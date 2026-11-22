/* ESH27 twin — sky & time — hebrew.js
 * Fixed (arithmetic) Hebrew calendar and the molad, after Reingold & Dershowitz, "Calendrical Calculations"
 * (3rd ed. 2008, ch.8) — the rules of Rambam, Hilchot Kiddush HaChodesh ch.6–8 (molad BaHaRaD, dechiyot
 * Lo AD"U Rosh, Molad Zaken, GaTaRaD, BeTU'TaKPaT). Validated in test/hebrew.test.mjs against python
 * `convertdate` and the `zmanim` (KosherJava port) molad.
 * Day boundary: a Hebrew date begins at the previous sunset — the functions here convert CIVIL days
 * (the daytime part); use {afterSunset:true} for an instant after sunset.
 */
const EPOCH = -1373427;                      // R.D. of 1 Tishrei AM 1 (Julian 7 Oct 3761 BCE)
const RD_JD = 1721424.5;                     // JD = RD + RD_JD (RD counts from midnight)
const floor = Math.floor, mod = (a, n) => ((a % n) + n) % n;
export const MONTHS_HE = ['', 'ניסן', 'אייר', 'סיוון', 'תמוז', 'אב', 'אלול', 'תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר ב׳'];
export const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const isLeap = y => mod(7 * y + 1, 19) < 7;
export const lastMonth = y => (isLeap(y) ? 13 : 12);
function elapsedDays(y) {
  const months = floor((235 * y - 234) / 19), parts = 12084 + 13753 * months, days = 29 * months + floor(parts / 25920);
  return mod(3 * (days + 1), 7) < 3 ? days + 1 : days;
}
function yearCorrection(y) {
  const ny0 = elapsedDays(y - 1), ny1 = elapsedDays(y), ny2 = elapsedDays(y + 1);
  return ny2 - ny1 === 356 ? 2 : ny1 - ny0 === 382 ? 1 : 0;
}
export const newYear = y => EPOCH + elapsedDays(y) + yearCorrection(y);
export const daysInYear = y => newYear(y + 1) - newYear(y);
const longHeshvan = y => mod(daysInYear(y), 10) === 5, shortKislev = y => mod(daysInYear(y), 10) === 3;
export function monthLength(m, y) {
  if (m === 2 || m === 4 || m === 6 || m === 10 || m === 13 || (m === 12 && !isLeap(y)) || (m === 8 && !longHeshvan(y)) || (m === 9 && shortKislev(y))) return 29;
  return 30;
}
/** Hebrew (y, m, d) → R.D. fixed day. Months: 1 = Nisan … 7 = Tishrei … 12 = Adar (I), 13 = Adar II. */
export function rdFromHebrew(y, m, d) {
  let rd = newYear(y) + d - 1;
  if (m < 7) { for (let k = 7; k <= lastMonth(y); k++) rd += monthLength(k, y); for (let k = 1; k < m; k++) rd += monthLength(k, y); }
  else for (let k = 7; k < m; k++) rd += monthLength(k, y);
  return rd;
}
export function hebrewFromRd(rd) {
  const approx = floor((rd - EPOCH) / (35975351 / 98496)) + 1;
  let y = approx - 1; while (newYear(y + 1) <= rd) y++;          // R-D: MAX y ≥ approx−1 with new-year(y) ≤ date
  let m = rd < rdFromHebrew(y, 1, 1) ? 7 : 1;
  for (let g = 0; rd > rdFromHebrew(y, m, monthLength(m, y)); g++) { if (g > 13) throw new Error('hebrewFromRd: no month for ' + rd); m = m === lastMonth(y) ? 1 : m + 1; }
  return { y, m, d: rd - rdFromHebrew(y, m, 1) + 1 };
}
export const rdFromJd = jd => floor(jd - RD_JD);
export const jdFromRd = rd => rd + RD_JD;      // midnight starting that civil day (UT-based, not local!)

/**
 * Hebrew date of an instant (JD UT) at a place: local civil day by lon/15 (local mean time), +1 after sunset.
 * @param {number} jdUT
 * @param {object} o {lon=35.2354, afterSunset=false, tzHours (overrides lon/15)}
 */
export function hebrewDate(jdUT, o = {}) {
  const off = o.tzHours != null ? o.tzHours / 24 : (o.lon ?? 35.2354) / 360;
  const rd = rdFromJd(jdUT + off) + (o.afterSunset ? 1 : 0);
  const h = hebrewFromRd(rd);
  return Object.assign(h, { rd, dow: mod(rd, 7), monthName: monthName(h.m, h.y), text: formatHebrew(h) });
}
export function monthName(m, y) { return m === 12 && isLeap(y) ? 'אדר א׳' : MONTHS_HE[m]; }

/**
 * Molad of Hebrew month (y, m) — mean conjunction (Rambam KH"Ch 6). Returns the traditional notation
 * (day of week, hours counted from 18:00 of the previous evening, chalakim = 1/1080 hour) and the instant.
 * moment = R.D. days in "Jerusalem time"; as KosherJava, the instant in UT is moment − 35.2354°/360 (Jerusalem
 * local MEAN time). [the halachic sources do not define a time zone; this convention is KosherJava's]
 */
export function molad(y, m) {
  const yy = m < 7 ? y + 1 : y, monthsElapsed = m - 7 + floor((235 * yy - 234) / 19);
  const moment = EPOCH - 876 / 25920 + monthsElapsed * (29 + 12 / 24 + 793 / 25920);
  const t = moment + 0.25;                         // day count starting 18:00 the evening before
  const day = floor(t), frac = t - day, partsTotal = Math.round(frac * 25920);
  const hours = floor(partsTotal / 1080), chalakim = partsTotal % 1080;
  return { y, m, moment, dow: mod(day, 7), hours, chalakim, minutes: floor(chalakim / 18), chalakimRem: chalakim % 18,
    jdUT: moment + RD_JD - 35.2354 / 360,
    text: `יום ${DAYS_HE[mod(day, 7)]}, ${hours} שעות ו-${chalakim} חלקים (מ-18:00 בערב הקודם, שעון ירושלים)` };
}

// ---------------------------------------------------------------- Hebrew numerals
const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'], HUND = ['', 'ק', 'ר', 'ש', 'ת'];
/** Gematria for 1..999 (15 → ט״ו, 16 → ט״ז); thousands → "ה׳" prefix when withThousands. */
export function gematria(n, withThousands = false) {
  let s = '', th = floor(n / 1000); n %= 1000;
  let h = floor(n / 100); while (h > 4) { s += 'ת'; h -= 4; } s += HUND[h];
  let r = n % 100;
  if (r === 15) s += 'טו'; else if (r === 16) s += 'טז'; else s += TENS[floor(r / 10)] + ONES[r % 10];
  s = s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
  return withThousands && th ? ONES[th] + '׳' + s : s;
}
export function formatHebrew(h) { return `${gematria(h.d)} ב${monthName(h.m, h.y)} ${gematria(h.y, true)}`; }
