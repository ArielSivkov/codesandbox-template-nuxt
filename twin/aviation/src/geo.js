/* ESH27 aviation — geo.js : geodesy for the far field (no dependencies).
 *
 * Frames
 *   LLA   : WGS84 geodetic latitude/longitude (deg) + ellipsoidal height (m).
 *   ECEF  : Earth-centred Earth-fixed (m). The Earth is treated as NON-ROTATING in the sims (labelled approx.).
 *   ITM   : Israeli Transverse Mercator, EPSG:2039 (Israel 1993 datum, GRS80) — the twin's data contract.
 *   local : the twin frame: x = grid east, y = up, z = grid south (metres), origin = a fixed ITM point
 *           (the game uses the Ashdod manifest bbox centre: E0 = 166265, N0 = 634406). It is the tangent
 *           plane at the origin, turned by the ITM meridian convergence so that −z is ITM grid north.
 *           Inside the 9 km city it matches ITM−origin to < 0.5 m horizontally; the Earth surface drops
 *           below y = 0 by ≈ d²/2R (2 m at 5 km, 785 m at 100 km) — the sims use the true curved Earth.
 *
 * Sources
 *   TM series (Krüger n-series, 6th order): C.F.F. Karney, "Transverse Mercator with an accuracy of a few
 *     nanometres", J. Geodesy 85 (2011). EPSG:2039 parameters from the EPSG registry.
 *   Israel 1993 → WGS84: 7-parameter Helmert, EPSG:1073 (coordinate-frame rotation), as used by PROJ.
 *   Validated against pyproj 3.8 (see test/geo.test.mjs): < 0.5 m.
 */
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
export const GRS80 = { a: 6378137, f: 1 / 298.257222101 };
export const MU_EARTH = 3.986004418e14;          // m³/s² (IERS)

const e2of = el => el.f * (2 - el.f);

export function llaToEcef(lat, lon, h = 0, el = WGS84) {
  const e2 = e2of(el), p = lat * D2R, l = lon * D2R, s = Math.sin(p), c = Math.cos(p);
  const N = el.a / Math.sqrt(1 - e2 * s * s);
  return [(N + h) * c * Math.cos(l), (N + h) * c * Math.sin(l), (N * (1 - e2) + h) * s];
}
/** ECEF → geodetic (Bowring start + 3 Newton-like iterations; mm accuracy for |h| < 1e7 m). */
export function ecefToLla(x, y, z, el = WGS84) {
  const e2 = e2of(el), a = el.a, b = a * (1 - el.f), p = Math.hypot(x, y), lon = Math.atan2(y, x);
  if (p < 1e-6) return { lat: z >= 0 ? 90 : -90, lon: 0, h: Math.abs(z) - b };
  let lat = Math.atan2(z, p * (1 - e2)), h = 0;
  for (let i = 0; i < 4; i++) { const s = Math.sin(lat), N = a / Math.sqrt(1 - e2 * s * s); h = p / Math.cos(lat) - N; lat = Math.atan2(z, p * (1 - e2 * N / (N + h))); }
  const s = Math.sin(lat), N = a / Math.sqrt(1 - e2 * s * s); h = Math.abs(lat) < 1.4 ? p / Math.cos(lat) - N : z / s - N * (1 - e2);
  return { lat: lat * R2D, lon: lon * R2D, h };
}

// ---------------------------------------------------------------- Transverse Mercator (Karney/Krüger)
function tmSetup(el, lat0, lon0, k0, FE, FN) {
  const n = el.f / (2 - el.f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = el.a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const al = [0, n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840, 212378941 * n6 / 319334400];
  const be = [0, n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
    n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
    17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
    4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
    4583 * n5 / 161280 - 108847 * n6 / 3991680, 20648693 * n6 / 638668800];
  const e = Math.sqrt(e2of(el));
  const T = { el, n, A, al, be, e, lon0: lon0 * D2R, k0, FE, FN, M0: 0 };
  T.M0 = tmFwdRaw(T, lat0 * D2R, T.lon0).y;     // northing of the origin latitude on the central meridian
  return T;
}
function tmFwdRaw(T, p, l) {
  const { e, al, A } = T, dl = l - T.lon0;
  const t = Math.sinh(Math.atanh(Math.sin(p)) - e * Math.atanh(e * Math.sin(p)));
  const xi1 = Math.atan2(t, Math.cos(dl)), eta1 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 6; j++) { xi += al[j] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1); eta += al[j] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1); }
  return { x: A * eta, y: A * xi };
}
function tmFwd(T, latDeg, lonDeg) { const r = tmFwdRaw(T, latDeg * D2R, lonDeg * D2R); return { E: T.FE + T.k0 * r.x, N: T.FN + T.k0 * (r.y - T.M0) }; }
function tmInv(T, E, N) {
  const { e, be, A } = T, xi = (N - T.FN) / T.k0 / A + T.M0 / A, eta = (E - T.FE) / T.k0 / A;
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 6; j++) { xi1 -= be[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); eta1 -= be[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const tp = Math.sin(xi1) / Math.sqrt(Math.sinh(eta1) ** 2 + Math.cos(xi1) ** 2);
  let t = tp; // solve conformal → geodetic (Newton, Karney eq. 19–21)
  for (let i = 0; i < 6; i++) { const s = Math.sqrt(1 + t * t), sig = Math.sinh(e * Math.atanh(e * t / s)), ts = t * Math.sqrt(1 + sig * sig) - sig * s;
    const dt = (tp - ts) / Math.sqrt(1 + ts * ts) * (1 + (1 - e * e) * t * t) / ((1 - e * e) * s); t += dt; if (Math.abs(dt) < 1e-14) break; }
  return { lat: Math.atan(t) * R2D, lon: (T.lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1))) * R2D };
}

// EPSG:2039 + Helmert EPSG:1073 (Israel 1993 → WGS 84, coordinate frame rotation)
const ITM_TM = tmSetup(GRS80, 31 + 44 / 60 + 3.817 / 3600, 35 + 12 / 60 + 16.261 / 3600, 1.0000067, 219529.584, 626907.390);
const AS = D2R / 3600, H = { tx: -24.0024, ty: -17.1032, tz: -17.8444, rx: -0.33077 * AS, ry: -1.85269 * AS, rz: 1.66969 * AS, s: 5.4248e-6 };
function helmert([x, y, z], dir) { // dir −1: Israel93 → WGS84 ; +1: inverse. Sign convention fixed by matching pyproj/PROJ (residual 0.3 m)
  const k = dir, s = 1 + k * H.s, rx = k * H.rx, ry = k * H.ry, rz = k * H.rz;
  if (dir > 0) return [H.tx + s * (x + rz * y - ry * z), H.ty + s * (-rz * x + y + rx * z), H.tz + s * (ry * x - rx * y + z)];
  const X = x - H.tx, Y = y - H.ty, Z = z - H.tz; return [s * (X + rz * Y - ry * Z), s * (-rz * X + Y + rx * Z), s * (ry * X - rx * Y + Z)];
}
/** WGS84 lat/lon (deg) → ITM {E, N} (m). */
export function wgsToItm(lat, lon) { const c = helmert(llaToEcef(lat, lon, 0, WGS84), 1); const g = ecefToLla(c[0], c[1], c[2], GRS80); return tmFwd(ITM_TM, g.lat, g.lon); }
/** ITM {E, N} → WGS84 {lat, lon} (deg). */
export function itmToWgs(E, N) { const g = tmInv(ITM_TM, E, N); const c = helmert(llaToEcef(g.lat, g.lon, 0, GRS80), -1); const w = ecefToLla(c[0], c[1], c[2], WGS84); return { lat: w.lat, lon: w.lon }; }
export const ITM_LON0 = 35 + 12 / 60 + 16.261 / 3600;
/** ITM meridian convergence γ (deg): grid azimuth = true azimuth − γ. Numerical (exact for the projection). */
export function itmConvergence(lat, lon) { const a = wgsToItm(lat, lon), b = wgsToItm(lat + 0.001, lon); return -Math.atan2(b.E - a.E, b.N - a.N) * R2D; }

// ---------------------------------------------------------------- the twin's local frame
export const ASHDOD_ORIGIN_ITM = { E: 166265, N: 634406 };   // = round(centre of twin/game Ashdod bbox_itm), as world.js
export class LocalFrame {
  constructor(E0 = ASHDOD_ORIGIN_ITM.E, N0 = ASHDOD_ORIGIN_ITM.N) {
    this.E0 = E0; this.N0 = N0; const g = itmToWgs(E0, N0); this.lat0 = g.lat; this.lon0 = g.lon;
    this.gamma = itmConvergence(g.lat, g.lon);
    this.o = llaToEcef(g.lat, g.lon, 0);
    const p = g.lat * D2R, l = g.lon * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
    const e = [-sl, cl, 0], n = [-sp * cl, -sp * sl, cp], u = [cp * cl, cp * sl, sp];
    const gr = this.gamma * D2R, cg = Math.cos(gr), sg = Math.sin(gr);
    // grid north has true azimuth γ ⇒ gridN = n·cosγ + e·sinγ ; gridE = e·cosγ − n·sinγ
    this.ex = e.map((v, i) => v * cg - n[i] * sg);      // local +x in ECEF
    this.ey = u;                                       // local +y
    const gn = e.map((v, i) => v * sg + n[i] * cg); this.ez = gn.map(v => -v);   // local +z = grid south
    // Earth centre / axis in local coordinates; local radius of curvature (Gaussian mean) for sphere approximations
    this.earthCentre = this.ecefToLocal(0, 0, 0);       // true centre of mass (≈ 3.6 km off the local normal at 31.8°N)
    this.axis = this.dirToLocal(0, 0, 1);
    const e2 = e2of(WGS84), w = 1 - e2 * sp * sp; this.R = WGS84.a * Math.sqrt(1 - e2) / w;   // sqrt(M·N) Gaussian mean radius
    // Sims and the globe use the OSCULATING SPHERE tangent at the origin: centre (0, −R, 0). "Up" = local normal at the
    // origin, altitude ≈ ellipsoidal height (< 50 m off within 500 km); gravity direction differs from geocentric by < 0.2°.
    this.center = { x: 0, y: -this.R, z: 0 };
  }
  ecefToLocal(X, Y, Z) { const d = [X - this.o[0], Y - this.o[1], Z - this.o[2]]; return { x: dot(d, this.ex), y: dot(d, this.ey), z: dot(d, this.ez) }; }
  dirToLocal(X, Y, Z) { const d = [X, Y, Z]; return { x: dot(d, this.ex), y: dot(d, this.ey), z: dot(d, this.ez) }; }
  localToEcef(x, y, z) { const o = this.o; return [o[0] + x * this.ex[0] + y * this.ey[0] + z * this.ez[0], o[1] + x * this.ex[1] + y * this.ey[1] + z * this.ez[1], o[2] + x * this.ex[2] + y * this.ey[2] + z * this.ez[2]]; }
  dirToEcef(x, y, z) { return [x * this.ex[0] + y * this.ey[0] + z * this.ez[0], x * this.ex[1] + y * this.ey[1] + z * this.ez[1], x * this.ex[2] + y * this.ey[2] + z * this.ez[2]]; }
  llaToLocal(lat, lon, h = 0) { const c = llaToEcef(lat, lon, h); return this.ecefToLocal(c[0], c[1], c[2]); }
  localToLla(x, y, z) { const c = this.localToEcef(x, y, z); return ecefToLla(c[0], c[1], c[2]); }
  /** ITM → local (flat, the city tiles' convention: x = E − E0, z = −(N − N0)) */
  itmToFlat(E, N) { return { x: E - this.E0, z: -(N - this.N0) }; }
  /** Geodetic height of a local point. Fast path (sphere, error < 0.3 m within 30 km) used every physics step:
   *  ellipsoid exact via localToLla when `exact`. */
  height(x, y, z, exact) { if (exact) return this.localToLla(x, y, z).h; const c = this.center; return Math.hypot(x - c.x, y - c.y, z - c.z) - this.R; }
  /** Unit "up" (radial from the sphere centre) at a local point. */
  up(x, y, z, out = {}) { const c = this.center, dx = x - c.x, dy = y - c.y, dz = z - c.z, l = Math.hypot(dx, dy, dz); out.x = dx / l; out.y = dy / l; out.z = dz / l; return out; }
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Geocentric direction to the sun in ECEF from the NOAA solar coordinates (declination δ, equation of time E, deg/min):
 *  subsolar point lat = δ, lon = −15°·(UTC_hours − 12 + E/60). Used to check the local sun vector (terminator). */
export function subsolarPoint(dateMs, decl, eqTimeMin) {
  const utcH = ((dateMs / 3600000) % 24 + 24) % 24; let lon = -15 * (utcH - 12 + eqTimeMin / 60); lon = ((lon + 540) % 360) - 180;
  return { lat: decl, lon };
}
