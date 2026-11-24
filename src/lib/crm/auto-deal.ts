/**
 * Client pipeline auto-deal rules (pure, no database access).
 *
 * Who gets a deal automatically:
 *   - someone who books a call (Cal.com webhook), and
 *   - someone who sends an enquiry (a capture with `intent: "enquiry"`, or a
 *     form named like an enquiry or contact form).
 * Plain newsletter sign-ups stay in Contacts only: no deal.
 *
 * A new deal opens in the first stage of the default pipeline. Someone who
 * already has an open deal never gets a second one. ensureLeadOpportunity()
 * in engine.ts is the one place that applies these rules to the database.
 */

export type CaptureIntent = "enquiry" | "subscribe";

const ENQUIRY_WORDS = /\b(enquir\w*|inquir\w*|contact)\b/i;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * What a capture means. `intent: "enquiry"` is the documented way to say it;
 * a form or form_type that reads like an enquiry or contact form counts too.
 * Anything else (newsletter, lead magnet, waitlist) is a subscribe.
 */
export function captureIntent(body: Record<string, unknown>): CaptureIntent {
  const intent = text(body.intent).toLowerCase();
  if (intent === "enquiry" || intent === "inquiry" || intent === "contact") return "enquiry";
  if (intent) return "subscribe";
  const form = `${text(body.form_type)} ${text(body.form)}`.replace(/[-_]/g, " ");
  return ENQUIRY_WORDS.test(form) ? "enquiry" : "subscribe";
}

export interface StageRow {
  id: string;
  name: string;
  position: number;
  pipeline_id: string;
}

export interface PipelineRow {
  id: string;
  is_default: boolean;
  position: number;
}

/** The default pipeline's stages in order (the first pipeline when none is marked default). */
export function defaultPipelineStages(pipelines: PipelineRow[], stages: StageRow[]): StageRow[] {
  const sorted = [...pipelines].sort((a, b) => a.position - b.position);
  const pipeline = sorted.find((p) => p.is_default) ?? sorted[0];
  if (!pipeline) return [];
  return stages.filter((s) => s.pipeline_id === pipeline.id).sort((a, b) => a.position - b.position);
}

export type DealPlan =
  | { action: "create"; stage: StageRow }
  | { action: "advance"; stage: StageRow }
  | { action: "exists" }
  | { action: "skip" }
  | { action: "no_pipeline" };

/**
 * What to do for one person.
 * - stages: the default pipeline's stages, in order.
 * - openStageId: the stage of their open deal, or null when they have none.
 *   An open deal in another pipeline (stage not in `stages`) is left alone.
 * - wanted: a stage name to file or advance into; falls back to the first stage.
 * - create: false means only advance an existing deal, never open one.
 */
export function planDeal(opts: {
  stages: StageRow[];
  openStageId: string | null;
  wanted?: string;
  create: boolean;
}): DealPlan {
  const { stages, openStageId, create } = opts;
  if (!stages.length) return { action: "no_pipeline" };
  const wanted = (opts.wanted || "").trim().toLowerCase();
  const target = (wanted && stages.find((s) => s.name.toLowerCase() === wanted)) || stages[0];

  if (openStageId) {
    const current = stages.find((s) => s.id === openStageId);
    // Forward-only: never drag a later-stage deal back.
    if (current && target.position > current.position) return { action: "advance", stage: target };
    return { action: "exists" };
  }
  return create ? { action: "create", stage: target } : { action: "skip" };
}
