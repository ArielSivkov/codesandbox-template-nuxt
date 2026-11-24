/* 53-materials-hd.js — חומרים חדים לעולם (גדוד הטקסטורות, ESH27): כביש, סימוני כביש, מדרכות, אבני שפה, קרקע, חזיתות.
 *
 * מקור הטקסטורות: twin/integration/tools/texfactory (פרוצדורלי ומקורי; מקור 4096 נשמר מחוץ למשחק, כאן רק גרסאות זמן ריצה).
 * טעינה עצלה: מתחיל רק אחרי שהעולם עלה והמשחק התחיל (+1.2 ש'), טוען לפי דרגת האיכות, מעלה לכרטיס טקסטורה אחת לפריים,
 * ורק כשקבוצה שלמה מוכנה – מחליף. כשל טעינה = נשאר הישן. ?hd=0 מכבה (המארח). dispose מחזיר הכול ומשחרר זיכרון.
 *
 * מה משתנה (בלי לגעת ב-js/world.js):
 *  · כביש (W.MAT.road): חומר Lambert חדש עם שיידר משלו – אספלט 4 מ' במיפוי עולם (לא נמתח לפי רוחב הכביש), שכבת מאקרו 64 מ'
 *    (בהירות, טלאי זפת, קווי איטום סדקים) נגד חזרתיות, נורמל + חספוס, פסי בלאי בגלגלים; סימוני כביש אנליטיים (חדים בכל מרחק,
 *    0 זיכרון): קו מרכז מקווקו / כפול, קווי שוליים ונתיבים לפי רוחב הכביש – **משוער** (אין שכבת סימונים בנתונים).
 *  · מדרכה (W.MAT.walk): אבנים משתלבות אפורות/אדמדמות או מרצפות בטון לפי רחוב (משוער, דטרמיניסטי), אבן שפה צבועה אדום-לבן
 *    או אפורה בשפת הכביש, אבן גן בשוליים. כיוון הריצוף לאורך הרחוב.
 *  · פנסי רחוב: אור אמיתי בשיידר (K הפנסים הקרובים, Lambert + ברק GGX עמום עם חספוס מהמפה – בלי "פלסטיק") על כביש/מדרכה/קרקע;
 *    כתמי האור השטוחים של atmo-lite דועכים ליד המצלמה (נשארים רחוק). מיקומי הפנסים = אותם של atmo-lite / procgen.
 *  · קרקע (W.MAT.terrain + עותקי הצמחייה): פרטי דשא/עשב יבש/חול לפי הגוון, ליד המצלמה; אור פנסים.
 *  · חזיתות (תוסף הבניינים, YZMAT 'buildings.facade'): טיח, חיפוי אבן וגג – אותו ממשק uniforms, רזולוציה גבוהה יותר.
 * תכונת קודקוד חדשה aEsh (2 בתים לקודקוד) על רשתות הכביש: רוחב (דצ"מ) וזרע לרחוב – לחישוב סימונים ואבני שפה.
 * פרמטרים בזמן ריצה: window.YZHd.params (עוצמת פנס, צבע, טווח, ברק, נורמל…). מדדים: window.YZHd.stats().
 */
(function () {
  'use strict';
  const BASE = 'assets/tex-hd/';
  const H = window.YZHd = window.YZHd || {};
  const P = H.params = Object.assign({
    lampI: 380,              // עוצמת פנס (יחידות three; מכויל מול תמונת הלילה 097: אספלט מואר ~(186,162,134))
    lampR: 42,               // טווח השפעה (מ')
    lampC: [1.0, 0.76, 0.54],// לד לבן-חם כפי שמצלמת הרדמי רואה אותו ב-097 (ליניארי)
    lampH: 8,                // גובה ראש הפנס אם אין גובה במקור (מ')
    specK: 1.0,              // עוצמת הברק מהפנסים
    emisK: 0.35,             // "אור עירוני" של atmo-lite (הארה עצמית) – כאן מוכפל בטקסטורה במקום צבע שטוח
    nrmK: 1.0,               // עוצמת מפת הנורמל
    groundK: 0.85,           // עוצמת פרטי הקרקע
    poolNear: null,          // כתמי האור של atmo-lite: שקופים ליד המצלמה ומלאים רחוק (null = לפי הדרגה: בינונית 30→70 מ', גבוהה 50→100)
    roadK: [1, 1, 1], walkK: [1, 1, 1],   // מכפילי כיול (ליניארי) – אחרי הכיול מול התמונות
    paint: [0.62, 0.62, 0.60],            // צבע סימון לבן שחוק (ליניארי)
    cone: [0.42, 0.78],      // פיזור הפנס: cos הזווית מהאנך – 0 מתחת ל-0.42 (‎65°), מלא מעל 0.78 (‎39°)
    ambNight: 0.30,          // בלילה: האור העקיף (חצי-כדור של atmo-lite) על הכביש/מדרכה/קרקע ×0.30 – כדי שהפנסים ייצרו כתמים כמו בתמונה 097 (מכויל)
    lamps: true, groundPatch: true, k: null,   // מתגי מדידה: אור פנסים בשיידר, תוספת לקרקע, מספר פנסים (null = לפי הדרגה)
  }, H.params || {});
  const T = { low: 0, medium: 1, high: 2 };
  // רזולוציה לכל דרגה (קבצים ב-assets/tex-hd/<res>/): גבוהה = 2K לאספלט (הכי נראה), בינונית (רדמי) = 1K, חסכונית = 512
  const TIERS = {
    low: { k: 0, aniso: 2, nrm: 1, ground: false, facade: false, pool: [0, 0],
      f: { asphC: '512/asphalt_c.jpg', asphN: '512/asphalt_n.jpg', mac: 'macro/asphalt_m_256.jpg', pavG: '512/pavers_c.jpg', pavR: '512/pavers_c_red.jpg', pavN: '512/pavers_n.jpg',
        conC: '512/concrete_c.jpg', conN: '512/concrete_n.jpg', curbRW: '512/curb_c.jpg', curbG: '512/curb_c_gray.jpg', curbN: '512/curb_n.jpg' } },
    medium: { k: 4, aniso: 4, nrm: 1, ground: true, facade: true, pool: [30, 70],
      f: { asphC: '1024/asphalt_c.jpg', asphN: '1024/asphalt_n.jpg', mac: 'macro/asphalt_m_512.jpg', pavG: '1024/pavers_c.jpg', pavR: '1024/pavers_c_red.jpg', pavN: '1024/pavers_n.jpg',
        conC: '512/concrete_c.jpg', conN: '512/concrete_n.jpg', curbRW: '1024/curb_c.jpg', curbG: '1024/curb_c_gray.jpg', curbN: '1024/curb_n.jpg',
        ground: '512/ground_d.jpg', plaster: '512/plaster_c.jpg', stone: '512/stone_c.jpg', roof: '512/roof_c.jpg' } },
    high: { k: 8, aniso: 8, nrm: 1, ground: true, facade: true, pool: [50, 100],
      f: { asphC: '2048/asphalt_c.jpg', asphN: '2048/asphalt_n.jpg', mac: 'macro/asphalt_m_1024.jpg', pavG: '1024/pavers_c.jpg', pavR: '1024/pavers_c_red.jpg', pavN: '1024/pavers_n.jpg',
        conC: '1024/concrete_c.jpg', conN: '1024/concrete_n.jpg', curbRW: '1024/curb_c.jpg', curbG: '1024/curb_c_gray.jpg', curbN: '1024/curb_n.jpg',
        ground: '1024/ground_d.jpg', plaster: '1024/plaster_c.jpg', stone: '1024/stone_c.jpg', roof: '1024/roof_c.jpg' } },
  };
  const GROUPS = { street: ['asphC', 'asphN', 'mac', 'pavG', 'pavR', 'pavN', 'conC', 'conN', 'curbRW', 'curbG', 'curbN'], ground: ['ground'], facade: ['plaster', 'stone', 'roof'] };
  const COLOR = new Set(['asphC', 'pavG', 'pavR', 'conC', 'curbRW', 'curbG', 'plaster', 'stone', 'roof']);   // sRGB; השאר נתונים ליניאריים
  const RAW = new Set(['plaster', 'stone', 'roof']);   // תוסף הבניינים קורא .g גולמי (כמו הטקסטורות המקוריות שלו, בלי המרת צבע)

  const S = { world: null, api: null, tier: null, want: null, gen: 0, tex: {}, pend: [], groups: {}, orig: null, mat: {}, patched: new Set(), fac: null,
    pool: null, beautySaved: null, scanT: 0, lampT: 0, startAt: 0, started: false, qT: 0, errors: [], timings: {}, lampsUsed: 0 };
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

  // ------------------------------------------------------------------ uniforms משותפים (עדכון אחד לכל החומרים)
  const KMAX = 12;
  const SH = {
    uEshOrigin: { value: new THREE.Vector2() },
    uEshLampP: { value: Array.from({ length: KMAX }, () => new THREE.Vector3()) },
    uEshLampN: { value: 0 }, uEshLampC: { value: new THREE.Color(1, 1, 1) }, uEshLampI: { value: 0 }, uEshLampR: { value: 42 },
    uEshSpecK: { value: 1 }, uEshEmisK: { value: 0.35 }, uEshNrmK: { value: 1 }, uEshAmbK: { value: 1 }, uEshCone: { value: new THREE.Vector2(0.42, 0.78) },
  };

  // ------------------------------------------------------------------ GLSL
  const V_HEAD = `
attribute vec2 aEsh;
uniform vec2 uEshOrigin;
varying vec3 vEshW; varying vec2 vEshP; varying vec2 vEshUv; varying vec2 vEshA;`;
  const V_BODY = `
{ vec4 eshWP = modelMatrix * vec4(transformed, 1.0); vEshW = eshWP.xyz; vEshP = vec2(eshWP.x, -eshWP.z) - uEshOrigin; vEshUv = uv; vEshA = vec2(aEsh.x * 0.1, aEsh.y / 255.0); }`;
  const F_COMMON = `
uniform vec3 uEshLampP[ESH_KMAX1]; uniform int uEshLampN; uniform vec3 uEshLampC; uniform float uEshLampI, uEshLampR, uEshSpecK, uEshEmisK, uEshNrmK, uEshAmbK; uniform vec2 uEshCone;
varying vec3 vEshW; varying vec2 vEshP; varying vec2 vEshUv; varying vec2 vEshA;
float eshRough = 0.9;
float eshLine(float x, float c, float hw) { float aa = fwidth(x) * 0.8 + 1e-4; return 1.0 - smoothstep(-aa, aa, abs(x - c) - hw); }
float eshDash(float s, float period, float len) { float aa = fwidth(s) * 0.8 + 1e-4; float q = mod(s, period) - len * 0.5; q -= period * floor(q / period + 0.5); return 1.0 - smoothstep(-aa, aa, abs(q) - len * 0.5); }
mat3 eshTBN(vec3 eye_pos, vec3 surf_norm, vec2 uv) {   // כמו getTangentFrame של three (נגזרות מסך) – לכל מיפוי UV
  vec3 q0 = dFdx(eye_pos.xyz), q1 = dFdy(eye_pos.xyz); vec2 st0 = dFdx(uv.st), st1 = dFdy(uv.st); vec3 N = surf_norm;
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0); vec3 Tt = q1perp * st0.x + q0perp * st1.x, Bt = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(Tt, Tt), dot(Bt, Bt)); float sc = (det == 0.0) ? 0.0 : inversesqrt(det); return mat3(Tt * sc, Bt * sc, N); }`;
  // פנסים: K הקרובים, Lambert + GGX עמום (F0=0.04, חספוס מהמפה) – אותו קוד לכביש, מדרכה וקרקע
  const F_LAMPS = `
#if ESH_KMAX > 0
#ifdef ESH_NEAR_ONLY
if (length(vEshW - cameraPosition) < 90.0)
#endif
{
  vec3 eNw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 eV = normalize(cameraPosition - vEshW); float eNV = max(dot(eNw, eV), 1e-3);
  float eA = clamp(eshRough, 0.35, 1.0); eA *= eA; float eA2 = eA * eA; float eK = eA * 0.5;
  vec3 eSpec = vec3(0.0); float eR2 = uEshLampR * uEshLampR;
  for (int i = 0; i < ESH_KMAX; i++) {
    if (i >= uEshLampN) break;
    vec3 Lv = uEshLampP[i] - vEshW; float d2 = dot(Lv, Lv);
    if (d2 > eR2) continue;
    float win = 1.0 - d2 / eR2; win *= win;
    float E = uEshLampI * win / (d2 + 1.0);
    vec3 L = Lv * inversesqrt(d2); float nl = max(dot(eNw, L), 0.0);
    E *= smoothstep(uEshCone.x, uEshCone.y, L.y);   // פנס רחוב מכוון מטה (חיתוך ~70° מהאנך) – כתמי אור כמו בתמונה 097
    reflectedLight.directDiffuse += uEshLampC * (E * nl) * BRDF_Lambert(material.diffuseColor);
#ifdef ESH_SPEC
    vec3 Hh = normalize(L + eV); float nh = max(dot(eNw, Hh), 0.0), vh = max(dot(eV, Hh), 0.0);
    float dd = nh * nh * (eA2 - 1.0) + 1.0; float D = eA2 / (PI * dd * dd);
    float F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
    eSpec += uEshLampC * (E * nl * D * F * 0.25 / ((nl * (1.0 - eK) + eK) * (eNV * (1.0 - eK) + eK)));
#endif
  }
  totalEmissiveRadiance += eSpec * uEshSpecK;
}
#endif`;
  // ---- כביש
  const F_ROAD_HEAD = `
uniform sampler2D uEshAlb, uEshNrm, uEshMac; uniform float uEshTile, uEshMacTile; uniform vec3 uEshPaint, uEshK;
float eshPaint = 0.0, eshTar = 0.0, eshSeal = 0.0, eshTrack = 0.0;`;
  const F_ROAD_MAP = `
vec2 eshUvA = vEshP / uEshTile;
vec3 eshAlb = texture2D(uEshAlb, eshUvA).rgb;
{
  vec4 mac = texture2D(uEshMac, vEshP / uEshMacTile);
  eshAlb *= 0.78 + 0.44 * mac.r;
  eshTar = mac.g; eshSeal = mac.b;
  eshAlb = mix(eshAlb, eshAlb * vec3(0.50, 0.50, 0.53), eshTar * 0.85);
  eshAlb = mix(eshAlb, vec3(0.028, 0.028, 0.032), eshSeal * 0.85);
  float w = vEshA.x > 0.5 ? vEshA.x : 7.0, ac = (vEshUv.x - 0.5) * w, al = vEshUv.y * 16.0;
  float nl = w > 9.5 ? 4.0 : (w > 6.0 ? 2.0 : 1.0), lw = w / nl, x = ac + w * 0.5, lc = (floor(x / lw) + 0.5) * lw, dx = abs(x - lc);
  eshTrack = 1.0 - smoothstep(0.12, 0.42, abs(dx - 0.85));
  float drip = 1.0 - smoothstep(0.06, 0.40, dx);
  eshAlb *= (1.0 + 0.07 * eshTrack) * (1.0 - 0.10 * drip * (1.0 - eshTar));
#ifdef ESH_MARK
  if (w > 6.0) {   // סימונים משוערים לפי רוחב: 7 מ' = מרכז מקווקו; 8.5 מ' = + שוליים; 10 מ' = מרכז כפול + נתיבים מקווקווים + שוליים
    float dash = eshDash(al, 9.0, 3.0);
    if (w < 9.5) eshPaint = eshLine(ac, 0.0, 0.06) * dash;
    else eshPaint = max(eshLine(ac, -0.12, 0.05), eshLine(ac, 0.12, 0.05));
    if (w > 8.0) { float e = w * 0.5 - 0.35; eshPaint = max(eshPaint, max(eshLine(ac, -e, 0.05), eshLine(ac, e, 0.05))); }
    if (w > 9.5) { float l = w * 0.25; eshPaint = max(eshPaint, max(eshLine(ac, -l, 0.05), eshLine(ac, l, 0.05)) * dash); }
    eshPaint *= (0.55 + 0.45 * smoothstep(0.05, 0.16, dot(eshAlb, vec3(0.3333)))) * (1.0 - eshSeal);
  }
#endif
}
eshAlb = mix(eshAlb, uEshPaint, clamp(eshPaint, 0.0, 1.0)) * uEshK;
diffuseColor.rgb *= eshAlb;
totalEmissiveRadiance *= eshAlb * uEshEmisK;`;
  const F_ROAD_NRM = `
#ifdef ESH_NRM
{
  vec4 eN = texture2D(uEshNrm, eshUvA);
  vec2 nxy = (eN.xy * 2.0 - 1.0) * uEshNrmK * (1.0 - 0.8 * eshPaint) * (1.0 - 0.6 * eshTar) * (1.0 - 0.8 * eshSeal);
  vec3 mapN = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  vec3 eT = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz, eB = (viewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz;
  eT = normalize(eT - normal * dot(normal, eT)); eB = normalize(eB - normal * dot(normal, eB));
  normal = normalize(eT * mapN.x + eB * mapN.y + normal * mapN.z);
  eshRough = eN.b;
}
#endif
eshRough = mix(eshRough, 0.70, eshTar * 0.7); eshRough = mix(eshRough, 0.62, eshSeal); eshRough = mix(eshRough, 0.6, clamp(eshPaint, 0.0, 1.0)); eshRough -= 0.08 * eshTrack;`;
  // ---- מדרכה + אבן שפה
  const F_WALK_HEAD = `
uniform sampler2D uEshPavG, uEshPavR, uEshPavN, uEshConC, uEshConN, uEshCurbRW, uEshCurbG, uEshCurbN; uniform float uEshTile; uniform vec3 uEshK;
vec4 eshN = vec4(0.5, 0.5, 0.85, 1.0); vec2 eshUvW = vec2(0.0);`;
  const F_WALK_MAP = `
vec3 eshAlb;
{
  float ww = vEshA.x > 0.5 ? vEshA.x : 12.0, ac = abs((vEshUv.x - 0.5) * ww), al = vEshUv.y * 4.0;
  float re = ww * 0.5 - 2.5, cv = (ac - re) / 0.25;      // אבן שפה: 25 ס"מ מקצה הכביש (v=0 בצד הכביש)
  eshUvW = vec2(al, ac - re - 0.25) / uEshTile;          // ריצוף מתחיל באבן השפה, שורות לאורך הרחוב
  vec2 gx = dFdx(eshUvW), gy = dFdy(eshUvW);
  bool mainSt = ww > 13.0; float sv = vEshA.y, sv2 = fract(sv * 7.13 + 0.37);
  float pR = mainSt ? 0.50 : 0.25, pC = mainSt ? 0.10 : 0.20;   // משוער: חלוקת סוגי מדרכה לפי סוג הרחוב (אין נתון)
  if (sv < pR) { eshAlb = textureGrad(uEshPavR, eshUvW, gx, gy).rgb; eshN = textureGrad(uEshPavN, eshUvW, gx, gy); }
  else if (sv < pR + pC) { eshAlb = textureGrad(uEshConC, eshUvW, gx, gy).rgb; eshN = textureGrad(uEshConN, eshUvW, gx, gy); }
  else { eshAlb = textureGrad(uEshPavG, eshUvW, gx, gy).rgb; eshN = textureGrad(uEshPavN, eshUvW, gx, gy); }
  if (cv < 1.0) {
    vec2 cuv = vec2(al * 0.5, clamp(cv, 0.0, 1.0)), cgx = vec2(gx.x, gx.y * 8.0) * (uEshTile * 0.5), cgy = vec2(gy.x, gy.y * 8.0) * (uEshTile * 0.5);
    bool rw = sv2 < (mainSt ? 0.70 : 0.20);              // משוער: אבן שפה אדום-לבן (בעיקר ברחובות ראשיים)
    eshAlb = rw ? textureGrad(uEshCurbRW, cuv, cgx, cgy).rgb : textureGrad(uEshCurbG, cuv, cgx, cgy).rgb;
    eshN = textureGrad(uEshCurbN, cuv, cgx, cgy);
  }
  float outer = smoothstep(ww * 0.5 - 0.15, ww * 0.5 - 0.12, ac);   // אבן גן בשולי המדרכה
  eshAlb = mix(eshAlb, vec3(0.20, 0.195, 0.185), outer);
  eshN = mix(eshN, vec4(0.5, 0.5, 0.85, 1.0), outer * 0.6);
}
eshAlb *= uEshK;
diffuseColor.rgb *= eshAlb;
totalEmissiveRadiance *= eshAlb * uEshEmisK;`;
  const F_WALK_NRM = `
#ifdef ESH_NRM
{
  vec2 nxy = (eshN.xy * 2.0 - 1.0) * uEshNrmK; vec3 mapN = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  normal = normalize(eshTBN(-vViewPosition, normal, eshUvW) * mapN);
}
#endif
eshRough = eshN.b;`;
  // ---- קרקע (תוספת לחומר קיים: MAT.terrain ועותקי הצמחייה)
  const G_V_HEAD = `
uniform vec2 uEshOrigin;
varying vec3 vEshW; varying vec2 vEshP;`;
  const G_V_BODY = `
{ vec4 eshWP = modelMatrix * vec4(transformed, 1.0); vEshW = eshWP.xyz; vEshP = vec2(eshWP.x, -eshWP.z) - uEshOrigin; }`;
  const G_F_HEAD = `
uniform vec3 uEshLampP[ESH_KMAX1]; uniform int uEshLampN; uniform vec3 uEshLampC; uniform float uEshLampI, uEshLampR, uEshSpecK, uEshEmisK, uEshGroundK, uEshAmbK; uniform vec2 uEshCone;
uniform sampler2D uEshGround;
varying vec3 vEshW; varying vec2 vEshP;
float eshRough = 0.95;`;
  const G_F_DETAIL = `
#ifdef ESH_GROUND
{ float fade = 1.0 - smoothstep(28.0, 75.0, length(vEshW - cameraPosition));
  if (fade > 0.001) {
    vec3 dt = texture2D(uEshGround, vEshP * 0.5).rgb; vec3 c = diffuseColor.rgb; float s = c.r + c.g + c.b + 1e-4;
    float gr = (c.g - c.r) / s, ye = (c.r - c.b) / s;                       // ירקות וצהבהבות של הצבע הקיים (צבעי הקודקוד/הצמחייה)
    float wg = smoothstep(0.01, 0.06, gr);                                     // ירוק → דשא
    float wsd = smoothstep(0.07, 0.095, ye) * (1.0 - wg);                      // צהבהב-בהיר (חוף, חולות) → חול
    float wd = max(0.0, 1.0 - wg - wsd);                                       // אפרפר (עירוני, יבש) → עשב יבש / עפר
    float det = dt.r * wg + dt.b * wsd + dt.g * wd;
    diffuseColor.rgb *= mix(1.0, det * 2.0, fade * uEshGroundK);
  } }
#endif`;

  // ------------------------------------------------------------------ בניית שיידרים (עם בדיקה שכל החלפה הצליחה)
  function rep(src, a, b, miss, tag) { if (src.indexOf(a) < 0) { miss.push(tag); return src; } return src.replace(a, b); }
  function streetShader(sh, kind, miss) {
    const head = kind === 'road' ? F_ROAD_HEAD : F_WALK_HEAD, map = kind === 'road' ? F_ROAD_MAP : F_WALK_MAP, nrm = kind === 'road' ? F_ROAD_NRM : F_WALK_NRM;
    sh.vertexShader = rep(sh.vertexShader, '#include <common>', '#include <common>' + V_HEAD, miss, 'v-common');
    sh.vertexShader = rep(sh.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>' + V_BODY, miss, 'v-begin');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <common>', '#include <common>' + F_COMMON + head, miss, 'f-common');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <map_fragment>', map, miss, 'f-map');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <normal_fragment_maps>', nrm, miss, 'f-nrm');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <lights_fragment_begin>', '#include <lights_fragment_begin>' + F_LAMPS, miss, 'f-lamps');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= uEshAmbK;', miss, 'f-amb');
    return sh;
  }
  function groundShader(sh, miss) {
    sh.vertexShader = rep(sh.vertexShader, '#include <common>', '#include <common>' + G_V_HEAD, miss, 'gv-common');
    sh.vertexShader = rep(sh.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>' + G_V_BODY, miss, 'gv-begin');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <common>', '#include <common>' + G_F_HEAD, miss, 'gf-common');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <alphamap_fragment>', G_F_DETAIL + '\n#include <alphamap_fragment>', miss, 'gf-detail');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <lights_fragment_begin>', '#include <lights_fragment_begin>' + F_LAMPS, miss, 'gf-lamps');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= uEshAmbK;', miss, 'gf-amb');
    return sh;
  }
  function selfTest() {   // ההחלפות נבדקות על תבנית Lambert של three לפני שמשנים משהו בעולם
    const miss = [], L = THREE.ShaderLib.lambert;
    streetShader({ vertexShader: L.vertexShader, fragmentShader: L.fragmentShader }, 'road', miss);
    streetShader({ vertexShader: L.vertexShader, fragmentShader: L.fragmentShader }, 'walk', miss);
    groundShader({ vertexShader: L.vertexShader, fragmentShader: L.fragmentShader }, miss);
    return miss;
  }

  // ------------------------------------------------------------------ חומרים
  function defs(tc, extra) { const d = Object.assign({ ESH_KMAX: tc.k, ESH_KMAX1: Math.max(1, tc.k) }, extra || {}); if (tc.nrm) d.ESH_NRM = 1; return d; }
  function streetMat(kind, orig, tc) {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: orig.polygonOffset, polygonOffsetFactor: orig.polygonOffsetFactor, polygonOffsetUnits: orig.polygonOffsetUnits });
    m.name = 'yz-hd-' + kind; m.defines = defs(tc, kind === 'road' ? { ESH_MARK: 1, ESH_SPEC: 1 } : (tc.k >= 8 ? { ESH_SPEC: 1 } : {}));
    const t = S.tex;
    const U = kind === 'road'
      ? { uEshAlb: { value: t.asphC }, uEshNrm: { value: t.asphN }, uEshMac: { value: t.mac }, uEshTile: { value: 4.0 }, uEshMacTile: { value: 64.0 },
        uEshPaint: { value: new THREE.Vector3(...P.paint) }, uEshK: { value: new THREE.Vector3(...P.roadK) } }
      : { uEshPavG: { value: t.pavG }, uEshPavR: { value: t.pavR }, uEshPavN: { value: t.pavN }, uEshConC: { value: t.conC }, uEshConN: { value: t.conN },
        uEshCurbRW: { value: t.curbRW }, uEshCurbG: { value: t.curbG }, uEshCurbN: { value: t.curbN }, uEshTile: { value: 2.0 }, uEshK: { value: new THREE.Vector3(...P.walkK) } };
    Object.assign(U, SH); m.userData.uniforms = U; m.userData.yzHdKind = kind;
    m.onBeforeCompile = sh => { Object.assign(sh.uniforms, U); const miss = []; streetShader(sh, kind, miss); if (miss.length) console.warn('[hd] shader', kind, miss); };
    m.customProgramCacheKey = () => 'yz-hd-' + kind + '-v1';
    return m;
  }
  const GU = { uEshGround: { value: null }, uEshGroundK: { value: 0.85 } };
  function patchGround(mat, tc) {   // עוטף חומר קיים (MAT.terrain או עותק של הצמחייה) – בלי להחליף אותו
    if (!P.groundPatch) return;
    if (!mat || !mat.isMeshLambertMaterial || (mat.userData.yzHd && mat.userData.yzHd.k === tc.k && mat.userData.yzHd.g === !!S.tex.ground)) return;
    if (mat.userData.yzHd) unpatchGround(mat);
    const own = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile'), prev = mat.onBeforeCompile, ownK = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey'), prevK = mat.customProgramCacheKey;
    const prevDefs = mat.defines ? Object.assign({}, mat.defines) : null;
    mat.userData.yzHd = { own, prev, ownK, prevK, prevDefs, k: tc.k, g: !!S.tex.ground };
    mat.defines = Object.assign({}, mat.defines || {}, defs({ k: tc.k, nrm: 0 }, Object.assign({ ESH_NEAR_ONLY: 1 }, S.tex.ground && tc.ground ? { ESH_GROUND: 1 } : {})));
    mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); Object.assign(sh.uniforms, SH, GU); const miss = []; groundShader(sh, miss); if (miss.length) console.warn('[hd] ground shader', miss); };
    mat.customProgramCacheKey = function () { return (prevK ? prevK.call(this) : '') + '|yz-hd-ground-v1'; };
    mat.needsUpdate = true; S.patched.add(mat);
  }
  function unpatchGround(mat) {
    const u = mat.userData.yzHd; if (!u) return;
    if (u.own) mat.onBeforeCompile = u.prev; else delete mat.onBeforeCompile;
    if (u.ownK) mat.customProgramCacheKey = u.prevK; else delete mat.customProgramCacheKey;
    mat.defines = u.prevDefs || undefined; if (!mat.defines) delete mat.defines;
    delete mat.userData.yzHd; mat.needsUpdate = true; S.patched.delete(mat);
  }
  // כתמי האור של atmo-lite: שקופים ליד המצלמה (שם יש אור אמיתי בשיידר), מלאים רחוק
  const PU = { uEshPoolNear: { value: new THREE.Vector2(55, 110) } };
  function patchPools() {
    const A = window.YZAtmoLite, m = A && A.pools && A.pools.material; if (!m || m.userData.yzHd) return;
    const own = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile'), prev = m.onBeforeCompile;
    m.userData.yzHd = { own, prev };
    m.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); Object.assign(sh.uniforms, PU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vEshD;').replace('#include <project_vertex>', '#include <project_vertex>\nvEshD = -mvPosition.z;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEshD; uniform vec2 uEshPoolNear;').replace('#include <opaque_fragment>', 'diffuseColor.a *= smoothstep(uEshPoolNear.x, uEshPoolNear.y, vEshD);\n#include <opaque_fragment>'); };
    m.customProgramCacheKey = () => 'yz-hd-pool-v1'; m.needsUpdate = true; S.pool = m;
  }
  function unpatchPools() { const m = S.pool; if (!m) return; const u = m.userData.yzHd; if (u) { if (u.own) m.onBeforeCompile = u.prev; else delete m.onBeforeCompile; delete m.customProgramCacheKey; delete m.userData.yzHd; m.needsUpdate = true; } S.pool = null; }

  // ------------------------------------------------------------------ תכונת aEsh על רשתות הכביש (רוחב בדצ"מ + זרע לרחוב)
  function seedOf(x, z) { let h = 2166136261; const s = Math.round(x * 2) + ',' + Math.round(z * 2); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 251; }
  function tagGeo(g) {
    if (!g || g.attributes.aEsh || !g.attributes.position || !g.attributes.uv) return;
    const Pp = g.attributes.position.array, Uv = g.attributes.uv.array, n = Pp.length / 3, a = new Uint8Array(n * 2);
    let seed = 0;
    for (let q = 0; q + 5 < n; q += 6) {   // סדר הקודקודים של ribbon(): L_a, R_b, R_a, L_a, L_b, R_b
      const w = Math.hypot(Pp[q * 3] - Pp[(q + 2) * 3], Pp[q * 3 + 2] - Pp[(q + 2) * 3 + 2]);
      if (Uv[q * 2 + 1] === 0) seed = seedOf(Pp[q * 3], Pp[q * 3 + 2]);
      const wd = Math.min(255, Math.round(w * 10));
      for (let k = 0; k < 6; k++) { a[(q + k) * 2] = wd; a[(q + k) * 2 + 1] = seed; }
    }
    g.setAttribute('aEsh', new THREE.BufferAttribute(a, 2));
  }
  function eachRoadMesh(t, fn) { const g = t && t.roadGrp; if (!g) return; for (const m of g.children) if (m.isMesh) fn(m); }

  // ------------------------------------------------------------------ טעינה
  function loader() {
    if (THREE.ImageBitmapLoader && typeof createImageBitmap === 'function') { const l = new THREE.ImageBitmapLoader(); l.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); return { l, bmp: true }; }
    return { l: new THREE.ImageLoader(), bmp: false };
  }
  function loadTex(key, file, tc, gen) {
    return new Promise((ok, no) => {
      const { l, bmp } = loader(); const t0 = performance.now();
      const to = setTimeout(() => no(new Error('timeout ' + file)), 45000);
      l.load(BASE + file, img => { clearTimeout(to); if (gen !== S.gen) { if (bmp && img.close) img.close(); return no(new Error('stale')); }
        const t = new THREE.Texture(img); t.flipY = !bmp; t.wrapS = THREE.RepeatWrapping; t.wrapT = key.startsWith('curb') ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        t.colorSpace = COLOR.has(key) && !RAW.has(key) ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = Math.min(tc.aniso, maxAniso()); t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.name = 'yz-hd:' + file; t.needsUpdate = true;
        t.userData.px = [img.width, img.height]; S.timings[file] = Math.round(performance.now() - t0); ok(t); }, undefined, e => { clearTimeout(to); no(new Error('load ' + file)); });
    });
  }
  function maxAniso() { try { return S.world.renderer.capabilities.getMaxAnisotropy(); } catch (e) { return 1; } }
  async function loadTier(tier) {
    const tc = TIERS[tier], gen = ++S.gen; S.want = tier; const out = {}, res = {};
    if (S.pend) { for (const it of S.pend) it.t.dispose(); S.pend = null; }   // העלאה ישנה שלא הסתיימה
    const jobs = Object.entries(GROUPS).map(async ([g, keys]) => {
      if ((g === 'ground' && !tc.ground) || (g === 'facade' && !tc.facade)) { res[g] = 'skip'; return; }
      try { const ts = await Promise.all(keys.map(k => loadTex(k, tc.f[k], tc, gen))); keys.forEach((k, i) => { out[k] = ts[i]; }); res[g] = 'ok'; }
      catch (e) { res[g] = 'failed'; S.errors.push(g + ': ' + e.message); keys.forEach(k => { if (out[k]) { out[k].dispose(); delete out[k]; } }); }
    });
    await Promise.all(jobs);
    if (gen !== S.gen) { for (const t of Object.values(out)) t.dispose(); return; }
    // העלאה לכרטיס: טקסטורה אחת לפריים (בלי קפיצה בפריים אחד)
    S.tmp = out; S.pend = Object.entries(out).map(([k, t]) => ({ k, t })); S.pendRes = res; S.pendTier = tier; S.pendGen = gen;
    if (!S.pend.length) { applyTier(tier, res, gen); S.pend = null; }
  }
  function uploadStep() {
    if (!S.pend || !S.pend.length) return false;
    if (S.pendGen !== S.gen) { for (const it of S.pend) it.t.dispose(); S.pend = null; return false; }
    const it = S.pend.shift(); try { S.world.renderer.initTexture(it.t); } catch (e) { /* יועלה בציור */ }
    if (!S.pend.length) { applyTier(S.pendTier, S.pendRes, S.pendGen); S.pend = null; }
    return true;
  }

  // ------------------------------------------------------------------ החלה / החזרה
  function applyTier(tier, res, gen) {
    if (gen !== S.gen) return;
    const W = S.world.data.W, tc = TIERS[tier], old = S.tex, oldMat = Object.assign({}, S.mat);
    const nt = {}; for (const k of Object.keys(old)) nt[k] = old[k];
    // קבוצה שנכשלה: נשאר מה שהיה (גם אם זו הדרגה הקודמת); קבוצה שהצליחה: מחליפה
    for (const [g, keys] of Object.entries(GROUPS)) if (res[g] === 'ok') for (const k of keys) nt[k] = S.tmp[k];
    if (!tc.ground) delete nt.ground; if (!tc.facade) { facadeRestore(); delete nt.plaster; delete nt.stone; delete nt.roof; }   // דרגה בלי חזיתות: מחזירים לתוסף את שלו לפני השחרור
    S.tex = nt; S.tier = tier;
    if (res.street === 'ok' || (S.mat.road && S.tex.asphC)) {
      if (!S.orig) S.orig = { road: W.MAT.road, walk: W.MAT.walk };
      const road = streetMat('road', S.orig.road, tc), walk = streetMat('walk', S.orig.walk, tc);
      S.mat = { road, walk };
      for (const t of W.tiles.values()) eachRoadMesh(t, m => { tagGeo(m.geometry); if (m.material === S.orig.road || m.material === oldMat.road) m.material = road; else if (m.material === S.orig.walk || m.material === oldMat.walk) m.material = walk; });
      W.MAT.road = road; W.MAT.walk = walk;
      if (oldMat.road) oldMat.road.dispose(); if (oldMat.walk) oldMat.walk.dispose();
      beautyNeutral(true); if (tc.k > 0) patchPools(); else unpatchPools();
      S.groups.street = 'on';
    } else if (res.street === 'failed') S.groups.street = S.mat.road ? 'on (קודם)' : 'failed';
    GU.uEshGround.value = S.tex.ground || null; GU.uEshGroundK.value = P.groundK;
    S.groups.ground = res.ground === 'ok' ? 'on' : res.ground;
    if (S.mat.road && (tc.k > 0 || (tc.ground && S.tex.ground))) { patchGround(W.MAT.terrain, tc); scanGround(tc); } else for (const m of [...S.patched]) unpatchGround(m);
    if (res.facade === 'ok') { S.groups.facade = facadeApply() ? 'on' : 'waiting'; } else S.groups.facade = res.facade;
    // שחרור טקסטורות ישנות שהוחלפו
    for (const k of Object.keys(old)) if (old[k] && old[k] !== S.tex[k]) old[k].dispose();
    S.tmp = null;
    H.applied = { tier, at: Math.round(performance.now()), res };
    if (S.api) S.api.emit('hd', { tier, res });
  }
  function scanGround(tc) { const W = S.world.data.W; for (const t of W.tiles.values()) if (t.terrain && t.terrain.material) patchGround(t.terrain.material, tc || TIERS[S.tier]); }
  function facadeApply() {
    const m = window.YZMAT && YZMAT.get('buildings.facade'), U = m && m.userData && m.userData.uniforms;
    if (!U || !U.uTexP || !S.tex.plaster) return false;
    if (S.fac && S.fac.U === U && U.uTexP.value === S.tex.plaster) return true;
    if (!S.fac || S.fac.U !== U) S.fac = { U, P: U.uTexP.value, S: U.uTexS.value, R: U.uTexR.value, has: U.uHasTex.value };
    U.uTexP.value = S.tex.plaster; U.uTexS.value = S.tex.stone; U.uTexR.value = S.tex.roof; U.uHasTex.value = 1; return true;
  }
  function facadeRestore() { const f = S.fac; if (!f) return; f.U.uTexP.value = f.P; f.U.uTexS.value = f.S; f.U.uTexR.value = f.R; f.U.uHasTex.value = f.has; S.fac = null; }
  function beautyNeutral(on) {   // מכפילי היום של 61-beauty נועדו לטקסטורות הישנות (אספלט כהה, מדרכה בהירה) – עם הכיול החדש הם 1
    const B = window.YZBeauty; if (!B || !B.day) return;
    if (on && !S.beautySaved) { S.beautySaved = { road: B.day.road, walk: B.day.walk }; B.day.road = [1, 1, 1]; B.day.walk = [1, 1, 1]; }
    if (!on && S.beautySaved) { B.day.road = S.beautySaved.road; B.day.walk = S.beautySaved.walk; S.beautySaved = null; }
  }
  function restoreAll() {
    const W = S.world && S.world.data && S.world.data.W; if (!W) return;
    if (S.orig) { for (const t of W.tiles.values()) eachRoadMesh(t, m => { if (m.material === S.mat.road) m.material = S.orig.road; else if (m.material === S.mat.walk) m.material = S.orig.walk; if (m.geometry && m.geometry.attributes.aEsh) m.geometry.deleteAttribute('aEsh'); });
      W.MAT.road = S.orig.road; W.MAT.walk = S.orig.walk; }
    for (const m of [...S.patched]) unpatchGround(m);
    unpatchPools(); facadeRestore(); beautyNeutral(false);
    if (S.mat.road) S.mat.road.dispose(); if (S.mat.walk) S.mat.walk.dispose(); S.mat = {};
    for (const t of Object.values(S.tex)) if (t) t.dispose(); S.tex = {}; S.tier = null; S.groups = {};
    if (S.pend) for (const it of S.pend) it.t.dispose(); S.pend = null; S.gen++;
  }

  // ------------------------------------------------------------------ פנסים: K הקרובים לנקודה שלפני המצלמה
  // בחירה בסריקה אחת עם רשימה קצרה ממוינת (בלי מיון של כל הפנסים ובלי הקצאות – חשוב למעבד של טלפון)
  const _f = new THREE.Vector3(), BD = new Float64Array(KMAX), BX = new Float64Array(KMAX), BY = new Float64Array(KMAX), BZ = new Float64Array(KMAX);
  let nB = 0, atmoOnT = 0, atmoOn = false;
  function keep(K, d, x, y, z) {
    if (nB === K && d >= BD[K - 1]) return;
    let i = nB < K ? nB++ : K - 1;
    while (i > 0 && BD[i - 1] > d) { BD[i] = BD[i - 1]; BX[i] = BX[i - 1]; BY[i] = BY[i - 1]; BZ[i] = BZ[i - 1]; i--; }
    BD[i] = d; BX[i] = x; BY[i] = y; BZ[i] = z;
  }
  function nightK(world) {
    const A = window.YZAtmoLite, now = performance.now();
    if (now > atmoOnT) { atmoOnT = now + 2000; atmoOn = YZW.plugins().some(p => p.id === 'atmo-lite' && p.state === 'on'); }
    if (A && typeof A.night === 'number' && atmoOn) return A.night; return clamp((2 - world.sun.elevation) / 8, 0, 1);
  }
  function updateLamps(world, K) {
    const night = nightK(world); SH.uEshLampI.value = P.lampI * night;
    SH.uEshLampR.value = P.lampR; SH.uEshLampC.value.setRGB(P.lampC[0], P.lampC[1], P.lampC[2]);
    if (P.k != null) K = Math.min(K, P.k);
    SH.uEshAmbK.value = K > 0 && P.lamps ? 1 - night * (1 - P.ambNight) : 1;   // בלי פנסים בשיידר (חסכונית) – האיזון הישן נשאר
    if (night < 0.02 || !K || !P.lamps) { SH.uEshLampN.value = 0; S.lampsUsed = 0; return; }
    const cam = world.camera.position; world.camera.getWorldDirection(_f); _f.y = 0; if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1); _f.normalize();
    const px = cam.x + _f.x * 22, pz = cam.z + _f.z * 22, fx = _f.x, fz = _f.z; nB = 0;
    const A = window.YZAtmoLite;
    if (A && A.lamps && A.cnt > 0 && A.lamps.visible !== false) { const p = A.lamps.geometry.attributes.position.array;
      for (let i = 0; i < A.cnt; i++) { const x = p[i * 3], z = p[i * 3 + 2]; let d = (x - px) * (x - px) + (z - pz) * (z - pz); if ((x - cam.x) * fx + (z - cam.z) * fz < -12) d *= 4; keep(K, d, x, p[i * 3 + 1], z); } }
    else if (world.providers.lamps && world.providers.lamps.length) { for (const l of world.providers.lamps) { let d = (l.x - px) * (l.x - px) + (l.z - pz) * (l.z - pz); if ((l.x - cam.x) * fx + (l.z - cam.z) * fz < -12) d *= 4;
      if (nB === K && d >= BD[K - 1]) continue; keep(K, d, l.x, (l.y != null ? l.y : Math.max(0, world.data.H(l.x, l.z))) + P.lampH, l.z); } }
    for (let i = 0; i < nB; i++) SH.uEshLampP.value[i].set(BX[i], BY[i], BZ[i]);
    SH.uEshLampN.value = nB; S.lampsUsed = nB;
  }

  // ------------------------------------------------------------------ מדדים לדוח
  H.stats = () => {
    let bytes = 0; const list = [];
    for (const [k, t] of Object.entries(S.tex)) { if (!t || !t.userData.px) continue; const [w, h] = t.userData.px; const b = w * h * 4 * 4 / 3; bytes += b; list.push({ k, w, h, mb: +(b / 1048576).toFixed(2) }); }
    return { tier: S.tier, want: S.want, groups: Object.assign({}, S.groups), gpuMB: +(bytes / 1048576).toFixed(1), textures: list, lamps: S.lampsUsed, patchedGround: S.patched.size, errors: S.errors.slice(-5), timings: S.timings, started: S.started };
  };
  H.reload = () => { if (S.world) { S.started = true; loadTier(S.world.quality.tier).then(() => {}); } };

  YZW.register({
    id: 'hd', name: 'חומרים חדים: כביש, סימונים, מדרכות, אבני שפה, קרקע, חזיתות (גדוד טקסטורות)', dept: 'textures', order: 53,
    init(world, api) {
      S.world = world; S.api = api; S.started = false; S.startAt = 0;
      const miss = selfTest(); if (miss.length) throw new Error('תבנית השיידר של three השתנתה: ' + miss.join(','));
      api.eachTile((t, kind) => { if (kind === 'add' && S.mat.road) { eachRoadMesh(t, m => { tagGeo(m.geometry); if (S.orig && m.material === S.orig.road) m.material = S.mat.road; else if (S.orig && m.material === S.orig.walk) m.material = S.mat.walk; }); if (t.terrain && (TIERS[S.tier].k > 0 || S.tex.ground)) patchGround(t.terrain.material, TIERS[S.tier]); } });
      api.on('quality', () => { S.qT = 1.2; });
    },
    update(dt, world) {
      if (!S.started) { if (!world.stats.startMs) return; if (!S.startAt) S.startAt = performance.now() + 1200; if (performance.now() < S.startAt) return;
        S.started = true; S.t0 = performance.now(); loadTier(world.quality.tier).catch(e => S.errors.push(String(e))); return; }
      uploadStep();
      if (S.qT > 0) { S.qT -= dt; if (S.qT <= 0 && world.quality.tier !== S.want) loadTier(world.quality.tier).catch(e => S.errors.push(String(e))); }
      const cam = world.camera.position; SH.uEshOrigin.value.set(Math.round(cam.x / 64) * 64, Math.round(-cam.z / 64) * 64);
      SH.uEshSpecK.value = P.specK; SH.uEshCone.value.set(P.cone[0], P.cone[1]); SH.uEshEmisK.value = P.emisK; SH.uEshNrmK.value = P.nrmK; { const pn = P.poolNear || (S.tier ? TIERS[S.tier].pool : [0, 0]); PU.uEshPoolNear.value.set(pn[0], pn[1]); } GU.uEshGroundK.value = P.groundK;
      if (S.mat.road) { const a = P.roadK, b = P.walkK, c = P.paint; S.mat.road.userData.uniforms.uEshK.value.set(a[0], a[1], a[2]); S.mat.walk.userData.uniforms.uEshK.value.set(b[0], b[1], b[2]); S.mat.road.userData.uniforms.uEshPaint.value.set(c[0], c[1], c[2]); }
      if (!S.tier) return;
      S.lampT -= dt; if (S.lampT <= 0) { S.lampT = 0.25; const c = world.camera.position, L = S.lastL;   // מחשבים מחדש רק אם המצלמה זזה 3 מ' / הסתובבה, או כל 2 ש'
        world.camera.getWorldDirection(_f); const moved = !L || (c.x - L.x) ** 2 + (c.z - L.z) ** 2 > 9 || _f.x * L.fx + _f.z * L.fz < 0.995 || performance.now() - L.t > 2000;
        if (moved) { S.lastL = { x: c.x, z: c.z, fx: _f.x, fz: _f.z, t: performance.now() }; updateLamps(world, TIERS[S.tier].k); } }
      S.scanT -= dt; if (S.scanT <= 0) { S.scanT = 1.5; if (S.mat.road && (TIERS[S.tier].k > 0 || S.tex.ground)) { scanGround(); if (TIERS[S.tier].k > 0) patchPools(); } if (S.groups.facade === 'waiting' || S.groups.facade === 'on') S.groups.facade = facadeApply() ? 'on' : 'waiting'; }
    },
    dispose() { restoreAll(); },
  });
})();
