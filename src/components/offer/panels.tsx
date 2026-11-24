'use client';
/** Offer panels: the avatar bank, the offer suite, and the per-offer panels. */
import { useState } from 'react';
import { newId } from '@/components/brand/use-solo-doc';
import {
  AddButton, Check, DeleteButton, ExpandRow, Field, NumberInput, Panel, Section, TextArea, TextInput, orNull, patchById,
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
        <div className="bp-list">
          {doc.avatars.map((a) => (
            <ExpandRow key={a.id} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)}
              title={<><strong style={{ fontWeight: 600 }}>{a.name || 'unnamed avatar'}</strong>{a.one_line && <span className="bp-faint" style={{ display: 'block', marginTop: 2 }}>{a.one_line.slice(0, 140)}</span>}</>}>
              <AvatarEditor avatar={a} update={update} />
              <div className="bp-actions">
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
      <div className="bp-grid2">
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
    <div className="bp-field">
      <label>{label}</label>
      {items.map((item, i) => (
        <div key={`${i}-${item}`} className="bp-card" style={{ flexDirection: 'row', alignItems: 'flex-start', padding: '8px 12px', background: 'var(--so-chip)' }}>
          <span style={{ flex: 1, fontSize: 14 }}>&ldquo;{item}&rdquo;</span>
          <button type="button" className="bp-btn" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => {
        e.preventDefault();
        const v = draft.trim();
        if (!v) return;
        onChange([...items, v]);
        setDraft('');
      }}>
        <input className="bp-input" value={draft} placeholder={placeholder} aria-label={label} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="bp-btn" disabled={!draft.trim()}>add</button>
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
            <div className="bp-list">
              {rungs.map((r) => (
                <ExpandRow key={r.id} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  title={<>{r.price_label && <strong style={{ fontWeight: 600, marginRight: 8 }}>{r.price_label}</strong>}{r.name || <span className="bp-faint">untitled offer</span>}</>}
                  badge={<span className="bp-chip">{STAGE_META[r.status].label.toLowerCase()}</span>}>
                  <div className="bp-grid2">
                    <Field label="name"><TextInput value={r.name} placeholder="e.g. Starter course" onChange={(v) => patch(r.id, { name: v })} /></Field>
                    <Field label="price"><TextInput value={r.price_label} placeholder="e.g. $47/mo" onChange={(v) => patch(r.id, { price_label: v })} /></Field>
                  </div>
                  <Field label="what it is"><TextArea rows={3} value={r.proof_required} placeholder="What is being sold at this tier, in one paragraph." onChange={(v) => patch(r.id, { proof_required: orNull(v) })} /></Field>
                  <Field label="the promise"><TextArea rows={2} value={r.promise} placeholder="The specific outcome, and by when." onChange={(v) => patch(r.id, { promise: v })} /></Field>
                  <div className="bp-grid3">
                    <Field label="stage">
                      <select className="bp-input" value={r.status} onChange={(e) => patch(r.id, { status: e.target.value as OfferPricingRung['status'] })}>
                        {OFFER_STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
                      </select>
                    </Field>
                    <Field label="tier">
                      <select className="bp-input" value={r.tier} onChange={(e) => patch(r.id, { tier: e.target.value as OfferPricingRung['tier'] })}>
                        {OFFER_TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
                      </select>
                    </Field>
                    <Field label="avatar">
                      <select className="bp-input" value={r.avatar_id ?? ''} onChange={(e) => patch(r.id, { avatar_id: e.target.value || null })}>
                        <option value="">none</option>
                        {doc.avatars.map((a) => <option key={a.id} value={a.id}>{a.name || 'unnamed avatar'}</option>)}
                      </select>
                    </Field>
                  </div>
                  <span className="bp-faint">{STAGE_META[r.status].description}</span>
                  <div className="bp-actions">
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
    <div className="bp-list">
      {confirmed.map((r) => (
        <ExpandRow key={r.id} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
          title={r.title || <span className="bp-faint">untitled result</span>}
          badge={<span className="bp-chip">{r.metric || (r.kind === 'own' ? 'mine' : 'customer')}</span>}>
          <TextInput value={r.title} placeholder="e.g. Client doubled her rates in 60 days" onChange={(v) => patch(r.id, { title: v })} />
          <TextArea rows={3} value={r.body} placeholder="Specifics: who, what changed, timeline." onChange={(v) => patch(r.id, { body: orNull(v) })} />
          <div className="bp-grid2">
            <select className="bp-input" value={r.kind} aria-label="Whose result" onChange={(e) => patch(r.id, { kind: e.target.value as OfferPricingResult['kind'] })}>
              <option value="own">my result</option>
              <option value="customer">customer result</option>
            </select>
            <TextInput value={r.metric} placeholder="Metric, e.g. +$4K/mo" onChange={(v) => patch(r.id, { metric: orNull(v) })} />
          </div>
          <div className="bp-actions">
            <button type="button" className="bp-btn" onClick={() => patch(r.id, { status: 'rejected' })}>hide</button>
            <DeleteButton what="this result" onDelete={() => remove(r.id)} />
          </div>
        </ExpandRow>
      ))}
      {candidates.length > 0 && (
        <div className="bp-candidates">
          <span className="so-label" style={{ color: 'var(--so-amber)' }}>suggested · {candidates.length} to review</span>
          {candidates.map((r) => (
            <div key={r.id} className="bp-card">
              <strong style={{ fontSize: 14 }}>{r.title}</strong>
              {r.body && <p className="bp-muted">{r.body}</p>}
              <div className="bp-actions">
                <button type="button" className="bp-btn" onClick={() => patch(r.id, { status: 'rejected' })}>reject</button>
                <button type="button" className="bp-btn primary" onClick={() => patch(r.id, { status: 'confirmed' })}>keep</button>
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
        <p className="bp-muted">No avatars yet. Add one in the Avatars card at the top of the Offer tab.</p>
      ) : (
        <div className="bp-grid2">
          {doc.avatars.map((a) => {
            const on = a.id === rung.avatar_id;
            return (
              <button key={a.id} type="button" className="bp-tile" aria-pressed={on}
                onClick={() => save({ avatar_id: on ? null : a.id })}
                style={{ background: 'var(--so-well)', boxShadow: on ? 'inset 0 0 0 1px var(--so-blue)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{a.name || 'unnamed avatar'}</strong>
                  {on && <span className="bp-chip" style={{ color: BLUE }}>✓ linked</span>}
                </div>
                <p>{(a.one_line || a.before_state || 'Not filled in yet.').slice(0, 180)}</p>
              </button>
            );
          })}
        </div>
      )}
      {attached && (
        <Section title="profile">
          <AvatarEditor avatar={attached} update={update} />
          <div className="bp-actions"><button type="button" className="bp-btn" onClick={() => save({ avatar_id: null })}>detach this avatar from this offer</button></div>
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
      <div className="bp-grid2">
        <Field label="target monthly revenue (USD)" hint="How much this offer is meant to bring in.">
          <NumberInput value={rung.target_revenue_per_month_usd} placeholder="5000" onChange={(v) => withDerived({ target_revenue_per_month_usd: v })} />
        </Field>
        <Field label="target customers / month"
          hint={derived !== null ? 'Target revenue divided by the goal price (or the current price).' : 'Fill in target revenue and a price and this works itself out.'}>
          <div className="bp-stat" style={{ alignItems: 'center' }}><span className="num">{derived !== null ? derived.toLocaleString() : (rung.target_customers_per_month ?? '-')}</span></div>
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
        {items.length === 0 && <p className="bp-muted">No results or wins yet. Add results in the Offer Suite card, or wins under Authority on the Reputation tab.</p>}
        <div className="bp-list">
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
          <section key={p.id} className="bp-card" style={{ background: 'transparent', padding: 0, boxShadow: isCurrent ? '-3px 0 0 0 var(--so-blue)' : undefined, paddingLeft: isCurrent ? 12 : 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{p.label}{isCurrent && <span className="bp-chip" style={{ marginLeft: 8, color: BLUE }}>you are here</span>}</h3>
              <span className="bp-faint">{count} / {p.checks.length}</span>
            </div>
            <p className="bp-muted">{p.description}</p>
            <div className="bp-list">
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
        <div className="bp-grid3">
          <Field label="visitors"><NumberInput value={rung.sales_page_visitors_30d} placeholder="0" onChange={(v) => save({ sales_page_visitors_30d: v })} /></Field>
          <Field label="buyers"><NumberInput value={rung.sales_page_buyers_30d} placeholder="0" onChange={(v) => save({ sales_page_buyers_30d: v })} /></Field>
          <div className="bp-stat"><span className="so-label" style={{ color: 'var(--so-label)' }}>conversion</span><span className="num">{pct(rate(rung.sales_page_buyers_30d, rung.sales_page_visitors_30d))}</span></div>
        </div>
      </Section>
      <Section title="video sales letter" sub="The long-form video that does the selling. Click-through = link clicks ÷ views.">
        <TextInput type="url" value={rung.vsl_url} placeholder="https://..." ariaLabel="Video sales letter link" onChange={(v) => save({ vsl_url: v })} />
        <div className="bp-grid3">
          <Field label="views"><NumberInput value={rung.vsl_views_30d} placeholder="0" onChange={(v) => save({ vsl_views_30d: v })} /></Field>
          <Field label="link clicks"><NumberInput value={rung.vsl_link_clicks_30d} placeholder="0" onChange={(v) => save({ vsl_link_clicks_30d: v })} /></Field>
          <div className="bp-stat"><span className="so-label" style={{ color: 'var(--so-label)' }}>click-through</span><span className="num">{pct(rate(rung.vsl_link_clicks_30d, rung.vsl_views_30d))}</span></div>
        </div>
      </Section>
      <Section title="emails" sub={`Emails that send people to this offer. Type each one's conversion rate from your email platform. Average: ${pct(avg)}.`}>
        <div className="bp-list">
          {emails.map((e) => (
            <div key={e.id} className="bp-card">
              <TextInput value={e.subject} placeholder="Subject" onChange={(v) => patchEmail(e.id, { subject: v })} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="bp-input" style={{ width: 'auto' }} value={e.kind} aria-label="Email type" onChange={(ev) => patchEmail(e.id, { kind: ev.target.value as OfferEmailKind })}>
                  {OFFER_EMAIL_KINDS.map((k) => <option key={k} value={k}>{EMAIL_KIND_LABEL[k]}</option>)}
                </select>
                <div style={{ width: 120 }}><NumberInput value={e.conversion_rate_pct} placeholder="% conv." ariaLabel="Conversion rate, percent" onChange={(v) => patchEmail(e.id, { conversion_rate_pct: v })} /></div>
                <span style={{ flex: 1 }} />
                <DeleteButton what="this email" onDelete={() => update((d) => ({ ...d, emails: d.emails.filter((x) => x.id !== e.id) }))} />
              </div>
            </div>
          ))}
          <form className="bp-card" onSubmit={(ev) => {
            ev.preventDefault();
            if (!subject.trim()) return;
            const now = Date.now();
            update((d) => ({ ...d, emails: [...d.emails, { id: newId('email'), rung_id: rung.id, subject: subject.trim(), kind, conversion_rate_pct: null, created_at: now, updated_at: now }] }));
            setSubject('');
          }}>
            <input className="bp-input" value={subject} placeholder="Email subject, e.g. 'Last 24 hours: doors close tonight'" aria-label="New email subject" onChange={(ev) => setSubject(ev.target.value)} />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <select className="bp-input" style={{ width: 'auto' }} value={kind} aria-label="New email type" onChange={(ev) => setKind(ev.target.value as OfferEmailKind)}>
                {OFFER_EMAIL_KINDS.map((k) => <option key={k} value={k}>{EMAIL_KIND_LABEL[k]}</option>)}
              </select>
              <button type="submit" className="bp-btn primary" disabled={!subject.trim()}>add email</button>
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
          <div className="bp-list">
            {OFFER_QUIZ[s].map((q, i) => (
              <div key={q} className="bp-card" style={{ gap: 8 }}>
                <span style={{ fontSize: 14 }}>{q}</span>
                <div className="bp-rate" role="group" aria-label={q}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" className={rung.scores[s][i] === n ? 'on' : ''} aria-pressed={rung.scores[s][i] === n}
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
