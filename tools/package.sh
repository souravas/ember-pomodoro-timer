#!/usr/bin/env bash
# Build the Chrome Web Store upload zip: runtime files only, no dev tooling.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'EOF'
import json, os, zipfile

FILES = [
    "manifest.json",
    "background.js", "offscreen.html", "offscreen.js",
    "popup.html", "popup.css", "popup.js",
    "app.html", "app.css", "app.js",
    "theme.css", "ui.js",
]
DIRS = ["core", "fonts", "icons"]

version = json.load(open("manifest.json"))["version"]
out = f"dist/ember-{version}.zip"
os.makedirs("dist", exist_ok=True)

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    paths = list(FILES)
    for d in DIRS:
        paths += [os.path.join(d, f) for f in sorted(os.listdir(d))]
    for p in paths:
        z.write(p)
        print(" packed", p)

print(f"\nBuilt {out} ({os.path.getsize(out) // 1024} KB)")
EOF
