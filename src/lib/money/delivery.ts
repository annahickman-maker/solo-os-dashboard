/**
 * Digital delivery: when an order for a digital product is paid, the buyer is
 * emailed its delivery_url, once.
 *
 * Called by the Stripe webhook (./apply.ts, after checkout.session.completed
 * marks the order paid) and by the owner's "send again" on the Sales page.
 *
 * Rules it keeps:
 * - One delivery per order. order_deliveries is keyed by the order, and the
 *   insert of that row is the claim: a retried webhook, or two deliveries
 *   racing, find the row and send nothing. A claim older than five minutes
 *   belongs to a delivery that died and may be taken over.
 * - The email goes through the CRM's own sender (lib/crm/email.ts, passed in
 *   as `send`), so it obeys safe mode (simulated until the owner goes live),
 *   suppresses bounced and complained addresses, and is recorded in
 *   email_sends and on the lead's timeline.
 * - A failed send never fails the payment: the row is marked failed, the
 *   timeline says so, and the owner can send it again. Database errors throw,
 *   so the webhook is retried and resumes here.
 * - Only a paid order delivers. A refunded or void order never does, even on
 *   the owner's resend.
 *
 * Relative imports only, so the tests run it against the fake client.
 */

import type { Json, MoneyRow } from "../../types/database.ts";
import type { Lead } from "../crm/types.ts";
import type { MoneyClient } from "./db.ts";
import { must } from "./db-util.ts";
import { DIGITAL_KIND } from "./records.ts";

type Delivery = MoneyRow<"order_deliveries">;
type Product = MoneyRow<"products">;

const CLAIM_TIMEOUT_MS = 5 * 60_000;
const DONE = ["sent", "simulated", "suppressed"] as const;

/** The name of an optional email template the owner can edit to change the delivery email. */
export const DELIVERY_TEMPLATE = "Digital delivery";

export interface DeliveryEmail {
  lead: Lead;
  subject: string;
  bodyMd: string;
  preheader: string | null;
  templateId: string | null;
  actor: string;
}

export interface DeliverySendResult {
  status: "sent" | "simulated" | "suppressed" | "failed";
  sendId?: string;
  error?: string;
}

export interface DeliveryDeps {
  /** lib/crm/email.ts sendCrmEmail as a transactional send (tests pass a fake transport). */
  send(db: MoneyClient, email: DeliveryEmail): Promise<DeliverySendResult>;
  now?: () => Date;
}

export type DeliveryOutcome =
  | { status: "not_found" | "not_paid" | "not_digital" }
  | { status: "already"; delivery: Delivery }
  | { status: "in_progress" }
  | { status: "no_buyer"; error: string }
  | { status: DeliverySendResult["status"]; sendId: string | null; error?: string };

/** Short form for the webhook result and the owner. */
export function deliverySummary(outcome: DeliveryOutcome): { status: string; reason?: string } {
  if (outcome.status === "already") return { status: "already", reason: `already ${outcome.delivery.status}` };
  if ("error" in outcome && outcome.error) return { status: outcome.status, reason: outcome.error };
  return { status: outcome.status };
}

/** The digital products on an order, with their delivery links. */
async function digitalProducts(db: MoneyClient, orderId: string): Promise<Product[]> {
  const items = must(await db.from("order_items").select("product_id").eq("order_id", orderId), "order items") || [];
  const ids = [...new Set(items.map((i) => i.product_id).filter((id): id is string => typeof id === "string"))];
  if (ids.length === 0) return [];
  const products = must(await db.from("products").select("*").in("id", ids), "order products") || [];
  return products.filter((p) => p.kind === DIGITAL_KIND && typeof p.delivery_url === "string" && p.delivery_url);
}

/**
 * Takes the order's delivery for this attempt. False when it is done (and
 * this is not an owner resend) or another attempt holds a fresh claim.
 */
async function claim(
  db: MoneyClient,
  order: MoneyRow<"orders">,
  at: Date,
  resend: boolean
): Promise<{ ok: true; attempts: number } | { ok: false; outcome: DeliveryOutcome }> {
  const inserted = await db.from("order_deliveries").insert({
    order_id: order.id,
    lead_id: order.lead_id,
    email: order.email,
    status: "sending",
    attempts: 1,
    claimed_at: at.toISOString(),
  });
  if (!inserted.error) return { ok: true, attempts: 1 };
  if (inserted.error.code !== "23505") throw new Error(`order_deliveries claim failed: ${inserted.error.message}`);

  const row = must(await db.from("order_deliveries").select("*").eq("order_id", order.id).maybeSingle(), "delivery lookup");
  if (!row) throw new Error("order_deliveries claim clashed but no row was found");
  if ((DONE as readonly string[]).includes(row.status) && !resend) return { ok: false, outcome: { status: "already", delivery: row } };
  if (row.status === "sending") {
    const claimedAt = row.claimed_at ? Date.parse(row.claimed_at) : 0;
    if (at.getTime() - claimedAt < CLAIM_TIMEOUT_MS) return { ok: false, outcome: { status: "in_progress" } };
  }
  // Take it over only where it is still what was read: whoever moves it first wins.
  const taken = must(
    await db
      .from("order_deliveries")
      .update({ status: "sending", attempts: row.attempts + 1, claimed_at: at.toISOString(), error: null })
      .eq("order_id", order.id)
      .eq("status", row.status)
      .eq("attempts", row.attempts)
      .select("order_id"),
    "delivery reclaim"
  );
  if (!taken || taken.length === 0) return { ok: false, outcome: { status: "in_progress" } };
  return { ok: true, attempts: row.attempts + 1 };
}

/** Product links as markdown, one per product. */
export function deliveryLinks(products: Array<{ name: string; delivery_url: string | null }>): string {
  return products
    .filter((p) => p.delivery_url)
    .map((p) => `[${p.name.replace(/[[\]]/g, "")}](${(p.delivery_url as string).replace(/\(/g, "%28").replace(/\)/g, "%29")})`)
    .join("\n\n");
}

function fillProductTags(text: string, values: { product_name: string; delivery_url: string; delivery_links: string }): string {
  return text.replace(/\{\{\s*(product_name|delivery_url|delivery_links)\s*(?:\|[^}]*)?\}\}/g, (_m, key: keyof typeof values) => values[key]);
}

/**
 * The email: the owner's "Digital delivery" template when there is one
 * ({{product_name}}, {{delivery_url}}, {{delivery_links}} plus every lead
 * merge tag), else plain default copy. The link is always in it: a template
 * that leaves it out gets the links appended.
 */
export async function deliveryEmail(
  db: MoneyClient,
  products: Product[]
): Promise<{ subject: string; bodyMd: string; preheader: string | null; templateId: string | null }> {
  const names = products.map((p) => p.name);
  const productName = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const links = deliveryLinks(products);
  const values = { product_name: productName, delivery_url: products[0].delivery_url as string, delivery_links: links };

  const rows = must(
    await db.from("email_templates").select("id, subject, body_md, preheader").eq("name", DELIVERY_TEMPLATE).order("created_at", { ascending: true }).limit(1),
    "delivery template"
  ) as Array<{ id: string; subject: string; body_md: string; preheader: string | null }> | null;
  const template = rows?.[0];
  if (template) {
    let bodyMd = fillProductTags(template.body_md, values);
    if (!products.every((p) => bodyMd.includes(p.delivery_url as string) || bodyMd.includes(links))) bodyMd += `\n\n${links}`;
    return {
      subject: fillProductTags(template.subject, values),
      bodyMd,
      preheader: template.preheader ? fillProductTags(template.preheader, values) : null,
      templateId: template.id,
    };
  }
  return {
    subject: `Your ${productName} is ready`,
    bodyMd: [
      "Hi {{first_name|there}},",
      `Thank you for your purchase. Here is your ${productName}:`,
      links,
      "Keep this email so you can come back to it. If the link does not work, reply and we will sort it out.",
    ].join("\n\n"),
    preheader: `Your ${productName} is ready`,
    templateId: null,
  };
}

/**
 * Delivers a paid digital order, once. `resend` is the owner asking again
 * from the Sales page (allowed for a delivery that is already done, never for
 * one in progress).
 */
export async function deliverDigitalOrder(
  db: MoneyClient,
  orderId: string,
  deps: DeliveryDeps,
  opts: { resend?: boolean; actor?: string } = {}
): Promise<DeliveryOutcome> {
  const at = deps.now ? deps.now() : new Date();
  const actor = opts.actor ?? "stripe";
  const order = must(await db.from("orders").select("*").eq("id", orderId).maybeSingle(), "order lookup");
  if (!order) return { status: "not_found" };
  if (order.status !== "paid") return { status: "not_paid" };
  const products = await digitalProducts(db, order.id);
  if (products.length === 0) return { status: "not_digital" };

  const claimed = await claim(db, order, at, !!opts.resend);
  if (!claimed.ok) return claimed.outcome;

  const finish = async (patch: Partial<Delivery>) => {
    must(await db.from("order_deliveries").update({ ...patch, claimed_at: null }).eq("order_id", order.id), "delivery finish");
  };

  const lead = order.lead_id
    ? (must(await db.from("leads").select("*").eq("id", order.lead_id).maybeSingle(), "lead lookup") as Lead | null)
    : null;
  if (!lead || !lead.email) {
    const error = "the order has no customer with an email address";
    await finish({ status: "failed", error });
    return { status: "no_buyer", error };
  }

  const email = await deliveryEmail(db, products);
  let result: DeliverySendResult;
  try {
    result = await deps.send(db, { lead, ...email, actor });
  } catch (e) {
    result = { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }

  const delivered = result.status === "sent" || result.status === "simulated";
  await finish({
    status: result.status,
    lead_id: lead.id,
    email: lead.email,
    email_send_id: result.sendId ?? null,
    error: result.status === "failed" ? result.error || "send failed" : result.status === "suppressed" ? "the address is suppressed (bounced, complained or tagged)" : null,
    delivered_at: delivered ? at.toISOString() : null,
  });

  // The CRM sender already wrote "email sent" on the timeline; a failure or
  // a suppression is said here, so the owner sees the buyer has nothing yet.
  if (!delivered) {
    must(
      await db.from("lead_activities").insert({
        lead_id: lead.id,
        activity_type: "delivery_failed",
        title: `Digital delivery not sent: ${result.status === "suppressed" ? "address suppressed" : result.error || "send failed"}`,
        data: { order_id: order.id, products: products.map((p) => p.slug), attempt: claimed.attempts } as Json,
        actor,
      }),
      "timeline insert"
    );
  }
  return { status: result.status, sendId: result.sendId ?? null, ...(result.error ? { error: result.error } : {}) };
}
