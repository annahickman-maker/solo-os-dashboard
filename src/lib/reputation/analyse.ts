/**
 * Reputation content analysis: the only source of the Reputation score.
 *
 * Reads the owner's published content (Memory documents of kind "content",
 * plus captions of published social posts), sends a bounded sample with the
 * owner's Reputation tab material to an analyser (Claude, see ./ai.ts) and
 * stores the result in the reputation solo document as `content_analysis`.
 * No published content = every score 0, and the analyser is not called.
 *
 * Takes the database, the document store and the analyser as arguments, so
 * tests pass fakes. The route is src/app/api/reputation/analyse/route.ts.
 */
import {
  ANALYSIS_KEYS, normalizeContentAnalysis, normalizeReputationDoc,
  type AnalysisKey, type ContentAnalysis, type ReputationDoc,
} from "../../components/reputation/types.ts";

/** Most recent content documents read per run. */
export const MAX_DOCUMENTS = 12;
/** Most recent published social posts read per run. */
export const MAX_POSTS = 20;
/** Characters kept from each document and each caption. */
export const MAX_DOC_CHARS = 6000;
export const MAX_CAPTION_CHARS = 1000;
/** Characters of published content in one prompt (roughly 15k tokens). */
export const MAX_TOTAL_CHARS = 60000;

export const MISSING_KEY_MESSAGE =
  "Analysing your content needs your own Anthropic key. Add ANTHROPIC_API_KEY to the dashboard's secrets, then try again.";

type DbError = { message: string; code?: string } | null;
type DbResult<T> = { data: T | null; error: DbError };

/** The slice of the Supabase query builder this module uses. */
export interface ContentQuery<T = unknown> extends PromiseLike<DbResult<T>> {
  select(columns: string): ContentQuery<T>;
  eq(column: string, value: unknown): ContentQuery<T>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): ContentQuery<T>;
  limit(n: number): ContentQuery<T>;
}
export interface ContentDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are checked where they are read
  from(table: string): ContentQuery<any>;
}

export type ContentPiece = { source: "memory" | "social"; title: string; date: string | null; text: string };

export type DimensionResult = { score: number; evidence: string[]; suggestion: string };
export type AnalyserResult = Record<AnalysisKey, DimensionResult>;
/** Sends the prompt to the model and returns its per-dimension result. */
export type Analyser = (prompt: { system: string; user: string }) => Promise<AnalyserResult>;

export class AnalysisError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MISSING = new Set(["42P01", "PGRST205"]);
const isMissing = (e: DbError) => !!e && (MISSING.has(e.code || "") || /does not exist|could not find/i.test(e.message));

function clip(text: string, max: number): string {
  const flat = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)} [...]`;
}

/** The newest published pieces, within the per-piece and total limits. */
export async function loadPublishedContent(db: ContentDb): Promise<ContentPiece[]> {
  const docs = await db.from("memory_documents")
    .select("title, occurred_at, created_at, raw_text")
    .eq("kind", "content")
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(MAX_DOCUMENTS);
  if (docs.error) {
    if (isMissing(docs.error)) throw new AnalysisError("Memory is not installed yet: apply migration 022_memory.sql.", 503);
    throw new AnalysisError(`Could not read your content: ${docs.error.message}`, 500);
  }
  const pieces: ContentPiece[] = [];
  for (const d of (docs.data || []) as { title?: unknown; occurred_at?: unknown; created_at?: unknown; raw_text?: unknown }[]) {
    const text = typeof d.raw_text === "string" ? d.raw_text : "";
    if (!text.trim()) continue;
    const date = typeof d.occurred_at === "string" ? d.occurred_at : typeof d.created_at === "string" ? d.created_at : null;
    pieces.push({ source: "memory", title: String(d.title || "Untitled"), date, text: clip(text, MAX_DOC_CHARS) });
  }

  // Published social posts are optional: a missing table or a read error just leaves them out.
  const posts = await db.from("social_posts")
    .select("title, caption, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(MAX_POSTS);
  if (!posts.error) {
    for (const p of (posts.data || []) as { title?: unknown; caption?: unknown; published_at?: unknown }[]) {
      const caption = typeof p.caption === "string" ? p.caption : "";
      if (!caption.trim()) continue;
      pieces.push({
        source: "social", title: String(p.title || "Social post"),
        date: typeof p.published_at === "string" ? p.published_at : null, text: clip(caption, MAX_CAPTION_CHARS),
      });
    }
  }

  const kept: ContentPiece[] = [];
  let total = 0;
  for (const p of pieces) {
    if (total + p.text.length > MAX_TOTAL_CHARS) {
      const room = MAX_TOTAL_CHARS - total;
      if (room > 500) kept.push({ ...p, text: clip(p.text, room) });
      break;
    }
    kept.push(p);
    total += p.text.length;
  }
  return kept;
}

export const SYSTEM = `You assess how well a solo creator's personal brand comes across in the content they have actually published.

Four dimensions:
- value: content that shifts belief, not just shares information. Their method and its steps taught clearly. Insight over tips.
- authority: proof, not bragging. Specific results, numbers, timelines and people, theirs and their clients'.
- pov: a clear point of view. Named beliefs they argue against (their "enemy"), stances taken inside the content.
- connection: relatability and vulnerability. Their own story, moments of struggle, stories that make an admirer into a buyer.

You are given the owner's source material (what they want to be known for) and a sample of their published pieces.
Score each dimension 0-100 for how well it is communicated in the PUBLISHED PIECES ONLY. The source material is the target, not evidence: something in the source material that never appears in the published pieces earns nothing.
- 0: absent. 25: occasional and vague. 50: present but inconsistent. 75: clear and frequent. 100: unmistakable across the body of work.
- evidence: up to 3 short verbatim quotes (under 25 words each) from the published pieces that show the dimension. Empty when there is none. Never invent a quote.
- suggestion: one concrete, specific next step for their next pieces of content, in one or two sentences, speaking to the owner as "you".
Plain language. No em dashes.`;

const line = (label: string, v: string | null | undefined) => (v && v.trim() ? `${label}: ${v.trim()}` : "");

/** The owner's Reputation tab, as plain text for the prompt. */
export function sourceMaterial(doc: ReputationDoc): string {
  const s = doc.slots;
  const a = doc.transformation_anchor;
  const steps = [s.value_step_1, s.value_step_2, s.value_step_3, s.value_step_4, s.value_step_5].filter(Boolean);
  const parts = [
    line("Transformation they want to be known for", a.positioning_statement),
    line("Who they help", a.who_you_help),
    line("Method", s.value_method),
    line("What the method gets people", s.value_method_result),
    steps.length ? `Method steps: ${steps.map((x, i) => `${i + 1}. ${x}`).join(" ")}` : "",
    line("Common enemy", s.common_enemy),
    doc.povs.length ? `Points of view:\n${doc.povs.slice(0, 12).map((p) => `- ${p.title}${p.my_pov ? `: ${p.my_pov}` : ""}`).join("\n")}` : "",
    line("Their story", s.compressed_story || (s.my_story_text ? clip(s.my_story_text, 1500) : null)),
    doc.wins.length ? `Wins:\n${doc.wins.filter((w) => w.status === "confirmed").slice(0, 12).map((w) => `- ${w.title}`).join("\n")}` : "",
    doc.proof_points.length ? `Proof:\n${doc.proof_points.slice(0, 8).map((p) => `- ${clip(p.title || p.text, 200)}`).join("\n")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : "(nothing filled in yet)";
}

export function buildUserPrompt(doc: ReputationDoc, pieces: ContentPiece[]): string {
  const body = pieces.map((p, i) => {
    const attrs = [`number="${i + 1}"`, `type="${p.source === "social" ? "social post caption" : "content"}"`,
      `title="${p.title.replace(/"/g, "'")}"`, p.date ? `date="${p.date.slice(0, 10)}"` : ""].filter(Boolean).join(" ");
    return `<piece ${attrs}>\n${p.text}\n</piece>`;
  }).join("\n\n");
  return `<source_material>\n${sourceMaterial(doc)}\n</source_material>\n\n<published_pieces count="${pieces.length}">\n${body}\n</published_pieces>\n\nScore how well each dimension is communicated in these published pieces.`;
}

const noDash = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, " - ").trim();

/** Turns the analyser's answer into a stored ContentAnalysis (clamped, trimmed). */
export function toAnalysis(result: Partial<Record<AnalysisKey, Partial<DimensionResult>>> | null, pieces: number, now: Date): ContentAnalysis {
  const raw = {
    analysed_at: now.toISOString(),
    pieces_count: pieces,
    scores: {} as Record<string, unknown>,
    evidence: {} as Record<string, unknown>,
    suggestions: {} as Record<string, unknown>,
  };
  for (const k of ANALYSIS_KEYS) {
    const r = result?.[k];
    raw.scores[k] = r?.score ?? 0;
    raw.evidence[k] = Array.isArray(r?.evidence) ? r.evidence.filter((e) => typeof e === "string").map((e) => noDash(e).slice(0, 300)).slice(0, 3) : [];
    raw.suggestions[k] = typeof r?.suggestion === "string" ? noDash(r.suggestion).slice(0, 600) : "";
  }
  return normalizeContentAnalysis(raw)!;
}

export type AnalyseDeps = {
  db: ContentDb;
  readDoc: () => Promise<unknown>;
  writeDoc: (value: unknown) => Promise<void>;
  /** null when ANTHROPIC_API_KEY is not set. */
  analyser: Analyser | null;
  now?: () => Date;
};
export type AnalyseResponse = { status: number; body: Record<string, unknown> };

/** POST /api/reputation/analyse, minus auth. */
export async function handleAnalyse(deps: AnalyseDeps): Promise<AnalyseResponse> {
  const now = deps.now ?? (() => new Date());
  try {
    const pieces = await loadPublishedContent(deps.db);
    const raw = await deps.readDoc();
    const doc = normalizeReputationDoc(raw);
    let analysis: ContentAnalysis;
    if (pieces.length === 0) {
      analysis = toAnalysis(null, 0, now());
    } else {
      if (!deps.analyser) return { status: 412, body: { error: MISSING_KEY_MESSAGE, code: "AI_KEY_MISSING" } };
      const result = await deps.analyser({ system: SYSTEM, user: buildUserPrompt(doc, pieces) });
      analysis = toAnalysis(result, pieces.length, now());
    }
    // Keep everything else in the stored document as it was.
    const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : doc;
    await deps.writeDoc({ ...base, content_analysis: analysis, updated_at: now().toISOString() });
    return { status: 200, body: { analysis } };
  } catch (e) {
    if (e instanceof AnalysisError) return { status: e.status, body: { error: e.message, code: e.code } };
    return { status: 500, body: { error: e instanceof Error ? e.message : "Analysis failed" } };
  }
}
