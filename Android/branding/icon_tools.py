"""Tiny BMP reader / PNG writer so the icon can be built with numpy alone (no Pillow)."""
import struct
import zlib

import numpy as np


def read_bmp(path):
    data = open(path, "rb").read()
    offset = struct.unpack_from("<I", data, 10)[0]
    width, height = struct.unpack_from("<ii", data, 18)
    bpp = struct.unpack_from("<H", data, 28)[0]
    channels = bpp // 8
    row = (width * channels + 3) & ~3
    flip = height > 0
    height = abs(height)
    px = np.frombuffer(data, np.uint8, row * height, offset).reshape(height, row)[:, : width * channels]
    px = px.reshape(height, width, channels)[..., [2, 1, 0]]  # BGR(A) -> RGB
    return px[::-1] if flip else px


def write_png(path, rgba):
    rgba = np.ascontiguousarray(rgba.astype(np.uint8))
    h, w, c = rgba.shape
    color_type = {3: 2, 4: 6}[c]
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag, payload):
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def resize(img, size):
    """Area-averaging downscale (box filter) of a float image to size x size."""
    h, w = img.shape[:2]
    out = np.zeros((size, size, img.shape[2]), np.float64)
    ys = np.linspace(0, h, size + 1)
    xs = np.linspace(0, w, size + 1)
    # Integral image makes each box sum O(1).
    integral = np.zeros((h + 1, w + 1, img.shape[2]))
    integral[1:, 1:] = img.cumsum(0).cumsum(1)

    def box(y0, y1, x0, x1):
        return integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]

    yi = np.round(ys).astype(int)
    xi = np.round(xs).astype(int)
    for j in range(size):
        for i in range(size):
            y0, y1, x0, x1 = yi[j], max(yi[j + 1], yi[j] + 1), xi[i], max(xi[i + 1], xi[i] + 1)
            out[j, i] = box(y0, y1, x0, x1) / ((y1 - y0) * (x1 - x0))
    return out
