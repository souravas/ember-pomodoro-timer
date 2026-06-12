import {
  PHASE_LABEL,
  displayMs,
  formatClock,
  formatTime,
  remainingFraction,
  todayKey,
} from './core/timer.js';
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
const RING_CIRCUMFERENCE = 2 * Math.PI * 164;

const settingToggles = [...document.querySelectorAll('input[data-toggle]')];

let state = null;

$('ring').style.strokeDasharray = RING_CIRCUMFERENCE;

let lastPhase = null;

// One bright pulse of the ring when a phase hands over to the next.
function flare() {
  const ring = document.querySelector('.ring');
  ring.classList.remove('flare');
  void ring.getBoundingClientRect(); // restart the animation
  ring.classList.add('flare');
}

// The big digits switch to h:mm:ss past the hour; shrink so they still fit.
function setTimeText(ms) {
  const time = formatTime(ms);
  setText($('time'), time);
  $('time').dataset.size = time.length > 5 ? 'long' : 'normal';
  return time;
}

function kickerText(state) {
  if (state.mode === 'timer') return 'one-shot countdown';
  if (state.mode === 'stopwatch') return 'counting up';
  return state.phase === 'focus'
    ? `session ${Math.min(state.cyclePos + 1, state.settings.longBreakEvery)} of ${state.settings.longBreakEvery}`
    : 'take a breath';
}

function idleHint(state) {
  if (state.mode === 'stopwatch') return 'press space to begin';
  return 'drag the dial to set · space to start';
}

function render(next) {
  state = next;
  if (dialing) return; // the dial owns the display until the drag ends
  applyTheme(state.settings.theme, state.settings.accent);
  document.body.dataset.mode = state.mode;
  document.body.dataset.phase = state.phase;
  document.body.dataset.status = state.status;
  if (lastPhase && lastPhase !== state.phase) flare();
  lastPhase = state.phase;

  const ms = displayMs(state);
  const time = setTimeText(ms);
  document.body.classList.toggle(
    'ending',
    state.mode !== 'stopwatch' && state.status === 'running' && ms <= 60_000
  );
  setText($('phase-label'), PHASE_LABEL[state.phase]);
  $('ring').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - remainingFraction(state));
  $('tip').style.setProperty('--frac', remainingFraction(state));
  setText($('toggle'), state.status === 'running' ? 'Pause' : 'Start');
  setText(
    $('ends-at'),
    state.status === 'running' && state.mode !== 'stopwatch'
      ? `ends ${formatClock(state.endsAt)}`
      : ''
  );
  setText(
    $('status-hint'),
    {
      idle: idleHint(state),
      running: '',
      paused: 'paused',
    }[state.status]
  );
  $('extend').classList.toggle('show', extendVisible(state));
  setText($('session-kicker'), kickerText(state));
  renderDots($('dots'), state);
  renderModes(state);
  if (DIAL[state.phase]) buildTicks(DIAL[state.phase].max);

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
  const scrim = $('scrim');
  if (open) {
    scrim.hidden = false;
    // Let the unhide land before the fade starts, or the transition is skipped.
    requestAnimationFrame(() => {
      if (panelOpen()) scrim.classList.add('open');
    });
  } else {
    scrim.classList.remove('open');
    // Hide only after the fade-out plays — unless the panel reopened meanwhile.
    scrim.addEventListener(
      'transitionend',
      () => {
        if (!panelOpen()) scrim.hidden = true;
      },
      { once: true }
    );
  }
  // Hand keyboard focus across the threshold; :focus-visible keeps the
  // ring invisible for mouse users.
  if (open) $('close-settings').focus();
  else if ($('panel').contains(document.activeElement)) $('open-settings').focus();
}

$('open-settings').addEventListener('click', () => setPanel(true));
$('close-settings').addEventListener('click', () => setPanel(false));
$('scrim').addEventListener('click', () => setPanel(false));

const renderDurations = bindDurationFields(() => state.settings, update);
const renderTheme = bindThemePicker(update);
const renderAccent = bindAccentPicker(update);

function renderSettings() {
  renderDurations(state);
  renderTheme(state);
  renderAccent(state);
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
// absolute clock face: a full circle is the phase's max minutes. The dial
// snaps to 5-minute notches — the tick marks make the scale visible.
const DIAL = {
  focus: { key: 'focusMin', max: 120 },
  shortBreak: { key: 'shortBreakMin', max: 60 },
  longBreak: { key: 'longBreakMin', max: 90 },
  timer: { key: 'timerMin', max: 120 },
};
const DIAL_STEP = 5;

const ringWrap = document.querySelector('.ring-wrap');
let dialing = false;
let dialMin = 0;

// One tick per notch, majors on the quarter-hour-ish anchors. Rebuilt only
// when the scale (the phase's max) changes.
function buildTicks(max) {
  const ticks = $('ticks');
  if (Number(ticks.dataset.max) === max) return;
  ticks.dataset.max = max;
  const majorEvery = max <= 60 ? 15 : 30;
  const lines = [];
  for (let m = 0; m < max; m += DIAL_STEP) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const major = m % majorEvery === 0;
    line.setAttribute('x1', '180');
    line.setAttribute('y1', '26');
    line.setAttribute('x2', '180');
    line.setAttribute('y2', major ? '36' : '31');
    line.setAttribute('transform', `rotate(${(m / max) * 360} 180 180)`);
    if (major) line.setAttribute('class', 'major');
    lines.push(line);
  }
  ticks.replaceChildren(...lines);
}

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
  dialMin = Math.min(max, Math.max(DIAL_STEP, Math.round((turn * max) / DIAL_STEP) * DIAL_STEP));
  $('ring').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - dialMin / max);
  $('tip').style.setProperty('--frac', dialMin / max);
  setTimeText(dialMin * 60_000);
  $('ends-at').textContent = `ends ${formatClock(Date.now() + dialMin * 60_000)}`;
  $('status-hint').textContent = 'release to set';
}

ringWrap.addEventListener('pointerdown', (e) => {
  if (!state || state.status !== 'idle' || !DIAL[state.phase]) return;
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

/* ---------- extend chips & mode tabs ---------- */

bindExtendButtons(sync);
const renderModes = bindModeSwitch(update);

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
