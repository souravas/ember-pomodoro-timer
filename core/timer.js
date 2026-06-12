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
  chime: 'bell', // chime voice: bell | warm | pluck
  volume: 0.7, // 0..1, shared by chime, warning tick, and ambient sound
  ambient: 'off', // played while focused work runs: off | ticking | rain | noise
  breakEndWarn: false, // soft tick 30s before a break ends
  notifications: true,
  pauseOnLock: true, // auto-pause focused work when the machine locks
  overtime: false, // focus/timer runs past zero, counting up, until ended
  strict: false, // pause/reset/skip need a press-and-hold during focus
  goalMin: 0, // daily focus goal in minutes; 0 = off
  showBadge: true,
  theme: 'ember',
  accent: 'auto', // flame color override; 'auto' keeps the theme's own
  weekStart: 1, // first day of the week for stats: 0 sun, 1 mon, 6 sat
};

// Quick duration presets — applied as a batch onto the four cycle settings.
export const PRESETS = [
  { id: 'classic', label: '25 · 5', settings: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 4 } },
  { id: 'fifty', label: '50 · 10', settings: { focusMin: 50, shortBreakMin: 10, longBreakMin: 20, longBreakEvery: 3 } },
  { id: 'deep', label: '90 · 20', settings: { focusMin: 90, shortBreakMin: 20, longBreakMin: 30, longBreakEvery: 2 } },
];

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
    label: '', // optional "what am I working on" — rides along when work is banked
    labelDay: null, // YYYY-MM-DD the label was set; lets a stale one retire
    startedAt: null, // epoch ms the current run first left idle (resume keeps it)
    overtime: false, // phase finished but keeps running past zero (a setting opts in)
    autoPausedAt: null, // epoch ms the machine locked mid-run, if that's why we're paused
    settings: { ...DEFAULT_SETTINGS },
  };
}

// States stored by older versions predate modes, labels, and overtime.
export function normalizeState(state, now = new Date()) {
  state.mode ??= 'pomodoro';
  state.label ??= '';
  state.labelDay ??= null;
  state.startedAt ??= null;
  state.overtime ??= false;
  state.autoPausedAt ??= null;
  // A label is an intent for the day — yesterday's shouldn't quietly tag
  // today's work. A run still in flight keeps its label until it's banked.
  if (state.label && state.status === 'idle' && state.labelDay !== todayKey(now)) {
    state.label = '';
    state.labelDay = null;
  }
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

// Time run past the phase's end while in overtime. endsAt stays parked at
// the original end, so overtime survives worker restarts like everything else.
export function overtimeMs(state, now = Date.now()) {
  if (!state.overtime || state.status !== 'running') return 0;
  return Math.max(0, now - state.endsAt);
}

// What the big digits show: counts down, except the stopwatch counts up —
// and overtime counts up from zero past the end.
export function displayMs(state, now = Date.now()) {
  if (state.overtime) return overtimeMs(state, now);
  return state.mode === 'stopwatch' ? elapsedMs(state, now) : remainingMs(state, now);
}

// Full length of the current phase, including any mid-session extensions.
// (`?? 0` covers states stored before extensions existed.)
export function phaseTotalMs(state) {
  return phaseDurationMs(state.phase, state.settings) + (state.extendedMs ?? 0);
}

// Fraction of the current phase still left, 0..1. Drives the progress ring.
// The stopwatch has no end, so its arc sweeps once per minute instead —
// overtime, also endless, borrows the same sweep.
export function remainingFraction(state, now = Date.now()) {
  if (state.overtime) return (overtimeMs(state, now) % 60_000) / 60_000;
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
