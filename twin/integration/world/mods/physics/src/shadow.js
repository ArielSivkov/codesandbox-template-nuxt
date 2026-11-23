/* ESH27 twin physics — shadow.js
 * Shadow of a vertical object / prism building on FLAT, HORIZONTAL ground.
 *
 *   length L = h / tan(elevation)          (h above the ground plane)
 *   direction = sun azimuth + 180°         (shadow points away from the sun)
 *   inverse:  h = L · tan(elevation)  with error propagation identical to
 *             twin/pipeline/yazam/shadow.py:  dH = sqrt((tan(e)·dL)² + (L·sec²(e)·de)²)
 *
 * APPROXIMATIONS (labeled):
 *   [S1] Flat horizontal ground. Slopes / other buildings receiving the shadow are not modelled here
 *        (the 3D renderer's shadow map handles that visually).
 *   [S2] Sun as a point source: real shadows have a penumbra of width ≈ L·0.53° (sun's angular diameter),
 *        e.g. 0.9 m for a 100 m long shadow. penumbraWidth() reports it.
 *   [S3] shadowPolygon(): union of footprint and the footprint translated by the shadow vector, computed as
 *        a convex hull — EXACT for convex footprints, an over-estimate for concave (L/U-shaped) ones.
 *   Elevation uses the refracted (apparent) sun by default, because light follows the refracted ray.
 *   NOTE: shadow.py uses the geometric (unrefracted) elevation; difference is ~0.16° at 5°, 0.09° at 10°.
 */
import { sunPosition, D2R } from './sun.js';

/** Shadow of height h (m) for a given sun {elevation, azimuth} (deg). Returns null when sun ≤ 0°. */
export function shadowFromSun(h, sun, gammaDeg = 0) {
  if (sun.elevation <= 0) return null;
  const t = Math.tan(sun.elevation * D2R);
  const L = h / t;
  const dirAz = (sun.azimuth + 180) % 360;                // true azimuth of the shadow direction
  const a = (dirAz - gammaDeg) * D2R;                      // grid azimuth if gamma given
  // ground vector in the twin frame (x east, z south)
  return { length: L, azimuth: dirAz, dx: L * Math.sin(a), dz: -L * Math.cos(a), ratio: 1 / t,
           penumbra: penumbraWidth(L, sun.elevation) };
}

/** Shadow of height h at an instant and place (uses sun.js). */
export function shadowAt(h, date, lat, lon, opts = {}) {
  const sun = sunPosition(date, lat, lon, opts);
  return { sun, shadow: shadowFromSun(h, sun, opts.gammaDeg || 0) };
}

/** Width of the penumbra at the shadow tip (m) [S2]: object-top-to-tip distance × sun angular diameter. */
export function penumbraWidth(L, elevationDeg, sunDiamDeg = 0.533) {
  const slant = L / Math.cos(elevationDeg * D2R);
  return slant * sunDiamDeg * D2R;
}

/** Inverse: height from a measured shadow length (mirrors shadow.py height_from_shadow). */
export function heightFromShadow(L, date, lat, lon, lenSigma = 0.5, elevSigmaDeg = 0.1, opts = { refraction: false }) {
  const s = sunPosition(date, lat, lon, opts);
  if (s.elevation <= 5) throw new Error(`sun too low for a reliable measurement (${s.elevation.toFixed(1)} deg)`);
  const t = Math.tan(s.elevation * D2R);
  const h = L * t;
  const sigma = Math.hypot(t * lenSigma, L / Math.cos(s.elevation * D2R) ** 2 * elevSigmaDeg * D2R);
  return { h, sigma, sun_elev: s.elevation, sun_az: s.azimuth, shadow_dir_az: (s.azimuth + 180) % 360 };
}

/** Project a 3D point (x,y,z) along the sun ray onto the plane y = groundY. sunDir = sunVector(...). */
export function projectToGround(p, sunDir, groundY = 0) {
  if (sunDir.y <= 0) return null;
  const k = (p.y - groundY) / sunDir.y;
  return { x: p.x - sunDir.x * k, y: groundY, z: p.z - sunDir.z * k };
}

/** Shadow polygon of a prism building (footprint [[x,z],...], height h above ground) [S3]. */
export function shadowPolygon(footprint, h, sunDir) {
  if (sunDir.y <= 0) return null;
  const k = h / sunDir.y;
  const pts = footprint.map(([x, z]) => [x, z]);
  for (const [x, z] of footprint) pts.push([x - sunDir.x * k, z - sunDir.z * k]);
  return convexHull(pts);
}

/** Point-in-polygon (ray casting), polygon [[x,z],...]. */
export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

