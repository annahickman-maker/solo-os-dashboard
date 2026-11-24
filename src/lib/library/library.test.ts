/**
 * Library: input and preview limits, idempotent ingest against a fake
 * database and a fake R2 bucket, the YouTube import against a fake fetch, and
 * scope enforcement through the real auth module with synthetic credentials.
 * No network, no real database, no real bucket.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  MAX_PREVIEW_BYTES,
  checkPreview,
  normaliseTags,
  previewKey,
  sniffImage,
  validateAssetInput,
  validateCuration,
  validateSyncRun,
  type AssetInput,
  type LibraryAsset,
} from "./contract.ts";
import { DuplicateAssetError, curateAsset, ingestAsset, type AssetRow, type LibraryDb, type PreviewBucket } from "./store.ts";
import { importYouTubeUploads } from "./youtube-import.ts";
import { toClientAsset } from "./client-shape.ts";
import * as signing from "../api/signing.ts";
import * as scopes from "../api/agent-key-scopes.ts";
import { scopedRouteAllowed } from "../api/scoped-routes.ts";
import type { AuthResult } from "../api/auth.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** 16x16 RGB PNG. */
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNQyTlDEmIY1TCqYfhqAABaPFwQvDIPgQAAAABJRU5ErkJggg==";
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const pngBytes = () => new Uint8Array(Buffer.from(PNG_B64, "base64"));

function pngWithSize(w: number, h: number): string {
  const b = pngBytes();
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b64(b);
}

function jpeg(w: number, h: number, pad = 0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...new Array(pad).fill(0), 0xff, 0xd9]);
}

function fakeDb() {
  const rows = new Map<string, LibraryAsset>();
  let n = 0;
  const calls = { insert: 0, update: 0 };
  let raceOnce: LibraryAsset | null = null;
  const db: LibraryDb = {
    async findBySource(source, sourceId) {
      return [...rows.values()].find((r) => r.source === source && r.source_id === sourceId) ?? null;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async insert(row: AssetRow) {
      calls.insert++;
      if (raceOnce) {
        rows.set(raceOnce.id, raceOnce);
        raceOnce = null;
        throw new DuplicateAssetError();
      }
      if ([...rows.values()].some((r) => r.source === row.source && r.source_id === row.source_id)) throw new DuplicateAssetError();
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const now = new Date().toISOString();
      const asset = { ...row, id, added_at: now, updated_at: now } as LibraryAsset;
      rows.set(id, asset);
      return asset;
    },
    async update(id, patch) {
      calls.update++;
      const asset = { ...rows.get(id)!, ...patch, updated_at: new Date().toISOString() } as LibraryAsset;
      rows.set(id, asset);
      return asset;
    },
  };
  return { db, rows, calls, race: (a: LibraryAsset) => (raceOnce = a) };
}

function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  const log = { put: 0, delete: 0 };
  const bucket: PreviewBucket = {
    async put(key, value, opts) {
      log.put++;
      objects.set(key, { bytes: value, type: opts?.httpMetadata?.contentType });
    },
    async delete(key) {
      log.delete++;
      objects.delete(key);
    },
  };
  return { bucket, objects, log };
}

function input(over: Record<string, unknown> = {}): AssetInput {
  const r = validateAssetInput({
    source: "mac",
    source_id: "Shoots/2026/beach.jpg",
    kind: "image",
    title: "beach",
    original_label: "Mac: Shoots/2026/beach.jpg",
    tags: ["Beach", "summer", "beach"],
    collection: "Stills",
    preview_base64: PNG_B64,
    ...over,
  });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.value;
}

// ── Validation and limits ───────────────────────────────────────────────────

test("asset input: source, kind and a way back to the original are required", () => {
  assert.equal(validateAssetInput({ source: "icloud", source_id: "x", kind: "image", original_label: "x" }).ok, false);
  assert.equal(validateAssetInput({ source: "mac", source_id: "", kind: "image", original_label: "x" }).ok, false);
  assert.equal(validateAssetInput({ source: "mac", source_id: "x", kind: "gif", original_label: "x" }).ok, false);
  assert.equal(validateAssetInput({ source: "mac", source_id: "x", kind: "image" }).ok, false, "no url and no label");
  assert.equal(validateAssetInput({ source: "link", source_id: "x", kind: "doc", original_label: "x" }).ok, false, "link needs a url");
  assert.equal(validateAssetInput({ source: "link", source_id: "x", kind: "doc", original_url: "javascript:alert(1)" }).ok, false);
  const ok = validateAssetInput({ source: "link", source_id: "https://example.com/a", kind: "doc", original_url: "https://example.com/a", taken_at: "2026-01-02" });
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.value.taken_at, "2026-01-02T00:00:00.000Z");
  assert.deepEqual(normaliseTags(" One, two ,one,, THREE "), ["one", "two", "three"]);
});

test("preview limits: type is sniffed from the bytes, size and pixel edge are capped", () => {
  assert.equal(sniffImage(pngBytes())?.type, "image/png");
  assert.deepEqual(sniffImage(jpeg(800, 450)), { type: "image/jpeg", width: 800, height: 450 });
  const ok = checkPreview(PNG_B64);
  assert.ok(ok.ok);

  const gif = checkPreview(b64(new TextEncoder().encode("GIF89a.........................")));
  assert.equal(!gif.ok && gif.status, 415);
  const html = checkPreview(b64(new TextEncoder().encode("<html><script>alert(1)</script></html>")));
  assert.equal(!html.ok && html.status, 415, "declared type is never trusted");

  const wide = checkPreview(pngWithSize(4000, 3000));
  assert.equal(!wide.ok && wide.status, 413);
  const tallJpeg = checkPreview(b64(jpeg(600, 2000)));
  assert.equal(!tallJpeg.ok && tallJpeg.status, 413);

  const big = checkPreview(b64(jpeg(800, 600, MAX_PREVIEW_BYTES)));
  assert.equal(!big.ok && big.status, 413);
  const huge = validateAssetInput({ ...input(), preview_base64: "A".repeat(Math.ceil((MAX_PREVIEW_BYTES * 4) / 3) + 100) });
  assert.equal(!huge.ok && huge.status, 413, "rejected before decoding");
  assert.equal(checkPreview("not base64 !!").ok, false);
});

test("curation and sync-run input are validated", () => {
  assert.equal(validateCuration({}).ok, false);
  assert.equal(validateCuration({ hidden: "yes" }).ok, false);
  const c = validateCuration({ tags: "A, b", collection: " Thumbnails ", hidden: true });
  assert.deepEqual(c.ok && c.value, { tags: ["a", "b"], collection: "thumbnails", hidden: true });
  assert.equal(validateSyncRun({ source: "mac", scanned: -1 }).ok, false);
  assert.equal(validateSyncRun({ source: "mac", status: "great" }).ok, false);
  assert.ok(validateSyncRun({ source: "mac", scanned: 3, created: 1 }).ok);
});

// ── Idempotent ingest ───────────────────────────────────────────────────────

test("ingest is idempotent on (source, source_id): one row, one preview object", async () => {
  const { db, rows, calls } = fakeDb();
  const { bucket, objects, log } = fakeBucket();

  const first = await ingestAsset({ db, bucket }, input());
  assert.ok(first.ok);
  assert.equal(first.value.status, "created");
  assert.deepEqual(first.value.asset.tags, ["beach", "summer"]);
  assert.equal(first.value.asset.collection, "stills");
  assert.equal(first.value.asset.preview_bytes, pngBytes().length);
  assert.equal(log.put, 1);
  const key = await previewKey("mac", "Shoots/2026/beach.jpg", "image/png");
  assert.equal(first.value.asset.preview_key, key);
  assert.equal(objects.get(key)?.type, "image/png");

  const again = await ingestAsset({ db, bucket }, input());
  assert.ok(again.ok);
  assert.equal(again.value.status, "unchanged");
  assert.equal(log.put, 1, "same preview is not uploaded again");
  assert.equal(calls.update, 0);

  const renamed = await ingestAsset({ db, bucket }, input({ title: "beach at dusk", preview_base64: null }));
  assert.ok(renamed.ok);
  assert.equal(renamed.value.status, "updated");
  assert.equal(renamed.value.asset.preview_key, key, "no preview sent: the stored one is kept");

  const newPreview = await ingestAsset({ db, bucket }, input({ title: "beach at dusk", preview_base64: b64(jpeg(800, 600)) }));
  assert.ok(newPreview.ok);
  assert.equal(newPreview.value.status, "updated");
  assert.equal(newPreview.value.asset.preview_type, "image/jpeg");
  assert.equal(objects.size, 1, "the old preview object is removed when the type changes");
  assert.equal(log.delete, 1);
  assert.equal(rows.size, 1);
});

test("ingest keeps the owner's curation and survives a concurrent insert", async () => {
  const { db, rows, race } = fakeDb();
  const { bucket } = fakeBucket();
  const created = await ingestAsset({ db, bucket }, input());
  assert.ok(created.ok);
  const curated = await curateAsset(db, created.value.asset.id, { tags: ["favourite"], collection: "me", hidden: true });
  assert.ok(curated?.curated_at);

  const resync = await ingestAsset({ db, bucket }, input({ tags: ["other"], collection: "elsewhere", title: "beach 2" }));
  assert.ok(resync.ok);
  assert.equal(resync.value.status, "updated");
  assert.deepEqual(resync.value.asset.tags, ["favourite"]);
  assert.equal(resync.value.asset.collection, "me");
  assert.equal(resync.value.asset.hidden, true, "a sync never unhides");

  // Another request inserts the same original between our read and insert.
  const other = { ...created.value.asset, id: "00000000-0000-4000-8000-999999999999", source_id: "race.jpg", preview_sha256: null, preview_key: null };
  race(other);
  const raced = await ingestAsset({ db, bucket }, input({ source_id: "race.jpg" }));
  assert.ok(raced.ok);
  assert.equal(raced.value.status, "updated");
  assert.equal(raced.value.asset.id, other.id);
  assert.equal([...rows.values()].filter((r) => r.source_id === "race.jpg").length, 1);
});

test("a preview needs the bucket; client shape hides the R2 key", async () => {
  const { db } = fakeDb();
  const r = await ingestAsset({ db, bucket: null }, input());
  assert.equal(!r.ok && r.status, 503);
  const noPreview = await ingestAsset({ db, bucket: null }, input({ preview_base64: null }));
  assert.ok(noPreview.ok, "metadata alone is fine without a bucket");
  const { bucket } = fakeBucket();
  const withPreview = await ingestAsset({ db, bucket }, input({ source_id: "b.jpg" }));
  assert.ok(withPreview.ok);
  const shaped = toClientAsset(withPreview.value.asset) as Record<string, unknown>;
  assert.equal("preview_key" in shaped, false);
  assert.match(String(shaped.preview_url), /^\/api\/library\/preview\/[0-9a-f-]{36}\?v=[0-9a-f]{12}$/);
});

// ── YouTube import ──────────────────────────────────────────────────────────

test("YouTube import: own uploads become previews with links, re-run is a no-op, only ytimg is fetched", async () => {
  const { db, rows } = fakeDb();
  const { bucket, log } = fakeBucket();
  const fetched: string[] = [];
  const fakeFetch = async (url: string) => {
    fetched.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/channels")) return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UUabc" } } }] });
    if (u.pathname.endsWith("/playlistItems")) {
      return Response.json({
        items: [
          { snippet: { title: "First video", thumbnails: { medium: { url: "https://i.ytimg.com/vi/vid000001/mqdefault.jpg" } } }, contentDetails: { videoId: "vid000001", videoPublishedAt: "2026-03-01T10:00:00Z" } },
          { snippet: { title: "Sneaky", thumbnails: { medium: { url: "https://evil.example.com/x.jpg" } } }, contentDetails: { videoId: "vid000002" } },
          { snippet: { title: "Private video" }, contentDetails: { videoId: "vid000003" } },
        ],
      });
    }
    if (u.hostname === "i.ytimg.com") return new Response(jpeg(320, 180) as BodyInit);
    return new Response("no", { status: 404 });
  };

  const first = await importYouTubeUploads({ db, bucket, fetch: fakeFetch }, "token", { channelTitle: "My channel" });
  assert.deepEqual({ ...first, errors: undefined }, { scanned: 2, created: 2, updated: 0, unchanged: 0, failed: 0, errors: undefined });
  assert.ok(!fetched.some((u) => u.includes("evil.example.com")));
  const v1 = [...rows.values()].find((r) => r.source_id === "vid000001")!;
  assert.equal(v1.original_url, "https://www.youtube.com/watch?v=vid000001");
  assert.equal(v1.kind, "video");
  assert.equal(v1.taken_at, "2026-03-01T10:00:00.000Z");
  assert.equal(v1.preview_type, "image/jpeg");
  const v2 = [...rows.values()].find((r) => r.source_id === "vid000002")!;
  assert.equal(v2.preview_key, null, "no preview from a non-YouTube host");

  const putsBefore = log.put;
  const thumbFetches = fetched.filter((u) => u.includes("ytimg")).length;
  const second = await importYouTubeUploads({ db, bucket, fetch: fakeFetch }, "token", { channelTitle: "My channel" });
  assert.equal(second.unchanged, 2);
  assert.equal(second.created + second.updated, 0);
  assert.equal(log.put, putsBefore);
  assert.equal(fetched.filter((u) => u.includes("ytimg")).length, thumbFetches, "unchanged thumbnails are not refetched");
  assert.equal(rows.size, 2);
});

test("YouTube import explains a connection without read scope", async () => {
  const { db } = fakeDb();
  const fakeFetch = async () => Response.json({ error: { message: "Request had insufficient authentication scopes." } }, { status: 403 });
  await assert.rejects(importYouTubeUploads({ db, bucket: null, fetch: fakeFetch }, "t"), /Reconnect the channel/);
});

// ── Scope enforcement ───────────────────────────────────────────────────────

test("scoped routes: library keys reach library routes only, read and write kept apart", () => {
  assert.ok((scopes.SCOPES as readonly string[]).includes("library:read"));
  assert.ok((scopes.SCOPES as readonly string[]).includes("library:write"));
  assert.equal(scopedRouteAllowed("GET", "/api/library/assets", ["library:read"]), true);
  assert.equal(scopedRouteAllowed("GET", "/api/library/status", ["library:read"]), true);
  assert.equal(scopedRouteAllowed("POST", "/api/library/assets", ["library:read"]), false);
  for (const path of ["/api/library/assets", "/api/library/sync-runs", "/api/library/import/youtube"]) {
    assert.equal(scopedRouteAllowed("POST", path, ["library:write"]), true, path);
  }
  assert.equal(scopedRouteAllowed("GET", "/api/library/assets", ["library:write"]), false, "write does not imply read");
  // Curation and previews are owner-only; no minted key reaches them.
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(scopedRouteAllowed("PATCH", `/api/library/assets/${id}`, ["library:read", "library:write"]), false);
  assert.equal(scopedRouteAllowed("GET", `/api/library/preview/${id}`, ["library:read", "library:write"]), false);
  assert.equal(scopedRouteAllowed("POST", "/api/library/assets/x", ["library:write"]), false);
  // Other keys do not reach the library, and library keys reach nothing else.
  assert.equal(scopedRouteAllowed("POST", "/api/library/assets", ["brand:write", "content:write", "money:write"]), false);
  for (const [m, p] of [["GET", "/api/crm/orders"], ["PUT", "/api/solo/docs/offer"], ["POST", "/api/settings/agent-keys"], ["GET", "/api/events"]]) {
    assert.equal(scopedRouteAllowed(m, p, ["library:read", "library:write"]), false, `${m} ${p}`);
  }
});

function authFixture(grants: string[]) {
  const env = { API_SECRET_KEY: "test-master", API_REQUEST_SIGNING_SECRET: "test-signing" };
  const deps: Record<string, unknown> = {
    "next/server": {},
    "@/lib/supabase/server": { createAdminClient: () => ({}), createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }) },
    "./signing": signing,
    "./agent-key-scopes": scopes,
    "./scoped-routes": { scopedRouteAllowed },
    "./agent-keys": { verifyAgentKey: async () => ({ name: "manager", scopes: grants }) },
  };
  const js = ts.transpileModule(readFileSync(join(import.meta.dirname, "../api/auth.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { authenticateSessionOrApiKey: (r: Request) => Promise<AuthResult>; requireScope: (a: AuthResult, s: string) => Response | null } };
  new Function("require", "module", "exports", "process", js)((id: string) => deps[id], mod, mod.exports, { env });
  return mod.exports;
}

function signed(key: string, method: string, path: string, body = "") {
  const time = String(Math.floor(Date.now() / 1000));
  return new Request(`https://test.invalid${path}`, {
    method,
    body: method === "GET" ? undefined : body,
    headers: { "x-api-key": key, "x-timestamp": time, "x-signature": signing.computeSignature(key, signing.buildSigningPayload(method, path, time, body)) },
  });
}

test("a minted library:write key can ingest but not read or curate; a read key cannot ingest", async () => {
  const minted = "bbk_manager_" + "b".repeat(32);
  const body = JSON.stringify({ source: "mac", source_id: "a.jpg", kind: "image", original_label: "Mac: a.jpg" });

  const writer = authFixture(["library:write"]);
  const w = await writer.authenticateSessionOrApiKey(signed(minted, "POST", "/api/library/assets", body));
  assert.equal(w.authenticated, true);
  assert.equal(writer.requireScope(w, "library:write"), null);
  assert.equal((await writer.authenticateSessionOrApiKey(signed(minted, "GET", "/api/library/assets"))).authenticated, false);
  assert.equal((await writer.authenticateSessionOrApiKey(signed(minted, "PATCH", "/api/library/assets/11111111-1111-4111-8111-111111111111", "{}"))).authenticated, false);
  assert.equal((await writer.authenticateSessionOrApiKey(signed(minted, "GET", "/api/library/preview/11111111-1111-4111-8111-111111111111"))).authenticated, false);

  const reader = authFixture(["library:read"]);
  assert.equal((await reader.authenticateSessionOrApiKey(signed(minted, "POST", "/api/library/assets", body))).authenticated, false);
  const r = await reader.authenticateSessionOrApiKey(signed(minted, "GET", "/api/library/assets"));
  assert.equal(r.authenticated, true);
  assert.equal(reader.requireScope(r, "library:write")?.status, 403);

  const tampered = signed(minted, "POST", "/api/library/assets", body);
  const forged = new Request(tampered.url, { method: "POST", headers: tampered.headers, body: body.replace("a.jpg", "b.jpg") });
  assert.equal((await writer.authenticateSessionOrApiKey(forged)).authenticated, false, "the signature covers the body");
});

const ROOT = join(import.meta.dirname, "../../..");
function handler(file: string, method: string): string {
  const src = readFileSync(join(ROOT, file), "utf8");
  const start = src.indexOf(`export async function ${method}(`);
  assert.ok(start >= 0, `${file} exports ${method}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test("every library handler authenticates and checks its scope before touching data", () => {
  const cases: [string, string, RegExp][] = [
    ["src/app/api/library/assets/route.ts", "GET", /requireScope\(auth, "library:read"\)/],
    ["src/app/api/library/assets/route.ts", "POST", /requireScope\(auth, "library:write"\)/],
    ["src/app/api/library/status/route.ts", "GET", /requireScope\(auth, "library:read"\)/],
    ["src/app/api/library/sync-runs/route.ts", "POST", /requireScope\(auth, "library:write"\)/],
    ["src/app/api/library/import/youtube/route.ts", "POST", /requireScope\(auth, "library:write"\)/],
    ["src/app/api/library/assets/[id]/route.ts", "PATCH", /WILDCARD_SCOPE/],
    ["src/app/api/library/preview/[id]/route.ts", "GET", /authenticateSession\(request\)/],
  ];
  for (const [file, method, gate] of cases) {
    const src = handler(file, method);
    const auth = src.search(/authenticateSession(?:OrApiKey)?\(request\)/);
    const g = src.search(gate);
    const data = src.search(/supabaseLibraryDb\(|listAssets\(|libraryStats\(|recordSyncRun\(|youtubeConnections\(|previewBucket\(/);
    assert.ok(auth >= 0, `${method} ${file}: no auth`);
    assert.ok(g >= auth, `${method} ${file}: no gate`);
    assert.ok(data < 0 || data > g, `${method} ${file}: touches data before the gate`);
  }
});

// ── Mac folder sync script ──────────────────────────────────────────────────

test("library-sync.mjs: relative ids and labels only, signatures the server accepts", async () => {
  const sync = await import("../../../scripts/library-sync.mjs");
  assert.equal(sync.kindOf("a.HEIC"), "image");
  assert.equal(sync.kindOf("clip.mov"), "video");
  assert.equal(sync.kindOf("notes.txt"), null);
  const d = sync.describe("/Users/someone/Pictures/Shoots", "Shoots", "/Users/someone/Pictures/Shoots/2026/Beach/a.jpg", undefined);
  assert.deepEqual(d, { source: "mac", source_id: "Shoots/2026/Beach/a.jpg", kind: "image", title: "a", original_label: "Mac: Shoots/2026/Beach/a.jpg", collection: "shoots", tags: ["2026", "beach"] });
  assert.ok(!JSON.stringify(d).includes("/Users/"), "no home path leaves the Mac");
  assert.ok(validateAssetInput(d).ok);
  assert.equal(sync.MAX_PREVIEW_BYTES, MAX_PREVIEW_BYTES);
  const h = sync.sign("bbk_sync_" + "d".repeat(32), "POST", "/api/library/assets", "{}", 1_800_000_000_000);
  assert.equal(h["x-signature"], signing.computeSignature("bbk_sync_" + "d".repeat(32), signing.buildSigningPayload("POST", "/api/library/assets", "1800000000", "{}")));
});
