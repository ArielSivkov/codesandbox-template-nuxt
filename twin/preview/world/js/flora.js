/* 27wrld · flora.js — גדוד הצמחייה (24.11.2026): עצים, דקלים ושיחים משכנעים במקום גושים מצולעים.
   מודול אחד, בלי קבצים חיצוניים, three r186 (window.THREE). נטען לפני world.js; גם מחלקת הצמחייה (mods/vegetation) משתמשת בו דרך המתאם.

   מה יש כאן:
   · אטלס פרוצדורלי אחד (קנבס, נוצר פעם אחת): צבע + normal. 1024² בטלפון, 2048² במחשב (?flora_tex=1024|2048).
     תאי עלים (פיקוס, רחב, מנוצה, צר, מחטים, קשקשים, עשב, מניפת וושינגטוניה, כף תמר, חצאית יבשה, תמרים, רתם)
     + רצועות קליפה (חלקה, מבוקעת, וושינגטוניה, תמר) שחוזרות לאורך הגזע. הצבעים "ניטרליים-בהירים": הגוון בא מצבע המין.
   · בוני גאומטריה: גזע מעוגל עם קליפה + כתר מאשכולות כרטיסי עלים (alpha-test), נורמלים "כדוריים" (הכתר מואר כנפח);
     דקל תמר: כפות בחתך V עם עלעלים; וושינגטוניה: מניפות + חצאית כפות יבשות; שיחים/עשב/רתם בגרסה זולה.
     אותן תכונות שמחלקת הצמחייה צריכה לעונות ולרוח (aPart/aCenter/aMask/aBend).
   · טלאי שיידר משותף: תאורה דו-צדדית לעלים (בלי היפוך נורמל בגב), עטיפה + שקיפות לאור שמש מאחור, שימור כיסוי האלפא
     במרחק (מיפמפ), לילה: הרמה עדינה (העלים לא שחורים) + אור מ-8 הפנסים הקרובים (נתרן כתום / LED לבן, לכל קודקוד), צל רק לעצים קרובים.
   ממשק: ESHFlora.init(opts) · .tex · .speciesModel(sp, detail) · .worldModel(kind, lo) · .material(opts) · .depthMaterial(opts)
          .patch(shader, opts) · .uniforms · .update(world?) · .bakeDay(on) · .stats()  */
(function () {
'use strict';
const T = window.THREE; if (!T) return;
const F = window.ESHFlora = window.ESHFlora || {};
F.version = '1.0';
const V3 = T.Vector3;
const qs = new URLSearchParams(location.search);
const TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;

// ------------------------------------------------------------------ עזר
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// ------------------------------------------------------------------ פריסת האטלס (יחידות של 1024; y למטה כמו בקנבס)
const CELL = {
  ficus: [0, 0, 256, 256], broad: [256, 0, 256, 256], pinnate: [512, 0, 256, 256], narrow: [768, 0, 256, 256],
  needle: [0, 256, 256, 256], fan: [256, 256, 256, 256], scale: [512, 256, 256, 256], grass: [768, 256, 256, 256],
  frond: [0, 512, 1024, 128],
  skirt: [0, 640, 512, 128], dates: [512, 640, 128, 128], broom: [640, 640, 128, 128],
};
// רצועות קליפה: [y0, גובה, מטרים לחזרה לאורך הגזע]. x = לאורך הגזע (חוזר), y = היקף. אזור 768–1023 אטום (שוליים בלי חורים).
const BARK = { smooth: [776, 60, 4.0], fissured: [836, 60, 3.0], wash: [896, 60, 7.0], phoe: [956, 60, 5.4] };
const FAN = { c: [128, 146], r: 108, a0: -200 * Math.PI / 180, a1: 20 * Math.PI / 180 };   // מניפה בתא (מרכז, רדיוס, טווח זווית בקנבס)
F.CELL = CELL; F.BARK = BARK;

// ------------------------------------------------------------------ ציור האטלס
function paintAtlas(S) {
  const k = S / 1024, R = rng(27027);
  const col = document.createElement('canvas'); col.width = col.height = S;
  const hgt = document.createElement('canvas'); hgt.width = hgt.height = S;
  const cx = col.getContext('2d'), hx = hgt.getContext('2d');
  hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S);
  cx.setTransform(k, 0, 0, k, 0, 0); hx.setTransform(k, 0, 0, k, 0, 0);
  const rgb = (r, g, b, a) => a == null ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  const grey = v => rgb(v, v, v);
  const vary = (c, s) => { const f = 1 + (R() - 0.5) * s / 150, h = (R() - 0.5) * s * 0.35; return [c[0] * f + h * 0.6, c[1] * f + h * 0.15, c[2] * f - h * 0.7]; };   // בהירות + גוון צהבהב/כחלחל (בלי סגול)
  const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
  // צורת עלה במערכת מקומית: בסיס (0,0), קצה (L,0)
  function leafPath(c, L, W, fat) { const a = fat == null ? 0.32 : fat; c.beginPath(); c.moveTo(0, 0);
    c.bezierCurveTo(L * a, -W * 1.15, L * 0.78, -W * 0.85, L, 0); c.bezierCurveTo(L * 0.78, W * 0.85, L * a, W * 1.15, 0, 0); c.closePath(); }
  function leaf(x, y, ang, L, W, base, tip, o) {
    o = o || {};
    cx.save(); cx.translate(x, y); cx.rotate(ang); leafPath(cx, L, W, o.fat);
    const g = cx.createLinearGradient(0, 0, L, 0); g.addColorStop(0, rgb(...base)); g.addColorStop(1, rgb(...tip)); cx.fillStyle = g; cx.fill();
    if (o.under) { cx.save(); cx.clip(); cx.fillStyle = rgb(...o.under, 0.55); cx.fillRect(0, 0, L, W * 1.2); cx.restore(); }   // צד תחתון בהיר (זית)
    cx.lineWidth = Math.max(0.5, W * 0.13); cx.strokeStyle = 'rgba(255,255,235,0.30)'; cx.beginPath(); cx.moveTo(L * 0.03, 0); cx.quadraticCurveTo(L * 0.5, -W * 0.08, L * 0.93, 0); cx.stroke();
    if (o.veins) { cx.lineWidth = 0.6; cx.strokeStyle = 'rgba(255,255,230,0.18)'; for (let i = 1; i <= o.veins; i++) { const t = i / (o.veins + 1); cx.beginPath(); cx.moveTo(L * t, 0); cx.lineTo(L * (t + 0.12), -W * 0.75); cx.moveTo(L * t, 0); cx.lineTo(L * (t + 0.12), W * 0.75); cx.stroke(); } }
    cx.lineWidth = 0.7; cx.strokeStyle = 'rgba(30,40,20,0.28)'; leafPath(cx, L, W, o.fat); cx.stroke();
    if (o.glint && R() < o.glint) { cx.fillStyle = 'rgba(255,255,250,0.35)'; cx.beginPath(); cx.ellipse(L * 0.45, -W * 0.25, L * 0.16, W * 0.18, 0, 0, 7); cx.fill(); }
    cx.restore();
    hx.save(); hx.translate(x, y); hx.rotate(ang); leafPath(hx, L, W, o.fat);
    const hv = o.h != null ? o.h : 150 + R() * 90, gh = hx.createLinearGradient(0, -W, 0, W);
    gh.addColorStop(0, grey(hv * 0.35)); gh.addColorStop(0.5, grey(hv)); gh.addColorStop(1, grey(hv * 0.35)); hx.fillStyle = gh; hx.fill(); hx.restore();
  }
  function stroke(pts, w0, w1, colr, hv, alpha) {   // ענף/גבעול: קו מתחדד
    for (let i = 0; i < pts.length - 1; i++) { const t = i / Math.max(1, pts.length - 2), w = w0 + (w1 - w0) * t;
      for (const [c, s] of [[cx, colr ? rgb(...colr, alpha == null ? 1 : alpha) : null], [hx, grey(hv)]]) { if (!s) continue; c.strokeStyle = s; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(pts[i][0], pts[i][1]); c.lineTo(pts[i + 1][0], pts[i + 1][1]); c.stroke(); } } }
  function curve(x0, y0, ang, len, bend, n) { const pts = []; let x = x0, y = y0, a = ang; for (let i = 0; i <= n; i++) { pts.push([x, y]); a += bend / n; x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; } return pts; }

  // ---- אשכול עלים בתא: עלים מכוונים החוצה מהמרכז, פנימיים כהים יותר, ענפים דקים מתחת
  function clump(cell, o) {
    const [x0, y0, w, h] = cell, mx = x0 + w / 2, my = y0 + h / 2 + (o.dy || 0), Rr = Math.min(w, h) / 2 - 7; o.ph0 = R() * 6.28;
    for (let t = 0; t < (o.twigs || 0); t++) { const a = -Math.PI / 2 + (R() - 0.5) * 2.6, sx = mx + (R() - 0.5) * 20, sy = my + Rr * 0.55;
      stroke(curve(sx, sy, a, Rr * (0.7 + R() * 0.35), (R() - 0.5) * 0.9, 6), 3.2, 0.8, o.twig || [120, 105, 85], 120); }
    const items = [];
    for (let i = 0; i < o.n; i++) { const L = o.L[0] + R() * (o.L[1] - o.L[0]), W = o.W[0] + R() * (o.W[1] - o.W[0]);
      const a = R() * Math.PI * 2, edge = Rr * (0.84 + 0.16 * Math.sin(3 * a + o.ph0) * Math.cos(2 * a)), r = Math.sqrt(R()) * Math.max(4, edge - L * 0.95);
      items.push({ x: mx + Math.cos(a) * r, y: my + Math.sin(a) * r * (o.aspect || 1), ang: a + (R() - 0.5) * (o.jit || 1.2), L, W, d: r / Rr }); }
    items.sort((p, q) => p.d - q.d);   // פנימיים קודם (מאחור), חיצוניים מעליהם
    for (const it of items) { const sh = (o.inner || 0.74) + (1 - (o.inner || 0.74)) * it.d, base = mul(vary(o.base, o.var || 34), sh), tip = mul(vary(o.tip, o.var || 34), sh);
      leaf(it.x, it.y, it.ang, it.L, it.W, base, tip, { fat: o.fat, glint: o.glint, veins: o.veins, under: o.under && R() < 0.35 ? o.under : null }); }
  }
  // ---- מנוצה: כמה עלים מורכבים (ציר + זוגות עלעלים)
  function pinnate(cell, o) {
    const [x0, y0, w, h] = cell, mx = x0 + w / 2, my = y0 + h / 2 + 10, Rr = Math.min(w, h) / 2 - 8;
    for (let t = 0; t < 4; t++) stroke(curve(mx + (R() - 0.5) * 14, my + 30, -Math.PI / 2 + (R() - 0.5) * 2.2, Rr * 0.7, (R() - 0.5) * 0.6, 5), 3, 0.9, [118, 104, 84], 110);
    const leaves = [];
    for (let i = 0; i < o.n; i++) { const a = -Math.PI / 2 + (i / (o.n - 1) - 0.5) * 2 * Math.PI * 0.62 + (R() - 0.5) * 0.35, len = Rr * (0.62 + R() * 0.36);
      leaves.push({ a, len, sx: mx + Math.cos(a) * 10 + (R() - 0.5) * 18, sy: my + Math.sin(a) * 10 + (R() - 0.5) * 18 + 8 }); }
    for (const lf of leaves.sort(() => R() - 0.5)) {
      const pts = curve(lf.sx, lf.sy, lf.a, lf.len, (R() - 0.5) * 0.5, 11); stroke(pts, 1.6, 0.6, [150, 160, 120], 140);
      const sh = 0.78 + R() * 0.22;
      for (let s = 2; s < pts.length; s++) { const [px, py] = pts[s], [qx, qy] = pts[s - 1], ra = Math.atan2(py - qy, px - qx), f = s / pts.length;
        const L = o.L * (1 - 0.35 * f) * (0.85 + R() * 0.3), W = o.W * (1 - 0.3 * f);
        for (const sd of [-1, 1]) leaf(px, py, ra + sd * (o.ang + (R() - 0.5) * 0.3), L, W, mul(vary(o.base, 30), sh), mul(vary(o.tip, 30), sh), { fat: 0.4 }); }
      const [ex, ey] = pts[pts.length - 1], [fx, fy] = pts[pts.length - 2]; leaf(ex, ey, Math.atan2(ey - fy, ex - fx), o.L * 0.8, o.W * 0.8, mul(o.base, sh), mul(o.tip, sh), { fat: 0.4 }); }
  }
  // ---- מחטים / קשקשים: צרורות קווים דקים
  function needles(cell, o) {
    const [x0, y0, w, h] = cell, mx = x0 + w / 2, my = y0 + h / 2 + 6, Rr = Math.min(w, h) / 2 - 8;
    for (let t = 0; t < 5; t++) stroke(curve(mx + (R() - 0.5) * 16, my + 28, -Math.PI / 2 + (R() - 0.5) * 2.4, Rr * 0.75, (R() - 0.5) * 0.7, 5), 3, 1, [110, 95, 80], 110);
    for (let i = 0; i < o.n; i++) { const r = Math.sqrt(R()) * (Rr - o.len), a = R() * Math.PI * 2, bx = mx + Math.cos(a) * r, by = my + Math.sin(a) * r;
      const sh = 0.7 + 0.3 * r / Rr, c = mul(vary(o.col, 36), sh);
      for (let j = 0; j < o.per; j++) { const na = a + (R() - 0.5) * o.spread, nl = o.len * (0.65 + R() * 0.35);
        const pts = o.scale ? curve(bx, by, na, nl, (R() - 0.5) * 0.6, 3) : [[bx, by], [bx + Math.cos(na) * nl, by + Math.sin(na) * nl]];
        stroke(pts, o.w, o.w * 0.6, c, 150 + R() * 80);
        if (o.scale) for (const [px, py] of pts.slice(1)) { cx.fillStyle = rgb(...mul(c, 1.08)); cx.beginPath(); cx.ellipse(px, py, o.w * 0.9, o.w * 0.7, na, 0, 7); cx.fill(); } } }
  }
  // ---- עשב / רתם: להבים מהבסיס למעלה
  function blades(cell, o) {
    const [x0, y0, w, h] = cell;
    for (let i = 0; i < o.n; i++) { const bx = x0 + w / 2 + (R() - 0.5) * w * o.spread, by = y0 + h - 3, a = -Math.PI / 2 + (R() - 0.5) * o.fan, len = (h - 8) * (0.45 + R() * 0.55);
      const c = vary(o.col, 40), pts = curve(bx, by, a, len, (R() - 0.5) * o.bend, 6);
      stroke(pts, o.w, 0.6, c, 140 + R() * 90); }
  }
  // ---- מניפת וושינגטוניה: פלחים מקופלים, קצוות מפוצלים וחוטים תלויים
  function fan(cell) {
    const [x0, y0] = cell, Cx = x0 + FAN.c[0], Cy = y0 + FAN.c[1], n = 44;
    for (let i = 0; i < n; i++) { const a0 = FAN.a0 + (FAN.a1 - FAN.a0) * i / n, a1 = FAN.a0 + (FAN.a1 - FAN.a0) * (i + 1) / n, am = (a0 + a1) / 2;
      const r1 = FAN.r * (0.9 + R() * 0.1), split = r1 * (0.62 + R() * 0.12), light = i % 2 ? 1 : 0.8, c = mul(vary([206, 214, 190], 22), light);
      for (const [cc, fill] of [[cx, rgb(...c)], [hx, null]]) {
        cc.beginPath(); cc.moveTo(Cx + Math.cos(am) * 8, Cy + Math.sin(am) * 8); cc.lineTo(Cx + Math.cos(a0) * split, Cy + Math.sin(a0) * split);
        cc.lineTo(Cx + Math.cos(a0 + 0.012) * r1, Cy + Math.sin(a0 + 0.012) * r1); cc.lineTo(Cx + Math.cos(am) * (split + 4), Cy + Math.sin(am) * (split + 4));
        cc.lineTo(Cx + Math.cos(a1 - 0.012) * r1 * 0.97, Cy + Math.sin(a1 - 0.012) * r1 * 0.97); cc.lineTo(Cx + Math.cos(a1) * split, Cy + Math.sin(a1) * split); cc.closePath();
        if (fill) { cc.fillStyle = fill; cc.fill(); cc.strokeStyle = 'rgba(40,50,30,0.25)'; cc.lineWidth = 0.6; cc.stroke(); }
        else { const g = cc.createLinearGradient(Cx + Math.cos(a0) * split, Cy + Math.sin(a0) * split, Cx + Math.cos(a1) * split, Cy + Math.sin(a1) * split);
          g.addColorStop(0, grey(70)); g.addColorStop(0.5, grey(i % 2 ? 230 : 200)); g.addColorStop(1, grey(70)); cc.fillStyle = g; cc.fill(); } }
      if (R() < 0.55) { const fx = Cx + Math.cos(am) * r1, fy = Cy + Math.sin(am) * r1; stroke([[fx, fy], [fx + (R() - 0.5) * 6, fy + 8 + R() * 14]], 0.7, 0.4, [235, 232, 215], 160, 0.8); } }
    cx.fillStyle = rgb(150, 150, 120); cx.beginPath(); cx.ellipse(Cx, Cy, 9, 6, 0, 0, 7); cx.fill();   // היסטולה
  }
  // ---- כף תמר: ציר לאורך x, עלעלים בשני הצדדים (חצי עליון = צד א', חצי תחתון = צד ב'), קוצים בבסיס
  function frond(cell) {
    const [x0, y0, w, h] = cell, yc = y0 + h / 2, xa = x0 + 8, xb = x0 + w - 6;
    for (let x = xa + 6; x < xa + 62; x += 5) for (const sd of [-1, 1]) stroke([[x, yc], [x + 6, yc + sd * (7 + R() * 7)]], 1.6, 0.5, [215, 200, 150], 170);   // קוצים
    for (let x = xa + 60; x < xb - 4; x += 7.5 + R() * 1.5) { const t = (x - xa) / (xb - xa), Lmax = h / 2 - 5, L = Lmax * Math.pow(Math.sin(Math.PI * clamp(0.06 + 0.92 * t, 0, 1)), 0.55) * (0.9 + R() * 0.1);
      for (const sd of [-1, 1]) { const a = sd * (0.62 + (R() - 0.5) * 0.2) * (1 - 0.25 * t), sh = 0.82 + R() * 0.18;
        const c0 = mul(vary([186, 200, 186], 26), sh), c1 = mul(vary([214, 222, 205], 26), sh);
        leaf(x, yc + sd * 1.5, a, L / Math.cos(Math.min(1.2, Math.abs(a))) * 0.98, 2.4 + 1.4 * (1 - t), c0, c1, { fat: 0.5 }); } }
    stroke([[xa, yc], [(xa + xb) / 2, yc], [xb, yc]], 6, 1.5, [210, 205, 160], 230);   // ציר
  }
  // ---- חצאית כפות יבשות (וושינגטוניה): רצועות תלויות, חוזר אופקית
  function skirt(cell) {
    const [x0, y0, w, h] = cell;
    cx.save(); hx.save(); cx.beginPath(); cx.rect(x0, y0, w, h); cx.clip(); hx.beginPath(); hx.rect(x0, y0, w, h); hx.clip();
    for (let i = 0; i < 190; i++) { const x = x0 + R() * w, len = h * (0.45 + R() * 0.55), wd = 5 + R() * 8, c = vary(R() < 0.5 ? [222, 204, 168] : [186, 160, 124], 30), sway = (R() - 0.5) * 10;
      for (const dx of [-w, 0, w]) { const pts = [[x + dx, y0 - 2], [x + dx + sway * 0.3, y0 + len * 0.4], [x + dx + sway * 0.7, y0 + len * 0.75], [x + dx + sway, y0 + len]];
        stroke(pts, wd, wd * 0.2, c, 120 + R() * 110); stroke(pts, 0.8, 0.4, mul(c, 0.68), 60, 0.6); } }
    cx.restore(); hx.restore();
  }
  // ---- אשכולות תמרים: חוטים וחרוזים (נצבע בצבע הפרי של המין)
  function dates(cell) {
    const [x0, y0, w, h] = cell;
    for (let s = 0; s < 9; s++) { const sx = x0 + w / 2 + (R() - 0.5) * 30, pts = curve(sx, y0 + 6, Math.PI / 2 + (R() - 0.5) * 0.9, h * (0.6 + R() * 0.3), (R() - 0.5) * 0.6, 5);
      stroke(pts, 1.8, 1, [220, 200, 150], 140);
      for (let k = 1; k < pts.length; k++) for (let j = 0; j < 4; j++) { const px = pts[k][0] + (R() - 0.5) * 12, py = pts[k][1] + (R() - 0.5) * 8, c = vary([240, 222, 180], 30);
        cx.fillStyle = rgb(...c); cx.beginPath(); cx.ellipse(px, py, 3.2, 4.6, (R() - 0.5), 0, 7); cx.fill(); hx.fillStyle = grey(200 + R() * 50); hx.beginPath(); hx.ellipse(px, py, 3.2, 4.6, 0, 0, 7); hx.fill(); } }
  }
  // ---- קליפה: רצועה ברוחב מלא, חוזרת בשני הצירים
  function bark(kind) {
    const [y0, bh] = BARK[kind], W = 1024;
    const wrapY = (fn) => { for (const dy of [-bh, 0, bh]) fn(dy); };
    cx.save(); hx.save(); cx.beginPath(); cx.rect(0, y0, W, bh); cx.clip(); hx.beginPath(); hx.rect(0, y0, W, bh); hx.clip();
    const base = { smooth: [204, 202, 194], fissured: [196, 182, 164], wash: [200, 194, 182], phoe: [188, 168, 136] }[kind];
    cx.fillStyle = rgb(...base); cx.fillRect(0, y0, W, bh); hx.fillStyle = grey(150); hx.fillRect(0, y0, W, bh);
    if (kind === 'smooth') {
      for (let i = 0; i < 260; i++) { const x = R() * W, y = y0 + R() * bh, l = 20 + R() * 70, t = 4 + R() * 12, d = R() < 0.5; wrapY(dy => { for (const ox of [-W, 0, W]) { cx.fillStyle = d ? 'rgba(60,55,50,0.07)' : 'rgba(255,255,250,0.10)'; cx.beginPath(); cx.ellipse(x + ox, y + dy, l, t, 0, 0, 7); cx.fill(); } }); }
      for (let i = 0; i < 900; i++) { const x = R() * W, y = y0 + R() * bh; cx.fillStyle = 'rgba(70,62,55,0.35)'; cx.fillRect(x, y, 1.2, 2.5 + R() * 2); hx.fillStyle = grey(90); hx.fillRect(x, y, 1.2, 2.5); }   // לנטיצלות
      for (let i = 0; i < 70; i++) { const y = y0 + R() * bh, x = R() * W, l = 60 + R() * 200; cx.strokeStyle = 'rgba(80,72,64,0.18)'; cx.lineWidth = 1 + R(); cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + l, y + (R() - 0.5) * 3); cx.stroke(); }
    } else if (kind === 'fissured') {
      for (let i = 0; i < 18; i++) { const yb = y0 + (i + R() * 0.5) * bh / 9; wrapY(dy => { let x = -20, y = yb + dy; const pts = [];
        while (x < W + 20) { pts.push([x, y]); x += 18 + R() * 26; y += (R() - 0.5) * 4; } if (R() < 0.8) { stroke(pts, 1.8 + R() * 1.4, 1.0, [112, 100, 88], 35); } }); }
      for (let i = 0; i < 500; i++) { const x = R() * W, y = y0 + R() * bh; cx.fillStyle = R() < 0.5 ? 'rgba(255,250,240,0.12)' : 'rgba(60,50,40,0.12)'; cx.fillRect(x, y, 6 + R() * 18, 1.5 + R() * 2); }
      hx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 300; i++) { hx.fillStyle = 'rgba(40,40,40,0.5)'; hx.fillRect(R() * W, y0 + R() * bh, 10 + R() * 30, 2 + R() * 3); } hx.globalCompositeOperation = 'source-over';
    } else if (kind === 'wash') {
      for (let i = 0; i < 160; i++) { const y = y0 + R() * bh; cx.strokeStyle = R() < 0.5 ? 'rgba(90,80,70,0.12)' : 'rgba(255,255,245,0.12)'; cx.lineWidth = 0.8 + R(); cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y + (R() - 0.5) * 2); cx.stroke(); }
      for (let x = 4; x < W; x += 9 + R() * 7) { const c = R() < 0.3 ? 'rgba(70,60,52,0.45)' : 'rgba(85,75,65,0.28)', lw = 1.2 + R() * 1.6;
        cx.strokeStyle = c; cx.lineWidth = lw; cx.beginPath(); cx.moveTo(x, y0 - 2); cx.lineTo(x + (R() - 0.5) * 3, y0 + bh + 2); cx.stroke();
        hx.strokeStyle = grey(60); hx.lineWidth = lw + 0.6; hx.beginPath(); hx.moveTo(x, y0 - 2); hx.lineTo(x, y0 + bh + 2); hx.stroke(); }
    } else {   // phoe: בסיסי כפות (מגפיים) מדורגים
      cx.fillStyle = 'rgb(120,98,72)'; cx.fillRect(0, y0, W, bh);
      for (let r = 0, x = 0; x < W; r++, x += 32) for (let j = -1; j < 4; j++) { const y = y0 + (j + (r % 2) * 0.5) * (bh / 3), cxp = x + 16;
        wrapY(dy => { const yy = y + dy, c = vary([200, 176, 140], 18);
          for (const [cc, f] of [[cx, rgb(...c)], [hx, null]]) { cc.beginPath(); cc.moveTo(cxp - 17, yy); cc.lineTo(cxp, yy - 11); cc.lineTo(cxp + 17, yy); cc.lineTo(cxp, yy + 11); cc.closePath();
            if (f) { cc.fillStyle = f; cc.fill(); cc.strokeStyle = 'rgba(70,55,40,0.55)'; cc.lineWidth = 1.4; cc.stroke(); }
            else { const g = cc.createRadialGradient(cxp - 3, yy, 1, cxp, yy, 16); g.addColorStop(0, grey(235)); g.addColorStop(1, grey(80)); cc.fillStyle = g; cc.fill(); } }
          cx.strokeStyle = 'rgba(80,62,45,0.35)'; cx.lineWidth = 0.8; cx.beginPath(); cx.moveTo(cxp - 10, yy); cx.lineTo(cxp + 12, yy); cx.stroke(); }); }
    }
    cx.restore(); hx.restore();
  }
  // אזור הקליפה אטום כולו (גם השוליים), כדי שאין "סדק" שקוף בגזע במרחק
  cx.fillStyle = rgb(190, 182, 168); cx.fillRect(0, 768, 1024, 256); hx.fillStyle = grey(150); hx.fillRect(0, 768, 1024, 256);
  for (const b of Object.keys(BARK)) bark(b);
  // תאי עלים (צבעי בסיס ניטרליים-בהירים; הגוון הסופי = צבע המין)
  clump(CELL.ficus, { n: 210, L: [18, 26], W: [7.5, 10.5], base: [168, 186, 150], tip: [212, 222, 186], twigs: 6, glint: 0.3, fat: 0.36, jit: 1.3 });
  clump(CELL.broad, { n: 100, L: [28, 40], W: [13, 19], base: [172, 186, 160], tip: [214, 222, 196], twigs: 5, glint: 0.25, fat: 0.28, veins: 3, jit: 1.1 });
  pinnate(CELL.pinnate, { n: 15, L: 13, W: 5, ang: 1.0, base: [190, 206, 160], tip: [222, 232, 192] });
  clump(CELL.narrow, { n: 165, L: [30, 44], W: [4.4, 6.8], base: [176, 190, 170], tip: [208, 216, 196], twigs: 6, fat: 0.45, jit: 0.9, under: [235, 238, 228], inner: 0.7 });
  needles(CELL.needle, { n: 58, per: 15, len: 34, w: 1.4, spread: 1.6, col: [172, 192, 160] });
  fan(CELL.fan);
  needles(CELL.scale, { n: 70, per: 9, len: 26, w: 2.6, spread: 1.3, col: [176, 192, 160], scale: true });
  blades(CELL.grass, { n: 80, spread: 0.45, fan: 1.3, bend: 0.8, w: 3, col: [214, 214, 178] });
  frond(CELL.frond);
  skirt(CELL.skirt);
  dates(CELL.dates);
  blades(CELL.broom, { n: 46, spread: 0.3, fan: 0.9, bend: 0.4, w: 1.7, col: [196, 206, 182] });
  return { col, hgt };
}

/** normal ממפת גובה (סובל), במרחב משיק (OpenGL: +v למעלה) */
function normalFromHeight(hgt, S, strength) {
  const src = hgt.getContext('2d').getImageData(0, 0, S, S).data, H = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) H[i] = src[i * 4] / 255;
  const out = document.createElement('canvas'); out.width = out.height = S; const ox = out.getContext('2d'), id = ox.createImageData(S, S), d = id.data;
  for (let y = 0; y < S; y++) { const ym = y > 0 ? y - 1 : 0, yp = y < S - 1 ? y + 1 : S - 1;
    for (let x = 0; x < S; x++) { const xm = x > 0 ? x - 1 : S - 1, xp = x < S - 1 ? x + 1 : 0;
      const tl = H[ym * S + xm], t = H[ym * S + x], tr = H[ym * S + xp], l = H[y * S + xm], r = H[y * S + xp], bl = H[yp * S + xm], b = H[yp * S + x], br = H[yp * S + xp];
      let nx = -((tr + 2 * r + br) - (tl + 2 * l + bl)) * strength, ny = ((bl + 2 * b + br) - (tl + 2 * t + tr)) * strength, nz = 1;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz), k = (y * S + x) * 4;
      d[k] = (nx * il * 0.5 + 0.5) * 255; d[k + 1] = (ny * il * 0.5 + 0.5) * 255; d[k + 2] = (nz * il * 0.5 + 0.5) * 255; d[k + 3] = 255; } }
  ox.putImageData(id, 0, 0); return out;
}

// ------------------------------------------------------------------ אתחול: טקסטורות + uniforms משותפים
const U = F.uniforms = {
  uFloraNight: { value: 0 },                                  // הרמת לילה (אחוז מהאלבדו)
  uFloraLampOn: { value: 0 },
  uFloraLP: { value: Array.from({ length: 8 }, () => new T.Vector4(0, -999, 0, 1)) },   // xyz + רדיוס²
  uFloraLC: { value: Array.from({ length: 8 }, () => new T.Vector4(0, 0, 0, 0)) },      // צבע×עוצמה
  uFloraShadowC: { value: new T.Vector4(0, 0, 0, 1e9) },      // מרכז + רדיוס לצל עצים
  uFloraTime: { value: 0 }, uFloraWind: { value: new T.Vector4(1, 0, 0, 3) },
};
F.ok = false;
F.init = function (opts) {
  if (F.ok) return F; opts = opts || {};
  const t0 = performance.now();
  const S = +(qs.get('flora_tex') || opts.size || (TOUCH || (navigator.deviceMemory && navigator.deviceMemory < 6) ? 1024 : 2048));
  const { col, hgt } = paintAtlas(S);
  const nrm = normalFromHeight(hgt, S, 2.4 * S / 1024);
  const map = new T.CanvasTexture(col); map.colorSpace = T.SRGBColorSpace; map.wrapS = T.RepeatWrapping; map.wrapT = T.ClampToEdgeWrapping;
  map.anisotropy = 4; map.minFilter = T.LinearMipmapLinearFilter; map.generateMipmaps = true; map.name = 'flora-atlas';
  const normal = new T.CanvasTexture(nrm); normal.colorSpace = T.NoColorSpace; normal.wrapS = T.RepeatWrapping; normal.wrapT = T.ClampToEdgeWrapping;
  normal.anisotropy = 4; normal.minFilter = T.LinearMipmapLinearFilter; normal.name = 'flora-normal';
  F.tex = { map, normal, size: S, canvas: col, normalCanvas: nrm };
  F.ms = Math.round(performance.now() - t0); F.ok = true;
  return F;
};
F.texMB = () => F.tex ? +(2 * F.tex.size * F.tex.size * 4 * 4 / 3 / 1048576).toFixed(1) : 0;
F.gain = 1.45;   // הטקסטורה ניטרלית-בהירה (ממוצע ~0.6 ליניארי) → כפל בחומר

// ------------------------------------------------------------------ טלאי שיידר
const LAMBERT_PARS = () => T.ShaderChunk.lights_lambert_pars_fragment
  .replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) * 0.72 + 0.28 );\n\tdotNL += 0.45 * pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 4.0 );   // עלים: עטיפה + אור עובר מאחור');
const NORMAL_BEGIN_2S = () => T.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '').replace(/tbn\[0\] \*= faceDirection;\s*tbn\[1\] \*= faceDirection;/, '');
const ABOOST = `#if defined( USE_MAP ) && defined( USE_ALPHATEST )
{ vec2 fq = vMapUv * vec2( textureSize( map, 0 ) ); vec2 fdx = dFdx( fq ), fdy = dFdy( fq );
  float flod = max( 0.0, 0.5 * log2( max( dot( fdx, fdx ), dot( fdy, fdy ) ) ) );
  diffuseColor.a = min( 1.0, diffuseColor.a * ( 1.0 + flod * 0.24 ) ); }   // כיסוי אלפא נשמר במרחק (העלווה לא "מתקרחת")
#endif
#include <alphatest_fragment>`;
F.ABOOST = ABOOST;
const LAMPS_FRAG = `#include <lights_fragment_end>
reflectedLight.directDiffuse += vFloraLamp * BRDF_Lambert( diffuseColor.rgb );   // אור פנסים (מחושב בקודקוד — זול בטלפון)
totalEmissiveRadiance += diffuseColor.rgb * uFloraNight;   // לילה: העלים לא שחורים`;
// פנסים לכל קודקוד: נפילת האור רכה על פני ~10 מ', כרטיס עלים קטן ממנה — אין צורך בלולאה לכל פיקסל (נמדד: ~5% מזמן הציור בלילה)
const LAMPS_VERT = `#include <fog_vertex>
vFloraW = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
vFloraLamp = vec3( 0.0 );
if ( uFloraLampOn > 0.5 ) { vec3 fnW = inverseTransformDirection( transformedNormal, viewMatrix );
  for ( int i = 0; i < 8; i ++ ) { vec3 fd = uFloraLP[ i ].xyz - vFloraW; float fd2 = dot( fd, fd ) + 0.25, fr2 = uFloraLP[ i ].w;
    float fatt = fr2 / ( fr2 + fd2 ) * clamp( 1.0 - fd2 / ( fr2 * 14.0 ), 0.0, 1.0 );
    vFloraLamp += uFloraLC[ i ].rgb * ( fatt * ( dot( fnW, fd ) * inversesqrt( fd2 ) * 0.45 + 0.55 ) ); } }`;
const HEAD_F = 'uniform float uFloraNight; varying vec3 vFloraW; varying vec3 vFloraLamp;\n';
const HEAD_V = 'varying vec3 vFloraW; varying vec3 vFloraLamp; uniform float uFloraTime, uFloraLampOn; uniform vec4 uFloraWind; uniform vec4 uFloraShadowC; uniform vec4 uFloraLP[ 8 ]; uniform vec4 uFloraLC[ 8 ];\n';
const WIND_V = `#include <begin_vertex>
{ vec3 fo = vec3( 0.0 );
  #ifdef USE_INSTANCING
  fo = instanceMatrix[ 3 ].xyz;
  #endif
  float fph = dot( fo.xz, vec2( 0.071, 0.113 ) ), fh = max( 0.0, position.y );
  float fk = uFloraWind.w * fh * fh * 0.00045 * ( 0.7 + 0.3 * sin( uFloraTime * 1.6 + fph ) );
  transformed.xz += vec2( sin( uFloraTime * 1.1 + fph ), cos( uFloraTime * 0.9 + fph * 1.3 ) ) * fk; }`;
const SHADOW_CULL = `#include <clipping_planes_vertex>
#ifdef USE_INSTANCING
{ vec3 fso = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz; if ( distance( fso.xz, uFloraShadowC.xz ) > uFloraShadowC.w ) gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 ); }   // צל רק לעצים קרובים
#endif`;
/** opts: { lit (Lambert), depth, wind, lamps(ברירת מחדל ב-lit) } — אפשר לשרשר אחרי טלאי אחר (מחלקת הצמחייה) */
F.patch = function (sh, o) {
  o = o || {}; Object.assign(sh.uniforms, U);
  sh.vertexShader = HEAD_V + sh.vertexShader;
  if (o.wind) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', WIND_V);
  if (o.depth) { sh.vertexShader = sh.vertexShader.replace('#include <clipping_planes_vertex>', SHADOW_CULL); sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', ABOOST); return sh; }
  sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', LAMPS_VERT);
  sh.fragmentShader = HEAD_F + sh.fragmentShader.replace('#include <alphatest_fragment>', ABOOST);
  if (o.lit !== false) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_lambert_pars_fragment>', LAMBERT_PARS()).replace('#include <normal_fragment_begin>', NORMAL_BEGIN_2S())
      .replace('#include <lights_fragment_end>', LAMPS_FRAG);
  }
  return sh;
};
/** חומר עלים+קליפה (אטלס אחד = קריאת ציור אחת לעץ). gain: הטקסטורה ניטרלית-בהירה, הגוון מצבע הקודקוד/המין */
F.material = function (o) {
  o = o || {}; if (!F.ok) F.init();
  const m = new T.MeshLambertMaterial({ map: F.tex.map, normalMap: F.tex.normal, normalScale: new T.Vector2(0.9, 0.9), alphaTest: 0.5, side: T.DoubleSide, vertexColors: true, color: new T.Color().setScalar(o.gain || F.gain) });
  const extra = o.onBeforeCompile;
  m.onBeforeCompile = sh => { if (extra) extra(sh); F.patch(sh, { wind: !!o.wind }); };
  const key = 'flora1' + (o.wind ? 'w' : '') + (o.key || ''); m.customProgramCacheKey = () => key; m.name = o.name || 'flora';
  return m;
};
F.depthMaterial = function (o) {
  o = o || {}; if (!F.ok) F.init();
  const m = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: F.tex.map, alphaTest: 0.5, side: T.DoubleSide });
  const extra = o.onBeforeCompile;
  m.onBeforeCompile = sh => { if (extra) extra(sh); F.patch(sh, { depth: true, wind: !!o.wind }); };
  const key = 'flora1d' + (o.wind ? 'w' : '') + (o.key || ''); m.customProgramCacheKey = () => key;
  return m;
};

// ------------------------------------------------------------------ בניית גאומטריה
function Builder() { return { P: [], N: [], UV: [], C: [], PA: [], CE: [], M: [], I: [], n: 0 }; }
function vtx(b, p, n, u, v, c, part, cen, mask) {
  b.P.push(p.x, p.y, p.z); b.N.push(n.x, n.y, n.z); b.UV.push(u, v);
  if (typeof c === 'number') b.C.push(c, c, c); else b.C.push(c[0], c[1], c[2]);
  b.PA.push(part); b.CE.push(cen.x, cen.y, cen.z); b.M.push(mask); return b.n++;
}
function toGeometry(b) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(b.P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(b.N, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(b.UV, 2)); g.setAttribute('color', new T.Float32BufferAttribute(b.C, 3));
  g.setAttribute('aPart', new T.Float32BufferAttribute(b.PA, 1)); g.setAttribute('aCenter', new T.Float32BufferAttribute(b.CE, 3)); g.setAttribute('aMask', new T.Float32BufferAttribute(b.M, 1));
  g.setIndex(b.I); g.computeBoundingBox();
  const bb = g.boundingBox, Hm = Math.max(0.3, bb.max.y), bend = new Float32Array(b.n);
  for (let i = 0; i < b.n; i++) bend[i] = Math.max(0, b.P[i * 3 + 1] / Hm);
  g.setAttribute('aBend', new T.BufferAttribute(bend, 1)); g.computeBoundingSphere();
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  return { geo: g, tris: b.I.length / 3, H: Hm, box: { w, h: bb.max.y - Math.min(0, bb.min.y), cy: (bb.max.y + Math.min(0, bb.min.y)) / 2 } };
}
const cellUV = (name, inset) => { const [x, y, w, h] = CELL[name], e = inset == null ? 2 : inset; return [(x + e) / 1024, 1 - (y + h - e) / 1024, (x + w - e) / 1024, 1 - (y + e) / 1024]; };   // u0 v0 u1 v1
const barkV = name => { const [y0, h] = BARK[name]; return [1 - (y0 + 0.5) / 1024, 1 - (y0 + h - 0.5) / 1024]; };
/** צינור מעוגל לאורך מסלול (גזע/ענף) עם קליפה חוזרת; col(p) → צבע/AO */
function tube(b, pts, rads, sides, barkName, part, col) {
  const [vA, vB] = barkV(barkName), rep = BARK[barkName][2], rings = []; let len = 0, prevN = null;
  for (let i = 0; i < pts.length; i++) {
    const t = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    if (i > 0 && i < pts.length - 1) t.add(pts[i].clone().sub(pts[i - 1]).normalize()).normalize();
    let nrm = prevN ? prevN.clone().addScaledVector(t, -prevN.dot(t)) : (Math.abs(t.y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0)).cross(t);
    nrm.normalize(); prevN = nrm; const bin = t.clone().cross(nrm).normalize();
    if (i) len += pts[i].distanceTo(pts[i - 1]);
    const ring = [];
    for (let j = 0; j <= sides; j++) { const a = j / sides * Math.PI * 2, dir = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      const p = pts[i].clone().addScaledVector(dir, rads[i]); ring.push(vtx(b, p, dir, len / rep, vA + (vB - vA) * j / sides, col(p, i / (pts.length - 1)), part, pts[0], 0)); }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) { const a = rings[i][j], c = rings[i][j + 1], d = rings[i + 1][j], e = rings[i + 1][j + 1]; b.I.push(a, d, c, c, d, e); }
}
/** כרטיס עלים: מרכז, נורמל הפנים, גודל, תא באטלס; נורמלים כדוריים ביחס למרכז הכתר */
function card(b, o) {
  const n0 = o.n.clone().normalize(); let Rv = (Math.abs(n0.y) > 0.95 ? new V3(1, 0, 0) : new V3(0, 1, 0)).cross(n0).normalize(); let Uv = n0.clone().cross(Rv).normalize();
  const ca = Math.cos(o.twist || 0), sa = Math.sin(o.twist || 0), R2 = Rv.clone().multiplyScalar(ca).addScaledVector(Uv, sa), U2 = Uv.clone().multiplyScalar(ca).addScaledVector(Rv, -sa);
  let [u0, v0, u1, v1] = cellUV(o.cell); if (o.flip) [u0, u1] = [u1, u0];
  const idx = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]].map(([sx, sy, u, v]) => {
    const p = o.c.clone().addScaledVector(R2, sx * o.w / 2).addScaledVector(U2, sy * o.h / 2);
    const rel = p.clone().sub(o.C).divide(o.rad), ns = rel.clone().normalize(); let fn = n0.clone(); if (fn.dot(ns) < 0) fn.negate();
    const sw = o.sph == null ? 0.75 : o.sph, n = ns.multiplyScalar(sw).addScaledVector(fn, 1 - sw).add(new V3(0, o.up == null ? 0.42 : o.up, 0)).normalize();   // נטייה למעלה: אור שמיים דרך הפרצות
    const dep = Math.min(1, rel.length()), ao = (o.ao || 1) * (0.58 + 0.42 * dep) * (0.9 + 0.1 * n.y);
    return vtx(b, p, n, u, v, o.col ? [o.col[0] * ao, o.col[1] * ao, o.col[2] * ao] : ao, o.part == null ? 1 : o.part, o.c, o.mask); });
  b.I.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3]);
}
// מאפייני מראה לפי מין (קוד ממחלקת הצמחייה) — תא עלים + קליפה; ברירת מחדל לפי ארכיטיפ
const LOOK = {
  FMIC: ['ficus', 'smooth'], FSYC: ['broad', 'smooth'], JACA: ['pinnate', 'fissured'], DELO: ['pinnate', 'smooth'], TIPU: ['pinnate', 'fissured'],
  BRAC: ['broad', 'smooth'], MELI: ['pinnate', 'fissured'], EUCA: ['narrow', 'smooth'], TAMA: ['scale', 'fissured'], OLEA: ['narrow', 'fissured'],
  CERA: ['broad', 'fissured'], PINU: ['needle', 'fissured'], CUPR: ['scale', 'fissured'], BOUG: ['broad', 'fissured'], NERI: ['narrow', 'fissured'],
  RETA: ['broom', 'fissured'], ARTE: ['scale', 'fissured'], AMMO: ['grass', 'fissured'],
};
const ARCH = {   // tr: חלק הגזע מהגובה · k: אשכולות (טלפון/מחשב) · s: גודל כרטיס יחסי לרדיוס · flat: שיטוח הכתר · br: ענפים
  round_dense: { tr: 0.36, k: [17, 25], s: 0.62, flat: 0.78, br: 4 }, round_wide: { tr: 0.3, k: [18, 26], s: 0.55, flat: 0.55, br: 5 },
  vase: { tr: 0.4, k: [15, 22], s: 0.6, flat: 0.6, br: 4 }, umbrella: { tr: 0.45, k: [16, 24], s: 0.55, flat: 0.42, br: 5 },
  round_open: { tr: 0.42, k: [14, 21], s: 0.62, flat: 0.65, br: 4 }, bottle: { tr: 0.5, k: [11, 16], s: 0.7, flat: 0.8, br: 3 },
  eucalyptus: { tr: 0.45, k: [14, 21], s: 0.6, flat: 1.0, br: 3 }, olive: { tr: 0.32, k: [12, 18], s: 0.68, flat: 0.65, br: 3 },
  pine: { tr: 0.58, k: [14, 21], s: 0.6, flat: 0.45, br: 4 }, column: { tr: 0.1, k: [12, 18], s: 0.95, flat: 2.6, br: 0 },
};
function fib(i, n) { const y = 1 - (i + 0.5) * 2 / n, r = Math.sqrt(Math.max(0, 1 - y * y)), ph = i * 2.399963; return new V3(Math.cos(ph) * r, y, Math.sin(ph) * r); }

/** עץ רחב-עלים: גזע מעוגל + ענפים + כתר מאשכולות כרטיסים (כל אשכול = כרטיס משיק + כרטיס רדיאלי) */
function broadleaf(b, R, o) {
  const A = ARCH[o.arch] || ARCH.round_dense, H = o.H, CW = o.CW, tH = H * A.tr, cr = CW / 2, detail = o.detail ? 1 : 0;
  const r0 = Math.max(0.12, H * (o.arch === 'bottle' ? 0.06 : 0.028)), sides = detail ? 8 : 7, wood = o.cols ? o.cols.wood : null;
  const woodCol = (p, f) => { const ao = 0.62 + 0.38 * Math.min(1, p.y / Math.max(1, tH)); return wood ? [wood[0] * ao, wood[1] * ao, wood[2] * ao] : ao; };
  // גזע: מסלול מתעקל קלות, התרחבות בבסיס
  const lean = (R() - 0.5) * 0.25, segs = detail ? 4 : 3, pts = [], rads = [];
  for (let i = 0; i <= segs; i++) { const f = i / segs, y = f * tH * 1.04; pts.push(new V3(lean * f * f * 2 + Math.sin(f * 5 + R()) * 0.05, y, lean * 0.4 * f + Math.cos(f * 4) * 0.04));
    rads.push(r0 * (o.arch === 'bottle' ? (1 + 0.9 * Math.sin(Math.PI * Math.min(1, f * 1.3))) * 0.8 : (1 - 0.35 * f)) * (i === 0 ? 1.35 : 1)); }
  if (o.arch !== 'column') tube(b, pts, rads, sides, o.bark, 0, woodCol);
  const top = pts[pts.length - 1];
  // כתר
  const cy = o.arch === 'column' ? tH + (H - tH) * 0.48 : tH + (H - tH) * 0.52, ry = Math.max(0.6, (H - tH) * 0.5 * A.flat + (o.arch === 'column' ? 0 : 0.35));
  const C = new V3(top.x, Math.min(H - ry * 0.6, cy), top.z), rad = new V3(cr, o.arch === 'column' ? (H - tH) * 0.5 : ry, cr);
  // ענפים אל תוך הכתר (נראים בין העלים ובחורף)
  for (let i = 0; i < A.br; i++) { const az = i / A.br * Math.PI * 2 + R() * 0.7, d = cr * (o.arch === 'umbrella' ? 0.75 : 0.55);
    const end = new V3(C.x + Math.cos(az) * d, C.y + (R() - 0.2) * rad.y * 0.5, C.z + Math.sin(az) * d), mid = top.clone().lerp(end, 0.5).add(new V3(0, 0.35, 0));
    tube(b, [top.clone().add(new V3(0, -0.2, 0)), mid, end], [r0 * 0.62, r0 * 0.4, r0 * 0.18], detail ? 5 : 4, o.bark, 0, woodCol); }
  const K = A.k[detail], col = o.cols ? o.cols.leaf : null, lump = [R(), R(), R(), R()].map(x => x * 6.28);
  for (let i = 0; i < K; i++) {
    let d = fib(i, K); d.x += (R() - 0.5) * 0.25; d.z += (R() - 0.5) * 0.25; d.y += (R() - 0.5) * 0.2;
    if (o.arch === 'umbrella' || o.arch === 'pine') d.y = Math.max(-0.35, d.y * 0.8);
    d.normalize();
    let f = 0.66 + 0.34 * R();
    if (o.arch === 'round_open' || o.arch === 'eucalyptus' || o.arch === 'olive') f *= 0.78 + 0.3 * Math.sin(d.x * 3 + lump[0]) * Math.cos(d.z * 3 + lump[1]) + 0.1;   // כתר "גבשושי"
    const p = C.clone().add(d.clone().multiply(rad).multiplyScalar(f));
    if (o.arch === 'vase') { const k2 = 0.75 + 0.45 * (d.y * 0.5 + 0.5); p.x = C.x + (p.x - C.x) * k2; p.z = C.z + (p.z - C.z) * k2; }
    const s = cr * A.s * 0.86 * (0.8 + R() * 0.4) * (o.arch === 'column' ? 0.9 : 1), out = p.clone().sub(C).divide(rad).normalize(), mask = 0.15 + 0.85 * R();   // ×0.86: פחות ציור-יתר (מילוי) בטלפון
    const side = out.clone().cross(new V3(R() - 0.5, R() - 0.5, R() - 0.5)).normalize();
    const hgt = o.arch === 'column' ? s * 1.25 : s;
    card(b, { c: p, n: out, w: s, h: hgt, twist: R() * 6.28, cell: o.leaf, C, rad, mask, flip: R() < 0.5, col });
    card(b, { c: p.clone().addScaledVector(out, -s * 0.12), n: side, w: s * 0.8, h: hgt * 0.8, twist: R() * 6.28, cell: o.leaf, C, rad, mask, flip: R() < 0.5, col, sph: 0.82 });
  }
}
/** דקל תמר: גזע עבה עם בסיסי כפות, כפות בחתך V (עלעלים בשני הצדדים), אשכולות תמרים */
function phoenix(b, R, o) {
  const H = o.H, CW = o.CW, detail = o.detail ? 1 : 0, lo = !!o.lo, cols = o.cols;
  const T0 = H - 2.0, lean = (R() - 0.5) * 0.9, sides = lo ? 5 : detail ? 8 : 7, segs = lo ? 2 : detail ? 6 : 5, pts = [], rads = [];
  for (let i = 0; i <= segs; i++) { const f = i / segs; pts.push(new V3(lean * f * f, f * T0, lean * 0.3 * f * f)); rads.push((0.44 - 0.08 * f) * (i === 0 ? 1.15 : 1)); }
  const wood = cols ? cols.wood : null; tube(b, pts, rads, sides, 'phoe', 0, (p) => { const ao = 0.7 + 0.3 * Math.min(1, p.y / 3); return wood ? wood.map(c => c * ao) : ao; });
  const top = pts[pts.length - 1].clone().add(new V3(0, 0.15, 0)), nF = lo ? 8 : detail ? 17 : 13, fs = lo ? 2 : detail ? 5 : 4, L = CW * 0.52;   // טלפון: 13 כפות (מילוי)
  const [u0, v0, u1, v1] = cellUV('frond', 1), vm = (v0 + v1) / 2;
  for (let i = 0; i < nF; i++) {
    const tier = i % 3, az = i / nF * Math.PI * 2 + R() * 0.25, dry = !lo && i >= nF - 2, el = dry ? -0.9 - R() * 0.3 : 0.75 - tier * 0.45 + (R() - 0.5) * 0.2;   // mask ≥0.15: לא "פורח" כשאין עונה
    const dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)), side = new V3(-Math.sin(az), 0, Math.cos(az));
    const len = L * (dry ? 0.85 : 0.85 + R() * 0.3), droop = dry ? 0.3 : 1.2 + R() * 0.8, part = dry ? 3 : 1, mask = 0.15 + 0.85 * R(), col = cols ? (dry ? cols.dry : cols.leaf) : null;
    const path = []; for (let s = 0; s <= fs; s++) { const f = s / fs; path.push(top.clone().addScaledVector(dir, len * f).add(new V3(0, -droop * f * f, 0))); }
    const halves = lo ? [[0, 1]] : [[1, 1], [-1, 0]];   // [צד, חצי תא]; בזול: רצועה שטוחה אחת על כל התא
    for (const [sd, hv] of halves) {
      const idx = [];
      for (let s = 0; s <= fs; s++) { const f = s / fs, p = path[s], tg = (s < fs ? path[s + 1].clone().sub(p) : p.clone().sub(path[s - 1])).normalize();
        const sdv = side.clone().addScaledVector(tg, -side.dot(tg)).normalize(), upv = tg.clone().cross(sdv).normalize(); if (upv.y < 0) upv.negate();
        const wd = (detail ? 0.62 : 0.56) * (1 - 0.3 * f) * (dry ? 0.8 : 1), u = u0 + (u1 - u0) * Math.min(1, f * 1.0);
        const n = upv.clone().multiplyScalar(0.7).add(p.clone().sub(top).normalize().multiplyScalar(0.3)).normalize();
        const ao = 0.72 + 0.28 * f, cc = col ? col.map(c => c * ao) : ao;
        if (lo) { const e0 = p.clone().addScaledVector(sdv, -wd), e1 = p.clone().addScaledVector(sdv, wd); idx.push([vtx(b, e0, n, u, v0, cc, part, top, mask), vtx(b, e1, n, u, v1, cc, part, top, mask)]); }
        else { const e = p.clone().addScaledVector(sdv, sd * wd * 0.9).addScaledVector(upv, wd * 0.42);   // חתך V: העלעלים עולים מהציר
          idx.push([vtx(b, p, n, u, vm, cc, part, top, mask), vtx(b, e, n, u, hv ? v1 : v0, cc, part, top, mask)]); } }
      for (let s = 0; s < fs; s++) { const [a, c] = idx[s], [d, e] = idx[s + 1]; b.I.push(a, d, c, c, d, e); }
    }
  }
  if (!lo) for (let i = 0; i < 3; i++) {   // תמרים (חלק 2 — גודל וצבע לפי העונה)
    const az = i / 3 * Math.PI * 2 + 0.5, c = top.clone().add(new V3(Math.cos(az) * 0.75, -0.85, Math.sin(az) * 0.75));
    card(b, { c, n: new V3(Math.cos(az), 0.1, Math.sin(az)), w: 0.75, h: 1.0, twist: Math.PI, cell: 'dates', C: top, rad: new V3(1, 1, 1), part: 2, mask: 0.5, sph: 0.3, col: cols ? cols.fruit : null }); }
}
/** וושינגטוניה: גזע דק וגבוה עם טבעות, חצאית כפות יבשות, מניפות על פטוטרות */
function washingtonia(b, R, o) {
  const H = o.H, CW = o.CW, detail = o.detail ? 1 : 0, lo = !!o.lo, cols = o.cols;
  const T0 = H - 1.3, lean = (R() - 0.5) * 0.4, sides = lo ? 5 : detail ? 8 : 7, segs = lo ? 2 : detail ? 6 : 5, pts = [], rads = [];
  for (let i = 0; i <= segs; i++) { const f = i / segs; pts.push(new V3(lean * f * f, f * T0, lean * 0.3 * f)); rads.push((0.34 - 0.1 * f) * (i === 0 ? 1.25 : 1)); }
  const wood = cols ? cols.wood : null; tube(b, pts, rads, sides, 'wash', 0, (p) => { const ao = 0.72 + 0.28 * Math.min(1, p.y / 3); return wood ? wood.map(c => c * ao) : ao; });
  const top = pts[pts.length - 1];
  if (!lo) {   // חצאית יבשה (חלק 3)
    const [u0, v0, u1, v1] = cellUV('skirt', 1), sn = detail ? 12 : 10, y1 = top.y + 0.1, y0 = top.y - 3.2, rr = [], dryC = cols ? cols.dry : null;
    for (let j = 0; j <= sn; j++) { const a = j / sn * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), n = new V3(dx, 0.15, dz).normalize();
      const pTop = new V3(top.x + dx * 0.72, y1, top.z + dz * 0.72), pBot = new V3(top.x + dx * 1.12, y0, top.z + dz * 1.12), u = u0 + (u1 - u0) * j / sn;
      rr.push([vtx(b, pTop, n, u, v1, dryC ? dryC.map(c => c * 0.8) : 0.8, 3, top, 0), vtx(b, pBot, n, u, v0, dryC ? dryC.map(c => c * 0.62) : 0.62, 3, top, 0)]); }
    for (let j = 0; j < sn; j++) { const [a, c] = rr[j], [d, e] = rr[j + 1]; b.I.push(a, d, c, c, d, e); }
  }
  const nL = lo ? 9 : detail ? 19 : 16, [fu0, fv0, fu1, fv1] = cellUV('fan', 0), [pu0, pv0, pu1, pv1] = cellUV('frond', 1), pvm = (pv0 + pv1) / 2, pdv = 3 / 1024;
  const fanUV = a => [fu0 + (FAN.c[0] + Math.cos(a) * FAN.r) / 256 * (fu1 - fu0), fv1 - (FAN.c[1] + Math.sin(a) * FAN.r) / 256 * (fv1 - fv0)];
  const cUV = [fu0 + FAN.c[0] / 256 * (fu1 - fu0), fv1 - FAN.c[1] / 256 * (fv1 - fv0)];
  for (let i = 0; i < nL; i++) {
    const az = i * 2.39996 + R() * 0.3, dry = !lo && i >= nL - 3, el = dry ? -1.15 + R() * 0.2 : 1.15 - (i % 4) * 0.42 + (R() - 0.5) * 0.2;   // זווית הזהב: מניפות מפוזרות סביב
    const out = new V3(Math.cos(az), 0, Math.sin(az)), dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const pl = (lo ? 1.0 : 1.15) + R() * 0.55, base = top.clone().add(new V3(0, 0.25, 0)), tip = base.clone().addScaledVector(dir, pl);
    const part = dry ? 3 : 1, mask = 0.15 + 0.85 * R(), col = cols ? (dry ? cols.dry : cols.leaf) : null, cc = f => col ? col.map(c => c * f) : f;
    if (!lo) {   // פטוטרת: רצועה דקה על ציר כף התמר
      const sdv = out.clone().cross(new V3(0, 1, 0)).normalize().multiplyScalar(0.05), n = new V3(0, 1, 0);
      const a = vtx(b, base.clone().sub(sdv), n, pu0, pvm - pdv, cc(0.7), part, base, mask), c = vtx(b, base.clone().add(sdv), n, pu0, pvm + pdv, cc(0.7), part, base, mask);
      const d = vtx(b, tip.clone().sub(sdv), n, pu0 + 0.18, pvm - pdv, cc(0.85), part, base, mask), e = vtx(b, tip.clone().add(sdv), n, pu0 + 0.18, pvm + pdv, cc(0.85), part, base, mask);
      b.I.push(a, d, c, c, d, e); }
    // להב המניפה: כמו מניפת יד שמוחזקת בידית — המישור מכיל את הפטוטרת ואת הכיוון הצידי; "למעלה" של התא = כיוון הפטוטרת
    const sideH = new V3(-Math.sin(az), 0, Math.cos(az)), tw = (R() - 0.5) * 1.6, rt = sideH.clone().multiplyScalar(Math.cos(tw)).add(new V3(0, Math.sin(tw), 0)).normalize();
    const upv = dir.clone(), fn = rt.clone().cross(upv).normalize(); if (fn.y < 0) fn.negate();
    const Rw = (lo ? 1.0 : 1.05) + R() * 0.25;
    const ctr = tip.clone().addScaledVector(upv, -0.05), arc = lo ? 3 : 5, ci = vtx(b, ctr, fn, cUV[0], cUV[1], cc(0.8), part, tip, mask), ring = [];
    for (let k = 0; k <= arc; k++) { const a = FAN.a0 + (FAN.a1 - FAN.a0) * k / arc, ca = Math.cos(a), sa = -Math.sin(a);   // קנבס y למטה → למעלה בעולם
      const p = ctr.clone().addScaledVector(rt, ca * Rw).addScaledVector(upv, sa * Rw).addScaledVector(fn, 0.22 * Rw * Math.abs(ca) - 0.12 * Rw).add(new V3(0, -0.35 * Rw * Math.max(0, sa), 0));   // שקערורית + קצוות שמוטים
      const uv = fanUV(a), n = fn.clone().addScaledVector(p.clone().sub(top).normalize(), 0.35).normalize(); ring.push(vtx(b, p, n, uv[0], uv[1], cc(0.95), part, tip, mask)); }
    for (let k = 0; k < arc; k++) b.I.push(ci, ring[k], ring[k + 1]);
  }
}
/** שיח / בן-שיח / רתם / עשב — גרסה זולה: כיפת אשכולות או כרטיסים מצטלבים */
function shrub(b, R, o) {
  const H = o.H, CW = o.CW, detail = o.detail ? 1 : 0, col = o.cols ? o.cols.leaf : null;
  if (o.arch === 'tussock' || o.arch === 'broom') {
    const n = o.arch === 'tussock' ? 3 : 4, C = new V3(0, H * 0.5, 0), rad = new V3(CW / 2, H / 2, CW / 2);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI + R() * 0.3; card(b, { c: new V3(0, H * 0.48, 0), n: new V3(Math.cos(a), 0, Math.sin(a)), w: CW * 1.1, h: H * 1.0, twist: 0, cell: o.leaf, C, rad, mask: 0.15 + 0.85 * R(), sph: 0.4, col, ao: 1.1 }); }
    return; }
  const dwarf = o.arch === 'dwarf', K = dwarf ? (detail ? 5 : 4) : (detail ? 10 : 7), C = new V3(0, H * (dwarf ? 0.42 : 0.5), 0), rad = new V3(CW / 2, H / 2, CW / 2);
  for (let i = 0; i < K; i++) { let d = fib(i, K + 2); if (d.y < -0.25) d.y = -0.25; d.normalize();
    const p = C.clone().add(d.clone().multiply(rad).multiplyScalar(0.55 + 0.25 * R())), s = CW * (dwarf ? 0.58 : 0.46) * (0.85 + R() * 0.3), out = p.clone().sub(C).divide(rad).normalize(), mask = 0.15 + 0.85 * R();
    card(b, { c: p, n: out, w: s, h: s, twist: R() * 6.28, cell: o.leaf, C, rad, mask, flip: R() < 0.5, col });
    card(b, { c: p, n: out.clone().cross(new V3(R() - 0.5, 1, R() - 0.5)).normalize(), w: s * 0.9, h: s * 0.9, twist: R() * 6.28, cell: o.leaf, C, rad, mask, col, sph: 0.82 }); }
}
/** ברוש: ציר מרכזי צפוף של אשכולות לאורך הגובה (פרופיל כוש) */
function column(b, R, o) {
  const H = o.H, CW = o.CW, detail = o.detail ? 1 : 0, col = o.cols ? o.cols.leaf : null, K = detail ? 16 : 12, C = new V3(0, H * 0.5, 0), rad = new V3(CW / 2, H / 2, CW / 2);
  tube(b, [new V3(0, 0, 0), new V3(0, H * 0.25, 0)], [Math.max(0.12, H * 0.02), Math.max(0.1, H * 0.016)], 5, o.bark, 0, p => 0.6);
  for (let i = 0; i < K; i++) { const f = (i + 0.5) / K, y = H * (0.08 + 0.9 * f), r = CW / 2 * Math.pow(Math.sin(Math.PI * Math.min(0.98, 0.1 + 0.9 * f)), 0.8) + 0.15;
    const az = i * 2.4 + R(), out = new V3(Math.cos(az), 0.15, Math.sin(az)).normalize(), p = new V3(Math.cos(az) * r * 0.35, y, Math.sin(az) * r * 0.35), s = Math.max(0.7, r * 2.1), mask = 0.15 + 0.85 * R();
    card(b, { c: p, n: out, w: s, h: s * 1.5, twist: (R() - 0.5) * 0.5, cell: o.leaf, C, rad, mask, col, up: 0.25 });
    card(b, { c: p, n: new V3(-out.z, 0, out.x), w: s, h: s * 1.5, twist: (R() - 0.5) * 0.5, cell: o.leaf, C, rad, mask, col, up: 0.25, sph: 0.85 }); }
}
function buildModel(o) {
  const b = Builder(), R = rng(hash32(o.seed || o.code || o.arch));
  if (o.arch === 'palm_feather') phoenix(b, R, o);
  else if (o.arch === 'palm_fan') washingtonia(b, R, o);
  else if (o.arch === 'shrub' || o.arch === 'dwarf' || o.arch === 'broom' || o.arch === 'tussock') shrub(b, R, o);
  else if (o.arch === 'column') column(b, R, o);
  else broadleaf(b, R, o);
  return toGeometry(b);
}
/** מודל למין של מחלקת הצמחייה (אותו חוזה כמו buildSpeciesGeometry: geo/tris/H/box + aPart/aCenter/aMask/aBend). צבע קודקוד = AO אפור; הגוון מה-uniforms של המין */
F.speciesModel = function (sp, detail) {
  if (!F.ok) F.init();
  const look = LOOK[sp.code] || [sp.arch === 'pine' ? 'needle' : sp.arch === 'olive' ? 'narrow' : 'broad', sp.arch === 'eucalyptus' ? 'smooth' : 'fissured'];
  const H = (sp.h[0] + sp.h[1]) / 2, CW = (sp.crown[0] + sp.crown[1]) / 2;
  return buildModel({ arch: sp.arch, code: sp.code, H, CW, leaf: look[0], bark: look[1], detail: !!detail });
};
/** מודלים ל-world.js (כשמחלקת הצמחייה כבויה): צבעים אפויים בקודקודים */
const lin = h => { const c = new T.Color(h); return [c.r, c.g, c.b]; };
F.worldModel = function (kind, lo) {
  if (!F.ok) F.init();
  if (kind === 'palm') return buildModel({ arch: 'palm_feather', code: 'world-palm' + (lo ? '-lo' : ''), H: 9, CW: 7, lo, detail: false, cols: { wood: lin('#8a7458'), leaf: lin('#6f8a55'), dry: lin('#8d7a55'), fruit: lin('#e0a32e') } });
  return buildModel({ arch: 'round_dense', code: 'world-street' + (lo ? '-lo' : ''), H: 8, CW: 7.5, leaf: 'ficus', bark: 'smooth', detail: false, cols: { wood: lin('#8b8378'), leaf: lin('#3f7034') } });
};

// ------------------------------------------------------------------ עדכון לכל פריים: לילה, פנסים, צל, רוח
const LAMP_C = { sodium: new T.Color(1.0, 0.56, 0.22), led: new T.Color(0.8, 0.88, 1.0) };
let lastLamp = 0, lastFrame = -1, bake = null; const _lamps = [];
F.cfg = { lampI: 6, lampR: 6.5, lampH: 7.2, night: 0.15, shadowR: { low: 0, medium: 45, high: 70 } };   // עוצמת פנס, רדיוס (מ'), גובה ראש, הרמת לילה, רדיוס צל לפי שכבה
F.update = function (world) {
  world = world || (window.YZW && YZW.world); if (!world || !world.camera) return;
  const fr = world.renderer ? world.renderer.info.render.frame : 0; if (fr === lastFrame) return; lastFrame = fr;
  const now = performance.now(), cam = world.camera.position, el = world.sun ? world.sun.elevation : 30, night = clamp((2 - el) / 8, 0, 1);
  U.uFloraTime.value = now / 1000;
  if (world.weather && world.weather.wind) { const w = world.weather.wind, sp = Math.hypot(w.x || 0, w.z || 0); U.uFloraWind.value.set(sp ? w.x / sp : 1, 0, sp ? w.z / sp : 0, Math.min(14, sp || world.weather.windSpeed || 3)); }
  const tier = world.quality ? world.quality.tier : 'medium'; U.uFloraShadowC.value.set(cam.x, cam.y, cam.z, F.cfg.shadowR[tier] || 45);
  if (bake) return;
  U.uFloraNight.value = F.cfg.night * night;
  if (night < 0.05) { U.uFloraLampOn.value = 0; return; }
  if (now - lastLamp < 500) return; lastLamp = now;
  // פנסים: הריהוט הנגזר (procgen) → אחרת נקודות הפנסים של atmo-lite
  _lamps.length = 0;
  const L = world.providers && world.providers.lamps;
  if (L && L.length) for (const l of L) { const d2 = (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2; if (d2 < 90 * 90) _lamps.push([d2, l.x, (l.y || 0) + F.cfg.lampH, l.z, l.type === 'sodium' ? 'sodium' : 'led']); }
  else if (window.YZAtmoLite && YZAtmoLite.lamps) { const p = YZAtmoLite.lamps.geometry.attributes.position, n = YZAtmoLite.cnt || 0;
    for (let i = 0; i < n; i++) { const x = p.getX(i), z = p.getZ(i), d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2; if (d2 < 90 * 90) _lamps.push([d2, x, p.getY(i) - 0.8, z, 'sodium']); } }
  _lamps.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < 8; i++) { const l = _lamps[i], P = U.uFloraLP.value[i], C = U.uFloraLC.value[i];
    if (!l) { P.set(0, -999, 0, 1); C.set(0, 0, 0, 0); continue; }
    const fade = 1 - clamp((Math.sqrt(l[0]) - 45) / 40, 0, 1), I = F.cfg.lampI * night * fade, c = LAMP_C[l[4]];
    P.set(l[1], l[2], l[3], F.cfg.lampR * F.cfg.lampR); C.set(c.r * I, c.g * I, c.b * I, 1); }
  U.uFloraLampOn.value = _lamps.length ? 1 : 0;
};
/** אפיית כרטיסים רחוקים: תאורת יום בלי לילה/פנסים */
F.bakeDay = function (on) {
  if (on) { bake = { n: U.uFloraNight.value, l: U.uFloraLampOn.value }; U.uFloraNight.value = 0; U.uFloraLampOn.value = 0; }
  else if (bake) { U.uFloraNight.value = bake.n; U.uFloraLampOn.value = bake.l; bake = null; }
};
F.stats = () => ({ tex: F.tex ? F.tex.size : 0, texMB: F.texMB(), ms: F.ms || 0, lamps: _lamps.length, night: +U.uFloraNight.value.toFixed(3) });
})();
