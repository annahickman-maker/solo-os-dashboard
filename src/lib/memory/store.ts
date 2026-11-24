/**
 * Memory - the database half: import (idempotent on source + source_id),
 * list, read, delete, search and the embedding backfill.
 *
 * Takes the database and the embedder as arguments, so tests pass fakes.
 * Routes get the real ones from ./server.ts.
 */
import { EMBED_BATCH, vectorLiteral, type Embedder } from "./embed.ts";
import type { MemoryInput } from "./input.ts";
import { bestSnippet, chunkText, contentHash, type MemoryKind } from "./text.ts";

type DbError = { message: string; code?: string } | null;
export type DbResult<T = unknown> = { data: T | null; error: DbError; count?: number | null };

/** The slice of the Supabase query builder this module uses. */
export interface Query<T = unknown> extends PromiseLike<DbResult<T>> {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): Query<T>;
  insert(values: unknown): Query<T>;
  update(values: unknown): Query<T>;
  delete(): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  is(column: string, value: null): Query<T>;
  ilike(column: string, pattern: string): Query<T>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): Query<T>;
  range(from: number, to: number): Query<T>;
  limit(n: number): Query<T>;
  maybeSingle(): Query<T>;
  single(): Query<T>;
}

export interface MemoryDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are checked where they are read
  from(table: string): Query<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult<any>>;
}

export class MemoryError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/** Postgres/PostgREST codes for "the table or function is not there": migration 022 not applied. */
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
export function isMissingSchema(error: DbError): boolean {
  return !!error && (MISSING.has(error.code || "") || /does not exist|could not find/i.test(error.message));
}

function check(error: DbError, what: string): void {
  if (!error) return;
  if (isMissingSchema(error)) throw new MemoryError("Memory is not installed yet: apply migration 022_memory.sql.", 503);
  throw new MemoryError(`${what}: ${error.message}`);
}

// ── Import ──────────────────────────────────────────────────────────────────

/** Chunks embedded during the import request; the rest wait for the backfill. */
export const MAX_INLINE_EMBEDS = 150;
const INSERT_BATCH = 200;

export type ImportResult = {
  status: "created" | "updated" | "unchanged";
  id: string;
  title: string;
  chunks: number;
  embedded: number;
  /** Chunks still waiting for an embedding (no AI binding, a model error, or a long document). */
  pending_embeddings: number;
};

type ExistingDoc = {
  id: string; content_hash: string; title: string; kind: string; occurred_at: string | null;
  url: string | null; owner_speaker: string | null; chunk_count: number;
};

function sameTime(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b;
  return Date.parse(a) === Date.parse(b);
}

/** Embeds up to `max` texts; returns literals, or nulls where it could not. */
async function embedPassages(embedder: Embedder | null, texts: string[], max: number): Promise<(string | null)[]> {
  const out: (string | null)[] = texts.map(() => null);
  if (!embedder) return out;
  const n = Math.min(texts.length, max);
  for (let i = 0; i < n; i += EMBED_BATCH) {
    try {
      const vectors = await embedder.embed(texts.slice(i, Math.min(n, i + EMBED_BATCH)), "passage");
      vectors.forEach((v, j) => { out[i + j] = vectorLiteral(v); });
    } catch {
      break; // keyword search still finds these; the backfill retries them
    }
  }
  return out;
}

export async function importDocument(
  db: MemoryDb,
  embedder: Embedder | null,
  input: MemoryInput,
  opts: { addedBy: string; maxInlineEmbeds?: number } = { addedBy: "owner" },
): Promise<ImportResult> {
  const hash = contentHash(input.text);
  const columns = "id, content_hash, title, kind, occurred_at, url, owner_speaker, chunk_count";
  const find = async () => {
    const { data, error } = await db.from("memory_documents").select(columns).eq("source", input.source).eq("source_id", input.source_id).maybeSingle();
    check(error, "Could not look up the document");
    return data as ExistingDoc | null;
  };

  const meta = {
    title: input.title,
    kind: input.kind,
    occurred_at: input.occurred_at,
    url: input.url,
    owner_speaker: input.owner_speaker,
    speakers: input.speakers,
    metadata: { ...input.metadata, format: input.format },
  };

  let existing = await find();
  if (existing && existing.content_hash === hash) {
    const changed =
      existing.title !== input.title || existing.kind !== input.kind || !sameTime(existing.occurred_at, input.occurred_at) ||
      existing.url !== input.url || existing.owner_speaker !== input.owner_speaker;
    if (changed) {
      const { error } = await db.from("memory_documents").update(meta).eq("id", existing.id);
      check(error, "Could not update the document");
    }
    return { status: changed ? "updated" : "unchanged", id: existing.id, title: input.title, chunks: existing.chunk_count, embedded: 0, pending_embeddings: 0 };
  }

  const chunks = chunkText(input.text);
  const vectors = await embedPassages(embedder, chunks, opts.maxInlineEmbeds ?? MAX_INLINE_EMBEDS);

  let id: string;
  if (existing) {
    id = existing.id;
  } else {
    // content_hash stays '' until the chunks are written, so an import that
    // dies halfway is redone by the next attempt instead of being "unchanged".
    const { data, error } = await db
      .from("memory_documents")
      .insert({ source: input.source, source_id: input.source_id, ...meta, raw_text: input.text, content_hash: "", added_by: opts.addedBy })
      .select("id")
      .single();
    if (error?.code === "23505") {
      existing = await find(); // the same document arriving twice at once
      if (!existing) throw new MemoryError("Could not create the document: it was created and removed at the same time", 409);
      id = existing.id;
    } else {
      check(error, "Could not create the document");
      id = (data as { id: string }).id;
    }
  }

  if (existing) {
    const { error } = await db.from("memory_chunks").delete().eq("document_id", id);
    check(error, "Could not replace the old passages");
  }
  const rows = chunks.map((content, i) => ({ document_id: id, chunk_index: i, content, embedding: vectors[i] }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await db.from("memory_chunks").insert(rows.slice(i, i + INSERT_BATCH));
    check(error, "Could not save the passages");
  }

  const { error } = await db
    .from("memory_documents")
    .update({ ...meta, raw_text: input.text, content_hash: hash, bytes: new TextEncoder().encode(input.text).length, chunk_count: chunks.length, added_by: opts.addedBy })
    .eq("id", id);
  check(error, "Could not finish the document");

  const embedded = vectors.filter(Boolean).length;
  return { status: existing ? "updated" : "created", id, title: input.title, chunks: chunks.length, embedded, pending_embeddings: chunks.length - embedded };
}

// ── Browse ──────────────────────────────────────────────────────────────────

export type DocumentSummary = {
  id: string; source: string; source_id: string; title: string; kind: MemoryKind; occurred_at: string | null;
  url: string | null; chunk_count: number; bytes: number; created_at: string; updated_at: string;
};
export type MemoryDocument = DocumentSummary & { raw_text: string; speakers: string[]; owner_speaker: string | null; added_by: string | null };

const SUMMARY_COLUMNS = "id, source, source_id, title, kind, occurred_at, url, chunk_count, bytes, created_at, updated_at";

/** Escapes % _ and \ so a typed title search matches literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listDocuments(db: MemoryDb, opts: { q?: string | null; kind?: MemoryKind | null; limit?: number; offset?: number } = {}) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const offset = Math.max(0, opts.offset ?? 0);
  let query = db.from("memory_documents").select(SUMMARY_COLUMNS, { count: "exact" });
  if (opts.kind) query = query.eq("kind", opts.kind);
  if (opts.q) query = query.ilike("title", likePattern(opts.q.slice(0, 200)));
  const { data, error, count } = await query
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  check(error, "Could not list documents");
  const documents = (data || []) as DocumentSummary[];
  return { documents, total: count ?? documents.length, has_more: offset + documents.length < (count ?? 0) };
}

export async function getDocument(db: MemoryDb, id: string): Promise<MemoryDocument | null> {
  const { data, error } = await db
    .from("memory_documents")
    .select(`${SUMMARY_COLUMNS}, raw_text, speakers, owner_speaker, added_by`)
    .eq("id", id)
    .maybeSingle();
  check(error, "Could not read the document");
  return (data as MemoryDocument | null) || null;
}

/** One passage's text, to highlight it in the document it came from. */
export async function getPassage(db: MemoryDb, documentId: string, index: number): Promise<string | null> {
  const { data, error } = await db.from("memory_chunks").select("content").eq("document_id", documentId).eq("chunk_index", index).maybeSingle();
  check(error, "Could not read the passage");
  return (data as { content?: string } | null)?.content ?? null;
}

export async function deleteDocument(db: MemoryDb, id: string): Promise<boolean> {
  const { data, error } = await db.from("memory_documents").delete().eq("id", id).select("id");
  check(error, "Could not delete the document");
  return Array.isArray(data) && data.length > 0;
}

// ── Search ──────────────────────────────────────────────────────────────────

export type SearchMode = "meaning+keywords" | "keywords";

export type MemoryHit = {
  document_id: string; title: string; kind: MemoryKind; source: string; occurred_at: string | null; url: string | null;
  owner_speaker: string | null; chunk_index: number; content: string; score: number; matched: "both" | "meaning" | "keywords";
  snippet: string;
};

/** The question's embedding, or null: no AI binding, a model error or a bad vector all mean keywords only. */
export async function embedQuery(embedder: Embedder | null, q: string): Promise<string | null> {
  if (!embedder) return null;
  try {
    const [v] = await embedder.embed([q], "query");
    return v ? vectorLiteral(v) : null;
  } catch {
    return null;
  }
}

export async function searchMemory(
  db: MemoryDb,
  embedder: Embedder | null,
  q: string,
  opts: { kind?: MemoryKind | null; limit?: number } = {},
): Promise<{ mode: SearchMode; results: MemoryHit[] }> {
  const embedding = await embedQuery(embedder, q);
  const { data, error } = await db.rpc("memory_search", {
    query_text: q,
    query_embedding: embedding,
    match_count: Math.min(50, Math.max(1, opts.limit ?? 12)),
    kind_filter: opts.kind ?? null,
  });
  check(error, "Search failed");
  const rows = (data || []) as Omit<MemoryHit, "snippet">[];
  return {
    mode: embedding ? "meaning+keywords" : "keywords",
    results: rows.map((r) => ({ ...r, snippet: bestSnippet(r.content, q) })),
  };
}

// ── Status and backfill ─────────────────────────────────────────────────────

export type MemoryStatus = { available: boolean; documents: number; chunks: number; embedded: number; last_import_at: string | null };

export async function memoryStatus(db: MemoryDb): Promise<MemoryStatus> {
  const { data, error } = await db.rpc("memory_status");
  if (isMissingSchema(error)) return { available: false, documents: 0, chunks: 0, embedded: 0, last_import_at: null };
  check(error, "Could not read memory status");
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    available: true,
    documents: Number(row?.documents ?? 0),
    chunks: Number(row?.chunks ?? 0),
    embedded: Number(row?.embedded ?? 0),
    last_import_at: (row?.last_import_at as string | null) ?? null,
  };
}

/** Embeds up to `limit` passages that have none yet. */
export async function backfillEmbeddings(db: MemoryDb, embedder: Embedder, limit = 100): Promise<{ embedded: number }> {
  const { data, error } = await db.from("memory_chunks").select("id, content").is("embedding", null).limit(Math.min(500, Math.max(1, limit)));
  check(error, "Could not read passages");
  const rows = (data || []) as { id: string; content: string }[];
  let embedded = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const vectors = await embedder.embed(batch.map((r) => r.content), "passage");
    const items = batch.map((r, j) => ({ id: r.id, embedding: vectorLiteral(vectors[j]) }));
    const res = await db.rpc("memory_set_embeddings", { items });
    check(res.error, "Could not save embeddings");
    embedded += Number(res.data ?? items.length);
  }
  return { embedded };
}
