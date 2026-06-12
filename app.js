import {
  PHASE_LABEL,
  formatTime,
  remainingFraction,
  remainingMs,
  todayKey,
} from './core/timer.js';
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
const RING_CIRCUMFERENCE = 2 * Math.PI * 164;

const settingToggles = [...document.querySelectorAll('input[data-toggle]')];

let state = null;

$('ring').style.strokeDasharray = RING_CIRCUMFERENCE;

function render(next) {
  state = next;
  if (dialing) return; // the dial owns the display until the drag ends
  document.body.dataset.phase = state.phase;
  document.body.dataset.status = state.status;

  const ms = remainingMs(state);
  const time = formatTime(ms);
  $('time').textContent = time;
  $('phase-label').textContent = PHASE_LABEL[state.phase];
  $('ring').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - remainingFraction(state));
  $('toggle').textContent = state.status === 'running' ? 'Pause' : 'Start';
  $('status-hint').textContent = {
    idle: 'press space · drag ring to set',
    running: '',
    paused: 'paused',
  }[state.status];
  $('extend').classList.toggle('show', extendVisible(state));
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

const renderDurations = bindDurationFields(() => state.settings, update);

function renderSettings() {
  renderDurations(state);
  for (const input of settingToggles) {
    input.checked = state.settings[input.dataset.toggle];
  }
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

/* ---------- ring dial: drag to set the idle phase's length ---------- */

// While dragging, the ring re-scales from "fraction remaining" to an
// absolute clock face: a full circle is the phase's max minutes.
const DIAL = {
  focus: { key: 'focusMin', max: 90 },
  shortBreak: { key: 'shortBreakMin', max: 60 },
  longBreak: { key: 'longBreakMin', max: 90 },
};

const ringWrap = document.querySelector('.ring-wrap');
let dialing = false;
let dialMin = 0;

function dialDelta(e) {
  const rect = ringWrap.getBoundingClientRect();
  return {
    dx: e.clientX - (rect.left + rect.width / 2),
    dy: e.clientY - (rect.top + rect.height / 2),
    radius: rect.width / 2,
  };
}

function setDial(e) {
  const { dx, dy } = dialDelta(e);
  // Fraction of a turn from 12 o'clock, clockwise.
  const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
  const { max } = DIAL[state.phase];
  dialMin = Math.min(max, Math.max(1, Math.round(turn * max)));
  $('ring').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - dialMin / max);
  $('time').textContent = formatTime(dialMin * 60_000);
  $('status-hint').textContent = 'release to set';
}

ringWrap.addEventListener('pointerdown', (e) => {
  if (!state || state.status !== 'idle') return;
  const { dx, dy, radius } = dialDelta(e);
  if (Math.hypot(dx, dy) < radius * 0.25) return; // dead zone at the hub
  e.preventDefault();
  ringWrap.setPointerCapture(e.pointerId);
  dialing = true;
  document.body.classList.add('dialing');
  setDial(e);
});

ringWrap.addEventListener('pointermove', (e) => {
  if (dialing) setDial(e);
});

ringWrap.addEventListener('pointerup', async () => {
  if (!dialing) return;
  endDial();
  update(await send('updateSettings', { settings: { [DIAL[state.phase].key]: dialMin } }));
});

ringWrap.addEventListener('pointercancel', () => {
  if (!dialing) return;
  endDial();
  render(state); // put the real state back on screen
});

function endDial() {
  dialing = false;
  document.body.classList.remove('dialing');
}

/* ---------- extend chips ---------- */

bindExtendButtons(sync);

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
