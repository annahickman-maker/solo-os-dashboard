/**
 * Reputation document: the owner's personal-brand foundations, stored as the
 * solo document key `reputation` (see src/lib/solo/documents.ts).
 *
 * The shape follows the old Solo OS reputation data so content can be moved
 * across: `slots` uses the old slot names, and each bank keeps the old entry
 * fields. Anything that writes this document (the owner in the browser, or
 * the brand strategist through PUT /api/solo/docs/reputation) should keep
 * this shape. Every load runs through normalizeReputationDoc, so missing or
 * unknown fields are tolerated.
 *
 * No imports, so `node --test` can load it.
 */

export const REPUTATION_DOC_KEY = 'reputation';

/** candidate = suggested (e.g. by your brand strategist), waiting for the owner to keep or reject. */
export type BankStatus = 'candidate' | 'confirmed' | 'rejected';

export interface ReputationTransformationAnchor {
  /** One sentence: the transformation you want to be known for. */
  positioning_statement: string | null;
  who_you_help: string | null;
  before_state: string | null;
  after_state: string | null;
  transformation_result: string | null;
  value_share_tags: string[];
  value_dont_share_tags: string[];
}

/** Free-text fields, keyed by the old slot names. null = not filled in. */
export interface ReputationSlots {
  /** Value: how you help them get the transformation. */
  value_method: string | null;
  /** Value: what the method gets them. */
  value_method_result: string | null;
  /** Value: the five phases of the method, in the owner's words. */
  value_step_1: string | null;
  value_step_2: string | null;
  value_step_3: string | null;
  value_step_4: string | null;
  value_step_5: string | null;
  /** Value: hours of long-form content published, typed by the owner. */
  hours_on_transformation: number | null;
  /** Point of view: the wedge every POV argues against. */
  common_enemy: string | null;
  /** Connection: the long version of the owner's story. */
  my_story_text: string | null;
  /** Connection: the 30-second version. Empty = drafted from my_story_text. */
  compressed_story: string | null;
}

export type ReputationSlotId = keyof ReputationSlots;

/** A brag (kind own) or a customer / client result (kind student or client). */
export interface ReputationWin {
  id: string;
  title: string;
  body?: string | null;
  /** Unix ms. */
  date?: number | null;
  kind: 'own' | 'student' | 'client';
  status: BankStatus;
  source_episode?: string | null;
  tags?: string[];
}

export interface ReputationPovEntry {
  id: string;
  title: string;
  category?: string | null;
  /** What most people believe. */
  common_belief?: string | null;
  /** The owner's flip on it. */
  my_pov?: string | null;
  /** Why the owner believes this. */
  story_behind?: string | null;
  /** How the owner uses it in content. */
  how_i_use?: string | null;
}

/** A verbatim moment banked from a transcript, call or post. */
export interface ApprovedBankEntry {
  id: string;
  text: string;
  title: string | null;
  context: string | null;
  source_transcript: string | null;
  source_timestamp: string | null;
  tags?: string[];
  /** Unix ms. */
  created_at: number | null;
}

export interface ReputationMicroStory {
  id: string;
  text: string;
  title?: string | null;
  source_episode?: string | null;
  source_transcript?: string | null;
  source_timestamp?: string | null;
  status: BankStatus;
  tags?: string[];
}

/** "Where your story is placed" checklist item. */
export interface ReputationStoryAction {
  id: string;
  label: string;
  hint?: string;
  done: boolean;
}

export interface ReputationDoc {
  version: 1;
  transformation_anchor: ReputationTransformationAnchor;
  slots: ReputationSlots;
  /** Authority: brag bank (kind own) and customer wins (student / client). */
  wins: ReputationWin[];
  /** Authority bank: verbatim proof moments. */
  proof_points: ApprovedBankEntry[];
  /** Value bank: verbatim teaching moments (systems, steps, processes). */
  teaching_frameworks: ApprovedBankEntry[];
  /** Point of view: the structured POV bank. */
  povs: ReputationPovEntry[];
  /** Point of view: verbatim POVs banked from transcripts. */
  transcript_povs: ApprovedBankEntry[];
  /** Connection: the micro-stories bank. */
  micro_stories: ReputationMicroStory[];
  /** Connection: where the story lives. */
  story_actions: ReputationStoryAction[];
  /**
   * The score. Written only by POST /api/reputation/analyse, from the owner's
   * published content. null = never analysed, which scores 0.
   */
  content_analysis: ContentAnalysis | null;
  updated_at?: string;
}

/** Keys used inside content_analysis (pov = the Point of View dimension). */
export type AnalysisKey = 'value' | 'authority' | 'pov' | 'connection';
export const ANALYSIS_KEYS: AnalysisKey[] = ['value', 'authority', 'pov', 'connection'];

/** How well each dimension is communicated in the owner's published content. */
export interface ContentAnalysis {
  /** ISO time of the run. */
  analysed_at: string;
  /** Published pieces read in the run. 0 = nothing published, every score 0. */
  pieces_count: number;
  /** 0-100 per dimension. */
  scores: Record<AnalysisKey, number>;
  /** Short quotes from the published content that show the dimension. */
  evidence: Record<AnalysisKey, string[]>;
  /** One suggestion per dimension. */
  suggestions: Record<AnalysisKey, string>;
}

export type DimensionId = 'value' | 'authority' | 'point_of_view' | 'connection';

export const DIMENSIONS: { id: DimensionId; label: string; color: string; definition: string }[] = [
  { id: 'value', label: 'Value', color: 'var(--so-green)', definition: 'Content that shifts belief, not just shares information. Insight over tips.' },
  { id: 'authority', label: 'Authority', color: 'var(--so-blue)', definition: 'Proof, not bragging. Specific numbers, specific timelines, specific people.' },
  { id: 'point_of_view', label: 'Point of View', color: 'var(--so-slate)', definition: 'The thing you publicly argue with. Pick an enemy. Take stances inside your content.' },
  { id: 'connection', label: 'Connection', color: 'var(--so-amber)', definition: 'Relatability plus vulnerability. Stories that turn an admirer into a buyer.' },
];

export const DEFAULT_STORY_ACTIONS: ReputationStoryAction[] = [
  { id: 'published', label: 'Story published as a standalone piece of content', hint: 'A carousel, video or written post that takes the audience through your before, turning point and after.', done: false },
  { id: 'on_sales_page', label: 'Story embedded on your main sales page', hint: 'The audience-mirroring story block as one of the first sections after the headline.', done: false },
  { id: 'on_about_page', label: 'Story embedded on your About page', done: false },
  { id: 'pinned_on_channel', label: 'Short story pinned on your main channel', done: false },
  { id: 'pinned_in_community', label: 'Short story pinned in your community', done: false },
];

export const EMPTY_SLOTS: ReputationSlots = {
  value_method: null, value_method_result: null,
  value_step_1: null, value_step_2: null, value_step_3: null, value_step_4: null, value_step_5: null,
  hours_on_transformation: null, common_enemy: null, my_story_text: null, compressed_story: null,
};

export const DEFAULT_REPUTATION_DOC: ReputationDoc = {
  version: 1,
  transformation_anchor: {
    positioning_statement: null, who_you_help: null, before_state: null, after_state: null,
    transformation_result: null, value_share_tags: [], value_dont_share_tags: [],
  },
  slots: EMPTY_SLOTS,
  wins: [], proof_points: [], teaching_frameworks: [], povs: [], transcript_povs: [], micro_stories: [],
  story_actions: DEFAULT_STORY_ACTIONS,
  content_analysis: null,
};

// ─── normalising ──────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null);
const req = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : []);
const status = (v: unknown, fallback: BankStatus = 'confirmed'): BankStatus =>
  v === 'candidate' || v === 'confirmed' || v === 'rejected' ? v : fallback;
let seq = 0;
const id = (v: unknown, prefix: string): string => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`);
const list = <T>(v: unknown, fn: (o: Obj) => T | null): T[] =>
  Array.isArray(v) ? v.filter(isObj).map(fn).filter((x): x is T => x !== null) : [];

function bankEntry(o: Obj): ApprovedBankEntry | null {
  const t = req(o.text);
  if (!t.trim() && !text(o.title)) return null;
  return {
    id: id(o.id, 'bank'), text: t, title: text(o.title), context: text(o.context),
    source_transcript: text(o.source_transcript), source_timestamp: text(o.source_timestamp),
    tags: strings(o.tags), created_at: num(o.created_at),
  };
}

/** Coerces anything read from storage into a valid ReputationDoc. */
export function normalizeReputationDoc(raw: unknown): ReputationDoc {
  const o = isObj(raw) ? raw : {};
  const a = isObj(o.transformation_anchor) ? o.transformation_anchor : {};
  const s = isObj(o.slots) ? o.slots : {};
  const slots = { ...EMPTY_SLOTS };
  for (const k of Object.keys(EMPTY_SLOTS) as ReputationSlotId[]) {
    if (k === 'hours_on_transformation') slots[k] = num(s[k]);
    else slots[k] = text(s[k]);
  }
  return {
    version: 1,
    transformation_anchor: {
      positioning_statement: text(a.positioning_statement), who_you_help: text(a.who_you_help),
      before_state: text(a.before_state), after_state: text(a.after_state),
      transformation_result: text(a.transformation_result),
      value_share_tags: strings(a.value_share_tags), value_dont_share_tags: strings(a.value_dont_share_tags),
    },
    slots,
    wins: list(o.wins, (w) => {
      const title = req(w.title);
      if (!title.trim()) return null;
      const kind = w.kind === 'student' || w.kind === 'client' ? w.kind : 'own';
      return {
        id: id(w.id, 'win'), title, body: text(w.body), date: num(w.date), kind, status: status(w.status),
        source_episode: text(w.source_episode), tags: strings(w.tags),
      };
    }),
    proof_points: list(o.proof_points, bankEntry),
    teaching_frameworks: list(o.teaching_frameworks, bankEntry),
    povs: list(o.povs, (p) => {
      const title = req(p.title);
      if (!title.trim()) return null;
      return {
        id: id(p.id, 'pov'), title, category: text(p.category), common_belief: text(p.common_belief),
        my_pov: text(p.my_pov), story_behind: text(p.story_behind), how_i_use: text(p.how_i_use),
      };
    }),
    transcript_povs: list(o.transcript_povs, bankEntry),
    micro_stories: list(o.micro_stories, (m) => {
      const t = req(m.text);
      if (!t.trim()) return null;
      return {
        id: id(m.id, 'story'), text: t, title: text(m.title), source_episode: text(m.source_episode),
        source_transcript: text(m.source_transcript), source_timestamp: text(m.source_timestamp),
        status: status(m.status), tags: strings(m.tags),
      };
    }),
    story_actions: Array.isArray(o.story_actions)
      ? list(o.story_actions, (x) => {
          const label = req(x.label);
          if (!label.trim()) return null;
          return { id: id(x.id, 'action'), label, hint: text(x.hint) ?? undefined, done: x.done === true };
        })
      : DEFAULT_STORY_ACTIONS,
    content_analysis: normalizeContentAnalysis(o.content_analysis),
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : undefined,
  };
}

/** True when nothing has been filled in yet (story actions do not count). */
export function isReputationEmpty(doc: ReputationDoc): boolean {
  const anchor = doc.transformation_anchor;
  return !anchor.positioning_statement
    && Object.values(doc.slots).every((v) => v === null || v === '')
    && doc.wins.length + doc.proof_points.length + doc.teaching_frameworks.length
      + doc.povs.length + doc.transcript_povs.length + doc.micro_stories.length === 0;
}

// ─── scoring: only from the analysis of published content ─────────────────

export const NO_ANALYSIS_LINE = 'Scores come from your published content. Nothing analysed yet.';
export const NO_CONTENT_LINE = 'Scores come from your published content. None found yet: add your transcripts and posts to Memory as content, then analyse.';

export const ANALYSIS_KEY: Record<DimensionId, AnalysisKey> = {
  value: 'value', authority: 'authority', point_of_view: 'pov', connection: 'connection',
};

const clampScore = (v: unknown): number => {
  const n = num(v);
  return n === null ? 0 : Math.round(Math.max(0, Math.min(100, n)));
};

/** Coerces a stored content_analysis; null when absent or unreadable. */
export function normalizeContentAnalysis(raw: unknown): ContentAnalysis | null {
  if (!isObj(raw)) return null;
  const scores = isObj(raw.scores) ? raw.scores : {};
  const evidence = isObj(raw.evidence) ? raw.evidence : {};
  const suggestions = isObj(raw.suggestions) ? raw.suggestions : {};
  const pieces = Math.max(0, Math.floor(num(raw.pieces_count) ?? 0));
  const out: ContentAnalysis = {
    analysed_at: typeof raw.analysed_at === 'string' ? raw.analysed_at : '',
    pieces_count: pieces,
    scores: { value: 0, authority: 0, pov: 0, connection: 0 },
    evidence: { value: [], authority: [], pov: [], connection: [] },
    suggestions: { value: '', authority: '', pov: '', connection: '' },
  };
  for (const k of ANALYSIS_KEYS) {
    out.scores[k] = pieces === 0 ? 0 : clampScore(scores[k]);
    out.evidence[k] = strings(evidence[k]).slice(0, 5);
    out.suggestions[k] = text(suggestions[k]) ?? '';
  }
  return out;
}

/** 0-100: how well the dimension shows up in published content. 0 without an analysis. */
export function dimensionScore(doc: ReputationDoc, dim: DimensionId): number {
  const a = doc.content_analysis;
  if (!a || a.pieces_count === 0) return 0;
  return clampScore(a.scores[ANALYSIS_KEY[dim]]);
}

/** 0-100: the average of the four dimension scores. */
export function overallScore(doc: ReputationDoc): number {
  const total = DIMENSIONS.reduce((acc, d) => acc + dimensionScore(doc, d.id), 0);
  return Math.round(total / DIMENSIONS.length);
}

// ─── source material: what is filled in on the tab (not the score) ──────

const DIMENSION_SLOTS: Record<DimensionId, ReputationSlotId[]> = {
  value: ['value_method', 'value_method_result', 'value_step_1', 'value_step_2', 'value_step_3', 'value_step_4', 'value_step_5'],
  authority: [],
  point_of_view: ['common_enemy'],
  connection: ['my_story_text', 'compressed_story'],
};

/** Bank sizes that count as "filled in" for a dimension. */
const BANK_TARGET: Record<DimensionId, number> = { value: 8, authority: 8, point_of_view: 12, connection: 18 };

export function bankCount(doc: ReputationDoc, dim: DimensionId): number {
  if (dim === 'value') return doc.teaching_frameworks.length;
  if (dim === 'authority') return doc.wins.filter((w) => w.status === 'confirmed').length + doc.proof_points.length;
  if (dim === 'point_of_view') return doc.povs.length + doc.transcript_povs.length;
  return doc.micro_stories.filter((m) => m.status === 'confirmed').length;
}

/**
 * Share of a dimension's source material that is filled in, 0-1: its fields
 * and its bank, equally. Shown as "filled in", never as the score.
 */
export function buildCompletion(doc: ReputationDoc, dim: DimensionId): number {
  const bank = Math.min(1, bankCount(doc, dim) / BANK_TARGET[dim]);
  const fields = DIMENSION_SLOTS[dim];
  if (fields.length === 0) return bank;
  const filled = fields.filter((f) => doc.slots[f] !== null && doc.slots[f] !== '').length / fields.length;
  return (filled + bank) / 2;
}

export function maturityStage(overall: number): { id: string; label: string; description: string } {
  if (overall >= 80) return { id: 'compounding', label: 'Compounding', description: 'Inbound replaces outreach. Reputation compounds.' };
  if (overall >= 60) return { id: 'resonating', label: 'Resonating', description: 'All four ingredients present. People say it feels written for them.' };
  if (overall >= 40) return { id: 'building', label: 'Building', description: 'A real body of work. Some ingredients consistently strong.' };
  if (overall >= 20) return { id: 'validating', label: 'Validating', description: 'One transformation chosen, content starting to ladder to it.' };
  return { id: 'invisible', label: 'Invisible', description: 'Not enough yet to compound. Build the foundations first.' };
}

/** The 30-second version drafted from the long story: first sentences, up to 280 characters. */
export function deriveCompressed(story: string | null): string {
  if (!story?.trim()) return '';
  const flat = story.replace(/\s+/g, ' ').trim();
  if (flat.length <= 280) return flat;
  let out = '';
  for (const s of flat.split(/(?<=[.!?])\s+/)) {
    if ((out + ' ' + s).trim().length > 280) break;
    out = (out + ' ' + s).trim();
  }
  return out || flat.slice(0, 280) + '...';
}
