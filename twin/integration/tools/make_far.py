#!/usr/bin/env python3
"""מסכת "הקרקע הרחוקה" של העין הגדולה (אשדוד ±100 ק"מ, תא 100 מ') מתוך סקירת הכיסוי הארצי.
קלט: swarm/national/data/nat/overview.png (R=√שבר בנוי, G=גובה ממוצע, B=יבשה לפי קו חוף OSM, A=בתוך העיגול; שורה 0 = צפון).
פלט: world/assets/far/far_ov.png — נתונים, לא צבע: R = שבר בנוי (0..1), G = יבשה (0/1, מוחלק קלות), B = 0.
הצבע עצמו בא מ-NASA (region_day.jpg) בשיידר, כך שאין תפר מול הכדור; מהסקירה באים רק קו החוף (100 מ') והשטח הבנוי.
python3 -I tools/make_far.py <overview.png> <out.png>"""
import sys, numpy as np, cv2
from PIL import Image, ImageFilter
src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32) / 255.0
R, B = im[..., 0], im[..., 2]
land = (B > 0.5).astype(np.float32)
# שאריות פוליגונים: רכיבי ים קטנים מ-600 תאים (6 קמ"ר) בתוך היבשה → יבשה (נשארים: הים התיכון וים המלח)
nlab, lab, st, _ = cv2.connectedComponentsWithStats((land < 0.5).astype(np.uint8), connectivity=4)
for i in range(1, nlab):
    if st[i, cv2.CC_STAT_AREA] < 600: land[lab == i] = 1
built = np.clip(R * 1.4, 0, 1) * land
L = np.asarray(Image.fromarray((land * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)))
Bt = np.asarray(Image.fromarray((built * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)))
rgb = np.stack([Bt, L, np.zeros_like(L)], -1).astype(np.uint8)
img = Image.fromarray(rgb).resize((2048, 2048), Image.BILINEAR)
img.save(out, optimize=True)
print(out, img.size, 'land%', round(float(land.mean()) * 100, 1))
