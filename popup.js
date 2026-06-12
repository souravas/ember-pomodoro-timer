import { PHASE_LABEL, formatTime, remainingFraction, remainingMs } from './core/timer.js';
import {
  bindDurationFields,
  bindExtendButtons,
  createTicker,
  extendVisible,
  getState,
  onStateChange,
  renderDots,
  send,
} from './ui.js';

const $ = (id) => document.getElementById(id);

let state = null;

function render(next) {
  state = next;
  document.body.dataset.phase = state.phase;
  document.body.dataset.status = state.status;

  $('phase-label').textContent = PHASE_LABEL[state.phase];
  $('time').textContent = formatTime(remainingMs(state));
  $('bar-fill').style.width = `${remainingFraction(state) * 100}%`;
  $('toggle').textContent = state.status === 'running' ? 'Pause' : 'Start';
  $('session-kicker').textContent =
    state.phase === 'focus'
      ? `session ${Math.min(state.cyclePos + 1, state.settings.longBreakEvery)} of ${state.settings.longBreakEvery}`
      : 'take a breath';
  renderDots($('dots'), state);
  $('extend').hidden = !extendVisible(state);
}

const sync = createTicker(render);

// State changes may also need the settings view repainted; ticker re-renders
// only move the countdown.
function update(next) {
  sync(next);
  if (state) renderDurations(state);
}

const renderDurations = bindDurationFields(() => state.settings, update);
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
