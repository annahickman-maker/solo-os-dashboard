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
 *   2. Hero: the focus offer's name (or "Pick a focus for...", which opens
 *      Set target), days remaining and target date, and the offer's funnel
 *      for this 90 days across the page (./offer-funnel.tsx). Revenue and
 *      sales targets and current values are edited in Set target. The plan's
 *      old free-text statement stays in the document; it is not shown.
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
import { useEffect, useState } from 'react';
import { GhostBtn, Loading, PageHeader, PrimaryBtn } from '@/components/crm/kit';
import { FocusSetup, fmtDate } from '@/components/focus/setup';
import { useFocusDoc, type SaveState } from '@/components/focus/use-focus-doc';
import { OfferConnector } from '@/components/focus/offer-connector';
import { FocusTargetToggle } from '@/components/focus/target-panel';
import { heroGoal, setGoalTarget, type TargetField } from '@/components/focus/hero';
import { focusHeading, focusOffer, setFocusOffer, writeOfferPrice, writeOfferTarget } from '@/components/focus/offer-link';
import { OfferFunnel } from '@/components/focus/offer-funnel';
import { revenueGoalFor90 } from '@/components/focus/offer-funnel-goal';
import { useSoloDoc } from '@/components/brand/use-solo-doc';
import { useOfferProductSync } from '@/components/offer/use-offer-product-sync';
import { OFFER_DOC_KEY, normalizeOfferDoc } from '@/components/offer/types';
import {
  FOCUS_WINDOW_DAYS, addDays, archiveCurrent, formatValue, newPlan, windowInfo,
  type ArchivedFocusPlan, type FocusPlan,
} from '@/components/focus/types';

const SAVE_LABEL: Record<SaveState, string> = { idle: '', pending: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: '' };

const TITLE = 'text-[13px] font-semibold text-zinc-300';
const CARD = 'border border-minimal-border rounded-lg p-6';

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

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;



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

const isFocusRung = (r: { featured: boolean }) => r.featured;

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
  // The focus offer sells as its own Sales product: made when it is picked (or on first load
  // when it has none yet) and kept in step with its name and price. No linking step.
  useOfferProductSync(offer.doc, offer.saveState, offer.update, isFocusRung);
  const [targetOpen, setTargetOpen] = useState(false);

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

  const setTarget = (field: TargetField, value: number) => {
    if (!rung) updatePlan((p) => setGoalTarget(p, field, value));
    else if (field === 'price') offer.update((d) => writeOfferPrice(d, rung.id, value, plan?.revenueModel !== 'one-time'));
    else offer.update((d) => writeOfferTarget(d, rung.id, 'customers', value));
  };

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
            onTarget={setTarget}
            onCadence={(c) => update((d) => ({ ...d, cadence: { ...d.cadence, ...c } }))}
            onStartDate={(startDate) => updatePlan((p) => ({ ...p, startDate }))}
            onNewWindow={startNewWindow}
            open={targetOpen} onOpenChange={setTargetOpen}
            offer={<OfferConnector doc={offer.doc} loadError={offer.loadError}
              onPick={(id) => offer.update((d) => setFocusOffer(d, id))} />} />
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
                  </div>
                  <PrimaryBtn onClick={startNewWindow}>Start a new 90 days</PrimaryBtn>
                </div>
              )}

              <div className="flex flex-col gap-3 min-w-0">
                {(() => {
                  const heading = focusHeading(rung);
                  const cls = 'text-xl sm:text-2xl font-semibold leading-snug text-white break-words';
                  return heading.pick
                    ? <h2 className={cls}><button type="button" className="text-left text-zinc-400 hover:text-white" onClick={() => setTargetOpen(true)}>{heading.text}</button></h2>
                    : <h2 className={cls}>{heading.text}</h2>;
                })()}
                <p className="text-[13px] text-zinc-500 tabular-nums">
                  {w.status === 'upcoming'
                    ? <>Starts in {w.startsIn} {w.startsIn === 1 ? 'day' : 'days'}, target {fmtDate(w.endDate)}</>
                    : <>{w.daysLeft} days remaining, target {fmtDate(w.endDate)}</>}
                </p>
                {/* Always shown; without a focus offer the boxes stay empty ("-") until one is picked. */}
                <OfferFunnel offerId={rung && w.status !== 'upcoming' ? rung.id : ''} startDate={plan.startDate} endDate={w.endDate}
                  refreshKey={`${rung?.product_slug ?? ''}|${rung?.sales_page_url ?? ''}`}
                  revenueGoal={revenueGoalFor90(hero?.revenueTarget ?? null, hero?.model === 'recurring')} />
              </div>

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
