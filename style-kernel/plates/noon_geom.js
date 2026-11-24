// noon_geom.js — exact sun-shadow geometry for the noon plate (used by render_noon.mjs in node and noon_scene.js in the browser).
// World frame of plates/AREA.json: u (metres, grid azimuth 30°), v (grid azimuth 300°), z (metres above sea level, SRTM/base_m).
// Every building of the twin is a flat-roofed prism (OSM footprint, base_m, h_m), so its shadow on any plane is an exact
// polygon: the prism projected along the sun ray. No raster, no approximation beyond the data's own (±σ heights, SRTM ground).

export const D2R = Math.PI / 180;

// ───────────── 2D polygon helpers (rings are arrays of [u, v], not closed)
export function area2(r) { let A = 0; for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; A += p[0] * q[1] - q[0] * p[1]; } return A / 2; }
export function dedupe(r, eps = 0.02) {
  const out = [];
  for (const p of r) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p); }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}
export const ccw = r => (area2(r) < 0 ? r.slice().reverse() : r.slice());
export function centroid(r) {                       // area-weighted centroid
  let A = 0, cx = 0, cy = 0;
  for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length], c = p[0] * q[1] - q[0] * p[1]; A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
  return Math.abs(A) < 1e-9 ? [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length] : [cx / (3 * A), cy / (3 * A)];
}
export function inside(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** Sutherland–Hodgman against one half-plane: keep (p − a)·n ≥ eps. */
export function clipHalf(r, a, n, eps = 0) {
  const out = [], f = p => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] - eps;
  for (let k = 0; k < r.length; k++) {
    const p = r[k], q = r[(k + 1) % r.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

// ───────────── the sun and the prisms
/** sun: { altDeg (apparent), azGridDeg } ; frame: { u_az_deg, v_az_deg }. Returns the vectors used everywhere below. */
export function sunFrame(sun, frame) {
  const A = sun.azGridDeg * D2R, e = Math.sin(A), n = Math.cos(A);
  const UD = [Math.sin(frame.u_az_deg * D2R), Math.cos(frame.u_az_deg * D2R)], VD = [Math.sin(frame.v_az_deg * D2R), Math.cos(frame.v_az_deg * D2R)];
  const toSun = [e * UD[0] + n * UD[1], e * VD[0] + n * VD[1]];          // horizontal unit vector toward the sun, in (u, v)
  const alt = sun.altDeg * D2R;
  return {
    alt, cosA: Math.cos(alt), sinA: Math.sin(alt), tanA: Math.tan(alt), cot: 1 / Math.tan(alt),
    toSun, d: [-toSun[0], -toSun[1]],                                        // d = horizontal direction the shadows point to
    S: [Math.cos(alt) * toSun[0], Math.cos(alt) * toSun[1], Math.sin(alt)],  // unit vector toward the sun (u, v, z)
  };
}
export function prism(b) {
  const ring = ccw(dedupe(b.ring_uv));
  return { id: b.id, ring, z0: b.base_m, z1: b.base_m + b.h_m, sig: b.sigma_m, c: centroid(ring), b };
}

/** Shadow of prism P on the horizontal plane z = zp (only the part of P above the plane casts onto it).
 *  Returns polygons in (u, v) on that plane, or [] (union = the swept footprint). */
export function shadowOnPlane(P, zp, sf, zTop = P.z1) {
  const t0 = Math.max(P.z0, zp) - zp, t1 = zTop - zp;
  if (t1 <= 1e-6) return [];
  const o0 = [sf.d[0] * t0 * sf.cot, sf.d[1] * t0 * sf.cot], o1 = [sf.d[0] * t1 * sf.cot, sf.d[1] * t1 * sf.cot], r = P.ring;
  const tr = o => r.map(p => [p[0] + o[0], p[1] + o[1]]);
  const out = [tr(o0), tr(o1)];
  for (let k = 0; k < r.length; k++) {
    const a = r[k], q = r[(k + 1) % r.length];
    out.push([[a[0] + o0[0], a[1] + o0[1]], [q[0] + o0[0], q[1] + o0[1]], [q[0] + o1[0], q[1] + o1[1]], [a[0] + o1[0], a[1] + o1[1]]]);
  }
  return out;
}

/** Where the sun ray through (p, z) going down meets the terrain: horizontal distance t ≥ 0 along d (fixed point on z(t) = ground). */
export function rayToGround(p, z, sf, zAt) {
  let t = Math.max(0, (z - zAt(p[0], p[1])) * sf.cot);
  for (let i = 0; i < 40; i++) {
    const q = [p[0] + sf.d[0] * t, p[1] + sf.d[1] * t], t2 = Math.max(0, (z - zAt(q[0], q[1])) * sf.cot);
    if (Math.abs(t2 - t) < 1e-4) { t = t2; break; }
    t = t + (t2 - t) * 0.8;
  }
  return [p[0] + sf.d[0] * t, p[1] + sf.d[1] * t, z - t * sf.tanA];
}

/** Shadow of prism P on the (gently sloping) SRTM ground. Base vertices stay on the footprint; every top vertex is followed
 *  down its own sun ray to the terrain. Returns polygons of [u, v] (draw with z = zAt(u, v)). */
export function shadowOnGround(P, sf, zAt, zTop = P.z1) {
  const r = P.ring, tips = r.map(p => rayToGround(p, zTop, sf, zAt)).map(q => [q[0], q[1]]);
  const out = [r.slice(), tips];
  for (let k = 0; k < r.length; k++) { const j = (k + 1) % r.length; out.push([r[k], r[j], tips[j], tips[k]]); }
  return out;
}

/** Shadow cast by occluder O on the vertical wall of prism W from a to q (outward normal n, wall faces the sun).
 *  Returns 3D polygons [[u, v, z], …] lying in the wall's plane (not yet clipped to the wall quad). */
export function shadowOnWall(O, a, n, sf, zTop = O.z1) {
  const dn = sf.d[0] * n[0] + sf.d[1] * n[1];
  if (dn >= -1e-6) return [];                                              // the wall does not face the sun
  const F = clipHalf(O.ring, a, n, 1e-3);                                  // only the part of O in front of the wall
  if (F.length < 3) return [];
  const proj = (p, z) => { const lam = ((a[0] - p[0]) * n[0] + (a[1] - p[1]) * n[1]) / (sf.cosA * dn); return [p[0] + lam * sf.cosA * sf.d[0], p[1] + lam * sf.cosA * sf.d[1], z - lam * sf.sinA]; };
  const lo = F.map(p => proj(p, O.z0)), hi = F.map(p => proj(p, zTop));
  const out = [lo, hi];
  for (let k = 0; k < F.length; k++) { const j = (k + 1) % F.length; out.push([lo[k], lo[j], hi[j], hi[k]]); }
  return out;
}

/** Shadow of the vertical axis of prism G (its centroid, from the ground to the roof) — a sundial gnomon. At true solar noon it
 *  lies exactly in the meridian plane. Marches along d over the surface (terrain, other roofs, the sun-facing walls).
 *  Returns { pieces: [{ on: 'ground' | id, kind: 'ground' | 'roof' | 'wall', pts: [[u,v,z],…] }], tip: [u,v,z], tipOn, length_m } */
export function gnomonShadow(G, prisms, sf, zAt, zTop = G.z1, step = 0.1) {
  const c = G.c, others = prisms.filter(P => P.id !== G.id);
  const surf = p => { for (const P of others) if (inside(p, P.ring)) return { z: P.z1, on: P.id }; return { z: zAt(p[0], p[1]), on: 'ground' }; };
  const at = t => [c[0] + sf.d[0] * t, c[1] + sf.d[1] * t];
  const ray = t => zTop - t * sf.tanA;
  const pieces = []; let cur = null, prev = null, tip = null, tipOn = null;
  const push = (on, kind, pt) => { if (!cur || cur.on !== on || cur.kind !== kind) { cur = { on, kind, pts: [] }; pieces.push(cur); if (prev && kind !== 'wall') cur.pts.push([...prev]); } cur.pts.push(pt); prev = pt; };
  let S = surf(at(0));
  push(S.on, S.on === 'ground' ? 'ground' : 'roof', [...at(0), S.z]);
  for (let t = step; t < 2000; t += step) {
    const p = at(t), N = surf(p), zr = ray(t);
    if (N.on !== S.on && N.z > S.z + 0.05) {                                 // a wall that faces the sun: climb it
      // refine the wall position
      let lo = t - step, hi = t; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (surf(at(m)).on === N.on) hi = m; else lo = m; }
      const pw = at(hi), zw = ray(hi);
      push(S.on, S.on === 'ground' ? 'ground' : 'roof', [...pw, S.z]);
      if (zw < N.z) { push(N.on, 'wall', [...pw, S.z]); push(N.on, 'wall', [...pw, zw]); tip = [...pw, zw]; tipOn = { on: N.on, kind: 'wall' }; break; }
      push(N.on, 'wall', [...pw, S.z]); push(N.on, 'wall', [...pw, N.z]);
      S = N; push(N.on, 'roof', [...pw, N.z]); continue;
    }
    if (N.on !== S.on && N.z < S.z - 0.05) {                                 // leaving a roof to the north: the far wall faces away (unseen)
      let lo = t - step, hi = t; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (surf(at(m)).on === N.on) hi = m; else lo = m; }
      const pw = at(hi);
      if (ray(hi) <= S.z) { const tt = (zTop - S.z) / sf.tanA; tip = [...at(tt), S.z]; push(S.on, 'roof', tip); tipOn = { on: S.on, kind: 'roof' }; break; }
      push(S.on, 'roof', [...pw, S.z]);
      S = N; cur = null; prev = null; push(N.on, N.on === 'ground' ? 'ground' : 'roof', [...pw, N.z]); continue;
    }
    if (zr <= N.z) {                                                         // the ray from the top lands here
      let lo = t - step, hi = t; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; const q = at(m); if (ray(m) <= surf(q).z) hi = m; else lo = m; }
      const q = at(hi); tip = [...q, surf(q).z]; push(N.on, N.on === 'ground' ? 'ground' : 'roof', tip); tipOn = { on: N.on, kind: N.on === 'ground' ? 'ground' : 'roof' }; break;
    }
    S = N;
    // keep ground pieces dense enough to follow the terrain (every 2 m)
    if (Math.round(t / step) % 20 === 0) push(N.on, N.on === 'ground' ? 'ground' : 'roof', [...p, N.z]);
  }
  const length_m = tip ? Math.hypot(tip[0] - c[0], tip[1] - c[1]) : null;
  return { pieces, tip, tipOn, length_m, base: [...c, zAt(c[0], c[1])] };
}

/** Painter's order for a parallel view looking along +v (screen x = u): back (large v) first. Pairwise test on the u-overlap
 *  of the footprints, topological sort, centroid-v tie break. */
export function paintOrder(prisms) {
  const vRange = (r, u) => {                                                // v-interval of the ring on the vertical line u
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < r.length; k++) {
      const p = r[k], q = r[(k + 1) % r.length];
      if ((p[0] - u) * (q[0] - u) > 0 || p[0] === q[0]) { if (p[0] === u) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); } continue; }
      const t = (u - p[0]) / (q[0] - p[0]), v = p[1] + (q[1] - p[1]) * t; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return lo <= hi ? [lo, hi] : null;
  };
  const n = prisms.length, ur = prisms.map(P => [Math.min(...P.ring.map(p => p[0])), Math.max(...P.ring.map(p => p[0]))]);
  const before = Array.from({ length: n }, () => new Set()), indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const lo = Math.max(ur[i][0], ur[j][0]), hi = Math.min(ur[i][1], ur[j][1]);
    if (hi - lo < 0.01) continue;
    let iFront = 0, jFront = 0;
    for (let s = 1; s <= 7; s++) {
      const u = lo + (hi - lo) * s / 8, a = vRange(prisms[i].ring, u), b = vRange(prisms[j].ring, u);
      if (!a || !b) continue;
      if (a[1] <= b[0] + 0.01) iFront++; else if (b[1] <= a[0] + 0.01) jFront++;
    }
    if (iFront > jFront) { before[j].add(i); } else if (jFront > iFront) { before[i].add(j); }   // before[x] = drawn after x
  }
  for (let i = 0; i < n; i++) for (const k of before[i]) indeg[k]++;
  const key = i => -prisms[i].c[1];
  const ready = []; for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const out = [];
  while (ready.length) {
    ready.sort((a, b) => key(a) - key(b) || (prisms[a].id < prisms[b].id ? -1 : 1));
    const i = ready.shift(); out.push(prisms[i]);
    for (const k of before[i]) if (--indeg[k] === 0) ready.push(k);
  }
  if (out.length < n) {                                                     // a cycle (should not happen): append by centroid
    const seen = new Set(out.map(P => P.id));
    prisms.filter(P => !seen.has(P.id)).sort((a, b) => b.c[1] - a.c[1]).forEach(P => out.push(P));
  }
  return out;
}

/** Terrain sampler over the plate's 10 m grid (bilinear; sea cells read 0 m). */
export function terrain(T) {
  const zAt = (u, v) => {
    const fx = Math.max(0, Math.min(T.nu - 1.0001, (u - T.u0) / T.grid_m)), fy = Math.max(0, Math.min(T.nv - 1.0001, (v - T.v0) / T.grid_m));
    const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j, g = (ii, jj) => T.z_m[jj * T.nu + ii] ?? 0;
    return (1 - ay) * ((1 - ax) * g(i, j) + ax * g(i + 1, j)) + ay * ((1 - ax) * g(i, j + 1) + ax * g(i + 1, j + 1));
  };
  const landAt = (u, v) => { const i = Math.round((u - T.u0) / T.grid_m), j = Math.round((v - T.v0) / T.grid_m); if (i < 0 || j < 0 || i >= T.nu || j >= T.nv) return null; return T.land[j * T.nu + i]; };
  return { zAt, landAt };
}
