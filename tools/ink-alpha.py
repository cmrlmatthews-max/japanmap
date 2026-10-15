#!/usr/bin/env python3
"""Turn a Gemini ink painting into an ink-on-transparent PNG.

Usage: python3 -I tools/ink-alpha.py IN.jpeg OUT.png [--size 1024] [--ink 2C2C2A] [--trim]

How it works:
1. Magenta (#FF00FF) pixels become background (Gemini sometimes paints the art on a paper sheet that sits on the magenta ground).
2. The background tone is the brightest common tone of the image (the paper or the white ground).
3. Alpha = how much darker a pixel is than that background. Pure background is 0. Solid ink is 1.
4. RGB = the ink colour everywhere. The map shader multiplies it toward grey, so only alpha carries the drawing.
5. --trim cuts the empty margin, with a small pad, so the file is as small as the drawing.

This works for art painted on a white ground, on a cream sheet, or on magenta. Pale washes keep their lightness as low alpha.
"""
import sys, argparse
import numpy as np
from PIL import Image, ImageFilter

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--size', type=int, default=1024, help='long side of the output')
ap.add_argument('--ink', default='2C2C2A')
ap.add_argument('--trim', action='store_true')
ap.add_argument('--gamma', type=float, default=1.0, help='alpha curve: >1 lightens washes, <1 darkens them')
a = ap.parse_args()

im = Image.open(a.src).convert('RGBA')
white = Image.new('RGBA', im.size, (255, 255, 255, 255)); white.alpha_composite(im); im = white.convert('RGB')   # a transparent source counts as white ground
rgb = np.asarray(im).astype(np.float32) / 255.0
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

# 1. magenta key: strong red and blue, weak green
mag = (r > 0.6) & (b > 0.6) & (g < 0.45) & ((r + b) / 2 - g > 0.35)
# grow the magenta mask (about 1 percent of the image) to swallow the JPEG fringe and the edge or shadow of a painted paper sheet
if mag.any():
    k = max(3, int(0.01 * max(im.size)) | 1)
    magI = Image.fromarray((mag * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(k))
    mag = np.asarray(magI) > 0

# 2. luminance, with magenta treated as the brightest background
lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
lum = np.where(mag, 1.0, lum)
# background tone: the typical tone of the non-magenta area (the paper or the white ground: most of the image is empty), never below 0.75
bg = max(0.75, float(np.percentile(lum[~mag], 60)) if (~mag).any() else 1.0)
ink_lum = 0.12   # anything this dark or darker is solid ink

# 3. alpha from darkness
alpha = np.clip((bg - lum) / (bg - ink_lum), 0.0, 1.0)
alpha[mag] = 0.0
# a soft floor: paper grain and JPEG noise (< 5 percent) are not ink
FLOOR = 0.05
alpha = np.where(alpha < FLOOR, 0.0, (alpha - FLOOR) / (1 - FLOOR))
alpha = alpha ** a.gamma

# 4. ink colour. Vermilion marks (a seal, a crane's crown, a sun) keep their own colour at full strength.
ink = tuple(int(a.ink[i:i + 2], 16) for i in (0, 2, 4))
red = (~mag) & (r > 0.45) & (g < 0.5) & (b < 0.5) & (r - np.maximum(g, b) > 0.25)
out = np.zeros((*alpha.shape, 4), dtype=np.uint8)
out[..., 0], out[..., 1], out[..., 2] = ink
out[..., 3] = (alpha * 255 + 0.5).astype(np.uint8)
if red.any():
    sat = np.clip((r - np.maximum(g, b) - 0.25) / 0.35, 0, 1)        # how red: fades the mark's edge into the ink
    for c, v in enumerate((0xC8, 0x34, 0x1E)): out[..., c] = np.where(red, (v * sat + ink[c] * (1 - sat)).astype(np.uint8), out[..., c])
    out[..., 3] = np.where(red, np.maximum(out[..., 3], (255 * sat).astype(np.uint8)), out[..., 3])
res = Image.fromarray(out, 'RGBA')

# 5. trim
if a.trim:
    ys, xs = np.where(alpha > 0.02)
    if len(xs):
        pad = int(0.03 * max(res.size))
        x0, x1 = max(0, xs.min() - pad), min(res.size[0], xs.max() + pad + 1)
        y0, y1 = max(0, ys.min() - pad), min(res.size[1], ys.max() + pad + 1)
        res = res.crop((x0, y0, x1, y1))

if a.size and max(res.size) > a.size:
    k = a.size / max(res.size)
    res = res.resize((max(1, round(res.size[0] * k)), max(1, round(res.size[1] * k))), Image.LANCZOS)
res.save(a.dst, optimize=True)
cov = float((alpha > 0.02).mean())
print(f'{a.dst}: {res.size[0]}x{res.size[1]}, background tone {bg:.3f}, magenta {mag.mean() * 100:.1f}%, ink coverage {cov * 100:.1f}%')
