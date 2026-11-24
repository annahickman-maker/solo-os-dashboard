/**
 * The "Client pipeline" flow cards on /crm/analytics: contacts as a flow of
 * Contacts, Nurture, Pipeline and Revenue, from GET /api/crm/dashboard.
 * Pure, so the rules are tested without a browser.
 *
 * The whole section shows only when the Client pipeline module (`pipeline`
 * in the `nav` document) is on. Inside it, Contacts needs `leads` and
 * Nurture (and the email counts) needs `email`.
 *
 * Every number fills itself: contacts from site forms, checkout and
 * bookings; nurture from workflow enrolments; open deals (by stage) from
 * the auto-deal rules and workflow stage moves; won deals when a deal is
 * marked won.
 *
 * Revenue is this month: deals won this month, plus paid orders from Sales
 * (net of refunds) when the Sales module is on. Deal values are in the home
 * currency; paid orders in another currency are listed beside it, never
 * added in.
 */
import { DEFAULT_CURRENCY, formatMinor } from "../money/money.ts";
import type { PaidTotal } from "../money/totals.ts";

export type FlowModules = { leads: boolean; email: boolean; pipeline: boolean; sales: boolean };

export type DashboardCounts = {
  total_leads: number;
  new_this_week: number;
  active_enrollments: number;
  emails_7d: number;
  open_tasks: number;
  open_opportunities: number;
  pipeline_value_cents: number;
  pipeline_estimate_cents: number;
  won_total_cents: number;
  won_this_month_cents: number;
  won_deals: number;
  won_this_month_deals?: number;
};

/** Open deals in one stage, in pipeline order. */
export type StageCount = { stage: string; count: number };

export type FlowDashboard = {
  counts: DashboardCounts;
  open_by_stage?: StageCount[];
  paid_this_month?: PaidTotal[];
  home_currency?: string;
};

export type FlowCard = { key: string; href: string; label: string; value: string; sub: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line about the week, with the parts for switched-off modules left out ("" when none apply). */
export function statusSentence(c: DashboardCounts, modules: FlowModules): string {
  const parts: string[] = [];
  if (modules.leads) parts.push(`${plural(c.new_this_week, 'new contact')} this week`);
  if (modules.email) parts.push(`${plural(c.emails_7d, 'email')} sent in the last 7 days`);
  if (modules.leads || modules.email) parts.push(c.open_tasks ? `${plural(c.open_tasks, 'open task')}` : 'no open tasks');
  if (!parts.length) return '';
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

/** Revenue this month: won deals plus paid orders, in the home currency. */
export function revenueThisMonth(d: FlowDashboard): { currency: string; total_minor: number; orders: number; deals: number; other: PaidTotal[] } {
  const currency = d.home_currency || DEFAULT_CURRENCY;
  const paid = d.paid_this_month ?? [];
  const home = paid.find((t) => t.currency === currency);
  const other = paid.filter((t) => t.currency !== currency && t.count > 0);
  return {
    currency,
    total_minor: (d.counts.won_this_month_cents || 0) + (home?.total_minor ?? 0),
    orders: paid.reduce((n, t) => n + t.count, 0),
    deals: d.counts.won_this_month_deals ?? 0,
    other,
  };
}

/**
 * Open deals per stage, in stage order (position, then name), one line per
 * stage name; stages with no open deals are left out. A deal whose stage is
 * unknown counts as "No stage".
 */
export function stageBreakdown(
  open: { stage_id: string | null }[],
  stages: { id: string; name: string; position: number }[]
): StageCount[] {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const counts = new Map<string, { count: number; position: number }>();
  for (const o of open) {
    const s = o.stage_id ? byId.get(o.stage_id) : undefined;
    const name = s?.name ?? 'No stage';
    const position = s?.position ?? Number.MAX_SAFE_INTEGER;
    const seen = counts.get(name);
    if (seen) {
      seen.count++;
      seen.position = Math.min(seen.position, position);
    } else counts.set(name, { count: 1, position });
  }
  return [...counts.entries()]
    .sort((a, b) => a[1].position - b[1].position || a[0].localeCompare(b[0]))
    .map(([stage, v]) => ({ stage, count: v.count }));
}

/** "New 2, Call Booked 1" (the first few stages), or "" when there are none. */
export function stageLine(stages: StageCount[] | undefined, max = 3): string {
  if (!stages?.length) return '';
  const shown = stages.slice(0, max).map((s) => `${s.stage} ${s.count}`);
  const rest = stages.slice(max).reduce((n, s) => n + s.count, 0);
  return shown.join(', ') + (rest ? `, +${rest} more` : '');
}

/** The flow cards, left to right; none when the Client pipeline module is off. */
export function flowCards(d: FlowDashboard | null | undefined, modules: FlowModules): FlowCard[] {
  if (!modules.pipeline) return [];
  const c = d?.counts;
  const currency = d?.home_currency || DEFAULT_CURRENCY;
  const money = (minor: number) => formatMinor(minor, currency);
  const cards: FlowCard[] = [];
  if (modules.leads) {
    cards.push({
      key: 'contacts', href: '/crm/leads', label: 'Contacts',
      value: c ? String(c.total_leads) : '-', sub: c ? `+${c.new_this_week} new this week` : '',
    });
  }
  if (modules.email) {
    cards.push({
      key: 'nurture', href: '/crm/workflows', label: 'Nurture',
      value: c ? String(c.active_enrollments) : '-', sub: c ? `in sequences, ${plural(c.emails_7d, 'email')} in 7 days` : '',
    });
  }
  {
    const estimated = !!c && c.pipeline_estimate_cents > c.pipeline_value_cents;
    const stages = stageLine(d?.open_by_stage);
    cards.push({
      key: 'pipeline', href: '/crm/pipeline', label: 'Pipeline',
      value: !c ? '-'
        : estimated ? `~${money(c.pipeline_estimate_cents)}`
          : c.pipeline_value_cents > 0 ? money(c.pipeline_value_cents) : String(c.open_opportunities),
      sub: !c ? ''
        : stages ? stages
          : estimated ? `${plural(c.open_opportunities, 'open deal')}, estimated`
            : c.pipeline_value_cents > 0 ? plural(c.open_opportunities, 'open deal') : 'open deals, no values set yet',
    });
  }
  // Revenue: won deals always; paid orders only when the Sales module is on.
  const revenueHref = modules.sales ? '/sales' : '/crm/pipeline';
  if (!d || !c) {
    cards.push({ key: 'revenue', href: revenueHref, label: 'Revenue this month', value: '-', sub: '' });
  } else {
    const r = revenueThisMonth(modules.sales ? d : { ...d, paid_this_month: [] });
    const others = r.other.map((t) => formatMinor(t.total_minor, t.currency)).join(', ');
    cards.push({
      key: 'revenue', href: revenueHref, label: 'Revenue this month',
      value: formatMinor(r.total_minor, r.currency),
      sub: modules.sales
        ? `${plural(r.deals, 'deal')} won, ${plural(r.orders, 'order')} paid${others ? `, plus ${others}` : ''}`
        : `${plural(r.deals, 'deal')} won`,
    });
  }
  return cards;
}
