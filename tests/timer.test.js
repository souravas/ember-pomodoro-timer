import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  defaultState,
  displayMs,
  elapsedMs,
  formatTime,
  nextPhase,
  normalizeState,
  overtimeMs,
  phaseDurationMs,
  phaseTotalMs,
  remainingFraction,
  remainingMs,
  todayKey,
} from '../core/timer.js';

function running(overrides = {}) {
  return { ...defaultState(), status: 'running', ...overrides };
}

describe('nextPhase', () => {
  it('breaks always hand back to focus', () => {
    assert.equal(nextPhase(running({ phase: 'shortBreak' })), 'focus');
    assert.equal(nextPhase(running({ phase: 'longBreak' })), 'focus');
  });

  it('focus goes to a short break until the cycle fills', () => {
    assert.equal(nextPhase(running({ phase: 'focus', cyclePos: 0 })), 'shortBreak');
    assert.equal(nextPhase(running({ phase: 'focus', cyclePos: 2 })), 'shortBreak');
  });

  it('the cycle-filling focus earns the long break', () => {
    assert.equal(nextPhase(running({ phase: 'focus', cyclePos: 3 })), 'longBreak');
  });
});

describe('clocks', () => {
  it('remainingMs counts down from the stored end while running', () => {
    const s = running({ endsAt: 10_000 });
    assert.equal(remainingMs(s, 4_000), 6_000);
    assert.equal(remainingMs(s, 11_000), 0); // never negative
  });

  it('paused remainingMs is the banked value', () => {
    const s = { ...defaultState(), status: 'paused', remainingMs: 90_000 };
    assert.equal(remainingMs(s, 123), 90_000);
  });

  it('stopwatch elapsed survives via the virtual start', () => {
    const s = running({ mode: 'stopwatch', phase: 'stopwatch', endsAt: 1_000 });
    assert.equal(elapsedMs(s, 61_000), 60_000);
  });

  it('overtime counts up past the parked end', () => {
    const s = running({ overtime: true, endsAt: 50_000 });
    assert.equal(overtimeMs(s, 95_000), 45_000);
    assert.equal(displayMs(s, 95_000), 45_000);
  });

  it('overtime sweeps the ring once a minute like the stopwatch', () => {
    const s = running({ overtime: true, endsAt: 0 });
    assert.equal(remainingFraction(s, 30_000), 0.5);
    assert.equal(remainingFraction(s, 90_000), 0.5);
  });

  it('phaseTotalMs includes mid-session extensions', () => {
    const s = running({ extendedMs: 5 * 60_000 });
    assert.equal(phaseTotalMs(s), (DEFAULT_SETTINGS.focusMin + 5) * 60_000);
  });

  it('phaseDurationMs reads the matching setting', () => {
    assert.equal(phaseDurationMs('longBreak', DEFAULT_SETTINGS), 15 * 60_000);
    assert.equal(phaseDurationMs('stopwatch', DEFAULT_SETTINGS), 0);
  });
});

describe('formatTime', () => {
  it('mm:ss under the hour, h:mm:ss past it', () => {
    assert.equal(formatTime(25 * 60_000), '25:00');
    assert.equal(formatTime(5_400), '00:05');
    assert.equal(formatTime(3_661_000), '1:01:01');
  });
});

describe('normalizeState', () => {
  it('fills fields older stored states lack', () => {
    const s = normalizeState({ status: 'idle', settings: { ...DEFAULT_SETTINGS } });
    assert.equal(s.mode, 'pomodoro');
    assert.equal(s.overtime, false);
    assert.equal(s.autoPausedAt, null);
    assert.equal(s.label, '');
  });

  it("retires yesterday's label once the run is idle", () => {
    const s = normalizeState(
      {
        status: 'idle',
        label: 'old work',
        labelDay: '2026-06-11',
        settings: { ...DEFAULT_SETTINGS },
      },
      new Date(2026, 5, 12)
    );
    assert.equal(s.label, '');
    assert.equal(s.labelDay, null);
  });

  it("keeps today's label, and any label on a run in flight", () => {
    const today = normalizeState(
      { status: 'idle', label: 'w', labelDay: todayKey(), settings: { ...DEFAULT_SETTINGS } }
    );
    assert.equal(today.label, 'w');
    const inFlight = normalizeState(
      {
        status: 'running',
        label: 'w',
        labelDay: '2020-01-01',
        settings: { ...DEFAULT_SETTINGS },
      },
      new Date(2026, 5, 12)
    );
    assert.equal(inFlight.label, 'w');
  });
});

describe('todayKey', () => {
  it('formats local dates as YYYY-MM-DD', () => {
    assert.equal(todayKey(new Date(2026, 0, 5)), '2026-01-05');
  });
});
