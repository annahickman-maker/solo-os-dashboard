import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyRung, derivedCustomers, normalizeOfferDoc, type OfferDoc } from '../offer/types.ts';
import {
  allTargets, deriveOfferTargets, focusOffer, hasOfferTargets, isOfferTarget, offerTargetId, setFocusOffer,
  setOfferProgress, writeOfferTarget,
} from './offer-link.ts';
import { newPlan, normalizeFocusDoc, overallProgress } from './types.ts';

const doc = (): OfferDoc => normalizeOfferDoc({
  rungs: [
    { id: 'course', name: 'Course', price_label: '$97', featured: true, target_revenue_per_month_usd: 4850 },
    { id: 'club', name: 'Club', price_label: '$19.99/mo' },
    { id: 'bare', name: '' },
  ],
});
const plan = () => newPlan({ statement: 'Grow', startDate: '2026-01-01', targets: [{ id: 'm', label: 'Subs', unit: '', start: 0, current: 50, target: 100 }] });

test('no offer: no focus offer and only the owner targets', () => {
  const empty = normalizeOfferDoc(null);
  assert.equal(focusOffer(empty), null);
  assert.equal(focusOffer(null), null);
  assert.deepEqual(deriveOfferTargets(plan(), null), []);
  assert.deepEqual(allTargets(plan(), null).map((t) => t.id), ['m']);
  assert.equal(hasOfferTargets(null), false);
});

test('offer without targets adds nothing', () => {
  const d = setFocusOffer(doc(), 'bare');
  const rung = focusOffer(d);
  assert.equal(rung?.id, 'bare');
  assert.equal(hasOfferTargets(rung), false);
  assert.deepEqual(deriveOfferTargets(plan(), rung), []);
});

test('offer with targets becomes the primary targets, progress from the focus plan', () => {
  const rung = focusOffer(doc());
  const p = setOfferProgress(plan(), 'course', 'revenue', { current: 2425 });
  const targets = deriveOfferTargets(p, rung);
  assert.deepEqual(targets.map((t) => [t.id, t.unit, t.start, t.current, t.target]), [
    [offerTargetId('course', 'revenue'), '$', 0, 2425, 4850],
    [offerTargetId('course', 'customers'), 'customers', 0, 0, 50],
  ]);
  assert.ok(targets.every(isOfferTarget));
  const all = allTargets(p, rung);
  assert.equal(all[0].id, offerTargetId('course', 'revenue'));
  assert.equal(all[2].id, 'm');
  assert.equal(isOfferTarget(all[2]), false);
  // (0.5 + 0 + 0.5) / 3
  assert.equal(overallProgress({ targets: all, milestones: [] }), 1 / 3);
});

test('switching the focus offer keeps one featured and each offer its own progress', () => {
  let d = doc();
  let p = setOfferProgress(plan(), 'course', 'revenue', { current: 1000 });
  d = setFocusOffer(d, 'club');
  assert.deepEqual(d.rungs.map((r) => r.featured), [false, true, false]);
  assert.deepEqual(deriveOfferTargets(p, focusOffer(d)), []);
  d = writeOfferTarget(d, 'club', 'customers', 3);
  const club = focusOffer(d)!;
  assert.equal(club.target_customers_per_month, 3);
  assert.equal(derivedCustomers(club), 3, 'revenue is set so the Offer tab derives the same customers');
  p = setOfferProgress(p, 'club', 'customers', { current: 1 });
  assert.equal(deriveOfferTargets(p, club).find((t) => t.metric === 'customers')?.current, 1);
  d = setFocusOffer(d, 'course');
  assert.equal(deriveOfferTargets(p, focusOffer(d))[0].current, 1000);
  assert.equal(setFocusOffer(d, 'missing'), d);
  assert.ok(setFocusOffer(d, null).rungs.every((r) => !r.featured));
});

test('writing a revenue target updates the offer and its derived customers', () => {
  const d = writeOfferTarget(doc(), 'course', 'revenue', 9700);
  const rung = d.rungs[0];
  assert.equal(rung.target_revenue_per_month_usd, 9700);
  assert.equal(rung.target_customers_per_month, 100);
  const cleared = writeOfferTarget(d, 'course', 'revenue', 0).rungs[0];
  assert.equal(cleared.target_revenue_per_month_usd, null);
  const noPrice = writeOfferTarget(normalizeOfferDoc({ rungs: [emptyRung({ id: 'x' })] }), 'x', 'customers', 12).rungs[0];
  assert.equal(noPrice.target_customers_per_month, 12);
  assert.equal(noPrice.target_revenue_per_month_usd, null);
});

test('offerProgress survives a save round trip', () => {
  const p = setOfferProgress(plan(), 'course', 'revenue', { start: 100, current: 300 });
  const back = normalizeFocusDoc(JSON.parse(JSON.stringify({ version: 1, current: p, archive: [] })));
  assert.deepEqual(back.current?.offerProgress, { course: { revenue: { start: 100, current: 300 } } });
  assert.deepEqual(normalizeFocusDoc({ current: { statement: 'x', offerProgress: [1, 2] } }).current?.offerProgress, {});
});
