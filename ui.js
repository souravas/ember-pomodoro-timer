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
