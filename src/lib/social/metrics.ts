/**
 * Performance snapshots. Each refresh appends a social_metrics row per
 * target (never updates in place) so the dashboard can chart growth, not
 * just show the latest number. The Reach box on /crm/analytics sums the
 * newest snapshot's views per target, so these rows are what fills it.
 *
 * Runs automatically on every social tick (the worker's 5-minute cron calls
 * POST /api/social/tick, which ends with refreshDueMetrics). No manual step.
 *
 * Cadence: targets published in the last 90 days. A target is due when it
 * has no snapshot yet, or its newest one is older than 6 hours (first 30
 * days after publishing) or 24 hours (days 31 to 90).
 *
 * Quotas: YouTube is asked in batches of 50 videos per call (1 unit each,
 * one access token per channel per run); Meta is asked per post, at most
 * MAX_META_PER_TICK posts a tick. Accounts that are disconnected or have no
 * token are skipped, not errored.
 */
import type { AdminClient } from "@/lib/crm/types";
import type { MetricSnapshot, SocialAccount, SocialTarget } from "./types";
import { fbFetchMetrics, fbFetchPostMetrics, igFetchMetrics } from "./meta.ts";
import { googleRefreshAccessToken, ytFetchMetricsMany } from "./youtube.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const TRACK_WINDOW_DAYS = 90;
const FRESH_DAYS = 30;
const FRESH_STALE_MS = 6 * HOUR;
const OLDER_STALE_MS = 24 * HOUR;
const MAX_TARGETS = 1000;
export const MAX_META_PER_TICK = 25;
export const MAX_YOUTUBE_PER_TICK = 200;
const IN_CHUNK = 200;
const PAGE = 1000;

export type MetricsTarget = Pick<SocialTarget, "id" | "platform" | "external_id" | "published_at"> & {
  account: Pick<SocialAccount, "id" | "status" | "access_token" | "refresh_token"> | null;
  post: { post_type: "video" | "carousel" } | null;
};

export type MetricsRow = {
  target_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
  raw: Record<string, unknown>;
};

/** How old a target's newest snapshot may be before it is fetched again. */
export function staleAfterMs(publishedAt: string | null, now: number): number {
  const age = publishedAt ? now - Date.parse(publishedAt) : 0;
  return age > FRESH_DAYS * DAY ? OLDER_STALE_MS : FRESH_STALE_MS;
}

/**
 * The targets to fetch now: never snapshotted first, then the most recently
 * published. force (a person asked for fresh numbers) skips the staleness gate.
 */
export function pickDue(
  targets: MetricsTarget[],
  latest: Map<string, string>,
  now: number,
  force = false
): MetricsTarget[] {
  const due = targets.filter((t) => {
    if (force) return true;
    const last = latest.get(t.id);
    return !last || now - Date.parse(last) > staleAfterMs(t.published_at, now);
  });
  return due.sort((a, b) => {
    const na = latest.has(a.id) ? 1 : 0;
    const nb = latest.has(b.id) ? 1 : 0;
    if (na !== nb) return na - nb;
    return Date.parse(b.published_at || "") - Date.parse(a.published_at || "") || 0;
  });
}

/** Connected means: an account that is not disconnected and holds the token its platform needs. */
export function connected(t: MetricsTarget): boolean {
  const a = t.account;
  if (!a || a.status === "disconnected" || !t.external_id) return false;
  return t.platform === "youtube" ? Boolean(a.refresh_token) : Boolean(a.access_token);
}

function row(targetId: string, snap: MetricSnapshot): MetricsRow {
  return {
    target_id: targetId,
    views: snap.views,
    likes: snap.likes,
    comments: snap.comments,
    shares: snap.shares,
    saves: snap.saves,
    reach: snap.reach,
    raw: snap.raw,
  };
}

/**
 * Fetch snapshots for the due targets: YouTube batched per channel, Meta one
 * post at a time up to the per-tick cap. Returns the rows to insert; a miss
 * is reported in errors (insights lag behind publishing) and never stops the rest.
 */
export async function collectSnapshots(due: MetricsTarget[]): Promise<{ rows: MetricsRow[]; errors: string[]; skipped: number }> {
  const rows: MetricsRow[] = [];
  const errors: string[] = [];
  let skipped = 0;
  const youtube = new Map<string, { refreshToken: string; targets: MetricsTarget[] }>();
  let ytQueued = 0;
  let metaDone = 0;

  for (const t of due) {
    if (!connected(t)) {
      skipped++;
      continue;
    }
    const account = t.account!;
    if (t.platform === "youtube") {
      if (ytQueued >= MAX_YOUTUBE_PER_TICK) continue;
      const group = youtube.get(account.id) ?? { refreshToken: account.refresh_token!, targets: [] };
      group.targets.push(t);
      youtube.set(account.id, group);
      ytQueued++;
      continue;
    }
    if (metaDone >= MAX_META_PER_TICK) continue;
    metaDone++;
    try {
      const token = account.access_token!;
      const snap =
        t.platform === "instagram"
          ? await igFetchMetrics(t.external_id!, token)
          : t.post?.post_type === "carousel"
            ? // Carousels land as multi-photo feed posts, which have no video_insights.
              await fbFetchPostMetrics(t.external_id!, token)
            : await fbFetchMetrics(t.external_id!, token);
      rows.push(row(t.id, snap));
    } catch (e) {
      // Insights lag behind publishing (IG often 404s for the first hour), so
      // a miss is not fatal - but it must be visible.
      errors.push(`metrics ${t.platform}/${t.external_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const [accountId, group] of youtube) {
    try {
      const token = await googleRefreshAccessToken(group.refreshToken);
      const stats = await ytFetchMetricsMany(token, group.targets.map((t) => t.external_id!));
      for (const t of group.targets) {
        const snap = stats.get(t.external_id!);
        if (snap) rows.push(row(t.id, snap));
        else errors.push(`metrics youtube/${t.external_id}: not returned (deleted or private?)`);
      }
    } catch (e) {
      errors.push(`metrics youtube account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { rows, errors, skipped };
}

export async function refreshDueMetrics(
  supabase: AdminClient,
  opts: { force?: boolean } = {}
): Promise<{ refreshed: number; errors: string[] }> {
  const errors: string[] = [];
  const now = Date.now();
  const windowStart = new Date(now - TRACK_WINDOW_DAYS * DAY).toISOString();
  const { data: targets, error } = await supabase
    .from("social_post_targets")
    .select("id, platform, external_id, published_at, account:social_accounts(id, status, access_token, refresh_token), post:social_posts(post_type)")
    .eq("status", "published")
    .not("external_id", "is", null)
    .gte("published_at", windowStart)
    .order("published_at", { ascending: false })
    .limit(MAX_TARGETS);
  if (error) return { refreshed: 0, errors: [`metrics targets: ${error.message}`] };
  if (!targets?.length) return { refreshed: 0, errors };
  const list = targets as unknown as MetricsTarget[];

  // Newest snapshot per target. Only snapshots young enough to keep a target
  // off the due list matter, so older ones are never read.
  const latest = new Map<string, string>();
  if (!opts.force) {
    const recent = new Date(now - OLDER_STALE_MS).toISOString();
    const ids = list.map((t) => t.id);
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      for (let from = 0; ; from += PAGE) {
        const { data: snaps, error: snapError } = await supabase
          .from("social_metrics")
          .select("target_id, captured_at")
          .in("target_id", chunk)
          .gte("captured_at", recent)
          .order("captured_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (snapError) return { refreshed: 0, errors: [`metrics snapshots: ${snapError.message}`] };
        for (const s of snaps || []) {
          const seen = latest.get(s.target_id);
          if (!seen || Date.parse(s.captured_at) > Date.parse(seen)) latest.set(s.target_id, s.captured_at);
        }
        if (!snaps || snaps.length < PAGE) break;
      }
    }
  }

  const collected = await collectSnapshots(pickDue(list, latest, now, opts.force));
  errors.push(...collected.errors);
  let refreshed = 0;
  if (collected.rows.length) {
    const { error: insertError } = await supabase.from("social_metrics").insert(collected.rows.map((r) => ({ ...r, raw: r.raw as never })));
    if (insertError) errors.push(`metrics insert: ${insertError.message}`);
    else refreshed = collected.rows.length;
  }
  return { refreshed, errors };
}
