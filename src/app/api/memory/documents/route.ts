/**
 * GET  /api/memory/documents?q=&kind=&limit=&offset=   memory:read
 *   -> { documents, total, has_more } (no full text; see /api/memory/documents/{id})
 * POST /api/memory/documents                           memory:write
 *   JSON {text, title?, source?, source_id?, kind?, occurred_at?, url?, speakers?, owner_speaker?, format?}
 *   or a multipart form with a `file` field (.txt .md .vtt .srt).
 *   -> 201 {status:"created", id, chunks, embedded, pending_embeddings}, or 200 "updated" / "unchanged".
 * Idempotent on (source, source_id). The owner's session can always use both.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { inputFromRequest } from "@/lib/memory/inbox";
import { memoryDb, memoryEmbedder } from "@/lib/memory/server";
import { importDocument, listDocuments, MemoryError } from "@/lib/memory/store";
import { isMemoryKind } from "@/lib/memory/text";

const fail = (e: unknown) =>
  NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: e instanceof MemoryError ? e.status : 500 });

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "memory:read");
  if (denied) return denied;
  const p = request.nextUrl.searchParams;
  const kind = p.get("kind");
  try {
    const result = await listDocuments(memoryDb(), {
      q: (p.get("q") || "").trim() || null,
      kind: isMemoryKind(kind) ? kind : null,
      limit: Number(p.get("limit") || 30) || 30,
      offset: Number(p.get("offset") || 0) || 0,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "memory:write");
  if (denied) return denied;
  const byOwner = auth.mode === "session";
  const parsed = await inputFromRequest(request, byOwner ? "upload" : "agent");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  try {
    const result = await importDocument(memoryDb(), memoryEmbedder(), parsed.input, { addedBy: byOwner ? "owner" : auth.agent });
    return NextResponse.json({ ok: true, ...result }, { status: result.status === "created" ? 201 : 200 });
  } catch (e) {
    return fail(e);
  }
}
