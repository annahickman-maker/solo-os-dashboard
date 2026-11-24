/**
 * The Claude analyser for ./analyse.ts. Uses the owner's own
 * ANTHROPIC_API_KEY, the same way as src/lib/memory/answer.ts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AnalysisError, type Analyser, type AnalyserResult } from "./analyse.ts";

const DEFAULT_MODEL = "claude-opus-5-5";

const DIMENSION = {
  type: "object",
  properties: {
    score: { type: "integer", description: "0-100: how well this dimension is communicated in the published pieces." },
    evidence: { type: "array", items: { type: "string" }, description: "Up to 3 short verbatim quotes from the published pieces." },
    suggestion: { type: "string", description: "One concrete next step." },
  },
  required: ["score", "evidence", "suggestion"],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: { value: DIMENSION, authority: DIMENSION, pov: DIMENSION, connection: DIMENSION },
  required: ["value", "authority", "pov", "connection"],
  additionalProperties: false,
} as const;

type Created = { content: { type: string; text?: string }[]; stop_reason: string | null };

/** null when ANTHROPIC_API_KEY is not set. */
export function claudeAnalyser(): Analyser | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return async ({ system, user }) => {
    // Same beta body as memory answers: server-side fallback and structured
    // output, which this SDK release does not type yet.
    const params = {
      model: process.env.REPUTATION_AI_MODEL || process.env.MEMORY_AI_MODEL || DEFAULT_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    };
    let response: Created;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response = (await new Anthropic().beta.messages.create(params as any)) as unknown as Created;
    } catch (error) {
      throw describe(error);
    }
    if (response.stop_reason === "refusal") throw new AnalysisError("Claude declined to analyse this content.", 422);
    if (response.stop_reason === "max_tokens") throw new AnalysisError("The analysis was too long to finish. Try again.", 502);
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text || "").join("");
    try {
      return JSON.parse(text) as AnalyserResult;
    } catch {
      throw new AnalysisError("Claude's analysis could not be read. Try again.", 502);
    }
  };
}

function describe(error: unknown): AnalysisError {
  if (error instanceof Anthropic.AuthenticationError) return new AnalysisError("Your Anthropic key was rejected. Check ANTHROPIC_API_KEY.", 502, "AI_KEY_REJECTED");
  if (error instanceof Anthropic.PermissionDeniedError) return new AnalysisError("Your Anthropic key is not allowed to use this model (REPUTATION_AI_MODEL).", 502);
  if (error instanceof Anthropic.RateLimitError) return new AnalysisError("Anthropic is rate limiting requests right now. Try again in a minute.", 429);
  if (error instanceof Anthropic.APIError) return new AnalysisError(`Anthropic error ${error.status ?? ""}: ${error.message}`, 502);
  return new AnalysisError(error instanceof Error ? error.message : "Analysis failed.", 500);
}
