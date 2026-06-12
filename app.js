import {
  PHASE_LABEL,
  PRESETS,
  displayMs,
  formatClock,
  formatTime,
  remainingFraction,
  todayKey,
} from './core/timer.js';
import {
  daySeries,
  formatHours,
  formatHoursShort,
  heatLevel,
  heatmapDays,
  parseKey,
  summary,
  weekDays,
  weekSeries,
} from './core/stats.js';
import { completionStats, hourHistogram, labelTotals } from './core/log.js';
import { playChime, startAmbient } from './core/sound.js';
import {
  applyTheme,
  bindAccentPicker,
  bindControl,
  bindDurationFields,
  bindLabelField,
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
  if (state.overtime) return 'overtime — end when ready';
  if (state.mode === 'timer') return 'one-shot countdown';
  if (state.mode === 'stopwatch') return 'counting up';
  return state.phase === 'focus'
    ? `session ${Math.min(state.cyclePos + 1, state.settings.longBreakEvery)} of ${state.settings.longBreakEvery}`
    : 'take a breath';
}

// Strict mode arms the controls: while a focus session runs, pause/reset/
// skip want a deliberate press-and-hold instead of a stray click.
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

// The primary button reads as what it will do.
function toggleLabel(state) {
  if (state.status !== 'running') return 'Start';
  if (!state.overtime) return 'Pause';
  return state.mode === 'timer' ? 'Done' : 'Take break';
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
  document.body.classList.toggle('overtime', !!state.overtime);
  if (lastPhase && lastPhase !== state.phase) flare();
  lastPhase = state.phase;

  const ms = displayMs(state);
  const time = setTimeText(ms);
  document.body.classList.toggle(
    'ending',
    !state.overtime && state.mode !== 'stopwatch' && state.status === 'running' && ms <= 60_000
  );
  setText($('phase-label'), PHASE_LABEL[state.phase]);
  $('ring').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - remainingFraction(state));
  $('tip').style.setProperty('--frac', remainingFraction(state));
  setText($('toggle'), toggleLabel(state));
  setText(
    $('ends-at'),
    state.status === 'running' && state.mode !== 'stopwatch'
      ? `${state.overtime ? 'ended' : 'ends'} ${formatClock(state.endsAt)}`
      : ''
  );
  setText(
    $('status-hint'),
    {
      idle: idleHint(state),
      running: strictArmed() ? 'strict · hold a button to interrupt' : '',
      paused: state.autoPausedAt ? 'auto-paused while you were away' : 'paused',
    }[state.status]
  );
  $('extend').classList.toggle('show', extendVisible(state));
  setText($('session-kicker'), kickerText(state));
  renderDots($('dots'), state);
  renderModes(state);
  if (DIAL[state.phase]) buildTicks(DIAL[state.phase].max);

  document.title =
    state.status === 'running'
      ? `${state.overtime ? '+' : ''}${time} · ${PHASE_LABEL[state.phase]} — Ember`
      : 'Ember';
  renderPip();
}

const sync = createTicker(render);

// For state changes (as opposed to ticker re-renders, which only move the
// countdown) the settings panel may need updating too.
function update(next) {
  sync(next);
  if (!state) return;
  renderSettings();
  renderLabel(state);
  // The dashboard frames its weeks by settings.weekStart — re-render the
  // open view when that changes (or when state lands after a #stats boot).
  if (statsOpen() && weekStartOf() !== renderedWeekStart) renderStats();
}

async function renderTodayStat() {
  const { stats = {}, log = [] } = await chrome.storage.local.get(['stats', 'log']);
  const day = stats[todayKey()] ?? { sessions: 0, minutes: 0 };
  const goal = state?.settings.goalMin ?? 0;
  const goalPart = goal > 0 ? ` · ${Math.min(100, Math.round((day.minutes / goal) * 100))}% of goal` : '';
  $('today-stat').textContent =
    day.sessions === 0 && day.minutes === 0
      ? 'today · no sessions yet'
      : `today · ${day.sessions} session${day.sessions === 1 ? '' : 's'} · ${day.minutes} min${goalPart}`;
  // The hover tooltip carries today's per-label split.
  const rows = labelTotals(log, new Date().setHours(0, 0, 0, 0));
  $('today-stat').title = rows.length
    ? rows.map((r) => `${r.label ?? 'unlabelled'} · ${formatHours(r.min)}`).join('\n')
    : 'Open stats';
}

/* ---------- actions ---------- */

async function toggle() {
  if (!state) return;
  sync(await send(state.status === 'running' ? 'pause' : 'start'));
}

// In strict mode the buttons want a press-and-hold while focus runs.
bindControl($('toggle'), strictArmed, toggle);
bindControl($('reset'), strictArmed, async () => {
  sync(await send('reset'));
});
bindControl($('skip'), strictArmed, async () => {
  sync(await send('skip'));
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  if (e.code === 'Space' && !panelOpen() && !statsOpen()) {
    e.preventDefault();
    if (!strictArmed()) toggle(); // strict: the hold lives on the buttons
  }
  if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey && !e.altKey && !panelOpen() && !statsOpen()) {
    setZen(!document.body.classList.contains('zen'));
  }
  if (e.code === 'Escape') {
    if (panelOpen()) setPanel(false);
    else if (statsOpen()) setStatsView(false);
    else if (document.body.classList.contains('zen')) setZen(false);
  }
});

/* ---------- zen mode: just the flame and the time ---------- */

function setZen(on) {
  document.body.classList.toggle('zen', on);
}

$('open-zen').addEventListener('click', () => setZen(true));

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
const renderLabel = bindLabelField(update);

function renderSettings() {
  renderDurations(state);
  renderTheme(state);
  renderAccent(state);
  for (const input of settingToggles) {
    input.checked = state.settings[input.dataset.toggle];
  }
  markActive(weekStartButtons, (btn) => Number(btn.dataset.weekStart) === state.settings.weekStart);
  markActive(presetButtons, (btn) => {
    const preset = PRESETS.find((p) => p.id === btn.dataset.preset);
    return Object.entries(preset.settings).every(([k, v]) => state.settings[k] === v);
  });
  markActive(chimeButtons, (btn) => btn.dataset.chime === state.settings.chime);
  markActive(ambientButtons, (btn) => btn.dataset.ambient === state.settings.ambient);
  if (document.activeElement !== $('volume')) {
    $('volume').value = Math.round(state.settings.volume * 100);
  }
  blockToggle.checked = state.settings.blockEnabled;
  if (document.activeElement !== blockListInput) blockListInput.value = state.settings.blockList;
  warnIfBlockPermMissing();
}

function markActive(buttons, isActive) {
  for (const btn of buttons) {
    const active = isActive(btn);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
}

const weekStartButtons = [...document.querySelectorAll('#week-start button')];
for (const btn of weekStartButtons) {
  btn.addEventListener('click', async () => {
    update(
      await send('updateSettings', { settings: { weekStart: Number(btn.dataset.weekStart) } })
    );
  });
}

const presetButtons = [...document.querySelectorAll('#presets button')];
for (const btn of presetButtons) {
  btn.addEventListener('click', async () => {
    const preset = PRESETS.find((p) => p.id === btn.dataset.preset);
    update(await send('updateSettings', { settings: { ...preset.settings } }));
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

/* ---------- site blocking: the toggle carries a permission ask ---------- */

// Redirecting pages needs declarativeNetRequest plus host access — optional
// permissions, so Chrome's consent dialog appears the first time the toggle
// goes on (and never at install). Declined means the toggle stays off.
const BLOCK_PERMS = { permissions: ['declarativeNetRequest'], origins: ['<all_urls>'] };
const blockToggle = $('block-toggle');
const blockListInput = $('block-list');

blockToggle.addEventListener('change', async () => {
  if (blockToggle.checked) {
    const granted = await chrome.permissions.request(BLOCK_PERMS).catch(() => false);
    if (!granted) {
      blockToggle.checked = false;
      return;
    }
  }
  update(await send('updateSettings', { settings: { blockEnabled: blockToggle.checked } }));
});

blockListInput.addEventListener('change', async () => {
  update(await send('updateSettings', { settings: { blockList: blockListInput.value } }));
});

// Settings sync across machines but permission grants don't — surface the
// gap instead of letting the blocklist silently do nothing here.
async function warnIfBlockPermMissing() {
  const granted = await chrome.permissions.contains(BLOCK_PERMS).catch(() => false);
  $('block-perm-note').hidden = !(state.settings.blockEnabled && !granted);
}

/* ---------- sound settings: voices, volume, ambient, previews ---------- */

// Previews play right here on the page — same synth the offscreen document
// uses, so what you hear is what you'll get.
let previewCtx = null;
let ambientPreview = null;

function previewOut(seconds) {
  previewCtx ??= new AudioContext();
  const g = previewCtx.createGain();
  g.gain.value = (state?.settings.volume ?? 0.7) ** 2;
  g.connect(previewCtx.destination);
  if (seconds) setTimeout(() => g.disconnect(), seconds * 1000);
  return g;
}

function previewChime(kind) {
  stopAmbientPreview();
  const out = previewOut(4);
  playChime(previewCtx, out, kind ?? state?.settings.chime);
}

function previewAmbient(kind) {
  stopAmbientPreview();
  if (!kind || kind === 'off') return;
  const out = previewOut(4);
  ambientPreview = startAmbient(previewCtx, out, kind);
  setTimeout(stopAmbientPreview, 3500);
}

function stopAmbientPreview() {
  ambientPreview?.stop();
  ambientPreview = null;
}

const chimeButtons = [...document.querySelectorAll('#chime-voice button')];
for (const btn of chimeButtons) {
  btn.addEventListener('click', async () => {
    update(await send('updateSettings', { settings: { chime: btn.dataset.chime } }));
    previewChime(btn.dataset.chime);
  });
}

const ambientButtons = [...document.querySelectorAll('#ambient button')];
for (const btn of ambientButtons) {
  btn.addEventListener('click', async () => {
    update(await send('updateSettings', { settings: { ambient: btn.dataset.ambient } }));
    previewAmbient(btn.dataset.ambient);
  });
}

$('volume').addEventListener('change', async (e) => {
  update(await send('updateSettings', { settings: { volume: Number(e.target.value) / 100 } }));
  previewChime();
});

$('preview-sound').addEventListener('click', () => previewChime());

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

/* ---------- stats dashboard ---------- */

// One SVG chart, three scales: the week reads as bars, the longer ranges
// as a stock-ticker area line. All of it is rebuilt from the cached stats
// on every render — the data is tiny.
const RANGES = {
  week: { title: 'this week', kind: 'bars' },
  month: { title: 'last 30 days', kind: 'line' },
  year: { title: 'last 12 months', kind: 'line' },
};
const CW = 720;
const CH = 230;
const CTOP = 30;
const CBOT = 26;
const CLEFT = 10;
const CRIGHT = 10;

let statsCache = null;
let chartRange = 'week';
let chartPoints = null; // current series, stashed for hover lookups
let chartKind = 'bars';
let chartMax = 60; // minutes at the top of the y scale
let renderedWeekStart = null; // what the open dashboard was framed with

const WEEK_START_NAME = { 0: 'sunday', 1: 'monday', 6: 'saturday' };

function weekStartOf() {
  return state?.settings.weekStart ?? 1;
}

function statsOpen() {
  return $('stats').classList.contains('open');
}

function setStatsView(open) {
  $('stats').classList.toggle('open', open);
  if (open) {
    renderStats();
    $('close-stats').focus();
  } else if ($('stats').contains(document.activeElement)) {
    $('open-stats').focus();
  }
}

async function renderStats() {
  const { stats = {}, log = [] } = await chrome.storage.local.get(['stats', 'log']);
  statsCache = stats;
  renderedWeekStart = weekStartOf();
  renderCards(stats, log);
  renderChart();
  renderLabelsCard(log);
  renderHours(log);
  renderSessions(log);
  renderHeatmap(stats);
}

// Where the week's time went, label by label. Built with DOM nodes, not
// innerHTML — labels are user text. Hidden until any work carries a label.
function renderLabelsCard(log) {
  const rows = labelTotals(log, Date.now() - 7 * 86_400_000);
  const show = rows.some((r) => r.label);
  $('labels-card').hidden = !show;
  if (!show) return;
  const max = rows[0].min || 1;
  $('label-rows').replaceChildren(
    ...rows.slice(0, 8).map((r) => {
      const li = document.createElement('li');
      li.className = 'label-row';
      if (!r.label) li.classList.add('muted');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = r.label ?? 'unlabelled';
      const track = document.createElement('span');
      track.className = 'track';
      const fill = document.createElement('i');
      fill.className = 'fill';
      fill.style.width = `${Math.max(4, (r.min / max) * 100)}%`;
      track.append(fill);
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = r.sessions
        ? `${formatHours(r.min)} · ${plural(r.sessions, 'session')}`
        : formatHours(r.min);
      li.append(name, track, amount, labelActions(r.label));
      return li;
    })
  );
}

// Rename (which merges) or remove a label across its whole history. The
// worker rewrites the log; storage.onChanged repaints everything open.
function labelActions(label) {
  const wrap = document.createElement('span');
  wrap.className = 'label-actions';
  if (!label) return wrap; // 'unlabelled' is not a label
  const rename = document.createElement('button');
  rename.textContent = '✎';
  rename.title = `Rename “${label}” everywhere`;
  rename.setAttribute('aria-label', `Rename label ${label}`);
  rename.addEventListener('click', async () => {
    const to = prompt(`Rename “${label}” to:`, label);
    if (to === null) return;
    const next = to.trim().slice(0, 60);
    if (next && next !== label) update(await send('labelRename', { from: label, to: next }));
  });
  const clear = document.createElement('button');
  clear.textContent = '×';
  clear.title = `Remove label “${label}” (the time stays, unlabelled)`;
  clear.setAttribute('aria-label', `Remove label ${label}`);
  clear.addEventListener('click', async () => {
    if (confirm(`Remove the label “${label}” from all entries? The time itself stays.`)) {
      update(await send('labelClear', { label }));
    }
  });
  wrap.append(rename, clear);
  return wrap;
}

// Worked minutes by hour of day, last 30 days — a small skyline.
function renderHours(log) {
  const hours = hourHistogram(log, Date.now() - 30 * 86_400_000);
  const total = hours.reduce((a, b) => a + b, 0);
  $('hours-card').hidden = total === 0;
  if (total === 0) return;
  const W = 720;
  const H = 120;
  const TOP = 12;
  const BOT = 22;
  const slot = W / 24;
  const max = Math.max(...hours);
  const parts = [`<line class="axis" x1="0" y1="${H - BOT}" x2="${W}" y2="${H - BOT}"/>`];
  for (const [h, min] of hours.entries()) {
    if (min > 0) {
      const bh = Math.max(2, (H - TOP - BOT) * (min / max));
      parts.push(
        `<rect class="hbar" x="${(slot * h + slot * 0.2).toFixed(1)}" y="${(H - BOT - bh).toFixed(1)}" width="${(slot * 0.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="3"><title>${hourLabel(h)} – ${hourLabel((h + 1) % 24)} · ${formatHours(min)}</title></rect>`
      );
    }
    if (h % 6 === 0) {
      parts.push(
        `<text x="${(slot * h + slot / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${hourLabel(h)}</text>`
      );
    }
  }
  $('hours-chart').innerHTML = parts.join('');
}

function hourLabel(h) {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

// The raw ledger: the most recent dozen banked runs, each deletable.
function renderSessions(log) {
  const rows = log.slice(-12).reverse();
  const wrap = $('session-rows');
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'sessions-empty';
    li.textContent = 'nothing banked yet — finish a session and it lands here';
    wrap.replaceChildren(li);
    return;
  }
  const tKey = todayKey();
  wrap.replaceChildren(
    ...rows.map((e) => {
      const li = document.createElement('li');
      li.className = 'session-row';
      const when = document.createElement('span');
      when.className = 'when';
      const d = new Date(e.end);
      const range = `${formatClock(e.start)} – ${formatClock(e.end)}`;
      when.textContent = todayKey(d) === tKey ? range : `${dateLabel(d)} · ${range}`;
      const label = document.createElement('span');
      label.className = 'slabel';
      if (!e.label) label.classList.add('muted');
      label.textContent = e.label ?? 'unlabelled';
      const min = document.createElement('span');
      min.className = 'smin';
      min.textContent = formatHours(e.min);
      const mode = document.createElement('span');
      mode.className = 'smode';
      mode.textContent = e.mode === 'pomodoro' && !e.completed ? 'partial' : e.mode;
      const del = document.createElement('button');
      del.className = 'row-del';
      del.textContent = '×';
      del.title = 'Delete this entry (and its minutes)';
      del.setAttribute('aria-label', 'Delete entry');
      del.addEventListener('click', async () => {
        if (confirm(`Delete this ${e.min} minute entry? Its time comes off the stats.`)) {
          await send('logDelete', { id: e.id });
        }
      });
      li.append(when, label, min, mode, del);
      return li;
    })
  );
}

// "9 jun", "9 jun 2025" once the year differs, "mon 9 jun" for weekdays.
function dateLabel(date, { weekday = false } = {}) {
  const opts = { day: 'numeric', month: 'short' };
  if (weekday) opts.weekday = 'short';
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString([], opts).toLowerCase();
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function statCard(label, value, sub) {
  return `<div class="stat-card"><span class="kicker">${label}</span><span class="stat-value">${value}</span><span class="stat-sub">${sub}</span></div>`;
}

function renderCards(stats, log) {
  const s = summary(stats, weekStartOf());
  const streakSub =
    s.bestStreak > s.streak
      ? `best · ${plural(s.bestStreak, 'day')}`
      : s.streak > 0
        ? 'personal best'
        : 'start one today';
  const goal = state?.settings.goalMin ?? 0;
  const todaySub =
    goal > 0
      ? `${plural(s.today.sessions, 'session')} · ${Math.min(100, Math.round((s.today.minutes / goal) * 100))}% of goal`
      : plural(s.today.sessions, 'session');
  const comp = completionStats(log, Date.now() - 30 * 86_400_000);
  const rate = comp.total ? Math.round((comp.completed / comp.total) * 100) : null;
  $('stat-cards').innerHTML = [
    statCard('today', formatHours(s.today.minutes), todaySub),
    statCard('this week', formatHours(s.weekMin), `since ${WEEK_START_NAME[weekStartOf()]}`),
    statCard('streak', plural(s.streak, 'day'), streakSub),
    statCard(
      'best day',
      s.bestDay ? formatHours(s.bestDay.minutes) : '—',
      s.bestDay ? dateLabel(parseKey(s.bestDay.key)) : 'no focus yet'
    ),
    statCard(
      'finish rate · 30d',
      rate === null ? '—' : `${rate}%`,
      rate === null ? 'no focus runs yet' : `${comp.completed} of ${comp.total} runs`
    ),
    statCard('all time', formatHours(s.totalMin), plural(s.totalSessions, 'session')),
  ].join('');
}

function chartSeries(range) {
  if (range === 'week') return weekDays(statsCache, weekStartOf());
  if (range === 'month') return daySeries(statsCache, 30);
  return weekSeries(statsCache, 52, weekStartOf());
}

function yFor(minutes) {
  return CTOP + (CH - CTOP - CBOT) * (1 - minutes / chartMax);
}

// Idle readout under the chart title: the range's total and average.
function resetReadout() {
  const total = chartPoints.reduce((sum, p) => sum + p.minutes, 0);
  if (total === 0) {
    $('chart-readout').textContent = 'no focus in this range yet';
    return;
  }
  const days =
    chartRange === 'week' ? chartPoints.findIndex((p) => p.key === todayKey()) + 1 : 30;
  const avg =
    chartRange === 'year'
      ? `avg ${formatHours(Math.round(total / chartPoints.length))} a week`
      : `avg ${formatHours(Math.round(total / Math.max(1, days)))} a day`;
  $('chart-readout').textContent = `${formatHours(total)} · ${avg}`;
}

function renderChart() {
  const { title, kind } = RANGES[chartRange];
  const pts = chartSeries(chartRange);
  chartPoints = pts;
  chartKind = kind;
  // The year chart's points are whole weeks, so the goal scales to match.
  const goalMin = state?.settings.goalMin ?? 0;
  const goalLine = goalMin > 0 ? (chartRange === 'year' ? goalMin * 7 : goalMin) : 0;
  chartMax = Math.ceil(Math.max(60, goalLine * 1.15, ...pts.map((p) => p.minutes)) / 30) * 30;
  setText($('chart-title'), title);

  const innerW = CW - CLEFT - CRIGHT;
  const innerH = CH - CTOP - CBOT;
  const baseY = CTOP + innerH;
  const parts = [
    `<defs><linearGradient id="chart-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color: var(--accent-focus); stop-opacity: 0.26"/><stop offset="1" style="stop-color: var(--accent-focus); stop-opacity: 0"/></linearGradient></defs>`,
  ];

  for (const frac of [0.5, 1]) {
    const y = yFor(chartMax * frac).toFixed(1);
    parts.push(`<line class="grid" x1="${CLEFT}" y1="${y}" x2="${CW - CRIGHT}" y2="${y}"/>`);
    parts.push(
      `<text x="${CW - CRIGHT}" y="${y - 6}" text-anchor="end">${formatHoursShort(chartMax * frac)}</text>`
    );
  }
  parts.push(`<line class="axis" x1="${CLEFT}" y1="${baseY}" x2="${CW - CRIGHT}" y2="${baseY}"/>`);

  if (goalLine) {
    const gy = yFor(goalLine).toFixed(1);
    parts.push(`<line class="goal-line" x1="${CLEFT}" y1="${gy}" x2="${CW - CRIGHT}" y2="${gy}"/>`);
    parts.push(`<text class="goal-text" x="${CLEFT + 2}" y="${gy - 6}">goal</text>`);
  }

  if (kind === 'bars') {
    const slot = innerW / pts.length;
    const barW = Math.min(44, slot * 0.5);
    for (const [i, p] of pts.entries()) {
      const cx = CLEFT + slot * (i + 0.5);
      if (p.minutes > 0) {
        const h = Math.max(3, innerH * (p.minutes / chartMax));
        const today = p.key === todayKey() ? ' today' : '';
        parts.push(
          `<rect class="bar${today}" x="${(cx - barW / 2).toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4"/>`
        );
        parts.push(
          `<text x="${cx.toFixed(1)}" y="${(baseY - h - 8).toFixed(1)}" text-anchor="middle">${formatHoursShort(p.minutes)}</text>`
        );
      }
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${CH - 8}" text-anchor="middle">${p.date.toLocaleDateString([], { weekday: 'short' }).toLowerCase()}</text>`
      );
    }
  } else {
    const step = innerW / (pts.length - 1);
    const path = pts
      .map((p, i) => `${i ? 'L' : 'M'}${(CLEFT + step * i).toFixed(1)} ${yFor(p.minutes).toFixed(1)}`)
      .join('');
    parts.push(`<path class="spark-area" d="${path}L${CW - CRIGHT} ${baseY}L${CLEFT} ${baseY}Z"/>`);
    parts.push(`<path class="spark-line" d="${path}"/>`);
    for (const [i, p] of pts.entries()) {
      // Month: a label every 7th day counted back from today. Year: one at
      // each month boundary.
      const label =
        chartRange === 'month'
          ? (pts.length - 1 - i) % 7 === 0 && dateLabel(p.date)
          : i > 0 &&
            p.date.getMonth() !== pts[i - 1].date.getMonth() &&
            p.date.toLocaleDateString([], { month: 'short' }).toLowerCase();
      if (!label) continue;
      const anchor = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle';
      parts.push(
        `<text x="${(CLEFT + step * i).toFixed(1)}" y="${CH - 8}" text-anchor="${anchor}">${label}</text>`
      );
    }
  }

  parts.push(`<line id="chart-cross" class="cross" y1="${CTOP}" y2="${baseY}" opacity="0"/>`);
  parts.push(`<circle id="chart-dot" class="dot" r="4" opacity="0"/>`);
  $('chart').innerHTML = parts.join('');
  resetReadout();
}

// Hover scrubbing: nearest point gets a crosshair, a dot on the line, and
// its exact date · time in the readout.
$('chart').addEventListener('pointermove', (e) => {
  if (!chartPoints) return;
  const rect = $('chart').getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * CW;
  const innerW = CW - CLEFT - CRIGHT;
  const n = chartPoints.length;
  const i = Math.max(
    0,
    Math.min(
      n - 1,
      chartKind === 'bars'
        ? Math.floor((x - CLEFT) / (innerW / n))
        : Math.round((x - CLEFT) / (innerW / (n - 1)))
    )
  );
  const p = chartPoints[i];
  const px = chartKind === 'bars' ? CLEFT + (innerW / n) * (i + 0.5) : CLEFT + (innerW / (n - 1)) * i;
  const cross = $('chart-cross');
  cross.setAttribute('x1', px);
  cross.setAttribute('x2', px);
  cross.setAttribute('opacity', '1');
  const dot = $('chart-dot');
  dot.setAttribute('cx', px);
  dot.setAttribute('cy', yFor(p.minutes).toFixed(1));
  dot.setAttribute('opacity', chartKind === 'bars' ? '0' : '1');
  const when =
    chartRange === 'year' ? `week of ${dateLabel(p.date)}` : dateLabel(p.date, { weekday: true });
  $('chart-readout').textContent = `${when} · ${formatHours(p.minutes)}`;
});

$('chart').addEventListener('pointerleave', () => {
  if (!chartPoints) return;
  $('chart-cross').setAttribute('opacity', '0');
  $('chart-dot').setAttribute('opacity', '0');
  resetReadout();
});

function renderHeatmap(stats) {
  const tKey = todayKey();
  $('heat-grid').innerHTML = heatmapDays(stats, weekStartOf())
    .map(
      (p) =>
        `<i data-level="${heatLevel(p.minutes)}"${p.key === tKey ? ' class="today"' : ''} title="${dateLabel(p.date)} · ${formatHours(p.minutes)}"></i>`
    )
    .join('');
}

const rangeButtons = [...document.querySelectorAll('#ranges .range')];
for (const btn of rangeButtons) {
  btn.addEventListener('click', () => {
    chartRange = btn.dataset.range;
    for (const b of rangeButtons) {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', String(b === btn));
    }
    if (statsCache) renderChart();
  });
}
rangeButtons[0].classList.add('active');

$('open-stats').addEventListener('click', () => setStatsView(true));
$('today-stat').addEventListener('click', () => setStatsView(true));
$('close-stats').addEventListener('click', () => setStatsView(false));

/* ---------- manual entries ---------- */

$('add-entry').addEventListener('click', () => {
  const form = $('entry-form');
  form.hidden = !form.hidden;
  if (!form.hidden) {
    $('entry-date').value = todayKey();
    $('entry-min').focus();
  }
});

$('entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await send('logAdd', {
    entry: {
      minutes: $('entry-min').value,
      label: $('entry-label').value,
      date: $('entry-date').value,
    },
  });
  e.target.reset();
  $('entry-form').hidden = true;
});

/* ---------- backup: export & import ---------- */

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('export-json').addEventListener('click', async () => {
  const { stats = {}, log = [] } = await chrome.storage.local.get(['stats', 'log']);
  const data = {
    ember: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings: state?.settings,
    stats,
    log,
  };
  download(`ember-backup-${todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
});

$('export-csv').addEventListener('click', async () => {
  const { log = [] } = await chrome.storage.local.get('log');
  const esc = (s) => `"${String(s ?? '').replaceAll('"', '""')}"`;
  const rows = [
    'date,start,end,minutes,label,mode,completed',
    ...log.map((e) =>
      [
        todayKey(new Date(e.end)),
        new Date(e.start).toISOString(),
        new Date(e.end).toISOString(),
        e.min,
        esc(e.label),
        e.mode,
        e.completed,
      ].join(',')
    ),
  ];
  download(`ember-sessions-${todayKey()}.csv`, rows.join('\n'), 'text/csv');
});

$('import-data').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data = null;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert('That file is not readable as an Ember backup.');
    return;
  }
  const days = Object.keys(data?.stats ?? {}).length;
  const entries = Array.isArray(data?.log) ? data.log.length : 0;
  if (!confirm(`Replace everything with this backup? (${days} days, ${entries} log entries.)`))
    return;
  const res = await send('importData', { data });
  if (!res) {
    alert('That file does not look like an Ember backup.');
    return;
  }
  update(res);
  renderTodayStat();
  if (statsOpen()) renderStats();
});

/* ---------- picture-in-picture mini timer ---------- */

let pipWin = null;
let pipEls = null;

if (!window.documentPictureInPicture) {
  $('open-pip').hidden = true;
} else {
  $('open-pip').addEventListener('click', async () => {
    if (pipWin) {
      pipWin.close();
      return;
    }
    const win = await documentPictureInPicture.requestWindow({ width: 300, height: 190 });
    pipWin = win;
    // Same stylesheets, so the mini window keeps the theme and the type.
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const copy = win.document.createElement('link');
      copy.rel = 'stylesheet';
      copy.href = link.href;
      win.document.head.append(copy);
    }
    win.document.body.className = 'pip';
    const phase = win.document.createElement('h1');
    phase.className = 'phase-word';
    const time = win.document.createElement('div');
    time.className = 'time';
    const controls = win.document.createElement('div');
    controls.className = 'controls';
    const btn = win.document.createElement('button');
    btn.className = 'btn-primary';
    btn.addEventListener('click', toggle);
    controls.append(btn);
    win.document.body.append(phase, time, controls);
    pipEls = { phase, time, btn };
    win.addEventListener('pagehide', () => {
      pipWin = null;
      pipEls = null;
    });
    renderPip();
  });
}

// Mirrors the main render into the mini window, theme and all.
function renderPip() {
  if (!pipWin || !pipEls || !state) return;
  const root = pipWin.document.documentElement;
  root.dataset.theme = document.documentElement.dataset.theme;
  root.dataset.accent = document.documentElement.dataset.accent;
  pipWin.document.body.dataset.phase = state.phase;
  pipWin.document.body.dataset.status = state.status;
  setText(pipEls.phase, PHASE_LABEL[state.phase]);
  setText(pipEls.time, formatTime(displayMs(state)));
  setText(pipEls.btn, toggleLabel(state));
}

/* ---------- first-run welcome ---------- */

// Only the install-time tab carries #welcome — updates never re-greet.
async function maybeWelcome() {
  if (location.hash !== '#welcome') return;
  const { onboarded } = await chrome.storage.local.get('onboarded');
  if (!onboarded) $('welcome').hidden = false;
}

$('welcome-done').addEventListener('click', async () => {
  $('welcome').hidden = true;
  await chrome.storage.local.set({ onboarded: true });
});

$('open-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

/* ---------- extend chips & mode tabs ---------- */

bindExtendButtons(sync);
const renderModes = bindModeSwitch(update);

/* ---------- boot ---------- */

onStateChange(update);

// Stats and the log get their own listener: they change on a different
// cadence than the timer state, so neither render path refreshes the other.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.stats || changes.log)) {
    renderTodayStat();
    if (statsOpen()) renderStats();
  }
});

getState().then((s) => {
  update(s);
  renderTodayStat();
  maybeWelcome();
});

// The popup's "stats" shortcut lands straight on the dashboard.
if (location.hash === '#stats') setStatsView(true);
