#!/usr/bin/env bash
# sidepanel.html is popup.html with body.sidepanel — regenerate after any
# popup.html change so the two surfaces never drift.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  head -1 popup.html
  echo '<!-- Side panel surface: a copy of popup.html with body.sidepanel (popup.css adapts the layout). Regenerate after popup.html changes: tools/make-sidepanel.sh -->'
  tail -n +2 popup.html | sed 's|<body data-phase="focus" data-status="idle">|<body class="sidepanel" data-phase="focus" data-status="idle">|'
} > sidepanel.html
echo "rebuilt sidepanel.html"
