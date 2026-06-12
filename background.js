// Service worker: the single owner of timer state. MV3 may kill this worker
// at any time, so state lives in chrome.storage.local and the phase change
// fires from a chrome.alarm — never from setTimeout.

import {
  DEFAULT_SETTINGS,
  MODES,
  PHASE_LABEL,
  defaultState,
  elapsedMs,
  nextPhase,
  normalizeState,
  overtimeMs,
  phaseDurationMs,
  phaseTotalMs,
  remainingMs,
  todayKey,
} from './core/timer.js';
import { appendEntry, clearLabel, entryId, removeEntry, renameLabel } from './core/log.js';
import { formatHours, parseKey } from './core/stats.js';

const ALARM_PHASE_END = 'phase-end';
const ALARM_BADGE_TICK = 'badge-tick';
const ALARM_PRE_WARN = 'pre-warn'; // soft tick 30s before a break ends
const ALARM_NAG = 'nag'; // one gentle reminder when a finished phase sits idle

// Phases where the user is working (vs. resting) — what ambient sound plays
// for, what the lock-pause protects, and what abandoning still credits.
const WORK_PHASES = ['focus', 'timer', 'stopwatch'];

const PHASE_COLOR = {
  focus: '#E25C3F',
  shortBreak: '#A8BD8F',
  longBreak: '#93AFC0',
  timer: '#E25C3F',
  stopwatch: '#E25C3F',
};

async function getState() {
  const { state } = await chrome.storage.local.get('state');
  if (!state) return defaultState();
  // Merge settings so new defaults appear after extension updates.
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  return normalizeState(state);
}

async function setState(state) {
  await chrome.storage.local.set({ state });
  await updateBadge(state);
  return state;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await setState(await getState());
  buildMenus();
  await migrateLog();
  await adoptSyncedSettings();
  // First run: the full page doubles as the welcome tour.
  if (details.reason === 'install') openApp('#welcome');
});

chrome.runtime.onStartup.addListener(async () => {
  await adoptSyncedSettings();
  const state = await getState();
  // If Chrome was closed past the end of a running phase, complete it now.
  // (A running stopwatch has no end — its endsAt is the virtual start.)
  if (state.status === 'running' && state.mode !== 'stopwatch' && !state.overtime && state.endsAt <= Date.now()) {
    await completePhase(state);
  } else {
    await updateBadge(state);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const actions = {
    start,
    pause,
    reset,
    skip,
    finishOvertime,
    extend: (s) => extend(s, msg.minutes),
    setMode: (s) => setMode(s, msg.mode),
    setLabel: (s) => setLabel(s, msg.label),
    updateSettings: (s) => updateSettings(s, msg.settings),
    logDelete: (s) => logDelete(s, msg.id),
    logAdd: (s) => logAdd(s, msg.entry),
    labelRename: (s) => labelRename(s, msg.from, msg.to),
    labelClear: (s) => labelClear(s, msg.label),
    importData: (s) => importData(s, msg.data),
  };
  const action = actions[msg.type];
  if (!action) return false;
  getState()
    .then((state) => action(state))
    .then((state) => sendResponse(state ?? null))
    .catch(() => sendResponse(null)); // never leave the channel hanging
  return true; // keep the message channel open for the async response
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const state = await getState();
  if (alarm.name === ALARM_PHASE_END) {
    if (state.status === 'running' && !state.overtime) await completePhase(state);
  } else if (alarm.name === ALARM_BADGE_TICK) {
    if (state.status === 'running') await updateBadge(state);
    else await chrome.alarms.clear(ALARM_BADGE_TICK);
  } else if (alarm.name === ALARM_PRE_WARN) {
    const onBreak = state.phase === 'shortBreak' || state.phase === 'longBreak';
    if (state.status === 'running' && onBreak && state.settings.sound) {
      await sendSound({ type: 'warn', volume: state.settings.volume });
    }
  } else if (alarm.name === ALARM_NAG) {
    if (state.status === 'idle' && state.mode === 'pomodoro' && state.settings.notifications) {
      notify(['ember-nag', 'start'], {
        title: 'Still there?',
        message:
          state.phase === 'focus'
            ? 'Your break is over — ready to focus?'
            : `Your ${PHASE_LABEL[state.phase]} is waiting.`,
        buttons: [{ title: state.phase === 'focus' ? 'Start focus' : 'Start break' }],
      });
    }
  }
});

/* ---------- global shortcuts, toolbar menu, side panel entry ---------- */

chrome.commands.onCommand.addListener(async (command) => {
  const state = await getState();
  if (command === 'toggle-timer') {
    await (state.status === 'running' ? pause(state) : start(state));
  } else if (command === 'skip-phase') {
    await skip(state);
  } else if (command === 'open-app') {
    openApp();
  }
});

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'toggle', title: 'Start / pause', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'skip', title: 'Skip phase', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-app', title: 'Open full timer', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-stats', title: 'Open stats', contexts: ['action'] });
  });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  const state = await getState();
  if (info.menuItemId === 'toggle') await (state.status === 'running' ? pause(state) : start(state));
  else if (info.menuItemId === 'skip') await skip(state);
  else if (info.menuItemId === 'open-app') openApp();
  else if (info.menuItemId === 'open-stats') openApp('#stats');
});

function openApp(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + hash });
}

/* ---------- notifications: ids carry their buttons' actions ---------- */

// The worker may be long dead when a button is clicked, so the notification
// id encodes what each button does: 'tag|action0|action1'.
function notify([tag, ...actions], { title, message, buttons = [] }) {
  chrome.notifications.create([tag, ...actions].join('|'), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    buttons,
    silent: true, // we play our own chime
  });
}

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  const action = id.split('|')[index + 1];
  if (!action) return;
  const state = await getState();
  if (action === 'start') await start(state);
  else if (action === 'finishOvertime') await finishOvertime(state);
  else if (action.startsWith('snooze:')) await snoozeBreak(state, action.slice(7));
  chrome.notifications.clear(id);
});

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith('ember-')) return;
  openApp();
  chrome.notifications.clear(id);
});

/* ---------- machine lock: don't bank time nobody worked ---------- */

chrome.idle.onStateChanged.addListener(async (idleState) => {
  const state = await getState();
  if (idleState === 'locked') {
    if (!state.settings.pauseOnLock || state.status !== 'running') return;
    if (!WORK_PHASES.includes(state.phase)) return; // a break can run unattended
    if (state.overtime) {
      await finishOvertime(state); // walking away ends the overtime stretch
      return;
    }
    state.autoPausedAt = Date.now();
    await pause(state);
  } else if (idleState === 'active') {
    // Back from a lock that auto-paused: a nudge beats silent confusion.
    if (state.status === 'paused' && state.autoPausedAt && state.settings.notifications) {
      notify(['ember-resume', 'start'], {
        title: 'Paused while you were away',
        message: `Your ${PHASE_LABEL[state.phase]} is on hold — resume when ready.`,
        buttons: [{ title: 'Resume' }],
      });
    }
  }
});

/* ---------- timer actions ---------- */

async function start(state) {
  if (state.status === 'running') return state;
  // A fresh run (not a resume) marks its start for the session log.
  if (state.status === 'idle') state.startedAt = Date.now();
  state.status = 'running';
  state.autoPausedAt = null;
  await chrome.alarms.clear(ALARM_NAG);
  if (state.mode === 'stopwatch') {
    // Counting up: no end alarm; endsAt is the virtual start.
    state.endsAt = Date.now() - state.remainingMs;
  } else {
    state.endsAt = Date.now() + state.remainingMs;
    await armPhaseEnd(state);
  }
  await chrome.alarms.create(ALARM_BADGE_TICK, { periodInMinutes: 1 });
  await syncAmbient(state);
  return setState(state);
}

// The end alarm, plus the optional warning tick shortly before a break ends.
async function armPhaseEnd(state) {
  await chrome.alarms.create(ALARM_PHASE_END, { when: state.endsAt });
  const onBreak = state.phase === 'shortBreak' || state.phase === 'longBreak';
  if (onBreak && state.settings.breakEndWarn && state.settings.sound && state.endsAt - 30_000 > Date.now()) {
    await chrome.alarms.create(ALARM_PRE_WARN, { when: state.endsAt - 30_000 });
  }
}

async function pause(state) {
  if (state.status !== 'running') return state;
  if (state.overtime) return finishOvertime(state); // overtime ends, never pauses
  state.remainingMs = state.mode === 'stopwatch' ? elapsedMs(state) : remainingMs(state);
  state.status = 'paused';
  state.endsAt = null;
  await clearAlarms();
  await syncAmbient(state);
  return setState(state);
}

// User reset abandons the run — bank its partial work before tearing down.
async function reset(state) {
  await creditAbandoned(state);
  return resetCore(state);
}

async function resetCore(state) {
  state.status = 'idle';
  state.endsAt = null;
  state.remainingMs =
    state.mode === 'stopwatch' ? 0 : phaseDurationMs(state.phase, state.settings);
  state.extendedMs = 0;
  state.startedAt = null;
  state.overtime = false;
  state.autoPausedAt = null;
  await clearAlarms();
  await syncAmbient(state);
  return setState(state);
}

// Switching mode abandons the current run but keeps pomodoro cycle progress
// for when the user switches back.
async function setMode(state, mode) {
  if (!MODES.includes(mode) || state.mode === mode) return state;
  await creditAbandoned(state); // bank work before the run is replaced
  state.mode = mode;
  state.phase = mode === 'pomodoro' ? 'focus' : mode;
  return resetCore(state); // clears alarms and adopts the mode's duration
}

// Stretch the running phase only — the saved durations are untouched.
async function extend(state, minutes) {
  if (state.status !== 'running' || state.overtime || !(minutes > 0)) return state;
  const ms = minutes * 60_000;
  state.extendedMs = (state.extendedMs ?? 0) + ms;
  state.endsAt += ms;
  await armPhaseEnd(state);
  return setState(state);
}

async function clearAlarms() {
  await chrome.alarms.clear(ALARM_PHASE_END);
  await chrome.alarms.clear(ALARM_BADGE_TICK);
  await chrome.alarms.clear(ALARM_PRE_WARN);
  await chrome.alarms.clear(ALARM_NAG);
}

// Skip moves to the next phase without crediting a completed session —
// though minutes already worked still count. Only the pomodoro cycle has a
// next phase to skip to.
async function skip(state) {
  if (state.mode !== 'pomodoro') return state;
  await creditAbandoned(state);
  return advance(state, { credit: false });
}

async function completePhase(state) {
  // Fired long past the end (sleep without a lock, Chrome closed): the phase
  // still completes, but nothing should chain after it — nobody is there.
  const overdue = Date.now() - state.endsAt > 5 * 60_000;

  // Overtime: the phase is done, but the clock keeps running up from zero
  // until the user ends it — banked all together then.
  if (state.settings.overtime && !overdue && (state.phase === 'focus' || state.mode === 'timer')) {
    state.overtime = true;
    if (state.settings.notifications) {
      notify(['ember-overtime', 'finishOvertime'], {
        title: state.phase === 'focus' ? 'Focus session complete' : 'Timer finished',
        message: 'Counting overtime — end it when you reach a stopping point.',
        buttons: [{ title: state.phase === 'focus' ? 'Take a break now' : 'Done' }],
      });
    }
    if (state.settings.sound) await playChime(state);
    return setState(state);
  }

  if (state.settings.notifications) notifyPhaseEnd(state);
  if (state.settings.sound) await playChime(state);
  // A one-shot timer just rearms itself — but the finished countdown still
  // counts as time worked (no session: those are pomodoro currency).
  if (state.mode === 'timer') {
    await recordWork(state, Math.round(phaseTotalMs(state) / 60_000), {
      when: state.endsAt,
      completed: true,
    });
    return resetCore(state);
  }
  return advance(state, { credit: true, autostart: !overdue });
}

// Ends an overtime stretch: the extra minutes fold into the phase as one
// big extension, then the cycle moves on normally.
async function finishOvertime(state) {
  if (!state.overtime || state.status !== 'running') return state;
  state.extendedMs = (state.extendedMs ?? 0) + overtimeMs(state);
  state.overtime = false;
  state.endsAt = Date.now();
  if (state.mode === 'timer') {
    await recordWork(state, Math.round(phaseTotalMs(state) / 60_000), {
      when: state.endsAt,
      completed: true,
    });
    return resetCore(state);
  }
  return advance(state, { credit: true });
}

// "5 more break minutes" from a break-end notification: steps back onto the
// just-ended break for a short encore. Only valid while the following focus
// phase sits unstarted.
async function snoozeBreak(state, phase) {
  if (state.mode !== 'pomodoro' || state.status !== 'idle' || state.phase !== 'focus') return state;
  if (phase !== 'shortBreak' && phase !== 'longBreak') return state;
  state.phase = phase;
  state.remainingMs = 5 * 60_000;
  state.extendedMs = 0;
  return start(state);
}

async function advance(state, { credit, autostart = true }) {
  await clearAlarms(); // start() re-creates them if the next phase auto-starts
  const endedPhase = state.phase;
  const next = nextPhase(state);

  if (endedPhase === 'focus' && credit) {
    state.cyclePos += 1;
    // Credit what was actually worked, including any "+5 min" extensions —
    // dated by when the phase ended, in case an overdue completion is being
    // processed after a Chrome restart (possibly days later).
    await recordWork(state, Math.round(phaseTotalMs(state) / 60_000), {
      sessions: 1,
      when: state.endsAt ?? Date.now(),
      completed: true,
    });
  }
  if (endedPhase === 'longBreak') state.cyclePos = 0;

  state.phase = next;
  state.remainingMs = phaseDurationMs(next, state.settings);
  state.extendedMs = 0;
  state.endsAt = null;
  state.status = 'idle';
  state.startedAt = null;
  state.overtime = false;
  state.autoPausedAt = null;

  const auto =
    (next === 'focus' ? state.settings.autoStartFocus : state.settings.autoStartBreaks) &&
    credit &&
    autostart;
  if (auto) return start(state);
  // Focus doesn't auto-start by default, and a missed notification means the
  // cycle silently stalls — so one (and only one) reminder follows.
  if (state.mode === 'pomodoro' && state.settings.notifications && credit && autostart) {
    await chrome.alarms.create(ALARM_NAG, { delayInMinutes: 3 });
  }
  await syncAmbient(state);
  return setState(state);
}

async function updateSettings(state, settings) {
  state.settings = { ...state.settings, ...settings };
  state.settingsAt = Date.now();
  // If the current phase hasn't started, adopt its new duration.
  if (state.status === 'idle') {
    state.remainingMs = phaseDurationMs(state.phase, state.settings);
    state.extendedMs = 0;
  }
  // Settings follow the user across machines; stats stay local.
  chrome.storage.sync
    .set({ settings: state.settings, settingsAt: state.settingsAt })
    .catch(() => {});
  await syncAmbient(state);
  return setState(state);
}

// Pull settings saved by another machine (or a fresh install on this one).
// Last write wins, decided by the settingsAt stamp.
async function adoptSyncedSettings() {
  try {
    const { settings, settingsAt } = await chrome.storage.sync.get(['settings', 'settingsAt']);
    if (!settings || !settingsAt) return;
    const state = await getState();
    if ((state.settingsAt ?? 0) >= settingsAt) return;
    state.settings = { ...DEFAULT_SETTINGS, ...settings };
    state.settingsAt = settingsAt;
    if (state.status === 'idle') {
      state.remainingMs = phaseDurationMs(state.phase, state.settings);
      state.extendedMs = 0;
    }
    await syncAmbient(state);
    await setState(state);
  } catch {
    // Sync unavailable (e.g. not signed in) — purely local is fine.
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) adoptSyncedSettings();
});

/* ---------- the stats ledger ---------- */

// Bank worked minutes (and completed focus sessions) on the day the work
// happened: daily totals for the dashboard, plus a session-log entry that
// carries the run's label so the work can be told apart later.
async function recordWork(state, minutes, { sessions = 0, when = Date.now(), completed = false } = {}) {
  if (minutes < 1 && sessions === 0) return;
  const key = todayKey(new Date(when));
  const { stats = {}, log = [] } = await chrome.storage.local.get(['stats', 'log']);
  const day = stats[key] ?? { sessions: 0, minutes: 0 };
  day.sessions += sessions;
  day.minutes += minutes;
  stats[key] = day;
  const entry = {
    id: entryId(when),
    start: state.startedAt ?? when - minutes * 60_000,
    end: when,
    min: minutes,
    label: state.label || null,
    mode: state.mode,
    completed,
  };
  await chrome.storage.local.set({ stats, log: appendEntry(log, entry) });
  await checkGoal(state, key, day);
}

// One quiet cheer the moment today's work crosses the daily goal.
async function checkGoal(state, key, day) {
  const goal = state.settings.goalMin;
  if (!goal || day.minutes < goal || key !== todayKey()) return;
  if (!state.settings.notifications) return;
  const { goalDay } = await chrome.storage.local.get('goalDay');
  if (goalDay === key) return;
  await chrome.storage.local.set({ goalDay: key });
  notify(['ember-goal'], {
    title: 'Daily goal reached',
    message: `${formatHours(day.minutes)} of focus today — well done.`,
  });
}

// The label is an optional "what am I working on" — it tags whatever gets
// banked next and sticks for the day (normalizeState retires stale ones).
async function setLabel(state, label) {
  state.label = String(label ?? '')
    .trim()
    .slice(0, 60);
  state.labelDay = state.label ? todayKey() : null;
  return setState(state);
}

// Whole minutes of work sitting in the current run that nothing has banked
// yet. Breaks aren't work; an idle run holds nothing.
function unsavedWorkMin(state) {
  if (state.status === 'idle') return 0;
  if (!WORK_PHASES.includes(state.phase)) return 0;
  if (state.overtime) return Math.floor((phaseTotalMs(state) + overtimeMs(state)) / 60_000);
  if (state.mode === 'stopwatch') return Math.floor(elapsedMs(state) / 60_000);
  return Math.floor((phaseTotalMs(state) - remainingMs(state)) / 60_000);
}

// Abandoning a run (reset, skip, mode switch) still credits the minutes
// already worked — only the session count stays strict about completion.
async function creditAbandoned(state) {
  const minutes = unsavedWorkMin(state);
  if (minutes >= 1) await recordWork(state, minutes);
}

/* ---------- dashboard edits: the views ask, the worker writes ---------- */

// Removing a log entry takes its minutes (and session credit) back out of
// the day's totals, so the charts agree with the list.
async function logDelete(state, id) {
  const { stats = {}, log = [] } = await chrome.storage.local.get(['stats', 'log']);
  const entry = log.find((e) => e.id === id);
  if (!entry) return state;
  const key = todayKey(new Date(entry.end));
  const day = stats[key];
  if (day) {
    day.minutes = Math.max(0, day.minutes - entry.min);
    if (entry.completed && entry.mode === 'pomodoro') day.sessions = Math.max(0, day.sessions - 1);
    if (day.minutes === 0 && day.sessions === 0) delete stats[key]; // keep streaks honest
  }
  await chrome.storage.local.set({ stats, log: removeEntry(log, id) });
  return state;
}

// Manual entry: work done away from the timer ("2h of reading"). Mode
// 'manual' keeps it out of session counts and the hour histogram.
async function logAdd(state, { minutes, label, date } = {}) {
  const min = Math.round(Number(minutes));
  if (!(min >= 1) || min > 24 * 60) return state;
  const today = todayKey();
  const key = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : today;
  const end = key === today ? Date.now() : parseKey(key).getTime() + 12 * 3_600_000;
  const { stats = {}, log = [] } = await chrome.storage.local.get(['stats', 'log']);
  const day = stats[key] ?? { sessions: 0, minutes: 0 };
  day.minutes += min;
  stats[key] = day;
  const entry = {
    id: entryId(end),
    start: end - min * 60_000,
    end,
    min,
    label: String(label ?? '').trim().slice(0, 60) || null,
    mode: 'manual',
    completed: false,
  };
  await chrome.storage.local.set({ stats, log: appendEntry(log, entry) });
  return state;
}

async function labelRename(state, from, to) {
  const { log = [] } = await chrome.storage.local.get('log');
  await chrome.storage.local.set({ log: renameLabel(log, from, to) });
  if (state.label === from) return setLabel(state, to);
  return state;
}

async function labelClear(state, label) {
  const { log = [] } = await chrome.storage.local.get('log');
  await chrome.storage.local.set({ log: clearLabel(log, label) });
  if (state.label === label) return setLabel(state, '');
  return state;
}

/* ---------- backup import ---------- */

// Replaces stats, log, and settings with a previously exported backup.
// Returns null (a failed action) if the file doesn't look like one of ours.
async function importData(state, data) {
  if (!data || typeof data !== 'object') return null;
  const stats = {};
  for (const [key, day] of Object.entries(data.stats ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const sessions = Math.max(0, Math.round(Number(day?.sessions)) || 0);
    const minutes = Math.max(0, Math.round(Number(day?.minutes)) || 0);
    if (sessions || minutes) stats[key] = { sessions, minutes };
  }
  if (!Array.isArray(data.log)) return null;
  const log = data.log
    .filter((e) => e && Number.isFinite(e.end) && Number.isFinite(e.min) && e.min > 0)
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id : entryId(e.end),
      start: Number.isFinite(e.start) ? e.start : e.end - e.min * 60_000,
      end: e.end,
      min: Math.round(e.min),
      label: e.label ? String(e.label).slice(0, 60) : null,
      mode: typeof e.mode === 'string' ? e.mode : 'pomodoro',
      completed: Boolean(e.completed),
    }))
    .sort((a, b) => a.end - b.end)
    .slice(-4000);
  await chrome.storage.local.set({ stats, log });
  if (data.settings && typeof data.settings === 'object') {
    const known = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in data.settings) known[key] = data.settings[key];
    }
    return updateSettings(state, known);
  }
  return state;
}

// Older logs predate entry ids; deletion needs them.
async function migrateLog() {
  const { log = [] } = await chrome.storage.local.get('log');
  if (!log.some((e) => !e.id)) return;
  await chrome.storage.local.set({
    log: log.map((e) => (e.id ? e : { ...e, id: entryId(e.end) })),
  });
}

/* ---------- badge, notifications, sound ---------- */

async function updateBadge(state) {
  let text = '';
  if (state.settings.showBadge) {
    if (state.status === 'running') {
      text = state.overtime
        ? `+${Math.floor(overtimeMs(state) / 60_000)}m`
        : state.mode === 'stopwatch'
          ? `${Math.floor(elapsedMs(state) / 60_000)}m`
          : `${Math.ceil(remainingMs(state) / 60_000)}m`;
    } else if (state.status === 'paused') {
      text = '||';
    }
  }
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: PHASE_COLOR[state.phase] });
    await chrome.action.setBadgeTextColor({ color: '#1A1310' });
  }
}

function notifyPhaseEnd(state) {
  if (state.mode === 'timer') {
    notify(['ember-end', 'start'], {
      title: 'Timer finished',
      message: `Your ${Math.round(phaseTotalMs(state) / 60_000)} minute timer is up.`,
      buttons: [{ title: 'Start again' }],
    });
    return;
  }
  const ended = state.phase;
  const next = nextPhase(state);
  const willAuto = next === 'focus' ? state.settings.autoStartFocus : state.settings.autoStartBreaks;
  const title = ended === 'focus' ? 'Focus session complete' : 'Break is over';
  // Name the work when the user named it — "what did I just finish?".
  const what = ended === 'focus' && state.label ? `“${state.label}”` : capitalize(PHASE_LABEL[ended]);
  const actions = [];
  const buttons = [];
  if (!willAuto) {
    actions.push('start');
    buttons.push({ title: next === 'focus' ? 'Start focus' : `Start ${PHASE_LABEL[next]}` });
  }
  if (ended !== 'focus') {
    actions.push(`snooze:${ended}`);
    buttons.push({ title: '5 more break minutes' });
  }
  notify(['ember-end', ...actions], {
    title,
    message: `${what} finished — up next: ${PHASE_LABEL[next]}.`,
    buttons,
  });
}

// Sound plays in an offscreen document (workers can't). Chrome reaps it on
// its own ~30s after audio stops, so nobody here closes anything.
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play timer chimes and optional ambient focus sound',
    });
  }
}

async function sendSound(msg) {
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // No sound is better than a crashed phase transition.
  }
}

async function playChime(state) {
  await sendSound({ type: 'chime', chime: state.settings.chime, volume: state.settings.volume });
}

// Keeps the offscreen ambient loop in step with what's happening: playing
// while focused work runs (when the setting asks for it), silent otherwise.
async function syncAmbient(state) {
  const on =
    state.status === 'running' &&
    WORK_PHASES.includes(state.phase) &&
    state.settings.ambient !== 'off';
  if (!on) {
    // Tell a live document to stop; don't spawn one just to say nothing.
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length) chrome.runtime.sendMessage({ type: 'ambient', sound: 'off' }).catch(() => {});
    return;
  }
  await sendSound({ type: 'ambient', sound: state.settings.ambient, volume: state.settings.volume });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
