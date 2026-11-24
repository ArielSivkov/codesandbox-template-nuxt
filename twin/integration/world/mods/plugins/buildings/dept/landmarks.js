/* ESH27 · מחלקת הבניינים — landmarks.js
   ציוני דרך באשדוד: רק עובדות עם מקור. גובה/קומות 'data' = מצוטט; צורה/מידה 'proc' = הנחה חזותית מסומנת.
   מזהי OSM מתייחסים לאריחי הדגימה (twin/pipeline/sample-out-ashdod = b6/map/data), כפי שהותאמו ב-twin/groundtruth.
   קואורדינטות: ITM של אריחי הדגימה = ITM אמיתי − (1507.82, 757.76) (היסט הגאורפרנס, groundtruth/README.txt). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ESHBuildings = root.ESHBuildings || {}; root.ESHBuildings.landmarks = api; }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const GEOREF = { dx: 1507.82, dy: 757.76 };   // twin/groundtruth/ashdod_reference.json → georef_offset_itm_m

// על בניין קיים באריח (לפי מזהה OSM): תיקון גובה + תווית + צורה מיוחדת אופציונלית
const ON_TILE = [
  { id: 'w358974561', he: 'מגדלי K – מגדל 1', h: 142, floors: 40, year: 2014, conf: 'high',
    src: ['https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Israel', 'https://www.globes.co.il/news/article.aspx?did=1000488026'],
    note: 'ויקיפדיה 142 מ\' / 40 קומות; גלובס ומודעת יד2: 42 קומות' },
  { id: 'w358974559', he: 'מגדלי K – מגדל 2', h: 138, floors: 40, year: 2014, conf: 'high',
    src: ['https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Israel', 'https://aroundus.com/p/7784834-k-towers'] },
  { id: 'w189733330', he: 'מגדל דמרי (טאוור אשדוד)', h: 160, floors: 46, year: 2021, conf: 'high',
    src: ['https://www.skyscrapercenter.com/building/dimri-tower/49478', 'https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Israel'],
    note: 'CTBUH: 160 מ\' ארכיטקטוני, 46 קומות; ויקיפדיה 154 מ\'/44. טביעת OSM (3,337 מ"ר, building=construction) כנראה כל המגרש – הגובה מוחל על כולה' },
  { id: 'w101976178', he: 'מוזיאון אשדוד לאמנות – מונארט', year: 2003, conf: 'medium', shape: 'pyramid',
    src: ['https://en.wikipedia.org/wiki/Ashdod_Museum_of_Art', 'https://en.wikipedia.org/wiki/Ashdod'],
    note: 'נחנך 2003, 12 גלריות; "הכניסה היא פירמידת זכוכית". גובה לא פורסם – נשאר אומדן. מידות הפירמידה: proc' },
  { id: 'w348041566', he: 'עיריית אשדוד', conf: 'label', src: ['OSM: name=עיריית אשדוד, building=townhall'], note: 'אין מקור לגובה – תווית בלבד' },
  { id: 'w98483037', he: 'היכל התרבות אשדוד', conf: 'label', src: ['OSM: name=היכל התרבות אשדוד'], note: 'מרכז אמנויות הבמה (חיים דותן, 2012) נמצא באותו אזור לפי ויקיפדיה; זהות הטביעה לא אומתה – תווית בלבד' },
  { id: 'w238281900', he: 'מלון לאונרדו פלאזה', floors: 13, conf: 'medium', src: ['https://www.gadish.co.il/en/project/%D7%9E%D7%9C%D7%95%D7%9F-%D7%9C%D7%90%D7%95%D7%A0%D7%A8%D7%93%D7%95-%D7%A4%D7%9C%D7%90%D7%96%D7%94-%D7%90%D7%A9%D7%93%D7%95%D7%93/'], note: '10 קומות מלון + 3 מסחר; גובה במטרים לא פורסם – קומות × 3.3 (proc)' },
  { id: 'w321354658', he: 'מלון ווסט', floors: 9, conf: 'medium', src: ['https://www.timeout.com/israel/hotels/west-boutique-hotel-ashdod'], note: '"בניין בן 9 קומות מול הים"; גובה: קומות × 3.3 (proc)' },
];

// מודלים עצמאיים (אין טביעה באריח או שהיא לא מתאימה)
function toSample(itm) { return [itm[0] - GEOREF.dx, itm[1] - GEOREF.dy]; }
const STANDALONE = [
  { key: 'light', he: 'מגדלור אשדוד – גבעת יונה', h: 42, year: 1966, conf: 'high',
    itm_real: [166617.0, 635816.8],                     // מ-31°48′50″N 34°38′47″E (pyproj, EPSG:2039)
    src: ['https://en.wikipedia.org/wiki/Ashdod_Light'],
    facts: 'מגדל בטון 42 מ\', גובה מוקד 76 מ\' מעל הים; חציו התחתון מנסרה משולשת, העליון גלילי; 1966',
    proc: 'רוחב המנסרה 6 מ\' וקוטר הגליל 4 מ\' – הנחה; הגבעה עצמה לא מופיעה במודל הקרקע הנוכחי (גובה מוקד 76 מ\' מרמז על גבעה בגובה ~34 מ\')' },
  { key: 'fort', he: 'מצודת אשדוד־ים (מינת אל-קלעה)', h: 4.5, year: 'המאה ה-7', conf: 'medium',
    itm_real: [164229.9, 632102.5],                     // 31.78028°N 34.62139°E (ויקיפדיה)
    size: [35, 55], src: ['https://en.wikipedia.org/wiki/Ashdod-Yam'],
    facts: 'מבצר אומיי (עבד אל-מלכ), 35×55 מ\', שופץ בידי הפאטמים והצלבנים',
    proc: 'גובה השרידים 4.5 מ\', 4 מגדלי פינה עגולים וכיוון הציר המקביל לקו החוף (~24° מזרחית לצפון) – הנחות חזותיות' },
];
STANDALONE.forEach(s => { s.itm = toSample(s.itm_real); });


/* מגדלים לפי נקודה (ג'מיני, twin_ashdod_towers_geoint_v1, 23.11.2026): אין מזהה OSM, הגובה = קומות מאתר היזם × ~3.4 (משוער).
   מוחל על הבניין הגבוה ביותר באריח שמרכזו ברדיוס r מהנקודה, ורק אם אין לו גובה מנתונים. K ודמרי לא כאן – נשארו לפי המקורות למעלה. */
const BY_POINT = [
  { key: 'yahad-d', he: 'מגדלי יחד – רובע ד׳', floors: 34, h: 115, itm_real: [166364.8, 634233.4], r: 30, conf: 'estimated', src: ['https://www.yad2.co.il/yad1/project/1529'] },
  { key: 'aqua-park', he: 'AQUA PARK – עמרם אברהם', floors: 29, h: 100, itm_real: [167576.3, 635957.1], r: 35, conf: 'estimated', src: ['https://amramltd.co.il/portfolio/aqwa-park-%D7%90%D7%A9%D7%93%D7%95%D7%93-%D7%A6%D7%A4%D7%95%D7%9F/'] },
  { key: 'sarfati', he: 'צרפתי TOWERS', floors: 23, h: 80, itm_real: [167643.2, 636089.8], r: 35, conf: 'estimated', src: ['https://www.yad2.co.il/yad1/project/18032'] },
  { key: 'seaport', he: 'מרכז עסקים סי פורט', floors: 12, h: 46, itm_real: [167361.6, 635642.2], r: 30, conf: 'estimated', src: ['https://www.zira1.com/buildings/5dcac0397db4310294f3f905'] },
  { key: 'we-lev', he: 'We לב אשדוד', floors: 25, h: 86, itm_real: [166912.0, 633820.3], r: 35, conf: 'estimated', src: ['https://www.s-sarfati.co.il/blog/lev-ashdod-residential-commercial-hub/'] },
  { key: 'yahad-maar', he: 'יחד במע"ר', floors: 25, h: 85, itm_real: [165951.8, 633115.6], r: 30, conf: 'estimated', src: ['https://y-hb.co.il/maar/'] },
  { key: 'the-lux', he: 'THE LUX – גבאי', floors: 14, h: 50, itm_real: [165838.1, 634923.7], r: 30, conf: 'estimated', src: ['https://gabaygroup.com/projects/the-lux/'] },
];
BY_POINT.forEach(s => { s.itm = toSample(s.itm_real); });

const byId = new Map(ON_TILE.map(l => [l.id, l]));
function landmarkOf(id) { return byId.get(String(id).startsWith('w') || String(id).startsWith('r') ? String(id) : 'w' + id) || null; }
/* גובה יעד לציון דרך: h מצוטט, אחרת קומות × 3.3 (מסומן proc), אחרת null */
function targetHeight(l) { if (!l) return null; if (l.h) return { h: l.h, basis: 'data' }; if (l.floors) return { h: l.floors * 3.3 + 1, basis: 'proc' }; return null; }

return { GEOREF, ON_TILE, STANDALONE, BY_POINT, landmarkOf, targetHeight, toSample };
});
