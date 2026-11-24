import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REPUTATION_DOC, DEFAULT_STORY_ACTIONS, buildCompletion, deriveCompressed, dimensionScore, isReputationEmpty,
  normalizeReputationDoc, overallScore,
} from './types.ts';

test('empty or junk input becomes the default document', () => {
  for (const raw of [null, undefined, 'x', 42, [], {}]) {
    const doc = normalizeReputationDoc(raw);
    assert.deepEqual({ ...doc, updated_at: undefined }, { ...DEFAULT_REPUTATION_DOC, updated_at: undefined });
    assert.equal(isReputationEmpty(doc), true);
    assert.equal(overallScore(doc), 0);
  }
});

test('keeps valid entries, drops blank ones and coerces fields', () => {
  const doc = normalizeReputationDoc({
    transformation_anchor: { positioning_statement: 'I help X do Y' },
    slots: { value_method: 'The method', hours_on_transformation: '12', unknown_slot: 'ignored' },
    wins: [{ id: 'w1', title: '41K subscribers', kind: 'own', status: 'confirmed' }, { title: '' }, { title: 'Client A', kind: 'client', status: 'weird' }],
    micro_stories: [{ text: 'The day I quit', status: 'candidate' }],
    story_actions: [],
  });
  assert.equal(doc.transformation_anchor.positioning_statement, 'I help X do Y');
  assert.equal(doc.slots.hours_on_transformation, 12);
  assert.equal('unknown_slot' in doc.slots, false);
  assert.equal(doc.wins.length, 2);
  assert.equal(doc.wins[1].status, 'confirmed');
  assert.ok(doc.wins[1].id);
  assert.equal(doc.micro_stories[0].status, 'candidate');
  assert.deepEqual(doc.story_actions, []);
  assert.equal(isReputationEmpty(doc), false);
});

test('missing story actions fall back to the defaults', () => {
  assert.deepEqual(normalizeReputationDoc({}).story_actions, DEFAULT_STORY_ACTIONS);
});

test('a fully filled-in tab with no analysis still scores 0', () => {
  const full = normalizeReputationDoc({
    slots: { value_method: 'a', value_method_result: 'b', value_step_1: '1', value_step_2: '2', value_step_3: '3', value_step_4: '4', value_step_5: '5' },
    teaching_frameworks: Array.from({ length: 20 }, (_, i) => ({ text: `t${i}` })),
    wins: Array.from({ length: 10 }, (_, i) => ({ title: `w${i}`, status: 'confirmed' })),
  });
  assert.equal(full.content_analysis, null);
  assert.equal(dimensionScore(full, 'value'), 0);
  assert.equal(dimensionScore(full, 'authority'), 0);
  assert.equal(overallScore(full), 0);
  // The filled-in indicator is separate from the score.
  assert.equal(buildCompletion(full, 'value'), 1);
  assert.equal(buildCompletion(full, 'authority'), 1);
});

test('scores come from the stored analysis, clamped to 0-100', () => {
  const doc = normalizeReputationDoc({
    content_analysis: {
      analysed_at: '2026-01-01T00:00:00.000Z', pieces_count: 4,
      scores: { value: 80, authority: '40', pov: 250, connection: -5 },
      evidence: { value: ['quote one', 3, ''], authority: 'nope' },
      suggestions: { value: 'Teach step two', pov: 7 },
    },
  });
  const a = doc.content_analysis!;
  assert.deepEqual(a.scores, { value: 80, authority: 40, pov: 100, connection: 0 });
  assert.deepEqual(a.evidence.value, ['quote one']);
  assert.deepEqual(a.evidence.authority, []);
  assert.equal(a.suggestions.value, 'Teach step two');
  assert.equal(dimensionScore(doc, 'value'), 80);
  assert.equal(dimensionScore(doc, 'point_of_view'), 100);
  assert.equal(dimensionScore(doc, 'connection'), 0);
  assert.equal(overallScore(doc), 55);
});

test('an analysis of zero published pieces scores 0 whatever it says', () => {
  const doc = normalizeReputationDoc({ content_analysis: { pieces_count: 0, scores: { value: 90, authority: 90, pov: 90, connection: 90 } } });
  assert.equal(overallScore(doc), 0);
  assert.equal(normalizeReputationDoc({ content_analysis: 'junk' }).content_analysis, null);
});

test('the 30-second version keeps whole sentences under 280 characters', () => {
  assert.equal(deriveCompressed(null), '');
  const long = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const out = deriveCompressed(long);
  assert.ok(out.length <= 280 && out.endsWith('.'));
});
