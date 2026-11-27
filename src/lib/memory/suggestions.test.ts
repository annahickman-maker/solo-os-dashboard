import { test } from "node:test";
import assert from "node:assert/strict";
import { audienceDigest, cleanQuestions, writeSuggestions } from "./suggestions.ts";

const playbook = {
  meta: { selectedAudience: { title: "Creators with an unpaid audience" } },
  audienceResearch: {
    audienceState: { currentState: "Income tied to posting", desiredState: "One offer that sells" },
    painPoints: [{ pain: "Audience exists, income doesn't", realQuotes: [{ text: "21k subs, $350 revenue" }] }],
    languageMap: { painPhrases: ["content treadmill"] },
    urgencyGateway: { failedSolutions: ["Posting more often"] },
  },
  focusGroupInsights: { directQuotes: [{ quote: "Nothing is working." }], desireStatements: ["A two-hour day"] },
};
const six = ["Why isn't my audience paying me?", "What should I sell first?", "How do I stop the treadmill?", "How do I price my offer?", "How do I launch small?", "How do I stay consistent?"];

test("suggestions: the digest carries pains, their words, desires and failed fixes", () => {
  const d = audienceDigest(playbook);
  for (const s of ["Audience exists, income doesn't", "21k subs", "content treadmill", "Nothing is working.", "A two-hour day", "Posting more often", "Creators with an unpaid audience"]) assert.ok(d.includes(s), s);
  assert.equal(audienceDigest({}), "");
  assert.equal(audienceDigest(null), "");
});

test("suggestions: six distinct questions or nothing", () => {
  assert.deepEqual(cleanQuestions({ questions: [...six, "extra one here"] }), six);
  assert.equal(cleanQuestions({ questions: [...six.slice(0, 5), six[0]] }), null, "duplicates do not count");
  assert.equal(cleanQuestions({ questions: "no" }), null);
});

test("suggestions: Claude's reply is read; an empty digest or refusal gives nothing", async () => {
  let sent: unknown = null;
  const client = (reply: unknown) => ({ create: async (p: unknown) => { sent = p; return reply; } });
  const ok = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ questions: six }) }] };
  assert.deepEqual(await writeSuggestions("Pain points:\n- x", client(ok)), six);
  assert.match(JSON.stringify(sent), /Audience research/);
  assert.equal(await writeSuggestions("  ", client(ok)), null);
  assert.equal(await writeSuggestions("x", client({ stop_reason: "refusal", content: [] })), null);
  assert.equal(await writeSuggestions("x", client({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] })), null);
});
