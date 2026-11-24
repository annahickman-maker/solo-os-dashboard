/**
 * POST /api/memory/ask {question, kind?}   memory:read
 *   -> { answer, found, used, sources: [{number, document_id, title, occurred_at, url, snippet}], mode }
 *   412 { code: "AI_KEY_MISSING", error } when ANTHROPIC_API_KEY is not set (search still works).
 * Spends the owner's own Anthropic key: one Claude call per question.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { answerQuestion, describeAnswerError, MISSING_KEY_MESSAGE } from "@/lib/memory/answer";
import { memoryDb, memoryEmbedder } from "@/lib/memory/server";
import { MemoryError, searchMemory } from "@/lib/memory/store";
import { isMemoryKind } from "@/lib/memory/text";

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "memory:read");
  if (denied) return denied;
  let body: { question?: unknown; kind?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  if (question.length < 3) return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: MISSING_KEY_MESSAGE, code: "AI_KEY_MISSING" }, { status: 412 });

  let search;
  try {
    search = await searchMemory(memoryDb(), memoryEmbedder(), question, { kind: isMemoryKind(body.kind) ? body.kind : null, limit: 10 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Search failed" }, { status: e instanceof MemoryError ? e.status : 500 });
  }
  try {
    const answer = await answerQuestion(question, search.results);
    return NextResponse.json({ ...answer, mode: search.mode }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const { message, status, code } = describeAnswerError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
