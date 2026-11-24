'use client';
/**
 * The funnel boxes at the top of /crm/analytics: Reach (views) > Capture
 * (email) > Conversions (sales), each with its conversion rate, and a small
 * period switch (default this month). Data: GET /api/analytics/funnel-summary;
 * the rules live in src/lib/analytics/funnel-summary.ts. Conversions is left
 * out when both Sales and Pipeline are switched off.
 */
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/components/crm/kit';
import { useNavModules } from '@/components/nav';
import {
  FUNNEL_PERIODS,
  FUNNEL_PERIOD_LABELS,
  funnelBoxes,
  type FunnelPeriod,
  type FunnelSummary,
} from '@/lib/analytics/funnel-summary';

const COLS: Record<number, string> = {
  2: 'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
  3: 'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]',
};

function Arrow() {
  return (
    <div aria-hidden className="flex items-center justify-center text-minimal-muted">
      <svg viewBox="0 0 16 16" className="h-4 w-4 rotate-90 sm:rotate-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function FunnelBoxes({ refresh = 0 }: { refresh?: number }) {
  const modules = useNavModules();
  const [period, setPeriod] = useState<FunnelPeriod>('month');
  const [data, setData] = useState<FunnelSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      api<FunnelSummary>('/api/analytics/funnel-summary?' + new URLSearchParams({ period }), { signal: controller.signal })
        .then((d) => {
          if (controller.signal.aborted) return;
          setData(d);
          setError('');
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the funnel');
        });
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      controller.abort();
      clearInterval(t);
    };
  }, [period, refresh]);

  const shown = data && data.period === period ? data : null;
  const boxes = funnelBoxes(shown, modules);

  return (
    <section aria-label="Funnel" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {error ? (
          <p role="alert" className="text-sm text-red-400">{error}</p>
        ) : (
          <span />
        )}
        <div role="group" aria-label="Funnel period" className="flex rounded border border-minimal-border text-xs">
          {FUNNEL_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === period}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 first:rounded-l last:rounded-r ${p === period ? 'bg-zinc-800 text-white' : 'text-minimal-muted hover:text-white'}`}
            >
              {FUNNEL_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      <div className={`grid grid-cols-1 gap-2 ${COLS[boxes.length] ?? ''}`}>
        {boxes.map((box, i) => (
          <Fragment key={box.key}>
            {i > 0 && <Arrow />}
            <Link
              href={box.href}
              className="min-w-0 border border-minimal-border rounded p-4 flex flex-col gap-1 hover:border-zinc-500 transition-colors"
            >
              <span className="text-sm text-minimal-muted truncate">{box.label}</span>
              <span className="text-2xl tabular-nums truncate">{box.value}</span>
              <span className="text-xs text-minimal-muted truncate" title={box.detail}>{box.detail || '\u00a0'}</span>
              <span className="text-sm tabular-nums truncate">
                {box.rate || '\u00a0'}
                {box.rate_note && <span className="text-xs text-minimal-muted"> · {box.rate_note}</span>}
              </span>
            </Link>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
