/**
 * Memory - what a new document looks like, from any door (the page, the
 * inbox, an agent key), and the inbox token. Pure: no framework imports.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  contentHash,
  isMemoryKind,
  isValidSource,
  MAX_BODY_BYTES,
  MAX_TEXT_CHARS,
  parseText,
  titleFromFilename,
  titleFromText,
  type MemoryKind,
  type TextFormat,
} from "./text.ts";

export type MemoryInput = {
  source: string;
  source_id: string;
  title: string;
  kind: MemoryKind;
  occurred_at: string | null;
  url: string | null;
  speakers: string[];
  owner_speaker: string | null;
  text: string;
  format: TextFormat;
  metadata: Record<string, unknown>;
};

export type InputResult = { ok: true; input: MemoryInput } | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): InputResult => ({ ok: false, error, status });

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function isoOrNull(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  if (!Number.isFinite(t)) return undefined;
  const year = new Date(t).getUTCFullYear();
  if (year < 1900 || year > 2200) return undefined;
  return new Date(t).toISOString();
}

/**
 * Validates and normalises one document. `fields` is the JSON body (or the
 * query parameters plus a raw file). `defaults` fills what the door knows:
 * the page says source "upload", the inbox "inbox".
 */
export function buildInput(fields: Record<string, unknown>, defaults: { source: string; filename?: string | null; contentType?: string | null }): InputResult {
  const rawText = typeof fields.text === "string" ? fields.text : typeof fields.transcript === "string" ? fields.transcript : null;
  if (rawText === null) return fail("text is required: the transcript, note or caption file as a string");
  if (rawText.length > MAX_BODY_BYTES) return fail(`text is too long (over ${MAX_BODY_BYTES} characters)`, 413);

  const filename = str(fields.filename, 300) || defaults.filename || null;
  const hint = str(fields.format, 20) || filename || defaults.contentType || null;
  const parsed = parseText(rawText, hint);
  if (!parsed.text) return fail("text is empty after removing timestamps and markup");
  if (parsed.text.length > MAX_TEXT_CHARS) return fail(`text is too long (over ${MAX_TEXT_CHARS} characters once cleaned); split it into parts`, 413);

  const source = (str(fields.source, 64) || defaults.source).toLowerCase();
  if (!isValidSource(source)) return fail("source must be 1-64 characters: lowercase letters, digits, _ . : or -, starting with a letter or digit");

  const kindRaw = fields.kind === undefined || fields.kind === null || fields.kind === "" ? "note" : fields.kind;
  if (!isMemoryKind(kindRaw)) return fail("kind must be conversation, content or note");

  const occurred = isoOrNull(fields.occurred_at ?? fields.date);
  if (occurred === undefined) return fail("occurred_at must be an ISO date (2026-03-04 or 2026-03-04T10:00:00Z) or a Unix time");

  const url = str(fields.url, 2000);
  if (url && !/^https?:\/\//i.test(url)) return fail("url must start with http:// or https://");

  // No source_id: the same text from the same source is the same document.
  const sourceId = str(typeof fields.source_id === "number" ? String(fields.source_id) : fields.source_id, 500) || contentHash(parsed.text).slice(7, 39);

  const given = Array.isArray(fields.speakers) ? fields.speakers.map((s) => str(s, 200)).filter((s): s is string => !!s) : [];
  const speakers = [...new Set([...given, ...parsed.speakers])].slice(0, 50);

  const title = str(fields.title, 300) || (filename ? titleFromFilename(filename) : titleFromText(parsed.text));
  const metadata = fields.metadata && typeof fields.metadata === "object" && !Array.isArray(fields.metadata) ? (fields.metadata as Record<string, unknown>) : {};
  if (JSON.stringify(metadata).length > 10_000) return fail("metadata is too large (10 KB at most)");

  return {
    ok: true,
    input: {
      source,
      source_id: sourceId,
      title,
      kind: kindRaw,
      occurred_at: occurred,
      url,
      speakers,
      owner_speaker: str(fields.owner_speaker, 200),
      text: parsed.text,
      format: parsed.format,
      metadata,
    },
  };
}

/** Raw file bodies the inbox accepts without JSON. */
export function isRawTextType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.startsWith("text/") || ct.includes("subrip") || ct.includes("vtt") || ct.includes("markdown") || ct === "application/octet-stream";
}

/** Metadata for a raw body comes from the query string: ?source=zoom&source_id=...&title=... */
export function fieldsFromQuery(params: URLSearchParams, text: string): Record<string, unknown> {
  const fields: Record<string, unknown> = { text };
  for (const key of ["source", "source_id", "title", "kind", "occurred_at", "url", "owner_speaker", "filename", "format"]) {
    const v = params.get(key);
    if (v !== null) fields[key] = v;
  }
  return fields;
}

// ── The inbox token ─────────────────────────────────────────────────────────

export const INBOX_TOKEN_PREFIX = "mem_";
const TOKEN_RE = /^mem_[0-9a-f]{40}$/;

export type InboxSetting = {
  token_hash: string;
  token_prefix: string;
  created_at: string;
};

export function newInboxToken(random: string = randomBytes(20).toString("hex")): string {
  return INBOX_TOKEN_PREFIX + random;
}

export function hashInboxToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** What the owner sees after the token is gone: mem_ and four characters. */
export function inboxTokenDisplay(token: string): string {
  return token.slice(0, INBOX_TOKEN_PREFIX.length + 4);
}

/** The token from Authorization: Bearer ... or X-Memory-Token. Never from the URL. */
export function tokenFromHeaders(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  return bearer || headers.get("x-memory-token")?.trim() || null;
}

/** Constant-time check of a presented token against the stored hash. */
export function inboxTokenMatches(presented: string | null, setting: InboxSetting | null): boolean {
  if (!presented || !setting?.token_hash || !TOKEN_RE.test(presented)) return false;
  const a = Buffer.from(hashInboxToken(presented), "hex");
  const b = Buffer.from(setting.token_hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isInboxSetting(v: unknown): v is InboxSetting {
  const s = v as InboxSetting | null;
  return !!s && typeof s === "object" && typeof s.token_hash === "string" && /^[0-9a-f]{64}$/.test(s.token_hash);
}
