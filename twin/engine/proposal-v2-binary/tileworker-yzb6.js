/* לוח היזם · גדוד 6 · Web Worker: טעינה, פריסת gzip, פענוח אריחי YZT1 ובניית גאומטריה ממוזגת לאריח.
   רץ ב-Worker; אם אין Worker (למשל file://) אותו קוד רץ בחוט הראשי דרך window.YZWorkerLocal.
   כל הקואורדינטות שיוצאות מכאן הן מטרים יחסית לפינה הדרומית-מערבית של האריח: x = מזרח, y = מעלה, z = −צפון. */
(function (G) {
'use strict';
let CFG = { base: 'data/', tile: 1000, q: 10, tstep: 25, tn: 41, gz: true };
let MEAS = {};              // osmId → קומות (מדידה ידנית/AI), מגיע מהחוט הראשי
let ROOF_DEMO = false;
const cache = new Map();    // key.lvl → אריח מפוענח (LRU)
const CACHE_MAX = 48;
const PARAPET = 1.05;       // מ' — מעקה גג (ת"י 1142: לפחות 105 ס"מ)
const PITCH = Math.tan(30 * Math.PI / 180);

async function fetchBin(url) {
  if (CFG.gz && typeof DecompressionStream !== 'undefined') {
    const r = await fetch(url + '.gz');
    if (r.ok) return await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return await r.arrayBuffer();
}
function parseContainer(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'YZT1') throw new Error('bad magic ' + magic);
  const n = dv.getUint32(16, true), s = {};
  for (let i = 0; i < n; i++) {
    const o = 20 + 12 * i, fc = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    s[fc] = { off: dv.getUint32(o + 4, true), len: dv.getUint32(o + 8, true) };
  }
  return { buf, s, tx: dv.getInt32(8, true), ty: dv.getInt32(12, true) };
}
const al4 = x => (x + 3) & ~3;

function decodeLo(c) {
  const { buf, s } = c, out = { n: 0 };
  if (s.BLDG) {
    const o = s.BLDG.off, n = (s.BLDG.len) / 22 | 0; // 4+4+2+2+2+4+1+1+1+1 = 22 בתים לבניין
    // גודל מדויק: אורך המקטע מרופד ל-4, לכן מחשבים n מתוך LOD0
    const nn = s.LOD0 ? countLod(c) : n;
    let p = o; const take = (T, k, sz) => { const a = new T(buf.slice(p, p + k * sz)); p += k * sz; return a; };
    const idd = take(Uint32Array, nn, 4), area = take(Uint32Array, nn, 4), base = take(Int16Array, nn, 2), h = take(Uint16Array, nn, 2), sg = take(Uint16Array, nn, 2), cen = take(Int16Array, nn * 2, 2);
    const typ = take(Uint8Array, nn, 1), fl = take(Uint8Array, nn, 1), roof = take(Uint8Array, nn, 1), hsrc = take(Uint8Array, nn, 1);
    const ids = new Float64Array(nn); let acc = 0; for (let i = 0; i < nn; i++) { acc += idd[i]; ids[i] = acc; }
    Object.assign(out, { n: nn, ids, area, base, h, sg, cen, typ, fl, roof, hsrc });
    // LOD0
    let q = s.LOD0.off; const ln = new Uint8Array(buf, q, nn); q += al4(nn);
    let tv = 0; for (let i = 0; i < nn; i++) tv += ln[i];
    const lv = new Int16Array(buf.slice(q, q + tv * 4)); q += al4(tv * 4);
    let tt = 0; for (let i = 0; i < nn; i++) tt += ln[i] - 2;
    const lt = new Uint8Array(buf.slice(q, q + tt * 3));
    out.lo = { n: new Uint8Array(ln), v: lv, t: lt };
    if (s.NAME) out.names = new TextDecoder().decode(new Uint8Array(buf, s.NAME.off, s.NAME.len)).replace(/\0+$/, '').split('\0'); else out.names = null;
  }
  { // שטח
    const N = CFG.tn, o = s.TERR.off, d = new Int16Array(buf, o, N * N), hgt = new Float32Array(N * N);
    for (let r = 0; r < N; r++) { let a = 0; for (let c = 0; c < N; c++) { a += d[r * N + c]; hgt[r * N + c] = a / CFG.q; } }
    out.terr = hgt; out.fade = new Uint8Array(buf.slice(o + N * N * 2, o + N * N * 3));
  }
  if (s.SEA_) { const o = s.SEA_.off, dv = new DataView(buf), nv = dv.getUint32(o, true), ni = dv.getUint32(o + 4, true);
    out.sea = { v: new Int16Array(buf.slice(o + 8, o + 8 + nv * 4)), i: new Uint16Array(buf.slice(o + 8 + nv * 4, o + 8 + nv * 4 + ni * 2)) }; }
  if (s.ROAD) out.roads = decodeRoads(buf, s.ROAD.off);
  if (s.HEAT) out.heat = new Uint16Array(buf.slice(s.HEAT.off, s.HEAT.off + 200));
  return out;
}
function countLod(c) { // n = מספר הבניינים: גודל BLDG = 22n מרופד; פותרים מתוך האורך
  const L = c.s.BLDG.len; for (let n = Math.floor(L / 22); n >= 0; n--) if (al4(22 * n) === L) return n; return 0;
}
function decodeRoads(buf, o) {
  const dv = new DataView(buf), n = dv.getUint32(o, true); let p = o + 4;
  const cls = new Uint8Array(buf.slice(p, p + n)); p += al4(n);
  const nm = new Int16Array(buf.slice(p, p + 2 * n)); p += al4(2 * n);
  const np = new Uint16Array(buf.slice(p, p + 2 * n)); p += al4(2 * n);
  let tot = 0; for (let i = 0; i < n; i++) tot += np[i];
  const co = new Int16Array(buf.slice(p, p + tot * 4));
  return { n, cls, nm, np, co };
}
function decodeHi(c) {
  const { buf, s } = c, out = {};
  if (s.RING) {
    const dv = new DataView(buf); let p = s.RING.off; const nd = dv.getUint32(p, true); p += 4;
    const idx = new Uint16Array(buf.slice(p, p + 2 * nd)); p += al4(2 * nd);
    const nr = new Uint16Array(buf.slice(p, p + 2 * nd)); p += al4(2 * nd);
    let tr = 0; for (let i = 0; i < nd; i++) tr += nr[i];
    const rl = new Uint16Array(buf.slice(p, p + 2 * tr));
    let tv = 0; for (let i = 0; i < tr; i++) tv += rl[i];
    const v = new Int16Array(buf.slice(s.VERT.off, s.VERT.off + tv * 4));
    let q = s.TRI_.off; const tc = new Uint16Array(buf.slice(q, q + 2 * nd)); q += al4(2 * nd);
    let tt = 0; for (let i = 0; i < nd; i++) tt += tc[i];
    const t = new Uint16Array(buf.slice(q, q + tt * 6));
    out.det = { nd, idx, nr, rl, v, tc, t };
  }
  if (s.ROAD) out.roads = decodeRoads(buf, s.ROAD.off);
  return out;
}
async function getTile(key, lvl) {
  const ck = key + '.' + lvl;
  if (cache.has(ck)) { const v = cache.get(ck); cache.delete(ck); cache.set(ck, v); return v; }
  const buf = await fetchBin(CFG.base + 't/' + key + '.' + lvl + '.bin');
  const c = parseContainer(buf), d = lvl === 'lo' ? decodeLo(c) : decodeHi(c);
  d.bytes = buf.byteLength;
  cache.set(ck, d); while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return d;
}

// ---------- גאומטריה של בניינים ----------
// מחזיר לכל בניין: טבעות (מערכי [x,n] במטרים מקומיים) + משולשי גג (אינדקסים לקודקודי הטבעות)
function buildingShapes(lo, hi, full) {
  const n = lo.n, Q = CFG.q, shapes = new Array(n);
  let p = 0, pt = 0;
  for (let k = 0; k < n; k++) {
    const m = lo.lo.n[k], r = new Float32Array(m * 2); let x = 0, y = 0;
    for (let i = 0; i < m; i++) { x += lo.lo.v[(p + i) * 2]; y += lo.lo.v[(p + i) * 2 + 1]; r[i * 2] = x / Q; r[i * 2 + 1] = y / Q; }
    const t = lo.lo.t.subarray(pt, pt + (m - 2) * 3);
    shapes[k] = { rings: [r], tri: t, lod0: true }; p += m; pt += (m - 2) * 3;
  }
  if (full && hi && hi.det) {
    const d = hi.det; let rp = 0, vp = 0, tp = 0;
    for (let j = 0; j < d.nd; j++) {
      const k = d.idx[j], rings = [];
      for (let r = 0; r < d.nr[j]; r++) {
        const m = d.rl[rp++], a = new Float32Array(m * 2); let x = 0, y = 0;
        for (let i = 0; i < m; i++) { x += d.v[(vp + i) * 2]; y += d.v[(vp + i) * 2 + 1]; a[i * 2] = x / Q; a[i * 2 + 1] = y / Q; }
        vp += m; rings.push(a);
      }
      const t = d.t.subarray(tp, tp + d.tc[j] * 3); tp += d.tc[j] * 3;
      shapes[k] = { rings, tri: t, lod0: false };
    }
  }
  return shapes;
}
function heightFor(lo, k) { // [גובה מ', קומות, σ מ', מקור]
  const id = lo.ids[k], m = MEAS[id];
  if (m && m.floors) return [m.floors * 3, m.floors, Math.max(1, m.floors * 0.3), m.source === 'ai' ? 'ai' : 'manual'];
  return [lo.h[k] / CFG.q, lo.fl[k], lo.sg[k] / CFG.q, 'est'];
}

class Buf { // מערכים גדלים
  constructor(nv) { this.pos = new Float32Array(nv * 3); this.nrm = new Int8Array(nv * 3); this.own = new Uint16Array(nv); this.sh = new Uint8Array(nv); this.fl = new Int16Array(nv * 2); this.v = 0; this.idx = []; this.towner = []; }
  grow(n) { if (this.v + n <= this.own.length) return; const N = Math.max(this.own.length * 2, this.v + n);
    const g = (A, k) => { const b = new A.constructor(N * k); b.set(A); return b; };
    this.pos = g(this.pos, 3); this.nrm = g(this.nrm, 3); this.own = g(this.own, 1); this.sh = g(this.sh, 1); this.fl = g(this.fl, 2); }
  vert(x, y, n, nx, ny, nz, own, sh, fb, fh) { this.grow(1); const v = this.v++, i = v * 3;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = -n;
    this.nrm[i] = Math.round(nx * 127); this.nrm[i + 1] = Math.round(ny * 127); this.nrm[i + 2] = Math.round(-nz * 127);
    this.own[v] = own; this.sh[v] = sh; this.fl[v * 2] = fb; this.fl[v * 2 + 1] = fh; return v; }
  tri(a, b, c, own) { this.idx.push(a, b, c); this.towner.push(own); }
}
// קיר בין שתי נקודות (a→b), נורמל חיצוני (dy, −dx) בטבעת נגד כיוון השעון; גוון: תחתית כהה (AO זול)
function wall(B, ax, an, bx, bn, y0, y1, own, fb, fh, shBot = 185, shTop = 255, flip = false) {
  let nx = bn - an, nn = -(bx - ax); const L = Math.hypot(nx, nn) || 1; nx /= L; nn /= L; if (flip) { nx = -nx; nn = -nn; }
  const v0 = B.vert(ax, y0, an, nx, 0, nn, own, shBot, fb, fh), v1 = B.vert(bx, y0, bn, nx, 0, nn, own, shBot, fb, fh),
        v2 = B.vert(bx, y1, bn, nx, 0, nn, own, shTop, fb, fh), v3 = B.vert(ax, y1, an, nx, 0, nn, own, shTop, fb, fh);
  B.tri(v0, v1, v2, own); B.tri(v0, v2, v3, own);
}
function face(B, pts, own, sh) { // מצולע קמור משופע (גג רעפים), נורמל מחושב
  const [a, b, c] = pts; const ux = b[0] - a[0], uy = b[1] - a[1], un = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vn = c[2] - a[2];
  let nx = uy * vn - un * vy, ny = un * vx - ux * vn, nn = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nn) || 1; nx /= L; ny /= L; nn /= L;
  if (ny < 0) { nx = -nx; ny = -ny; nn = -nn; }
  const vs = pts.map(p => B.vert(p[0], p[1], p[2], nx, ny, nn, own, sh, 0, 0));
  for (let i = 1; i + 1 < vs.length; i++) B.tri(vs[0], vs[i], vs[i + 1], own);
}
function pitched(B, r, y0, y1, kind, own, fb, fh) { // r: 4 פינות; kind 2 = גמלון, 3 = ארבע־שיפועים
  let P = [0, 1, 2, 3].map(i => [r[i * 2], r[i * 2 + 1]]);
  const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d(P[1], P[2]) > d(P[0], P[1])) P = [P[1], P[2], P[3], P[0]];   // P0P1 ו-P2P3 = הצלעות הארוכות
  const hw = d(P[1], P[2]) / 2, rise = hw * PITCH, yr = y1 + rise;
  const m1 = [(P[1][0] + P[2][0]) / 2, (P[1][1] + P[2][1]) / 2], m3 = [(P[3][0] + P[0][0]) / 2, (P[3][1] + P[0][1]) / 2];
  for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; wall(B, a[0], a[1], b[0], b[1], y0, y1, own, fb, fh); }
  let R1 = m1, R3 = m3;
  if (kind === 3) { const L = d(m1, m3), ux = (m1[0] - m3[0]) / L, un = (m1[1] - m3[1]) / L, s = Math.min(hw, L / 2);
    R1 = [m1[0] - ux * s, m1[1] - un * s]; R3 = [m3[0] + ux * s, m3[1] + un * s]; }
  const q = (p, y) => [p[0], y, p[1]];
  face(B, [q(P[0], y1), q(P[1], y1), q(R1, yr), q(R3, yr)], own, 235);
  face(B, [q(P[2], y1), q(P[3], y1), q(R3, yr), q(R1, yr)], own, 235);
  const sh = kind === 3 ? 235 : 255;
  face(B, [q(P[1], y1), q(P[2], y1), q(R1, yr)], own, sh);
  face(B, [q(P[3], y1), q(P[0], y1), q(R3, yr)], own, sh);
  return rise;
}
function isConvexQuad(r) { if (r.length !== 8) return false; let s = 0;
  for (let i = 0; i < 4; i++) { const a = i * 2, b = ((i + 1) % 4) * 2, c = ((i + 2) % 4) * 2; const cr = (r[b] - r[a]) * (r[c + 1] - r[b + 1]) - (r[b + 1] - r[a + 1]) * (r[c] - r[b]); if (cr <= 0) return false; }
  return true; }

const LOWT = new Set(['house', 'detached', 'semidetached_house', 'bungalow']);
function buildBuildings(lo, hi, lod, types) {
  const full = lod >= 1, shapes = buildingShapes(lo, hi, full), n = lo.n;
  const B = new Buf(n * 24);
  for (let k = 0; k < n; k++) {
    const S = shapes[k], [h, f, , src] = heightFor(lo, k), base = lo.base[k] / CFG.q;
    const y0 = base - 1.0, y1 = base + h, fb = Math.round(base * CFG.q), fh = f > 0 ? Math.round(h / f * CFG.q) : 0;
    let roof = lo.roof[k];
    if (ROOF_DEMO && roof === 0 && LOWT.has(types[lo.typ[k]])) roof = (k % 2) ? 3 : 2;   // הדגמה בלבד (?roofs=demo)
    if ((roof === 2 || roof === 3) && lod >= 1 && S.rings.length === 1 && isConvexQuad(S.rings[0])) { pitched(B, S.rings[0], y0, y1, roof, k, fb, fh); continue; }
    const par = lod === 2 && roof === 0 && h >= 5;
    const yTop = par ? y1 + PARAPET : y1;
    // גג
    const v0 = B.v;
    for (const r of S.rings) for (let i = 0; i < r.length; i += 2) B.vert(r[i], y1, r[i + 1], 0, 1, 0, k, par ? 222 : 240, 0, 0);
    for (let i = 0; i < S.tri.length; i += 3) B.tri(v0 + S.tri[i], v0 + S.tri[i + 1], v0 + S.tri[i + 2], k);
    // קירות (+ מעקה)
    for (const r of S.rings) { const m = r.length / 2;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m; wall(B, r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], y0, yTop, k, fb, fh); }
      if (par) { // פנים המעקה (פונה פנימה, מוזח 25 ס"מ) + קופינג
        for (let i = 0; i < m; i++) { const j = (i + 1) % m, ax = r[i * 2], an = r[i * 2 + 1], bx = r[j * 2], bn = r[j * 2 + 1];
          let nx = bn - an, nn = -(bx - ax); const L = Math.hypot(nx, nn) || 1; nx = nx / L * 0.25; nn = nn / L * 0.25;
          wall(B, bx - nx, bn - nn, ax - nx, an - nn, y1, yTop, k, 0, 0, 200, 235, false);
          const c0 = B.vert(ax, yTop, an, 0, 1, 0, k, 255, 0, 0), c1 = B.vert(bx, yTop, bn, 0, 1, 0, k, 255, 0, 0), c2 = B.vert(bx - nx, yTop, bn - nn, 0, 1, 0, k, 255, 0, 0), c3 = B.vert(ax - nx, yTop, an - nn, 0, 1, 0, k, 255, 0, 0);
          B.tri(c0, c1, c2, k); B.tri(c0, c2, c3, k); } }
    }
  }
  return finish(B);
}
function finish(B) {
  const nv = B.v, ni = B.idx.length, idx = nv > 65535 ? new Uint32Array(B.idx) : new Uint16Array(B.idx), pos = B.pos;
  // כיוון משולשים לפי הנורמל (כמו במקור) – כך FrontSide תמיד נכון
  for (let i = 0; i < ni; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    if ((uy * vz - uz * vy) * B.nrm[a] + (uz * vx - ux * vz) * B.nrm[a + 1] + (ux * vy - uy * vx) * B.nrm[a + 2] < 0) { const s = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = s; }
  }
  return { pos: pos.slice(0, nv * 3), nrm: B.nrm.slice(0, nv * 3), own: B.own.slice(0, nv), sh: B.sh.slice(0, nv), fl: B.fl.slice(0, nv * 2), idx, towner: new Uint16Array(B.towner) };
}

// ---------- קרקע + ים (רשת אחת לאריח, צבע לפי קודקוד) ----------
const BG = [0.80, 0.86, 0.90];   // צבע האופק/ערפל – שולי השטח נמוגים אליו
function groundColor(h, f, out, o) {
  let r, g, b;
  if (h < 4) { r = 0.87; g = 0.81; b = 0.66; } else if (h < 15) { r = 0.76; g = 0.74; b = 0.63; } else { r = 0.64 + Math.min(h, 60) / 400; g = 0.67; b = 0.53; }
  const t = f / 255; out[o] = BG[0] + (r - BG[0]) * t; out[o + 1] = BG[1] + (g - BG[1]) * t; out[o + 2] = BG[2] + (b - BG[2]) * t;
}
function buildGround(lo, stride) {
  const N = CFG.tn, S = CFG.tstep, H = lo.terr, F = lo.fade, m = Math.floor((N - 1) / stride) + 1;
  const at = (r, c) => H[r * N + c];
  // קודקודי רשת + חצאית (skirt) בשוליים למניעת סדקים בין רמות פירוט
  const nv = m * m + 4 * m * 2, pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), col = new Uint8Array(nv * 3), idx = [];
  const tmp = [0, 0, 0];
  let v = 0; const id = new Int32Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
    const r = Math.min(i * stride, N - 1), c = Math.min(j * stride, N - 1), h = at(r, c);
    const hx = at(r, Math.min(c + 1, N - 1)) - at(r, Math.max(c - 1, 0)), hz = at(Math.min(r + 1, N - 1), c) - at(Math.max(r - 1, 0), c);
    let nx = -hx / (2 * S), nn = -hz / (2 * S); const L = Math.hypot(nx, 1, nn);
    pos[v * 3] = c * S; pos[v * 3 + 1] = h; pos[v * 3 + 2] = -r * S;
    nrm[v * 3] = Math.round(nx / L * 127); nrm[v * 3 + 1] = Math.round(127 / L); nrm[v * 3 + 2] = Math.round(-nn / L * 127);
    groundColor(h, F[r * N + c], tmp, 0); col[v * 3] = tmp[0] * 255; col[v * 3 + 1] = tmp[1] * 255; col[v * 3 + 2] = tmp[2] * 255;
    id[i * m + j] = v++;
  }
  const fadeAt = (i, j) => F[Math.min(i * stride, N - 1) * N + Math.min(j * stride, N - 1)];
  const hAt = (i, j) => at(Math.min(i * stride, N - 1), Math.min(j * stride, N - 1));
  for (let i = 0; i + 1 < m; i++) for (let j = 0; j + 1 < m; j++) {
    const f = fadeAt(i, j) + fadeAt(i + 1, j) + fadeAt(i, j + 1) + fadeAt(i + 1, j + 1);
    const sea = hAt(i, j) < 0 && hAt(i + 1, j) < 0 && hAt(i, j + 1) < 0 && hAt(i + 1, j + 1) < 0;
    if (f === 0 || sea) continue;
    const a = id[i * m + j], b = id[i * m + j + 1], c = id[(i + 1) * m + j], d = id[(i + 1) * m + j + 1];
    idx.push(a, b, d, a, d, c);
  }
  // חצאית: קודקוד כפול 6 מ' מתחת לשוליים
  const skirt = (list) => { for (let k = 0; k + 1 < list.length; k++) { const [i0, j0] = list[k], [i1, j1] = list[k + 1];
    if (fadeAt(i0, j0) + fadeAt(i1, j1) === 0) continue;
    const a = id[i0 * m + j0], b = id[i1 * m + j1], a2 = v, b2 = v + 1;
    for (const [src, dst] of [[a, a2], [b, b2]]) { pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - 6; pos[dst * 3 + 2] = pos[src * 3 + 2]; nrm.set(nrm.subarray(src * 3, src * 3 + 3), dst * 3); col.set(col.subarray(src * 3, src * 3 + 3), dst * 3); }
    v += 2; idx.push(a, a2, b2, a, b2, b, a, b2, a2, a, b, b2); } };
  const e = []; for (let j = 0; j < m; j++) e.push([0, j]); skirt(e);
  const e2 = []; for (let j = 0; j < m; j++) e2.push([m - 1, j]); skirt(e2);
  const e3 = []; for (let i = 0; i < m; i++) e3.push([i, 0]); skirt(e3);
  const e4 = []; for (let i = 0; i < m; i++) e4.push([i, m - 1]); skirt(e4);
  // ים וקטורי (y = 0)
  if (lo.sea) {
    const sv = lo.sea.v, base = v, need = v + sv.length / 2;
    const P = new Float32Array(need * 3), Nn = new Int8Array(need * 3), C = new Uint8Array(need * 3);
    P.set(pos.subarray(0, v * 3)); Nn.set(nrm.subarray(0, v * 3)); C.set(col.subarray(0, v * 3));
    for (let i = 0; i < sv.length / 2; i++) { P[v * 3] = sv[i * 2] / CFG.q; P[v * 3 + 1] = 0; P[v * 3 + 2] = -sv[i * 2 + 1] / CFG.q; Nn[v * 3 + 1] = 127; C[v * 3] = 0.19 * 255; C[v * 3 + 1] = 0.44 * 255; C[v * 3 + 2] = 0.60 * 255; v++; }
    for (let i = 0; i < lo.sea.i.length; i += 3) { // כיוון: הנורמל הגאומטרי חייב לפנות למעלה (אחרת המשולש נחתך ב-FrontSide)
      const a = base + lo.sea.i[i], b = base + lo.sea.i[i + 1], c = base + lo.sea.i[i + 2];
      const ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2];
      if (uz * vx - ux * vz > 0) idx.push(a, b, c); else idx.push(a, c, b); }
    return { pos: P, nrm: Nn, col: C, idx: v > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), nv: v, uvScale: CFG.tile };
  }
  return { pos: pos.slice(0, v * 3), nrm: nrm.slice(0, v * 3), col: col.slice(0, v * 3), idx: v > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), nv: v };
}
function terrH(lo, x, n) { // דגימה בילינארית של שטח האריח (מ')
  const N = CFG.tn, S = CFG.tstep, c = Math.min(Math.max(x / S, 0), N - 1.001), r = Math.min(Math.max(n / S, 0), N - 1.001), i = r | 0, j = c | 0, a = r - i, b = c - j, H = lo.terr;
  return Math.max(0, H[i * N + j] * (1 - a) * (1 - b) + H[i * N + j + 1] * (1 - a) * b + H[(i + 1) * N + j] * a * (1 - b) + H[(i + 1) * N + j + 1] * a * b);
}
const RC = { 5: [245, 158, 77], 4: [250, 204, 115], 3: [255, 255, 255], 2: [250, 250, 245], 1: [217, 217, 217] };
function buildRoads(lo, sets) {
  let ns = 0; for (const R of sets) for (let i = 0; i < R.n; i++) ns += R.np[i] - 1;
  const pos = new Float32Array(ns * 6), col = new Uint8Array(ns * 6); let s = 0;
  for (const R of sets) { let p = 0;
    for (let i = 0; i < R.n; i++) { let x = 0, y = 0, px = 0, py = 0; const c = RC[R.cls[i]] || RC[1];
      for (let k = 0; k < R.np[i]; k++) { x += R.co[(p + k) * 2]; y += R.co[(p + k) * 2 + 1];
        if (k) { const a = s * 6; pos.set([px / 10, terrH(lo, px / 10, py / 10) + 0.8, -py / 10, x / 10, terrH(lo, x / 10, y / 10) + 0.8, -y / 10], a); col.set(c, a); col.set(c, a + 3); s++; }
        px = x; py = y; }
      p += R.np[i]; } }
  return { pos, col };
}
function streetSegs(lo, R, ni, out, ox, on) {
  let p = 0;
  for (let i = 0; i < R.n; i++) { let x = 0, y = 0, px = 0, py = 0;
    for (let k = 0; k < R.np[i]; k++) { x += R.co[(p + k) * 2]; y += R.co[(p + k) * 2 + 1];
      if (k && R.nm[i] === ni) out.push(ox + px / 10, on + py / 10, terrH(lo, px / 10, py / 10), ox + x / 10, on + y / 10, terrH(lo, x / 10, y / 10)); px = x; py = y; }
    p += R.np[i]; }
}

async function handle(m) {
  if (m.type === 'init') { Object.assign(CFG, m.cfg); return { ok: true }; }
  if (m.type === 'meas') { MEAS = m.meas || {}; return { ok: true }; }
  if (m.type === 'roofdemo') { ROOF_DEMO = !!m.on; return { ok: true }; }
  if (m.type === 'build') {
    const t0 = performance.now();
    const lo = await getTile(m.key, 'lo'), hi = m.lod >= 1 && m.hasHi ? await getTile(m.key, 'hi') : null;
    const res = { key: m.key, lod: m.lod, bytes: lo.bytes + (hi && hi.bytes || 0) };
    const tr = [];
    if (m.wantMeta && lo.n) {
      res.meta = { n: lo.n, ids: lo.ids, area: lo.area, base: lo.base, h: lo.h, sg: lo.sg, cen: lo.cen, typ: lo.typ, fl: lo.fl, roof: lo.roof, hsrc: lo.hsrc, names: lo.names, heat: lo.heat || null, terr: lo.terr.slice() };
    } else if (m.wantMeta) res.meta = { n: 0, heat: lo.heat || null, terr: lo.terr.slice() };
    // בניינים + קרקע + ים בגאומטריה אחת → קריאת ציור אחת לאריח (אותו חומר; לקרקע afl = 0 ולכן אין קווי קומות)
    const b = lo.n ? buildBuildings(lo, hi, m.lod, m.types) : null;
    const g = buildGround(lo, m.lod === 2 ? 1 : m.lod === 1 ? 2 : 4);
    const nb = b ? b.own.length : 0, ng = g.pos.length / 3, nv = nb + ng, nib = b ? b.idx.length : 0, ni = nib + g.idx.length;
    if (ni) {
      const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), fl = new Int16Array(nv * 2), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), towner = new Uint16Array(ni / 3);
      if (b) { pos.set(b.pos); nrm.set(b.nrm); fl.set(b.fl); idx.set(b.idx); towner.set(b.towner); }
      pos.set(g.pos, nb * 3); nrm.set(g.nrm, nb * 3);
      for (let i = 0; i < g.idx.length; i++) idx[nib + i] = g.idx[i] + nb;
      towner.fill(65535, nib / 3);
      res.m = { pos, nrm, fl, idx, towner, own: b ? b.own : new Uint16Array(0), sh: b ? b.sh : new Uint8Array(0), gcol: g.col, nb, nib };
      tr.push(pos.buffer, nrm.buffer, fl.buffer, idx.buffer, towner.buffer, res.m.own.buffer, res.m.sh.buffer, g.col.buffer);
    }
    const sets = []; if (lo.roads) sets.push(lo.roads); if (hi && hi.roads) sets.push(hi.roads);
    if (sets.length) { const r = buildRoads(lo, sets); res.r = r; tr.push(r.pos.buffer, r.col.buffer); }
    res.ms = performance.now() - t0;
    return [res, tr];
  }
  if (m.type === 'geom') { // טבעות מדויקות של בניין אחד (לכרטיס ולמדידות)
    const lo = await getTile(m.key, 'lo'), hi = await getTile(m.key, 'hi').catch(() => null);
    const S = buildingShapes(lo, hi, true)[m.k];
    return { key: m.key, k: m.k, rings: S.rings.map(r => Array.from(r)) };
  }
  if (m.type === 'street') { // מקטעי רחוב מכל האריחים שבמטמון
    const out = [];
    for (const [ck, d] of cache) { const [key, lvl] = ck.split('.'); const lo = lvl === 'lo' ? d : cache.get(key + '.lo'); if (!lo || !d.roads) continue;
      const [tx, ty] = key.split('_').map(Number); streetSegs(lo, d.roads, m.ni, out, tx * CFG.tile, ty * CFG.tile); }
    return { segs: out };
  }
}
const api = { handle };
if (typeof document === 'undefined') {
  self.onmessage = async e => { const m = e.data; try { const r = await handle(m); if (Array.isArray(r)) self.postMessage({ id: m.id, res: r[0] }, r[1]); else self.postMessage({ id: m.id, res: r }); }
    catch (err) { self.postMessage({ id: m.id, err: String(err && err.message || err) }); } };
} else G.YZWorkerLocal = api;
})(typeof self !== 'undefined' ? self : window);
