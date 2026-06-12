import { PHASE_LABEL, displayMs, formatTime, remainingFraction } from './core/timer.js';
import {
  applyTheme,
  bindAccentPicker,
  bindDurationFields,
  bindExtendButtons,
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
  if (state.mode === 'timer') return 'one-shot countdown';
  if (state.mode === 'stopwatch') return 'counting up';
  return state.phase === 'focus'
    ? `session ${Math.min(state.cyclePos + 1, state.settings.longBreakEvery)} of ${state.settings.longBreakEvery}`
    : 'take a breath';
}

function render(next) {
  state = next;
  applyTheme(state.settings.theme, state.settings.accent);
  document.body.dataset.mode = state.mode;
  document.body.dataset.phase = state.phase;
  document.body.dataset.status = state.status;

  const ms = displayMs(state);
  const time = formatTime(ms);
  document.body.classList.toggle(
    'ending',
    state.mode !== 'stopwatch' && state.status === 'running' && ms <= 60_000
  );
  setText($('phase-label'), PHASE_LABEL[state.phase]);
  setText($('time'), time);
  $('time').dataset.size = time.length > 5 ? 'long' : 'normal';
  $('bar-fill').style.width = `${remainingFraction(state) * 100}%`;
  setText($('toggle'), state.status === 'running' ? 'Pause' : 'Start');
  setText($('session-kicker'), kickerText(state));
  renderDots($('dots'), state);
  renderModes(state);
  $('extend').hidden = !extendVisible(state);
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
  }
}

const renderDurations = bindDurationFields(() => state.settings, update);
const renderTheme = bindThemePicker(update);
const renderAccent = bindAccentPicker(update);
const renderModes = bindModeSwitch(update);
bindExtendButtons(sync);

$('toggle').addEventListener('click', async () => {
  if (!state) return;
  sync(await send(state.status === 'running' ? 'pause' : 'start'));
});
$('reset').addEventListener('click', async () => {
  sync(await send('reset'));
});
$('skip').addEventListener('click', async () => {
  sync(await send('skip'));
});
$('open-app').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

/* ---------- settings flip-view ---------- */

function setView(showSettings) {
  $('timer-view').hidden = showSettings;
  $('settings-view').hidden = !showSettings;
}

$('open-settings').addEventListener('click', () => setView(true));
$('close-settings').addEventListener('click', () => setView(false));

onStateChange(update);
getState().then(update);
