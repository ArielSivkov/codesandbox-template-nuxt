# overview of sample tiles' sea/land in sample frame -> PNG (2 px per 25 m)
import gzip, glob, os, struct, sys, json
import numpy as np
root = sys.argv[1]; out = sys.argv[2]
keys = [os.path.basename(f)[:-7] for f in glob.glob(root + '/tiles/t/*.bin.gz')]
txs = [int(k.split('_')[0]) for k in keys]; tys = [int(k.split('_')[1]) for k in keys]
x0, x1, y0, y1 = min(txs), max(txs) + 1, min(tys), max(tys) + 1
W, H = (x1 - x0) * 40, (y1 - y0) * 40
img = np.zeros((H, W, 3), np.uint8); img[:] = (60, 60, 60)
for k in keys:
    b = gzip.open(f'{root}/tiles/t/{k}.bin.gz').read()
    z = np.frombuffer(b[20:20 + 41 * 41 * 2], '<i2').reshape(41, 41)[:40, :40]
    tx, ty = map(int, k.split('_'))
    c0 = (tx - x0) * 40; r0 = (y1 - 1 - ty) * 40
    t = np.zeros((40, 40, 3), np.uint8)
    t[z == -32768] = (30, 90, 160); t[z == -32767] = (90, 90, 90)
    land = z > -32767; g = np.clip(z / 10 * 4, 0, 255).astype(np.uint8)
    t[land] = np.stack([g[land] // 2 + 100, g[land] // 2 + 120, 60 + 0 * g[land]], -1)
    img[r0:r0 + 40, c0:c0 + 40] = t
from PIL import Image
im = Image.fromarray(img).resize((W * 3, H * 3), Image.NEAREST); im.save(out)
print('frame tiles x', x0, x1, 'y', y0, y1, 'px/km', 120)
