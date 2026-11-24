/**
 * POST /api/crm/orders/deliver - { order_id }   owner session only
 *   → { delivery: { status, reason? } }
 *
 * The owner sends a paid digital order's delivery email again from the Sales
 * page: after it failed, after safe mode simulated it and the owner has gone
 * live, or when the buyer lost it. Same rules as the webhook's delivery
 * (lib/money/delivery.ts): only a paid order, never while another send holds
 * the claim, through the CRM sender so safe mode still applies.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { moneyDb } from "@/lib/money/db";
import { deliverDigitalOrder, deliverySummary } from "@/lib/money/delivery";
import { crmDeliveryDeps } from "@/lib/money/delivery-deps";
import { isUuid } from "@/lib/money/records";
import { readJson } from "@/lib/money/route-auth";

const MESSAGES: Record<string, string> = {
  not_found: "No order with that id",
  not_paid: "Only a paid order is delivered",
  not_digital: "This order has no digital product with a delivery link",
  in_progress: "A delivery for this order is being sent right now; try again in a few minutes",
};

export async function POST(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const body = await readJson(request);
  if (!isUuid(body.order_id)) return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  try {
    const outcome = await deliverDigitalOrder(moneyDb(), body.order_id, crmDeliveryDeps, { resend: true, actor: "human" });
    const delivery = deliverySummary(outcome);
    const refusal = MESSAGES[outcome.status];
    if (refusal) {
      const status = outcome.status === "not_found" ? 404 : 409;
      return NextResponse.json({ error: refusal, delivery }, { status });
    }
    return NextResponse.json({ delivery }, { status: outcome.status === "failed" || outcome.status === "no_buyer" ? 502 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
