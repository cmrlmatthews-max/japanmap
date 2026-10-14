"""Key out a flat magenta background from Gemini JPEGs and write RGBA PNGs.
Usage: python3 tools/key-magenta.py assets/_jpeg-originals/name.jpeg [more...]
Output: assets/name.png
"""
import sys, os
from PIL import Image
import numpy as np
for src in sys.argv[1:]:
    name = os.path.splitext(os.path.basename(src))[0]
    a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g                      # magenta strength
    alpha = np.clip(255 - (m - 40) * 255 / 100, 0, 255)
    t = (255 - alpha) / 255.0                     # despill soft edges
    rr = r - t * (r - g); bb = b - t * (b - g)
    out = np.dstack([rr.clip(0, 255), g, bb.clip(0, 255), alpha]).astype(np.uint8)
    dst = os.path.join("assets", name + ".png")
    Image.fromarray(out, "RGBA").save(dst)
    print(dst, "transparent %.0f%%" % (100 * (alpha == 0).mean()))
