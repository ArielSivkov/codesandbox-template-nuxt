/* לוח היזם · כיסוי ארצי · Worker מודולרי: אריח וקטורי (פורמט גדוד 5) → גאומטריה ממוזגת.
   קואורדינטות יוצאות: מטרים בסצנה, x = מזרח − E0, y = מעלה, z = −(צפון − N0)  (ITM אמיתי, EPSG:2039).
   שום שדה טקסט לא נכנס ל-HTML כאן – רק מוחזר כמחרוזת; התצוגה כותבת אותו עם textContent. */
import earcut from '../vendor/earcut.js';
import { buildingAlbedo, hexToRgb, PALETTE, srgbToLinear } from '../vendor/atmosphere/src/palette.js';
const lin = c => c.map(srgbToLinear);          // הפלטה ב-sRGB; צבעי קודקוד בשיידר הם ליניאריים

let BASE = 'data/';      // תמיד יחסי לאותו מקור (אין ?data= חיצוני – ממצא צוות אדום 2)
const Q = 10;
const ROAD_W = [3.2, 6.5, 9.5, 14];                 // רוחב לפי מחלקה (מ') – הנחה ויזואלית
const ROAD_C_HEX = ['#BDB6A8', '#5A5A5E', '#525256', '#4A4A4C'];   // מדרכה/שירות, שכונתי, עורק, ראשי (אספלט – palette.asphalt)
const LAMP_STEP = 34;                                // מרווח עמודי תאורה (מ') – הנחה
const SEA_C = lin(hexToRgb(PALETTE.seaMid));
const ROAD_C = ROAD_C_HEX.map(h => lin(hexToRgb(h)));
const LU_C = { park: [0.42, 0.52, 0.30], grass: [0.50, 0.58, 0.34], forest: [0.30, 0.42, 0.24], pitch: [0.36, 0.55, 0.30], cemetery: [0.52, 0.55, 0.42],
  beach: lin(hexToRgb(PALETTE.sand)), scrub: [0.58, 0.58, 0.42], farm: [0.66, 0.62, 0.44], water: lin(hexToRgb(PALETTE.seaShallow)) };   // צבעים: הנחה אמנותית

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

async function fetchJSONgz(url, signal) {
  const r = await fetch(url, { signal, cache: 'force-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = await r.arrayBuffer(); const u = new Uint8Array(buf, 0, 2);
  let txt;
  if (u[0] === 0x1f && u[1] === 0x8b) txt = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  else txt = new TextDecoder().decode(buf);
  return { v: JSON.parse(txt), net: buf.byteLength };
}

function decRing(r, ox, oy, E0, N0) {   // → [x0,z0,x1,z1,...] scene metres
  const n = r.length >> 1, o = new Float64Array(n * 2); let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += r[2 * i]; y += r[2 * i + 1]; o[2 * i] = ox + x / Q - E0; o[2 * i + 1] = -(oy + y / Q - N0); }
  return o;
}
function simplifyRing(r, tol) {     // דאגלס–פויקר לטבעת סגורה (LOD רחוק)
  const n = r.length >> 1; if (n <= 4) return r;
  const keep = new Uint8Array(n); keep[0] = 1; let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = (r[2 * i] - r[0]) ** 2 + (r[2 * i + 1] - r[1]) ** 2; if (d > fd) { fd = d; far = i; } }
  keep[far] = 1; const st = [[0, far], [far, n]];
  while (st.length) { const [a, b] = st.pop(), bi = b % n, ax = r[2 * a], az = r[2 * a + 1], dx = r[2 * bi] - ax, dz = r[2 * bi + 1] - az, L2 = dx * dx + dz * dz || 1e-9; let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const ii = i % n, px = r[2 * ii] - ax, pz = r[2 * ii + 1] - az, t = Math.max(0, Math.min(1, (px * dx + pz * dz) / L2)), qx = px - t * dx, qz = pz - t * dz, d = qx * qx + qz * qz; if (d > md) { md = d; mi = i; } }
    if (mi >= 0 && md > tol * tol) { keep[mi % n] = 1; st.push([a, mi], [mi, b]); } }
  const o = []; for (let i = 0; i < n; i++) if (keep[i]) o.push(r[2 * i], r[2 * i + 1]);
  return o.length >= 6 ? Float64Array.from(o) : r;
}
function signedArea(p) { let s = 0; const n = p.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; } return s / 2; }

class Buf {
  constructor() { this.p = []; this.n = []; this.c = []; this.f = []; this.s = []; this.k = []; this.idx = []; this.v = 0; }
  vert(x, y, z, nx, ny, nz, c, fb, fh, seed, kind) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(c[0] * 255 | 0, c[1] * 255 | 0, c[2] * 255 | 0); this.f.push(fb, fh); this.s.push(seed); this.k.push(kind); return this.v++; }
  out() {
    const V = this.v, I = V > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    return { pos: new Float32Array(this.p), nor: new Int8Array(this.n.map(v => Math.round(v * 127))), col: new Uint8Array(this.c), afl: new Float32Array(this.f), aseed: new Float32Array(this.s), akind: new Float32Array(this.k), index: I, verts: V };
  }
}

function buildTile(v, E0, N0, lod) {
  const [ox, oy] = v.o; const B = new Buf(), G = new Buf();
  const meta = { ids: [], names: [], typ: [], h: [], sg: [], f: [], he: [], src: [], cx: [], cz: [], triStart: [] };
  let bi = 0;
  for (const b of v.b || []) {
    if (!b || !Array.isArray(b.r) || !b.r.length) continue;                         // רשומה פגומה – מדלגים (ממצא 6)
    const h = Math.max(2.5, (+b.h || 30) / Q), base = (+b.z || 0) / Q, seed = (hashStr(String(b.i)) % 9973) + 0.5;
    if (lod === 0 && (+b.a || 0) < 40) continue;                                   // LOD רחוק: בלי מחסנים/סככות קטנים
    const rings = []; for (let k = 0; k < b.r.length; k++) { let r = decRing(b.r[k], ox, oy, E0, N0); if (lod === 0) r = simplifyRing(r, 1.0); if (r.length >= 6) rings.push(r); }
    if (!rings.length) continue;
    const alb0 = buildingAlbedo(String(b.i), b.t || '', h, b.rs === 'gabled' || b.rs === 'hipped'), alb = { wall: lin(alb0.wall), roof: lin(alb0.roof) };
    meta.triStart.push(B.idx.length / 3);
    const top = base + h;
    // קירות (כולל חצרות פנימיות – ממצא 17)
    for (let k = 0; k < rings.length; k++) {
      const r = rings[k], n = r.length >> 1; const ccw = signedArea(r) > 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n; let x0 = r[2 * i], z0 = r[2 * i + 1], x1 = r[2 * j], z1 = r[2 * j + 1];
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.05) continue;
        // נורמל החוצה: בטבעת חיצונית ובחצר – לפי כיוון הטבעת במישור x,z (z = −צפון הופך את הכיוון)
        let nx = dz / L, nz = -dx / L; const outer = k === 0; if ((ccw ? 1 : -1) * (outer ? 1 : -1) < 0) { nx = -nx; nz = -nz; }
        const a = B.vert(x0, base, z0, nx, 0, nz, alb.wall, base * 10, 30, seed, 0), b1 = B.vert(x1, base, z1, nx, 0, nz, alb.wall, base * 10, 30, seed, 0);
        const c = B.vert(x1, top, z1, nx, 0, nz, alb.wall, base * 10, 30, seed, 0), d = B.vert(x0, top, z0, nx, 0, nz, alb.wall, base * 10, 30, seed, 0);
        if (nx * (-(z1 - z0)) + nz * (x1 - x0) >= 0) B.idx.push(a, b1, c, a, c, d); else B.idx.push(a, c, b1, a, d, c);
      }
    }
    // גג
    const flat = [], holes = []; rings.forEach((r, k) => { if (k) holes.push(flat.length >> 1); for (let i = 0; i < r.length; i++) flat.push(r[i]); });
    const tri = earcut(flat, holes, 2); const v0 = B.v;
    for (let i = 0; i < flat.length; i += 2) B.vert(flat[i], top, flat[i + 1], 0, 1, 0, alb.roof, base * 10, 30, seed, 0);
    for (let i = 0; i < tri.length; i += 3) {
      const ax = flat[2 * tri[i]], az = flat[2 * tri[i] + 1], bx = flat[2 * tri[i + 1]], bz = flat[2 * tri[i + 1] + 1], cx = flat[2 * tri[i + 2]], cz = flat[2 * tri[i + 2] + 1];
      const up = (bx - ax) * (cz - az) - (bz - az) * (cx - ax) < 0;            // צריך פנים כלפי מעלה (y)
      if (up) B.idx.push(v0 + tri[i], v0 + tri[i + 1], v0 + tri[i + 2]); else B.idx.push(v0 + tri[i], v0 + tri[i + 2], v0 + tri[i + 1]);
    }
    let cx = 0, cz = 0; const o = rings[0], m = o.length >> 1; for (let i = 0; i < m; i++) { cx += o[2 * i]; cz += o[2 * i + 1]; }
    meta.ids.push(String(b.i)); meta.names.push(String(b.n || '')); meta.typ.push(String(b.t || '')); meta.h.push(h); meta.sg.push((+b.s || 0) / Q);
    meta.f.push(+b.f || 0); meta.he.push(String(b.he || (b.src === 'R' ? 'משוער' : ''))); meta.src.push(String(b.src || '')); meta.cx.push(cx / m); meta.cz.push(cz / m);
    bi++;
  }
  // כבישים: סרטים שטוחים; פנסים לאורך כבישים מחלקה ≥1
  const lamps = [], lampStreet = [];
  for (const rd of v.rd || []) {
    if (!rd || !Array.isArray(rd.r)) continue;
    const c = Math.max(0, Math.min(3, rd.c | 0)), w = ROAD_W[c] / 2, col = ROAD_C[c], p = decRing(rd.r, ox, oy, E0, N0), n = p.length >> 1;
    let acc = LAMP_STEP * 0.5, side = 1;
    for (let i = 0; i < n - 1; i++) {
      const x0 = p[2 * i], z0 = p[2 * i + 1], x1 = p[2 * i + 2], z1 = p[2 * i + 3], dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.01) continue;
      const nx = -dz / L * w, nz = dx / L * w, y = 0.06 + c * 0.01;
      const a = G.vert(x0 + nx, y, z0 + nz, 0, 1, 0, col, 0, 0, 0, 1), b1 = G.vert(x0 - nx, y, z0 - nz, 0, 1, 0, col, 0, 0, 0, 1);
      const cc = G.vert(x1 - nx, y, z1 - nz, 0, 1, 0, col, 0, 0, 0, 1), d = G.vert(x1 + nx, y, z1 + nz, 0, 1, 0, col, 0, 0, 0, 1);
      G.idx.push(a, cc, b1, a, d, cc);
      if (c >= 1) { while (acc < L) { const t = acc / L, s = side * (w + 1.6) / w; lamps.push(x0 + dx * t + nx * s, z0 + dz * t + nz * s); lampStreet.push(rd.n || ''); side = -side; acc += LAMP_STEP; } acc -= L; }
    }
  }
  // שימושי קרקע (פארקים/דשא/חול/תעשייה) – כשהמקור כולל אותם (PBF של גיאופבריק; לא בנתוני TAMA)
  for (const lu of v.lu || []) {
    const col = LU_C[lu && lu.k]; if (!col || !Array.isArray(lu.r)) continue;
    const flat = [], holes = []; lu.r.forEach((r, k) => { const d = decRing(r, ox, oy, E0, N0); if (k) holes.push(flat.length >> 1); for (let i = 0; i < d.length; i++) flat.push(d[i]); });
    const tri = earcut(flat, holes, 2), v0 = G.v, kind = lu.k === 'water' ? 2 : 1, y = lu.k === 'water' ? 0.03 : 0.02;
    for (let i = 0; i < flat.length; i += 2) G.vert(flat[i], y, flat[i + 1], 0, 1, 0, col, 0, 0, 0, kind);
    for (let i = 0; i < tri.length; i += 3) G.idx.push(v0 + tri[i], v0 + tri[i + 1], v0 + tri[i + 2]);
  }
  // ים (מצולעי ים חתוכים לאריח)
  for (const poly of v.sea || []) {
    const flat = [], holes = []; poly.forEach((r, k) => { const d = decRing(r, ox, oy, E0, N0); if (k) holes.push(flat.length >> 1); for (let i = 0; i < d.length; i++) flat.push(d[i]); });
    const tri = earcut(flat, holes, 2), v0 = G.v;
    for (let i = 0; i < flat.length; i += 2) G.vert(flat[i], 0.03, flat[i + 1], 0, 1, 0, SEA_C, 0, 0, 0, 2);
    for (let i = 0; i < tri.length; i += 3) {
      const ax = flat[2 * tri[i]], az = flat[2 * tri[i] + 1], bx = flat[2 * tri[i + 1]], bz = flat[2 * tri[i + 1] + 1], cx = flat[2 * tri[i + 2]], cz = flat[2 * tri[i + 2] + 1];
      if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) < 0) G.idx.push(v0 + tri[i], v0 + tri[i + 1], v0 + tri[i + 2]); else G.idx.push(v0 + tri[i], v0 + tri[i + 2], v0 + tri[i + 1]);
    }
  }
  return { b: B.out(), g: G.out(), meta, lamps: new Float32Array(lamps), lampStreet, count: bi };
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'cfg') { const u = new URL(String(m.base || 'data/'), self.location.href); if (u.origin === self.location.origin) BASE = u.href; return; }   // רק אותו מקור
  if (m.type !== 'tile') return;
  const t0 = performance.now();
  try {
    if (!/^\d{2,3}_\d{3}$/.test(m.key)) throw new Error('bad key');
    const { v, net } = await fetchJSONgz(BASE + 'tiles/v/' + m.key + '.json.gz');
    const r = buildTile(v, m.E0, m.N0, m.lod);
    const tr = [r.b.pos.buffer, r.b.nor.buffer, r.b.col.buffer, r.b.afl.buffer, r.b.aseed.buffer, r.b.akind.buffer, r.b.index.buffer,
      r.g.pos.buffer, r.g.nor.buffer, r.g.col.buffer, r.g.afl.buffer, r.g.aseed.buffer, r.g.akind.buffer, r.g.index.buffer, r.lamps.buffer];
    self.postMessage({ type: 'tile', key: m.key, req: m.req, ok: true, res: r, net, ms: performance.now() - t0 }, tr);
  } catch (err) {
    self.postMessage({ type: 'tile', key: m.key, req: m.req, ok: false, err: String(err && err.message || err) });
  }
};
