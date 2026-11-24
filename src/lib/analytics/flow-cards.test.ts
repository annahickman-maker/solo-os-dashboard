import assert from "node:assert/strict";
import test from "node:test";
import { flowCards, revenueThisMonth, stageBreakdown, stageLine, statusSentence, type FlowDashboard } from "./flow-cards.ts";
import { paidTotals } from "../money/totals.ts";

const counts = {
  total_leads: 12, new_this_week: 3, active_enrollments: 4, emails_7d: 1, open_tasks: 2,
  open_opportunities: 2, pipeline_value_cents: 0, pipeline_estimate_cents: 0,
  won_total_cents: 50_000, won_this_month_cents: 20_000, won_deals: 3, won_this_month_deals: 1,
};
const all = { leads: true, email: true, pipeline: true, sales: true };

test("paidTotals nets refunds and keeps currencies apart", () => {
  const t = paidTotals([
    { total_minor: 4900, currency: "AUD", metadata: null },
    { total_minor: 4900, currency: "AUD", metadata: { refunded_minor: 900 } },
    { total_minor: 1000, currency: "USD", metadata: { refunded_minor: 5000 } },
  ]);
  assert.deepEqual(t, [
    { currency: "AUD", total_minor: 8900, count: 2 },
    { currency: "USD", total_minor: 0, count: 1 },
  ]);
});

test("revenue adds paid orders in the home currency to deals won this month", () => {
  const d: FlowDashboard = {
    counts, home_currency: "AUD",
    paid_this_month: [{ currency: "AUD", total_minor: 9800, count: 2 }, { currency: "USD", total_minor: 4000, count: 1 }],
  };
  const r = revenueThisMonth(d);
  assert.equal(r.total_minor, 29_800);
  assert.equal(r.orders, 3);
  assert.equal(r.deals, 1);
  assert.deepEqual(r.other.map((t) => t.currency), ["USD"]);
  const card = flowCards(d, all).find((c) => c.key === "revenue")!;
  assert.equal(card.label, "Revenue this month");
  assert.match(card.sub, /^1 deal won, 3 orders paid, plus /);
});

test("a product seller with no deals still shows paid orders", () => {
  const d: FlowDashboard = {
    counts: { ...counts, won_this_month_cents: 0, won_this_month_deals: 0 },
    home_currency: "AUD", paid_this_month: [{ currency: "AUD", total_minor: 4900, count: 1 }],
  };
  assert.equal(revenueThisMonth(d).total_minor, 4900);
  assert.equal(flowCards(d, all).find((c) => c.key === "revenue")!.sub, "0 deals won, 1 order paid");
});

test("an older dashboard answer without paid orders counts won deals only", () => {
  const r = revenueThisMonth({ counts: { ...counts, won_this_month_deals: undefined } });
  assert.equal(r.total_minor, 20_000);
  assert.equal(r.currency, "AUD");
  assert.equal(r.deals, 0);
});

test("the section shows only with the Client pipeline module on", () => {
  assert.deepEqual(flowCards({ counts }, all).map((c) => c.key), ["contacts", "nurture", "pipeline", "revenue"]);
  assert.deepEqual(flowCards({ counts }, { ...all, pipeline: false }), []);
  assert.deepEqual(flowCards({ counts }, { leads: true, email: false, pipeline: true, sales: false }).map((c) => c.key), ["contacts", "pipeline", "revenue"]);
  assert.equal(flowCards(null, all)[0].value, "-");
  assert.equal(flowCards({ counts }, all)[0].label, "Contacts");
  assert.equal(flowCards({ counts }, all)[0].sub, "+3 new this week");
});

test("without Sales, revenue is won deals only", () => {
  const d: FlowDashboard = { counts, home_currency: "AUD", paid_this_month: [{ currency: "AUD", total_minor: 9800, count: 2 }] };
  const card = flowCards(d, { ...all, sales: false }).find((c) => c.key === "revenue")!;
  assert.equal(card.sub, "1 deal won");
  assert.equal(card.href, "/crm/pipeline");
  assert.match(card.value, /200/);
});

test("open deals are broken down by stage, in pipeline order", () => {
  const stages = [
    { id: "s2", name: "Call Booked", position: 2 },
    { id: "s0", name: "New", position: 0 },
    { id: "s1", name: "Nurturing", position: 1 },
  ];
  const by = stageBreakdown([{ stage_id: "s2" }, { stage_id: "s0" }, { stage_id: "s0" }, { stage_id: null }], stages);
  assert.deepEqual(by, [{ stage: "New", count: 2 }, { stage: "Call Booked", count: 1 }, { stage: "No stage", count: 1 }]);
  assert.equal(stageLine(by, 2), "New 2, Call Booked 1, +1 more");
  assert.equal(stageLine([]), "");
  const card = flowCards({ counts, open_by_stage: by }, all).find((c) => c.key === "pipeline")!;
  assert.equal(card.sub, "New 2, Call Booked 1, No stage 1");
});

test("the status sentence leaves out switched-off modules", () => {
  assert.equal(statusSentence(counts, all), "3 new contacts this week, 1 email sent in the last 7 days, 2 open tasks.");
  assert.equal(statusSentence(counts, { leads: false, email: true, pipeline: false, sales: false }), "1 email sent in the last 7 days, 2 open tasks.");
  assert.equal(statusSentence(counts, { leads: false, email: false, pipeline: true, sales: true }), "");
});

test("the dashboard route reports paid orders this month", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../app/api/crm/dashboard/route.ts", import.meta.url), "utf8");
  assert.match(src, /paid_this_month: paidThisMonth/);
  assert.match(src, /\.from\("orders"\)[^\n]*\.eq\("status", "paid"\)\.gte\("paid_at", since\)/);
  assert.match(src, /won_this_month_deals/);
  assert.match(src, /open_by_stage: openByStage/);
  assert.match(src, /stageBreakdown\(openOpps\.data/);
});
