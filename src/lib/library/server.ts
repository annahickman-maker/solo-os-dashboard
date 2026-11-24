/**
 * Library - the Supabase and R2 adapters for ./store.ts, plus the reads the
 * page and Setup use. Server only.
 *
 * Previews live in the private R2 bucket bound as LIBRARY_PREVIEWS (see
 * wrangler.jsonc and LIBRARY.md). Nothing in it is public: the dashboard
 * serves each preview through /api/library/preview/[id] to the owner.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminClient } from "@/lib/supabase/server";
import type { LibraryAsset, LibraryKind, LibrarySource, SyncRunInput } from "./contract";
import { DuplicateAssetError, type AssetRow, type LibraryDb, type PreviewBucket } from "./store";

// library_assets is not in the generated schema types yet; query it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => createAdminClient() as any;

export type StoredPreview = { body: ReadableStream; httpEtag: string; size: number; httpMetadata?: { contentType?: string } };
export type ServerPreviewBucket = PreviewBucket & { get(key: string): Promise<StoredPreview | null> };

/** The private previews bucket, or null when it is not bound yet. */
export function previewBucket(): ServerPreviewBucket | null {
  try {
    const env = getCloudflareContext().env as unknown as { LIBRARY_PREVIEWS?: ServerPreviewBucket };
    return env.LIBRARY_PREVIEWS ?? null;
  } catch {
    return null;
  }
}

const COLUMNS =
  "id, source, source_id, title, kind, original_url, original_label, preview_key, preview_type, preview_bytes, preview_sha256, width, height, duration_s, tags, collection, curated_at, hidden, meta, taken_at, added_at, updated_at";

function fail(what: string, error: { message?: string; code?: string }): never {
  if (error.code === "42P01" || /library_assets/.test(error.message || "")) {
    throw new Error(`Library ${what} failed: is migration 023_library.sql applied?`);
  }
  throw new Error(`Library ${what} failed: ${error.message || "database error"}`);
}

export function supabaseLibraryDb(client = db()): LibraryDb {
  return {
    async findBySource(source, sourceId) {
      const { data, error } = await client.from("library_assets").select(COLUMNS).eq("source", source).eq("source_id", sourceId).maybeSingle();
      if (error) fail("read", error);
      return (data as LibraryAsset) ?? null;
    },
    async findById(id) {
      const { data, error } = await client.from("library_assets").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) fail("read", error);
      return (data as LibraryAsset) ?? null;
    },
    async insert(row: AssetRow) {
      const { data, error } = await client.from("library_assets").insert(row).select(COLUMNS).single();
      if (error) {
        if (error.code === "23505") throw new DuplicateAssetError();
        fail("write", error);
      }
      return data as LibraryAsset;
    },
    async update(id, patch) {
      const { data, error } = await client.from("library_assets").update(patch).eq("id", id).select(COLUMNS).single();
      if (error) fail("write", error);
      return data as LibraryAsset;
    },
  };
}

export interface ListFilter {
  q?: string;
  kind?: LibraryKind;
  source?: LibrarySource;
  collection?: string;
  tag?: string;
  hidden?: boolean;
  limit?: number;
  before?: string;
}

/** Newest first. `before` is an added_at cursor for the next page. */
export async function listAssets(f: ListFilter): Promise<LibraryAsset[]> {
  let query = db().from("library_assets").select(COLUMNS).eq("hidden", f.hidden ?? false);
  if (f.kind) query = query.eq("kind", f.kind);
  if (f.source) query = query.eq("source", f.source);
  if (f.collection) query = query.eq("collection", f.collection);
  if (f.tag) query = query.contains("tags", [f.tag]);
  if (f.q) query = query.ilike("title", `%${f.q.replace(/[%_\\]/g, (c: string) => `\\${c}`)}%`);
  if (f.before) query = query.lt("added_at", f.before);
  const { data, error } = await query.order("added_at", { ascending: false }).limit(Math.min(Math.max(f.limit ?? 60, 1), 200));
  if (error) fail("read", error);
  return (data || []) as LibraryAsset[];
}

export interface LibraryStats {
  assets: number;
  visible: number;
  previews: number;
  preview_bytes: number;
  by_source: Record<string, number>;
  collections: Record<string, number>;
}

export async function libraryStats(): Promise<LibraryStats> {
  const { data, error } = await db().rpc("library_stats");
  if (error) fail("stats", error);
  return data as LibraryStats;
}

/** Every distinct tag on visible assets, most used first (capped). */
export async function libraryTags(): Promise<{ tag: string; n: number }[]> {
  const { data, error } = await db().from("library_assets").select("tags").eq("hidden", false).limit(5000);
  if (error) fail("read", error);
  const counts = new Map<string, number>();
  for (const row of (data || []) as { tags: string[] }[]) for (const t of row.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([tag, n]) => ({ tag, n }));
}

export async function recordSyncRun(run: SyncRunInput): Promise<void> {
  const { error } = await db().from("library_sync_runs").insert(run);
  if (error) fail("sync run", error);
}

export interface SyncRunRow extends SyncRunInput {
  id: string;
  finished_at: string;
}

/** The latest run per source. */
export async function latestSyncRuns(): Promise<Partial<Record<LibrarySource, SyncRunRow>>> {
  const { data, error } = await db().from("library_sync_runs").select("*").order("finished_at", { ascending: false }).limit(50);
  if (error) fail("sync runs", error);
  const out: Partial<Record<LibrarySource, SyncRunRow>> = {};
  for (const row of (data || []) as SyncRunRow[]) if (!out[row.source]) out[row.source] = row;
  return out;
}

/** Active YouTube connections from Social, with their refresh tokens. Server only. */
export async function youtubeConnections(): Promise<{ id: string; name: string; refresh_token: string | null }[]> {
  const { data, error } = await db().from("social_accounts").select("id, name, refresh_token, status").eq("platform", "youtube").eq("status", "active");
  if (error) return [];
  return (data || []) as { id: string; name: string; refresh_token: string | null }[];
}
