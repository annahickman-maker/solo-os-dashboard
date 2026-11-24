/**
 * GET /api/analytics/funnel-summary?period=7d|30d|month|90d - the three
 * funnel boxes at the top of /crm/analytics (Reach, Capture, Conversions).
 * Session only. Default period: this month (UTC). The counting rules live
 * in src/lib/analytics/funnel-summary.ts.
 *
 * Each source is read on its own: a missing table or failed read becomes
 * null, which the summary counts as 0 and names in `unavailable`.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { selectAllIn } from "@/lib/money/db-util";
import { homeCurrency } from "@/lib/money/engagements";
import { DEFAULT_CURRENCY } from "@/lib/money/money";
import { latestViews, netPaidSales, parsePeriod, periodStart, summariseFunnel, type MetricSnapshot } from "@/lib/analytics/funnel-summary";

const IN_CHUNK = 200;

async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

function headCount(result: { count: number | null; error: { message: string } | null }, what: string): number {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.count ?? 0;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const db = createAdminClient();
  const period = parsePeriod(request.nextUrl.searchParams.get("period"));
  const now = new Date();
  const since = periodStart(period, now).toISOString();
  const until = now.toISOString();

  const contentViews = orNull(async () => {
    const targets = await selectAllIn(
      (from, to) =>
        db.from("social_post_targets").select("id").eq("status", "published").gte("published_at", since).lte("published_at", until).order("published_at").range(from, to),
      "published targets"
    );
    const ids = targets.map((t) => t.id);
    const snapshots: MetricSnapshot[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      snapshots.push(
        ...(await selectAllIn(
          (from, to) => db.from("social_metrics").select("target_id, captured_at, views").in("target_id", chunk).order("captured_at", { ascending: false }).order("id").range(from, to),
          "social metrics"
        ))
      );
    }
    return latestViews(snapshots);
  });

  const sitePageViews = orNull(async () =>
    headCount(
      await db.from("analytics_events").select("id", { count: "exact", head: true }).eq("event_type", "page_view").gte("created_at", since).lte("created_at", until),
      "page views"
    )
  );

  const funnelStarts = orNull(async () =>
    headCount(
      await db.from("funnel_events").select("id", { count: "exact", head: true }).eq("event_type", "start").gte("created_at", since).lte("created_at", until),
      "funnel sessions"
    )
  );

  const newContacts = orNull(async () =>
    headCount(await db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", since).lte("created_at", until), "new contacts")
  );

  const paid = orNull(async () =>
    netPaidSales(
      await selectAllIn(
        (from, to) =>
          db.from("orders").select("total_minor, currency, metadata").eq("status", "paid").gte("paid_at", since).lte("paid_at", until).order("paid_at").order("id").range(from, to),
        "paid orders"
      )
    )
  );

  const won = orNull(async () => {
    const rows = await selectAllIn(
      (from, to) =>
        db.from("opportunities").select("value_cents").eq("status", "won").gte("won_at", since).lte("won_at", until).order("won_at").order("id").range(from, to),
      "won deals"
    );
    return { deals: rows.length, value_minor: rows.reduce((sum, o) => sum + (o.value_cents || 0), 0) };
  });

  const [content_views, site_page_views, funnel_starts, new_contacts, paidTotals, wonDeals, home_currency] = await Promise.all([
    contentViews,
    sitePageViews,
    funnelStarts,
    newContacts,
    paid,
    won,
    homeCurrency(db).catch(() => DEFAULT_CURRENCY),
  ]);

  return NextResponse.json(
    summariseFunnel({ period, since, home_currency, content_views, site_page_views, funnel_starts, new_contacts, paid: paidTotals, won: wonDeals }),
    { headers: { "Cache-Control": "no-store" } }
  );
}
