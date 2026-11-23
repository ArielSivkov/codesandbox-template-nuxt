/* ESH27 twin — atmosphere — airquality.js
 * Air-quality adapters + the physical mapping "pollution → what the air looks like".
 * Pure JS (browser + Node 18). Never throws on network: falls back to cache, then to a preset.
 *
 * SOURCES (see README.txt for terms):
 *  1. Israel Ministry of Environmental Protection air-monitoring network — https://air.sviva.gov.il
 *     (המשרד להגנת הסביבה – ניטור אוויר; the Ashdod stations are run with the Ashdod-region
 *     environmental association). Measured, per station, 5–30 min. Its REST access needs a token
 *     → server-side proxy only. Field names below follow the Envista-style JSON used by Israeli
 *     government monitoring APIs — UNVERIFIED from this sandbox (network blocked); confirm with the
 *     ministry before production.
 *  2. Open-Meteo Air Quality API — https://air-quality-api.open-meteo.com/v1/air-quality
 *     (CAMS model data; Ashdod lies inside the CAMS-Europe 0.1° domain). Free for NON-COMMERCIAL use,
 *     commercial use needs an API key (customer- server). Must credit Open-Meteo AND CAMS.
 *  3. Copernicus CAMS (ads.atmosphere.copernicus.eu) — free & open under the Copernicus licence,
 *     attribution "Generated using Copernicus Atmosphere Monitoring Service information <year>".
 *
 * VISUAL MAPPING (labeled approximations):
 *  • Extinction b_ext [Mm⁻¹] follows the revised IMPROVE algorithm idea (Pitchford et al. 2007,
 *    JAWMA 57:1326): b = Rayleigh(11) + 3·f(RH)·fine(non-dust) + 1·fineDust + 0.6·coarse + 0.33·NO2[ppb]
 *    (fine non-dust lumped at the sulfate/nitrate/organic average efficiency).
 *  • Desert dust (sharav) uses the empirical Saharan-dust relation of d'Almeida (1986),
 *    C = 914·V^−0.73 + 19 (C µg/m³, V km), inverted — dust is far more visible per µg than IMPROVE "coarse".
 *  • Visibility (Koschmieder): V = 3.912 / b_ext.
 *  • Fog/haze for rendering: exponential extinction β = b_ext (per metre).
 */

export const OPEN_METEO_AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const ATTRIBUTION_AQ = {
  openMeteo: '<a href="https://open-meteo.com/">Air quality data by Open-Meteo.com</a> · CAMS — Copernicus Atmosphere Monitoring Service',
  cams: 'Generated using Copernicus Atmosphere Monitoring Service information ' + new Date().getUTCFullYear(),
  sviva: 'נתוני ניטור: המשרד להגנת הסביבה – air.sviva.gov.il',
  preset: 'נתוני דוגמה (לא מדידה)',
};
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// ------------------------------------------------------------------ presets (art-directed, plausible values)
export const AQ_PRESETS = {
  clean:  { label_he: 'אוויר נקי',      pm25: 8,   pm10: 22,  dust: 6,   no2: 12, rh: 62, note: 'בריזת ים, אחרי גשם' },
  sharav: { label_he: 'שרב (אבק)',      pm25: 110, pm10: 600, dust: 520, no2: 18, rh: 18, note: 'סופת אבק מזרחית/דרומית; PM10 של מאות עד אלפי מק"ג נמדדים בישראל באירועי אבק' },
  smog:   { label_he: 'ערפיח עירוני',    pm25: 48,  pm10: 75,  dust: 12,  no2: 70, rh: 70, note: 'היפוך טמפרטורה, תנועה ונמל, בוקר חורף' },
  storm:  { label_he: 'סערת חורף',       pm25: 5,   pm10: 30,  dust: 2,   no2: 8,  rh: 92, note: 'ריסוס ימי ורטיבות, ראות מוגבלת בגשם' },
};

// ------------------------------------------------------------------ physics of the look
const ugToPpbNO2 = ug => ug / 1.88;   // 25 °C, 1 atm

/** Hygroscopic growth f(RH) ≈ (1 − RH)^−0.5, capped (approx.). */
export function fRH(rh = 60) { const r = clamp(rh, 0, 95) / 100; return Math.min(4, Math.pow(1 - r, -0.5)); }

/** Dust extinction [Mm⁻¹] from dust mass (µg/m³), inverted d'Almeida (1986). 0 below the 19 µg/m³ offset. */
export function dustExtinction(dust) {
  const c = Math.max(0, dust - 19);
  if (c <= 0) return 0;
  const Vkm = Math.pow(c / 914.06, -1 / 0.73);
  return 3912 / Vkm;
}

/** Fill missing dust from PM10/PM2.5 (station data has no dust channel): coarse-dominated mass is treated as dust. */
export function estimateDust(aq) {
  if (aq.dust != null) return aq.dust;
  const pm10 = aq.pm10 || 0, pm25 = aq.pm25 != null ? aq.pm25 : pm10 * 0.5;
  return Math.max(0, pm10 - 1.8 * pm25) * (pm10 / Math.max(1, pm25) > 2.5 ? 1 : 0.4);
}

/**
 * Air quality → atmosphere parameters for rendering.
 * @param aq {pm25, pm10, dust?, no2?, aod?, rh?}  µg/m³
 * @returns {bext (Mm⁻¹), visibility_m, beta (1/m), tau550, alpha, absorb, no2, hazeColor (sRGB 0-1), dustiness 0-1, smogginess 0-1, shares}
 */
export function aqToAtmosphere(aq = AQ_PRESETS.clean) {
  const pm10 = Math.max(0, aq.pm10 || 0), pm25 = Math.min(Math.max(0, aq.pm25 != null ? aq.pm25 : pm10 * 0.5), Math.max(pm10, aq.pm25 || 0));
  const dust = Math.max(0, estimateDust(aq)), no2 = Math.max(0, aq.no2 || 0), f = fRH(aq.rh != null ? aq.rh : 60);
  const fineDust = Math.min(pm25, 0.22 * dust);
  const fineOther = Math.max(0, pm25 - fineDust);
  const coarseOther = Math.max(0, pm10 - pm25 - Math.max(0, dust - fineDust));
  const parts = {
    rayleigh: 11,
    fine: 3 * f * fineOther,
    dust: Math.max(dustExtinction(dust), 1.0 * fineDust + 0.6 * Math.max(0, dust - fineDust)),
    coarse: 0.6 * coarseOther * (0.6 + 0.4 * f),       // sea salt grows with humidity too
    no2: 0.33 * ugToPpbNO2(no2),
  };
  const bext = parts.rayleigh + parts.fine + parts.dust + parts.coarse + parts.no2;
  const visibility_m = 3.912 / (bext * 1e-6);
  // column optical depth: mixed layer ~1.2 km for local pollution, dust layers ~3 km (approx.); or use model AOD
  const aerExt = bext - parts.rayleigh - parts.no2;
  const tauModel = (parts.fine + parts.coarse) * 1e-6 * 1200 + parts.dust * 1e-6 * 1300 + 0.05;
  const tau550 = aq.aod != null && isFinite(aq.aod) ? Math.max(aq.aod, 0.02) : tauModel;
  const wDust = parts.dust / Math.max(1e-6, aerExt), wFine = parts.fine / Math.max(1e-6, aerExt), wCoarse = parts.coarse / Math.max(1e-6, aerExt);
  const alpha = 0.15 * wDust + 1.45 * wFine + 0.35 * wCoarse;                  // Ångström exponent
  const absorb = clamp(0.06 + 0.10 * wDust + 0.10 * wFine * (1 + no2 / 60), 0.04, 0.35);
  // haze colour (sRGB albedo of the aerosol "veil" under white light): clean = blue-white, dust = ochre, smog = grey-brown
  const cClean = [0.80, 0.86, 0.93], cSalt = [0.90, 0.91, 0.92], cDust = [0.84, 0.68, 0.45], cSmog = [0.70, 0.66, 0.60], cNO2 = [0.66, 0.53, 0.38];
  const smogF = clamp((pm25 - 12) / 40, 0, 1);   // low PM2.5 on the coast is mostly sea salt / sulfate → white veil, not brown
  const w = { clean: parts.rayleigh, salt: parts.coarse + parts.fine * (1 - smogF), dust: parts.dust, smog: parts.fine * smogF, no2: parts.no2 * 4 };
  const W = w.clean + w.salt + w.dust + w.smog + w.no2;
  const hazeColor = [0, 1, 2].map(i => (cClean[i] * w.clean + cSalt[i] * w.salt + cDust[i] * w.dust + cSmog[i] * w.smog + cNO2[i] * w.no2) / W);
  return {
    bext, visibility_m, beta: bext * 1e-6, tau550, alpha, absorb, no2, hazeColor,
    dustiness: clamp(parts.dust / Math.max(1, bext) * clamp(Math.log10(1 + parts.dust / 30), 0, 1.2), 0, 1),
    smogginess: clamp((parts.fine + parts.no2) / Math.max(1, bext) * clamp(Math.log10(1 + (parts.fine + parts.no2) / 30), 0, 1.2), 0, 1),
    parts,
  };
}

// ------------------------------------------------------------------ indices + Hebrew chip
/** European AQI bands by pollutant (EEA, µg/m³; 1-hour/24-hour mixed as published by EEA pre-2025 revision). */
const EAQI_BANDS = {
  pm25: [10, 20, 25, 50, 75],
  pm10: [20, 40, 50, 100, 150],
  no2:  [40, 90, 120, 230, 340],
};
export const EAQI_HE = ['טובה', 'סבירה', 'בינונית', 'ירודה', 'ירודה מאוד', 'ירודה ביותר'];
export const EAQI_COLOR = ['#50F0E6', '#50CCAA', '#F0E641', '#FF5050', '#960032', '#7D2181'];
/** European AQI level 0..5 (worst pollutant) from concentrations. */
export function eaqiLevel(aq) {
  let worst = 0, by = 'pm10';
  for (const k of Object.keys(EAQI_BANDS)) {
    const v = aq[k]; if (v == null) continue;
    let lvl = EAQI_BANDS[k].findIndex(t => v <= t); if (lvl < 0) lvl = 5;
    if (lvl > worst) { worst = lvl; by = k; }
  }
  return { level: worst, by, label_he: EAQI_HE[worst], color: EAQI_COLOR[worst] };
}
/** Israeli index (מדד איכות אוויר, 100 … −400) categories — used only when a station feed provides the index value itself. */
export function israelIndexCategory(v) {
  if (v == null || !isFinite(v)) return null;
  if (v >= 51) return { label_he: 'איכות אוויר טובה', color: '#00E400' };
  if (v >= 0) return { label_he: 'זיהום אוויר ברמה בינונית', color: '#FFFF00' };
  if (v >= -200) return { label_he: 'זיהום אוויר ברמה גבוהה', color: '#FF0000' };
  return { label_he: 'זיהום אוויר ברמה גבוהה מאוד', color: '#7E0023' };
}
const POLL_HE = { pm25: 'חלקיקים עדינים PM2.5', pm10: 'חלקיקים PM10', no2: 'חנקן דו-חמצני', dust: 'אבק' };
const fmtKm = m => m >= 10000 ? Math.round(m / 1000) + ' ק"מ' : (Math.round(m / 100) / 10) + ' ק"מ';
/** Data for the Hebrew AQI chip. */
export function aqiChip(aq, atm = aqToAtmosphere(aq)) {
  const il = israelIndexCategory(aq.ilIndex);
  const e = eaqiLevel(aq);
  const main = il ? il.label_he : 'איכות אוויר ' + e.label_he;
  const dusty = atm.dustiness > 0.35;
  const parts = [];
  if (dusty) parts.push('אבק ' + Math.round(estimateDust(aq)) + ' מק"ג/מ"ק');
  else parts.push(POLL_HE[e.by].split(' ').pop() + ' ' + Math.round(aq[e.by] || 0));
  parts.push('ראות ~' + fmtKm(Math.min(atm.visibility_m, 99000)));
  return {
    text: main + ' · ' + parts.join(' · '), main, detail: parts.join(' · '), color: il ? il.color : e.color, level: e.level,
    scale_he: il ? 'מדד ישראלי (100 עד −400)' : 'מדד אירופי (EAQI) מחושב מריכוזים',
    source_he: aq.source === 'sviva' ? ATTRIBUTION_AQ.sviva : aq.source === 'open-meteo' ? 'Open-Meteo / CAMS' : ATTRIBUTION_AQ.preset,
  };
}

// ------------------------------------------------------------------ adapters
/** Open-Meteo AQ JSON → [{time(ms UTC), pm25, pm10, dust, no2, aod, eaqi}] */
export function normalizeOpenMeteoAQ(j) {
  if (!j || !j.hourly || !Array.isArray(j.hourly.time)) throw Object.assign(new Error('bad open-meteo body'), { code: 'BAD_BODY' });
  const H = j.hourly, off = (j.utc_offset_seconds || 0) * 1000, n = H.time.length, out = [];
  const num = (a, i) => a && a[i] != null && isFinite(a[i]) ? +a[i] : null;
  for (let i = 0; i < n; i++) {
    const t = H.time[i];
    const ms = typeof t === 'number' ? t * 1000 : Date.parse(t + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z')) - off;
    out.push({ time: ms, pm25: num(H.pm2_5, i), pm10: num(H.pm10, i), dust: num(H.dust, i), no2: num(H.nitrogen_dioxide, i), aod: num(H.aerosol_optical_depth, i), eaqi: num(H.european_aqi, i), source: 'open-meteo' });
  }
  return out;
}
export function openMeteoAQUrl({ lat, lon, base = OPEN_METEO_AQ_URL, apikey, pastDays = 1, forecastDays = 2 }) {
  const p = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), hourly: 'pm10,pm2_5,dust,nitrogen_dioxide,aerosol_optical_depth,european_aqi',
    timezone: 'GMT', past_days: String(pastDays), forecast_days: String(forecastDays), domains: 'auto' });
  if (apikey) p.set('apikey', apikey);
  return base + '?' + p.toString();
}
/**
 * Ministry station JSON (Envista-style, UNVERIFIED field names) → record.
 * Expected: { data: [ { datetime: ISO, channels: [ { name: 'PM10'|'PM2.5'|'NO2'|..., value, valid: bool } ] } ] }
 * Some feeds also carry an index channel ('AQI' / 'מדד') on the 100…−400 Israeli scale.
 */
export function normalizeSviva(j, stationName = '') {
  const rows = j && (j.data || j.Data); if (!Array.isArray(rows)) throw Object.assign(new Error('bad sviva body'), { code: 'BAD_BODY' });
  const map = { 'PM10': 'pm10', 'PM2.5': 'pm25', 'PM25': 'pm25', 'NO2': 'no2', 'AQI': 'ilIndex', 'מדד': 'ilIndex' };
  return rows.map(r => {
    const rec = { time: Date.parse(r.datetime || r.DateTime), source: 'sviva', station: stationName };
    for (const c of r.channels || r.Channels || []) { const k = map[c.name || c.Name]; if (k && (c.valid !== false && c.Valid !== false) && isFinite(c.value ?? c.Value)) rec[k] = +(c.value ?? c.Value); }
    return rec;
  }).filter(r => isFinite(r.time));
}
/** Nearest-in-time record (no interpolation of dust events — they are bursty). */
export function sampleAQ(records, ms) {
  let best = null, bd = Infinity; for (const r of records || []) { const d = Math.abs(r.time - ms); if (d < bd && (r.pm10 != null || r.pm25 != null)) { bd = d; best = r; } }
  return best;
}

const memStore = new Map();
const defaultStorage = () => { try { if (typeof localStorage !== 'undefined') { localStorage.setItem('__aqt', '1'); localStorage.removeItem('__aqt'); return localStorage; } } catch (e) { /* none */ }
  return { getItem: k => memStore.get(k) ?? null, setItem: (k, v) => memStore.set(k, v), removeItem: k => memStore.delete(k) }; };

/**
 * Get air quality near (lat, lon). Order: fresh cache → Open-Meteo (or proxy `base`) → stale cache → preset.
 * @returns {Promise<{status:'live'|'cache'|'stale-cache'|'preset', aq, records?, error?, attribution}>}  never throws.
 */
export async function getAirQuality({ lat = 31.80, lon = 34.65, preset = 'clean', fetchImpl = globalThis.fetch, storage = defaultStorage(), ttlMs = 60 * 60e3, maxStaleMs = 24 * 3600e3, timeoutMs = 8000, now = Date.now(), base, apikey } = {}) {
  const key = `aq1:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  let cached = null; try { cached = JSON.parse(storage.getItem(key) || 'null'); } catch (e) { storage.removeItem(key); }
  const fromRecords = (recs, status, extra) => { const r = sampleAQ(recs, now); return r ? Object.assign({ status, aq: r, records: recs, attribution: ATTRIBUTION_AQ.openMeteo }, extra) : null; };
  if (cached && now - cached.at < ttlMs) { const r = fromRecords(cached.records, 'cache'); if (r) return r; }
  let error = null;
  if (typeof fetchImpl === 'function') {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; const to = ctl && setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(openMeteoAQUrl({ lat, lon, base, apikey }), ctl ? { signal: ctl.signal } : {});
      if (res.status === 429) error = { code: 'RATE_LIMIT', message: 'HTTP 429' };
      else if (!res.ok) error = { code: res.status >= 500 ? 'SERVER' : 'HTTP', message: 'HTTP ' + res.status };
      else {
        const recs = normalizeOpenMeteoAQ(await res.json());
        try { storage.setItem(key, JSON.stringify({ at: now, records: recs })); } catch (e) { /* quota */ }
        const r = fromRecords(recs, 'live'); if (r) return r; error = { code: 'EMPTY', message: 'no usable hours' };
      }
    } catch (e) { error = { code: e && e.name === 'AbortError' ? 'TIMEOUT' : e && e.code === 'BAD_BODY' ? 'BAD_BODY' : 'NETWORK', message: String(e && e.message || e) }; }
    finally { to && clearTimeout(to); }
  } else error = { code: 'NO_FETCH', message: 'fetch unavailable' };
  if (cached && now - cached.at < maxStaleMs) { const r = fromRecords(cached.records, 'stale-cache', { error }); if (r) return r; }
  const p = AQ_PRESETS[preset] || AQ_PRESETS.clean;
  return { status: 'preset', aq: Object.assign({ source: 'preset', time: now }, p), error, attribution: ATTRIBUTION_AQ.preset };
}
