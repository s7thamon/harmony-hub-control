"""Build the macOS app icon (desktop/resources/icon.png) from the Melodious artwork.

Usage, from the repo root:
    sips -s format bmp Android/branding/melodious-icon-source.jpg --out /tmp/melodious.bmp
    python3 -I desktop/scripts/build-icon.py /tmp/melodious.bmp desktop/resources/icon.png

The artwork already draws the app tile. This crops a square from inside it, rounds
the corners on Apple's icon grid (an 824 px tile on a 1024 px canvas) and adds a soft
shadow. electron-builder turns the PNG into the .icns. numpy only, like
Android/branding/build_icon.py.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "Android", "branding"))
import icon_tools as t  # noqa: E402

CANVAS = 1024
TILE = 824
RADIUS = 185  # about 22.5% of the tile, as in Apple's template
SS = 2  # supersampling for smooth corners

src, out = sys.argv[1:3]
px = t.read_bmp(src).astype(np.float64)

# The artwork's tile is the region a little lighter than the page; take a square from
# its middle so the crop holds only tile gradient and the glyph.
g = px.mean(2)
lit = g > 34
rows = np.where(lit.mean(1) > 0.2)[0]
cols = np.where(lit.mean(0) > 0.2)[0]
y0, y1, x0, x1 = rows.min(), rows.max(), cols.min(), cols.max()
side = int(min(y1 - y0, x1 - x0) * 0.97)
cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
crop = px[cy - side // 2: cy - side // 2 + side, cx - side // 2: cx - side // 2 + side]

big = CANVAS * SS
tile = t.resize(crop, TILE * SS)

# Rounded-rect coverage, supersampled.
yy, xx = np.mgrid[0:TILE * SS, 0:TILE * SS] + 0.5
r = RADIUS * SS
dx = np.maximum(np.maximum(r - xx, xx - (TILE * SS - r)), 0)
dy = np.maximum(np.maximum(r - yy, yy - (TILE * SS - r)), 0)
inside = (dx * dx + dy * dy) <= r * r

off = (big - TILE * SS) // 2
alpha = np.zeros((big, big))
alpha[off:off + TILE * SS, off:off + TILE * SS] = inside

# Shadow: the tile mask, blurred and nudged down.
def blur(a, radius, passes=3):
    for _ in range(passes):
        k = 2 * radius + 1
        c = np.cumsum(np.pad(a, ((0, 0), (radius + 1, radius)), mode="constant"), 1)
        a = (c[:, k:] - c[:, :-k]) / k
        c = np.cumsum(np.pad(a, ((radius + 1, radius), (0, 0)), mode="constant"), 0)
        a = (c[k:] - c[:-k]) / k
    return a

shadow = blur(np.roll(alpha, 12 * SS, 0), 10 * SS) * 0.45

rgb = np.zeros((big, big, 3))
rgb[off:off + TILE * SS, off:off + TILE * SS] = tile
a_tile = alpha
a_out = a_tile + shadow * (1 - a_tile)
premul = rgb * a_tile[..., None]  # shadow is black, so it adds no colour
img = np.concatenate([premul, a_out[..., None]], 2)
img = t.resize(img, CANVAS)
a = img[..., 3:4]
color = np.where(a > 1e-6, img[..., :3] / np.maximum(a, 1e-6), 0)
t.write_png(out, np.concatenate([np.clip(color, 0, 255), np.clip(a * 255, 0, 255)], 2).round())
print(f"wrote {out} ({CANVAS}x{CANVAS}, tile {TILE}, crop {side}px from the artwork)")
