/**
 * POST /api/offers/sync-product { rungId }                     owner session only
 *   → { product_slug, own, created, updated }
 *
 * Makes sure the offer's own Sales product exists and follows the offer's
 * name and price (src/lib/money/offer-product.ts), then answers the slug the
 * offer sells as. When the owner chose another product with "sells as", that
 * choice stands: nothing is made and its slug is answered (own: false).
 * The browser writes product_slug into the offer when it has none.
 * Idempotent: calling it again never makes a second product.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { moneyDb } from "@/lib/money/db";
import { homeCurrency } from "@/lib/money/engagements";
import { DEFAULT_CURRENCY } from "@/lib/money/money";
import { readJson } from "@/lib/money/route-auth";
import { offerProductSlug, syncOfferProduct } from "@/lib/money/offer-product";
import { readSoloDoc } from "@/lib/solo/documents";
import { normalizeOfferDoc } from "@/components/offer/types";

export async function POST(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const body = await readJson(request);
  const rungId = typeof body.rungId === "string" ? body.rungId.trim() : "";
  if (!rungId) return NextResponse.json({ error: "rungId is required" }, { status: 400 });

  try {
    const rung = normalizeOfferDoc(await readSoloDoc("offer")).rungs.find((r) => r.id === rungId);
    if (!rung) return NextResponse.json({ error: "offer not found" }, { status: 404 });

    const own = offerProductSlug(rung.id);
    if (rung.product_slug && rung.product_slug !== own) {
      return NextResponse.json({ product_slug: rung.product_slug, own: false, created: false, updated: false });
    }

    const db = moneyDb();
    const currency = await homeCurrency(db).catch(() => DEFAULT_CURRENCY);
    const synced = await syncOfferProduct(db, rung, currency);
    return NextResponse.json({ product_slug: synced.slug, own: true, created: synced.created, updated: synced.updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
