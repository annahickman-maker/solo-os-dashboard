/**
 * GET /api/crm/sales - the Sales page's data.                     owner session only
 *   ?since=<ISO time>  start of the period to total (the page sends the
 *                      start of the owner's month); default: start of this UTC month
 *   ?limit=1-200 (50)  ?offset=
 *   → { totals: [{ currency, total_minor, count }], since,
 *       orders: [{ …order, product_names, delivery }], has_more }
 *
 * Totals count paid orders by paid_at, net of partial refunds, one line per
 * currency (amounts in different currencies are never added together).
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { moneyDb } from "@/lib/money/db";
import { listWindow, selectAllIn, windowed } from "@/lib/money/db-util";
import { paidTotals } from "@/lib/money/totals";
import type { MoneyRow } from "@/types/database";

function periodStart(raw: string | null): string {
  const parsed = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const db = moneyDb();
  const since = periodStart(new URL(request.url).searchParams.get("since"));
  const { limit, offset } = listWindow(request.url);
  try {
    const paid = await selectAllIn(
      (from, to) =>
        db.from("orders").select("id, total_minor, currency, metadata").eq("status", "paid").gte("paid_at", since).order("paid_at").range(from, to),
      "paid orders"
    );
    const page = await db.from("orders").select("*").order("created_at", { ascending: false }).range(offset, offset + limit);
    if (page.error) throw new Error(`orders failed: ${page.error.message}`);
    const { rows: orders, has_more } = windowed(page.data, limit);
    const ids = orders.map((o) => o.id);

    let items: MoneyRow<"order_items">[] = [];
    let deliveries: MoneyRow<"order_deliveries">[] = [];
    let products: Array<{ id: string; name: string }> = [];
    if (ids.length) {
      items = await selectAllIn((from, to) => db.from("order_items").select("*").in("order_id", ids).range(from, to), "order items");
      const productIds = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];
      if (productIds.length) {
        const found = await db.from("products").select("id, name").in("id", productIds);
        if (found.error) throw new Error(`products failed: ${found.error.message}`);
        products = found.data || [];
      }
      // Before migration 021 there is no delivery table: show orders without it.
      const sent = await db.from("order_deliveries").select("*").in("order_id", ids);
      if (!sent.error) deliveries = sent.data || [];
    }
    const nameOf = new Map(products.map((p) => [p.id, p.name]));

    return NextResponse.json(
      {
        since,
        totals: paidTotals(paid),
        orders: orders.map((o) => ({
          ...o,
          product_names: items.filter((i) => i.order_id === o.id).map((i) => (i.product_id && nameOf.get(i.product_id)) || "Removed product"),
          delivery: deliveries.find((d) => d.order_id === o.id) ?? null,
        })),
        has_more,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
