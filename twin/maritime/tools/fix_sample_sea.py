#!/usr/bin/env python3
"""Make a demo copy of the Ashdod sample tiles where offshore 'OUTSIDE' terrain cells become SEA.

Why: pipeline/yazam/tiles.py writes OUTSIDE (-32767) for every lattice node outside the study area (city + 300 m),
including open sea. twin/game/js/world.js then fills OUTSIDE cells of a tile that has any land by diffusion from
land → sand strips / plateaus 0.6–1 m high appear in the sea (visible from the boat and the beach).
The proper fix is in the pipeline (see pipeline_patch: keep SEA outside the study area). This tool applies the
same idea to a COPY of the sample for the demo: an OUTSIDE node becomes SEA when it is flood-connected to a SEA
node through OUTSIDE nodes AND lies at least 60 m west of the fitted coast line (stricter than the world.js +300 m rule so the shore is never flooded).
Source data is not modified.  Usage:  python3 tools/fix_sample_sea.py <src data dir> <dst dir>
"""
import gzip, json, os, shutil, struct, sys
from collections import deque
import numpy as np

SEA, OUT = -32768, -32767
A, B = -125006.9, 0.45566           # world.js COAST_A / COAST_B (sample frame)
src, dst = sys.argv[1], sys.argv[2]
if os.path.exists(dst):
    shutil.rmtree(dst)
shutil.copytree(src, dst)
files = sorted(os.listdir(os.path.join(dst, "tiles", "t")))
tiles = {}
for f in files:
    raw = gzip.open(os.path.join(dst, "tiles", "t", f)).read()
    hdr = raw[:20]
    _, _, tx, ty, nt, nm, step = struct.unpack("<4sHiiHHH", hdr)
    z = np.frombuffer(raw[20:20 + nt * nt * 2], "<i2").copy().reshape(nt, nt)
    tiles[(tx, ty)] = {"f": f, "raw": raw, "z": z, "nt": nt, "step": step}
# global lattice index: (E//25, N//25) -> list of (tile, r, c)
node = {}
for (tx, ty), t in tiles.items():
    nt, st = t["nt"], t["step"]
    for r in range(nt):
        for c in range(nt):
            key = ((tx * 1000) // st + c, ((ty + 1) * 1000) // st - r)
            node.setdefault(key, []).append((tx, ty, r, c))
val = lambda k: [tiles[(tx, ty)]["z"][r, c] for tx, ty, r, c in node[k]]
west = lambda k: k[0] * 25 < A + B * (k[1] * 25) - 60     # stricter than world.js (+300): never flood the shore
q = deque(k for k in node if SEA in val(k))
seen = set(q)
flip = 0
while q:
    k = q.popleft()
    for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = (k[0] + d[0], k[1] + d[1])
        if n in seen or n not in node:
            continue
        v = val(n)
        if all(x == OUT for x in v) and west(n):
            seen.add(n); q.append(n); flip += 1
            for tx, ty, r, c in node[n]:
                tiles[(tx, ty)]["z"][r, c] = SEA
for (tx, ty), t in tiles.items():
    raw = t["raw"]; nt = t["nt"]
    out = raw[:20] + t["z"].astype("<i2").tobytes() + raw[20 + nt * nt * 2:]
    with open(os.path.join(dst, "tiles", "t", t["f"]), "wb") as fh:
        fh.write(gzip.compress(out, compresslevel=9, mtime=0))
note = {"derived_from": src, "change": "offshore OUTSIDE terrain nodes -> SEA (flood from SEA, west of coast fit − 60 m)",
        "nodes_changed": flip, "tool": "swarm/maritime/tools/fix_sample_sea.py"}
json.dump(note, open(os.path.join(dst, "DEMO_DATA_NOTE.json"), "w"), indent=1)
print("nodes OUTSIDE -> SEA:", flip)
