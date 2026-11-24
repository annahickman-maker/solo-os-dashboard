import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOfferDoc } from '../offer/types.ts';
import { focusOffer, writeOfferTarget } from './offer-link.ts';
import { heroGoal, metricNoun, setGoalCurrent, setGoalTarget } from './hero.ts';
import { newPlan } from './types.ts';

const plan = () => newPlan({ statement: 'Grow', startDate: '2026-01-01' });
const offers = () => normalizeOfferDoc({
  rungs: [{ id: 'club', name: 'Club', price_label: '$50/mo', featured: true, target_revenue_per_month_usd: 5000 }],
});

test('no focus offer: numbers come from the focus goal', () => {
  let p = plan();
  let h = heroGoal(p, null);
  assert.equal(h.source, 'focus');
  assert.equal(h.targetSet, false);
  assert.equal(h.progress, 0);
  assert.equal(h.noun, 'sales');
  p = setGoalTarget(p, 'revenue', 4000);
  p = setGoalCurrent(p, null, 'revenue', 1000);
  p = setGoalTarget(p, 'count', 40);
  p = setGoalCurrent(p, null, 'count', 30);
  h = heroGoal(p, null);
  assert.equal(h.targetSet, true);
  assert.equal(h.progress, 0.25); // revenue leads
  assert.equal(h.countCurrent, 30);
  assert.equal(setGoalTarget(p, 'revenue', 0).goal.revenueTarget, null);
  assert.equal(heroGoal(setGoalTarget(p, 'revenue', 0), null).progress, 0.75); // falls back to the count
});

test('focus offer: targets come from the offer, current values from offerProgress', () => {
  const d = offers();
  const rung = focusOffer(d);
  let p = setGoalTarget(plan(), 'revenue', 99); // ignored while an offer is the focus
  p = setGoalCurrent(p, rung, 'count', 25);
  p = setGoalCurrent(p, rung, 'revenue', 1250);
  const h = heroGoal(p, rung);
  assert.equal(h.source, 'offer');
  assert.equal(h.offerName, 'Club');
  assert.equal(h.revenueTarget, 5000);
  assert.equal(h.countTarget, 100); // 5000 / $50
  assert.equal(h.progress, 0.25);
  assert.deepEqual(p.offerProgress.club.customers, { start: 0, current: 25 });
  assert.equal(p.goal.countCurrent, 0);

  // Editing the members target writes the offer and moves the revenue with it.
  const next = writeOfferTarget(d, 'club', 'customers', 120);
  const h2 = heroGoal(p, focusOffer(next));
  assert.equal(h2.countTarget, 120);
  assert.equal(h2.revenueTarget, 6000);
});

test('revenue model is a label switch', () => {
  assert.equal(metricNoun('recurring'), 'sales');
  assert.equal(metricNoun('one-time'), 'sales');
  assert.equal(heroGoal({ ...plan(), revenueModel: 'one-time' }, null).noun, 'sales');
});
