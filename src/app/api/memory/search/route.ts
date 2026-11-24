/**
 * GET /api/memory/search?q=&kind=&limit=   memory:read
 * Passages from the owner's memory, best first. Free: no Claude call.
 * mode is "meaning+keywords" with the Workers AI binding, else "keywords".
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { memoryDb, memoryEmbedder } from "@/lib/memory/server";
import { MemoryError, searchMemory } from "@/lib/memory/store";
import { isMemoryKind } from "@/lib/memory/text";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "memory:read");
  if (denied) return denied;
  const p = request.nextUrl.searchParams;
  const q = (p.get("q") || "").trim().slice(0, 500);
  if (q.length < 2) return NextResponse.json({ error: "q is required" }, { status: 400 });
  const kind = p.get("kind");
  try {
    const result = await searchMemory(memoryDb(), memoryEmbedder(), q, {
      kind: isMemoryKind(kind) ? kind : null,
      limit: Number(p.get("limit") || 12) || 12,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Search failed" }, { status: e instanceof MemoryError ? e.status : 500 });
  }
}
