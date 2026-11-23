// Builds data/terrain.json — a COARSE TERRAIN FIXTURE (NOT a DEM) for the far field of Israel / east Mediterranean.
// Why a fixture: no DEM host was reachable from the build machine (AWS terrain tiles / Copernicus / Open-Meteo were
// blocked by the proxy on 23.11.2026). The relief is hand-modelled from well-known summit / valley heights
// (Meron 1208 m, Hebron hills ~1000 m, Jerusalem ~800 m, Carmel ~550 m, Hermon 2814 m, Kinneret −209 m, Dead Sea −430 m,
// Ramon ~1000 m, St Catherine 2629 m, Troodos 1952 m, Lebanon range ~3000 m, Edom/Shara ~1500 m), as smooth ridges and a
// rift valley, over the Natural Earth land mask. Expect errors of hundreds of metres. Replace with a real DEM
// (e.g. Copernicus GLO-90, pipeline/yazam/dem.py) by writing the same JSON format: {bbox, nx, ny, data: base64 Int16 (m)}.
import fs from 'node:fs';
const R = JSON.parse(fs.readFileSync(new URL('../data/region.json', import.meta.url)));
const [lon0, lat0, lon1, lat1] = R.bbox, STEP = 0.04, nx = Math.round((lon1 - lon0) / STEP) + 1, ny = Math.round((lat1 - lat0) / STEP) + 1;
const KX = 111.32 * Math.cos(32 * Math.PI / 180), KY = 110.9;           // km per degree (approx. at 32°N)
const pip = (x, y, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const inAny = (x, y, rings) => { let c = false; for (const r of rings) if (pip(x, y, r)) c = !c; return c; };   // even-odd (holes)
const segs = []; for (const r of R.land) for (let i = 0; i + 1 < r.length; i++) { const a = r[i], b = r[i + 1]; if (a[0] <= lon0 + 1e-6 && b[0] <= lon0 + 1e-6 || a[0] >= lon1 - 1e-6 && b[0] >= lon1 - 1e-6 || a[1] <= lat0 + 1e-6 && b[1] <= lat0 + 1e-6 || a[1] >= lat1 - 1e-6 && b[1] >= lat1 - 1e-6) continue; segs.push([a[0] * KX, a[1] * KY, b[0] * KX, b[1] * KY]); }
function segD(px, py, s) { const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / L)) : 0; return [Math.hypot(px - s[0] - t * dx, py - s[1] - t * dy), t]; }
const coastD = (lon, lat) => { const px = lon * KX, py = lat * KY; let m = 1e9; for (const s of segs) { if (Math.abs(s[0] - px) > m + 60 && Math.abs(s[2] - px) > m + 60) continue; const d = segD(px, py, s)[0]; if (d < m) m = d; } return m; };
// ridges: [[lat, lon, h], ...], sigma km
const RIDGES = [
  [[[31.35, 35.05, 850], [31.53, 35.10, 1010], [31.78, 35.21, 800], [31.92, 35.22, 880], [32.20, 35.27, 920], [32.46, 35.30, 520]], 11],   // Judea–Samaria
  [[[32.82, 34.98, 300], [32.73, 35.05, 520], [32.60, 35.13, 350]], 4],                                                                    // Carmel
  [[[32.70, 35.30, 450], [32.88, 35.38, 900], [32.99, 35.41, 1200], [33.10, 35.45, 800]], 9],                                             // Galilee / Meron
  [[[33.30, 35.50, 1300], [33.60, 35.65, 1900], [33.95, 35.85, 2600], [34.30, 36.10, 3000], [34.55, 36.25, 2000]], 15],                   // Mount Lebanon
  [[[33.30, 35.75, 1500], [33.41, 35.86, 2800], [33.70, 36.10, 2300], [34.00, 36.40, 2000]], 9],                                           // Hermon / Anti-Lebanon
  [[[33.10, 35.80, 900], [32.80, 35.75, 450]], 14],                                                                                         // Golan
  [[[32.65, 35.85, 1000], [32.20, 35.75, 1050], [31.70, 35.75, 900], [31.20, 35.70, 1150], [30.60, 35.60, 1500], [30.00, 35.45, 1400], [29.50, 35.30, 1300]], 16], // Gilead / Moab / Edom
  [[[32.60, 36.40, 850], [31.50, 36.20, 800], [30.30, 36.00, 950], [29.40, 35.80, 1100]], 45],                                            // Transjordan plateau
  [[[33.00, 36.40, 750], [33.40, 36.60, 700]], 40],                                                                                         // Hauran / Damascus plateau
  [[[31.25, 34.80, 280], [30.90, 34.85, 550], [30.60, 34.85, 950], [30.25, 34.95, 750], [29.80, 34.95, 650]], 14],                         // Negev highlands / Ramon
  [[[30.40, 35.15, 450], [29.90, 35.05, 600], [29.55, 34.95, 800]], 7],                                                                    // Eilat mountains
  [[[29.90, 33.80, 900], [29.50, 33.95, 1300], [29.10, 33.70, 1600]], 45],                                                                  // El Tih plateau
  [[[28.80, 33.80, 1600], [28.55, 33.95, 2600], [28.30, 34.10, 2000], [28.05, 34.30, 1500]], 22],                                           // South Sinai massif
  [[[27.60, 32.95, 1400], [28.30, 32.40, 1200]], 28],                                                                                       // Red Sea hills (Egypt)
  [[[34.93, 32.86, 1950], [34.85, 33.20, 900]], 14], [[[35.30, 33.20, 900], [35.33, 33.80, 700]], 5],                                     // Troodos, Kyrenia (Cyprus)
  [[[36.40, 33.00, 1800], [36.50, 34.50, 2200], [36.50, 36.20, 1800]], 30],                                                               // Taurus edge (Turkey)
  [[[30.90, 34.35, 250], [30.60, 34.20, 400]], 25],                                                                                        // NW Negev / Sinai dunes
];
// Jordan rift: floor polyline [[lat, lon, floor]], half-width km
const RIFT = [[33.20, 35.60, 80], [33.05, 35.61, 60], [32.83, 35.59, -209], [32.50, 35.56, -260], [32.00, 35.53, -300], [31.75, 35.55, -400], [31.50, 35.48, -430], [31.10, 35.40, -390], [30.80, 35.27, -100], [30.40, 35.15, 100], [29.90, 35.05, 50], [29.55, 34.97, 0]];
const RIFT_W = 6;
function distPoly(lat, lon, pts) { const px = lon * KX, py = lat * KY; let best = [1e9, 0, 0]; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; const [d, t] = segD(px, py, [a[1] * KX, a[0] * KY, b[1] * KX, b[0] * KY]); if (d < best[0]) best = [d, i, t]; } const a = pts[best[1]], b = pts[best[1] + 1]; return [best[0], a[2] + (b[2] - a[2]) * best[2]]; }
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (hash(i, j) * (1 - u) + hash(i + 1, j) * u) * (1 - v) + (hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u) * v; };
function elev(lat, lon) {
  const dc = coastD(lon, lat);
  let h = Math.min(180, 8 + 5.5 * dc);
  for (const [pts, sg] of RIDGES) { const [d, hh] = distPoly(lat, lon, pts); h = Math.max(h, hh * Math.exp(-((d / sg) ** 2))); }
  const n = vnoise(lon * 12, lat * 12) * 0.6 + vnoise(lon * 31, lat * 31) * 0.4; h += (n - 0.5) * Math.min(220, h * 0.25);
  const [dr, fl] = distPoly(lat, lon, RIFT); if (dr < RIFT_W + 14) { const t = Math.max(0, Math.min(1, (dr - RIFT_W) / 14)); h = fl + (h - fl) * t * t * (3 - 2 * t); }
  return h;
}
const LAKE_LEVEL = lake => { const c = lake.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map(v => v / lake.length); if (c[1] > 31 && c[1] < 31.8 && c[0] > 35.3 && c[0] < 35.7) return -430; if (c[1] > 32.6 && c[1] < 33 && c[0] > 35.5 && c[0] < 35.7) return -209; return null; };
const out = new Int16Array(nx * ny); let land = 0, mn = 1e9, mx = -1e9;
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const lon = lon0 + i * STEP, lat = lat0 + j * STEP; let h = 0;
  if (inAny(lon, lat, R.land)) { h = elev(lat, lon); land++; for (const lk of R.lakes) if (pip(lon, lat, lk)) { const lv = LAKE_LEVEL(lk); if (lv != null) h = lv; } }
  out[j * nx + i] = Math.round(h); mn = Math.min(mn, h); mx = Math.max(mx, h);
}
const T = { v: 1, kind: 'FIXTURE — hand-modelled coarse relief, NOT measured (see tools/build_terrain.mjs)', bbox: R.bbox, nx, ny, step: STEP, rowOrder: 'south→north, west→east', units: 'm above sea level, Int16 LE', data: Buffer.from(out.buffer).toString('base64') };
fs.writeFileSync(new URL('../data/terrain.json', import.meta.url), JSON.stringify(T));
const at = (la, lo) => out[Math.round((la - lat0) / STEP) * nx + Math.round((lo - lon0) / STEP)];
console.log(`terrain fixture ${nx}×${ny}, land cells ${land}, min ${mn.toFixed(0)} max ${mx.toFixed(0)} | Ashdod ${at(31.80, 34.66)} Jerusalem ${at(31.78, 35.21)} Meron ${at(32.99, 35.41)} DeadSea ${at(31.5, 35.5)} Hermon ${at(33.41, 35.86)} Kinneret ${at(32.82, 35.59)} TelAviv ${at(32.08, 34.80)} sea ${at(32.0, 34.0)}`);
