/**
 * The three funnel boxes at the top of /crm/analytics: Reach (views),
 * Capture (email) and Conversions (sales), from GET /api/analytics/funnel-summary.
 * Pure, so the rules are tested without a browser or a database.
 *
 * Reach = content views + site visits in the period:
 *   - content views: for social post targets published in the period, the
 *     views on each target's latest social_metrics snapshot, summed;
 *   - site visits: analytics_events page_view events in the period plus
 *     funnel_events `start` events (one per funnel session) in the period.
 *     The sales page site's own "sales-page" funnel is left out of the
 *     starts: its visits are already counted as page views.
 * Capture = leads created in the period (any source).
 * Conversions = paid orders (paid_at in the period, net of refunds; an order
 * refunded in full is not a sale) plus pipeline deals won in the period.
 * Revenue is in the home currency; paid orders in another currency are
 * listed beside it, never added in.
 *
 * A source the database cannot answer (missing table, failed read) counts as
 * zero and is named in `unavailable`, so the boxes still render.
 *
 * A custom range (from/to) replaces the period, and an offer filter narrows
 * the numbers to one offer (the /focus funnel):
 *   - Reach: sales page views (the site's page views; the site is the one
 *     sales page) plus content views. Other funnels' starts are left out.
 *   - Capture: contacts created in the range whose source equals the offer's
 *     product slug, whose interested_offers holds the product id, or whose
 *     capture_page is on the offer's sales page URL. When none match, all new
 *     contacts are counted and the summary says so (capture_scope "all").
 *   - Conversions: paid orders of the offer's product (an order item with the
 *     product id, or metadata.product_slug), net of refunds, plus deals won in
 *     the range whose contact names the product (source or interested_offers).
 *     Every offer sells as a product: its own, made automatically
 *     (src/lib/money/offer-product.ts), unless the owner picked another.
 *     An offer ref with no product slug claims no conversions.
 */
import { DEFAULT_CURRENCY, formatMinor } from "../money/money.ts";
import { paidTotals, type PaidTotal } from "../money/totals.ts";
import type { Json } from "../../types/database.ts";
import { metaOf, selectAllIn } from "../money/db-util.ts";
import type { MoneyClient } from "../money/db.ts";

/** The funnel the sales page site writes (its page views are already in analytics_events). */
export const SALES_PAGE_FUNNEL = "sales-page";

export const FUNNEL_PERIODS = ["7d", "30d", "month", "90d"] as const;
export type FunnelPeriod = (typeof FUNNEL_PERIODS)[number];
export const FUNNEL_PERIOD_LABELS: Record<FunnelPeriod, string> = {
  "7d": "7 days",
  "30d": "30 days",
  month: "This month",
  "90d": "90 days",
};

/** The period from a query value; this month when missing or unknown. */
export function parsePeriod(raw: string | null | undefined): FunnelPeriod {
  return (FUNNEL_PERIODS as readonly string[]).includes(raw ?? "") ? (raw as FunnelPeriod) : "month";
}

/** Where the period starts. "This month" starts at the start of the UTC month, like the Sales totals. */
export function periodStart(period: FunnelPeriod, now: Date = new Date()): Date {
  if (period === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 86_400_000);
}

export type MetricSnapshot = { target_id: string; captured_at: string; views: number | null };

/** Views on each target's newest snapshot, summed. Older snapshots of the same target are ignored. */
export function latestViews(snapshots: MetricSnapshot[]): number {
  const latest = new Map<string, MetricSnapshot>();
  for (const s of snapshots) {
    const seen = latest.get(s.target_id);
    if (!seen || Date.parse(s.captured_at) > Date.parse(seen.captured_at)) latest.set(s.target_id, s);
  }
  let total = 0;
  for (const s of latest.values()) total += Math.max(0, Number(s.views) || 0);
  return total;
}

export type PaidOrder = { total_minor: number; currency: string; metadata: Json | null };

/** Paid orders net of refunds; an order refunded in full is left out, so it is not counted as a sale. */
export function netPaidSales(orders: PaidOrder[]): PaidTotal[] {
  const kept = orders.filter((o) => o.total_minor - (Number(metaOf(o.metadata).refunded_minor) || 0) > 0);
  return paidTotals(kept);
}

/** A custom range, as ISO times or YYYY-MM-DD (UTC days; `to` takes the whole day). Capped at now; null when unusable. */
export function parseRange(
  from: string | null | undefined,
  to: string | null | undefined,
  now: Date = new Date()
): { since: string; until: string } | null {
  if (!from) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const start = Date.parse(day.test(from) ? `${from}T00:00:00.000Z` : from);
  const endRaw = to ? Date.parse(day.test(to) ? `${to}T23:59:59.999Z` : to) : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(endRaw)) return null;
  const end = Math.min(endRaw, now.getTime());
  if (start > end) return null;
  return { since: new Date(start).toISOString(), until: new Date(end).toISOString() };
}

/** What the offer filter knows about an offer (a rung of the offer document). */
export type OfferRef = { id: string; name: string; product_slug: string | null; sales_page_url: string };
/** The offer plus the id of its linked product, when the product exists. */
export type OfferMatch = OfferRef & { product_id: string | null };

export type LeadRef = { source: string | null; capture_page: string | null; interested_offers: string[] | null };

const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

function pageOf(raw: string): { host: string; path: string } | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    return { host: u.host.toLowerCase().replace(/^www\./, ""), path: u.pathname.replace(/\/+$/, "") || "/" };
  } catch {
    return null;
  }
}

/** True when the capture page is on the sales page: same host, same path or below it. */
export function onSalesPage(capturePage: string | null | undefined, salesPageUrl: string): boolean {
  const sales = pageOf(salesPageUrl);
  const page = capturePage ? pageOf(capturePage) : null;
  if (!sales || !page || sales.host !== page.host) return false;
  return sales.path === "/" || page.path === sales.path || page.path.startsWith(`${sales.path}/`);
}

/** The contact names the offer's product: its source is the product slug, or interested_offers holds the product id. */
export function leadNamesProduct(lead: LeadRef, offer: OfferMatch): boolean {
  const slug = lower(offer.product_slug);
  if (slug && lower(lead.source) === slug) return true;
  return !!offer.product_id && (lead.interested_offers ?? []).includes(offer.product_id);
}

/** A sign-up for the offer: it names the product, or was captured on the offer's sales page. */
export function leadMatchesOffer(lead: LeadRef, offer: OfferMatch): boolean {
  return leadNamesProduct(lead, offer) || (!!offer.sales_page_url.trim() && onSalesPage(lead.capture_page, offer.sales_page_url));
}

/** An order of the offer's product: an order item with the product id, or metadata.product_slug. */
export function orderMatchesProduct(order: PaidOrder, itemProductIds: string[], offer: OfferMatch): boolean {
  const slug = lower(offer.product_slug);
  if (!slug) return false;
  if (offer.product_id && itemProductIds.includes(offer.product_id)) return true;
  const meta = metaOf(order.metadata).product_slug;
  return typeof meta === "string" && lower(meta) === slug;
}

/** How /focus labels the offer's numbers. */
export type OfferFunnelInfo = {
  id: string;
  name: string;
  product_slug: string | null;
  /** A product is linked, so orders can be matched to the offer. */
  linked: boolean;
  /** "offer": contacts matched to the offer; "all": none matched, so every new contact is counted. */
  capture_scope: "offer" | "all";
};

/** One source per number; null means the database could not answer it. */
export type FunnelInputs = {
  period: FunnelPeriod | "range";
  since: string;
  until?: string;
  offer?: OfferFunnelInfo | null;
  home_currency?: string;
  content_views: number | null;
  site_page_views: number | null;
  funnel_starts: number | null;
  new_contacts: number | null;
  paid: PaidTotal[] | null;
  won: { deals: number; value_minor: number } | null;
};

export type FunnelSummary = {
  period: FunnelPeriod | "range";
  since: string;
  until?: string;
  offer?: OfferFunnelInfo | null;
  home_currency: string;
  reach: { total: number; content_views: number; site_visits: number; site_page_views: number; funnel_starts: number };
  capture: { total: number };
  conversions: { total: number; orders: number; deals: number; revenue_minor: number; order_revenue_minor: number; deal_revenue_minor: number; other: PaidTotal[] };
  unavailable: string[];
};

/** The summary the route answers with: every null source becomes 0 and is named in `unavailable`. */
export function summariseFunnel(i: FunnelInputs): FunnelSummary {
  const unavailable: string[] = [];
  const n = (v: number | null, name: string) => {
    if (v === null) {
      unavailable.push(name);
      return 0;
    }
    return Math.max(0, Number(v) || 0);
  };
  const content_views = n(i.content_views, "content views");
  const site_page_views = n(i.site_page_views, "site page views");
  const funnel_starts = n(i.funnel_starts, "funnel sessions");
  const new_contacts = n(i.new_contacts, "contacts");
  if (i.paid === null) unavailable.push("paid orders");
  if (i.won === null) unavailable.push("won deals");
  const currency = i.home_currency || DEFAULT_CURRENCY;
  const paid = i.paid ?? [];
  const home = paid.find((t) => t.currency === currency);
  const orders = paid.reduce((sum, t) => sum + t.count, 0);
  const deals = i.won?.deals ?? 0;
  const deal_revenue_minor = i.won?.value_minor ?? 0;
  const order_revenue_minor = home?.total_minor ?? 0;
  const site_visits = site_page_views + funnel_starts;
  return {
    period: i.period,
    since: i.since,
    ...(i.until ? { until: i.until } : {}),
    ...(i.offer !== undefined ? { offer: i.offer } : {}),
    home_currency: currency,
    reach: { total: content_views + site_visits, content_views, site_visits, site_page_views, funnel_starts },
    capture: { total: new_contacts },
    conversions: {
      total: orders + deals,
      orders,
      deals,
      revenue_minor: order_revenue_minor + deal_revenue_minor,
      order_revenue_minor,
      deal_revenue_minor,
      other: paid.filter((t) => t.currency !== currency && t.count > 0),
    },
    unavailable,
  };
}

/** "12.3%", or "-" when the denominator is 0 (never Infinity or NaN). */
export function formatRate(numerator: number, denominator: number): string {
  if (!denominator || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return "-";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

const count = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export type FunnelModules = { sales: boolean; pipeline: boolean };

export type FunnelBox = {
  key: "reach" | "capture" | "conversions";
  href: string;
  label: string;
  value: string;
  detail: string;
  rate: string;
  rate_note?: string;
};

/**
 * The boxes, left to right. Reach and Capture always show; Conversions shows
 * when Sales or Pipeline is on, and counts only the switched-on parts.
 */
export function funnelBoxes(s: FunnelSummary | null | undefined, modules: FunnelModules): FunnelBox[] {
  const boxes: FunnelBox[] = [];
  const reach = s?.reach.total ?? 0;
  const captured = s?.capture.total ?? 0;
  boxes.push({
    key: "reach",
    href: "/crm/analytics",
    label: "Reach (views)",
    value: s ? count(reach) : "-",
    detail: s ? `${count(s.reach.content_views)} content views · ${count(s.reach.site_visits)} site visits` : "",
    rate: "",
  });
  boxes.push({
    key: "capture",
    href: "/crm/leads",
    label: "Capture (email)",
    value: s ? count(captured) : "-",
    detail: s ? "new email contacts" : "",
    rate: s ? `${formatRate(captured, reach)} of reach` : "",
  });
  // Conversions always show: every sale counts, whatever modules are on.
  {
    if (!s) {
      boxes.push({ key: "conversions", href: "/sales", label: "Conversions (sales)", value: "-", detail: "", rate: "" });
    } else {
      const c = s.conversions;
      // Every sale counts: orders and won deals, whatever modules are on.
      const orders = c.orders;
      const deals = c.deals;
      const total = orders + deals;
      const revenue = c.order_revenue_minor + c.deal_revenue_minor;
      const parts: string[] = [formatMinor(revenue, s.home_currency)];
      if (modules.pipeline || deals) parts.push(`${plural(orders, "order")}, ${plural(deals, "deal")} won`);
      if (modules.sales) {
        const others = c.other.map((t) => formatMinor(t.total_minor, t.currency)).join(", ");
        if (others) parts.push(`plus ${others}`);
      }
      boxes.push({
        key: "conversions",
        href: "/sales",
        label: "Conversions (sales)",
        value: count(total),
        detail: parts.join(" · "),
        rate: `${formatRate(total, captured)} of captured`,
        rate_note: `${formatRate(total, reach)} of reach`,
      });
    }
  }
  return boxes;
}

// ── reading the sources ─────────────────────────────────────────────────────

const IN_CHUNK = 200;

async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

function headCount(result: { count: number | null; error: { message: string } | null }, what: string): number {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.count ?? 0;
}

async function inChunks<Row>(ids: string[], read: (chunk: string[]) => Promise<Row[]>): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await read(ids.slice(i, i + IN_CHUNK))));
  return out;
}

export type FunnelRead = {
  period: FunnelPeriod | "range";
  since: string;
  until: string;
  home_currency: string;
  /** Narrow to one offer (the /focus funnel). */
  offer?: OfferRef | null;
};

/**
 * Reads every source for the summary. Each is read on its own: a missing
 * table or failed read becomes null, which the summary counts as 0 and names.
 */
export async function readFunnelInputs(db: MoneyClient, r: FunnelRead): Promise<FunnelInputs> {
  const { since, until } = r;
  const ref = r.offer ?? null;
  const slug = ref?.product_slug?.trim() || null;

  const productId = ref && slug
    ? await orNull(async () => {
        const { data, error } = await db.from("products").select("id").eq("slug", slug).maybeSingle();
        if (error) throw new Error(error.message);
        return data?.id ?? null;
      })
    : null;
  const match: OfferMatch | null = ref ? { ...ref, product_slug: slug, product_id: productId } : null;

  const contentViews = orNull(async () => {
    const targets = await selectAllIn(
      (from, to) =>
        db.from("social_post_targets").select("id").eq("status", "published").gte("published_at", since).lte("published_at", until).order("published_at").range(from, to),
      "published targets"
    );
    const snapshots = await inChunks(targets.map((t) => t.id), (chunk) =>
      selectAllIn<MetricSnapshot>(
        (from, to) => db.from("social_metrics").select("target_id, captured_at, views").in("target_id", chunk).order("captured_at", { ascending: false }).order("id").range(from, to),
        "social metrics"
      )
    );
    return latestViews(snapshots);
  });

  const sitePageViews = orNull(async () =>
    headCount(
      await db.from("analytics_events").select("id", { count: "exact", head: true }).eq("event_type", "page_view").gte("created_at", since).lte("created_at", until),
      "page views"
    )
  );

  // The offer funnel counts the sales page only; other funnels sell other things.
  const funnelStarts: Promise<number | null> = match
    ? Promise.resolve(0)
    : orNull(async () =>
        headCount(
          await db.from("funnel_events").select("id", { count: "exact", head: true }).eq("event_type", "start").neq("funnel", SALES_PAGE_FUNNEL).gte("created_at", since).lte("created_at", until),
          "funnel sessions"
        )
      );

  const contacts = orNull(async (): Promise<{ count: number; scope: "offer" | "all" }> => {
    if (!match) {
      return { count: headCount(await db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", since).lte("created_at", until), "new contacts"), scope: "all" };
    }
    const leads = await selectAllIn<LeadRef>(
      (from, to) =>
        db.from("leads").select("id, source, capture_page, interested_offers").gte("created_at", since).lte("created_at", until).order("created_at").order("id").range(from, to),
      "new contacts"
    );
    const matched = leads.filter((l) => leadMatchesOffer(l, match)).length;
    return matched > 0 ? { count: matched, scope: "offer" } : { count: leads.length, scope: "all" };
  });

  const paid = orNull(async () => {
    if (match && !match.product_slug) return [];
    const orders = await selectAllIn<PaidOrder & { id: string }>(
      (from, to) =>
        db.from("orders").select("id, total_minor, currency, metadata").eq("status", "paid").gte("paid_at", since).lte("paid_at", until).order("paid_at").order("id").range(from, to),
      "paid orders"
    );
    if (!match) return netPaidSales(orders);
    const items = match.product_id
      ? await inChunks(orders.map((o) => o.id), (chunk) =>
          selectAllIn<{ order_id: string; product_id: string | null }>(
            (from, to) => db.from("order_items").select("order_id, product_id").in("order_id", chunk).order("id").range(from, to),
            "order items"
          )
        )
      : [];
    const byOrder = new Map<string, string[]>();
    for (const it of items) if (it.product_id) byOrder.set(it.order_id, [...(byOrder.get(it.order_id) ?? []), it.product_id]);
    return netPaidSales(orders.filter((o) => orderMatchesProduct(o, byOrder.get(o.id) ?? [], match)));
  });

  const won = orNull(async () => {
    if (match && !match.product_slug) return { deals: 0, value_minor: 0 };
    let rows = await selectAllIn<{ value_cents: number; lead_id: string }>(
      (from, to) =>
        db.from("opportunities").select("value_cents, lead_id").eq("status", "won").gte("won_at", since).lte("won_at", until).order("won_at").order("id").range(from, to),
      "won deals"
    );
    if (match) {
      const leads = await inChunks([...new Set(rows.map((o) => o.lead_id))], (chunk) =>
        selectAllIn<LeadRef & { id: string }>(
          (from, to) => db.from("leads").select("id, source, capture_page, interested_offers").in("id", chunk).order("id").range(from, to),
          "deal contacts"
        )
      );
      const named = new Set(leads.filter((l) => leadNamesProduct(l, match)).map((l) => l.id));
      rows = rows.filter((o) => named.has(o.lead_id));
    }
    return { deals: rows.length, value_minor: rows.reduce((sum, o) => sum + (o.value_cents || 0), 0) };
  });

  const [content_views, site_page_views, funnel_starts, contactCount, paidTotals, wonDeals] = await Promise.all([
    contentViews, sitePageViews, funnelStarts, contacts, paid, won,
  ]);

  return {
    period: r.period,
    since,
    until,
    home_currency: r.home_currency,
    content_views,
    site_page_views,
    funnel_starts,
    new_contacts: contactCount?.count ?? null,
    paid: paidTotals,
    won: wonDeals,
    ...(match
      ? { offer: { id: match.id, name: match.name, product_slug: match.product_slug, linked: !!match.product_slug, capture_scope: contactCount?.scope ?? "all" } }
      : {}),
  };
}

// ── the /focus offer funnel ─────────────────────────────────────────────────

export type OfferFunnelStep = {
  key: "reach" | "capture" | "conversions" | "revenue";
  label: string;
  value: string;
  detail: string;
  /** Conversion from the step before, e.g. "2.0%"; shown between the boxes. */
  rate_in?: string;
};

/**
 * Reach > Capture > Conversions > Revenue for one offer. Conversions shows
 * when Sales or Pipeline is on; Revenue (paid orders, home currency) when
 * Sales is on. Every offer sells as a product, so with a summary the numbers
 * always show (0 and $0 until sales come in); with none (no focus offer
 * yet) every box shows "-".
 */
export function offerFunnelSteps(s: FunnelSummary | null | undefined, modules: FunnelModules): OfferFunnelStep[] {
  const reach = s ? s.reach.site_page_views + s.reach.content_views : 0;
  const captured = s?.capture.total ?? 0;
  const steps: OfferFunnelStep[] = [
    {
      key: "reach",
      label: "Reach (views)",
      value: s ? count(reach) : "-",
      detail: s ? `${count(s.reach.site_page_views)} sales page · ${count(s.reach.content_views)} content` : "",
    },
    {
      key: "capture",
      label: "Capture (email)",
      value: s ? count(captured) : "-",
      detail: s?.offer?.capture_scope === "all" ? "all sign-ups" : "",
      rate_in: s ? formatRate(captured, reach) : "-",
    },
  ];
  // All four boxes always show, whatever modules are on; empty ones read 0 or "-".
  const c = s?.conversions;
  const orders = c ? c.orders : 0;
  const deals = c ? c.deals : 0;
  const total = orders + deals;
  steps.push({
    key: "conversions",
    label: "Conversions (sales)",
    value: s ? count(total) : "-",
    detail: s ? (modules.pipeline || deals ? `${plural(orders, "order")}, ${plural(deals, "deal")} won` : plural(orders, "order")) : "",
    rate_in: s ? formatRate(total, captured) : "-",
  });
  const others = (c?.other ?? []).map((t) => formatMinor(t.total_minor, t.currency)).join(", ");
  steps.push({
    key: "revenue",
    label: "Revenue",
    value: s ? formatMinor(c?.order_revenue_minor ?? 0, s.home_currency) : "-",
    detail: s && others ? `plus ${others}` : "",
  });
  return steps;
}
