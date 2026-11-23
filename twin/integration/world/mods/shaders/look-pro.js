/* look-pro.js — מחלקת הרינדור והשיידרים (ESH27): "מראה מקצועי" לעולם התאום של אשדוד.
 * תוסף למארח YZW (integration/host/host.js) — נרשם לבד בסוף הקובץ: YZW.register(LookPro.plugin()).
 *   (רישום ידני: window.LOOKPRO_MANUAL = true לפני הטעינה, ואז YZW.register(LookPro.plugin({order: 33}))).
 *
 * מה יש כאן (הכול נגזר ממקור האמת האחד: world.sun / world.weather / world.clock — אין חישוב שמש משלנו):
 *  1. רנדרר: צינור צבע נכון (sRGB, ACES/AgX, חשיפה לפי גובה השמש עם הסתגלות עין), pixelRatio = min(dpr, תקרת שכבה),
 *     MSAA ×4 על יעד HDR (FXAA כשאין), רזולוציה דינמית.
 *  2. תאורה: שמש פיזיקלית (צבע מעובי האוויר לפי מסת אוויר + אובך), מפת צל אחת מותאמת לפרוסת המבט של המצלמה (PCF רך,
 *     הצמדה לטקסל), סביבה (IBL) מ-PMREM של השמיים הפרוצדורליים, לילה: ירח מהמחלקה, חלונות דולקים בשיידר,
 *     פנסי רחוב כ"מפת אור" עילית אחת (קריאת ציור אחת, לא מאות אורות) + כרטיסי זוהר לראשי הפנסים.
 *  3. שמיים: Preetham (מהמימוש של three r170 שבעולם) → טבלת שמיים 64×32 → כיפה + ערפל + סביבה. אובך אופק, עננים,
 *     זוהר עירוני בלילה, כוכבים/ירח = מחלקת השמיים (לא מוחלפים). ערפל גובה+מרחק בצבע השמיים בכיוון המבט.
 *  4. עיבוד-אחרי (בינונית+): SAO בחצי רזולוציה, זוהר (bloom) רב-שלבי, דירוג צבע (split-tone/רוויה/ניגודיות) לפי
 *     תמונות השטח, וינייטה עדינה. בשכבה חסכונית — כבוי (ציור ישיר).
 *  5. חומרים: שיידר חזית PBR לבניינים (טיח טריפלנרי עם גוון/לכלוך לכל בניין, רשת חלונות בשיידר — תריסים/פתוח/סגור/
 *     דולק, מרפסות בפרלקסה, מזגנים, חנויות בקומת קרקע, מעקה גג), גג שטוח/רעפים, אספלט עם סדקים/טלאים/רטיבות,
 *     אבני שפה (אדום-לבן/כחול-לבן), מרצפות מדרכה, דשא, חול. דטרמיניסטי לכל מזהה בניין.
 *     עקיפות: LookPro.setBuildingStyle(fn) (וילות עם רעפים אדומים וכו'), LookPro.makeRoofTileMaterial() לגגות משופעים.
 *  6. ביצועים: LookPro.bench() מודד מ"ש לכל תכונה (JS + זמן ציור עם gl.finish). כל תכונה ניתנת לכיבוי מהגדרות המודול.
 * מגבלות כנות: ראו README בדו"ח המחלקה. אין CDN, אין נכסים חיצוניים — כל הטקסטורות נוצרות ב-GPU בעלייה.
 */
(function () {
'use strict';
const VERSION = '1.0.0';
const D2R = Math.PI / 180;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const qs = new URLSearchParams(location.search);
const hash32 = s => { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const hash01 = s => { let x = hash32(s) ^ 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const s2l = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const hexLin = h => { const n = parseInt(h.slice(1), 16); return [s2l((n >> 16 & 255) / 255), s2l((n >> 8 & 255) / 255), s2l((n & 255) / 255)]; };

// ------------------------------------------------------------------ שכבות איכות
// pr = תקרת יחס פיקסלים (min עם devicePixelRatio), prMin = רצפת הרזולוציה הדינמית
const TIERS = {
  low:    { pr: 1.0,  prMin: 0.8, post: false, msaa: 0, ao: 0,  bloom: 0, shadow: 0,    sRadius: 0,   pmrem: 0,   lampRes: 128, lampSize: 384, detail: 0, pbr: false },
  medium: { pr: 1.5,  prMin: 1.0, post: true,  msaa: 4, ao: 6,  bloom: 4, shadow: 1024, sRadius: 2.5, pmrem: 64,  lampRes: 256, lampSize: 512, detail: 1, pbr: true },
  high:   { pr: 2.0,  prMin: 1.25, post: true, msaa: 4, ao: 10, bloom: 5, shadow: 2048, sRadius: 3.0, pmrem: 128, lampRes: 512, lampSize: 768, detail: 2, pbr: true },
};
// תפוסת חלונות לפי שעה (מחלקת האווירה, curves.js — מעוגן ב-01:00 = 0.15 מתמונות השטח של אריאל)
const OCC_H = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24];
const OCC_V = [0.30, 0.15, 0.10, 0.07, 0.06, 0.09, 0.22, 0.24, 0.12, 0.08, 0.12, 0.2, 0.36, 0.5, 0.58, 0.6, 0.55, 0.44, 0.30];
function occupancy(h) { h = ((h % 24) + 24) % 24; for (let i = 1; i < OCC_H.length; i++) if (h <= OCC_H[i]) return lerp(OCC_V[i - 1], OCC_V[i], (h - OCC_H[i - 1]) / (OCC_H[i] - OCC_H[i - 1])); return OCC_V[0]; }
// צבעי מקורות אור (ליניארי, מנורמל) — פלטת מחלקת האווירה (גוף שחור → sRGB)
const norm3 = c => { const m = Math.max(c[0], c[1], c[2]) || 1; return [c[0] / m, c[1] / m, c[2] / m]; };
const LAMP_COL = { led4000: norm3(hexLin('#FFD1A3')), led5000: norm3(hexLin('#FFE4CE')), warm3000: norm3(hexLin('#FFB46B')), sodium: norm3(hexLin('#FF8A1F')) };
const MOON_TINT = norm3(hexLin('#9DB4D8'));

// ------------------------------------------------------------------ Preetham (אותה מתמטיקה כמו THREEX.Sky r170 שבעולם)
const TOTAL_RAYLEIGH = [5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5];
const MIE_CONST = [1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14];
function skyParams(sd, turbidity, rayleigh, mieCoef, mieG) {
  const zc = clamp(sd.y, -1, 1);
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(zc)) / 1.5)));
  const sunfade = 1 - clamp(1 - Math.exp(sd.y), 0, 1);
  const rc = rayleigh - (1 - sunfade);
  const c = 0.2 * turbidity * 10E-18;
  return { sunE, sunfade, betaR: TOTAL_RAYLEIGH.map(v => v * rc), betaM: MIE_CONST.map(v => 0.434 * c * v * mieCoef), mieG };
}
function preethamJS(P, d, sd) {   // d, sd: כיוונים מנורמלים. מחזיר [r,g,b] באותו קנה מידה כמו ה-LUT (לפני kSky)
  const za = Math.acos(Math.max(0, d.y));
  const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - za * 180 / Math.PI, -1.253));
  const sR = 8.4E3 * inv, sM = 1.25E3 * inv;
  const ct = d.x * sd.x + d.y * sd.y + d.z * sd.z;
  const rP = 0.05968310365946075 * (1 + Math.pow(ct * 0.5 + 0.5, 2));
  const g2 = P.mieG * P.mieG, mP = 0.07957747154594767 * (1 - g2) / Math.pow(1 - 2 * P.mieG * ct + g2, 1.5);
  const k = clamp(Math.pow(1 - sd.y, 5), 0, 1), out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = P.betaR[i], bM = P.betaM[i], Fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rP + bM * mP) / (bR + bM);
    let Lin = Math.pow(Math.max(0, P.sunE * ratio * (1 - Fex)), 1.5);
    Lin *= lerp(1, Math.pow(Math.max(0, P.sunE * ratio * Fex), 0.5), k);
    const L0 = 0.1 * Fex;
    const tex = (Lin + L0) * 0.04 + [0, 0.0003, 0.00075][i];
    out[i] = Math.pow(tex, 1 / (1.2 + 1.2 * P.sunfade));
  }
  return out;
}

// ------------------------------------------------------------------ GLSL משותף
const GLSL_HASH = `
float lpHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float lpHash1(float n){ return lpHash(vec2(n, n * 0.618 + 7.13)); }
vec3 lpS2L(vec3 c){ return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
`;
const GLSL_SKYLUT = `
uniform sampler2D tLut;
vec3 lpLut(vec3 d){ float u = atan(d.z, d.x) * 0.15915494 + 0.5; float v = sqrt(clamp(d.y, 0.0, 1.0)); return texture2D(tLut, vec2(u, v * 0.97 + 0.015)).rgb; }
`;

// טקסטורת רעש אריחית 256² (נוצרת ב-GPU): R = fbm ערך, G = fbm גדול (זרע אחר), B = קווי סדקים (וורונוי F2−F1), A = גרעין לבן
const NOISE_FS = `
varying vec2 vUv;
float h2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p, float per, float seed){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h2(mod(i, per) + seed), b = h2(mod(i + vec2(1.0, 0.0), per) + seed), c = h2(mod(i + vec2(0.0, 1.0), per) + seed), d = h2(mod(i + vec2(1.0, 1.0), per) + seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 uv, float per, float seed, int oct){ float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vnoise(uv * per, per, seed + float(i) * 17.0); n += a; a *= 0.5; per *= 2.0; } return s / n; }
float cracks(vec2 uv, float per){
  vec2 p = uv * per; vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 c = mod(i + g, per);
    vec2 o = vec2(h2(c + 3.1), h2(c + 7.7)); float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return 1.0 - smoothstep(0.0, 0.07, d2 - d1);
}
void main(){
  float r = fbm(vUv, 8.0, 1.0, 5);
  float g = fbm(vUv, 4.0, 91.0, 4);
  float b = cracks(vUv, 12.0) * (0.55 + 0.45 * fbm(vUv, 4.0, 33.0, 2));
  float a = h2(floor(vUv * 256.0) + 0.5);
  gl_FragColor = vec4(r, g, b, a);
}`;
const FS_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// טבלת שמיים: u = אזימוט (atan(z,x)), v = sqrt(dir.y)
const LUT_FS = `
varying vec2 vUv;
uniform vec3 sunDir; uniform vec3 betaR; uniform vec3 betaM; uniform float sunE; uniform float sunfade; uniform float mieG; uniform float kSky;
uniform vec3 nightZen; uniform vec3 nightHor; uniform vec3 cityGlow; uniform vec3 moonSky; uniform vec3 hazeCol; uniform float haze; uniform float overcast; uniform vec3 overcastCol;
const float pi = 3.141592653589793;
vec3 preetham(vec3 direction){
  float zenithAngle = acos(max(0.0, direction.y));
  float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
  float sR = 8.4E3 * inverse; float sM = 1.25E3 * inverse;
  vec3 Fex = exp(-(betaR * sR + betaM * sM));
  float cosTheta = dot(direction, sunDir);
  float rPhase = 0.05968310365946075 * (1.0 + pow(cosTheta * 0.5 + 0.5, 2.0));
  float g2 = mieG * mieG; float mPhase = 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * mieG * cosTheta + g2, 1.5));
  vec3 ratio = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
  vec3 Lin = pow(max(sunE * ratio * (1.0 - Fex), 0.0), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(max(sunE * ratio * Fex, 0.0), vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
  vec3 L0 = vec3(0.1) * Fex;
  vec3 texColor = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  return pow(texColor, vec3(1.0 / (1.2 + 1.2 * sunfade)));
}
void main(){
  float az = (vUv.x - 0.5) * 6.2831853; float vv = clamp((vUv.y - 0.015) / 0.97, 0.0, 1.0); float y = vv * vv; float c = sqrt(max(1.0 - y * y, 0.0));
  vec3 d = vec3(c * cos(az), y, c * sin(az));
  vec3 col = preetham(d) * kSky;
  // Preetham של three יוצא דהוי בצינור ליניארי: מגבירים רוויה (פחות ליד השמש) ומכהים את הזנית — מכויל לתמונות היום (043/044): זנית כחולה עמוקה, אופק בהיר
  float ct = dot(d, sunDir); float sunw = pow(max(ct, 0.0), 6.0);
  float L0 = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = max(vec3(L0) + (col - vec3(L0)) * mix(1.9, 1.0, sunw), 0.0);
  col *= 1.0 - 0.38 * pow(y, 0.8);
  // חגורת נוגה (ורדרד מול השמש בשקיעה)
  col += vec3(0.20, 0.11, 0.14) * kSky * 0.25 * smoothstep(10.0, 0.0, asin(clamp(sunDir.y, -1.0, 1.0)) * 57.3) * smoothstep(-2.0, 0.5, asin(clamp(sunDir.y, -1.0, 1.0)) * 57.3) * (1.0 - ct) * exp(-y * 9.0);
  float hz = pow(1.0 - y, 3.0);
  col += mix(nightZen, nightHor, hz) + cityGlow * exp(-y * 7.0) + moonSky * (0.4 + 0.6 * hz);
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, hazeCol * L * 1.15, haze * (0.35 + 0.65 * hz));
  col = mix(col, overcastCol * (0.75 + 0.35 * y), overcast);
  gl_FragColor = vec4(col, 1.0);
}`;

// כיפת שמיים (גם לסביבה): כיוון בלבד, עומק 1 (מאחורי הכול), עננים מטקסטורת הרעש
const DOME_VS = `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * vec4((viewMatrix * vec4(position, 0.0)).xyz, 1.0); gl_Position = p.xyww; }`;
const DOME_FS = `
varying vec3 vDir;
${GLSL_SKYLUT}
uniform sampler2D lpNoise; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunDisc; uniform float cloud; uniform vec2 cloudOff; uniform float cloudScale;
uniform vec3 cloudLit; uniform vec3 cloudAmb; uniform vec3 groundRad; uniform float envMode;
void main(){
  vec3 d = normalize(vDir);
  vec3 c;
  if (d.y >= 0.0) { c = lpLut(d); if (envMode > 0.5) c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.55); }   // סביבה: שמיים פחות רוויים לתאורה (כמו מצלמה + החזרות חמות)
  else c = mix(lpLut(vec3(d.x, 0.0, d.z)) * 0.92, groundRad, envMode > 0.5 ? 1.0 : clamp(-d.y * 3.0, 0.0, 0.6));
  float cs = dot(d, sunDir);
  if (envMode < 0.5) c += sunCol * sunDisc * smoothstep(0.999945, 0.99997, cs);
  if (d.y > 0.0 && cloud > 0.01) {
    vec2 p = d.xz / (d.y + 0.09) * cloudScale + cloudOff;
    float n = texture2D(lpNoise, p).r * 0.62 + texture2D(lpNoise, p * 2.7 + 0.37).g * 0.38;
    float cov = smoothstep(1.02 - cloud - 0.16, 1.02 - cloud + 0.30, n) * smoothstep(0.0, 0.12, d.y);
    float n2 = texture2D(lpNoise, p + sunDir.xz * 0.02).r * 0.62 + texture2D(lpNoise, (p + sunDir.xz * 0.02) * 2.7 + 0.37).g * 0.38;
    float lit = clamp(0.6 + (n - n2) * 5.0, 0.15, 1.0);
    vec3 cc = cloudAmb * (0.8 + 0.4 * n) + cloudLit * lit * (0.55 + 0.45 * pow(max(cs, 0.0), 6.0));
    c = mix(c, cc, cov * 0.93);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------------ שיידרי חומרים (onBeforeCompile על חומרי three)
const MAT_VS_HEAD = `
attribute vec4 lpB;
attribute vec2 lpA;
varying vec3 vLpW; varying vec3 vLpN; varying vec4 vLpB; varying vec2 vLpUv; varying vec2 vLpA;
`;
const MAT_VS_BODY = `
{
  vec4 lpw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    lpw = instanceMatrix * lpw;
  #endif
  lpw = modelMatrix * lpw;
  vLpW = lpw.xyz;
  vLpN = normalize(mat3(modelMatrix) * objectNormal);
  vLpUv = uv;
  #ifdef LP_USE_A
    vLpA = lpA;
  #else
    vLpA = vec2(0.0);
  #endif
  #ifdef LP_USE_B
    vec4 b = lpB;
    if (b.x < 0.0) { vec2 o = modelMatrix[3].xz; b.x = fract(sin(dot(floor(o), vec2(12.9898, 78.233))) * 43758.5453); b.w += modelMatrix[3].y; }
    vLpB = b;
  #else
    vLpB = vec4(0.0);
  #endif
}
`;
const MAT_FS_HEAD = `
varying vec3 vLpW; varying vec3 vLpN; varying vec4 vLpB; varying vec2 vLpUv; varying vec2 vLpA;
uniform sampler2D lpNoise; uniform sampler2D lpLampMap; uniform vec4 lpLampRect; uniform float lpLampOn;
uniform float lpNight; uniform float lpOcc; uniform float lpWet; uniform float lpHemiK; uniform float lpWinK; uniform vec3 lpSunW;
${GLSL_HASH}
vec4 lpN(vec2 uv){ return texture2D(lpNoise, uv); }
vec3 lpLamp(vec3 p, out float lampTop){
  lampTop = -100.0;
  if (lpLampOn < 0.5) return vec3(0.0);
  vec2 uv = (p.xz - lpLampRect.xy) * lpLampRect.z;
  vec2 e = smoothstep(vec2(0.0), vec2(0.06), uv) * smoothstep(vec2(1.0), vec2(0.94), uv);
  if (e.x * e.y <= 0.0) return vec3(0.0);
  vec4 L = texture2D(lpLampMap, uv);
  lampTop = L.a * 400.0 - 50.0;
  return L.rgb * lpLampRect.w * e.x * e.y;
}
`;

// חזיתות: מחושב פעם אחת אחרי color_fragment; התוצאות (lpAlb/lpRough/lpNW/lpEmis/lpAO) משמשות בהמשך
const FACADE = `
vec3 lpAlb = vec3(0.8); float lpRough = 0.88; float lpMetal = 0.0; vec3 lpNW = normalize(vLpN); vec3 lpEmis = vec3(0.0); float lpAO = 1.0; float lpSpecK = 1.0;
{
  vec3 wp = vLpW; vec3 nW = lpNW;
  float hs = vLpB.x; float styF = vLpB.y; float sty = floor(styF + 0.01); float fam = floor(fract(styF + 0.001) * 10.0 + 0.5);
  float bh = max(vLpB.z, 3.0); float base = vLpB.w;
  #ifdef LP_IND
    sty = 1.0;
  #endif
  bool roofLike = nW.y > 0.6;
  float h1 = fract(hs * 7.31), h2 = fract(hs * 13.97), h3 = fract(hs * 29.13), h4 = fract(hs * 51.71), h5 = fract(hs * 73.37), h6 = fract(hs * 91.9);
  bool ind = sty > 0.5 && sty < 1.5; bool villa = sty > 1.5 && sty < 2.5; bool tower = !ind && (bh > 33.0 || sty > 2.5);
  // --- טיח: משפחת צבע לכל בניין (פלטת אשדוד של מחלקת האווירה)
  vec3 pc;
  float fsel = fam > 0.5 ? (fam - 0.5) / 4.0 : (tower ? h1 * 0.72 : (bh < 32.0 && bh > 11.0 ? h1 : h1 * 0.95));
  if (ind) { pc = h2 < 0.25 ? vec3(0.78, 0.80, 0.82) : h2 < 0.5 ? vec3(0.70, 0.74, 0.78) : h2 < 0.75 ? vec3(0.82, 0.78, 0.70) : vec3(0.62, 0.68, 0.72); }
  else if (fsel < 0.50) { float k = h2 * 5.0; pc = k < 1.0 ? vec3(0.929, 0.902, 0.839) : k < 2.0 ? vec3(0.910, 0.863, 0.769) : k < 3.0 ? vec3(0.890, 0.839, 0.737) : k < 4.0 ? vec3(0.867, 0.816, 0.714) : vec3(0.945, 0.925, 0.886); }
  else if (fsel < 0.72) { float k = h2 * 4.0; pc = k < 1.0 ? vec3(0.851, 0.788, 0.659) : k < 2.0 ? vec3(0.812, 0.745, 0.612) : k < 3.0 ? vec3(0.788, 0.718, 0.604) : vec3(0.839, 0.780, 0.671); }
  else if (fsel < 0.94) { float k = h2 * 4.0; pc = k < 1.0 ? vec3(0.741, 0.718, 0.667) : k < 2.0 ? vec3(0.702, 0.678, 0.624) : k < 3.0 ? vec3(0.663, 0.643, 0.596) : vec3(0.769, 0.745, 0.690); }
  else { float k = h2 * 3.0; pc = k < 1.0 ? vec3(0.914, 0.788, 0.651) : k < 2.0 ? vec3(0.890, 0.725, 0.561) : vec3(0.847, 0.765, 0.627); }
  vec3 plaster = lpS2L(pc) * (0.93 + 0.12 * h3);
  float dirtB = (fsel > 0.72 && fsel < 0.94 ? 0.55 : 0.25) + 0.45 * h5;   // לכלוך כללי (שיכונים ישנים יותר)
  if (roofLike) {
    // --- גג (ברמת פירוט רחוקה הגגות באותה קבוצה)
    vec3 rc = villa ? lpS2L(vec3(0.71, 0.39, 0.24)) : lpS2L(h4 < 0.5 ? vec3(0.847, 0.831, 0.80) : vec3(0.776, 0.757, 0.714));
    float n = lpN(wp.xz / 9.0).r;
    lpAlb = rc * (0.85 + 0.25 * n); lpRough = 0.9;
  } else {
    // --- צירי הקיר
    vec3 tW = normalize(vec3(nW.z, 0.0, -nW.x));
    float along = dot(wp, tW);
    #ifdef LP_HASUV
      float bayU = vLpUv.x * (ind ? 1.0 : 2.0);
    #else
      float bayU = along / (ind ? 4.0 : 3.4);
    #endif
    float flH = ind ? 6.0 : 3.0;
    float yb = wp.y - base;
    float topY = bh - (ind ? 0.4 : 0.9);
    float nF = max(1.0, floor(topY / flH + 0.35));
    float cellH = topY / nF;
    float fyv = yb / cellH; float fi = floor(fyv); float py = fract(fyv);
    float bi = floor(bayU); float px = fract(bayU);
    float cw = ind ? 4.0 : 3.4;
    float aaK = smoothstep(0.10, 0.38, max(fwidth(bayU), fwidth(fyv)));   // טביעת הפיקסל ביחידות תא: רחוק → ממוצע (בלי מוארה/ריצוד)
    // --- רעש טריפלנרי על מישור הקיר (קירות אנכיים: מספיקים 2 מישורים לפי הנורמל)
    vec2 wuv = vec2(along, wp.y);
    vec4 nBig = lpN(wuv / 11.0 + hs * 7.0);
    vec4 nFine = lpN(wuv / 1.7);
    vec3 alb = plaster * (0.9 + 0.17 * nBig.g) * (0.97 + 0.06 * nFine.a);
    float rough = 0.9;
    vec3 emis = vec3(0.0); float ao = 1.0; vec3 nPert = vec3(0.0);
    // לכלוך: פס תחתון, כתמים
    alb *= mix(1.0, 0.72 + 0.28 * clamp(yb / 0.9, 0.0, 1.0), 0.5 + 0.5 * dirtB);
    alb *= 1.0 - dirtB * 0.10 * smoothstep(0.45, 0.85, nBig.r);
    if (yb > topY) {
      // --- מעקה גג (פרפט) + קופינג
      float t = yb - topY; float H = bh - topY;
      if (t > H - 0.09) { alb = plaster * 1.06; nPert += vec3(0.0, 0.55, 0.0); }
      else if (t > H - 0.24) alb *= 0.86;
      if (ind) alb *= 0.9;
    } else if (yb < 0.0) {
      alb *= 0.62;   // יסוד/מסד
    } else if (ind) {
      // --- תעשייה: פח גלי + פס חלונות עליון
      float rib = sin(along * 31.4159);
      nPert += tW * rib * 0.22;
      alb = plaster * (0.86 + 0.08 * rib) * (0.92 + 0.15 * nBig.g);
      rough = 0.55; lpMetal = 0.35;
      if (py > 0.70 && py < 0.86) { alb = vec3(0.025, 0.03, 0.035); rough = 0.12; lpMetal = 0.0;
        float lit = step(lpHash(vec2(bi, fi) + hs * 113.0), lpOcc * 0.35) * lpNight; emis = vec3(0.9, 0.95, 1.0) * lit * lpWinK * 0.8; }
      alb *= 1.0 - 0.18 * smoothstep(0.5, 1.0, nBig.r) * smoothstep(0.7, 0.0, py);   // חלודה/זליגה
    } else {
      // --- מגורים: סגנון לפי בניין
      float rW = lpHash(vec2(bi, fi) + hs * 517.0);
      float rS = lpHash(vec2(bi + 0.37, fi) + hs * 211.0);
      float rL = lpHash(vec2(bi, fi + 0.71) + hs * 97.0);
      float rC = lpHash(vec2(bi + 0.13, fi + 0.29) + hs * 37.0);
      bool shop = fi < 0.5 && h6 > 0.55 && bh < 40.0 && !villa;
      bool balRich = tower || (h4 < 0.45 && !villa);
      bool bal = !shop && fi > 0.5 && balRich && (tower ? mod(bi, 3.0) != 1.0 : mod(bi + floor(h3 * 2.0), 2.0) < 1.0);
      vec3 frameC = h6 < 0.6 ? vec3(0.80) : vec3(0.10, 0.105, 0.11);
      vec3 shutC = lpS2L(h5 < 0.3 ? vec3(0.93, 0.92, 0.90) : h5 < 0.6 ? vec3(0.85, 0.80, 0.71) : h5 < 0.85 ? vec3(0.66, 0.67, 0.67) : vec3(0.79, 0.79, 0.77));
      vec3 litC = rC < 0.62 ? vec3(1.0, 0.60, 0.28) : rC < 0.9 ? vec3(1.0, 0.80, 0.58) : vec3(0.55, 0.68, 1.0);
      float lit = step(rL, lpOcc) * lpNight;
      // פס רצפה (חלק מהבניינים)
      if (h4 > 0.5 && py < 0.035 && fi > 0.5) { alb *= 0.9; nPert += vec3(0.0, -0.35, 0.0); }
      if (shop) {
        // --- חזית חנות: זכוכית גדולה, עמודים, שלט
        float ux = abs(px - 0.5);
        if (ux > 0.465) { alb = plaster * 0.95; }
        else if (py > 0.80 && py < 0.95) {
          vec3 sc = rW < 0.25 ? vec3(0.65, 0.08, 0.06) : rW < 0.5 ? vec3(0.05, 0.22, 0.6) : rW < 0.75 ? vec3(0.9, 0.9, 0.88) : vec3(0.08, 0.42, 0.22);
          alb = sc; rough = 0.45; emis = sc * step(rS, 0.45) * lpNight * lpWinK * 1.1;
        } else if (py > 0.04 && py < 0.80) {
          alb = vec3(0.03, 0.035, 0.04) + vec3(0.05, 0.045, 0.04) * step(0.5, rS); rough = 0.07;
          float shopOpen = step(rL, lpOcc * 0.5 + 0.05);
          emis = vec3(1.0, 0.92, 0.8) * shopOpen * lpNight * lpWinK * 1.3;
          if (rS < 0.35 && lpNight > 0.5 && shopOpen < 0.5) { alb = lpS2L(vec3(0.62, 0.62, 0.6)) * (0.85 + 0.15 * step(0.5, fract(py * 60.0))); rough = 0.5; lpMetal = 0.6; } // תריס גלילה של חנות סגורה
        } else alb = plaster * 0.8;
      } else if (bal) {
        // --- מרפסת שקועה: פרלקסה של קיר אחורי/צדדים/תקרה + מעקה בחזית
        float u0 = 0.06, u1 = 0.94, v0 = 0.07, v1 = tower ? 0.97 : 0.93;
        vec3 V = normalize(cameraPosition - wp);
        vec3 vt = vec3(dot(V, tW), V.y, max(dot(V, nW), 0.08));
        float depth = tower ? 1.8 : 1.4;
        vec2 cell = vec2(px * cw, py * cellH);
        vec2 pb = (cell - vt.xy / vt.z * depth) / vec2(cw, cellH);
        if (px > u0 && px < u1 && py > v0 && py < v1) {
          vec3 inC;
          if (pb.x > u0 && pb.x < u1 && pb.y > v0 && pb.y < v1) {
            // קיר אחורי עם דלת הזזה
            float du = (pb.x - u0) / (u1 - u0), dv = (pb.y - v0) / (v1 - v0);
            if (du > 0.14 && du < 0.86 && dv < 0.80) { inC = vec3(0.03, 0.035, 0.045) + (rS < 0.5 ? vec3(0.10, 0.09, 0.08) * step(0.5, fract(du * 2.0)) : vec3(0.0));
              emis = litC * lit * lpWinK * 0.85; rough = 0.1; }
            else inC = plaster * 0.55;
          } else if (pb.y >= v1) inC = plaster * 0.33;
          else if (pb.y <= v0) inC = lpS2L(vec3(0.62, 0.58, 0.52)) * 0.55;
          else inC = plaster * 0.45;
          alb = inC; ao = 0.55;
          // מעקה: זכוכית או מוטות מתכת, גובה 1.05 מ'
          float railTop = v0 + 1.05 / cellH;
          if (py < railTop) {
            if (tower || h5 > 0.55) { alb = mix(alb, vec3(0.30, 0.36, 0.38), 0.55); rough = 0.08; ao = 0.9; emis *= 0.5; }
            else { float bar = step(fract(cell.x / 0.12), 0.22); float rail = step(railTop - 0.035, py);
              if (bar + rail > 0.5) { alb = frameC * 0.9; rough = 0.4; lpMetal = 0.5; ao = 1.0; emis = vec3(0.0); } }
          }
        } else if (py <= v0) { alb = plaster * 1.04; nPert += vec3(0.0, 0.6, 0.0) * step(v0 - 0.025, py); }   // שפת התקרה הבולטת
      } else {
        // --- חלון רגיל + תריס גלילה (תריס עליון), אדן, קופסת תריס, מזגן
        float ww = tower ? 0.84 : 0.36 + 0.2 * h1; float u0 = 0.5 - ww * 0.5, u1 = 0.5 + ww * 0.5;
        float vs = tower ? 0.25 : 0.30, ve = tower ? 0.90 : 0.80 + 0.04 * h2;
        float fr = 0.03;
        if (px > u0 && px < u1 && py > vs && py < ve) {
          float wy = (py - vs) / (ve - vs);
          float sc = rS < 0.22 ? 1.0 : rS < 0.42 ? 0.55 : rS < 0.55 ? 0.25 : 0.0;
          sc = mix(sc, max(sc, step(rS, 0.6) * 0.92), lpNight * 0.7);
          bool inFrame = px < u0 + fr * 0.5 || px > u1 - fr * 0.5 || py < vs + fr || py > ve - fr;
          bool mull = tower && abs(px - 0.5) < 0.008;
          if (inFrame || mull) { alb = frameC; rough = 0.35; lpMetal = 0.3; }
          else if (wy > 1.0 - sc) {
            // תריס: שלבים אופקיים
            float sl = fract(py * cellH / 0.055);
            alb = shutC * (0.88 + 0.14 * smoothstep(0.1, 0.5, sl)); rough = 0.55;
            nPert += vec3(0.0, (sl - 0.5) * 0.6, 0.0);
            emis = litC * lit * lpWinK * 0.05;
          } else {
            vec3 inner = vec3(0.025, 0.03, 0.038);
            if (rC > 0.55) inner += lpS2L(vec3(0.75, 0.72, 0.66)) * 0.18 * (0.7 + 0.3 * sin(px * 90.0));   // וילון
            alb = inner; rough = 0.1; lpSpecK = 0.75;
            emis = litC * lit * lpWinK * (rC > 0.55 ? 0.75 : 1.0);
            if (wy > 0.9 - sc) ao = 0.6;   // צל המשקוף
          }
        } else if (!tower && px > u0 - 0.03 && px < u1 + 0.03 && py > vs - 0.035 && py <= vs) {
          alb = plaster * 1.08; nPert += vec3(0.0, 0.7, 0.0);   // אדן
        } else if (!tower && px > u0 && px < u1 && py >= ve && py < ve + 0.075) {
          alb = plaster * 0.98 + 0.03; nPert += vec3(0.0, -0.2, 0.0);   // קופסת תריס
        } else {
          #if LP_DETAIL > 0
          // מזגן ליד חלון
          float acx = u1 + 0.05;
          if (!tower && rW < 0.24 && px > acx && px < acx + 0.17 && py > 0.13 && py < 0.32) {
            float gx = (px - acx) / 0.17, gy = (py - 0.13) / 0.19;
            alb = lpS2L(vec3(0.80, 0.80, 0.78)) * (gx > 0.12 && gx < 0.88 && gy > 0.15 && gy < 0.85 ? 0.75 + 0.25 * step(0.5, fract(gy * 7.0)) : 1.0);
            rough = 0.5; nPert += vec3(0.0, 0.25, 0.0) * step(0.9, gy);
          } else if (!tower && rW < 0.24 && px > acx && px < acx + 0.17 && py > 0.10 && py <= 0.13) { ao = 0.6; }
          // זליגות לכלוך מתחת לאדנים
          float below = vs - py;
          if (px > u0 && px < u1 && below > 0.0 && below < 0.5) {
            float st = lpN(vec2(along * 1.3, wp.y * 0.08) + hs).r;
            alb *= 1.0 - (0.06 + 0.12 * dirtB) * (1.0 - below / 0.5) * smoothstep(0.35, 0.75, st);
          }
          #endif
        }
      }
    }
    // סדקים דקים בטיח (בתים מוזנחים)
    #if LP_DETAIL > 0
      alb *= 1.0 - 0.18 * dirtB * smoothstep(0.55, 0.95, lpN(wuv / 4.3 + hs * 3.0).b);
    #endif
    // נורמל: גרעין הטיח + הפרעות
    vec3 bump = (vec3(nFine.r - 0.5, nFine.g - 0.5, 0.0)) * 0.10;
    nPert += tW * bump.x + vec3(0.0, bump.y, 0.0);
    if (aaK > 0.0 && yb > 0.0 && yb < topY) {
      vec3 avgAlb = ind ? plaster * 0.8 : mix(plaster, vec3(0.05, 0.06, 0.07), tower ? 0.45 : 0.25);
      vec3 avgEm = vec3(1.0, 0.72, 0.45) * lpOcc * lpNight * lpWinK * (ind ? 0.03 : tower ? 0.4 : 0.2);
      alb = mix(alb, avgAlb, aaK); emis = mix(emis, avgEm, aaK); rough = mix(rough, 0.6, aaK); lpMetal *= 1.0 - aaK; ao = mix(ao, 1.0, aaK); nPert *= 1.0 - aaK;
    }
    lpNW = normalize(nW + nPert);
    lpAlb = alb; lpRough = rough; lpEmis = emis; lpAO = ao;
  }
}
`;
const FACADE_LITE = `
vec3 lpAlb = vec3(0.8); float lpRough = 0.9; float lpMetal = 0.0; vec3 lpNW = normalize(vLpN); vec3 lpEmis = vec3(0.0); float lpAO = 1.0; float lpSpecK = 1.0;
{
  vec3 wp = vLpW; vec3 nW = lpNW;
  float hs = vLpB.x; float sty = floor(vLpB.y + 0.01); float bh = max(vLpB.z, 3.0); float base = vLpB.w;
  float h1 = fract(hs * 7.31), h2 = fract(hs * 13.97), h3 = fract(hs * 29.13), h4 = fract(hs * 51.71);
  bool ind = sty > 0.5 && sty < 1.5; bool villa = sty > 1.5 && sty < 2.5;
  vec3 pc = ind ? vec3(0.74, 0.76, 0.78) : h1 < 0.5 ? mix(vec3(0.93, 0.90, 0.84), vec3(0.87, 0.82, 0.72), h2) : h1 < 0.72 ? mix(vec3(0.85, 0.79, 0.66), vec3(0.79, 0.72, 0.60), h2) : h1 < 0.94 ? mix(vec3(0.74, 0.72, 0.67), vec3(0.66, 0.64, 0.60), h2) : vec3(0.89, 0.73, 0.56);
  vec3 plaster = lpS2L(pc) * (0.93 + 0.12 * h3);
  if (nW.y > 0.6) { lpAlb = villa ? lpS2L(vec3(0.71, 0.39, 0.24)) : lpS2L(vec3(0.82, 0.80, 0.77)) * (0.9 + 0.15 * h4); }
  else {
    vec3 tW = normalize(vec3(nW.z, 0.0, -nW.x));
    float bayU = dot(wp, tW) / (ind ? 4.0 : 3.4);
    float yb = wp.y - base; float topY = bh - 0.9; float cellH = topY / max(1.0, floor(topY / (ind ? 6.0 : 3.0) + 0.35));
    float px = fract(bayU), py = fract(yb / cellH), bi = floor(bayU), fi = floor(yb / cellH);
    float aaK = smoothstep(0.10, 0.38, max(fwidth(bayU), fwidth(yb / cellH)));
    lpAlb = plaster;
    if (yb > 0.0 && yb < topY && abs(px - 0.5) < (ind ? 0.45 : 0.24) && py > 0.3 && py < 0.82) {
      lpAlb = mix(plaster, vec3(0.035, 0.04, 0.05), 0.85); lpRough = 0.2;
      float lit = step(lpHash(vec2(bi, fi) + hs * 97.0), lpOcc * (ind ? 0.3 : 1.0)) * lpNight;
      float rc = lpHash(vec2(bi + 0.13, fi + 0.29) + hs * 37.0);
      lpEmis = (rc < 0.62 ? vec3(1.0, 0.60, 0.28) : rc < 0.9 ? vec3(1.0, 0.80, 0.58) : vec3(0.55, 0.68, 1.0)) * lit * lpWinK;
    }
    if (yb > 0.0 && yb < topY) { lpAlb = mix(lpAlb, mix(plaster, vec3(0.05, 0.06, 0.07), 0.22), aaK); lpEmis = mix(lpEmis, vec3(1.0, 0.72, 0.45) * lpOcc * lpNight * lpWinK * 0.2, aaK); }
  }
}
`;
// גג שטוח / רעפים
const ROOF = `
vec3 lpAlb = vec3(0.8); float lpRough = 0.9; float lpMetal = 0.0; vec3 lpNW = normalize(vLpN); vec3 lpEmis = vec3(0.0); float lpAO = 1.0; float lpSpecK = 1.0;
{
  vec3 wp = vLpW; float hs = vLpB.x; float sty = floor(vLpB.y + 0.01);
  float h1 = fract(hs * 7.31), h2 = fract(hs * 13.97), h3 = fract(hs * 29.13), h4 = fract(hs * 51.71);
  if (sty > 1.5 && sty < 2.5) {
    vec2 q = h1 > 0.5 ? wp.xz : wp.zx;
    ${'' /* רעפים */}
    float row = floor(q.y / 0.34); float ux = q.x / 0.21 + mod(row, 2.0) * 0.5; float t = fract(ux); float rv = fract(q.y / 0.34);
    float tid = lpHash(vec2(floor(ux), row) + hs * 31.0);
    vec3 tc = lpS2L(mix(vec3(0.71, 0.39, 0.24), vec3(0.66, 0.35, 0.21), tid)) * (0.85 + 0.2 * lpHash(vec2(floor(ux) * 1.7, row)));
    tc *= 0.78 + 0.22 * smoothstep(0.0, 0.25, rv);              // צל החפיפה
    float moss = smoothstep(0.62, 0.9, lpN(wp.xz / 7.0 + hs).r);
    tc = mix(tc, lpS2L(vec3(0.42, 0.40, 0.33)), moss * 0.4);
    lpAlb = tc; lpRough = 0.62;
    lpNW = normalize(vec3(0.0, 1.0, 0.0) + (h1 > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)) * cos(t * 6.2831853) * 0.35 + (h1 > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)) * (rv - 0.5) * 0.25);
  } else {
    vec4 n = lpN(wp.xz / 13.0 + hs * 5.0); vec4 f = lpN(wp.xz / 1.3);
    vec3 rc = h2 < 0.14 ? lpS2L(vec3(0.30, 0.30, 0.29)) : lpS2L(h2 < 0.55 ? vec3(0.847, 0.831, 0.80) : h2 < 0.8 ? vec3(0.812, 0.796, 0.761) : vec3(0.776, 0.757, 0.714));
    rc *= (0.86 + 0.22 * n.g) * (0.95 + 0.08 * f.a);
    rc *= 1.0 - 0.2 * smoothstep(0.55, 0.85, n.r) * (0.4 + 0.6 * h3);   // כתמי מים
    rc *= 1.0 - 0.25 * smoothstep(0.5, 0.95, lpN(wp.xz / 5.0).b) * h4;    // תפרי זפת
    lpAlb = rc; lpRough = 0.92;
    lpNW = normalize(vec3(f.r - 0.5, 4.0, f.g - 0.5));
  }
}
`;
// רעפים לגג משופע (חומר עצמאי למחלקת האינטגרציה): שורות לאורך השיפוע לפי הנורמל
const ROOFTILE = `
vec3 lpAlb = vec3(0.8); float lpRough = 0.62; float lpMetal = 0.0; vec3 lpNW = normalize(vLpN); vec3 lpEmis = vec3(0.0); float lpAO = 1.0; float lpSpecK = 1.0;
{
  vec3 wp = vLpW; vec3 n = lpNW;
  vec3 alongT = abs(n.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), n));
  vec3 downT = normalize(cross(n, alongT));
  float qx = dot(wp, alongT), qy = dot(wp, downT);
  float row = floor(qy / 0.34); float ux = qx / 0.21 + mod(row, 2.0) * 0.5; float t = fract(ux); float rv = fract(qy / 0.34);
  float tid = lpHash(vec2(floor(ux), row));
  #ifdef LP_TILE_B
    float th = vLpB.x; vec3 lpRoofTint = lpS2L(th < 0.4 ? vec3(0.71, 0.39, 0.24) : th < 0.7 ? vec3(0.66, 0.35, 0.21) : th < 0.88 ? vec3(0.75, 0.44, 0.29) : vec3(0.55, 0.30, 0.20));
  #endif
  vec3 tc = lpRoofTint * mix(1.0, 0.86, tid) * (0.85 + 0.2 * lpHash(vec2(floor(ux) * 1.7, row)));
  tc *= 0.74 + 0.26 * smoothstep(0.0, 0.25, rv);
  float moss = smoothstep(0.62, 0.9, lpN(wp.xz / 7.0).r);
  tc = mix(tc, lpS2L(vec3(0.42, 0.40, 0.33)), moss * 0.35);
  lpAlb = tc;
  lpNW = normalize(n + alongT * cos(t * 6.2831853) * 0.35 + downT * (rv - 0.5) * 0.3);
}
`;
// קרקע: סיווג לפי צבע הקודקוד של המשחק (חוף/חול/עירוני/צמחייה) + פירוט מטקסטורת הרעש
const TERRAIN = `
vec3 lpAlb = vec3(0.6); float lpRough = 0.95; float lpMetal = 0.0; vec3 lpNW = normalize(vLpN); vec3 lpEmis = vec3(0.0); float lpAO = 1.0; float lpSpecK = 0.6;
{
  vec3 wp = vLpW;
  #ifdef USE_COLOR
    vec3 vc = vColor.rgb;
  #else
    vec3 vc = vec3(0.6, 0.58, 0.52);
  #endif
  float grass = smoothstep(0.0, 0.06, vc.g - vc.r);
  float sand = smoothstep(0.70, 0.80, vc.r) * (1.0 - grass);
  float urban = clamp(1.0 - grass - sand, 0.0, 1.0);
  vec4 n1 = lpN(wp.xz / 23.0); vec4 n2 = lpN(wp.xz / 97.0 + 0.31); vec4 n3 = lpN(wp.xz / 2.1);
  vec3 gC = mix(lpS2L(vec3(0.44, 0.50, 0.27)), lpS2L(vec3(0.63, 0.58, 0.37)), smoothstep(0.25, 0.7, n2.g)) * (0.82 + 0.3 * n1.r) * (0.9 + 0.2 * n3.a);
  vec3 sC = lpS2L(vec3(0.90, 0.83, 0.66)) * (0.92 + 0.1 * n1.r) * (0.96 + 0.06 * n3.a);
  vec3 uC = lpS2L(vec3(0.74, 0.67, 0.54)) * (0.84 + 0.24 * n1.r) * (0.9 + 0.16 * n3.a);
  uC *= 1.0 - 0.12 * smoothstep(0.5, 0.8, n2.r);
  vec3 c = gC * grass + sC * sand + uC * urban;
  c *= 0.75 + 0.25 * (vc / max(dot(vc, vec3(0.333)), 0.05)) * 0.333 * 3.0 * 0.333;
  lpAlb = c;
  float rip = sin(dot(wp.xz, vec2(0.62, 0.78)) * 5.5 + n1.r * 9.0);
  lpNW = normalize(vec3((n3.r - 0.5) * 0.25 + 0.12 * rip * sand * 0.0, 1.0, (n3.g - 0.5) * 0.25) + vec3(0.62, 0.0, 0.78) * rip * sand * 0.12);
  lpRough = mix(0.95, 0.9, sand);
  lpSpecK = 0.6;
}
`;
// אספלט: נסיעה (u לרוחב 0..1, v לאורך = מרחק/16), סימונים בשיידר, סדקים, טלאים, שחיקה, רטיבות
const ROAD = `
vec3 lpAlb = vec3(0.1); float lpRough = 0.82; float lpMetal = 0.0; vec3 lpNW = vec3(0.0, 1.0, 0.0); vec3 lpEmis = vec3(0.0); float lpAO = 1.0; float lpSpecK = 1.0;
{
  vec3 wp = vLpW; float u = vLpUv.x; float dist = vLpUv.y * 16.0;
  float hw = vLpA.y > 0.5 ? vLpA.y : 3.5; float ac = vLpA.y > 0.5 ? vLpA.x : (u - 0.5) * 7.0;
  float seg = floor(dist / 40.0); float sh = lpHash(vec2(seg, floor(hw * 3.0)));
  vec4 nA = lpN(wp.xz / 0.7); vec4 nB = lpN(wp.xz / 9.0 + 0.2); vec4 nC = lpN(wp.xz / 31.0 + 0.7);
  float wear = clamp(0.25 + 0.55 * sh + 0.35 * (nC.g - 0.5), 0.0, 1.0);
  vec3 c = mix(lpS2L(vec3(0.27, 0.27, 0.285)), lpS2L(vec3(0.50, 0.48, 0.45)), wear);
  c *= 0.88 + 0.22 * nA.a;                                     // גרעיני אגרגט
  c *= 0.92 + 0.16 * nB.r;
  // פסי גלגלים (מוחלקים וכהים מעט) וכתמי שמן במרכז הנתיב
  float lane = abs(fract(ac / 3.4) - 0.5) * 3.4;
  float track = smoothstep(0.55, 0.85, abs(lane - 0.0) ) * (1.0 - smoothstep(0.95, 1.25, abs(lane)));
  c *= 1.0 - 0.07 * track;
  float oil = smoothstep(0.25, 0.0, lane) * smoothstep(0.55, 0.8, nB.g);
  c *= 1.0 - 0.25 * oil;
  float rough = 0.85 - 0.12 * track - 0.2 * oil;
  // טלאים
  vec2 pc = floor(vec2(ac / 2.6, dist / 6.5)); float pr = lpHash(pc + sh * 17.0);
  if (pr < 0.10) { vec2 pf = fract(vec2(ac / 2.6, dist / 6.5)); if (pf.x > 0.08 && pf.x < 0.92 && pf.y > 0.1 && pf.y < 0.9) { c = lpS2L(vec3(0.24, 0.24, 0.25)) * (0.9 + 0.2 * nA.a); rough = 0.8; } }
  // סדקים
  float cr = smoothstep(0.35, 0.9, lpN(wp.xz / 7.0).b) * smoothstep(0.35, 0.8, wear);
  c *= 1.0 - 0.45 * cr;
  // סימונים: קווי שוליים, קו מרכזי מקווקו (3 מ' קו / 9 מ' רווח)
  float edge = hw - abs(ac);
  float mk = 0.0;
  if (hw > 2.8) { mk = max(mk, step(0.18, edge) * step(edge, 0.30)); mk = max(mk, step(abs(ac), 0.06) * step(fract(dist / 12.0), 0.25)); }
  mk *= smoothstep(0.15, 0.55, nA.g + 0.25 * (1.0 - wear));
  c = mix(c, lpS2L(vec3(0.86, 0.86, 0.82)), mk); rough = mix(rough, 0.6, mk);
  // שוחת ביוב
  vec2 mc = floor(vec2(ac / 3.4, dist / 30.0)); float mh = lpHash(mc + 5.3);
  if (mh < 0.18) { vec2 mp = vec2(fract(ac / 3.4) * 3.4 - 1.7, fract(dist / 30.0) * 30.0 - 15.0); float r = length(mp);
    if (r < 0.34) { c = lpS2L(vec3(0.20, 0.19, 0.18)) * (0.8 + 0.4 * step(0.5, fract((mp.x + mp.y) * 8.0))); rough = 0.5; lpMetal = 0.6; } else if (r < 0.40) c *= 0.7; }
  // שוליים כהים ליד אבן השפה (מרזב)
  c *= 1.0 - 0.25 * smoothstep(0.35, 0.0, edge);
  lpAlb = c; lpRough = rough;
  lpNW = normalize(vec3((nA.r - 0.5) * 0.18 * (1.0 - mk), 1.0, (nA.g - 0.5) * 0.18 * (1.0 - mk)));
}
`;
// מדרכה: לפי המרחק משפת הכביש (lpA.x = רוחבי במטרים, lpA.y = חצי רוחב הכביש): אבן שפה צבועה + מרצפות
const WALK = `
vec3 lpAlb = vec3(0.6); float lpRough = 0.85; float lpMetal = 0.0; vec3 lpNW = vec3(0.0, 1.0, 0.0); vec3 lpEmis = vec3(0.0); float lpAO = 1.0; float lpSpecK = 0.8;
{
  vec3 wp = vLpW; float dist = vLpUv.y * 4.0;
  float hr = vLpA.y > 0.5 ? vLpA.y : 3.5; float ac = vLpA.y > 0.5 ? vLpA.x : (vLpUv.x - 0.5) * 12.0;
  float d = abs(ac) - hr;
  float side = ac < 0.0 ? 0.0 : 1.0;
  float seg = floor(dist / 22.0); float sh = lpHash(vec2(seg, side + floor(hr * 2.0) * 3.1));
  vec4 nA = lpN(wp.xz / 1.1); vec4 nB = lpN(wp.xz / 13.0 + 0.4);
  if (d < 0.24) {
    // אבן שפה: אדום-לבן (אסור לעצור), כחול-לבן (חניה בתשלום), אפור
    float st = step(0.5, fract(dist / 1.0));
    vec3 kc = lpS2L(vec3(0.72, 0.71, 0.68));
    if (sh < 0.30) kc = mix(lpS2L(vec3(0.70, 0.12, 0.10)), lpS2L(vec3(0.86, 0.85, 0.82)), st);
    else if (sh < 0.45) kc = mix(lpS2L(vec3(0.10, 0.28, 0.62)), lpS2L(vec3(0.86, 0.85, 0.82)), st);
    kc *= 0.82 + 0.2 * nA.r;
    float faded = smoothstep(0.3, 0.9, nB.g); kc = mix(kc, lpS2L(vec3(0.66, 0.65, 0.62)), faded * 0.45);
    lpAlb = kc; lpRough = 0.75;
    lpNW = normalize(vec3(0.0, 1.0, 0.0) + (d < 0.05 ? vec3(0.0) : vec3(0.0)) );
    if (d < 0.04) lpAlb *= 0.55;   // פנים אבן השפה בצל
  } else {
    // מרצפות 30×30 (או אריחי "בטון" משתלבים) עם מישקים
    float s = dist; float t = d - 0.24;
    float pat = lpHash(vec2(seg * 0.37, side));
    vec2 tq = pat < 0.5 ? vec2(s, t) / 0.30 : vec2(s / 0.20 + step(0.5, fract(t / 0.4)) * 0.5, t / 0.10 * 0.5);
    vec2 cell = floor(tq); vec2 f = fract(tq);
    float grout = 1.0 - smoothstep(0.0, 0.06, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    float th = lpHash(cell + seg * 13.0);
    vec3 pc = pat < 0.25 ? lpS2L(vec3(0.66, 0.64, 0.60)) : pat < 0.5 ? mix(lpS2L(vec3(0.62, 0.50, 0.45)), lpS2L(vec3(0.70, 0.68, 0.64)), step(0.5, fract((cell.x + cell.y) * 0.5))) : lpS2L(vec3(0.73, 0.70, 0.64));
    pc *= 0.88 + 0.18 * th;
    pc *= 0.9 + 0.14 * nA.a;
    pc *= 1.0 - 0.15 * smoothstep(0.55, 0.85, nB.r);   // לכלוך
    pc *= 1.0 - 0.35 * grout;
    if (nA.a > 0.985) pc *= 0.45;                        // מסטיקים
    lpAlb = pc; lpRough = 0.82 + 0.1 * grout;
    lpNW = normalize(vec3((f.x - 0.5) * grout * 0.6, 1.0, (f.y - 0.5) * grout * 0.6));
  }
}
`;
// הזרקות משותפות לכל החומרים שלנו (אחרי החישוב)
const INJ_ROUGH = `
#ifdef LP_PBR
  roughnessFactor = clamp(mix(lpRough, 0.06 + 0.1 * lpRough, lpWetK), 0.04, 1.0);
  metalnessFactor = lpMetal;
#endif
`;
const INJ_COLOR = (body) => `
${body}
float lpWetK = 0.0;
#ifdef LP_WETTABLE
  { float pud = smoothstep(0.55, 0.75, lpN(vLpW.xz / 17.0 + 0.5).g) * step(0.5, lpWet); lpWetK = clamp(lpWet * 0.85 + pud * 0.6, 0.0, 1.0) * step(0.5, lpNW.y);
    lpAlb *= mix(1.0, 0.55, lpWetK); if (pud > 0.5 && lpWet > 0.5) lpNW = vec3(0.0, 1.0, 0.0); }
#endif
diffuseColor.rgb = lpAlb;
`;
const INJ_NORMAL = `
normal = normalize((viewMatrix * vec4(lpNW, 0.0)).xyz);
`;
const INJ_EMIS = `
totalEmissiveRadiance += lpEmis;
`;
const INJ_LIGHT = `
#if defined( RE_IndirectDiffuse )
  irradiance *= lpHemiK;
  { float lt; vec3 front = vLpW + lpNW * vec3(1.6, 0.0, 1.6);
    vec3 la = lpLamp(front, lt);
    float dy = vLpW.y - lt; float att = lpNW.y > 0.6 ? 1.0 : clamp(1.0 - (dy + 1.0) / 11.0, 0.0, 1.0) * 0.85;
    irradiance += la * att * PI;
  }
#endif
`;
const INJ_SPEC = `
#if defined( RE_IndirectSpecular )
  radiance *= lpSpecK;
  #ifdef LP_WETTABLE
  { float lt; vec3 la = lpLamp(vLpW, lt); radiance += la * lpWetK * 0.6; }
  #endif
#endif
`;
const INJ_AO = `
reflectedLight.indirectDiffuse *= lpAO;
reflectedLight.indirectSpecular *= mix(1.0, lpAO, 0.6);
reflectedLight.directDiffuse *= mix(1.0, lpAO, 0.5);
`;
const KIND = {
  wall:    { body: FACADE, defs: { LP_USE_B: '', LP_HASUV: '' } },
  ind:     { body: FACADE, defs: { LP_USE_B: '', LP_HASUV: '', LP_IND: '' } },
  lo:      { body: FACADE_LITE, defs: { LP_USE_B: '' } },
  roof:    { body: ROOF, defs: { LP_USE_B: '', LP_WETTABLE: '' } },
  terrain: { body: TERRAIN, defs: { LP_WETTABLE: '' } },
  road:    { body: ROAD, defs: { LP_USE_A: '', LP_WETTABLE: '' } },
  walk:    { body: WALK, defs: { LP_USE_A: '', LP_WETTABLE: '' } },
  rooftile:{ body: ROOFTILE, defs: { LP_WETTABLE: '' } },
  tile:    { body: ROOFTILE, defs: { LP_WETTABLE: '', LP_USE_B: '', LP_TILE_B: '' } },   // גגות רעפים של וילות (MAT.tile של האינטגרציה), גוון לפי בניין
};
function patchVS(vs) {
  return vs.replace('#include <common>', '#include <common>\n' + MAT_VS_HEAD).replace('#include <project_vertex>', '#include <project_vertex>\n' + MAT_VS_BODY);
}
function patchFS(fs, kind) {
  const k = KIND[kind];
  let s = fs.replace('#include <common>', '#include <common>\n' + MAT_FS_HEAD + (kind === 'rooftile' ? 'uniform vec3 lpRoofTint;\n' : ''));
  s = s.replace('#include <color_fragment>', '#include <color_fragment>\n' + INJ_COLOR(k.body));
  if (s.includes('#include <metalnessmap_fragment>')) s = s.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + INJ_ROUGH);
  s = s.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + INJ_NORMAL);
  s = s.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + INJ_EMIS);
  s = s.replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n' + INJ_LIGHT);
  s = s.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + INJ_SPEC);
  s = s.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + INJ_AO);
  return s;
}

// ------------------------------------------------------------------ עיבוד-אחרי
const AO_FS = `
varying vec2 vUv;
uniform sampler2D tDepth; uniform vec2 uTexel; uniform mat4 uProjInv; uniform float uRadius; uniform float uScale; uniform float uIntensity;
vec3 vp(vec2 uv){ float d = texture2D(tDepth, uv).r; vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = uProjInv * c; return v.xyz / v.w; }
void main(){
  float d0 = texture2D(tDepth, vUv).r;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = vp(vUv);
  vec3 pr = vp(vUv + vec2(uTexel.x, 0.0)), pl = vp(vUv - vec2(uTexel.x, 0.0)), pu = vp(vUv + vec2(0.0, uTexel.y)), pd = vp(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  float ssR = clamp(uRadius * uScale / -P.z, 1.5, 60.0);
  // סיבוב לפי תבנית 4×4 (16 זוויות) — טשטוש תיבה 4×4 בהרכבה מבטל אותה בדיוק (בלי "נקודות" על הקירות)
  vec2 fc = mod(floor(gl_FragCoord.xy), 4.0); float bay = mod(fc.x * 4.0 + fc.y * 7.0 + floor(fc.x * fc.y), 16.0);
  float ang0 = 6.2831853 * (bay + 0.5) / 16.0;
  float sum = 0.0; float r2 = uRadius * uRadius;
  for (int i = 0; i < AO_N; i++) {
    float t = (float(i) + 0.5) / float(AO_N);
    float a = ang0 + t * 6.2831853 * 3.0;
    vec2 off = vec2(cos(a), sin(a)) * t * ssR * uTexel;
    vec3 Q = vp(vUv + off); vec3 v = Q - P; float vv = dot(v, v); float vn = dot(v, N);
    float f = max(r2 - vv, 0.0); sum += f * f * f * max((vn - (0.06 * uRadius + 0.004 * -P.z)) / (0.01 + vv), 0.0);
  }
  float ao = max(0.0, 1.0 - sum * uIntensity * 3.5 / (r2 * r2 * r2 * float(AO_N)));
  ao = mix(ao, 1.0, smoothstep(90.0, 220.0, -P.z));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;
const BLOOM_PRE_FS = `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr; uniform float uExp;
void main(){
  vec3 c = 0.25 * (texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb);
  c *= uExp; float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThr + 0.6, 0.0, 1.2); soft = soft * soft / 4.8;
  c *= max(soft, br - uThr) / max(br, 1e-4);
  gl_FragColor = vec4(min(c, vec3(40.0)), 1.0);
}`;
const BLOOM_DOWN_FS = `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){ gl_FragColor = vec4(0.25 * (texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb), 1.0); }`;
const BLOOM_UP_FS = `
varying vec2 vUv; uniform sampler2D tSrc; uniform sampler2D tLow; uniform vec2 uTexel; uniform float uMix;
void main(){
  vec3 s = texture2D(tLow, vUv).rgb * 4.0;
  s += (texture2D(tLow, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tLow, vUv - vec2(uTexel.x, 0.0)).rgb + texture2D(tLow, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tLow, vUv - vec2(0.0, uTexel.y)).rgb) * 2.0;
  s += texture2D(tLow, vUv + uTexel).rgb + texture2D(tLow, vUv - uTexel).rgb + texture2D(tLow, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tLow, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
  gl_FragColor = vec4(texture2D(tSrc, vUv).rgb + s / 16.0 * uMix, 1.0);
}`;
const COMP_FS = `
varying vec2 vUv;
uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tAO; uniform sampler2D tBloom;
${GLSL_SKYLUT}
uniform vec2 uTexel; uniform vec2 uAOTexel; uniform mat4 uProjInv; uniform mat4 uCamWorld; uniform vec3 uCam;
uniform float uAOStr; uniform float uBloomStr; uniform float uVig; uniform float uFxaa; uniform float uFogOn;
uniform float uFogBeta; uniform float uFogH; uniform float uFogFar; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunScat;
uniform vec3 uGShadow; uniform vec3 uGHigh; uniform float uSat; uniform float uContrast; uniform float uExpo; uniform float uTime; uniform float uGrain; uniform float uCA; uniform float uTone;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
// מיפוי טונים משלנו (זהה ל-three: ACES Filmic / AgX) כדי שההרכבה תוכל לכתוב גם ליעד LDR (מצבי סגנון)
vec3 rrtOdt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 lpACES(vec3 c){ const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= uExpo / 0.6; c = IN * c; c = rrtOdt(c); c = OUT * c; return clamp(c, 0.0, 1.0); }
vec3 agxC(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 lpAgX(vec3 c){
  const mat3 S2R = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 R2S = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 INS = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 OUTS = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  c *= uExpo; c = S2R * c; c = INS * c; c = max(c, 1e-10); c = log2(c); c = (c + 12.47393) / 16.499999; c = clamp(c, 0.0, 1.0); c = agxC(c); c = OUTS * c;
  c = pow(max(vec3(0.0), c), vec3(2.2)); c = R2S * c; return clamp(c, 0.0, 1.0); }
vec3 lpL2S(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 tm(vec3 c){ c *= uExpo; return c / (1.0 + c); }
vec3 sceneAA(vec2 uv){
  vec3 rgbM = texture2D(tScene, uv).rgb;
  if (uFxaa < 0.5) return rgbM;
  vec3 rgbNW = texture2D(tScene, uv + vec2(-1.0, -1.0) * uTexel).rgb, rgbNE = texture2D(tScene, uv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(tScene, uv + vec2(-1.0, 1.0) * uTexel).rgb, rgbSE = texture2D(tScene, uv + vec2(1.0, 1.0) * uTexel).rgb;
  float lNW = lum(tm(rgbNW)), lNE = lum(tm(rgbNE)), lSW = lum(tm(rgbSW)), lSE = lum(tm(rgbSE)), lM = lum(tm(rgbM));
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uTexel;
  vec3 A = 0.5 * (texture2D(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 B = A * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
  float lB = lum(tm(B)); return (lB < lMin || lB > lMax) ? A : B;
}
void main(){
  vec3 c = sceneAA(vUv);
  if (uCA > 0.0) { vec2 o = (vUv - 0.5) * uCA; c.r = texture2D(tScene, vUv + o).r; c.b = texture2D(tScene, vUv - o).b; }   // סטייה כרומטית עדינה של עדשה
  float d = texture2D(tDepth, vUv).r;
  if (d < 0.99999) {
    vec4 vp4 = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 vp = vp4.xyz / vp4.w;
    // SAO מטושטש קלות (5 דגימות)
    float ao = 0.25 * (texture2D(tAO, vUv + vec2(uAOTexel.x, uAOTexel.y)).r + texture2D(tAO, vUv + vec2(-uAOTexel.x, uAOTexel.y)).r + texture2D(tAO, vUv + vec2(uAOTexel.x, -uAOTexel.y)).r + texture2D(tAO, vUv - uAOTexel).r);   // 4 דגימות בילינאריות = תיבה 4×4
    c *= mix(1.0, ao, uAOStr);
    // ערפל גובה+מרחק בצבע השמיים בכיוון המבט (+ פיזור שמש)
    float dist = length(vp);
    vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz; vec3 dir = (wp - uCam) / max(dist, 1e-3);
    float y0 = max(uCam.y, 0.0), y1 = max(wp.y, 0.0), dyy = y1 - y0;
    float hf = abs(dyy) > 1.0 ? (exp(-y0 / uFogH) - exp(-y1 / uFogH)) * uFogH / dyy : exp(-y0 / uFogH);
    hf = max(hf, 0.35);
    float f = 1.0 - exp(-uFogBeta * dist * hf);
    f = max(f, smoothstep(uFogFar * 0.62, uFogFar * 0.98, dist));
    vec3 fc = lpLut(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.35 + 0.015, dir.z)));
    fc += uSunCol * uSunScat * pow(max(dot(dir, uSunDir), 0.0), 8.0);
    c = mix(c, fc, f * uFogOn);
  }
  c += texture2D(tBloom, vUv).rgb * uBloomStr;
  // דירוג צבע (ליניארי, לפני מיפוי טונים): רוויה + גוון צללים/הבהרות
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(L), c, uSat), 0.0);
  c *= mix(uGShadow, uGHigh, smoothstep(0.0, 0.55, L * uExpo));
  vec3 o = lpL2S(uTone > 0.5 ? lpAgX(c) : lpACES(c));
  o = mix(o, o * o * (3.0 - 2.0 * o), uContrast);
  vec2 q = vUv - 0.5; o *= 1.0 - uVig * pow(clamp(length(q * vec2(1.0, 0.8)) * 1.45, 0.0, 1.0), 2.6);
  float gn = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uTime * 7.31, vec2(0.06711056, 0.00583715))));
  o += (gn - 0.5) * (1.0 / 255.0 + uGrain * (1.0 - o * 0.7));   // דיתר + גרעין פילם עדין (חזק יותר בצללים, כמו בחיישן טלפון)
  gl_FragColor = vec4(o, 1.0);
}`;
// כרטיסי זוהר לראשי פנסים (billboard, אדיטיבי) + מפת האור העילית
const LAMPHEAD_VS = `
attribute vec4 aLamp; attribute vec3 aCol;
uniform float uSize; uniform float uBeta;
varying vec2 vQ; varying vec3 vC; varying float vF;
void main(){
  vec3 c = aLamp.xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float dist = length(c - cameraPosition);
  float s = max(uSize, dist * 0.012);
  vec3 p = c + (right * position.x + up * position.y) * s;
  vQ = position.xy * 2.0; vC = aCol; vF = exp(-uBeta * dist) * clamp(uSize / s, 0.25, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const LAMPHEAD_FS = `
varying vec2 vQ; varying vec3 vC; varying float vF; uniform float uI; uniform float uGlare;
void main(){ float r = length(vQ); if (r > 1.0) discard; float core = smoothstep(0.10, 0.02, r); float halo = exp(-r * r * 30.0) * 0.35 + exp(-r * r * 6.0) * 0.03;
  vec2 a = abs(vQ); float streak = (exp(-a.y * 90.0) * (1.0 - a.x) * (1.0 - a.x) + exp(-a.x * 90.0) * (1.0 - a.y) * (1.0 - a.y)) * 0.3 * uGlare;   // כוכב 4 קרניים של עדשת טלפון
  gl_FragColor = vec4(vC * (core * 14.0 + halo * 3.0 + streak) * uI * vF, 1.0); }`;
const LAMPMAP_VS = `
attribute vec4 aLamp; attribute vec3 aCol;
uniform vec4 uRect; uniform float uR;
varying vec2 vOff; varying vec3 vC; varying float vH; varying float vTop;
void main(){
  vec2 p = aLamp.xz + position.xy * uR;
  vOff = position.xy * uR; vC = aCol; vH = max(aLamp.y - aLamp.w, 4.0); vTop = aLamp.y;
  gl_Position = vec4((p - uRect.xy) * uRect.z * 2.0 - 1.0, 0.0, 1.0);
}`;
const LAMPMAP_FS = `
varying vec2 vOff; varying vec3 vC; varying float vH; varying float vTop; uniform float uR; uniform float uEnc;
void main(){ float r = length(vOff); if (r > uR) discard;
  float h2 = vH * vH; float e = pow(h2 / (r * r + h2), 1.5) * (1.0 - smoothstep(uR * 0.6, uR, r));
  gl_FragColor = vec4(vC * e * uEnc, e > 0.015 ? clamp((vTop + 50.0) / 400.0, 0.0, 1.0) : 0.0); }`;

// סגנון: טנזור מבנה (Sobel על צבע) בחצי רזולוציה
const ST_TENSOR_FS = `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uEnc;
void main(){
  vec2 t = uTexel * 2.0;
  vec3 a = texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb, b = texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb, c = texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb;
  vec3 d = texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb, f = texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb, h = texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb, i = texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb;
  vec3 fx = (c + 2.0 * f + i - a - 2.0 * d - g) * 0.25, fy = (g + 2.0 * h + i - a - 2.0 * b - c) * 0.25;
  vec3 st = vec3(dot(fx, fx), dot(fx, fy), dot(fy, fy));
  gl_FragColor = vec4(uEnc < 1.0 ? st * uEnc + vec3(0.0, 0.5, 0.0) : st, 1.0);
}`;
// סגנון: Kuwahara אנאיזוטרופי עם משקלים פולינומיים (Kyprianidis et al. 2009/2011), 8 גזרות
const ST_KUWA_FS = `
varying vec2 vUv; uniform sampler2D tSrc; uniform sampler2D tTen; uniform vec2 uTexel; uniform float uRadius; uniform float uEnc;
void main(){
  vec3 st = texture2D(tTen, vUv).rgb; if (uEnc > 1.0) st = vec3(st.x, st.y - 0.5, st.z) * uEnc;
  float E = st.x, F = st.y, G = st.z;
  float disc = sqrt(max((E - G) * (E - G) + 4.0 * F * F, 0.0));
  float l1 = 0.5 * (E + G + disc), l2 = 0.5 * (E + G - disc);
  vec2 v = vec2(l1 - E, -F); vec2 t = length(v) > 1e-6 ? normalize(v) : vec2(0.0, 1.0);
  float phi = -atan(t.y, t.x);
  float A = (l1 + l2 > 1e-6) ? (l1 - l2) / (l1 + l2) : 0.0;
  float alpha = 1.0, rad = uRadius;
  float a = rad * clamp((alpha + A) / alpha, 0.1, 2.0), b = rad * clamp(alpha / (alpha + A), 0.1, 2.0);
  float cp = cos(phi), sp = sin(phi);
  mat2 SR = mat2(0.5 / a, 0.0, 0.0, 0.5 / b) * mat2(cp, -sp, sp, cp);
  int maxX = int(sqrt(a * a * cp * cp + b * b * sp * sp)), maxY = int(sqrt(a * a * sp * sp + b * b * cp * cp));
  float zeta = 2.0 / rad, eta = 0.25 * 4.0 / 2.0;
  vec4 m[8]; vec3 s[8];
  for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
  for (int j = -8; j <= 8; j++) { if (j < -maxY || j > maxY) continue;
    for (int i = -8; i <= 8; i++) { if (i < -maxX || i > maxX) continue;
      vec2 d = vec2(float(i), float(j)); vec2 w2 = SR * d; if (dot(w2, w2) > 0.25) continue;
      vec3 c = texture2D(tSrc, vUv + d * uTexel * 2.0).rgb; vec3 cc = c * c;
      float sum = 0.0; float wk[8]; float z;
      float vxx = zeta - eta * w2.x * w2.x, vyy = zeta - eta * w2.y * w2.y;
      z = max(0.0, w2.y + vxx); wk[0] = z * z; sum += wk[0];
      z = max(0.0, -w2.x + vyy); wk[2] = z * z; sum += wk[2];
      z = max(0.0, -w2.y + vxx); wk[4] = z * z; sum += wk[4];
      z = max(0.0, w2.x + vyy); wk[6] = z * z; sum += wk[6];
      vec2 r2 = 0.70710678 * vec2(w2.x - w2.y, w2.x + w2.y);
      vxx = zeta - eta * r2.x * r2.x; vyy = zeta - eta * r2.y * r2.y;
      z = max(0.0, r2.y + vxx); wk[1] = z * z; sum += wk[1];
      z = max(0.0, -r2.x + vyy); wk[3] = z * z; sum += wk[3];
      z = max(0.0, -r2.y + vxx); wk[5] = z * z; sum += wk[5];
      z = max(0.0, r2.x + vyy); wk[7] = z * z; sum += wk[7];
      float g = exp(-3.125 * dot(w2, w2)) / max(sum, 1e-6);
      for (int k = 0; k < 8; k++) { float ww = wk[k] * g; m[k] += vec4(c * ww, ww); s[k] += cc * ww; }
    } }
  vec4 o = vec4(0.0);
  for (int k = 0; k < 8; k++) { if (m[k].w <= 0.0) continue; vec3 mu = m[k].rgb / m[k].w; vec3 sg = abs(s[k] / m[k].w - mu * mu);
    float sig2 = sg.r + sg.g + sg.b; float w = 1.0 / (1.0 + pow(255.0 * sig2, 4.0)); o += vec4(mu * w, w); }
  gl_FragColor = vec4(o.w > 0.0 ? o.rgb / o.w : texture2D(tSrc, vUv).rgb, 1.0);
}`;
// סגנון: אימפרסיוניסטי — מכחול (Kuwahara) + "צבע שבור" (רטט גוון/ערך לפי משיכות) + בד קנבס + קצוות רכים אבל קריאים
const ST_IMPR_FS = `
varying vec2 vUv; uniform sampler2D tK; uniform sampler2D tSrc; uniform sampler2D lpNoise; uniform vec2 uTexel; uniform vec2 uKTexel; uniform float uAspect;
void main(){
  vec3 k = texture2D(tK, vUv).rgb;
  vec3 src = texture2D(tSrc, vUv).rgb;
  // משיכות: רעש מוארך לפי כיוון הגרדיאנט של התמונה המצויירת
  vec3 kx = texture2D(tK, vUv + vec2(uKTexel.x, 0.0)).rgb - texture2D(tK, vUv - vec2(uKTexel.x, 0.0)).rgb;
  vec3 ky = texture2D(tK, vUv + vec2(0.0, uKTexel.y)).rgb - texture2D(tK, vUv - vec2(0.0, uKTexel.y)).rgb;
  vec2 gdir = vec2(dot(kx, vec3(0.333)), dot(ky, vec3(0.333)));
  vec2 tang = length(gdir) > 1e-4 ? normalize(vec2(-gdir.y, gdir.x)) : vec2(1.0, 0.0);
  vec2 q = vUv * vec2(uAspect, 1.0) * 70.0;
  vec2 sq = vec2(dot(q, tang), dot(q, vec2(-tang.y, tang.x)) * 3.2);
  vec4 n = texture2D(lpNoise, sq / 64.0);
  vec4 n2 = texture2D(lpNoise, q / 23.0 + 0.37);
  // צבע שבור: כל ערוץ זז מעט אחרת (כמו נגיעות מכחול צבעוניות זו ליד זו)
  vec3 broken = k * (1.0 + (vec3(n.r, n.g, n2.r) - 0.5) * vec3(0.16, 0.12, 0.18));
  float L = dot(broken, vec3(0.299, 0.587, 0.114));
  broken = mix(vec3(L), broken, 1.18);                       // צבעוניות של אימפרסיוניסטים
  broken += (vec3(0.04, 0.02, -0.03) * (1.0 - L) + vec3(-0.02, 0.0, 0.03) * L) * 0.6;   // צללים חמים/סגולים, אור קריר — לפי מונה
  // פרטים קריאים: מעט מהבהירות של המקור
  float ls = dot(src, vec3(0.299, 0.587, 0.114)), lk = dot(k, vec3(0.299, 0.587, 0.114));
  broken += (ls - lk) * 0.22;
  // בד קנבס
  vec2 cv = vUv / uTexel; float weave = (sin(cv.x * 1.9) * sin(cv.y * 1.9)) * 0.5 + 0.5;
  broken *= 0.97 + 0.05 * weave * (0.6 + 0.4 * n2.a);
  gl_FragColor = vec4(clamp(broken, 0.0, 1.0), 1.0);
}`;
// סגנון: צבעי מים — עיוות קל, טשטוש פיגמנט, כהות בקצוות, גרעון נייר, שקיפות
const ST_WATER_FS = `
varying vec2 vUv; uniform sampler2D tSrc; uniform sampler2D lpNoise; uniform vec2 uTexel; uniform float uAspect;
void main(){
  vec2 q = vUv * vec2(uAspect, 1.0);
  vec4 n = texture2D(lpNoise, q * 3.1); vec4 nf = texture2D(lpNoise, q * 17.0 + 0.3);
  vec2 wob = (n.rg - 0.5) * uTexel * 5.0;
  vec2 uv = vUv + wob;
  vec3 c0 = texture2D(tSrc, uv).rgb;
  vec3 acc = c0 * 0.2; float r = 2.5;
  acc += 0.1 * (texture2D(tSrc, uv + vec2(r, 0.0) * uTexel).rgb + texture2D(tSrc, uv - vec2(r, 0.0) * uTexel).rgb + texture2D(tSrc, uv + vec2(0.0, r) * uTexel).rgb + texture2D(tSrc, uv - vec2(0.0, r) * uTexel).rgb);
  acc += 0.1 * (texture2D(tSrc, uv + vec2(r, r) * uTexel).rgb + texture2D(tSrc, uv - vec2(r, r) * uTexel).rgb + texture2D(tSrc, uv + vec2(r, -r) * uTexel).rgb + texture2D(tSrc, uv - vec2(r, -r) * uTexel).rgb);
  vec3 blur = acc;
  float L0 = dot(c0, vec3(0.299, 0.587, 0.114)), Lb = dot(blur, vec3(0.299, 0.587, 0.114));
  float edge = smoothstep(0.02, 0.12, abs(L0 - Lb));
  vec3 c = mix(blur, c0, 0.35);
  float lv = floor(Lb * 6.0 + nf.r * 0.6) / 6.0; c *= mix(1.0, (lv + 0.08) / max(Lb, 0.05), 0.25);   // שטיפות צבע בשכבות
  c = mix(c, vec3(1.0, 0.99, 0.96), 0.14);                         // שקיפות על נייר
  c *= 1.0 - edge * 0.22;                                          // פיגמנט נאסף בקצוות
  c *= 0.93 + 0.1 * nf.a * (1.0 - Lb);                             // גרעון בצבע הכהה
  vec2 pp = vUv / uTexel; float paper = texture2D(lpNoise, pp / 211.0).g * 0.6 + texture2D(lpNoise, pp / 37.0).a * 0.4;
  c *= 0.95 + 0.06 * paper;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// ------------------------------------------------------------------ מצב
const L = {
  world: null, api: null, on: false, tierName: 'medium', cfg: TIERS.medium, THREE: null,
  opts: { post: true, ao: true, bloom: true, shadows: true, materials: true, fog: true, grade: true, lamps: true, dres: !qs.has('lpdr') || qs.get('lpdr') !== '0', tone: 'aces', grain: true, ca: false, glare: true, style: 'photo', progressive: !qs.has('lpprog') || qs.get('lpprog') !== '0' },
  U: null, mats: {}, matCache: {}, swap: new Map(), unswap: new Map(),
  sky: null, lut: null, lutMat: null, dome: null, domeMat: null, envScene: null, envMat: null, pmrem: null, envRT: null,
  noiseRT: null, fs: null, post: null, lampMap: null, heads: null, lampList: [], lampDirty: true, lampCenter: null,
  saved: null, prev: { sunDir: null, key: '' }, envT: 0, sweepT: 0, liteT: 0, sun: null, P: null,
  exp: 1, expTarget: 1, prCur: 0, dresT: 0, perf: { upd: 0, ren: 0, ao: 0, bloom: 0, style: 0, frames: 0 }, half: false, faults: 0,
  styleFn: null, roofTileMats: [],
};
window.LookPro = L.public = {};

function hasHalfFloatRT(r) { const e = r.extensions; return !!(r.capabilities.isWebGL2 && (e.has('EXT_color_buffer_float') || e.has('EXT_color_buffer_half_float'))); }
function mkFS(T) {
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const mesh = new T.Mesh(g); mesh.frustumCulled = false; const scene = new T.Scene(); scene.add(mesh); const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { g, mesh, scene, cam };
}
function pass(mat, rt) { const r = L.world.renderer, f = L.fs; f.mesh.material = mat; r.setRenderTarget(rt); r.render(f.scene, f.cam); }
const shMat = (T, fs, uniforms, extra) => new T.ShaderMaterial(Object.assign({ vertexShader: FS_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false }, extra || {}));

// ------------------------------------------------------------------ טקסטורת רעש + טבלת שמיים
function makeNoise(T, r) {
  const rt = new T.WebGLRenderTarget(256, 256, { type: T.UnsignedByteType, wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, generateMipmaps: true, depthBuffer: false });
  rt.texture.wrapS = rt.texture.wrapT = T.RepeatWrapping; rt.texture.generateMipmaps = true; rt.texture.anisotropy = Math.min(4, r.capabilities.getMaxAnisotropy());
  const m = shMat(T, NOISE_FS, {}); pass(m, rt); m.dispose(); r.setRenderTarget(null); return rt;
}
function makeSky(T) {
  const hf = L.half;
  L.lut = new T.WebGLRenderTarget(64, 32, { type: hf ? T.HalfFloatType : T.UnsignedByteType, wrapS: T.RepeatWrapping, wrapT: T.ClampToEdgeWrapping, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false, generateMipmaps: false });
  L.lut.texture.wrapS = T.RepeatWrapping;
  const V3 = () => new T.Vector3(), C3 = () => new T.Vector3();
  L.lutMat = shMat(T, LUT_FS, { sunDir: { value: V3() }, betaR: { value: V3() }, betaM: { value: V3() }, sunE: { value: 0 }, sunfade: { value: 1 }, mieG: { value: 0.8 }, kSky: { value: 1 },
    nightZen: { value: C3() }, nightHor: { value: C3() }, cityGlow: { value: C3() }, moonSky: { value: C3() }, hazeCol: { value: C3() }, haze: { value: 0 }, overcast: { value: 0 }, overcastCol: { value: C3() } });
  const du = { tLut: { value: L.lut.texture }, lpNoise: L.U.lpNoise, sunDir: { value: V3() }, sunCol: { value: C3() }, sunDisc: { value: 0 }, cloud: { value: 0.3 }, cloudOff: { value: new T.Vector2() }, cloudScale: { value: 0.16 },
    cloudLit: { value: C3() }, cloudAmb: { value: C3() }, groundRad: { value: C3() }, envMode: { value: 0 } };
  L.domeMat = new T.ShaderMaterial({ vertexShader: DOME_VS, fragmentShader: DOME_FS, uniforms: du, side: T.BackSide, depthWrite: false, depthTest: true, fog: false });
  L.dome = new T.Mesh(new T.SphereGeometry(1, 32, 16), L.domeMat); L.dome.frustumCulled = false; L.dome.renderOrder = 1e6; L.dome.name = 'lp-sky';
  L.envMat = L.domeMat.clone(); L.envMat.uniforms = Object.assign({}, du, { envMode: { value: 1 } });
  L.envScene = new T.Scene(); const em = new T.Mesh(new T.SphereGeometry(10, 24, 12), L.envMat); em.frustumCulled = false; L.envScene.add(em);
}

// ------------------------------------------------------------------ סביבה: שמש, שמיים, תאורה
function skyState(world) {
  const T = L.THREE, w = world.weather || {}, el = world.sun.elevation || 0, sd = world.sun.dir;
  const sunDir = new T.Vector3(sd.x, sd.y, sd.z).normalize();
  const aqi = w.aqi || 0, haze = clamp((aqi - 25) / 200, 0, 0.8), cloud = clamp(w.cloud || 0, 0, 1), rain = clamp((w.rain || 0) / 8, 0, 1);
  const vis = isFinite(w.visibility) && w.visibility > 0 ? w.visibility : 20000;
  // מעבר שמש: Rayleigh + אירוסול לפי מסת אוויר (Kasten–Young)
  const e = Math.max(el, -0.9), m = 1 / (Math.sin(e * D2R) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
  const tau550 = 0.09 + haze * 0.55 + (1 - Math.min(1, vis / 20000)) * 0.4;
  const tauR = [0.0399, 0.0937, 0.2090], lam = [0.68, 0.55, 0.45];
  const Tr = tauR.map((t, i) => Math.exp(-(t + tau550 * Math.pow(lam[i] / 0.55, -1.1)) * m));
  const up = smooth(-1.2, 1.5, el);
  const cf = 1 - 0.8 * Math.pow(cloud, 1.6) - 0.15 * rain;
  const sunCol = norm3(Tr), sunI = 6.4 * Math.pow(0.2126 * Tr[0] + 0.7152 * Tr[1] + 0.0722 * Tr[2], 0.4) * up * Math.max(cf, 0.05);
  const night = clamp((2 - el) / 8, 0, 1), dark = clamp((-el - 1) / 11, 0, 1);
  const P = skyParams(sunDir, 2.0 + haze * 6 + cloud * 1.2, 1.0 + 0.6 * (1 - up), 0.004 + haze * 0.012, 0.78);
  return { el, sunDir, haze, cloud, rain, vis, sunCol, sunI, night, dark, P, up, cf, tau550 };
}
const K_SKY = 0.55;      // Preetham → יחידות הסצנה (מכויל מול גוון הצהריים #3D7CC9 של מחלקת האווירה)
function applySky(world, force) {
  const T = L.THREE, S = skyState(world); L.sun = S;
  const u = L.lutMat.uniforms, P = S.P;
  u.sunDir.value.copy(S.sunDir); u.betaR.value.fromArray(P.betaR); u.betaM.value.fromArray(P.betaM); u.sunE.value = P.sunE; u.sunfade.value = P.sunfade; u.mieG.value = P.mieG; u.kSky.value = K_SKY;
  // לילה: כחול-כהה + זוהר עירוני (אשדוד: נתרן/LED) + פיזור אור ירח; ערכים ליניאריים מכוילים לחשיפת הלילה
  const moon = world.providers.moon ? safe(() => world.providers.moon()) : null;
  const mAlt = moon ? moon.altApparent : -90, mPh = moon && moon.phase != null ? moon.phase : 0.5;
  const mk = smooth(-1, 8, mAlt) * (0.2 + 0.8 * mPh) * S.dark;
  const nz = S.dark * (1 - 0.6 * S.cloud);
  u.nightZen.value.set(0.0016, 0.0024, 0.0058).multiplyScalar(nz);
  u.nightHor.value.set(0.0050, 0.0058, 0.0095).multiplyScalar(nz);
  u.cityGlow.value.set(0.010, 0.0068, 0.0042).multiplyScalar(S.dark * (1 + 1.5 * S.cloud + 1.5 * S.haze));
  u.moonSky.value.set(MOON_TINT[0], MOON_TINT[1], MOON_TINT[2]).multiplyScalar(0.004 * mk);
  const hz = S.dark > 0.5 ? [0.23, 0.21, 0.2] : [0.85, 0.72, 0.55]; u.hazeCol.value.set(hz[0], hz[1], hz[2]); u.haze.value = S.haze * 0.8;
  // עננות כבדה / גשם: שמיים אפורים אחידים
  const oc = smooth(0.7, 1.0, S.cloud) * 0.85 + S.rain * 0.3;
  const zen = skyJS(P, { x: 0, y: 1, z: 0 }, S.sunDir).map(v => v * K_SKY);
  const ocL = (zen[0] * 0.2126 + zen[1] * 0.7152 + zen[2] * 0.0722) * 0.75 + 0.002;
  u.overcast.value = clamp(oc, 0, 0.9); u.overcastCol.value.set(ocL * 0.95, ocL, ocL * 1.04);
  L.fs && pass(L.lutMat, L.lut); world.renderer.setRenderTarget(null);
  // כיפה
  const d = L.domeMat.uniforms;
  d.sunDir.value.copy(S.sunDir); d.sunCol.value.set(S.sunCol[0], S.sunCol[1], S.sunCol[2]).multiplyScalar(S.up * Math.max(S.cf, 0.02)); d.sunDisc.value = 900 * (1 - S.cloud * 0.7);
  const YB = window.YZBeauty && window.YZBeauty.clouds || {};
  d.cloud.value = clamp(Math.max(YB.min != null ? YB.min : 0.28, S.cloud), 0, 1); d.cloudScale.value = 0.16 * (YB.scale || 1);
  const lit = S.sunCol.map(v => v * S.sunI * 0.11 + 0.0);
  const amb = [zen[0] * 0.9 + 0.012 * S.dark + ocL * 0.4, zen[1] * 0.9 + 0.009 * S.dark + ocL * 0.4, zen[2] * 0.9 + 0.007 * S.dark + ocL * 0.4];
  d.cloudLit.value.set(lit[0], lit[1], lit[2]); d.cloudAmb.value.set(amb[0], amb[1], amb[2]);
  // קרינת הקרקע (לסביבה): אלבדו 0.22 × (שמש + שמיים)
  const skyAvg = avgSky(P, S.sunDir).map((v, i) => v * K_SKY + [0.0016, 0.0024, 0.0058][i] * nz + [0.010, 0.0068, 0.0042][i] * S.dark * 0.5);
  { const Lm = 0.2126 * skyAvg[0] + 0.7152 * skyAvg[1] + 0.0722 * skyAvg[2]; for (let i = 0; i < 3; i++) skyAvg[i] = Lm + (skyAvg[i] - Lm) * 0.55; }
  L.skyAvg = skyAvg;
  const gE = S.sunI * Math.max(0, S.sunDir.y) / Math.PI;
  d.groundRad.value.set((S.sunCol[0] * gE + skyAvg[0]) * 0.24, (S.sunCol[1] * gE + skyAvg[1]) * 0.21, (S.sunCol[2] * gE + skyAvg[2]) * 0.17);
  L.envMat.uniforms.envMode.value = 1;
  // מצב חלונות: תפוסה לפי השעה המקומית
  const hr = localHour(world); L.U.lpOcc.value = occupancy(hr); L.U.lpNight.value = S.night * S.night * (3 - 2 * S.night);
  L.U.lpWet.value = clamp((world.weather.rain || 0) / 2.5, 0, 1);
  L.U.lpSunW.value.copy(S.sunDir);
  // חשיפה (הסתגלות עין): יום 0.78 → דמדומים → לילה 2.6
  const el = S.el;
  let ex = el >= 25 ? 0.72 : el >= 5 ? lerp(0.92, 0.72, (el - 5) / 20) : el >= 0 ? lerp(1.15, 0.92, el / 5) : el >= -6 ? lerp(1.9, 1.15, (el + 6) / 6) : el >= -12 ? lerp(2.4, 1.9, (el + 12) / 6) : 2.4;
  ex *= 1 + 0.35 * S.cloud * S.up + 0.15 * S.rain;
  L.expTarget = ex; if (force) L.exp = ex;
  L.envDirty = true;
}
function skyJS(P, d, sd) {   // אותו עיבוד כמו ב-LUT (רוויה + כהות זנית), לפני kSky
  const c = preethamJS(P, d, sd), ct = d.x * sd.x + d.y * sd.y + d.z * sd.z, sw = Math.pow(Math.max(ct, 0), 6), S = 1.9 + (1 - 1.9) * sw;
  const Lm = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], dk = 1 - 0.38 * Math.pow(Math.max(d.y, 0), 0.8);
  return c.map(v => Math.max(0, Lm + (v - Lm) * S) * dk);
}
function avgSky(P, sd) { const acc = [0, 0, 0]; let n = 0; for (const e of [12, 35, 65]) for (let a = 0; a < 360; a += 60) { const c = Math.cos(e * D2R); const v = skyJS(P, { x: c * Math.cos(a * D2R), y: Math.sin(e * D2R), z: c * Math.sin(a * D2R) }, sd); acc[0] += v[0]; acc[1] += v[1]; acc[2] += v[2]; n++; } return acc.map(v => v / n); }
function localHour(world) { const d = world.clock.date || new Date(); let off = 120; try { off = world.G27.SIM.israelOffsetMin(d); } catch (e) { /* */ } const l = new Date(d.getTime() + off * 60000); return l.getUTCHours() + l.getUTCMinutes() / 60; }
function safe(f) { try { return f(); } catch (e) { return null; } }

function lights(world, dt) {
  const S = L.sun; if (!S) return;
  const sl = world.sunLight, hemi = world.hemi, T = L.THREE;
  const moon = world.providers.moon ? safe(() => world.providers.moon()) : null;
  if (sl) {
    if (S.up > 0.001) { sl.color.setRGB(S.sunCol[0], S.sunCol[1], S.sunCol[2]); sl.intensity = S.sunI; L.lightDir = S.sunDir; }
    else if (moon && moon.altApparent > 0 && moon.vec) { const mk = smooth(0, 10, moon.altApparent) * (0.25 + 0.75 * (moon.phase != null ? moon.phase : 0.5));
      sl.color.setRGB(MOON_TINT[0], MOON_TINT[1], MOON_TINT[2]); sl.intensity = 0.05 * mk * (1 - 0.8 * S.cloud); L.lightDir = new T.Vector3(moon.vec.x, moon.vec.y, moon.vec.z).normalize(); }
    else { sl.intensity = 0; L.lightDir = S.sunDir; }
    const wantShadow = L.cfg.shadow > 0 && L.opts.shadows && sl.intensity > 0.08 && L.lightDir.y > 0.02;
    sl.castShadow = wantShadow;
  }
  if (hemi) {
    const a = L.skyAvg || [0.1, 0.12, 0.16];
    hemi.color.setRGB(a[0], a[1], a[2]); hemi.intensity = Math.PI;
    const g = L.domeMat.uniforms.groundRad.value; hemi.groundColor.setRGB(g.x, g.y, g.z);
  }
  // IBL מחליף את ההמיספרה בחומרים שלנו כשיש PMREM
  L.U.lpHemiK.value = (L.envRT && L.cfg.pmrem) ? 0.0 : 1.0;
  L.U.lpWinK.value = 0.55;
}

// מפת צל אחת: כדור חוסם של פרוסת המבט [0, D] של המצלמה, מוצמד לטקסל
function fitShadow(world) {
  const sl = world.sunLight; if (!sl || !sl.castShadow || !L.lightDir) return;
  const T = L.THREE, cam = world.camera, sh = sl.shadow, ms = L.cfg.shadow;
  if (sh.mapSize.x !== ms) { sh.mapSize.set(ms, ms); if (sh.map) { sh.map.dispose(); sh.map = null; } }
  sh.radius = L.cfg.sRadius;
  const alt = Math.max(0, cam.position.y - Math.max(0, world.data.H(cam.position.x, cam.position.z)));
  const D = clamp(70 + alt * 1.3, 70, 380);
  const fov = cam.fov * D2R, hh = Math.tan(fov / 2) * D, hw = hh * cam.aspect;
  const c = (D * D + hw * hw + hh * hh) / (2 * D), cc = Math.min(c, D);
  let R = Math.max(cc, Math.sqrt((D - cc) ** 2 + hw * hw + hh * hh)); R = Math.ceil(R / 5) * 5;
  const fwd = L._v1 || (L._v1 = new T.Vector3()); cam.getWorldDirection(fwd);
  const ctr = (L._v2 || (L._v2 = new T.Vector3())).copy(cam.position).addScaledVector(fwd, cc);
  const ld = L.lightDir, z = ld, x = (L._v3 || (L._v3 = new T.Vector3())).set(0, 1, 0).cross(z); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
  const y = (L._v4 || (L._v4 = new T.Vector3())).copy(z).cross(x);
  const texel = 2 * R / ms, px = ctr.dot(x), py = ctr.dot(y);
  ctr.addScaledVector(x, Math.round(px / texel) * texel - px).addScaledVector(y, Math.round(py / texel) * texel - py);
  const sc = sh.camera; sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.near = 1; sc.far = R * 2 + 900; sc.updateProjectionMatrix();
  sl.target.position.copy(ctr); sl.position.copy(ctr).addScaledVector(ld, R + 600);
  sl.target.updateMatrixWorld(); sl.updateMatrixWorld();
  const graze = 1 - Math.max(0, Math.min(1, ld.y / 0.35));            // שמש נמוכה → יותר הטיה (בלי "אקנה" על קירות ורכבים)
  sh.bias = -0.0004 - 0.0006 * graze; sh.normalBias = texel * (2.2 + 2.5 * graze) + 0.06;
}

// ------------------------------------------------------------------ PMREM מהשמיים
function updateEnv(world, force) {
  if (!L.cfg.pmrem) { if (world.scene.environment === (L.envRT && L.envRT.texture)) world.scene.environment = null; return; }
  const now = performance.now(); if (!force && (!L.envDirty || now - L.envT < 1500)) return;
  L.envDirty = false; L.envT = now;
  const r = world.renderer, T = L.THREE; if (!L.pmrem) L.pmrem = new T.PMREMGenerator(r);
  const t0 = performance.now();
  const prevRT = L.envRT;
  const rt = L.pmrem.fromScene(L.envScene, 0, 0.1, 100, { size: L.cfg.pmrem });
  L.envRT = rt; world.scene.environment = rt.texture; world.scene.environmentIntensity = 1;
  if (prevRT && prevRT !== rt) prevRT.dispose();
  r.setRenderTarget(null);
  L.perf.envMs = performance.now() - t0;
}

// ------------------------------------------------------------------ חומרים: יצירה, החלפה, תכונות גאומטריה
function makeMat(kind) {
  const T = L.THREE, pbr = L.cfg.pbr, det = L.cfg.detail;
  const key = kind + '|' + (pbr ? 1 : 0) + '|' + det;
  if (L.matCache[key]) return L.matCache[key];
  const M = pbr ? new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 }) : new T.MeshLambertMaterial({ color: 0xffffff });
  if (kind === 'terrain') M.vertexColors = true;
  if (kind === 'road') { M.polygonOffset = true; M.polygonOffsetFactor = -2; M.polygonOffsetUnits = -4; }
  if (kind === 'walk') { M.polygonOffset = true; M.polygonOffsetFactor = -1; M.polygonOffsetUnits = -2; }
  M.defines = Object.assign({ LP_DETAIL: det }, KIND[kind].defs, pbr ? { LP_PBR: '' } : {});
  if (pbr) M.envMapIntensity = kind === 'road' || kind === 'walk' || kind === 'terrain' ? 0.65 : 0.7;   // IBL מהשמיים — מאוזן מול שמש חמה (ניגוד אור חם / צל קריר)
  M.name = 'lp-' + kind;
  const U = L.U;
  M.onBeforeCompile = sh => {
    for (const k in U) sh.uniforms[k] = U[k];
    if (kind === 'rooftile') sh.uniforms.lpRoofTint = M.userData.tint;
    sh.vertexShader = patchVS(sh.vertexShader); sh.fragmentShader = patchFS(sh.fragmentShader, kind);
  };
  M.customProgramCacheKey = () => 'lookpro-' + VERSION + '-' + key;
  if (kind === 'rooftile') M.userData.tint = { value: new T.Vector3(...hexLin('#B5643C')) };
  L.matCache[key] = M; return M;
}
function buildMats(world) {
  const MAT = world.data.MAT; L.swap.clear(); L.unswap.clear();
  const pairs = { wall: 'wall', ind: 'ind', roof: 'roof', lo: 'lo', terrain: 'terrain', road: 'road', walk: 'walk', tile: 'tile' };
  for (const [k, kind] of Object.entries(pairs)) { if (!MAT[k]) continue; const m = makeMat(kind); L.mats[kind] = m; L.swap.set(MAT[k], m); L.unswap.set(m, MAT[k]); }
}
function swapIn(o, map) {
  const m = o.material; if (!m) return false;
  if (Array.isArray(m)) { let ch = false; const n = m.map(x => { const y = map.get(x); if (y) { ch = true; return y; } return x; }); if (ch) o.material = n; return ch; }
  const y = map.get(m); if (y) { o.material = y; return true; } return false;
}
function sweep(world, map) {
  const want = map === L.swap;
  // החלפה רק במשים של בניינים/קרקע (אריחי העולם + ציוני דרך של מחלקת הבניינים) — לעולם לא רכבים/דמויות/משים אחרים שחולקים חומר
  if (want) { const tm = L.tileMeshes || (L.tileMeshes = new WeakSet()); for (const t of world.data.tiles.values()) { for (const m of [t.hi, t.lo, t.terrain]) if (m) tm.add(m); if (t.roadGrp) t.roadGrp.children.forEach(c => tm.add(c)); } }
  world.scene.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; if (want && !(L.tileMeshes.has(o) || (o.userData && o.userData.landmark))) return; if (swapIn(o, map) && want) ensureAttr(o); });
  for (const t of world.data.tiles.values()) { for (const m of [t.hi, t.lo]) if (m && !m.parent) swapIn(m, map); }
}
function styleOf(b) {
  let st = b.ind ? 1 : 0, fam = 0;
  if (L.styleFn) { const r = safe(() => L.styleFn(b)); if (r) { const s = typeof r === 'string' ? r : r.style; if (s === 'industrial') st = 1; else if (s === 'villa') st = 2; else if (s === 'tower') st = 3; else if (s === 'apartment') st = 0;
      if (r.family) fam = { plaster: 1, stone: 2, shikun: 3, accent: 4 }[r.family] || 0; return st + fam / 10; } }
  // טיפולוגיה של העולם (W27.tyOf של האינטגרציה: ind/tower/villa/block) — אותו סיווג כמו גגות הרעפים והגינות
  const W = L.world && L.world.data && L.world.data.W;
  if (W && W.tyOf) { const ty = safe(() => W.tyOf(b)); if (ty === 'ind') st = 1; else if (ty === 'villa') st = 2; else if (ty === 'tower') st = 3; else st = 0; return st + fam / 10; }
  const h = (b.top - b.base) || 0;
  if (!b.ind && h >= 33) st = 3;
  else if (!b.ind && (b.floors || 0) <= 2 && h < 9.5 && b.area < 260 && hash01(b.id + 'v') < 0.6) st = 2;
  return st + fam / 10;
}
// תכונת lpB לכל קודקוד: [hash, סגנון, גובה, בסיס] — משוחזר לפי סדר הבנייה של world.js (קירות מגורים, קירות תעשייה, גגות)
function augBuildings(t, mesh, lo) {
  const g = mesh.geometry; if (!g || g.attributes.lpB) return;
  const pos = g.attributes.position.array, nv = pos.length / 3, B = new Float32Array(nv * 4);
  const list = (t.blds || []).filter(b => !(lo && b.area < 70)); let v = 0;
  const put = (b, cnt) => { const hs = hash01(b.id), st = styleOf(b), h = b.top - b.base; for (let k = 0; k < cnt && v < nv; k++, v++) { B[v * 4] = hs; B[v * 4 + 1] = st; B[v * 4 + 2] = h; B[v * 4 + 3] = b.base; } };
  for (const pass of [0, 1]) for (const b of list) {
    if (!!b.ind !== (pass === 1)) continue;
    let p = b.p, n = b.n;
    if (lo && n > 6) { const keep = []; let lx = p[0], lz = p[1]; keep.push(lx, lz);
      for (let i = 1; i < n; i++) { const x = p[i * 2], z = p[i * 2 + 1]; if (Math.hypot(x - lx, z - lz) > 1.5) { keep.push(x, z); lx = x; lz = z; } }
      if (keep.length >= 6) { p = keep; n = keep.length / 2; } }
    let cnt = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]) >= 0.05) cnt += 6; }
    put(b, cnt);
  }
  if (!lo && g.groups && g.groups[2] && g.groups[2].start !== v) { L.stats.wallMismatch = (L.stats.wallMismatch || 0) + 1; v = Math.min(v, g.groups[2].start); }
  // גגות: משולשים ברצף (שטוחים, ואז גגות רעפים של וילות — קודקוד 0 בפינת הגג עם בליטה 0.45 מ'); מתאימים לפי גובה הגג ותיבת התחום
  const own = (b, x, y, z) => Math.abs(y - b.top) < 0.02 && x >= b.minx - 1.0 && x <= b.maxx + 1.0 && z >= b.minz - 1.0 && z <= b.maxz + 1.0;
  let k = 0, miss = 0;
  for (; v + 2 < nv; v += 3) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (!(k < list.length && own(list[k], x, y, z))) { let f = -1; for (let j = k + 1; j < list.length; j++) if (own(list[j], x, y, z)) { f = j; break; } if (f < 0) { for (let j = 0; j < list.length; j++) if (own(list[j], x, y, z)) { f = j; break; } } if (f >= 0) k = f; else miss++; }
    const b = list[k] || list[0]; if (!b) break; const hs = hash01(b.id), st = styleOf(b), h = b.top - b.base;
    for (let q = 0; q < 3; q++) { const w = v + q; B[w * 4] = hs; B[w * 4 + 1] = st; B[w * 4 + 2] = h; B[w * 4 + 3] = b.base; }
  }
  g.setAttribute('lpB', new L.THREE.BufferAttribute(B, 4));
  L.stats.aug++; if (miss) L.stats.roofMiss += miss;
}
function augRoad(mesh, walk) {
  const g = mesh.geometry; if (!g || g.attributes.lpA || !g.attributes.uv) return;
  const p = g.attributes.position.array, uv = g.attributes.uv.array, nv = p.length / 3, A = new Float32Array(nv * 2);
  for (let q = 0; q + 5 < nv; q += 6) {
    const w = Math.hypot(p[q * 3] - p[(q + 2) * 3], p[q * 3 + 2] - p[(q + 2) * 3 + 2]) || 7;
    const half = walk ? Math.max(1, w / 2 - 2.5) : w / 2;
    for (let i = 0; i < 6; i++) { A[(q + i) * 2] = (uv[(q + i) * 2] - 0.5) * w; A[(q + i) * 2 + 1] = half; }
  }
  g.setAttribute('lpA', new L.THREE.BufferAttribute(A, 2));
}
function ensureAttr(o) {   // מש שמשתמש בחומר החזית בלי lpB (למשל מגדלי הדקל) — תכונה קבועה לפי התיבה, hash לפי מיקום האובייקט
  const g = o.geometry, mm = Array.isArray(o.material) ? o.material : [o.material];
  const needB = mm.some(m => m === L.mats.wall || m === L.mats.ind || m === L.mats.roof || m === L.mats.lo || m === L.mats.tile);
  if (needB && !g.attributes.lpB && g.attributes.position) {
    if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox, nv = g.attributes.position.count, B = new Float32Array(nv * 4);
    const h = bb.max.y - bb.min.y, st = h >= 33 ? 3 : 0;
    for (let i = 0; i < nv; i++) { B[i * 4] = -1; B[i * 4 + 1] = st; B[i * 4 + 2] = h; B[i * 4 + 3] = bb.min.y; }
    g.setAttribute('lpB', new L.THREE.BufferAttribute(B, 4));
  }
  const needA = mm.some(m => m === L.mats.road || m === L.mats.walk);
  if (needA && !g.attributes.lpA) augRoad(o, mm.includes(L.mats.walk));
}
function onTile(t, kind) {
  if (kind === 'remove' || !t) return;
  if (t.hi) augBuildings(t, t.hi, false);
  if (t.lo) augBuildings(t, t.lo, true);
  if (t.roadGrp) for (const c of t.roadGrp.children) { const m = c.material; const isW = m === L.world.data.MAT.walk || m === L.mats.walk; augRoad(c, isW); }
  if (L.opts.materials) { for (const m of [t.hi, t.lo, t.terrain]) if (m) swapIn(m, L.swap); if (t.roadGrp) t.roadGrp.children.forEach(c => swapIn(c, L.swap)); }
  L.lampDirty = true;
}

// ------------------------------------------------------------------ פנסים: מפת אור עילית + כרטיסי זוהר
function lampSources(world) {
  const P = world.player.pos, out = [], R = L.cfg.lampSize * 0.75, R2 = R * R, H = world.data.H;
  const pl = world.providers.lamps;
  if (pl && pl.length) {
    for (const l of pl) { const d2 = (l.x - P.x) ** 2 + (l.z - P.z) ** 2; if (d2 > R2) continue; const y = l.y != null ? l.y : Math.max(0, H(l.x, l.z));
      const col = l.kind === 'lamp_ornate_red_double' ? LAMP_COL.warm3000 : l.kind === 'lamp_led_white' ? LAMP_COL.led5000 : l.type === 'sodium' ? LAMP_COL.sodium : LAMP_COL.led4000;
      out.push({ x: l.x, z: l.z, top: y + 8.2, g: y, col, k: l.type === 'sodium' ? 0.8 : 1.0 }); }
    return out;
  }
  for (const t of world.data.tiles.values()) for (const r of t.roads || []) {
    if (r.c < 1) continue; const p = r.p, off = r.w / 2 + 1.2; let acc = 0, side = 1;
    for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, Lg = Math.hypot(dx, dz) || 1;
      for (let s = 28 - acc; s < Lg; s += 28) { const x = ax + dx * s / Lg, z = az + dz * s / Lg; side = -side; if ((x - P.x) ** 2 + (z - P.z) ** 2 > R2) continue;
        const lx = x - dz / Lg * side * off, lz = z + dx / Lg * side * off, g = Math.max(0, H(lx, lz)), hs = hash01((lx | 0) + ':' + (lz | 0));
        out.push({ x: lx - dz / Lg * side * -1.6, z: lz + dx / Lg * side * -1.6, top: g + 8.2, g, col: hs < 0.25 ? LAMP_COL.sodium : hs < 0.85 ? LAMP_COL.led4000 : LAMP_COL.led5000, k: hs < 0.25 ? 0.8 : 1.0 }); }
      acc = (acc + Lg) % 28; } }
  return out;
}
function makeLamps(T, group) {
  const MAX = 900;
  const ig = new T.InstancedBufferGeometry(); const pg = new T.PlaneGeometry(1, 1); ig.index = pg.index; ig.setAttribute('position', pg.attributes.position);
  const aL = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4), aC = new T.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  ig.setAttribute('aLamp', aL); ig.setAttribute('aCol', aC); ig.instanceCount = 0;
  const hm = new T.ShaderMaterial({ vertexShader: LAMPHEAD_VS, fragmentShader: LAMPHEAD_FS, uniforms: { uSize: { value: 3.6 }, uBeta: { value: 0.0006 }, uI: { value: 1 }, uGlare: { value: 1 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
  const heads = new T.Mesh(ig, hm); heads.frustumCulled = false; heads.renderOrder = 5; heads.name = 'lp-lampheads'; group.add(heads);
  // מפת האור
  const res = L.cfg.lampRes, hf = L.half;
  const rt = new T.WebGLRenderTarget(res, res, { type: hf ? T.HalfFloatType : T.UnsignedByteType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false, generateMipmaps: false });
  const qg = new T.InstancedBufferGeometry(); qg.index = pg.index; qg.setAttribute('position', pg.attributes.position); qg.setAttribute('aLamp', aL); qg.setAttribute('aCol', aC);
  // ב-PlaneGeometry(1,1) המיקום הוא ±0.5 → מכפילים ×2 כדי לקבל ±1
  const mm = new T.ShaderMaterial({ vertexShader: LAMPMAP_VS.replace('position.xy * uR', 'position.xy * 2.0 * uR').replace('vOff = position.xy * uR', 'vOff = position.xy * 2.0 * uR'), fragmentShader: LAMPMAP_FS,
    uniforms: { uRect: { value: new T.Vector4() }, uR: { value: 24 }, uEnc: { value: hf ? 1 : 0.25 } }, depthTest: false, depthWrite: false,
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendEquationAlpha: T.MaxEquation, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneFactor });
  const qm = new T.Mesh(qg, mm); qm.frustumCulled = false; const sc = new T.Scene(); sc.add(qm);
  L.lampMap = { rt, scene: sc, mesh: qm, mat: mm, ig, qg, aL, aC, MAX, cam: new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), hf };
  L.heads = heads;
  L.U.lpLampMap.value = rt.texture;
}
function rebuildLamps(world) {
  const LM = L.lampMap; if (!LM) return; const r = world.renderer, P = world.player.pos, S = L.cfg.lampSize;
  const cx = Math.round(P.x / 64) * 64 - S / 2, cz = Math.round(P.z / 64) * 64 - S / 2;
  const src = L.opts.lamps ? lampSources(world) : []; const n = Math.min(src.length, LM.MAX);
  src.sort((a, b) => ((a.x - P.x) ** 2 + (a.z - P.z) ** 2) - ((b.x - P.x) ** 2 + (b.z - P.z) ** 2));
  const a = LM.aL.array, c = LM.aC.array;
  for (let i = 0; i < n; i++) { const l = src[i]; a[i * 4] = l.x; a[i * 4 + 1] = l.top; a[i * 4 + 2] = l.z; a[i * 4 + 3] = l.g; c[i * 3] = l.col[0] * 3.2 * l.k; c[i * 3 + 1] = l.col[1] * 3.2 * l.k; c[i * 3 + 2] = l.col[2] * 3.2 * l.k; }
  LM.aL.needsUpdate = LM.aC.needsUpdate = true; LM.ig.instanceCount = LM.qg.instanceCount = n;
  LM.mat.uniforms.uRect.value.set(cx, cz, 1 / S, 0);
  const prevClear = r.getClearColor(new L.THREE.Color()), prevA = r.getClearAlpha();
  r.setClearColor(0x000000, 0); pass2(LM.scene, LM.cam, LM.rt); r.setClearColor(prevClear, prevA);
  L.U.lpLampRect.value.set(cx, cz, 1 / S, LM.hf ? 1 : 4);
  L.lampCenter = { x: P.x, z: P.z }; L.lampCount = n; L.lampDirty = false;
}
function pass2(scene, cam, rt) { const r = L.world.renderer; r.setRenderTarget(rt); r.render(scene, cam); r.setRenderTarget(null); }

// ------------------------------------------------------------------ עיבוד-אחרי: יעדים ומעברים
function buildPost(world) {
  const T = L.THREE, r = world.renderer, cfg = L.cfg;
  if (!cfg.post || !L.half) { L.post = null; return; }
  const samples = Math.min(cfg.msaa, r.capabilities.maxSamples || 0);
  const size = r.getDrawingBufferSize(new T.Vector2()); const w = Math.max(2, size.x), h = Math.max(2, size.y);
  const dt = new T.DepthTexture(w, h); dt.type = T.UnsignedIntType;
  const scene = new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType, samples, depthTexture: dt, depthBuffer: true, minFilter: T.LinearFilter, magFilter: T.LinearFilter, generateMipmaps: false });
  const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
  const ao = new T.WebGLRenderTarget(hw, hh, { type: T.UnsignedByteType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter });
  const down = [], up = [];
  for (let i = 0; i < cfg.bloom; i++) { const s = 1 << (i + 1); down.push(new T.WebGLRenderTarget(Math.max(1, (w / s) | 0), Math.max(1, (h / s) | 0), { type: T.HalfFloatType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter }));
    up.push(new T.WebGLRenderTarget(Math.max(1, (w / s) | 0), Math.max(1, (h / s) | 0), { type: T.HalfFloatType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter })); }
  const V2 = () => new T.Vector2(), M4 = () => new T.Matrix4(), V3 = () => new T.Vector3();
  const aoM = shMat(T, AO_FS, { tDepth: { value: dt }, uTexel: { value: V2() }, uProjInv: { value: M4() }, uRadius: { value: 1.4 }, uScale: { value: 500 }, uIntensity: { value: 1.0 } });
  aoM.defines = { AO_N: Math.max(1, cfg.ao) };
  const preM = shMat(T, BLOOM_PRE_FS, { tSrc: { value: scene.texture }, uTexel: { value: V2() }, uThr: { value: 1.25 }, uExp: { value: 1 } });
  const dnM = shMat(T, BLOOM_DOWN_FS, { tSrc: { value: null }, uTexel: { value: V2() } });
  const upM = shMat(T, BLOOM_UP_FS, { tSrc: { value: null }, tLow: { value: null }, uTexel: { value: V2() }, uMix: { value: 1 } });
  const compM = new T.ShaderMaterial({ vertexShader: FS_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { tScene: { value: scene.texture }, tDepth: { value: dt }, tAO: { value: ao.texture }, tBloom: { value: null }, tLut: { value: L.lut.texture },
      uTexel: { value: V2() }, uAOTexel: { value: V2() }, uProjInv: { value: M4() }, uCamWorld: { value: M4() }, uCam: { value: V3() },
      uAOStr: { value: 0.85 }, uBloomStr: { value: 0.55 }, uVig: { value: 0.22 }, uFxaa: { value: samples ? 0 : 1 }, uFogOn: { value: 1 },
      uFogBeta: { value: 0.0006 }, uFogH: { value: 90 }, uFogFar: { value: 1150 }, uSunDir: { value: V3() }, uSunCol: { value: V3() }, uSunScat: { value: 0 },
      uGShadow: { value: V3().set(1, 1, 1) }, uGHigh: { value: V3().set(1, 1, 1) }, uSat: { value: 1.05 }, uContrast: { value: 0.12 }, uExpo: { value: 1 }, uTime: { value: 0 }, uGrain: { value: 0.02 }, uCA: { value: 0 }, uTone: { value: 0 } } });
  // 1×1 שחור כשאין זוהר
  const black = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const white = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  L.post = { scene, dt, ao, down, up, aoM, preM, dnM, upM, compM, w, h, samples, black, white };
}
// ------------------------------------------------------------------ שיפור הדרגתי: רמה 0 בתנועה (בלי AO/צבירה), 1 אחרי 0.5 ש' (AO), 2 אחרי 3 ש' (צבירת דגימות + "גבוהה")
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
function progress(world, cam) {
  const P = L.prog || (L.prog = { m: new L.THREE.Matrix4(), still: 0, level: 0, n: 0, t: performance.now(), sun: 0 });
  const now = performance.now(), dt = Math.min(0.25, (now - P.t) / 1000); P.t = now;
  const e = cam.matrixWorld.elements, q = P.m.elements; let d = 0; for (let i = 0; i < 16; i++) d += Math.abs(e[i] - q[i]);
  const sunMoved = Math.abs((L.sun ? L.sun.el : 0) - P.sun) > 0.05;
  if (d > 1e-4 || sunMoved || L.progReset) { P.still = 0; P.n = 0; P.m.copy(cam.matrixWorld); P.sun = L.sun ? L.sun.el : 0; L.progReset = false; }
  else P.still += dt;
  const lv = P.still >= 3 ? 2 : P.still >= 0.5 ? 1 : 0;
  if (lv !== P.level) { P.level = lv; P.n = 0; }
  if (lv === 2) P.n++;
  return P;
}
const ACC_FS = `varying vec2 vUv; uniform sampler2D tCur; uniform sampler2D tPrev; uniform float uA; void main(){ gl_FragColor = vec4(mix(texture2D(tPrev, vUv).rgb, texture2D(tCur, vUv).rgb, uA), 1.0); }`;
const COPY_FS = `varying vec2 vUv; uniform sampler2D tSrc; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`;
function accTargets(p) {
  if (p.acc) return p.acc; const T = L.THREE, o = { type: T.UnsignedByteType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter };
  p.acc = { cur: new T.WebGLRenderTarget(p.w, p.h, o), read: new T.WebGLRenderTarget(p.w, p.h, o), write: new T.WebGLRenderTarget(p.w, p.h, o),
    m: shMat(T, ACC_FS, { tCur: { value: null }, tPrev: { value: null }, uA: { value: 1 } }), copy: shMat(T, COPY_FS, { tSrc: { value: null } }) };
  return p.acc;
}
// ------------------------------------------------------------------ מצבי סגנון (אופציונליים, כבויים כברירת מחדל): אימפרסיוניסטי (Kuwahara אנאיזוטרופי), צבעי מים
function stylePass(world, p) {
  if (p.style) return p.style;
  const T = L.THREE, w = p.w, h = p.h, hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
  const o = { type: T.UnsignedByteType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter };
  const ldr = new T.WebGLRenderTarget(w, h, o), ten = new T.WebGLRenderTarget(hw, hh, Object.assign({}, o, { type: L.half ? T.HalfFloatType : T.UnsignedByteType })), kuw = new T.WebGLRenderTarget(hw, hh, o);
  const V2 = () => new T.Vector2();
  const tenM = shMat(T, ST_TENSOR_FS, { tSrc: { value: ldr.texture }, uTexel: { value: V2() }, uEnc: { value: L.half ? 1 : 0.125 } });
  const kuwM = shMat(T, ST_KUWA_FS, { tSrc: { value: ldr.texture }, tTen: { value: ten.texture }, uTexel: { value: V2() }, uRadius: { value: 4 }, uEnc: { value: L.half ? 1 : 8 } });
  const impM = shMat(T, ST_IMPR_FS, { tK: { value: kuw.texture }, tSrc: { value: ldr.texture }, lpNoise: L.U.lpNoise, uTexel: { value: V2() }, uKTexel: { value: V2() }, uAspect: { value: w / h }, uSeed: { value: 0 } });
  const watM = shMat(T, ST_WATER_FS, { tSrc: { value: ldr.texture }, lpNoise: L.U.lpNoise, uTexel: { value: V2() }, uAspect: { value: w / h } });
  p.style = { ldr, ten, kuw, tenM, kuwM, impM, watM };
  return p.style;
}
function runStyle(world, p, sp, style) {
  const t0 = performance.now();
  if (style === 'impressionist') {
    sp.tenM.uniforms.uTexel.value.set(1 / p.w, 1 / p.h); pass(sp.tenM, sp.ten);
    sp.kuwM.uniforms.uTexel.value.set(1 / p.w, 1 / p.h); sp.kuwM.uniforms.uRadius.value = 4.0 * Math.max(1, p.h / 900); pass(sp.kuwM, sp.kuw);
    sp.impM.uniforms.uTexel.value.set(1 / p.w, 1 / p.h); sp.impM.uniforms.uKTexel.value.set(1 / sp.kuw.width, 1 / sp.kuw.height); pass(sp.impM, null);
  } else { sp.watM.uniforms.uTexel.value.set(1 / p.w, 1 / p.h); pass(sp.watM, null); }
  L.perf.style = (L.perf.style || 0) + ((performance.now() - t0) - (L.perf.style || 0)) * 0.1;
}
function disposeStyle(p) { const s = p.style; if (!s) return; [s.ldr, s.ten, s.kuw].forEach(t => t.dispose()); [s.tenM, s.kuwM, s.impM, s.watM].forEach(m => m.dispose()); p.style = null; }
function disposePost() {
  const p = L.post; if (!p) return; disposeStyle(p);
  if (p.acc) { [p.acc.cur, p.acc.read, p.acc.write].forEach(t => t.dispose()); p.acc.m.dispose(); p.acc.copy.dispose(); p.acc = null; }
  [p.scene, p.ao, ...p.down, ...p.up].forEach(t => t.dispose()); p.dt.dispose();
  [p.aoM, p.preM, p.dnM, p.upM, p.compM].forEach(m => m.dispose()); p.black.dispose(); p.white.dispose(); L.post = null;
}
function ensurePostSize(world) {
  const r = world.renderer, s = r.getDrawingBufferSize(L._sz || (L._sz = new L.THREE.Vector2()));
  if (!L.post || L.post.w !== s.x || L.post.h !== s.y) { disposePost(); buildPost(world); }
}

// ------------------------------------------------------------------ ציור
function renderFrame(world, orig) {
  const r = world.renderer, scene = world.scene, cam = world.camera, T = L.THREE, t0 = performance.now();
  if (L.atmoOn || !L.sun) { orig(scene, cam); return; }
  if (L.photoReq) {   // צילום בודד (גם בשכבה חסכונית): צינור עיבוד-אחרי זמני לפריים אחד + סגנון
    const req = L.photoReq; L.photoReq = null; const sc = L.cfg, sp = L.post, ss = L.opts.style, so = L.opts.post;
    try { if (!L.post && L.half) { L.cfg = Object.assign({}, TIERS.medium, { pbr: sc.pbr, detail: sc.detail, lampRes: sc.lampRes, lampSize: sc.lampSize }); buildPost(world); }
      L.opts.style = req.style || ss; L.opts.post = true; renderFrame(world, orig);
      req.ok(r.domElement.toDataURL('image/jpeg', 0.92)); }
    catch (e) { req.ok(null); }
    finally { if (!sp && L.post) disposePost(); L.cfg = sc; L.opts.style = ss; L.opts.post = so; }
    return;
  }
  // מיקום-תלוי: מפת צל, מרכז הפנסים
  if (L.dome && !L.dome.parent) L.group.add(L.dome);
  fitShadow(world);
  const P = world.player.pos;
  if (L.lampMap && (L.U.lpNight.value > 0.02 || L.U.lpLampOn.value > 0.5)) {
    const moved = !L.lampCenter || Math.hypot(P.x - L.lampCenter.x, P.z - L.lampCenter.z) > L.cfg.lampSize * 0.2;
    if ((moved || L.lampDirty) && performance.now() - (L.lampT || 0) > 1500) { L.lampT = performance.now(); rebuildLamps(world); }
  }
  const lampsOn = L.opts.lamps && L.U.lpNight.value > 0.02;
  L.U.lpLampOn.value = lampsOn ? 1 : 0; L.U.lpLampRect.value.w = (L.lampMap && L.lampMap.hf ? 1 : 4) * smooth(0.0, 0.5, L.U.lpNight.value);
  if (L.heads) { L.heads.visible = lampsOn; const hu = L.heads.material.uniforms; hu.uI.value = smooth(0.0, 0.6, L.U.lpNight.value); hu.uBeta.value = L.fogBeta || 0.0006; hu.uGlare.value = L.opts.glare ? 1 : 0; }
  r.toneMapping = L.opts.tone === 'agx' ? T.AgXToneMapping : T.ACESFilmicToneMapping;
  r.toneMappingExposure = L.exp;
  const fog = scene.fog; const fNear = fog ? fog.near : 0, fFar = fog ? fog.far : 0;
  L.fogFar = fFar || 1150;
  const usePost = L.post && L.opts.post;
  if (!usePost) {
    if (fog && L.fogCol) fog.color.copy(L.fogCol);
    orig(scene, cam); L.perf.ren += (performance.now() - t0 - L.perf.ren) * 0.05; return;
  }
  ensurePostSize(world);
  const p = L.post; r.info.autoReset = false; r.info.reset();
  // 1) סצנה → HDR (בלי ערפל קדמי: הערפל בעיבוד-אחרי, לפי עומק)
  if (fog) { fog.near = 1e6; fog.far = 2e6; }
  // שיפור הדרגתי (עיקרון של אריאל: מתחילים מהר ומינימלי, נשארים במקום → האיכות עולה): ריצוד תת-פיקסלי לצבירה כשהמצלמה עומדת
  const PR = progress(world, cam), jit = PR.level >= 2 && L.opts.progressive;
  if (jit) { const hx = halton(PR.n % 16 + 1, 2) - 0.5, hy = halton(PR.n % 16 + 1, 3) - 0.5; cam.projectionMatrix.elements[8] += hx * 2 / p.w; cam.projectionMatrix.elements[9] += hy * 2 / p.h; }
  r.setRenderTarget(p.scene); orig(scene, cam);
  if (jit) cam.updateProjectionMatrix();
  if (fog) { fog.near = fNear; fog.far = fFar; }
  const tS = performance.now();
  // 2) SAO
  const proj = cam.projectionMatrix, pinv = cam.projectionMatrixInverse;
  const aoOn = L.cfg.ao > 0 && L.opts.ao && (PR.level >= 1 || !L.opts.progressive);
  if (aoOn) { const u = p.aoM.uniforms; u.uTexel.value.set(1 / p.w, 1 / p.h); u.uProjInv.value.copy(pinv); u.uScale.value = proj.elements[5] * 0.5 * p.h; pass(p.aoM, p.ao); }
  const tA = performance.now();
  // 3) זוהר
  let bloomTex = p.black.texture || p.black;
  if (L.cfg.bloom > 0 && L.opts.bloom && p.down.length) {
    const pu = p.preM.uniforms; pu.uTexel.value.set(0.5 / p.w, 0.5 / p.h); pu.uExp.value = L.exp; pass(p.preM, p.down[0]);
    for (let i = 1; i < p.down.length; i++) { const s = p.down[i - 1]; p.dnM.uniforms.tSrc.value = s.texture; p.dnM.uniforms.uTexel.value.set(0.5 / s.width, 0.5 / s.height); pass(p.dnM, p.down[i]); }
    let low = p.down[p.down.length - 1];
    for (let i = p.down.length - 2; i >= 0; i--) { const u = p.upM.uniforms; u.tSrc.value = p.down[i].texture; u.tLow.value = low.texture; u.uTexel.value.set(1 / low.width, 1 / low.height); u.uMix.value = 1.0; pass(p.upM, p.up[i]); low = p.up[i]; }
    bloomTex = low.texture;
  }
  const tB = performance.now();
  // 4) הרכבה → מסך
  const S = L.sun, cu = p.compM.uniforms;
  cu.tBloom.value = bloomTex; cu.tAO.value = aoOn ? p.ao.texture : p.white; cu.uAOStr.value = aoOn ? 0.85 : 0;
  cu.uTexel.value.set(1 / p.w, 1 / p.h); cu.uAOTexel.value.set(1 / p.ao.width, 1 / p.ao.height);
  cu.uProjInv.value.copy(pinv); cu.uCamWorld.value.copy(cam.matrixWorld); cu.uCam.value.setFromMatrixPosition(cam.matrixWorld);
  cu.uBloomStr.value = 0.22 + 0.26 * L.U.lpNight.value;
  cu.uFogOn.value = L.opts.fog ? 1 : 0; cu.uFogBeta.value = L.fogBeta || 0.0006; cu.uFogFar.value = L.fogFar; cu.uFogH.value = 70 + 60 * (1 - (S ? S.haze : 0));
  if (S) { cu.uSunDir.value.copy(S.sunDir); cu.uSunCol.value.set(S.sunCol[0], S.sunCol[1], S.sunCol[2]); cu.uSunScat.value = S.sunI * 0.05 * (0.4 + S.haze); }
  cu.uExpo.value = L.exp; cu.uTime.value = (world.clock.frame % 64);
  cu.uGrain.value = L.opts.grain ? 0.016 + 0.02 * L.U.lpNight.value : 0; cu.uCA.value = L.opts.ca ? 0.0035 : 0; cu.uTone.value = L.opts.tone === 'agx' ? 1 : 0;
  grade(cu);
  const style = L.opts.style && L.opts.style !== 'photo' ? L.opts.style : null;
  if (jit) {   // צבירה (TAA פשוט בלי הקרנה מחדש — רק כשהמצלמה עומדת; מתאפס בכל תנועה)
    const A = accTargets(p); pass(p.compM, A.cur);
    const a = Math.max(1 / Math.min(PR.n + 1, 12), 0.18); A.m.uniforms.tCur.value = A.cur.texture; A.m.uniforms.tPrev.value = A.read.texture; A.m.uniforms.uA.value = PR.n === 0 ? 1 : a;
    pass(A.m, A.write); const t = A.read; A.read = A.write; A.write = t;
    if (style) { const sp = stylePass(world, p); A.copy.uniforms.tSrc.value = A.read.texture; pass(A.copy, sp.ldr); runStyle(world, p, sp, style); }
    else { A.copy.uniforms.tSrc.value = A.read.texture; pass(A.copy, null); }
  } else if (style) { const sp = stylePass(world, p); pass(p.compM, sp.ldr); runStyle(world, p, sp, style); }
  else { if (p.style) disposeStyle(p); pass(p.compM, null); }
  r.info.autoReset = true;
  const t1 = performance.now();
  const k = 0.05; L.perf.ren += (t1 - t0 - L.perf.ren) * k; L.perf.ao += ((tA - tS) - (L.perf.ao || 0)) * k; L.perf.bloom += ((tB - tA) - (L.perf.bloom || 0)) * k;
}
function grade(cu) {
  const n = L.U.lpNight.value, S = L.sun, g = S ? clamp(1 - Math.abs(S.el - 6) / 9, 0, 1) * (1 - S.cloud) : 0;
  if (!L.opts.grade) { cu.uSat.value = 1; cu.uContrast.value = 0; cu.uVig.value = 0; cu.uGShadow.value.set(1, 1, 1); cu.uGHigh.value.set(1, 1, 1); return; }
  // יום: ים-תיכוני חם, צללים נייטרליים-קרירים; שעת זהב: חום בהבהרות; לילה (תמונות 01:00): צללים כחולים-כהים, אור פנסים חם
  const sh = [lerp(0.98, 0.86, n), lerp(1.0, 0.95, n), lerp(1.03, 1.18, n)];
  const hi = [lerp(1.03, 1.06, n) + 0.05 * g, lerp(1.0, 0.98, n) + 0.01 * g, lerp(0.95, 0.88, n) - 0.05 * g];
  const wb = [1.0 + 0.05 * (1 - n) + 0.16 * g, 1.0 + 0.02 * g, 1.0 - 0.07 * (1 - n) - 0.2 * g];   // איזון לבן של "מצלמה" (יום: חמים עדין; שעת זהב: זהוב)
  cu.uGShadow.value.set(sh[0] * wb[0], sh[1] * wb[1], sh[2] * wb[2]); cu.uGHigh.value.set(hi[0] * wb[0], hi[1] * wb[1], hi[2] * wb[2]);
  cu.uSat.value = lerp(1.1, 0.92, n); cu.uContrast.value = lerp(0.14, 0.08, n); cu.uVig.value = lerp(0.2, 0.32, n);
}

// ------------------------------------------------------------------ עדכון לכל פריים
// חלוקת בעלות: כשמודול האווירה (Z.atmo) פעיל הוא הבעלים של שמיים/שמש/חשיפה/ערפל/לילה/עיבוד-אחרי — look-pro עובר למצב "סרק"
// (לא ממפה טונים, לא זוהר, לא דירוג, לא מחליף חומרים). atmo-lite ו-beauty (גישורי האינטגרציה) מושבתים זמנית כשאנחנו הבעלים.
function handover(world) {
  const pl = YZW.plugins(), st = id => { const x = pl.find(p => p.id === id); return x ? x.state : null; };
  const atmo = st('atmosphere') === 'on';
  if (atmo !== !!L.atmoOn) {
    L.atmoOn = atmo;
    if (atmo) { sweep(world, L.unswap); if (world.sky) world.sky.visible = L.saved ? L.saved.skyVis : true; if (L.dome) L.dome.visible = false; if (L.heads) L.heads.visible = false; world.scene.environment = null; YZW.notice('מודול האווירה פעיל — "מראה מקצועי" במצב סרק (רזולוציה בלבד)', { kind: 'info', ms: 3000 }); }
    else { if (L.dome) L.dome.visible = true; L.envDirty = true; if (L.opts.materials) sweep(world, L.swap); }
  }
  if (atmo) return;
  for (const id of ['atmo-lite', 'beauty']) if (st(id) === 'on') { YZW.enable(id, false, true); (L.handed || (L.handed = new Set())).add(id); }
}
function update(dt, world) {
  const t0 = performance.now();
  if (L.atmoOn) { pixelRatio(world, dt); L.liteT -= dt; if (L.liteT <= 0) { L.liteT = 2; handover(world); } return; }
  if (!L.sun) applySky(world, true);
  // הסתגלות חשיפה
  L.exp += (L.expTarget - L.exp) * (1 - Math.exp(-dt * 1.6));
  lights(world, dt);
  // ערפל: אלומה לפי ראות + אובך; צבע הערפל הקדמי (שכבה חסכונית) = צבע השמיים באופק לכיוון המצלמה
  const S = L.sun, w = world.weather;
  const vis = Math.min(S.vis, 30000) / (1 + S.haze * 2.2 + S.rain * 1.5);
  L.fogBeta = 3.0 / Math.max(vis, 600) + 0.00012;
  if (!L.fogCol) L.fogCol = new L.THREE.Color();
  { const cam = world.camera, f = L._v5 || (L._v5 = new L.THREE.Vector3()); cam.getWorldDirection(f); f.y = 0.02; f.normalize();
    const c = skyJS(S.P, f, S.sunDir).map(v => v * K_SKY); const nz = S.dark;
    L.fogCol.setRGB(c[0] + 0.006 * nz + 0.01 * nz, c[1] + 0.0065 * nz + 0.007 * nz, c[2] + 0.01 * nz + 0.004 * nz); }
  // עננים נעים עם הרוח (מקור הרוח האחד)
  if (L.domeMat) { const o = L.domeMat.uniforms.cloudOff.value, wv = w.wind || { x: 0, z: 0 }, YB = window.YZBeauty && window.YZBeauty.clouds || {}, k = 0.00035 * (YB.speed != null ? YB.speed / 0.012 : 1);
    o.x += ((wv.x || 0) * k + 0.00012) * dt; o.y += ((wv.z || 0) * k + 0.00005) * dt; }
  // PMREM מתעדכן לאט (רק כששינוי מספיק)
  updateEnv(world, false);
  // רזולוציה דינמית
  pixelRatio(world, dt);
  // ניקוי תקופתי: החלפת חומרים במשים חדשים (מגדלים של מחלקת הבניינים וכו'), השבתת atmo-lite אם עלה מחדש
  L.sweepT -= dt; if (L.sweepT <= 0) { L.sweepT = 1.0; if (L.opts.materials && !L.atmoOn) sweep(world, L.swap); }
  L.liteT -= dt; if (L.liteT <= 0) { L.liteT = 2; handover(world); }
  if (world.sky && world.sky.visible) world.sky.visible = false;
  world.providers.look = { night: L.U.lpNight.value, exposure: L.exp, lampMap: L.lampMap && L.lampMap.rt.texture, lampRect: L.U.lpLampRect.value, sun: S, version: VERSION };
  L.perf.upd += (performance.now() - t0 - L.perf.upd) * 0.05; L.perf.frames++;
}
function setBoost(world, on) {
  if (!!L.boost === on) return; L.boost = on;
  const base = TIERS[L.tierName] || TIERS.medium;
  L.cfg = on ? Object.assign({}, TIERS.high, { detail: base.detail, pbr: base.pbr, lampRes: base.lampRes, lampSize: base.lampSize }) : base;
  disposePost(); buildPost(world); L.envDirty = true; L.prCur = 0;
}
function pixelRatio(world, dt) {
  // שדרוג אוטומטי: בינונית עם fps ≥ 55 במשך 8 ש' → תכונות "גבוהה" (צל 2048, SAO 10, זוהר 5, DPR עד 2); ירידה מתחת ל-40 fps במשך 3 ש' → חזרה
  if (L.tierName === 'medium' && L.opts.dres && L.cfg.post !== false) {
    const fps = world.stats.fps; L.boostT = (L.boostT || 0) + dt;
    if (!L.boost) { if (fps >= 55) { if (L.boostT > 8) { setBoost(world, true); L.boostT = 0; } } else L.boostT = 0; }
    else { if (fps < 40) { if (L.boostT > 3) { setBoost(world, false); L.boostT = 0; } } else L.boostT = 0; }
  }
  const r = world.renderer, dpr = window.devicePixelRatio || 1, cap = Math.min(dpr, L.cfg.pr), floor = Math.min(dpr, L.cfg.prMin);
  if (!L.prCur) L.prCur = cap;
  if (L.opts.dres && L.cfg.post) {
    const fps = world.stats.fps; L.dresT += dt;
    if (L.dresT > 1.5) { if (fps < 40 && L.prCur > floor) { L.prCur = Math.max(floor, L.prCur - 0.125); L.dresT = 0; } else if (fps > 57 && L.prCur < cap) { L.prCur = Math.min(cap, L.prCur + 0.125); L.dresT = 0; } else if (L.dresT > 4) L.dresT = 0; }
  } else L.prCur = cap;
  if (Math.abs(r.getPixelRatio() - L.prCur) > 0.01) r.setPixelRatio(L.prCur);
}

// ------------------------------------------------------------------ אתחול / שחרור
async function init(world, api) {
  const T = L.THREE = window.THREE; L.world = world; L.api = api; L.stats = { aug: 0, roofMiss: 0 };
  const r = world.renderer;
  if (!r.capabilities.isWebGL2) throw new Error('נדרש WebGL2');
  L.half = hasHalfFloatRT(r) && !qs.has('lpnohalf');
  L.tierName = world.quality.tier; L.cfg = TIERS[L.tierName] || TIERS.medium;
  if (!L.half && L.cfg.post) L.fallbackNote = 'אין יעד HDR (half-float) — עיבוד-אחרי כבוי';
  L.saved = { exp: r.toneMappingExposure, tm: r.toneMapping, pr: r.getPixelRatio(), shadowSize: world.sunLight ? world.sunLight.shadow.mapSize.x : 1024, shadowR: world.sunLight ? world.sunLight.shadow.radius : 1,
    bias: world.sunLight ? world.sunLight.shadow.bias : 0, nbias: world.sunLight ? world.sunLight.shadow.normalBias : 0, skyVis: world.sky ? world.sky.visible : true, scLeft: world.sunLight ? world.sunLight.shadow.camera.left : 85 };
  L.fs = mkFS(T);
  // אחידים משותפים — נשמרים בין הפעלות (החומרים במטמון ממשיכים להצביע עליהם → הפעלה מחדש בלי קומפילציה)
  if (!L.U) L.U = { lpNoise: { value: null }, lpLampMap: { value: null }, lpLampRect: { value: new T.Vector4(0, 0, 1 / 512, 1) }, lpLampOn: { value: 0 }, lpNight: { value: 0 }, lpOcc: { value: 0.2 },
    lpWet: { value: 0 }, lpHemiK: { value: 1 }, lpWinK: { value: 0.55 }, lpSunW: { value: new T.Vector3(0, 1, 0) } };
  L.noiseRT = makeNoise(T, r); L.U.lpNoise.value = L.noiseRT.texture;
  makeSky(T);
  L.group = api.group('lookpro'); L.group.add(L.dome);
  makeLamps(T, L.group);
  applySky(world, true); updateEnv(world, true);
  buildPost(world);
  buildMats(world);
  // קומפילציה מקבילית (KHR_parallel_shader_compile) לפני ההחלפה — בלי קפיצה בטלפון
  if (L.opts.materials) {
    const dummy = new T.Scene(); const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)); g.setAttribute('normal', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2)); g.setAttribute('color', new T.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3)); g.setAttribute('lpB', new T.Float32BufferAttribute(new Float32Array(12), 4)); g.setAttribute('lpA', new T.Float32BufferAttribute(new Float32Array(6), 2));
    for (const m of Object.values(L.mats)) { const o = new T.Mesh(g, m); o.receiveShadow = o.castShadow = true; dummy.add(o); }
    try { if (r.compileAsync) await Promise.race([r.compileAsync(dummy, world.camera, world.scene), new Promise(ok => setTimeout(ok, 9000))]); } catch (e) { /* קומפילציה רגילה בפריים הבא */ }
    g.dispose();
  }
  api.eachTile((t, kind) => onTile(t, kind));
  if (L.opts.materials) sweep(world, L.swap);
  if (world.sky) world.sky.visible = false;
  api.on('env', () => applySky(world, false));
  api.on('quality', q => retier(world, q.tier));
  api.on('lamps', () => { L.lampDirty = true; });
  api.on('tile', () => { L.lampDirty = true; });
  L.on = true; L.exp = L.expTarget;
  addEventListener('resize', L._rs = () => { L.prCur = 0; });
  if (L.fallbackNote) api.notice(L.fallbackNote, { kind: 'info' });
}
function retier(world, tier) {
  if (tier === L.tierName) return;
  L.tierName = tier; L.cfg = TIERS[tier] || TIERS.medium; L.prCur = 0; L.boost = false; L.boostT = 0;
  // חומרים חדשים לשכבה (PBR/Lambert, רמת פירוט)
  const MAT = world.data.MAT; sweep(world, L.unswap); buildMats(world); if (L.opts.materials) sweep(world, L.swap);
  for (const t of world.data.tiles.values()) onTile(t, 'lod');
  disposePost(); buildPost(world);
  if (L.lampMap) { L.lampMap.rt.setSize(L.cfg.lampRes, L.cfg.lampRes); L.lampDirty = true; }
  if (!L.cfg.pmrem && world.scene.environment) { world.scene.environment = null; } L.envDirty = true; updateEnv(world, true);
}
function dispose(world) {
  L.on = false;
  try { sweep(world, L.unswap); } catch (e) { /* */ }
  disposePost();
  const r = world.renderer;
  if (L.envRT) { if (world.scene.environment === L.envRT.texture) world.scene.environment = null; L.envRT.dispose(); L.envRT = null; }
  if (L.pmrem) { L.pmrem.dispose(); L.pmrem = null; }
  if (L.lut) { L.lut.dispose(); L.lut = null; } if (L.lutMat) L.lutMat.dispose(); if (L.envMat) L.envMat.dispose();
  if (L.noiseRT) { L.noiseRT.dispose(); L.noiseRT = null; }
  if (L.lampMap) { L.lampMap.rt.dispose(); L.lampMap.mat.dispose(); L.lampMap.qg.dispose(); L.lampMap = null; }
  if (L.fs) { L.fs.g.dispose(); L.fs = null; }
  const s = L.saved;
  if (s) { r.toneMappingExposure = s.exp; r.toneMapping = s.tm;
    const sl = world.sunLight; if (sl) { sl.shadow.mapSize.set(s.shadowSize, s.shadowSize); if (sl.shadow.map) { sl.shadow.map.dispose(); sl.shadow.map = null; } sl.shadow.radius = s.shadowR; sl.shadow.bias = s.bias; sl.shadow.normalBias = s.nbias;
      const sc = sl.shadow.camera; sc.left = sc.bottom = -s.scLeft; sc.right = sc.top = s.scLeft; sc.near = 1; sc.far = 900; sc.updateProjectionMatrix(); }
    if (world.sky) world.sky.visible = s.skyVis; }
  // המשחק מחזיר את יחס הפיקסלים, האורות והערפל שלו
  try { world.G27.setQuality(({ low: 2, medium: 1, high: 0 })[world.quality.tier]); } catch (e) { /* */ }
  try { world.G27.applyEnv(); } catch (e) { /* */ }
  world.providers.look = null;
  removeEventListener('resize', L._rs);
  L.sun = null; L.post = null; L.dome = null; L.heads = null; L.mats = {}; L.swap.clear(); L.unswap.clear(); L.prCur = 0; L.envDirty = true; L.lampCenter = null;
  if (L.U) { L.U.lpNoise.value = null; L.U.lpLampMap.value = null; }
  if (L.handed) { const ids = [...L.handed]; L.handed = null; setTimeout(() => ids.forEach(id => YZW.enable(id, true, true)), 0); }
  L.atmoOn = false;
}

// ------------------------------------------------------------------ הגדרות (בגיליון המארח, בעברית)
const settings = [
  { id: 'lp.post', label: 'עיבוד-אחרי (ערפל עומק, AO, זוהר, דירוג צבע)', type: 'toggle', get: () => L.opts.post, set: v => { L.opts.post = !!v; } },
  { id: 'lp.ao', label: 'הצללה סביבתית (SSAO)', type: 'toggle', get: () => L.opts.ao, set: v => { L.opts.ao = !!v; } },
  { id: 'lp.bloom', label: 'זוהר אורות (Bloom)', type: 'toggle', get: () => L.opts.bloom, set: v => { L.opts.bloom = !!v; } },
  { id: 'lp.shadows', label: 'צללים רכים עוקבי מצלמה', type: 'toggle', get: () => L.opts.shadows, set: v => { L.opts.shadows = !!v; } },
  { id: 'lp.mat', label: 'חומרים פרוצדורליים (חזיתות, כבישים, מדרכות)', type: 'toggle', get: () => L.opts.materials, set: v => { L.opts.materials = !!v; if (L.world) sweep(L.world, v ? L.swap : L.unswap); } },
  { id: 'lp.lamps', label: 'פנסי רחוב (מפת אור)', type: 'toggle', get: () => L.opts.lamps, set: v => { L.opts.lamps = !!v; L.lampDirty = true; } },
  { id: 'lp.grade', label: 'דירוג צבע לפי תמונות השטח', type: 'toggle', get: () => L.opts.grade, set: v => { L.opts.grade = !!v; } },
  { id: 'lp.dres', label: 'רזולוציה דינמית', type: 'toggle', get: () => L.opts.dres, set: v => { L.opts.dres = !!v; L.prCur = 0; } },
  { id: 'lp.tone', label: 'מיפוי טונים', type: 'select', options: [['aces', 'ACES'], ['agx', 'AgX']], get: () => L.opts.tone, set: v => { L.opts.tone = v; } },
  { id: 'lp.style', label: 'סגנון תמונה', type: 'select', options: [['photo', 'פוטוריאליסטי'], ['impressionist', 'אימפרסיוניסטי'], ['watercolor', 'צבעי מים']], get: () => L.opts.style, set: v => { L.opts.style = v;
      if (v !== 'photo' && L.world && !L.post) YZW.notice('סגנון ציורי זמין באיכות בינונית ומעלה; בחסכונית — רק בצילום (LookPro.photo)', { kind: 'info' }); } },
  { id: 'lp.prog', label: 'שיפור הדרגתי כשעומדים במקום (צבירת דגימות, AO)', type: 'toggle', get: () => L.opts.progressive, set: v => { L.opts.progressive = !!v; L.progReset = true; } },
  { id: 'lp.grain', label: 'גרעין פילם עדין', type: 'toggle', get: () => L.opts.grain, set: v => { L.opts.grain = !!v; } },
  { id: 'lp.ca', label: 'סטייה כרומטית של עדשה (עדינה)', type: 'toggle', get: () => L.opts.ca, set: v => { L.opts.ca = !!v; } },
  { id: 'lp.glare', label: 'הילת עדשה סביב פנסים', type: 'toggle', get: () => L.opts.glare, set: v => { L.opts.glare = !!v; } },
];

// ------------------------------------------------------------------ מדידה: מ"ש לכל תכונה
// LookPro.bench({frames}) → [{name, js, gpu, calls, tris}] — js = זמן JS של render (כולל עדכוני המודולים), gpu = עד gl.finish (בארגז: SwiftShader = מעבד)
async function bench(o = {}) {
  const world = L.world, r = world.renderer, gl = r.getContext(), N = o.frames || 6, out = [];
  const save = Object.assign({}, L.opts, { style: L.opts.style || 'photo' });
  const configs = o.configs || [
    ['בסיס (ללא look-pro)', null],
    ['look-pro: ישיר (ללא עיבוד-אחרי, ללא צל)', { post: false, shadows: false, materials: true }],
    ['+ צללים', { post: false, shadows: true, materials: true }],
    ['+ עיבוד-אחרי בסיסי (HDR+MSAA+ערפל+דירוג)', { post: true, ao: false, bloom: false, shadows: true, materials: true }],
    ['+ SSAO', { post: true, ao: true, bloom: false, shadows: true, materials: true }],
    ['+ זוהר = הכול', { post: true, ao: true, bloom: true, shadows: true, materials: true }],
    ['הכול בלי חומרים פרוצדורליים', { post: true, ao: true, bloom: true, shadows: true, materials: false }],
    ['הכול + סגנון אימפרסיוניסטי', { post: true, ao: true, bloom: true, shadows: true, materials: true, style: 'impressionist' }],
    ['הכול + סגנון צבעי מים', { post: true, ao: true, bloom: true, shadows: true, materials: true, style: 'watercolor' }],
  ];
  const wait = ms => new Promise(ok => setTimeout(ok, ms));
  for (const [name, cfg] of configs) {
    if (cfg === null) { YZW.enable('look-pro', false, true); await wait(400); }
    else { if (!L.on) { YZW.enable('look-pro', true, true); for (let i = 0; i < 200 && !L.on; i++) await wait(100); }
      const matChange = cfg.materials !== L.opts.materials; Object.assign(L.opts, { style: 'photo' }, cfg); if (matChange) sweep(world, cfg.materials ? L.swap : L.unswap); }
    // חימום (קומפילציה) ואז מדידה
    for (let i = 0; i < 2; i++) { r.render(world.scene, world.camera); gl.finish(); }
    let js = 0, tot = 0, calls = 0, tris = 0;
    for (let i = 0; i < N; i++) { const a = performance.now(); r.render(world.scene, world.camera); const b = performance.now(); gl.finish(); const c = performance.now(); js += b - a; tot += c - a; calls = r.info.render.calls; tris = r.info.render.triangles; await wait(0); }
    out.push({ name, jsMs: +(js / N).toFixed(2), totalMs: +(tot / N).toFixed(1), calls, tris });
  }
  if (!L.on) { YZW.enable('look-pro', true, true); for (let i = 0; i < 200 && !L.on; i++) await wait(100); }
  Object.assign(L.opts, save); sweep(world, L.opts.materials ? L.swap : L.unswap);
  return out;
}

// ------------------------------------------------------------------ ממשק ציבורי
function plugin(o = {}) {
  return {
    id: 'look-pro', name: 'מראה מקצועי: תאורה, צללים, שמיים, חומרים, עיבוד-אחרי', dept: 'shaders', order: o.order || 33,
    requires: () => !!(window.THREE && window.THREE.PMREMGenerator),
    timeoutMs: 40000,
    init, update, dispose, settings,
    hudPanels: [{ id: 'lpq', render(el, world) { if (world.player.mode !== 'dev' || !L.prog || !L.post) return; const lv = L.prog.level;
      el.textContent = '✨ איכות: ' + (lv === 0 ? 'תנועה (מהיר)' : lv === 1 ? 'מתייצב (AO)' : 'מלאה · ' + Math.min(L.prog.n, 99) + ' דגימות') + (L.boost ? ' · גבוהה' : ''); } }],
    render(world, orig) { renderFrame(world, orig); },
  };
}
Object.assign(L.public, {
  version: VERSION, TIERS, plugin, bench, state: L,
  /** fn(b) → 'villa' | 'apartment' | 'industrial' | 'tower' | {style, family:'plaster'|'stone'|'shikun'|'accent'} | null (ברירת מחדל). מחיל על אריחים חדשים; refresh() לכולם. */
  setBuildingStyle(fn) { L.styleFn = fn; },
  refresh() { if (!L.world) return; for (const t of L.world.data.tiles.values()) { for (const m of [t.hi, t.lo]) if (m && m.geometry.attributes.lpB) m.geometry.deleteAttribute('lpB'); onTile(t, 'lod'); } },
  /** חומר רעפים לגג משופע (נורמל אמיתי → שורות לאורך השיפוע). color = hex sRGB. דורש את התוסף פעיל (טקסטורת רעש + אחידים). */
  makeRoofTileMaterial(color) { const m = makeMat('rooftile').clone(); m.onBeforeCompile = makeMat('rooftile').onBeforeCompile; m.customProgramCacheKey = makeMat('rooftile').customProgramCacheKey; m.userData.tint = { value: new L.THREE.Vector3(...hexLin(color || '#B5643C')) };
    const ob = m.onBeforeCompile; m.onBeforeCompile = sh => { ob(sh); sh.uniforms.lpRoofTint = m.userData.tint; }; return m; },
  /** חומר חזית/קרקע לפי סוג: 'wall'|'ind'|'roof'|'lo'|'terrain'|'road'|'walk' (לשימוש במשים של מחלקות אחרות; צריך תכונות lpB/lpA או ברירת מחדל) */
  material(kind) { return makeMat(kind); },
  /** צילום פריים אחד באיכות מלאה ובסגנון נבחר (גם בחסכונית) → Promise<dataURL JPEG> */
  photo(o = {}) { return new Promise(ok => { L.photoReq = { style: o.style, ok }; }); },
  setOptions(o) { Object.assign(L.opts, o || {}); if (L.world && o && 'materials' in o) sweep(L.world, o.materials ? L.swap : L.unswap); },
  perf() { const p = L.perf; return { updateMs: +p.upd.toFixed(3), renderJsMs: +p.ren.toFixed(3), aoJsMs: +(p.ao || 0).toFixed(3), bloomJsMs: +(p.bloom || 0).toFixed(3), envMs: +(p.envMs || 0).toFixed(2), lamps: L.lampCount || 0, tier: L.tierName, pr: L.world ? L.world.renderer.getPixelRatio() : 0, post: !!L.post, samples: L.post ? L.post.samples : 0, aug: L.stats && L.stats.aug, roofMiss: L.stats && L.stats.roofMiss }; },
});
if (window.YZW && !window.LOOKPRO_MANUAL) YZW.register(plugin());
})();
