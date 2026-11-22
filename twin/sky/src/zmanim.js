/* ESH27 twin — sky & time — zmanim.js
 * Halachic times (זמני היום) for any place and date, from the precise sun of sky.js (VSOP87 + ΔT, so it works
 * for historical dates too). Definitions follow the common Israeli calendars and the KosherJava library
 * (python port `zmanim` 0.3.1 used as the reference in test/zmanim.test.mjs):
 *   הנץ / שקיעה: upper limb on the sea-level horizon: centre at −(34' refraction + 16' semidiameter) = −0.8333°.
 *     useElevation: also minus the geometric dip acos(R/(R+h)), R = 6356.9 km (KosherJava). horizonDeg: altitude
 *     of the real (terrain) horizon, e.g. +0.6° for a ridge — added to the event altitude (visible horizon).
 *   Degree zmanim (עלות 16.1°, משיכיר 11.5°/11°/10.2°, צאת 8.5°, 16.1°): geometric centre of the sun that many
 *     degrees below the horizon (no refraction, no elevation — as KosherJava).
 *   שעה זמנית (גר"א) = (שקיעה − הנץ)/12; מג"א 72 = from הנץ−72 to שקיעה+72 (KosherJava "MGA");
 *     מג"א 16.1° = from עלות 16.1° to צאת 16.1°.
 *   חצות = meridian transit of the sun (astronomical); chatzosHalfDay = midpoint הנץ–שקיעה (KosherJava 0.3.x).
 *   צאת הכוכבים: 8.5° (גאונים), 13.5 / 18 / 24 fixed minutes after שקיעה, רבנו תם 72 fixed minutes.
 * THIS IS A CALCULATION TOOL, NOT A HALACHIC RULING (אין לסמוך על זה להלכה בלי רב).
 */
import { time, body, observer } from './sky.js';
import { jdFromCalendar, calendarFromJd, dateFromJd } from './time.js';

const R_KJ = 6356.9;   // KosherJava earth radius for the elevation dip (km)
const mod = (a, n) => ((a % n) + n) % n;

/** Offset (hours) of a zone at an instant. tz: IANA name | number (hours) | 'lmt' (local mean time). */
export function tzOffsetHours(jdUT, tz, lon) {
  if (typeof tz === 'number') return tz;
  if (tz === 'lmt') return lon / 15;
  if (jdUT < 2421403.5) return lon / 15;            // before 1918-01-01: no zone time in the region → local mean time
  const d = dateFromJd(jdUT);
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = {}; for (const x of f.formatToParts(d)) p[x.type] = x.value;
    const u = new Date(0); u.setUTCFullYear(+p.year, +p.month - 1, +p.day); u.setUTCHours(+p.hour % 24, +p.minute, +p.second, 0);   // no 2-digit-year trap
    const asUTC = u.getTime();
    return Math.round((asUTC - Math.floor(d.getTime() / 1000) * 1000) / 60000) / 60;
  } catch (e) { return lon / 15; }
}
export function elevationDip(elevM) { return elevM > 0 ? Math.acos(R_KJ / (R_KJ + elevM / 1000)) * 180 / Math.PI : 0; }

function sunAlt(jd, obs) { return body('Sun', { jdUT: jd }, obs, { refraction: false }).alt; }
function sunHA(jd, obs) { return body('Sun', { jdUT: jd }, obs, { refraction: false }).hourAngle; }
function solve(f, a, b, target) {   // f increasing or decreasing on [a,b]; returns null if target not bracketed
  let fa = f(a) - target, fb = f(b) - target; if ((fa < 0) === (fb < 0)) return null;
  for (let i = 0; i < 44 && (b - a) > 2e-7; i++) { const m = (a + b) / 2, fm = f(m) - target; if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else { b = m; fb = fm; } }
  return (a + b) / 2;
}

export const ZMAN_LABELS = {
  alos16_1: 'עלות השחר (16.1°)', alos72: 'עלות השחר (72 דק׳ לפני הנץ)',
  misheyakir11_5: 'משיכיר – טלית ותפילין (11.5°)', misheyakir11: 'משיכיר (11°)', misheyakir10_2: 'משיכיר (10.2°)',
  sunrise: 'הנץ החמה', sofZmanShmaMGA16_1: 'סוף זמן ק״ש – מג״א (16.1°)', sofZmanShmaMGA72: 'סוף זמן ק״ש – מג״א (72 דק׳)',
  sofZmanShmaGRA: 'סוף זמן ק״ש – גר״א', sofZmanTfilaMGA16_1: 'סוף זמן תפילה – מג״א (16.1°)', sofZmanTfilaMGA72: 'סוף זמן תפילה – מג״א (72 דק׳)',
  sofZmanTfilaGRA: 'סוף זמן תפילה – גר״א', chatzos: 'חצות היום', minchaGedola: 'מנחה גדולה', minchaKetana: 'מנחה קטנה',
  plagHamincha: 'פלג המנחה', sunset: 'שקיעה', tzeis8_5: 'צאת הכוכבים (8.5°)', tzeis13_5: 'צאת הכוכבים (13.5 דק׳)',
  tzeis18: 'צאת הכוכבים (18 דק׳)', tzeis24: 'צאת הכוכבים (24 דק׳)', tzeis16_1: 'צאת הכוכבים (16.1°)', tzeisRT72: 'צאת – רבנו תם (72 דק׳)',
  chatzosLayla: 'חצות הלילה',
};
export const ZMAN_ORDER = ['alos16_1', 'alos72', 'misheyakir11_5', 'misheyakir11', 'misheyakir10_2', 'sunrise', 'sofZmanShmaMGA16_1', 'sofZmanShmaMGA72',
  'sofZmanShmaGRA', 'sofZmanTfilaMGA16_1', 'sofZmanTfilaMGA72', 'sofZmanTfilaGRA', 'chatzos', 'minchaGedola', 'minchaKetana', 'plagHamincha', 'sunset',
  'tzeis8_5', 'tzeis13_5', 'tzeis18', 'tzeis24', 'tzeis16_1', 'tzeisRT72', 'chatzosLayla'];

/**
 * Zmanim for a LOCAL civil date.
 * @param {number} y year (astronomical; Julian calendar before 1582-10-15 unless o.calendar)  @param m month 1-12  @param d day
 * @param {number} lat @param {number} lon
 * @param {object} o {elev=0 m, useElevation=false, horizonDeg=0, tz='Asia/Jerusalem' (≥1918) | 'lmt' | hours, calendar='auto'}
 * @returns {{times: {key: jdUT|null}, local: {key: 'HH:MM:SS'}, shaahZmanitGRA (min), shaahZmanitMGA72 (min), tz, transit, list:[{key, he, jd, local}]}}
 */
export function zmanim(y, m, d, lat, lon, o = {}) {
  const tz = o.tz ?? (y >= 1918 ? 'Asia/Jerusalem' : 'lmt');
  const obs = observer(lat, lon, 0);
  const jd0 = jdFromCalendar(y, m, d, o.calendar || 'auto');             // 00:00 UT of that calendar day
  const off = tzOffsetHours(jd0 + 0.5 - lon / 360, tz, lon) / 24;
  // meridian transit near local noon (Newton on the hour angle)
  let tr = jd0 + 0.5 - lon / 360;
  for (let i = 0; i < 4; i++) tr -= sunHA(tr, obs) / 360 * 0.99727;
  const alt = jd => sunAlt(jd, obs);
  const am = h => solve(alt, tr - 0.5, tr, h), pm = h => solve(alt, tr, tr + 0.5, h);
  const dip = o.useElevation ? elevationDip(o.elev || 0) : 0, hz = o.horizonDeg || 0;
  const h0 = -50 / 60 - dip + hz;
  const T = {}, MIN = 1 / 1440, add = (t, min) => (t == null ? null : t + min * MIN);
  T.sunrise = am(h0); T.sunset = pm(h0);
  T.alos16_1 = am(-16.1); T.misheyakir11_5 = am(-11.5); T.misheyakir11 = am(-11); T.misheyakir10_2 = am(-10.2);
  T.tzeis8_5 = pm(-8.5); T.tzeis16_1 = pm(-16.1);
  T.alos72 = add(T.sunrise, -72); T.tzeisRT72 = add(T.sunset, 72);
  T.tzeis13_5 = add(T.sunset, 13.5); T.tzeis18 = add(T.sunset, 18); T.tzeis24 = add(T.sunset, 24);
  const zm = (a, b, h) => (a == null || b == null ? null : a + (b - a) * h / 12);
  T.sofZmanShmaGRA = zm(T.sunrise, T.sunset, 3); T.sofZmanTfilaGRA = zm(T.sunrise, T.sunset, 4);
  T.sofZmanShmaMGA72 = zm(T.alos72, T.tzeisRT72, 3); T.sofZmanTfilaMGA72 = zm(T.alos72, T.tzeisRT72, 4);
  T.sofZmanShmaMGA16_1 = zm(T.alos16_1, T.tzeis16_1, 3); T.sofZmanTfilaMGA16_1 = zm(T.alos16_1, T.tzeis16_1, 4);
  T.chatzos = tr; T.chatzosHalfDay = zm(T.sunrise, T.sunset, 6);
  T.minchaGedola = zm(T.sunrise, T.sunset, 6.5); T.minchaKetana = zm(T.sunrise, T.sunset, 9.5); T.plagHamincha = zm(T.sunrise, T.sunset, 10.75);
  T.chatzosLayla = tr + 0.5;
  const local = {}, list = [];
  for (const k of Object.keys(T)) local[k] = fmtLocal(T[k], tz, lon);
  for (const k of ZMAN_ORDER) list.push({ key: k, he: ZMAN_LABELS[k], jd: T[k], local: local[k] });
  return { times: T, local, list, tz, utcOffsetHours: off * 24, transit: tr,
    shaahZmanitGRA: T.sunset != null ? (T.sunset - T.sunrise) * 1440 / 12 : null,
    shaahZmanitMGA72: T.sunset != null ? (T.tzeisRT72 - T.alos72) * 1440 / 12 : null,
    params: { elev: o.elev || 0, useElevation: !!o.useElevation, dip, horizonDeg: hz, sunriseAltitude: h0 } };
}
export function fmtLocal(jd, tz, lon) {
  if (jd == null) return '—';
  const l = jd + tzOffsetHours(jd, tz, lon) / 24, c = calendarFromJd(l), p = n => String(n).padStart(2, '0');
  return `${p(c.h)}:${p(c.mi)}:${p(c.s)}`;
}
/** Seasonal ("zmanit") hour of an instant: {hour 0..12 since sunrise (day) or since sunset (night), isDay} */
export function shaahZmanitOf(jdUT, z) {
  const T = z.times; if (T.sunrise == null) return null;
  if (jdUT >= T.sunrise && jdUT < T.sunset) return { isDay: true, hour: (jdUT - T.sunrise) / (T.sunset - T.sunrise) * 12 };
  const nightLen = 1 - (T.sunset - T.sunrise);
  return { isDay: false, hour: mod((jdUT - T.sunset), 1) / nightLen * 12 };
}
