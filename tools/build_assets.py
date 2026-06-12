"""One-shot asset builder: downloads latin woff2 fonts and draws toolbar icons."""
import os
import re
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

CSS_URL = ("https://fonts.googleapis.com/css2"
           "?family=Instrument+Serif:ital@0;1"
           "&family=Spline+Sans+Mono:wght@400;500;600&display=swap")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read()


def download_fonts():
    css = fetch(CSS_URL).decode()
    os.makedirs(os.path.join(ROOT, "fonts"), exist_ok=True)
    # Split into @font-face blocks, keep only latin (U+0000-00FF) subsets.
    blocks = re.findall(r"@font-face\s*{[^}]+}", css)
    for b in blocks:
        if "U+0000-00FF" not in b:
            continue
        family = re.search(r"font-family:\s*'([^']+)'", b).group(1)
        style = re.search(r"font-style:\s*(\w+)", b).group(1)
        weight = re.search(r"font-weight:\s*(\d+)", b).group(1)
        url = re.search(r"url\((https://[^)]+\.woff2)\)", b).group(1)
        name = family.replace(" ", "")
        suffix = "Italic" if style == "italic" else weight
        path = os.path.join(ROOT, "fonts", f"{name}-{suffix}.woff2")
        with open(path, "wb") as f:
            f.write(fetch(url))
        print("font:", os.path.basename(path))


def draw_icon(size):
    # Draw at 8x and downscale for clean antialiasing.
    s = size * 8
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.24),
                        fill=(26, 19, 16, 255))
    pad = int(s * 0.20)
    box = [pad, pad, s - pad, s - pad]
    w = max(2, int(s * 0.075))
    # Faint full track, then ember arc with a gap at the top (timer mid-run).
    d.arc(box, 0, 360, fill=(239, 229, 214, 46), width=w)
    d.arc(box, -90, 200, fill=(226, 92, 63, 255), width=w)
    # Center dot in warm cream.
    r = int(s * 0.045)
    c = s // 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=(239, 229, 214, 230))
    return img.resize((size, size), Image.LANCZOS)


def build_icons():
    os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(ROOT, "icons", f"icon{size}.png")
        draw_icon(size).save(path)
        print("icon:", os.path.basename(path))


if __name__ == "__main__":
    download_fonts()
    build_icons()
