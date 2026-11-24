/**
 * Memory answers: Claude reads the passages search found and answers the
 * owner's question from their own words, citing the sources by number.
 * Uses the owner's own ANTHROPIC_API_KEY. Search works without it.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MemoryHit } from "./store.ts";

const DEFAULT_MODEL = "claude-opus-5-5";
export const MISSING_KEY_MESSAGE =
  "Answers need your own Anthropic key. Add ANTHROPIC_API_KEY to the dashboard's secrets (see MEMORY.md); search below still works without it.";

export type MemorySource = {
  number: number; document_id: string; title: string; kind: string; occurred_at: string | null; url: string | null;
  chunk_index: number; snippet: string;
};
export type MemoryAnswer = { answer: string; found: boolean; sources: MemorySource[]; used: number[] };

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "False when the passages do not answer the question." },
    answer: { type: "string", description: "The answer, in plain prose, citing passages as [1], [2]." },
    used: { type: "array", items: { type: "integer" }, description: "The numbers of the passages the answer relies on." },
  },
  required: ["found", "answer", "used"],
  additionalProperties: false,
} as const;

const SYSTEM = `You answer questions from the owner of a personal archive: transcripts of their calls, videos and talks, and their written notes. Everything you know comes from the numbered passages you are given.

- Answer from the passages only. Never add outside advice, facts or opinions.
- Ground the answer in the owner's own words. Quote their phrasing where it carries the point, and cite each claim with the passage number in square brackets, like [2].
- Speak to the owner as "you" ("You said ... [1]").
- Some passages are conversations. A line labelled with a speaker name is that person's words. When a passage says which speaker is the owner, only those lines are the owner's; other speakers' lines are context. Never present someone else's words as the owner's. If you cannot tell who said something, say so.
- If the passages disagree, say so plainly. If they do not answer the question, set found to false and say briefly what they do cover.
- Keep it short: a few sentences to a few short paragraphs. Plain language, no headings.`;

/** Passages for the prompt: the best hits, at most `max`, numbered in order. */
export function promptSources(hits: MemoryHit[], max = 10): MemorySource[] {
  return hits.slice(0, max).map((h, i) => ({
    number: i + 1,
    document_id: h.document_id,
    title: h.title,
    kind: h.kind,
    occurred_at: h.occurred_at,
    url: h.url,
    chunk_index: h.chunk_index,
    snippet: h.snippet,
  }));
}

export function buildPrompt(question: string, hits: MemoryHit[], max = 10): string {
  const passages = hits.slice(0, max).map((h, i) => {
    const attrs = [
      `number="${i + 1}"`,
      `title="${h.title.replace(/"/g, "'")}"`,
      `kind="${h.kind}"`,
      h.occurred_at ? `date="${h.occurred_at.slice(0, 10)}"` : "",
      h.owner_speaker ? `owner_speaker="${h.owner_speaker.replace(/"/g, "'")}"` : "",
    ].filter(Boolean).join(" ");
    return `<passage ${attrs}>\n${h.content}\n</passage>`;
  });
  return `${passages.join("\n\n")}\n\nThe owner's question: ${question}`;
}

type Created = { content: { type: string; text?: string }[]; stop_reason: string | null };

export async function answerQuestion(question: string, hits: MemoryHit[]): Promise<MemoryAnswer> {
  const sources = promptSources(hits);
  if (!hits.length) return { answer: "Nothing in your memory matches that yet. Try other words, or add the transcript or note it is in.", found: false, sources, used: [] };
  if (!process.env.ANTHROPIC_API_KEY) throw new MemoryAnswerError(MISSING_KEY_MESSAGE, 412, "AI_KEY_MISSING");

  // The beta endpoint lets a declined request fall back to another model
  // instead of failing. This SDK release does not type `fallbacks` or
  // `output_config` yet, so the body is passed through as-is.
  const params = {
    model: process.env.MEMORY_AI_MODEL || DEFAULT_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(question, hits) }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = (await new Anthropic().beta.messages.create(params as any)) as unknown as Created;
  if (response.stop_reason === "refusal") throw new MemoryAnswerError("Claude declined to answer this question.", 422);
  if (response.stop_reason === "max_tokens") throw new MemoryAnswerError("The answer was too long to finish. Try a narrower question.", 502);
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text || "").join("");
  let parsed: { found?: boolean; answer?: string; used?: number[] };
  try { parsed = JSON.parse(text); } catch { throw new MemoryAnswerError("Claude's answer could not be read. Try again.", 502); }
  const used = (parsed.used || []).filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length);
  return { answer: String(parsed.answer || "").trim(), found: parsed.found !== false, sources, used: [...new Set(used)] };
}

export class MemoryAnswerError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function describeAnswerError(error: unknown): { message: string; status: number; code?: string } {
  if (error instanceof MemoryAnswerError) return { message: error.message, status: error.status, code: error.code };
  if (error instanceof Anthropic.AuthenticationError) return { message: "Your Anthropic key was rejected. Check ANTHROPIC_API_KEY.", status: 502, code: "AI_KEY_REJECTED" };
  if (error instanceof Anthropic.PermissionDeniedError) return { message: "Your Anthropic key is not allowed to use this model (MEMORY_AI_MODEL).", status: 502 };
  if (error instanceof Anthropic.RateLimitError) return { message: "Anthropic is rate limiting requests right now. Try again in a minute.", status: 429 };
  if (error instanceof Anthropic.APIError) return { message: `Anthropic error ${error.status ?? ""}: ${error.message}`, status: 502 };
  return { message: error instanceof Error ? error.message : "Something went wrong.", status: 500 };
}
