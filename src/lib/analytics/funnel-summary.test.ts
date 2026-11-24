import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  formatRate,
  funnelBoxes,
  latestViews,
  netPaidSales,
  offerFunnelSteps,
  onSalesPage,
  parsePeriod,
  parseRange,
  periodStart,
  readFunnelInputs,
  summariseFunnel,
  type FunnelInputs,
  type OfferRef,
} from "./funnel-summary.ts";
import { paidTotals } from "../money/totals.ts";
import { formatMinor } from "../money/money.ts";
import { fakeDb } from "../money/fake-db.ts";
import type { MoneyClient } from "../money/db.ts";

const both = { sales: true, pipeline: true };
const base: FunnelInputs = {
  period: "month", since: "2026-11-01T00:00:00.000Z", home_currency: "AUD",
  content_views: 0, site_page_views: 0, funnel_starts: 0, new_contacts: 0, paid: [], won: { deals: 0, value_minor: 0 },
};
const box = (inputs: FunnelInputs, key: string, modules = both) => funnelBoxes(summariseFunnel(inputs), modules).find((b) => b.key === key)!;

test("period defaults to this month and starts at the UTC month", () => {
  assert.equal(parsePeriod(null), "month");
  assert.equal(parsePeriod("bogus"), "month");
  assert.equal(parsePeriod("7d"), "7d");
  const now = new Date("2026-11-23T10:00:00Z");
  assert.equal(periodStart("month", now).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(periodStart("7d", now).toISOString(), "2026-11-16T10:00:00.000Z");
  assert.equal(periodStart("90d", now).getTime(), now.getTime() - 90 * 86_400_000);
});

test("rates show - for a zero denominator, one decimal otherwise", () => {
  assert.equal(formatRate(0, 0), "-");
  assert.equal(formatRate(5, 0), "-");
  assert.equal(formatRate(1, 3), "33.3%");
  assert.equal(formatRate(0, 10), "0.0%");
});

test("zero data shows zeros and dashes, never Infinity or NaN", () => {
  const boxes = funnelBoxes(summariseFunnel(base), both);
  assert.deepEqual(boxes.map((b) => b.key), ["reach", "capture", "conversions"]);
  assert.equal(boxes[0].value, "0");
  assert.equal(boxes[0].detail, "0 content views · 0 site visits");
  assert.equal(boxes[1].rate, "- of reach");
  assert.equal(boxes[2].rate, "- of captured");
  assert.equal(boxes[2].rate_note, "- of reach");
  assert.doesNotMatch(JSON.stringify(boxes), /Infinity|NaN/);
});

test("content views take each target's latest snapshot only", () => {
  assert.equal(latestViews([
    { target_id: "a", captured_at: "2026-11-02T00:00:00Z", views: 100 },
    { target_id: "a", captured_at: "2026-11-05T00:00:00Z", views: 400 },
    { target_id: "b", captured_at: "2026-11-03T00:00:00Z", views: 50 },
    { target_id: "b", captured_at: "2026-11-01T00:00:00Z", views: 10 },
  ]), 450);
  assert.equal(latestViews([]), 0);
});

test("normal data: reach, capture and conversion rates", () => {
  const inputs: FunnelInputs = {
    ...base, content_views: 12_400, site_page_views: 800, funnel_starts: 30, new_contacts: 264,
    paid: [{ currency: "AUD", total_minor: 49_000, count: 10 }, { currency: "USD", total_minor: 4_000, count: 1 }],
    won: { deals: 2, value_minor: 200_000 },
  };
  const s = summariseFunnel(inputs);
  assert.equal(s.reach.total, 13_230);
  assert.equal(s.reach.site_visits, 830);
  assert.equal(s.conversions.total, 13);
  assert.equal(s.conversions.revenue_minor, 249_000);
  assert.deepEqual(s.unavailable, []);
  const reach = box(inputs, "reach"), capture = box(inputs, "capture"), conv = box(inputs, "conversions");
  assert.equal(reach.value, "13,230");
  assert.equal(reach.detail, "12,400 content views · 830 site visits");
  assert.equal(capture.rate, "2.0% of reach");
  assert.equal(conv.value, "13");
  assert.equal(conv.rate, "4.9% of captured");
  assert.equal(conv.rate_note, "0.1% of reach");
  assert.match(conv.detail, /11 orders, 2 deals won · plus /);
});

test("refunds: partial refunds net off, a full refund is not a sale", () => {
  const sales = netPaidSales([
    { total_minor: 4900, currency: "AUD", metadata: null },
    { total_minor: 4900, currency: "AUD", metadata: { refunded_minor: 900 } },
    { total_minor: 4900, currency: "AUD", metadata: { refunded_minor: 4900 } },
    { total_minor: 1000, currency: "USD", metadata: { refunded_minor: 5000 } },
  ]);
  assert.deepEqual(sales, [{ currency: "AUD", total_minor: 8900, count: 2 }]);
  const conv = box({ ...base, new_contacts: 4, paid: sales }, "conversions");
  assert.equal(conv.value, "2");
  assert.equal(conv.rate, "50.0% of captured");
  // paidTotals itself still counts every paid order (the Sales page rule).
  assert.equal(paidTotals([{ total_minor: 100, currency: "AUD", metadata: { refunded_minor: 100 } }])[0].count, 1);
});

test("missing tables count as zero and are named", () => {
  const s = summariseFunnel({ ...base, content_views: null, funnel_starts: null, paid: null, won: null, site_page_views: 20, new_contacts: 2 });
  assert.deepEqual(s.unavailable, ["content views", "funnel sessions", "paid orders", "won deals"]);
  assert.equal(s.reach.total, 20);
  assert.equal(s.conversions.total, 0);
  const boxes = funnelBoxes(s, both);
  assert.equal(boxes[1].rate, "10.0% of reach");
  assert.equal(boxes[2].rate, "0.0% of captured");
});

test("conversions count every sale, whatever modules are on", () => {
  const inputs: FunnelInputs = { ...base, new_contacts: 10, paid: [{ currency: "AUD", total_minor: 1000, count: 1 }], won: { deals: 3, value_minor: 9000 } };
  assert.deepEqual(funnelBoxes(summariseFunnel(inputs), { sales: false, pipeline: false }).map((b) => b.key), ["reach", "capture", "conversions"]);
  assert.equal(box(inputs, "conversions", { sales: true, pipeline: false }).value, "4");
  assert.equal(box(inputs, "conversions", { sales: false, pipeline: true }).value, "4");
  assert.equal(box(inputs, "conversions", { sales: false, pipeline: true }).href, "/sales");
  assert.equal(funnelBoxes(null, both)[0].value, "-");
});

test("the route is session-only and reads through the lib", () => {
  const src = readFileSync(new URL("../../app/api/analytics/funnel-summary/route.ts", import.meta.url), "utf8");
  assert.match(src, /authenticateSession\(request\)/);
  assert.doesNotMatch(src, /authenticateSessionOrApiKey/);
  assert.match(src, /readFunnelInputs\(db,/);
  assert.match(src, /parseRange\(params\.get\("from"\), params\.get\("to"\)/);
});

// ── date range and offer filter, against the fake database ─────────────────

const NOW = new Date("2026-11-23T12:00:00Z");
const RANGE = { since: "2026-10-01T00:00:00.000Z", until: NOW.toISOString() };
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const offerRef: OfferRef = { id: "course", name: "Course", product_slug: "course", sales_page_url: "https://shop.example.com/course" };

const seed = () => ({
  products: [{ id: PRODUCT_ID, slug: "course" }, { id: OTHER_ID, slug: "club" }],
  social_post_targets: [
    { id: "t1", status: "published", published_at: "2026-10-05T00:00:00Z" },
    { id: "t0", status: "published", published_at: "2026-09-05T00:00:00Z" },
  ],
  social_metrics: [
    { id: "m1", target_id: "t1", captured_at: "2026-10-06T00:00:00Z", views: 900 },
    { id: "m0", target_id: "t0", captured_at: "2026-10-06T00:00:00Z", views: 5000 },
  ],
  analytics_events: [
    { id: "e1", event_type: "page_view", created_at: "2026-10-02T00:00:00Z" },
    { id: "e2", event_type: "page_view", created_at: "2026-11-20T00:00:00Z" },
    { id: "e3", event_type: "page_view", created_at: "2026-09-30T23:59:59Z" },
    { id: "e4", event_type: "cta_click", created_at: "2026-10-02T00:00:00Z" },
  ],
  funnel_events: [
    { id: "f1", event_type: "start", funnel: "quiz", created_at: "2026-10-03T00:00:00Z" },
    { id: "f2", event_type: "start", funnel: "sales-page", created_at: "2026-10-03T00:00:00Z" },
  ],
  leads: [
    { id: "l1", created_at: "2026-10-10T00:00:00Z", source: "course", capture_page: null, interested_offers: [] },
    { id: "l2", created_at: "2026-10-11T00:00:00Z", source: "newsletter", capture_page: "https://www.shop.example.com/course/thanks", interested_offers: [] },
    { id: "l3", created_at: "2026-10-12T00:00:00Z", source: null, capture_page: null, interested_offers: [PRODUCT_ID] },
    { id: "l4", created_at: "2026-10-13T00:00:00Z", source: "newsletter", capture_page: "https://shop.example.com/blog", interested_offers: [OTHER_ID] },
    { id: "l5", created_at: "2026-09-01T00:00:00Z", source: "course", capture_page: null, interested_offers: [] },
  ],
  orders: [
    { id: "o1", status: "paid", paid_at: "2026-10-15T00:00:00Z", total_minor: 9700, currency: "AUD", metadata: {} },
    { id: "o2", status: "paid", paid_at: "2026-10-16T00:00:00Z", total_minor: 9700, currency: "AUD", metadata: { product_slug: "course", refunded_minor: 1700 } },
    { id: "o3", status: "paid", paid_at: "2026-10-17T00:00:00Z", total_minor: 9700, currency: "AUD", metadata: { product_slug: "course", refunded_minor: 9700 } },
    { id: "o4", status: "paid", paid_at: "2026-10-18T00:00:00Z", total_minor: 1999, currency: "AUD", metadata: { product_slug: "club" } },
    { id: "o5", status: "paid", paid_at: "2026-09-20T00:00:00Z", total_minor: 9700, currency: "AUD", metadata: { product_slug: "course" } },
    { id: "o6", status: "pending", paid_at: null, total_minor: 9700, currency: "AUD", metadata: { product_slug: "course" } },
  ],
  order_items: [
    { id: "i1", order_id: "o1", product_id: PRODUCT_ID },
    { id: "i4", order_id: "o4", product_id: OTHER_ID },
  ],
  opportunities: [
    { id: "d1", status: "won", won_at: "2026-10-20T00:00:00Z", value_cents: 50000, lead_id: "l1" },
    { id: "d2", status: "won", won_at: "2026-10-21T00:00:00Z", value_cents: 70000, lead_id: "l4" },
    { id: "d3", status: "won", won_at: "2026-10-22T00:00:00Z", value_cents: 30000, lead_id: "l2" },
    { id: "d4", status: "won", won_at: "2026-09-22T00:00:00Z", value_cents: 30000, lead_id: "l1" },
  ],
});

const read = (tables: ReturnType<typeof seed>, offer: OfferRef | null) =>
  readFunnelInputs(fakeDb(tables) as unknown as MoneyClient, { period: "range", ...RANGE, home_currency: "AUD", offer }).then(summariseFunnel);

test("a custom range: dates parse, cap at now, and reject nonsense", () => {
  assert.deepEqual(parseRange("2026-10-01", null, NOW), RANGE);
  assert.deepEqual(parseRange("2026-10-01", "2026-10-31", NOW), { since: RANGE.since, until: "2026-10-31T23:59:59.999Z" });
  assert.equal(parseRange("2026-10-01", "2027-01-01", NOW)?.until, NOW.toISOString());
  assert.equal(parseRange("2026-10-01T10:00:00.000Z", null, NOW)?.since, "2026-10-01T10:00:00.000Z");
  assert.equal(parseRange(null, "2026-10-01", NOW), null);
  assert.equal(parseRange("bogus", null, NOW), null);
  assert.equal(parseRange("2026-12-01", null, NOW), null);
});

test("no offer: the range bounds every source, all funnels and all contacts count", async () => {
  const s = await read(seed(), null);
  assert.equal(s.until, RANGE.until);
  assert.equal(s.reach.content_views, 900);
  assert.equal(s.reach.site_page_views, 2);
  assert.equal(s.reach.funnel_starts, 1);
  assert.equal(s.capture.total, 4);
  assert.equal(s.conversions.orders, 3);
  assert.equal(s.conversions.order_revenue_minor, 9700 + 8000 + 1999);
  assert.equal(s.conversions.deals, 3);
  assert.equal(s.offer, undefined);
  assert.deepEqual(s.unavailable, []);
});

test("offer filter: reach is the sales page plus content; capture, orders and deals follow the product", async () => {
  const s = await read(seed(), offerRef);
  assert.equal(s.reach.total, 902);
  assert.equal(s.reach.funnel_starts, 0);
  // l1 source = slug, l2 captured on the sales page, l3 names the product id; l4 does not.
  assert.equal(s.capture.total, 3);
  assert.deepEqual(s.offer, { id: "course", name: "Course", product_slug: "course", linked: true, capture_scope: "offer" });
  // o1 by order item, o2 by metadata (partly refunded); o3 refunded in full; o4 another product.
  assert.equal(s.conversions.orders, 2);
  assert.equal(s.conversions.order_revenue_minor, 9700 + 8000);
  // d1's contact has source "course"; d3's was only captured on the sales page, so it is not claimed.
  assert.equal(s.conversions.deals, 1);
  assert.equal(s.conversions.deal_revenue_minor, 50000);
});

test("offer filter: nothing offer-specific falls back to all sign-ups, labelled", async () => {
  const tables = seed();
  tables.leads = tables.leads.map((l) => ({ ...l, source: "newsletter", capture_page: null, interested_offers: [] }));
  const s = await read(tables, offerRef);
  assert.equal(s.capture.total, 4);
  assert.equal(s.offer?.capture_scope, "all");
  assert.equal(offerFunnelSteps(s, both).find((b) => b.key === "capture")!.detail, "all sign-ups");
});

test("offer filter: an offer ref with no product slug claims no conversions", async () => {
  const s = await read(seed(), { ...offerRef, product_slug: null });
  assert.equal(s.offer?.linked, false);
  assert.equal(s.conversions.total, 0);
});

test("offer steps: with an offer the boxes always count its product, 0 and $0 before any sale, never a link step", async () => {
  // The offer's own product exists but has sold nothing yet.
  const s = await read(seed(), { ...offerRef, product_slug: "offer-new" });
  const steps = offerFunnelSteps(s, both);
  assert.deepEqual(steps.map((b) => b.key), ["reach", "capture", "conversions", "revenue"]);
  const conv = steps.find((b) => b.key === "conversions")!;
  assert.equal(conv.value, "0");
  assert.notEqual(conv.rate_in, undefined);
  assert.equal(steps.find((b) => b.key === "revenue")!.value, formatMinor(0, "AUD"));
  for (const step of steps) assert.equal("link_product" in step, false);
});

test("offer steps: no focus offer (no summary) shows - in every box", () => {
  const steps = offerFunnelSteps(null, both);
  assert.deepEqual(steps.map((b) => b.value), ["-", "-", "-", "-"]);
  for (const step of steps) assert.equal("link_product" in step, false);
});

test("offer steps: rates between steps, one decimal, and revenue in the home currency", async () => {
  const s = await read(seed(), offerRef);
  const steps = offerFunnelSteps(s, both);
  assert.equal(steps[0].value, "902");
  assert.equal(steps[0].detail, "2 sales page · 900 content");
  assert.equal(steps[1].rate_in, "0.3%");
  assert.equal(steps[2].value, "3");
  assert.equal(steps[2].rate_in, "100.0%");
  assert.equal(steps[2].detail, "2 orders, 1 deal won");
  assert.equal(steps[3].value, formatMinor(17700, "AUD"));
  assert.equal(offerFunnelSteps(s, { sales: true, pipeline: false })[2].value, "3");
  const all = ["reach", "capture", "conversions", "revenue"];
  assert.deepEqual(offerFunnelSteps(s, { sales: false, pipeline: false }).map((b) => b.key), all);
  assert.deepEqual(offerFunnelSteps(s, { sales: false, pipeline: true }).map((b) => b.key), all);
  assert.deepEqual(offerFunnelSteps(null, { sales: false, pipeline: false }).map((b) => b.key), all);
  const zero = offerFunnelSteps(summariseFunnel({ ...base, offer: s.offer }), both);
  assert.equal(zero[1].rate_in, "-");
  assert.equal(zero[2].rate_in, "-");
});

test("offer filter: a failed table is zero and named, the rest still count", async () => {
  const db = fakeDb(seed());
  db.failWhen = (table) => table === "order_items";
  const s = summariseFunnel(await readFunnelInputs(db as unknown as MoneyClient, { period: "range", ...RANGE, home_currency: "AUD", offer: offerRef }));
  assert.deepEqual(s.unavailable, ["paid orders"]);
  assert.equal(s.capture.total, 3);
});

test("sales page matching: same host, the page or below it; a root URL is the whole site", () => {
  assert.equal(onSalesPage("https://shop.example.com/course?x=1", "shop.example.com/course/"), true);
  assert.equal(onSalesPage("https://shop.example.com/courses", "https://shop.example.com/course"), false);
  assert.equal(onSalesPage("https://other.example.com/course", "https://shop.example.com/course"), false);
  assert.equal(onSalesPage("https://shop.example.com/anything", "https://shop.example.com"), true);
  assert.equal(onSalesPage(null, "https://shop.example.com"), false);
  assert.equal(onSalesPage("https://shop.example.com/", ""), false);
});
