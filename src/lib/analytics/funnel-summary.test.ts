import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  formatRate,
  funnelBoxes,
  latestViews,
  netPaidSales,
  parsePeriod,
  periodStart,
  summariseFunnel,
  type FunnelInputs,
} from "./funnel-summary.ts";
import { paidTotals } from "../money/totals.ts";

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

test("conversions follow the Sales and Pipeline modules", () => {
  const inputs: FunnelInputs = { ...base, new_contacts: 10, paid: [{ currency: "AUD", total_minor: 1000, count: 1 }], won: { deals: 3, value_minor: 9000 } };
  assert.deepEqual(funnelBoxes(summariseFunnel(inputs), { sales: false, pipeline: false }).map((b) => b.key), ["reach", "capture"]);
  assert.equal(box(inputs, "conversions", { sales: true, pipeline: false }).value, "1");
  assert.equal(box(inputs, "conversions", { sales: false, pipeline: true }).value, "3");
  assert.equal(box(inputs, "conversions", { sales: false, pipeline: true }).href, "/crm/pipeline");
  assert.equal(funnelBoxes(null, both)[0].value, "-");
});

test("the route is session-only and reads each source", () => {
  const src = readFileSync(new URL("../../app/api/analytics/funnel-summary/route.ts", import.meta.url), "utf8");
  assert.match(src, /authenticateSession\(request\)/);
  assert.doesNotMatch(src, /authenticateSessionOrApiKey/);
  for (const table of ["social_post_targets", "social_metrics", "analytics_events", "funnel_events", "leads", "orders", "opportunities"]) {
    assert.match(src, new RegExp(`from\\("${table}"\\)`));
  }
  assert.match(src, /\.eq\("event_type", "page_view"\)/);
  assert.match(src, /\.eq\("status", "paid"\)\.gte\("paid_at", since\)/);
});
