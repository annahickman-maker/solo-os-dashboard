import assert from "node:assert/strict";
import test from "node:test";
import { scopedRouteAllowed } from "../api/scoped-routes.ts";
import { fakeMemoryDb } from "../memory/fake-db.ts";
import {
  AnalysisError, handleAnalyse, loadPublishedContent, MAX_DOC_CHARS, MAX_DOCUMENTS, MAX_TOTAL_CHARS,
  type Analyser, type AnalyserResult,
} from "./analyse.ts";

const NOW = new Date("2026-03-01T10:00:00.000Z");

function store(initial: unknown) {
  const s = { value: initial as unknown, writes: 0 };
  return {
    s,
    readDoc: async () => s.value,
    writeDoc: async (v: unknown) => { s.value = v; s.writes++; },
  };
}

function contentDoc(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `d${i}`, source: "paste", source_id: `s${i}`, title: `Video ${i}`, kind: "content",
    occurred_at: `2026-01-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`, created_at: "2026-01-01T00:00:00.000Z",
    raw_text: `Transcript ${i}: here is my method, step one.`, ...extra,
  };
}

const RESULT: AnalyserResult = {
  value: { score: 72, evidence: ["here is my method \u2014 step one"], suggestion: "Name step two." },
  authority: { score: 130, evidence: [], suggestion: "Share a client number." },
  pov: { score: 35, evidence: ["a", "b", "c", "d"], suggestion: "Pick an enemy." },
  connection: { score: -3, evidence: [], suggestion: "Tell your story." },
};

test("no published content: every score 0, stored, and the AI is never called", async () => {
  const db = fakeMemoryDb({ memory_documents: [{ ...contentDoc(1), kind: "conversation" }, { ...contentDoc(2), kind: "note" }] });
  const st = store({ slots: { value_method: "My method" }, wins: [{ title: "Big win", status: "confirmed" }], extra_field: "kept" });
  let calls = 0;
  const analyser: Analyser = async () => { calls++; return RESULT; };
  const res = await handleAnalyse({ db, ...st, analyser, now: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(calls, 0);
  const a = res.body.analysis as { pieces_count: number; scores: Record<string, number>; analysed_at: string };
  assert.equal(a.pieces_count, 0);
  assert.deepEqual(a.scores, { value: 0, authority: 0, pov: 0, connection: 0 });
  assert.equal(a.analysed_at, NOW.toISOString());
  const saved = st.s.value as Record<string, unknown>;
  assert.deepEqual(saved.content_analysis, a);
  assert.equal(saved.extra_field, "kept");
  assert.deepEqual(saved.slots, { value_method: "My method" });
});

test("no published content works without an Anthropic key", async () => {
  const st = store(null);
  const res = await handleAnalyse({ db: fakeMemoryDb(), ...st, analyser: null, now: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(st.s.writes, 1);
});

test("content but no key: a clear 412 and nothing stored", async () => {
  const st = store({});
  const res = await handleAnalyse({ db: fakeMemoryDb({ memory_documents: [contentDoc(1)] }), ...st, analyser: null });
  assert.equal(res.status, 412);
  assert.equal(res.body.code, "AI_KEY_MISSING");
  assert.match(String(res.body.error), /ANTHROPIC_API_KEY/);
  assert.equal(st.s.writes, 0);
});

test("normal run: sends content and source material, stores clamped scores, evidence and suggestions", async () => {
  const db = fakeMemoryDb({
    memory_documents: [contentDoc(1), contentDoc(2), { ...contentDoc(3), kind: "note", raw_text: "PRIVATE NOTE" }],
    social_posts: [
      { id: "p1", title: "Reel", caption: "Caption that was posted", status: "published", published_at: "2026-02-01T00:00:00.000Z" },
      { id: "p2", title: "Draft", caption: "DRAFT CAPTION", status: "draft", published_at: null },
    ],
  });
  const st = store({ slots: { value_method: "The Three Step Method", common_enemy: "Hustle culture" }, povs: [{ title: "Less is more" }] });
  let prompt = { system: "", user: "" };
  const analyser: Analyser = async (p) => { prompt = p; return RESULT; };
  const res = await handleAnalyse({ db, ...st, analyser, now: () => NOW });
  assert.equal(res.status, 200);
  assert.match(prompt.user, /Transcript 1/);
  assert.match(prompt.user, /Transcript 2/);
  assert.match(prompt.user, /Caption that was posted/);
  assert.doesNotMatch(prompt.user, /PRIVATE NOTE|DRAFT CAPTION/);
  assert.match(prompt.user, /The Three Step Method/);
  assert.match(prompt.user, /Hustle culture/);
  assert.match(prompt.user, /Less is more/);
  assert.match(prompt.system, /PUBLISHED PIECES ONLY/);
  const a = (st.s.value as { content_analysis: { pieces_count: number; scores: Record<string, number>; evidence: Record<string, string[]>; suggestions: Record<string, string> } }).content_analysis;
  assert.equal(a.pieces_count, 3);
  assert.deepEqual(a.scores, { value: 72, authority: 100, pov: 35, connection: 0 });
  assert.deepEqual(a.evidence.value, ["here is my method - step one"]);
  assert.equal(a.evidence.pov.length, 3);
  assert.equal(a.suggestions.authority, "Share a client number.");
  assert.deepEqual(res.body.analysis, a);
});

test("an analyser error comes back with its status and stores nothing", async () => {
  const st = store({});
  const analyser: Analyser = async () => { throw new AnalysisError("Anthropic is rate limiting requests right now.", 429); };
  const res = await handleAnalyse({ db: fakeMemoryDb({ memory_documents: [contentDoc(1)] }), ...st, analyser });
  assert.equal(res.status, 429);
  assert.equal(st.s.writes, 0);
});

test("missing memory schema is a 503", async () => {
  const broken = { from: () => {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "relation does not exist", code: "42P01" } }).then(ok) };
    return q;
  } };
  const res = await handleAnalyse({ db: broken as never, ...store({}), analyser: null });
  assert.equal(res.status, 503);
});

test("content is bounded: newest documents first, per-piece and total limits", async () => {
  const docs = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, i) => contentDoc(i + 1, { raw_text: "x".repeat(MAX_DOC_CHARS * 2) }));
  const pieces = await loadPublishedContent(fakeMemoryDb({ memory_documents: docs }));
  assert.ok(pieces.length <= MAX_DOCUMENTS);
  assert.equal(pieces[0].title, `Video ${MAX_DOCUMENTS + 5}`);
  assert.ok(pieces.every((p) => p.text.length <= MAX_DOC_CHARS + 10));
  assert.ok(pieces.reduce((n, p) => n + p.text.length, 0) <= MAX_TOTAL_CHARS + 10);
});

test("agent keys need brand:write for the analyse route", () => {
  assert.equal(scopedRouteAllowed("POST", "/api/reputation/analyse", ["brand:write"]), true);
  assert.equal(scopedRouteAllowed("POST", "/api/reputation/analyse", ["brand:read", "memory:read"]), false);
  assert.equal(scopedRouteAllowed("GET", "/api/reputation/analyse", ["brand:write"]), false);
});
