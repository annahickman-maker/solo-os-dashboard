/**
 * Memory - reading a new document out of a request, and the universal inbox
 * (POST /api/memory/inbox): one secret token per dashboard, stored hashed in
 * backend_settings.memory_inbox. Works with Zapier, Make, a shell script or
 * scripts/memory-import.mjs. See MEMORY.md for payloads.
 *
 * Framework-free: it takes a standard Request and returns a standard
 * Response, so tests drive it with fakes.
 */
import type { Embedder } from "./embed.ts";
import {
  buildInput,
  fieldsFromQuery,
  hashInboxToken,
  inboxTokenDisplay,
  inboxTokenMatches,
  isInboxSetting,
  isRawTextType,
  newInboxToken,
  tokenFromHeaders,
  type InboxSetting,
  type InputResult,
} from "./input.ts";
import { importDocument, MemoryError, type MemoryDb } from "./store.ts";
import { MAX_BODY_BYTES } from "./text.ts";

export const INBOX_SETTING_KEY = "memory_inbox";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/**
 * One document from a request: JSON ({text, title, ...}), a multipart form
 * with a `file` field, or a raw text/caption body with its details in the
 * query string. Size is checked before and after reading.
 */
export async function inputFromRequest(request: Request, defaultSource: string): Promise<InputResult> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return { ok: false, error: `Body too large (over ${MAX_BODY_BYTES} bytes)`, status: 413 };
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  const url = new URL(request.url);

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await request.formData(); } catch { return { ok: false, error: "Could not read the form", status: 400 }; }
    const file = form.get("file");
    const fields: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
    let filename: string | null = null;
    if (file && typeof file !== "string") {
      if (file.size > MAX_BODY_BYTES) return { ok: false, error: `File too large (over ${MAX_BODY_BYTES} bytes)`, status: 413 };
      fields.text = await file.text();
      filename = file.name || null;
    }
    return buildInput(fields, { source: defaultSource, filename, contentType: file && typeof file !== "string" ? file.type : null });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, error: `Body too large (over ${MAX_BODY_BYTES} bytes)`, status: 413 };

  if (contentType.includes("application/json") || (!contentType && /^\s*\{/.test(text))) {
    let body: unknown;
    try { body = JSON.parse(text); } catch { return { ok: false, error: "Invalid JSON", status: 400 }; }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send one document as a JSON object", status: 400 };
    return buildInput(body as Record<string, unknown>, { source: defaultSource });
  }

  if (!contentType || isRawTextType(contentType)) {
    const fields = fieldsFromQuery(url.searchParams, text);
    return buildInput(fields, { source: defaultSource, filename: (fields.filename as string) || null, contentType });
  }
  return { ok: false, error: "Send JSON, a multipart form with a file field, or a plain text / .vtt / .srt body", status: 415 };
}

// ── The inbox token in backend_settings ─────────────────────────────────────

export async function readInboxSetting(db: MemoryDb): Promise<InboxSetting | null> {
  const { data, error } = await db.from("backend_settings").select("value").eq("key", INBOX_SETTING_KEY).maybeSingle();
  if (error) throw new MemoryError(`Could not read the inbox setting: ${error.message}`);
  const value = (data as { value?: unknown } | null)?.value;
  return isInboxSetting(value) ? value : null;
}

/** A new token; replaces any earlier one. The plaintext is returned once and never stored. */
export async function rotateInboxToken(db: MemoryDb, now = new Date(), random?: string): Promise<{ token: string; setting: InboxSetting }> {
  const token = newInboxToken(random);
  const setting: InboxSetting = { token_hash: hashInboxToken(token), token_prefix: inboxTokenDisplay(token), created_at: now.toISOString() };
  const { data: existing, error: readError } = await db.from("backend_settings").select("key").eq("key", INBOX_SETTING_KEY).maybeSingle();
  if (readError) throw new MemoryError(`Could not save the inbox token: ${readError.message}`);
  const { error } = existing
    ? await db.from("backend_settings").update({ value: setting }).eq("key", INBOX_SETTING_KEY)
    : await db.from("backend_settings").insert({ key: INBOX_SETTING_KEY, value: setting });
  if (error) throw new MemoryError(`Could not save the inbox token: ${error.message}`);
  return { token, setting };
}

/** Turns the inbox off: the stored hash is removed, every old token stops working. */
export async function revokeInboxToken(db: MemoryDb): Promise<void> {
  const { error } = await db.from("backend_settings").delete().eq("key", INBOX_SETTING_KEY);
  if (error) throw new MemoryError(`Could not turn the inbox off: ${error.message}`);
}

// ── POST /api/memory/inbox ──────────────────────────────────────────────────

export async function handleInbox(request: Request, deps: { db: MemoryDb; embedder: Embedder | null }): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  let setting: InboxSetting | null;
  try {
    setting = await readInboxSetting(deps.db);
  } catch {
    return json({ error: "The inbox is unavailable right now" }, 503);
  }
  if (!setting) return json({ error: "The memory inbox is off. Turn it on in Setup > Memory connections." }, 403);
  if (!inboxTokenMatches(tokenFromHeaders(request.headers), setting)) {
    return json({ error: "Missing or wrong inbox token. Send it as Authorization: Bearer <token>." }, 401);
  }

  const parsed = await inputFromRequest(request, "inbox");
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  try {
    const result = await importDocument(deps.db, deps.embedder, parsed.input, { addedBy: "inbox" });
    return json({ ok: true, ...result, source: parsed.input.source, source_id: parsed.input.source_id }, result.status === "created" ? 201 : 200);
  } catch (e) {
    const status = e instanceof MemoryError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : "Import failed" }, status);
  }
}
