/* ESH27 · לוח היזם · מחלקת הבניינים — typology.js
   טיפולוגיה של בנייני אשדוד + מתמטיקת החזית (חלונות/קומות/מפרצים), רמות פירוט, אורות לילה, ציוד גג.
   קוד טהור (בלי three.js) – רץ בדפדפן (window.ESHBuildings.typology) ובצומת (require) לבדיקות.
   כלל ברזל: כל ערך מסומן 'data' (מהאריח/מקור מצוטט) או 'proc' (פרוצדורלי – הנחה חזותית). ראו SOURCES.txt. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ESHBuildings = root.ESHBuildings || {}; root.ESHBuildings.typology = api; }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---------- קודי טיפולוגיה (4 ביטים בשיידר) ----------
const T = { GROUND: 0, VILLA: 1, WALKUP: 2, RAKEVET: 3, BLOCK: 4, TOWER: 5, COMMERCIAL: 6, PUBLIC: 7, INDUSTRIAL: 8, ANNEX: 9, LANDMARK: 10 };
const T_HE = ['קרקע', 'צמוד קרקע / קוטג\'', 'שיכון 3–4 קומות', 'בניין רכבת (בלוק ארוך)', 'בלוק 5–10 קומות', 'מגדל מגורים / משרדים', 'מסחר / קניון', 'מבנה ציבור', 'תעשייה / מחסן', 'מבנה עזר', 'ציון דרך'];
const MAT = { PLASTER: 0, STONE: 1, CONCRETE: 2, GLASS: 3 };
const MAT_HE = ['שליכט / טיח', 'חיפוי אבן', 'בטון / פח', 'קיר מסך זכוכית'];

const RE_PUBLIC = /בית ?כנסת|בית ?ספר|גן ילדים|היכל|מוזיאון|מתנ"?ס|בית ?חולים|מכללה|ישיבה|עירי|מונארט|synagog|school|museum/i;
const RE_COMM = /קניון|מרכז מסחרי|מרכזון|mall|seamall|סי טאוור/i;
const RE_TOWER = /טאוו?ר|tower|מגדל/i;
const TYP_VILLA = new Set(['house', 'detached', 'semidetached_house', 'bungalow', 'terrace', 'villa']);
const TYP_IND = new Set(['industrial', 'warehouse', 'manufacture', 'cowshed', 'hangar', 'storage_tank']);
const TYP_COMM = new Set(['retail', 'commercial', 'supermarket', 'kiosk']);
const TYP_PUB = new Set(['school', 'kindergarten', 'university', 'college', 'synagogue', 'civic', 'townhall', 'public', 'hospital', 'sports_centre', 'train_station', 'government', 'religious', 'museum']);
const TYP_ANNEX = new Set(['roof', 'shed', 'garage', 'garages', 'carport', 'hut', 'service', 'transformer_tower']);

/* classify(b) — b: { typ, name, area (מ"ר), floors, h (מ'), len, wid (מידות מלבן חוסם מכוון, מ'), floorsSrc ('R' = כלל אצבע) }
   מחזיר { code, he, basis, why } ; basis: 'data' (תג OSM / שם), 'shape' (גאומטריה), 'rule' (קומות משוערות). */
function classify(b) {
  const typ = (b.typ || '').toLowerCase(), name = b.name || '', area = +b.area || 0, f = +b.floors || 0, h = +b.h || f * 3;
  const elong = b.len && b.wid ? b.len / Math.max(b.wid, 0.5) : 1;
  const est = !b.floorsSrc || b.floorsSrc === 'R';            // קומות מכלל אצבע של גדוד 5
  const R = (code, basis, why) => ({ code, he: T_HE[code], basis, why });
  if (TYP_VILLA.has(typ)) return R(T.VILLA, 'data', 'building=' + typ);
  if (TYP_IND.has(typ)) return R(T.INDUSTRIAL, 'data', 'building=' + typ);
  if (TYP_ANNEX.has(typ)) return R(T.ANNEX, 'data', 'building=' + typ);
  if (typ === 'office' && h >= 35) return R(T.TOWER, 'data', 'building=office, גובה ≥ 35 מ\'');
  if (TYP_COMM.has(typ) || typ === 'office' || RE_COMM.test(name)) return R(T.COMMERCIAL, 'data', typ ? 'building=' + typ : 'שם: ' + name);
  if (TYP_PUB.has(typ) || RE_PUBLIC.test(name)) return R(T.PUBLIC, 'data', typ ? 'building=' + typ : 'שם: ' + name);
  if (area > 0 && area < 40) return R(T.ANNEX, 'shape', 'שטח < 40 מ"ר');
  if (f >= 11 || h >= 35 || (RE_TOWER.test(name) && f >= 8)) return R(T.TOWER, est && !RE_TOWER.test(name) ? 'rule' : 'data', f >= 11 ? f + ' קומות' : 'שם: ' + name);
  if (f > 0 && f <= 2 && area < 300) return R(T.VILLA, est ? 'rule' : 'data', f + ' קומות, ' + Math.round(area) + ' מ"ר');
  if (f >= 3 && f <= 9 && elong >= 2.6 && (b.len || 0) >= 40) return R(T.RAKEVET, 'shape', 'יחס אורך/רוחב ' + elong.toFixed(1) + ', אורך ' + Math.round(b.len) + ' מ\'');
  if (f >= 5) return R(T.BLOCK, est ? 'rule' : 'data', f + ' קומות');
  if (area >= 3000 && f <= 3) return R(T.COMMERCIAL, 'shape', 'טביעה גדולה ונמוכה ' + Math.round(area) + ' מ"ר');
  return R(T.WALKUP, est ? 'rule' : 'data', (f || '?') + ' קומות');
}

/* פרמטרי חזית לכל טיפולוגיה — כולם פרוצדורליים (proc) אלא אם צוין. bay = רוחב מפרץ חלון (מ').
   pil = הסתברות קומת עמודים · balc = הסתברות עמודת מרפסות · closed = הסתברות מרפסת סגורה (סגירת מרפסות)
   shut = חלק ממוצע של תריס גלילה מוגף · ac = הסתברות מזגן מתחת לחלון · mat = התפלגות חומר [טיח, אבן, בטון, זכוכית] */
const FACADE = {
  [T.VILLA]:      { bay: 3.4, ww: 0.42, wh: 0.45, sill: 0.33, pil: 0.0, balc: 0.15, closed: 0.1, shut: 0.45, ac: 0.25, shop: 0, mat: [0.75, 0.25, 0, 0] },
  [T.WALKUP]:     { bay: 3.0, ww: 0.46, wh: 0.42, sill: 0.33, pil: 0.30, balc: 0.40, closed: 0.55, shut: 0.40, ac: 0.35, shop: 0, mat: [0.92, 0.08, 0, 0] },
  [T.RAKEVET]:    { bay: 3.0, ww: 0.46, wh: 0.42, sill: 0.33, pil: 0.20, balc: 0.40, closed: 0.55, shut: 0.40, ac: 0.35, shop: 0, mat: [0.95, 0.05, 0, 0] },
  [T.BLOCK]:      { bay: 3.2, ww: 0.50, wh: 0.45, sill: 0.30, pil: 0.70, balc: 0.30, closed: 0.35, shut: 0.35, ac: 0.30, shop: 0, mat: [0.65, 0.35, 0, 0] },
  [T.TOWER]:      { bay: 3.6, ww: 0.62, wh: 0.60, sill: 0.20, pil: 1.00, balc: 0.35, closed: 0.05, shut: 0.15, ac: 0.10, shop: 0, mat: [0.15, 0.55, 0, 0.30] },
  [T.COMMERCIAL]: { bay: 6.0, ww: 0.80, wh: 0.55, sill: 0.25, pil: 0.0, balc: 0.0, closed: 0, shut: 0.0, ac: 0.0, shop: 1, mat: [0.4, 0.2, 0.3, 0.1] },
  [T.PUBLIC]:     { bay: 4.5, ww: 0.55, wh: 0.45, sill: 0.35, pil: 0.0, balc: 0.0, closed: 0, shut: 0.10, ac: 0.20, shop: 0, mat: [0.5, 0.4, 0.1, 0] },
  [T.INDUSTRIAL]: { bay: 8.0, ww: 0.30, wh: 0.20, sill: 0.65, pil: 0.0, balc: 0.0, closed: 0, shut: 0.0, ac: 0.0, shop: 0, mat: [0.1, 0, 0.9, 0] },
  [T.ANNEX]:      { bay: 9.0, ww: 0.0, wh: 0.0, sill: 0.5, pil: 0.0, balc: 0.0, closed: 0, shut: 0.0, ac: 0.0, shop: 0, mat: [0.7, 0, 0.3, 0] },
  [T.LANDMARK]:   { bay: 3.6, ww: 0.60, wh: 0.55, sill: 0.22, pil: 1.00, balc: 0.25, closed: 0.0, shut: 0.1, ac: 0.0, shop: 0, mat: [0.1, 0.6, 0, 0.3] },
};

// ---------- גיבוב יציב (FNV-1a) → זרע 0..32767 ----------
function seedOf(id) { let h = 2166136261; const s = String(id); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) & 32767; }
const rnd = (seed, k) => { let x = Math.imul(seed ^ Math.imul(k + 1, 0x9E3779B1), 0x85EBCA6B) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xC2B2AE35) >>> 0; x ^= x >>> 16; return (x >>> 0) / 4294967296; };

/* facadeFlags — בוחר דגלים פרוצדורליים יציבים לבניין: עמודים, חנויות בקומת קרקע, חומר.
   shopsData: true/false אם יש נתון (למשל shop=* מ-OSM או building=retail) — גובר על ההסתברות. */
function facadeFlags(code, seed, shopsData) {
  const P = FACADE[code] || FACADE[T.WALKUP];
  const pil = rnd(seed, 1) < P.pil ? 1 : 0;
  const shop = shopsData === true ? 1 : shopsData === false ? 0 : (P.shop ? 1 : 0);
  let r = rnd(seed, 2), mat = 0; for (let i = 0; i < 4; i++) { if (r < P.mat[i]) { mat = i; break; } r -= P.mat[i]; }
  return { pil: shop ? 0 : pil, shop, mat };
}

/* facadeLayout — אותה נוסחה בדיוק כמו בשיידר (facades.js):
   מפרצים n = 0 אם הקיר קצר מ-2 מ', אחרת max(1, round(L / bay)); רוחב מפרץ = L / n.
   חלונות לקיר = n × קומות מאוכלסות (קומת קרקע לא נספרת אם היא קומת עמודים או חזית חנויות). */
function facadeLayout(wallLen, floors, code, flags) {
  const P = FACADE[code] || FACADE[T.WALKUP];
  const n = wallLen < 2 || P.ww <= 0 ? 0 : Math.max(1, Math.round(wallLen / P.bay));
  const groundSpecial = flags && (flags.pil || flags.shop) ? 1 : 0;
  const winFloors = Math.max(0, floors - groundSpecial);
  return { bays: n, bayW: n ? wallLen / n : 0, winFloors, windows: n * winFloors, groundSpecial };
}

/* פנימי: אורך/רוחב של מלבן חוסם מכוון לפי הקיר הארוך ביותר. segs = [[ax,an,bx,bn],...] */
function footprintDims(segs) {
  let best = null, bl = 0, perim = 0;
  for (const s of segs) { const l = Math.hypot(s[2] - s[0], s[3] - s[1]); perim += l; if (l > bl) { bl = l; best = s; } }
  if (!best) return { len: 0, wid: 0, perim: 0 };
  const ux = (best[2] - best[0]) / bl, un = (best[3] - best[1]) / bl;
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const s of segs) for (const [x, n] of [[s[0], s[1]], [s[2], s[3]]]) { const a = x * ux + n * un, b = -x * un + n * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const L = a1 - a0, W = b1 - b0, ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  // ang: כיוון הקיר הארוך (רדיאנים, ממזרח נגד כיוון השעון) · cx/cn: מרכז המלבן המכוון
  return { len: Math.max(L, W), wid: Math.min(L, W), perim, ang: Math.atan2(un, ux) + (W > L ? Math.PI / 2 : 0), cx: ca * ux - cb * un, cn: ca * un + cb * ux };
}

// ---------- רמות פירוט (LOD) ----------
/* שלוש רמות: 2 = קרוב (חזית מלאה + ציוד גג), 1 = בינוני (חלונות בלי פרטים קטנים, בלי ציוד גג), 0 = רחוק (צבע ממוצע שטוח).
   היסטרזיס 15% – לא מהבהב בגבול. אותם קבועים נשלחים לשיידר (uNear/uFar). */
const LOD = { NEAR: 450, FAR: 1400, CLUTTER: 420, HYST: 1.15 };
function lodFor(dist, prev) {
  let w = dist < LOD.NEAR ? 2 : dist < LOD.FAR ? 1 : 0;
  if (prev != null && prev > w) { const lim = prev === 2 ? LOD.NEAR : LOD.FAR; if (dist < lim * LOD.HYST) w = prev; }
  return w;
}
function clutterOn(dist, wasOn) { return dist < LOD.CLUTTER * (wasOn ? LOD.HYST : 1); }

// ---------- אורות לילה ----------
/* חלק החלונות הדולקים לפי שעה מקומית (פרוצדורלי – אין מקור מדוד; עקומה סבירה למגורים). */
const LIT = [[0, 0.22], [1, 0.14], [3, 0.07], [5, 0.08], [6, 0.18], [7, 0.20], [8, 0.10], [16, 0.10], [17, 0.25], [18, 0.45], [19, 0.60], [21, 0.65], [22, 0.55], [23, 0.38], [24, 0.22]];
function litFraction(hour) { const h = ((hour % 24) + 24) % 24; for (let i = 1; i < LIT.length; i++) if (h <= LIT[i][0]) { const [h0, v0] = LIT[i - 1], [h1, v1] = LIT[i]; return v0 + (v1 - v0) * (h - h0) / (h1 - h0); } return LIT[0][1]; }
/* night = 0 ביום, 1 בלילה, לפי גובה השמש (מעלות): דמדומים אזרחיים עד −6°. */
function nightFactor(sunAltDeg) { return Math.min(1, Math.max(0, (4 - sunAltDeg) / 10)); }

// ---------- ציוד גג (דודי שמש, מיכלי מים, מזגנים, חדר מדרגות) ----------
/* חוק דודי השמש (1980): חובה בבנייני מגורים חדשים עד 27 מ'; הרחבה 2012: מעל 27 מ' – לשבע הקומות העליונות (solarthermalworld.org).
   יחידות לקומה ≈ שטח טביעה / 110 מ"ר (proc: דירה ממוצעת + שטחים משותפים). קיבולת: מערכת לכל 6 מ"ר גג. */
const RESID = new Set([T.VILLA, T.WALKUP, T.RAKEVET, T.BLOCK, T.TOWER]);
function roofKit(code, floors, area, h, seed) {
  const out = { solar: 0, tank: 0, ac: 0, stair: 0, basis: 'proc' };
  if (code === T.ANNEX || code === T.GROUND || area < 25) return out;
  const roofCap = Math.floor(area * 0.8 / 6);
  if (RESID.has(code)) {
    const upf = code === T.VILLA ? 1 : Math.max(1, Math.min(12, Math.round(area / 110)));
    const solarFloors = (h || floors * 3) <= 27 ? floors : Math.min(7, floors);
    out.solar = Math.min(roofCap, upf * solarFloors);
    out.tank = code === T.VILLA ? (rnd(seed, 7) < 0.4 ? 1 : 0) : Math.max(1, Math.round(upf * floors / 14));
    const acShare = code === T.TOWER ? 0.15 : code === T.BLOCK ? 0.35 : 0.5;
    out.ac = Math.min(Math.max(0, roofCap - out.solar), Math.round(upf * floors * acShare));
    out.stair = code === T.VILLA ? 0 : Math.max(1, Math.round(Math.sqrt(area) / 22));
  } else if (code === T.COMMERCIAL || code === T.PUBLIC || code === T.LANDMARK) {
    out.ac = Math.min(roofCap, Math.round(area / 120)); out.stair = 1; out.tank = area > 400 ? 1 : 0;
  } else if (code === T.INDUSTRIAL) { out.ac = Math.min(roofCap, Math.round(area / 400)); }
  return out;
}

// ---------- אריזה לשיידר (Int16) ----------
/* afc.z = code | floors<<4 | pil<<10 | shop<<11 | mat<<12  (≤ 14 ביטים) */
function pack(code, floors, flags) { return (code & 15) | (Math.min(63, Math.max(0, floors | 0)) << 4) | ((flags.pil & 1) << 10) | ((flags.shop & 1) << 11) | ((flags.mat & 7) << 12); }
function unpack(p) { return { code: p & 15, floors: (p >> 4) & 63, pil: (p >> 10) & 1, shop: (p >> 11) & 1, mat: (p >> 12) & 7 }; }

// ---------- רובעים ----------
/* אין גבולות רובעים באריחים הנוכחיים – לכן quarterOf מחזיר null עד שהצינור יוסיף שדה q (ראו pipeline/typology.py).
   עובדות מצוטטות לרובעים (ללא קואורדינטות): */
const QUARTERS = {
  "רובע א'": { era: 'הרובע הראשון והוותיק', src: 'https://www.nadlancenter.co.il/article/8384' },
  "רובע ה'": { era: 'מבנים בני 4 קומות (אבן עזרא, פינוי-בינוי)', src: 'https://www.nadlancenter.co.il/article/7731' },
  'הדקל': { era: '9 בנייני מגורים שנבנו בתחילת שנות ה-60', src: 'https://www.nadlancenter.co.il/article/7731' },
  'רובע י"א': { era: 'בניין 8 קומות על עמודים + 2 דירות גג', src: 'https://www.ynet.co.il/articles/mobile/0,7340,L-4190171,00.html' },
  'הסיטי': { era: 'מגדלים 2014–2021 (מגדלי K, מגדל דמרי)', src: 'https://www.skyscrapercenter.com/building/dimri-tower/49478' },
};

return { T, T_HE, MAT, MAT_HE, FACADE, classify, facadeFlags, facadeLayout, footprintDims, seedOf, rnd, LOD, lodFor, clutterOn, litFraction, nightFactor, roofKit, pack, unpack, QUARTERS, RESID };
});
