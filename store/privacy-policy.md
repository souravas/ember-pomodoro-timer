# Privacy Policy — Ember (Pomodoro Timer)

_Last updated: June 13, 2026_

Ember is a pomodoro timer Chrome extension. This policy describes what
data it handles. The short version: **Ember collects nothing.**

## Data collection

Ember does **not** collect, transmit, sell, or share any data. It has no
analytics, no accounts, no ads, and makes no network requests of its own.
Fonts and sounds are bundled or synthesized locally.

## Data stored on your device

Ember keeps data in Chrome's extension storage, only so the timer works:

- **Timer state** — current phase, remaining time, whether the timer is
  running, and the optional session label you typed.
- **Settings** — your chosen durations, auto-start, sound, theme, daily
  goal, site-blocking list, and notification preferences. Settings (and
  only settings) are stored in `chrome.storage.sync`, so they follow your
  own Chrome profile across your machines through your Google account —
  Ember itself never sees them.
- **Focus history** — minutes and completed sessions per day, plus a
  session log (start/end time, minutes, label) that powers the stats
  dashboard. This stays in `chrome.storage.local` on your device only.

You can export this data as JSON/CSV from Settings, and it is removed by
Chrome when you uninstall the extension.

## Site blocking

Site blocking is **off by default** and fully opt-in. If you enable it,
Chrome asks for one additional permission at that moment (never at
install): host access to the sites you want blocked. It is used solely
to redirect page loads of the domains **you listed**, **only while a
focus session is running**, to a local "it can wait" page bundled with
the extension, and to move already-open tabs of those domains to that
page when focus starts.

Matching happens entirely on your machine via Chrome's own rule engine.
Ember does not read page content, does not inject scripts into pages,
and does not store or transmit your browsing history — the only thing it
keeps is the blocklist you typed, as part of your settings. Decline or
revoke the permission and the feature simply does nothing.

## Permissions

- **alarms** — schedules when a focus session or break ends and the
  once-per-minute badge update.
- **storage** — saves the settings, timer state, and local focus history
  described above.
- **notifications** — optional desktop notification when a phase ends.
- **offscreen** — plays the optional chime and ambient sound (service
  workers cannot play audio).
- **idle** — auto-pauses a running focus session when the machine locks,
  so the lock screen never counts as work. No idle data is stored.
- **contextMenus** — start/pause, skip, and stats items on the toolbar
  icon's right-click menu.
- **sidePanel** — offers the timer in Chrome's side panel.
- **declarativeNetRequestWithHostAccess** — Chrome's site-blocking rule
  engine, declared with no install-time warning; it can act only on sites
  you grant host access to.
- **host access** — optional and requested at runtime (never at install),
  used only for the site blocking described above.

## Changes

If this policy changes, the updated text will be published at the same
URL with a new "last updated" date.

## Contact

Questions about this policy: abjasree.work@gmail.com
