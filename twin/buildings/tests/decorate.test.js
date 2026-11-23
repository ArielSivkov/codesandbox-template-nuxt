'use strict';
// decorateMesh על גאומטריה מדומה בפורמט של מנוע גדוד 6 (קירות = 4 קודקודים רצופים, גג = נורמל מעלה)
const test = require('node:test'), assert = require('node:assert');
globalThis.self = globalThis;
globalThis.ESHBuildings = { typology: require('../src/typology.js'), landmarks: require('../src/landmarks.js') };
require('../src/facades.js');
const F = globalThis.ESHBuildings.facades, TY = globalThis.ESHBuildings.typology;
class BA { constructor(a, n) { this.array = a; this.itemSize = n; this.needsUpdate = false; } }
const THREE = { BufferAttribute: BA };

function fakeTile(blds) { // blds: [{id, rect:[x0,n0,x1,n1], h, f, typ, base}]
  const pos = [], nrm = [], fl = [], own = [], idx = [], tw = [];
  const M = { n: blds.length, ids: [], typ: [], names: [], area: [], f: [], h: [], par: [], base: [], src: [], cen: [], sg: [] };
  blds.forEach((b, k) => {
    const [x0, n0, x1, n1] = b.rect, y0 = b.base - 1, y1 = b.base + b.h, fh = Math.round(b.h / b.f * 10), fb = Math.round(b.base * 10);
    Object.entries({ ids: b.id, typ: b.typ || '', names: '', area: (x1 - x0) * (n1 - n0), f: b.f, h: b.h, par: 0, base: b.base, src: 'R', sg: 2 }).forEach(([key, v]) => M[key].push(v));
    M.cen.push((x0 + x1) / 2, (n0 + n1) / 2);
    const V = (x, y, n, nx, ny, nn, f2) => { pos.push(x, y, -n); nrm.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(-nn * 127)); fl.push(f2 ? fb : 0, f2 ? fh : 0); own.push(k); return own.length - 1; };
    const r = [[x0, n0], [x1, n0], [x1, n1], [x0, n1]];
    const a = r.map(p => V(p[0], y1, p[1], 0, 1, 0, false)); idx.push(a[0], a[1], a[2], a[0], a[2], a[3]); tw.push(k, k);
    for (let i = 0; i < 4; i++) { const p = r[i], q = r[(i + 1) % 4]; let nx = q[1] - p[1], nn = -(q[0] - p[0]); const L = Math.hypot(nx, nn); nx /= L; nn /= L;
      const v0 = V(p[0], y0, p[1], nx, 0, nn, true), v1 = V(q[0], y0, q[1], nx, 0, nn, true), v2 = V(q[0], y1, q[1], nx, 0, nn, true), v3 = V(p[0], y1, p[1], nx, 0, nn, true);
      idx.push(v0, v1, v2, v0, v2, v3); tw.push(k, k); }
  });
  const g = { attributes: { position: new BA(new Float32Array(pos), 3), normal: new BA(new Int8Array(nrm), 3), afl: new BA(new Int16Array(fl), 2) }, index: { array: new Uint32Array(idx) },
    setAttribute(n, a) { this.attributes[n] = a; }, computeBoundingSphere() {} };
  return { geometry: g, position: { x: 0, z: 0 }, userData: { t: { meta: M, box: { max: { y: 100 } }, tx: 0, ty: 0 }, own: new Uint16Array(own), towner: new Uint16Array(tw), nib: idx.length } };
}

test('decorateMesh: u ו-L לכל קיר, וספירת החלונות לפי אותה נוסחה כמו השיידר', () => {
  const m = fakeTile([{ id: 'w1', rect: [0, 0, 30, 12], h: 12, f: 4, base: 2 }, { id: 'w2', rect: [50, 0, 125, 12], h: 12, f: 4, base: 2 }]);
  const info = F.decorateMesh(THREE, m);
  const afc = m.geometry.attributes.afc.array, own = m.userData.own;
  assert.equal(info[0].code, TY.T.WALKUP); assert.equal(info[1].code, TY.T.RAKEVET, 'בלוק 75×12 = בניין רכבת');
  // קודקודי קיר: v0/v3 u=0, v1/v2 u=L; אורכים 30,12,30,12 (בדצ"מ)
  const lens = []; for (let v = 4; v < 20; v += 4) { assert.equal(afc[v * 4], 0); assert.equal(afc[(v + 1) * 4], afc[(v + 1) * 4 + 1]); lens.push(afc[v * 4 + 1] / 10); }
  assert.deepEqual(lens, [30, 12, 30, 12]);
  // ספירת חלונות "מהשיידר" – משחזרים את החישוב בשיידר מ-afc ומשווים ל-facadeLayout
  let shaderWin = 0; const u0 = TY.unpack(afc[4 * 4 + 2]); const P = TY.FACADE[u0.code];
  for (const L of lens) { const nb = L < 2 ? 0 : Math.max(1, Math.floor(L / P.bay + 0.5)); shaderWin += nb * (u0.floors - (u0.pil || u0.shop ? 1 : 0)); }
  const jsWin = lens.reduce((s, L) => s + TY.facadeLayout(L, 4, u0.code, info[0].flags).windows, 0);
  assert.equal(shaderWin, jsWin); assert.equal(jsWin, (10 + 4 + 10 + 4) * (4 - (info[0].flags.pil ? 1 : 0)));
  // כל קודקודי הבניין נושאים את אותו קוד וזרע
  for (let v = 0; v < own.length; v++) assert.equal(afc[v * 4 + 3], info[own[v]].seed);
});

test('ציון דרך: גובה מצוטט מתקן את הגאומטריה ואת המטא פעם אחת בלבד', () => {
  const m = fakeTile([{ id: 'w358974561', rect: [0, 0, 30, 25], h: 60, f: 20, base: 3 }]);
  F.decorateMesh(THREE, m);
  const pos = m.geometry.attributes.position.array; let top = 0; for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
  assert.ok(Math.abs(top - (3 + 142)) < 0.01, 'top ' + top);
  assert.equal(m.userData.t.meta.h[0], 142); assert.equal(m.userData.t.meta.f[0], 40);
  assert.equal(m.userData.esh.info[0].code, TY.T.LANDMARK);
  // רמת פירוט חדשה של אותו אריח (גאומטריה בגובה הישן מה-Worker, מטא כבר מתוקן) → מתוקנת שוב נכון
  const m2 = fakeTile([{ id: 'w358974561', rect: [0, 0, 30, 25], h: 60, f: 20, base: 3 }]); m2.userData.t = m.userData.t;
  F.decorateMesh(THREE, m2); const p2 = m2.geometry.attributes.position.array; let t2 = 0; for (let i = 1; i < p2.length; i += 3) t2 = Math.max(t2, p2[i]);
  assert.ok(Math.abs(t2 - 145) < 0.01, 't2 ' + t2); assert.equal(m.userData.t.meta.h[0], 142);
});

test('ציוד גג: דודי שמש בתוך הגג, בלי חפיפות, לפי חוק 27 מ\'', () => {
  const m = fakeTile([{ id: 'w9', rect: [0, 0, 40, 14], h: 12, f: 4, base: 0 }]);
  const info = F.decorateMesh(THREE, m); const p = F.roofProps(m, 0, info[0]);
  const kit = TY.roofKit(info[0].code, 4, 560, 12, info[0].seed);
  assert.ok(p.solar.length / 4 > 0 && p.solar.length / 4 <= kit.solar);
  for (let i = 0; i < p.solar.length; i += 4) { const x = p.solar[i], n = -p.solar[i + 2]; assert.ok(x > 0 && x < 40 && n > 0 && n < 14); assert.equal(p.solar[i + 1], 12); }
  const all = []; for (const k of ['solar', 'tank', 'ac', 'stair']) for (let i = 0; i < p[k].length; i += 4) all.push([p[k][i], p[k][i + 2]]);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(Math.hypot(all[i][0] - all[j][0], all[i][1] - all[j][1]) > 0.5);
});
