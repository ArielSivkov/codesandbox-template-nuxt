// sunrise_scene.mjs — builds the scene for the sunrise plate (data + light), in plate pixels.
// Everything geometric comes from the twin-world tiles named in plates/AREA.json; everything about the sun from ../sky.js.
// What is not data is returned with a label ('סכמטי' / 'משוער') so the page can print it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as Sky from '../sky.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const SEA = -32768, OUTSIDE = -32767;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ───────────────────────────── colour helpers (linear light, same maths as sky.js) ─────────────────────────────
const toLin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
export const lin = hex => Sky.hexToRgb(hex).map(toLin);
export const hexOf = l => Sky.rgbToHex(l.map(toSrgb));
export const scaleHex = (hex, k) => hexOf(lin(hex).map(v => v * k));
export const mix = (a, b, t) => Sky.mixHex(a, b, t);
export const Y = hex => Sky.luminance(hex);

// ───────────────────────────── twin-world data (git objects of the twin-world branch) ─────────────────────────────
export function loadTwin({ repo, ref, area }) {
  const show = p => execFileSync('git', ['-C', repo, 'show', `${ref}:${p}`], { maxBuffer: 64 << 20 });
  const tdir = area.source.tilesPath;                                        // twin/integration/world/data/tiles
  const gdir = 'twin/integration/world/mods/vegetation/data/tiles/g';        // land-cover layer of the twin (vegetation dept.)
  const manifest = JSON.parse(show(area.source.manifest).toString('utf8'));
  return { show, tdir, gdir, manifest };
}

export function buildScene(opt) {
  const { repo, area, style, W = 2400, H = 1350 } = opt;
  const ref = opt.ref || area.source.commit;
  const tw = loadTwin({ repo, ref, area });

  // ---------- area frame (AREA.json): u along u_az (screen right), v along v_az (away from the camera)
  const [CX, CY] = area.center_sample;
  const uAz = area.axes.u_az_deg * D2R, vAz = area.axes.v_az_deg * D2R;
  const UD = [Math.sin(uAz), Math.cos(uAz)], VD = [Math.sin(vAz), Math.cos(vAz)];
  const [U0, U1] = area.u_range_m, [V0, V1] = area.v_range_m;
  const toUV = (E, N) => { const dx = E - CX, dy = N - CY; return [dx * UD[0] + dy * UD[1], dx * VD[0] + dy * VD[1]]; };
  const toEN = (u, v) => [CX + u * UD[0] + v * VD[0], CY + u * UD[1] + v * VD[1]];

  // ---------- the moment: true sunrise (sky.js) at the area centre
  const place = { lat: area.center_wgs84[0], lon: area.center_wgs84[1], elevation: 0 };
  const day = new Date('2026-11-24T10:00:00Z');
  const times = Sky.sunTimes(day, place);
  const T0 = times.sunrise;
  const sp = Sky.sunPosition(T0, place);
  const rayAlt = sp.altApparent + sp.semidiameter;            // upper limb, apparent: the first light that reaches the city
  const sunAz = sp.az;
  const sky = Sky.skyColors(new Date(T0.getTime() + 1000), place);   // +1 s: the model treats the sun as risen
  const lt = Sky.localTime(T0);
  const moonT = Sky.moonTimes(day, place);
  const moonAtSet = moonT.set ? Sky.moonPosition(moonT.set, place) : null;
  const ladder = [10, 20, 30, 60].map(m => {
    const t = new Date(T0.getTime() + m * 60000), p = Sky.sunPosition(t, place);
    return { min: m, local: Sky.localTime(t).hhmm, altApp: p.altApparent, az: p.az, shadow10: 10 / Math.tan(p.altApparent * D2R) };
  });

  // ---------- tiles: the area plus 2.4 km toward the sun (what can block the first light)
  const corners = [[U0, V0], [U1, V0], [U1, V1], [U0, V1]].map(([u, v]) => toEN(u, v));
  const SX = Math.sin(sunAz * D2R), SY = Math.cos(sunAz * D2R), REACH = 2400;
  const ext = [...corners, ...corners.map(([x, y]) => [x + SX * REACH, y + SY * REACH])];
  const bx0 = Math.min(...ext.map(p => p[0])), bx1 = Math.max(...ext.map(p => p[0]));
  const by0 = Math.min(...ext.map(p => p[1])), by1 = Math.max(...ext.map(p => p[1]));
  const keys = [];
  for (let tx = Math.floor(bx0 / 1000); tx <= Math.floor(bx1 / 1000); tx++)
    for (let ty = Math.floor(by0 / 1000); ty <= Math.floor(by1 / 1000); ty++)
      if (tw.manifest.tiles.includes(`${tx}_${ty}`)) keys.push(`${tx}_${ty}`);
  const decRing = (r, ox, oy) => { const out = []; let x = ox, y = oy; for (let i = 0; i < r.length; i += 2) { x += r[i] / 10; y += r[i + 1] / 10; out.push([x, y]); } return out; };
  const vt = {}, tt = {}, gt = {};
  for (const k of keys) {
    vt[k] = JSON.parse(zlib.gunzipSync(tw.show(`${tw.tdir}/v/${k}.json.gz`)).toString('utf8'));
    const b = zlib.gunzipSync(tw.show(`${tw.tdir}/t/${k}.bin.gz`));
    const NT = b.readUInt16LE(14), NM = b.readUInt16LE(16), step = b.readUInt16LE(18);
    const z = new Int16Array(NT * NT); for (let i = 0; i < NT * NT; i++) z[i] = b.readInt16LE(20 + i * 2);
    const mb = b.subarray(20 + NT * NT * 2), mask = new Uint8Array(NM * NM);
    for (let i = 0; i < NM * NM; i++) mask[i] = (mb[i >> 3] >> (7 - (i & 7))) & 1;
    const [tx, ty] = k.split('_').map(Number);
    tt[k] = { tx, ty, NT, NM, step, z, mask };
    try {
      const g = JSON.parse(zlib.gunzipSync(tw.show(`${tw.gdir}/${k}.json.gz`)).toString('utf8'));
      gt[k] = { lc: Buffer.from(g.lc, 'base64'), step: g.lc_step };
    } catch { /* no land-cover tile */ }
  }
  const tileOf = (E, N) => `${Math.floor(E / 1000)}_${Math.floor(N / 1000)}`;
  function zAt(E, N) {                       // terrain, bilinear on the 25 m nodes; sea = 0; outside the data = null
    const t = tt[tileOf(E, N)]; if (!t) return null;
    const fx = (E - t.tx * 1000) / t.step, fy = ((t.ty + 1) * 1000 - N) / t.step;
    const c0 = Math.min(t.NT - 2, Math.floor(fx)), r0 = Math.min(t.NT - 2, Math.floor(fy)), ax = fx - c0, ay = fy - r0;
    const val = (r, c) => { const q = t.z[r * t.NT + c]; return q === SEA ? 0 : q === OUTSIDE ? NaN : q / 10; };
    const v = (1 - ay) * ((1 - ax) * val(r0, c0) + ax * val(r0, c0 + 1)) + ay * ((1 - ax) * val(r0 + 1, c0) + ax * val(r0 + 1, c0 + 1));
    return Number.isFinite(v) ? v : null;
  }
  function landAt(E, N) {
    const t = tt[tileOf(E, N)]; if (!t) return null;
    const c = Math.floor((E - t.tx * 1000) / 10), r = Math.floor(((t.ty + 1) * 1000 - N) / 10);
    return t.mask[clamp(r, 0, t.NM - 1) * t.NM + clamp(c, 0, t.NM - 1)] === 1;
  }
  function lcAt(E, N) {                       // twin land cover: class (0..15) and 'estimated' flag
    const k = tileOf(E, N), g = gt[k], t = tt[k]; if (!g || !t) return { cls: 0, est: true };
    const n = 1000 / g.step, c = Math.floor((E - t.tx * 1000) / g.step), r = Math.floor(((t.ty + 1) * 1000 - N) / g.step);
    const b = g.lc[clamp(r, 0, n - 1) * n + clamp(c, 0, n - 1)];
    return { cls: b & 0x7f, est: (b & 0x80) !== 0 };
  }

  // ---------- buildings / roads / sea of every loaded tile
  const CONF = ['מאומת', 'גבוה', 'בינוני', 'נמוך'];
  const allB = [], roadsW = [], seaW = [];
  for (const k of keys) {
    const j = vt[k], [ox, oy] = j.o;
    for (const b of j.b) allB.push({ id: b.i, name: b.n || '', ring: decRing(b.r[0], ox, oy), base: b.z / 10, h: b.h / 10, sigma: b.s / 10,
      src: b.src, conf: CONF[b.c] ?? String(b.c), floors: b.f, area: b.a, tile: k });
    for (const r of j.rd || []) roadsW.push({ cls: r.c, name: r.n || '', line: decRing(r.r, ox, oy) });
    for (const s of j.sea || []) seaW.push(decRing(s[0], ox, oy));
  }

  // ---------- obstacle raster (2 m): terrain surface + roofs (base + h)
  const CELL = 2, rx0 = Math.floor(bx0) - 4, ry0 = Math.floor(by0) - 4;
  const RNX = Math.ceil((bx1 - rx0) / CELL) + 8, RNY = Math.ceil((by1 - ry0) / CELL) + 8;
  const HR = new Float32Array(RNX * RNY).fill(-1e9);
  for (let j = 0; j < RNY; j++) for (let i = 0; i < RNX; i++) {
    const z = zAt(rx0 + (i + 0.5) * CELL, ry0 + (j + 0.5) * CELL);
    if (z != null) HR[j * RNX + i] = z;
  }
  function fillPoly(ring, hgt) {               // scanline at cell centres
    const ys = ring.map(p => p[1]), ymin = Math.min(...ys), ymax = Math.max(...ys);
    for (let j = Math.max(0, Math.floor((ymin - ry0) / CELL)); j <= Math.min(RNY - 1, Math.ceil((ymax - ry0) / CELL)); j++) {
      const yc = ry0 + (j + 0.5) * CELL, xs = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        for (let i = Math.max(0, Math.ceil((xs[q] - rx0) / CELL - 0.5)); i <= Math.min(RNX - 1, Math.floor((xs[q + 1] - rx0) / CELL - 0.5)); i++) {
          const o = j * RNX + i; if (HR[o] < hgt) HR[o] = hgt;
        }
      }
    }
  }
  for (const b of allB) fillPoly(b.ring, b.base + b.h);
  const hAt = (x, y) => { const i = Math.floor((x - rx0) / CELL), j = Math.floor((y - ry0) / CELL); return i < 0 || j < 0 || i >= RNX || j >= RNY ? -1e9 : HR[j * RNX + i]; };

  // terminator: the height above which a point sees the sun's upper limb (rays at rayAlt, Earth curvature with k = 0.13)
  const tanA = Math.tan(rayAlt * D2R), CURV = (1 - 0.13) / (2 * 6371000);
  function terminator(E, N, d0 = 0.5) {
    let best = -1e9;
    for (let d = d0; d < REACH; d += CELL * 0.75) {
      const h = hAt(E + SX * d, N + SY * d); if (h < -1e8) continue;
      const t = h - d * tanA - d * d * CURV; if (t > best) best = t;
    }
    return best;
  }
  // horizon angle (deg) seen from (E,N,z0) toward azimuth az
  function horizon(E, N, z0, az, dmax = 1500) {
    const sx = Math.sin(az * D2R), sy = Math.cos(az * D2R); let best = 0;
    for (let d = 3; d < dmax; d += d < 200 ? 3 : d < 600 ? 6 : 12) {
      const h = hAt(E + sx * d, N + sy * d); if (h < -1e8) continue;
      const a = Math.atan2(h - z0 - d * d * CURV, d); if (a > best) best = a;
    }
    return best * R2D;
  }
  // share of the sunrise glow (low eastern sky around the sun) hidden from a point — a soft long shadow toward WNW.
  // Model (משוער): glow weight exp(−(Δaz/25°)²) × exp(−elev/6°), 11 azimuths ±50°.
  const GLOW = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map(da => ({ az: sunAz + da, w: Math.exp(-((da / 25) ** 2)) }));
  const GW = GLOW.reduce((s, g) => s + g.w, 0);
  function glowOcc(E, N, z0) {
    let s = 0; for (const g of GLOW) s += g.w * (1 - Math.exp(-horizon(E, N, z0 + 0.5, g.az) / 6)); return s / GW;
  }

  // ---------- projection to plate pixels (parallel, camera at area.view_suggested)
  const EL = (area.view_suggested?.elevation_deg ?? 30) * D2R, sinE = Math.sin(EL), cosE = Math.cos(EL);
  const S = opt.scale ?? 2.86, OX = W / 2 + (opt.dx ?? 0), OY = opt.oy ?? 812;
  const P = (u, v, z) => [OX + S * u, OY - S * (v * sinE + z * cosE)];
  const r2 = x => Math.round(x * 100) / 100;
  const PP = (u, v, z) => P(u, v, z).map(r2);

  // ---------- clipping to the area rectangle in (u,v)
  const inside = (p, e) => e === 0 ? p[1] >= V0 : e === 1 ? p[0] <= U1 : e === 2 ? p[1] <= V1 : p[0] >= U0;
  const cross = (a, b, e) => {
    const t = e === 0 ? (V0 - a[1]) / (b[1] - a[1]) : e === 1 ? (U1 - a[0]) / (b[0] - a[0]) : e === 2 ? (V1 - a[1]) / (b[1] - a[1]) : (U0 - a[0]) / (b[0] - a[0]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  function clipPoly(pts) {
    let out = pts;
    for (let e = 0; e < 4 && out.length; e++) {
      const inp = out; out = [];
      for (let i = 0; i < inp.length; i++) {
        const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
        if (inside(b, e)) { if (!inside(a, e)) out.push(cross(a, b, e)); out.push(b); } else if (inside(a, e)) out.push(cross(a, b, e));
      }
    }
    return out;
  }
  function clipLine(pts) {
    const runs = []; let cur = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0;
      let t0 = 0, t1 = 1, ok = true;
      for (const [p, q] of [[-dx, x0 - U0], [dx, U1 - x0], [-dy, y0 - V0], [dy, V1 - y0]]) {
        if (p === 0) { if (q < 0) { ok = false; break; } continue; }
        const r = q / p; if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
      }
      if (!ok) { cur = null; continue; }
      const a = [x0 + dx * t0, y0 + dy * t0], b = [x0 + dx * t1, y0 + dy * t1];
      if (!cur || t0 > 0) { cur = [a]; runs.push(cur); }
      cur.push(b); if (t1 < 1) cur = null;
    }
    return runs.filter(r => r.length > 1);
  }
  const area2 = p => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const zUV = (u, v) => { const [E, N] = toEN(u, v); const z = zAt(E, N); return z == null ? 0 : z; };

  // ---------- materials and light (style.json; inspiration, not measurement)
  const M = style.materials.items, roles = style.palette.roles;
  const amb = sky.ambient, sun = sky.sunLight;
  // ambient split: 45% of the dawn ambient comes from the low glow around the sun (משוער) — occluded by glowOcc
  const ambientK = (occ, facing = 0.5) => (0.55 + 0.45 * (1 - occ)) * (0.8 + 0.4 * facing);
  const lightHex = (base, { occ = 0, facing = 0.5, direct = 0 } = {}) => {
    const b = lin(base), a = lin(amb.hex), s = lin(sun.hex), ka = amb.intensity * ambientK(occ, facing), ks = sun.intensity * direct * 1.1;
    let hex = hexOf(b.map((v, i) => v * (a[i] * ka + s[i] * ks)));
    if (direct <= 0) hex = mix(hex, sky.shadowTint.hex, sky.shadowTint.alpha * 0.5);
    return hex;
  };
  const EXPO = opt.exposure ?? 1.0;          // one global exposure for the plate (documented in the cartouche)
  const ex = hex => scaleHex(hex, EXPO);
  const groundBase = c => {
    if (c === 5 || c === 6 || c === 15) return M.sand.base;           // sand / beach / mobile dune
    if (c === 7) return mix(M.sand.base, M.greenery.dryGrass, 0.35);   // stabilised dune
    if (c === 1 || c === 2 || c === 3 || c === 12 || c === 13) return mix(M.greenery.olive, M.greenery.dryGrass, 0.35);
    if (c === 11) return M.concrete.base;
    return mix(M.pavers.alt, M.concrete.base, 0.5);                    // urban / unknown ground
  };

  // ---------- ground grid (4 m nodes over the area)
  const G = 4, GU = Math.round((U1 - U0) / G), GV = Math.round((V1 - V0) / G);
  const node = [];
  for (let j = 0; j <= GV; j++) for (let i = 0; i <= GU; i++) {
    const u = U0 + i * G, v = V0 + j * G, [E, N] = toEN(u, v), land = landAt(E, N), z = land ? (zAt(E, N) ?? 0) : 0;
    node.push({ u, v, E, N, z, land });
  }
  const nd = (i, j) => node[j * (GU + 1) + i];
  const cells = [];
  let litGround = 0, sandCells = 0, landCells = 0;
  const seaNear = roleColor('sea_deep'), seaFar = roleColor('sea_surface');
  function roleColor(r) { return Sky.roleColor(roles[r], sky); }
  for (let j = 0; j < GV; j++) for (let i = 0; i < GU; i++) {
    const a = nd(i, j), b = nd(i + 1, j), c = nd(i + 1, j + 1), d = nd(i, j + 1);
    const u = (a.u + c.u) / 2, v = (a.v + c.v) / 2, [E, N] = toEN(u, v);
    const land = landAt(E, N);
    const z = land ? (a.z + b.z + c.z + d.z) / 4 : 0;
    const occ = glowOcc(E, N, z);
    let col, kind;
    if (land) {
      const lc = lcAt(E, N); kind = lc.cls; landCells++;
      if (kind === 5 || kind === 6 || kind === 15) sandCells++;
      const T = terminator(E, N, 0.5), lit = z > T; if (lit) litGround++;
      col = lightHex(groundBase(kind), { occ, facing: 0.15, direct: lit ? Math.sin(Math.max(rayAlt, 0.02) * D2R) : 0 });
    } else {
      kind = 14;
      const t = clamp((v - V0) / (V1 - V0), 0, 1);
      col = lightHex(mix(seaNear, seaFar, 0.35 + 0.65 * t), { occ: occ * 0.6, facing: 0.15 });
      col = scaleHex(col, 2.2);             // sea role colours are already "lit" values (style.json) – undo the ambient factor partly
    }
    cells.push({ i, j, kind, land, occ: Math.round(occ * 1000) / 1000,
      pts: [PP(a.u, a.v, land ? a.z : 0), PP(b.u, b.v, land ? b.z : 0), PP(c.u, c.v, land ? c.z : 0), PP(d.u, d.v, land ? d.z : 0)], c: ex(col) });
  }

  // contours every 2 m on land (marching squares on the 4 m nodes)
  const contours = [];
  for (let lev = 2; lev <= 60; lev += 2) {
    for (let j = 0; j < GV; j++) for (let i = 0; i < GU; i++) {
      const q = [nd(i, j), nd(i + 1, j), nd(i + 1, j + 1), nd(i, j + 1)];
      if (!q.every(n => n.land)) continue;
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const A = q[e], B = q[(e + 1) % 4];
        if ((A.z < lev) !== (B.z < lev)) { const t = (lev - A.z) / (B.z - A.z); pts.push([A.u + (B.u - A.u) * t, A.v + (B.v - A.v) * t]); }
      }
      for (let k = 0; k + 1 < pts.length; k += 2) contours.push({ lev, a: PP(pts[k][0], pts[k][1], lev), b: PP(pts[k + 1][0], pts[k + 1][1], lev) });
    }
  }

  // coastline (land/sea edge of the 4 m grid, data = synthetic coast of the sample)
  const coast = [];
  for (let j = 0; j < GV; j++) for (let i = 0; i < GU; i++) {
    const c0 = cells[j * GU + i];
    if (i + 1 < GU && c0.land !== cells[j * GU + i + 1].land) { const u = U0 + (i + 1) * G; coast.push([PP(u, V0 + j * G, 0), PP(u, V0 + (j + 1) * G, 0)]); }
    if (j + 1 < GV && c0.land !== cells[(j + 1) * GU + i].land) { const v = V0 + (j + 1) * G; coast.push([PP(U0 + i * G, v, 0), PP(U0 + (i + 1) * G, v, 0)]); }
  }

  // sea outline in plate px (for the sea hatching clip)
  const seaPolys = [];
  for (const ring of seaW) {
    const c = clipPoly(ring.map(([E, N]) => toUV(E, N)));
    if (c.length >= 3 && Math.abs(area2(c)) > 1) seaPolys.push(c.map(([u, v]) => PP(u, v, 0)));
  }

  // sand ripples (engraving texture on sand cells; positions seeded — the ripples themselves are 'סכמטי')
  const ripples = [];
  const rnd = Sky.seededRandom('plate:sunrise/ripples|2026-11-24');
  for (let n = 0; n < 5200; n++) {
    const u = U0 + rnd() * (U1 - U0), v = V0 + rnd() * (V1 - V0), [E, N] = toEN(u, v);
    if (!landAt(E, N)) continue;
    const lc = lcAt(E, N); if (!(lc.cls === 5 || lc.cls === 6 || lc.cls === 15 || lc.cls === 7)) continue;
    const L = 3 + rnd() * 5, bend = (rnd() - 0.5) * 1.6, pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6 - 0.5, du = t * L, dv = bend * (1 - 4 * t * t); pts.push(PP(u + du, v + dv, zUV(u + du, v + dv))); }
    ripples.push(pts);
  }

  // roads (OSM): draped, widths schematic by class
  const RW = [3, 6, 9, 12, 5];
  const roads = [];
  for (const r of roadsW) for (const run of clipLine(r.line.map(([E, N]) => toUV(E, N)))) {
    const pts = [];
    for (let k = 0; k + 1 < run.length; k++) {
      const [u0, v0] = run[k], [u1, v1] = run[k + 1], L = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.ceil(L / 4));
      for (let s = 0; s < n; s++) { const t = s / n, u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t; pts.push(PP(u, v, zUV(u, v) + 0.15)); }
    }
    const [ue, ve] = run[run.length - 1]; pts.push(PP(ue, ve, zUV(ue, ve) + 0.15));
    roads.push({ cls: r.cls, name: r.name, w: r2(RW[clamp(r.cls, 0, 4)] * S * 0.8), pts });
  }

  // ---------- buildings in the area: walls (lit above the terminator), roofs, ± bands
  const camUV = [0, -1];                                    // the camera looks along +v
  const wallBase = M.plaster.base, roofBase = M.roof_flat.base;
  const bldgs = [];
  const focusRuns = [];
  const towerIds = new Set(['w1013192689', 'w1280878706']);
  let towerT = [];
  for (const b of allB) {
    const ringUV = b.ring.map(([E, N]) => toUV(E, N));
    let cut = clipPoly(ringUV);
    if (cut.length < 3 || Math.abs(area2(cut)) < 2) continue;
    if (area2(cut) < 0) cut = cut.slice().reverse();          // CCW in (u,v)
    const top = b.base + b.h, isTower = towerIds.has(b.id);
    const walls = [];
    for (let k = 0; k < cut.length; k++) {
      const a = cut[k], c = cut[(k + 1) % cut.length];
      const du = c[0] - a[0], dv = c[1] - a[1], L = Math.hypot(du, dv); if (L < 0.05) continue;
      const nU = dv / L, nV = -du / L;                         // outward normal for a CCW ring
      if (nU * camUV[0] + nV * camUV[1] <= 1e-6) continue;    // back-facing
      const nE = nU * UD[0] + nV * VD[0], nN = nU * UD[1] + nV * VD[1];
      const facing = Math.cos(Math.atan2(nE, nN) - sunAz * D2R);
      const onEdge = (Math.abs(a[0] - c[0]) < 1e-6 && (Math.abs(a[0] - U0) < 1e-6 || Math.abs(a[0] - U1) < 1e-6)) ||
                     (Math.abs(a[1] - c[1]) < 1e-6 && (Math.abs(a[1] - V0) < 1e-6 || Math.abs(a[1] - V1) < 1e-6));
      // terminator samples along the wall
      const step = isTower ? 0.4 : 1.0, n = Math.max(2, Math.ceil(L / step) + 1), samp = [];
      if (facing > 0.02 && !onEdge) {
        for (let s = 0; s < n; s++) {
          const t = s / (n - 1), u = a[0] + du * t + nU * 0.6, v = a[1] + dv * t + nV * 0.6, [E, N] = toEN(u, v);
          const T = terminator(E, N, 0.2);
          samp.push({ t, T });
          if (isTower) towerT.push(T);
        }
      }
      const pA0 = PP(a[0], a[1], b.base), pC0 = PP(c[0], c[1], b.base), pA1 = PP(a[0], a[1], top), pC1 = PP(c[0], c[1], top);
      const shadeCol = lightHex(wallBase, { occ: 0.25, facing: Math.max(0, facing) });
      const wall = { pts: [pA0, pC0, pC1, pA1], c: ex(shadeCol), facing: r2(facing), cut: onEdge, len: r2(L * S) };
      // lit polygon: upper part above max(T, base)
      if (samp.length && samp.some(s => s.T < top - 0.05)) {
        const litC = lightHex(wallBase, { occ: 0.1, facing, direct: facing });
        const runs = []; let cur = null;
        for (const s of samp) {
          const lo = Math.max(s.T, b.base);
          if (lo < top - 0.05) { if (!cur) { cur = []; runs.push(cur); } cur.push({ t: s.t, lo }); } else cur = null;
        }
        wall.lit = runs.filter(r => r.length >= 2 || (isTower && r.length >= 1)).map(r => {
          const at = (t, z) => PP(a[0] + du * t, a[1] + dv * t, z);
          const lower = r.map(s => at(s.t, s.lo)), upper = r.slice().reverse().map(s => at(s.t, top));
          if (isTower) focusRuns.push({ id: b.id, pts: r.filter(s => s.lo > b.base + 0.05).map(s => at(s.t, s.lo)), zs: r.map(s => s.lo) });
          return { pts: [...lower, ...upper] };
        });
        wall.litC = ex(litC);
      }
      walls.push(wall);
    }
    // painter depth: nearest footprint point (smallest v) and centroid
    const cv = cut.reduce((s, p) => s + p[1], 0) / cut.length, cu = cut.reduce((s, p) => s + p[0], 0) / cut.length;
    const [Ec, Nc] = toEN(cu, cv), Troof = terminator(Ec, Nc, 0.2), roofLit = top >= Troof - 0.05;
    const roofOcc = glowOcc(Ec, Nc, top);
    const roofCol = lightHex(roofBase, { occ: roofOcc, facing: 0.3, direct: roofLit ? Math.sin(Math.max(rayAlt, 0.02) * D2R) * 6 : 0 });
    bldgs.push({ id: b.id, name: b.name, src: b.src, h: b.h, sigma: b.sigma, base: b.base, conf: b.conf, area: b.area, tower: isTower,
      depth: Math.min(...cut.map(p => p[1])), cdepth: cv, cu: r2(cu), cv: r2(cv),
      roof: cut.map(([u, v]) => PP(u, v, top)), roofC: ex(roofCol), roofLit,
      bandLo: cut.map(([u, v]) => PP(u, v, Math.max(b.base, top - b.sigma))), bandHi: cut.map(([u, v]) => PP(u, v, top + b.sigma)),
      foot: cut.map(([u, v]) => PP(u, v, b.base)), walls,
      label: PP(cu, cv, top + b.sigma) });
  }
  // back to front: far (large v) first
  bldgs.sort((p, q) => (q.cdepth - p.cdepth) || (p.id < q.id ? -1 : 1));

  // ---------- block skirt along the near edge (v = V0): terrain section down to sea level (schematic)
  const skirt = [];
  for (let u = U0; u <= U1 + 1e-6; u += 4) skirt.push({ top: PP(u, V0, zUV(u, V0)), bot: PP(u, V0, 0) });

  // ---------- numbers for the cartouche
  const towers = allB.filter(b => towerIds.has(b.id));
  const tMin = towerT.length ? Math.min(...towerT) : null, tMax = towerT.length ? Math.max(...towerT) : null;
  // first direct sun on the sand at the area's waterline (u = 0), from the data relief (no relief beyond the data)
  const beachUV = (() => { for (let v = V1; v > V0; v -= 2) { const [E, N] = toEN(0, v); if (landAt(E, N)) return [0, v - 10]; } return [0, 0]; })();
  const [bE, bN] = toEN(...beachUV), bz = zAt(bE, bN) ?? 0;
  const beachHorizon = (() => { let best = -1e9; for (let d = 2; d < REACH; d += 1.5) { const h = hAt(bE + SX * d, bN + SY * d); if (h < -1e8) continue; const a = Math.atan2(h - bz - d * d * CURV, d) * R2D; if (a > best) best = a; } return best; })();
  // first direct sun (upper limb above the data horizon) at points of the waterline: u = −280 … +280 m
  function firstSun(E, N, z0) {
    const hz = az => { const ax = Math.sin(az * D2R), ay = Math.cos(az * D2R); let best = -1e9; for (let d = 2; d < REACH; d += 1.5) { const h = hAt(E + ax * d, N + ay * d); if (h < -1e8) continue; const a = Math.atan2(h - z0 - 1.6 - d * d * CURV, d) * R2D; if (a > best) best = a; } return best; };
    for (let s = 0; s < 3 * 3600; s += 20) {
      const t = new Date(T0.getTime() + s * 1000), p = Sky.sunPosition(t, place), h = hz(p.az);
      if (p.altApparent + p.semidiameter > h) return { local: Sky.localTime(t).hhmm, minutes: s / 60, horizon: h };
    }
    return null;
  }
  const wl = [];
  for (let u = -280; u <= 280; u += 80) {
    let vv = null; for (let v = V1; v > V0; v -= 2) { const [E, N] = toEN(u, v); if (landAt(E, N)) { vv = v - 8; break; } }
    if (vv == null) continue;
    const [E, N] = toEN(u, vv), z = zAt(E, N) ?? 0, f = firstSun(E, N, z);
    if (f) wl.push({ u, v: vv, z, ...f });
  }
  wl.sort((a, b) => a.minutes - b.minutes);
  const beachFirst = wl.length ? { points: wl, earliest: wl[0].local, latest: wl[wl.length - 1].local,
    hMin: Math.min(...wl.map(w => w.horizon)), hMax: Math.max(...wl.map(w => w.horizon)), eye_m: 1.6 } : null;
  const firstSunBeach = wl[0] || null;

  const heb = hebrewDate(2026, 11, 24);
  const dows = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];
  const dow = new Date(Date.UTC(lt.y, lt.m - 1, lt.d)).getUTCDay();

  return {
    W, H, S, OX, OY, elevDeg: EL * R2D, area: { id: area.id, name_he: area.name_he, u: [U0, U1], v: [V0, V1], frame: area.frame },
    corners: { far: [PP(U0, V1, 0), PP(U1, V1, 0)], near: [PP(U0, V0, zUV(U0, V0)), PP(U1, V0, zUV(U1, V0))] },
    sun: { iso: T0.toISOString(), local: lt.hhmm, localSec: `${String(lt.h).padStart(2, '0')}:${String(lt.min).padStart(2, '0')}:${String(lt.s).padStart(2, '0')}`,
      date_he: lt.date_he, dow: dows[dow], az: sunAz, alt: sp.alt, altApparent: sp.altApparent, upperLimb: rayAlt, semidiameter: sp.semidiameter,
      shadow10: 10 / Math.tan(Math.max(rayAlt, 1e-4) * D2R), civilDawn: times.local.civilDawn, goldenEnd: times.local.goldenHourMorningEnd,
      ladder, moonSet: moonT.local.set, moonSetAz: moonAtSet ? moonAtSet.az : null, moonIllum: moonAtSet ? moonAtSet.illumination : null },
    sky: { stops: sky.stops, sunward: sky.sunward, antisun: sky.antisun, ambient: sky.ambient, sunLight: sky.sunLight, shadowTint: sky.shadowTint,
      phase: sky.phase, focus: sky.focus, weights: sky.weights },
    heb, exposure: EXPO,
    cells, contours, coast, seaPolys, ripples, roads, bldgs, skirt,
    focusRuns: focusRuns.filter(r => r.pts.length >= 2),
    numbers: {
      towers: towers.map(t => ({ id: t.id, h: t.h, sigma: t.sigma, base: t.base, top: t.base + t.h, src: t.src })),
      towerTerminator: tMin == null ? null : { min: tMin, max: tMax },
      litGroundCells: litGround, landCells, sandCells,
      beach: { uv: beachUV, z: bz, horizonDeg: beachHorizon, firstSun: firstSunBeach && { local: firstSunBeach.local, minutes: firstSunBeach.minutes, horizon: firstSunBeach.horizon } },
      beachFirst,
      buildingsInArea: bldgs.length, bySrc: bldgs.reduce((m, b) => (m[b.src] = (m[b.src] || 0) + 1, m), {}),
      tilesUsed: keys, reach_m: REACH, raster_m: CELL,
    },
    sources: {
      repo_branch: 'twin-world', commit: ref, tiles: `${tw.tdir}/{v,t}/<tx>_<ty>`, landcover: `${tw.gdir}/<tx>_<ty>.json.gz`,
      manifest: area.source.manifest, manifest_sources: tw.manifest.sources, manifest_built_at: tw.manifest.built_at,
    },
    labels: {
      towers: towers.map(t => { const [u, v] = toUV(t.ring.reduce((s, p) => s + p[0], 0) / t.ring.length, t.ring.reduce((s, p) => s + p[1], 0) / t.ring.length); return { id: t.id, uv: [u, v], top: PP(u, v, t.base + t.h + t.sigma), mid: PP(u, v, t.base + t.h * 0.5) }; }),
      coastAt: (() => { for (let v = V1; v > V0; v -= 2) { const [E, N] = toEN(-200, v); if (landAt(E, N)) return PP(-200, v, 0); } return null; })(),
      seaAt: PP(-150, V1 - 25, 0), sandAt: PP(-40, beachUV[1] - 25, zUV(-40, beachUV[1] - 25)),
      beachPt: PP(beachUV[0], beachUV[1], bz),
      skirtAt: PP(U0 + 40, V0, zUV(U0 + 40, V0) * 0.5),
      roadsAt: (() => { const r = roads.find(x => x.name === 'הטיילת') || roads.find(x => x.cls >= 3) || roads[0]; return r ? { name: r.name, p: r.pts[Math.floor(r.pts.length / 2)] } : null; })(),
      origin: PP(0, 0, zUV(0, 0)),
      sunArrow: (() => { const k = 60; const [u0, v0] = [U1 - 70, V0 + 60]; const sdu = SX * UD[0] + SY * UD[1], sdv = SX * VD[0] + SY * VD[1];
        return { from: PP(u0 + sdu * k, v0 + sdv * k, zUV(u0, v0)), to: PP(u0 - sdu * k, v0 - sdv * k, zUV(u0, v0)) }; })(),
      north: (() => { const [u0, v0] = [U0 + 60, V1 - 60]; const nu = UD[1], nv = VD[1]; return { from: PP(u0, v0, 0), to: PP(u0 + nu * 40, v0 + nv * 40, 0) }; })(),
      scale: { from: PP(U1 - 220, V0, 0), to: PP(U1 - 120, V0, 0), m: 100 },
    },
  };
}

// Hebrew date (pyluach, as the task asks). Kernel typography: "י״ד בכסלו תשפ״ז".
export function hebrewDate(y, m, d) {
  const out = execFileSync('python3', ['-I', '-c',
    `from pyluach import dates\nh=dates.GregorianDate(${y},${m},${d}).to_heb()\nprint(h.hebrew_date_string())\nprint(h.year, h.month, h.day)`], { encoding: 'utf8' }).trim().split('\n');
  const [day, month, year] = out[0].split(' ');
  return { he: `${day} ב${month} ${year}`, raw: out[0], ymd: out[1], lib: 'pyluach' };
}
