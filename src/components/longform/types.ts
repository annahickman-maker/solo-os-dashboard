/**
 * Long form pipeline data. Stored whole in the Solo document `longform`
 * (src/lib/solo/documents.ts), loaded and saved by the page.
 */

/** Fields every pipeline card has, long form or short form. */
export interface PipelineCardBase {
  id: string;
  title: string;
  notes: string;
  stage: string;
  /** YYYY-MM-DD, or null when there is no target yet. */
  targetDate: string | null;
  /** Any URL: the draft, the upload, the live video. Empty string when unset. */
  link: string;
  createdAt: string;
  updatedAt: string;
  /** Saved studio results, keyed by StudioTool.id. */
  studio?: Record<string, string[]>;
}

export const LONGFORM_STAGES = [
  { id: 'idea', label: 'idea' },
  { id: 'scripting', label: 'scripting' },
  { id: 'filming', label: 'filming' },
  { id: 'editing', label: 'editing' },
  { id: 'scheduled', label: 'scheduled' },
  { id: 'published', label: 'published' },
] as const;

export type LongformStage = (typeof LONGFORM_STAGES)[number]['id'];

export interface LongformCard extends PipelineCardBase {
  stage: LongformStage;
}

export interface LongformDoc {
  version: 1;
  cards: LongformCard[];
}

export const EMPTY_LONGFORM: LongformDoc = { version: 1, cards: [] };

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** Fills defaults on the shared fields so a hand-edited or older document still loads. */
export function normalizeBase(raw: Record<string, unknown>, stages: readonly { id: string }[]): PipelineCardBase {
  const now = new Date().toISOString();
  const stage = str(raw.stage);
  const studio = raw.studio && typeof raw.studio === 'object' ? (raw.studio as Record<string, string[]>) : undefined;
  return {
    id: str(raw.id) || crypto.randomUUID(),
    title: str(raw.title, 'untitled'),
    notes: str(raw.notes),
    stage: stages.some((s) => s.id === stage) ? stage : stages[0].id,
    targetDate: typeof raw.targetDate === 'string' && raw.targetDate ? raw.targetDate : null,
    link: str(raw.link),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
    ...(studio ? { studio } : {}),
  };
}

export function normalizeLongform(raw: unknown): LongformDoc {
  const cards = (raw as { cards?: unknown })?.cards;
  if (!Array.isArray(cards)) return EMPTY_LONGFORM;
  return {
    version: 1,
    cards: cards
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => normalizeBase(c, LONGFORM_STAGES) as LongformCard),
  };
}
