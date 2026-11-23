/* ITM (EPSG:2039, Israeli TM Grid) ↔ WGS84 – Transverse Mercator על אליפסואיד GRS80 (Snyder, USGS PP 1395, עמ' 61–64).
   APPROX (מסומן): הזזת דאטום Israel 1993→WGS84 כקבוע (−66.2 מ' מזרח, −41.0 מ' צפון), נמדד מול pyproj
   (EPSG:4326→2039) ב-4 נקודות (אשדוד, ת"א, ירושלים, ב"ש): שארית עד 0.4 מ' (באילת ובצפון עד 1.4 מ' – tests/test_pipeline.py). משמש למצלמה ולמעבר כדור→עיר, לא למדידה. כל הנתונים עצמם כבר ב-ITM אמיתי. */
const a = 6378137.0, f = 1 / 298.257222101, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
const k0 = 1.0000067, lat0 = 31.7343936111111 * Math.PI / 180, lon0 = 35.2045169444444 * Math.PI / 180, FE = 219529.584, FN = 626907.39;
const D = Math.PI / 180, DE = -66.2, DN = -41.0;
function M(phi) {
  return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
}
const M0 = M(lat0);
export function toITM(lat, lon) {
  const p = lat * D, l = lon * D, N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, A = (l - lon0) * Math.cos(p);
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M(p) - M0 + N * Math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [x + FE + DE, y + FN + DN];
}
export function fromITM(E, N) {
  const x = E - FE - DE, y = N - FN - DN, m = M0 + y / k0, mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, Dd = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (Dd * Dd / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Dd ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Dd ** 6 / 720);
  const lon = lon0 + (Dd - (1 + 2 * T1 + C1) * Dd ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Dd ** 5 / 120) / Math.cos(p1);
  return [lat / D, lon / D];
}
/** כיוון על כדור (מסגרת three.js של SphereGeometry + מרקם equirect): x = cosλcosφ, y = sinφ, z = −sinλcosφ */
export function ll2v(lat, lon, r = 1) { const p = lat * D, l = lon * D; return [r * Math.cos(l) * Math.cos(p), r * Math.sin(p), -r * Math.sin(l) * Math.cos(p)]; }
