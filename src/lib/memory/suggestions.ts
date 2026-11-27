/**
 * Suggested questions for the Memory page, written from the owner's
 * published Brand Playbook: six questions their audience keeps asking,
 * phrased the way the owner would ask their own memory. Claude writes them
 * once per playbook; they are kept in the solo document `memory_suggestions`
 * with the playbook's fingerprint, so a new playbook gets new questions.
 */
import Anthropic from "@anthropic-ai/sdk";

export const SUGGESTION_COUNT = 6;
const DEFAULT_MODEL = "claude-opus-5-5";

export type SuggestionsDoc = { fingerprint: string; questions: string[]; generated_at: string };

type Loose = Record<string, unknown>;
const rec = (v: unknown): Loose => (v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The audience research, as short lines: pains, their words, desires, what they tried. */
export function audienceDigest(playbook: unknown): string {
  const p = rec(playbook);
  const research = rec(p.audienceResearch);
  const insights = rec(p.focusGroupInsights);
  const lines: string[] = [];
  const add = (label: string, values: unknown[]) => {
    const clean = values.map(str).filter(Boolean).slice(0, 12);
    if (clean.length) lines.push(`${label}:\n${clean.map((v) => `- ${v.slice(0, 300)}`).join("\n")}`);
  };
  add("Audience", [rec(rec(p.meta).selectedAudience).title, rec(research.audienceState).currentState]);
  add("Pain points", [...list(research.painPoints).map((x) => rec(x).pain), ...list(insights.painPoints).map((x) => rec(x).pain)]);
  add("In their words", [
    ...list(insights.directQuotes).map((x) => rec(x).quote),
    ...list(research.painPoints).flatMap((x) => list(rec(x).realQuotes).map((q) => rec(q).text)),
    ...list(rec(research.languageMap).painPhrases),
  ]);
  add("What they want", [...list(insights.desireStatements), rec(research.audienceState).desiredState]);
  add("What they tried that failed", list(rec(research.urgencyGateway).failedSolutions));
  return lines.join("\n\n");
}

/** Six distinct, short questions, or null when the reply is not usable. */
export function cleanQuestions(value: unknown): string[] | null {
  const raw = list(rec(value).questions).map(str).map((q) => q.replace(/\s+/g, " ").slice(0, 140)).filter((q) => q.length >= 8);
  const seen = new Set<string>();
  const out = raw.filter((q) => !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()));
  return out.length >= SUGGESTION_COUNT ? out.slice(0, SUGGESTION_COUNT) : null;
}

const SYSTEM = `You write suggested questions for a creator's searchable memory of their own calls, videos and workshops. Given the research about their audience, write ${SUGGESTION_COUNT} questions the creator would want to ask their memory to find what they have already said about the topics that come up most for that audience.
Rules:
- Each question is short (under 12 words), plain and specific to this audience's most frequent pains and desires.
- Phrase them as the audience's questions the creator answers, e.g. "Why isn't my audience paying me yet?" or "What should I sell first?".
- Cover ${SUGGESTION_COUNT} different topics. No numbering, no quotes, no em dashes.`;

const SCHEMA = {
  type: "object",
  properties: { questions: { type: "array", items: { type: "string" } } },
  required: ["questions"],
  additionalProperties: false,
};

type Created = { content: { type: string; text?: string }[]; stop_reason: string | null };

/** Claude writes the questions. Null when the digest is empty or the reply is not usable. */
export async function writeSuggestions(digest: string, client: { create: (params: unknown) => Promise<unknown> } = { create: (params) => new Anthropic().beta.messages.create(params as never) }): Promise<string[] | null> {
  if (!digest.trim()) return null;
  const params = {
    model: process.env.MEMORY_AI_MODEL || DEFAULT_MODEL,
    max_tokens: 1000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: `Audience research:\n\n${digest}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  };
  const response = (await client.create(params)) as Created;
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text || "").join("");
  try {
    return cleanQuestions(JSON.parse(text));
  } catch {
    return null;
  }
}
