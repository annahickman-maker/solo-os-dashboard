'use client';
/**
 * The focus offer's funnel under the /focus heading: Reach > Capture >
 * Conversions > Revenue for the current 90 days (start date to today), with
 * the conversion at each step between the boxes. Styled like the boxes on
 * /crm/analytics (src/components/analytics/funnel-boxes.tsx); data from
 * GET /api/analytics/funnel-summary?from=&to=&offer=. How each number is tied
 * to the offer: src/lib/analytics/funnel-summary.ts. Conversions and Revenue
 * count the offer's own Sales product (made automatically, see
 * src/lib/money/offer-product.ts), so they read 0 until sales come in.
 */
import { Fragment, useEffect, useState } from 'react';
import { api } from '@/components/crm/kit';
import { useNavModules } from '@/components/nav';
import { goalPercent } from './offer-funnel-goal';
import { offerFunnelSteps, type FunnelSummary } from '@/lib/analytics/funnel-summary';

// Laid out by the space the funnel has (a container query), not the screen.
const COLS: Record<number, string> = {
  2: '@xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
  3: '@2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]',
  4: '@2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]',
};
const ROW: Record<number, string> = { 2: '@xl', 3: '@2xl', 4: '@2xl' };

/** The arrow between two boxes, with the conversion from one to the next. */
function Step({ rate, row }: { rate?: string; row: string }) {
  const turn = row === '@xl' ? '@xl:rotate-0' : '@2xl:rotate-0';
  const col = row === '@xl' ? '@xl:flex-col' : '@2xl:flex-col';
  return (
    <div className={`flex ${col} items-center justify-center gap-1 text-minimal-muted`}>
      <svg aria-hidden viewBox="0 0 16 16" className={`h-4 w-4 rotate-90 ${turn}`} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {rate && <span className="text-xs tabular-nums text-zinc-300">{rate}</span>}
    </div>
  );
}

/** Local midnight of a YYYY-MM-DD key, as an ISO time. */
function localStart(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

export function OfferFunnel({ offerId, startDate, endDate, refreshKey, revenueGoal = null }: {
  offerId: string; startDate: string; endDate: string; refreshKey?: string;
  /** 90-day revenue goal in major units; shows "x% of goal" on the Revenue box. */
  revenueGoal?: number | null;
}) {
  const modules = useNavModules();
  const [data, setData] = useState<FunnelSummary | null>(null);
  const [error, setError] = useState('');
  const query = `offer=${encodeURIComponent(offerId)}&from=${encodeURIComponent(localStart(startDate))}&to=${encodeURIComponent(localStart(endDate))}`;

  useEffect(() => {
    if (!offerId) return;
    const controller = new AbortController();
    const load = () =>
      api<FunnelSummary>(`/api/analytics/funnel-summary?${query}`, { signal: controller.signal })
        .then((d) => { if (!controller.signal.aborted) { setData(d); setError(''); } })
        .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the funnel'); });
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => { controller.abort(); clearInterval(t); };
  }, [query, refreshKey, offerId]);

  const shown = offerId && data && data.offer?.id === offerId ? data : null;
  const steps = offerFunnelSteps(shown, modules);

  return (
    <section aria-label="Focus offer funnel" className="@container flex flex-col gap-2">
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className={`grid grid-cols-1 gap-2 ${COLS[steps.length] ?? ''}`}>
        {steps.map((step, i) => (
          <Fragment key={step.key}>
            {i > 0 && <Step rate={step.rate_in} row={ROW[steps.length] ?? '@2xl'} />}
            <div className="min-w-0 border border-minimal-border rounded p-3 flex flex-col gap-1">
              <span className="text-sm text-minimal-muted truncate">{step.label}</span>
              <span className="text-xl tabular-nums truncate">{step.value}</span>
              {step.key === 'revenue' && shown && revenueGoal ? (
                <span className="text-xs text-white tabular-nums">{goalPercent(shown.conversions?.order_revenue_minor ?? 0, revenueGoal)}</span>
              ) : (
                <span className="text-xs text-minimal-muted truncate" title={step.detail}>{step.detail || ' '}</span>
              )}
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
