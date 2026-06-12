// Shared by popup.js and app.js: state access, actions, and a display ticker.
// Views never mutate state — they message the service worker and re-render.

import { DEFAULT_SETTINGS, defaultState, remainingMs } from './core/timer.js';

export async function getState() {
  const { state } = await chrome.storage.local.get('state');
  if (!state) return defaultState();
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  return state;
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
    const untilFlip = (remainingMs(state) + 500) % 1000 || 1000;
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
export function extendVisible(state) {
  return state.status === 'running' && remainingMs(state) <= 5 * 60_000;
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
  { id: 'dark', label: 'Dark' },
  { id: 'amoled', label: 'AMOLED' },
  { id: 'rose', label: 'Rosé Pine' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'nord', label: 'Nord' },
  { id: 'catppuccin', label: 'Catppuccin' },
];

// The attribute lives on <html> so theme-boot.js can set it before first
// paint; localStorage mirrors the setting for that same early read.
export function applyTheme(theme) {
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('ember-theme', theme);
  } catch {
    // Mirror only — the popup just falls back to the default until state loads.
  }
}

// Builds swatch buttons into #themes (when the page has one) and returns a
// renderer that marks the active swatch and names it in #theme-name.
export function bindThemePicker(onUpdate) {
  const wrap = document.getElementById('themes');
  if (!wrap) return () => {};
  for (const t of THEMES) {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.dataset.theme = t.id;
    btn.title = t.label;
    btn.setAttribute('aria-label', `${t.label} theme`);
    btn.addEventListener('click', async () => {
      onUpdate(await send('updateSettings', { settings: { theme: t.id } }));
    });
    wrap.append(btn);
  }
  const name = document.getElementById('theme-name');
  return (state) => {
    for (const btn of wrap.children) {
      const active = btn.dataset.theme === state.settings.theme;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    if (name) {
      const active = THEMES.find((t) => t.id === state.settings.theme);
      name.textContent = (active?.label ?? state.settings.theme).toLowerCase();
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
