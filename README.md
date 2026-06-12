# Ember — Pomodoro Timer

A calm, focused pomodoro timer as a Chrome extension. Toolbar countdown badge,
compact popup for quick control, a **side panel** that stays beside the page,
and a full-page focus view with settings, **zen mode** (press `z`), and a
pop-out **mini timer** (document picture-in-picture).
Three modes: the pomodoro cycle, a one-shot timer, and a stopwatch.
A stats dashboard (full page → **Stats**) tracks time worked per day:
today/week/streak/best-day/finish-rate cards, a week·month·year chart with an
optional **daily-goal** line, a "when you focus" hour-of-day skyline, a
session ledger (deletable entries, manual additions), and a GitHub-style year
heatmap. All data stays in `chrome.storage.local` — and can be exported /
imported as JSON (plus a CSV of the session log) from Settings.

Sessions can optionally carry a **label** — type "what are you working on?"
under the phase word (or in the popup), or re-pick a recent label from the
one-click chips that appear on focus. Labels are never required; they stick
for the day, tag whatever work gets banked, and show up as a per-label
breakdown in the dashboard ("by label · last 7 days", with rename/merge and
remove) and in the today tooltip.

Quality-of-life around the cycle:

- **Global shortcut** — `Alt+Shift+P` starts/pauses from any tab (more
  commands bindable at `chrome://extensions/shortcuts`); the toolbar icon's
  right-click menu has start/pause · skip · stats.
- **Actionable notifications** — "Start focus" / "5 more break minutes"
  buttons right on the phase-end notification, plus one gentle reminder if a
  finished phase sits unstarted for 3 minutes.
- **Lock-aware** — locking the machine auto-pauses focused work (so sleep
  never counts as focus), with a resume nudge when you're back. Optional.
- **Overtime** (optional) — focus runs past zero counting up until you end
  it; everything worked is banked together.
- **Strict focus** (optional) — pause/reset/skip take a press-and-hold while
  focus runs.
- **Site blocking** (optional) — list distracting sites in Settings and,
  while focused work runs, their tabs rest on a quiet "it can wait" page
  showing the time left; the moment the session ends (or you pause) the page
  offers the way back. Subdomains included; pausing is the escape hatch.
- **Duration presets** — 25·5, 50·10, 90·20 one-tap in Settings.
- **Sound** — three chime voices with a volume slider and preview, an
  optional 30-second warning before a break ends, and optional ambient sound
  while focusing (ticking · rain · noise), all synthesized locally.
- **Daily goal** — set minutes/day; progress shows in the popup, the topbar,
  the stats cards, and as a goal line on the chart, with one quiet
  notification when you cross it.
- Settings sync across machines via `chrome.storage.sync`; stats stay local.
- Themes can follow the OS (**auto** swatch) on top of the twelve palettes.

## Load it in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin Ember to the toolbar — the badge shows minutes remaining while running

## How it's built

- **Manifest V3**, no remote code, no install-time host permissions.
  Permissions used: `alarms`, `storage`, `notifications`, `offscreen`,
  `idle` (lock-pause), `contextMenus` (toolbar menu), `sidePanel`. Site
  blocking needs `declarativeNetRequest` + host access, so those are
  **optional permissions** — Chrome asks only when the toggle is first
  flipped, and everything degrades gracefully if they're never granted.
- Site blocking ([core/block.js](core/block.js)) turns the blocklist into
  `declarativeNetRequest` dynamic rules that redirect listed domains (and
  subdomains) to [blocked.html](blocked.html) — rules are synced on every
  state write, so they can never drift from what the timer is doing, and
  already-open tabs get walked to the blocked page when focus starts.
- The service worker ([background.js](background.js)) is the single owner of
  timer state. MV3 kills workers after ~30s idle, so the timer is an
  **end-timestamp in `chrome.storage.local`** and phase changes fire from
  **`chrome.alarms`** — never `setTimeout`. Notification buttons survive a
  dead worker too: each notification's id encodes its buttons' actions.
  The toolbar badge ticks once a minute by design: per-second badge
  updates would need a worker keep-alive hack (alarms floor at 30s), and
  every open Ember surface already shows live seconds — the badge is for
  glancing, not watching.
- [core/timer.js](core/timer.js) holds the pure phase/cycle logic, shared by
  the worker and all views so they can never disagree.
- [core/stats.js](core/stats.js) holds the pure dashboard math over the
  daily totals the worker banks (completed focus sessions count as sessions;
  finished one-shot timers, stopwatch runs, and the worked part of abandoned
  focus phases count as minutes).
- [core/log.js](core/log.js) holds the pure session-log logic: alongside the
  daily totals, every banked run gets a log entry (start/end, minutes, label,
  mode, completed) under `log`, pruned to a year. The log feeds the recent-
  label chips and the per-label breakdown; the daily totals stay the source
  for the charts.
- The popup, the side panel ([sidepanel.html](sidepanel.html) — popup.html
  with a `body.sidepanel` class; regenerate via
  [tools/make-sidepanel.sh](tools/make-sidepanel.sh)), and the full page
  ([app.html](app.html)) are thin views: they read state from storage,
  re-render on `storage.onChanged`, and send actions (start / pause / reset /
  skip / settings / log edits) to the worker. Dashboard edits (delete entry,
  manual entry, label rename) go through the worker so `stats` and `log`
  always move together.
- Sound can't play from a service worker, so everything is synthesized with
  WebAudio in an **offscreen document** ([offscreen.js](offscreen.js));
  the synth lives in [core/sound.js](core/sound.js) and the settings panel
  reuses it for in-page previews. Chrome reaps the offscreen document ~30s
  after audio stops; ambient loops keep it alive exactly as long as needed.
- `tests/` holds a `node --test` suite over the pure `core/` modules
  (`npm test`).
- Fonts (Instrument Serif + Spline Sans Mono) are bundled locally in
  `fonts/`; icons are generated by [tools/build_assets.py](tools/build_assets.py).
- **Theming**: twelve themes (Ember default, Light, Porcelain, Dark, AMOLED,
  Midnight, Forest, Gruvbox, Rosé Pine, Dracula, Nord, Catppuccin) are
  CSS-variable token blocks in [theme.css](theme.css), switched by one
  `data-theme` attribute. A separate **flame** picker overrides the accent
  color (`data-accent`: ember, gold, mint, teal, sky, violet, rose, mono) on
  top of any theme. [theme-boot.js](theme-boot.js) applies both before first
  paint; swatch pickers live in both the popup and full-page settings.

## Defaults

25 min focus · 5 min short break · 15 min long break every 4 sessions.
Breaks auto-start; focus doesn't. Stats weeks start on Monday (Sat/Sun/Mon
selectable). All adjustable in Settings on the full page.

## Releasing to the Chrome Web Store

- `tools/package.sh` builds the upload zip (`dist/ember-<version>.zip`,
  runtime files only).
- [store/listing.md](store/listing.md) has the full listing copy: description,
  category, permission justifications, and privacy disclosures, mapped to the
  Developer Dashboard fields.
- [store/privacy-policy.md](store/privacy-policy.md) is the privacy policy to
  host and link in the listing.
- [store/assets/](store/assets/) holds the screenshots and promo tiles
  (regeneration: [store/src/README.md](store/src/README.md)).
