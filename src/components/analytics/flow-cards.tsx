'use client';
/**
 * The "Client pipeline" flow cards on /crm/analytics (Contacts, Nurture,
 * Pipeline by stage, Revenue this month) with a one-line status above them.
 * Data: GET /api/crm/dashboard; the rules live in
 * src/lib/analytics/flow-cards.ts. Renders nothing when the Client pipeline
 * module is off, so the page shell can leave out its heading too.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/components/crm/kit';
import { flowCards, statusSentence, type FlowDashboard, type FlowModules } from '@/lib/analytics/flow-cards';

const COLS: Record<number, string> = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };

export default function FlowCards({ modules, refresh = 0 }: { modules: FlowModules; refresh?: number }) {
  const [data, setData] = useState<FlowDashboard | null>(null);
  const [error, setError] = useState('');
  const on = modules.pipeline;

  useEffect(() => {
    if (!on) return;
    const controller = new AbortController();
    const load = () =>
      api<FlowDashboard>('/api/crm/dashboard', { signal: controller.signal })
        .then((d) => {
          if (controller.signal.aborted) return;
          setData(d);
          setError('');
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the client pipeline');
        });
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      controller.abort();
      clearInterval(t);
    };
  }, [on, refresh]);

  const cards = flowCards(data, modules);
  if (!cards.length) return null;
  const sentence = data ? statusSentence(data.counts, modules) : '';

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-red-400">{error}</p>
      ) : sentence ? (
        <p className="text-sm text-minimal-muted">{sentence}</p>
      ) : null}
      <div className={`grid grid-cols-1 min-[420px]:grid-cols-2 gap-4 ${COLS[cards.length] ?? ''}`}>
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="min-w-0 border border-minimal-border rounded p-4 flex flex-col gap-1 hover:border-zinc-500 transition-colors"
          >
            <span className="text-sm text-minimal-muted truncate">{card.label}</span>
            <span className="text-2xl tabular-nums truncate">{card.value}</span>
            <span className="text-xs text-minimal-muted truncate" title={card.sub}>{card.sub || ' '}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
