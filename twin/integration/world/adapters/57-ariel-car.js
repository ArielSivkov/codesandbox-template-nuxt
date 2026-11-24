/* מתאם: הרכב של אריאל – אאודי A1 (8X) תלת-דלתית לבנה, לוחית 73-464-53 (באישור אריאל, 23.11.2026).
 * גרסה 5 (גדוד הרכב, 24.11.2026) – בעקבות משוב אריאל ב-03:18 "גם האודי כזאת ריבועי" (צילומים מאחור בנסיעת לילה).
 *   גוף חדש: לופט של 71 חתכי רוחב (61 + 5 בכל קצה מעוגל), כל חתך = עקומה סגורה דרך 18 נקודות (קובית מונוטונית לפי אורך מיתר –
 *   עוברת דרך הנקודות בלי "קפיצות"), 52 דגימות; נורמלים חלקים; קשתות גלגלים עגולות עם בית גלגל כהה; קו כתף; שמשה קדמית ~57° ואחורית ~45°;
 *   מכסה מנוע יורד; אחור מעוגל עם דלת תא מטען; צבע MeshPhysical עם clearcoat ומפת סביבה (באיכות "חסכונית" – MeshStandard).
 *   חלונות, פנסים, גריל ופסים – "מדבקות" שמוטלות על הגוף בקרני הטלה (מנוע קרניים עצמי, מואץ לפי רצועות חתכים וגזרות).
 *   גוף ראשון: לוח מחוונים, הגה ושעונים; בלילה כתם אור פנסים על הכביש (רק בנהיגה). הדגם מורם בגובה הכביש (הכבישים 10–16 ס"מ מעל הקרקע).
 * מידות יצרן (A1 8X 3 דלתות): אורך 3,954, רוחב 1,740, גובה 1,416, בסיס גלגלים 2,469, מפשק 1,477/1,471 מ"מ, צמיגים 215/45 R16 או 205/55 R15
 *   – carexpert.co.nz (Audi A1 2011, exterior and dimensions) ו-auto-data.net (A1 8X 1.4 TFSI). שלוחות 800/685 מ"מ, גלגל 17", רדיוס צמיג 0.30 – [לא אומת].
 * צורה וצבעים: צילומי אריאל 075–083 (23.11.2026, תיקיית "צילומי שכונה – רחוב הארז"): גג לבן (לא שחור!), ספוילר גג שחור, מסגרות חלונות שחורות,
 *   חישוקי 10 חישורים כסופים, ריפוד בז', אגזוז בשמאל. גג שחור (קשת קונטרסט) – אופציה: ?ariel-roof=black. ?ariel-car=0 מכבה.
 * גרסה 4 (Gemini QA) – בהיסטוריית git ובצילומי lab/ariel-car-v4-check; גרסה 2 ב-lab/ariel-car-v2/. מודל ידני לפי צילומים, לא סריקה.
 * תקציב: ≤ 15,000 משולשים, ≤ 30 קריאות ציור (בדיקה: tools/test-ariel-car-active.js). */
(function () {
  'use strict';

  const L = 3.954, Wd = 1.740, H = 1.416, WB = 2.469, TRK = 1.477, TRK_R = 1.471, R = 0.300;
  const OV_F = 0.800, OV_R = 0.685;                       // שלוחה קדמית/אחורית [לא אומת]; סכום = L − WB
  const ZF = WB / 2 + OV_F, ZR = -(WB / 2 + OV_R);       // ‎+2.0345 / ‎−1.9195 (ראשית = אמצע בסיס הגלגלים, על הקרקע)
  const PLATE = '73-464-53';

  let texPlateCache = null, texRimCache = null, texEnvCache = null, texShadowCache = null, texBeamCache = null;
  const hasDoc = () => typeof document !== 'undefined' && document.createElement;
  const canvas2d = (w, h) => { if (!hasDoc()) return null; const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext && cv.getContext('2d'); return x ? { cv, x } : null; };
  const srgb = t => { if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const dataTex = rgba => { const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1); t.needsUpdate = true; return t; };

  // ---------- טקסטורות (קנבס; בלי קבצים)
  function plateTex() {                       // לוחית ישראלית צהובה + פס כחול IL + מסגרת סוכנות "GOOD CAR" (כמו בצילומים)
    if (texPlateCache) return texPlateCache;
    const c = canvas2d(512, 128);
    if (c) {
      const x = c.x;
      x.fillStyle = '#101215'; x.fillRect(0, 0, 512, 128);
      x.fillStyle = '#f4be18'; x.fillRect(8, 8, 496, 98);
      x.fillStyle = '#0b4ea2'; x.fillRect(8, 8, 56, 98);
      x.fillStyle = '#ffffff'; x.fillRect(16, 16, 40, 26);
      x.fillStyle = '#0b4ea2'; x.fillRect(16, 20, 40, 3); x.fillRect(16, 35, 40, 3);
      x.fillStyle = '#ffffff'; x.font = 'bold 22px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('IL', 36, 68);
      x.font = 'bold 11px Arial, sans-serif'; x.fillText('ישראל', 36, 86);
      x.fillStyle = '#111317'; x.font = '900 70px "Arial Narrow", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(PLATE, 284, 58);
      x.fillStyle = '#d8dee9'; x.font = 'bold 12px Arial, sans-serif'; x.fillText('GOOD CAR', 284, 117);
      const t = srgb(new THREE.CanvasTexture(c.cv)); t.anisotropy = 4; return (texPlateCache = t);
    }
    return (texPlateCache = dataTex([244, 190, 24, 255]));
  }

  function rimTex() {                         // חישוק 10 חישורים כטקסטורה – נשמר מגרסה 4 בגלל הממשק (module.exports); החישוק עצמו עכשיו תלת-ממדי
    if (texRimCache) return texRimCache;
    const c = canvas2d(256, 256);
    if (c) {
      const x = c.x, cx = 128, cy = 128;
      x.fillStyle = '#101318'; x.fillRect(0, 0, 256, 256);
      x.beginPath(); x.arc(cx, cy, 88, 0, Math.PI * 2); x.fillStyle = '#282d35'; x.fill(); x.lineWidth = 14; x.strokeStyle = '#434b56'; x.stroke();
      const g = x.createRadialGradient(cx, cy, 98, cx, cy, 125); g.addColorStop(0, '#9fa8b5'); g.addColorStop(0.5, '#e8edf5'); g.addColorStop(1, '#858e9c');
      x.beginPath(); x.arc(cx, cy, 124, 0, Math.PI * 2); x.arc(cx, cy, 98, 0, Math.PI * 2, true); x.fillStyle = g; x.fill();
      for (let i = 0; i < 10; i++) { x.save(); x.translate(cx, cy); x.rotate((i / 10) * Math.PI * 2); x.beginPath(); x.moveTo(-9.5, 28); x.lineTo(9.5, 28); x.lineTo(7, 105); x.lineTo(-7, 105); x.closePath(); x.fillStyle = '#e8edf5'; x.fill(); x.restore(); }
      x.beginPath(); x.arc(cx, cy, 32, 0, Math.PI * 2); x.fillStyle = '#c8d0dc'; x.fill();
      return (texRimCache = srgb(new THREE.CanvasTexture(c.cv)));
    }
    return (texRimCache = dataTex([210, 216, 224, 255]));
  }

  function envTex() {                         // סביבה אקוויריקטנגולרית: שמיים, אופק בהיר עם צלליות בניינים, אספלט – ההשתקפות היא שמראה את העיגול
    if (texEnvCache) return texEnvCache;
    const c = canvas2d(512, 256);
    let t;
    if (c) {
      const x = c.x;
      const sky = x.createLinearGradient(0, 0, 0, 128);
      sky.addColorStop(0, '#2f6fc0'); sky.addColorStop(0.55, '#8fc0ee'); sky.addColorStop(0.9, '#e6f1fb'); sky.addColorStop(1, '#fff4de');
      x.fillStyle = sky; x.fillRect(0, 0, 512, 128);
      const gr = x.createLinearGradient(0, 128, 0, 256);
      gr.addColorStop(0, '#77736c'); gr.addColorStop(0.25, '#4c4b49'); gr.addColorStop(1, '#2b2c2e');
      x.fillStyle = gr; x.fillRect(0, 128, 512, 128);
      x.fillStyle = 'rgba(205,200,188,0.85)';                 // קו בניינים (אבן בהירה) באופק
      for (let i = 0; i < 26; i++) { const w = 10 + ((i * 37) % 23), h = 6 + ((i * 53) % 19), px = (i * 41) % 512; x.fillRect(px, 128 - h, w, h); }
      x.fillStyle = 'rgba(70,92,70,0.7)';
      for (let i = 0; i < 18; i++) { const px = (i * 61 + 17) % 512; x.beginPath(); x.ellipse(px, 126, 9 + (i % 4) * 3, 5, 0, 0, Math.PI * 2); x.fill(); }
      for (const [cx, cy, rx] of [[120, 54, 50], [330, 42, 64], [470, 70, 40]]) {     // עננים רכים (בלי קווים חדים בהשתקפות)
        const cg = x.createRadialGradient(cx, cy, 2, cx, cy, rx); cg.addColorStop(0, 'rgba(255,255,255,0.40)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = cg; x.fillRect(cx - rx, cy - rx, rx * 2, rx * 2); }
      const s = x.createRadialGradient(400, 60, 1, 400, 60, 26); s.addColorStop(0, 'rgba(255,255,250,1)'); s.addColorStop(0.4, 'rgba(255,236,190,0.7)'); s.addColorStop(1, 'rgba(255,236,190,0)');
      x.fillStyle = s; x.fillRect(370, 30, 60, 60);
      t = new THREE.CanvasTexture(c.cv);
    } else {
      t = new THREE.DataTexture(new Uint8Array([120, 175, 235, 255, 235, 244, 255, 255, 60, 60, 60, 255, 35, 36, 38, 255]), 2, 2); t.needsUpdate = true;
    }
    if (THREE.EquirectangularReflectionMapping) t.mapping = THREE.EquirectangularReflectionMapping;
    return (texEnvCache = srgb(t));
  }

  function shadowTex() {                      // צל מגע רך מתחת לרכב (נראה גם בלילה וגם באיכות חסכונית, כשאין מפת צללים)
    if (texShadowCache) return texShadowCache;
    const c = canvas2d(64, 128);
    if (c) {
      const x = c.x; x.clearRect(0, 0, 64, 128);
      for (let i = 0; i < 14; i++) { const k = i / 13, a = 0.10 * (1 - k * 0.55); x.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
        const mx = 4 + k * 16, my = 6 + k * 20, r = 22 - k * 10; x.beginPath();
        if (x.roundRect) x.roundRect(mx, my, 64 - 2 * mx, 128 - 2 * my, r); else x.rect(mx, my, 64 - 2 * mx, 128 - 2 * my); x.fill(); }
      return (texShadowCache = new THREE.CanvasTexture(c.cv));
    }
    return (texShadowCache = dataTex([0, 0, 0, 90]));
  }

  function beamTex() {                        // כתם אור הפנסים על הכביש בלילה (שורה עליונה = ליד הרכב, תחתונה = רחוק)
    if (texBeamCache) return texBeamCache;
    const c = canvas2d(128, 256);
    if (c) {
      const x = c.x; x.clearRect(0, 0, 128, 256); x.globalCompositeOperation = 'lighter';
      const blob = (cx, cy, r, sy, a) => { x.save(); x.translate(cx, cy); x.scale(1, sy); const gg = x.createRadialGradient(0, 0, 0, 0, 0, r);
        gg.addColorStop(0, `rgba(255,242,215,${a})`); gg.addColorStop(0.55, `rgba(255,236,200,${(a * 0.45).toFixed(3)})`); gg.addColorStop(1, 'rgba(255,230,190,0)');
        x.fillStyle = gg; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill(); x.restore(); };
      blob(64, 120, 60, 2.1, 0.26);                                   // שטיפה רחבה (‎~10 מ' קדימה)
      for (const cx of [51, 77]) { blob(cx, 40, 14, 2.4, 0.35); blob(cx + (cx - 64) * 0.6, 96, 30, 2.7, 0.70); blob(cx + (cx - 64) * 1.2, 170, 34, 2.2, 0.32); }
      return (texBeamCache = new THREE.CanvasTexture(c.cv));
    }
    return (texBeamCache = dataTex([60, 56, 48, 255]));
  }
  function makeBeam() {
    const geo = new THREE.PlaneGeometry(6.0, 22.0); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: beamTex(), color: 0xfff0d8, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const m = new THREE.Mesh(geo, mat); m.name = 'ariel-a1-beam'; m.position.set(0, 0.03, ZF + 0.5 + 11.0); m.visible = false; m.renderOrder = 2; m.frustumCulled = true;
    return m;
  }

  // ---------- עזרי מתמטיקה
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const smax = (a, b, k) => { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return lerp(b, a, h) + k * h * (1 - h); };
  function mono(xs, ys) {                     // אינטרפולציה קובית מונוטונית (Fritsch–Carlson): חלקה, בלי "גלים" בין תחנות
    const n = xs.length, d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return v => {
      if (v <= xs[0]) return ys[0]; if (v >= xs[n - 1]) return ys[n - 1];
      let i = 0; while (i < n - 2 && v > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (v - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }
  function chaikin(pts, it, closed) {
    let p = pts;
    for (let k = 0; k < it; k++) {
      const q = [], n = p.length;
      if (!closed) q.push(p[0]);
      for (let i = 0; i < (closed ? n : n - 1); i++) { const a = p[i], b = p[(i + 1) % n]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
      if (!closed) q.push(p[n - 1]);
      p = q;
    }
    return p;
  }
  function resample(pts, n) {                 // n נקודות במרחקים שווים לאורך קו שבור פתוח
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const tot = acc[acc.length - 1] || 1, out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const s = (tot * k) / (n - 1);
      while (j < acc.length - 2 && acc[j + 1] < s) j++;
      const seg = acc[j + 1] - acc[j] || 1, t = clamp((s - acc[j]) / seg, 0, 1);
      out.push([lerp(pts[j][0], pts[j + 1][0], t), lerp(pts[j][1], pts[j + 1][1], t)]);
    }
    return out;
  }
  const circle = (cx, cy, rx, ry, n, a0) => { const o = []; for (let i = 0; i <= n; i++) { const a = (a0 || 0) + (i / n) * Math.PI * 2; o.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return o; };

  // ---------- הגוף: טבלת חתכים לאורך הרכב (z קדימה). כל שורה = נקודות על חצי החתך השמאלי (x>0), מלמטה למעלה;
  // העקומה (Catmull-Rom צנטריפטלית) עוברת דרכן בדיוק: תחתית, פינת סף, צד, קו כתף ("טורנדו"), קו חלון, פינת גג/עמוד, גג, מרכז.
  //  z       yBot   wF    wL     yL     wS     yS     wSh    ySh    wB     yB     wR     yR     wC    yC     yTop
  const BT = [
    [-1.865, 0.262, 0.40, 0.690, 0.330, 0.718, 0.545, 0.690, 0.822, 0.625, 0.812, 0.520, 0.788, 0.30, 0.762, 0.766],
    [-1.845, 0.246, 0.44, 0.738, 0.314, 0.770, 0.545, 0.745, 0.852, 0.668, 0.846, 0.548, 0.826, 0.30, 0.798, 0.804],
    [-1.800, 0.230, 0.47, 0.780, 0.300, 0.812, 0.545, 0.786, 0.866, 0.700, 0.874, 0.580, 0.866, 0.30, 0.855, 0.860],
    [-1.750, 0.222, 0.49, 0.803, 0.292, 0.836, 0.540, 0.808, 0.870, 0.722, 0.902, 0.620, 0.915, 0.32, 0.920, 0.924],
    [-1.700, 0.218, 0.50, 0.815, 0.286, 0.848, 0.535, 0.826, 0.866, 0.745, 0.928, 0.655, 0.972, 0.45, 0.992, 0.998],
    [-1.620, 0.211, 0.51, 0.827, 0.278, 0.859, 0.530, 0.848, 0.858, 0.755, 0.952, 0.648, 1.053, 0.45, 1.076, 1.083],
    [-1.520, 0.205, 0.52, 0.835, 0.270, 0.864, 0.524, 0.862, 0.848, 0.760, 0.966, 0.642, 1.158, 0.45, 1.181, 1.188],
    [-1.440, 0.201, 0.53, 0.838, 0.265, 0.866, 0.520, 0.868, 0.840, 0.762, 0.972, 0.636, 1.238, 0.45, 1.263, 1.270],
    [-1.360, 0.198, 0.53, 0.840, 0.261, 0.866, 0.516, 0.870, 0.832, 0.762, 0.972, 0.632, 1.316, 0.47, 1.343, 1.350],
    [-1.200, 0.191, 0.54, 0.841, 0.256, 0.866, 0.508, 0.871, 0.818, 0.762, 0.964, 0.632, 1.340, 0.50, 1.379, 1.387],
    [-0.900, 0.184, 0.55, 0.838, 0.233, 0.859, 0.498, 0.868, 0.800, 0.772, 0.953, 0.645, 1.344, 0.53, 1.399, 1.407],
    [-0.400, 0.177, 0.55, 0.835, 0.226, 0.856, 0.495, 0.864, 0.788, 0.781, 0.946, 0.650, 1.347, 0.55, 1.408, 1.416],
    [0.000, 0.176, 0.55, 0.834, 0.225, 0.855, 0.495, 0.862, 0.785, 0.785, 0.944, 0.652, 1.338, 0.55, 1.398, 1.406],
    [0.260, 0.178, 0.55, 0.835, 0.226, 0.855, 0.495, 0.861, 0.784, 0.786, 0.943, 0.656, 1.318, 0.55, 1.378, 1.386],
    [0.450, 0.180, 0.55, 0.836, 0.227, 0.856, 0.497, 0.860, 0.784, 0.787, 0.942, 0.674, 1.198, 0.52, 1.238, 1.250],
    [0.700, 0.182, 0.55, 0.837, 0.228, 0.857, 0.500, 0.859, 0.786, 0.789, 0.940, 0.700, 1.040, 0.52, 1.072, 1.082],
    [0.900, 0.184, 0.55, 0.838, 0.229, 0.859, 0.503, 0.859, 0.790, 0.792, 0.918, 0.700, 0.952, 0.48, 0.957, 0.960],
    [1.000, 0.185, 0.55, 0.839, 0.231, 0.860, 0.505, 0.859, 0.790, 0.795, 0.893, 0.660, 0.926, 0.45, 0.933, 0.936],
    [1.250, 0.190, 0.55, 0.842, 0.237, 0.864, 0.510, 0.860, 0.786, 0.797, 0.858, 0.640, 0.887, 0.42, 0.893, 0.895],
    [1.550, 0.200, 0.53, 0.827, 0.247, 0.850, 0.514, 0.845, 0.772, 0.784, 0.810, 0.620, 0.831, 0.40, 0.836, 0.838],
    [1.750, 0.206, 0.50, 0.797, 0.253, 0.823, 0.514, 0.814, 0.756, 0.758, 0.772, 0.600, 0.786, 0.38, 0.790, 0.792],
    [1.880, 0.216, 0.46, 0.750, 0.263, 0.774, 0.508, 0.759, 0.728, 0.714, 0.738, 0.560, 0.745, 0.36, 0.748, 0.750],
    [1.965, 0.236, 0.40, 0.674, 0.279, 0.694, 0.496, 0.672, 0.682, 0.624, 0.692, 0.490, 0.700, 0.30, 0.703, 0.705],
  ];
  const Z0 = BT[0][0], Z1 = BT[BT.length - 1][0];
  const CAP_R = { zc: Z0, ze: ZR, yp: 0.50, p: 2.2 }, CAP_F = { zc: Z1, ze: ZF, yp: 0.47, p: 2.4 };
  const ARCH_F = 0.336, ARCH_R = 0.333;
  const SPAN_N = [1, 2, 3, 3, 4, 3, 4, 3, 3];            // דגימות לכל מקטע בחצי חתך (26) → 52 נקודות בטבעת (הרצפה שטוחה – דגימה אחת)
  const NS = SPAN_N.concat(SPAN_N.slice().reverse()), J_TOP = SPAN_N.reduce((a, b) => a + b, 0), NP = 2 * J_TOP;
  const KNOT = k => SPAN_N.slice(0, k).reduce((a, b) => a + b, 0);   // אינדקס הדגימה של נקודה k בחצי החתך (P0=0, P1=1, P2a=2, P2=3 …)
  const J_P2A = KNOT(2), J_P2 = KNOT(3), J_P5 = KNOT(6);
  let BI = null;
  const bodyInterp = () => BI || (BI = BT[0].slice(1).map((_, c) => mono(BT.map(r => r[0]), BT.map(r => r[c + 1]))));
  function archY(z) {
    let a = -1; const dF = z - WB / 2, dR = z + WB / 2;
    if (Math.abs(dF) < ARCH_F) a = Math.max(a, R + Math.sqrt(ARCH_F * ARCH_F - dF * dF));
    if (Math.abs(dR) < ARCH_R) a = Math.max(a, R + Math.sqrt(ARCH_R * ARCH_R - dR * dR));
    return a;
  }
  function sectionCtrl(z) {
    let [yBot, wF, wL, yL, wS, yS, wSh, ySh, wB, yB, wR, yR, wC, yC, yTop] = bodyInterp().map(f => f(z));
    let wA = lerp(wF, wL, 0.62), yA = lerp(yBot, yL, 0.18), s = 0;
    const a = archY(z);
    if (a > 0) {                              // קשת גלגל: שפת הקשת למעלה, תקרת בית הגלגל, הרחבה קלה של הכנף
      s = sstep(0, 0.05, a - yL);
      yL = smax(yL, a + 0.012, 0.025); wL += 0.010 * s;
      wA = lerp(wA, wF + 0.08, s); yA = lerp(yA, a + 0.002, s);
      wS += 0.006 * s;
    }
    yS = Math.max(yS, yL + 0.06);
    return { s, c: [[0, yBot], [wF, yBot], [wA, yA], [wL, yL], [wS, yS], [wSh, ySh], [wB, yB], [wR, yR], [wC, yC], [0, yTop]] };
  }
  // עקומה סגורה דרך נקודות החתך: קובית הרמיט לכל קואורדינטה לפי אורך מיתר, שיפועים מונוטוניים (Fritsch–Carlson, סימטרי)
  // → עוברת בדיוק דרך הנקודות, בלי "קפיצות" מעל הגג או מתחת לרצפה, חלקה (C1) וסימטרית במראה
  function loopCurve(C, counts) {
    const n = C.length, s = [0], h = [], m = [new Array(n), new Array(n)], pts = [];
    for (let i = 0; i < n; i++) { const a = C[i], b = C[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6; h.push(l); s.push(s[i] + l); }
    for (let c = 0; c < 2; c++) {
      const d = []; for (let i = 0; i < n; i++) d.push((C[(i + 1) % n][c] - C[i][c]) / h[i]);
      for (let i = 0; i < n; i++) { const ip = (i - 1 + n) % n, d0 = d[ip], d1 = d[i]; m[c][i] = d0 * d1 <= 0 ? 0 : (h[i] * d0 + h[ip] * d1) / (h[ip] + h[i]); }
      const tau = d.map((di, i) => { if (di === 0) return 0; const al = m[c][i] / di, be = m[c][(i + 1) % n] / di, q = al * al + be * be; return q > 9 ? 3 / Math.sqrt(q) : 1; });
      for (let i = 0; i < n; i++) m[c][i] *= Math.min(tau[(i - 1 + n) % n], tau[i]);
    }
    for (let k = 0; k < n; k++) {
      const a = C[k], b = C[(k + 1) % n], hk = h[k], kn = (k + 1) % n;
      for (let q = 0; q < counts[k]; q++) {
        const t = q / counts[k], t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        pts.push([h00 * a[0] + h10 * hk * m[0][k] + h01 * b[0] + h11 * hk * m[0][kn], h00 * a[1] + h10 * hk * m[1][k] + h01 * b[1] + h11 * hk * m[1][kn]]);
      }
    }
    return pts;
  }
  function ringAt(z) {
    const sc = sectionCtrl(z), h = sc.c, C = h.slice();
    for (let k = 8; k >= 1; k--) C.push([-h[k][0], h[k][1]]);
    return { pts: loopCurve(C, NS), arch: sc.s };
  }

  // מעטפת אטומה: קוטב אחורי, 71 טבעות, קוטב קדמי. פאות בכיוון השעון-הפוך מבחוץ → נפח מסומן חיובי.
  function buildBody(opts) {
    const NM = 60, NC = 5, rings = [];
    const b0 = ringAt(Z0), b1 = ringAt(Z1);
    const capRing = (base, cap, m) => {
      const phi = (m / (NC + 1)) * Math.PI / 2, k = Math.cos(phi), t = Math.pow(1 - Math.pow(k, cap.p), 1 / cap.p);
      return { z: cap.zc + (cap.ze - cap.zc) * t, pts: base.pts.map(([x, y]) => [x * k, cap.yp + (y - cap.yp) * k]), arch: 0, cap: 1 - k };
    };
    for (let m = NC; m >= 1; m--) rings.push(capRing(b0, CAP_R, m));
    for (let i = 0; i <= NM; i++) { const z = Z0 + ((Z1 - Z0) * i) / NM, r = i === 0 ? b0 : i === NM ? b1 : ringAt(z); rings.push({ z, pts: r.pts, arch: r.arch, cap: 0 }); }
    for (let m = 1; m <= NC; m++) rings.push(capRing(b1, CAP_F, m));
    let mx = 0; for (const r of rings) for (const p of r.pts) mx = Math.max(mx, Math.abs(p[0]));
    const sx = Wd / 2 / mx;                   // רוחב מדויק 1.740
    const NR = rings.length, pos = new Float32Array((NR * NP + 2) * 3), col = new Float32Array((NR * NP + 2) * 3), idx = [];
    pos.set([0, CAP_R.yp, ZR], 0);
    const roofBlack = !!(opts && opts.roofBlack);
    const shade = (x, y, z, j, ring) => {     // צבע קודקוד: בתי גלגלים ותחתית כהים, פס תחתון אחורי שחור, גג שחור (אופציה)
      const jj = j <= J_TOP ? j : NP - j;
      let d = 0;
      if (jj < J_P2A && !ring.cap) d = 1;                       // תחתית (לא על פני הפגושים)
      if (ring.arch > 0.25 && jj < J_P2) d = 1;                 // בית גלגל
      if (z > 1.93 && y < 0.250) d = Math.max(d, 1);            // שפה תחתונה קדמית
      if (roofBlack && jj >= J_P5 && z > -1.62 && z < 0.92) return [0.03, 0.03, 0.035];
      return d ? [0.07, 0.072, 0.078] : [1, 1, 1];
    };
    for (let i = 0; i < NR; i++) {
      const r = rings[i];
      for (let j = 0; j < NP; j++) {
        const o = (1 + i * NP + j) * 3, x = r.pts[j][0] * sx, y = r.pts[j][1];
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = r.z;
        col.set(shade(x, y, r.z, j, r), o);
      }
    }
    const F = 1 + NR * NP; pos.set([0, CAP_F.yp, ZF], F * 3);
    col.set(shade(0, CAP_R.yp, ZR, J_P2 + 4, rings[0]), 0); col.set(shade(0, CAP_F.yp, ZF, J_P2 + 4, rings[NR - 1]), F * 3);
    const vid = (i, j) => 1 + i * NP + (((j % NP) + NP) % NP);
    const bands = [];
    bands.push({ z0: ZR, z1: rings[0].z, t0: 0, t1: NP });
    for (let j = 0; j < NP; j++) idx.push(0, vid(0, j + 1), vid(0, j));
    for (let i = 0; i < NR - 1; i++) {
      const t0 = idx.length / 3;
      for (let j = 0; j < NP; j++) {
        const a = vid(i, j), b = vid(i, j + 1), c = vid(i + 1, j + 1), d = vid(i + 1, j);
        if (j < J_TOP) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);   // אלכסונים סימטריים במראה
      }
      bands.push({ z0: Math.min(rings[i].z, rings[i + 1].z), z1: Math.max(rings[i].z, rings[i + 1].z), t0, t1: idx.length / 3 });
    }
    { const t0 = idx.length / 3; for (let j = 0; j < NP; j++) idx.push(F, vid(NR - 1, j), vid(NR - 1, j + 1)); bands.push({ z0: rings[NR - 1].z, z1: ZF, t0, t1: idx.length / 3 }); }
    // כל רצועה מחולקת ל-8 גזרות עם תיבה חוסמת – הקרן בודקת רק גזרות שהיא חוצה (פי 4–8 פחות משולשים)
    for (const B of bands) {
      B.sec = []; const n = B.t1 - B.t0, per = Math.ceil(n / 8);
      for (let t0 = B.t0; t0 < B.t1; t0 += per) {
        const t1 = Math.min(B.t1, t0 + per), bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
        for (let t = t0 * 3; t < t1 * 3; t++) { const v = idx[t] * 3; for (let c = 0; c < 3; c++) { const q = pos[v + c]; if (q < bb[c]) bb[c] = q; if (q > bb[c + 3]) bb[c + 3] = q; } }
        B.sec.push({ t0, t1, bb });
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return { geo, bands, rings, sx };
  }

  // הטלת קרן על הגוף (Möller–Trumbore), רק על רצועות החתכים שהקרן חוצה; מחזיר נקודה + נורמל חלק
  function makeCaster(geo, bands) {
    const P = geo.attributes.position.array, N = geo.attributes.normal.array, I = geo.index.array;
    return function cast(o, d, tMax) {
      tMax = tMax || 4;
      let bt = tMax, bi = -1, bu = 0, bv = 0;
      const dz = d[2], nb = bands.length, flat = Math.abs(dz) < 1e-9;
      for (let qq = 0; qq < nb; qq++) {           // הרצועות ממוינות לפי z: עוברים בכיוון הקרן ועוצרים אחרי הפגיעה הקרובה
        const B = bands[dz < 0 ? nb - 1 - qq : qq];
        if (flat) { if (B.z1 < o[2] - 1e-6 || B.z0 > o[2] + 1e-6) continue; }
        else if (dz > 0) { if (B.z1 < o[2]) continue; if (B.z0 > o[2] + dz * bt) break; }
        else { if (B.z0 > o[2]) continue; if (B.z1 < o[2] + dz * bt) break; }
        for (const S of B.sec) {
        const bb = S.bb; let ta = 0, tb = bt, miss = false;           // מבחן לוחות מול התיבה של הגזרה
        for (let c = 0; c < 3 && !miss; c++) {
          const oc = o[c], dc = d[c], lo = bb[c] - 1e-4, hi = bb[c + 3] + 1e-4;
          if (Math.abs(dc) < 1e-12) { if (oc < lo || oc > hi) miss = true; continue; }
          let u0 = (lo - oc) / dc, u1 = (hi - oc) / dc; if (u0 > u1) { const tq = u0; u0 = u1; u1 = tq; }
          if (u0 > ta) ta = u0; if (u1 < tb) tb = u1; if (ta > tb) miss = true;
        }
        if (miss) continue;
        for (let t = S.t0; t < S.t1; t++) {
          const i0 = I[t * 3] * 3, i1 = I[t * 3 + 1] * 3, i2 = I[t * 3 + 2] * 3;
          const ax = P[i0], ay = P[i0 + 1], az = P[i0 + 2];
          const e1x = P[i1] - ax, e1y = P[i1 + 1] - ay, e1z = P[i1 + 2] - az, e2x = P[i2] - ax, e2y = P[i2 + 1] - ay, e2z = P[i2 + 2] - az;
          const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-12 && det < 1e-12) continue;
          const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
          const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-7 || u > 1 + 1e-7) continue;   // סובלנות: קרן שעוברת בדיוק על צלע לא נופלת ב"סדק"
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < -1e-7 || u + v > 1 + 1e-7) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv; if (tt <= 1e-6 || tt >= bt) continue;
          const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
          if (fx * d[0] + fy * d[1] + fz * d[2] >= 0) continue;   // רק פאה חיצונית
          bt = tt; bi = t; bu = u; bv = v;
        }
        }
      }
      if (bi < 0) return null;
      const i0 = I[bi * 3] * 3, i1 = I[bi * 3 + 1] * 3, i2 = I[bi * 3 + 2] * 3, w = 1 - bu - bv;
      let nx = N[i0] * w + N[i1] * bu + N[i2] * bv, ny = N[i0 + 1] * w + N[i1 + 1] * bu + N[i2 + 1] * bv, nz = N[i0 + 2] * w + N[i1 + 2] * bu + N[i2 + 2] * bv;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      return { p: [o[0] + d[0] * bt, o[1] + d[1] * bt, o[2] + d[2] * bt], n: [nx, ny, nz] };
    };
  }

  function build(opts) {
    opts = opts || {};
    const envMap = envTex();
    const std = p => new THREE.MeshStandardMaterial(p);
    const M = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0xf2f3f1, roughness: 0.34, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.07, envMap, envMapIntensity: 0.95, vertexColors: true }),
      glass: std({ color: 0x06080b, roughness: 0.06, metalness: 0.15, envMap, envMapIntensity: 1.1 }),
      black: std({ color: 0x08090b, roughness: 0.16, metalness: 0.25, envMap, envMapIntensity: 0.9 }),
      plastic: std({ color: 0x141518, roughness: 0.72, metalness: 0.05, envMap, envMapIntensity: 0.3 }),
      chrome: std({ color: 0xeef1f5, roughness: 0.08, metalness: 1.0, envMap, envMapIntensity: 1.35 }),
      lamp: std({ color: 0x9aa3ad, roughness: 0.10, metalness: 0.9, envMap, envMapIntensity: 1.3, emissive: 0xfff1d6, emissiveIntensity: 0.0 }),
      drl: std({ color: 0xffffff, roughness: 0.2, emissive: 0xfff4e2, emissiveIntensity: 0.6 }),
      tail: std({ color: 0x7c0a10, roughness: 0.12, metalness: 0.1, envMap, envMapIntensity: 1.1, emissive: 0xff1810, emissiveIntensity: 0.10 }),
      tailGlow: std({ color: 0xff2a22, roughness: 0.3, emissive: 0xff2014, emissiveIntensity: 0.55 }),
      plate: std({ map: plateTex(), roughness: 0.35, metalness: 0.05, emissive: 0xffffff, emissiveMap: plateTex(), emissiveIntensity: 0 }),
      interior: std({ vertexColors: true, roughness: 0.75, metalness: 0.05 }),
      tire: std({ color: 0x121315, roughness: 0.9, metalness: 0.0 }),
      alloy: std({ color: 0xc9cdd3, roughness: 0.26, metalness: 0.85, envMap, envMapIntensity: 1.15 }),
      shadow: new THREE.MeshBasicMaterial({ map: shadowTex(), color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
    const g = new THREE.Group(); g.name = 'ariel-a1';

    // --- גוף
    const body = buildBody(opts);
    const bodyMesh = new THREE.Mesh(body.geo, M.paint); bodyMesh.name = 'ariel-a1-body'; bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
    g.add(bodyMesh);
    const cast = makeCaster(body.geo, body.bands);

    // --- דליים לאיחוד לפי חומר (קריאת ציור אחת לחומר)
    const buckets = new Map();
    const bucket = m => { let b = buckets.get(m); if (!b) { b = { pos: [], nrm: [], col: [], uv: [], idx: [], uvOn: false }; buckets.set(m, b); } return b; };
    const pushTri = (b, a, c, d) => b.idx.push(a, c, d);
    function addGeo(geo, mat, matrix, color) {
      const gg = geo.index ? geo.clone() : geo.clone();
      if (matrix) gg.applyMatrix4(matrix);
      if (!gg.attributes.normal) gg.computeVertexNormals();
      const p = gg.attributes.position, n = gg.attributes.normal, uv = gg.attributes.uv, b = bucket(mat), base = b.pos.length / 3;
      const flip = matrix && matrix.determinant() < 0, c = color || [1, 1, 1];
      for (let k = 0; k < p.count; k++) { b.pos.push(p.getX(k), p.getY(k), p.getZ(k)); b.nrm.push(n.getX(k), n.getY(k), n.getZ(k)); b.col.push(c[0], c[1], c[2]); if (uv) { b.uv.push(uv.getX(k), uv.getY(k)); b.uvOn = true; } else b.uv.push(0, 0); }
      const ix = gg.index ? gg.index.array : [...Array(p.count).keys()];
      for (let k = 0; k < ix.length; k += 3) { if (flip) b.idx.push(base + ix[k], base + ix[k + 2], base + ix[k + 1]); else b.idx.push(base + ix[k], base + ix[k + 1], base + ix[k + 2]); }
    }
    const M4 = (p, r, s) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r || [0, 0, 0]))), new THREE.Vector3(...(s || [1, 1, 1])));

    // --- קרני הטלה: (a,b) → מוצא + כיוון
    const raySide = sx => (a, b) => ({ o: [sx * 1.6, b, a], d: [-sx, 0, 0] });          // (z,y)
    const rayFront = (a, b) => ({ o: [a, b, ZF + 0.8], d: [0, 0, -1] });               // (x,y)
    const rayRear = (a, b) => ({ o: [a, b, ZR - 0.8], d: [0, 0, 1] });                 // (x,y)
    const rayTilt = (C, U, V, D) => (a, b) => ({ o: [C[0] + a * U[0] + b * V[0] - D[0], C[1] + a * U[1] + b * V[1] - D[1], C[2] + a * U[2] + b * V[2] - D[2]], d: D });
    // מסלול עוטף פינה (מבט על): ישר לאורך הפנים → קשת → ישר לאורך הצד; s = אורך לאורך המסלול, b = גובה
    function rayWrap(sx, front, xIn, xc, zc, rc, side) {
      const pts = [], dirs = [], fz = front ? 1 : -1;
      const zFace = zc + fz * rc;
      for (let i = 0; i <= 8; i++) { const x = lerp(xIn, xc, i / 8); pts.push([x, zFace]); dirs.push([0, -fz]); }
      for (let i = 1; i <= 16; i++) { const th = (i / 16) * Math.PI / 2; pts.push([xc + Math.sin(th) * rc, zc + fz * Math.cos(th) * rc]); dirs.push([-Math.sin(th), -fz * Math.cos(th)]); }
      for (let i = 1; i <= 8; i++) { pts.push([xc + rc, zc - fz * (i / 8) * side]); dirs.push([-1, 0]); }
      const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const fn = (a, b) => {
        let i = 0; while (i < acc.length - 2 && acc[i + 1] < a) i++;
        const t = clamp((a - acc[i]) / (acc[i + 1] - acc[i] || 1), 0, 1), x = lerp(pts[i][0], pts[i + 1][0], t), z = lerp(pts[i][1], pts[i + 1][1], t);
        let dx = lerp(dirs[i][0], dirs[i + 1][0], t), dz = lerp(dirs[i][1], dirs[i + 1][1], t); const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        return { o: [sx * (x - dx * 0.25), b, z - dz * 0.25], d: [sx * dx, 0, dz] };
      };
      fn.len = acc[acc.length - 1];
      return fn;
    }
    const hit = (ray, a, b, off) => { const r = ray(a, b), h = cast(r.o, r.d, 3); if (!h) return null; return { p: [h.p[0] + h.n[0] * off, h.p[1] + h.n[1] * off, h.p[2] + h.n[2] * off], n: h.n }; };

    // מדבקה: אזור בין שני קווים (תחתון/עליון) בדו-ממד, מוטל על הגוף ומורם בהיסט קטן לאורך הנורמל
    function patch(mat, ray, lo, up, nu, nv, off, o) {
      o = o || {};
      const A = resample(lo, nu + 1), U = resample(up, nu + 1), b = bucket(mat), base = b.pos.length / 3, ok = [];
      const col = o.color || [1, 1, 1];
      for (let i = 0; i <= nu; i++) for (let k = 0; k <= nv; k++) {
        const t = o.vf ? o.vf(k / nv) : k / nv, h = hit(ray, lerp(A[i][0], U[i][0], t), lerp(A[i][1], U[i][1], t), off + (o.dome ? o.dome * Math.sin(Math.PI * k / nv) * Math.sin(Math.PI * i / nu) : 0));
        ok.push(!!h);
        if (h) { b.pos.push(...h.p); b.nrm.push(...h.n); } else { b.pos.push(0, 0, 0); b.nrm.push(0, 1, 0); }
        b.col.push(col[0], col[1], col[2]);
        if (o.uv) { b.uv.push(i / nu, k / nv); b.uvOn = true; } else b.uv.push(0, 0);
      }
      const V = nv + 1, vtx = q => base + q;
      for (let i = 0; i < nu; i++) for (let k = 0; k < nv; k++) {
        const q00 = i * V + k, q01 = q00 + 1, q10 = q00 + V, q11 = q10 + 1;
        for (const tri of [[q00, q10, q11], [q00, q11, q01]]) {
          if (!ok[tri[0]] || !ok[tri[1]] || !ok[tri[2]]) continue;
          orient(b, vtx(tri[0]), vtx(tri[1]), vtx(tri[2]));
        }
      }
    }
    function orient(b, a, c, d) {             // סדר קודקודים כך שהפאה פונה לכיוון הנורמל (כלפי חוץ)
      const P = b.pos, N = b.nrm;
      const ux = P[c * 3] - P[a * 3], uy = P[c * 3 + 1] - P[a * 3 + 1], uz = P[c * 3 + 2] - P[a * 3 + 2];
      const vx = P[d * 3] - P[a * 3], vy = P[d * 3 + 1] - P[a * 3 + 1], vz = P[d * 3 + 2] - P[a * 3 + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (fx * fx + fy * fy + fz * fz < 1e-14) return;
      const nx = N[a * 3] + N[c * 3] + N[d * 3], ny = N[a * 3 + 1] + N[c * 3 + 1] + N[d * 3 + 1], nz = N[a * 3 + 2] + N[c * 3 + 2] + N[d * 3 + 2];
      if (fx * nx + fy * ny + fz * nz >= 0) pushTri(b, a, c, d); else pushTri(b, a, d, c);
    }
    // פס לאורך קו (תפרים, מסגרות, טבעות): רוחב w, גובה off מעל הגוף; קיר צד אופציונלי עד הגוף
    function strip(mat, ray, pts, w, off, o) {
      o = o || {};
      const b = bucket(mat), n = pts.length, col = o.color || [1, 1, 1], L0 = [], L1 = [];
      for (let i = 0; i < n; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
        let tx = p1[0] - p0[0], ty = p1[1] - p0[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const nx = -ty * w / 2, ny = tx * w / 2;
        L0.push(hit(ray, pts[i][0] + nx, pts[i][1] + ny, off)); L1.push(hit(ray, pts[i][0] - nx, pts[i][1] - ny, off));
      }
      const base = b.pos.length / 3;
      for (let i = 0; i < n; i++) for (const h of [L0[i], L1[i]]) { if (h) { b.pos.push(...h.p); b.nrm.push(...h.n); } else { b.pos.push(0, 0, 0); b.nrm.push(0, 1, 0); } b.col.push(...col); b.uv.push(0, 0); }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2, c = a + 1, d = a + 3, e = a + 2;
        if (L0[i] && L1[i] && L1[i + 1]) orient(b, a, c, d);
        if (L0[i] && L1[i + 1] && L0[i + 1]) orient(b, a, d, e);
      }
      if (o.wall) {                           // קיר מהשפה החיצונית אל הגוף – נותן עובי (מסגרת גריל, שוליים)
        for (const Ls of [L0, L1]) {          // שני הקירות (חיצוני ופנימי), דו-צדדיים, נורמל = כיוון הרוחב
          const wb = b.pos.length / 3;
          for (let i = 0; i < n; i++) { const h = Ls[i], o2 = Ls === L0 ? L1[i] : L0[i];
            if (h && o2) { let sx2 = h.p[0] - o2.p[0], sy2 = h.p[1] - o2.p[1], sz2 = h.p[2] - o2.p[2]; const sl = Math.hypot(sx2, sy2, sz2) || 1; sx2 /= sl; sy2 /= sl; sz2 /= sl;
              b.pos.push(...h.p, h.p[0] - h.n[0] * off * 0.95, h.p[1] - h.n[1] * off * 0.95, h.p[2] - h.n[2] * off * 0.95); b.nrm.push(sx2, sy2, sz2, sx2, sy2, sz2); }
            else { b.pos.push(0, 0, 0, 0, 0, 0); b.nrm.push(0, 1, 0, 0, 1, 0); }
            b.col.push(...col, ...col); b.uv.push(0, 0, 0, 0); }
          for (let i = 0; i < n - 1; i++) { if (!Ls[i] || !Ls[i + 1] || !L1[i] || !L0[i]) continue; const a = wb + i * 2, c = a + 1, d = a + 3, e = a + 2; orient(b, a, c, d); orient(b, a, d, e); }
        }
      }
    }

    // ===== חלונות (צילומים 079/080/082: מסגרת שחורה, עמוד B שחור, זכוכית כהה מאוד)
    for (const sx of [1, -1]) {
      const rs = raySide(sx);
      const belt = z => lerp(0.952, 0.972, clamp((0.86 - z) / 2.06, 0, 1));        // קו חלון עולה מעט לאחור (צילום 079)
      // מסגרת DLO אחת (שחור מבריק), גדולה ב-1.2 ס"מ מהזכוכית; חלון אחורי משולש עם קצה חד לאחור
      const dloLo = [];
      for (let i = 0; i <= 24; i++) { const z = lerp(0.640, -1.225, i / 24); dloLo.push([z, belt(z) - 0.012]); }
      const dloUp = chaikin([[0.640, belt(0.640) - 0.012], [0.560, 1.040], [0.460, 1.140], [0.360, 1.240], [0.270, 1.318], [0.150, 1.342], [0.0, 1.346], [-0.40, 1.347], [-0.68, 1.340], [-0.84, 1.318], [-0.96, 1.272], [-1.06, 1.195], [-1.15, 1.080], [-1.225, belt(-1.225) - 0.012]], 3, false);
      patch(M.black, rs, dloLo, dloUp, 28, 5, 0.0058, { vf: t => 1 - (1 - t) * (1 - t) * (1 - t) });
      patch(M.black, rs, [[0.645, belt(0.645) - 0.010], [0.790, belt(0.79) - 0.010]], [[0.645, 1.035], [0.790, belt(0.79) + 0.004]], 4, 2, 0.0045);   // משולש מראה שחור
      // זכוכית דלת
      const dl = [];
      for (let i = 0; i <= 12; i++) { const z = lerp(0.600, -0.355, i / 12); dl.push([z, belt(z)]); }
      const dU = chaikin([[0.600, belt(0.600)], [0.530, 1.040], [0.430, 1.140], [0.335, 1.240], [0.255, 1.310], [0.140, 1.330], [0.0, 1.334], [-0.30, 1.334], [-0.355, 1.326], [-0.355, belt(-0.355)]], 2, false);
      patch(M.glass, rs, dl, dU, 16, 4, 0.0095, { vf: t => 1 - (1 - t) * (1 - t) });
      const ql = [], qu = chaikin([[-0.445, belt(-0.445)], [-0.445, 1.326], [-0.68, 1.328], [-0.83, 1.307], [-0.95, 1.262], [-1.05, 1.188], [-1.13, 1.085], [-1.205, belt(-1.205)]], 2, false);
      for (let i = 0; i <= 10; i++) { const z = lerp(-0.445, -1.205, i / 10); ql.push([z, belt(z)]); }
      patch(M.glass, rs, ql, qu, 12, 4, 0.0095, { vf: t => 1 - (1 - t) * (1 - t) });
    }
    // שמשה קדמית: מסגרת מוטה ~57° מהאנך, נורמל (0, 0.84, 0.545)
    {
      const D = [0, -0.84, -0.545], Vv = [0, 0.545, -0.84], C = [0, 1.15, 0.62];
      const rt = rayTilt(C, [1, 0, 0], Vv, D);
      const lo = [], up = [];
      for (let i = 0; i <= 16; i++) { const a = lerp(-1, 1, i / 16); lo.push([a * 0.655, -0.355 + 0.035 * a * a]); up.push([a * 0.565, 0.400 - 0.022 * a * a]); }
      patch(M.black, rt, lo.map(p => [p[0] * 1.0, p[1] - 0.012]), up.map(p => [p[0] * 1.012, p[1] + 0.012]), 22, 4, 0.004);
      patch(M.glass, rt, lo, up, 20, 4, 0.0075);
      // מגבים קדמיים (שחור, בבסיס השמשה)
      strip(M.black, rt, [[-0.62, -0.300], [-0.05, -0.322]], 0.016, 0.016);
      strip(M.black, rt, [[0.02, -0.318], [0.50, -0.300]], 0.016, 0.016);
    }
    // שמשה אחורית: מוטה ~45° מהאנך (צילום 079: מהספוילר בגובה 1.33 ועד 1.00 מעל הפנסים), טרפז עם פינות מעוגלות
    {
      const D = [0, -0.702, 0.712], Vv = [0, 0.712, 0.702], C = [0, 1.165, -1.535];
      const rt = rayTilt(C, [1, 0, 0], Vv, D);
      const lo = [], up = [];
      for (let i = 0; i <= 14; i++) { const a = lerp(-1, 1, i / 14), c = Math.pow(Math.abs(a), 8); lo.push([a * (0.622 - 0.03 * c), -0.212 + 0.035 * c]); up.push([a * (0.570 - 0.03 * c), 0.208 - 0.028 * c]); }
      patch(M.black, rt, lo.map(p => [p[0] * 1.025, p[1] - 0.016]), up.map(p => [p[0] * 1.025, p[1] + 0.02]), 20, 3, 0.004);
      patch(M.glass, rt, lo, up, 20, 4, 0.0075);
      strip(M.black, rt, [[0.03, -0.175], [-0.34, -0.150]], 0.014, 0.017);            // מגב אחורי
    }

    // ===== ספוילר גג שחור בקצה הגג (צילומים 079/080/082) – בולט מעל השמשה האחורית
    {
      const rows = [], NU = 14;
      for (let i = 0; i <= NU; i++) {
        const a = lerp(-1, 1, i / NU), xx = a * 0.575;
        const h0 = cast([xx, 2.5, -1.300], [0, -1, 0], 3); const y0 = h0 ? h0.p[1] : 1.36;
        const tipZ = -1.445 + 0.022 * a * a, droop = 0.020 * Math.pow(Math.abs(a), 3);
        rows.push([[xx, y0 + 0.003, -1.270], [xx * 1.004, y0 + 0.011 - droop * 0.4, -1.350], [xx * 1.008, y0 - 0.004 - droop, tipZ], [xx * 1.008, y0 - 0.030 - droop, tipZ + 0.024], [xx, y0 - 0.052 - droop * 0.6, -1.330]]);
      }
      const K = rows[0].length, sp = [], si = [];
      for (const r of rows) for (const p of r) sp.push(...p);
      for (let i = 0; i < NU; i++) for (let k = 0; k < K - 1; k++) { const a = i * K + k; si.push(a, a + K, a + K + 1, a, a + K + 1, a + 1); }
      for (const [i, sg2] of [[0, -1], [NU, 1]]) { const c = sp.length / 3; let cx = 0, cy = 0, cz = 0; for (let k = 0; k < K; k++) { cx += sp[(i * K + k) * 3]; cy += sp[(i * K + k) * 3 + 1]; cz += sp[(i * K + k) * 3 + 2]; } sp.push(cx / K, cy / K, cz / K);
        for (let k = 0; k < K; k++) { const a = i * K + k, b2 = i * K + ((k + 1) % K); if (sg2 > 0) si.push(c, a, b2); else si.push(c, b2, a); } }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setIndex(si); sg.computeVertexNormals();
      addGeo(sg, M.black);
    }

    // ===== פנסים אחוריים בצורת A1 8X: טריז שעוטף את הפינה אל הצד, קצה פנימי מחודד, קצה קדמי אלכסוני (צילומים 079–082)
    for (const sx of [1, -1]) {
      const rw = rayWrap(sx, false, 0.20, 0.60, ZR + 0.26, 0.36, 0.30);
      const up = chaikin([[0.180, 0.812], [0.215, 0.838], [0.300, 0.858], [0.400, 0.870], [0.560, 0.880], [0.720, 0.885], [0.860, 0.884], [0.960, 0.878], [1.000, 0.868]], 2, false);
      const lo = chaikin([[0.180, 0.812], [0.210, 0.792], [0.300, 0.768], [0.450, 0.754], [0.600, 0.748], [0.740, 0.750], [0.840, 0.764], [0.930, 0.806], [1.000, 0.868]], 2, false);
      patch(M.black, rw, lo.map(p => [p[0], p[1] - 0.009]), up.map(p => [p[0], p[1] + 0.008]), 20, 2, 0.003);
      patch(M.tail, rw, lo, up, 22, 4, 0.010, { dome: 0.007 });
      // מוביל אור בהיר (פס עליון שעוטף + קשת תחתונה) ואזור שקוף (רוורס) בחלק הפנימי
      strip(M.tailGlow, rw, chaikin([[0.240, 0.840], [0.420, 0.856], [0.640, 0.866], [0.850, 0.866], [0.950, 0.860]], 2, false), 0.014, 0.0175);
      strip(M.tailGlow, rw, chaikin([[0.300, 0.788], [0.480, 0.772], [0.660, 0.768], [0.800, 0.780]], 2, false), 0.008, 0.0175);
    }

    // ===== פנסים קדמיים (גל בקו התחתון, עוטפים אל הכנף; צילומים 075–078)
    for (const sx of [1, -1]) {
      const rw = rayWrap(sx, true, 0.22, 0.58, ZF - 0.27, 0.36, 0.34);
      const s0 = 0.155;
      const up = chaikin([[0.00, 0.612], [0.05, 0.640], [0.16, 0.676], [0.28, 0.706], [0.38, 0.724], [0.48, 0.736], [0.57, 0.742], [0.65, 0.738], [0.72, 0.726]].map(p => [s0 + p[0], p[1]]), 2, false);
      const lo = chaikin([[0.00, 0.612], [0.06, 0.584], [0.14, 0.566], [0.22, 0.568], [0.30, 0.588], [0.40, 0.604], [0.50, 0.618], [0.60, 0.640], [0.72, 0.726]].map(p => [s0 + p[0], p[1]]), 2, false);
      patch(M.black, rw, lo.map(p => [p[0], p[1] - 0.007]), up.map(p => [p[0], p[1] + 0.006]), 16, 2, 0.003);
      patch(M.lamp, rw, lo, up, 18, 4, 0.009, { dome: 0.006 });
      strip(M.drl, rw, chaikin([[s0 + 0.05, 0.620], [s0 + 0.20, 0.652], [s0 + 0.36, 0.684], [s0 + 0.52, 0.706], [s0 + 0.66, 0.716]], 2, false), 0.009, 0.0165);
      for (const [cs, cy, rr] of [[s0 + 0.25, 0.632, 0.032], [s0 + 0.42, 0.664, 0.036]]) strip(M.chrome, rw, circle(cs, cy, rr, rr * 0.9, 10), 0.008, 0.016);
    }

    // ===== גריל Singleframe (מסגרת כרום, רשת שחורה עם פסים אופקיים), טבעות, לוחית קדמית
    {
      const G = [[-0.300, 0.648], [0.300, 0.648], [0.400, 0.590], [0.398, 0.420], [0.382, 0.310], [0.330, 0.258], [-0.330, 0.258], [-0.382, 0.310], [-0.398, 0.420], [-0.400, 0.590]];
      const loop = chaikin(G, 2, true); loop.push(loop[0]);
      const lo = [], up = [];
      const gBot = x => 0.258 + Math.max(0, Math.abs(x) - 0.33), gTop = x => 0.648 - Math.max(0, Math.abs(x) - 0.30) * 0.58;
      const gHalf = y => (y > 0.59 ? 0.30 + (0.648 - y) * 1.724 : y < 0.31 ? 0.33 + (y - 0.258) : 0.395);
      for (let i = 0; i <= 16; i++) { const x = lerp(-0.392, 0.392, i / 16); lo.push([x, gBot(x)]); up.push([x, gTop(x)]); }
      patch(M.plastic, rayFront, lo, up, 16, 4, 0.006);
      for (const y of [0.300, 0.345, 0.390, 0.500, 0.540, 0.580, 0.618]) { const hw = gHalf(y) - 0.016; strip(M.black, rayFront, [[-hw, y], [hw, y]], 0.010, 0.010); }
      strip(M.chrome, rayFront, loop, 0.022, 0.016, { wall: true });
      for (let r = 0; r < 4; r++) strip(M.chrome, rayFront, circle((r - 1.5) * 0.058, 0.575, 0.034, 0.034, 12), 0.0065, 0.022);
      const tp = hit(rayFront, 0, 0.462, 0.012), bp = hit(rayFront, 0, 0.348, 0.012);
      if (tp && bp) {
        const cy = (tp.p[1] + bp.p[1]) / 2, cz = (tp.p[2] + bp.p[2]) / 2, tilt = Math.atan2(tp.p[2] - bp.p[2], tp.p[1] - bp.p[1]);
        addGeo(new THREE.BoxGeometry(0.535, 0.125, 0.012), M.plastic, M4([0, cy, cz - 0.004], [-tilt, 0, 0]));
        addGeo(new THREE.PlaneGeometry(0.520, 0.114), M.plate, M4([0, cy, cz + 0.0025], [-tilt, 0, 0]));
      }
      // פנסי ערפל/פתחי אוויר צדדיים (רשת שחורה) + פס תחתון
      for (const sx of [1, -1]) {
        const rw = rayWrap(sx, true, 0.40, 0.58, ZF - 0.27, 0.36, 0.2);
        patch(M.plastic, rw, [[0.10, 0.282], [0.34, 0.300]], [[0.08, 0.352], [0.35, 0.376]], 8, 2, 0.005);
        strip(M.black, rw, chaikin([[0.08, 0.355], [0.35, 0.379], [0.36, 0.300], [0.11, 0.279], [0.08, 0.355]], 1, false), 0.008, 0.008);
      }
    }

    // ===== אחור: לוחית (מוטה כמו הדלת), טבעות, תגים, תפר פגוש, מחזירי אור, אגזוז בשמאל (צילום 081)
    {
      const tp = hit(rayRear, 0, 0.758, 0.012), bp = hit(rayRear, 0, 0.642, 0.012);
      if (tp && bp) {
        const cy = (tp.p[1] + bp.p[1]) / 2, cz = (tp.p[2] + bp.p[2]) / 2, tilt = Math.atan2(tp.p[2] - bp.p[2], tp.p[1] - bp.p[1]);
        addGeo(new THREE.BoxGeometry(0.540, 0.128, 0.012), M.plastic, M4([0, cy, cz + 0.004], [-tilt, 0, 0]));
        addGeo(new THREE.PlaneGeometry(0.520, 0.114), M.plate, M4([0, cy, cz - 0.0025], [-tilt, Math.PI, 0]));
      }
      for (let r = 0; r < 4; r++) strip(M.chrome, rayRear, circle(-(r - 1.5) * 0.050, 0.826, 0.028, 0.023, 12), 0.0055, 0.008);
      strip(M.chrome, rayRear, [[0.44, 0.662], [0.37, 0.662]], 0.016, 0.006);            // "A1" (משמאל לצופה = +x)
      strip(M.chrome, rayRear, [[-0.36, 0.652], [-0.44, 0.652]], 0.012, 0.006);          // "TFSI"
      strip(M.black, rayRear, chaikin([[-0.46, 0.618], [-0.30, 0.624], [0, 0.626], [0.30, 0.624], [0.46, 0.618]], 2, false), 0.004, 0.002);   // תפר פגוש/דלת תא מטען
      for (const px of [-0.50, -0.17, 0.17, 0.50]) strip(M.plastic, rayRear, circle(px, 0.470, 0.011, 0.011, 8), 0.006, 0.002);   // חיישני חניה
      for (const sx of [1, -1]) {             // פס פלסטיק שחור תחתון שעוטף את פינות הפגוש + מחזירי אור אדומים
        const rw = rayWrap(sx, false, 0.0, 0.60, ZR + 0.26, 0.36, 0.25);
        patch(M.plastic, rw, chaikin([[0.0, 0.268], [0.50, 0.270], [0.80, 0.286], [0.98, 0.300], [1.10, 0.318]], 1, false), chaikin([[0.0, 0.332], [0.50, 0.334], [0.80, 0.340], [0.98, 0.338], [1.10, 0.330]], 1, false), 14, 2, 0.004);
        patch(M.tailGlow, rw, [[0.86, 0.350], [0.98, 0.352]], [[0.86, 0.372], [0.98, 0.374]], 3, 1, 0.006);
      }
      const ex = hit(rayRear, 0.475, 0.262, 0);
      if (ex) {
        const ez = ex.p[2] - 0.02;
        addGeo(new THREE.CylinderGeometry(0.036, 0.036, 0.11, 12, 1, true), M.chrome, M4([0.475, 0.252, ez], [Math.PI / 2, 0, 0]));
        addGeo(new THREE.CircleGeometry(0.031, 10), M.plastic, M4([0.475, 0.252, ez - 0.04], [0, Math.PI, 0]));
      }
    }

    // ===== צד: קווי דלת, ידית לבנה, מכסה דלק (ימין), מראות לבנות על בסיס שחור
    for (const sx of [1, -1]) {
      const rs = raySide(sx);
      const door = chaikin([[0.848, 0.945], [0.866, 0.860], [0.874, 0.640], [0.858, 0.420], [0.812, 0.262], [0.760, 0.234], [-0.420, 0.234], [-0.468, 0.262], [-0.478, 0.420], [-0.458, 0.700], [-0.436, 0.880], [-0.430, 0.960]], 2, false);
      strip(M.black, rs, resample(door, 26), 0.0045, 0.0018);
      // ידית (לבנה) + שקע כהה
      const hp = hit(rs, -0.300, 0.812, 0);
      if (hp) {
        const hx = hp.p[0];
        addGeo(new THREE.BoxGeometry(0.016, 0.040, 0.150), M.black, M4([hx + sx * 0.001, 0.812, -0.300]));
        addGeo(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.011, 0.11, 3, 8) : new THREE.CylinderGeometry(0.011, 0.011, 0.13, 8), M.paint, M4([hx + sx * 0.014, 0.818, -0.296], [Math.PI / 2, 0, 0]));
      }
      if (sx < 0) strip(M.black, rs, circle(-1.355, 0.870, 0.068, 0.068, 24), 0.004, 0.0018);   // מכסה דלק – צד ימין
      // מראה: רגל שחורה על הדלת, כיפה לבנה, זכוכית לאחור, איתות
      const mb = hit(rs, 0.700, 0.985, 0);
      if (mb) {
        const bx = mb.p[0];
        addGeo(new THREE.BoxGeometry(0.060, 0.050, 0.110), M.black, M4([bx + sx * 0.022, 0.997, 0.705], [0, 0, -sx * 0.18]));
        addGeo(new THREE.BoxGeometry(0.085, 0.030, 0.060), M.black, M4([bx + sx * 0.070, 1.017, 0.690], [0, -sx * 0.10, -sx * 0.25]));
        const cx = sx * Math.min(Math.abs(bx) + 0.092, 0.876), cy = 1.053, cz = 0.665;      // קצה המראה ≤ 0.966 (רוחב כולל ≤ 1.94)
        addGeo(new THREE.SphereGeometry(1, 12, 8), M.paint, M4([cx, cy, cz], [0, -sx * 0.12, 0], [0.090, 0.062, 0.058]));
        addGeo(new THREE.CircleGeometry(1, 14), M.glass, M4([cx - sx * 0.006, cy - 0.002, cz - 0.0585], [0, Math.PI - sx * 0.12, 0], [0.080, 0.050, 1]));
        addGeo(new THREE.BoxGeometry(0.150, 0.020, 0.080), M.black, M4([cx, cy - 0.044, cz + 0.004], [0, -sx * 0.12, 0]));
        addGeo(new THREE.BoxGeometry(0.055, 0.007, 0.012), M.drl, M4([cx + sx * 0.040, cy - 0.028, cz + 0.040], [0, sx * 0.5, 0]));
      }
    }
    // קווי מכסה מנוע (לאורך הכנפיים ומעל הגריל)
    for (const sx of [1, -1]) strip(M.black, raySide(sx), chaikin([[0.93, 0.806], [1.20, 0.798], [1.45, 0.786], [1.62, 0.772]], 2, false), 0.0045, 0.0018);   // מכסה מנוע "צדפה": התפר בצד, בגובה קו הכתף (צילום 079)

    // ===== פנים (נראה בגוף ראשון): לוח מחוונים, גגון שעונים, הגה, מסך MMI, עמודי A, מראה פנימית
    {
      const IC = { dash: [0.17, 0.175, 0.185], dark: [0.07, 0.072, 0.078], beige: [0.72, 0.60, 0.45], vent: [0.6, 0.62, 0.65] };
      const dash = new THREE.Shape(); dash.moveTo(0.860, 0.935); dash.lineTo(0.700, 0.975); dash.quadraticCurveTo(0.530, 0.995, 0.470, 0.945); dash.lineTo(0.440, 0.820); dash.lineTo(0.520, 0.700); dash.lineTo(0.880, 0.700); dash.closePath();
      const dg = new THREE.ExtrudeGeometry(dash, { depth: 1.24, bevelEnabled: false, curveSegments: 4 });
      dg.rotateY(-Math.PI / 2); dg.translate(0.62, 0, 0);      // צורה (z,y) → מתיחה לאורך x
      addGeo(dg, M.interior, null, IC.dash);
      addGeo(new THREE.CylinderGeometry(0.16, 0.16, 0.10, 12, 1, false, -Math.PI / 2, Math.PI), M.interior, M4([0.37, 0.985, 0.585], [0, 0, Math.PI / 2], [1, 1, 0.55]), IC.dark);   // גגון שעונים
      for (const gx of [0.30, 0.44]) { addGeo(new THREE.RingGeometry(0.036, 0.041, 14), M.chrome, M4([gx, 0.975, 0.528], [0.35, Math.PI, 0])); addGeo(new THREE.CircleGeometry(0.036, 14), M.interior, M4([gx, 0.974, 0.531], [0.35, Math.PI, 0]), IC.dark); }
      addGeo(new THREE.TorusGeometry(0.170, 0.016, 4, 16), M.interior, M4([0.37, 0.930, 0.430], [0.40, 0, 0]), IC.dark);           // הגה
      addGeo(new THREE.CylinderGeometry(0.050, 0.056, 0.05, 8), M.interior, M4([0.37, 0.930, 0.442], [Math.PI / 2 + 0.40, 0, 0]), IC.dark);
      addGeo(new THREE.BoxGeometry(0.29, 0.020, 0.03), M.interior, M4([0.37, 0.905, 0.438], [0.40, 0, 0]), IC.dark);
      addGeo(new THREE.BoxGeometry(0.20, 0.100, 0.012), M.interior, M4([-0.02, 1.000, 0.600], [0.15, 0, 0]), IC.dark);             // MMI
      for (const vx of [-0.18, 0.12]) addGeo(new THREE.TorusGeometry(0.034, 0.008, 4, 10), M.interior, M4([vx, 0.880, 0.468], [0, 0, 0]), IC.vent);
      for (const sx of [1, -1]) {             // עמודי A פנימיים + מדפן
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-sx * 0.065, 0.32, -0.50).normalize());
        addGeo(new THREE.BoxGeometry(0.045, 0.56, 0.030), M.interior, new THREE.Matrix4().compose(new THREE.Vector3(sx * 0.600, 1.090, 0.585), q, new THREE.Vector3(1, 1, 1)), IC.dash);
      }
      addGeo(new THREE.BoxGeometry(0.22, 0.060, 0.020), M.interior, M4([0, 1.250, 0.240], [0.1, 0, 0]), IC.dark);   // מראה פנימית
      for (const sx of [1, -1]) {             // מושבים (בז') – נראים דרך השמשה
        addGeo(new THREE.BoxGeometry(0.46, 0.13, 0.50), M.interior, M4([sx * 0.37, 0.50, -0.05]), IC.beige);
        addGeo(new THREE.BoxGeometry(0.46, 0.62, 0.11), M.interior, M4([sx * 0.37, 0.86, -0.33], [-0.22, 0, 0]), IC.beige);
      }
    }

    // ===== צל מגע (משטח שקוף מתחת לרכב)
    { const sg = new THREE.PlaneGeometry(1.90, 3.96); sg.rotateX(-Math.PI / 2); const sm = new THREE.Mesh(sg, M.shadow); sm.position.set(0, 0.012, (ZF + ZR) / 2); sm.renderOrder = -1; sm.name = 'ariel-a1-shadow'; g.add(sm); }

    // איחוד: Mesh אחד לכל חומר
    for (const [mat, b] of buckets) {
      if (!b.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      if (mat.vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      if (b.uvOn) geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setIndex(b.idx);
      const mesh = new THREE.Mesh(geo, mat); mesh.name = 'ariel-a1-' + (Object.keys(M).find(k => M[k] === mat) || 'part');
      if (mat === M.paint) mesh.castShadow = true;
      if (mat === M.interior) g.userData.interior = mesh;
      g.add(mesh);
    }

    // ===== גלגלים: צמיג (+ דיסק כהה פנימי) וחישוק 10 חישורים – 2 קריאות ציור לגלגל
    const wheels = [];
    const tireProf = [[0.226, -0.094], [0.262, -0.106], [0.287, -0.103], [0.298, -0.088], [0.300, -0.050], [0.300, 0.050], [0.298, 0.088], [0.287, 0.103], [0.262, 0.106], [0.226, 0.094]].map(p => new THREE.Vector2(p[0], p[1]));
    const tireGeo = new THREE.LatheGeometry(tireProf, 16); tireGeo.rotateZ(Math.PI / 2);
    const lipProf = [[0.212, 0.058], [0.222, 0.084], [0.229, 0.090], [0.230, 0.096], [0.222, 0.097]].map(p => new THREE.Vector2(p[0], p[1]));
    function rimGeometry(sx) {
      const parts = [];
      const lip = new THREE.LatheGeometry(lipProf, 16); lip.rotateZ(-Math.PI / 2); parts.push(lip);
      const pos = [], idx = [];
      for (let k = 0; k < 10; k++) {          // חישור: מנסרה משולשת (רכס) מהטבור אל השפה, קעורה פנימה
        const a = (k / 10) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), tx = -sa, ty = ca;
        const P = (r, w, h) => [h, ca * r + tx * w, sa * r + ty * w];
        const r0 = 0.050, r1 = 0.214, w0 = 0.016, w1 = 0.011, h0 = 0.072, h1 = 0.088, hr0 = 0.086, hr1 = 0.096;
        const v = [P(r0, -w0, h0), P(r0, 0, hr0), P(r0, w0, h0), P(r1, -w1, h1), P(r1, 0, hr1), P(r1, w1, h1)];
        const b = pos.length / 3; for (const q of v) pos.push(...q);
        idx.push(b, b + 3, b + 4, b, b + 4, b + 1, b + 1, b + 4, b + 5, b + 1, b + 5, b + 2);
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx); sg.computeVertexNormals(); parts.push(sg);
      const hub = new THREE.CylinderGeometry(0.058, 0.062, 0.03, 8); hub.rotateZ(Math.PI / 2); hub.translate(0.084, 0, 0); parts.push(hub);
      const out = { pos: [], nrm: [], idx: [] };
      for (const pg of parts) {
        const gg = pg.index ? pg : pg; const p = gg.attributes.position, n = gg.attributes.normal, base = out.pos.length / 3;
        for (let i = 0; i < p.count; i++) { out.pos.push(sx * p.getX(i), p.getY(i), p.getZ(i)); out.nrm.push(sx * n.getX(i), n.getY(i), n.getZ(i)); }
        const ix = gg.index ? gg.index.array : [...Array(p.count).keys()];
        for (let i = 0; i < ix.length; i += 3) { if (sx > 0) out.idx.push(base + ix[i], base + ix[i + 1], base + ix[i + 2]); else out.idx.push(base + ix[i], base + ix[i + 2], base + ix[i + 1]); }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3)); geo.setIndex(out.idx);
      return geo;
    }
    const rimL = rimGeometry(1), rimRt = rimGeometry(-1);
    const backL = new THREE.CircleGeometry(0.228, 14); backL.rotateY(Math.PI / 2); backL.translate(0.045, 0, 0);
    const backR = new THREE.CircleGeometry(0.228, 14); backR.rotateY(-Math.PI / 2); backR.translate(-0.045, 0, 0);
    const tireL = mergeTwo(tireGeo, backL), tireRt = mergeTwo(tireGeo, backR);
    function mergeTwo(a, b2) {
      const out = { pos: [], nrm: [], idx: [] };
      for (const gg of [a, b2]) { const p = gg.attributes.position, n = gg.attributes.normal, base = out.pos.length / 3; for (let i = 0; i < p.count; i++) { out.pos.push(p.getX(i), p.getY(i), p.getZ(i)); out.nrm.push(n.getX(i), n.getY(i), n.getZ(i)); } const ix = gg.index ? gg.index.array : [...Array(p.count).keys()]; for (const v of ix) out.idx.push(base + v); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3)); geo.setIndex(out.idx); return geo;
    }
    for (const sz of [1, -1]) for (const sx of [1, -1]) {
      const wg = new THREE.Group(); wg.name = 'ariel-a1-wheel';
      wg.position.set(sx * (sz > 0 ? TRK : TRK_R) / 2, R, sz * WB / 2);
      const tm = new THREE.Mesh(sx > 0 ? tireL : tireRt, M.tire); tm.castShadow = true; wg.add(tm);
      wg.add(new THREE.Mesh(sx > 0 ? rimL : rimRt, M.alloy));
      g.add(wg); wheels.push(wg);
    }

    g.userData.ownWheels = wheels;
    g.userData.mats = M;
    g.userData.body = { rings: body.rings.length, perRing: NP };
    return g;
  }

  // ---- חיבור לעולם: מחפשים בסצנה את קבוצת רכב השחקן (userData.wheels), מסתירים את ילדיה (גם דגם CC0 שנטען באיחור) ומחזירים הכול ב-dispose.
  const ST = { car: null, model: null, beam: null, hidden: [], wheelsOrig: null, world: null, day: -1, lights: null, tier: null, paintStd: null, unsub: null, lift: 0, liftCur: 0, roadT: 0 };
  const qp = k => { try { return typeof location !== 'undefined' ? new URLSearchParams(location.search).get(k) : null; } catch (e) { return null; } };
  const off = () => qp('ariel-car') === '0';
  function setTier(tier) {                    // מכשיר חלש: צבע בלי ציפוי שקוף (MeshStandard) – זול יותר בשיידר
    if (!ST.model || tier === ST.tier) return; ST.tier = tier;
    const body = ST.model.getObjectByName('ariel-a1-body'), paint2 = ST.model.getObjectByName('ariel-a1-paint'), M = ST.model.userData.mats;
    if (!ST.paintStd) ST.paintStd = new THREE.MeshStandardMaterial({ color: M.paint.color, roughness: 0.3, metalness: 0, envMap: M.paint.envMap, envMapIntensity: M.paint.envMapIntensity, vertexColors: true });
    const m = tier === 'low' ? ST.paintStd : M.paint;
    if (body) body.material = m; if (paint2) paint2.material = m;
  }
  const driving = world => !!(world && world.player && world.player.mode === 'car');   // פנסים דולקים רק כשנוהגים
  function daylight(world) {                  // אותו חישוב כמו המשחק: יום מלא מעל 10°, לילה מתחת ל־4°−
    const el = world && world.sun && isFinite(world.sun.elevation) ? world.sun.elevation : 30;
    return clamp((el + 4) / 14, 0, 1);
  }
  function applyLight(day, lightsOn) {        // יום/לילה: עוצמת השתקפויות, פנסים (בנהיגה בלבד), כתם אור על הכביש
    if (!ST.model || (Math.abs(day - ST.day) < 0.01 && lightsOn === ST.lights)) return; ST.day = day; ST.lights = lightsOn;
    const M = ST.model.userData.mats, env = 0.25 + 0.75 * day, n = lightsOn ? 1 - day : 0;
    M.paint.envMapIntensity = 0.95 * env; if (ST.paintStd) ST.paintStd.envMapIntensity = 0.95 * env;
    M.glass.envMapIntensity = 1.1 * env; M.black.envMapIntensity = 0.9 * env; M.chrome.envMapIntensity = 1.35 * env; M.alloy.envMapIntensity = 1.15 * env;
    M.lamp.envMapIntensity = 1.3 * env; M.tail.envMapIntensity = 1.1 * env; M.plastic.envMapIntensity = 0.3 * env;
    M.tail.emissiveIntensity = 0.10 + 0.95 * n; M.tailGlow.emissiveIntensity = 0.55 + 2.2 * n;
    M.lamp.emissiveIntensity = 0.0 + 1.1 * n; M.drl.emissiveIntensity = 0.6 + 1.4 * n;
    M.shadow.opacity = 0.85 - 0.25 * (1 - day); M.plate.emissiveIntensity = 0.22 * n;   // תאורת לוחית
    if (ST.beam) { ST.beam.material.opacity = 0.95 * n; ST.beam.visible = n > 0.04; }
  }
  const adapter = {
    id: 'ariel-car',
    name: 'הרכב של אריאל (אאודי A1)',
    dept: 'assets',
    order: 57,
    init(world, api) {
      if (off()) return;
      ST.world = world || null;
      world.scene.traverse(o => { if (!ST.car && o.userData && o.userData.wheels && o.isGroup) ST.car = o; });
      if (!ST.car) throw new Error('רכב המשחק לא נמצא');
      const m = build({ roofBlack: qp('ariel-roof') === 'black' });
      for (const c of ST.car.children) { if (c.visible) { c.visible = false; ST.hidden.push(c); } }
      ST.car.add(m); ST.model = m;
      ST.wheelsOrig = ST.car.userData.wheels; ST.car.userData.wheels = m.userData.ownWheels;
      ST.beam = makeBeam(); ST.car.add(ST.beam);   // אור על הכביש – אפקט עולם, לא חלק ממידות הרכב (לכן לא בתוך build)
      world.arielCar = { plate: PLATE, model: 'Audi A1 8X 3-door', source: 'photos 075–082', version: 'car-battalion-5' };
      setTier(world.quality && world.quality.tier); applyLight(daylight(world), driving(world));
      if (api && typeof api.on === 'function') ST.unsub = api.on('quality', q => setTier(q && q.tier));
    },
    update(dt, world) {   // נכסי CC0 נטענים באיחור ומסתירים את כל הילדים – מוודאים שהרכב שלנו נראה והשאר מוסתר
      if (!ST.car || !ST.model) return; if (!ST.model.visible) ST.model.visible = true;
      for (const c of ST.car.children) if (c !== ST.model && c !== ST.beam && c.visible) { c.visible = false; if (!ST.hidden.includes(c)) ST.hidden.push(c); }
      const w = world || ST.world; applyLight(daylight(w), driving(w));
      // כבישי העולם מורמים 10–16 ס"מ מעל פני הקרקע (world.js: ribbon lift) והמשחק מציב את הרכב על הקרקע – בכביש הגלגלים "שוקעים".
      // מרימים את הדגם שלנו בגובה הכביש (4 בדיקות בשנייה, מעבר רך); הפנים נשאר במקומו כדי שמבט הנהג לא ישתנה.
      const S = w && w.G27 && w.G27.S, dd = w && w.data;
      if (S && S.car && dd && typeof dd.onRoad === 'function') {
        ST.roadT -= dt || 0; if (ST.roadT <= 0) { ST.roadT = 0.25; let r = false; try { r = dd.onRoad(S.car.x, S.car.z); } catch (e) { r = false; } ST.lift = r ? 0.10 + (r.c || 0) * 0.015 : 0; }
        ST.liftCur += (ST.lift - ST.liftCur) * Math.min(1, (dt || 0.016) * 8);
        ST.model.position.y = ST.liftCur; const im = ST.model.userData.interior; if (im) im.position.y = -ST.liftCur;
        if (ST.beam) ST.beam.position.y = 0.03 + ST.liftCur;
      }
      for (const wh of ST.model.userData.ownWheels) {   // המשחק מסובב לפי רדיוס 0.36; לצמיג A1 (0.30) מוסיפים את ההפרש כדי שהגלגל לא "יחליק"
        const r = wh.rotation.x; if (wh.userData.prevRot !== undefined) wh.rotation.x += (r - wh.userData.prevRot) * (0.36 / R - 1); wh.userData.prevRot = wh.rotation.x;
      }
    },
    dispose() {
      if (ST.model && ST.car) ST.car.remove(ST.model);
      if (ST.beam && ST.car) { ST.car.remove(ST.beam); ST.beam.geometry.dispose(); ST.beam.material.dispose(); }
      if (ST.car && ST.wheelsOrig) ST.car.userData.wheels = ST.wheelsOrig;
      for (const c of ST.hidden) c.visible = true;
      if (ST.world && ST.world.arielCar) delete ST.world.arielCar;
      if (typeof ST.unsub === 'function') try { ST.unsub(); } catch (e) { /* */ }
      ST.lift = 0; ST.liftCur = 0; ST.roadT = 0;
      ST.hidden = []; ST.model = null; ST.beam = null; ST.car = null; ST.wheelsOrig = null; ST.world = null; ST.day = -1; ST.lights = null; ST.tier = null; ST.paintStd = null; ST.unsub = null;
    }
  };

  if (typeof YZW !== 'undefined' && YZW && typeof YZW.register === 'function') {
    YZW.register(adapter);
  }
  if (typeof module === 'object' && module && module.exports) {
    module.exports = { plateTex, rimTex, build, adapter };
  }
})();
