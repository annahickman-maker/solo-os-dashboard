/**
 * Library - the pure half: what an asset looks like, input validation and
 * preview limits. No framework imports, so `node --test` loads it directly.
 *
 * The Library stores PREVIEWS ONLY. An original stays where it lives (a Mac
 * folder, Google Drive, Dropbox, YouTube, any link); a row here holds a small
 * preview image and a link or path label back to it. See LIBRARY.md.
 */

export const LIBRARY_SOURCES = ["mac", "gdrive", "dropbox", "youtube", "link", "upload"] as const;
export type LibrarySource = (typeof LIBRARY_SOURCES)[number];

export const LIBRARY_KINDS = ["image", "video", "audio", "doc"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const PREVIEW_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type PreviewType = (typeof PREVIEW_TYPES)[number];

/** A preview is a thumbnail, not a copy: 400 KiB and 1024px on the long edge at most. */
export const MAX_PREVIEW_BYTES = 400 * 1024;
export const MAX_PREVIEW_EDGE = 1024;
/** The size previews are made at by the sync script and the dashboard. */
export const PREVIEW_TARGET_EDGE = 800;
/** JSON body cap for POST /api/library/assets: base64 preview plus metadata. */
export const MAX_BODY_BYTES = Math.ceil((MAX_PREVIEW_BYTES * 4) / 3) + 64 * 1024;

export const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 40;

export const SOURCE_LABEL: Record<LibrarySource, string> = {
  mac: "Mac folder",
  gdrive: "Google Drive",
  dropbox: "Dropbox",
  youtube: "YouTube",
  link: "Link",
  upload: "Upload",
};

export interface LibraryAsset {
  id: string;
  source: LibrarySource;
  source_id: string;
  title: string;
  kind: LibraryKind;
  original_url: string | null;
  original_label: string | null;
  preview_key: string | null;
  preview_type: PreviewType | null;
  preview_bytes: number;
  preview_sha256: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  tags: string[];
  collection: string | null;
  curated_at: string | null;
  hidden: boolean;
  meta: Record<string, unknown>;
  taken_at: string | null;
  added_at: string;
  updated_at: string;
}

/** What an ingest call may set. Validated; never trusted raw. */
export interface AssetInput {
  source: LibrarySource;
  source_id: string;
  title: string;
  kind: LibraryKind;
  original_url: string | null;
  original_label: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  tags: string[];
  collection: string | null;
  taken_at: string | null;
  meta: Record<string, unknown>;
  /** Base64 of the preview image, when one is sent. */
  preview_base64: string | null;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const bad = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });

function optText(v: unknown, max: number, name: string): Checked<string | null> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return bad(`${name} must be a string`);
  const t = v.trim();
  if (t.length > max) return bad(`${name} is longer than ${max} characters`);
  return { ok: true, value: t || null };
}

function optPositiveInt(v: unknown, name: string): Checked<number | null> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 100_000) return bad(`${name} must be a positive whole number`);
  return { ok: true, value: n };
}

/** http(s) only; anything else (javascript:, data:, file:) is refused. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim() || v.length > 2000) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Lowercase, trimmed, de-duplicated, at most MAX_TAGS. Accepts an array or "a, b". */
export function normaliseTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function normaliseCollection(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  return t || null;
}

export function validateAssetInput(body: unknown): Checked<AssetInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");
  const b = body as Record<string, unknown>;

  if (typeof b.source !== "string" || !(LIBRARY_SOURCES as readonly string[]).includes(b.source)) {
    return bad(`source must be one of ${LIBRARY_SOURCES.join(", ")}`);
  }
  const source = b.source as LibrarySource;
  if (typeof b.source_id !== "string" || !b.source_id.trim() || b.source_id.length > 1000) {
    return bad("source_id is required (1-1000 characters): the original's stable id in its source");
  }
  if (typeof b.kind !== "string" || !(LIBRARY_KINDS as readonly string[]).includes(b.kind)) {
    return bad(`kind must be one of ${LIBRARY_KINDS.join(", ")}`);
  }
  const title = optText(b.title, 300, "title");
  if (!title.ok) return title;
  const label = optText(b.original_label, 1000, "original_label");
  if (!label.ok) return label;

  let originalUrl: string | null = null;
  if (b.original_url !== undefined && b.original_url !== null && b.original_url !== "") {
    originalUrl = safeUrl(b.original_url);
    if (!originalUrl) return bad("original_url must be an http or https link");
  }
  if (source === "link" && !originalUrl) return bad("A link asset needs original_url");
  if (!originalUrl && !label.value) return bad("Send original_url or original_label so the original can be found");

  const width = optPositiveInt(b.width, "width");
  if (!width.ok) return width;
  const height = optPositiveInt(b.height, "height");
  if (!height.ok) return height;

  let duration: number | null = null;
  if (b.duration_s !== undefined && b.duration_s !== null && b.duration_s !== "") {
    const d = Number(b.duration_s);
    if (!Number.isFinite(d) || d < 0 || d > 1_000_000) return bad("duration_s must be a number of seconds");
    duration = Math.round(d * 100) / 100;
  }

  let takenAt: string | null = null;
  if (b.taken_at !== undefined && b.taken_at !== null && b.taken_at !== "") {
    const t = typeof b.taken_at === "string" ? Date.parse(b.taken_at) : NaN;
    if (!Number.isFinite(t)) return bad("taken_at must be an ISO date");
    takenAt = new Date(t).toISOString();
  }

  let meta: Record<string, unknown> = {};
  if (b.meta !== undefined && b.meta !== null) {
    if (typeof b.meta !== "object" || Array.isArray(b.meta)) return bad("meta must be an object");
    if (JSON.stringify(b.meta).length > 4000) return bad("meta is larger than 4000 characters");
    meta = b.meta as Record<string, unknown>;
  }

  let preview: string | null = null;
  if (b.preview_base64 !== undefined && b.preview_base64 !== null && b.preview_base64 !== "") {
    if (typeof b.preview_base64 !== "string") return bad("preview_base64 must be a base64 string");
    if (b.preview_base64.length > Math.ceil((MAX_PREVIEW_BYTES * 4) / 3) + 4) {
      return bad(`Preview is larger than ${MAX_PREVIEW_BYTES / 1024} KiB. Send a thumbnail, not the original.`, 413);
    }
    preview = b.preview_base64;
  }

  return {
    ok: true,
    value: {
      source,
      source_id: b.source_id.trim(),
      title: title.value || "",
      kind: b.kind as LibraryKind,
      original_url: originalUrl,
      original_label: label.value,
      width: width.value,
      height: height.value,
      duration_s: duration,
      tags: normaliseTags(b.tags),
      collection: normaliseCollection(b.collection),
      taken_at: takenAt,
      meta,
      preview_base64: preview,
    },
  };
}

export function decodeBase64(b64: string): Uint8Array | null {
  try {
    const clean = b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export interface SniffedImage {
  type: PreviewType;
  width: number | null;
  height: number | null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/**
 * The image type from its first bytes (the declared type is never trusted),
 * with pixel dimensions where the header carries them. Null for anything that
 * is not a JPEG, PNG or WebP.
 */
export function sniffImage(b: Uint8Array): SniffedImage | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { type: "image/png", width: u32be(b, 16) || null, height: u32be(b, 20) || null };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { type: "image/jpeg", height: u16be(b, i + 5) || null, width: u16be(b, i + 7) || null };
      if (len < 2) break;
      i += 2 + len;
    }
    return { type: "image/jpeg", width: null, height: null };
  }
  if (b.length >= 30 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...b.slice(12, 16));
    if (chunk === "VP8X") return { type: "image/webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === "VP8 ") return { type: "image/webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { type: "image/webp", width: null, height: null };
  }
  return null;
}

export type CheckedPreview = Checked<{ bytes: Uint8Array; type: PreviewType; width: number | null; height: number | null }>;

/** Size, type and dimension limits for a preview image. */
export function checkPreview(b64: string): CheckedPreview {
  const bytes = decodeBase64(b64);
  if (!bytes || bytes.length === 0) return bad("preview_base64 is not valid base64");
  if (bytes.length > MAX_PREVIEW_BYTES) {
    return bad(`Preview is larger than ${MAX_PREVIEW_BYTES / 1024} KiB. Send a thumbnail, not the original.`, 413);
  }
  const img = sniffImage(bytes);
  if (!img) return bad("Preview must be a JPEG, PNG or WebP image", 415);
  if ((img.width && img.width > MAX_PREVIEW_EDGE) || (img.height && img.height > MAX_PREVIEW_EDGE)) {
    return bad(`Preview is larger than ${MAX_PREVIEW_EDGE}px on its long edge. Resize it to about ${PREVIEW_TARGET_EDGE}px.`, 413);
  }
  return { ok: true, value: { bytes, ...img } };
}

const EXT: Record<PreviewType, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

/**
 * The R2 key for an asset's preview. Derived from (source, source_id), so a
 * re-sent preview overwrites the same object instead of adding another.
 */
export async function previewKey(source: LibrarySource, sourceId: string, type: PreviewType): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${source}\n${sourceId}`));
  const hex = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
  return `library/${source}/${hex.slice(0, 40)}.${EXT[type]}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface CurationInput {
  tags?: string[];
  collection?: string | null;
  hidden?: boolean;
  title?: string;
}

/** The fields the owner may change from the dashboard. */
export function validateCuration(body: unknown): Checked<CurationInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");
  const b = body as Record<string, unknown>;
  const out: CurationInput = {};
  if ("tags" in b) out.tags = normaliseTags(b.tags);
  if ("collection" in b) out.collection = normaliseCollection(b.collection);
  if ("hidden" in b) {
    if (typeof b.hidden !== "boolean") return bad("hidden must be true or false");
    out.hidden = b.hidden;
  }
  if ("title" in b) {
    const t = optText(b.title, 300, "title");
    if (!t.ok) return t;
    out.title = t.value || "";
  }
  if (Object.keys(out).length === 0) return bad("Nothing to change: send tags, collection, hidden or title");
  return { ok: true, value: out };
}

export interface SyncRunInput {
  source: LibrarySource;
  label: string | null;
  status: "ok" | "partial" | "failed";
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  note: string | null;
  started_at: string | null;
}

export function validateSyncRun(body: unknown): Checked<SyncRunInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");
  const b = body as Record<string, unknown>;
  if (typeof b.source !== "string" || !(LIBRARY_SOURCES as readonly string[]).includes(b.source)) {
    return bad(`source must be one of ${LIBRARY_SOURCES.join(", ")}`);
  }
  const status = b.status === undefined ? "ok" : b.status;
  if (status !== "ok" && status !== "partial" && status !== "failed") return bad("status must be ok, partial or failed");
  const count = (k: string) => {
    const n = Number(b[k] ?? 0);
    return Number.isInteger(n) && n >= 0 && n < 10_000_000 ? n : -1;
  };
  const counts = { scanned: count("scanned"), created: count("created"), updated: count("updated"), unchanged: count("unchanged"), failed: count("failed") };
  if (Object.values(counts).some((n) => n < 0)) return bad("counts must be whole numbers");
  const label = optText(b.label, 200, "label");
  if (!label.ok) return label;
  const note = optText(b.note, 1000, "note");
  if (!note.ok) return note;
  let started: string | null = null;
  if (typeof b.started_at === "string" && Number.isFinite(Date.parse(b.started_at))) started = new Date(b.started_at).toISOString();
  return { ok: true, value: { source: b.source as LibrarySource, label: label.value, status, ...counts, note: note.value, started_at: started } };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
