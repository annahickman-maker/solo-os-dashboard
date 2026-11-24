/**
 * POST /api/reputation/analyse   session, or an agent key with brand:write
 *   -> { analysis: { analysed_at, pieces_count, scores, evidence, suggestions } }
 * Scores how well Value, Authority, Point of View and Connection come across
 * in the owner's published content (Memory documents of kind "content" and
 * published social post captions) and stores it in the reputation document
 * as content_analysis. No published content: every score 0, no AI call.
 *   412 { code: "AI_KEY_MISSING", error } when there is content but no ANTHROPIC_API_KEY.
 * Spends the owner's own Anthropic key: one Claude call per run.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { claudeAnalyser } from "@/lib/reputation/ai";
import { handleAnalyse, type ContentDb } from "@/lib/reputation/analyse";
import { readSoloDoc, writeSoloDoc } from "@/lib/solo/documents";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "brand:write");
  if (denied) return denied;
  const { status, body } = await handleAnalyse({
    // memory_documents and social_posts are read untyped (see SCHEMA-TYPES.md).
    db: createAdminClient() as unknown as ContentDb,
    readDoc: () => readSoloDoc("reputation"),
    writeDoc: (value) => writeSoloDoc("reputation", value),
    analyser: claudeAnalyser(),
  });
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
