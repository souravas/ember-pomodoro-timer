// Shared by popup.js and app.js: state access, actions, and a display ticker.
// Views never mutate state — they message the service worker and re-render.

import {
  DEFAULT_SETTINGS,
  defaultState,
  displayMs,
  normalizeState,
  remainingMs,
} from './core/timer.js';
import { labelTotals, recentLabels } from './core/log.js';

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
    // half-second mark going down; counting up (stopwatch, overtime), going up.
    const shown = displayMs(state);
    const countsUp = state.mode === 'stopwatch' || state.overtime;
    const untilFlip = countsUp
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
// (The stopwatch has no end to extend; overtime is already past it.)
export function extendVisible(state) {
  return (
    state.mode !== 'stopwatch' &&
    !state.overtime &&
    state.status === 'running' &&
    remainingMs(state) <= 5 * 60_000
  );
}

// Strict mode turns a control into a press-and-hold: while `isArmed()` says
// so, the action fires only after the pointer (or Enter/Space) stays down
// for `holdMs` — friction by design. Unarmed, it's a normal click.
export function bindControl(btn, isArmed, action, holdMs = 1200) {
  let timer = null;
  let held = false;

  function startHold() {
    held = false;
    btn.classList.add('holding');
    btn.style.setProperty('--hold-ms', `${holdMs}ms`);
    timer = setTimeout(() => {
      held = true;
      btn.classList.remove('holding');
      action();
    }, holdMs);
  }
  function cancelHold() {
    clearTimeout(timer);
    btn.classList.remove('holding');
  }

  btn.addEventListener('pointerdown', () => {
    if (isArmed()) startHold();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    btn.addEventListener(ev, cancelHold);
  }
  btn.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && isArmed()) {
      e.preventDefault(); // and with it, the synthetic click on keyup
      startHold();
    }
  });
  btn.addEventListener('keyup', cancelHold);
  btn.addEventListener('click', () => {
    // A completed hold already acted; an early release acts as the friction.
    if (held) {
      held = false;
      return;
    }
    if (!isArmed()) action();
  });
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
  { id: 'auto', label: 'Auto (match system)' },
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

// The 'auto' theme follows the OS: Ember in the dark, Light in the light.
const prefersLight = matchMedia('(prefers-color-scheme: light)');

export function resolveTheme(theme) {
  if (theme !== 'auto') return theme;
  return prefersLight.matches ? 'light' : 'ember';
}

// The attributes live on <html> so theme-boot.js can set them before first
// paint; localStorage mirrors the settings (unresolved, so 'auto' stays
// auto) for that same early read.
let appliedTheme = null;
let appliedAccent = 'auto';

export function applyTheme(theme, accent = 'auto') {
  appliedTheme = theme;
  appliedAccent = accent;
  const el = document.documentElement;
  const resolved = resolveTheme(theme);
  if (el.dataset.theme !== resolved) el.dataset.theme = resolved;
  mirror('ember-theme', theme);
  if (el.dataset.accent !== accent) el.dataset.accent = accent;
  mirror('ember-accent', accent);
}

// An OS scheme flip re-resolves 'auto' on the open page, no reload needed.
prefersLight.addEventListener('change', () => {
  if (appliedTheme === 'auto') applyTheme(appliedTheme, appliedAccent);
});

function mirror(key, value) {
  try {
    if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
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

// Wires the session label — an optional "what are you working on?" attached
// to the timer. Entering the field surfaces recent labels (with today's
// minutes) as one-click chips; the worker stamps the label onto whatever
// work it banks next. Returns a renderer that paints the current label.
export function bindLabelField(onUpdate) {
  const wrap = document.getElementById('label-wrap');
  if (!wrap) return () => {};
  const input = document.getElementById('label');
  const chips = document.getElementById('label-chips');
  const clear = document.getElementById('label-clear');
  let current = '';

  async function commit(value) {
    const label = value.trim();
    if (label === current) return;
    onUpdate(await send('setLabel', { label }));
  }

  input.addEventListener('keydown', (e) => {
    // Space and Escape belong to the field while typing, not the page.
    e.stopPropagation();
    if (e.key === 'Enter') input.blur(); // blur fires the change event
    if (e.key === 'Escape') {
      input.value = current; // back to the committed value — no change fires
      input.blur();
    }
  });
  input.addEventListener('change', () => commit(input.value));
  input.addEventListener('input', () => wrap.classList.toggle('has-label', input.value !== ''));

  clear.addEventListener('click', () => {
    input.value = '';
    wrap.classList.remove('has-label');
    commit('');
  });

  // Chips appear while the field has focus, fetched fresh on each entry.
  // focusin/focusout (not focus/blur) so moving between the input, the
  // clear button, and a chip never closes the dropdown mid-click.
  input.addEventListener('focus', async () => {
    const { log = [] } = await chrome.storage.local.get('log');
    renderChips(log);
  });
  wrap.addEventListener('focusout', (e) => {
    if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('open');
  });

  function renderChips(log) {
    if (!wrap.contains(document.activeElement)) return; // focus already left
    const midnight = new Date().setHours(0, 0, 0, 0);
    const today = new Map(labelTotals(log, midnight).map((r) => [r.label, r.min]));
    const labels = recentLabels(log);
    chips.replaceChildren(
      ...labels.map((label) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        btn.append(label);
        const min = today.get(label);
        if (min) {
          const note = document.createElement('span');
          note.className = 'chip-min';
          note.textContent = ` · ${min}m`;
          btn.append(note);
        }
        btn.addEventListener('click', () => {
          input.value = label;
          wrap.classList.add('has-label');
          commit(label);
          wrap.classList.remove('open');
          btn.blur();
        });
        return btn;
      })
    );
    wrap.classList.toggle('open', labels.length > 0);
  }

  return (state) => {
    current = state.label ?? '';
    // Never repaint under the user's cursor mid-edit.
    if (document.activeElement !== input) {
      input.value = current;
      wrap.classList.toggle('has-label', current !== '');
    }
  };
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
