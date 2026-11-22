/* ESH27 twin — sky & time — calib.js
 * "Camera calibration" from the sky: given a photo's timestamp + place and the pixel position of the Sun/Moon
 * (or a planet/star), solve the camera's true heading (and pitch; with ≥2 bodies also roll and focal length).
 * Pinhole camera, no lens distortion (phones: distortion < 1–2% at the edge → use bodies near the centre).
 * Pixel convention: u to the right, v DOWN, origin top-left; principal point = image centre.
 * Orientation: yaw = azimuth of the optical axis from TRUE north (clockwise), pitch = up positive,
 *   roll = rotation about the optical axis, positive = image content turns clockwise (camera tilted left).
 */
import { body, moon, star, observer, time } from './sky.js';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const mod = (a, n) => ((a % n) + n) % n;

export function focalPx(W, fovDeg) { return (W / 2) / Math.tan(fovDeg * D2R / 2); }
function basis(yaw, pitch, roll) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
  const F = [sy * cp, cy * cp, sp], R0 = [cy, -sy, 0], U0 = [-sy * sp, -cy * sp, cp];
  const Rt = [0, 1, 2].map(i => R0[i] * cr - U0[i] * sr), Up = [0, 1, 2].map(i => R0[i] * sr + U0[i] * cr);
  return { F, R: Rt, U: Up };
}
const enu = (az, alt) => [Math.cos(alt * D2R) * Math.sin(az * D2R), Math.cos(alt * D2R) * Math.cos(az * D2R), Math.sin(alt * D2R)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Forward model: az/alt (deg) → pixel {u, v, front}. */
export function project(az, alt, cam) {
  const w = enu(az, alt), B = basis(cam.yaw * D2R, cam.pitch * D2R, (cam.roll || 0) * D2R);
  const z = dot(w, B.F), x = dot(w, B.R), y = dot(w, B.U);
  return { u: cam.W / 2 + cam.f * x / z, v: cam.H / 2 - cam.f * y / z, front: z > 0 };
}
/** Closed form, one body, known roll (default 0): returns {yaw, pitch} in degrees. */
export function solveOne(az, alt, u, v, W, H, f, rollDeg = 0) {
  // undo roll in the image plane, then normalise the ray
  const r = rollDeg * D2R, x0 = (u - W / 2), y0 = -(v - H / 2);
  const x = x0 * Math.cos(r) + y0 * Math.sin(r), y = -x0 * Math.sin(r) + y0 * Math.cos(r);
  const n = Math.hypot(x, y, f), a = x / n, b = y / n, c = f / n;
  const Uw = Math.sin(alt * D2R), Rr = Math.hypot(b, c), del = Math.atan2(c, b);
  const k = Math.acos(Math.max(-1, Math.min(1, Uw / Rr)));
  const cands = [del + k, del - k].map(t => mod(t + Math.PI, 2 * Math.PI) - Math.PI).filter(t => Math.abs(t) <= Math.PI / 2 + 1e-9);
  const th = cands.sort((p, q) => Math.abs(p) - Math.abs(q))[0] ?? 0;
  const yaw = az * D2R - Math.atan2(a, c * Math.cos(th) - b * Math.sin(th));
  return { yaw: mod(yaw * R2D, 360), pitch: th * R2D };
}
/**
 * Least squares (Levenberg–Marquardt) over yaw, pitch [, roll] [, f] from ≥1 observations {az, alt, u, v}.
 * @returns {{yaw, pitch, roll, f, rmsPx, iterations}}
 */
export function solveCamera(obs, o) {
  const W = o.W, H = o.H; let f = o.f || focalPx(W, o.fovDeg || 66);
  const first = solveOne(obs[0].az, obs[0].alt, obs[0].u, obs[0].v, W, H, f, o.roll || 0);
  let p = [first.yaw, first.pitch, o.roll || 0, f];
  const free = [true, true, !!o.solveRoll && obs.length >= 2, !!o.solveFocal && obs.length >= 2];
  const resid = q => { const out = []; for (const b of obs) { const pr = project(b.az, b.alt, { yaw: q[0], pitch: q[1], roll: q[2], f: q[3], W, H }); out.push(pr.u - b.u, pr.v - b.v); } return out; };
  let lam = 1e-3, r = resid(p), cost = r.reduce((s, x) => s + x * x, 0), it = 0;
  for (; it < 60; it++) {
    const idx = [0, 1, 2, 3].filter(i => free[i]), J = [];
    for (const i of idx) { const h = i === 3 ? 1e-3 * p[3] : 1e-5, q = p.slice(); q[i] += h; const rq = resid(q); J.push(rq.map((x, k) => (x - r[k]) / h)); }
    const n = idx.length, A = Array.from({ length: n }, () => new Array(n).fill(0)), g = new Array(n).fill(0);
    for (let a = 0; a < n; a++) { for (let b = 0; b < n; b++) for (let k = 0; k < r.length; k++) A[a][b] += J[a][k] * J[b][k]; for (let k = 0; k < r.length; k++) g[a] += J[a][k] * r[k]; }
    for (let a = 0; a < n; a++) A[a][a] *= 1 + lam;
    const dx = solveLin(A, g.map(x => -x)); if (!dx) break;
    const q = p.slice(); idx.forEach((i, k) => { q[i] += dx[k]; });
    const rq = resid(q), cq = rq.reduce((s, x) => s + x * x, 0);
    if (cq < cost) { p = q; r = rq; const done = cost - cq < 1e-10 * (1 + cost); cost = cq; lam *= 0.3; if (done) break; } else lam *= 10;
  }
  return { yaw: mod(p[0], 360), pitch: p[1], roll: p[2], f: p[3], rmsPx: Math.sqrt(cost / (2 * obs.length)), iterations: it };
}
function solveLin(A, b) {   // Gaussian elimination, small n
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-15) return null; [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; } }
  return M.map((row, i) => row[n] / row[i]);
}
/**
 * High-level helper for the demo / field photos.
 * @param {object} a {date (Date|ms UT), lat, lon, elev, W, H, fovDeg | f, roll?, marks:[{body:'Sun'|'Moon'|planet|star name, u, v}], pixelSigma=3, gammaDeg}
 * @returns {{heading, headingGrid, pitch, roll, f, rmsPx, sigmaHeading, bodies:[{body, az, alt}]}}
 */
export function calibrateFromPhoto(a) {
  const c = time(a.date), ob = observer(a.lat, a.lon, a.elev || 0), opt = { refraction: true };
  const bodies = a.marks.map(m => {
    const b = m.body === 'Moon' ? moon(c, ob, opt) : ['Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'].includes(m.body) ? body(m.body, c, ob, opt) : star(m.body, c, ob, opt);
    if (!b) throw new Error('גוף לא מוכר: ' + m.body);
    return { body: m.body, az: b.az, alt: b.altApparent, u: m.u, v: m.v };
  });
  const f = a.f || focalPx(a.W, a.fovDeg || 66);
  const s = solveCamera(bodies, { W: a.W, H: a.H, f, roll: a.roll || 0, solveRoll: bodies.length >= 2, solveFocal: bodies.length >= 3 || (bodies.length >= 2 && a.solveFocal) });
  const sig = (a.pixelSigma ?? 3) / s.f * R2D;
  return { heading: s.yaw, headingGrid: mod(s.yaw - (a.gammaDeg || 0), 360), pitch: s.pitch, roll: s.roll, f: s.f, rmsPx: s.rmsPx,
    sigmaHeading: sig, bodies: bodies.map(b => ({ body: b.body, az: b.az, alt: b.alt })) };
}
