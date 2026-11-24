'use client';
/**
 * Content counters, ported from the Solo OS YearGrid and MonthGrid.
 * YearGrid: one cell per week for the last 52 weeks (current week last).
 * MonthGrid: one row per month, one cell per day, current month at the bottom.
 * Data: src/components/focus/publishing.ts.
 */
import { cadenceLabel, type MonthCount, type WeekCount } from './publishing';

const MONTH_LABELS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function cellClass(count: number, perWeek: number): string {
  if (count <= 0) return 'focus-cell';
  return count >= Math.max(1, perWeek) ? 'focus-cell on' : 'focus-cell part';
}

export function YearGrid({ weeks, perWeek }: { weeks: WeekCount[]; perWeek: number }) {
  const posted = weeks.filter((w) => w.count > 0).length;
  const total = weeks.reduce((s, w) => s + w.count, 0);
  const ticks = weeks.map((w, i) => {
    const m = Number(w.start.slice(5, 7)) - 1;
    const prev = i > 0 ? Number(weeks[i - 1].start.slice(5, 7)) - 1 : -1;
    return m !== prev && i < weeks.length - 2 ? MONTH_LABELS[m] : '';
  });
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px] text-zinc-400">
        <span>{posted} {posted === 1 ? 'week' : 'weeks'} you posted in the last year{total > posted ? `, ${total} videos` : ''}</span>
        <span>target: {cadenceLabel(perWeek)}</span>
      </div>
      <div className="focus-weeks" role="img" aria-label={`${posted} of the last ${weeks.length} weeks had a published video`}>
        {weeks.map((w) => (
          <span key={w.start} className={cellClass(w.count, perWeek)} title={`week of ${w.start}${w.count ? `, ${w.count} published` : ''}`} />
        ))}
      </div>
      <div className="focus-weeks ticks" aria-hidden>
        {ticks.map((t, i) => <span key={i}>{t}</span>)}
      </div>
    </div>
  );
}

export function MonthGrid({ months, perWeek, thisWeek, shown = 4 }: {
  months: MonthCount[]; perWeek: number; thisWeek: number; shown?: number;
}) {
  const rows = months.slice(-shown);
  const total = rows.reduce((s, m) => s + m.total, 0);
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px] text-zinc-400">
        <span>{total} {total === 1 ? 'post' : 'posts'} in the last {rows.length} months, {thisWeek} this week</span>
        <span>target: {cadenceLabel(perWeek)}</span>
      </div>
      <div className="focus-months" role="img" aria-label={`${total} short-form posts in the last ${rows.length} months`}>
        {rows.map((m) => (
          <div key={`${m.year}-${m.month}`} className="focus-month">
            <span className="focus-month-label">{m.label}</span>
            {Array.from({ length: 31 }, (_, i) => {
              if (i >= m.daysInMonth) return <span key={i} />;
              const count = m.days[i] ?? 0;
              return <span key={i} className={count > 0 ? 'focus-cell on' : 'focus-cell'} title={`${m.label} ${i + 1}${count ? `, ${count} posted` : ''}`} />;
            })}
          </div>
        ))}
        <div className="focus-month ticks" aria-hidden>
          <span />
          {Array.from({ length: 31 }, (_, i) => <span key={i}>{i === 0 || (i + 1) % 5 === 0 ? i + 1 : ''}</span>)}
        </div>
      </div>
    </div>
  );
}
