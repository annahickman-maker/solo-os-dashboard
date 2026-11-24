/**
 * The link between the 90-day focus (`focus` document) and the focus offer
 * (`offer` document).
 *
 * One source of truth:
 *   - Which offer is the focus: the rung with featured=true in the offer
 *     document. The focus document does not store an offer id, so the Offer
 *     tab's "make focus" button and the picker on /focus are the same switch.
 *   - The target numbers (price and customers, and the monthly revenue that
 *     follows from them): the focus offer's price labels,
 *     target_customers_per_month and target_revenue_per_month_usd. Editing
 *     them from /focus writes back to the offer document.
 *   - Start and current values: the owner types them on /focus. They live in
 *     the focus plan's offerProgress, keyed by offer id, so switching the
 *     focus offer and back keeps each offer's progress.
 *
 * Current values are typed by the owner. The funnel under the heading reads
 * real numbers for the offer through the product it sells as: its own,
 * made automatically (src/lib/money/offer-product.ts), unless the owner
 * picked another (rung.product_slug); see src/lib/analytics/funnel-summary.ts.
 *
 * Pure functions only, so `node --test` can load this file.
 */
import { derivedCustomers, parsePriceLabel, type OfferDoc, type OfferPricingRung } from '../offer/types.ts';
import type { FocusPlan, FocusTarget, OfferMetricProgress, OfferProgress } from './types.ts';

export type OfferMetric = 'revenue' | 'customers';
export const OFFER_METRICS: OfferMetric[] = ['revenue', 'customers'];

/** A 90-day target that comes from the focus offer. */
export interface OfferTarget extends FocusTarget {
  rungId: string;
  metric: OfferMetric;
}

const OFFER_TARGET_PREFIX = 'offer:';

export function offerTargetId(rungId: string, metric: OfferMetric): string {
  return `${OFFER_TARGET_PREFIX}${rungId}:${metric}`;
}

export function isOfferTarget(t: FocusTarget): t is OfferTarget {
  return t.id.startsWith(OFFER_TARGET_PREFIX) && 'rungId' in t && 'metric' in t;
}

/** The focus offer: the featured rung of the offer document, or null. */
export function focusOffer(doc: OfferDoc | null | undefined): OfferPricingRung | null {
  return doc?.rungs.find((r) => r.featured) ?? null;
}

export const PICK_FOCUS_OFFER = 'Pick a focus for the next 90 days';

/** The /focus heading: the focus offer's name, or a prompt to pick one (which opens Set target). */
export function focusHeading(rung: OfferPricingRung | null): { text: string; pick: boolean } {
  return rung ? { text: offerName(rung), pick: false } : { text: PICK_FOCUS_OFFER, pick: true };
}

/** The offer's target for a metric, or null when it has none. Customers follow revenue / price, as on the Offer tab. */
export function offerTargetValue(rung: OfferPricingRung, metric: OfferMetric): number | null {
  const v = metric === 'revenue' ? rung.target_revenue_per_month_usd : derivedCustomers(rung) ?? rung.target_customers_per_month;
  return v !== null && Number.isFinite(v) && v > 0 ? v : null;
}

export function hasOfferTargets(rung: OfferPricingRung | null): boolean {
  return !!rung && OFFER_METRICS.some((m) => offerTargetValue(rung, m) !== null);
}

const METRIC_META: Record<OfferMetric, { label: string; unit: string }> = {
  revenue: { label: 'monthly revenue', unit: '$' },
  customers: { label: 'customers per month', unit: 'customers' },
};

export function offerName(rung: OfferPricingRung): string {
  return rung.name.trim() || 'untitled offer';
}

/** The focus offer's targets as 90-day targets, revenue first. Empty when no offer or no targets. */
export function deriveOfferTargets(plan: Pick<FocusPlan, 'offerProgress'>, rung: OfferPricingRung | null): OfferTarget[] {
  if (!rung) return [];
  const progress = plan.offerProgress[rung.id] ?? {};
  const out: OfferTarget[] = [];
  for (const metric of OFFER_METRICS) {
    const target = offerTargetValue(rung, metric);
    if (target === null) continue;
    const p: OfferMetricProgress = progress[metric] ?? { start: 0, current: 0 };
    out.push({
      id: offerTargetId(rung.id, metric), rungId: rung.id, metric,
      label: `${offerName(rung)}: ${METRIC_META[metric].label}`, unit: METRIC_META[metric].unit,
      start: p.start, current: p.current, target,
    });
  }
  return out;
}

/** Every target the plan is measured on: the focus offer's first, then the owner's own. */
export function allTargets(plan: Pick<FocusPlan, 'offerProgress' | 'targets'>, rung: OfferPricingRung | null): FocusTarget[] {
  return [...deriveOfferTargets(plan, rung), ...plan.targets];
}

/** Makes one offer the focus (featured) and every other offer not. null clears the focus. */
export function setFocusOffer(doc: OfferDoc, rungId: string | null): OfferDoc {
  if (rungId !== null && !doc.rungs.some((r) => r.id === rungId)) return doc;
  if (doc.rungs.every((r) => r.featured === (r.id === rungId))) return doc;
  return { ...doc, rungs: doc.rungs.map((r) => ({ ...r, featured: r.id === rungId })) };
}

/**
 * Writes a 90-day target back to the offer's target fields, the same way the
 * Offer tab's pricing panel does: customers per month follow revenue / price.
 * Setting customers when the offer has a price sets the revenue to match, so
 * both tabs show the same pair. null or 0 clears the target.
 */
export function writeOfferTarget(doc: OfferDoc, rungId: string, metric: OfferMetric, value: number | null): OfferDoc {
  const rung = doc.rungs.find((r) => r.id === rungId);
  if (!rung) return doc;
  const v = value !== null && Number.isFinite(value) && value > 0 ? value : null;
  let patch: Partial<OfferPricingRung>;
  if (metric === 'revenue') {
    const next = { ...rung, target_revenue_per_month_usd: v };
    patch = { target_revenue_per_month_usd: v, target_customers_per_month: v === null ? rung.target_customers_per_month : derivedCustomers(next) ?? rung.target_customers_per_month };
  } else {
    const customers = v === null ? null : Math.ceil(v);
    const price = offerPrice(rung);
    if (customers === null || !price) {
      patch = { target_customers_per_month: customers, ...(customers === null && price ? { target_revenue_per_month_usd: null } : {}) };
    } else {
      patch = { target_customers_per_month: customers, target_revenue_per_month_usd: revenueFor(customers, price) };
    }
  }
  return { ...doc, rungs: doc.rungs.map((r) => (r.id === rungId ? { ...r, ...patch } : r)) };
}

/** The offer's price: the goal price when it has one, else the current price (as derivedCustomers reads it). */
export function offerPrice(rung: Pick<OfferPricingRung, 'goal_price_label' | 'price_label'>): number | null {
  return parsePriceLabel(rung.goal_price_label) ?? parsePriceLabel(rung.price_label);
}

/** Puts a price into a price label, keeping its wording ("$47/mo" -> "$97/mo"). null clears the label. */
export function priceLabelWith(label: string, price: number | null, recurring: boolean): string {
  if (price === null) return '';
  const n = price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (parsePriceLabel(label) !== null) return label.replace(/\d[\d,]*(?:\.\d+)?/, n);
  return recurring ? `$${n}/mo` : `$${n}`;
}

/**
 * Writes the focus offer's price from /focus. The label in effect changes
 * (the goal price when set, else the current price), the target customers
 * stay, and the monthly revenue target follows customers x price.
 * null or 0 clears that price.
 */
export function writeOfferPrice(doc: OfferDoc, rungId: string, value: number | null, recurring: boolean): OfferDoc {
  const rung = doc.rungs.find((r) => r.id === rungId);
  if (!rung) return doc;
  const v = value !== null && Number.isFinite(value) && value > 0 ? value : null;
  const count = offerTargetValue(rung, 'customers');
  const labels: Partial<OfferPricingRung> = parsePriceLabel(rung.goal_price_label) !== null
    ? { goal_price_label: priceLabelWith(rung.goal_price_label, v, recurring) }
    : { price_label: priceLabelWith(rung.price_label, v, recurring) };
  const price = offerPrice({ ...rung, ...labels });
  const patch: Partial<OfferPricingRung> = count === null
    ? labels
    : { ...labels, target_customers_per_month: count, target_revenue_per_month_usd: price ? revenueFor(count, price) : null };
  return { ...doc, rungs: doc.rungs.map((r) => (r.id === rungId ? { ...r, ...patch } : r)) };
}

/** Revenue (to the cent) whose ceil(revenue / price) is exactly `customers`, despite float rounding. */
function revenueFor(customers: number, price: number): number {
  let revenue = Math.round(customers * price * 100) / 100;
  for (let i = 0; i < 5 && Math.ceil(revenue / price) > customers; i++) revenue = Math.round(revenue * 100 - 1) / 100;
  for (let i = 0; i < 5 && Math.ceil(revenue / price) < customers; i++) revenue = Math.round(revenue * 100 + 1) / 100;
  return revenue;
}

/** Updates the owner's start or current value for one offer target, in the focus plan. */
export function setOfferProgress<P extends Pick<FocusPlan, 'offerProgress'>>(
  plan: P, rungId: string, metric: OfferMetric, change: Partial<OfferMetricProgress>,
): P {
  const entry: OfferProgress = plan.offerProgress[rungId] ?? {};
  const prev = entry[metric] ?? { start: 0, current: 0 };
  return { ...plan, offerProgress: { ...plan.offerProgress, [rungId]: { ...entry, [metric]: { ...prev, ...change } } } };
}
