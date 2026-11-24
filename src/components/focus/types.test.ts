import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveCurrent, formatValue, newPlan, normalizeFocusDoc, overallProgress, pace, targetProgress, windowInfo,
} from './types.ts';

test('targetProgress clamps and handles decreasing targets', () => {
  assert.equal(targetProgress({ start: 100, current: 150, target: 200 }), 0.5);
  assert.equal(targetProgress({ start: 100, current: 50, target: 200 }), 0);
  assert.equal(targetProgress({ start: 100, current: 300, target: 200 }), 1);
  assert.equal(targetProgress({ start: 80, current: 70, target: 60 }), 0.5);
  assert.equal(targetProgress({ start: 5, current: 5, target: 5 }), 1);
});

test('windowInfo counts day X of 90', () => {
  const today = new Date(2026, 0, 10);
  assert.deepEqual(windowInfo('2026-01-01', today), {
    endDate: '2026-04-01', day: 10, daysLeft: 81, elapsed: 10 / 90, status: 'running', startsIn: 0,
  });
  assert.equal(windowInfo('2026-01-15', today).status, 'upcoming');
  assert.equal(windowInfo('2026-01-15', today).startsIn, 5);
  assert.equal(windowInfo('2025-10-01', today).status, 'ended');
});

test('pace compares progress to time', () => {
  assert.equal(pace(0.5, 0.5), 'on track');
  assert.equal(pace(0.2, 0.5), 'behind');
  assert.equal(pace(0.7, 0.5), 'ahead');
});

test('overallProgress falls back to milestones', () => {
  assert.equal(overallProgress({ targets: [], milestones: [] }), null);
  assert.equal(overallProgress({ targets: [], milestones: [{ id: 'a', title: 'x', done: true }, { id: 'b', title: 'y', done: false }] }), 0.5);
});

test('normalizeFocusDoc tolerates junk and archive keeps history', () => {
  const doc = normalizeFocusDoc({ current: { statement: 'Grow', startDate: 'nope', targets: [{ label: 'Subs', target: '10' }, {}, {}, {}], week: [{ title: 't', weekday: 'xyz' }] } });
  assert.equal(doc.current?.targets.length, 3);
  assert.equal(doc.current?.targets[0].target, 10);
  assert.equal(doc.current?.week[0].weekday, null);
  assert.match(doc.current?.startDate ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(normalizeFocusDoc(null), { version: 1, current: null, archive: [], cadence: { longFormPerWeek: 1, shortFormPerWeek: 3 } });

  const archived = archiveCurrent({ version: 1, current: newPlan({ statement: 'A', startDate: '2026-01-01' }), archive: [], cadence: { longFormPerWeek: 1, shortFormPerWeek: 3 } });
  assert.equal(archived.current, null);
  assert.equal(archived.archive[0].statement, 'A');
});

test('formatValue places currency before the number', () => {
  assert.equal(formatValue(1200, '$'), '$1,200');
  assert.equal(formatValue(40, 'members'), '40 members');
  assert.equal(formatValue(900, '/mo'), '900/mo');
});

test('normalizeFocusDoc fills goal, revenue model and cadence and keeps old fields', () => {
  const doc = normalizeFocusDoc({
    cadence: { longFormPerWeek: '0.5', shortFormPerWeek: -2 },
    current: {
      statement: 'Grow', startDate: '2026-01-01', revenueModel: 'one-time',
      goal: { revenueTarget: 5000, revenueCurrent: '1200', countTarget: 0, countCurrent: 3 },
      milestones: [{ id: 'm', title: 'Launch', done: true }], week: [{ id: 'w', title: 'Film', weekday: 'mon' }],
    },
  });
  assert.deepEqual(doc.cadence, { longFormPerWeek: 0.5, shortFormPerWeek: 3 });
  assert.equal(doc.current?.revenueModel, 'one-time');
  assert.deepEqual(doc.current?.goal, { revenueTarget: 5000, revenueCurrent: 1200, countTarget: null, countCurrent: 3, price: null });
  assert.equal(doc.current?.milestones[0].title, 'Launch');
  assert.equal(doc.current?.week[0].weekday, 'mon');
  const old = normalizeFocusDoc({ current: { statement: 'Old' } });
  assert.equal(old.current?.revenueModel, 'recurring');
  assert.deepEqual(old.current?.goal, { revenueTarget: null, revenueCurrent: 0, countTarget: null, countCurrent: 0, price: null });
});
