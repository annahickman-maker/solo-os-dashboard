import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bucketDays, cadenceLabel, emptyCounts, localDayKey, longFormDays, parseTzOffset, seriesSince, shortFormDays, weekStart,
} from './publishing.ts';

test('weekStart is the Monday', () => {
  assert.equal(weekStart('2026-11-23'), '2026-11-23'); // Monday
  assert.equal(weekStart('2026-11-29'), '2026-11-23'); // Sunday
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
});

test('localDayKey uses the owner offset', () => {
  assert.equal(localDayKey('2026-11-23T02:00:00Z', 300), '2026-11-22'); // UTC-5
  assert.equal(localDayKey('2026-11-23T22:00:00Z', -120), '2026-11-24'); // UTC+2
  assert.equal(localDayKey('junk'), null);
  assert.equal(parseTzOffset('300'), 300);
  assert.equal(parseTzOffset('abc'), 0);
  assert.equal(parseTzOffset('99999'), 0);
});

test('bucketDays: 52 weeks ending this week, 12 months ending this month', () => {
  const s = bucketDays(['2026-11-23', '2026-11-24', '2026-11-16', '2025-01-01', null, 'bad'], '2026-11-25');
  assert.equal(s.weeks.length, 52);
  assert.equal(s.weeks[51].start, '2026-11-23');
  assert.equal(s.weeks[51].count, 2);
  assert.equal(s.weeks[50].count, 1);
  assert.equal(s.weeks.reduce((a, w) => a + w.count, 0), 3); // 2025-01-01 is outside
  assert.equal(s.months.length, 12);
  assert.deepEqual([s.months[11].year, s.months[11].month, s.months[11].label, s.months[11].daysInMonth], [2026, 11, 'nov', 30]);
  assert.equal(s.months[11].days[22], 1);
  assert.equal(s.months[11].total, 3);
  assert.equal(s.months[0].label, 'dec');
  assert.equal(s.months[0].year, 2025);
});

test('empty data is empty grids', () => {
  const e = emptyCounts('2026-11-25');
  assert.equal(e.longForm.weeks.every((w) => w.count === 0), true);
  assert.equal(e.shortForm.months.every((m) => m.total === 0), true);
  assert.equal(seriesSince('2026-11-25'), '2025-12-01');
});

test('long form counts published pipeline cards by target date, else last update', () => {
  const days = longFormDays({
    cards: [
      { stage: 'published', targetDate: '2026-11-20', updatedAt: '2026-11-22T10:00:00Z' },
      { stage: 'published', targetDate: null, updatedAt: '2026-11-22T03:00:00Z' },
      { stage: 'editing', targetDate: '2026-11-21' },
      null,
    ],
  }, 300);
  assert.deepEqual(days, ['2026-11-20', '2026-11-21']);
  assert.deepEqual(longFormDays(null), []);
});

test('short form counts each post once, on its first live copy', () => {
  const days = shortFormDays([
    { post_id: 'a', published_at: '2026-11-20T10:00:00Z', status: 'published' },
    { post_id: 'a', published_at: '2026-11-19T10:00:00Z', status: 'published' },
    { post_id: 'b', published_at: '2026-11-21T10:00:00Z', status: 'published' },
    { post_id: 'c', published_at: '2026-11-21T10:00:00Z', status: 'failed' },
    { post_id: 'd', published_at: null, status: 'published' },
  ]);
  assert.deepEqual(days.sort(), ['2026-11-19', '2026-11-21']);
});

test('cadenceLabel', () => {
  assert.equal(cadenceLabel(1), '1 per week');
  assert.equal(cadenceLabel(0.5), '1 every 2 weeks');
  assert.equal(cadenceLabel(3), '3 per week');
  assert.equal(cadenceLabel(7), 'daily');
  assert.equal(cadenceLabel(0), 'no target');
});
