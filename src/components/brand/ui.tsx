'use client';
/**
 * Small building blocks shared by the Reputation and Offer pages. They use
 * the dashboard look (src/components/crm/kit.tsx and the Focus page):
 * sentence case, 13px section titles, 13-14px body, 12px meta, bordered
 * cards and the kit buttons and inputs. Colours are the zinc / minimal
 * utilities that src/app/solo-theme.css maps for light and dark. The few
 * rules utilities cannot say live in ./brand.css.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { GhostBtn, Loading } from '@/components/crm/kit';
import type { SaveState } from './use-solo-doc';

export const EMPTY_STATE = 'Your brand strategist fills this in once your playbook is done, or add your own.';

/** First letter upper case: labels are stored lower case, shown in sentence case. */
export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── class names (the kit's, for elements the kit components cannot take) ──

/** Page body under the Brand tabs: same gutters and rhythm as Focus and Sales. */
export const PAGE = 'flex-1 min-h-0 overflow-y-auto px-4 sm:px-12 pt-6 pb-16';
export const PAGE_INNER = 'flex flex-col gap-8 max-w-6xl';
export const CARD = 'border border-minimal-border rounded-lg p-6';
/** A card that is also a button (theme CSS fills bordered buttons as wells, so no border here). */
export const CARD_BTN = 'w-full text-left rounded-lg bg-minimal-bg p-6 flex flex-col gap-4 cursor-pointer transition-shadow hover:ring-1 hover:ring-zinc-600';
/** A filled box inside a card or panel. Fields and buttons inside it sit on the panel colour (brand.css). */
export const WELL = 'bp-well rounded-lg bg-minimal-row';
export const WELL_BTN = `${WELL} w-full text-left px-4 py-3 flex flex-col gap-2 cursor-pointer transition-shadow hover:ring-1 hover:ring-zinc-600`;
export const TITLE = 'text-[13px] font-semibold text-zinc-300';
export const BODY = 'text-[13px] text-zinc-500 leading-relaxed';
export const META = 'text-xs text-zinc-500';
export const GRID2 = 'grid grid-cols-1 sm:grid-cols-2 gap-3';
export const ACTIONS = 'flex gap-2 flex-wrap justify-end items-center';
export const STAT = `${WELL} px-4 py-3 flex flex-col gap-1`;
export const STAT_NUM = 'text-2xl font-semibold text-white tabular-nums';
export const ITEM = `${WELL} px-4 py-3 flex flex-col gap-3`;
/** Suggestions waiting for a keep or reject. */
export const CANDIDATES = 'rounded-lg border-[1.5px] border-dashed border-amber-500/50 p-4 flex flex-col gap-3';
export const GRID3 = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';
export const INPUT =
  'w-full bg-minimal-row border border-minimal-border rounded-lg px-3 py-2 text-[14px] text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none transition-colors';
export const SELECT = `${INPUT} w-auto`;
export const PRIMARY_BTN = 'text-[13px] font-semibold bg-white text-black px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-zinc-200 transition-colors whitespace-nowrap';
/** Kit GhostBtn as the theme renders it (a filled well). */
export const GHOST_BTN = 'bp-ghost text-[13px] font-medium px-3.5 py-2 rounded-lg bg-minimal-row text-zinc-300 hover:text-white transition-colors disabled:opacity-40 whitespace-nowrap';
export const DANGER_BTN = 'text-[13px] font-medium px-3.5 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors whitespace-nowrap';

/** Progress ring, drawn like the Focus dial. value 0-1. */
export function Ring({ value, label, size = 64, color = 'var(--so-green)', stroke = 6 }: {
  value: number; label: ReactNode; size?: number; color?: string; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--so-well)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`} style={{ transition: 'stroke-dasharray 800ms cubic-bezier(0.2, 0.8, 0.2, 1)' }} />
      </svg>
      <span className="relative font-semibold text-white tabular-nums tracking-tight leading-none" style={{ fontSize: Math.round(size * 0.28) }}>{label}</span>
    </div>
  );
}

/** Thin progress bar. onWell: inside a filled box, so the track is a hairline instead. */
export function Bar({ value, color, onWell }: { value: number; color: string; onWell?: boolean }) {
  return (
    <div className={`h-1 rounded-full overflow-hidden ${onWell ? 'bg-zinc-700' : 'bg-minimal-row'}`}>
      <div className="h-full rounded-full" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color }} />
    </div>
  );
}

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-[color:var(--so-chip)] text-[color:var(--so-chip-ink)]"
      style={color ? { color } : undefined}>
      {children}
    </span>
  );
}

/** Side panel, laid out like the Focus "Set target" panel. Closes on the scrim, Close or Escape. */
export function Panel({ eyebrow, title, sub, color, onClose, aside, children }: {
  eyebrow: string; title: ReactNode; sub?: ReactNode; color?: string; onClose: () => void; aside?: ReactNode; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="bp-panel-wrap fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <aside role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="bp-panel w-full sm:w-[560px] h-full overflow-y-auto bg-minimal-bg border-l border-minimal-border p-4 sm:p-8 pb-16 sm:pb-16 flex flex-col gap-4">
        <header className="flex items-start justify-between gap-4 mb-2">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-xs text-zinc-500">
              {color && <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
              {cap(eyebrow)}
            </p>
            <h2 className="text-lg font-semibold text-white mt-1 break-words">{typeof title === 'string' ? cap(title) : title}</h2>
            {sub && <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">{sub}</p>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {aside}
            <GhostBtn onClick={onClose}>Close</GhostBtn>
          </div>
        </header>
        {children}
      </aside>
    </div>
  );
}

/** A card inside a panel, as the Focus panel's sections. */
export function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className={`${CARD} flex flex-col gap-4`}>
      <div>
        <h3 className={TITLE}>{cap(title)}</h3>
        {sub && <p className={`${BODY} mt-1`}>{sub}</p>}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[13px] font-medium text-zinc-300">{cap(label)}</span>
      {children}
      {hint && <span className="text-xs text-zinc-600">{hint}</span>}
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3, large, ariaLabel }: {
  value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; rows?: number; large?: boolean; ariaLabel?: string;
}) {
  return (
    <textarea className={`${INPUT} leading-relaxed resize-y ${large ? '!text-[15px] font-medium' : ''}`} rows={rows} value={value ?? ''} placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

export function TextInput({ value, onChange, placeholder, ariaLabel, type = 'text' }: {
  value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string; type?: 'text' | 'url';
}) {
  return (
    <input className={INPUT} type={type} value={value ?? ''} placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

export function NumberInput({ value, onChange, placeholder, ariaLabel }: {
  value: number | null; onChange: (v: number | null) => void; placeholder?: string; ariaLabel?: string;
}) {
  return (
    <input className={`${INPUT} tabular-nums`} type="number" inputMode="decimal" min={0} value={value ?? ''} placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => {
        const n = e.target.value === '' ? null : Number(e.target.value);
        onChange(n !== null && Number.isFinite(n) ? n : null);
      }} />
  );
}

/** Comma-separated tags. Commits on blur so typing a comma does not jump. */
export function TagsInput({ value, onChange, placeholder = 'tags, comma separated' }: {
  value: string[] | undefined; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const joined = (value ?? []).join(', ');
  const [draft, setDraft] = useState(joined);
  const [shown, setShown] = useState(joined);
  if (shown !== joined) { setShown(joined); setDraft(joined); }
  return (
    <input className={INPUT} value={draft} placeholder={cap(placeholder)} aria-label={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.split(',').map((t) => t.trim()).filter(Boolean);
        if (next.join(', ') !== joined) onChange(next);
      }} />
  );
}

export function Tags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return <div className="flex gap-1.5 flex-wrap">{tags.map((t) => <Chip key={t}>{t}</Chip>)}</div>;
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div><button type="button" className={GHOST_BTN} onClick={onClick}>+ {cap(label)}</button></div>
  );
}

export function DeleteButton({ what, onDelete, label = 'delete' }: { what: string; onDelete: () => void; label?: string }) {
  return (
    <button type="button" className={DANGER_BTN}
      onClick={() => { if (window.confirm(`Delete ${what}?`)) onDelete(); }}>{cap(label)}</button>
  );
}

/** A row that expands to show its editor. */
export function ExpandRow({ title, badge, open, onToggle, children }: {
  title: ReactNode; badge?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className={WELL}>
      <button type="button" className="flex items-center gap-3 w-full px-4 py-3 text-left text-[14px] text-white cursor-pointer" onClick={onToggle} aria-expanded={open}>
        <span className="flex-1 min-w-0 break-words">{title}</span>
        {badge}
        <span aria-hidden className="text-zinc-500 text-base leading-none">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-4 pb-4 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

export function Check({ label, hint, done, onToggle }: { label: string; hint?: string; done: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={done}
      className={`${WELL} flex gap-3 items-start w-full text-left px-4 py-3 cursor-pointer`}>
      <span aria-hidden className={`mt-0.5 w-[18px] h-[18px] rounded-[5px] shrink-0 inline-flex items-center justify-center border-[1.5px] ${
        done ? 'bg-green-500 border-green-500' : 'border-zinc-600'}`} style={done ? { color: '#fff' } : undefined}>
        {done && (
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] text-white">{label}</span>
        {hint && <span className="block text-xs text-zinc-500 mt-0.5 first-letter:uppercase">{hint}</span>}
      </span>
    </button>
  );
}

const SAVE_LABEL: Record<SaveState, string> = { idle: '', pending: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: '' };

/** Save status, as on Focus. */
export function SaveStatus({ state, error, onRetry }: { state: SaveState; error: string; onRetry: () => void }) {
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

/** The save status, top right of the page body. */
export function TopLine({ children }: { children: ReactNode }) {
  return <div className="flex justify-end items-center min-h-4 -mb-4">{children}</div>;
}

export function LoadState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className={PAGE}>
      <div className={PAGE_INNER}>
        {!error ? <Loading /> : (
          <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`} role="alert">
            <span className="text-[13px] text-red-400">{error}</span>
            <GhostBtn onClick={onRetry}>Try again</GhostBtn>
          </div>
        )}
      </div>
    </div>
  );
}

/** Replaces one item in a list by id. */
export function patchById<T extends { id: string }>(items: T[], id: string, patch: Partial<T>): T[] {
  return items.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

/** Empty string becomes null, for optional text fields. */
export const orNull = (v: string): string | null => (v === '' ? null : v);
