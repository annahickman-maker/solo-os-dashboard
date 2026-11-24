/**
 * Focus document: the owner's 90-day focus plan, stored as the solo document
 * key `focus` (see src/lib/solo/documents.ts). Anything that writes to it
 * should keep this shape; the page runs every load through normalizeFocusDoc
 * so missing or extra fields are tolerated.
 *
 * Dates are local calendar days as "YYYY-MM-DD". Timestamps are ISO strings.
 */

export const FOCUS_DOC_KEY = 'focus';
export const FOCUS_WINDOW_DAYS = 90;
export const MAX_TARGETS = 3;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A number the owner is moving, e.g. subscribers or monthly revenue. */
export interface FocusTarget {
  id: string;
  label: string;   // "Newsletter subscribers"
  unit: string;    // "subscribers", "$", "/mo". "$", "£", "€" are shown before the number.
  start: number;   // value on day 1
  current: number; // value now, typed by the owner
  target: number;  // value wanted by day 90
}

export interface FocusMilestone {
  id: string;
  title: string;
  done: boolean;
}

/** A task in this week's plan. weekday null = not given a day yet. */
export interface FocusTask {
  id: string;
  title: string;
  weekday: Weekday | null;
  done: boolean;
}

/** Where an offer-linked number started and where it is now. */
export interface OfferMetricProgress {
  start: number;
  current: number;
}

/**
 * Progress on the focus offer's targets, keyed by offer id (OfferPricingRung.id).
 * Only the owner's start and current values live here. The target numbers
 * themselves, and which offer is the focus, are read from the `offer`
 * document every time (see ./offer-link.ts), so there is one source of truth.
 */
export interface OfferProgress {
  revenue?: OfferMetricProgress;
  customers?: OfferMetricProgress;
}

/**
 * Revenue model: a labelling switch. recurring counts "members" and shows
 * revenue per month; one-time counts "sales".
 */
export const REVENUE_MODELS = ['recurring', 'one-time'] as const;
export type RevenueModel = (typeof REVENUE_MODELS)[number];

/**
 * The 90-day goal numbers used when no focus offer is set. When a focus offer
 * is set, the targets come from the offer and the current values from
 * offerProgress instead (see ./hero.ts), and these are left as they are.
 */
export interface FocusGoal {
  revenueTarget: number | null;
  revenueCurrent: number;
  countTarget: number | null; // members (recurring) or sales (one-time)
  countCurrent: number;
}

export const EMPTY_GOAL: FocusGoal = { revenueTarget: null, revenueCurrent: 0, countTarget: null, countCurrent: 0 };

/** Publishing cadence the content counters are measured against. Kept across 90-day windows. */
export interface FocusCadence {
  longFormPerWeek: number;  // 0.5 = one every 2 weeks
  shortFormPerWeek: number;
}

export const DEFAULT_CADENCE: FocusCadence = { longFormPerWeek: 1, shortFormPerWeek: 3 };

export interface FocusPlan {
  statement: string;  // "what are you focused on for the next 90 days?"
  startDate: string;  // YYYY-MM-DD; the window ends startDate + 90 days
  revenueModel: RevenueModel;
  goal: FocusGoal;
  targets: FocusTarget[];       // the owner's own numbers, at most MAX_TARGETS (offer targets come on top)
  offerProgress: Record<string, OfferProgress>;
  milestones: FocusMilestone[];
  week: FocusTask[];
  createdAt: string;
}

export interface ArchivedFocusPlan extends FocusPlan {
  archivedAt: string;
}

export interface FocusDoc {
  version: 1;
  current: FocusPlan | null;    // null = no plan yet (or the last one was archived)
  archive: ArchivedFocusPlan[]; // newest first
  cadence: FocusCadence;
}

export const DEFAULT_FOCUS_DOC: FocusDoc = { version: 1, current: null, archive: [], cadence: DEFAULT_CADENCE };

// ── helpers ────────────────────────────────────────────────────────────────

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses YYYY-MM-DD as a local date (midnight). Returns null if invalid. */
export function parseDateKey(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key) ?? new Date();
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86_400_000);
}

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export interface WindowInfo {
  endDate: string;
  /** 1..90 while running; 0 before it starts; 90 once ended. */
  day: number;
  daysLeft: number;
  /** Fraction of the window elapsed, 0..1. */
  elapsed: number;
  status: 'upcoming' | 'running' | 'ended';
  startsIn: number;
}

export function windowInfo(startDate: string, today: Date = new Date()): WindowInfo {
  const start = parseDateKey(startDate) ?? today;
  const endDate = addDays(toDateKey(start), FOCUS_WINDOW_DAYS);
  const since = daysBetween(start, today);
  if (since < 0) return { endDate, day: 0, daysLeft: FOCUS_WINDOW_DAYS, elapsed: 0, status: 'upcoming', startsIn: -since };
  if (since >= FOCUS_WINDOW_DAYS) return { endDate, day: FOCUS_WINDOW_DAYS, daysLeft: 0, elapsed: 1, status: 'ended', startsIn: 0 };
  return {
    endDate, day: since + 1, daysLeft: FOCUS_WINDOW_DAYS - since,
    elapsed: (since + 1) / FOCUS_WINDOW_DAYS, status: 'running', startsIn: 0,
  };
}

/** (current - start) / (target - start), clamped to 0..1. Works for targets that go down too. */
export function targetProgress(t: Pick<FocusTarget, 'start' | 'current' | 'target'>): number {
  const span = t.target - t.start;
  if (span === 0) return t.current === t.target ? 1 : 0;
  return clamp01((t.current - t.start) / span);
}

export function milestoneProgress(ms: FocusMilestone[]): number {
  return ms.length ? ms.filter((m) => m.done).length / ms.length : 0;
}

/** Average progress over the targets, or milestones when there are no targets. null = nothing to measure. */
export function overallProgress(plan: Pick<FocusPlan, 'targets' | 'milestones'>): number | null {
  if (plan.targets.length) return plan.targets.reduce((s, t) => s + targetProgress(t), 0) / plan.targets.length;
  if (plan.milestones.length) return milestoneProgress(plan.milestones);
  return null;
}

export type Pace = 'ahead' | 'on track' | 'behind';

/** Progress against time elapsed. Within 5 points of the clock counts as on track. */
export function pace(progress: number, elapsed: number): Pace {
  if (progress >= elapsed + 0.1) return 'ahead';
  if (progress >= elapsed - 0.05) return 'on track';
  return 'behind';
}

export const CURRENCY_UNITS = ['$', '£', '€', '¥'];

export function formatValue(n: number, unit: string): string {
  const num = Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0';
  const u = unit.trim();
  if (!u) return num;
  if (CURRENCY_UNITS.includes(u)) return `${u}${num}`;
  return u.startsWith('/') ? `${num}${u}` : `${num} ${u}`;
}

export function todayWeekday(d: Date = new Date()): Weekday {
  return WEEKDAYS[(d.getDay() + 6) % 7];
}

// ── normalising whatever is stored ─────────────────────────────────────────

const str = (v: unknown, fb = '') => (typeof v === 'string' ? v : fb);
const num = (v: unknown, fb = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fb);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

function normMetric(v: unknown): OfferMetricProgress | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  return { start: num(m.start), current: num(m.current, num(m.start)) };
}

function normOfferProgress(v: unknown): Record<string, OfferProgress> {
  const out: Record<string, OfferProgress> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!id || !raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const entry: OfferProgress = {};
    const revenue = normMetric(o.revenue);
    const customers = normMetric(o.customers);
    if (revenue) entry.revenue = revenue;
    if (customers) entry.customers = customers;
    out[id] = entry;
  }
  return out;
}

const posOrNull = (v: unknown): number | null => { const n = num(v, NaN); return Number.isFinite(n) && n > 0 ? n : null; };
const nonNeg = (v: unknown, fb: number) => { const n = num(v, fb); return n >= 0 ? n : fb; };

function normGoal(v: unknown): FocusGoal {
  if (!v || typeof v !== 'object') return { ...EMPTY_GOAL };
  const g = v as Record<string, unknown>;
  return {
    revenueTarget: posOrNull(g.revenueTarget), revenueCurrent: nonNeg(g.revenueCurrent, 0),
    countTarget: posOrNull(g.countTarget), countCurrent: nonNeg(g.countCurrent, 0),
  };
}

function normCadence(v: unknown): FocusCadence {
  const c = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    longFormPerWeek: nonNeg(c.longFormPerWeek, DEFAULT_CADENCE.longFormPerWeek),
    shortFormPerWeek: nonNeg(c.shortFormPerWeek, DEFAULT_CADENCE.shortFormPerWeek),
  };
}

function normPlan(v: unknown): FocusPlan | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  return {
    statement: str(p.statement),
    startDate: parseDateKey(str(p.startDate)) ? str(p.startDate) : toDateKey(new Date()),
    revenueModel: p.revenueModel === 'one-time' ? 'one-time' : 'recurring',
    goal: normGoal(p.goal),
    targets: arr(p.targets).slice(0, MAX_TARGETS).map((t) => ({
      id: str(t.id) || newId(), label: str(t.label), unit: str(t.unit),
      start: num(t.start), current: num(t.current, num(t.start)), target: num(t.target),
    })),
    offerProgress: normOfferProgress(p.offerProgress),
    milestones: arr(p.milestones).map((m) => ({ id: str(m.id) || newId(), title: str(m.title), done: m.done === true })),
    week: arr(p.week).map((t) => ({
      id: str(t.id) || newId(), title: str(t.title), done: t.done === true,
      weekday: (WEEKDAYS as readonly string[]).includes(str(t.weekday)) ? (t.weekday as Weekday) : null,
    })),
    createdAt: str(p.createdAt) || new Date().toISOString(),
  };
}

export function normalizeFocusDoc(v: unknown): FocusDoc {
  if (!v || typeof v !== 'object') return { ...DEFAULT_FOCUS_DOC, archive: [], cadence: { ...DEFAULT_CADENCE } };
  const d = v as Record<string, unknown>;
  const archive = arr(d.archive)
    .map((a) => { const p = normPlan(a); return p ? { ...p, archivedAt: str(a.archivedAt) || p.createdAt } : null; })
    .filter((a): a is ArchivedFocusPlan => a !== null);
  return { version: 1, current: normPlan(d.current), archive, cadence: normCadence(d.cadence) };
}

export function newPlan(input: { statement: string; startDate: string; targets?: FocusTarget[]; revenueModel?: RevenueModel }): FocusPlan {
  return {
    statement: input.statement, startDate: input.startDate, revenueModel: input.revenueModel ?? 'recurring', goal: { ...EMPTY_GOAL },
    targets: (input.targets ?? []).slice(0, MAX_TARGETS),
    offerProgress: {}, milestones: [], week: [], createdAt: new Date().toISOString(),
  };
}

/** Moves the current plan to the front of the archive. */
export function archiveCurrent(doc: FocusDoc, now: Date = new Date()): FocusDoc {
  if (!doc.current) return doc;
  return { ...doc, current: null, archive: [{ ...doc.current, archivedAt: now.toISOString() }, ...doc.archive] };
}
