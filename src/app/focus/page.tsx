'use client';
/**
 * Focus: the owner's 90-day focus, laid out as the Solo OS Focus page minus
 * its task lists.
 *
 * Laid out like the rest of the dashboard (src/components/crm/kit.tsx):
 * page header, bordered cards, 13px section titles.
 *
 *   1. Header: "Focus", the save status and the "set target" button that
 *      opens the target panel.
 *   2. Hero: the editable focus statement, days remaining and target date,
 *      the focus offer connector; beside it the progress dial with revenue
 *      and sales against the target.
 *   3. Content counters: long form per week for the last year, short form
 *      per day for the last 4 months, each against the cadence target.
 *
 * Data: the solo document `focus` (src/components/focus/types.ts). When a
 * focus offer is set, its targets live on the offer and both tabs edit the
 * same numbers (src/components/focus/hero.ts, offer-link.ts). Publishing
 * counts: GET /api/focus/publishing (src/components/focus/publishing.ts).
 * Targets, milestones and weekly tasks from earlier versions of this page stay
 * in the document untouched; they are not shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GhostBtn, Loading, PageHeader, PrimaryBtn } from '@/components/crm/kit';
import { Percent, Ring } from '@/components/focus/ring';
import { FocusSetup, fmtDate } from '@/components/focus/setup';
import { useFocusDoc, type SaveState } from '@/components/focus/use-focus-doc';
import { OfferConnector } from '@/components/focus/offer-connector';
import { FocusTargetToggle } from '@/components/focus/target-panel';
import { MonthGrid, YearGrid } from '@/components/focus/grids';
import { heroGoal, setGoalCurrent, setGoalTarget, OFFER_METRIC, type GoalMetric, type HeroGoal } from '@/components/focus/hero';
import { focusOffer, setFocusOffer, writeOfferTarget } from '@/components/focus/offer-link';
import { emptyCounts, localDayKey, type PublishingCounts } from '@/components/focus/publishing';
import { useSoloDoc } from '@/components/brand/use-solo-doc';
import { OFFER_DOC_KEY, normalizeOfferDoc } from '@/components/offer/types';
import {
  FOCUS_WINDOW_DAYS, addDays, archiveCurrent, formatValue, newPlan, windowInfo,
  type ArchivedFocusPlan, type FocusCadence, type FocusPlan,
} from '@/components/focus/types';

const SAVE_LABEL: Record<SaveState, string> = { idle: '', pending: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: '' };

const TITLE = 'text-[13px] font-semibold text-zinc-300';
const CARD = 'border border-minimal-border rounded-lg p-6';
const LINK = 'text-xs text-zinc-500 hover:text-white underline underline-offset-2';

function SaveStatus({ state, error, onRetry }: { state: SaveState; error: string; onRetry: () => void }) {
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-red-400" role="alert">
        Not saved: {error}
        <button type="button" className="underline underline-offset-2" onClick={onRetry}>Retry</button>
      </span>
    );
  }
  return <span className="text-xs text-zinc-500" aria-live="polite">{SAVE_LABEL[state]}</span>;
}

function Statement({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grow with the text where CSS field-sizing is not supported.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} aria-label="your 90-day focus"
      className="focus-statement w-full resize-none overflow-hidden bg-transparent border-0 outline-none p-0 m-0 text-xl sm:text-2xl font-semibold leading-snug text-white placeholder:text-zinc-600"
      placeholder="What are you focused on for the next 90 days?" onChange={(e) => onChange(e.target.value)} />
  );
}

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** "<n> sales · edit": click to type the current count. */
function CountEdit({ hero, onSave }: { hero: HeroGoal; onSave: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft === null) return;
    const n = Number(draft.replace(/,/g, ''));
    if (draft.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== hero.countCurrent) onSave(n);
    setDraft(null);
  };
  if (draft !== null) {
    return (
      <input autoFocus inputMode="numeric" value={draft} aria-label={`current ${hero.noun}`}
        className="w-24 text-center bg-minimal-row border border-zinc-500 rounded-lg px-3 py-2 text-[14px] font-semibold text-white focus:outline-none"
        onChange={(e) => setDraft(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setDraft(null); }} />
    );
  }
  return (
    <button type="button" title={`click to update current ${hero.noun} count`}
      className="min-h-11 sm:min-h-8 px-2 rounded-md text-[13px] text-zinc-500 hover:text-white hover:bg-minimal-row transition-colors"
      onClick={() => setDraft(String(hero.countCurrent))}>
      {formatValue(hero.countCurrent, '')} {hero.noun} · edit
    </button>
  );
}

function Dial({ hero, onCount }: { hero: HeroGoal; onCount: (n: number) => void }) {
  const pct = Math.round(hero.progress * 100);
  const perMonth = hero.model === 'recurring' ? ' / mo' : '';
  return (
    <div className={`${CARD} flex flex-col items-center gap-3 text-center`}>
      <div style={{ width: 'min(200px, 56vw)' }}>
        <Ring value={hero.progress} size={200} stroke={9} label={`${pct}% of the target`}>
          <Percent value={hero.progress} size={48} />
        </Ring>
      </div>
      <span className="text-xs text-zinc-500">Out of {hero.countTarget ? formatValue(hero.countTarget, '') : '?'} {hero.noun}</span>
      <span className="text-2xl font-semibold text-white tabular-nums">
        {money(hero.revenueCurrent)}
        <small className="ml-1 text-[13px] font-normal text-zinc-500 whitespace-nowrap">
          {hero.revenueTarget ? ` / ${money(hero.revenueTarget)}${perMonth}` : perMonth}
        </small>
      </span>
      <CountEdit hero={hero} onSave={onCount} />
    </div>
  );
}

function usePublishing() {
  const [counts, setCounts] = useState<PublishingCounts | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    const tz = new Date().getTimezoneOffset();
    return fetch(`/api/focus/publishing?tz=${tz}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: PublishingCounts) => { setCounts(data); setFailed(false); })
      .catch(() => { setCounts(emptyCounts(localDayKey(new Date(), tz) ?? '')); setFailed(true); });
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { counts, failed, reload: load };
}

function ContentCounters({ cadence }: { cadence: FocusCadence }) {
  const { counts, failed, reload } = usePublishing();
  const today = localDayKey(new Date(), new Date().getTimezoneOffset()) ?? '';
  const data = counts ?? emptyCounts(today);
  const shortWeeks = data.shortForm.weeks;
  return (
    <div className="flex flex-col gap-6">
      <section className={`${CARD} flex flex-col gap-4`}>
        <h2 className={TITLE}>Long form</h2>
        <YearGrid weeks={data.longForm.weeks} perWeek={cadence.longFormPerWeek} />
        <p className="text-xs text-zinc-500">Counts videos marked published on the Long form tab.</p>
      </section>
      <section className={`${CARD} flex flex-col gap-4`}>
        <h2 className={TITLE}>Short form</h2>
        <MonthGrid months={data.shortForm.months} perWeek={cadence.shortFormPerWeek} thisWeek={shortWeeks[shortWeeks.length - 1]?.count ?? 0} />
        <p className="text-xs text-zinc-500">Counts posts published to Instagram, Facebook and YouTube Shorts from your dashboard, once per post.</p>
      </section>
      {failed && (
        <p className="text-xs text-zinc-500">
          Publishing counts could not be loaded. <button type="button" className={LINK} onClick={() => void reload()}>Try again</button>
        </p>
      )}
    </div>
  );
}

function PastPlans({ plans }: { plans: ArchivedFocusPlan[] }) {
  if (!plans.length) return null;
  return (
    <details className="group">
      <summary className={`${TITLE} cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:text-white`}>
        <span className="inline-block mr-1.5 text-zinc-500 transition-transform group-open:rotate-90" aria-hidden>›</span>
        Past 90-day plans ({plans.length})
      </summary>
      <ul className="mt-3 border border-minimal-border rounded-lg divide-y divide-minimal-border">
        {plans.map((p) => {
          const g = p.goal;
          const noun = 'sales';
          const parts = [
            g.revenueTarget ? `${money(g.revenueCurrent)} of ${money(g.revenueTarget)}` : '',
            g.countTarget ? `${formatValue(g.countCurrent, noun)} of ${formatValue(g.countTarget, '')}` : '',
          ].filter(Boolean);
          return (
            <li key={p.archivedAt + p.createdAt} className="px-4 py-3">
              <p className="text-[14px] font-medium text-white break-words">{p.statement || 'Untitled focus'}</p>
              <p className="text-xs text-zinc-500">
                {fmtDate(p.startDate)} to {fmtDate(addDays(p.startDate, FOCUS_WINDOW_DAYS))}
                {parts.length > 0 && <> · {parts.join('; ')}</>}
              </p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export default function FocusPage() {
  const { doc, loadError, reload, update, saveState, saveError, retrySave } = useFocusDoc();

  // A first visit shows the full Focus page straight away, as Solo OS always
  // did: start a blank 90 days from today so the heading, dial and counters
  // are there to fill in. (A plan that ended still offers restore or a fresh start.)
  const needsFirstPlan = !!doc && !doc.current && doc.archive.length === 0;
  useEffect(() => {
    if (!needsFirstPlan) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    update((cur) => (cur.current || cur.archive.length ? cur : { ...cur, current: newPlan({ statement: '', startDate: today }) }));
  }, [needsFirstPlan, update]);
  const offer = useSoloDoc(OFFER_DOC_KEY, normalizeOfferDoc);

  const updatePlan = (fn: (p: FocusPlan) => FocusPlan) =>
    update((d) => (d.current ? { ...d, current: fn(d.current) } : d));

  const startNewWindow = () => {
    if (!window.confirm('Start a new 90 days? This plan moves to past plans.')) return;
    update((d) => archiveCurrent(d));
  };

  const plan = doc?.current ?? null;
  const rung = focusOffer(offer.doc);
  const hero = plan ? heroGoal(plan, rung) : null;
  const w = plan ? windowInfo(plan.startDate) : null;

  const setTarget = (metric: GoalMetric, value: number) => {
    if (rung) offer.update((d) => writeOfferTarget(d, rung.id, OFFER_METRIC[metric], value));
    else updatePlan((p) => setGoalTarget(p, metric, value));
  };
  const setCurrent = (metric: GoalMetric, value: number) => updatePlan((p) => setGoalCurrent(p, rung, metric, value));

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Focus" className="!px-4 sm:!px-12">
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <SaveStatus state={saveState} error={saveError} onRetry={() => void retrySave()} />
          {offer.saveState === 'error' && (
            <SaveStatus state="error" error={`offer ${offer.saveError}`} onRetry={() => void offer.retrySave()} />
          )}
        </div>
        {plan && hero && w && (
          <FocusTargetToggle hero={hero} cadence={doc!.cadence} startDate={plan.startDate} window={w}
            onModel={(revenueModel) => updatePlan((p) => ({ ...p, revenueModel }))}
            onTarget={setTarget} onCurrent={setCurrent}
            onCadence={(c) => update((d) => ({ ...d, cadence: { ...d.cadence, ...c } }))}
            onStartDate={(startDate) => updatePlan((p) => ({ ...p, startDate }))}
            onNewWindow={startNewWindow} />
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-4 sm:px-12 pb-16">
        <div className="flex flex-col gap-8 max-w-6xl">
          {loadError ? (
            <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`} role="alert">
              <span className="text-[13px] text-red-400">{loadError}</span>
              <GhostBtn onClick={() => void reload()}>Try again</GhostBtn>
            </div>
          ) : !doc ? (
            <Loading />
          ) : plan && hero && w ? (
            <>
              {w.status === 'ended' && (
                <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
                  <div>
                    <p className="text-[14px] font-medium text-white">This 90 days ended on {fmtDate(w.endDate)}.</p>
                    <p className="text-[13px] text-zinc-500">Your plan is kept in past plans when you start the next one.</p>
                  </div>
                  <PrimaryBtn onClick={startNewWindow}>Start a new 90 days</PrimaryBtn>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 items-start">
                <div className="flex flex-col gap-3 min-w-0">
                  <h2 className={TITLE}>90-day focus</h2>
                  <Statement value={plan.statement} onChange={(statement) => updatePlan((p) => ({ ...p, statement }))} />
                  <p className="text-[13px] text-zinc-500 tabular-nums">
                    {w.status === 'upcoming'
                      ? <>Starts in {w.startsIn} {w.startsIn === 1 ? 'day' : 'days'}, target {fmtDate(w.endDate)}</>
                      : <>{w.daysLeft} days remaining, target {fmtDate(w.endDate)}</>}
                  </p>
                  <div className="mt-4">
                    <OfferConnector doc={offer.doc} loadError={offer.loadError}
                      onPick={(id) => offer.update((d) => setFocusOffer(d, id))} />
                  </div>
                </div>
                <Dial hero={hero} onCount={(n) => setCurrent('count', n)} />
              </div>

              <ContentCounters cadence={doc.cadence} />
            </>
          ) : (
            <FocusSetup
              previous={doc.archive[0]}
              onStart={(next) => update((d) => ({ ...d, current: next }))}
              onRestore={() => update((d) => {
                const [last, ...rest] = d.archive;
                if (!last) return d;
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { archivedAt, ...restored } = last;
                return { ...d, current: restored, archive: rest };
              })}
            />
          )}

          {doc && <PastPlans plans={doc.archive} />}
        </div>
      </div>
    </div>
  );
}
