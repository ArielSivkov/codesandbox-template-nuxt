/* מעבדת WebGPU: עותק של tileworker.js של גדוד 6 (b6/map/js) – שינוי יחיד: Worker מסוג module שמייבא earcut מ-three.core.js r187 במקום importScripts.
   לוח היזם · גדוד 6 · Web Worker: טוען אריחים בפורמט של גדוד 5 ובונה גאומטריה ממוזגת לאריח.
   פורמט (גדוד 5, yazam/tiles.py):  tiles/v/<tx>_<ty>.json.gz  – בניינים, כבישים, פוליגוני ים (דלתא בדצימטרים, ITM)
                                     tiles/t/<tx>_<ty>.bin.gz   – כותרת YZT1 (20 בתים) + 41×41 Int16 dm (שורה 0 = צפון) + מסכת יבשה 100×100 ביטים
   אם אין Worker (למשל file://) אותו קוד רץ בחוט הראשי דרך window.YZWorkerLocal.
   כל הקואורדינטות שיוצאות מכאן: מטרים יחסית לפינה הדרומית-מערבית של האריח; x = מזרח, y = מעלה, z = −צפון. */
import { ShapeUtils, Vector2 } from '../vendor/three/three.core.js';
const __T = { ShapeUtils, Vector2 };
(function (G) {
'use strict';
const IN_WORKER = typeof document === 'undefined';
if (IN_WORKER) { self.THREE = __T; } else if (!G.THREE) G.THREE = __T;   // רק בשביל earcut (THREE.ShapeUtils); הקובץ כבר במטמון הדפדפן
const earcut = (contour, holes) => (G.THREE || self.THREE).ShapeUtils.triangulateShape(contour, holes);
let CFG = { base: 'data/', tile: 1000 };
let MEAS = {};               // osmId (בלי קידומת w) → {floors, source}
let ROOF_DEMO = false;
const cache = new Map();     // key → מודל אריח מפוענח (LRU)
const CACHE_MAX = 40;
const PITCH = Math.tan(30 * Math.PI / 180);
const SEA = -32768, OUT = -32767;
const FLOOR_H = 3.0, PAR_B5 = 1.0;   // גדוד 5: h = קומות × 3 + מעקה 1.0 (הנחה לכיול, heights.py)

async function fetchBuf(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  const buf = await r.arrayBuffer(), u8 = new Uint8Array(buf, 0, 2);
  const net = +r.headers.get('content-length') || buf.byteLength;   // בייטים ברשת (דחוסים)
  // השרת עשוי להגיש עם Content-Encoding: gzip (ואז הדפדפן כבר פרס) – בודקים חתימת gzip לפני פריסה
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
    return { buf: await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(), net };
  }
  return { buf, net };
}

// ---------- פענוח לפורמט פנימי ----------
function decodeRing(r, scale) { const a = new Float32Array(r.length); let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; a[i] = x / scale; a[i + 1] = y / scale; } return a; }
function ringArea(r) { let s = 0; const m = r.length / 2; for (let i = 0; i < m; i++) { const j = (i + 1) % m; s += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; } return s / 2; }
function orient(r, ccw) { if ((ringArea(r) > 0) === ccw) return r; const m = r.length / 2, o = new Float32Array(r.length); for (let i = 0; i < m; i++) { o[i * 2] = r[(m - 1 - i) * 2]; o[i * 2 + 1] = r[(m - 1 - i) * 2 + 1]; } return o; }
function dedupe(r) { const out = []; const m = r.length / 2; for (let i = 0; i < m; i++) { const x = r[i * 2], y = r[i * 2 + 1], L = out.length; if (L && Math.abs(out[L - 2] - x) < 0.01 && Math.abs(out[L - 1] - y) < 0.01) continue; out.push(x, y); }
  if (out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) < 0.01 && Math.abs(out[1] - out[out.length - 1]) < 0.01) out.length -= 2; return new Float32Array(out); }
const toV2 = r => { const V = (G.THREE || self.THREE).Vector2, a = []; for (let i = 0; i < r.length; i += 2) a.push(new V(r[i], r[i + 1])); return a; };
function decodeB5(v, t, key) {
  const Q = 10, n = v.b.length, M = { key, n, bytes: 0, hInclPar: true };
  M.ids = new Array(n); M.area = new Float32Array(n); M.base = new Float32Array(n); M.h = new Float32Array(n); M.sg = new Float32Array(n);
  M.f = new Uint8Array(n); M.flo = new Uint8Array(n); M.fhi = new Uint8Array(n); M.conf = new Int8Array(n); M.roof = new Uint8Array(n);
  M.src = new Array(n); M.used = new Array(n); M.typ = new Array(n); M.names = new Array(n); M.cen = new Float32Array(2 * n); M.rings = new Array(n);
  v.b.forEach((b, k) => {
    M.ids[k] = b.i; M.area[k] = b.a; M.base[k] = b.z / Q; M.h[k] = b.h / Q; M.sg[k] = b.s / Q; M.f[k] = b.f; M.flo[k] = b.fl; M.fhi[k] = b.fh; M.conf[k] = b.c == null ? -1 : b.c;
    M.src[k] = b.src || ''; M.used[k] = b.u || ''; M.typ[k] = b.t || ''; M.names[k] = b.n || '';
    M.roof[k] = b.rs === 'gabled' || b.rs === 'gable' ? 2 : b.rs === 'hipped' || b.rs === 'hip' ? 3 : b.t === 'roof' ? 1 : 0;   // rs = roof:shape (הצעה לגדוד 5); אחרת שטוח + מעקה
    const rings = b.r.map((r, i) => orient(dedupe(decodeRing(r, Q)), i === 0)).filter(r => r.length >= 6);
    M.rings[k] = rings; let cx = 0, cy = 0; const o = rings[0], m = o.length / 2; for (let i = 0; i < m; i++) { cx += o[i * 2]; cy += o[i * 2 + 1]; } M.cen[2 * k] = cx / m; M.cen[2 * k + 1] = cy / m;
  });
  M.tri = new Array(n); M.lo = new Array(n);
  // שטח: הופכים לשורה 0 = דרום; ים → −2 מ' (מתחת למצולע הים ב-y=0); מחוץ לתחום → דעיכה 0
  const dv = new DataView(t), N = dv.getUint16(14, true), step = dv.getUint16(18, true), z = new Int16Array(t.slice(20, 20 + N * N * 2));
  M.N = N; M.step = step; M.terr = new Float32Array(N * N); const inside = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = z[(N - 1 - r) * N + c], d = r * N + c;
    if (s === OUT) { M.terr[d] = NaN; inside[d] = 0; } else if (s === SEA) { M.terr[d] = -2; inside[d] = 1; } else { M.terr[d] = Math.max(0.3, s / Q); inside[d] = 1; } }
  for (let it = 0; it < 6; it++) for (let i = 0; i < N * N; i++) if (isNaN(M.terr[i])) { const r = i / N | 0, c = i % N; let s = 0, k = 0;   // מחוץ לתחום: גובה מהשכן
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < N && cc < N && !isNaN(M.terr[rr * N + cc])) { s += M.terr[rr * N + cc]; k++; } } if (k) M.terr[i] = s / k; }
  for (let i = 0; i < N * N; i++) if (isNaN(M.terr[i])) M.terr[i] = 0.3;
  // שוליים רכים: טשטוש מסכת התחום (3 מעברי 3×3 ≈ 75 מ') → הקרקע נמוגה לצבע האופק במקום "לוח" עם קצה חד
  let f = inside; for (let pass = 0; pass < 3; pass++) { const g = new Float32Array(N * N); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { let s = 0, k = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < N && cc < N) { s += f[rr * N + cc]; k++; } } g[r * N + c] = s / k; } f = g; }
  M.fade = new Uint8Array(N * N); for (let i = 0; i < N * N; i++) M.fade[i] = Math.round(Math.max(0, Math.min(1, inside[i] ? f[i] * 1.5 - 0.1 : f[i] - 0.2)) * 255);
  // ים וקטורי (מצולעים חתוכים לאריח) → משולשים
  const sv = [], si = [];
  for (const poly of v.sea || []) { const rings = poly.map((r, i) => orient(dedupe(decodeRing(r, Q)), i === 0)).filter(r => r.length >= 6); if (!rings.length) continue; const base = sv.length / 2;
    const tr = earcut(toV2(rings[0]), rings.slice(1).map(toV2)); for (const r of rings) for (let i = 0; i < r.length; i++) sv.push(r[i]);
    for (const tt of tr) si.push(base + tt[0], base + tt[1], base + tt[2]); }
  M.sea = sv.length ? { v: new Float32Array(sv), i: si } : null;
  M.roads = (v.rd || []).map(r => ({ cls: r.c, name: r.n || '', pts: decodeRing(r.r, Q) }));
  return M;
}
async function getModel(key) {
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const [V, Tt] = await Promise.all([fetchBuf(CFG.base + 'tiles/v/' + key + '.json.gz'), fetchBuf(CFG.base + 'tiles/t/' + key + '.bin.gz')]);
  const M = decodeB5(JSON.parse(new TextDecoder().decode(V.buf)), Tt.buf, key); M.bytes = V.net + Tt.net;
  cache.set(key, M); while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return M;
}
// טביעה מלאה / מפושטת (רמה 0: עד 8 פינות, בלי חצרות – Visvalingam) + משולשי גג (earcut, נשמר במטמון)
function visvalingam(r, maxN) { const a = []; for (let i = 0; i < r.length; i += 2) a.push([r[i], r[i + 1]]);
  while (a.length > maxN) { let bi = 0, ba = Infinity; for (let i = 0; i < a.length; i++) { const p = a[(i + a.length - 1) % a.length], q = a[i], s = a[(i + 1) % a.length];
    const ar = Math.abs((q[0] - p[0]) * (s[1] - p[1]) - (s[0] - p[0]) * (q[1] - p[1])); if (ar < ba) { ba = ar; bi = i; } } a.splice(bi, 1); }
  return new Float32Array(a.flat()); }
function shape(M, k, full) {
  if (full) { if (!M.tri[k]) { const R = M.rings[k]; M.tri[k] = new Uint32Array(earcut(toV2(R[0]), R.slice(1).map(toV2)).flat()); } return { rings: M.rings[k], tri: M.tri[k] }; }
  if (!M.lo[k]) { const o = M.rings[k][0];
    if (o.length <= 16 && M.rings[k].length === 1) M.lo[k] = shape(M, k, true);
    else { const r = orient(visvalingam(o, 8), true); M.lo[k] = { rings: [r], tri: new Uint32Array(earcut(toV2(r), []).flat()) }; } }
  return M.lo[k];
}
function heightFor(M, k) { // {h: גובה עד תקרת הגג (מ'), par: מעקה (מ'), f, sg, src}
  const id = String(M.ids[k]).replace(/^w/, ''), m = MEAS[id];
  if (m && m.floors) return { h: m.floors * FLOOR_H, par: M.roof[k] === 0 ? PAR_B5 : 0, f: m.floors, sg: Math.max(0.5, m.floors * 0.15 + 0.5), src: m.source === 'ai' ? 'ai' : 'manual' };
  const par = M.hInclPar && M.roof[k] === 0 && M.h[k] > 4 ? PAR_B5 : 0;
  return { h: Math.max(2.5, M.h[k] - par), par, f: M.f[k], sg: M.sg[k], src: 'est' };
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
// קיר a→b; נורמל חיצוני (dy, −dx) בטבעת נגד כיוון השעון; תחתית כהה יותר (AO זול בצבע קודקוד)
function wall(B, ax, an, bx, bn, y0, y1, own, fb, fh, shBot = 185, shTop = 255) {
  let nx = bn - an, nn = -(bx - ax); const L = Math.hypot(nx, nn) || 1; nx /= L; nn /= L;
  const v0 = B.vert(ax, y0, an, nx, 0, nn, own, shBot, fb, fh), v1 = B.vert(bx, y0, bn, nx, 0, nn, own, shBot, fb, fh),
        v2 = B.vert(bx, y1, bn, nx, 0, nn, own, shTop, fb, fh), v3 = B.vert(ax, y1, an, nx, 0, nn, own, shTop, fb, fh);
  B.tri(v0, v1, v2, own); B.tri(v0, v2, v3, own);
}
function face(B, pts, own, sh) { // מצולע קמור משופע (גג רעפים)
  const [a, b, c] = pts; const ux = b[0] - a[0], uy = b[1] - a[1], un = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vn = c[2] - a[2];
  let nx = uy * vn - un * vy, ny = un * vx - ux * vn, nn = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nn) || 1; nx /= L; ny /= L; nn /= L;
  if (ny < 0) { nx = -nx; ny = -ny; nn = -nn; }
  const vs = pts.map(p => B.vert(p[0], p[1], p[2], nx, ny, nn, own, sh, 0, 0));
  for (let i = 1; i + 1 < vs.length; i++) B.tri(vs[0], vs[i], vs[i + 1], own);
}
function pitched(B, r, y0, y1, kind, own, fb, fh) { // 4 פינות; kind 2 = גמלון, 3 = ארבעה שיפועים; שיפוע 30°
  let P = [0, 1, 2, 3].map(i => [r[i * 2], r[i * 2 + 1]]);
  const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d(P[1], P[2]) > d(P[0], P[1])) P = [P[1], P[2], P[3], P[0]];
  const hw = d(P[1], P[2]) / 2, yr = y1 + hw * PITCH;
  const m1 = [(P[1][0] + P[2][0]) / 2, (P[1][1] + P[2][1]) / 2], m3 = [(P[3][0] + P[0][0]) / 2, (P[3][1] + P[0][1]) / 2];
  for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; wall(B, a[0], a[1], b[0], b[1], y0, y1, own, fb, fh); }
  let R1 = m1, R3 = m3;
  if (kind === 3) { const L = d(m1, m3), ux = (m1[0] - m3[0]) / L, un = (m1[1] - m3[1]) / L, s = Math.min(hw, L / 2); R1 = [m1[0] - ux * s, m1[1] - un * s]; R3 = [m3[0] + ux * s, m3[1] + un * s]; }
  const q = (p, y) => [p[0], y, p[1]];
  face(B, [q(P[0], y1), q(P[1], y1), q(R1, yr), q(R3, yr)], own, 235); face(B, [q(P[2], y1), q(P[3], y1), q(R3, yr), q(R1, yr)], own, 235);
  const sh = kind === 3 ? 235 : 255; face(B, [q(P[1], y1), q(P[2], y1), q(R1, yr)], own, sh); face(B, [q(P[3], y1), q(P[0], y1), q(R3, yr)], own, sh);
}
function isConvexQuad(r) { if (r.length !== 8) return false;
  for (let i = 0; i < 4; i++) { const a = i * 2, b = ((i + 1) % 4) * 2, c = ((i + 2) % 4) * 2; if ((r[b] - r[a]) * (r[c + 1] - r[b + 1]) - (r[b + 1] - r[a + 1]) * (r[c] - r[b]) <= 0) return false; } return true; }
const LOWT = new Set(['house', 'detached', 'semidetached_house', 'bungalow']);
function buildBuildings(M, lod) {
  const B = new Buf(M.n * 24);
  for (let k = 0; k < M.n; k++) {
    const S = shape(M, k, lod >= 1), I = heightFor(M, k), base = M.base[k];
    const y0 = base - 1.0, y1 = base + I.h, fb = Math.round(base * 10), fh = I.f > 0 ? Math.round(I.h / I.f * 10) : 0;
    let roof = M.roof[k]; if (ROOF_DEMO && roof === 0 && LOWT.has(M.typ[k])) roof = (k % 2) ? 3 : 2;   // הדגמה בלבד (?roofs=demo)
    if ((roof === 2 || roof === 3) && lod >= 1 && S.rings.length === 1 && isConvexQuad(S.rings[0])) { pitched(B, S.rings[0], y0, y1, roof, k, fb, fh); continue; }
    const par = lod === 2 && I.par > 0, yTop = y1 + I.par;   // רחוק: המעקה נכלל בקיר (צללית נכונה, בלי משולשי מעקה)
    const yRoof = par ? y1 : yTop, v0 = B.v;
    for (const r of S.rings) for (let i = 0; i < r.length; i += 2) B.vert(r[i], yRoof, r[i + 1], 0, 1, 0, k, par ? 222 : 240, 0, 0);
    for (let i = 0; i < S.tri.length; i += 3) B.tri(v0 + S.tri[i], v0 + S.tri[i + 1], v0 + S.tri[i + 2], k);
    for (const r of S.rings) { const m = r.length / 2;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m; wall(B, r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], y0, yTop, k, fb, fh); }
      if (par) for (let i = 0; i < m; i++) { // פנים המעקה (מוזח 25 ס"מ פנימה) + קופינג
        const j = (i + 1) % m, ax = r[i * 2], an = r[i * 2 + 1], bx = r[j * 2], bn = r[j * 2 + 1];
        let nx = bn - an, nn = -(bx - ax); const L = Math.hypot(nx, nn) || 1; nx = nx / L * 0.25; nn = nn / L * 0.25;
        wall(B, bx - nx, bn - nn, ax - nx, an - nn, y1, yTop, k, 0, 0, 200, 235);
        const c0 = B.vert(ax, yTop, an, 0, 1, 0, k, 255, 0, 0), c1 = B.vert(bx, yTop, bn, 0, 1, 0, k, 255, 0, 0), c2 = B.vert(bx - nx, yTop, bn - nn, 0, 1, 0, k, 255, 0, 0), c3 = B.vert(ax - nx, yTop, an - nn, 0, 1, 0, k, 255, 0, 0);
        B.tri(c0, c1, c2, k); B.tri(c0, c2, c3, k); }
    }
  }
  return finish(B);
}
function finish(B) {
  const nv = B.v, ni = B.idx.length, idx = new Uint32Array(B.idx), pos = B.pos;
  for (let i = 0; i < ni; i += 3) { // כיוון משולשים לפי הנורמל – FrontSide תמיד נכון
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    if ((uy * vz - uz * vy) * B.nrm[a] + (uz * vx - ux * vz) * B.nrm[a + 1] + (ux * vy - uy * vx) * B.nrm[a + 2] < 0) { const s = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = s; }
  }
  return { pos: pos.slice(0, nv * 3), nrm: B.nrm.slice(0, nv * 3), own: B.own.slice(0, nv), sh: B.sh.slice(0, nv), fl: B.fl.slice(0, nv * 2), idx, towner: new Uint16Array(B.towner) };
}

// ---------- קרקע + ים ----------
const BG = [0.72, 0.72, 0.66];   // = צבע האובך של הסצנה בגוון ליניארי   // צבע האופק/ערפל
function groundColor(h, f, out) {
  let r, g, b; if (h < 4) { r = 0.87; g = 0.81; b = 0.66; } else if (h < 15) { r = 0.76; g = 0.74; b = 0.63; } else { r = 0.64 + Math.min(h, 60) / 400; g = 0.67; b = 0.53; }
  const t = f / 255; out[0] = BG[0] + (r - BG[0]) * t; out[1] = BG[1] + (g - BG[1]) * t; out[2] = BG[2] + (b - BG[2]) * t;
}
function buildGround(M, stride) {
  const N = M.N, S = M.step, H = M.terr, F = M.fade, m = Math.floor((N - 1) / stride) + 1, at = (r, c) => H[r * N + c];
  const cap = m * m + 8 * m + (M.sea ? M.sea.v.length / 2 : 0);
  const pos = new Float32Array(cap * 3), nrm = new Int8Array(cap * 3), col = new Uint8Array(cap * 3), idx = [], tmp = [0, 0, 0], id = new Int32Array(m * m);
  let v = 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
    const r = Math.min(i * stride, N - 1), c = Math.min(j * stride, N - 1), h = at(r, c);
    const hx = at(r, Math.min(c + 1, N - 1)) - at(r, Math.max(c - 1, 0)), hz = at(Math.min(r + 1, N - 1), c) - at(Math.max(r - 1, 0), c);
    const nx = -hx / (2 * S), nn = -hz / (2 * S), L = Math.hypot(nx, 1, nn);
    pos[v * 3] = c * S; pos[v * 3 + 1] = h; pos[v * 3 + 2] = -r * S;
    nrm[v * 3] = Math.round(nx / L * 127); nrm[v * 3 + 1] = Math.round(127 / L); nrm[v * 3 + 2] = Math.round(-nn / L * 127);
    groundColor(h, F[r * N + c], tmp); col[v * 3] = tmp[0] * 255; col[v * 3 + 1] = tmp[1] * 255; col[v * 3 + 2] = tmp[2] * 255;
    id[i * m + j] = v++;
  }
  const fA = (i, j) => F[Math.min(i * stride, N - 1) * N + Math.min(j * stride, N - 1)], hA = (i, j) => at(Math.min(i * stride, N - 1), Math.min(j * stride, N - 1));
  for (let i = 0; i + 1 < m; i++) for (let j = 0; j + 1 < m; j++) {
    if (fA(i, j) + fA(i + 1, j) + fA(i, j + 1) + fA(i + 1, j + 1) === 0) continue;
    if (hA(i, j) < 0 && hA(i + 1, j) < 0 && hA(i, j + 1) < 0 && hA(i + 1, j + 1) < 0) continue;   // ים: מצויר רק מהמצולע
    const a = id[i * m + j], b = id[i * m + j + 1], c = id[(i + 1) * m + j], d = id[(i + 1) * m + j + 1]; idx.push(a, b, d, a, d, c);
  }
  const skirt = list => { for (let k = 0; k + 1 < list.length; k++) { const [i0, j0] = list[k], [i1, j1] = list[k + 1]; if (fA(i0, j0) + fA(i1, j1) === 0) continue;
    const a = id[i0 * m + j0], b = id[i1 * m + j1], a2 = v, b2 = v + 1;
    for (const [s, d] of [[a, a2], [b, b2]]) { pos[d * 3] = pos[s * 3]; pos[d * 3 + 1] = pos[s * 3 + 1] - 6; pos[d * 3 + 2] = pos[s * 3 + 2]; nrm.set(nrm.subarray(s * 3, s * 3 + 3), d * 3); col.set(col.subarray(s * 3, s * 3 + 3), d * 3); }
    v += 2; idx.push(a, a2, b2, a, b2, b, a, b2, a2, a, b, b2); } };   // חצאית דו-צדדית בשולי האריח: אין סדקים בין רמות פירוט
  const E = f => { const l = []; for (let q = 0; q < m; q++) l.push(f(q)); skirt(l); };
  E(q => [0, q]); E(q => [m - 1, q]); E(q => [q, 0]); E(q => [q, m - 1]);
  if (M.sea) { const sv = M.sea.v, base = v;
    for (let i = 0; i < sv.length / 2; i++) { pos[v * 3] = sv[i * 2]; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = -sv[i * 2 + 1]; nrm[v * 3 + 1] = 127; col[v * 3] = 48; col[v * 3 + 1] = 112; col[v * 3 + 2] = 153; v++; }
    const I = M.sea.i; for (let i = 0; i < I.length; i += 3) { const a = base + I[i], b = base + I[i + 1], c = base + I[i + 2];
      const ux = pos[b * 3] - pos[a * 3], uz = pos[b * 3 + 2] - pos[a * 3 + 2], vx = pos[c * 3] - pos[a * 3], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      if (uz * vx - ux * vz > 0) idx.push(a, b, c); else idx.push(a, c, b); } }   // נורמל גאומטרי כלפי מעלה
  return { pos: pos.slice(0, v * 3), nrm: nrm.slice(0, v * 3), col: col.slice(0, v * 3), idx };
}
function terrH(M, x, n) { const N = M.N, S = M.step, c = Math.min(Math.max(x / S, 0), N - 1.001), r = Math.min(Math.max(n / S, 0), N - 1.001), i = r | 0, j = c | 0, a = r - i, b = c - j, H = M.terr;
  return Math.max(0, H[i * N + j] * (1 - a) * (1 - b) + H[i * N + j + 1] * (1 - a) * b + H[(i + 1) * N + j] * a * (1 - b) + H[(i + 1) * N + j + 1] * a * b); }
const RC = { 5: [245, 158, 77], 4: [250, 204, 115], 3: [255, 255, 255], 2: [250, 250, 245], 1: [217, 217, 217], 0: [210, 210, 205] };
function buildRoads(M, minCls) {
  let ns = 0; for (const r of M.roads) if (r.cls >= minCls) ns += r.pts.length / 2 - 1;
  const pos = new Float32Array(ns * 6), col = new Uint8Array(ns * 6); let s = 0;
  for (const r of M.roads) { if (r.cls < minCls) continue; const p = r.pts, c = RC[r.cls] || RC[1];
    for (let k = 2; k < p.length; k += 2) { const a = s * 6; pos.set([p[k - 2], terrH(M, p[k - 2], p[k - 1]) + 0.8, -p[k - 1], p[k], terrH(M, p[k], p[k + 1]) + 0.8, -p[k + 1]], a); col.set(c, a); col.set(c, a + 3); s++; } }
  return { pos, col };
}
function names(M, ox, on) { // אינדקס חיפוש מצטבר מהאריחים (לגדוד 5 אין עדיין קובץ חיפוש)
  const st = {}; for (const r of M.roads) { if (!r.name) continue; const p = r.pts, o = st[r.name] || (st[r.name] = []); for (let k = 0; k < p.length; k += 2) o.push(ox + p[k], on + p[k + 1]); }
  const streets = Object.entries(st).map(([nm, a]) => { let sx = 0, sy = 0; const n = a.length / 2; for (let i = 0; i < a.length; i += 2) { sx += a[i]; sy += a[i + 1]; }
    return [nm, sx / n, sy / n, n, a.filter((_, i) => i % Math.max(2, (a.length / 16 | 0) * 2) < 2)]; });   // [שם, מרכז x, מרכז n, משקל, דגימת נקודות]
  const blds = []; for (let k = 0; k < M.n; k++) if (M.names[k]) blds.push([M.names[k], ox + M.cen[2 * k], on + M.cen[2 * k + 1], k, M.typ[k]]);
  return { streets, blds };
}

function seaEdge(M) { // לחיבור "הים הרחוק": האם יש ים בקצה המערבי, ועד איזה x הים מגיע בקצה הדרומי/הצפוני
  if (!M.sea) return null; const v = M.sea.v; let w = false, s = -1, n = -1;
  for (let i = 0; i < v.length; i += 2) { if (v[i] < 1) w = true; if (v[i + 1] < 1) s = Math.max(s, v[i]); if (v[i + 1] > 999) n = Math.max(n, v[i]); }
  return { w, s, n };
}
async function handle(m) {
  if (m.type === 'init') { Object.assign(CFG, m.cfg); return { ok: true }; }
  if (m.type === 'meas') { MEAS = m.meas || {}; return { ok: true }; }
  if (m.type === 'roofdemo') { ROOF_DEMO = !!m.on; return { ok: true }; }
  if (m.type === 'build') {
    const t0 = performance.now(), M = await getModel(m.key), [tx, ty] = m.key.split('_').map(Number), tr = [];
    const res = { key: m.key, lod: m.lod, bytes: M.bytes };
    if (m.wantMeta) {
      const hh = new Float32Array(M.n), ff = new Uint8Array(M.n), ss = new Float32Array(M.n), pp = new Float32Array(M.n);
      let hmax = 0; for (let k = 0; k < M.n; k++) { const I = heightFor(M, k); hh[k] = I.h; ff[k] = I.f; ss[k] = I.sg; pp[k] = I.par; hmax = Math.max(hmax, M.base[k] + I.h + I.par + I.sg); }
      res.meta = { n: M.n, ids: M.ids, area: M.area, base: M.base, h: hh, par: pp, sg: ss, f: ff, flo: M.flo, fhi: M.fhi, conf: M.conf, src: M.src, used: M.used, typ: M.typ, names: M.names, roof: M.roof, cen: M.cen,
        terr: M.terr.slice(), N: M.N, step: M.step, hmax, seaEdge: seaEdge(M), idx: names(M, tx * CFG.tile, ty * CFG.tile) };
    }
    // בניינים + קרקע + ים בגאומטריה אחת → קריאת ציור אחת לאריח (אותו חומר; לקרקע afl = 0 → אין קווי קומות)
    const b = M.n ? buildBuildings(M, m.lod) : null, g = buildGround(M, m.lod === 2 ? 1 : m.lod === 1 ? 2 : 4);
    const nb = b ? b.own.length : 0, ng = g.pos.length / 3, nv = nb + ng, nib = b ? b.idx.length : 0, ni = nib + g.idx.length;
    if (ni) {
      const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), fl = new Int16Array(nv * 2), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), towner = new Uint16Array(ni / 3);
      if (b) { pos.set(b.pos); nrm.set(b.nrm); fl.set(b.fl); idx.set(b.idx); towner.set(b.towner); }
      pos.set(g.pos, nb * 3); nrm.set(g.nrm, nb * 3); for (let i = 0; i < g.idx.length; i++) idx[nib + i] = g.idx[i] + nb; towner.fill(65535, nib / 3);
      res.m = { pos, nrm, fl, idx, towner, own: b ? b.own : new Uint16Array(0), sh: b ? b.sh : new Uint8Array(0), gcol: g.col, nb, nib };
      tr.push(pos.buffer, nrm.buffer, fl.buffer, idx.buffer, towner.buffer, res.m.own.buffer, res.m.sh.buffer, g.col.buffer);
    }
    if (M.roads.length) { const r = buildRoads(M, m.lod === 0 ? 3 : 0); if (r.pos.length) { res.r = r; tr.push(r.pos.buffer, r.col.buffer); } }   // רחוק: רק דרכים ראשיות
    res.ms = performance.now() - t0;
    return [res, tr];
  }
  if (m.type === 'geom') { const M = await getModel(m.key); return { key: m.key, k: m.k, rings: M.rings[m.k].map(r => Array.from(r)) }; }
  if (m.type === 'street') { const out = [];
    for (const [key, M] of cache) { const [tx, ty] = key.split('_').map(Number), ox = tx * CFG.tile, on = ty * CFG.tile;
      for (const r of M.roads) if (r.name === m.name) { const p = r.pts; for (let k = 2; k < p.length; k += 2) out.push(ox + p[k - 2], on + p[k - 1], terrH(M, p[k - 2], p[k - 1]), ox + p[k], on + p[k + 1], terrH(M, p[k], p[k + 1])); } }
    return { segs: out }; }
}
const api = { handle };
if (IN_WORKER) {
  self.onmessage = async e => { const m = e.data; try { const r = await handle(m); if (Array.isArray(r)) self.postMessage({ id: m.id, res: r[0] }, r[1]); else self.postMessage({ id: m.id, res: r }); }
    catch (err) { self.postMessage({ id: m.id, err: String(err && err.message || err) }); } };
} else G.YZWorkerLocal = api;
G.__YZapi = api;
})(typeof self !== 'undefined' ? self : window);
