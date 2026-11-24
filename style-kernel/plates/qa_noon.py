"""Kernel DAY brightness budget on a rendered plate (style.json -> composition.brightnessBudget.dayTest_he).
usage: python3 -I qa_noon.py plate.png focus.json  -> JSON on stdout
By day the focus is gold INK, so the rule is applied to local contrast |Y - Y(background)| instead of Y.
Downscale to 1080 px wide. Focus contrast = the strongest contrast on the focus line itself (core + ink edges, 4u) and its
bead. The focus block (line + 40u, bead, the focus words) is excluded from "outside"; so are all words (SVG text boxes):
legible text needs 4.5:1 on light paper, which no 35 % day budget can allow. The with-words figure is reported too.
Colour keys (legend swatches, the true-colour sky swatch of the dial) are exempt like words.
Pass: P99 of contrast outside <= 0.35 x focus contrast.
Also: the five largest high-contrast components (contrast > 0.55, >= 40 px) must lie inside the mask."""
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


def lin(a):
    a = np.asarray(a, dtype=np.float64) / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


L = lin(small)
Y = 0.2126 * L[..., 0] + 0.7152 * L[..., 1] + 0.0722 * L[..., 2]
bg = F["background"].lstrip("#")
bl = lin([int(bg[i:i + 2], 16) for i in (0, 2, 4)])
Ybg = float(0.2126 * bl[0] + 0.7152 * bl[1] + 0.0722 * bl[2])
Cn = np.abs(Y - Ybg)

k = w / F["W"]
U = F["H"] / 1080.0


def draw_mask(rad, with_boxes):
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    r = rad * k
    for run in F["pts"]:
        pts = [(x * k, y * k) for x, y in run]
        if len(pts) > 1:
            d.line(pts, fill=255, width=max(1, int(round(2 * r))), joint="curve")
        for x, y in pts[:1] + pts[-1:]:
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    if F.get("bead"):
        x, y = F["bead"][0] * k, F["bead"][1] * k
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    for bx in (F.get("boxes", []) if with_boxes else []):
        d.rectangle([bx[0] * k, bx[1] * k, (bx[0] + bx[2]) * k, (bx[1] + bx[3]) * k], fill=255)
    return np.asarray(m) > 0


core = draw_mask(4 * U, False)                      # the focus line itself (core + ink edges) and its bead
M = draw_mask(F.get("radius") or 40 * U, True)      # focus block: line + 40u, bead, the focus words
words = Image.new("L", (w, h), 0)
dw = ImageDraw.Draw(words)
for bx in F.get("words", []) + F.get("keys", []):
    dw.rectangle([bx[0] * k - 1, bx[1] * k - 1, (bx[0] + bx[2]) * k + 1, (bx[1] + bx[3]) * k + 1], fill=255)
Wm = np.asarray(words) > 0

focusC = float(Cn[core].max()) if core.any() else 0.0
out = Cn[~M & ~Wm]
p99 = float(np.percentile(out, 99))
outAll = Cn[~M]
p99All = float(np.percentile(outAll, 99))
hiShare = float((out > 0.35 * focusC).mean())

# connected high-contrast components outside the mask (4-neighbour flood fill, small image -> fine in numpy/python)
hi = (Cn > 0.55) & ~Wm
lab = np.zeros(hi.shape, np.int32)
sizes, inside = [], []
cur = 0
for y0, x0 in zip(*np.nonzero(hi)):
    if lab[y0, x0]:
        continue
    cur += 1
    stack = [(y0, x0)]
    lab[y0, x0] = cur
    n = 0
    m_in = 0
    while stack:
        y, x = stack.pop()
        n += 1
        m_in += 1 if M[y, x] else 0
        for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= yy < h and 0 <= xx < w and hi[yy, xx] and not lab[yy, xx]:
                lab[yy, xx] = cur
                stack.append((yy, xx))
    sizes.append(n)
    inside.append(m_in / n)
order = sorted(range(len(sizes)), key=lambda i: -sizes[i])[:5]
big = [{"px": sizes[i], "inMask": round(inside[i], 2)} for i in order if sizes[i] >= 40]

res = {
    "test": "day: |Y - Y(paper)|; words exempt (see known issues: 4.5:1 text vs 35% budget)",
    "size_tested": [w, h],
    "paperY": round(Ybg, 4),
    "focusContrast": round(focusC, 4),
    "p99Outside": round(p99, 4),
    "limit": round(0.35 * focusC, 4),
    "ratio": round(p99 / focusC, 4) if focusC else None,
    "pass": bool(p99 <= 0.35 * focusC),
    "shareOverLimit": round(hiShare, 4),
    "withWords": {"p99Outside": round(p99All, 4), "ratio": round(p99All / focusC, 4) if focusC else None, "pass": bool(p99All <= 0.35 * focusC)},
    "maxOutside": round(float(out.max()), 4),
    "largestHighContrast": big,
    "componentsPass": all(b["inMask"] >= 0.5 for b in big),
    "meanY": round(float(Y.mean()), 4),
    "quietShare_contrast<0.08": round(float((Cn < 0.08).mean()), 3),
}
print(json.dumps(res))
