#!/usr/bin/env python3
"""Regenerate store/src/shot-app.html and store/src/popup-framed.html from the
real app.html / popup.html, so the store screenshots can never drift from the
shipped markup. The transform: swap theme-boot.js for chrome-shim.js, point
asset paths two levels up, and append each page's little URL-param helper."""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

APP_HELPER = """    <script>
      const q = new URLSearchParams(location.search);
      if (q.get('panel') === '1') {
        addEventListener('load', () => document.getElementById('open-settings').click());
      }
      // Pre-select a chart range on the stats dashboard, e.g. #stats&range=year
      if (q.get('range')) {
        addEventListener('load', () =>
          document.querySelector(`#ranges [data-range="${q.get('range')}"]`)?.click()
        );
      }
    </script>
"""

POPUP_HELPER = """    <script>
      if (new URLSearchParams(location.search).get('settings') === '1') {
        addEventListener('load', () => document.getElementById('open-settings').click());
      }
    </script>
"""


def transform(src, title, helper, head_extra=''):
    html = (ROOT / src).read_text()
    html = html.replace('<title>Ember</title>', f'<title>{title}</title>')
    html = html.replace(
        '<script src="theme-boot.js"></script>', '<script src="chrome-shim.js"></script>'
    )
    html = re.sub(r'(href|src)="(theme\.css|app\.css|popup\.css|blocked\.css|app\.js|popup\.js|blocked\.js|icons/)', r'\1="../../\2', html)
    if head_extra:
        html = html.replace('</head>', head_extra + '  </head>')
    html = html.replace('</body>', helper + '  </body>')
    return html


(ROOT / 'store/src/shot-app.html').write_text(
    transform('app.html', 'Ember — store screenshot', APP_HELPER)
)
(ROOT / 'store/src/popup-framed.html').write_text(
    transform(
        'popup.html',
        'Ember popup — store screenshot',
        POPUP_HELPER,
        head_extra='  <style>\n      body { overflow: hidden; }\n    </style>\n',
    )
)

(ROOT / 'store/src/shot-blocked.html').write_text(
    transform('blocked.html', 'Ember blocked page — store screenshot', '')
    .replace('<title>Ember — it can wait</title>', '<title>Ember blocked page — store screenshot</title>')
)

print('rebuilt store/src/shot-app.html, popup-framed.html, and shot-blocked.html')
