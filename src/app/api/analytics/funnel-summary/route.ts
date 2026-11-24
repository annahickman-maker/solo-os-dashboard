/**
 * GET /api/analytics/funnel-summary - the funnel boxes: Reach, Capture,
 * Conversions. Session only.
 *   ?period=7d|30d|month|90d   default this month (UTC), as on /crm/analytics
 *   ?from=&to=                 a custom range instead (ISO times or YYYY-MM-DD; to defaults to now)
 *   ?offer=<offer id>          narrow to one offer of the `offer` document (/focus)
 * The counting rules and the reads live in src/lib/analytics/funnel-summary.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { homeCurrency } from "@/lib/money/engagements";
import { DEFAULT_CURRENCY } from "@/lib/money/money";
import { readSoloDoc } from "@/lib/solo/documents";
import { normalizeOfferDoc } from "@/components/offer/types";
import { offerSalesSlug } from "@/lib/money/offer-product";
import { parsePeriod, parseRange, periodStart, readFunnelInputs, summariseFunnel, type OfferRef } from "@/lib/analytics/funnel-summary";

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const db = createAdminClient();
  const params = request.nextUrl.searchParams;
  const now = new Date();
  const range = parseRange(params.get("from"), params.get("to"), now);
  if (params.get("from") && !range) return NextResponse.json({ error: "from/to is not a valid range" }, { status: 400 });
  const period = range ? "range" : parsePeriod(params.get("period"));
  const since = range ? range.since : periodStart(parsePeriod(params.get("period")), now).toISOString();
  const until = range ? range.until : now.toISOString();

  let offer: OfferRef | null = null;
  const offerId = params.get("offer");
  if (offerId) {
    const rung = normalizeOfferDoc(await readSoloDoc("offer").catch(() => null)).rungs.find((r) => r.id === offerId);
    if (!rung) return NextResponse.json({ error: "offer not found" }, { status: 404 });
    // Every offer sells as a product: the owner's "sells as" choice, else its own (made by
    // POST /api/offers/sync-product). Before that product exists its orders count as 0.
    offer = { id: rung.id, name: rung.name, product_slug: offerSalesSlug(rung), sales_page_url: rung.sales_page_url };
  }

  const home_currency = await homeCurrency(db).catch(() => DEFAULT_CURRENCY);
  const inputs = await readFunnelInputs(db, { period, since, until, home_currency, offer });
  return NextResponse.json(summariseFunnel(inputs), { headers: { "Cache-Control": "no-store" } });
}
