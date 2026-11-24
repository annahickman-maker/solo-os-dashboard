/**
 * Prompt building for the content studio. Pure functions (no imports beyond
 * types) so they can be tested with node --test.
 */
import type { StudioConfig, StudioTool } from '@/components/longform/studio-tools';

/** What the browser sends about the card the studio is working from. */
export interface StudioSource {
  title: string;
  notes: string;
  /** Short form only: platform labels the post is for. */
  platforms?: string[];
  /** Short form only: the long form video this post is cut from. */
  fromVideo?: { title: string; notes: string };
}

/** Shown when ANTHROPIC_API_KEY is not set. The page shows the same words. */
export const AI_KEY_MISSING_MESSAGE = 'Add your AI key in Setup to use the studio.';

const MAX_TITLE = 300;
const MAX_NOTES = 8000;

function clip(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Validates and trims an untrusted source object. Returns null when there is nothing to work from. */
export function parseSource(raw: unknown): StudioSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const source: StudioSource = { title: clip(r.title, MAX_TITLE), notes: clip(r.notes, MAX_NOTES) };
  if (Array.isArray(r.platforms)) {
    source.platforms = r.platforms.filter((p): p is string => typeof p === 'string').slice(0, 8).map((p) => p.slice(0, 40));
  }
  const fv = r.fromVideo as Record<string, unknown> | undefined;
  if (fv && typeof fv === 'object') {
    const fromVideo = { title: clip(fv.title, MAX_TITLE), notes: clip(fv.notes, MAX_NOTES) };
    if (fromVideo.title || fromVideo.notes) source.fromVideo = fromVideo;
  }
  if (!source.title && !source.notes && !source.fromVideo) return null;
  return source;
}

export function buildSystemPrompt(config: StudioConfig, brandContext: string, offers: string): string {
  return [
    `You are ${config.role} working for a solo creator. You write ${config.medium} in the owner's own voice.`,
    'Use the brand context below for voice, audience, beliefs and proof. Never invent facts, numbers, results or testimonials that are not in it.',
    'Write plainly. Never use the em dash or en dash characters; use a hyphen, comma or full stop instead.',
    '',
    '## Brand context',
    brandContext,
    '',
    '## Active offers',
    offers,
  ].join('\n');
}

export function buildUserPrompt(tool: StudioTool, source: StudioSource): string {
  const lines = [
    tool.instruction,
    '',
    tool.count === 1
      ? 'Return exactly one option in the options array.'
      : `Return exactly ${tool.count} options in the options array, best first.`,
    '',
    '## The piece',
    `Working title: ${source.title || '(none yet)'}`,
  ];
  if (source.platforms?.length) lines.push(`Platforms: ${source.platforms.join(', ')}`);
  lines.push('Notes:', source.notes || '(no notes yet)');
  if (source.fromVideo) {
    lines.push('', '## Cut from this long form video', `Title: ${source.fromVideo.title || '(untitled)'}`, 'Notes:', source.fromVideo.notes || '(no notes)');
  }
  return lines.join('\n');
}

export const OPTIONS_SCHEMA = {
  type: 'object',
  required: ['options'],
  properties: {
    options: { type: 'array', items: { type: 'string' }, description: 'The generated options, as plain strings' },
  },
} as const;

/** Cleans model output: strings only, trimmed, dashes swapped, capped at the tool's count. */
export function cleanOptions(raw: unknown, count: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.replace(/\s*[\u2014\u2013]\s*/g, ' - ').trim())
    .filter(Boolean)
    .slice(0, Math.max(1, count));
}
