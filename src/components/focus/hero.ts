/**
 * The Focus hero numbers: revenue and members (or sales) against the 90-day
 * target, read from one place.
 *
 *   - Focus offer set (featured offer in the `offer` document): the targets
 *     are the offer's monthly revenue goal and customers per month, the same
 *     numbers the Offer tab shows. Editing them writes to the offer
 *     (./offer-link.ts writeOfferTarget). Current values are typed by the
 *     owner and kept in the plan's offerProgress for that offer.
 *   - No focus offer: targets and current values live in the plan's goal.
 *
 * Pure functions only, so `node --test` can load this file.
 */
import type { OfferPricingRung } from '../offer/types.ts';
import { offerName, offerTargetValue, setOfferProgress, type OfferMetric } from './offer-link.ts';
import { clamp01, type FocusGoal, type FocusPlan, type RevenueModel } from './types.ts';

export type GoalMetric = 'revenue' | 'count';

export interface HeroGoal {
  /** Where the targets come from. */
  source: 'offer' | 'focus';
  rungId: string | null;
  offerName: string | null;
  model: RevenueModel;
  /** Always "sales": one generic count for every business. */
  noun: 'members' | 'sales';
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

const OFFER_METRIC: Record<GoalMetric, OfferMetric> = { revenue: 'revenue', count: 'customers' };

export function heroGoal(plan: Pick<FocusPlan, 'revenueModel' | 'goal' | 'offerProgress'>, rung: OfferPricingRung | null): HeroGoal {
  let revenueTarget: number | null;
  let countTarget: number | null;
  let revenueCurrent: number;
  let countCurrent: number;
  if (rung) {
    const p = plan.offerProgress[rung.id] ?? {};
    revenueTarget = offerTargetValue(rung, 'revenue');
    countTarget = offerTargetValue(rung, 'customers');
    revenueCurrent = p.revenue?.current ?? 0;
    countCurrent = p.customers?.current ?? 0;
  } else {
    ({ revenueTarget, countTarget, revenueCurrent, countCurrent } = plan.goal);
  }
  return {
    source: rung ? 'offer' : 'focus', rungId: rung?.id ?? null, offerName: rung ? offerName(rung) : null,
    model: plan.revenueModel, noun: metricNoun(plan.revenueModel),
    revenueTarget, revenueCurrent, countTarget, countCurrent,
    progress: ratio(revenueCurrent, revenueTarget) ?? ratio(countCurrent, countTarget) ?? 0,
    targetSet: revenueTarget !== null || countTarget !== null,
  };
}

/** Sets a current value (revenue now, members or sales now) in the plan: offerProgress when a focus offer is set, else the goal. */
export function setGoalCurrent<P extends Pick<FocusPlan, 'goal' | 'offerProgress'>>(
  plan: P, rung: OfferPricingRung | null, metric: GoalMetric, value: number,
): P {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  if (rung) return setOfferProgress(plan, rung.id, OFFER_METRIC[metric], { current: v });
  const key: keyof FocusGoal = metric === 'revenue' ? 'revenueCurrent' : 'countCurrent';
  return { ...plan, goal: { ...plan.goal, [key]: v } };
}

/** Sets a target in the plan's goal (no focus offer). 0 or less clears it. With a focus offer use writeOfferTarget instead. */
export function setGoalTarget<P extends Pick<FocusPlan, 'goal'>>(plan: P, metric: GoalMetric, value: number | null): P {
  const v = value !== null && Number.isFinite(value) && value > 0 ? value : null;
  const key: keyof FocusGoal = metric === 'revenue' ? 'revenueTarget' : 'countTarget';
  return { ...plan, goal: { ...plan.goal, [key]: v } };
}

export { OFFER_METRIC };
