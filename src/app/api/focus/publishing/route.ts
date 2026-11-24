/**
 * GET /api/focus/publishing?tz=<Date.getTimezoneOffset()>: publishing counts
 * for the Focus page's content counters. Owner session only.
 *
 * Returns { longForm, shortForm }, each { weeks, months }: counts for the
 * last 52 weeks (Monday start, oldest first) and per day for the last 12
 * months (oldest first). Sources and dating rules:
 * src/components/focus/publishing.ts. A source that cannot be read (no
 * social tables yet, no long form document) counts as empty, so the page shows
 * empty grids rather than an error; `unavailable` names any such source.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { readSoloDoc } from "@/lib/solo/documents";
import {
  bucketDays, localDayKey, longFormDays, parseTzOffset, seriesSince, shortFormDays,
} from "@/components/focus/publishing";

const PAGE = 1000;
const MAX_ROWS = 20_000;

type TargetRow = { post_id: string; published_at: string | null; status: string };

async function publishedTargets(sinceIso: string): Promise<TargetRow[]> {
  const db = createAdminClient();
  const rows: TargetRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await db
      .from("social_post_targets")
      .select("post_id, published_at, status")
      .eq("status", "published")
      .gte("published_at", sinceIso)
      .order("published_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as TargetRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const tz = parseTzOffset(request.nextUrl.searchParams.get("tz"));
  const today = localDayKey(new Date(), tz) ?? new Date().toISOString().slice(0, 10);
  // A day early, so a post late on the first local day is not missed in any time zone.
  const since = new Date(Date.parse(`${seriesSince(today)}T00:00:00Z`) - 86_400_000).toISOString();
  const unavailable: string[] = [];

  const [longDoc, targets] = await Promise.all([
    readSoloDoc("longform").catch(() => { unavailable.push("longform"); return null; }),
    publishedTargets(since).catch(() => { unavailable.push("social"); return [] as TargetRow[]; }),
  ]);

  return NextResponse.json(
    {
      today,
      longForm: bucketDays(longFormDays(longDoc, tz), today),
      shortForm: bucketDays(shortFormDays(targets, tz), today),
      unavailable,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
