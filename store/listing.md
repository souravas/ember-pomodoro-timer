# Chrome Web Store listing — Ember

Everything below maps 1:1 to a field in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
Copy-paste as you fill in the submission.

---

## Store listing tab

**Name** (max 75 chars)

```
Ember — Pomodoro Timer
```

**Short description** (max 132 chars)

```
A calm, focused pomodoro timer. Toolbar countdown, full-page focus view, gentle chimes.
```

**Detailed description**

```
Ember is a pomodoro timer that stays out of your way. No accounts, no ads,
no tracking — just a quiet, warm place to focus.

WHAT YOU GET

• Toolbar countdown — the badge shows minutes remaining, color-coded by
  phase (ember red for focus, sage for short breaks, dusk blue for long
  breaks), so you never need to open anything to know where you stand.

• Compact popup — start, pause, reset, or skip in one click from the
  toolbar, with a progress bar and your position in the cycle.

• Full-page focus view — open Ember in its own tab for a large progress
  ring, the time remaining in the tab title, and spacebar to start/pause.

• Gentle finish — a soft synthesized two-note chime and a desktop
  notification when a phase ends. Both optional.

• Your rhythm — adjust focus, short-break, and long-break lengths, how
  many sessions before a long break, and whether breaks or focus sessions
  auto-start. Defaults: 25 / 5 / 15, long break every 4.

• Daily tally — see how many sessions and minutes you've focused today.

BUILT TO BE TRUSTWORTHY

• No data collection. Your settings and session counts live in local
  browser storage and never leave your machine.
• No host permissions — Ember cannot read or change any website.
• No remote code, no analytics, no network requests. Fonts and sounds are
  bundled or synthesized locally.
• The timer survives browser restarts: it is anchored to a timestamp, not
  a fragile countdown, so it stays accurate even when Chrome suspends the
  extension.

The pomodoro technique: work in focused sprints (traditionally 25 minutes),
then take a short break; every few sprints, take a longer one. Ember keeps
the count so you can keep your attention on the work.
```

**Category**: Productivity → Workflow & Planning
**Language**: English

**Graphic assets** (files in `store/assets/`; to regenerate see `store/src/README.md`)

| Dashboard field        | File                                  | Size      |
| ---------------------- | ------------------------------------- | --------- |
| Store icon             | `icons/icon128.png` (already in repo) | 128×128   |
| Screenshot 1           | `assets/screenshot-1-focus.png`       | 1280×800  |
| Screenshot 2           | `assets/screenshot-2-popup.png`       | 1280×800  |
| Screenshot 3           | `assets/screenshot-3-break.png`       | 1280×800  |
| Screenshot 4           | `assets/screenshot-4-settings.png`    | 1280×800  |
| Small promo tile       | `assets/promo-small-440x280.png`      | 440×280   |
| Marquee promo tile     | `assets/promo-marquee-1400x560.png`   | 1400×560  |

---

## Privacy tab

**Single purpose description**

```
Ember is a pomodoro timer: it times focus sessions and breaks, shows the
remaining time on the toolbar badge and in a timer page, and signals the
end of each phase with an optional chime and desktop notification.
```

**Permission justifications**

`alarms`

```
Schedules the end of each focus/break phase and a once-per-minute badge
update. Manifest V3 suspends service workers, so alarms are the only
reliable way for the timer to fire on time.
```

`storage`

```
Stores the user's timer settings (phase durations, auto-start, sound and
notification preferences), the current timer state, and a local count of
completed sessions per day. Stats and the session log stay in
chrome.storage.local on the user's device; only the settings object uses
chrome.storage.sync so preferences follow the user's own Chrome profile.
```

`notifications`

```
Shows a desktop notification when a focus session or break ends, so the
user notices the phase change without watching the timer. Can be turned
off in the extension's settings.
```

`offscreen`

```
Service workers cannot play audio. An offscreen document is created only to
play the end-of-phase chime and the optional ambient focus sound, and Chrome
closes it shortly after audio stops. Can be turned off in the extension's
settings.
```

`idle`

```
Detects when the machine locks so a running focus session auto-pauses —
otherwise time the user did not work (lock screen, sleep) would be counted
as focus. No idle data is stored or transmitted; the optional behaviour can
be turned off in settings.
```

`contextMenus`

```
Adds start/pause, skip, and open-stats items to the toolbar icon's
right-click menu, so the timer can be controlled without opening the popup.
```

`sidePanel`

```
Offers the same compact timer as a Chrome side panel, so the user can keep
it visible next to the page they are working on. Opened only by the user.
```

**Host permissions**: none requested.

**Remote code**: No, this extension does not use remote code.

**Data usage**: check **none** of the data-type boxes (no data is
collected or transmitted). Certify the disclosures.

**Privacy policy URL**: host `store/privacy-policy.md` somewhere public
(e.g. a GitHub repo or Gist) and paste its URL. A privacy policy is
optional when no data is collected, but providing one speeds review.

---

## Distribution tab

- **Visibility**: Public
- **Distribution**: all regions
- **Pricing**: Free

## Package to upload

Run `tools/package.sh` and upload `dist/ember-1.0.0.zip`
(contains only runtime files — no tools, store assets, or README).
