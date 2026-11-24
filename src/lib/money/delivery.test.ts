import assert from "node:assert/strict";
import test from "node:test";
import { createWebhookStore } from "./apply.ts";
import type { MoneyClient } from "./db.ts";
import { deliverDigitalOrder, deliveryEmail, type DeliveryDeps, type DeliveryEmail, type DeliverySendResult } from "./delivery.ts";
import type { MoneyDeps } from "./deps.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";
import { checkProduct } from "./records.ts";
import { signPayload } from "./stripe-signature.ts";
import { handleStripeWebhook } from "./webhook.ts";

// Fabricated: not real secrets, addresses or links.
const SECRET = "whsec_fabricated_for_tests";
const NOW = 1_761_500_000;
const ORDER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const LINK = "https://files.example.com/private/guide.pdf";

type Row = Record<string, unknown>;

const digital = (over: Row = {}): Row => ({
  id: PRODUCT, slug: "the-guide", name: "The Guide", kind: "digital", amount_minor: 2900, currency: "AUD", delivery_url: LINK, active: true, ...over,
});
const pendingOrder = (over: Row = {}): Row => ({
  id: ORDER, email: null, lead_id: null, status: "pending", total_minor: 2900, currency: "AUD",
  stripe_checkout_session_id: "cs_1", stripe_payment_intent_id: null, stripe_subscription_id: null, metadata: {}, ...over,
});
const checkout = (id = "evt_paid_1"): Row => ({
  id, type: "checkout.session.completed", created: NOW, livemode: true,
  data: { object: {
    id: "cs_1", payment_status: "paid", amount_total: 2900, currency: "aud", payment_intent: "pi_1",
    customer_details: { email: "Bea@Example.com", name: "Bea Buyer" }, metadata: { order_id: ORDER },
  } },
});

/** A fake transport standing in for lib/crm/email.ts: records an email_sends row like the real sender, sends nothing. */
function transport(db: FakeDb, answer: () => DeliverySendResult["status"] = () => "sent") {
  const sent: DeliveryEmail[] = [];
  const deps: DeliveryDeps = {
    now: () => clock.now,
    async send(_db, email) {
      sent.push(email);
      const status = answer();
      if (status === "failed") return { status, error: "provider said no" };
      const { data } = await db.from("email_sends").insert({ lead_id: email.lead.id, subject: email.subject, status }).select("id").single();
      return { status, sendId: (data as Row).id as string };
    },
  };
  return { sent, deps };
}

const clock = { now: new Date(NOW * 1000) };

function home(seed: Record<string, Row[]> = {}, answer?: () => DeliverySendResult["status"]) {
  clock.now = new Date(NOW * 1000);
  const db = fakeDb({
    products: [digital()],
    orders: [pendingOrder()],
    order_items: [{ order_id: ORDER, product_id: PRODUCT, quantity: 1, amount_minor: 2900 }],
    ...seed,
  });
  const mail = transport(db, answer);
  const deps: MoneyDeps = {
    async upsertLead(_db, input) {
      const { data } = await db.from("leads").insert({ email: input.email, first_name: input.name ?? null, email_status: "subscribed" }).select("*").single();
      return { lead: data as never, created: true };
    },
    async fireTrigger() { return []; },
    async enrollLead() { return { enrolled: true }; },
    deliver: (client, orderId) => deliverDigitalOrder(client, orderId, mail.deps),
    stripe: { env: {} },
  };
  const store = createWebhookStore(db as unknown as MoneyClient, deps, { now: () => new Date(NOW * 1000) });
  const send = (event: Row) => {
    const rawBody = JSON.stringify(event);
    return handleStripeWebhook({ rawBody, signatureHeader: signPayload(SECRET, rawBody, NOW), secret: SECRET, nowSeconds: NOW }, store);
  };
  const deliver = (opts: { resend?: boolean } = {}) => deliverDigitalOrder(db as unknown as MoneyClient, ORDER, mail.deps, opts);
  return { db, send, deliver, sent: mail.sent };
}

test("a paid digital order emails its link once, recorded on the order and in email_sends", async () => {
  const h = home();
  const out = await h.send(checkout());
  assert.equal(out.status, 200);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].bodyMd, /files\.example\.com\/private\/guide\.pdf/);
  assert.equal(h.sent[0].subject, "Your The Guide is ready");
  assert.equal(h.sent[0].lead.email, "bea@example.com");
  const [row] = h.db.rows("order_deliveries");
  assert.equal(row.status, "sent");
  assert.equal(row.attempts, 1);
  assert.equal(row.email_send_id, h.db.rows("email_sends")[0].id);
  assert.equal(row.claimed_at, null);
  assert.ok(row.delivered_at);
  if (out.status === 200) assert.deepEqual(out.body.result?.delivery, { status: "sent" });
});

test("a redelivered event, and a retry after a failure late in the webhook, never email twice", async () => {
  const h = home();
  // Fail the webhook's "finish" write (the second payment_events update, after the claim), so Stripe retries.
  let updates = 0;
  h.db.failWhen = (table, op) => table === "payment_events" && op === "update" && ++updates === 2;
  const first = await h.send(checkout());
  assert.equal(first.status, 500);
  assert.equal(h.sent.length, 1, "delivered before the failure");
  h.db.failWhen = null;

  const retry = await h.send(checkout());
  assert.equal(retry.status, 200);
  if (retry.status === 200) assert.equal(retry.body.result?.delivery?.status, "already");
  const replay = await h.send(checkout());
  assert.equal(replay.status, 200);
  if (replay.status === 200) assert.equal(replay.body.duplicate, true);
  // A second, different event for the same session (async_payment_succeeded) is settled and sends nothing.
  const other = await h.send({ ...checkout("evt_paid_2"), type: "checkout.session.async_payment_succeeded" });
  assert.equal(other.status, 200);
  assert.equal(h.sent.length, 1);
  assert.equal(h.db.rows("order_deliveries").length, 1);
});

test("two deliveries racing: one sends, the other finds the claim", async () => {
  const h = home({ orders: [pendingOrder({ status: "paid", lead_id: "lead-1", email: "bea@example.com" })], leads: [{ id: "lead-1", email: "bea@example.com" }] });
  const [a, b] = await Promise.all([h.deliver(), h.deliver()]);
  assert.deepEqual([a.status, b.status].sort(), ["in_progress", "sent"]);
  assert.equal(h.sent.length, 1);
});

test("safe mode: the delivery is recorded as simulated; the owner sends it again once live", async () => {
  let mode: DeliverySendResult["status"] = "simulated";
  const h = home({}, () => mode);
  await h.send(checkout());
  assert.equal(h.db.rows("order_deliveries")[0].status, "simulated");
  assert.equal((await h.deliver()).status, "already", "the webhook path never repeats a simulated send");

  mode = "sent";
  const again = await h.deliver({ resend: true });
  assert.equal(again.status, "sent");
  assert.equal(h.sent.length, 2);
  const [row] = h.db.rows("order_deliveries");
  assert.equal(row.status, "sent");
  assert.equal(row.attempts, 2);
});

test("a failed send never fails the payment: marked failed, on the timeline, and can be sent again", async () => {
  let mode: DeliverySendResult["status"] = "failed";
  const h = home({}, () => mode);
  const out = await h.send(checkout());
  assert.equal(out.status, 200);
  assert.equal(h.db.rows("orders")[0].status, "paid");
  const [row] = h.db.rows("order_deliveries");
  assert.equal(row.status, "failed");
  assert.equal(row.error, "provider said no");
  assert.equal(h.db.rows("lead_activities").filter((a) => a.activity_type === "delivery_failed").length, 1);

  mode = "sent";
  assert.equal((await h.deliver({ resend: true })).status, "sent");
  assert.equal(h.db.rows("order_deliveries")[0].status, "sent");
});

test("a claim left by a delivery that died is taken over after five minutes, not before", async () => {
  const h = home({
    orders: [pendingOrder({ status: "paid", lead_id: "lead-1", email: "bea@example.com" })],
    leads: [{ id: "lead-1", email: "bea@example.com" }],
    order_deliveries: [{ order_id: ORDER, status: "sending", attempts: 1, claimed_at: new Date(NOW * 1000 - 60_000).toISOString() }],
  });
  assert.equal((await h.deliver({ resend: true })).status, "in_progress");
  assert.equal(h.sent.length, 0);
  clock.now = new Date(NOW * 1000 + 5 * 60_000);
  assert.equal((await h.deliver()).status, "sent");
  assert.equal(h.db.rows("order_deliveries")[0].attempts, 2);
});

test("only a paid digital order delivers: pending, refunded and non-digital orders send nothing", async () => {
  const pending = home();
  assert.equal((await pending.deliver({ resend: true })).status, "not_paid");

  const refunded = home({ orders: [pendingOrder({ status: "refunded", lead_id: "lead-1" })], leads: [{ id: "lead-1", email: "bea@example.com" }] });
  assert.equal((await refunded.deliver({ resend: true })).status, "not_paid");

  const plain = home({ products: [digital({ kind: "one_time", delivery_url: null })] });
  const out = await plain.send(checkout());
  assert.equal(out.status, 200);
  if (out.status === 200) assert.equal(out.body.result?.delivery, undefined);
  for (const h of [pending, refunded, plain]) {
    assert.equal(h.sent.length, 0);
    assert.equal(h.db.rows("order_deliveries").length, 0);
  }
});

test("a paid order with no customer email is marked failed, not sent", async () => {
  const h = home({ orders: [pendingOrder({ status: "paid" })] });
  const out = await h.deliver();
  assert.equal(out.status, "no_buyer");
  assert.equal(h.db.rows("order_deliveries")[0].status, "failed");
  assert.equal(h.sent.length, 0);
});

test("a database error while claiming throws, so the webhook is retried", async () => {
  const h = home({ orders: [pendingOrder({ status: "paid", lead_id: "lead-1" })], leads: [{ id: "lead-1", email: "bea@example.com" }] });
  h.db.failWhen = (table, op) => table === "order_deliveries" && op === "insert";
  await assert.rejects(h.deliver(), /order_deliveries claim failed/);
  assert.equal(h.sent.length, 0);
});

test("the owner's Digital delivery template is used, and the link is added if the template leaves it out", async () => {
  const db = fakeDb({
    email_templates: [{ id: "tpl-1", name: "Digital delivery", subject: "Here is {{product_name}}", body_md: "Hi {{first_name|there}}, enjoy {{product_name}}.", preheader: null, created_at: "2026-01-01" }],
  });
  const email = await deliveryEmail(db as unknown as MoneyClient, [digital() as never]);
  assert.equal(email.subject, "Here is The Guide");
  assert.equal(email.templateId, "tpl-1");
  assert.match(email.bodyMd, /^Hi \{\{first_name\|there\}\}, enjoy The Guide\./);
  assert.ok(email.bodyMd.includes(`[The Guide](${LINK})`));

  const withLink = fakeDb({
    email_templates: [{ id: "tpl-2", name: "Digital delivery", subject: "S", body_md: "Get it: {{delivery_url}}", preheader: null, created_at: "2026-01-01" }],
  });
  const filled = await deliveryEmail(withLink as unknown as MoneyClient, [digital() as never]);
  assert.equal(filled.bodyMd, `Get it: ${LINK}`);
});

test("a digital product needs an https delivery link; other kinds cannot carry one", () => {
  const base = { name: "The Guide", amount_minor: 2900, currency: "AUD" };
  assert.match((checkProduct({ ...base, kind: "digital" }) as { error: string }).error, /needs a delivery_url/);
  assert.match((checkProduct({ ...base, kind: "digital", delivery_url: "http://files.example.com/x" }) as { error: string }).error, /https/);
  assert.match((checkProduct({ ...base, kind: "digital", delivery_url: "javascript:alert(1)" }) as { error: string }).error, /https/);
  const ok = checkProduct({ ...base, kind: "digital", delivery_url: LINK });
  assert.ok(ok.ok && ok.value.delivery_url === LINK && ok.value.interval === null);
  assert.match((checkProduct({ ...base, kind: "one_time", delivery_url: LINK }) as { error: string }).error, /only a digital product/);
  // Changing a digital product to another kind drops its link.
  if (!ok.ok) throw new Error("unreachable");
  const changed = checkProduct({ kind: "one_time" }, ok.value);
  assert.ok(changed.ok && changed.value.delivery_url === null);
});
