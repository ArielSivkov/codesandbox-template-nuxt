/* מתאם: מחלקת מזג האוויר (swarm/weather/weather.js — ES module, לא זורק על רשת).
 * מצב "חי": getWeather → sampleAt(זמן העולם) → YZW.setWeather (מקור אמת יחיד; המשחק, הצל, הים, הצמחייה והרחפן קוראים משם).
 * ראות → ערפל ליניארי של המשחק (far ≈ ראות, קושמידר 2%); AQI → אובך (מטופל במודול האווירה).
 * פער ממשק (נרשם ביומן): הגשם החזותי של המחלקה (shader, 4000 טיפות) נמצא רק ב-demo.html — לא מיוצא כמודול, לכן הגשם של המשחק נשאר.
 */
(function () {
  'use strict';
  let WX = null, data = null, lastSampleT = 0, fetching = false;
  const LAT = 31.8014, LON = 34.6435;
  async function pull(world) {
    if (fetching) return; fetching = true;
    try {
      const r = await WX.getWeather({ lat: LAT, lon: LON, timeoutMs: 8000 });
      data = r.data; const HE = { live: 'חי', cache: 'מטמון', 'stale-cache': 'מטמון ישן', preset: 'ערכה (אין רשת)' };
      world.weather.status = HE[r.status] || r.status; world.weather.liveStatus = r.status;
      if (r.status === 'preset') YZW.notice('מזג אוויר חי לא זמין כרגע — מוצגת ערכה' + (r.error ? ' (' + r.error.code + ')' : ''), { kind: 'info', ms: 3000 });
      apply(world, true);
    } finally { fetching = false; }
  }
  function apply(world, force) {
    if (!data || world.weather.mode !== 'live') return;
    const t = +world.clock.date; if (!force && Math.abs(t - lastSampleT) < 20 * 60000) return; lastSampleT = t;
    const s = WX.sampleAt(data.hourly, t) || data.current; if (!s) return;
    YZW.setWeather({ windSpeed: +(s.wind_10m_ms || 0).toFixed(1), windFrom: Math.round(s.wind_dir_deg || 0), gust: s.wind_10m_ms > 0.5 && s.gust_ms ? Math.min(2.5, s.gust_ms / s.wind_10m_ms) : 1.3,
      cloud: (s.cloud_cover || 0) / 100, rain: s.precip_mm || 0, tempC: s.temp_c, pressureHpa: Number.isFinite(s.pressure_hpa) ? s.pressure_hpa : null, visibility: s.visibility_m || 20000, source: 'Open-Meteo · ' + world.weather.status });
  }
  YZW.register({
    id: 'weather', name: 'מזג אוויר (Open-Meteo, חי/ידני)', dept: 'weather', order: 12,
    async init(world, api) {
      WX = await import(new URL('mods/weather/weather.js', location.href).href);
      api.on('weather-mode', m => { if (m === 'live') pull(world); });
      api.on('env', () => apply(world, false));
      if (/[?&]live=1/.test(location.search)) { world.weather.mode = 'live'; pull(world); }
      world.weather.attribution = WX.ATTRIBUTION;
    },
    update(dt, world) {
      // ראות → ערפל. המשחק קובע fog.far לפי גובה המצלמה; כאן רק מקטינים כשהראות נמוכה
      const v = world.weather.visibility; if (!v || v >= 15000) return;
      const f = world.scene.fog; if (!f) return; const far = Math.max(120, v * 1.0); if (f.far > far) { f.far = far; f.near = far * 0.25; }
    },
    dispose() { WX = null; data = null; },
  });
})();
