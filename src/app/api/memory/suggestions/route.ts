/**
 * GET /api/memory/suggestions   memory:read
 * -> { questions: string[] }: six questions written from the published Brand
 * Playbook's audience research, kept until the playbook changes. Empty when
 * no playbook is published or ANTHROPIC_API_KEY is not set. Spends the
 * owner's Anthropic key once per playbook.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { getBrandPlaybook } from "@/lib/brand/playbook-store";
import { playbookFingerprint } from "@/lib/brand/playbook-contract";
import { readSoloDoc, writeSoloDoc } from "@/lib/solo/documents";
import { audienceDigest, writeSuggestions, type SuggestionsDoc } from "@/lib/memory/suggestions";

const none = () => NextResponse.json({ questions: [] }, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "memory:read");
  if (denied) return denied;

  const playbook = await getBrandPlaybook("current");
  if (!playbook) return none();
  const fingerprint = playbookFingerprint(playbook);
  const saved = await readSoloDoc<SuggestionsDoc>("memory_suggestions").catch(() => null);
  if (saved?.fingerprint === fingerprint && saved.questions?.length) {
    return NextResponse.json({ questions: saved.questions }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!process.env.ANTHROPIC_API_KEY) return none();
  try {
    const questions = await writeSuggestions(audienceDigest(playbook));
    if (!questions) return none();
    await writeSoloDoc("memory_suggestions", { fingerprint, questions, generated_at: new Date().toISOString() } satisfies SuggestionsDoc);
    return NextResponse.json({ questions }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("Memory suggestions failed", e);
    return none();
  }
}
