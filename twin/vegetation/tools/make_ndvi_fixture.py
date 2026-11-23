"""SYNTHETIC NDVI fixture (Sentinel-2 is not reachable from this sandbox). Shape and encoding are exactly what the
real path produces (ITM 10 m grid, uint8 = NDVI*125+125, 255 = nodata); the VALUES are invented from the estimated
land cover + noise, only to exercise the code path. Never use it as data.  python3 tools/make_ndvi_fixture.py"""
import base64, gzip, json, os
import numpy as np
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
keys = ["164_633", "165_633", "164_634", "165_634"]
x0, y1 = 164000, 635000
nd = np.full((200, 200), np.nan)
base = {0: 0.12, 1: 0.55, 2: 0.5, 3: 0.6, 4: 0.3, 5: 0.06, 6: 0.04, 7: 0.16, 8: 0.35, 9: 0.45, 10: 0.3, 11: 0.6, 12: 0.38, 13: 0.25, 14: -0.1, 15: 0.07}
rng = np.random.default_rng(27)
for k in keys:
    tx, ty = map(int, k.split("_"))
    g = json.load(gzip.open(os.path.join(H, "data/tiles/g", k + ".json.gz")))
    lc = np.frombuffer(base64.b64decode(g["lc"]), np.uint8).reshape(100, 100) & 0x7F
    r0, c0 = (y1 - (ty + 1) * 1000) // 10, (tx * 1000 - x0) // 10
    nd[r0:r0 + 100, c0:c0 + 100] = np.vectorize(base.get)(lc) + rng.normal(0, 0.08, (100, 100))
q = np.where(np.isnan(nd), 255, np.clip(np.round(nd * 125 + 125), 0, 250)).astype(np.uint8)
out = os.path.join(H, "fixtures/ndvi_SYNTHETIC_ashdod_4tiles.npz")
np.savez_compressed(out, ndvi=q, x0=x0, y1=y1, step=10, synthetic=True, scene="SYNTHETIC-FIXTURE-not-a-real-scene")
print(out, q.shape, os.path.getsize(out), "bytes")
