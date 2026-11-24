import assert from "node:assert/strict";
import test from "node:test";
import {
  offerProductChanges,
  offerProductFields,
  offerProductSlug,
  offerSalesSlug,
  recurringInterval,
  syncOfferProduct,
  type OfferProductRung,
} from "./offer-product.ts";
import { fakeDb } from "./fake-db.ts";
import type { MoneyClient } from "./db.ts";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const rung = (p: Partial<OfferProductRung> = {}): OfferProductRung => ({
  id: "offer-lx3k2-ab12cd34", name: "Starter course", price_label: "$47", goal_price_label: "", ...p,
});
const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as MoneyClient;

test("slug: stable, derived from the offer id, always a valid slug", () => {
  assert.equal(offerProductSlug("offer-lx3k2-ab12cd34"), "offer-lx3k2-ab12cd34");
  assert.equal(offerProductSlug("offer-lx3k2-ab12cd34"), offerProductSlug("offer-lx3k2-ab12cd34"));
  assert.equal(offerProductSlug("Rung_1"), "offer-rung-1");
  assert.notEqual(offerProductSlug("a"), offerProductSlug("b"));
  for (const id of ["offer-x", "Rung_1", "###", "é", "x".repeat(200), "a--b--"]) {
    const slug = offerProductSlug(id);
    assert.match(slug, SLUG_RE, id);
    assert.ok(slug.startsWith("offer-") && slug.length <= 60, id);
  }
});

test("sales slug: the owner's choice when set, else the offer's own", () => {
  assert.equal(offerSalesSlug({ id: "offer-a1", product_slug: null }), "offer-a1");
  assert.equal(offerSalesSlug({ id: "offer-a1", product_slug: " coaching " }), "coaching");
});

test("fields: name and price follow the offer; one_time unless the price repeats", () => {
  const f = offerProductFields(rung(), "AUD");
  assert.equal(f.slug, "offer-lx3k2-ab12cd34");
  assert.equal(f.name, "Starter course");
  assert.equal(f.amount_minor, 4700);
  assert.equal(f.currency, "AUD");
  assert.equal(f.kind, "one_time");
  assert.equal(f.interval, null);
  assert.equal(f.active, true);
  assert.deepEqual(f.metadata, { offer_id: "offer-lx3k2-ab12cd34" });

  const sub = offerProductFields(rung({ price_label: "$29/mo", goal_price_label: "$49.50/mo" }), "USD");
  assert.equal(sub.amount_minor, 4950);
  assert.equal(sub.kind, "subscription");
  assert.equal(sub.interval, "month");
  assert.equal(offerProductFields(rung({ price_label: "¥5,000" }), "JPY").amount_minor, 5000);
  assert.equal(offerProductFields(rung({ name: "  ", price_label: "" }), "AUD").name, "Untitled offer");
  assert.equal(offerProductFields(rung({ price_label: "" }), "AUD").amount_minor, 0);
  assert.equal(recurringInterval("$470/yr"), "year");
  assert.equal(recurringInterval("97 per month"), "month");
  assert.equal(recurringInterval("$1,200 one-off"), null);
  assert.equal(recurringInterval("$500 for 3 months"), null);
});

test("sync: creates once, then is idempotent on the slug", async () => {
  const db = fakeDb();
  const first = await syncOfferProduct(asDb(db), rung(), "AUD");
  assert.equal(first.created, true);
  assert.equal(first.slug, "offer-lx3k2-ab12cd34");
  const again = await syncOfferProduct(asDb(db), rung(), "AUD");
  assert.deepEqual([again.created, again.updated, again.product_id], [false, false, first.product_id]);
  assert.equal(db.rows("products").length, 1);
  assert.equal(db.calls.filter((c) => c === "update products").length, 0);
});

test("sync: a rename or new price updates the same product", async () => {
  const db = fakeDb();
  const first = await syncOfferProduct(asDb(db), rung(), "AUD");
  const next = await syncOfferProduct(asDb(db), rung({ name: "Starter course 2", price_label: "$97/mo" }), "AUD");
  assert.deepEqual([next.created, next.updated, next.product_id], [false, true, first.product_id]);
  const [p] = db.rows("products");
  assert.equal(db.rows("products").length, 1);
  assert.deepEqual([p.name, p.amount_minor, p.kind, p.interval], ["Starter course 2", 9700, "subscription", "month"]);
});

test("sync: an insert that races another finds the row and does not duplicate", async () => {
  const db = fakeDb();
  let raced = false;
  db.beforeCall = (table, op) => {
    if (table === "products" && op === "insert" && !raced) {
      raced = true;
      db.rows("products").push({ id: "p-other", ...offerProductFields(rung({ name: "Old name" }), "AUD") });
    }
  };
  const r = await syncOfferProduct(asDb(db), rung(), "AUD");
  assert.deepEqual([r.created, r.updated, r.product_id], [false, true, "p-other"]);
  assert.equal(db.rows("products").length, 1);
  assert.equal(db.rows("products")[0].name, "Starter course");
});

test("sync: what the owner set on the product stands", async () => {
  const own = offerProductFields(rung(), "AUD");
  const db = fakeDb({
    products: [{ id: "p1", ...own, currency: "USD", active: false, kind: "digital", delivery_url: "https://files.example.com/x", stripe_price_id: null }],
  });
  await syncOfferProduct(asDb(db), rung({ price_label: "$59/mo" }), "AUD");
  const [p] = db.rows("products");
  assert.deepEqual([p.kind, p.interval, p.currency, p.active, p.amount_minor], ["digital", null, "USD", false, 5900]);

  const priced = fakeDb({ products: [{ id: "p2", ...own, stripe_price_id: "price_123" }] });
  await syncOfferProduct(asDb(priced), rung({ name: "Renamed", price_label: "$99" }), "AUD");
  const [q] = priced.rows("products");
  assert.deepEqual([q.name, q.amount_minor], ["Renamed", 4700]);
});

test("sync: a failed read throws instead of creating a second product", async () => {
  const db = fakeDb();
  db.failWhen = (table, op) => table === "products" && op === "select";
  await assert.rejects(syncOfferProduct(asDb(db), rung(), "AUD"), /product lookup failed/);
  assert.equal(db.rows("products").length, 0);
});

test("an unpriced offer's product stays hidden until it gets a price", () => {
  const free = offerProductFields(rung({ price_label: "", goal_price_label: "" }), "AUD");
  assert.equal(free.amount_minor, 0);
  assert.equal(free.active, false);
  const want = offerProductFields(rung(), "AUD");
  const changes = offerProductChanges({ id: "p", ...free, stripe_price_id: null }, want);
  assert.equal(changes.active, true);
  assert.equal(changes.amount_minor, 4700);
});
