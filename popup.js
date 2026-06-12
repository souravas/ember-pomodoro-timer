import { PHASE_LABEL, displayMs, formatTime, remainingFraction, todayKey } from './core/timer.js';
import {
  applyTheme,
  bindAccentPicker,
  bindControl,
  bindDurationFields,
  bindExtendButtons,
  bindLabelField,
  bindModeSwitch,
  bindThemePicker,
  createTicker,
  extendVisible,
  getState,
  onStateChange,
  renderDots,
  send,
  setText,
} from './ui.js';

const $ = (id) => document.getElementById(id);

let state = null;

function kickerText(state) {
  if (state.overtime) return 'overtime — end when ready';
  if (state.mode === 'timer') return 'one-shot countdown';
  if (state.mode === 'stopwatch') return 'counting up';
  return state.phase === 'focus'
    ? `session ${Math.min(state.cyclePos + 1, state.settings.longBreakEvery)} of ${state.settings.longBreakEvery}`
    : 'take a breath';
}

// Strict mode arms the controls: interrupting a running focus session
// takes a press-and-hold instead of a click.
function strictArmed() {
  return (
    !!state &&
    state.settings.strict &&
    state.status === 'running' &&
    !state.overtime &&
    state.mode === 'pomodoro' &&
    state.phase === 'focus'
  );
}

function toggleLabel(state) {
  if (state.status !== 'running') return 'Start';
  if (!state.overtime) return 'Pause';
  return state.mode === 'timer' ? 'Done' : 'Take break';
}

function render(next) {
  state = next;
  applyTheme(state.settings.theme, state.settings.accent);
  document.body.dataset.mode = state.mode;
  document.body.dataset.phase = state.phase;
  document.body.dataset.status = state.status;
  document.body.classList.toggle('overtime', !!state.overtime);

  const ms = displayMs(state);
  const time = formatTime(ms);
  document.body.classList.toggle(
    'ending',
    !state.overtime && state.mode !== 'stopwatch' && state.status === 'running' && ms <= 60_000
  );
  setText($('phase-label'), PHASE_LABEL[state.phase]);
  setText($('time'), time);
  $('time').dataset.size = time.length > 5 ? 'long' : 'normal';
  $('bar-fill').style.width = `${remainingFraction(state) * 100}%`;
  setText($('toggle'), toggleLabel(state));
  setText($('session-kicker'), kickerText(state));
  renderDots($('dots'), state);
  renderModes(state);
  $('extend').hidden = !extendVisible(state);
}

// One line of today under the modes — and goal progress once a goal is set.
async function renderToday() {
  const { stats = {} } = await chrome.storage.local.get('stats');
  const day = stats[todayKey()] ?? { sessions: 0, minutes: 0 };
  const goal = state?.settings.goalMin ?? 0;
  const goalPart =
    goal > 0 ? ` · ${Math.min(100, Math.round((day.minutes / goal) * 100))}% of goal` : '';
  setText($('popup-today'), day.minutes === 0 ? 'today · —' : `today · ${day.minutes}m${goalPart}`);
}

const sync = createTicker(render);

// State changes may also need the settings view repainted; ticker re-renders
// only move the countdown.
function update(next) {
  sync(next);
  if (state) {
    renderDurations(state);
    renderTheme(state);
    renderAccent(state);
    renderLabel(state);
  }
}

const renderDurations = bindDurationFields(() => state.settings, update);
const renderTheme = bindThemePicker(update);
const renderAccent = bindAccentPicker(update);
const renderLabel = bindLabelField(update);
const renderModes = bindModeSwitch(update);
bindExtendButtons(sync);

// In strict mode the controls take a press-and-hold while focus runs.
bindControl($('toggle'), strictArmed, async () => {
  if (!state) return;
  sync(await send(state.status === 'running' ? 'pause' : 'start'));
});
bindControl($('reset'), strictArmed, async () => {
  sync(await send('reset'));
});
bindControl($('skip'), strictArmed, async () => {
  sync(await send('skip'));
});
$('open-app').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});
// The dashboard needs room — it lives on the full page.
$('open-stats').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html#stats') });
});
$('popup-today').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html#stats') });
});
// The side panel keeps Ember beside the page. Inside the panel itself the
// button makes no sense (popup.js also drives sidepanel.html) — hidden there.
if (document.body.classList.contains('sidepanel') || !chrome.sidePanel) {
  $('open-panel').hidden = true;
} else {
  $('open-panel').addEventListener('click', async () => {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  });
}

/* ---------- settings flip-view ---------- */

function setView(showSettings) {
  $('timer-view').hidden = showSettings;
  $('settings-view').hidden = !showSettings;
}

$('open-settings').addEventListener('click', () => setView(true));
$('close-settings').addEventListener('click', () => setView(false));

onStateChange(update);

// Today's minutes move on their own cadence (work gets banked).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) renderToday();
});

getState().then((s) => {
  update(s);
  renderToday();
});
