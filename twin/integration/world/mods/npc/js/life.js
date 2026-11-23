/* מחלקת הדמויות · life.js — סימולציית "חיים" טהורה (בלי three.js, רץ גם ב-Node לבדיקות).
   שעון ישראל + שבת (שקיעה מחושבת, זמני כניסה/יציאה מקורבים), פרסונות ולוחות זמנים, סיווג בניינים,
   גרף רחובות + A*, הליכה על המדרכה, הימנעות הדדית, תגובה לשחקן (זז הצידה, מסתכל, בורח מרכב מהיר),
   מזג אוויר (מטריה בגשם, חוף ריק), שלוש רמות סימולציה לפי מרחק, וממשק צפיפות לצוות התחבורה.
   צירים כמו בעולם: x = מזרח, y = מעלה, z = דרום (מטרים). */
(function (root, factory) { const L = factory(); if (typeof module === 'object' && module.exports) module.exports = L; else root.NPCLife = L; })(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const L = { version: 1 };
const D2R = Math.PI / 180;
const LAT = 31.8014, LON = 34.6435;            // אשדוד
L.CANDLE_MIN = 20; L.TZEIT_MIN = 40;           // כניסת שבת: 20 דק' לפני השקיעה · יציאה: 40 דק' אחרי (מקורב, משתנה לפי מנהג)

// ---------------- עזר
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
L.rng = rng;
const hash32 = s => { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
L.hash32 = hash32;
/** ערבוב מספרים מהיר בלי הקצאה (32 ביט) */
const hash2 = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return h >>> 0; };
L.hash2 = hash2;
const pick = (R, a) => a[Math.floor(R() * a.length) % a.length];
function wpick(R, pairs) { let s = 0; for (const p of pairs) s += p[1]; let r = R() * s; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[pairs.length - 1][0]; }

// ---------------- 1. שעון ושבת
/** חלקי תאריך בשעון ישראל (Intl, כולל שעון קיץ). dow: 0=ראשון … 6=שבת */
let _fmt = null, _offKey = -1, _off = 120;
L.israelParts = function (date) {
  // היסט שעון ישראל: מחושב פעם בשעה (Intl יקר), השאר חשבון
  const hk = Math.floor(date.getTime() / 3600000);
  if (hk !== _offKey) { _offKey = hk; _off = L._offsetMin(date); }
  const off = _off;
  const il = new Date(date.getTime() + off * 60000);
  const y = il.getUTCFullYear(), doy = Math.floor((Date.UTC(y, il.getUTCMonth(), il.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  return { y, mo: il.getUTCMonth() + 1, d: il.getUTCDate(), dow: il.getUTCDay(), min: il.getUTCHours() * 60 + il.getUTCMinutes() + il.getUTCSeconds() / 60 + il.getUTCMilliseconds() / 60000, doy, off };
};
L._offsetMin = function (date) {
  let off = 120;
  try {
    const f = _fmt || (_fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    off = Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  } catch (e) { /* ברירת מחדל שעון חורף */ }
  return off;
};
/** זריחה/שקיעה בשעון מקומי (דקות מחצות). NOAA מקוצר, דיוק ~1–2 דק'. */
L.sunTimes = function (doy, offMin, lat, lon) {
  lat = lat == null ? LAT : lat; lon = lon == null ? LON : lon;
  const g = 2 * Math.PI / 365 * (doy - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const de = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const c = Math.cos(90.833 * D2R) / (Math.cos(lat * D2R) * Math.cos(de)) - Math.tan(lat * D2R) * Math.tan(de);
  const ha = Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
  return { sunrise: 720 - 4 * (lon + ha) - eq + offMin, sunset: 720 - 4 * (lon - ha) - eq + offMin };
};
/** שעון משחק מתאריך. אפשר גם לבנות ידנית: {dow, min, doy, off} */
let _stKey = '', _st = null;
L.clock = function (date) {
  const p = L.israelParts(date), k = p.doy + ':' + p.off; if (k !== _stKey) { _stKey = k; _st = L.sunTimes(p.doy, p.off); } const st = _st;
  return { dow: p.dow, min: p.min, doy: p.doy, off: p.off, sunrise: st.sunrise, sunset: st.sunset, date };
};
L.clockAt = function (dow, min, doy, off) { doy = doy || 327; off = off == null ? 120 : off; const st = L.sunTimes(doy, off); return { dow, min, doy, off, sunrise: st.sunrise, sunset: st.sunset }; };
/** מצב שבת: none | erev (שישי אחה"צ, לפני כניסה) | shabbat | motzash (מוצאי שבת) */
L.shabbat = function (c) {
  if (c.dow === 5) { const start = c.sunset - L.CANDLE_MIN; if (c.min >= start) return { active: true, phase: 'shabbat', start }; return { active: false, phase: c.min >= 12 * 60 ? 'erev' : 'none', start }; }
  if (c.dow === 6) { const end = c.sunset + L.TZEIT_MIN; return c.min < end ? { active: true, phase: 'shabbat', end } : { active: false, phase: 'motzash', end }; }
  return { active: false, phase: 'none' };
};
/** סוג יום ללוח הזמנים */
L.dayType = function (c) { const s = L.shabbat(c); if (s.active) return 'shabbat'; if (s.phase === 'motzash') return 'motzash'; if (c.dow === 5) return 'friday'; return 'weekday'; };

/** צפיפות לצוות התחבורה (מכפילים יחסית ליום חול רגיל בצהריים = 1). מקורב, לא מדוד. */
L.density = function (c, weather) {
  const h = c.min / 60, dt = L.dayType(c), rain = weather && weather.rain > 0.2;
  const bump = (x, m, w) => Math.exp(-((x - m) * (x - m)) / (2 * w * w));
  let ped, car;
  if (dt === 'shabbat') {
    // רחובות שקטים: מעט רכבים; הליכה לבית הכנסת בבוקר ולגן/לים אחה"צ
    car = 0.12; ped = 0.15 + 0.75 * bump(h, 8.6, 1.0) + 0.55 * bump(h, 11.3, 0.8) + 0.8 * bump(h, 16.5, 1.6) + (c.dow === 5 ? 0.5 * bump(h, (c.sunset + 15) / 60, 0.5) : 0);
  } else if (dt === 'friday') {
    car = 0.25 + 0.9 * bump(h, 10.5, 2.2) + 0.2 * bump(h, 14, 1); ped = 0.2 + 1.2 * bump(h, 10.5, 1.8) + 0.25 * bump(h, 13.5, 1);
    const s = L.shabbat(c); if (s.start && c.min > s.start - 60) { car *= 0.5; ped *= 0.6; }
  } else if (dt === 'motzash') {
    car = 0.5 + 0.6 * bump(h, 21.5, 1.5); ped = 0.4 + 0.9 * bump(h, 21.5, 1.5);
  } else {
    car = 0.15 + 1.0 * bump(h, 8, 1.2) + 0.7 * bump(h, 13, 2.5) + 1.0 * bump(h, 17.5, 1.5);
    ped = 0.1 + 0.9 * bump(h, 7.8, 0.9) + 0.6 * bump(h, 12.5, 2) + 1.0 * bump(h, 18.8, 1.6);
  }
  if (h < 5.5 || h > 23.5) { ped *= 0.25; car *= 0.4; }
  if (rain) { ped *= 0.4; car *= 1.1; }
  return { pedestrians: +ped.toFixed(3), cars: +car.toFixed(3), dayType: dt, approx: true };
};

// ---------------- 2. סיווג בניינים
const TAG = { apartments: 'home', residential: 'home', house: 'home', detached: 'home', semidetached_house: 'home', terrace: 'home',
  retail: 'shop', commercial: 'shop', supermarket: 'shop', kiosk: 'shop', office: 'office', civic: 'public', public: 'public', townhall: 'public', government: 'public',
  school: 'school', kindergarten: 'kinder', university: 'school', college: 'school', synagogue: 'synagogue', religious: 'synagogue',
  industrial: 'industry', warehouse: 'industry', manufacture: 'industry', construction: 'construction', hospital: 'public', train_station: 'public', sports_centre: 'public', hotel: 'office' };
/** {kind, inferred}. בניין בלי תיוג – הסקה לפי שטח/גובה (מקורב! מסומן inferred) */
L.classifyBuilding = function (b, opts) {
  const t = b.type || '';
  if (TAG[t]) { let k = TAG[t]; if (k === 'industry' && opts && opts.isPort && opts.isPort(b)) k = 'port'; return { kind: k, inferred: false }; }
  if (t === 'roof' || t === 'cowshed' || b.area < 50) return { kind: 'none', inferred: false };
  let k = 'home';
  if (b.area >= 2500 && (b.floors || 1) <= 3) k = 'industry';
  else if (b.area >= 600 && (b.floors || 1) <= 2) k = 'shop';
  if (k === 'industry' && opts && opts.isPort && opts.isPort(b)) k = 'port';
  return { kind: k, inferred: true };
};

// ---------------- 3. גרף רחובות
/** roads: [{p: Float32Array [x,z,...], w: רוחב}] → גרף. צמתים קרובים (<mergeR) מתמזגים. */
L.buildGraph = function (roads, opts) {
  const mergeR = (opts && opts.mergeR) || 3, C = 8;
  const xs = [], zs = [], ws = [], adj = [], grid = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  function nodeAt(x, z, w) {
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) { const g = grid.get(key(a, b)); if (!g) continue;
      for (const n of g) if ((xs[n] - x) ** 2 + (zs[n] - z) ** 2 < mergeR * mergeR) { ws[n] = Math.max(ws[n], w); return n; } }
    const n = xs.length; xs.push(x); zs.push(z); ws.push(w); adj.push([]);
    const k = key(ci, cj); let g = grid.get(k); if (!g) grid.set(k, g = []); g.push(n); return n;
  }
  function link(a, b) { if (a === b) return; for (let i = 0; i < adj[a].length; i += 2) if (adj[a][i] === b) return; const d = Math.hypot(xs[a] - xs[b], zs[a] - zs[b]); adj[a].push(b, d); adj[b].push(a, d); }
  for (const r of roads) {
    const p = r.p, n = p.length / 2; if (n < 2) continue; let prev = -1, px = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      const x = p[i * 2], z = p[i * 2 + 1];
      if (prev >= 0) { // פיצול מקטעים ארוכים כדי שיהיו צמתים לאורך הרחוב (יציאה מבניין לרחוב קרובה)
        const L2 = Math.hypot(x - px, z - pz), k = Math.max(1, Math.ceil(L2 / 40));
        for (let s = 1; s < k; s++) { const m = nodeAt(px + (x - px) * s / k, pz + (z - pz) * s / k, r.w || 6); link(prev, m); prev = m; }
      }
      const cur = nodeAt(x, z, r.w || 6); if (prev >= 0) link(prev, cur); prev = cur; px = x; pz = z;
    }
  }
  const g = { xs: Float32Array.from(xs), zs: Float32Array.from(zs), ws: Float32Array.from(ws), adj, n: xs.length, grid, C, key };
  return g;
};
L.nearestNode = function (g, x, z, maxR) {
  maxR = maxR || 250; const C = g.C; let best = -1, bd = maxR * maxR;
  const ci = Math.floor(x / C), cj = Math.floor(z / C), R = Math.ceil(maxR / C);
  for (let ring = 0; ring <= R; ring++) {
    for (let a = ci - ring; a <= ci + ring; a++) for (let b = cj - ring; b <= cj + ring; b++) {
      if (Math.max(Math.abs(a - ci), Math.abs(b - cj)) !== ring) continue;
      const cell = g.grid.get(g.key(a, b)); if (!cell) continue;
      for (const n of cell) { if (!g.adj[n].length) continue; const d = (g.xs[n] - x) ** 2 + (g.zs[n] - z) ** 2; if (d < bd) { bd = d; best = n; } }
    }
    if (best >= 0 && (ring * C) ** 2 > bd) break;
  }
  return best;
};
/** A* בין צמתים. מחזיר מערך צמתים או null */
L.astar = function (g, s, t, maxIter) {
  if (s < 0 || t < 0) return null; if (s === t) return [s];
  maxIter = maxIter || 20000;
  // מערכים טיפוסיים לשימוש חוזר (חותמת דור במקום איפוס) – בלי Map ובלי זבל
  if (!g._as || g._as.n !== g.n) g._as = { n: g.n, gs: new Float32Array(g.n), came: new Int32Array(g.n), st: new Uint32Array(g.n), closed: new Uint32Array(g.n), gen: 0, hn: new Int32Array(1024), hf: new Float32Array(1024) };
  const A = g._as; A.gen++; const gen = A.gen, xs = g.xs, zs = g.zs, tx = xs[t], tz = zs[t];
  let hn = A.hn, hf = A.hf, hl = 0;
  const push = (n, f) => { if (hl >= hn.length) { const a = new Int32Array(hn.length * 2); a.set(hn); hn = A.hn = a; const b = new Float32Array(hf.length * 2); b.set(hf); hf = A.hf = b; }
    let i = hl++; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hn[i] = hn[p]; hf[i] = hf[p]; i = p; } hn[i] = n; hf[i] = f; };
  const pop = () => { const top = hn[0], ln = hn[--hl], lf = hf[hl]; let i = 0;
    for (;;) { const l = i * 2 + 1; if (l >= hl) break; const r = l + 1, m = r < hl && hf[r] < hf[l] ? r : l; if (hf[m] >= lf) break; hn[i] = hn[m]; hf[i] = hf[m]; i = m; }
    hn[i] = ln; hf[i] = lf; return top; };
  A.st[s] = gen; A.gs[s] = 0; A.came[s] = -1; push(s, Math.hypot(xs[s] - tx, zs[s] - tz)); let it = 0;
  while (hl && it++ < maxIter) {
    const n = pop(); if (A.closed[n] === gen) continue; A.closed[n] = gen;
    if (n === t) { const out = [t]; let c = t; while (A.came[c] >= 0) { c = A.came[c]; out.push(c); } return out.reverse(); }
    const gn = A.gs[n], a = g.adj[n];
    for (let i = 0; i < a.length; i += 2) { const m = a[i]; if (A.closed[m] === gen) continue; const v = gn + a[i + 1];
      if (A.st[m] !== gen || v < A.gs[m]) { A.st[m] = gen; A.gs[m] = v; A.came[m] = n; push(m, v + Math.hypot(xs[m] - tx, zs[m] - tz)); } }
  }
  return null;
};
/** מסלול צמתים → קו הליכה במדרכה הימנית (היסט רוחב/2 + 1.4 מ'), עם חיבור מנקודת המוצא ולנקודת היעד */
L.sidewalkPath = function (g, nodes, from, to, side, jitter) {
  const out = [from.x, from.z]; side = side || 1; jitter = jitter || 0;
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const a = nodes[i], x = g.xs[a], z = g.zs[a];
    const px = i > 0 ? g.xs[nodes[i - 1]] : from.x, pz = i > 0 ? g.zs[nodes[i - 1]] : from.z;
    const nx = i < n - 1 ? g.xs[nodes[i + 1]] : to.x, nz = i < n - 1 ? g.zs[nodes[i + 1]] : to.z;
    let d1x = x - px, d1z = z - pz, l1 = Math.hypot(d1x, d1z) || 1; d1x /= l1; d1z /= l1;
    let d2x = nx - x, d2z = nz - z, l2 = Math.hypot(d2x, d2z) || 1; d2x /= l2; d2z /= l2;
    if (l1 < 0.01 || i === 0) { d1x = d2x; d1z = d2z; } if (l2 < 0.01 || i === n - 1) { d2x = d1x; d2z = d1z; }
    // ימין של ההולך: (−dz, dx)
    let rx = -(d1z + d2z), rz = d1x + d2x; const rl = Math.hypot(rx, rz);
    const off = (g.ws[a] / 2 + 1.4 + jitter) * side;
    if (rl < 0.2) { rx = -d1z; rz = d1x; } else { rx /= rl; rz /= rl; }
    const cosh = Math.max(0.5, Math.abs(rx * -d1z + rz * d1x));
    out.push(x + rx * off / cosh, z + rz * off / cosh);
  }
  out.push(to.x, to.z);
  return out;
};

// ---------------- 4. פרסונות ולוחות זמנים
// כל שורה: [דקה, פעילות, הסתברות]. 'S-x' = x דק' לפני השקיעה, 'E+x' = x דק' אחרי צאת השבת. הסתברות שנכשלה → נשארים בפעילות הקודמת.
const SCHED = {
  worker: {
    weekday: [[0, 'home'], [430, 'work', 0.9], [1020, 'home'], [1110, 'stroll', 0.35], [1110, 'park', 0.2], [1230, 'home']],
    friday: [[0, 'home'], [540, 'market', 0.6], [700, 'home'], [800, 'stroll', 0.2], [880, 'home']],
    shabbat: [[0, 'home'], [480, 'synagogue', 0.5], [690, 'home'], [960, 'park', 0.45], [990, 'beach', 0.2], ['S-30', 'home'], ['S+0', 'home']],
    motzash: [[0, 'home'], ['E+40', 'stroll', 0.5], [1380, 'home']],
  },
  student: { // ילדים ובני נוער
    weekday: [[0, 'home'], [450, 'school', 0.95], [810, 'home'], [930, 'park', 0.5], [1080, 'home']],
    friday: [[0, 'home'], [600, 'park', 0.4], [780, 'home']],
    shabbat: [[0, 'home'], [480, 'synagogue', 0.45], [690, 'home'], [930, 'park', 0.6], ['S-20', 'home']],
    motzash: [[0, 'home'], ['E+30', 'park', 0.3], [1290, 'home']],
  },
  retiree: {
    weekday: [[0, 'home'], [420, 'stroll', 0.5], [510, 'home'], [570, 'market', 0.5], [690, 'home'], [990, 'park', 0.45], [1140, 'home']],
    friday: [[0, 'home'], [450, 'market', 0.75], [660, 'home']],
    shabbat: [[0, 'home'], [450, 'synagogue', 0.6], [690, 'home'], [960, 'park', 0.55], ['S-30', 'home']],
    motzash: [[0, 'home'], ['E+40', 'stroll', 0.25], [1320, 'home']],
  },
  parent: {
    weekday: [[0, 'home'], [440, 'school_run', 0.6], [520, 'market', 0.4], [660, 'home'], [960, 'park', 0.45], [1140, 'home']],
    friday: [[0, 'home'], [510, 'market', 0.8], [720, 'home']],
    shabbat: [[0, 'home'], [480, 'synagogue', 0.45], [690, 'home'], [930, 'park', 0.65], ['S-20', 'home']],
    motzash: [[0, 'home'], ['E+40', 'stroll', 0.4], [1320, 'home']],
  },
  builder: { // פועל בנייה: באתר בחוץ, עם קסדה ואפוד
    weekday: [[0, 'home'], [400, 'site', 0.95], [960, 'home'], [1110, 'stroll', 0.2], [1230, 'home']],
    friday: [[0, 'home'], [400, 'site', 0.5], [720, 'home']],
    shabbat: [[0, 'home'], [960, 'park', 0.4], ['S-30', 'home']],
    motzash: [[0, 'home'], ['E+40', 'stroll', 0.3], [1380, 'home']],
  },
  young: {
    weekday: [[0, 'home'], [480, 'work', 0.7], [990, 'beach', 0.35], [1080, 'stroll', 0.45], [1320, 'home']],
    friday: [[0, 'home'], [600, 'beach', 0.45], [780, 'market', 0.3], [900, 'home']],
    shabbat: [[0, 'home'], [600, 'beach', 0.45], [780, 'park', 0.3], ['S-20', 'home']],
    motzash: [[0, 'home'], ['E+60', 'stroll', 0.7], [1410, 'home']],
  },
};
L.SCHED = SCHED;
L.OUTDOOR = { park: 1, beach: 1, stroll: 1, site: 1, gather: 1, dogwalk: 1 };
function slotMin(v, c) {
  if (typeof v === 'number') return v;
  const m = /^([SE])([+-]\d+)$/.exec(v); if (!m) return 0;
  if (m[1] === 'S') return c.sunset + +m[2];
  return c.sunset + L.TZEIT_MIN + +m[2];
}
/** הפעילות הרצויה לפי לוח זמנים: דטרמיניסטי לכל סוכן (seed) ולכל יום */
L.scheduledActivity = function (persona, c, seed, weather) {
  const dt = L.dayType(c), tab = (SCHED[persona] || SCHED.worker)[dt];
  const day = c.doy * 7 + c.dow;
  let act = 'home', from = 0;
  for (let i = 0; i < tab.length; i++) {
    const row = tab[i], h = hash2(seed ^ Math.imul(day + 1, 2654435761), i * 97 + 1);
    const jit = i === 0 ? 0 : ((h & 0xffff) / 65536 - 0.5) * 60;   // ±30 דק'
    const t0 = slotMin(row[0], c) + jit;
    if (c.min < t0) break;
    const p = row[2] == null ? 1 : row[2];
    if ((h >>> 16) / 65536 < p) { act = row[1]; from = t0; }
  }
  // גשם: פעילויות חוץ מתבטלות ברובן; החוף ריק כמעט לגמרי
  if (weather && weather.rain > 0.2 && L.OUTDOOR[act] && act !== 'site') {
    const R = rng(seed ^ 0x5bd1e995 ^ day); const keep = act === 'beach' ? 0.03 : 0.25;
    if (R() > keep) act = 'home';
  }
  if (dt === 'shabbat' && (act === 'work' || act === 'site' || act === 'market')) act = 'home';
  return { act, from, dayType: dt };
};

// ---------------- 5. מראה (וריאציה) — ערכים בלבד, הצביעה ב-crowd.js
const SKIN = [[0.96, 0.80, 0.69], [0.92, 0.74, 0.60], [0.85, 0.65, 0.50], [0.76, 0.56, 0.42], [0.62, 0.44, 0.32], [0.48, 0.33, 0.24], [0.36, 0.24, 0.17], [0.89, 0.71, 0.58]];
const HAIR = [[0.08, 0.06, 0.05], [0.18, 0.12, 0.08], [0.32, 0.21, 0.12], [0.50, 0.35, 0.20], [0.70, 0.55, 0.32], [0.55, 0.53, 0.50], [0.80, 0.79, 0.76], [0.42, 0.18, 0.10]];
const TOPS = [[0.95, 0.95, 0.93], [0.15, 0.17, 0.22], [0.20, 0.35, 0.62], [0.55, 0.12, 0.15], [0.22, 0.45, 0.30], [0.85, 0.65, 0.30], [0.55, 0.60, 0.68], [0.75, 0.40, 0.45], [0.35, 0.30, 0.50], [0.92, 0.86, 0.72], [0.30, 0.55, 0.65], [0.62, 0.62, 0.60]];
const BOTTOMS = [[0.12, 0.14, 0.20], [0.20, 0.28, 0.45], [0.30, 0.30, 0.32], [0.45, 0.38, 0.28], [0.08, 0.08, 0.09], [0.62, 0.58, 0.50], [0.25, 0.32, 0.25], [0.35, 0.22, 0.30]];
L.PALETTE = { SKIN, HAIR, TOPS, BOTTOMS };
/** מראה: גוף, צבעים, סגנון לבוש, כיסויי ראש. מכבד ומגוון, בלי קריקטורות. */
L.makeLook = function (R, a) {
  const f = a.sex === 'f', kid = a.child;
  const look = {
    body: f ? 1 : 0,
    height: kid ? 1.05 + R() * 0.45 : (f ? 1.56 + R() * 0.16 : 1.66 + R() * 0.2),
    width: 0.9 + R() * 0.25,
    skin: pick(R, SKIN), hair: a.persona === 'retiree' ? pick(R, [HAIR[5], HAIR[6], HAIR[1]]) : pick(R, HAIR.slice(0, 5).concat([HAIR[7]])),
    top: pick(R, TOPS), bottom: pick(R, BOTTOMS),
    hairStyle: Math.floor(R() * 2), beard: !f && !kid && R() < 0.3,
    longSleeve: R() < 0.45, longBottom: R() < 0.75, dress: f && R() < 0.45,
    kippa: !f && R() < 0.35, cap: false, sunhat: false, scarf: false, hardhat: false, vest: false, umbrella: false,
  };
  if (!f && !look.kippa && R() < 0.12) look.cap = true;
  if (f && !kid && R() < 0.22) look.scarf = true;            // כיסוי ראש
  if (f && !look.scarf && R() < 0.1) look.sunhat = true;
  if (a.persona === 'builder') { look.hardhat = true; look.vest = true; look.kippa = look.kippa && false; look.cap = false; look.scarf = false; look.sunhat = false; look.longBottom = true; look.dress = false; }
  if (a.persona === 'young' && R() < 0.3) look.longBottom = false;
  return look;
};

// ---------------- 6. הסימולציה
const SPEED = { walk: 1.35, kid: 1.25, old: 1.0, run: 4.2 };
/** world: { buildings:[{id,cx,cz,area,h,floors,type,p,n}], roads:[{p,w}], H(x,z), isSea(x,z), blocked(x,z) } */
L.createSim = function (world, opts) {
  opts = Object.assign({ maxAgents: 900, seed: 27, tier0R: 70, tier1R: 260, pathsPerFrame: 6, pathMs: 0.6, center: { x: 0, z: 0 }, radius: 600 }, opts || {});
  const sim = { agents: [], named: [], places: {}, graph: null, t: 0, clock: null, weather: { rain: 0 }, player: { x: 0, z: 0, vx: 0, vz: 0, mode: 'foot', speed: 0 },
    stats: { ms: 0, t0: 0, t1: 0, t2: 0, outdoor: 0, paths: 0, pathFail: 0 }, opts, world, pathQueue: [], events: [] };
  sim.clock = L.clockAt(2, 720);   // עד הקריאה הראשונה ל-update
  const R = rng(opts.seed);

  // --- מקומות
  function indexPlaces() {
    const P = { home: [], shop: [], office: [], school: [], kinder: [], synagogue: [], industry: [], port: [], construction: [], public: [], park: [], beach: [] };
    for (const b of world.buildings) {
      const dx = b.cx - opts.center.x, dz = b.cz - opts.center.z; if (dx * dx + dz * dz > (opts.radius + 600) ** 2) continue;
      const c = L.classifyBuilding(b, world); if (c.kind === 'none') continue; b.kind = c.kind; b.inferred = c.inferred; (P[c.kind] || (P[c.kind] = [])).push(b);
    }
    P.park = (world.openSpots || []).map(s => ({ x: s.x, z: s.z, approx: true }));
    P.beach = (world.beachSpots || []).map(s => ({ x: s.x, z: s.z }));
    sim.places = P;
  }
  sim.indexPlaces = indexPlaces;
  function nearestOf(list, x, z, R2, maxD) {
    if (!list || !list.length) return null; const md = (maxD || 1e9) ** 2;
    // 4 הקרובים ביותר בלי מיון של כל הרשימה
    const kd = [Infinity, Infinity, Infinity, Infinity], kb = [null, null, null, null];
    for (const b of list) { const px = b.cx != null ? b.cx : b.x, pz = b.cz != null ? b.cz : b.z, d = (px - x) ** 2 + (pz - z) ** 2; if (d >= md || d >= kd[3]) continue;
      let i = 3; while (i > 0 && kd[i - 1] > d) { kd[i] = kd[i - 1]; kb[i] = kb[i - 1]; i--; } kd[i] = d; kb[i] = b; }
    const k = kb.filter(Boolean).length; if (!k) return null; return kb[Math.floor((R2 ? R2() : 0) * k)];
  }
  sim.nearestOf = nearestOf;

  // --- אוכלוסייה
  const PERS = [['worker', 34], ['parent', 14], ['retiree', 15], ['young', 12], ['builder', 5]];
  function populate() {
    indexPlaces(); sim.agents.length = 0;
    const homes = sim.places.home.slice().sort((a, b) => hash32(a.id) - hash32(b.id));
    let cap = 0; for (const h of homes) { const dx = h.cx - opts.center.x, dz = h.cz - opts.center.z; if (dx * dx + dz * dz <= opts.radius * opts.radius) cap += Math.max(1, Math.min(40, Math.round((h.floors || 1) * h.area / 110 * 0.5))) * 1.6; }
    const scale = Math.min(1, opts.maxAgents / Math.max(1, cap));
    let id = 0;
    for (const h of homes) {
      const dx = h.cx - opts.center.x, dz = h.cz - opts.center.z; if (dx * dx + dz * dz > opts.radius * opts.radius) continue;
      const HR = rng(hash32(h.id) ^ opts.seed);
      const nHouse = Math.round(Math.max(1, Math.min(40, Math.round((h.floors || 1) * h.area / 110 * 0.5))) * scale + HR() * 0.6);
      for (let k = 0; k < nHouse && sim.agents.length < opts.maxAgents; k++) {
        // משק בית: מבוגר/ים + ילדים שהולכים אחרי ההורה בשבת ובגן
        const A = newAgent(id++, h, wpick(HR, PERS), HR);
        sim.agents.push(A);
        if ((A.persona === 'parent' || (A.persona === 'worker' && HR() < 0.35)) && sim.agents.length < opts.maxAgents) {
          const kids = 1 + Math.floor(HR() * 3);
          for (let j = 0; j < kids && sim.agents.length < opts.maxAgents; j++) { const c = newAgent(id++, h, 'student', HR, true); c.parent = A.id; sim.agents.push(c); }
        }
      }
    }
    for (const a of sim.agents) assignPlaces(a);
    return sim.agents.length;
  }
  function newAgent(id, home, persona, HR, child) {
    const sex = persona === 'builder' ? (HR() < 0.9 ? 'm' : 'f') : (HR() < 0.5 ? 'm' : 'f');
    const a = { id, seed: (hash32(home.id + ':' + id) ^ opts.seed) >>> 0, persona, sex, child: !!child, home, work: null, school: null,
      x: home.cx, z: home.cz, vx: 0, vz: 0, heading: HR() * 6.28, speed: 0, pref: child ? SPEED.kid : persona === 'retiree' ? SPEED.old : SPEED.walk * (0.9 + HR() * 0.2),
      state: 'inside', act: 'home', place: home, anim: 'idle', animT: 0, path: null, pi: 0, tier: 2, next: HR() * 2, lastUpd: 0, flee: 0, group: null, side: HR() < 0.5 ? 1 : -1, jit: HR() * 0.9,
      look: null, visible: false, talkT: 0, lookAt: 0 };
    a.look = L.makeLook(rng(a.seed), a);
    return a;
  }
  function assignPlaces(a) {
    const AR = rng(a.seed ^ 77), P = sim.places, x = a.home.cx, z = a.home.cz;
    if (a.persona === 'builder') a.work = nearestOf(P.construction, x, z, AR, 3000) || nearestOf(P.industry, x, z, AR, 3000);
    else if (a.persona === 'worker' || a.persona === 'young') a.work = nearestOf(wpick(AR, [[P.office, 2], [P.shop, 3], [P.industry, 2], [P.port, 1], [P.public, 1]]) || P.shop, x, z, AR, 2500) || nearestOf(P.shop, x, z, AR);
    a.school = nearestOf(a.child && AR() < 0.35 ? P.kinder : P.school, x, z, AR, 2500) || nearestOf(P.school, x, z, AR);
  }
  sim.populate = populate;

  // --- יעדים
  function door(b, toward) {
    // נקודה על דופן הבניין הקרובה לרחוב, 0.8 מ' החוצה
    if (!b.p) return { x: b.cx != null ? b.cx : b.x, z: b.cz != null ? b.cz : b.z };
    const tx = toward ? toward.x : b.cx + 50, tz = toward ? toward.z : b.cz;
    let best = null, bd = 1e18; const p = b.p, n = b.n || p.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9; let t = ((tx - ax) * dx + (tz - az) * dz) / l2; t = Math.max(0.15, Math.min(0.85, t));
      const qx = ax + dx * t, qz = az + dz * t, d = (qx - tx) ** 2 + (qz - tz) ** 2; if (d < bd) { bd = d; const l = Math.sqrt(l2); best = { x: qx + (dz / l) * 0.8, z: qz - (dx / l) * 0.8, nx: dz / l, nz: -dx / l }; } }
    // הנורמל יכול להצביע פנימה (כיוון הפוליגון) – בודקים מול המרכז
    if (best && ((best.x - b.cx) * best.nx + (best.z - b.cz) * best.nz) < 0) { best.x -= best.nx * 1.6; best.z -= best.nz * 1.6; best.nx = -best.nx; best.nz = -best.nz; }
    return best;
  }
  sim.door = door;
  /** נקודה בחוץ ליד בניין (אתר בנייה / חנות / שער בית ספר): מתפזרים בחזית ולא נערמים על הדלת */
  function spotNear(a, pl, toward) {
    const d = door(pl, toward) || { x: pl.cx, z: pl.cz, nx: 0, nz: 1 }, R1 = rng(a.seed ^ 0x51);
    const out = 1.5 + R1() * 7, lat = (R1() - 0.5) * Math.min(24, 4 + Math.sqrt(pl.area || 100) * 0.6);
    const x = d.x + (d.nx || 0) * out - (d.nz || 0) * lat, z = d.z + (d.nz || 0) * out + (d.nx || 0) * lat;
    if (!world.blocked || !world.blocked(x, z)) return { x, z };
    for (let k = 0; k < 6; k++) { const o2 = 2 + R1() * 8, l2 = (R1() - 0.5) * 10, x2 = d.x + (d.nx || 0) * o2 - (d.nz || 0) * l2, z2 = d.z + (d.nz || 0) * o2 + (d.nx || 0) * l2; if (!world.blocked(x2, z2)) return { x: x2, z: z2 }; }
    return { x: d.x + (R1() - 0.5) * 3, z: d.z + (R1() - 0.5) * 3 };
  }
  sim.spotNear = spotNear;
  function destFor(a, act) {
    const P = sim.places, AR = rng(a.seed ^ Math.floor(sim.t / 600) ^ hash32(act)), x = a.home.cx, z = a.home.cz;
    switch (act) {
      case 'home': return { place: a.home, inside: true };
      case 'work': return a.work ? { place: a.work, inside: true } : { place: a.home, inside: true };
      case 'school': return a.school ? { place: a.school, inside: true } : { place: a.home, inside: true };
      case 'school_run': return a.school ? { place: a.school, inside: false, spot: 'gather', dwell: 600 } : { place: a.home, inside: true };
      case 'market': { const s = nearestOf(P.shop, x, z, AR, 1500); return s ? { place: s, inside: AR() < 0.5, spot: 'browse', dwell: 600 + AR() * 900 } : { place: a.home, inside: true }; }
      case 'synagogue': { const s = nearestOf(P.synagogue, x, z, AR, 1200); if (s) return { place: s, inside: true, after: 'gather' };
        const p = nearestOf(P.park, x, z, AR, 800); return p ? { place: p, inside: false, spot: 'gather', approx: true } : { place: a.home, inside: true }; }
      case 'site': return a.work ? { place: a.work, inside: false, spot: 'site' } : { place: a.home, inside: true };
      case 'park': { const p = nearestOf(P.park, x, z, AR, 900); return p ? { place: p, inside: false, spot: 'park' } : { place: a.home, inside: true }; }
      case 'beach': { const p = nearestOf(P.beach, x, z, AR, 3000); return p ? { place: p, inside: false, spot: 'beach' } : destFor(a, 'park'); }
      case 'dogwalk': { const ang = AR() * 6.28, d = 90 + AR() * 120; return { place: { x: x + Math.cos(ang) * d, z: z + Math.sin(ang) * d }, inside: false, spot: 'stroll', dwell: 25 }; }
      case 'stroll': { const ang = AR() * 6.28, d = 150 + AR() * 250; return { place: { x: x + Math.cos(ang) * d, z: z + Math.sin(ang) * d }, inside: false, spot: 'stroll', dwell: 30 }; }
    }
    return { place: a.home, inside: true };
  }

  // --- תכנון מסלול
  function planTrip(a, dest) {
    a.dest = dest;
    const pl = dest.place, from = { x: a.x, z: a.z };
    let to;
    if (pl.cx != null && !dest.inside) to = spotNear(a, pl, from);
    else if (pl.cx != null) to = door(pl, from); else to = { x: pl.x + (rng(a.seed)() - 0.5) * 14, z: pl.z + (rng(a.seed ^ 9)() - 0.5) * 14 };
    a.target = to; a.path = null;
    sim.pathQueue.push(a);
  }
  function solvePath(a) {
    const g = sim.graph, to = a.target; sim.stats.paths++;
    if (!g || !to) { a.path = [a.x, a.z, to.x, to.z]; a.pi = 1; return; }
    const s = L.nearestNode(g, a.x, a.z, 200), t = L.nearestNode(g, to.x, to.z, 200);
    const nodes = (s >= 0 && t >= 0) ? L.astar(g, s, t, 6000) : null;
    if (!nodes) { sim.stats.pathFail++; a.path = [a.x, a.z, to.x, to.z]; a.pi = 1; return; }
    a.path = L.sidewalkPath(g, nodes, { x: a.x, z: a.z }, to, a.side, a.jit); a.pi = 1;
  }
  sim.solvePath = solvePath;

  function setAnim(a, n) { if (a.anim !== n) { a.anim = n; a.animT = sim.t; } }

  // --- חשיבה (עוברים על לוח הזמנים)
  function think(a) {
    if (a.parent != null && a.followOn) return;            // ילד שהולך עם ההורה
    let want = L.scheduledActivity(a.persona, sim.clock, a.seed, sim.weather).act;
    if (sim.wantHook) want = sim.wantHook(a, want, sim.clock) || want;   // תוספים (למשל טיול עם הכלב)
    if (want === a.act && a.state !== 'stay-done') return;
    const done = a.state === 'stay-done' && want === a.doneAct;
    a.act = want; const d = done ? destFor(a, 'home') : destFor(a, want); if (done) a.doneAct = null;
    // ילדים שמצטרפים להורה (בית כנסת / גן / טיול)
    if (!a.child) for (const k of sim.kidsOf(a)) {
      const kw = L.scheduledActivity('student', sim.clock, k.seed, sim.weather).act;
      if (want === 'park' || want === 'synagogue' || want === 'stroll' || want === 'beach' || (want === 'school_run' && kw === 'school') || (want === 'home' && k.followOn)) {
        k.followOn = want !== 'home'; if (k.state === 'inside' && a.state === 'inside') { k.x = a.x; k.z = a.z; }
        if (want === 'home') { k.followOn = false; }
      }
    }
    if (a.state === 'inside' && d.inside && d.place === a.place) return;
    a.place = d.place;
    if (a.state === 'inside') { const dd = door(a.state === 'inside' && a.atPlace && a.atPlace.cx != null ? a.atPlace : a.home, d.place.cx != null ? { x: d.place.cx, z: d.place.cz } : d.place); if (dd) { a.x = dd.x; a.z = dd.z; } }
    a.state = 'walk'; a.group = leaveGroup(a); setAnim(a, 'walk'); planTrip(a, d);
  }
  sim.kidsOf = a => { if (!a._kids) a._kids = sim.agents.filter(k => k.parent === a.id); return a._kids; };

  // --- קבוצות שיחה
  const groups = [];
  function leaveGroup(a) { const g = a.group; if (!g) return null; g.m = g.m.filter(x => x !== a); if (g.m.length === 1) { const o = g.m[0]; if (o.state === 'stay') setAnim(o, o.dest && o.dest.spot === 'beach' ? 'sit' : 'idle'); } return null; }
  function joinOrStartGroup(a) {
    for (const g of groups) { if (g.m.length && g.m.length < 4 && (g.x - a.x) ** 2 + (g.z - a.z) ** 2 < 25) {
      g.m.push(a); a.group = g; const k = g.m.length, ang = (k * 2.1 + g.r) % 6.283; a.gx = g.x + Math.cos(ang) * 0.95; a.gz = g.z + Math.sin(ang) * 0.95;
      for (const m of g.m) setAnim(m, g.sit ? 'sittalk' : 'talk'); return true; } }
    const g = { x: a.x, z: a.z, m: [a], r: rng(a.seed)() * 6, sit: a.dest && a.dest.spot === 'beach' && rng(a.seed ^ 3)() < 0.6 };
    a.gx = g.x + Math.cos(g.r) * 0.95; a.gz = g.z + Math.sin(g.r) * 0.95; groups.push(g); a.group = g; return false;
  }

  // --- הגעה ליעד
  function arrive(a) {
    const d = a.dest || {}; a.path = null; a.vx = a.vz = 0;
    if (d.inside) { a.state = 'inside'; a.atPlace = d.place; setAnim(a, 'idle'); if (d.after === 'gather') a.afterGather = sim.t; return; }
    a.state = 'stay'; a.stayT = sim.t; a.atPlace = d.place;
    const SR = rng(a.seed ^ Math.floor(sim.t));
    switch (d.spot) {
      case 'site': setAnim(a, wpick(SR, [['kneel', 3], ['arms', 1], ['carry', 2], ['idle', 1]])); if (a.anim === 'carry') { a.wander = 1; } break;
      case 'beach': if (sim.weather.rain > 0.2) { a.doneAct = a.act; a.state = 'stay-done'; break; } if (SR() < 0.45) joinOrStartGroup(a); else setAnim(a, SR() < 0.55 ? 'sit' : 'idle'); break;
      case 'park': case 'gather': if (SR() < 0.7) joinOrStartGroup(a); else setAnim(a, SR() < 0.3 ? 'arms' : 'idle'); break;
      case 'browse': setAnim(a, 'idle'); break;
      default: setAnim(a, 'idle');
    }
  }

  // --- עדכון סוכן
  const PL = sim.player;
  function follow(a, dt) {
    // רמות 1–2: התקדמות מדויקת לאורך הקו (בלי חריגה גם בצעד גדול)
    const p = a.path; let rem = (a.flee > 0 ? SPEED.run : a.pref) * dt, hx = 0, hz = 0;
    while (rem > 0 && a.pi < p.length / 2) {
      const tx = p[a.pi * 2], tz = p[a.pi * 2 + 1], dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      if (d > 1e-4) { hx = dx; hz = dz; }
      if (d <= rem) { a.x = tx; a.z = tz; rem -= d; a.pi++; } else { a.x += dx / d * rem; a.z += dz / d * rem; rem = 0; }
    }
    const sp = a.flee > 0 ? SPEED.run : a.pref; const hl = Math.hypot(hx, hz) || 1; a.vx = hx / hl * sp; a.vz = hz / hl * sp; a.speed = sp;
    if (hx || hz) a.heading = Math.atan2(hx, hz);
    setAnim(a, a.flee > 0 ? 'run' : a.carry ? 'carry' : 'walk');
    if (a.pi >= p.length / 2) arrive(a);
  }
  function steer(a, dt, full) {
    if (!full) return follow(a, dt);
    // מטרה: נקודת המסלול הבאה
    const p = a.path; let tx, tz;
    if (p) { tx = p[a.pi * 2]; tz = p[a.pi * 2 + 1];
      let dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      while (d < (full ? 1.2 : 2.5) && a.pi < p.length / 2 - 1) { a.pi++; tx = p[a.pi * 2]; tz = p[a.pi * 2 + 1]; dx = tx - a.x; dz = tz - a.z; d = Math.hypot(dx, dz); }
      if (d < 0.6 && a.pi >= p.length / 2 - 1) { arrive(a); return; }
    } else return;
    let dx = tx - a.x, dz = tz - a.z; const d = Math.hypot(dx, dz) || 1; let spd = a.flee > 0 ? SPEED.run : a.pref;
    let vx = dx / d * spd, vz = dz / d * spd;
    if (full) {
      // הפרדה משכנים
      let sx = 0, sz = 0; const i0 = Math.floor(a.x / NC), j0 = Math.floor(a.z / NC);
      for (let gi = i0 - 1; gi <= i0 + 1; gi++) for (let gj = j0 - 1; gj <= j0 + 1; gj++) { const cell = NG.get(gi * 100003 + gj); if (!cell) continue;
      for (let ci = 0; ci < cell.length; ci++) { const o = cell[ci]; if (o === a) continue; const ox = a.x - o.x, oz = a.z - o.z, d2 = ox * ox + oz * oz; if (d2 > 16 || d2 < 1e-6) continue; const d = Math.sqrt(d2);
        if (d < 1.2) { const k = (1.2 - d) / 1.2; sx += ox / d * k; sz += oz / d * k; }
        // מתקרבים זה לזה (חזיתית): כל אחד סוטה ימינה מבעוד מועד
        const rvx = a.vx - o.vx, rvz = a.vz - o.vz; if (ox * rvx + oz * rvz < 0) { const lat = Math.abs(ox * vz - oz * vx) / spd; if (lat < 1.1) { const k = (4 - d) / 4 * 0.9; sx += -vz / spd * k; sz += vx / spd * k; } } } }
      vx += sx * 2.2; vz += sz * 2.2;
      // השחקן: זזים הצידה כשהוא מתקרב
      const px = PL.x - a.x, pz = PL.z - a.z, pd2 = px * px + pz * pz;
      if (PL.mode === 'foot' && pd2 < 6.25) { const pd = Math.sqrt(pd2) || 1, k = (2.5 - pd) / 2.5; const side = (px * -vz + pz * vx) > 0 ? -1 : 1;
        vx += (-pz / pd * side * 1.8 - px / pd * 1.2) * k; vz += (px / pd * side * 1.8 - pz / pd * 1.2) * k; a.lookAt = sim.t + 1.5; }
    }
    if (a.flee > 0) { vx += a.fx * 3; vz += a.fz * 3; }
    const sp = Math.hypot(vx, vz), maxS = a.flee > 0 ? SPEED.run * 1.1 : a.pref * 1.5; if (sp > maxS) { vx *= maxS / sp; vz *= maxS / sp; }
    // החלקה של המהירות (אינרציה קלה)
    const k = full ? Math.min(1, dt * 6) : 1; a.vx += (vx - a.vx) * k; a.vz += (vz - a.vz) * k;
    let nx = a.x + a.vx * dt, nz = a.z + a.vz * dt;
    if (full && world.blocked && (sim._tick + a.id) % 3 === 0 && world.blocked(nx, nz)) { // לא נכנסים לבניינים (חוץ מביציאה/כניסה לדלת)
      const dd = a.path ? Math.hypot(a.path[a.path.length - 2] - nx, a.path[a.path.length - 1] - nz) : 99;
      if (dd > 3 && !world.blocked(a.x, a.z)) { if (!world.blocked(nx, a.z)) nz = a.z; else if (!world.blocked(a.x, nz)) nx = a.x; else { nx = a.x; nz = a.z; } } }
    a.x = nx; a.z = nz; a.speed = Math.hypot(a.vx, a.vz);
    if (a.speed > 0.15) { const h = Math.atan2(a.vx, a.vz); a.heading += angD(a.heading, h) * Math.min(1, dt * 8); }
    setAnim(a, a.flee > 0 || a.speed > 3 ? 'run' : a.speed > 0.2 ? (a.carry ? 'carry' : 'walk') : 'idle');
  }
  const angD = (a, b) => { let d = b - a; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; return d; };
  L.angD = angD;

  function react(a) {
    // בריחה מרכב מהיר: זמן ומרחק הגישה הקרובה ביותר
    if (PL.mode !== 'car' || PL.speed < 8.3) return;
    const rx = a.x - PL.x, rz = a.z - PL.z, d2 = rx * rx + rz * rz; if (d2 > 1600) return;
    const vv = PL.vx * PL.vx + PL.vz * PL.vz || 1e-6, tca = (rx * PL.vx + rz * PL.vz) / vv;
    if (tca < 0 || tca > 2.5) return;
    const cx = rx - PL.vx * tca, cz = rz - PL.vz * tca, miss = Math.hypot(cx, cz);
    if (miss > 3.5) return;
    // בורחים בניצב לכיוון הרכב, לצד שבו כבר נמצאים
    const vl = Math.sqrt(vv); let fx = -PL.vz / vl, fz = PL.vx / vl; if (fx * cx + fz * cz < 0) { fx = -fx; fz = -fz; }
    a.flee = 2.2; a.fx = fx; a.fz = fz; if (a.state !== 'walk') { a.prevState = a.state; a.state = 'walk'; a.path = [a.x, a.z, a.x + fx * 7, a.z + fz * 7]; a.pi = 1; a.dest = { place: { x: a.x + fx * 7, z: a.z + fz * 7 }, inside: false, spot: 'park' }; }
    a.group = leaveGroup(a); sim.events.push({ t: sim.t, type: 'flee', id: a.id });
  }

  function updAgent(a, dt, tier) {
    if (a.flee > 0) a.flee -= dt;
    // ילד שהולך עם ההורה
    if (a.parent != null && a.followOn) {
      const p = sim.byId[a.parent];
      if (!p || (p.state === 'inside' && p.act === 'home')) { a.followOn = false; a.state = 'inside'; a.x = p ? p.x : a.x; a.z = p ? p.z : a.z; return; }
      if (p.state === 'inside') { a.state = 'inside'; a.x = p.x; a.z = p.z; return; }
      const idx = sim.kidsOf(p).indexOf(a), back = 1.3 + idx * 0.5, lat = (idx % 2 ? -0.75 : 0.75);
      const hs = Math.sin(p.heading), hc = Math.cos(p.heading);
      let tx = p.x - hs * back + hc * lat, tz = p.z - hc * back - hs * lat;
      if (p.state === 'stay') { const R2 = rng(a.seed ^ Math.floor(sim.t / 6)); tx = p.x + (R2() - 0.5) * 7; tz = p.z + (R2() - 0.5) * 7; }
      const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      if (d > 30) { a.x = tx; a.z = tz; }
      const s = d < 0.3 ? 0 : Math.min(d * 1.5, p.state === 'stay' ? 2.6 : Math.max(p.speed, 0.6) * 1.25);
      a.vx = d > 1e-3 ? dx / d * s : 0; a.vz = d > 1e-3 ? dz / d * s : 0; a.x += a.vx * dt; a.z += a.vz * dt; a.speed = s; a.state = 'walk';
      if (s > 0.15) a.heading += angD(a.heading, Math.atan2(a.vx, a.vz)) * Math.min(1, dt * 8);
      else if (p.state === 'stay') a.heading += angD(a.heading, Math.atan2(p.x - a.x, p.z - a.z)) * Math.min(1, dt * 3);
      setAnim(a, s > 2.2 ? 'run' : s > 0.2 ? 'walk' : 'idle'); return;
    }
    if (tier === 0) react(a);
    if (a.state === 'walk') { if (a.path) steer(a, dt, tier === 0); return; }
    if (a.state === 'stay') {
      if (a.group && a.gx != null) { const dx = a.gx - a.x, dz = a.gz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.1) { const s = Math.min(1.2, d * 2); a.x += dx / d * s * dt; a.z += dz / d * s * dt; if (d > 0.4) setAnim(a, 'walk'); }
        else { setAnim(a, a.group.sit ? 'sittalk' : (a.group.m.length > 1 ? 'talk' : 'idle')); a.heading += angD(a.heading, Math.atan2(a.group.x - a.x, a.group.z - a.z)) * Math.min(1, dt * 4); } }
      // מסתכלים על השחקן כשהוא קרוב ועומד
      if (tier === 0) { const px = PL.x - a.x, pz = PL.z - a.z; if (px * px + pz * pz < 25 && PL.speed < 2 && PL.mode === 'foot') { if (!a.group || a.group.m.length < 2) a.heading += angD(a.heading, Math.atan2(px, pz)) * Math.min(1, dt * 3); a.lookAt = sim.t + 1; } }
      // שהייה נגמרת → שוב חושבים (למשל "שיטוט" חוזר הביתה)
      const dw = (a.dest && a.dest.dwell) || 0; if (dw && sim.t - a.stayT > dw) { a.doneAct = a.act; a.state = 'stay-done'; a.group = leaveGroup(a); }
      return;
    }
    // תפילת שבת בבוקר ~2.5 שעות (מקורב, 140–180 דק'); אחר כך מתאספים בחוץ
    if (a.state === 'inside' && a.afterGather && sim.t - a.afterGather > (140 + (a.seed % 41)) * 60 && !a._gathered) { // אחרי התפילה: מתאספים בחוץ לשיחה
      a._gathered = true; a.state = 'stay'; a.stayT = sim.t; a.dest = { spot: 'gather', dwell: 1200 + rng(a.seed)() * 900 }; const d = door(a.atPlace);
      // מתפזרים בחזית: 3–16 מ' החוצה ועד 14 מ' לצדדים, בקבוצות קטנות
      if (d) { const R1 = rng(a.seed ^ 5), out = 3 + R1() * 13, lat = (R1() - 0.5) * 28; a.x = d.x + (d.nx || 0) * out - (d.nz || 0) * lat; a.z = d.z + (d.nz || 0) * out + (d.nx || 0) * lat; } joinOrStartGroup(a);
    }
  }

  // --- רשת שכנים לרמה 0
  const NG = new Map(), NGused = [], NC = 2.5;

  /** צעד סימולציה. dtGame בשניות משחק. now = זמן משחק (Date) או clock מוכן */
  const NOW = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const PR = sim.prof = { think: 0, nThink: 0, upd0: 0, upd1: 0, upd2: 0, paths: 0, frames: 0 };
  sim.update = function (dt, clockOrDate) {
    PR.frames++;
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    sim.t += dt;
    if (clockOrDate) sim.clock = clockOrDate.dow != null ? clockOrDate : L.clock(clockOrDate);
    if (!sim.byId) { sim.byId = {}; for (const a of sim.agents) sim.byId[a.id] = a; }
    // מסלולים: עד 6 A* לפריים
    { const tq = (typeof performance !== 'undefined' ? performance : Date).now(); let k = 0;
      while (sim.pathQueue.length && (k < 1 || (k < opts.pathsPerFrame && (typeof performance !== 'undefined' ? performance : Date).now() - tq < opts.pathMs))) { const a = sim.pathQueue.shift(); if (a.state === 'walk' && a.target) solvePath(a); k++; } }
    // רמות לפי מרחק מהשחקן
    for (let i = 0; i < NGused.length; i++) NGused[i].length = 0; NGused.length = 0;
    if (NG.size > 3000) NG.clear();
    const t0R = sim._t0R || opts.tier0R, r0 = t0R * t0R, r1 = opts.tier1R * opts.tier1R; let c0 = 0, c1 = 0, c2 = 0, out = 0, n0 = 0;
    for (const a of sim.agents) {
      const dx = a.x - PL.x, dz = a.z - PL.z, d2 = dx * dx + dz * dz; a.d2 = d2;
      a.tier = d2 < r0 && a.state !== 'inside' ? 0 : d2 < r1 ? 1 : 2;
      if (a.tier === 0) { n0++; const k = Math.floor(a.x / NC) * 100003 + Math.floor(a.z / NC); let c = NG.get(k); if (!c) NG.set(k, c = []); if (!c.length) NGused.push(c); c.push(a); }
    }
    // רמה 0 מוגבלת ל-~90 סוכנים (כמו תקציב ה-80 המונפשים): רדיוס מסתגל
    sim._t0R = n0 > 90 ? Math.max(15, t0R * 0.92) : n0 < 70 ? Math.min(opts.tier0R, t0R * 1.04) : t0R;
    const tick = sim._tick = (sim._tick || 0) + 1;
    for (const a of sim.agents) {
      // חשיבה: פעם ב-20–40 שניות משחק לכל סוכן (פזור)
      if (sim.t >= a.next || a.state === 'stay-done') { a.next = sim.t + 20 + (a.seed % 20); think(a); PR.nThink++; }
      // תדירות עדכון: רמה 0 – כל פריים, רמה 1 – כל 4, רמה 2 – כל 16 (dt מצטבר)
      const every = a.tier === 0 ? 2 : a.tier === 1 ? 6 : 24;
      if ((tick + a.id) % every) {
        // רמה 0 בין צעדי ההיגוי: רק אינטגרציה של המיקום (חלק לעין, חצי מהעלות)
        if (a.tier === 0 && a.state === 'walk' && a.speed > 0.05) { a.x += a.vx * dt; a.z += a.vz * dt; }
        continue;
      }
      let adt = Math.min(sim.t - (a.lastUpd || sim.t - dt), a.tier === 2 ? 150 : 2); a.lastUpd = sim.t;
      if (a.tier === 0 && a.state === 'walk' && a._int) adt = dt;   // המיקום כבר קודם בפריים שבינתיים
      a._int = a.tier === 0;
      updAgent(a, adt, a.tier);
      if (a.tier === 0) c0++; else if (a.tier === 1) c1++; else c2++;
    }
    for (let i = groups.length - 1; i >= 0; i--) if (!groups[i].m.length) groups.splice(i, 1);
    for (const n of sim.named) updNamed(n, dt);
    for (const a of sim.agents) if (a.state !== 'inside') out++;
    const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    sim.stats.ms = sim.stats.ms * 0.9 + ms * 0.1; sim.stats.last = ms; sim.stats.t0 = c0; sim.stats.t1 = c1; sim.stats.t2 = c2; sim.stats.outdoor = out; sim.stats.groups = groups.length;
    if (sim.events.length > 50) sim.events.splice(0, sim.events.length - 50);
  };
  /** "התיישבות" מיידית בלי הרצה: כל סוכן במקום שבו לוח הזמנים שם אותו עכשיו; מי שהפעילות שלו התחילה לפני פחות מ-25 דק' – עדיין בדרך.
      זול (O(n)), כך שאפשר לאכלס מחדש כשהשחקן עובר שכונה בלי עצירה. */
  sim.settle = function (clockOrDate) {
    sim.clock = clockOrDate.dow != null ? clockOrDate : L.clock(clockOrDate); if (!sim.byId) { sim.byId = {}; for (const a of sim.agents) sim.byId[a.id] = a; }
    let walking = 0;
    for (const a of sim.agents) {
      if (a.parent != null) continue;
      const sa = L.scheduledActivity(a.persona, sim.clock, a.seed, sim.weather);
      if (sim.wantHook) { const w2 = sim.wantHook(a, sa.act, sim.clock); if (w2 && w2 !== sa.act) { sa.act = w2; sa.from = sim.clock.min - 5; } }
      a.act = sa.act; a.next = sim.t + (a.seed % 30);
      const d = destFor(a, sa.act), pl = d.place, recent = sim.clock.min - sa.from < 25 && sa.from > 0 && (rng(a.seed ^ 0x77)() < 0.7);
      if (recent) { const h = door(a.home, pl.cx != null ? { x: pl.cx, z: pl.cz } : pl); if (h) { a.x = h.x; a.z = h.z; } a.place = pl; a.state = 'walk'; setAnim(a, 'walk'); planTrip(a, d); walking++; continue; }
      if (d.inside) { a.state = 'inside'; a.atPlace = pl; const h = door(pl, null); if (h) { a.x = h.x; a.z = h.z; }
        if (d.after === 'gather') a.afterGather = sim.t - Math.max(0, (sim.clock.min - sa.from) * 60); continue; }
      a.dest = d; const tx = pl.cx != null ? spotNear(a, pl, null) : { x: pl.x + (rng(a.seed)() - 0.5) * 14, z: pl.z + (rng(a.seed ^ 9)() - 0.5) * 14 };
      a.x = tx.x; a.z = tx.z; arrive(a);
    }
    for (const k of sim.agents) if (k.parent != null) { const p = sim.byId[k.parent]; k.x = p.x; k.z = p.z; k.state = 'inside'; k.followOn = false;
      if (p.state !== 'inside' && (p.act === 'park' || p.act === 'synagogue' || p.act === 'stroll' || p.act === 'beach')) k.followOn = true; }
    return walking;
  };
  sim.setPlayer = function (p) { Object.assign(PL, p); };
  sim.setWeather = function (w) { const was = sim.weather.rain > 0.2; sim.weather = Object.assign({ rain: 0 }, w); const now = sim.weather.rain > 0.2;
    for (const a of sim.agents) a.look.umbrella = now && !a.look.hardhat && (rng(a.seed ^ 0xabc)() < 0.8);
    if (was !== now) for (const a of sim.agents) a.next = sim.t + (a.seed % 10); };
  sim.groups = groups;
  /** המקום הכי חי (תא 50 מ' עם הכי הרבה אנשים בחוץ) בטווח R מנקודה */
  sim.busiest = function (x, z, R) {
    const C = 50, m = new Map(); let best = null, bn = 0;
    for (const a of sim.agents) { if (a.state === 'inside') continue; if ((a.x - x) ** 2 + (a.z - z) ** 2 > R * R) continue; const k = Math.floor(a.x / C) + ',' + Math.floor(a.z / C); const c = (m.get(k) || 0) + 1; m.set(k, c); if (c > bn) { bn = c; best = k; } }
    if (!best) return null; const [i, j] = best.split(',').map(Number); let sx = 0, sz = 0, n = 0;
    for (const a of sim.agents) if (a.state !== 'inside' && Math.floor(a.x / C) === i && Math.floor(a.z / C) === j) { sx += a.x; sz += a.z; n++; }
    return { x: sx / n, z: sz / n, n };
  };

  // --- דמויות בעלות שם (אינטראקטיביות)
  sim.addNamed = function (n) {
    const a = Object.assign({ id: 'n:' + n.key, named: true, state: 'stay', anim: n.anim || 'idle', animT: 0, heading: n.heading || 0, x: n.x, z: n.z, vx: 0, vz: 0, speed: 0, persona: n.persona || 'worker', sex: n.sex || 'm', child: false,
      seed: hash32(n.key), d2: 0, tier: 0, homeHeading: n.heading || 0 }, n);
    a.look = Object.assign(L.makeLook(rng(a.seed), a), n.look || {});
    sim.named.push(a); return a;
  };
  function updNamed(n, dt) {
    // נוכחות לפי לוח: למשל קבלן ובעל חנות לא נמצאים בשבת; מציל רק בשעות היום
    n.present = n.presence ? n.presence(sim.clock, sim.weather) : true;
    const px = PL.x - n.x, pz = PL.z - n.z, d2 = px * px + pz * pz; n.d2 = d2;
    const target = d2 < 64 && PL.mode === 'foot' ? Math.atan2(px, pz) : n.homeHeading;
    n.heading += angD(n.heading, target) * Math.min(1, dt * 3);
    n.anim = n.talking ? 'talk' : d2 < 36 ? (n.greetAnim || 'idle') : (n.baseAnim || n.anim);
  }
  return sim;
};

// ---------------- 7. מקומות פתוחים וחוף מהעולם (מקורב)
/** דגימת רשת: חוף = יבשה שיש ים בטווח 45 מ' מערבה; "פארק" = שטח פתוח בלי בניינים ב-18 מ' ובלי כביש ב-8 מ' (מקורב! אין שכבת פארקים באריחים) */
L.findSpots = function (world, cx, cz, R, step) {
  step = step || 24; const open = [], beach = [];
  for (let x = cx - R; x <= cx + R; x += step) for (let z = cz - R; z <= cz + R; z += step) {
    if ((x - cx) ** 2 + (z - cz) ** 2 > R * R) continue;
    if (world.isSea(x, z)) continue;
    const seaW = world.isSea(x - 45, z) || world.isSea(x - 25, z);
    if (seaW && !world.isSea(x - 8, z)) { if (!world.nearBuilding || !world.nearBuilding(x, z, 6)) beach.push({ x: x - 10, z }); continue; }
    if (world.nearBuilding && world.nearBuilding(x, z, 18)) continue;
    if (world.nearRoad && world.nearRoad(x, z, 8)) continue;
    if (world.nearRoad && !world.nearRoad(x, z, 140)) continue;
    open.push({ x, z });
  }
  return { open, beach };
};

/** חוף לאורך הים (מערבה, כמו באשדוד): בכל שורה צועדים מערבה עד הים; הנקודה = 10–35 מ' לפני קו המים */
L.findBeach = function (world, cx, cz, R, step) {
  step = step || 40; const out = [];
  for (let z = cz - R; z <= cz + R; z += step) {
    for (let x = cx, k = 0; k < 400; k++, x -= 12) { if (world.isSea(x, z)) { for (const d of [12, 24, 36]) { const bx = x + d; if (!world.isSea(bx, z) && !world.isSea(bx - 6, z)) { out.push({ x: bx, z, sand: true }); break; } } break; } }
  }
  return out;
};

return L;
});
