import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { todayKey } from '../core/timer.js';
import {
  addDays,
  bestStreak,
  daySeries,
  formatHours,
  formatHoursShort,
  heatLevel,
  parseKey,
  startOfWeek,
  summary,
  weekDays,
  weekSeries,
} from '../core/stats.js';

// Friday 12 June 2026, mid-afternoon local time.
const NOW = new Date(2026, 5, 12, 15, 0, 0);

function day(date) {
  return todayKey(addDays(NOW, date));
}

describe('startOfWeek', () => {
  it('finds the most recent week-start day at midnight', () => {
    assert.equal(todayKey(startOfWeek(NOW, 1)), '2026-06-08'); // monday
    assert.equal(todayKey(startOfWeek(NOW, 0)), '2026-06-07'); // sunday
    assert.equal(todayKey(startOfWeek(NOW, 6)), '2026-06-06'); // saturday
    assert.equal(startOfWeek(NOW, 1).getHours(), 0);
  });

  it('a week-start day starts its own week', () => {
    const monday = new Date(2026, 5, 8, 9, 0, 0);
    assert.equal(todayKey(startOfWeek(monday, 1)), '2026-06-08');
  });
});

describe('parseKey', () => {
  it('parses as local time, not UTC', () => {
    const d = parseKey('2026-06-12');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 5);
    assert.equal(d.getDate(), 12);
    assert.equal(d.getHours(), 0);
  });
});

describe('series', () => {
  it('daySeries spans the asked-for days, oldest first', () => {
    const series = daySeries({ [day(0)]: { minutes: 30, sessions: 1 } }, 3, NOW);
    assert.equal(series.length, 3);
    assert.deepEqual(
      series.map((p) => p.key),
      [day(-2), day(-1), day(0)]
    );
    assert.deepEqual(
      series.map((p) => p.minutes),
      [0, 0, 30]
    );
  });

  it('weekDays keeps the full calendar week, future days included', () => {
    const series = weekDays({}, 1, NOW);
    assert.equal(series.length, 7);
    assert.equal(series[0].key, '2026-06-08');
    assert.equal(series[6].key, '2026-06-14');
  });

  it('weekSeries totals whole weeks', () => {
    const stats = {
      '2026-06-08': { minutes: 30, sessions: 1 },
      '2026-06-12': { minutes: 20, sessions: 1 },
      '2026-06-03': { minutes: 45, sessions: 1 }, // previous week
    };
    const series = weekSeries(stats, 2, 1, NOW);
    assert.equal(series.length, 2);
    assert.equal(series[0].minutes, 45);
    assert.equal(series[1].minutes, 50);
  });
});

describe('summary', () => {
  const stats = {
    [day(0)]: { minutes: 50, sessions: 2 },
    [day(-1)]: { minutes: 100, sessions: 4 },
    [day(-2)]: { minutes: 25, sessions: 1 },
    // gap at -3 breaks the streak
    [day(-4)]: { minutes: 75, sessions: 3 },
    [day(-5)]: { minutes: 75, sessions: 3 },
    [day(-6)]: { minutes: 75, sessions: 3 },
    [day(-7)]: { minutes: 75, sessions: 3 },
  };

  it('adds up the headline numbers', () => {
    const s = summary(stats, 1, NOW);
    assert.equal(s.today.minutes, 50);
    assert.equal(s.streak, 3);
    assert.equal(s.bestStreak, 4);
    assert.equal(s.bestDay.minutes, 100);
    assert.equal(s.totalMin, 475);
    assert.equal(s.totalSessions, 19);
  });

  it('a quiet today leans on yesterday for the streak', () => {
    const s = summary({ [day(-1)]: { minutes: 30, sessions: 1 } }, 1, NOW);
    assert.equal(s.streak, 1);
  });

  it('weekMin honours the week-start setting', () => {
    // Friday NOW: monday-start week began 8 jun (covers -4..0);
    // saturday-start week began 6 jun (covers -6..0).
    assert.equal(summary(stats, 1, NOW).weekMin, 50 + 100 + 25 + 75);
    assert.equal(summary(stats, 6, NOW).weekMin, 50 + 100 + 25 + 75 + 75 + 75);
  });
});

describe('bestStreak', () => {
  it('finds the longest run anywhere in history', () => {
    assert.equal(
      bestStreak({
        '2026-01-01': { minutes: 10 },
        '2026-01-02': { minutes: 10 },
        '2026-01-04': { minutes: 10 },
        '2026-03-01': { minutes: 0 }, // zero-minute days do not count
      }),
      2
    );
    assert.equal(bestStreak({}), 0);
  });
});

describe('formatting & heat', () => {
  it('formatHours', () => {
    assert.equal(formatHours(0), '0m');
    assert.equal(formatHours(59), '59m');
    assert.equal(formatHours(60), '1h');
    assert.equal(formatHours(185), '3h 05m');
  });

  it('formatHoursShort', () => {
    assert.equal(formatHoursShort(45), '45m');
    assert.equal(formatHoursShort(150), '2.5h');
  });

  it('heatLevel bands anchor to 25-minute sessions', () => {
    assert.deepEqual([0, 25, 50, 100, 200].map(heatLevel), [0, 1, 2, 3, 4]);
  });
});
