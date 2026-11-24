/** Revenue goal for the 90 days in major units (a monthly target counts three times). */
export function revenueGoalFor90(target: number | null, recurring: boolean): number | null {
  if (!target || target <= 0) return null;
  return recurring ? target * 3 : target;
}

export function goalPercent(revenueMinor: number, goal: number | null): string {
  if (!goal) return '';
  const pct = (revenueMinor / 100 / goal) * 100;
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}% of goal`;
}

