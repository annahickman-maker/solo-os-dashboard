/**
 * GET  /api/memory/settings   owner only -> status for Setup > Memory connections:
 *   { available, documents, chunks, embedded, last_import_at, embeddings_available,
 *     answers_available, inbox: { on, token_prefix, created_at } | { on: false }, inbox_path }
 * POST /api/memory/settings {action}   owner only
 *   "rotate": a new inbox token; returns { token } once. The old one stops working.
 *   "revoke": turns the inbox off.
 *   "embed":  embeds up to 100 passages that have no embedding yet.
 * Never returns a stored secret; the token exists in plaintext only in the rotate response.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateOwner, unauthorizedResponse } from "@/lib/api/auth";
import { readInboxSetting, revokeInboxToken, rotateInboxToken } from "@/lib/memory/inbox";
import { aiBinding, memoryDb, memoryEmbedder } from "@/lib/memory/server";
import { backfillEmbeddings, MemoryError, memoryStatus } from "@/lib/memory/store";

const noStore = { "Cache-Control": "no-store" };
const fail = (e: unknown) =>
  NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: e instanceof MemoryError ? e.status : 500 });

export async function GET(request: NextRequest) {
  const auth = await authenticateOwner(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  try {
    const db = memoryDb();
    const [status, inbox] = await Promise.all([memoryStatus(db), readInboxSetting(db)]);
    return NextResponse.json(
      {
        ...status,
        embeddings_available: !!aiBinding(),
        answers_available: !!process.env.ANTHROPIC_API_KEY,
        inbox: inbox ? { on: true, token_prefix: inbox.token_prefix, created_at: inbox.created_at } : { on: false },
        inbox_path: "/api/memory/inbox",
      },
      { headers: noStore },
    );
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateOwner(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  let body: { action?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const db = memoryDb();
    if (body.action === "rotate") {
      const { token, setting } = await rotateInboxToken(db);
      return NextResponse.json({ token, token_prefix: setting.token_prefix, created_at: setting.created_at }, { headers: noStore });
    }
    if (body.action === "revoke") {
      await revokeInboxToken(db);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "embed") {
      const embedder = memoryEmbedder();
      if (!embedder) return NextResponse.json({ error: "The Workers AI binding (AI) is not available here. It is on the deployed dashboard; local dev uses keyword search." }, { status: 409 });
      const result = await backfillEmbeddings(db, embedder, 100);
      return NextResponse.json({ ok: true, ...result, status: await memoryStatus(db) });
    }
    return NextResponse.json({ error: "action must be rotate, revoke or embed" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
