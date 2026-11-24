'use client';
/** Offer panels: the avatar bank, the offer suite, and the per-offer panels. */
import { useState } from 'react';
import { newId } from '@/components/brand/use-solo-doc';
import {
  ACTIONS, BODY, CANDIDATES, CARD, GHOST_BTN, GRID2, GRID3, INPUT, ITEM, META, PRIMARY_BTN, SELECT, STAT, STAT_NUM, TITLE, WELL,
  WELL_BTN, AddButton, Check, Chip, DeleteButton, ExpandRow, Field, NumberInput, Panel, Section, TextArea, TextInput, cap,
  orNull, patchById,
} from '@/components/brand/ui';
import type { ReputationWin } from '@/components/reputation/types';
import {
  EMAIL_KIND_LABEL, OFFER_EMAIL_KINDS, OFFER_QUIZ, OFFER_STAGES, OFFER_TIERS, QUIZ_LABEL, QUIZ_SECTIONS, STAGE_META,
  TIER_META, VALIDATION_PHASES, currentPhase, derivedCustomers, emptyRung, offerScore, rate,
  type OfferAvatar, type OfferDoc, type OfferEmailKind, type OfferPricingResult, type OfferPricingRung,
} from './types';
import type { UpdateOffer } from './offer-view';

type Save = (p: Partial<OfferPricingRung>) => void;
const BLUE = 'var(--so-blue)';
const pct = (n: number | null) => (n === null ? '-' : `${n.toFixed(n < 10 ? 2 : 1)}%`);

// ─── Avatars ──────────────────────────────────────────────────────────────

export function AvatarsPanel({ doc, update, onClose }: { doc: OfferDoc; update: UpdateOffer; onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Panel eyebrow="section" title="avatars" color={BLUE} onClose={onClose}
      sub="The people you build your offers for. Open an avatar to see and edit their whole profile.">
      <Section title="avatar bank">
        <div className="flex flex-col gap-2">
          {doc.avatars.map((a) => (
            <ExpandRow key={a.id} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)}
              title={<><strong className="font-medium">{a.name || 'Unnamed avatar'}</strong>{a.one_line && <span className={`block mt-0.5 ${META}`}>{a.one_line.slice(0, 140)}</span>}</>}>
              <AvatarEditor avatar={a} update={update} />
              <div className={ACTIONS}>
                <DeleteButton what={`"${a.name || 'this avatar'}"`} onDelete={() => update((d) => ({
                  ...d,
                  avatars: d.avatars.filter((x) => x.id !== a.id),
                  rungs: d.rungs.map((r) => (r.avatar_id === a.id ? { ...r, avatar_id: null } : r)),
                }))} />
              </div>
            </ExpandRow>
          ))}
          <AddButton label="add an avatar" onClick={() => {
            const id = newId('avatar');
            update((d) => ({ ...d, avatars: [...d.avatars, { id, name: null, one_line: null, price_point: null, before_state: null, after_state: null, demographics: null, struggles: [], outcomes: [] }] }));
            setOpenId(id);
          }} />
        </div>
      </Section>
    </Panel>
  );
}

function AvatarEditor({ avatar, update }: { avatar: OfferAvatar; update: UpdateOffer }) {
  const patch = (p: Partial<OfferAvatar>) => update((d) => ({ ...d, avatars: patchById(d.avatars, avatar.id, p) }));
  return (
    <>
      <Field label="name"><TextInput value={avatar.name} placeholder="e.g. The burnt-out freelancer" onChange={(v) => patch({ name: orNull(v) })} /></Field>
      <Field label="who they are">
        <TextArea rows={2} value={avatar.one_line} placeholder="One or two sentences on who this person is, e.g. an experienced freelancer who wants to move from client work into teaching."
          onChange={(v) => patch({ one_line: orNull(v) })} />
      </Field>
      <Field label="demographics"><TextInput value={avatar.demographics} placeholder="Age, work, where they are, what they earn" onChange={(v) => patch({ demographics: orNull(v) })} /></Field>
      <div className={GRID2}>
        <Field label="before"><TextArea rows={4} value={avatar.before_state} placeholder="The stuck place. The recurring frustration they live in right now." onChange={(v) => patch({ before_state: orNull(v) })} /></Field>
        <Field label="after"><TextArea rows={4} value={avatar.after_state} placeholder="The day-to-day after working with you." onChange={(v) => patch({ after_state: orNull(v) })} /></Field>
      </div>
      <WordsList label="what they struggle with (in their own words)" items={avatar.struggles}
        placeholder="e.g. I post every day and nobody buys" onChange={(struggles) => patch({ struggles })} />
      <WordsList label="what they want (in their own words)" items={avatar.outcomes}
        placeholder="e.g. a handful of clients who come to me" onChange={(outcomes) => patch({ outcomes })} />
      <Field label="price point"><TextInput value={avatar.price_point} placeholder="What they can and will pay" onChange={(v) => patch({ price_point: orNull(v) })} /></Field>
    </>
  );
}

function WordsList({ label, items, placeholder, onChange }: { label: string; items: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[13px] font-medium text-zinc-300">{cap(label)}</span>
      {items.map((item, i) => (
        <div key={`${i}-${item}`} className={`${WELL} flex items-start gap-3 pl-4 pr-2 py-2`}>
          <span className="flex-1 min-w-0 py-1.5 text-[14px] text-white">&ldquo;{item}&rdquo;</span>
          <button type="button" className={GHOST_BTN} aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        const v = draft.trim();
        if (!v) return;
        onChange([...items, v]);
        setDraft('');
      }}>
        <input className={INPUT} value={draft} placeholder={placeholder} aria-label={label} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className={GHOST_BTN} disabled={!draft.trim()}>Add</button>
      </form>
    </div>
  );
}

// ─── Offer suite ──────────────────────────────────────────────────────────

export function SuitePanel({ doc, update, onClose }: { doc: OfferDoc; update: UpdateOffer; onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const patch = (id: string, p: Partial<OfferPricingRung>) => update((d) => ({ ...d, rungs: patchById(d.rungs, id, p) }));
  return (
    <Panel eyebrow="section" title="offer suite" color={BLUE} onClose={onClose}
      sub="The full set of offers you sell: low, mid and high ticket, each with its own price, promise and avatar.">
      {OFFER_TIERS.map((tier) => {
        const rungs = doc.rungs.filter((r) => r.tier === tier).sort((a, b) => a.sort_order - b.sort_order);
        return (
          <Section key={tier} title={TIER_META[tier].label} sub={TIER_META[tier].sub}>
            <div className="flex flex-col gap-2">
              {rungs.map((r) => (
                <ExpandRow key={r.id} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  title={<>{r.price_label && <strong className="font-medium mr-2">{r.price_label}</strong>}{r.name || <span className="text-zinc-500">Untitled offer</span>}</>}
                  badge={<Chip>{STAGE_META[r.status].label.toLowerCase()}</Chip>}>
                  <div className={GRID2}>
                    <Field label="name"><TextInput value={r.name} placeholder="e.g. Starter course" onChange={(v) => patch(r.id, { name: v })} /></Field>
                    <Field label="price"><TextInput value={r.price_label} placeholder="e.g. $47/mo" onChange={(v) => patch(r.id, { price_label: v })} /></Field>
                  </div>
                  <Field label="what it is"><TextArea rows={3} value={r.proof_required} placeholder="What is being sold at this tier, in one paragraph." onChange={(v) => patch(r.id, { proof_required: orNull(v) })} /></Field>
                  <Field label="the promise"><TextArea rows={2} value={r.promise} placeholder="The specific outcome, and by when." onChange={(v) => patch(r.id, { promise: v })} /></Field>
                  <div className={GRID3}>
                    <Field label="stage">
                      <select className={INPUT} value={r.status} onChange={(e) => patch(r.id, { status: e.target.value as OfferPricingRung['status'] })}>
                        {OFFER_STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
                      </select>
                    </Field>
                    <Field label="tier">
                      <select className={INPUT} value={r.tier} onChange={(e) => patch(r.id, { tier: e.target.value as OfferPricingRung['tier'] })}>
                        {OFFER_TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
                      </select>
                    </Field>
                    <Field label="avatar">
                      <select className={INPUT} value={r.avatar_id ?? ''} onChange={(e) => patch(r.id, { avatar_id: e.target.value || null })}>
                        <option value="">none</option>
                        {doc.avatars.map((a) => <option key={a.id} value={a.id}>{a.name || 'Unnamed avatar'}</option>)}
                      </select>
                    </Field>
                  </div>
                  <span className={META}>{STAGE_META[r.status].description}</span>
                  <div className={ACTIONS}>
                    <DeleteButton what="this offer" onDelete={() => update((d) => ({ ...d, rungs: d.rungs.filter((x) => x.id !== r.id), emails: d.emails.filter((e) => e.rung_id !== r.id) }))} />
                  </div>
                </ExpandRow>
              ))}
              <AddButton label={`add a ${TIER_META[tier].label.toLowerCase().replace('more offers', 'other offer')}`} onClick={() => {
                const rung = emptyRung({ id: newId('offer'), tier, sort_order: Math.max(0, ...doc.rungs.map((x) => x.sort_order)) + 1 });
                update((d) => ({ ...d, rungs: [...d.rungs, rung] }));
                setOpenId(rung.id);
              }} />
            </div>
          </Section>
        );
      })}

      <Section title="results that justify the price"
        sub="Deliver ten times more value than you charge: at $99, aim for at least $1,000 worth of results. Log the specific results, yours and your customers', that prove you do.">
        <ResultsBank results={doc.results} update={update} />
      </Section>
    </Panel>
  );
}

function ResultsBank({ results, update }: { results: OfferPricingResult[]; update: UpdateOffer }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const patch = (id: string, p: Partial<OfferPricingResult>) => update((d) => ({ ...d, results: patchById(d.results, id, p) }));
  const remove = (id: string) => update((d) => ({
    ...d,
    results: d.results.filter((x) => x.id !== id),
    rungs: d.rungs.map((r) => (r.pinned_proof_ids.includes(id) ? { ...r, pinned_proof_ids: r.pinned_proof_ids.filter((p) => p !== id) } : r)),
  }));
  const confirmed = results.filter((r) => r.status === 'confirmed');
  const candidates = results.filter((r) => r.status === 'candidate');
  return (
    <div className="flex flex-col gap-2">
      {confirmed.map((r) => (
        <ExpandRow key={r.id} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
          title={r.title || <span className="text-zinc-500">Untitled result</span>}
          badge={<Chip>{r.metric || (r.kind === 'own' ? 'mine' : 'customer')}</Chip>}>
          <TextInput value={r.title} placeholder="e.g. Client doubled her rates in 60 days" onChange={(v) => patch(r.id, { title: v })} />
          <TextArea rows={3} value={r.body} placeholder="Specifics: who, what changed, timeline." onChange={(v) => patch(r.id, { body: orNull(v) })} />
          <div className={GRID2}>
            <select className={INPUT} value={r.kind} aria-label="Whose result" onChange={(e) => patch(r.id, { kind: e.target.value as OfferPricingResult['kind'] })}>
              <option value="own">my result</option>
              <option value="customer">customer result</option>
            </select>
            <TextInput value={r.metric} placeholder="Metric, e.g. +$4K/mo" onChange={(v) => patch(r.id, { metric: orNull(v) })} />
          </div>
          <div className={ACTIONS}>
            <button type="button" className={GHOST_BTN} onClick={() => patch(r.id, { status: 'rejected' })}>Hide</button>
            <DeleteButton what="this result" onDelete={() => remove(r.id)} />
          </div>
        </ExpandRow>
      ))}
      {candidates.length > 0 && (
        <div className={CANDIDATES}>
          <span className="text-xs font-medium text-amber-500">Suggested · {candidates.length} to review</span>
          {candidates.map((r) => (
            <div key={r.id} className={ITEM}>
              <strong className="text-[14px] font-medium text-white">{r.title}</strong>
              {r.body && <p className={BODY}>{r.body}</p>}
              <div className={ACTIONS}>
                <button type="button" className={GHOST_BTN} onClick={() => patch(r.id, { status: 'rejected' })}>Reject</button>
                <button type="button" className={PRIMARY_BTN} onClick={() => patch(r.id, { status: 'confirmed' })}>Keep</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <AddButton label="add a result" onClick={() => {
        const id = newId('result');
        update((d) => ({ ...d, results: [...d.results, { id, title: '', body: null, kind: 'own', metric: null, status: 'confirmed' }] }));
        setOpenId(id);
      }} />
    </div>
  );
}

// ─── Per-offer panels ─────────────────────────────────────────────────────

const offerName = (r: OfferPricingRung) => r.name || 'this offer';

export function OfferAvatarPanel({ rung, doc, update, save, onClose }: {
  rung: OfferPricingRung; doc: OfferDoc; update: UpdateOffer; save: Save; onClose: () => void;
}) {
  const attached = doc.avatars.find((a) => a.id === rung.avatar_id) ?? null;
  return (
    <Panel eyebrow="avatar for this offer" color={BLUE} onClose={onClose}
      title={attached ? `linked: ${attached.name ?? 'unnamed'}` : 'pick an avatar to attach'}
      sub="Every offer talks to one specific person. Pick one below; the linked avatar's profile opens underneath for editing.">
      {doc.avatars.length === 0 ? (
        <p className={BODY}>No avatars yet. Add one in the Avatars card at the top of the Offer tab.</p>
      ) : (
        <div className={GRID2}>
          {doc.avatars.map((a) => {
            const on = a.id === rung.avatar_id;
            return (
              <button key={a.id} type="button" className={`${WELL_BTN}${on ? ' ring-1 ring-blue-500 hover:ring-blue-500' : ''}`} aria-pressed={on}
                onClick={() => save({ avatar_id: on ? null : a.id })}>
                <div className="flex justify-between gap-2">
                  <strong className="text-[14px] font-medium text-white">{a.name || 'Unnamed avatar'}</strong>
                  {on && <Chip color={BLUE}>✓ linked</Chip>}
                </div>
                <p className={BODY}>{(a.one_line || a.before_state || 'Not filled in yet.').slice(0, 180)}</p>
              </button>
            );
          })}
        </div>
      )}
      {attached && (
        <Section title="profile">
          <AvatarEditor avatar={attached} update={update} />
          <div className={ACTIONS}><button type="button" className={GHOST_BTN} onClick={() => save({ avatar_id: null })}>Detach this avatar from this offer</button></div>
        </Section>
      )}
    </Panel>
  );
}

export function OfferPricingPanel({ rung, save, onClose }: { rung: OfferPricingRung; save: Save; onClose: () => void }) {
  // Customers per month follows target revenue and price whenever either changes.
  const withDerived = (p: Partial<OfferPricingRung>) => {
    const next = { ...rung, ...p };
    const derived = derivedCustomers(next);
    save(derived !== null ? { ...p, target_customers_per_month: derived } : p);
  };
  const derived = derivedCustomers(rung);
  return (
    <Panel eyebrow="pricing" color={BLUE} onClose={onClose} title={`how do you raise the price of ${offerName(rung)}?`}
      sub="The current price, where you want it to go, the revenue and customer goals for this offer, and the plan to climb.">
      <Field label="current price" hint="What you charge today.">
        <TextInput value={rung.price_label} placeholder="$47/mo" onChange={(v) => withDerived({ price_label: v })} />
      </Field>
      <Field label="goal price" hint="Where you want this offer to land at scale.">
        <TextInput value={rung.goal_price_label} placeholder="$197/mo" onChange={(v) => withDerived({ goal_price_label: v })} />
      </Field>
      <div className={GRID2}>
        <Field label="target monthly revenue (USD)" hint="How much this offer is meant to bring in.">
          <NumberInput value={rung.target_revenue_per_month_usd} placeholder="5000" onChange={(v) => withDerived({ target_revenue_per_month_usd: v })} />
        </Field>
        <Field label="target customers / month"
          hint={derived !== null ? 'Target revenue divided by the goal price (or the current price).' : 'Fill in target revenue and a price and this works itself out.'}>
          <div className={STAT}><span className={STAT_NUM}>{derived !== null ? derived.toLocaleString() : (rung.target_customers_per_month ?? '-')}</span></div>
        </Field>
      </div>
      <Field label="plan to raise the price" hint="What triggers each step up: number of customers, level of proof, something added?">
        <TextArea rows={6} value={rung.pricing_plan} onChange={(v) => save({ pricing_plan: v })}
          placeholder={'e.g.\n$47 → first 30 paying members\n$97 → 5 case studies\n$197 → named framework + 100 members'} />
      </Field>
    </Panel>
  );
}

export function OfferProofPanel({ rung, doc, wins, save, onClose }: {
  rung: OfferPricingRung; doc: OfferDoc; wins: ReputationWin[]; save: Save; onClose: () => void;
}) {
  const pinned = new Set(rung.pinned_proof_ids);
  const toggle = (id: string) => save({ pinned_proof_ids: pinned.has(id) ? rung.pinned_proof_ids.filter((x) => x !== id) : [...rung.pinned_proof_ids, id] });
  const items = [
    ...doc.results.filter((r) => r.status === 'confirmed').map((r) => ({ id: r.id, kind: r.kind === 'own' ? 'my result' : 'customer result', title: r.title, body: r.body })),
    ...wins.map((w) => ({ id: w.id, kind: w.kind === 'own' ? 'brag' : 'customer win', title: w.title, body: w.body ?? null })),
  ];
  return (
    <Panel eyebrow="proof" color={BLUE} onClose={onClose} title={`proof for ${offerName(rung)}`}
      sub="The one-line promise plus the proof that makes it believable. Pin at least three.">
      <Section title="the promise">
        <TextArea rows={2} large value={rung.promise} placeholder="One sentence: the specific outcome, and by when." onChange={(v) => save({ promise: v })} />
      </Section>
      <Section title={`pinned proof · ${items.filter((i) => pinned.has(i.id)).length}`}
        sub="From the results in your Offer Suite and the wins on your Reputation tab.">
        {items.length === 0 && <p className={BODY}>No results or wins yet. Add results in the Offer Suite card, or wins under Authority on the Reputation tab.</p>}
        <div className="flex flex-col gap-2">
          {items.map((i) => (
            <Check key={i.id} done={pinned.has(i.id)} onToggle={() => toggle(i.id)}
              label={i.title} hint={[i.kind, i.body].filter(Boolean).join(' · ')} />
          ))}
        </div>
      </Section>
    </Panel>
  );
}

export function OfferValidationPanel({ rung, save, onClose }: { rung: OfferPricingRung; save: Save; onClose: () => void }) {
  const done = new Set(rung.validation_checks);
  const current = currentPhase(rung);
  const toggle = (id: string) => save({ validation_checks: done.has(id) ? rung.validation_checks.filter((x) => x !== id) : [...rung.validation_checks, id] });
  return (
    <Panel eyebrow="validation" color={BLUE} onClose={onClose} title={`where ${offerName(rung)} is`}
      sub="Five phases from idea to scaling. Tick each tangible step as you do it. The highlighted phase is where you are now.">
      {VALIDATION_PHASES.map((p) => {
        const count = p.checks.filter((c) => done.has(c.id)).length;
        const isCurrent = p.id === current;
        return (
          <section key={p.id} className={`${CARD} flex flex-col gap-4${isCurrent ? ' ring-1 ring-blue-500' : ''}`}>
            <div>
              <div className="flex justify-between gap-2 items-baseline">
                <h3 className={`${TITLE} inline-flex items-center gap-2 flex-wrap`}>{p.label}{isCurrent && <Chip color={BLUE}>you are here</Chip>}</h3>
                <span className={`${META} tabular-nums`}>{count} / {p.checks.length}</span>
              </div>
              <p className={`${BODY} mt-1`}>{p.description}</p>
            </div>
            <div className="flex flex-col gap-2">
              {p.checks.map((c) => <Check key={c.id} label={c.label} hint={c.hint} done={done.has(c.id)} onToggle={() => toggle(c.id)} />)}
            </div>
          </section>
        );
      })}
    </Panel>
  );
}

export function OfferContentPanel({ rung, doc, update, save, onClose }: {
  rung: OfferPricingRung; doc: OfferDoc; update: UpdateOffer; save: Save; onClose: () => void;
}) {
  const emails = doc.emails.filter((e) => e.rung_id === rung.id);
  const rated = emails.filter((e) => e.conversion_rate_pct !== null);
  const avg = rated.length ? rated.reduce((a, e) => a + (e.conversion_rate_pct ?? 0), 0) / rated.length : null;
  const [subject, setSubject] = useState('');
  const [kind, setKind] = useState<OfferEmailKind>('one_time');
  const patchEmail = (id: string, p: Partial<OfferDoc['emails'][number]>) =>
    update((d) => ({ ...d, emails: patchById(d.emails, id, { ...p, updated_at: Date.now() }) }));
  return (
    <Panel eyebrow="conversions" color="var(--so-green)" onClose={onClose} title={`the funnel into ${offerName(rung)}`}
      sub="The sales page is the destination. Your video sales letter and emails send people to it. Numbers are the last 30 days, typed in from wherever you track them.">
      <Section title="sales page" sub="Conversion = buyers ÷ visitors.">
        <TextInput type="url" value={rung.sales_page_url} placeholder="https://..." ariaLabel="Sales page link" onChange={(v) => save({ sales_page_url: v })} />
        <div className={GRID3}>
          <Field label="visitors"><NumberInput value={rung.sales_page_visitors_30d} placeholder="0" onChange={(v) => save({ sales_page_visitors_30d: v })} /></Field>
          <Field label="buyers"><NumberInput value={rung.sales_page_buyers_30d} placeholder="0" onChange={(v) => save({ sales_page_buyers_30d: v })} /></Field>
          <div className={STAT}><span className={META}>Conversion</span><span className={STAT_NUM}>{pct(rate(rung.sales_page_buyers_30d, rung.sales_page_visitors_30d))}</span></div>
        </div>
      </Section>
      <Section title="video sales letter" sub="The long-form video that does the selling. Click-through = link clicks ÷ views.">
        <TextInput type="url" value={rung.vsl_url} placeholder="https://..." ariaLabel="Video sales letter link" onChange={(v) => save({ vsl_url: v })} />
        <div className={GRID3}>
          <Field label="views"><NumberInput value={rung.vsl_views_30d} placeholder="0" onChange={(v) => save({ vsl_views_30d: v })} /></Field>
          <Field label="link clicks"><NumberInput value={rung.vsl_link_clicks_30d} placeholder="0" onChange={(v) => save({ vsl_link_clicks_30d: v })} /></Field>
          <div className={STAT}><span className={META}>Click-through</span><span className={STAT_NUM}>{pct(rate(rung.vsl_link_clicks_30d, rung.vsl_views_30d))}</span></div>
        </div>
      </Section>
      <Section title="emails" sub={`Emails that send people to this offer. Type each one's conversion rate from your email platform. Average: ${pct(avg)}.`}>
        <div className="flex flex-col gap-2">
          {emails.map((e) => (
            <div key={e.id} className={ITEM}>
              <TextInput value={e.subject} placeholder="Subject" onChange={(v) => patchEmail(e.id, { subject: v })} />
              <div className="flex gap-2 flex-wrap items-center">
                <select className={SELECT} value={e.kind} aria-label="Email type" onChange={(ev) => patchEmail(e.id, { kind: ev.target.value as OfferEmailKind })}>
                  {OFFER_EMAIL_KINDS.map((k) => <option key={k} value={k}>{EMAIL_KIND_LABEL[k]}</option>)}
                </select>
                <div className="w-32"><NumberInput value={e.conversion_rate_pct} placeholder="% conv." ariaLabel="Conversion rate, percent" onChange={(v) => patchEmail(e.id, { conversion_rate_pct: v })} /></div>
                <span className="flex-1" />
                <DeleteButton what="this email" onDelete={() => update((d) => ({ ...d, emails: d.emails.filter((x) => x.id !== e.id) }))} />
              </div>
            </div>
          ))}
          <form className={ITEM} onSubmit={(ev) => {
            ev.preventDefault();
            if (!subject.trim()) return;
            const now = Date.now();
            update((d) => ({ ...d, emails: [...d.emails, { id: newId('email'), rung_id: rung.id, subject: subject.trim(), kind, conversion_rate_pct: null, created_at: now, updated_at: now }] }));
            setSubject('');
          }}>
            <input className={INPUT} value={subject} placeholder="Email subject, e.g. 'Last 24 hours: doors close tonight'" aria-label="New email subject" onChange={(ev) => setSubject(ev.target.value)} />
            <div className="flex gap-2 justify-end flex-wrap">
              <select className={SELECT} value={kind} aria-label="New email type" onChange={(ev) => setKind(ev.target.value as OfferEmailKind)}>
                {OFFER_EMAIL_KINDS.map((k) => <option key={k} value={k}>{EMAIL_KIND_LABEL[k]}</option>)}
              </select>
              <button type="submit" className={PRIMARY_BTN} disabled={!subject.trim()}>Add email</button>
            </div>
          </form>
        </div>
      </Section>
    </Panel>
  );
}

export function OfferScorePanel({ rung, save, onClose }: { rung: OfferPricingRung; save: Save; onClose: () => void }) {
  const { value, perSection } = offerScore(rung);
  const setScore = (section: (typeof QUIZ_SECTIONS)[number], i: number, n: number) => {
    const next = [...rung.scores[section]];
    next[i] = next[i] === n ? 0 : n;
    save({ scores: { ...rung.scores, [section]: next } });
  };
  return (
    <Panel eyebrow="overall offer score" color="var(--so-green)" onClose={onClose} title={`${Math.round(value * 100)} / 100`}
      sub={`Rate each statement 1 (not at all) to 5 (fully). Sections are weighted for the ${STAGE_META[rung.status].label.toLowerCase()} stage. Tap a rating again to clear it.`}>
      {QUIZ_SECTIONS.map((s) => (
        <Section key={s} title={`${QUIZ_LABEL[s]} · ${Math.round(perSection[s] * 100)}`}>
          <div className="flex flex-col gap-2">
            {OFFER_QUIZ[s].map((q, i) => (
              <div key={q} className={`${WELL} px-4 py-3 flex flex-col gap-2`}>
                <span className="text-[14px] text-white">{q}</span>
                <div className="inline-flex gap-1 flex-wrap" role="group" aria-label={q}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-pressed={rung.scores[s][i] === n}
                      className={`w-8 h-8 rounded-lg text-[13px] font-semibold tabular-nums transition-colors ${
                        rung.scores[s][i] === n ? 'bg-white text-black' : 'bg-minimal-bg text-zinc-400 hover:text-white'}`}
                      onClick={() => setScore(s, i, n)}>{n}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </Panel>
  );
}
