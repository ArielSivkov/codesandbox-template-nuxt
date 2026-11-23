"""Render the green layer of a city as a PNG (land cover colours + plant dots). python3 tools/lc_png.py data shots/lc.png"""
import base64, gzip, json, os, sys
import numpy as np
from PIL import Image
D, OUT = sys.argv[1], sys.argv[2]
COL = {0: (150, 150, 150), 1: (110, 170, 70), 2: (70, 140, 60), 3: (40, 90, 40), 4: (140, 150, 90), 5: (230, 215, 170),
       6: (240, 225, 180), 7: (205, 190, 140), 8: (180, 170, 110), 9: (120, 140, 70), 10: (90, 110, 80), 11: (60, 160, 60),
       12: (130, 175, 100), 13: (170, 180, 110), 14: (60, 100, 150), 15: (235, 220, 170)}
fs = [f for f in os.listdir(D + '/tiles/g')]
ks = [tuple(map(int, f.split('.')[0].split('_'))) for f in fs]
tx0 = min(k[0] for k in ks); tx1 = max(k[0] for k in ks); ty0 = min(k[1] for k in ks); ty1 = max(k[1] for k in ks)
W = (tx1 - tx0 + 1) * 100; H = (ty1 - ty0 + 1) * 100
img = np.zeros((H, W, 3), np.uint8)
for (tx, ty), f in zip(ks, fs):
    g = json.load(gzip.open(D + '/tiles/g/' + f))
    lc = np.frombuffer(base64.b64decode(g['lc']), np.uint8).reshape(100, 100)
    r0 = (ty1 - ty) * 100; c0 = (tx - tx0) * 100
    for c, rgb in COL.items():
        m = (lc & 0x7F) == c
        img[r0:r0 + 100, c0:c0 + 100][m] = rgb
    t = g['t']
    for i in range(0, len(t), 5):
        x = c0 + int(t[i] / 100); y = r0 + 99 - int(t[i + 1] / 100)
        if 0 <= x < W and 0 <= y < H:
            img[y, x] = (20, 60, 20) if t[i + 4] != 3 else (200, 40, 40)
Image.fromarray(img).save(OUT)
print(OUT, W, H)
