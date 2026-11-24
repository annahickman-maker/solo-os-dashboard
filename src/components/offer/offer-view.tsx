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
import {
  ACTIONS, BODY, CARD, CARD_BTN, GHOST_BTN, GRID2, GRID3, META, PAGE, PAGE_INNER, SELECT, TITLE, WELL_BTN, Bar, Chip,
  DeleteButton, Field, LoadState, Ring, SaveStatus, TextArea, TopLine, cap, patchById,
} from '@/components/brand/ui';
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
    <div className={PAGE}>
      <div className={PAGE_INNER}>
        <TopLine><SaveStatus state={saveState} error={saveError} onRetry={retrySave} /></TopLine>

        <div className={GRID2}>
          <PhaseCard title="avatars" complete={doc.avatars.length > 0}
            state={doc.avatars.length === 0 ? 'empty' : `${doc.avatars.length} avatar${doc.avatars.length === 1 ? '' : 's'}`}
            description="Who you serve. Fill in the people your offers speak to so every other part of your dashboard works from a clear persona."
            onOpen={() => setPanel('avatars')} />
          <PhaseCard title="offer suite" complete={named > 0}
            state={doc.rungs.length === 0 ? 'empty' : `${named} offer${named === 1 ? '' : 's'}`}
            description="Every offer you sell, organised by tier, plus the results that justify each price."
            onOpen={() => setPanel('suite')} />
        </div>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className={TITLE}>Your offers</h2>
            <p className={`${BODY} mt-1`}>
              {cap(doc.rungs.length === 0 ? 'no offers yet' : featured ? 'one focus, plus the rest' : 'pick one to focus on')}
            </p>
          </div>
          {featured && card(featured)}
          {others.map(card)}
          <div><button type="button" className={GHOST_BTN} onClick={addOffer}>+ Add an offer</button></div>
        </section>
      </div>

      {panel === 'avatars' && <AvatarsPanel doc={doc} update={update} onClose={closePanel} />}
      {panel === 'suite' && <SuitePanel doc={doc} update={update} onClose={closePanel} />}
    </div>
  );
}

function PhaseCard({ title, description, state, complete, onOpen }: {
  title: string; description: string; state: string; complete: boolean; onOpen: () => void;
}) {
  return (
    <button type="button" className={CARD_BTN} onClick={onOpen}>
      <div className="flex justify-between gap-2 items-center">
        <h3 className={`${TITLE} inline-flex items-center gap-2`}>
          <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${complete ? 'bg-green-500' : 'bg-zinc-600'}`} />
          {cap(title)}
        </h3>
        <Chip color={complete ? 'var(--so-green)' : undefined}>{state}</Chip>
      </div>
      <p className={BODY}>{description}</p>
      <div className={`flex justify-end ${META}`}><span>Open →</span></div>
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
    ? `Target: $${rung.target_revenue_per_month_usd.toLocaleString()}/mo · ${rung.target_customers_per_month} customers`
    : rung.goal_price_label ? `Current: ${rung.price_label || '-'} → goal: ${rung.goal_price_label}`
    : rung.price_label ? `${rung.price_label} · how do you raise it from here?` : 'Price ladder and revenue goal for this offer.';

  return (
    <article className={`${CARD} !p-0 overflow-hidden${rung.featured ? ' so-ring-writing' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="grid grid-cols-[auto_1fr_auto] gap-4 items-center w-full px-4 sm:px-6 py-5 text-left cursor-pointer">
        <Ring value={score} label={Math.round(score * 100)} size={rung.featured ? 72 : 56} color={accent} stroke={5} />
        <div className="min-w-0 flex flex-col gap-1">
          {rung.featured && <span className="text-xs font-medium text-green-500">★ Focus of this sprint</span>}
          <div className="flex gap-2 items-baseline flex-wrap">
            <span className={`${rung.featured ? 'text-lg' : 'text-[15px]'} font-semibold text-white break-words`}>{rung.name || <span className="text-zinc-500 italic font-normal">Untitled offer</span>}</span>
            {rung.price_label && <span className="text-[13px] text-zinc-500">· {rung.price_label}</span>}
          </div>
          <p className={BODY}>{rung.promise || rung.proof_required || 'No promise yet. Open to add what this offer delivers.'}</p>
          <div className={`flex gap-x-3 gap-y-1 flex-wrap mt-1 ${META}`}>
            <span>Stage: {STAGE_META[rung.status].label}</span>
            <span>Tier: {TIER_META[rung.tier].label}</span>
            <span>{avatar ? `→ ${avatar.name ?? 'avatar'}` : 'No avatar'}</span>
          </div>
        </div>
        <span aria-hidden className="text-xl leading-none text-zinc-500">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="px-4 sm:px-6 pb-6 flex flex-col gap-4">
          <Field label="the promise">
            <TextArea rows={2} large value={rung.promise} placeholder="One sentence: the specific outcome this offer delivers, and by when."
              onChange={(v) => save({ promise: v })} />
          </Field>
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <span className={META}>Open any card below to edit that part of this offer.</span>
            <div className={ACTIONS}>
              {(() => {
                // Only for edge cases: by default an offer sells as its own product ("this offer").
                const own = offerProductSlug(rung.id);
                // Other offers' own products are left out; any product the owner made is offered.
                const others = products.filter((p) => p.slug !== own && !p.metadata?.offer_id);
                const chosen = rung.product_slug && rung.product_slug !== own ? rung.product_slug : own;
                if (others.length === 0 && chosen === own) return null;
                return (
                  <select className={SELECT} aria-label="Sells as" value={chosen}
                    onChange={(e) => save({ product_slug: e.target.value || own })}>
                    <option value={own}>sells as: this offer</option>
                    {chosen !== own && !others.some((p) => p.slug === chosen) && (
                      <option value={chosen}>sells as: {chosen}</option>
                    )}
                    {others.map((p) => <option key={p.slug} value={p.slug}>sells as: {p.name || p.slug}</option>)}
                  </select>
                );
              })()}
              <button type="button" className={GHOST_BTN} onClick={() => setFocus(!rung.featured)}>{rung.featured ? '★ Unfocus' : '☆ Make focus'}</button>
              <DeleteButton what="this offer" onDelete={() => update((d) => ({ ...d, rungs: d.rungs.filter((r) => r.id !== rung.id), emails: d.emails.filter((e) => e.rung_id !== rung.id) }))} />
            </div>
          </div>
          <div className={GRID3}>
            <SubCard eyebrow="avatar" title={avatar?.name ?? 'Attach an avatar'}
              text={avatar ? (avatar.one_line || avatar.before_state || 'Not filled in yet.') : 'Every offer talks to one specific person.'}
              value={avatar ? 1 : 0} onClick={() => setPanel('avatar')} />
            <SubCard eyebrow="pricing" title={rung.goal_price_label ? `Goal: ${rung.goal_price_label}` : 'Set a price strategy'}
              text={pricingSummary} value={perSection.pricing} onClick={() => setPanel('pricing')} />
            <SubCard eyebrow="proof" title="Proof" text="The promise this offer makes, plus the proof that makes it believable."
              value={proofCompletion(rung)} onClick={() => setPanel('proof')} />
            <SubCard eyebrow="validation" title={STAGE_META[rung.status].label}
              text="Where this offer is on the journey from idea to scaling, by tangible signs."
              value={validationCompletion(rung)} onClick={() => setPanel('validation')} />
            <SubCard eyebrow="conversions" title={rung.sales_page_url ? 'Sales page + funnel' : 'The path to this offer'}
              text="How traffic flows into this offer and converts at each step." value={perSection.content} onClick={() => setPanel('content')} />
          </div>
          <button type="button" className={`${WELL_BTN} !gap-3`} onClick={() => setPanel('score')}>
            <div className="flex justify-between gap-2 items-baseline">
              <span className={TITLE}>Overall offer score</span>
              <span className="text-lg font-semibold text-white tabular-nums">{Math.round(score * 100)}</span>
            </div>
            <Bar value={score} color="var(--so-green)" onWell />
            <div className={`flex justify-between gap-2 flex-wrap ${META}`}><span>25 questions, weighted by stage</span><span>Rate →</span></div>
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
    <button type="button" className={WELL_BTN} onClick={onClick}>
      <span className={META}>{cap(eyebrow)}</span>
      <strong className="text-[14px] font-medium text-white">{title}</strong>
      <p className={`${BODY} line-clamp-2`}>{text}</p>
      <Bar value={value} color="var(--so-blue)" onWell />
    </button>
  );
}
