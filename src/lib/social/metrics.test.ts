import assert from "node:assert/strict";
import test from "node:test";
import { MAX_META_PER_TICK, collectSnapshots, connected, pickDue, staleAfterMs, type MetricsTarget } from "./metrics.ts";
import { ytFetchMetricsMany } from "./youtube.ts";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function target(id: string, over: Partial<MetricsTarget> = {}): MetricsTarget {
  return {
    id,
    platform: "youtube",
    external_id: `vid-${id}`,
    published_at: ago(DAY),
    account: { id: "yt-1", status: "active", access_token: null, refresh_token: "refresh-1" },
    post: { post_type: "video" },
    ...over,
  };
}

function fakeFetch(t: test.TestContext, handler: (url: URL, init?: RequestInit) => unknown) {
  const calls: URL[] = [];
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    return new Response(JSON.stringify(handler(url, init)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}

test("fresh posts refresh every 6 hours, posts older than 30 days daily", () => {
  assert.equal(staleAfterMs(ago(2 * DAY), NOW), 6 * HOUR);
  assert.equal(staleAfterMs(ago(45 * DAY), NOW), 24 * HOUR);
});

test("pickDue: never-snapshotted first, then newest; recent snapshots wait", () => {
  const targets = [
    target("old-never", { published_at: ago(60 * DAY) }),
    target("new-fresh", { published_at: ago(1 * DAY) }),
    target("new-stale", { published_at: ago(2 * DAY) }),
    target("old-recent", { published_at: ago(60 * DAY) }),
  ];
  const latest = new Map([
    ["new-fresh", ago(2 * HOUR)],
    ["new-stale", ago(7 * HOUR)],
    ["old-recent", ago(10 * HOUR)],
  ]);
  assert.deepEqual(pickDue(targets, latest, NOW).map((t) => t.id), ["old-never", "new-stale"]);
  assert.equal(pickDue(targets, latest, NOW, true).length, 4);
});

test("disconnected accounts and missing tokens are skipped, not errored", async (t) => {
  const calls = fakeFetch(t, () => ({}));
  assert.equal(connected(target("a", { account: null })), false);
  const result = await collectSnapshots([
    target("a", { account: null }),
    target("b", { account: { id: "yt-1", status: "disconnected", access_token: null, refresh_token: "r" } }),
    target("c", { account: { id: "yt-1", status: "active", access_token: null, refresh_token: null } }),
    target("d", { platform: "instagram", account: { id: "ig-1", status: "active", access_token: null, refresh_token: null } }),
  ]);
  assert.deepEqual(result, { rows: [], errors: [], skipped: 4 });
  assert.equal(calls.length, 0);
});

test("YouTube is asked once per channel per 50 videos, with one token", async (t) => {
  const calls = fakeFetch(t, (url) => {
    if (url.hostname === "oauth2.googleapis.com") return { access_token: "access-1" };
    const ids = (url.searchParams.get("id") || "").split(",");
    return { items: ids.filter((id) => id !== "vid-gone").map((id, i) => ({ id, statistics: { viewCount: String(100 + i), likeCount: "3" } })) };
  });
  const due = Array.from({ length: 60 }, (_, i) => target(`t${i}`));
  due.push(target("gone", { external_id: "vid-gone" }));
  const result = await collectSnapshots(due);
  const tokenCalls = calls.filter((u) => u.hostname === "oauth2.googleapis.com");
  const statCalls = calls.filter((u) => u.pathname.endsWith("/videos"));
  assert.equal(tokenCalls.length, 1);
  assert.equal(statCalls.length, 2);
  assert.equal(statCalls[0].searchParams.get("id")!.split(",").length, 50);
  assert.equal(result.rows.length, 60);
  assert.equal(result.rows[0].views, 100);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /vid-gone/);
});

test("a failed YouTube token refresh is one error for the channel, not one per video", async (t) => {
  const calls = fakeFetch(t, (url) => (url.hostname === "oauth2.googleapis.com" ? { error_description: "revoked" } : {}));
  const result = await collectSnapshots([target("a"), target("b")]);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.errors, ["metrics youtube account yt-1: revoked"]);
  assert.equal(calls.length, 1);
});

test("Meta posts are capped per tick and a miss does not stop the rest", async (t) => {
  fakeFetch(t, (url) => {
    if (url.pathname.includes("ig-bad")) return { error: { message: "not ready" } };
    if (url.pathname.endsWith("/insights")) return { data: [{ name: "views", values: [{ value: 42 }] }] };
    return { like_count: 2, comments_count: 1 };
  });
  const meta = (id: string) =>
    target(id, { platform: "instagram", external_id: `ig-${id}`, account: { id: "ig-1", status: "active", access_token: "page", refresh_token: null } });
  const due = [meta("bad"), ...Array.from({ length: MAX_META_PER_TICK + 5 }, (_, i) => meta(`p${i}`))];
  const result = await collectSnapshots(due);
  assert.equal(result.rows.length, MAX_META_PER_TICK - 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.rows[0].views, 42);
});

test("ytFetchMetricsMany: an API error throws", async (t) => {
  fakeFetch(t, () => ({ error: { message: "quotaExceeded" } }));
  await assert.rejects(() => ytFetchMetricsMany("token", ["a"]), /quotaExceeded/);
});
