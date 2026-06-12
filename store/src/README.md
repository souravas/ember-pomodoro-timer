# Store asset sources

These pages render the real extension UI (same markup, CSS, and JS) in a
plain browser tab so it can be screenshotted for the Chrome Web Store.
[chrome-shim.js](chrome-shim.js) mocks the few `chrome.*` APIs the views
use; the displayed state is set via URL params.

## Regenerating `store/assets/`

1. Serve the project root: `python3 -m http.server 8741`
2. Open each page below at the given viewport size, wait ~2s for the
   entrance animations, and screenshot the viewport (PNG).
3. Flatten to 24-bit (no alpha): `Image.open(p).convert("RGB").save(p)`
   — the store rejects PNGs with an alpha channel.

| Asset                        | Size      | URL |
| ---------------------------- | --------- | --- |
| screenshot-1-focus.png       | 1280×800  | `shot-app.html?phase=focus&status=running&remain=17.8&cycle=1&sessions=2&minutes=50&label=thesis%20draft` |
| screenshot-2-stats.png       | 1280×800  | `shot-app.html?sessions=3&minutes=80#stats` (shim seeds a year of fake history) |
| screenshot-3-popup.png       | 1280×800  | `shot-popup.html` |
| screenshot-4-blocked.png     | 1280×800  | `shot-blocked.html?block=1&status=running&phase=focus&remain=17.8&from=youtube.com&label=thesis%20draft` |
| screenshot-5-settings.png    | 1280×800  | `shot-app.html?phase=focus&status=running&remain=21.5&cycle=1&sessions=2&minutes=50&panel=1&block=1` |
| promo-small-440x280.png      | 440×280   | `tile-small.html` |
| promo-marquee-1400x560.png   | 1400×560  | `tile-marquee.html` |

(The store allows five screenshots — focus, stats, popup, the blocked
page, and settings earn the slots; the break view is implied by the rest.)

`shot-app.html` / `popup-framed.html` are generated from the real `app.html`
/ `popup.html` — after the real markup changes, run
`python3 tools/make-store-src.py` to rebuild them before regenerating shots.
