// Minimal chrome.* mock so the real app.js / popup.js can run in a plain
// browser tab for store screenshots. State is preset via URL params:
//   ?mode=pomodoro|timer|stopwatch
//   &phase=focus|shortBreak|longBreak|timer|stopwatch
//   &status=idle|running|paused
//   &remain=<minutes>  &cycle=<n>  &sessions=<n>  &minutes=<n>  &panel=1
//   &theme=<theme id>  &accent=<flame id>
(() => {
  const q = new URLSearchParams(location.search);
  const num = (key, fallback) => (q.has(key) ? Number(q.get(key)) : fallback);

  // What theme-boot.js does in the extension: land the theme before first
  // paint so shots don't catch the colors mid-transition.
  if (q.has('theme')) document.documentElement.dataset.theme = q.get('theme');
  if (q.has('accent')) document.documentElement.dataset.accent = q.get('accent');

  const settings = {
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    timerMin: 30,
    longBreakEvery: 4,
    autoStartBreaks: true,
    autoStartFocus: false,
    sound: true,
    notifications: true,
    theme: q.get('theme') ?? 'ember',
    accent: q.get('accent') ?? 'auto',
    weekStart: num('weekstart', 1), // 0 sun, 1 mon, 6 sat
  };

  const mode = q.get('mode') ?? 'pomodoro';
  const status = q.get('status') ?? 'running';
  const remainMs = num('remain', 17.8) * 60_000;
  const state = {
    mode,
    phase: q.get('phase') ?? (mode === 'pomodoro' ? 'focus' : mode),
    status,
    // For the stopwatch, endsAt is the virtual start (now − elapsed).
    endsAt:
      status === 'running'
        ? mode === 'stopwatch'
          ? Date.now() - remainMs
          : Date.now() + remainMs
        : null,
    remainingMs: remainMs,
    cyclePos: num('cycle', 1),
    label: q.get('label') ?? '',
    settings,
  };

  // Same key shape as core/timer.js todayKey() (local date).
  const keyOf = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;

  // Labels stamp the day they were set; without this normalizeState would
  // retire the preset label as stale.
  state.labelDay = state.label ? keyOf(new Date()) : null;

  // A plausible year of history so the stats dashboard has something to
  // show. Deterministic (seeded), so shots are reproducible: weekdays run
  // warmer than weekends, and some days are skipped outright.
  let seedNum = 7;
  const rand = () => (seedNum = (seedNum * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const stats = {};
  for (let i = 364; i >= 1; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (rand() < (weekend ? 0.55 : 0.18)) continue; // day off
    const sessions = 1 + Math.floor(rand() * (weekend ? 4 : 8));
    stats[keyOf(d)] = { sessions, minutes: sessions * 25 + Math.floor(rand() * 20) };
  }
  stats[keyOf(new Date())] = { sessions: num('sessions', 3), minutes: num('minutes', 75) };

  // A few days of labelled session-log entries so the recent-label chips
  // and the dashboard's "by label" card have something to show.
  const log = [];
  const labels = ['deep work', 'thesis draft', 'email', 'side project'];
  for (let i = 6; i >= 0; i--) {
    const dayEnd = Date.now() - i * 86_400_000 - 3 * 3_600_000;
    for (let s = 0; s < 2 + Math.floor(rand() * 3); s++) {
      const min = 25;
      const end = dayEnd - s * 2 * 3_600_000;
      log.unshift({
        start: end - min * 60_000,
        end,
        min,
        label: rand() < 0.25 ? null : labels[Math.floor(rand() * labels.length)],
        mode: 'pomodoro',
        completed: true,
      });
    }
  }

  const minKey = {
    focus: 'focusMin',
    shortBreak: 'shortBreakMin',
    longBreak: 'longBreakMin',
    timer: 'timerMin',
  };

  const stored = { state, stats, log };
  window.chrome = {
    storage: {
      local: {
        // Both forms the views use: a single key or an array of keys.
        get: async (key) =>
          Object.fromEntries(
            (Array.isArray(key) ? key : [key])
              .filter((k) => k in stored)
              .map((k) => [k, stored[k]])
          ),
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      // Honour updateSettings and setMode so steppers / pickers / the ring
      // dial / mode tabs respond when the real UI scripts run against this
      // shim.
      sendMessage: async (msg) => {
        if (msg && msg.type === 'updateSettings') {
          // Mutate state.settings (not `settings`): ui.js getState() swaps in
          // its own merged copy, and that copy is what the views read.
          Object.assign(state.settings, msg.settings);
          if (state.status === 'idle' && minKey[state.phase]) {
            state.remainingMs = state.settings[minKey[state.phase]] * 60_000;
          }
        }
        if (msg && msg.type === 'setLabel') {
          state.label = String(msg.label ?? '').trim().slice(0, 60);
        }
        if (msg && msg.type === 'setMode' && msg.mode !== state.mode) {
          state.mode = msg.mode;
          state.phase = msg.mode === 'pomodoro' ? 'focus' : msg.mode;
          state.status = 'idle';
          state.endsAt = null;
          state.remainingMs =
            msg.mode === 'stopwatch' ? 0 : state.settings[minKey[state.phase]] * 60_000;
        }
        return state;
      },
      getURL: (p) => p,
      getManifest: () => ({ version: 'shot' }),
    },
    tabs: { create() {} },
  };
})();
