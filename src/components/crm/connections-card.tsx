'use client';

/**
 * The Setup page's connections card: a titled card of status rows, each a
 * coloured dot (ready, needs attention, not set), a label and a one-line
 * detail. Shared by every connections card on Setup so they look the same.
 */
import type { ReactNode } from 'react';

export type ConnectionState = 'ok' | 'warn' | 'off';
export type ConnectionRow = { label: string; state: ConnectionState; detail: ReactNode };

const DOT: Record<ConnectionState, string> = { ok: 'bg-green-500', warn: 'bg-yellow-500', off: 'bg-zinc-600' };
const SR: Record<ConnectionState, string> = { ok: 'ready', warn: 'needs attention', off: 'not set' };

export function ConnectionsCard({
  title,
  intro,
  rows,
  error,
  footer,
}: {
  title: string;
  intro: ReactNode;
  /** null while checking. */
  rows: ConnectionRow[] | null;
  error?: string;
  footer?: ReactNode;
}) {
  return (
    <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-zinc-300">{title}</h2>
        <p className="text-xs text-zinc-500 mt-1">{intro}</p>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-red-400">{error}</p>
      ) : !rows ? (
        <p className="text-[13px] text-zinc-500">Checking…</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.label} className="flex items-start gap-3">
              <span aria-hidden="true" className={`mt-[6px] w-2 h-2 rounded-full shrink-0 ${DOT[r.state]}`} />
              <span className="flex flex-col min-w-0">
                <span className="text-[14px] text-white">
                  {r.label}
                  <span className="sr-only">: {SR[r.state]}</span>
                </span>
                <span className="text-xs text-zinc-500">{r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {footer && <div className="flex flex-wrap gap-4 text-[13px]">{footer}</div>}
    </section>
  );
}
