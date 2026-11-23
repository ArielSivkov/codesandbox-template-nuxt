// weather.js — מתאם מזג אוויר ל"לוח היזם – עולם תאום של ישראל"
// מודול ES ללא תלויות. רץ בדפדפן (localStorage, fetch) וב-Node 18+ (fetch מובנה, אחסון בזיכרון).
//
// מקור ראשי: Open-Meteo (תחזית: api.open-meteo.com/v1/forecast, היסטוריה: archive-api.open-meteo.com/v1/archive).
// רישיון נתונים CC BY 4.0 — חובה להציג קישור "Weather data by Open-Meteo.com" ליד התצוגה (ATTRIBUTION למטה).
// שימוש מסחרי (מנוי / פרסומות / מוצר מסחרי) מחייב תוכנית בתשלום: customer-api.open-meteo.com + apikey.
// את המפתח לא שמים בדפדפן — מעבירים דרך worker/proxy.js (Cloudflare Worker) שמוסיף אותו בצד השרת.
//
// מוסכמת וקטור הרוח בתאום (אומתה מול swarm/game/js/world.js:  z0 = -((ty+1)*TILE - OY)  ומול
// twin/engine/map/js/app.js setSun:  x = sin(az), z = -cos(az)):  x = מזרח, y = למעלה, z = דרום (צפון = -z).
// אין עדיין מודול /home/claude/swarm/physics/ — אם צוות הפיזיקה יגדיר מוסכמה אחרת, משנים רק את windToVector/vectorToWind.
// כיוון רוח מטאורולוגי = הכיוון שממנו הרוח נושבת (0 = מצפון, 90 = ממזרח). הווקטור מצביע לאן האוויר זז.

export const ATTRIBUTION = { text: 'Weather data by Open-Meteo.com', href: 'https://open-meteo.com/', license: 'CC BY 4.0' };

export const ENDPOINTS = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  forecastCommercial: 'https://customer-api.open-meteo.com/v1/forecast',
  archive: 'https://archive-api.open-meteo.com/v1/archive',            // ERA5 / ERA5-Land, השהיה ~5 ימים
  historicalForecast: 'https://historical-forecast-api.open-meteo.com/v1/forecast', // ריצות תחזית מאורכבות, אותו מבנה כמו forecast
};

export const VARS = ['temperature_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'cloud_cover', 'precipitation', 'visibility', 'pressure_msl', 'is_day'];

const DEG = Math.PI / 180;
const HOUR = 3600e3;
export const FOG_K = Math.sqrt(3.912); // ≈1.978, ראו weatherToVisual

// ---------- המרות יחידות ----------
const SPEED_TO_MS = { 'm/s': 1, 'ms': 1, 'km/h': 1 / 3.6, 'kmh': 1 / 3.6, 'kn': 0.514444, 'knots': 0.514444, 'mph': 0.44704, 'mp/h': 0.44704 };
export function speedToMs(v, unit = 'm/s') {
  if (v == null || !Number.isFinite(+v)) return null;
  const k = SPEED_TO_MS[String(unit).trim().toLowerCase()];
  if (k == null) throw new Error(`יחידת מהירות לא מוכרת: ${unit}`);
  return +v * k;
}
export function tempToC(v, unit = '°C') {
  if (v == null || !Number.isFinite(+v)) return null;
  const u = String(unit).toLowerCase();
  if (u.includes('f')) return (+v - 32) * 5 / 9;
  if (u === 'k') return +v - 273.15;
  return +v;
}
export function lengthToMm(v, unit = 'mm') {
  if (v == null || !Number.isFinite(+v)) return null;
  const u = String(unit).toLowerCase();
  return u.startsWith('inch') || u === 'in' ? +v * 25.4 : +v;
}
export function distToM(v, unit = 'm') {
  if (v == null || !Number.isFinite(+v)) return null;
  const u = String(unit).toLowerCase();
  if (u === 'ft' || u === 'feet') return +v * 0.3048;
  if (u === 'km') return +v * 1000;
  return +v;
}
export function pressureToHpa(v, unit = 'hPa') {
  if (v == null || !Number.isFinite(+v)) return null;
  const u = String(unit).toLowerCase();
  if (u === 'pa') return +v / 100;
  if (u === 'inhg') return +v * 33.8639;
  return +v; // hPa == mb
}
const normDeg = d => ((d % 360) + 360) % 360;

// ---------- וקטור רוח ----------
/** מהירות (מ/ש) + כיוון מטאורולוגי "מאיפה" → וקטור תנועת האוויר במוסכמת התאום {x: מזרח, y: למעלה, z: דרום}. */
export function windToVector(speedMs, fromDeg) {
  const s = Math.max(0, +speedMs || 0), d = (+fromDeg || 0) * DEG;
  // האוויר נע לכיוון fromDeg+180: רכיב מזרח = -s·sin(d), רכיב צפון = -s·cos(d), z = -צפון
  const x = -s * Math.sin(d), z = s * Math.cos(d);
  return { x: Math.abs(x) < 1e-12 ? 0 : x, y: 0, z: Math.abs(z) < 1e-12 ? 0 : z };
}
/** פעולה הפוכה: וקטור תאום → {speed_ms, from_deg}. */
export function vectorToWind({ x = 0, z = 0 }) {
  const s = Math.hypot(x, z);
  if (s < 1e-9) return { speed_ms: 0, from_deg: 0 };
  return { speed_ms: s, from_deg: normDeg(Math.atan2(-x, z) / DEG) };
}
/** רוח בגובה h (מ') לפי חוק חזקה מרוח ב-10 מ'. alpha≈0.14 שטח פתוח/ים, ≈0.25–0.3 עיר. קירוב בלבד — לא מחליף מודל זרימה בין בניינים. */
export function windAtHeight(v10, h, alpha = 0.25) {
  if (!(v10 > 0)) return 0;
  return v10 * Math.pow(Math.max(h, 1) / 10, alpha);
}

// ---------- נרמול תשובת Open-Meteo ----------
function parseTime(t, offsetSec) {
  if (typeof t === 'number') return t * 1000;              // timeformat=unixtime (שניות UTC)
  // iso8601 של Open-Meteo הוא זמן מקומי ללא סיומת אזור; utc_offset_seconds קבוע לכל התשובה
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z');
  if (Number.isNaN(ms)) throw new Error(`זמן לא תקין: ${t}`);
  return ms - (offsetSec || 0) * 1000;
}
function rec(get, units, time, offset) {
  const u = k => (units && units[k]) || undefined;
  const r = {
    time: parseTime(time, offset),
    temp_c: tempToC(get('temperature_2m'), u('temperature_2m') || '°C'),
    wind_10m_ms: speedToMs(get('wind_speed_10m'), u('wind_speed_10m') || 'km/h'),
    wind_dir_deg: get('wind_direction_10m') == null ? null : normDeg(+get('wind_direction_10m')),
    gust_ms: speedToMs(get('wind_gusts_10m'), u('wind_gusts_10m') || 'km/h'),
    cloud_cover: get('cloud_cover') == null ? null : Math.min(100, Math.max(0, +get('cloud_cover'))),
    precip_mm: lengthToMm(get('precipitation'), u('precipitation') || 'mm'),
    visibility_m: distToM(get('visibility'), u('visibility') || 'm'),
    pressure_hpa: pressureToHpa(get('pressure_msl') ?? get('surface_pressure'), u('pressure_msl') || u('surface_pressure') || 'hPa'),
    is_day: get('is_day') == null ? null : +get('is_day') === 1,
  };
  if (r.gust_ms != null && r.wind_10m_ms != null && r.gust_ms < r.wind_10m_ms) r.gust_ms = r.wind_10m_ms;
  r.wind_vec = r.wind_10m_ms == null || r.wind_dir_deg == null ? null : windToVector(r.wind_10m_ms, r.wind_dir_deg);
  return r;
}
/** תשובת Open-Meteo (forecast / archive / historical-forecast) → מבנה אחיד. זורק אם המבנה שבור. */
export function normalizeOpenMeteo(json, source = 'open-meteo') {
  if (!json || typeof json !== 'object') throw new Error('תשובה ריקה');
  if (json.error) throw new Error(`Open-Meteo: ${json.reason || 'שגיאה'}`);
  const off = json.utc_offset_seconds || 0;
  const out = { source, lat: json.latitude, lon: json.longitude, elevation_m: json.elevation ?? null,
    timezone: json.timezone || 'GMT', current: null, hourly: [] };
  if (json.current && json.current.time != null) {
    const c = json.current;
    out.current = rec(k => c[k], json.current_units, c.time, off);
  }
  const h = json.hourly;
  if (h) {
    if (!Array.isArray(h.time)) throw new Error('hourly.time חסר');
    for (let i = 0; i < h.time.length; i++) out.hourly.push(rec(k => (h[k] ? h[k][i] : null), json.hourly_units, h.time[i], off));
  }
  if (!out.current && !out.hourly.length) throw new Error('אין current ואין hourly');
  // Open-Meteo לא מחזיר visibility ב-current בכל המודלים — ממלאים מהשעה הקרובה
  if (out.current && out.current.visibility_m == null && out.hourly.length) {
    const n = nearest(out.hourly, out.current.time); if (n) out.current.visibility_m = n.visibility_m;
  }
  return out;
}
function nearest(list, t) { let b = null, bd = Infinity; for (const r of list) { const d = Math.abs(r.time - t); if (d < bd) { bd = d; b = r; } } return b; }

/** אינטרפולציה בזמן t (ms) בין רשומות שעתיות. כיוון רוח מאונטרפל דרך רכיבי הווקטור (לא דרך מעלות, כדי לא לעבור דרך 180 בין 350 ל-10). */
export function sampleAt(hourly, t) {
  if (!hourly || !hourly.length) return null;
  if (t <= hourly[0].time) return { ...hourly[0], time: t };
  const last = hourly[hourly.length - 1];
  if (t >= last.time) return { ...last, time: t };
  let i = 1; while (hourly[i].time < t) i++;
  const a = hourly[i - 1], b = hourly[i], f = (t - a.time) / (b.time - a.time);
  const L = k => (a[k] == null || b[k] == null ? (f < 0.5 ? a[k] : b[k]) : a[k] + (b[k] - a[k]) * f);
  const r = { time: t, temp_c: L('temp_c'), wind_10m_ms: L('wind_10m_ms'), gust_ms: L('gust_ms'), cloud_cover: L('cloud_cover'),
    precip_mm: L('precip_mm'), visibility_m: L('visibility_m'), pressure_hpa: L('pressure_hpa'), is_day: f < 0.5 ? a.is_day : b.is_day, wind_dir_deg: null, wind_vec: null };
  if (a.wind_vec && b.wind_vec) {
    const v = { x: a.wind_vec.x + (b.wind_vec.x - a.wind_vec.x) * f, y: 0, z: a.wind_vec.z + (b.wind_vec.z - a.wind_vec.z) * f };
    const w = vectorToWind(v); r.wind_dir_deg = w.from_deg; r.wind_vec = windToVector(r.wind_10m_ms, w.from_deg);
  }
  return r;
}

// ---------- בניית כתובות ----------
function checkLatLon(lat, lon) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new TypeError(`lat לא תקין: ${lat}`);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new TypeError(`lon לא תקין: ${lon}`);
}
const r4 = v => Math.round(v * 1e4) / 1e4;
export function buildForecastUrl({ lat, lon, hours = 48, base = ENDPOINTS.forecast, apikey } = {}) {
  checkLatLon(lat, lon);
  const p = new URLSearchParams({ latitude: r4(lat), longitude: r4(lon), current: VARS.join(','), hourly: VARS.join(','),
    wind_speed_unit: 'ms', timeformat: 'unixtime', timezone: 'GMT', forecast_hours: String(hours) });
  if (apikey) p.set('apikey', apikey);
  return `${base}?${p}`;
}
// ERA5 (archive) אין בו visibility; is_day לא מתועד בטבלה — מבקשים רק משתנים מתועדים, אחרת Open-Meteo מחזיר 400.
export const ARCHIVE_VARS = VARS.filter(v => v !== 'visibility' && v !== 'is_day');
/** יום היסטורי ("שידור חוזר של יום אמיתי"). date = 'YYYY-MM-DD' (UTC).
 *  kind='historical-forecast' (ברירת מחדל: מ-~2022, אותו מבנה כמו forecast, כולל visibility) או 'archive' (ERA5, מ-1940, השהיה ~5 ימים). */
export function buildHistoricalUrl({ lat, lon, date, kind = 'historical-forecast', base, apikey } = {}) {
  checkLatLon(lat, lon);
  if (!/^\d{4}-\d\d-\d\d$/.test(date || '') || Number.isNaN(Date.parse(date))) throw new TypeError(`תאריך לא תקין: ${date}`);
  const vars = kind === 'archive' ? ARCHIVE_VARS : VARS;
  const p = new URLSearchParams({ latitude: r4(lat), longitude: r4(lon), start_date: date, end_date: date, hourly: vars.join(','),
    wind_speed_unit: 'ms', timeformat: 'unixtime', timezone: 'GMT' });
  if (apikey) p.set('apikey', apikey);
  return `${base || (kind === 'archive' ? ENDPOINTS.archive : ENDPOINTS.historicalForecast)}?${p}`;
}

// ---------- מטמון ----------
export function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, _map: m };
}
function defaultStorage() {
  try { if (typeof localStorage !== 'undefined') { const k = '__wx_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } } catch (e) { /* מצב פרטי / חסום */ }
  return memoryStorage();
}
/** מפתח מטמון: עיגול ל-0.01° (~1.1 ק"מ) — כל שכונה חולקת רשומה, פחות קריאות. */
export function cacheKey(kind, lat, lon, extra = '') { return `wx1:${kind}:${lat.toFixed(2)}:${lon.toFixed(2)}${extra ? ':' + extra : ''}`; }
export function createCache({ storage = defaultStorage(), now = () => Date.now() } = {}) {
  return {
    /** מחזיר {value, age_ms, fresh} או null. */
    get(key, ttlMs) {
      let raw; try { raw = storage.getItem(key); } catch (e) { return null; }
      if (!raw) return null;
      let o; try { o = JSON.parse(raw); } catch (e) { try { storage.removeItem(key); } catch (_) {} return null; }
      if (!o || typeof o.t !== 'number' || !('v' in o)) return null;
      const age = now() - o.t;
      return { value: o.v, age_ms: age, fresh: age >= 0 && age < ttlMs };
    },
    set(key, value) {
      try { storage.setItem(key, JSON.stringify({ t: now(), v: value })); return true; } catch (e) { return false; } // מכסה מלאה → ממשיכים בלי מטמון
    },
  };
}

// ---------- ערכות ידניות (מצב לא מקוון) ----------
// ערכים טיפוסיים לחוף אשדוד; לא מדידות. משמשים כשאין רשת ואין מטמון, או לבחירה ידנית בהדגמה.
export const PRESETS = {
  'calm-clear':   { label: 'בהיר ושקט',       temp_c: 24, wind_10m_ms: 1.5, wind_dir_deg: 300, gust_ms: 3,  cloud_cover: 5,   precip_mm: 0,   visibility_m: 30000, pressure_hpa: 1015 },
  'sea-breeze':   { label: 'בריזת ים',         temp_c: 28, wind_10m_ms: 6,   wind_dir_deg: 290, gust_ms: 9,  cloud_cover: 15,  precip_mm: 0,   visibility_m: 20000, pressure_hpa: 1012 },
  'sharav':       { label: 'שרב (מזרחית, אובך)', temp_c: 36, wind_10m_ms: 7,   wind_dir_deg: 100, gust_ms: 13, cloud_cover: 10,  precip_mm: 0,   visibility_m: 3000,  pressure_hpa: 1006 },
  'winter-storm': { label: 'סערת חורף',       temp_c: 13, wind_10m_ms: 12,  wind_dir_deg: 235, gust_ms: 21, cloud_cover: 100, precip_mm: 6,   visibility_m: 4000,  pressure_hpa: 998 },
  'drizzle':      { label: 'טפטוף מעונן',      temp_c: 16, wind_10m_ms: 4,   wind_dir_deg: 260, gust_ms: 7,  cloud_cover: 90,  precip_mm: 0.4, visibility_m: 9000,  pressure_hpa: 1010 },
  'fog-morning':  { label: 'ערפל בוקר',        temp_c: 15, wind_10m_ms: 1,   wind_dir_deg: 20,  gust_ms: 2,  cloud_cover: 60,  precip_mm: 0,   visibility_m: 400,   pressure_hpa: 1018 },
};
export function presetWeather(name = 'calm-clear', { now = Date.now(), hours = 48, lat = null, lon = null } = {}) {
  const p = PRESETS[name] || PRESETS['calm-clear'];
  const t0 = Math.floor(now / HOUR) * HOUR;
  const mk = t => { const { label, ...v } = p; return { time: t, ...v, is_day: isDayApprox(t, lat ?? 31.8, lon ?? 34.65), wind_vec: windToVector(p.wind_10m_ms, p.wind_dir_deg) }; };
  const hourly = []; for (let i = 0; i < hours; i++) hourly.push(mk(t0 + i * HOUR));
  return { source: 'preset:' + (PRESETS[name] ? name : 'calm-clear'), lat, lon, elevation_m: null, timezone: 'GMT', current: mk(now), hourly };
}
/** קירוב יום/לילה לפי גובה שמש (מספיק לערכה ידנית; Open-Meteo מחזיר is_day אמיתי). */
export function isDayApprox(t, lat, lon) {
  const d = t / 86400000 + 2440587.5 - 2451545.0, g = (357.529 + 0.98560028 * d) * DEG, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG, e = 23.439 * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24, ha = (gmst * 15 + lon) * DEG - ra, la = lat * DEG;
  return Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha) > -0.0145; // ‎-0.83°
}

// ---------- שליפה עם מטמון ונפילה חיננית ----------
async function fetchJson(url, { fetchImpl, timeoutMs }) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw Object.assign(new Error('אין fetch בסביבה'), { code: 'NO_FETCH' });
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    let res;
    try { res = await f(url, ac ? { signal: ac.signal } : {}); }
    catch (e) { throw Object.assign(new Error(ac && ac.signal.aborted ? `תם הזמן (${timeoutMs} ms)` : `שגיאת רשת: ${e.message}`), { code: ac && ac.signal.aborted ? 'TIMEOUT' : 'NETWORK' }); }
    let body = null; try { body = await res.json(); } catch (e) { /* גוף לא JSON */ }
    if (!res.ok) {
      const code = res.status === 429 ? 'RATE_LIMIT' : res.status >= 500 ? 'SERVER' : 'HTTP';
      throw Object.assign(new Error(`HTTP ${res.status}${body && body.reason ? ': ' + body.reason : ''}`), { code, status: res.status });
    }
    if (!body) throw Object.assign(new Error('גוף התשובה אינו JSON'), { code: 'BAD_BODY' });
    return body;
  } finally { if (timer) clearTimeout(timer); }
}

// tries: [{url, source}] — מנסים לפי הסדר; עוברים לבא רק על שגיאת HTTP/פענוח (לא על רשת/זמן — שם המקור הבא ייכשל גם).
async function cachedFetch({ key, tries, ttlMs, maxStaleMs, fetchImpl, timeoutMs, cache, fallback }) {
  const hit = cache.get(key, ttlMs);
  if (hit && hit.fresh) return { status: 'cache', age_ms: hit.age_ms, data: hit.value };
  let err;
  for (const t of tries) {
    try {
      const json = await fetchJson(t.url, { fetchImpl, timeoutMs });
      const data = normalizeOpenMeteo(json, t.source);
      cache.set(key, data);
      return { status: 'live', age_ms: 0, data };
    } catch (e) { err = e; if (['NETWORK', 'TIMEOUT', 'NO_FETCH', 'RATE_LIMIT'].includes(e.code)) break; }
  }
  {
    const error = { code: err.code || 'PARSE', message: err.message };
    if (hit && hit.age_ms <= maxStaleMs) return { status: 'stale-cache', age_ms: hit.age_ms, data: hit.value, error };
    return { status: 'preset', age_ms: null, data: fallback(), error };
  }
}

/**
 * מזג אוויר נוכחי + תחזית שעתית. לעולם לא נכשל בגלל רשת: מחזיר {status, data, error?, age_ms}.
 * status: 'live' | 'cache' | 'stale-cache' | 'preset'.  זורק TypeError רק על קלט שגוי (lat/lon).
 */
export async function getWeather({ lat, lon, hours = 48, ttlMs = 30 * 60e3, maxStaleMs = 48 * HOUR, timeoutMs = 8000,
  fetchImpl, storage, now = () => Date.now(), preset = 'calm-clear', base, apikey } = {}) {
  const url = buildForecastUrl({ lat, lon, hours, base, apikey });
  const cache = createCache({ storage, now });
  return cachedFetch({ key: cacheKey('fc', lat, lon), tries: [{ url, source: 'open-meteo:forecast' }], ttlMs, maxStaleMs, fetchImpl, timeoutMs, cache,
    fallback: () => presetWeather(preset, { now: now(), hours, lat, lon }) });
}
/** יום היסטורי לשידור חוזר: קודם historical-forecast (כולל visibility), ואם נדחה (למשל תאריך לפני 2022) — ERA5 archive.
 *  נתון היסטורי כמעט לא משתנה — TTL ארוך (30 יום). */
export async function getHistoricalDay({ lat, lon, date, ttlMs = 30 * 24 * HOUR, timeoutMs = 15000, fetchImpl, storage, now = () => Date.now(),
  preset = 'calm-clear', apikey } = {}) {
  const tries = [
    { url: buildHistoricalUrl({ lat, lon, date, kind: 'historical-forecast', apikey }), source: 'open-meteo:historical-forecast' },
    { url: buildHistoricalUrl({ lat, lon, date, kind: 'archive', apikey }), source: 'open-meteo:archive-era5' },
  ];
  const cache = createCache({ storage, now });
  return cachedFetch({ key: cacheKey('day', lat, lon, date), tries, ttlMs, maxStaleMs: Infinity, fetchImpl, timeoutMs, cache,
    fallback: () => presetWeather(preset, { now: Date.parse(date + 'T00:00:00Z'), hours: 24, lat, lon }) });
}

// ---------- מיפוי לתצוגה ----------
/** רשומה מנורמלת → פרמטרים לרינדור (ערכים 0..1 ופקטורים). פונקציה טהורה, ניתנת לבדיקה. */
export function weatherToVisual(r) {
  const cc = (r.cloud_cover ?? 0) / 100, mm = Math.max(0, r.precip_mm ?? 0);
  const vis = Math.max(50, r.visibility_m ?? 30000);
  // עוצמת גשם: 0 ב-0 מ"מ/ש, ~0.5 ב-2 מ"מ/ש (גשם בינוני), רוויה ~1 ב-10+ מ"מ/ש
  const rain = mm <= 0.05 ? 0 : Math.min(1, Math.log1p(mm) / Math.log1p(10));
  // שמש ישירה מתעמעמת עם עננות; צל נשאר מורגש עד ~70% ואז נעלם כמעט (אור מפוזר)
  const sun = 1 - 0.85 * Math.pow(cc, 1.5);
  const shadow = Math.max(0.05, 1 - Math.pow(cc, 2.2) * 0.95);
  // ערפל: חוק קושמידר, טווח ראייה V = 3.912/σ. ב-FogExp2 גורם = exp(-(ρ·d)²); נבחר ρ כך שבמרחק V נשאר 2% ניגודיות:
  // (ρ·V)² = 3.912 → ρ = √3.912 / V ≈ 1.978/V
  const fogDensity = FOG_K / vis;
  const wet = Math.min(1, rain * 1.4 + (mm > 0 ? 0.15 : 0));
  return { rain, sun, shadow, fogDensity, wet, cloud: cc, day: r.is_day !== false,
    wind: r.wind_vec || windToVector(r.wind_10m_ms || 0, r.wind_dir_deg || 0), gust_ms: r.gust_ms ?? r.wind_10m_ms ?? 0 };
}
