/**
 * Each offer (a rung of the `offer` solo document) sells as exactly one Sales
 * product, made and kept in step automatically, so the /focus funnel can
 * count the offer's orders with no linking step.
 *
 *   - Its slug comes from the offer id (offerProductSlug), so it never
 *     changes when the offer is renamed and is never made twice.
 *   - Name and price follow the offer. Kind is one_time unless the price
 *     label says it repeats ("$47/mo", "$470/yr"), then a subscription.
 *   - A product the owner has changed in ways the offer cannot express is
 *     left alone where it matters: a Stripe price keeps its amount, kind and
 *     currency; a deposit, invoice item or digital product keeps its kind;
 *     the currency and active flag are only set when the product is made.
 *
 * POST /api/offers/sync-product calls syncOfferProduct. Relative imports
 * only, so `node --test` can run it against the fake database.
 */
import { parsePriceLabel, type OfferPricingRung } from "../../components/offer/types.ts";
import type { MoneyClient } from "./db.ts";
import { minorUnitDigits, MAX_AMOUNT_MINOR } from "./money.ts";
import { checkProduct, slugify, type ProductFields } from "./records.ts";

export type OfferProductRung = Pick<OfferPricingRung, "id" | "name" | "price_label" | "goal_price_label">;

/** The slug of the offer's own product: "offer-" plus the offer id as a slug. Stable for the offer's life. */
export function offerProductSlug(rungId: string): string {
  let base = slugify(rungId).replace(/^offer-/, "");
  if (!base) {
    // An id with no letters or digits at all: a short stable hash of it.
    let h = 0;
    for (const ch of rungId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    base = h.toString(36);
  }
  return `offer-${base}`.slice(0, 60).replace(/-+$/, "");
}

/** The product this offer counts sales of: the owner's "sells as" choice, else its own. */
export function offerSalesSlug(rung: Pick<OfferPricingRung, "id" | "product_slug">): string {
  return rung.product_slug?.trim() || offerProductSlug(rung.id);
}

/** month or year when the price label repeats ("$47/mo", "97 per month", "$470 yearly"), else null. */
export function recurringInterval(label: string | null | undefined): "month" | "year" | null {
  const t = (label ?? "").toLowerCase();
  if (/(\/|\bper\s+|\ba\s+|\bevery\s+)(mo|mth|month)\b|\bmonthly\b/.test(t)) return "month";
  if (/(\/|\bper\s+|\ba\s+|\bevery\s+)(yr|year|annum)\b|\b(yearly|annually|annual)\b/.test(t)) return "year";
  return null;
}

/** The offer's price as the product's amount: the goal price when set, else the current price (as /focus reads it). */
export function offerProductPrice(rung: OfferProductRung, currency: string): { amount_minor: number; interval: "month" | "year" | null } {
  const goal = parsePriceLabel(rung.goal_price_label);
  const label = goal !== null ? rung.goal_price_label : rung.price_label;
  const price = goal ?? parsePriceLabel(rung.price_label) ?? 0;
  const minor = Math.round(price * 10 ** minorUnitDigits(currency));
  return {
    amount_minor: Number.isFinite(minor) ? Math.min(Math.max(0, minor), MAX_AMOUNT_MINOR) : 0,
    interval: recurringInterval(label) ?? recurringInterval(rung.price_label),
  };
}

/** The product fields the offer says, for a new product. */
export function offerProductFields(rung: OfferProductRung, currency: string): ProductFields {
  const { amount_minor, interval } = offerProductPrice(rung, currency);
  const checked = checkProduct(
    {
      slug: offerProductSlug(rung.id),
      name: rung.name.trim() || "Untitled offer",
      kind: interval ? "subscription" : "one_time",
      interval,
      amount_minor,
      currency,
      // Hidden from the public product list until the offer has a price.
      active: amount_minor > 0,
      metadata: { offer_id: rung.id },
    },
    undefined,
    { defaultCurrency: currency }
  );
  if (!checked.ok) throw new Error(`offer product: ${checked.error}`);
  return checked.value;
}

type ProductRow = ProductFields & { id: string };

/** What to change on an existing product so it follows the offer; empty when it already does. */
export function offerProductChanges(existing: ProductRow, want: ProductFields): Partial<ProductFields> {
  const out: Partial<ProductFields> = {};
  if (existing.name !== want.name) out.name = want.name;
  // A Stripe price fixes amount, kind and currency; changing them here would break checkout.
  if (existing.stripe_price_id) return out;
  const amount = existing.currency === want.currency
    ? want.amount_minor
    : offerProductAmountIn(want, existing.currency);
  if (existing.amount_minor !== amount) out.amount_minor = amount;
  // A product created unpriced (so hidden) goes live once the offer gets a price.
  if (!existing.active && existing.amount_minor === 0 && amount > 0) out.active = true;
  if (existing.kind === "one_time" || existing.kind === "subscription") {
    if (existing.kind !== want.kind) out.kind = want.kind;
    if ((existing.interval ?? null) !== want.interval) out.interval = want.interval;
  }
  return out;
}

/** The same major amount in another currency's minor units (the owner may have repriced the currency). */
function offerProductAmountIn(want: ProductFields, currency: string): number {
  const major = want.amount_minor / 10 ** minorUnitDigits(want.currency);
  return Math.min(Math.round(major * 10 ** minorUnitDigits(currency)), MAX_AMOUNT_MINOR);
}

export type OfferProductSync = { slug: string; product_id: string; created: boolean; updated: boolean };

/**
 * Makes sure the offer's own product exists and follows the offer. Idempotent
 * on the slug: a second call (or a race with another tab) finds the row the
 * first made and only updates it. Errors throw.
 */
export async function syncOfferProduct(db: MoneyClient, rung: OfferProductRung, currency: string): Promise<OfferProductSync> {
  const want = offerProductFields(rung, currency);
  const find = async (): Promise<ProductRow | null> => {
    const { data, error } = await db.from("products").select("*").eq("slug", want.slug).maybeSingle();
    if (error) throw new Error(`product lookup failed: ${error.message}`);
    return (data as unknown as ProductRow) ?? null;
  };

  let existing = await find();
  if (!existing) {
    const row = { ...want, metadata: want.metadata } as Record<string, unknown>;
    delete row.delivery_url; // never set for an offer product; older databases have no column
    const inserted = await db.from("products").insert(row as never).select("*").single();
    if (!inserted.error) return { slug: want.slug, product_id: (inserted.data as { id: string }).id, created: true, updated: false };
    if (inserted.error.code !== "23505") throw new Error(`product insert failed: ${inserted.error.message}`);
    existing = await find();
    if (!existing) throw new Error("product insert clashed but no product was found");
  }

  const changes = offerProductChanges(existing, want);
  if (Object.keys(changes).length === 0) return { slug: want.slug, product_id: existing.id, created: false, updated: false };
  const { error } = await db.from("products").update(changes as never).eq("id", existing.id);
  if (error) throw new Error(`product update failed: ${error.message}`);
  return { slug: want.slug, product_id: existing.id, created: false, updated: true };
}
