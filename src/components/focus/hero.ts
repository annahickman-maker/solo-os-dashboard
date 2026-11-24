/**
 * The Focus hero numbers: revenue and members (or sales) against the 90-day
 * target, read from one place. The owner sets a number (members or sales)
 * and a price; the revenue goal is number x price (monthly for recurring).
 *
 *   - Focus offer set (featured offer in the `offer` document): the price is
 *     the offer's price (goal price when set) and the number is its target
 *     customers, the same numbers the Offer tab shows. Editing them writes to
 *     the offer (./offer-link.ts writeOfferPrice, writeOfferTarget).
 *   - No focus offer: price and number live in the plan's goal.
 *
 * Current values used to be typed here; actuals now come from Sales.
 *
 * Pure functions only, so `node --test` can load this file.
 */
import type { OfferPricingRung } from '../offer/types.ts';
import { offerName, offerPrice, offerTargetValue } from './offer-link.ts';
import { clamp01, goalRevenue, type FocusGoal, type FocusPlan, type RevenueModel } from './types.ts';

/** What the Set target panel edits: the number of members or sales, and the price. */
export type TargetField = 'count' | 'price';

export interface HeroGoal {
  /** Where the targets come from. */
  source: 'offer' | 'focus';
  rungId: string | null;
  offerName: string | null;
  model: RevenueModel;
  /** Always "sales": one generic count for every business. */
  noun: 'members' | 'sales';
  /** Price of membership per month (recurring) or price per sale (one-time). */
  price: number | null;
  /** number x price (monthly for recurring); legacy typed value when no price. */
  revenueTarget: number | null;
  revenueCurrent: number;
  countTarget: number | null;
  countCurrent: number;
  /** current / target, 0..1: revenue when it has a target, else the count. */
  progress: number;
  /** A revenue or count target exists (the "set target" pill turns green). */
  targetSet: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function metricNoun(model: RevenueModel): 'members' | 'sales' {
  return 'sales';
}

const ratio = (current: number, target: number | null) => (target && target > 0 ? clamp01(current / target) : null);

export function heroGoal(plan: Pick<FocusPlan, 'revenueModel' | 'goal' | 'offerProgress'>, rung: OfferPricingRung | null): HeroGoal {
  let price: number | null;
  let revenueTarget: number | null;
  let countTarget: number | null;
  let revenueCurrent: number;
  let countCurrent: number;
  if (rung) {
    const p = plan.offerProgress[rung.id] ?? {};
    price = offerPrice(rung);
    countTarget = offerTargetValue(rung, 'customers');
    revenueTarget = price && countTarget ? goalRevenue(price, countTarget, null) : offerTargetValue(rung, 'revenue');
    revenueCurrent = p.revenue?.current ?? 0;
    countCurrent = p.customers?.current ?? 0;
  } else {
    ({ price, countTarget, revenueCurrent, countCurrent } = plan.goal);
    revenueTarget = goalRevenue(price, countTarget, plan.goal.revenueTarget);
  }
  return {
    source: rung ? 'offer' : 'focus', rungId: rung?.id ?? null, offerName: rung ? offerName(rung) : null,
    model: plan.revenueModel, noun: metricNoun(plan.revenueModel),
    price, revenueTarget, revenueCurrent, countTarget, countCurrent,
    progress: ratio(revenueCurrent, revenueTarget) ?? ratio(countCurrent, countTarget) ?? 0,
    targetSet: revenueTarget !== null || countTarget !== null,
  };
}

/**
 * Sets the number (members or sales) or the price in the plan's goal (no
 * focus offer) and keeps revenueTarget = price x number. 0 or less clears it.
 * With a focus offer use writeOfferTarget / writeOfferPrice instead.
 */
export function setGoalTarget<P extends Pick<FocusPlan, 'goal'>>(plan: P, field: TargetField, value: number | null): P {
  const v = value !== null && Number.isFinite(value) && value > 0 ? value : null;
  const goal: FocusGoal = { ...plan.goal, [field === 'price' ? 'price' : 'countTarget']: v };
  if (field === 'price' && v === null) goal.revenueTarget = null; // the old price x number no longer holds
  return { ...plan, goal: { ...goal, revenueTarget: goalRevenue(goal.price, goal.countTarget, goal.revenueTarget) } };
}
