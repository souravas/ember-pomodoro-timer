// Shared by popup.js and app.js: state access, actions, and a display ticker.
// Views never mutate state — they message the service worker and re-render.

import {
  DEFAULT_SETTINGS,
  defaultState,
  displayMs,
  normalizeState,
  remainingMs,
} from './core/timer.js';

export async function getState() {
  const { state } = await chrome.storage.local.get('state');
  if (!state) return defaultState();
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  return normalizeState(state);
}

export function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

// Write only on change: skips text-node churn on every tick and keeps
// aria-live regions from re-announcing values that didn't move.
export function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

export function onStateChange(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.state) cb(changes.state.newValue);
  });
}

// Drives a view's rendering. Call the returned sync() with every new state:
// it renders immediately, and while the timer is running it schedules one
// re-render per displayed second, timed to the moment the shown value flips
// (formatTime rounds, so that's each half-second mark of the remaining
// time). Idle and paused render once and go quiet — nothing on screen is
// moving, so no work happens. Time always comes from the stored
// end-timestamp, so a throttled or late tick still shows the right value.
export function createTicker(render) {
  let state = null;
  let timer = null;

  function tick() {
    render(state);
    schedule();
  }

  function schedule() {
    // Counting down, the shown value flips when the remainder crosses each
    // half-second mark going down; counting up (stopwatch), going up.
    const shown = displayMs(state);
    const untilFlip =
      state.mode === 'stopwatch'
        ? (1500 - (shown % 1000)) % 1000 || 1000
        : (shown + 500) % 1000 || 1000;
    timer = setTimeout(tick, untilFlip + 15);
  }

  return function sync(next) {
    if (!next) return; // failed action response; keep the last good state
    state = next;
    clearTimeout(timer);
    render(state);
    if (state.status === 'running') schedule();
  };
}

// Extend chips only appear when the end is near — that is the moment the
// feature serves; the rest of the time the running view stays clean.
// (The stopwatch has no end to extend.)
export function extendVisible(state) {
  return (
    state.mode !== 'stopwatch' && state.status === 'running' && remainingMs(state) <= 5 * 60_000
  );
}

export function bindExtendButtons(onUpdate) {
  for (const btn of document.querySelectorAll('button[data-extend]')) {
    btn.addEventListener('click', async () => {
      onUpdate(await send('extend', { minutes: Number(btn.dataset.extend) }));
    });
  }
}

// Wires every .field[data-setting] duration control: ± buttons nudge the
// value, and the number itself is editable — Enter or blur commits, clamped
// to the field's min/max. Returns a renderer that paints current values.
export function bindDurationFields(getSettings, onUpdate) {
  const fields = [...document.querySelectorAll('.field[data-setting]')].map((field) => ({
    key: field.dataset.setting,
    label: field.querySelector('span')?.textContent ?? field.dataset.setting,
    min: Number(field.dataset.min),
    max: Number(field.dataset.max),
    input: field.querySelector('.value'),
    steps: [...field.querySelectorAll('.step')],
  }));

  async function save(f, value) {
    const next = Math.min(f.max, Math.max(f.min, value));
    onUpdate(await send('updateSettings', { settings: { [f.key]: next } }));
    f.input.value = next; // show the clamp even when nothing else changed
  }

  for (const f of fields) {
    f.input.setAttribute('aria-label', f.label);
    for (const btn of f.steps) {
      const dir = Number(btn.dataset.dir);
      btn.setAttribute('aria-label', `${dir < 0 ? 'Decrease' : 'Increase'} ${f.label}`);
      btn.addEventListener('click', () => save(f, getSettings()[f.key] + dir));
    }
    f.input.addEventListener('focus', () => f.input.select());
    f.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') f.input.blur(); // blur fires the change event
    });
    f.input.addEventListener('change', () => {
      const typed = Math.round(Number(f.input.value));
      if (f.input.value.trim() !== '' && Number.isFinite(typed)) save(f, typed);
      else f.input.value = getSettings()[f.key]; // garbage in — restore
    });
  }

  return (state) => {
    for (const f of fields) {
      // Never repaint under the user's cursor mid-edit.
      if (document.activeElement !== f.input) f.input.value = state.settings[f.key];
    }
  };
}

// Theme list for the pickers. Colors live in theme.css — each swatch carries
// data-theme and lets the cascade paint it with that theme's own tokens.
export const THEMES = [
  { id: 'ember', label: 'Ember' },
  { id: 'light', label: 'Light' },
  { id: 'porcelain', label: 'Porcelain' },
  { id: 'dark', label: 'Dark' },
  { id: 'amoled', label: 'AMOLED' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'forest', label: 'Forest' },
  { id: 'gruvbox', label: 'Gruvbox' },
  { id: 'rose', label: 'Rosé Pine' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'nord', label: 'Nord' },
  { id: 'catppuccin', label: 'Catppuccin' },
];

// Flame (accent) overrides — any of these on top of any theme. 'auto' keeps
// the theme's own accent. Colors live in theme.css under [data-accent].
export const ACCENTS = [
  { id: 'auto', label: 'Theme default' },
  { id: 'ember', label: 'Ember' },
  { id: 'gold', label: 'Gold' },
  { id: 'mint', label: 'Mint' },
  { id: 'teal', label: 'Teal' },
  { id: 'sky', label: 'Sky' },
  { id: 'violet', label: 'Violet' },
  { id: 'rose', label: 'Rose' },
  { id: 'mono', label: 'Mono' },
];

// The attributes live on <html> so theme-boot.js can set them before first
// paint; localStorage mirrors the settings for that same early read.
export function applyTheme(theme, accent = 'auto') {
  const el = document.documentElement;
  if (el.dataset.theme !== theme) {
    el.dataset.theme = theme;
    mirror('ember-theme', theme);
  }
  if (el.dataset.accent !== accent) {
    el.dataset.accent = accent;
    mirror('ember-accent', accent);
  }
}

function mirror(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Mirror only — the page just falls back to the default until state loads.
  }
}

// Builds swatch buttons into a container and returns a renderer that marks
// the active swatch and names it. Shared by the theme and accent pickers —
// they differ only in which data attribute and setting they drive.
function bindSwatchPicker(onUpdate, { containerId, nameId, options, attr, settingKey, kind }) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return () => {};
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.dataset[attr] = opt.id;
    btn.title = opt.label;
    btn.setAttribute('aria-label', `${opt.label} ${kind}`);
    btn.addEventListener('click', async () => {
      onUpdate(await send('updateSettings', { settings: { [settingKey]: opt.id } }));
    });
    wrap.append(btn);
  }
  const name = document.getElementById(nameId);
  return (state) => {
    const current = state.settings[settingKey];
    for (const btn of wrap.children) {
      const active = btn.dataset[attr] === current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    if (name) {
      const active = options.find((o) => o.id === current);
      name.textContent = (active?.label ?? current).toLowerCase();
    }
  };
}

export function bindThemePicker(onUpdate) {
  return bindSwatchPicker(onUpdate, {
    containerId: 'themes',
    nameId: 'theme-name',
    options: THEMES,
    attr: 'theme',
    settingKey: 'theme',
    kind: 'theme',
  });
}

export function bindAccentPicker(onUpdate) {
  return bindSwatchPicker(onUpdate, {
    containerId: 'accents',
    nameId: 'accent-name',
    options: ACCENTS,
    attr: 'accent',
    settingKey: 'accent',
    kind: 'flame',
  });
}

// Wires the pomodoro/timer/stopwatch tabs (when the page has them) and
// returns a renderer that marks the active mode.
export function bindModeSwitch(onUpdate) {
  const wrap = document.getElementById('modes');
  if (!wrap) return () => {};
  const tabs = [...wrap.querySelectorAll('button[data-mode]')];
  for (const btn of tabs) {
    btn.addEventListener('click', async () => {
      onUpdate(await send('setMode', { mode: btn.dataset.mode }));
    });
  }
  return (state) => {
    for (const btn of tabs) {
      const active = btn.dataset.mode === state.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  };
}

export function renderDots(container, state) {
  const total = state.settings.longBreakEvery;
  const done = state.cyclePos;
  // Rebuilding on every tick would restart the .current dot's breathe
  // animation, so only touch the DOM when the dots actually change.
  const key = `${total}/${done}/${state.phase}`;
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  container.replaceChildren(
    ...Array.from({ length: total }, (_, i) => {
      const dot = document.createElement('i');
      if (i < done) dot.className = 'done';
      else if (i === done && state.phase === 'focus') dot.className = 'current';
      return dot;
    })
  );
}
