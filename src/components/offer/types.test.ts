import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OFFER_DOC, currentPhase, derivedCustomers, emptyRung, normalizeOfferDoc, offerScore, parsePriceLabel,
  proofCompletion, validationCompletion, VALIDATION_PHASES,
} from './types.ts';

test('empty or junk input becomes the default document', () => {
  for (const raw of [null, 'x', [], {}]) {
    const doc = normalizeOfferDoc(raw);
    assert.deepEqual({ ...doc, updated_at: undefined }, { ...DEFAULT_OFFER_DOC, updated_at: undefined });
  }
});

test('rungs are coerced and only one stays featured', () => {
  const doc = normalizeOfferDoc({
    rungs: [
      { id: 'a', name: 'Course', status: 'nope', tier: 'mid', featured: true, scores: { avatar: [5, 9, '3'] } },
      { id: 'b', name: 'Coaching', featured: true },
    ],
    emails: [{ subject: 'no offer' }, { rung_id: 'a', subject: 'Doors close', kind: 'launch' }],
  });
  assert.equal(doc.rungs[0].status, 'idea');
  assert.equal(doc.rungs[0].tier, 'mid');
  assert.deepEqual(doc.rungs[0].scores.avatar, [5, 0, 3, 0, 0]);
  assert.deepEqual(doc.rungs.map((r) => r.featured), [true, false]);
  assert.equal(doc.emails.length, 1);
  assert.equal(doc.emails[0].kind, 'launch');
});

test('score is the stage-weighted average of rated answers', () => {
  const rung = emptyRung({ status: 'iterating' });
  assert.equal(offerScore(rung).value, 0);
  for (const s of ['avatar', 'pricing', 'proof', 'validation', 'content'] as const) rung.scores[s] = [5, 0, 0, 0, 0];
  assert.equal(Math.round(offerScore(rung).value * 100), 100);
});

test('price helpers', () => {
  assert.equal(parsePriceLabel('$1,497 once'), 1497);
  assert.equal(parsePriceLabel('free'), null);
  assert.equal(derivedCustomers({ price_label: '$47/mo', goal_price_label: '$100', target_revenue_per_month_usd: 5000 }), 50);
  assert.equal(derivedCustomers({ price_label: '$47', goal_price_label: '', target_revenue_per_month_usd: null }), null);
});

test('validation and proof progress', () => {
  const rung = emptyRung();
  assert.equal(currentPhase(rung), 'idea');
  rung.validation_checks = VALIDATION_PHASES[0].checks.map((c) => c.id);
  assert.equal(currentPhase(rung), 'validating');
  assert.equal(validationCompletion(rung), 0.2);
  rung.promise = 'Your first 10 clients in 90 days';
  rung.pinned_proof_ids = ['a', 'b', 'c'];
  assert.equal(proofCompletion(rung), 1);
});
