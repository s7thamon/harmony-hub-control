"""Build Melodious adaptive-icon layers from the supplied artwork.

Usage: python3 -I build_icon.py <source.bmp> <android res dir> <preview dir>
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import icon_tools as t  # noqa: E402

src, res, preview = sys.argv[1:4]
px = t.read_bmp(src).astype(np.float64)

# The glyph is the only saturated thing on the canvas; pad its box generously for the glow.
sat = px.max(2) - px.min(2)
ys, xs = np.where(sat > 60)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
pad = 70
mask = np.zeros(sat.shape, bool)
mask[y0 - pad:y1 + pad, x0 - pad:x1 + pad] = True

# Un-blend the neon from the tile: P = B*(1-a) + C*a with the glyph colour C as bright as possible.
# The tile is a vertical gradient (lighter at the top), so estimate its colour per row from the
# non-glyph pixels in the padded box; a single colour leaves a faint rectangle behind.
calm = (sat < 18) & mask
bg = np.zeros_like(px)
fallback = np.array([31.0, 32.0, 38.0])
for y in range(px.shape[0]):
    row = px[y][calm[y]]
    bg[y] = np.median(row, 0) if len(row) > 20 else fallback
# Smooth the per-row estimate so JPEG noise doesn't band.
kernel = np.ones(41) / 41
for c in range(3):
    bg[:, :, c] = np.convolve(np.pad(bg[:, 0, c], 20, mode="edge"), kernel, "valid")[:, None]
diff = px - bg
alpha = np.clip((diff / (255.0 - bg)).max(2), 0, 1)
alpha = np.clip((alpha - 0.02) / 0.98, 0, 1)
alpha[~mask] = 0
color = np.where(alpha[..., None] > 0, bg + diff / np.maximum(alpha[..., None], 1e-6), 0)
color = np.clip(color, 0, 255)

# Square canvas centred on the glyph. The glyph (with glow) must fit Android's 66dp safe circle
# inside the 108dp layer, so the canvas is the glyph diagonal scaled by 108/66.
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
# Fit the glyph's widest side (plus glow) into 62dp of the 108dp layer: its bounding-box corners
# are empty, so the real artwork stays inside the 66dp safe circle.
span = max(x1 - x0, y1 - y0) + 2 * 40
side = int(np.ceil(span * 108 / 62))
canvas = np.zeros((side, side, 4))
sx0, sy0 = int(round(cx - side / 2)), int(round(cy - side / 2))
for c in range(3):
    canvas[..., c] = 0
h, w = alpha.shape
ty0, tx0 = max(0, -sy0), max(0, -sx0)
yy0, xx0 = max(0, sy0), max(0, sx0)
yy1, xx1 = min(h, sy0 + side), min(w, sx0 + side)
region = (slice(ty0, ty0 + yy1 - yy0), slice(tx0, tx0 + xx1 - xx0))
# Premultiply before resampling so the glow edges don't pick up dark fringes.
canvas[region[0], region[1], :3] = color[yy0:yy1, xx0:xx1] * alpha[yy0:yy1, xx0:xx1, None]
canvas[region[0], region[1], 3] = alpha[yy0:yy1, xx0:xx1]

# Monochrome: just the strokes (no halo), so themed icons and status-bar icons stay crisp.
mono_alpha = np.clip((canvas[..., 3] - 0.42) / 0.33, 0, 1)

def export(arr_premul_rgba, size):
    small = t.resize(arr_premul_rgba, size)
    a = small[..., 3:4]
    rgb = np.where(a > 0, small[..., :3] / np.maximum(a, 1e-6), 0)
    return np.concatenate([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)], 2)

densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
mono = np.zeros_like(canvas)
mono[..., :3] = 255 * mono_alpha[..., None]
mono[..., 3] = mono_alpha
for name, scale in densities.items():
    d = os.path.join(res, f"mipmap-{name}")
    os.makedirs(d, exist_ok=True)
    t.write_png(os.path.join(d, "ic_launcher_foreground.png"), export(canvas, int(108 * scale)))
    t.write_png(os.path.join(d, "ic_launcher_monochrome.png"), export(mono, int(108 * scale)))
    # Status bar / Quick Settings: 24dp, white strokes only. Crop the safe zone so the glyph fills it.
    dd = os.path.join(res, f"drawable-{name}")
    os.makedirs(dd, exist_ok=True)
    inner = int(side * 72 / 108)
    off = (side - inner) // 2
    t.write_png(os.path.join(dd, "ic_stat_melodious.png"), export(mono[off:off + inner, off:off + inner], int(24 * scale)))

# 512 px store icon and a preview: glyph over the tile gradient.
def composite(size):
    fg = export(canvas, size)
    yy = np.linspace(0, 1, size)[:, None, None]
    tile = np.array([38.0, 39.0, 46.0]) * (1 - yy) + np.array([28.0, 30.0, 33.0]) * yy
    tile = np.broadcast_to(tile, (size, size, 3))
    a = fg[..., 3:4] / 255
    return np.concatenate([tile * (1 - a) + fg[..., :3] * a, np.full((size, size, 1), 255)], 2)

os.makedirs(preview, exist_ok=True)
t.write_png(os.path.join(preview, "melodious-playstore-512.png"), composite(512))
# Preview of the monochrome layer on a dark background, as a themed icon would show it.
m = export(mono, 256)
dark = np.full((256, 256, 3), 40.0)
a = m[..., 3:4] / 255
t.write_png(os.path.join(preview, "mono-preview.png"), np.concatenate([dark * (1 - a) + m[..., :3] * a, np.full((256, 256, 1), 255)], 2))
print("canvas", side, "glyph box", (x0, y0, x1, y1))
