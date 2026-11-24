/**
 * Publishing counts for the Focus content counters, shared by the API route
 * (src/app/api/focus/publishing/route.ts) and the page.
 *
 * Sources (one per counter, so nothing is counted twice):
 *   - Long form: cards in the Long form pipeline (`longform` document) at the
 *     "published" stage, dated by their target date, or by their last update
 *     when they have none. The social publishing tables are not used for long
 *     form: their YouTube uploads are Shorts, and the YouTube connection
 *     (src/lib/social/youtube.ts) cannot list a channel's uploads.
 *   - Short form: social_post_targets that reached "published" (Instagram,
 *     Facebook and YouTube Shorts; reels and carousels alike). A post sent to
 *     several platforms counts once, on the day its first copy went live.
 *
 * Days are the owner's calendar days: the browser sends its UTC offset.
 * Weeks start on Monday. Pure functions only, so `node --test` can load this.
 */

export const WEEKS = 52;
export const MONTHS = 12;

const MONTH_LABELS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface WeekCount { start: string; count: number }
export interface MonthCount { year: number; month: number; label: string; daysInMonth: number; days: number[]; total: number }
export interface PublishSeries { weeks: WeekCount[]; months: MonthCount[] }
export interface PublishingCounts { longForm: PublishSeries; shortForm: PublishSeries }

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function parseKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A clean UTC offset in minutes as from Date.getTimezoneOffset(); anything else is 0. */
export function parseTzOffset(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && Math.abs(n) <= 14 * 60 ? n : 0;
}

/** The owner's calendar day (YYYY-MM-DD) for a timestamp. tzOffset is Date.getTimezoneOffset(). */
export function localDayKey(at: string | Date, tzOffset = 0): string | null {
  const t = typeof at === 'string' ? Date.parse(at) : at.getTime();
  if (!Number.isFinite(t)) return null;
  return keyOf(new Date(t - tzOffset * 60_000));
}

/** Monday of the week holding this day. */
export function weekStart(key: string): string {
  const d = parseKey(key);
  if (!d) return key;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return keyOf(d);
}

/** Counts per week (the last 52, oldest first, the current week last) and per day for the last 12 months (oldest first). */
export function bucketDays(dayKeys: (string | null)[], today: string): PublishSeries {
  const perDay = new Map<string, number>();
  for (const k of dayKeys) {
    const d = k ? parseKey(k) : null;
    if (!d) continue;
    const key = keyOf(d);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const thisWeek = parseKey(weekStart(today)) ?? new Date();
  const weeks: WeekCount[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setUTCDate(start.getUTCDate() - i * 7);
    let count = 0;
    for (let day = 0; day < 7; day++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + day);
      count += perDay.get(keyOf(d)) ?? 0;
    }
    weeks.push({ start: keyOf(start), count });
  }

  const now = parseKey(today) ?? new Date();
  const months: MonthCount[] = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const year = first.getUTCFullYear();
    const month = first.getUTCMonth() + 1;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days = Array.from({ length: daysInMonth }, (_, d) => perDay.get(`${year}-${pad(month)}-${pad(d + 1)}`) ?? 0);
    months.push({ year, month, label: MONTH_LABELS[month - 1], daysInMonth, days, total: days.reduce((s, n) => s + n, 0) });
  }
  return { weeks, months };
}

/** Earliest window the route has to read: the first day of the oldest week or month shown. */
export function seriesSince(today: string): string {
  const w = parseKey(weekStart(today)) ?? new Date();
  w.setUTCDate(w.getUTCDate() - (WEEKS - 1) * 7);
  const now = parseKey(today) ?? new Date();
  const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1));
  return keyOf(w < m ? w : m);
}

/** Long form: published pipeline cards, dated by target date, else last update. */
export function longFormDays(doc: unknown, tzOffset = 0): string[] {
  const cards = (doc as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(cards)) return [];
  const out: string[] = [];
  for (const c of cards) {
    if (!c || typeof c !== 'object') continue;
    const card = c as Record<string, unknown>;
    if (card.stage !== 'published') continue;
    const target = typeof card.targetDate === 'string' && parseKey(card.targetDate) ? card.targetDate.slice(0, 10) : null;
    const day = target ?? (typeof card.updatedAt === 'string' ? localDayKey(card.updatedAt, tzOffset) : null);
    if (day) out.push(day);
  }
  return out;
}

/** Short form: one day per post, from the first of its platform copies to go live. */
export function shortFormDays(targets: { post_id: string; published_at: string | null; status?: string }[], tzOffset = 0): string[] {
  const first = new Map<string, number>();
  for (const t of targets) {
    if (t.status !== undefined && t.status !== 'published') continue;
    const at = t.published_at ? Date.parse(t.published_at) : NaN;
    if (!Number.isFinite(at)) continue;
    const prev = first.get(t.post_id);
    if (prev === undefined || at < prev) first.set(t.post_id, at);
  }
  return [...first.values()].map((at) => localDayKey(new Date(at), tzOffset)).filter((k): k is string => k !== null);
}

export function emptyCounts(today: string): PublishingCounts {
  return { longForm: bucketDays([], today), shortForm: bucketDays([], today) };
}

/** "1 per week", "1 every 2 weeks", "3 per week", "daily". */
export function cadenceLabel(perWeek: number): string {
  if (!(perWeek > 0)) return 'no target';
  if (perWeek >= 7) return 'daily';
  if (perWeek < 1) {
    const every = Math.round(1 / perWeek);
    return every <= 1 ? '1 per week' : `1 every ${every} weeks`;
  }
  return `${Number(perWeek.toFixed(1))} per week`;
}
