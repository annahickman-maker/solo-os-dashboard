'use client';
/** Focus page sections: targets, milestones and this week's tasks. */
import { useState, type KeyboardEvent } from 'react';
import { SectionHeading, ghostButtonStyle, solidButtonStyle } from '@/components/solo/kit';
import { Percent, Ring } from './ring';
import { TextInput } from '@/components/crm/kit';
import type { OfferTarget } from './offer-link';
import {
  MAX_TARGETS, WEEKDAYS, formatValue, milestoneProgress, newId, pace, targetProgress, todayWeekday,
  type FocusMilestone, type FocusPlan, type FocusTarget, type FocusTask, type Pace, type Weekday,
} from './types';

type PlanUpdate = (fn: (p: FocusPlan) => FocusPlan) => void;

export const PACE_COLOR: Record<Pace, string> = { ahead: 'var(--accent)', 'on track': 'var(--strain)', behind: 'var(--hrv)' };

export function PaceChip({ value }: { value: Pace }) {
  return <span className="focus-chip" style={{ ['--pace' as string]: PACE_COLOR[value] }}>{value}</span>;
}

export function Check({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className={`focus-check${on ? ' on' : ''}`} onClick={onToggle} aria-pressed={on} aria-label={label}>
      {on && (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </button>
  );
}

/** Number field that commits on blur or Enter, so typing "-" or "" mid-edit is fine. */
export function NumberInput({ value, onCommit, label, className = '' }: {
  value: number; onCommit: (n: number) => void; label: string; className?: string;
}) {
  const commit = (raw: string) => {
    const n = Number(raw.replace(/,/g, ''));
    if (raw.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <TextInput key={value} className={className} inputMode="decimal" aria-label={label} defaultValue={String(value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur(); } }} />
  );
}

const onEnter = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

// ── targets ────────────────────────────────────────────────────────────────

/** linked: the target comes from the focus offer; its label and unit are fixed and its target number lives on the offer. */
function TargetCard({ t, elapsed, onChange, onRemove, linked = false }: {
  t: FocusTarget; elapsed: number; onChange: (patch: Partial<FocusTarget>) => void; onRemove?: () => void; linked?: boolean;
}) {
  const [editing, setEditing] = useState(!linked && !t.label);
  const p = targetProgress(t);
  const status = pace(p, elapsed);
  return (
    <div className="card focus-target">
      <div className="focus-target-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ overflowWrap: 'anywhere' }}>{t.label || 'new target'}</div>
          {linked && <div className="focus-linked">★ from your focus offer</div>}
          <div style={{ marginTop: 6 }}><PaceChip value={status} /></div>
        </div>
        <button type="button" className="focus-link" onClick={() => setEditing(!editing)}>{editing ? 'done' : 'edit'}</button>
      </div>
      <div className="focus-target-body">
        <div style={{ width: 92 }}><Ring value={p} size={92} stroke={7} color={PACE_COLOR[status]}><Percent value={p} size={20} /></Ring></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
          <div className="focus-num">{formatValue(t.current, t.unit)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            from {formatValue(t.start, t.unit)} to {formatValue(t.target, t.unit)}
          </div>
        </div>
      </div>
      <label className="focus-field">
        update the current number
        <NumberInput value={t.current} label={`current ${t.label}`} onCommit={(current) => onChange({ current })} />
      </label>
      {editing && linked && (
        <div className="focus-fields">
          <label>start
            <NumberInput value={t.start} label="start value" onCommit={(start) => onChange({ start })} />
          </label>
          <label>target (saved on the offer)
            <NumberInput value={t.target} label="target value" onCommit={(target) => onChange({ target })} />
          </label>
        </div>
      )}
      {editing && !linked && (
        <div className="focus-fields">
          <label className="full">what are you measuring?
            <input className="input sm" value={t.label} placeholder="e.g. newsletter subscribers" onChange={(e) => onChange({ label: e.target.value })} />
          </label>
          <label>unit
            <input className="input sm" value={t.unit} placeholder="subscribers, $, /mo" onChange={(e) => onChange({ unit: e.target.value })} />
          </label>
          <label>start
            <NumberInput value={t.start} label="start value" onCommit={(start) => onChange({ start })} />
          </label>
          <label className="full">target by day 90
            <NumberInput value={t.target} label="target value" onCommit={(target) => onChange({ target })} />
          </label>
          <div className="full" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="focus-link" onClick={() => { if (onRemove && window.confirm(`Remove "${t.label || 'this target'}"?`)) onRemove(); }}>remove target</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TargetsSection({ plan, elapsed, update, offerTargets = [], onOfferChange }: {
  plan: FocusPlan; elapsed: number; update: PlanUpdate;
  /** The focus offer's targets, shown first (see ./offer-link.ts). */
  offerTargets?: OfferTarget[]; onOfferChange?: (t: OfferTarget, patch: Partial<FocusTarget>) => void;
}) {
  const patch = (id: string, change: Partial<FocusTarget>) =>
    update((p) => ({ ...p, targets: p.targets.map((t) => (t.id === id ? { ...t, ...change } : t)) }));
  const add = () => update((p) => p.targets.length >= MAX_TARGETS ? p
    : { ...p, targets: [...p.targets, { id: newId(), label: '', unit: '', start: 0, current: 0, target: 100 }] });
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <SectionHeading label="targets" sub="the numbers that tell you it worked" />
        {plan.targets.length < MAX_TARGETS && <button type="button" style={ghostButtonStyle} onClick={add}>+ target</button>}
      </div>
      {plan.targets.length + offerTargets.length === 0
        ? <div className="card" style={{ color: 'var(--muted)', fontSize: 14 }}>Add up to {MAX_TARGETS} numbers to track, like subscribers, monthly revenue or members, or pick a focus offer with targets.</div>
        : (
          <div className="focus-targets">
            {offerTargets.map((t) => (
              <TargetCard key={t.id} t={t} elapsed={elapsed} linked onChange={(c) => onOfferChange?.(t, c)} />
            ))}
            {plan.targets.map((t) => (
              <TargetCard key={t.id} t={t} elapsed={elapsed} onChange={(c) => patch(t.id, c)}
                onRemove={() => update((p) => ({ ...p, targets: p.targets.filter((x) => x.id !== t.id) }))} />
            ))}
          </div>
        )}
    </section>
  );
}

// ── milestones ─────────────────────────────────────────────────────────────

export function MilestonesSection({ plan, update }: { plan: FocusPlan; update: PlanUpdate }) {
  const [draft, setDraft] = useState('');
  const ms = plan.milestones;
  const done = ms.filter((m) => m.done).length;
  const set = (id: string, change: Partial<FocusMilestone>) =>
    update((p) => ({ ...p, milestones: p.milestones.map((m) => (m.id === id ? { ...m, ...change } : m)) }));
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    update((p) => ({ ...p, milestones: [...p.milestones, { id: newId(), title, done: false }] }));
    setDraft('');
  };
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <SectionHeading label="milestones" sub={ms.length ? `${done} of ${ms.length} done` : 'the steps that get you there'} count={ms.length || undefined} />
      {ms.length > 0 && <div className="focus-bar"><span style={{ width: `${milestoneProgress(ms) * 100}%` }} /></div>}
      <ul className="focus-list">
        {ms.map((m) => (
          <li key={m.id} className={`focus-row${m.done ? ' done' : ''}`}>
            <Check on={m.done} onToggle={() => set(m.id, { done: !m.done })} label={`mark ${m.title} ${m.done ? 'not done' : 'done'}`} />
            <div className="grow">
              <input className="title" value={m.title} aria-label="milestone" onChange={(e) => set(m.id, { title: e.target.value })} />
            </div>
            <button type="button" className="focus-x" aria-label={`delete ${m.title}`}
              onClick={() => update((p) => ({ ...p, milestones: p.milestones.filter((x) => x.id !== m.id) }))}>×</button>
          </li>
        ))}
      </ul>
      <div className="focus-add">
        <input className="input sm" value={draft} placeholder="add a milestone" onChange={(e) => setDraft(e.target.value)} onKeyDown={onEnter(add)} />
        <button type="button" style={solidButtonStyle} onClick={add} disabled={!draft.trim()}>add</button>
      </div>
    </section>
  );
}

// ── this week ──────────────────────────────────────────────────────────────

const DAY_LABEL: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function DaySelect({ value, onChange }: { value: Weekday | null; onChange: (d: Weekday | null) => void }) {
  return (
    <select className="focus-select" value={value ?? ''} aria-label="day" onChange={(e) => onChange((e.target.value || null) as Weekday | null)}>
      <option value="">any day</option>
      {WEEKDAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
    </select>
  );
}

export function WeekSection({ plan, update }: { plan: FocusPlan; update: PlanUpdate }) {
  const today = todayWeekday();
  const [draft, setDraft] = useState('');
  const [day, setDay] = useState<Weekday | null>(today);
  const tasks = plan.week;
  const done = tasks.filter((t) => t.done).length;
  const set = (id: string, change: Partial<FocusTask>) =>
    update((p) => ({ ...p, week: p.week.map((t) => (t.id === id ? { ...t, ...change } : t)) }));
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    update((p) => ({ ...p, week: [...p.week, { id: newId(), title, weekday: day, done: false }] }));
    setDraft('');
  };
  const groups: { key: Weekday | null; label: string }[] = [
    ...WEEKDAYS.map((d) => ({ key: d as Weekday | null, label: d === today ? `${DAY_LABEL[d]} - today` : DAY_LABEL[d] })),
    { key: null, label: 'any day' },
  ];
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <SectionHeading label="this week" sub={tasks.length ? `${done} of ${tasks.length} done` : 'what moves the focus forward this week'} />
        {done > 0 && (
          <button type="button" className="focus-link" style={{ marginTop: 2 }}
            onClick={() => update((p) => ({ ...p, week: p.week.filter((t) => !t.done) }))}>clear done</button>
        )}
      </div>
      <div className="focus-add">
        <input className="input sm" value={draft} placeholder="add a task" onChange={(e) => setDraft(e.target.value)} onKeyDown={onEnter(add)} />
        <DaySelect value={day} onChange={setDay} />
        <button type="button" style={solidButtonStyle} onClick={add} disabled={!draft.trim()}>add</button>
      </div>
      <div>
        {groups.map((g) => {
          const items = tasks.filter((t) => t.weekday === g.key);
          if (!items.length && g.key !== today) return null;
          return (
            <div key={g.key ?? 'any'}>
              <div className={`focus-day${g.key === today ? ' today' : ''}`}>{g.label}</div>
              {items.length === 0
                ? <div style={{ fontSize: 13, color: 'var(--muted-2)', padding: '6px 4px' }}>nothing planned</div>
                : (
                  <ul className="focus-list">
                    {items.map((t) => (
                      <li key={t.id} className={`focus-row${t.done ? ' done' : ''}`}>
                        <Check on={t.done} onToggle={() => set(t.id, { done: !t.done })} label={`mark ${t.title} ${t.done ? 'not done' : 'done'}`} />
                        <div className="grow"><span className="title">{t.title}</span></div>
                        <DaySelect value={t.weekday} onChange={(weekday) => set(t.id, { weekday })} />
                        <button type="button" className="focus-x" aria-label={`delete ${t.title}`}
                          onClick={() => update((p) => ({ ...p, week: p.week.filter((x) => x.id !== t.id) }))}>×</button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
