/**
 * Paid order totals, shared by the Sales page (GET /api/crm/sales) and the
 * dashboard (GET /api/crm/dashboard) and the analytics funnel boxes
 * (GET /api/analytics/funnel-summary). Pure: no database access.
 *
 * Each paid order counts its total net of partial refunds
 * (metadata.refunded_minor), one line per currency: amounts in different
 * currencies are never added together.
 */
import type { Json } from "../../types/database.ts";
import { metaOf } from "./db-util.ts";

export type PaidTotal = { currency: string; total_minor: number; count: number };

export function paidTotals(orders: Array<{ total_minor: number; currency: string; metadata: Json | null }>): PaidTotal[] {
  const byCurrency = new Map<string, PaidTotal>();
  for (const o of orders) {
    const refunded = Number(metaOf(o.metadata).refunded_minor) || 0;
    const line = byCurrency.get(o.currency) ?? { currency: o.currency, total_minor: 0, count: 0 };
    line.total_minor += Math.max(0, o.total_minor - refunded);
    line.count += 1;
    byCurrency.set(o.currency, line);
  }
  return [...byCurrency.values()];
}
