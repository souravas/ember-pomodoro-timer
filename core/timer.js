// Shared timer domain logic. Pure functions only — used by the service
// worker, the popup, and the full-page app so they can never disagree.

export const DEFAULT_SETTINGS = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  sound: true,
  notifications: true,
};

export const PHASE_LABEL = {
  focus: 'focus',
  shortBreak: 'short break',
  longBreak: 'long break',
};

export function phaseDurationMs(phase, settings) {
  const minutes = {
    focus: settings.focusMin,
    shortBreak: settings.shortBreakMin,
    longBreak: settings.longBreakMin,
  }[phase];
  return minutes * 60_000;
}

export function defaultState() {
  return {
    phase: 'focus',
    status: 'idle', // idle | running | paused
    endsAt: null, // epoch ms, set while running
    remainingMs: DEFAULT_SETTINGS.focusMin * 60_000,
    extendedMs: 0, // mid-session "+5 min" extensions; cleared when the phase ends
    cyclePos: 0, // focus sessions completed since the last long break
    settings: { ...DEFAULT_SETTINGS },
  };
}

// The phase that follows `state.phase`, assuming it just completed.
export function nextPhase(state) {
  if (state.phase !== 'focus') return 'focus';
  const completed = state.cyclePos + 1;
  return completed >= state.settings.longBreakEvery ? 'longBreak' : 'shortBreak';
}

export function remainingMs(state, now = Date.now()) {
  if (state.status === 'running') return Math.max(0, state.endsAt - now);
  return state.remainingMs;
}

// Full length of the current phase, including any mid-session extensions.
// (`?? 0` covers states stored before extensions existed.)
export function phaseTotalMs(state) {
  return phaseDurationMs(state.phase, state.settings) + (state.extendedMs ?? 0);
}

// Fraction of the current phase still left, 0..1. Drives the progress ring.
export function remainingFraction(state, now = Date.now()) {
  return Math.min(1, Math.max(0, remainingMs(state, now) / phaseTotalMs(state)));
}

export function formatTime(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
