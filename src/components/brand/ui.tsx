'use client';
/**
 * Small building blocks shared by the Reputation and Offer pages. Styles live
 * in ./brand.css (Solo OS tokens only).
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { SaveState } from './use-solo-doc';

export const EMPTY_STATE = 'Your brand strategist fills this in once your playbook is done, or add your own.';

/** Progress ring. value 0-1. */
export function Ring({ value, label, size = 64, color = 'var(--so-green)', stroke = 6 }: {
  value: number; label: ReactNode; size?: number; color?: string; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className="bp-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--so-well)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`} />
      </svg>
      <span style={{ fontSize: Math.round(size * 0.28) }}>{label}</span>
    </div>
  );
}

export function Bar({ value, color }: { value: number; color: string }) {
  return <div className="bp-bar"><div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color }} /></div>;
}

/** Slide-over panel. Closes on the scrim, the close button or Escape. */
export function Panel({ eyebrow, title, sub, color, onClose, aside, children }: {
  eyebrow: string; title: ReactNode; sub?: ReactNode; color?: string; onClose: () => void; aside?: ReactNode; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="bp-scrim" onClick={onClose}>
      <aside className="bp-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="bp-panel-head">
          <div style={{ minWidth: 0 }}>
            <div className="so-label" style={{ color: color ?? 'var(--so-label)' }}>{eyebrow}</div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
            {aside}
            <button type="button" className="bp-btn" onClick={onClose}>close</button>
          </div>
        </header>
        {children}
      </aside>
    </div>
  );
}

export function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="bp-section">
      <header className="bp-section-head">
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="bp-field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3, large, ariaLabel }: {
  value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; rows?: number; large?: boolean; ariaLabel?: string;
}) {
  return (
    <textarea className={`bp-input${large ? ' lg' : ''}`} rows={rows} value={value ?? ''} placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

export function TextInput({ value, onChange, placeholder, ariaLabel, type = 'text' }: {
  value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string; type?: 'text' | 'url';
}) {
  return (
    <input className="bp-input" type={type} value={value ?? ''} placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

export function NumberInput({ value, onChange, placeholder, ariaLabel }: {
  value: number | null; onChange: (v: number | null) => void; placeholder?: string; ariaLabel?: string;
}) {
  return (
    <input className="bp-input" type="number" inputMode="decimal" min={0} value={value ?? ''} placeholder={placeholder}
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
    <input className="bp-input" value={draft} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.split(',').map((t) => t.trim()).filter(Boolean);
        if (next.join(', ') !== joined) onChange(next);
      }} />
  );
}

export function Tags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return <div className="bp-chips">{tags.map((t) => <span key={t} className="bp-chip">{t}</span>)}</div>;
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="bp-add" onClick={onClick}>+ {label}</button>;
}

export function DeleteButton({ what, onDelete, label = 'delete' }: { what: string; onDelete: () => void; label?: string }) {
  return (
    <button type="button" className="bp-btn danger"
      onClick={() => { if (window.confirm(`Delete ${what}?`)) onDelete(); }}>{label}</button>
  );
}

/** A row that expands to show its editor. */
export function ExpandRow({ title, badge, open, onToggle, children }: {
  title: ReactNode; badge?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className="bp-row">
      <button type="button" className="bp-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="title">{title}</span>
        {badge}
        <span className="caret">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="bp-row-body">{children}</div>}
    </div>
  );
}

export function Check({ label, hint, done, onToggle }: { label: string; hint?: string; done: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`bp-check${done ? ' done' : ''}`} onClick={onToggle} aria-pressed={done}>
      <span className="box">{done ? '✓' : ''}</span>
      <span>
        <span className="label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
    </button>
  );
}

export function SaveStatus({ state, error, onRetry }: { state: SaveState; error: string; onRetry: () => void }) {
  if (state === 'error') {
    return <span className="bp-status err" role="alert">Not saved: {error}<button type="button" onClick={onRetry}>retry</button></span>;
  }
  const label = state === 'pending' || state === 'saving' ? 'saving...' : state === 'saved' ? 'saved' : '';
  return <span className="bp-status" aria-live="polite">{label}</span>;
}

export function LoadState({ error, onRetry }: { error: string; onRetry: () => void }) {
  if (!error) return <div className="stack"><p className="bp-muted">Loading...</p></div>;
  return (
    <div className="stack">
      <p className="bp-muted" role="alert">{error}</p>
      <div><button type="button" className="bp-btn" onClick={onRetry}>try again</button></div>
    </div>
  );
}

/** Replaces one item in a list by id. */
export function patchById<T extends { id: string }>(items: T[], id: string, patch: Partial<T>): T[] {
  return items.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

/** Empty string becomes null, for optional text fields. */
export const orNull = (v: string): string | null => (v === '' ? null : v);
