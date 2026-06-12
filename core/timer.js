// Shared timer domain logic. Pure functions only — used by the service
// worker, the popup, and the full-page app so they can never disagree.

export const DEFAULT_SETTINGS = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  timerMin: 30,
  longBreakEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  sound: true,
  notifications: true,
  theme: 'ember',
  accent: 'auto', // flame color override; 'auto' keeps the theme's own
};

export const MODES = ['pomodoro', 'timer', 'stopwatch'];

export const PHASE_LABEL = {
  focus: 'focus',
  shortBreak: 'short break',
  longBreak: 'long break',
  timer: 'timer',
  stopwatch: 'stopwatch',
};

export function phaseDurationMs(phase, settings) {
  const minutes = {
    focus: settings.focusMin,
    shortBreak: settings.shortBreakMin,
    longBreak: settings.longBreakMin,
    timer: settings.timerMin,
    stopwatch: 0, // counts up; has no duration
  }[phase];
  return minutes * 60_000;
}

export function defaultState() {
  return {
    mode: 'pomodoro', // pomodoro | timer | stopwatch
    phase: 'focus', // in timer/stopwatch mode the phase mirrors the mode
    status: 'idle', // idle | running | paused
    endsAt: null, // epoch ms, set while running (stopwatch: virtual start, see elapsedMs)
    remainingMs: DEFAULT_SETTINGS.focusMin * 60_000,
    extendedMs: 0, // mid-session "+5 min" extensions; cleared when the phase ends
    cyclePos: 0, // focus sessions completed since the last long break
    settings: { ...DEFAULT_SETTINGS },
  };
}

// States stored by older versions predate modes.
export function normalizeState(state) {
  state.mode ??= 'pomodoro';
  return state;
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

// Stopwatch time worked so far. While running, endsAt holds the virtual
// start (now − elapsed) so elapsed survives worker restarts the same way a
// countdown's end does; while paused/idle, remainingMs holds the elapsed.
export function elapsedMs(state, now = Date.now()) {
  if (state.status === 'running') return Math.max(0, now - state.endsAt);
  return state.remainingMs;
}

// What the big digits show: counts down, except the stopwatch counts up.
export function displayMs(state, now = Date.now()) {
  return state.mode === 'stopwatch' ? elapsedMs(state, now) : remainingMs(state, now);
}

// Full length of the current phase, including any mid-session extensions.
// (`?? 0` covers states stored before extensions existed.)
export function phaseTotalMs(state) {
  return phaseDurationMs(state.phase, state.settings) + (state.extendedMs ?? 0);
}

// Fraction of the current phase still left, 0..1. Drives the progress ring.
// The stopwatch has no end, so its arc sweeps once per minute instead.
export function remainingFraction(state, now = Date.now()) {
  if (state.mode === 'stopwatch') return (elapsedMs(state, now) % 60_000) / 60_000;
  return Math.min(1, Math.max(0, remainingMs(state, now) / phaseTotalMs(state)));
}

export function formatTime(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

// Wall-clock label for "ends at" — e.g. "5:51 pm" (case via CSS).
export function formatClock(epochMs) {
  return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
