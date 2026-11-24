import assert from "node:assert/strict";
import test from "node:test";
import { scopedRouteAllowed } from "../api/scoped-routes.ts";
import { EMBED_DIMENSIONS, workersAiEmbedder, type Embedder } from "./embed.ts";
import { fakeMemoryDb, type FakeMemoryDb } from "./fake-db.ts";
import { handleInbox, INBOX_SETTING_KEY, revokeInboxToken, rotateInboxToken } from "./inbox.ts";
import { buildInput, inboxTokenMatches, type MemoryInput } from "./input.ts";
import { backfillEmbeddings, importDocument, listDocuments, memoryStatus, searchMemory } from "./store.ts";
import { bestSnippet, CHUNK_TARGET, chunkText, MAX_BODY_BYTES, parseText } from "./text.ts";

// Fabricated content and tokens only.
const URL_ = "https://dash.example.com/api/memory/inbox";
const RANDOM = "0123456789abcdef0123456789abcdef01234567";

const sentence = (i: number) => `Sentence number ${i} talks about pricing, offers and the calendar in plain words.`;
const longText = (n: number) => Array.from({ length: n }, (_, i) => sentence(i)).join(" ");

/** A fake Workers AI: one 384-number vector per text. */
function fakeEmbedder(opts: { fail?: boolean } = {}): Embedder & { calls: { texts: string[]; as: string }[] } {
  const calls: { texts: string[]; as: string }[] = [];
  return {
    model: "fake",
    calls,
    async embed(texts, as) {
      calls.push({ texts, as });
      if (opts.fail) throw new Error("model down");
      return texts.map((_, i) => Array.from({ length: EMBED_DIMENSIONS }, (_, j) => (j === i % EMBED_DIMENSIONS ? 1 : 0)));
    },
  };
}

function input(over: Record<string, unknown> = {}): MemoryInput {
  const r = buildInput({ source: "zoom", source_id: "rec-1", title: "Pricing call", kind: "conversation", text: "Me: I raise prices when the calendar is full.", ...over }, { source: "inbox" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.input;
}

async function withToken(db: FakeMemoryDb): Promise<string> {
  return (await rotateInboxToken(db, new Date("2026-01-01T00:00:00Z"), RANDOM)).token;
}

function inboxRequest(body: unknown, headers: Record<string, string> = {}, url = URL_): Request {
  const isString = typeof body === "string";
  return new Request(url, {
    method: "POST",
    headers: { "content-type": isString ? "text/plain" : "application/json", ...headers },
    body: isString ? body : JSON.stringify(body),
  });
}

const payload = { source: "zoom", source_id: "rec-42", title: "Client call", kind: "conversation", occurred_at: "2026-03-04T10:00:00Z", text: "Me: The first call is always about the outcome." };

// ── Chunking and parsing ────────────────────────────────────────────────────

test("chunking: short text is one chunk; long text splits near the target with overlap and loses nothing", () => {
  assert.deepEqual(chunkText("  One short note.\n\n\n\nSecond line. "), ["One short note.\n\nSecond line."]);
  assert.deepEqual(chunkText("   "), []);

  const text = longText(120);
  const chunks = chunkText(text);
  assert.ok(chunks.length > 3);
  for (const c of chunks) {
    assert.ok(c.length <= CHUNK_TARGET + 200, `chunk of ${c.length}`);
    assert.ok(c.trim().length > 0);
  }
  for (let i = 0; i < 120; i++) assert.ok(chunks.some((c) => c.includes(`number ${i} talks`)), `sentence ${i} lost`);
  // Overlap: a later chunk starts with words from the end of the one before.
  const tailWords = chunks[0].split(" ").slice(-3).join(" ");
  assert.ok(chunks[1].includes(tailWords));

  // Paragraphs are kept whole when they fit.
  const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}. ` + "word ".repeat(80).trim()).join("\n\n");
  for (const c of chunkText(paras)) assert.ok(!/word Paragraph/.test(c));

  // One enormous word run still splits.
  assert.ok(chunkText("x".repeat(5000)).every((c) => c.length <= CHUNK_TARGET));
});

test("captions: .vtt and .srt lose timestamps and cue numbers, keep speakers, drop rolling repeats", () => {
  const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Sam>Hello and welcome.</v>\n\n2\n00:00:03.000 --> 00:00:05.000\n<v Sam>Hello and welcome.</v>\n\n3\n00:00:05.000 --> 00:00:07.000\n<v Alex>Thanks for having me.</v>\n\nNOTE this is a note\n\n00:00:07.000 --> 00:00:09.000\n<v Alex>Pricing is next.</v>\n";
  const v = parseText(vtt, "call.vtt");
  assert.equal(v.format, "vtt");
  assert.equal(v.text, "Sam: Hello and welcome.\n\nAlex: Thanks for having me. Pricing is next.");
  assert.deepEqual(v.speakers, ["Sam", "Alex"]);

  const srt = "1\n00:00:01,000 --> 00:00:02,500\nFirst line\n\n2\n00:00:02,500 --> 00:00:04,000\nsecond line\n";
  const s = parseText(srt);
  assert.equal(s.format, "srt");
  assert.equal(s.text, "First line second line");

  const plain = parseText("Sam: hi\nAlex: hello\nSam: ok\nAlex: bye\nNote: once");
  assert.deepEqual(plain.speakers.sort(), ["Alex", "Sam"]);
});

test("input: validates source, kind, date, url and size; fills title and source_id", () => {
  const ok = buildInput({ text: "# My idea\n\nBody", filename: "notes/2026 plan.md" }, { source: "upload" });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.input.title, "2026 plan");
    assert.equal(ok.input.kind, "note");
    assert.equal(ok.input.source, "upload");
    assert.match(ok.input.source_id, /^[0-9a-f]{32}$/);
  }
  const bad = (f: Record<string, unknown>) => buildInput({ text: "x", ...f }, { source: "inbox" });
  assert.match((bad({ source: "Bad Source" }) as { error: string }).error, /source/);
  assert.match((bad({ kind: "gossip" }) as { error: string }).error, /kind/);
  assert.match((bad({ occurred_at: "yesterday" }) as { error: string }).error, /occurred_at/);
  assert.match((bad({ url: "ftp://x" }) as { error: string }).error, /url/);
  assert.equal((buildInput({ text: "a".repeat(MAX_BODY_BYTES + 1) }, { source: "inbox" }) as { status: number }).status, 413);
  assert.equal((buildInput({}, { source: "inbox" }) as { status: number }).status, 400);
  const unix = buildInput({ text: "x", occurred_at: 1767225600 }, { source: "inbox" });
  assert.ok(unix.ok && unix.input.occurred_at === "2026-01-01T00:00:00.000Z");
});

// ── Inbox auth ──────────────────────────────────────────────────────────────

test("inbox auth: off until a token exists; wrong, missing or URL tokens are refused; Bearer and X-Memory-Token work", async () => {
  const db = fakeMemoryDb();
  const off = await handleInbox(inboxRequest(payload, { authorization: `Bearer mem_${RANDOM}` }), { db, embedder: null });
  assert.equal(off.status, 403);
  assert.match((await off.json()).error, /inbox is off/);

  const token = await withToken(db);
  // Only the hash is stored.
  const stored = JSON.stringify(db.tables.backend_settings);
  assert.ok(!stored.includes(token));
  assert.ok(stored.includes("mem_0123"));

  for (const headers of [{} as Record<string, string>, { authorization: "Bearer mem_" + "f".repeat(40) }, { authorization: "Basic " + token }, { authorization: `Bearer ${token}x` }]) {
    const r = await handleInbox(inboxRequest(payload, headers), { db, embedder: null });
    assert.equal(r.status, 401, JSON.stringify(headers));
  }
  const inUrl = await handleInbox(inboxRequest(payload, {}, `${URL_}?token=${token}`), { db, embedder: null });
  assert.equal(inUrl.status, 401);
  assert.equal(db.tables.memory_documents.length, 0);

  const bearer = await handleInbox(inboxRequest(payload, { authorization: `Bearer ${token}` }), { db, embedder: null });
  assert.equal(bearer.status, 201);
  const header = await handleInbox(inboxRequest({ ...payload, source_id: "rec-43" }, { "x-memory-token": token }), { db, embedder: null });
  assert.equal(header.status, 201);
  assert.equal(db.tables.memory_documents.length, 2);
  assert.equal(db.tables.memory_documents[0].added_by, "inbox");

  const get = await handleInbox(new Request(URL_, { method: "GET", headers: { authorization: `Bearer ${token}` } }), { db, embedder: null });
  assert.equal(get.status, 405);
});

test("inbox auth: rotating replaces the token, revoking turns the inbox off", async () => {
  const db = fakeMemoryDb();
  const first = await withToken(db);
  const { token: second } = await rotateInboxToken(db);
  assert.notEqual(first, second);
  assert.equal(db.tables.backend_settings.filter((r) => r.key === INBOX_SETTING_KEY).length, 1);
  const setting = db.tables.backend_settings[0].value as never;
  assert.equal(inboxTokenMatches(first, setting), false);
  assert.equal(inboxTokenMatches(second, setting), true);
  assert.equal((await handleInbox(inboxRequest(payload, { authorization: `Bearer ${first}` }), { db, embedder: null })).status, 401);
  assert.equal((await handleInbox(inboxRequest(payload, { authorization: `Bearer ${second}` }), { db, embedder: null })).status, 201);
  await revokeInboxToken(db);
  assert.equal((await handleInbox(inboxRequest(payload, { authorization: `Bearer ${second}` }), { db, embedder: null })).status, 403);
});

test("inbox: raw caption bodies take their details from the query string; size and type limits apply", async () => {
  const db = fakeMemoryDb();
  const token = await withToken(db);
  const auth = { authorization: `Bearer ${token}` };
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Me>Raw caption upload.</v>\n";
  const r = await handleInbox(
    new Request(`${URL_}?source=youtube&source_id=vid123&kind=content&title=My%20video`, { method: "POST", headers: { ...auth, "content-type": "text/vtt" }, body: vtt }),
    { db, embedder: null },
  );
  assert.equal(r.status, 201);
  const doc = db.tables.memory_documents[0];
  assert.deepEqual([doc.source, doc.source_id, doc.kind, doc.title, doc.raw_text], ["youtube", "vid123", "content", "My video", "Me: Raw caption upload."]);

  const form = new FormData();
  form.set("file", new Blob(["1\n00:00:01,000 --> 00:00:02,000\nFrom a form\n"], { type: "application/x-subrip" }), "Talk.srt");
  form.set("source", "drive");
  const f = await handleInbox(new Request(URL_, { method: "POST", headers: auth, body: form }), { db, embedder: null });
  assert.equal(f.status, 201);
  assert.equal(db.tables.memory_documents[1].title, "Talk");
  assert.equal(db.tables.memory_documents[1].raw_text, "From a form");

  const big = await handleInbox(inboxRequest({ ...payload, text: "a".repeat(MAX_BODY_BYTES + 10) }, auth), { db, embedder: null });
  assert.equal(big.status, 413);
  const declared = await handleInbox(new Request(URL_, { method: "POST", headers: { ...auth, "content-type": "application/json", "content-length": String(MAX_BODY_BYTES + 1) }, body: "{}" }), { db, embedder: null });
  assert.equal(declared.status, 413);
  const pdf = await handleInbox(new Request(URL_, { method: "POST", headers: { ...auth, "content-type": "application/pdf" }, body: "%PDF" }), { db, embedder: null });
  assert.equal(pdf.status, 415);
  const badJson = await handleInbox(new Request(URL_, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{nope" }), { db, embedder: null });
  assert.equal(badJson.status, 400);
});

// ── Idempotency ─────────────────────────────────────────────────────────────

test("idempotency: the same (source, source_id) twice is one document; changed text replaces its passages", async () => {
  const db = fakeMemoryDb();
  const a = await importDocument(db, null, input(), { addedBy: "inbox" });
  assert.equal(a.status, "created");
  const again = await importDocument(db, null, input(), { addedBy: "inbox" });
  assert.deepEqual([again.status, again.id], ["unchanged", a.id]);
  assert.equal(db.tables.memory_documents.length, 1);
  assert.equal(db.tables.memory_chunks.length, 1);
  assert.equal(db.calls.filter((c) => c === "insert memory_chunks").length, 1);

  // New title only: the row is updated, the passages are not rewritten.
  const retitled = await importDocument(db, null, input({ title: "Pricing call (edited)" }), { addedBy: "inbox" });
  assert.equal(retitled.status, "updated");
  assert.equal(db.tables.memory_documents[0].title, "Pricing call (edited)");
  assert.equal(db.calls.filter((c) => c === "insert memory_chunks").length, 1);

  // New text: same row, passages replaced.
  const changed = await importDocument(db, null, input({ text: longText(40) }), { addedBy: "inbox" });
  assert.deepEqual([changed.status, changed.id], ["updated", a.id]);
  assert.equal(db.tables.memory_documents.length, 1);
  assert.equal(db.tables.memory_chunks.length, changed.chunks);
  assert.ok(changed.chunks > 1);
  assert.deepEqual(db.tables.memory_chunks.map((c) => c.chunk_index), Array.from({ length: changed.chunks }, (_, i) => i));
  assert.equal(db.tables.memory_documents[0].chunk_count, changed.chunks);

  // A different source with the same id is a different document.
  await importDocument(db, null, input({ source: "drive" }), { addedBy: "inbox" });
  assert.equal(db.tables.memory_documents.length, 2);

  // Pasted text without a source_id: the same text is the same document.
  const p1 = buildInput({ text: "An idea worth keeping." }, { source: "paste" });
  const p2 = buildInput({ text: "An idea worth keeping.\n" }, { source: "paste" });
  assert.ok(p1.ok && p2.ok);
  if (p1.ok && p2.ok) {
    await importDocument(db, null, p1.input, { addedBy: "owner" });
    assert.equal((await importDocument(db, null, p2.input, { addedBy: "owner" })).status, "unchanged");
  }
});

test("idempotency: an import that died halfway is redone, and two arriving at once make one document", async () => {
  const db = fakeMemoryDb();
  db.failWhen = (table, op) => table === "memory_chunks" && op === "insert";
  await assert.rejects(importDocument(db, null, input(), { addedBy: "inbox" }), /passages/);
  assert.equal(db.tables.memory_documents[0].content_hash, "");
  db.failWhen = null;
  const retry = await importDocument(db, null, input(), { addedBy: "inbox" });
  assert.equal(retry.status, "updated");
  assert.equal(db.tables.memory_documents.length, 1);
  assert.equal(db.tables.memory_chunks.length, 1);
  assert.match(String(db.tables.memory_documents[0].content_hash), /^sha256:/);

  // The racing writer inserts the same document just before this one does.
  const race = fakeMemoryDb();
  race.beforeInsert = (table) => {
    if (table === "memory_documents") race.tables.memory_documents.push({ id: "racer", source: "zoom", source_id: "rec-1", title: "Pricing call", kind: "conversation", content_hash: "", chunk_count: 0, occurred_at: null, url: null, owner_speaker: null });
  };
  const r = await importDocument(race, null, input(), { addedBy: "inbox" });
  assert.deepEqual([r.status, r.id], ["updated", "racer"]);
  assert.equal(race.tables.memory_documents.length, 1);
  assert.equal(race.tables.memory_chunks.length, 1);
});

test("idempotency through the inbox: a retried webhook answers unchanged with the same id", async () => {
  const db = fakeMemoryDb();
  const token = await withToken(db);
  const send = () => handleInbox(inboxRequest(payload, { authorization: `Bearer ${token}` }), { db, embedder: null });
  const first = await send();
  const second = await send();
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  const [a, b] = [await first.json(), await second.json()];
  assert.equal(a.id, b.id);
  assert.equal(b.status, "unchanged");
  assert.equal(db.tables.memory_documents.length, 1);
});

// ── Embeddings and search fallback ──────────────────────────────────────────

test("embeddings: passages are embedded on import when AI is there, left for the backfill when it is not or fails", async () => {
  const db = fakeMemoryDb();
  const ai = fakeEmbedder();
  const r = await importDocument(db, ai, input({ text: longText(40) }), { addedBy: "owner" });
  assert.equal(r.embedded, r.chunks);
  assert.equal(r.pending_embeddings, 0);
  assert.ok(ai.calls.every((c) => c.as === "passage"));
  assert.match(String(db.tables.memory_chunks[0].embedding), /^\[1,0,0/);

  const offline = fakeMemoryDb();
  const o = await importDocument(offline, null, input({ text: longText(40) }), { addedBy: "owner" });
  assert.deepEqual([o.embedded, o.pending_embeddings], [0, o.chunks]);
  const failing = await importDocument(offline, fakeEmbedder({ fail: true }), input({ source_id: "rec-2", text: longText(20) }), { addedBy: "owner" });
  assert.equal(failing.embedded, 0);
  assert.equal(failing.status, "created");

  const before = await memoryStatus(offline);
  assert.equal(before.embedded, 0);
  const filled = await backfillEmbeddings(offline, fakeEmbedder(), 500);
  assert.equal(filled.embedded, before.chunks);
  const after = await memoryStatus(offline);
  assert.deepEqual([after.available, after.documents, after.embedded], [true, 2, after.chunks]);
});

test("workers AI embedder: batches, adds the query prefix, refuses wrong-sized vectors", async () => {
  const seen: unknown[] = [];
  const ai = { run: async (_m: string, i: unknown) => { seen.push(i); const t = (i as { text: string[] }).text; return { data: t.map(() => new Array(384).fill(0.5)) }; } };
  const e = workersAiEmbedder(ai);
  assert.equal((await e.embed(Array.from({ length: 120 }, (_, i) => `t${i}`), "passage")).length, 120);
  assert.equal(seen.length, 3);
  await e.embed(["what about pricing"], "query");
  assert.match((seen[3] as { text: string[] }).text[0], /^Represent this sentence for searching relevant passages: what about pricing$/);
  assert.equal((seen[3] as { pooling: string }).pooling, "cls");
  const bad = workersAiEmbedder({ run: async () => ({ data: [[1, 2, 3]] }) });
  await assert.rejects(bad.embed(["x"], "query"), /wrong size/);
});

test("search fallback: without AI, or when it fails, search runs on keywords; with AI it sends the question's vector", async () => {
  const db = fakeMemoryDb();
  const hit = { document_id: "d1", title: "Pricing call", kind: "conversation", source: "zoom", occurred_at: null, url: null, owner_speaker: null, chunk_index: 0, content: longText(30), score: 0.03, matched: "keywords" };
  db.rpcs.memory_search = () => ({ data: [hit], error: null });

  const none = await searchMemory(db, null, "pricing calendar");
  assert.equal(none.mode, "keywords");
  assert.equal(db.rpcCalls.at(-1)?.args?.query_embedding, null);

  const broken = await searchMemory(db, fakeEmbedder({ fail: true }), "pricing calendar");
  assert.equal(broken.mode, "keywords");
  assert.equal(db.rpcCalls.at(-1)?.args?.query_embedding, null);

  const ai = fakeEmbedder();
  const meaning = await searchMemory(db, ai, "pricing calendar", { kind: "conversation", limit: 99 });
  assert.equal(meaning.mode, "meaning+keywords");
  assert.equal(ai.calls[0].as, "query");
  const args = db.rpcCalls.at(-1)?.args;
  assert.match(String(args?.query_embedding), /^\[1,0,/);
  assert.equal(args?.kind_filter, "conversation");
  assert.equal(args?.match_count, 50);

  assert.ok(meaning.results[0].snippet.length <= 300);
  assert.match(meaning.results[0].snippet, /pricing/);
});

test("search fallback: snippets centre on the words asked about; a missing migration reads as not installed", async () => {
  const filler = "Nothing to see in this part of the conversation at all. ".repeat(20);
  const content = `${filler}Here the owner explains the refund policy for workshops in detail. ${filler}`;
  const snip = bestSnippet(content, "what is my refund policy for workshops?");
  assert.match(snip, /refund policy for workshops/);
  assert.ok(snip.startsWith("...") && snip.endsWith("..."));
  assert.equal(bestSnippet("short", "x"), "short");

  const db = fakeMemoryDb();
  delete (db.rpcs as Record<string, unknown>).memory_status;
  delete (db.rpcs as Record<string, unknown>).memory_search;
  assert.deepEqual(await memoryStatus(db), { available: false, documents: 0, chunks: 0, embedded: 0, last_import_at: null });
  await assert.rejects(searchMemory(db, null, "pricing"), /apply migration 022/);
});

test("browse: newest first, title search is literal, kind filter and paging", async () => {
  const db = fakeMemoryDb();
  for (const [id, title, kind, date] of [["a", "Old note", "note", "2025-01-01"], ["b", "100% launch call", "conversation", "2026-02-01"], ["c", "Launch video", "content", "2026-03-01"]]) {
    await importDocument(db, null, input({ source_id: id, title, kind, occurred_at: date, text: `Text ${id}` }), { addedBy: "owner" });
  }
  const all = await listDocuments(db, {});
  assert.deepEqual(all.documents.map((d) => d.title), ["Launch video", "100% launch call", "Old note"]);
  assert.equal(all.total, 3);
  assert.ok(!("raw_text" in all.documents[0]));
  assert.deepEqual((await listDocuments(db, { q: "launch" })).documents.map((d) => d.title), ["Launch video", "100% launch call"]);
  assert.deepEqual((await listDocuments(db, { q: "100%" })).documents.map((d) => d.title), ["100% launch call"]);
  assert.deepEqual((await listDocuments(db, { kind: "note" })).documents.map((d) => d.title), ["Old note"]);
  const page = await listDocuments(db, { limit: 2 });
  assert.deepEqual([page.documents.length, page.has_more], [2, true]);
});

test("agent keys: memory:read reads and asks, memory:write adds, neither deletes or reaches the inbox settings", () => {
  const read = ["memory:read"];
  const write = ["memory:write"];
  assert.ok(scopedRouteAllowed("GET", "/api/memory/documents", read));
  assert.ok(scopedRouteAllowed("GET", "/api/memory/search", read));
  assert.ok(scopedRouteAllowed("GET", "/api/memory/documents/11111111-1111-4111-8111-111111111111", read));
  assert.ok(scopedRouteAllowed("POST", "/api/memory/ask", read));
  assert.ok(!scopedRouteAllowed("POST", "/api/memory/documents", read));
  assert.ok(scopedRouteAllowed("POST", "/api/memory/documents", write));
  assert.ok(!scopedRouteAllowed("GET", "/api/memory/search", write));
  for (const scopes of [read, write]) {
    assert.ok(!scopedRouteAllowed("DELETE", "/api/memory/documents/11111111-1111-4111-8111-111111111111", scopes));
    assert.ok(!scopedRouteAllowed("GET", "/api/memory/settings", scopes));
    assert.ok(!scopedRouteAllowed("POST", "/api/memory/settings", scopes));
  }
  assert.ok(!scopedRouteAllowed("GET", "/api/memory/documents", ["brand:read"]));
});
