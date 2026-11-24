"""Kernel brightness budget on a rendered plate (style.json → composition.brightnessBudget).
usage: python3 -I qa_budget.py plate.png focus.json  → JSON on stdout
Downscale to 1080 px wide; the focal mask is the focus polyline widened by its glow radius (40u).
Pass: P99 of luminance Y outside the mask ≤ 0.35 × Y(brightest pixel in the mask). Also reports bright blobs outside."""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

png, fj = sys.argv[1], sys.argv[2]
F = json.load(open(fj, encoding="utf-8"))
im = Image.open(png).convert("RGB")
w = 1080
h = round(im.height * w / im.width)
small = im.resize((w, h), Image.LANCZOS)
a = np.asarray(small).astype(np.float64) / 255.0
lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
Y = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]

k = w / F["W"]
mask = Image.new("L", (w, h), 0)
d = ImageDraw.Draw(mask)
r = (F.get("radius") or 50) * k
pts = [(x * k, y * k) for x, y in F["pts"]]
if len(pts) > 1:
    d.line(pts, fill=255, width=max(1, int(round(2 * r))), joint="curve")
for x, y in pts + ([tuple(F["bead"])] if F.get("bead") else []):
    if F.get("bead") and (x, y) == tuple(F["bead"]):
        x, y = x * k, y * k
    d.ellipse([x - r, y - r, x + r, y + r], fill=255)
M = np.asarray(mask) > 0

out = Y[~M]
p99 = float(np.percentile(out, 99))
focusY = float(Y[M].max()) if M.any() else 0.0
bright = (Y > 0.55) & ~M
res = {
    "size_tested": [w, h],
    "focusY": round(focusY, 4),
    "p99Outside": round(p99, 4),
    "limit": round(0.35 * focusY, 4),
    "ratio": round(p99 / focusY, 4) if focusY else None,
    "pass": bool(p99 <= 0.35 * focusY),
    "maxOutside": round(float(out.max()), 4),
    "pixelsOutsideOver055": int(bright.sum()),
    "meanY": round(float(Y.mean()), 4),
    "quietShareY<0.02": round(float((Y < 0.02).mean()), 3),
}
print(json.dumps(res))
