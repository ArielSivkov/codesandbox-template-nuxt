/* 27wrld · אשדוד — world.js
   עולם אמיתי מאריחי גדוד 5 (ITM, אריח 1 ק"מ): קרקע 41×41, בניינים, כבישים, ים.
   סצנה: x = מזרח − OX, z = −(צפון − OY), y = מעלה (מטרים).
   סטרימינג לפי מרחק, גאומטריה ממוזגת לכל אריח (2 רמות פירוט), אינדקס מרחבי להתנגשויות. */
(function () {
'use strict';
const T = window.THREE;
const SEA = -32768, OUT = -32767, NT = 41, STEP = 25, TILE = 1000;
// קו חוף משוער (התאמה ליניארית לתאי הים באריחי אשדוד): E = A + B·N. רק למילוי אריחים שאין עליהם נתונים.
const COAST_A = -125006.9, COAST_B = 0.45566;
const SEA_Y = -2.5, LAND_MIN = 0.6, HC = 64;   // תא אינדקס מרחבי 64 מ'
const BAY = 3.4, FLOOR = 3.0;

const W = window.W27 = {
  ready: false, OX: 0, OY: 0, manifest: null, tiles: new Map(), stats: { tris: 0, tiles: 0, builds: 0, buildMs: 0 },
  radius: 1150, hiRadius: 650, onTile: null,
};
let BASE = 'data/', scene = null, root = null, TILESET = new Set(), EXTRA = new Set(), EXTRA_BASE = '';   // EXTRA: אריחי הכיסוי הארצי (נטענים מתיקייה משותפת)
const hash = new Map();
const queue = [];          // אריחים שממתינים לבנייה (נתונים כבר הורדו)
const fetching = new Set();

// ---------- עזר
const hash32 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
async function fetchBuf(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  let buf = await r.arrayBuffer(); const u = new Uint8Array(buf, 0, 2);
  if (u[0] === 0x1f && u[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buf;
}
const td = new TextDecoder();
async function fetchJSON(url) { return JSON.parse(td.decode(await fetchBuf(url))); }

// ---------- טקסטורות פרוצדורליות (קנבס, פעם אחת)
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; if (rep !== false) { t.wrapS = t.wrapT = T.RepeatWrapping; }
  t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; return t;
}
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
function noiseFill(x, w, h, n, a, seed, dark) { const R = rng(seed); for (let i = 0; i < n; i++) { const v = dark ? 0 : 255; x.fillStyle = `rgba(${v},${v},${v},${a * R()})`; x.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); } }

const TEX = {};
function makeTextures() {
  // חזית מגורים: 2 מפרצים × 2 קומות, לבן (הצבע מגיע מצבע הקודקוד)
  TEX.facade = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); noiseFill(x, w, h, 1400, 0.09, 7, true);
    const R = rng(11);
    for (let fy = 0; fy < 2; fy++) for (let bx = 0; bx < 2; bx++) {
      const X = bx * 128, Y = fy * 128;
      x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(X, Y + 122, 128, 6);            // קו רצפה
      const shut = R() < 0.3, wide = R() < 0.35;
      const wx = X + (wide ? 14 : 30), ww = wide ? 100 : 68, wy = Y + 26, wh = 64;
      x.fillStyle = '#d9d6cf'; x.fillRect(wx - 5, wy - 5, ww + 10, wh + 12);          // מסגרת
      const g = x.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, '#5d7d98'); g.addColorStop(0.5, '#2c4359'); g.addColorStop(1, '#1d2b3a');
      x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
      x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.moveTo(wx, wy + wh * 0.7); x.lineTo(wx + ww * 0.5, wy); x.lineTo(wx + ww * 0.7, wy); x.lineTo(wx, wy + wh); x.fill();
      if (shut) { x.fillStyle = '#c8c2b4'; x.fillRect(wx, wy, ww, wh * (0.4 + R() * 0.6)); x.fillStyle = 'rgba(0,0,0,0.12)'; for (let s = wy; s < wy + wh; s += 5) x.fillRect(wx, s, ww, 1); }
      x.fillStyle = '#ece9e2'; x.fillRect(wx - 8, wy + wh + 5, ww + 16, 5);           // אדן
      if (wide) { x.fillStyle = 'rgba(60,60,60,0.55)'; for (let s = wx; s < wx + ww; s += 7) x.fillRect(s, wy + wh - 24, 2, 24); x.fillRect(wx, wy + wh - 26, ww, 3); } // מעקה מרפסת
      if (!wide && R() < 0.5) { x.fillStyle = '#b9b9b4'; x.fillRect(wx + ww + 8, wy + 40, 16, 12); x.fillStyle = '#8a8a86'; x.fillRect(wx + ww + 10, wy + 42, 12, 2); } // מזגן
    }
  });
  // תעשייה: פח גלי + רצועת חלונות עליונה
  TEX.ind = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 8) { x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(i, 0, 3, h); x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(i + 4, 0, 1, h); }
    x.fillStyle = '#41586b'; x.fillRect(0, 14, w, 16); x.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < w; i += 32) x.fillRect(i, 14, 3, 16);
    x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(0, 120, w, 8);
  });
  TEX.roof = canvasTex(128, 128, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); noiseFill(x, w, h, 2500, 0.16, 3, true); noiseFill(x, w, h, 800, 0.3, 4, false);
    x.strokeStyle = 'rgba(0,0,0,0.08)'; x.lineWidth = 2; x.strokeRect(1, 1, w - 2, h - 2); });
  TEX.road = canvasTex(128, 256, (x, w, h) => {
    x.fillStyle = '#5b5e62'; x.fillRect(0, 0, w, h); noiseFill(x, w, h, 3000, 0.25, 5, true); noiseFill(x, w, h, 900, 0.12, 6, false);
    x.fillStyle = '#e8e4d8'; x.fillRect(2, 0, 3, h); x.fillRect(w - 5, 0, 3, h);           // קווי שוליים
    x.fillStyle = '#f2f0e8'; x.fillRect(w / 2 - 2, 20, 4, 100); x.fillRect(w / 2 - 2, 148, 4, 100); // מקווקו
  });
  TEX.walk = canvasTex(64, 64, (x, w, h) => { x.fillStyle = '#cfc9bd'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < w; i += 16) { x.fillRect(i, 0, 1, h); x.fillRect(0, i, w, 1); } noiseFill(x, w, h, 300, 0.12, 9, true); });
  TEX.ground = canvasTex(128, 128, (x, w, h) => { x.fillStyle = '#e6e6e6'; x.fillRect(0, 0, w, h); noiseFill(x, w, h, 4000, 0.10, 12, true); noiseFill(x, w, h, 900, 0.12, 13, false); });
  TEX.waterN = canvasTex(128, 128, (x, w, h) => {
    const id = x.createImageData(w, h), d = id.data; const R = rng(21); const ph = [R() * 6, R() * 6, R() * 6, R() * 6];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const u = i / w * Math.PI * 2, v = j / h * Math.PI * 2;
      const nx = 0.5 * Math.cos(u * 3 + ph[0]) + 0.3 * Math.cos(u * 5 + v * 2 + ph[1]) + 0.2 * Math.cos(u * 9 - v * 4 + ph[2]);
      const ny = 0.5 * Math.cos(v * 4 + ph[3]) + 0.3 * Math.cos(v * 7 - u * 3 + ph[0]) + 0.2 * Math.cos(v * 11 + u * 5 + ph[1]);
      const k = (j * w + i) * 4; d[k] = 128 + nx * 50; d[k + 1] = 128 + ny * 50; d[k + 2] = 255; d[k + 3] = 255; }
    x.putImageData(id, 0, 0); });
  TEX.waterN.colorSpace = T.NoColorSpace;
}

const MAT = {};
function makeMaterials() {
  MAT.wall = new T.MeshLambertMaterial({ map: TEX.facade, vertexColors: true });
  MAT.ind = new T.MeshLambertMaterial({ map: TEX.ind, vertexColors: true });
  MAT.roof = new T.MeshLambertMaterial({ map: TEX.roof, vertexColors: true });
  TEX.tile = canvasTex(64, 64, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) { x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, r * 16 + 13, w, 3); for (let c = 0; c < 4; c++) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(c * 16 + (r % 2) * 8, r * 16, 2, 16); } } noiseFill(x, w, h, 300, 0.12, 9, true); });
  MAT.tile = new T.MeshLambertMaterial({ map: TEX.tile, vertexColors: true, side: T.DoubleSide });
  MAT.lo = new T.MeshLambertMaterial({ vertexColors: true });           // רמת פירוט רחוקה: בלי טקסטורה
  MAT.terrain = new T.MeshLambertMaterial({ vertexColors: true, map: TEX.ground });
  MAT.road = new T.MeshLambertMaterial({ map: TEX.road, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  MAT.walk = new T.MeshLambertMaterial({ map: TEX.walk, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  MAT.sea = new T.MeshPhongMaterial({ color: 0x2a6f93, specular: 0xbfd8e8, shininess: 70, normalMap: TEX.waterN, normalScale: new T.Vector2(0.6, 0.6), transparent: true, opacity: 0.93 });
  MAT.solar = new T.MeshLambertMaterial({ color: 0x9aa3ab });
  MAT.panel = new T.MeshLambertMaterial({ color: 0x1f3550 });
  MAT.trunk = new T.MeshLambertMaterial({ color: 0x8a6a48 });
  MAT.leaf = new T.MeshLambertMaterial({ color: 0x4f7d34 });
  MAT.palm = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });   // דקל: גזע + כפות בגאומטריה אחת (קריאת ציור אחת לאריח)
}

// ---------- גבהים
function decodeTerrain(buf, v) {
  const dv = new DataView(buf); const nt = dv.getUint16(14, true), step = dv.getUint16(18, true);
  if (nt !== NT || step !== STEP || buf.byteLength < 20 + NT * NT * 2) throw new Error('terrain grid ' + nt + ' ' + step + ' (' + buf.byteLength + 'B)');
  const z = new Int16Array(buf.slice(20, 20 + NT * NT * 2));
  const h = new Float32Array(NT * NT), known = new Uint8Array(NT * NT), sea = new Uint8Array(NT * NT);
  const ox = v.o[0], oy = v.o[1];
  const seaRings = (v.sea || []).map(p => decodeRingEN(p[0], ox, oy));
  for (let r = 0; r < NT; r++) for (let k = 0; k < NT; k++) {
    const i = r * NT + k, val = z[i];
    if (val === SEA) { h[i] = SEA_Y; known[i] = 1; sea[i] = 1; continue; }
    if (val === OUT) { const E = ox + k * STEP, N = oy + TILE - r * STEP; if (seaRings.some(rg => pipEN(rg, E, N))) { h[i] = SEA_Y; known[i] = 1; sea[i] = 1; } continue; }
    h[i] = Math.max(LAND_MIN, val / 10); known[i] = 1;
  }
  // מילוי תאים מחוץ לאזור המחקר: ממוצע שכנים יבשתיים (דיפוזיה), כדי שלא יהיה "לוח צף" או צוק
  let any = false; for (let i = 0; i < NT * NT; i++) if (known[i] && !sea[i]) { any = true; break; }
  if (!any) { for (let i = 0; i < NT * NT; i++) if (!known[i]) { h[i] = 1.0; known[i] = 1; } }
  for (let it = 0; it < 120; it++) {
    let left = 0; const nk = known.slice();
    for (let r = 0; r < NT; r++) for (let k = 0; k < NT; k++) {
      const i = r * NT + k; if (known[i]) continue; let s = 0, n = 0;
      if (k > 0 && known[i - 1] && !sea[i - 1]) { s += h[i - 1]; n++; } if (k < NT - 1 && known[i + 1] && !sea[i + 1]) { s += h[i + 1]; n++; }
      if (r > 0 && known[i - NT] && !sea[i - NT]) { s += h[i - NT]; n++; } if (r < NT - 1 && known[i + NT] && !sea[i + NT]) { s += h[i + NT]; n++; }
      if (n) { h[i] = Math.max(LAND_MIN, s / n * 0.985 + 0.015 * 3); nk[i] = 1; } else left++;
    }
    known.set(nk); if (!left) break;
  }
  for (let i = 0; i < NT * NT; i++) if (!known[i]) h[i] = 1.0;
  return { h, sea };
}
function decodeRingEN(r, ox, oy) { const a = new Float64Array(r.length); let x = ox, y = oy; for (let i = 0; i < r.length; i += 2) { x += r[i] / 10; y += r[i + 1] / 10; a[i] = x; a[i + 1] = y; } return a; }
function pipEN(a, x, y) { let c = false; const n = a.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = a[i * 2], yi = a[i * 2 + 1], xj = a[j * 2], yj = a[j * 2 + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }

// גובה בתוך אריח – אותה חלוקה למשולשים כמו הרשת (אלכסון b–d), כך שרכב/דמות יושבים בדיוק על הקרקע
function tileH(t, E, N) {
  let fx = (E - t.tx * TILE) / STEP, fr = ((t.ty + 1) * TILE - N) / STEP;
  fx = fx < 0 ? 0 : fx > 39.9999 ? 39.9999 : fx; fr = fr < 0 ? 0 : fr > 39.9999 ? 39.9999 : fr;
  const k = fx | 0, r = fr | 0, u = fx - k, v = fr - r, h = t.hgt, i = r * NT + k;
  const a = h[i], b = h[i + 1], d = h[i + NT], e = h[i + NT + 1];
  return (u + v < 1) ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
}
function fallbackH(E, N) { return E > COAST_A + COAST_B * N + 300 ? 1.0 : SEA_Y; }
W.H = function (x, z) {
  const E = x + W.OX, N = W.OY - z, tx = Math.floor(E / TILE), ty = Math.floor(N / TILE);
  const t = W.tiles.get(tx + '_' + ty); if (!t || !t.hgt) return fallbackH(E, N); return tileH(t, E, N);
};
W.isSea = (x, z) => W.H(x, z) < -0.5;

// ---------- בניינים
function polyArea(p) { let s = 0; const n = p.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; } return s / 2; }
function decodeBuildings(t, v) {
  const out = [], ox = v.o[0], oy = v.o[1];
  for (const b of v.b) {
    if (!b || !Array.isArray(b.r) || !b.r[0]) { W.badRecords = (W.badRecords || 0) + 1; continue; }
    const en = decodeRingEN(b.r[0], ox, oy); let n = en.length / 2;
    if (n > 3 && Math.abs(en[0] - en[n * 2 - 2]) < 0.05 && Math.abs(en[1] - en[n * 2 - 1]) < 0.05) n--;
    if (n < 3) continue;
    let p = new Float32Array(n * 2); for (let i = 0; i < n; i++) { p[i * 2] = en[i * 2] - W.OX; p[i * 2 + 1] = -(en[i * 2 + 1] - W.OY); }
    if (polyArea(p) > 0) { const q = new Float32Array(n * 2); for (let i = 0; i < n; i++) { q[i * 2] = p[(n - 1 - i) * 2]; q[i * 2 + 1] = p[(n - 1 - i) * 2 + 1]; } p = q; }
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, per = 0, cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { const x = p[i * 2], z = p[i * 2 + 1]; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); cx += x; cz += z;
      const j = (i + 1) % n; per += Math.hypot(p[j * 2] - x, p[j * 2 + 1] - z); }
    const base = b.z / 10, h = Math.max(3, b.h / 10);
    const ind = /industrial|warehouse|manufacture|cowshed/.test(b.t) || (b.a > 2500 && b.f <= 3);
    out.push({ id: b.i, name: b.n || '', type: b.t || '', area: b.a, base, h, top: base + h, sigma: b.s / 10, floors: b.f, fl: b.fl, fh: b.fh, src: b.src, conf: b.c,
      p, n, minx, maxx, minz, maxz, cx: cx / n, cz: cz / n, per, ind, tile: t.key });
  }
  return out;
}
const PAL = [[0.95, 0.93, 0.88], [0.97, 0.96, 0.93], [0.92, 0.88, 0.80], [0.90, 0.86, 0.78], [0.88, 0.88, 0.86], [0.94, 0.90, 0.84], [0.85, 0.80, 0.72], [0.93, 0.86, 0.80], [0.82, 0.84, 0.86],
  [0.88, 0.80, 0.66], [0.93, 0.83, 0.72], [0.80, 0.81, 0.80], [0.90, 0.84, 0.70], [0.86, 0.87, 0.90], [0.92, 0.88, 0.76]];   // + אבן חולית, אפרסק, אפור, חול, כחלחל – גוונים נפוצים בבנייה בעיר החוף (אסתטי, לא נתון)
const IND_PAL = [[0.78, 0.80, 0.82], [0.70, 0.74, 0.78], [0.82, 0.78, 0.70], [0.62, 0.68, 0.72]];
// טיפולוגיה נגזרת (לא נמדדת): וילה = עד 2 קומות וטביעה קטנה; מגדל = 12+ קומות; אחרת בלוק. דטרמיניסטי לפי מזהה.
const VILLA_PAL = [[0.98, 0.97, 0.94], [0.97, 0.94, 0.86], [0.96, 0.92, 0.84], [0.99, 0.98, 0.96], [0.93, 0.90, 0.84], [0.97, 0.90, 0.82]];
const BLOCK_PAL = [[0.93, 0.90, 0.82], [0.88, 0.84, 0.76], [0.95, 0.93, 0.88], [0.86, 0.86, 0.84], [0.92, 0.86, 0.80], [0.84, 0.82, 0.78], [0.96, 0.94, 0.90], [0.90, 0.88, 0.84], [0.80, 0.78, 0.74], [0.94, 0.88, 0.84]];
const TOWER_PAL = [[0.90, 0.90, 0.88], [0.84, 0.86, 0.88], [0.92, 0.90, 0.85], [0.78, 0.82, 0.86]];
function tyOf(b) { if (b.ty) return b.ty; let t = 'block'; if (b.ind) t = 'ind'; else if (b.floors >= 12 || b.h >= 36) t = 'tower'; else if (b.floors <= 2 && b.area < 450 && b.area > 35) t = 'villa'; b.ty = t; return t; }
W.tyOf = tyOf;
function hipRoof(b, p, n, y1, gr, hs) { // גג רעפים על מלבן מכוון; רק כשהטביעה קרובה למלבן
  let bi = 0, bl = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]); if (l > bl) { bl = l; bi = i; } }
  const j0 = (bi + 1) % n, ux = (p[j0 * 2] - p[bi * 2]) / bl, uz = (p[j0 * 2 + 1] - p[bi * 2 + 1]) / bl, vx = -uz, vz = ux;
  let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9; for (let i = 0; i < n; i++) { const u = p[i * 2] * ux + p[i * 2 + 1] * uz, w = p[i * 2] * vx + p[i * 2 + 1] * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
  const W_ = u1 - u0, D_ = w1 - w0; if (W_ * D_ <= 0 || b.area / (W_ * D_) < 0.72) return false;
  const o = 0.45; u0 -= o; u1 += o; w0 -= o; w1 += o; const sw = D_ > W_; const L = sw ? D_ : W_, S = sw ? W_ : D_, hr = Math.min(3.6, Math.max(1.2, 0.36 * S));
  const P = (u, w, y) => [u * ux + w * vx, y, u * uz + w * vz];
  const um = (u0 + u1) / 2, wm = (w0 + w1) / 2, half = (S + 2 * o) / 2, yr = y1 + hr;
  let r1, r2; if (!sw) { r1 = P(Math.min(um, u0 + half), wm, yr); r2 = P(Math.max(um, u1 - half), wm, yr); } else { r1 = P(um, Math.min(wm, w0 + half), yr); r2 = P(um, Math.max(wm, w1 - half), yr); }
  const c00 = P(u0, w0, y1), c10 = P(u1, w0, y1), c11 = P(u1, w1, y1), c01 = P(u0, w1, y1);
  const k = 0.82 + ((hs >>> 4) % 20) / 100, col = [0.70 * k, 0.34 * k, 0.22 * k];
  const tri = (a, b2, c) => { const e1 = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    if (ny < 0) { const t = b2; b2 = c; c = t; nx = -nx; ny = -ny; nz = -nz; } const l = Math.hypot(nx, ny, nz) || 1;
    for (const q of [a, b2, c]) { gr.p.push(q[0], q[1], q[2]); gr.n.push(nx / l, ny / l, nz / l); gr.c.push(col[0], col[1], col[2]); gr.u.push((q[0] * ux + q[2] * uz) / 1.4, (q[1] - y1) / 0.55 + (q[0] * vx + q[2] * vz) * 0.0); } };
  if (!sw) { tri(c00, c10, r2); tri(c00, r2, r1); tri(c11, c01, r1); tri(c11, r1, r2); tri(c10, c11, r2); tri(c01, c00, r1); }
  else { tri(c00, c01, r2); tri(c00, r2, r1); tri(c11, c10, r1); tri(c11, r1, r2); tri(c01, c11, r2); tri(c10, c00, r1); }
  return true;
}

function buildBuildingGeo(list, lo) {
  // groups: 0 קירות מגורים, 1 קירות תעשייה, 2 גגות (ב-lo: הכול בקבוצה אחת)
  const G = [{ p: [], n: [], c: [], u: [] }, { p: [], n: [], c: [], u: [] }, { p: [], n: [], c: [], u: [] }, { p: [], n: [], c: [], u: [] }];   // 3 = גגות רעפים
  const solar = [];
  const v2 = [];
  for (const b of list) {
    if (!isFinite(b.top) || !isFinite(b.base)) { b.base = isFinite(b.base) ? b.base : 0; b.h = isFinite(b.h) ? b.h : (b.floors || 1) * 3.3 + 1; b.top = b.base + b.h; }
    if (lo && b.area < 70) continue;
    const ty = tyOf(b), pal = b.ind ? IND_PAL : ty === 'villa' ? VILLA_PAL : ty === 'tower' ? TOWER_PAL : BLOCK_PAL, hs = hash32(b.id), col = pal[hs % pal.length];
    const y0 = b.base - 0.6, y1 = b.top, gw = b.ind ? G[1] : G[0];
    const bayW = b.ind ? 4.0 : BAY, flH = b.ind ? 6.0 : FLOOR;
    // פישוט קל לרמה רחוקה: מדלגים על קודקודים שיוצרים קיר קצר מ-1.5 מ'
    let p = b.p, n = b.n;
    if (lo && n > 6) { const keep = []; let lx = p[0], lz = p[1]; keep.push(lx, lz);
      for (let i = 1; i < n; i++) { const x = p[i * 2], z = p[i * 2 + 1]; if (Math.hypot(x - lx, z - lz) > 1.5) { keep.push(x, z); lx = x; lz = z; } }
      if (keep.length >= 6) { p = keep; n = keep.length / 2; } }
    const dark = 0.70, vB = -0.6 / flH;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
      const nx = -dz / L, nz = dx / L;
      const bays = L < 1.6 ? 0.05 : Math.max(1, Math.round(L / bayW)) / (b.ind ? 1 : 2);
      const vT = (y1 - b.base) / flH / (b.ind ? 1 : 2);
      const sh = 0.9 + 0.1 * Math.abs(nx);               // הבדל עדין בין חזיתות
      const cb = [col[0] * dark * sh, col[1] * dark * sh, col[2] * dark * sh], ct = [col[0] * sh, col[1] * sh, col[2] * sh];
      gw.p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
      for (let k = 0; k < 6; k++) gw.n.push(nx, 0, nz);
      gw.c.push(...cb, ...cb, ...ct, ...cb, ...ct, ...ct);
      gw.u.push(0, vB, bays, vB, bays, vT, 0, vB, bays, vT, 0, vT);
    }
    // גג (וילה: רעפים; אחרת שטוח)
    if (!(!lo && ty === 'villa' && hipRoof(b, p, n, y1, G[3], hs))) {
    v2.length = 0; for (let i = 0; i < n; i++) v2.push(new T.Vector2(p[i * 2], p[i * 2 + 1]));
    let tri; try { tri = T.ShapeUtils.triangulateShape(v2, []); } catch (e) { tri = []; }
    const rc = [col[0] * 0.86, col[1] * 0.86, col[2] * 0.86], gr = G[2];
    for (const t of tri) {
      const a = v2[t[0]], b2 = v2[t[1]], c = v2[t[2]];
      const cr = (b2.y - a.y) * (c.x - a.x) - (b2.x - a.x) * (c.y - a.y);
      const seq = cr > 0 ? [a, b2, c] : [a, c, b2];
      for (const q of seq) { gr.p.push(q.x, y1, q.y); gr.n.push(0, 1, 0); gr.c.push(...rc); gr.u.push(q.x / 10, q.y / 10); }
    }
    }
    // דודי שמש על גגות מגורים (סמל ישראלי) – רק ברמת פירוט קרובה
    if (!lo && !b.ind && ty !== 'villa' && b.area > 120 && b.area < 3000 && b.floors >= 2) {
      const k = 1 + (hs >>> 8) % 3;
      for (let s = 0; s < k; s++) { const fx = ((hs >>> (s * 5)) % 100) / 100 - 0.5, fz = ((hs >>> (s * 7 + 3)) % 100) / 100 - 0.5;
        const x = b.cx + fx * (b.maxx - b.minx) * 0.45, z = b.cz + fz * (b.maxz - b.minz) * 0.45;
        if (pip(b, x, z)) solar.push(x, y1, z, (hs % 628) / 100); }
    }
  }
  const geo = new T.BufferGeometry(); const P = [], N = [], C = [], U = []; let start = 0;
  const groups = lo ? [[0, 1, 2, 3]] : [[0], [1], [2], [3]];
  groups.forEach((gi, mi) => { let cnt = 0; for (const g of gi) { P.push(...G[g].p); N.push(...G[g].n); C.push(...G[g].c); U.push(...G[g].u); cnt += G[g].p.length / 3; }
    geo.addGroup(start, cnt, mi); start += cnt; });
  geo.setAttribute('position', new T.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(C, 3));
  if (!lo) geo.setAttribute('uv', new T.Float32BufferAttribute(U, 2));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return { geo, tris: P.length / 9, solar };
}
let SOLAR_GEO = null, PANEL_GEO = null;
function solarMesh(arr) {
  const n = arr.length / 4; if (!n) return null;
  if (!SOLAR_GEO) { SOLAR_GEO = new T.CylinderGeometry(0.35, 0.35, 1.6, 8); SOLAR_GEO.rotateZ(Math.PI / 2); SOLAR_GEO.translate(0, 1.05, 0.3);
    PANEL_GEO = new T.BoxGeometry(1.8, 0.08, 1.1); PANEL_GEO.rotateX(-0.6); PANEL_GEO.translate(0, 0.65, -0.6); }
  const g = new T.Group(), m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1, 1, 1), up = new T.Vector3(0, 1, 0);
  const a = new T.InstancedMesh(SOLAR_GEO, MAT.solar, n), b = new T.InstancedMesh(PANEL_GEO, MAT.panel, n);
  for (let i = 0; i < n; i++) { q.setFromAxisAngle(up, arr[i * 4 + 3]); m.compose(new T.Vector3(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2]), q, s); a.setMatrixAt(i, m); b.setMatrixAt(i, m); }
  g.add(a, b); return g;
}

// ---------- כבישים
const RW = [0, 5.0, 7.0, 8.5, 10.0];
function decodeRoads(t, v) {
  const ox = v.o[0], oy = v.o[1], out = [];
  for (const r of v.rd) { const en = decodeRingEN(r.r, ox, oy), n = en.length / 2; if (n < 2) continue;
    const p = new Float32Array(n * 2); for (let i = 0; i < n; i++) { p[i * 2] = en[i * 2] - W.OX; p[i * 2 + 1] = -(en[i * 2 + 1] - W.OY); }
    out.push({ c: r.c, name: r.n || '', p, w: RW[r.c] || 5 }); }
  return out;
}
function ribbon(t, road, width, lift, P, U, N, vScale) {
  // דגימה מחדש כל ~8 מ' כדי שהסרט יעקוב אחרי הקרקע
  const src = road.p, pts = [];
  for (let i = 0; i < src.length / 2 - 1; i++) { const ax = src[i * 2], az = src[i * 2 + 1], bx = src[i * 2 + 2], bz = src[i * 2 + 3]; const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / 8));
    for (let s = 0; s < k; s++) pts.push(ax + (bx - ax) * s / k, az + (bz - az) * s / k); }
  pts.push(src[src.length - 2], src[src.length - 1]);
  const m = pts.length / 2; if (m < 2) return;
  const L = [], R = []; let dist = 0, prevV = 0;
  for (let i = 0; i < m; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    const i0 = Math.max(0, i - 1), i1 = Math.min(m - 1, i + 1);
    let dx = pts[i1 * 2] - pts[i0 * 2], dz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const hw = width / 2, nx = -dz * hw, nz = dx * hw;
    if (i) dist += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1]);
    const lx = x + nx, lz = z + nz, rx = x - nx, rz = z - nz;
    L.push(lx, tileH(t, lx + W.OX, W.OY - lz) + lift, lz, dist / vScale); R.push(rx, tileH(t, rx + W.OX, W.OY - rz) + lift, rz, dist / vScale);
  }
  for (let i = 0; i < m - 1; i++) {
    const a = i * 4, b = (i + 1) * 4;
    const q = [[L, a, 0], [R, b, 1], [R, a, 1], [L, a, 0], [L, b, 0], [R, b, 1]];
    for (const [S, o, u] of q) { P.push(S[o], S[o + 1], S[o + 2]); U.push(u, S[o + 3]); N.push(0, 1, 0); }
  }
}
function buildRoadMeshes(t) {
  const P = [], U = [], N = [], P2 = [], U2 = [], N2 = [];
  for (const r of t.roads) {
    ribbon(t, r, r.w, 0.10 + r.c * 0.015, P, U, N, 16);
    if (r.c >= 2) ribbon(t, r, r.w + 5, 0.06, P2, U2, N2, 4);
  }
  const g = new T.Group();
  const mk = (P, U, N, mat) => { if (!P.length) return; const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(P, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); geo.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); geo.computeBoundingSphere(); const m = new T.Mesh(geo, mat); m.renderOrder = 1; m.receiveShadow = true; g.add(m); W.stats.tris += P.length / 9; };
  mk(P2, U2, N2, MAT.walk); mk(P, U, N, MAT.road);
  return g;
}
// דקל פרוצדורלי (~180 משולשים): גזע מתחדד עם טבעות, "חצאית" כפות יבשות, 9 כפות מתעקלות עם עורק מרכזי. צבעים בקודקודים.
function palmGeo(lo) {
  const P = [], C = [], I = []; const v = (x, y, z, r, g, b) => { P.push(x, y, z); C.push(r, g, b); return P.length / 3 - 1; };
  const H = 7, SEG = lo ? 5 : 7, RING = lo ? 2 : 6;
  for (let j = 0; j <= RING; j++) { const u = j / RING, y = u * H, rad = 0.3 - 0.11 * u + 0.03 * Math.sin(u * 9), dk = j % 2 ? 0.86 : 1;
    for (let k = 0; k < SEG; k++) { const a = k / SEG * Math.PI * 2; v(Math.cos(a) * rad, y, Math.sin(a) * rad, 0.52 * dk, 0.40 * dk, 0.28 * dk); } }
  for (let j = 0; j < RING; j++) for (let k = 0; k < SEG; k++) { const a = j * SEG + k, b = j * SEG + (k + 1) % SEG; I.push(a, b, a + SEG, b, b + SEG, a + SEG); }
  const NF = lo ? 6 : 9, NS = lo ? 2 : 4, L = 3.4;
  for (let f = 0; f < NF; f++) {
    const ang = f / NF * Math.PI * 2 + (f % 2) * 0.2, ca = Math.cos(ang), sa = Math.sin(ang), dry = f >= NF - 2, up = 0.55 - (f % 3) * 0.18 - (dry ? 0.5 : 0);
    let base = -1;
    for (let s = 0; s <= NS; s++) { const u = s / NS, r = u * L, y = H + 0.15 + up * u * 2.2 - 1.9 * u * u, w = 0.62 * Math.sin(Math.PI * Math.min(1, u * 1.08 + 0.04)), rib = 0.14 * (1 - u);
      const g0 = dry ? [0.55, 0.47, 0.30] : [0.20 + 0.10 * u, 0.36 + 0.14 * u, 0.13 + 0.03 * u];
      const cx = ca * r, cz = sa * r, px = -sa * w, pz = ca * w;
      const m = v(cx, y + rib, cz, g0[0], g0[1], g0[2]), l = v(cx + px, y - 0.12 * w, cz + pz, g0[0] * 0.8, g0[1] * 0.8, g0[2] * 0.8), rr = v(cx - px, y - 0.12 * w, cz - pz, g0[0] * 0.8, g0[1] * 0.8, g0[2] * 0.8);
      if (base >= 0) { const pm = base, pl = base + 1, pr = base + 2; I.push(pm, pl, m, pl, l, m, pm, m, pr, m, rr, pr); }
      base = m; }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
/** הדקלים הקרובים (עד 48, רדיוס 140 מ'): גאומטריה מלאה + צל. מתעדכן כשזזים 12 מ'. העותק הזול באריח מוקטן לאפס במקומם. */
let NEARP = null, nearHidden = [], lastNP = null; const _pm = new T.Matrix4(), _p0 = new T.Matrix4().makeScale(0, 0, 0);
W.updatePalms = function (px, pz, scene) {
  if (lastNP && Math.hypot(px - lastNP.x, pz - lastNP.z) < 12) return; lastNP = { x: px, z: pz };
  if (!NEARP) { NEARP = new T.InstancedMesh(palmGeo(false), MAT.palm, 48); NEARP.castShadow = true; NEARP.frustumCulled = false; NEARP.count = 0; scene.add(NEARP); }
  for (const [im, i, m] of nearHidden) { im.setMatrixAt(i, m); im.instanceMatrix.needsUpdate = true; } nearHidden = [];
  const cand = [];
  for (const t of W.tiles.values()) { if (!t.palms || !t.palms.visible) continue; const im = t.palms.children[0], P = t.palms.userData.xz;
    for (let i = 0; i < P.length / 2; i++) { const d = (P[i * 2] - px) ** 2 + (P[i * 2 + 1] - pz) ** 2; if (d < 140 * 140) cand.push([d, im, i]); } }
  cand.sort((a, b) => a[0] - b[0]); let k = 0;
  for (const [, im, i] of cand) { if (k >= 48) break; im.getMatrixAt(i, _pm); NEARP.setMatrixAt(k++, _pm); nearHidden.push([im, i, _pm.clone()]); im.setMatrixAt(i, _p0); im.instanceMatrix.needsUpdate = true; }
  NEARP.count = k; NEARP.instanceMatrix.needsUpdate = true;
};
// ---------- רהוט רחוב: צמתים (מהגאומטריה האמיתית של OSM), רמזורים ומעברי חציה (מיקום משוער!), שלטי רחוב (שמות OSM), עצי רחוב
// אין בנתונים שלנו צמתים מרומזרים (OSM highway=traffic_signals לא נמשך – Overpass חסום מהסביבה הזו). לכן: רמזור + מעבר חציה
// בכל צומת של לפחות שני זרועות כביש ראשי (c≥3) ושלוש זרועות c≥2 – מסומן "משוער" בממשק. שמות הרחובות אמיתיים (OSM, ODbL).
W.junctionsOf = t => junctionsOf(t);
function junctionsOf(t) {
  if (t.junc) return t.junc; const M = new Map();
  t.roads.forEach((r, ri) => { const p = r.p, n = p.length / 2; for (let i = 0; i < n; i++) { const k = Math.round(p[i * 2] * 2) + ',' + Math.round(p[i * 2 + 1] * 2);
    let e = M.get(k); if (!e) M.set(k, e = { x: p[i * 2], z: p[i * 2 + 1], arms: [], roads: new Set() }); e.roads.add(ri);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < n) { const dx = p[j * 2] - p[i * 2], dz = p[j * 2 + 1] - p[i * 2 + 1], l = Math.hypot(dx, dz); if (l > 0.5) e.arms.push({ dx: dx / l, dz: dz / l, w: r.w, c: r.c, name: r.name, ri }); } } });
  const out = [];
  for (const e of M.values()) { if (e.roads.size < 2) continue; const a2 = e.arms.filter(a => a.c >= 2); if (a2.length < 3) continue;
    e.major = new Set(e.arms.filter(a => a.c >= 3).map(a => a.name || ('#' + a.ri))).size >= 2; /* שני כבישים ראשיים שונים נחתכים */ e.maxW = Math.max(...a2.map(a => a.w)); e.arms = a2; e.y = tileH(t, e.x + W.OX, W.OY - e.z); out.push(e); }
  return t.junc = out;
}
function mergeColored(parts) {   // [{geo, color:[r,g,b]}] → BufferGeometry אחת עם צבע בקודקודים
  const P = [], N = [], C = [];
  for (const { geo, color } of parts) { const g = geo.index ? geo.toNonIndexed() : geo; g.computeVertexNormals(); const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) { P.push(p[i], p[i + 1], p[i + 2]); N.push(n[i], n[i + 1], n[i + 2]); C.push(color[0], color[1], color[2]); } }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3)); return g;
}
let POLE_GEO = null, LAMP_GEO = null, TREE_GEO = null;
const LAMP_ON = [new T.Color(1, 0.12, 0.08), new T.Color(1, 0.72, 0.05), new T.Color(0.1, 1, 0.35)], LAMP_OFF = new T.Color(0.07, 0.07, 0.07);
function furniture(t) {
  if (!t.roads || !t.roads.length) return null;
  if (!POLE_GEO) {
    const pole = new T.CylinderGeometry(0.07, 0.09, 3.6, 5, 1, true); pole.translate(0, 1.8, 0);
    const head = new T.BoxGeometry(0.34, 1.0, 0.26); head.translate(0, 3.25, 0.12);
    const visor = new T.BoxGeometry(0.36, 0.04, 0.2); visor.translate(0, 3.72, 0.32);
    POLE_GEO = mergeColored([{ geo: pole, color: [0.32, 0.33, 0.35] }, { geo: head, color: [0.13, 0.13, 0.14] }, { geo: visor, color: [0.1, 0.1, 0.1] }]);
    LAMP_GEO = new T.CircleGeometry(0.1, 6); LAMP_GEO.translate(0, 0, 0.255);
    const tr = new T.CylinderGeometry(0.12, 0.17, 2.6, 5, 1, true); tr.translate(0, 1.3, 0); const cr = new T.IcosahedronGeometry(2.0, 0); cr.scale(1, 0.8, 1); cr.translate(0, 3.7, 0);
    const cr2 = new T.IcosahedronGeometry(1.3, 0); cr2.translate(0.9, 4.4, 0.4);
    TREE_GEO = mergeColored([{ geo: tr, color: [0.40, 0.31, 0.22] }, { geo: cr, color: [0.24, 0.40, 0.17] }, { geo: cr2, color: [0.30, 0.47, 0.20] }]);
  }
  const g = new T.Group(), J = junctionsOf(t), m = new T.Matrix4(), q = new T.Quaternion(), one = new T.Vector3(1, 1, 1), up = new T.Vector3(0, 1, 0);
  // רמזורים: עמוד בצד ימין של כל זרוע נכנסת, פונה לתנועה המתקרבת
  const poles = [], zebra = [];
  for (const e of J) { if (!e.major) continue; const d0 = e.arms[0], hs = hash32(e.x.toFixed(0) + e.z.toFixed(0)) % 60;
    for (const a of e.arms) { const back = e.maxW / 2 + 3, rx = a.dz, rz = -a.dx, px = e.x + a.dx * back + rx * (a.w / 2 + 1.2), pz = e.z + a.dz * back + rz * (a.w / 2 + 1.2);
      if (W.buildingAt(px, pz, 0.5)) continue;
      poles.push({ x: px, z: pz, y: e.y, yaw: Math.atan2(a.dx, a.dz), axis: Math.abs(a.dx * d0.dx + a.dz * d0.dz) > 0.7 ? 0 : 1, ph: hs });
      const cx = e.x + a.dx * (e.maxW / 2 + 1.6), cz = e.z + a.dz * (e.maxW / 2 + 1.6), ns = Math.floor(a.w / 1.0);   // מעבר חציה: פסים במקביל לכיוון הנסיעה
      for (let s = 0; s < ns; s++) { const o = -a.w / 2 + 0.5 + s * 1.0; zebra.push(cx + rx * o, cz + rz * o, a.dx, a.dz, rx, rz, e.y + 0.11 + a.c * 0.015 + 0.03); } } }
  t.sigPoles = poles; t.zebra = zebra;   // נתונים בלבד; הציור דרך W.updateStreet (הקרובים)
  // עצי רחוב (פיקוס, מקורב) לאורך רחובות c=2, כל 18 מ'
  const tp = [];
  for (const r of t.roads) { if (r.c !== 2) continue; const p = r.p; let acc = 9;
    for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue; const dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let s = acc; s < L; s += 18) { const side = (Math.floor(s / 18) % 2) ? 1 : -1, off = r.w / 2 + 2.4, x = ax + dx * s - dz * off * side, z = az + dz * s + dx * off * side; if (!W.buildingAt(x, z, 2.5)) tp.push(x, z); }
      acc = (acc - L) % 18; if (acc < 0) acc += 18; } }
  // מיקומי עצים בלבד; הציור דרך W.updateTrees (הקרובים בלבד)
  t.treeXZ = tp;
  return poles.length || zebra.length || tp.length ? g : null;   // קבוצה ריקה = סימון 'אריח קרוב' לשכבות הקרובות
}
/** עצי רחוב קרובים (עד 180, רדיוס 220 מ'), קריאת ציור אחת עם צל. מתעדכן כשזזים 15 מ'. */
let TREES = null, lastTR = null;
W.updateTrees = function (px, pz, scene) {
  if (lastTR && Math.hypot(px - lastTR.x, pz - lastTR.z) < 15) return; lastTR = { x: px, z: pz };
  if (!TREES) { if (!TREE_GEO) return; TREES = new T.InstancedMesh(TREE_GEO, MAT.palm, 180); TREES.castShadow = true; TREES.frustumCulled = false; scene.add(TREES); }
  const cand = []; for (const t of W.tiles.values()) { const P = t.treeXZ; if (!P || !t.furn || !t.furn.visible) continue; for (let i = 0; i < P.length; i += 2) { const d = (P[i] - px) ** 2 + (P[i + 1] - pz) ** 2; if (d < 220 * 220) cand.push([d, P[i], P[i + 1], t]); } }
  cand.sort((a, b) => a[0] - b[0]); const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(); let k = 0;
  for (const [, x, z, t] of cand) { if (k >= 180) break; const hs = hash32(x.toFixed(1) + z.toFixed(1)), sc = 0.75 + (hs % 50) / 100; e.set(0, (hs % 628) / 100, 0); q.setFromEuler(e); s.set(sc, sc * (0.9 + (hs >> 5) % 20 / 100), sc);
    m.compose(new T.Vector3(x, tileH(t, x + W.OX, W.OY - z) - 0.1, z), q, s); TREES.setMatrixAt(k++, m); }
  TREES.count = k; TREES.instanceMatrix.needsUpdate = true;
};
/** רמזורים ומעברי חציה קרובים (רדיוס 250 מ', עד 64 עמודים): 3 קריאות ציור לכל העולם. מתעדכן כשזזים 15 מ'. */
let STREET = null, lastST = null;
W.updateStreet = function (px, pz, scene) {
  if (lastST && Math.hypot(px - lastST.x, pz - lastST.z) < 15) return; lastST = { x: px, z: pz }; if (!POLE_GEO) return;
  if (!STREET) { STREET = { pm: new T.InstancedMesh(POLE_GEO, MAT.palm, 64), lm: new T.InstancedMesh(LAMP_GEO, MAT.lamp || (MAT.lamp = new T.MeshBasicMaterial({ toneMapped: false })), 192),
      zm: new T.Mesh(new T.BufferGeometry(), MAT.zebra || (MAT.zebra = new T.MeshLambertMaterial({ color: 0xe8e8e2, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }))), poles: [] };
    STREET.pm.castShadow = true; STREET.zm.receiveShadow = true; for (const o of [STREET.pm, STREET.lm, STREET.zm]) { o.frustumCulled = false; scene.add(o); }
    for (let i = 0; i < 192; i++) STREET.lm.setColorAt(i, LAMP_OFF); }
  const cp = [], cz = []; for (const t of W.tiles.values()) { if (!t.furn || !t.furn.visible) continue;
    for (const p of t.sigPoles || []) { const d = (p.x - px) ** 2 + (p.z - pz) ** 2; if (d < 250 * 250) cp.push([d, p]); }
    const Z = t.zebra || []; for (let i = 0; i < Z.length; i += 7) { const d = (Z[i] - px) ** 2 + (Z[i + 1] - pz) ** 2; if (d < 250 * 250) cz.push(i, Z); } }
  cp.sort((a, b) => a[0] - b[0]); const m = new T.Matrix4(), lp = new T.Matrix4(), q = new T.Quaternion(), one = new T.Vector3(1, 1, 1), up = new T.Vector3(0, 1, 0), off = new T.Vector3(); let k = 0; STREET.poles = [];
  for (const [, p] of cp) { if (k >= 64) break; q.setFromAxisAngle(up, p.yaw); const base = new T.Vector3(p.x, p.y, p.z); m.compose(base, q, one); STREET.pm.setMatrixAt(k, m);
    for (let j = 0; j < 3; j++) { off.set(0, 3.57 - j * 0.32, 0); lp.compose(off.applyQuaternion(q).add(base), q, one); STREET.lm.setMatrixAt(k * 3 + j, lp); } STREET.poles.push(p); k++; }
  STREET.pm.count = k; STREET.lm.count = k * 3; STREET.pm.instanceMatrix.needsUpdate = STREET.lm.instanceMatrix.needsUpdate = true; sigT = -1;
  const n = cz.length / 2, P = new Float32Array(n * 18);
  for (let s = 0; s < n; s++) { const i = cz[s * 2], Z = cz[s * 2 + 1], x = Z[i], z = Z[i + 1], dx = Z[i + 2], dz = Z[i + 3], rx = Z[i + 4], rz = Z[i + 5], y = Z[i + 6], hl = 1.5, hw = 0.25;
    [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, -hl], [hw, hl], [-hw, hl]].forEach(([u, v], c) => { P[s * 18 + c * 3] = x + rx * u + dx * v; P[s * 18 + c * 3 + 1] = y; P[s * 18 + c * 3 + 2] = z + rz * u + dz * v; }); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(P, 3)); g.computeVertexNormals(); STREET.zm.geometry.dispose(); STREET.zm.geometry = g;
};
W.streetStats = () => ({ poles: STREET ? STREET.pm.count : 0, lit: STREET ? STREET.poles.length : 0, zebra: STREET ? STREET.zm.geometry.attributes.position ? STREET.zm.geometry.attributes.position.count / 6 : 0 : 0, signs: SIGNS ? SIGNS.posts.count : 0, trees: TREES ? TREES.count : 0 });
/** מחזור רמזורים (מקורב: 60 ש', ירוק 27 / צהוב 3 / אדום 30 לכל ציר, היסט לפי צומת) */
let sigT = -1;
W.updateSignals = function (time) {
  if (!STREET || time - sigT < 0.4) return; sigT = time;
  STREET.poles.forEach((p, i) => { const c = ((time + p.ph) % 60 + 60) % 60, tc = p.axis ? (c + 30) % 60 : c, st = tc < 27 ? 2 : tc < 30 ? 1 : 0;
    for (let k = 0; k < 3; k++) STREET.lm.setColorAt(i * 3 + k, k === st ? LAMP_ON[st] : LAMP_OFF); });
  if (STREET.lm.instanceColor) STREET.lm.instanceColor.needsUpdate = true;
};
/** שלטי רחוב: עד 12 צמתים קרובים (120 מ'), שלט כחול עם שם הרחוב מ-OSM בכל זרוע עם שם (עד 2 לצומת).
 *  כל השלטים בקריאת ציור אחת (אטלס טקסטורה) + עמודים בקריאה אחת. */
let SIGNS = null, lastSG = null;
W.updateSigns = function (px, pz, scene) {
  if (lastSG && Math.hypot(px - lastSG.x, pz - lastSG.z) < 15) return; lastSG = { x: px, z: pz };
  if (!SIGNS) { const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    SIGNS = { cv, tex, plate: new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ map: tex })), posts: new T.InstancedMesh((() => { const g = new T.CylinderGeometry(0.04, 0.04, 2.7, 5, 1, true); g.translate(0, 1.35, 0); return g; })(), new T.MeshLambertMaterial({ color: 0x8a8d90 }), 32) };
    SIGNS.plate.frustumCulled = false; SIGNS.posts.frustumCulled = false; scene.add(SIGNS.plate, SIGNS.posts); }
  const cand = []; for (const t of W.tiles.values()) { if (!t.roads || !t.hi) continue; for (const e of junctionsOf(t)) { const d = (e.x - px) ** 2 + (e.z - pz) ** 2; if (d < 120 * 120) cand.push([d, e]); } }
  cand.sort((a, b) => a[0] - b[0]);
  const x2 = SIGNS.cv.getContext('2d'), P = [], U = [], I = [], m = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), one = new T.Vector3(1, 1, 1); let k = 0;
  x2.clearRect(0, 0, 1024, 512);
  for (const [, e] of cand.slice(0, 12)) { const seen = new Set();
    for (const a of e.arms) { if (k >= 32 || !a.name || seen.has(a.name) || seen.size >= 2) continue; seen.add(a.name);
      const lx = -a.dz, lz = a.dx, x = e.x + a.dx * (e.maxW / 2 + 2.2) + lx * (a.w / 2 + 1.0), z = e.z + a.dz * (e.maxW / 2 + 2.2) + lz * (a.w / 2 + 1.0);
      if (W.buildingAt(x, z, 0.4)) continue;
      const col = k % 4, row = k >> 2, ox = col * 256, oy = row * 64;   // משבצת באטלס
      x2.fillStyle = '#1d4f91'; x2.fillRect(ox, oy, 256, 64); x2.strokeStyle = '#fff'; x2.lineWidth = 4; x2.strokeRect(ox + 4, oy + 4, 248, 56); x2.fillStyle = '#fff'; x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.direction = 'rtl';
      let fs = 34; x2.font = `bold ${fs}px Heebo, Arial, sans-serif`; while (x2.measureText(a.name).width > 230 && fs > 14) { fs -= 2; x2.font = `bold ${fs}px Heebo, Arial, sans-serif`; } x2.fillText(a.name, ox + 128, oy + 34);
      const u0 = ox / 1024, u1 = (ox + 256) / 1024, v1 = 1 - oy / 512, v0 = 1 - (oy + 64) / 512;
      const yaw = Math.atan2(a.dx, a.dz) + Math.PI / 2, cx = Math.cos(yaw), sx = Math.sin(yaw), hw = 0.65, y0 = e.y + 2.39, y1 = e.y + 2.72;
      for (const s of [1, -1]) {   // שני צדי הלוח, כל צד קריא (UV הפוך בגב)
        const nx = sx * 0.012 * s, nz = cx * 0.012 * s, b = P.length / 3, ax = cx * hw * s, az = -sx * hw * s;
        P.push(x - ax + nx, y0, z - az + nz, x + ax + nx, y0, z + az + nz, x + ax + nx, y1, z + az + nz, x - ax + nx, y1, z - az + nz);
        U.push(u0, v0, u1, v0, u1, v1, u0, v1); I.push(b, b + 1, b + 2, b, b + 2, b + 3); }
      q.setFromAxisAngle(up, yaw); m.compose(new T.Vector3(x, e.y, z), q, one); SIGNS.posts.setMatrixAt(k, m); k++; } }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setIndex(I);
  SIGNS.plate.geometry.dispose(); SIGNS.plate.geometry = g; SIGNS.posts.count = k; SIGNS.posts.instanceMatrix.needsUpdate = true; SIGNS.tex.needsUpdate = true;
};
// עצי דקל לאורך שדרות (c≥3)
let TRUNK_GEO = null, CROWN_GEO = null;
function palms(t) {
  const pos = [];
  for (const r of t.roads) { if (r.c < 3) continue; const p = r.p; let acc = 11;
    for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let s = acc; s < L; s += 22) { const off = r.w / 2 + 3.2, x = ax + dx * s - dz * off, z = az + dz * s + dx * off; pos.push(x, z); }
      acc = (acc - L) % 22; if (acc < 0) acc += 22; } }
  const ok = []; for (let i = 0; i < pos.length; i += 2) { const x = pos[i], z = pos[i + 1]; if (!W.buildingAt(x, z, 1.5)) ok.push(x, z); }
  const n = ok.length / 2; if (!n) return null;
  if (!TRUNK_GEO) TRUNK_GEO = palmGeo(true);   // דקלי האריח: גרסה זולה (~70 משולשים) בלי הטלת צל; הקרובים מתחלפים בגרסה המלאה (W.updatePalms)
  const a = new T.InstancedMesh(TRUNK_GEO, MAT.palm, n); const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), e = new T.Euler();
  for (let i = 0; i < n; i++) { const x = ok[i * 2], z = ok[i * 2 + 1], hs = hash32(x.toFixed(1) + z.toFixed(1)), sc = 0.8 + (hs % 50) / 100; e.set(((hs >> 3) % 10 - 5) / 100, (hs % 628) / 100, ((hs >> 7) % 10 - 5) / 100); q.setFromEuler(e); s.set(sc, sc, sc);
    m.compose(new T.Vector3(x, tileH(t, x + W.OX, W.OY - z) - 0.2, z), q, s); a.setMatrixAt(i, m); }
  a.castShadow = false; const g = new T.Group(); g.add(a); g.userData.xz = ok; g.userData.n = n; return g;
}

// ---------- קרקע
function terrainMesh(t) {
  const pos = new Float32Array(NT * NT * 3), col = new Float32Array(NT * NT * 3), uv = new Float32Array(NT * NT * 2);
  const x0 = t.tx * TILE - W.OX, z0 = -((t.ty + 1) * TILE - W.OY);
  for (let r = 0; r < NT; r++) for (let k = 0; k < NT; k++) {
    const i = r * NT + k, h = t.hgt[i], x = x0 + k * STEP, z = z0 + r * STEP;
    pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z; uv[i * 2] = x / 18; uv[i * 2 + 1] = z / 18;
    const n = (hash32(((x | 0) * 73856093 ^ (z | 0) * 19349663) + '') % 1000) / 1000;
    let c;
    if (h < 0) c = [0.78, 0.72, 0.58];                 // קרקעית חול רטוב
    else if (h < 3.5) c = [0.90, 0.83, 0.66];          // חוף
    else if (t.wild && t.wild[i]) c = [0.80 - n * 0.06, 0.73 - n * 0.05, 0.55];   // חולות (מחוץ לאזור המחקר)
    else c = n < 0.45 ? [0.60, 0.58, 0.52] : n < 0.8 ? [0.52, 0.56, 0.42] : [0.42, 0.52, 0.32]; // עירוני / צמחייה
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  const idx = [];
  for (let r = 0; r < NT - 1; r++) for (let k = 0; k < NT - 1; k++) { const a = r * NT + k, b = a + 1, d = a + NT, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  W.stats.tris += idx.length / 3;
  const m = new T.Mesh(g, MAT.terrain); m.name = 'terrain'; m.receiveShadow = true; return m;
}

// ---------- אינדקס מרחבי
function hk(i, j) { return i * 100003 + j; }
function indexAdd(b) { for (let i = Math.floor(b.minx / HC); i <= Math.floor(b.maxx / HC); i++) for (let j = Math.floor(b.minz / HC); j <= Math.floor(b.maxz / HC); j++) { const k = hk(i, j); let a = hash.get(k); if (!a) hash.set(k, a = []); a.push(b); } }
function indexRemove(b) { for (let i = Math.floor(b.minx / HC); i <= Math.floor(b.maxx / HC); i++) for (let j = Math.floor(b.minz / HC); j <= Math.floor(b.maxz / HC); j++) { const k = hk(i, j), a = hash.get(k); if (!a) continue; const x = a.indexOf(b); if (x >= 0) a.splice(x, 1); if (!a.length) hash.delete(k); } }
const _seen = new Set(), _res = [];
W.near = function (x, z, r) {
  _res.length = 0; _seen.clear();
  for (let i = Math.floor((x - r) / HC); i <= Math.floor((x + r) / HC); i++) for (let j = Math.floor((z - r) / HC); j <= Math.floor((z + r) / HC); j++) {
    const a = hash.get(hk(i, j)); if (!a) continue;
    for (const b of a) { if (_seen.has(b)) continue; _seen.add(b); if (x + r < b.minx || x - r > b.maxx || z + r < b.minz || z - r > b.maxz) continue; _res.push(b); } }
  return _res;
};
function pip(b, x, z) { const p = b.p, n = b.n; let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
W.pip = pip;
W.buildingAt = function (x, z, pad) { const a = W.near(x, z, pad || 0); for (const b of a) if (pip(b, x, z)) return b; if (pad) { let best = null, bd = pad; for (const b of a) { const d = edgeDist(b, x, z).d; if (d < bd) { bd = d; best = b; } } return best; } return null; };
const _ed = { d: 0, nx: 0, nz: 0, px: 0, pz: 0 };
function edgeDist(b, x, z) {
  const p = b.p, n = b.n; let bd = 1e9, bx = 0, bz = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) { const ax = p[j * 2], az = p[j * 2 + 1], cx = p[i * 2], cz = p[i * 2 + 1]; const dx = cx - ax, dz = cz - az, l2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + dx * t, qz = az + dz * t, d = (x - qx) * (x - qx) + (z - qz) * (z - qz);
    if (d < bd) { bd = d; bx = qx; bz = qz; } }
  _ed.d = Math.sqrt(bd); _ed.px = bx; _ed.pz = bz; return _ed;
}
W.edgeDist = edgeDist;
/** דוחף עיגול (x,z,r) אל מחוץ לטביעות בניינים שגובהן חותך את [y0,y1]. מחזיר {x,z,hit,nx,nz,b} */
const _col = { x: 0, z: 0, hit: false, nx: 0, nz: 0, b: null };
W.collide = function (x, z, r, y0, y1) {
  _col.hit = false; _col.b = null;
  for (let pass = 0; pass < 2; pass++) {
    const a = W.near(x, z, r + 1);
    for (const b of a) {
      if (y0 >= b.top - 0.05 || y1 <= b.base - 1) continue;
      const inside = pip(b, x, z), e = edgeDist(b, x, z);
      if (!inside && e.d >= r) continue;
      let nx = x - e.px, nz = z - e.pz; const l = Math.hypot(nx, nz) || 1e-6; nx /= l; nz /= l;
      if (inside) { nx = -nx; nz = -nz; x = e.px + nx * (r + 0.01); z = e.pz + nz * (r + 0.01); }
      else { x = e.px + nx * (r + 0.01); z = e.pz + nz * (r + 0.01); }
      _col.hit = true; _col.nx = nx; _col.nz = nz; _col.b = b;
    }
    if (!_col.hit) break;
  }
  _col.x = x; _col.z = z; return _col;
};
/** רצפה מתחת לנקודה: קרקע, או גג אם עומדים מעליו */
W.floorAt = function (x, z, y) {
  let f = W.H(x, z); const a = W.near(x, z, 0);
  for (const b of a) if (y >= b.top - 1.2 && b.top > f && pip(b, x, z)) f = b.top;
  return f;
};
/** האם על כביש (לפיזיקת רכב) */
W.onRoad = function (x, z) {
  const E = x + W.OX, N = W.OY - z, t = W.tiles.get(Math.floor(E / TILE) + '_' + Math.floor(N / TILE)); if (!t || !t.roads) return false;
  for (const r of t.roads) { const p = r.p, hw = r.w / 2 + 1; for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, l2 = dx * dx + dz * dz || 1e-9;
    let s = ((x - ax) * dx + (z - az) * dz) / l2; s = s < 0 ? 0 : s > 1 ? 1 : s; const qx = ax + dx * s - x, qz = az + dz * s - z; if (qx * qx + qz * qz < hw * hw) return r; } }
  return false;
};
W.nearestStreet = function (x, z, maxD) {
  let best = '', bd = (maxD || 250) ** 2;
  for (const t of W.tiles.values()) { if (!t.roads) continue; for (const r of t.roads) { if (!r.name) continue; const p = r.p; for (let i = 0; i < p.length; i += 2) { const d = (p[i] - x) ** 2 + (p[i + 1] - z) ** 2; if (d < bd) { bd = d; best = r.name; } } } }
  return best;
};

// ---------- טעינת אריחים
async function fetchTile(key) {
  if (fetching.has(key) || W.tiles.has(key)) return; fetching.add(key);
  try {
    const [v, tb] = await Promise.all([fetchJSON((EXTRA.has(key) ? EXTRA_BASE : BASE) + 'tiles/v/' + key + '.json.gz'), fetchBuf((EXTRA.has(key) ? EXTRA_BASE : BASE) + 'tiles/t/' + key + '.bin.gz')]);
    queue.push({ key, v, tb });
  } catch (e) { console.warn('tile', key, e.message); W._retry = W._retry || {}; W._retry[key] = Math.min(60000, (W._retry[key] || 1000) * 2); W.tiles.set(key, { key, failed: true, t: performance.now(), wait: W._retry[key] }); }
  finally { fetching.delete(key); }
}
function wildMask(tb) { const z = new Int16Array(tb.slice(20, 20 + NT * NT * 2)); const m = new Uint8Array(NT * NT); for (let i = 0; i < NT * NT; i++) m[i] = z[i] === OUT ? 1 : 0; return m; }
function buildTile(job) {
  const t0 = performance.now();
  const [tx, ty] = job.key.split('_').map(Number);
  const t = { key: job.key, tx, ty, grp: new T.Group(), cx: (tx + 0.5) * TILE - W.OX, cz: -((ty + 0.5) * TILE - W.OY) };
  const ter = decodeTerrain(job.tb, job.v); t.hgt = ter.h; t.wild = wildMask(job.tb);
  W.tiles.set(t.key, t);
  t.terrain = terrainMesh(t); t.grp.add(t.terrain);
  t.blds = decodeBuildings(t, job.v); for (const b of t.blds) indexAdd(b);
  t.roads = decodeRoads(t, job.v);
  t.roadGrp = buildRoadMeshes(t); t.grp.add(t.roadGrp);
  t.lod = -1; t.hi = null; t.lo = null;
  t.grp.name = 'tile_' + t.key; root.add(t.grp);
  W.stats.tiles++; W.stats.builds++; W.stats.buildMs += performance.now() - t0;
  if (W.onTile) W.onTile(t, 'add');
}
function flatTile(key) {      // אריח בלי נתונים: יבשה שטוחה מזרחית לקו החוף
  const [tx, ty] = key.split('_').map(Number), E = (tx + 0.5) * TILE, N = (ty + 0.5) * TILE;
  if (E <= COAST_A + COAST_B * N + 300) { W.tiles.set(key, { key, empty: true }); return; }
  const t = { key, tx, ty, grp: new T.Group(), empty: true, hgt: new Float32Array(NT * NT).fill(1.0), wild: new Uint8Array(NT * NT).fill(1), roads: [], blds: [] };
  W.tiles.set(key, t); t.grp.add(terrainMesh(t)); root.add(t.grp);
}
function setLOD(t, lod) {
  if (t.lod === lod || !t.blds) return;
  const t0 = performance.now();
  if (lod === 1 && !t.hi) { const r = buildBuildingGeo(t.blds, false); t.hi = new T.Mesh(r.geo, [MAT.wall, MAT.ind, MAT.roof, MAT.tile || MAT.roof]); t.hi.castShadow = t.hi.receiveShadow = true; t.hiTris = r.tris; t.solar = solarMesh(r.solar); if (t.solar) t.grp.add(t.solar); t.palms = palms(t); if (t.palms) t.grp.add(t.palms); t.furn = furniture(t); if (t.furn) t.grp.add(t.furn); }
  if (lod === 0 && !t.lo) { const r = buildBuildingGeo(t.blds, true); t.lo = new T.Mesh(r.geo, [MAT.lo]); t.loTris = r.tris; }
  if (t.hi) { if (lod === 1) t.grp.add(t.hi); else t.grp.remove(t.hi); }
  if (t.lo) { if (lod === 0) t.grp.add(t.lo); else t.grp.remove(t.lo); }
  if (t.solar) t.solar.visible = lod === 1; if (t.palms) t.palms.visible = lod === 1; if (t.furn) t.furn.visible = lod === 1;
  t.lod = lod; W.stats.buildMs += performance.now() - t0;
  if (W.onTile) W.onTile(t, 'lod');
}
function dispose(o) { o.traverse(m => { if (m.geometry && m.geometry !== SOLAR_GEO && m.geometry !== PANEL_GEO && m.geometry !== TRUNK_GEO && m.geometry !== CROWN_GEO && m.geometry !== POLE_GEO && m.geometry !== LAMP_GEO && m.geometry !== TREE_GEO) m.geometry.dispose(); if (m.isInstancedMesh) m.dispose(); }); }
function unload(t) {
  if (t.grp) { root.remove(t.grp); dispose(t.grp); }
  if (t.hi && !t.hi.parent) t.hi.geometry.dispose(); if (t.lo && !t.lo.parent) t.lo.geometry.dispose();
  if (t.blds) for (const b of t.blds) indexRemove(b);
  W.tiles.delete(t.key); if (W.onTile) W.onTile(t, 'remove');
}

/** קריאה בכל פריים: מה לטעון/לפרוק, ורמת פירוט. budgetMs = תקציב בנייה לפריים */
W.update = function (x, z, budgetMs) {
  if (!W.ready) return;
  const E = x + W.OX, N = W.OY - z, R = W.radius;
  const want = [];
  for (let tx = Math.floor((E - R) / TILE); tx <= Math.floor((E + R) / TILE); tx++) for (let ty = Math.floor((N - R) / TILE); ty <= Math.floor((N + R) / TILE); ty++) {
    const d = Math.hypot(Math.max(0, Math.abs((tx + 0.5) * TILE - E) - 500), Math.max(0, Math.abs((ty + 0.5) * TILE - N) - 500));
    if (d < R) want.push([tx + '_' + ty, d]);
  }
  want.sort((a, b) => a[1] - b[1]);
  for (const [k] of want) { const __ex = W.tiles.get(k); if (__ex && __ex.failed && !__ex.bad && performance.now() - __ex.t > __ex.wait) W.tiles.delete(k); else if (__ex) continue; if (TILESET.has(k)) fetchTile(k); else flatTile(k); }
  const t0 = performance.now(); let did = 0;
  queue.sort((a, b) => { const da = Math.hypot((+a.key.split('_')[0] + 0.5) * TILE - E, (+a.key.split('_')[1] + 0.5) * TILE - N), db = Math.hypot((+b.key.split('_')[0] + 0.5) * TILE - E, (+b.key.split('_')[1] + 0.5) * TILE - N); return da - db; });
  while (queue.length && (did === 0 || performance.now() - t0 < budgetMs)) { const j = queue.shift(); if (!W.tiles.has(j.key)) { try { buildTile(j); } catch (e) { console.warn('tile build failed', j.key, e.message); W.badTiles = (W.badTiles || 0) + 1; const tt = W.tiles.get(j.key); if (tt && tt.grp) root.remove(tt.grp); if (tt && tt.blds) for (const b of tt.blds) indexRemove(b); W.tiles.set(j.key, { key: j.key, failed: true, bad: true }); } } did++; }
  for (const t of W.tiles.values()) {
    if (!t.tx && t.tx !== 0) continue;
    const d = Math.hypot(Math.max(0, Math.abs((t.tx + 0.5) * TILE - E) - 500), Math.max(0, Math.abs((t.ty + 0.5) * TILE - N) - 500));
    if (d > R + 600) { unload(t); continue; }
    if (!t.blds || !t.blds.length) continue;
    const lod = d < W.hiRadius ? 1 : 0;
    if (t.lod !== lod && performance.now() - t0 < budgetMs + 4) setLOD(t, lod);
  }
  if (W.sea) { W.sea.position.x = Math.round(x / 200) * 200; W.sea.position.z = Math.round(z / 200) * 200; }
};
W.pending = () => queue.length + fetching.size;
W.triangles = () => { let n = 0; for (const t of W.tiles.values()) { if (t.lod === 1) n += t.hiTris || 0; else if (t.lod === 0) n += t.loTris || 0; n += 3200; } return n; };

W.init = async function (sc, opts) {
  scene = sc; BASE = (opts && opts.base) || BASE; root = new T.Group(); root.name = 'world'; scene.add(root); W.root = root;
  makeTextures(); makeMaterials(); W.MAT = MAT; W.TEX = TEX;
  const idx = await fetchJSON(BASE + 'index.json');
  const slug = (opts && opts.city) || Object.keys(idx.cities)[0];
  const m = await fetchJSON(BASE + idx.cities[slug].manifest);
  W.manifest = m; TILESET = new Set(m.tiles);
  const [x0, y0, x1, y1] = m.bbox_itm; W.OX = Math.round((x0 + x1) / 2); W.OY = Math.round((y0 + y1) / 2);
  W.bounds = { minx: x0 - W.OX - 300, maxx: x1 - W.OX + 300, minz: -(y1 - W.OY) - 300, maxz: -(y0 - W.OY) + 300 };
  // כיסוי מורחב: אריחי הארצי (מרכז הארץ) – ?nat=0 מכבה
  if (m.extra && !/[?&]nat=0/.test(location.search)) try {
    const x = await fetchJSON(BASE + m.extra.index); EXTRA_BASE = BASE + m.extra.base; EXTRA = new Set(x.tiles.filter(k => !TILESET.has(k)));
    for (const k of EXTRA) TILESET.add(k); W.extra = x;
    const [a0, b0, a1, b1] = x.bbox_sample; W.bounds = { minx: Math.min(W.bounds.minx, a0 - W.OX), maxx: Math.max(W.bounds.maxx, a1 - W.OX), minz: Math.min(W.bounds.minz, -(b1 - W.OY)), maxz: Math.max(W.bounds.maxz, -(b0 - W.OY)) };
  } catch (e) { console.warn('כיסוי ארצי לא נטען', e.message); }
  // ים: מישור אחד גדול בגובה 0 שעוקב אחרי השחקן (היבשה תמיד ≥ +0.6 מ', קרקעית הים −2.5 מ')
  const sg = new T.PlaneGeometry(16000, 16000, 1, 1); sg.rotateX(-Math.PI / 2);
  const uv = sg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 800, uv.getY(i) * 800);
  W.sea = new T.Mesh(sg, MAT.sea); W.sea.position.y = -0.05; W.sea.renderOrder = 2; scene.add(W.sea);
  W.ready = true; return m;
};
W.isExtra = k => EXTRA.has(k); W.tileBase = k => (EXTRA.has(k) ? EXTRA_BASE : BASE);   // לתוספים שקוראים קבצי אריח בעצמם
W.toScene = (E, N) => ({ x: E - W.OX, z: -(N - W.OY) });
W.toITM = (x, z) => ({ E: x + W.OX, N: W.OY - z });
})();
