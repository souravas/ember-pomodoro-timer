// Service worker: the single owner of timer state. MV3 may kill this worker
// at any time, so state lives in chrome.storage.local and the phase change
// fires from a chrome.alarm — never from setTimeout.

import {
  DEFAULT_SETTINGS,
  PHASE_LABEL,
  defaultState,
  nextPhase,
  phaseDurationMs,
  phaseTotalMs,
  remainingMs,
  todayKey,
} from './core/timer.js';

const ALARM_PHASE_END = 'phase-end';
const ALARM_BADGE_TICK = 'badge-tick';

const PHASE_COLOR = {
  focus: '#E25C3F',
  shortBreak: '#A8BD8F',
  longBreak: '#93AFC0',
};

async function getState() {
  const { state } = await chrome.storage.local.get('state');
  if (!state) return defaultState();
  // Merge settings so new defaults appear after extension updates.
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  return state;
}

async function setState(state) {
  await chrome.storage.local.set({ state });
  await updateBadge(state);
  return state;
}

chrome.runtime.onInstalled.addListener(async () => {
  await setState(await getState());
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  // If Chrome was closed past the end of a running phase, complete it now.
  if (state.status === 'running' && state.endsAt <= Date.now()) {
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
    extend: (s) => extend(s, msg.minutes),
    updateSettings: (s) => updateSettings(s, msg.settings),
    chimeDone: closeOffscreen,
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
    if (state.status === 'running') await completePhase(state);
  } else if (alarm.name === ALARM_BADGE_TICK) {
    if (state.status === 'running') await updateBadge(state);
    else await chrome.alarms.clear(ALARM_BADGE_TICK);
  }
});

async function start(state) {
  if (state.status === 'running') return state;
  state.status = 'running';
  state.endsAt = Date.now() + state.remainingMs;
  await chrome.alarms.create(ALARM_PHASE_END, { when: state.endsAt });
  await chrome.alarms.create(ALARM_BADGE_TICK, { periodInMinutes: 1 });
  return setState(state);
}

async function pause(state) {
  if (state.status !== 'running') return state;
  state.remainingMs = remainingMs(state);
  state.status = 'paused';
  state.endsAt = null;
  await clearAlarms();
  return setState(state);
}

async function reset(state) {
  state.status = 'idle';
  state.endsAt = null;
  state.remainingMs = phaseDurationMs(state.phase, state.settings);
  state.extendedMs = 0;
  await clearAlarms();
  return setState(state);
}

// Stretch the running phase only — the saved durations are untouched.
async function extend(state, minutes) {
  if (state.status !== 'running' || !(minutes > 0)) return state;
  const ms = minutes * 60_000;
  state.extendedMs = (state.extendedMs ?? 0) + ms;
  state.endsAt += ms;
  await chrome.alarms.create(ALARM_PHASE_END, { when: state.endsAt });
  return setState(state);
}

async function clearAlarms() {
  await chrome.alarms.clear(ALARM_PHASE_END);
  await chrome.alarms.clear(ALARM_BADGE_TICK);
}

// Skip moves to the next phase without crediting the current one.
function skip(state) {
  return advance(state, { credit: false });
}

async function completePhase(state) {
  if (state.settings.notifications) notifyPhaseEnd(state);
  if (state.settings.sound) playChime();
  return advance(state, { credit: true });
}

async function advance(state, { credit }) {
  await clearAlarms(); // start() re-creates them if the next phase auto-starts
  const endedPhase = state.phase;
  const next = nextPhase(state);

  if (endedPhase === 'focus' && credit) {
    state.cyclePos += 1;
    // Credit what was actually worked, including any "+5 min" extensions.
    await recordFocusSession(Math.round(phaseTotalMs(state) / 60_000));
  }
  if (endedPhase === 'longBreak') state.cyclePos = 0;

  state.phase = next;
  state.remainingMs = phaseDurationMs(next, state.settings);
  state.extendedMs = 0;
  state.endsAt = null;
  state.status = 'idle';

  const auto =
    next === 'focus' ? state.settings.autoStartFocus : state.settings.autoStartBreaks;
  if (auto && credit) return start(state);
  return setState(state);
}

async function updateSettings(state, settings) {
  state.settings = { ...state.settings, ...settings };
  // If the current phase hasn't started, adopt its new duration.
  if (state.status === 'idle') {
    state.remainingMs = phaseDurationMs(state.phase, state.settings);
    state.extendedMs = 0;
  }
  return setState(state);
}

async function recordFocusSession(minutes) {
  const key = todayKey();
  const { stats = {} } = await chrome.storage.local.get('stats');
  const day = stats[key] ?? { sessions: 0, minutes: 0 };
  day.sessions += 1;
  day.minutes += minutes;
  stats[key] = day;
  await chrome.storage.local.set({ stats });
}

async function updateBadge(state) {
  let text = '';
  if (state.status === 'running') {
    text = `${Math.ceil(remainingMs(state) / 60_000)}m`;
  } else if (state.status === 'paused') {
    text = '||';
  }
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: PHASE_COLOR[state.phase] });
    await chrome.action.setBadgeTextColor({ color: '#1A1310' });
  }
}

function notifyPhaseEnd(state) {
  const ended = PHASE_LABEL[state.phase];
  const next = PHASE_LABEL[nextPhase(state)];
  const title = state.phase === 'focus' ? 'Focus session complete' : 'Break is over';
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: `${capitalize(ended)} finished — up next: ${next}.`,
    silent: true, // we play our own chime
  });
}

async function playChime() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play a short chime when a timer phase ends',
      });
    }
    chrome.runtime.sendMessage({ type: 'chime' }).catch(() => {});
  } catch {
    // No sound is better than a crashed phase transition.
  }
}

async function closeOffscreen() {
  await chrome.offscreen.closeDocument().catch(() => {});
  return null;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
