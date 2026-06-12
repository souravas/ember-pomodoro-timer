// Minimal chrome.* mock so the real app.js / popup.js can run in a plain
// browser tab for store screenshots. State is preset via URL params:
//   ?phase=focus|shortBreak|longBreak  &status=idle|running|paused
//   &remain=<minutes>  &cycle=<n>  &sessions=<n>  &minutes=<n>  &panel=1
(() => {
  const q = new URLSearchParams(location.search);
  const num = (key, fallback) => (q.has(key) ? Number(q.get(key)) : fallback);

  const settings = {
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    longBreakEvery: 4,
    autoStartBreaks: true,
    autoStartFocus: false,
    sound: true,
    notifications: true,
  };

  const status = q.get('status') ?? 'running';
  const remainMs = num('remain', 17.8) * 60_000;
  const state = {
    phase: q.get('phase') ?? 'focus',
    status,
    endsAt: status === 'running' ? Date.now() + remainMs : null,
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

  window.chrome = {
    storage: {
      local: {
        get: async (key) => (key === 'state' ? { state } : key === 'stats' ? { stats } : {}),
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      // Honour updateSettings so steppers / typed values / the ring dial
      // respond when the real UI scripts run against this shim.
      sendMessage: async (msg) => {
        if (msg && msg.type === 'updateSettings') {
          // Mutate state.settings (not `settings`): ui.js getState() swaps in
          // its own merged copy, and that copy is what the views read.
          Object.assign(state.settings, msg.settings);
          const minKey = { focus: 'focusMin', shortBreak: 'shortBreakMin', longBreak: 'longBreakMin' };
          if (state.status === 'idle') state.remainingMs = state.settings[minKey[state.phase]] * 60_000;
        }
        return state;
      },
      getURL: (p) => p,
    },
    tabs: { create() {} },
  };
})();
