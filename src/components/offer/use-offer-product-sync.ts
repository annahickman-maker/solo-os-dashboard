'use client';
/**
 * Keeps each offer's own Sales product in step with the offer, with no
 * linking step for the owner (src/lib/money/offer-product.ts).
 *
 * Once the offer document is saved (or just loaded), every offer `pick`
 * selects is sent to POST /api/offers/sync-product when its name or price
 * changed since the last sync. The server makes or updates the product; an
 * offer without product_slug then gets its own slug written in. An offer the
 * owner pointed at another product ("sells as") is left alone.
 * A failed sync is not retried until the offer changes again.
 */
import { useEffect, useRef, useState } from 'react';
import { offerProductSlug, offerSalesSlug } from '@/lib/money/offer-product';
import type { SaveState } from '@/components/brand/use-solo-doc';
import type { OfferDoc, OfferPricingRung } from './types';

/** What the product follows; a sync runs when it changes. */
function syncKey(r: OfferPricingRung): string {
  return [r.id, r.name.trim(), r.price_label, r.goal_price_label, offerSalesSlug(r)].join('|');
}

export function useOfferProductSync(
  doc: OfferDoc | null,
  saveState: SaveState,
  update: (fn: (d: OfferDoc) => OfferDoc) => void,
  pick: (r: OfferPricingRung) => boolean,
) {
  const done = useRef(new Set<string>());
  const inflight = useRef(new Set<string>());
  const pickRef = useRef(pick);
  // Bumped when a sync ends, so an offer edited while its sync was in flight is looked at again.
  const [tick, setTick] = useState(0);
  useEffect(() => { pickRef.current = pick; });

  useEffect(() => {
    // Only once the server holds what is on screen: it reads the offer from the saved document.
    if (!doc || (saveState !== 'idle' && saveState !== 'saved')) return;
    for (const rung of doc.rungs) {
      if (!pickRef.current(rung)) continue;
      const own = offerProductSlug(rung.id);
      if (rung.product_slug && rung.product_slug !== own) continue;
      const key = syncKey(rung);
      if (done.current.has(key) || inflight.current.has(rung.id)) continue;
      inflight.current.add(rung.id);
      fetch('/api/offers/sync-product', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rungId: rung.id }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((r: { product_slug?: string; own?: boolean }) => {
          const slug = r.own ? r.product_slug : null;
          if (slug) {
            update((d) => d.rungs.some((x) => x.id === rung.id && !x.product_slug)
              ? { ...d, rungs: d.rungs.map((x) => (x.id === rung.id && !x.product_slug ? { ...x, product_slug: slug } : x)) }
              : d);
          }
        })
        .catch(() => { /* the funnel still counts the offer's own slug; the next change retries */ })
        .finally(() => { done.current.add(key); inflight.current.delete(rung.id); setTick((t) => t + 1); });
    }
  }, [doc, saveState, update, tick]);
}

/** The offers that sell as their own product: the focus offer, and every offer with a name. */
export function sellsAsOwnProduct(r: OfferPricingRung): boolean {
  return r.featured || r.name.trim().length > 0;
}
