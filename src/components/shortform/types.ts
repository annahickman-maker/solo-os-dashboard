/**
 * Short form pipeline data. Stored whole in the Solo document `shortform`.
 * A card may point at a long form card (longformId) it was cut from.
 */
import { normalizeBase, type PipelineCardBase } from '@/components/longform/types';

export const SHORTFORM_STAGES = [
  { id: 'idea', label: 'idea' },
  { id: 'drafting', label: 'drafting' },
  { id: 'ready', label: 'ready' },
  { id: 'scheduled', label: 'scheduled' },
  { id: 'posted', label: 'posted' },
] as const;

export type ShortformStage = (typeof SHORTFORM_STAGES)[number]['id'];

export const SHORTFORM_PLATFORMS = [
  { id: 'shorts', label: 'Shorts' },
  { id: 'reels', label: 'Reels' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'carousel', label: 'carousel' },
] as const;

export type ShortformPlatform = (typeof SHORTFORM_PLATFORMS)[number]['id'];

export interface ShortformCard extends PipelineCardBase {
  stage: ShortformStage;
  platforms: ShortformPlatform[];
  /** id of the long form card this was cut from, or null. */
  longformId: string | null;
}

export interface ShortformDoc {
  version: 1;
  cards: ShortformCard[];
}

export const EMPTY_SHORTFORM: ShortformDoc = { version: 1, cards: [] };

export function normalizeShortform(raw: unknown): ShortformDoc {
  const cards = (raw as { cards?: unknown })?.cards;
  if (!Array.isArray(cards)) return EMPTY_SHORTFORM;
  const known = SHORTFORM_PLATFORMS.map((p) => p.id) as string[];
  return {
    version: 1,
    cards: cards
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        ...(normalizeBase(c, SHORTFORM_STAGES) as ShortformCard),
        platforms: Array.isArray(c.platforms)
          ? (c.platforms.filter((p) => typeof p === 'string' && known.includes(p)) as ShortformPlatform[])
          : [],
        longformId: typeof c.longformId === 'string' && c.longformId ? c.longformId : null,
      })),
  };
}
