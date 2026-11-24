'use client';
/**
 * "set target" pill (top right of /focus) and its side panel, ported from the
 * Solo OS FocusTargetToggle. The pill turns green once a revenue or sales
 * (sales) target exists. The panel sets the revenue model, the revenue and
 * sales targets and current values, the content cadence and the
 * 90-day window. Where each number is stored: ./hero.ts.
 */
import { useEffect, useState } from 'react';
import { GhostBtn, TextInput } from '@/components/crm/kit';
import { NumberInput } from './sections';
import { fmtDate } from './setup';
import type { GoalMetric, HeroGoal } from './hero';
import { FOCUS_WINDOW_DAYS, parseDateKey, type FocusCadence, type RevenueModel, type WindowInfo } from './types';

const PILL = 'inline-flex items-center gap-2 text-[13px] font-medium px-3.5 py-2 border rounded-lg transition-colors';
const PILL_EMPTY = `${PILL} border-minimal-border text-minimal-muted hover:text-white hover:border-minimal-muted`;
const PILL_SET = `${PILL} border-green-500/40 bg-green-500/10 text-white hover:border-green-500/70`;
const LABEL = 'flex flex-col gap-1.5 min-w-0 text-[13px] font-medium text-zinc-300';

function TargetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

export interface TargetPanelProps {
  hero: HeroGoal;
  cadence: FocusCadence;
  startDate: string;
  window: WindowInfo;
  onModel: (m: RevenueModel) => void;
  onTarget: (metric: GoalMetric, value: number) => void;
  onCurrent: (metric: GoalMetric, value: number) => void;
  onCadence: (c: Partial<FocusCadence>) => void;
  onStartDate: (key: string) => void;
  onNewWindow: () => void;
}

function Section({ step, title, sub, children }: { step: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
      <div>
        <p className="text-xs text-zinc-500">{step}</p>
        <h3 className="text-[13px] font-semibold text-zinc-300 mt-1">{title}</h3>
        {sub && <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function ModelTabs({ value, onChange }: { value: RevenueModel; onChange: (m: RevenueModel) => void }) {
  const options: RevenueModel[] = ['recurring', 'one-time'];
  return (
    <div role="tablist" aria-label="revenue model" className="inline-flex self-start p-1 gap-1 rounded-lg bg-minimal-row">
      {options.map((m) => (
        <button key={m} type="button" role="tab" aria-selected={value === m} onClick={() => onChange(m)}
          className={`text-[13px] px-3.5 py-1.5 rounded-md capitalize transition-colors ${
            value === m ? 'bg-minimal-bg text-white font-semibold shadow-sm' : 'text-minimal-muted hover:text-white font-medium'
          }`}>
          {m}
        </button>
      ))}
    </div>
  );
}

export function FocusTargetToggle(props: TargetPanelProps) {
  const [open, setOpen] = useState(false);
  const { hero, cadence } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const noun = hero.noun;
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const perMonth = hero.model === 'recurring';
  const where = hero.source === 'offer'
    ? `Saved on your focus offer, ${hero.offerName}. The Offer tab shows the same numbers.`
    : 'No focus offer is set, so these are kept with your 90-day focus. Pick a focus offer to link them to it.';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="set target" title="set your 90-day revenue and sales targets"
        className={hero.targetSet ? PILL_SET : PILL_EMPTY}>
        <TargetIcon />
        Set target
      </button>

      {open && (
        <div className="focus-panel-wrap fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label="set target" onClick={(e) => e.stopPropagation()}
            className="focus-panel w-full sm:w-[560px] h-full overflow-y-auto bg-minimal-bg border-l border-minimal-border p-4 sm:p-8 flex flex-col gap-4">
            <header className="flex items-start justify-between gap-4 mb-2">
              <div>
                <h2 className="text-lg font-semibold text-white">Set target</h2>
                <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">Your revenue and {noun} targets for this 90-day window, and how often you publish.</p>
              </div>
              <GhostBtn onClick={() => setOpen(false)}>Close</GhostBtn>
            </header>

            <Section step="Step 1" title="How you get paid" sub="Recurring shows revenue per month; one-time shows total revenue.">
              <ModelTabs value={hero.model} onChange={props.onModel} />
            </Section>

            <Section step="Step 2" title="Where you want to be by day 90" sub={where}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={LABEL}>Revenue target ($){perMonth ? ' / mo' : ''}
                  <NumberInput value={hero.revenueTarget ?? 0} label="revenue target" onCommit={(v) => props.onTarget('revenue', v)} />
                </label>
                <label className={LABEL}>Revenue now ($){perMonth ? ' / mo' : ''}
                  <NumberInput value={hero.revenueCurrent} label="revenue now" onCommit={(v) => props.onCurrent('revenue', v)} />
                </label>
                <label className={LABEL}>{Noun} target
                  <NumberInput value={hero.countTarget ?? 0} label={`${noun} target`} onCommit={(v) => props.onTarget('count', v)} />
                </label>
                <label className={LABEL}>{Noun} now
                  <NumberInput value={hero.countCurrent} label={`${noun} now`} onCommit={(v) => props.onCurrent('count', v)} />
                </label>
              </div>
              {hero.source === 'offer' && (
                <p className="text-xs text-zinc-500">When the offer has a price, the {noun} target follows revenue / price, as on the Offer tab.</p>
              )}
            </Section>

            <Section step="Step 3" title="How often you publish" sub="The content counters on this page measure against these.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={LABEL}>Long form per week
                  <NumberInput value={cadence.longFormPerWeek} label="long form per week" onCommit={(v) => props.onCadence({ longFormPerWeek: Math.max(0, v) })} />
                </label>
                <label className={LABEL}>Short form per week
                  <NumberInput value={cadence.shortFormPerWeek} label="short form per week" onCommit={(v) => props.onCadence({ shortFormPerWeek: Math.max(0, v) })} />
                </label>
              </div>
              <p className="text-xs text-zinc-500">Use 0.5 for one every 2 weeks.</p>
            </Section>

            <Section step="Step 4" title={`Target date ${fmtDate(props.window.endDate)}`}
              sub={`${FOCUS_WINDOW_DAYS} days from the start date.`}>
              <label className={`${LABEL} max-w-60`}>Start date
                <TextInput type="date" value={props.startDate}
                  onChange={(e) => { const v = e.target.value; if (parseDateKey(v)) props.onStartDate(v); }} />
              </label>
              <div>
                <GhostBtn onClick={() => { setOpen(false); props.onNewWindow(); }}>Start a new 90 days</GhostBtn>
              </div>
            </Section>
          </aside>
        </div>
      )}
    </>
  );
}
