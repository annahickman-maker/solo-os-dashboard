/**
 * GET    /api/memory/documents/{id}?passage=N   memory:read  -> { document, passage? } with its full text
 * DELETE /api/memory/documents/{id}   owner only (session or master key)
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateOwner, authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { memoryDb } from "@/lib/memory/server";
import { deleteDocument, getDocument, getPassage, MemoryError } from "@/lib/memory/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (e: unknown) =>
  NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: e instanceof MemoryError ? e.status : 500 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "memory:read");
  if (denied) return denied;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const db = memoryDb();
    const document = await getDocument(db, id);
    if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const n = Number(request.nextUrl.searchParams.get("passage"));
    const passage = Number.isInteger(n) && n >= 0 && request.nextUrl.searchParams.has("passage") ? await getPassage(db, id, n) : null;
    return NextResponse.json({ document, passage }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOwner(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const gone = await deleteDocument(memoryDb(), id);
    return gone ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}
