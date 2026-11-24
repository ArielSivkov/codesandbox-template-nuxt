#!/usr/bin/env python3
"""texfactory/qa.py - בדיקת טקסטורות רציפות (גדוד טקסטורות, ESH27).

שימוש:  python3 -I qa.py <out_dir> <file> [file ...]
פלט:    שורת JSON לכל קובץ + תצוגת ריצוף 2x2 (<out_dir>/<name>.tile.jpg) לבדיקה בעין.

מדדים:
  seam_x / seam_y  - הקפיצה בקו התפר (עמודה אחרונה מול ראשונה) חלקי הקפיצה החציונית בין עמודות שכנות בפנים.
                     1.0 = רציף לגמרי; עד ~1.3 לא נראה; מעל 2 = תפר נראה בריצוף.
  macro            - טווח הבהירות (max-min) של ממוצעי 8x8 בלוקים, ביחידות 0..1. גבוה = כתמים גדולים שיחזרו בריצוף.
  normal (למפות נורמל): אורך ממוצע, z ממוצע, הטיה ממוצעת (x,y) - הטיה גדולה = המשטח "נוטה" ומשנה תאורה בריצוף.
"""
import json
import os
import sys

import numpy as np
from PIL import Image


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def seam_ratio(a, axis):
    """a: HxWxC float. axis=1 -> horizontal wrap (columns), axis=0 -> vertical wrap (rows)."""
    if axis == 1:
        inner = np.abs(np.diff(a, axis=1)).mean(axis=(0, 2))          # per column pair
        wrap = np.abs(a[:, 0] - a[:, -1]).mean()
    else:
        inner = np.abs(np.diff(a, axis=0)).mean(axis=(1, 2))
        wrap = np.abs(a[0] - a[-1]).mean()
    med = float(np.median(inner)) or 1e-9
    p99 = float(np.percentile(inner, 99)) or 1e-9
    return wrap / med, wrap / p99


def macro_range(lum, n=8):
    h, w = lum.shape
    b = lum[: h // n * n, : w // n * n].reshape(n, h // n, n, w // n).mean(axis=(1, 3))
    return float(b.max() - b.min())


def analyze(path, out_dir):
    im = Image.open(path)
    info = {"file": os.path.basename(path), "size": list(im.size), "mode": im.mode, "bytes": os.path.getsize(path)}
    rgb = np.asarray(im.convert("RGB"), dtype=np.float64) / 255.0
    sx, sx99 = seam_ratio(rgb, 1)
    sy, sy99 = seam_ratio(rgb, 0)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    info.update({
        "mean_srgb8": [round(float(v) * 255, 1) for v in rgb.reshape(-1, 3).mean(0)],
        "mean_lin": [round(float(v), 4) for v in srgb_to_lin(rgb).reshape(-1, 3).mean(0)],
        "lum_std": round(float(lum.std()), 4),
        "seam_x": round(sx, 2), "seam_y": round(sy, 2), "seam_x_vs_p99": round(sx99, 2), "seam_y_vs_p99": round(sy99, 2),
        "macro": round(macro_range(lum), 4),
    })
    if "normal" in os.path.basename(path).lower():
        n = rgb * 2.0 - 1.0
        ln = np.linalg.norm(n, axis=2)
        info["normal"] = {"len_mean": round(float(ln.mean()), 3), "z_mean": round(float(n[..., 2].mean()), 3),
                          "tilt_xy": [round(float(n[..., 0].mean()), 3), round(float(n[..., 1].mean()), 3)],
                          "z_neg_frac": round(float((n[..., 2] < 0).mean()), 4)}
    # תצוגת ריצוף 2x2 (כל אריח מוקטן ל-512)
    t = im.convert("RGB").resize((512, 512), Image.LANCZOS)
    tile = Image.new("RGB", (1024, 1024))
    for k in range(4):
        tile.paste(t, ((k % 2) * 512, (k // 2) * 512))
    os.makedirs(out_dir, exist_ok=True)
    tile.save(os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + ".tile.jpg"), quality=85)
    return info


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    out = sys.argv[1]
    for p in sys.argv[2:]:
        print(json.dumps(analyze(p, out), ensure_ascii=False))


if __name__ == "__main__":
    main()
