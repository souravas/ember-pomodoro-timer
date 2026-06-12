import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOG_KEEP_DAYS,
  LOG_MAX_ENTRIES,
  appendEntry,
  clearLabel,
  completionStats,
  entryId,
  hourHistogram,
  labelTotals,
  recentLabels,
  removeEntry,
  renameLabel,
} from '../core/log.js';

const NOW = Date.parse('2026-06-12T15:00:00');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function entry(overrides = {}) {
  const end = overrides.end ?? NOW;
  const min = overrides.min ?? 25;
  return {
    id: entryId(end),
    start: end - min * 60_000,
    end,
    min,
    label: null,
    mode: 'pomodoro',
    completed: true,
    ...overrides,
  };
}

describe('appendEntry', () => {
  it('appends and prunes entries older than the keep window', () => {
    const old = entry({ end: NOW - (LOG_KEEP_DAYS + 2) * DAY });
    const fresh = entry({ end: NOW - DAY });
    const log = appendEntry([old, fresh], entry({ end: NOW }));
    assert.equal(log.length, 2);
    assert.ok(!log.includes(old));
  });

  it('caps the total number of entries', () => {
    const log = Array.from({ length: LOG_MAX_ENTRIES }, (_, i) => entry({ end: NOW - i * 1000 }));
    const out = appendEntry(log, entry({ end: NOW + 1000 }));
    assert.equal(out.length, LOG_MAX_ENTRIES);
  });
});

describe('recentLabels', () => {
  it('returns distinct labels, most recent first', () => {
    const log = [
      entry({ label: 'alpha', end: NOW - 3000 }),
      entry({ label: 'beta', end: NOW - 2000 }),
      entry({ label: 'alpha', end: NOW - 1000 }),
      entry({ label: null, end: NOW }),
    ];
    assert.deepEqual(recentLabels(log), ['alpha', 'beta']);
  });
});

describe('labelTotals', () => {
  it('sums minutes per label and counts only completed pomodoro sessions', () => {
    const log = [
      entry({ label: 'deep', min: 25 }),
      entry({ label: 'deep', min: 10, completed: false }),
      entry({ label: 'deep', min: 30, mode: 'timer' }),
      entry({ label: null, min: 5 }),
      entry({ label: 'old', min: 60, end: NOW - 10 * DAY }),
    ];
    const rows = labelTotals(log, NOW - DAY);
    assert.deepEqual(rows[0], { label: 'deep', min: 65, sessions: 1 });
    assert.equal(rows.find((r) => r.label === null).min, 5);
    assert.ok(!rows.some((r) => r.label === 'old'));
  });
});

describe('editing', () => {
  it('removeEntry drops exactly the id', () => {
    const a = entry({ end: NOW - 1000 });
    const b = entry({ end: NOW });
    assert.deepEqual(removeEntry([a, b], a.id), [b]);
  });

  it('renameLabel merges onto an existing label', () => {
    const log = [entry({ label: 'wokr' }), entry({ label: 'work' })];
    const out = renameLabel(log, 'wokr', 'work');
    assert.ok(out.every((e) => e.label === 'work'));
  });

  it('renaming to nothing clears instead', () => {
    const out = renameLabel([entry({ label: 'x' })], 'x', '   ');
    assert.equal(out[0].label, null);
  });

  it('clearLabel keeps the time, unlabelled', () => {
    const out = clearLabel([entry({ label: 'x', min: 25 })], 'x');
    assert.equal(out[0].label, null);
    assert.equal(out[0].min, 25);
  });
});

describe('hourHistogram', () => {
  it('splits a run across the hours it spanned', () => {
    // 09:30–10:30 local: half the minutes in each hour bucket.
    const end = new Date(2026, 5, 12, 10, 30).getTime();
    const log = [entry({ start: end - HOUR, end, min: 60 })];
    const hours = hourHistogram(log, 0);
    assert.equal(hours[9], 30);
    assert.equal(hours[10], 30);
  });

  it('skips manual entries and respects the window', () => {
    const end = new Date(2026, 5, 12, 12, 0).getTime();
    const log = [
      entry({ end, min: 30, mode: 'manual' }),
      entry({ end: end - 40 * DAY, min: 30 }),
    ];
    assert.ok(hourHistogram(log, end - 30 * DAY).every((m) => m === 0));
  });
});

describe('completionStats', () => {
  it('counts only pomodoro focus runs', () => {
    const log = [
      entry({ completed: true }),
      entry({ completed: false }),
      entry({ mode: 'timer', completed: true }),
      entry({ mode: 'manual', completed: false }),
    ];
    assert.deepEqual(completionStats(log, 0), { total: 2, completed: 1 });
  });
});
