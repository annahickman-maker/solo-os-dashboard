'use client';
/**
 * Offer tab (/brand/offer), ported from the old Solo OS Offer page.
 *   Row 1: Avatars and Offer Suite cards; each opens its panel.
 *   Row 2: every offer as its own card, the focus offer first. Expand one for
 *          its promise and the per-offer parts (avatar, pricing, proof,
 *          validation, conversions) plus the overall offer score.
 * Data: solo document `offer` (./types.ts). Reputation wins are read (never
 * written) so they can be pinned as proof.
 */
import { useCallback, useEffect, useState } from 'react';
import { loadDoc } from '@/lib/solo/client';
import { useNavModules } from '@/components/nav';
import { newId, useSoloDoc } from '@/components/brand/use-solo-doc';
import { offerProductSlug } from '@/lib/money/offer-product';
import { sellsAsOwnProduct, useOfferProductSync } from './use-offer-product-sync';
import { Bar, DeleteButton, LoadState, Ring, SaveStatus, TextArea, patchById } from '@/components/brand/ui';
import { REPUTATION_DOC_KEY, normalizeReputationDoc, type ReputationWin } from '@/components/reputation/types';
import {
  OFFER_DOC_KEY, STAGE_META, TIER_META, emptyRung, normalizeOfferDoc, offerScore, proofCompletion,
  validationCompletion, type OfferDoc, type OfferPricingRung,
} from './types';
import {
  AvatarsPanel, OfferAvatarPanel, OfferContentPanel, OfferPricingPanel, OfferProofPanel, OfferScorePanel,
  OfferValidationPanel, SuitePanel,
} from './panels';

export type UpdateOffer = (fn: (d: OfferDoc) => OfferDoc) => void;
type PerOffer = 'avatar' | 'pricing' | 'proof' | 'validation' | 'content' | 'score';
type SalesProduct = { slug: string; name: string; metadata?: { offer_id?: unknown } | null };

/** Sales products, for "sells as" (an edge case: each offer sells as its own product by default); empty while the Sales module is off. */
function useSalesProducts(): SalesProduct[] {
  const { sales } = useNavModules();
  const [products, setProducts] = useState<SalesProduct[]>([]);
  useEffect(() => {
    if (!sales) return;
    let live = true;
    fetch('/api/crm/products?limit=200', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { products?: SalesProduct[] }) => { if (live) setProducts(Array.isArray(d.products) ? d.products : []); })
      .catch(() => { if (live) setProducts([]); });
    return () => { live = false; };
  }, [sales]);
  return sales ? products : [];
}

export function OfferView() {
  const { doc, loadError, reload, update, saveState, saveError, retrySave } = useSoloDoc(OFFER_DOC_KEY, normalizeOfferDoc);
  const [panel, setPanel] = useState<'avatars' | 'suite' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [wins, setWins] = useState<ReputationWin[]>([]);
  const products = useSalesProducts();
  // Each named offer (and the focus offer) sells as its own Sales product, made and kept in step here.
  useOfferProductSync(doc, saveState, update, sellsAsOwnProduct);
  const closePanel = useCallback(() => setPanel(null), []);

  useEffect(() => {
    loadDoc<unknown>(REPUTATION_DOC_KEY, null)
      .then((raw) => setWins(normalizeReputationDoc(raw).wins.filter((w) => w.status === 'confirmed')))
      .catch(() => setWins([]));
  }, []);

  // Land on the focus offer, expanded.
  const featuredId = doc?.rungs.find((r) => r.featured)?.id ?? null;
  const [defaulted, setDefaulted] = useState(false);
  if (!defaulted && featuredId) { setDefaulted(true); setOpenId(featuredId); }

  if (!doc) return <LoadState error={loadError} onRetry={reload} />;

  const featured = doc.rungs.find((r) => r.featured) ?? null;
  const others = doc.rungs.filter((r) => !r.featured).sort((a, b) => a.sort_order - b.sort_order);
  const named = doc.rungs.filter((r) => r.name.trim() || r.price_label.trim()).length;

  const addOffer = () => {
    const rung = emptyRung({ id: newId('offer'), sort_order: Math.max(0, ...doc.rungs.map((r) => r.sort_order)) + 1 });
    update((d) => ({ ...d, rungs: [...d.rungs, rung] }));
    setOpenId(rung.id);
  };

  const card = (r: OfferPricingRung) => (
    <OfferCard key={r.id} rung={r} doc={doc} update={update} wins={wins} products={products}
      open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
  );

  return (
    <div className="stack">
      <div className="bp-topline">
        <span />
        <SaveStatus state={saveState} error={saveError} onRetry={retrySave} />
      </div>

      <div className="bp-grid2">
        <PhaseCard title="avatars" complete={doc.avatars.length > 0}
          state={doc.avatars.length === 0 ? 'empty' : `${doc.avatars.length} avatar${doc.avatars.length === 1 ? '' : 's'}`}
          description="Who you serve. Fill in the people your offers speak to so every other part of your dashboard works from a clear persona."
          onOpen={() => setPanel('avatars')} />
        <PhaseCard title="offer suite" complete={named > 0}
          state={doc.rungs.length === 0 ? 'empty' : `${named} offer${named === 1 ? '' : 's'}`}
          description="Every offer you sell, organised by tier, plus the results that justify each price."
          onOpen={() => setPanel('suite')} />
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <span className="so-label" style={{ color: 'var(--so-label)' }}>your offers</span>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '4px 0' }}>
            {doc.rungs.length === 0 ? 'no offers yet' : featured ? 'one focus, plus the rest' : 'pick one to focus on'}
          </h2>
        </div>
        {featured && card(featured)}
        {others.map(card)}
        <button type="button" className="bp-add" onClick={addOffer}>+ add an offer</button>
      </section>

      {panel === 'avatars' && <AvatarsPanel doc={doc} update={update} onClose={closePanel} />}
      {panel === 'suite' && <SuitePanel doc={doc} update={update} onClose={closePanel} />}
    </div>
  );
}

function PhaseCard({ title, description, state, complete, onOpen }: {
  title: string; description: string; state: string; complete: boolean; onOpen: () => void;
}) {
  const color = complete ? 'var(--so-green)' : 'var(--so-faint)';
  return (
    <button type="button" className="bp-tile" onClick={onOpen}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span className="so-label" style={{ color }}>{title}</span>
        <span className="bp-chip" style={complete ? { color: 'var(--so-green)' } : undefined}>{state}</span>
      </div>
      <p>{description}</p>
      <div className="bp-meta"><span /><span>open →</span></div>
    </button>
  );
}

function OfferCard({ rung, doc, update, wins, products, open, onToggle }: {
  rung: OfferPricingRung; doc: OfferDoc; update: UpdateOffer; wins: ReputationWin[]; products: SalesProduct[]; open: boolean; onToggle: () => void;
}) {
  const [panel, setPanel] = useState<PerOffer | null>(null);
  const close = useCallback(() => setPanel(null), []);
  const save = (p: Partial<OfferPricingRung>) => update((d) => ({ ...d, rungs: patchById(d.rungs, rung.id, p) }));
  const setFocus = (on: boolean) => update((d) => ({ ...d, rungs: d.rungs.map((r) => ({ ...r, featured: r.id === rung.id ? on : on ? false : r.featured })) }));
  const avatar = doc.avatars.find((a) => a.id === rung.avatar_id) ?? null;
  const { value: score, perSection } = offerScore(rung);
  const accent = rung.featured ? 'var(--so-green)' : 'var(--so-blue)';
  const pricingSummary = rung.target_revenue_per_month_usd && rung.target_customers_per_month
    ? `target: $${rung.target_revenue_per_month_usd.toLocaleString()}/mo · ${rung.target_customers_per_month} customers`
    : rung.goal_price_label ? `current: ${rung.price_label || '-'} → goal: ${rung.goal_price_label}`
    : rung.price_label ? `${rung.price_label} · how do you raise it from here?` : 'Price ladder and revenue goal for this offer.';

  return (
    <article className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: rung.featured ? 'inset 0 0 0 1px var(--so-ring-writing)' : undefined }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center', width: '100%', padding: '16px 20px', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--so-ink)' }}>
        <Ring value={score} label={Math.round(score * 100)} size={rung.featured ? 72 : 56} color={accent} stroke={5} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rung.featured && <span className="so-label" style={{ color: 'var(--so-green)' }}>★ focus of this sprint</span>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: rung.featured ? 18 : 16, fontWeight: 600 }}>{rung.name || <span className="bp-faint" style={{ fontStyle: 'italic', fontWeight: 400 }}>untitled offer</span>}</span>
            {rung.price_label && <span className="bp-muted">· {rung.price_label}</span>}
          </div>
          <p className="bp-muted">{rung.promise || rung.proof_required || 'No promise yet. Open to add what this offer delivers.'}</p>
          <div className="bp-meta" style={{ justifyContent: 'flex-start', gap: 12 }}>
            <span>stage: {STAGE_META[rung.status].label.toLowerCase()}</span>
            <span>tier: {TIER_META[rung.tier].label.toLowerCase()}</span>
            <span>{avatar ? `→ ${avatar.name ?? 'avatar'}` : 'no avatar'}</span>
          </div>
        </div>
        <span style={{ fontSize: 22, color: 'var(--so-muted)', fontWeight: 300 }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="bp-field">
            <label style={{ color: accent }}>the promise</label>
            <TextArea rows={2} large value={rung.promise} placeholder="One sentence: the specific outcome this offer delivers, and by when."
              onChange={(v) => save({ promise: v })} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="bp-faint">Open any card below to edit that part of this offer.</span>
            <div className="bp-actions">
              {(() => {
                // Only for edge cases: by default an offer sells as its own product ("this offer").
                const own = offerProductSlug(rung.id);
                // Other offers' own products are left out; any product the owner made is offered.
                const others = products.filter((p) => p.slug !== own && !p.metadata?.offer_id);
                const chosen = rung.product_slug && rung.product_slug !== own ? rung.product_slug : own;
                if (others.length === 0 && chosen === own) return null;
                return (
                  <select className="bp-input" style={{ width: 'auto' }} aria-label="Sells as" value={chosen}
                    onChange={(e) => save({ product_slug: e.target.value || own })}>
                    <option value={own}>sells as: this offer</option>
                    {chosen !== own && !others.some((p) => p.slug === chosen) && (
                      <option value={chosen}>sells as: {chosen}</option>
                    )}
                    {others.map((p) => <option key={p.slug} value={p.slug}>sells as: {p.name || p.slug}</option>)}
                  </select>
                );
              })()}
              <button type="button" className="bp-btn" onClick={() => setFocus(!rung.featured)}>{rung.featured ? '★ unfocus' : '☆ make focus'}</button>
              <DeleteButton what="this offer" onDelete={() => update((d) => ({ ...d, rungs: d.rungs.filter((r) => r.id !== rung.id), emails: d.emails.filter((e) => e.rung_id !== rung.id) }))} />
            </div>
          </div>
          <div className="bp-grid3">
            <SubCard eyebrow="avatar" title={avatar?.name ?? 'attach an avatar'}
              text={avatar ? (avatar.one_line || avatar.before_state || 'Not filled in yet.') : 'Every offer talks to one specific person.'}
              value={avatar ? 1 : 0} onClick={() => setPanel('avatar')} />
            <SubCard eyebrow="pricing" title={rung.goal_price_label ? `goal: ${rung.goal_price_label}` : 'set a price strategy'}
              text={pricingSummary} value={perSection.pricing} onClick={() => setPanel('pricing')} />
            <SubCard eyebrow="proof" title="proof" text="The promise this offer makes, plus the proof that makes it believable."
              value={proofCompletion(rung)} onClick={() => setPanel('proof')} />
            <SubCard eyebrow="validation" title={STAGE_META[rung.status].label}
              text="Where this offer is on the journey from idea to scaling, by tangible signs."
              value={validationCompletion(rung)} onClick={() => setPanel('validation')} />
            <SubCard eyebrow="conversions" title={rung.sales_page_url ? 'sales page + funnel' : 'the path to this offer'}
              text="How traffic flows into this offer and converts at each step." value={perSection.content} onClick={() => setPanel('content')} />
          </div>
          <button type="button" className="bp-tile" onClick={() => setPanel('score')} style={{ background: 'var(--so-well)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <span className="so-label" style={{ color: 'var(--so-green)' }}>overall offer score</span>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{Math.round(score * 100)}</span>
            </div>
            <Bar value={score} color="var(--so-green)" />
            <div className="bp-meta"><span>25 questions, weighted by stage</span><span>rate →</span></div>
          </button>

          {panel === 'avatar' && <OfferAvatarPanel rung={rung} doc={doc} update={update} save={save} onClose={close} />}
          {panel === 'pricing' && <OfferPricingPanel rung={rung} save={save} onClose={close} />}
          {panel === 'proof' && <OfferProofPanel rung={rung} doc={doc} wins={wins} save={save} onClose={close} />}
          {panel === 'validation' && <OfferValidationPanel rung={rung} save={save} onClose={close} />}
          {panel === 'content' && <OfferContentPanel rung={rung} doc={doc} update={update} save={save} onClose={close} />}
          {panel === 'score' && <OfferScorePanel rung={rung} save={save} onClose={close} />}
        </div>
      )}
    </article>
  );
}

function SubCard({ eyebrow, title, text, value, onClick }: { eyebrow: string; title: string; text: string; value: number; onClick: () => void }) {
  return (
    <button type="button" className="bp-tile" onClick={onClick} style={{ background: 'var(--so-well)', padding: '12px 14px', gap: 8 }}>
      <span className="so-label" style={{ color: 'var(--so-blue)' }}>{eyebrow}</span>
      <strong style={{ fontSize: 14, fontWeight: 600 }}>{title}</strong>
      <p style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text}</p>
      <Bar value={value} color="var(--so-blue)" />
    </button>
  );
}
