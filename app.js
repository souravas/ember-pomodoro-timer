import {
  PHASE_LABEL,
  formatTime,
  remainingFraction,
  remainingMs,
  todayKey,
} from './core/timer.js';
import { createTicker, getState, onStateChange, renderDots, send } from './ui.js';

const $ = (id) => document.getElementById(id);
const RING_CIRCUMFERENCE = 2 * Math.PI * 164;

// The settings controls never change shape, so query them once.
const settingFields = [...document.querySelectorAll('.field[data-setting]')].map((field) => ({
  field,
  key: field.dataset.setting,
  output: field.querySelector('output'),
}));
const settingToggles = [...document.querySelectorAll('input[data-toggle]')];

let state = null;

$('ring').style.strokeDasharray = RING_CIRCUMFERENCE;

function render(next) {
  state = next;
  document.body.dataset.phase = state.phase;
  document.body.dataset.status = state.status;

  const ms = remainingMs(state);
  const time = formatTime(ms);
  $('time').textContent = time;
  $('phase-label').textContent = PHASE_LABEL[state.phase];
  $('ring').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - remainingFraction(state));
  $('toggle').textContent = state.status === 'running' ? 'Pause' : 'Start';
  $('status-hint').textContent = {
    idle: 'press space to begin',
    running: '',
    paused: 'paused',
  }[state.status];
  $('session-kicker').textContent =
    state.phase === 'focus'
      ? `session ${Math.min(state.cyclePos + 1, state.settings.longBreakEvery)} of ${state.settings.longBreakEvery}`
      : 'take a breath';
  renderDots($('dots'), state);

  document.title =
    state.status === 'running' ? `${time} · ${PHASE_LABEL[state.phase]} — Ember` : 'Ember';
}

const sync = createTicker(render);

// For state changes (as opposed to ticker re-renders, which only move the
// countdown) the settings panel may need updating too.
function update(next) {
  sync(next);
  if (state) renderSettings();
}

async function renderTodayStat() {
  const { stats = {} } = await chrome.storage.local.get('stats');
  const day = stats[todayKey()] ?? { sessions: 0, minutes: 0 };
  $('today-stat').textContent =
    day.sessions === 0
      ? 'today · no sessions yet'
      : `today · ${day.sessions} session${day.sessions === 1 ? '' : 's'} · ${day.minutes} min`;
}

/* ---------- actions ---------- */

async function toggle() {
  if (!state) return;
  sync(await send(state.status === 'running' ? 'pause' : 'start'));
}

$('toggle').addEventListener('click', toggle);
$('reset').addEventListener('click', async () => {
  sync(await send('reset'));
});
$('skip').addEventListener('click', async () => {
  sync(await send('skip'));
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !panelOpen()) {
    e.preventDefault();
    toggle();
  }
  if (e.code === 'Escape') setPanel(false);
});

/* ---------- settings panel ---------- */

function panelOpen() {
  return $('panel').classList.contains('open');
}

function setPanel(open) {
  $('panel').classList.toggle('open', open);
  $('scrim').hidden = !open;
  // Allow the scrim's opacity transition to play.
  requestAnimationFrame(() => $('scrim').classList.toggle('open', open));
}

$('open-settings').addEventListener('click', () => setPanel(true));
$('close-settings').addEventListener('click', () => setPanel(false));
$('scrim').addEventListener('click', () => setPanel(false));

function renderSettings() {
  for (const { key, output } of settingFields) {
    output.textContent = state.settings[key];
  }
  for (const input of settingToggles) {
    input.checked = state.settings[input.dataset.toggle];
  }
}

for (const { field, key } of settingFields) {
  field.querySelectorAll('.step').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const next = Math.min(
        Number(field.dataset.max),
        Math.max(Number(field.dataset.min), state.settings[key] + Number(btn.dataset.dir))
      );
      update(await send('updateSettings', { settings: { [key]: next } }));
    });
  });
}

for (const input of settingToggles) {
  input.addEventListener('change', async () => {
    update(
      await send('updateSettings', {
        settings: { [input.dataset.toggle]: input.checked },
      })
    );
  });
}

/* ---------- boot ---------- */

onStateChange(update);

// Stats get their own listener: they change on a different cadence than the
// timer state, so neither render path needs to refresh the other.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) renderTodayStat();
});

getState().then((s) => {
  update(s);
  renderTodayStat();
});
