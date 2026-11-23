// סטטיסטיקת טיפולוגיה על אריחי הדגימה של אשדוד: node tools/typology_stats.js [data/tiles/v]
'use strict';
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const TY = require('../src/typology.js');
const dir = process.argv[2] || '/home/claude/swarm/b6/map/data/tiles/v';
const cnt = {}, basis = {}, byCodeBasis = {}; let n = 0, windows = 0, solar = 0;
for (const f of fs.readdirSync(dir)) {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))));
  for (const b of d.b) {
    const r = b.r[0], pts = []; let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; pts.push([x / 10, y / 10]); }
    const segs = pts.map((p, i) => [...p, ...pts[(i + 1) % pts.length]]), dims = TY.footprintDims(segs);
    const c = TY.classify({ typ: b.t, name: b.n, area: b.a, floors: b.f, h: b.h / 10, len: dims.len, wid: dims.wid, floorsSrc: b.src });
    n++; cnt[c.code] = (cnt[c.code] || 0) + 1; basis[c.basis] = (basis[c.basis] || 0) + 1; const k = c.code + ':' + c.basis; byCodeBasis[k] = (byCodeBasis[k] || 0) + 1;
    const seed = TY.seedOf(b.i), fl = TY.facadeFlags(c.code, seed); for (const s of segs) windows += TY.facadeLayout(Math.hypot(s[2] - s[0], s[3] - s[1]), b.f, c.code, fl).windows;
    solar += TY.roofKit(c.code, b.f, b.a, b.h / 10, seed).solar;
  }
}
const out = { buildings: n, byCode: Object.fromEntries(Object.entries(cnt).map(([k, v]) => [TY.T_HE[k], v])), byBasis: basis, byCodeBasis, windows, solarHeaters: solar };
console.log(JSON.stringify(out, null, 1));
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
