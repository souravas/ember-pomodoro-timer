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
    settings,
  };

  // Same key shape as core/timer.js todayKey() (local date).
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const stats = { [todayKey]: { sessions: num('sessions', 3), minutes: num('minutes', 75) } };

  const minKey = {
    focus: 'focusMin',
    shortBreak: 'shortBreakMin',
    longBreak: 'longBreakMin',
    timer: 'timerMin',
  };

  window.chrome = {
    storage: {
      local: {
        get: async (key) => (key === 'state' ? { state } : key === 'stats' ? { stats } : {}),
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
    },
    tabs: { create() {} },
  };
})();
