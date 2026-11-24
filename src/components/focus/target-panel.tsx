'use client';
/**
 * "set target" pill (top right of /focus) and its side panel, ported from the
 * Solo OS FocusTargetToggle. The pill turns green once a revenue or sales
 * (sales) target exists. The panel sets the revenue model, the number of
 * members or sales and the price (revenue goal = number x price), the
 * content cadence and the 90-day window. Where each number is stored: ./hero.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { GhostBtn, PrimaryBtn, TextInput } from '@/components/crm/kit';
import { NumberInput } from './sections';
import { fmtDate } from './setup';
import type { HeroGoal, TargetField } from './hero';
import { FOCUS_WINDOW_DAYS, parseDateKey, type FocusCadence, type RevenueModel, type WindowInfo } from './types';

const LABEL = 'flex flex-col gap-1.5 min-w-0 text-[13px] font-medium text-zinc-300';

export interface TargetPanelProps {
  hero: HeroGoal;
  cadence: FocusCadence;
  startDate: string;
  window: WindowInfo;
  onModel: (m: RevenueModel) => void;
  onTarget: (field: TargetField, value: number) => void;
  onCadence: (c: Partial<FocusCadence>) => void;
  onStartDate: (key: string) => void;
  onNewWindow: () => void;
  /** The focus offer picker, shown first inside the panel. */
  offer?: React.ReactNode;
  /** Open state, when the page opens the panel too (the heading's "pick a focus offer"). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const { onOpenChange } = props;
  const setOpen = useCallback((v: boolean) => { setOwnOpen(v); onOpenChange?.(v); }, [onOpenChange]);
  const { hero, cadence } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const noun = hero.noun;
  const perMonth = hero.model === 'recurring';
  const countLabel = perMonth ? 'Number of members' : 'Number of sales';
  const priceLabel = perMonth ? 'Price of membership ($ / mo)' : 'Price per sale ($)';
  const where = hero.source === 'offer'
    ? `Saved on your focus offer, ${hero.offerName}. The Offer tab shows the same numbers.`
    : 'No focus offer is set, so these are kept with your 90-day focus. Pick a focus offer to link them to it.';

  return (
    <>
      <PrimaryBtn onClick={() => setOpen(true)}>Set target</PrimaryBtn>

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

            {props.offer && <Section step="Step 1" title="Pick one offer to focus on">{props.offer}</Section>}

            <Section step="Step 2" title="How you get paid" sub="Recurring shows revenue per month; one-time shows total revenue.">
              <ModelTabs value={hero.model} onChange={props.onModel} />
            </Section>

            <Section step="Step 3" title="Where you want to be by day 90" sub={where}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={LABEL}>{countLabel}
                  <NumberInput value={hero.countTarget ?? 0} label={countLabel.toLowerCase()} onCommit={(v) => props.onTarget('count', v)} />
                </label>
                <label className={LABEL}>{priceLabel}
                  <NumberInput value={hero.price ?? 0} label={priceLabel.toLowerCase()} onCommit={(v) => props.onTarget('price', v)} />
                </label>
              </div>
            </Section>

            <Section step="Step 4" title="How often you publish" sub="The content counters on this page measure against these.">
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

            <Section step="Step 5" title={`Target date ${fmtDate(props.window.endDate)}`}
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
