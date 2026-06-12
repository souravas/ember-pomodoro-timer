// The page a blocked site lands on. A thin view like the others: it reads
// state from storage, re-renders on changes, and flips to "carry on" the
// moment the block lifts — it never decides anything itself.

import { displayMs, formatTime, WORK_PHASES } from './core/timer.js';
import { blockingActive } from './core/block.js';
import { applyTheme, createTicker, getState, onStateChange, setText } from './ui.js';

const $ = (id) => document.getElementById(id);

// Name what was blocked. The open-tab sweep passes the full address
// (?url=...) so "carry on" can return exactly there; a network redirect only
// knows the blocklist host (?from=...). Both render via textContent and the
// URL is re-validated — query params are attacker-reachable input.
const params = new URLSearchParams(location.search);
let returnUrl = null;
let siteHost = null;
try {
  const u = new URL(params.get('url') ?? '');
  if (u.protocol === 'https:' || u.protocol === 'http:') {
    returnUrl = u.href;
    siteHost = u.hostname;
  }
} catch {
  // No ?url= or not parseable — fall back to ?from= below.
}
if (!siteHost) {
  const from = (params.get('from') ?? '').toLowerCase();
  if (/^[a-z0-9][a-z0-9.-]*$/.test(from)) {
    siteHost = from;
    returnUrl = `https://${from}/`;
  }
}
if (siteHost) {
  $('site').textContent = siteHost;
  $('site').hidden = false;
}

function render(state) {
  applyTheme(state.settings.theme, state.settings.accent);
  const active = blockingActive(state, WORK_PHASES);
  document.body.dataset.status = active ? 'running' : 'idle';
  document.body.dataset.phase = active ? state.phase : 'focus';

  if (active) {
    setText($('kicker'), state.overtime ? 'overtime — focus still on' : 'focus in progress');
    setText($('headline'), 'it can wait');
    setText($('time'), formatTime(displayMs(state)));
    $('time').hidden = false;
    $('label').textContent = state.label ? `“${state.label}”` : '';
    $('label').hidden = !state.label;
    $('return').hidden = true;
    $('note').hidden = false;
  } else {
    setText($('kicker'), 'the block has lifted');
    setText($('headline'), 'carry on');
    $('time').hidden = true;
    $('label').hidden = true;
    if (returnUrl) {
      $('return').href = returnUrl;
      $('return').hidden = false;
    }
    $('note').hidden = true;
  }
}

const sync = createTicker(render);
getState().then(sync);
onStateChange(sync);

$('close-tab').addEventListener('click', async () => {
  // An extension page may close its own tab without the "tabs" permission.
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) chrome.tabs.remove(tab.id);
  else window.close();
});
