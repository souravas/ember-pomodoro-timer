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
A calm pomodoro timer: focus stats, session labels, gentle site blocking, side panel, ambient sound. No accounts, no tracking.
```

**Detailed description**

```
Ember is a pomodoro timer that stays out of your way. No accounts, no ads,
no tracking — just a quiet, warm place to focus.

THE TIMER

• Three modes — the pomodoro cycle, a one-shot timer, and a stopwatch.
• Toolbar countdown — the badge shows minutes remaining, color-coded by
  phase, so you never need to open anything to know where you stand.
• Compact popup — start, pause, reset, skip, or label your session in one
  click from the toolbar.
• Side panel — keep the timer beside the page you're working on.
• Full-page focus view — a large progress ring you can drag like a dial to
  set the length, zen mode (press z) for just the flame and the time, and
  a pop-out floating mini timer (picture-in-picture).
• Overtime (optional) — focus runs past zero counting up until you end it.
• Strict focus (optional) — interrupting a focus session takes a deliberate
  press-and-hold instead of a stray click.
• Global shortcut — Alt+Shift+P starts/pauses from any tab.

GENTLE SITE BLOCKING (optional)

List your distracting sites and, while focus runs, their tabs rest on a
quiet "it can wait" page showing the time left. The moment the session
ends — or you pause — the page offers the way back. Blocking is fully
opt-in: Chrome asks for the permission only if you enable it, and Ember
only ever acts on the sites you list, only while focus runs.

STATS THAT STAY YOURS

A full dashboard tracks time worked per day: today / week / streak cards,
a week·month·year chart with an optional daily-goal line, an hour-of-day
"when you focus" skyline, a deletable session ledger, and a year heatmap.
Label sessions with what you're working on ("thesis draft") and see a
per-label breakdown. Everything lives in local browser storage and can be
exported or imported as JSON (plus CSV) — Ember never sees your data.

THE QUIET DETAILS

• Phase-end notifications with action buttons (start focus, 5 more break
  minutes) and one gentle reminder if a finished phase sits unstarted.
• Lock-aware — locking the machine auto-pauses focus, so the lock screen
  never counts as work.
• Sound — three synthesized chime voices, a 30-second break-end warning,
  and optional ambient focus sound (ticking · rain · noise). All generated
  locally; nothing is downloaded.
• A daily goal with one quiet cheer when you cross it.
• Twelve themes plus an auto light/dark swatch, and a flame accent picker.
• Settings sync across your machines; stats stay local.

BUILT TO BE TRUSTWORTHY

• No data collection — nothing ever leaves your machine.
• No install-time host permissions. Site blocking asks for its permission
  only when you turn it on, and works only on the domains you list.
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
| Screenshot 2           | `assets/screenshot-2-stats.png`       | 1280×800  |
| Screenshot 3           | `assets/screenshot-3-popup.png`       | 1280×800  |
| Screenshot 4           | `assets/screenshot-4-blocked.png`     | 1280×800  |
| Screenshot 5           | `assets/screenshot-5-settings.png`    | 1280×800  |
| Small promo tile       | `assets/promo-small-440x280.png`      | 440×280   |
| Marquee promo tile     | `assets/promo-marquee-1400x560.png`   | 1400×560  |

---

## Privacy tab

**Single purpose description**

```
Ember is a pomodoro timer: it times focus sessions and breaks, shows the
remaining time on the toolbar badge and in its own pages, keeps a local
tally of focus time, signals the end of each phase with an optional chime
and notification, and — only if the user opts in — keeps the user's own
list of distracting sites parked on a quiet page while a focus session
runs.
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
Stores the user's timer settings (durations, auto-start, sound, blocking
and notification preferences), the current timer state, and a local record
of focus time per day plus a session log. Stats and the log stay in
chrome.storage.local on the user's device; only the settings object uses
chrome.storage.sync so preferences follow the user's own Chrome profile.
```

`notifications`

```
Shows a desktop notification when a focus session or break ends — with
action buttons to start the next phase — so the user notices the phase
change without watching the timer. Can be turned off in settings.
```

`offscreen`

```
Service workers cannot play audio. An offscreen document is created only to
play the end-of-phase chime and the optional ambient focus sound, and Chrome
closes it shortly after audio stops. Can be turned off in settings.
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

`declarativeNetRequest` (optional, requested at runtime)

```
Powers the opt-in site blocking feature: while a focus session runs, page
loads of domains the user listed are redirected to a calm extension page
showing the remaining time. Rules exist only while focus runs and only for
the user's own list. The permission is requested the first time the user
enables the feature — never at install — and the feature degrades to a
no-op if it is declined or revoked.
```

**Host permissions** (`<all_urls>`, optional, requested at runtime)

```
Required by Chrome for declarativeNetRequest redirect rules and to move
already-open tabs of the user's blocked sites to the quiet page when focus
starts. Requested together with declarativeNetRequest only when the user
enables site blocking. Ember makes no network requests, injects no scripts
into pages, and never reads page content; tab URLs are matched locally
against the user's blocklist and are not stored or transmitted.
```

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

Run `tools/package.sh` and upload the `dist/ember-<version>.zip` it prints
(contains only runtime files — no tools, store assets, or README).
