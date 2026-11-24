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
 * Capture = leads created in the period (any source).
 * Conversions = paid orders (paid_at in the period, net of refunds; an order
 * refunded in full is not a sale) plus pipeline deals won in the period.
 * Revenue is in the home currency; paid orders in another currency are
 * listed beside it, never added in.
 *
 * A source the database cannot answer (missing table, failed read) counts as
 * zero and is named in `unavailable`, so the boxes still render.
 */
import { DEFAULT_CURRENCY, formatMinor } from "../money/money.ts";
import { paidTotals, type PaidTotal } from "../money/totals.ts";
import type { Json } from "../../types/database.ts";
import { metaOf } from "../money/db-util.ts";

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

/** One source per number; null means the database could not answer it. */
export type FunnelInputs = {
  period: FunnelPeriod;
  since: string;
  home_currency?: string;
  content_views: number | null;
  site_page_views: number | null;
  funnel_starts: number | null;
  new_contacts: number | null;
  paid: PaidTotal[] | null;
  won: { deals: number; value_minor: number } | null;
};

export type FunnelSummary = {
  period: FunnelPeriod;
  since: string;
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
  if (modules.sales || modules.pipeline) {
    if (!s) {
      boxes.push({ key: "conversions", href: modules.sales ? "/sales" : "/crm/pipeline", label: "Conversions (sales)", value: "-", detail: "", rate: "" });
    } else {
      const c = s.conversions;
      const orders = modules.sales ? c.orders : 0;
      const deals = modules.pipeline ? c.deals : 0;
      const total = orders + deals;
      const revenue = (modules.sales ? c.order_revenue_minor : 0) + (modules.pipeline ? c.deal_revenue_minor : 0);
      const parts: string[] = [formatMinor(revenue, s.home_currency)];
      if (modules.sales && modules.pipeline) parts.push(`${plural(orders, "order")}, ${plural(deals, "deal")} won`);
      if (modules.sales) {
        const others = c.other.map((t) => formatMinor(t.total_minor, t.currency)).join(", ");
        if (others) parts.push(`plus ${others}`);
      }
      boxes.push({
        key: "conversions",
        href: modules.sales ? "/sales" : "/crm/pipeline",
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
