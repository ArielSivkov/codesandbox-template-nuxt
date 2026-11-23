// audio-core.js — מחלקת הקול, לוח היזם / עולם תאום של ישראל
// פונקציות טהורות בלבד (בלי Web Audio) — רצות גם ב-Node לבדיקות.
// מוסכמת צירים (כמו weather.js / game): x = מזרח, y = למעלה, z = דרום. מרחקים במטרים, מהירות במ/ש.

export const SPEED_OF_SOUND = 343;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dbToGain = db => Math.pow(10, db / 20);
export const gainToDb = g => 20 * Math.log10(Math.max(1e-12, g));

/** PRNG דטרמיניסטי (mulberry32) — כל הרעש והאירועים האקראיים נגזרים ממנו, אין Math.random. */
export function rng(seed = 27) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- מצבי תנועה ----------
export const MODES = ['walk', 'car', 'helicopter', 'jetpack', 'drone', 'jet', 'spaceship', 'boat'];
export const MODE_ALIAS = { heli: 'helicopter', chopper: 'helicopter', foot: 'walk', ship: 'spaceship', plane: 'jet', uav: 'drone' };
export const normMode = m => { const k = String(m || '').toLowerCase(); return MODE_ALIAS[k] || k; };

/** פרמטרי מרחב לכל רכב: refDistance (בו העוצמה = 1), maxDistance, עדיפות, עוצמה בסיסית. */
export const VEHICLE_SPATIAL = {
  walk:       { ref: 1.5, max: 60,   priority: 2, loud: 0.5 },
  car:        { ref: 6,   max: 600,  priority: 3, loud: 1.0 },
  helicopter: { ref: 40,  max: 4000, priority: 4, loud: 1.0 },
  jetpack:    { ref: 8,   max: 900,  priority: 3, loud: 1.0 },
  drone:      { ref: 2.5, max: 250,  priority: 2, loud: 0.7 },
  jet:        { ref: 80,  max: 9000, priority: 5, loud: 1.0 },
  spaceship:  { ref: 25,  max: 3000, priority: 4, loud: 0.9 },
  boat:       { ref: 10,  max: 1500, priority: 3, loud: 1.0 },
};

// ---------- רכב: מהירות → הילוך → סל"ד → תדר הצתה ----------
export const CAR = {
  wheelR: 0.31, finalDrive: 3.9, gears: [3.5, 2.1, 1.45, 1.1, 0.87, 0.7],
  idle: 800, redline: 6500, shiftUp: 5600, shiftDown: 1900, cylinders: 4,
};
/** מחזיר {gear (1..6), rpm}. הילוך אוטומטי עם היסטרזיס (prevGear). מתחת ל-5 מ/ש — מצמד מחליק: הגז מעלה סל"ד. */
export function carRpm(speed, throttle = 0, prevGear = 1, cfg = CAR) {
  const v = Math.abs(speed || 0), th = clamp(throttle, 0, 1);
  const wheelRpm = (v / (2 * Math.PI * cfg.wheelR)) * 60;
  const rpmIn = g => wheelRpm * cfg.gears[g - 1] * cfg.finalDrive;
  let g = clamp(prevGear | 0 || 1, 1, cfg.gears.length);
  while (g < cfg.gears.length && rpmIn(g) > cfg.shiftUp) g++;
  while (g > 1 && rpmIn(g) < cfg.shiftDown && rpmIn(g - 1) < cfg.shiftUp * 0.92) g--;
  let rpm = rpmIn(g);
  const slip = cfg.idle + th * 2200 * clamp(1 - v / 5, 0, 1); // זינוק מעמידה
  rpm = Math.max(rpm, slip, cfg.idle);
  return { gear: g, rpm: Math.min(rpm, cfg.redline) };
}
/** מנוע 4 פעימות: הצתה כל 2 סיבובים לכל צילינדר → rpm/60 · cyl/2 (4 צילינדרים: 800 סל"ד → 26.7 הרץ). */
export const firingHz4 = (rpm, cyl = 4) => (rpm / 60) * (cyl / 2);
/** 2 פעימות (מנוע חיצוני): הצתה כל סיבוב → rpm/60 · cyl. */
export const firingHz2 = (rpm, cyl = 3) => (rpm / 60) * cyl;

// ---------- מסוק ----------
export const HELI = { rotorRpm: 390, blades: 4, tailRatio: 5.4, tailBlades: 2 };
/** סל"ד רוטור: במצב פעיל קבוע כמעט (גוברנר), יורד קלות בקולקטיב גבוה. spool 0..1 בזמן הנעה. */
export const heliRotorRpm = (collective = 0.5, spool = 1, cfg = HELI) => cfg.rotorRpm * clamp(spool, 0, 1) * (1.02 - 0.04 * clamp(collective, 0, 1));
/** תדר מעבר להבים (blade-pass) = rpm/60 · מספר להבים (390·4/60 = 26 הרץ). */
export const bladePassHz = (rotorRpm, blades = HELI.blades) => (rotorRpm / 60) * blades;

// ---------- רחפן ----------
export const DRONE = { rpmMax: 14000, blades: 2, idleThrust: 0.06 };
/** דחף ∝ rpm² ⇒ rpm ∝ √דחף. thrust 0..1 של דחף מקסימלי; מחזיר תדר מעבר להבים. */
export function droneMotorHz(thrust, cfg = DRONE) {
  const t = Math.max(cfg.idleThrust, clamp(thrust, 0, 1));
  return (cfg.rpmMax * Math.sqrt(t) / 60) * cfg.blades;
}

// ---------- סילון ----------
/** סיבוב טורבינה N1 (0.2 בסרק → 1.0): מסנן מסדר ראשון, האצה איטית (≈2.5 ש') מהאטה (≈1.6 ש'). */
export function jetSpool(n1, throttle, dt) {
  const target = 0.2 + 0.8 * clamp(throttle, 0, 1);
  const tau = target > n1 ? 2.5 : 1.6;
  return n1 + (target - n1) * (1 - Math.exp(-dt / tau));
}
export const jetWhineHz = n1 => 700 + 3300 * clamp(n1, 0, 1.1);

// ---------- סירה (מנוע חיצוני 3 צילינדרים, 2 פעימות) ----------
export const BOAT = { idle: 900, max: 5800, cylinders: 3 };
export const boatRpm = (throttle, cfg = BOAT) => cfg.idle + (cfg.max - cfg.idle) * Math.pow(clamp(throttle, 0, 1), 0.8);

// ---------- חללית ----------
export const spaceshipHz = throttle => 48 * (1 + 0.6 * clamp(throttle, 0, 1));

// ---------- מרחק ----------
/** זהה לנוסחאות מפרט W3C של PannerNode: inverse / linear / exponential. */
export function distanceGain(d, { model = 'inverse', ref = 1, max = 10000, rolloff = 1 } = {}) {
  if (model === 'linear') {
    const dd = clamp(d, ref, max);
    return max === ref ? 1 : 1 - rolloff * (dd - ref) / (max - ref);
  }
  const dd = Math.max(d, ref);
  if (model === 'exponential') return Math.pow(dd / ref, -rolloff);
  return ref / (ref + rolloff * (dd - ref));
}
/** בליעת אוויר (קירוב): מעל ~100 מ' הגבוהים נחלשים. מחזיר תדר חיתוך למסנן low-pass. */
export const airAbsorptionCutoff = d => clamp(20000 / (1 + Math.max(0, d) / 350), 900, 20000);
/** הסתרה: occ = מספר בניינים בקו הראייה (0, 1, 2+). בניין אחד: low-pass ‏1 ק"הרץ ו- −6dB; כל בניין נוסף מוריד עוד. */
export const occlusionCutoff = occ => (occ <= 0 ? 20000 : clamp(1000 / Math.pow(1.8, occ - 1), 300, 1000));
export const occlusionGain = occ => (occ <= 0 ? 1 : clamp(dbToGain(-6 * Math.min(occ, 3)), 0.12, 1));

/** דופלר: f' = f·(c + vL·u)/(c + vS·u), u = וקטור יחידה מהמאזין אל המקור. מוגבל ל-[0.5, 2]. */
export function dopplerFactor(sp, sv, lp, lv, c = SPEED_OF_SOUND) {
  const dx = sp.x - lp.x, dy = sp.y - lp.y, dz = sp.z - lp.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-3) return 1;
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const vl = clamp((lv.x || 0) * ux + (lv.y || 0) * uy + (lv.z || 0) * uz, -0.9 * c, 0.9 * c);
  const vs = clamp((sv.x || 0) * ux + (sv.y || 0) * uy + (sv.z || 0) * uz, -0.9 * c, 0.9 * c);
  return clamp((c + vl) / (c + vs), 0.5, 2);
}

// ---------- מזג אוויר → קול ----------
/** מקבל רשומה מנורמלת של weather.js (wind_10m_ms, gust_ms, precip_mm) או את הפלט של weatherToVisual (wind{x,z}, rain 0..1). */
export function weatherToAudio(w = {}) {
  let wind = 0;
  if (typeof w.wind_10m_ms === 'number') wind = w.wind_10m_ms;
  else if (w.wind && typeof w.wind === 'object') wind = Math.hypot(w.wind.x || 0, w.wind.z || 0);
  else if (typeof w.wind === 'number') wind = w.wind;
  const gust = Math.max(wind, w.gust_ms ?? wind * 1.4);
  let rain = 0;
  if (typeof w.rain === 'number') rain = clamp(w.rain, 0, 1);
  else if (typeof w.precip_mm === 'number') rain = w.precip_mm <= 0.05 ? 0 : Math.min(1, Math.log1p(w.precip_mm) / Math.log1p(10));
  const day = w.day ?? w.is_day ?? true;
  return { wind, gust, rain, day: day !== false };
}
/** רוח: שקט מתחת ל-1 מ/ש, רוויה ~18 מ/ש. מחזיר עוצמה ומרכז מסנן (משב מעלה את הגובה). gustPhase 0..1. */
export function windParams(windMs, gustMs, gustPhase = 0) {
  const v = Math.max(0, windMs + (Math.max(gustMs, windMs) - windMs) * clamp(gustPhase, 0, 1));
  const gain = clamp(Math.pow(Math.max(0, v - 0.8) / 17, 1.3), 0, 1) * 0.55;
  return { gain, cutoff: 250 + 95 * v, whistle: clamp((v - 9) / 10, 0, 1) * 0.12, v };
}
export const rainGain = r => 0.38 * Math.pow(clamp(r, 0, 1), 0.7);
/** גלים: עוצמה ~1 עד 25 מ' מקו המים, ~−20dB ב-300 מ'; הגבוהים נבלעים במרחק. */
export function waveParams(shoreDist) {
  const d = Math.max(0, shoreDist ?? Infinity);
  if (!isFinite(d)) return { gain: 0, cutoff: 400 };
  return { gain: 0.42 / (1 + Math.max(0, d - 25) / 33), cutoff: clamp(4200 / (1 + d / 120), 300, 4200) };
}
/** שכבות עיר לפי מרחק לכביש ראשי / פארק / נמל (מטרים). */
export function areaMix({ mainRoad = Infinity, park = Infinity, port = Infinity } = {}) {
  const f = (d, half) => (isFinite(d) ? 1 / (1 + Math.pow(Math.max(0, d) / half, 2)) : 0);
  return { traffic: f(mainRoad, 90), park: f(park, 60), port: f(port, 350) };
}

// ---------- צעדים ----------
export const SURFACES = {
  asphalt:  { lp: 3500, hp: 300, decay: 0.045, thump: 90,  thumpAmt: 0.5, grit: 0.25, ring: 0,    gain: 0.8 },
  concrete: { lp: 5000, hp: 400, decay: 0.035, thump: 110, thumpAmt: 0.4, grit: 0.15, ring: 0,    gain: 0.8 },
  tile:     { lp: 7000, hp: 800, decay: 0.03,  thump: 140, thumpAmt: 0.3, grit: 0.05, ring: 0.15, gain: 0.7 },
  wood:     { lp: 2500, hp: 120, decay: 0.07,  thump: 170, thumpAmt: 0.9, grit: 0.05, ring: 0,    gain: 0.85 },
  grass:    { lp: 6000, hp: 1200, decay: 0.12, thump: 70,  thumpAmt: 0.15, grit: 0.9, ring: 0,    gain: 0.55 },
  sand:     { lp: 2800, hp: 500, decay: 0.16,  thump: 60,  thumpAmt: 0.2, grit: 1.0,  ring: 0,    gain: 0.6 },
  metal:    { lp: 9000, hp: 500, decay: 0.05,  thump: 120, thumpAmt: 0.4, grit: 0.05, ring: 0.6,  gain: 0.75 },
  water:    { lp: 2200, hp: 200, decay: 0.2,   thump: 50,  thumpAmt: 0.2, grit: 0.4,  ring: 0,    gain: 0.6, bubbles: 1 },
};
export const surfaceOf = s => (SURFACES[s] ? s : 'asphalt');
/** אורך צעד: 0.7 מ' בהליכה → ~1.4 מ' בריצה (6 מ/ש). */
export const strideLength = speed => clamp(0.55 + 0.15 * Math.abs(speed), 0.6, 1.5);

// ---------- שבת ----------
/** מצב שבת: רק אווירה (רוח, גשם, ים, ציפורים, עיר, צעדים). אין מוזיקה, התראות, ממשק, קול, מנועים. */
export const BUSES = ['engines', 'ambience', 'ui', 'voice', 'music'];
export const SHABBAT_ALLOWED = Object.freeze({ ambience: true, engines: false, ui: false, voice: false, music: false });
export function busAllowed(bus, shabbat, allowed = SHABBAT_ALLOWED) {
  if (!shabbat) return true;
  return !!allowed[bus];
}

// ---------- הקצאת ערוצים (Voice limiting) ----------
/**
 * candidates: [{id, score}] — score = עדיפות × עוצמה משוערת. קולות מתחת ל-minScore נכבים תמיד.
 * היסטרזיס: קול שכבר פעיל נשאר אם מועמד חדש לא עולה עליו בפקטור hysteresis.
 * fixed = מספר ערוצים תפוסים (one-shots שמתנגנים עכשיו).
 */
export function allocateVoices(candidates, { max = 16, prevActive = new Set(), hysteresis = 1.25, minScore = 1e-3, fixed = 0 } = {}) {
  const slots = Math.max(0, max - fixed);
  const list = candidates.filter(c => c.score >= minScore)
    .map(c => ({ ...c, eff: prevActive.has(c.id) ? c.score * hysteresis : c.score }))
    .sort((a, b) => b.eff - a.eff || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const active = new Set(list.slice(0, slots).map(c => c.id));
  const virtual = new Set(candidates.filter(c => !active.has(c.id)).map(c => c.id));
  return { active, virtual };
}

// ---------- הסתרה ע"י בניינים ----------
function segAabb2(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  const ax_ = [[-dx, ax - b.minx], [dx, b.maxx - ax], [-dz, az - b.minz], [dz, b.maxz - az]];
  for (const [p, q] of ax_) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}
function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1 = bx - ax, r2 = bz - az, s1 = dx - cx, s2 = dz - cz, den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den, u = ((cx - ax) * r2 - (cz - az) * r1) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function pip(p, n, x, z) {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i], zi = p[2 * i + 1], xj = p[2 * j], zj = p[2 * j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/**
 * כמה בניינים חוסמים את הקו מקור→מאזין. בניין = {minx,maxx,minz,maxz, top|h, base?, p?(Float32 x,z), n?}
 * (אותו מבנה כמו W27 של המשחק). בודק גם גובה: אם הקו עובר מעל הגג — לא חוסם.
 */
export function countOccluders(a, b, buildings) {
  let n = 0;
  for (const B of buildings || []) {
    const t = segAabb2(a.x, a.z, b.x, b.z, B);
    if (!t) continue;
    const top = B.top ?? ((B.base || 0) + (B.h || 10));
    const yAt = tt => a.y + (b.y - a.y) * tt;
    if (Math.min(yAt(t[0]), yAt(t[1])) >= top) continue;
    if (B.p && (B.n || B.p.length / 2) >= 3) {
      const p = B.p, m = B.n || p.length / 2;
      let hit = pip(p, m, a.x, a.z) || pip(p, m, b.x, b.z);
      for (let i = 0, j = m - 1; !hit && i < m; j = i++) hit = segSeg(a.x, a.z, b.x, b.z, p[2 * j], p[2 * j + 1], p[2 * i], p[2 * i + 1]);
      if (!hit) continue;
    }
    n++;
  }
  return n;
}

/** רעש חלק דטרמיניסטי (value noise 1D) — למשבי רוח ותנודות. */
export function smoothNoise(seed) {
  const r = rng(seed), vals = Array.from({ length: 256 }, r);
  return t => {
    const i = Math.floor(t), f = t - i, a = vals[((i % 256) + 256) % 256], b = vals[(((i + 1) % 256) + 256) % 256];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}
