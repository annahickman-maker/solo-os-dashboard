'use client';
/** The four Reputation dimension panels and their banks. */
import { useState } from 'react';
import { newId } from '@/components/brand/use-solo-doc';
import {
  ACTIONS, BODY, CANDIDATES, GHOST_BTN, GRID2, INPUT, ITEM, META, PRIMARY_BTN, STAT, STAT_NUM,
  AddButton, Check, Chip, DeleteButton, ExpandRow, Field, NumberInput, Section, Tags, TagsInput, TextArea, TextInput,
  orNull, patchById,
} from '@/components/brand/ui';
import {
  deriveCompressed, type ApprovedBankEntry, type ReputationDoc, type ReputationMicroStory, type ReputationSlotId,
  type ReputationWin,
} from './types';
import type { UpdateRep } from './reputation-view';

type Props = { doc: ReputationDoc; update: UpdateRep };

const setSlot = (update: UpdateRep, key: ReputationSlotId, value: string | number | null) =>
  update((d) => ({ ...d, slots: { ...d.slots, [key]: value } }));

// ─── Value ────────────────────────────────────────────────────────────────

export function ValuePanel({ doc, update, color }: Props & { color: string }) {
  const steps = [1, 2, 3, 4, 5] as const;
  const filledSteps = steps.filter((n) => doc.slots[`value_step_${n}`]).length;
  return (
    <>
      <Section title="the method" sub="How you help them get their transformation, and the method you use to do it. The prose lives here; the steps live below.">
        <Field label="the method">
          <TextArea rows={4} value={doc.slots.value_method} placeholder="The way you get people from where they are to where they want to be."
            onChange={(v) => setSlot(update, 'value_method', orNull(v))} />
        </Field>
        <Field label="the result of the method">
          <TextArea rows={3} value={doc.slots.value_method_result} placeholder="What someone has once they have been through it."
            onChange={(v) => setSlot(update, 'value_method_result', orNull(v))} />
        </Field>
      </Section>

      <Section title="your 5 steps" sub="The phases someone walks through to complete the method. Each box is one phase, in your words.">
        {steps.map((n) => (
          <Field key={n} label={`step ${n}`}>
            <TextArea rows={2} value={doc.slots[`value_step_${n}`]} placeholder={`Phase ${n} of your method`}
              onChange={(v) => setSlot(update, `value_step_${n}`, orNull(v))} />
          </Field>
        ))}
      </Section>

      <Section title="hours of content" sub="A running total of the long-form content you have published. The more you ship, the more your team has to draw on when writing in your voice.">
        <div className={GRID2}>
          <div className={STAT}>
            <span className={META}>Hours published</span>
            <NumberInput value={doc.slots.hours_on_transformation} placeholder="0" ariaLabel="Hours of long-form content published"
              onChange={(v) => setSlot(update, 'hours_on_transformation', v)} />
          </div>
          <div className={STAT}>
            <span className={META}>Transformation series</span>
            <span className={STAT_NUM}>{filledSteps} / 5</span>
            <span className={META}>One cornerstone piece per step</span>
          </div>
        </div>
      </Section>

      <BankSection title="value bank" color={color}
        sub="Verbatim teaching moments: systems, steps and processes you have named on calls or in content. Use them as your core method."
        entries={doc.teaching_frameworks}
        onChange={(fn) => update((d) => ({ ...d, teaching_frameworks: fn(d.teaching_frameworks) }))} />
    </>
  );
}

// ─── Authority ────────────────────────────────────────────────────────────

export function AuthorityPanel({ doc, update }: Props) {
  const setWins = (fn: (w: ReputationWin[]) => ReputationWin[]) => update((d) => ({ ...d, wins: fn(d.wins) }));
  return (
    <>
      <Section title="brag bank" sub="Everything you bring: experience, people you have worked with, years in, results, awards, press, numbers. For example '5 years building creator businesses' or 'featured on a top podcast'.">
        <WinsList wins={doc.wins.filter((w) => w.kind === 'own')} kind="own" setWins={setWins} />
      </Section>
      <Section title="customer + client wins" sub="The people you have helped and what changed for them. Specifics: who, what you did, before, after, timeline.">
        <WinsList wins={doc.wins.filter((w) => w.kind !== 'own')} kind="client" setWins={setWins} />
      </Section>
      <BankSection title="authority bank" color="var(--so-blue)"
        sub="Verbatim proof moments: specific customer wins, money amounts, audience numbers. Drop them into content as evidence."
        entries={doc.proof_points}
        onChange={(fn) => update((d) => ({ ...d, proof_points: fn(d.proof_points) }))} />
    </>
  );
}

function WinsList({ wins, kind, setWins }: {
  wins: ReputationWin[]; kind: 'own' | 'client'; setWins: (fn: (w: ReputationWin[]) => ReputationWin[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const confirmed = wins.filter((w) => w.status === 'confirmed');
  const candidates = wins.filter((w) => w.status === 'candidate');
  const hidden = wins.filter((w) => w.status === 'rejected').length;
  const patch = (id: string, p: Partial<ReputationWin>) => setWins((all) => patchById(all, id, p));

  return (
    <div className="flex flex-col gap-2">
      {confirmed.map((w) => (
        <ExpandRow key={w.id} title={w.title || <span className="text-zinc-500">Untitled</span>} open={openId === w.id}
          onToggle={() => setOpenId(openId === w.id ? null : w.id)}>
          <TextInput value={w.title} placeholder={kind === 'own' ? "Headline, e.g. '$50K month from a 5-video series'" : "Client headline, e.g. 'Client A: 0 to 2K subscribers in 90 days'"}
            onChange={(v) => patch(w.id, { title: v })} />
          <TextArea rows={3} value={w.body} placeholder="Specifics: numbers, dates, what was done."
            onChange={(v) => patch(w.id, { body: orNull(v) })} />
          {kind !== 'own' && (
            <select className={INPUT} value={w.kind} aria-label="Who this win is for"
              onChange={(e) => patch(w.id, { kind: e.target.value as ReputationWin['kind'] })}>
              <option value="client">client</option>
              <option value="student">student</option>
            </select>
          )}
          <TagsInput value={w.tags} onChange={(tags) => patch(w.id, { tags })} />
          {w.source_episode && <span className={META}>From: {w.source_episode}</span>}
          <div className={ACTIONS}>
            <button type="button" className={GHOST_BTN} onClick={() => patch(w.id, { status: 'rejected' })}>Hide</button>
            <DeleteButton what={`"${w.title || 'this win'}"`} onDelete={() => setWins((all) => all.filter((x) => x.id !== w.id))} />
          </div>
        </ExpandRow>
      ))}

      {candidates.length > 0 && (
        <Candidates count={candidates.length}>
          {candidates.map((w) => (
            <CandidateRow key={w.id} title={w.title} body={w.body} source={w.source_episode}
              onKeep={() => patch(w.id, { status: 'confirmed' })} onReject={() => patch(w.id, { status: 'rejected' })} />
          ))}
        </Candidates>
      )}

      <AddButton label={kind === 'own' ? 'add a brag' : 'add a customer win'} onClick={() => {
        const id = newId('win');
        setWins((all) => [...all, { id, title: '', body: null, kind, status: 'confirmed', tags: [] }]);
        setOpenId(id);
      }} />
      {hidden > 0 && (
        <button type="button" className={`${GHOST_BTN} self-start`}
          onClick={() => setWins((all) => all.map((w) => (w.status === 'rejected' && (kind === 'own') === (w.kind === 'own') ? { ...w, status: 'confirmed' } : w)))}>
          Show {hidden} hidden
        </button>
      )}
    </div>
  );
}

function Candidates({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div className={CANDIDATES}>
      <span className="text-xs font-medium text-amber-500">Suggested · {count} to review</span>
      {children}
    </div>
  );
}

function CandidateRow({ title, body, source, onKeep, onReject }: {
  title?: string | null; body?: string | null; source?: string | null; onKeep: () => void; onReject: () => void;
}) {
  return (
    <div className={ITEM}>
      {title && <strong className="text-[14px] font-medium text-white">{title}</strong>}
      {body && <p className={`${BODY} whitespace-pre-wrap`}>{body}</p>}
      {source && <span className={META}>From: {source}</span>}
      <div className={ACTIONS}>
        <button type="button" className={GHOST_BTN} onClick={onReject}>Reject</button>
        <button type="button" className={PRIMARY_BTN} onClick={onKeep}>Keep</button>
      </div>
    </div>
  );
}

// ─── Banks of verbatim moments ────────────────────────────────────────────

function BankSection({ title, sub, entries, onChange, color }: {
  title: string; sub: string; entries: ApprovedBankEntry[]; color: string;
  onChange: (fn: (e: ApprovedBankEntry[]) => ApprovedBankEntry[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const patch = (id: string, p: Partial<ApprovedBankEntry>) => onChange((all) => patchById(all, id, p));
  return (
    <Section title={title} sub={sub}>
      <div className="flex flex-col gap-2">
        {entries.map((e) => (
          <ExpandRow key={e.id} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)}
            title={e.title || (e.text ? `"${e.text.slice(0, 90)}${e.text.length > 90 ? '...' : ''}"` : <span className="text-zinc-500">Untitled</span>)}
            badge={e.tags?.length ? <Chip color={color}>{e.tags[0]}</Chip> : undefined}>
            <TextInput value={e.title} placeholder="Short title (optional)" onChange={(v) => patch(e.id, { title: orNull(v) })} />
            <TextArea rows={4} value={e.text} placeholder="The words, verbatim." onChange={(v) => patch(e.id, { text: v })} />
            <TextArea rows={2} value={e.context} placeholder="Context: where and why it came up (optional)" onChange={(v) => patch(e.id, { context: orNull(v) })} />
            <div className={GRID2}>
              <TextInput value={e.source_transcript} placeholder="Source (call, video, post)" onChange={(v) => patch(e.id, { source_transcript: orNull(v) })} />
              <TextInput value={e.source_timestamp} placeholder="Timestamp, e.g. 12:40" onChange={(v) => patch(e.id, { source_timestamp: orNull(v) })} />
            </div>
            <TagsInput value={e.tags} onChange={(tags) => patch(e.id, { tags })} />
            <div className={ACTIONS}>
              <DeleteButton what="this entry" onDelete={() => onChange((all) => all.filter((x) => x.id !== e.id))} />
            </div>
          </ExpandRow>
        ))}
        <AddButton label="add an entry" onClick={() => {
          const id = newId('bank');
          onChange((all) => [...all, { id, text: '', title: null, context: null, source_transcript: null, source_timestamp: null, tags: [], created_at: Date.now() }]);
          setOpenId(id);
        }} />
      </div>
    </Section>
  );
}

// ─── Point of view ────────────────────────────────────────────────────────

export function PovPanel({ doc, update }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const patch = (id: string, p: Partial<ReputationDoc['povs'][number]>) => update((d) => ({ ...d, povs: patchById(d.povs, id, p) }));
  return (
    <>
      <Section title="your common enemy" sub="The wedge every POV argues against.">
        <TextArea rows={2} value={doc.slots.common_enemy}
          placeholder="e.g. 'hustle culture' or 'generic playbooks built for people whose brain works differently from mine'"
          onChange={(v) => setSlot(update, 'common_enemy', orNull(v))} />
      </Section>

      <Section title="POV bank" sub="Every contrarian point you stake, structured. Open a POV to fill in the common belief, your flip, why you believe it, and how you use it in content.">
        <div className="flex flex-col gap-2">
          {doc.povs.map((p) => (
            <ExpandRow key={p.id} title={p.title || <span className="text-zinc-500">Untitled POV</span>} open={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              badge={p.my_pov ? undefined : <Chip>draft</Chip>}>
              <TextInput value={p.title} placeholder="POV title, e.g. 'Long-form beats short-form for solo creators'" onChange={(v) => patch(p.id, { title: v })} />
              <Field label="the common belief"><TextArea rows={2} value={p.common_belief} placeholder="What most people in your space believe." onChange={(v) => patch(p.id, { common_belief: orNull(v) })} /></Field>
              <Field label="my flip"><TextArea rows={2} value={p.my_pov} placeholder="What you believe instead." onChange={(v) => patch(p.id, { my_pov: orNull(v) })} /></Field>
              <Field label="why I believe this"><TextArea rows={3} value={p.story_behind} placeholder="The story or evidence behind it." onChange={(v) => patch(p.id, { story_behind: orNull(v) })} /></Field>
              <Field label="how I use it in content"><TextArea rows={2} value={p.how_i_use} placeholder="Where it shows up: hooks, videos, emails." onChange={(v) => patch(p.id, { how_i_use: orNull(v) })} /></Field>
              <div className={ACTIONS}>
                <DeleteButton what={`"${p.title || 'this POV'}"`} onDelete={() => update((d) => ({ ...d, povs: d.povs.filter((x) => x.id !== p.id) }))} />
              </div>
            </ExpandRow>
          ))}
          <AddButton label="add POV" onClick={() => {
            const id = newId('pov');
            update((d) => ({ ...d, povs: [...d.povs, { id, title: '' }] }));
            setOpenId(id);
          }} />
        </div>
      </Section>

      <BankSection title="POVs from transcripts" color="var(--so-slate)"
        sub="Verbatim POVs from things you have said on calls, in workshops or in content."
        entries={doc.transcript_povs}
        onChange={(fn) => update((d) => ({ ...d, transcript_povs: fn(d.transcript_povs) }))} />
    </>
  );
}

// ─── Connection ───────────────────────────────────────────────────────────

export function ConnectionPanel({ doc, update }: Props) {
  const auto = deriveCompressed(doc.slots.my_story_text);
  const override = doc.slots.compressed_story;
  const [newAction, setNewAction] = useState('');
  return (
    <>
      <Section title="your story" sub="The long version: where you started, the turning point, what you do now and who it is for. Your team draws on this when writing in your voice.">
        <TextArea rows={8} value={doc.slots.my_story_text} placeholder="Where it started, what changed, where you are now."
          onChange={(v) => setSlot(update, 'my_story_text', orNull(v))} />
      </Section>

      <Section title="30-second version" sub="Drafted from your story above until you edit it. This is what you would say in a podcast intro or pin to your profile.">
        <TextArea rows={4} value={override ?? auto} placeholder="Write your story above and a short draft appears here."
          onChange={(v) => setSlot(update, 'compressed_story', v === '' || v === auto ? null : v)} />
        {override && auto && (
          <div><button type="button" className={GHOST_BTN} onClick={() => setSlot(update, 'compressed_story', null)}>Use the draft from my story</button></div>
        )}
      </Section>

      <Section title="where your story is placed" sub="Tick off where your story actually lives in the wild.">
        <div className="flex flex-col gap-2">
          {doc.story_actions.map((a) => (
            <div key={a.id} className="flex gap-2 items-stretch">
              <div className="flex-1 min-w-0">
                <Check label={a.label} hint={a.hint} done={a.done}
                  onToggle={() => update((d) => ({ ...d, story_actions: patchById(d.story_actions, a.id, { done: !a.done }) }))} />
              </div>
              <button type="button" className={GHOST_BTN} aria-label={`Remove "${a.label}"`} title="remove"
                onClick={() => { if (window.confirm(`Remove "${a.label}"?`)) update((d) => ({ ...d, story_actions: d.story_actions.filter((x) => x.id !== a.id) })); }}>×</button>
            </div>
          ))}
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            const label = newAction.trim();
            if (!label) return;
            update((d) => ({ ...d, story_actions: [...d.story_actions, { id: newId('action'), label, done: false }] }));
            setNewAction('');
          }}>
            <input className={INPUT} value={newAction} placeholder="Another place your story lives" aria-label="Another place your story lives"
              onChange={(e) => setNewAction(e.target.value)} />
            <button type="submit" className={GHOST_BTN} disabled={!newAction.trim()}>Add</button>
          </form>
        </div>
      </Section>

      <Section title="micro-stories bank" sub="Moments worth reusing across content. Keep what feels like you and tag by topic so the right one gets pulled for the right script.">
        <MicroStories stories={doc.micro_stories}
          onChange={(fn) => update((d) => ({ ...d, micro_stories: fn(d.micro_stories) }))} />
      </Section>
    </>
  );
}

function MicroStories({ stories, onChange }: {
  stories: ReputationMicroStory[]; onChange: (fn: (s: ReputationMicroStory[]) => ReputationMicroStory[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const patch = (id: string, p: Partial<ReputationMicroStory>) => onChange((all) => patchById(all, id, p));
  const confirmed = stories.filter((s) => s.status === 'confirmed');
  const candidates = stories.filter((s) => s.status === 'candidate');
  return (
    <div className="flex flex-col gap-2">
      {confirmed.map((s) => (
        <ExpandRow key={s.id} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)}
          title={s.title || (s.text ? `${s.text.slice(0, 90)}${s.text.length > 90 ? '...' : ''}` : <span className="text-zinc-500">Untitled story</span>)}
          badge={s.tags?.length ? <Tags tags={s.tags.slice(0, 2)} /> : undefined}>
          <TextInput value={s.title} placeholder="Short title (optional)" onChange={(v) => patch(s.id, { title: orNull(v) })} />
          <TextArea rows={5} value={s.text} placeholder="The story, in your words." onChange={(v) => patch(s.id, { text: v })} />
          <TextInput value={s.source_episode} placeholder="Where it came from (optional)" onChange={(v) => patch(s.id, { source_episode: orNull(v) })} />
          <TagsInput value={s.tags} onChange={(tags) => patch(s.id, { tags })} placeholder="topics, comma separated" />
          <div className={ACTIONS}>
            <button type="button" className={GHOST_BTN} onClick={() => patch(s.id, { status: 'rejected' })}>Hide</button>
            <DeleteButton what="this story" onDelete={() => onChange((all) => all.filter((x) => x.id !== s.id))} />
          </div>
        </ExpandRow>
      ))}
      {candidates.length > 0 && (
        <Candidates count={candidates.length}>
          {candidates.map((s) => (
            <CandidateRow key={s.id} title={s.title} body={s.text} source={s.source_episode}
              onKeep={() => patch(s.id, { status: 'confirmed' })} onReject={() => patch(s.id, { status: 'rejected' })} />
          ))}
        </Candidates>
      )}
      <AddButton label="add a micro-story" onClick={() => {
        const id = newId('story');
        onChange((all) => [...all, { id, text: '', title: null, status: 'confirmed', tags: [] }]);
        setOpenId(id);
      }} />
    </div>
  );
}
