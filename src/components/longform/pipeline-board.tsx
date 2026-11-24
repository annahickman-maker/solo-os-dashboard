'use client';
/**
 * Pipeline board shared by the long form and short form pages. Stage lanes
 * stacked top to bottom (empty lanes hidden), a stage filter, an add-idea row,
 * and a card editor overlay. Move a card by tapping its stage bar (works on a
 * phone) or by dragging it onto another lane (desktop).
 *
 * Page-specific bits come in through props: chips on the card face, extra
 * editor fields, and the studio panel.
 */
import { useState, type ReactNode } from 'react';
import { FilterTabs, SectionHeading, ghostButtonStyle, solidButtonStyle } from '@/components/solo/kit';
import type { PipelineCardBase } from './types';

export interface Stage { id: string; label: string }

export function PipelineBoard<C extends PipelineCardBase>({
  stages, cards, addPlaceholder, onAdd, onChange, onDelete, renderChips, renderEditorExtra, renderStudio,
}: {
  stages: readonly Stage[];
  cards: C[];
  addPlaceholder: string;
  onAdd: (title: string) => void;
  onChange: (card: C) => void;
  onDelete: (id: string) => void;
  renderChips?: (card: C) => ReactNode;
  renderEditorExtra?: (card: C, change: (patch: Partial<C>) => void) => ReactNode;
  renderStudio?: (card: C, change: (patch: Partial<C>) => void) => ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = cards.find((c) => c.id === openId) ?? null;

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onAdd(title);
    setDraft('');
  };
  const move = (card: C, stage: string) => {
    if (card.stage !== stage) onChange({ ...card, stage, updatedAt: new Date().toISOString() });
  };
  const drop = (stage: string, e: React.DragEvent) => {
    e.preventDefault();
    const card = cards.find((c) => c.id === e.dataTransfer.getData('text/plain'));
    if (card) move(card, stage);
  };

  const lanes = stages
    .map((s) => ({ ...s, cards: cards.filter((c) => c.stage === s.id) }))
    .filter((l) => l.cards.length > 0 && (filter === 'all' || filter === l.id));

  return (
    <>
      <style>{BOARD_CSS}</style>
      <form className="pl-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={addPlaceholder} />
        <button type="submit" style={draft.trim() ? solidButtonStyle : ghostButtonStyle}>add idea</button>
      </form>

      <FilterTabs value={filter} onChange={setFilter} ariaLabel="filter by stage"
        options={[{ value: 'all', label: 'all', count: cards.length }, ...stages.map((s) => ({ value: s.id, label: s.label, count: cards.filter((c) => c.stage === s.id).length }))]} />

      {cards.length === 0 && (
        <div className="card" style={{ color: 'var(--muted)', fontSize: 'var(--body-sm)' }}>No cards yet. Add your first idea above.</div>
      )}

      {lanes.map((lane) => (
        <section key={lane.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(lane.id, e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <SectionHeading label={lane.label} count={lane.cards.length} />
          <div className="pl-grid">
            {lane.cards.map((card) => (
              <article key={card.id} className="pl-card" draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
                onClick={() => setOpenId(card.id)}>
                <h3 className="pl-card__title">{card.title}</h3>
                {card.notes && <p className="pl-card__notes">{card.notes}</p>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {card.targetDate && <span className="pl-chip">{formatDate(card.targetDate)}</span>}
                  {renderChips?.(card)}
                </div>
                <StageBar stages={stages} value={card.stage} onPick={(s) => move(card, s)} />
              </article>
            ))}
          </div>
        </section>
      ))}

      {open && (
        <CardEditor key={open.id} card={open} stages={stages} onClose={() => setOpenId(null)}
          onChange={onChange} onDelete={() => { onDelete(open.id); setOpenId(null); }}
          renderExtra={renderEditorExtra} renderStudio={renderStudio} />
      )}
    </>
  );
}

function StageBar({ stages, value, onPick }: { stages: readonly Stage[]; value: string; onPick: (stage: string) => void }) {
  const at = stages.findIndex((s) => s.id === value);
  return (
    <div className="pl-stages" onClick={(e) => e.stopPropagation()}>
      {stages.map((s, i) => (
        <button key={s.id} type="button" title={`move to ${s.label}`} aria-label={`move to ${s.label}`}
          className={`pl-stage${i <= at ? ' pl-stage--on' : ''}${i === at ? ' pl-stage--current' : ''}`}
          onClick={() => onPick(s.id)} />
      ))}
    </div>
  );
}

function CardEditor<C extends PipelineCardBase>({ card, stages, onClose, onChange, onDelete, renderExtra, renderStudio }: {
  card: C; stages: readonly Stage[]; onClose: () => void; onChange: (card: C) => void; onDelete: () => void;
  renderExtra?: (card: C, change: (patch: Partial<C>) => void) => ReactNode;
  renderStudio?: (card: C, change: (patch: Partial<C>) => void) => ReactNode;
}) {
  // Text fields are edited locally and saved on blur, so typing does not save every keystroke.
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  const [link, setLink] = useState(card.link);

  const change = (patch: Partial<C>) => {
    if (typeof patch.title === 'string') setTitle(patch.title);
    onChange({ ...card, title, notes, link, ...patch, updatedAt: new Date().toISOString() });
  };
  const commit = () => {
    if (title !== card.title || notes !== card.notes || link !== card.link) change({});
  };
  const close = () => { commit(); onClose(); };

  return (
    <div className="viewer" onClick={close}>
      <div className="panel" style={{ maxWidth: 720, gap: 'var(--space-4)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div className="eyebrow">edit card</div>
          <button type="button" style={ghostButtonStyle} onClick={close}>done</button>
        </div>
        <Field label="title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commit} />
        </Field>
        <div className="pl-row">
          <Field label="stage">
            <select className="input" value={card.stage} onChange={(e) => change({ stage: e.target.value } as Partial<C>)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="target date">
            <input className="input" type="date" value={card.targetDate ?? ''} onChange={(e) => change({ targetDate: e.target.value || null } as Partial<C>)} />
          </Field>
        </div>
        <Field label="link">
          <input className="input" type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} onBlur={commit} />
        </Field>
        {link && /^https?:\/\//.test(link) && (
          <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 'var(--body-sm)', color: 'var(--muted)' }}>open link</a>
        )}
        {renderExtra?.(card, change)}
        <Field label="notes">
          <textarea className="input" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={commit}
            placeholder="What is it about, key points, the story, who it is for" style={{ resize: 'vertical' }} />
        </Field>
        {renderStudio?.({ ...card, title, notes, link }, change)}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap', borderTop: '1px solid var(--hairline)', paddingTop: 'var(--space-3)' }}>
          <button type="button" style={{ ...ghostButtonStyle, color: 'var(--hrv)' }}
            onClick={() => { if (window.confirm('Delete this card?')) onDelete(); }}>delete</button>
          <button type="button" style={solidButtonStyle} onClick={close}>done</button>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** New card with the shared fields filled. */
export function newCardBase(title: string, stage: string): PipelineCardBase {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title, notes: '', stage, targetDate: null, link: '', createdAt: now, updatedAt: now };
}

const BOARD_CSS = `
.solo .pl-add { display: flex; gap: var(--space-2); }
.solo .pl-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.solo .pl-row { display: flex; gap: var(--space-3); }
@media (max-width: 639px) {
  .solo .pl-grid { grid-template-columns: 1fr; }
  .solo .pl-row { flex-direction: column; }
}
.solo .pl-card { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--radius-lg); box-shadow: var(--lift);
  padding: var(--space-4); cursor: pointer; display: flex; flex-direction: column; gap: var(--space-3); min-width: 0;
  transition: transform var(--duration-fast) var(--ease-out); }
.solo .pl-card:hover { transform: translateY(-2px); }
.solo .pl-card__title { margin: 0; font-weight: 700; font-size: 1.05rem; line-height: 1.25; letter-spacing: -0.015em; overflow-wrap: anywhere; }
.solo .pl-card__notes { margin: 0; font-size: var(--body-sm); line-height: 1.55; color: var(--muted);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.solo .pl-chip { font-size: var(--eyebrow); font-weight: 600; letter-spacing: 0.04em; color: var(--muted); background: var(--fill-subtle);
  border: 1px solid var(--hairline); border-radius: var(--radius-pill); padding: 2px 8px; }
.solo .pl-stages { display: flex; gap: 4px; margin-top: auto; }
.solo .pl-stage { flex: 1; height: 6px; border: none; border-radius: 3px; background: var(--fill-subtle); cursor: pointer; padding: 0; }
.solo .pl-stage--on { background: var(--accent); }
.solo .pl-stage--current { height: 8px; margin-top: -1px; }
.solo .pl-stage:hover { background: var(--ink); }
@media (pointer: coarse) { .solo .pl-stages { padding: 8px 0; margin: -8px 0; } }
`;
