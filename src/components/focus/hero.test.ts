import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOfferDoc } from '../offer/types.ts';
import { focusOffer, writeOfferPrice, writeOfferTarget } from './offer-link.ts';
import { revenueGoalFor90 } from './offer-funnel-goal.ts';
import { heroGoal, metricNoun, setGoalTarget } from './hero.ts';
import { newPlan, normalizeFocusDoc } from './types.ts';

const plan = () => newPlan({ statement: 'Grow', startDate: '2026-01-01' });
const offers = () => normalizeOfferDoc({
  rungs: [{ id: 'club', name: 'Club', price_label: '$50/mo', featured: true, target_revenue_per_month_usd: 5000 }],
});

test('no focus offer, recurring: revenue goal is members x monthly price, three months for the 90 days', () => {
  let p = plan();
  let h = heroGoal(p, null);
  assert.equal(h.source, 'focus');
  assert.equal(h.targetSet, false);
  assert.equal(h.progress, 0);
  assert.equal(h.noun, 'sales');
  p = setGoalTarget(p, 'count', 40);
  p = setGoalTarget(p, 'price', 25);
  h = heroGoal(p, null);
  assert.equal(h.targetSet, true);
  assert.equal(h.price, 25);
  assert.equal(h.countTarget, 40);
  assert.equal(h.revenueTarget, 1000);
  assert.equal(p.goal.revenueTarget, 1000); // stored too, for past plans
  assert.equal(revenueGoalFor90(h.revenueTarget, h.model === 'recurring'), 3000);
  // Clearing the price clears the revenue goal; the count stays.
  const noPrice = setGoalTarget(p, 'price', 0);
  assert.equal(noPrice.goal.price, null);
  assert.equal(heroGoal(noPrice, null).revenueTarget, null);
  assert.equal(heroGoal(noPrice, null).countTarget, 40);
});

test('no focus offer, one-time: revenue goal is sales x price, counted once', () => {
  let p = { ...plan(), revenueModel: 'one-time' as const };
  p = setGoalTarget(p, 'price', 497);
  p = setGoalTarget(p, 'count', 10);
  const h = heroGoal(p, null);
  assert.equal(h.revenueTarget, 4970);
  assert.equal(revenueGoalFor90(h.revenueTarget, h.model === 'recurring'), 4970);
});

test('legacy focus goal without a price keeps its typed revenue target', () => {
  const doc = normalizeFocusDoc({ current: { startDate: '2026-01-01', goal: { revenueTarget: 4000, countTarget: 40 } } });
  const p = doc.current!;
  assert.equal(p.goal.price, null);
  assert.equal(heroGoal(p, null).revenueTarget, 4000);
  assert.equal(heroGoal(setGoalTarget(p, 'count', 50), null).revenueTarget, 4000); // still no price
  assert.equal(heroGoal(setGoalTarget(p, 'price', 120), null).revenueTarget, 4800); // a price takes over
  const priced = normalizeFocusDoc({ current: { startDate: '2026-01-01', goal: { revenueTarget: 1, countTarget: 3, price: 10 } } });
  assert.equal(priced.current!.goal.revenueTarget, 30);
});

test('focus offer: price and number are the offer price and target customers', () => {
  const d = offers();
  const rung = focusOffer(d);
  const p = setGoalTarget(plan(), 'count', 99); // ignored while an offer is the focus
  const h = heroGoal(p, rung);
  assert.equal(h.source, 'offer');
  assert.equal(h.offerName, 'Club');
  assert.equal(h.price, 50);
  assert.equal(h.countTarget, 100); // 5000 / $50
  assert.equal(h.revenueTarget, 5000);

  // Editing the number writes the offer and moves the revenue with it.
  const next = writeOfferTarget(d, 'club', 'customers', 120);
  const h2 = heroGoal(p, focusOffer(next));
  assert.equal(h2.countTarget, 120);
  assert.equal(h2.revenueTarget, 6000);

  // Editing the price writes the offer's price label; the number stays.
  const repriced = writeOfferPrice(next, 'club', 60, true);
  assert.equal(repriced.rungs[0].price_label, '$60/mo');
  assert.equal(repriced.rungs[0].target_revenue_per_month_usd, 7200);
  const h3 = heroGoal(p, focusOffer(repriced));
  assert.equal(h3.price, 60);
  assert.equal(h3.countTarget, 120);
  assert.equal(h3.revenueTarget, 7200);
  assert.equal(revenueGoalFor90(h3.revenueTarget, true), 21600);
});

test('focus offer: one-time price and the goal price label', () => {
  const d = normalizeOfferDoc({ rungs: [{ id: 'c', name: 'Course', price_label: '$97 once', goal_price_label: '$197', featured: true }] });
  let next = writeOfferTarget(d, 'c', 'customers', 10);
  next = writeOfferPrice(next, 'c', 297, false);
  const r = next.rungs[0];
  assert.equal(r.goal_price_label, '$297'); // the price in effect is the goal price
  assert.equal(r.price_label, '$97 once');
  const h = heroGoal({ ...plan(), revenueModel: 'one-time' }, focusOffer(next));
  assert.equal(h.price, 297);
  assert.equal(h.countTarget, 10);
  assert.equal(h.revenueTarget, 2970);
  assert.equal(revenueGoalFor90(h.revenueTarget, false), 2970);
  // A price on an offer with none yet.
  const blank = normalizeOfferDoc({ rungs: [{ id: 'x', name: 'X', featured: true }] });
  assert.equal(writeOfferPrice(blank, 'x', 40, true).rungs[0].price_label, '$40/mo');
  assert.equal(writeOfferPrice(blank, 'x', 40, false).rungs[0].price_label, '$40');
});

test('revenue model is a label switch', () => {
  assert.equal(metricNoun('recurring'), 'sales');
  assert.equal(metricNoun('one-time'), 'sales');
  assert.equal(heroGoal({ ...plan(), revenueModel: 'one-time' }, null).noun, 'sales');
});
