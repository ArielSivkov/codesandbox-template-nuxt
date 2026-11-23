/* ESH27 · מחלקת הבניינים — interiors.js
   "הנכסים שלי": תבנית פנים קלה – לובי עם דלת לרחוב, גרעין מדרגות ומעלית, ודירה אחת (3–5 חדרים) במצב "לפני" / "אחרי" שיפוץ.
   מידות החדרים: תבנית מקורבת (proc) שנבדקת מול המינימום החוקי:
     תקנות התכנון והבנייה (גלובס 2006): חדר שינה/מגורים ≥ 8 מ"ר ורוחב ≥ 2.60 מ'; סלון אחד ≥ 12 מ"ר; מטבח ≥ 6 מ"ר ורוחב ≥ 1.70 מ';
       אמבטיה ≥ 2.50 מ"ר ורוחב ≥ 1.45 מ'; שירותים ≥ 1.10 מ"ר ורוחב ≥ 0.80 מ'; גובה חדר ≥ 2.50 מ'.  https://www.globes.co.il/news/article.aspx?did=1000085066
     ממ"ד ≥ 9 מ"ר נטו ו-22.5 מ"ק (כל זכות). https://www.kolzchut.org.il/he/מסלול_מהיר_לבניית_ממ"ד_במבנים_נמוכים_(פטור_מהיתר_בנייה)
     דירת 3 חדרים בשיכון 1963 (חולון): 70 מ"ר (טכניון, "דיור לכל" עמ' 13).
     ברוטו מול נטו: "דירה של 100 מ"ר ברוטו היא בדרך כלל 80–85 מ"ר שמישים"; מרפסת 10–14 מ"ר בדירת 4 חדרים חדשה (Times of Israel blog).
   קוד טהור לתכנון (planApartment) + בונה three.js (buildProperty). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ESHBuildings = root.ESHBuildings || {}; root.ESHBuildings.interiors = api; }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
// מינימום חוקי לכל סוג חדר: שטח (מ"ר) ומידה קצרה (מ')
const MIN = { salon: [12, 2.6], bed: [8, 2.6], mamad: [9, 2.0], kitchen: [6, 1.7], bath: [2.5, 1.45], wc: [1.1, 0.8], hall: [3, 1.0], suite: [1.8, 0.9] };
const HE = { salon: 'סלון ופינת אוכל', bed: 'חדר שינה', master: 'חדר הורים', mamad: 'ממ"ד', kitchen: 'מטבח', bath: 'אמבטיה', wc: 'שירותי אורחים', hall: 'כניסה ומסדרון', suite: 'מקלחת הורים' };
const SHORT = { salon: 'סלון', bed: 'שינה', master: 'הורים', mamad: 'ממ"ד', kitchen: 'מטבח', bath: 'אמבטיה', wc: 'שירותים', hall: 'מבואה', suite: 'מקלחון' };
// תבניות (נטו, מ"ר) – proc. band: f = חזית (סלון/מטבח, מול המרפסת), m = אמצע (רטוב + מסדרון), b = אחור (חדרים)
const TEMPLATES = {
  3: [['salon', 24, 'f'], ['kitchen', 9, 'f'], ['hall', 6, 'm'], ['bath', 4.5, 'm'], ['wc', 1.6, 'm'], ['master', 12, 'b'], ['mamad', 9.5, 'b']],
  4: [['salon', 28, 'f'], ['kitchen', 10, 'f'], ['hall', 7, 'm'], ['bath', 4.5, 'm'], ['wc', 1.6, 'm'], ['suite', 3.5, 'm'], ['master', 13, 'b'], ['bed', 10.5, 'b'], ['mamad', 10, 'b']],
  5: [['salon', 32, 'f'], ['kitchen', 12, 'f'], ['hall', 9, 'm'], ['bath', 5, 'm'], ['wc', 1.6, 'm'], ['suite', 4, 'm'], ['master', 14, 'b'], ['bed', 11, 'b'], ['bed', 11, 'b'], ['mamad', 10.5, 'b']],
};
const BALCONY = { 3: 10, 4: 12, 5: 14 };   // מ"ר (טווח 10–14 לפי המקור; 3 חד' – הנחה)
const NET_TO_GROSS = 1 / 0.82;             // 100 ברוטו ≈ 80–85 נטו
const minOf = key => MIN[key === 'master' ? 'bed' : key];

/* planApartment(rooms) → { W, D, rooms[{key,he,x,z,w,d,area,ok}], net, gross, balcony, worstSlack }
   פריסה בשלוש רצועות לרוחב W: כל חדר ברוחב area/depth. W נבחר בחיפוש כך שהמרווח מעל המינימום (יחס מידה/מינימום) מקסימלי. */
function planApartment(n = 4) {
  const tpl = TEMPLATES[n] || TEMPLATES[4], bands = { f: [], m: [], b: [] };
  tpl.forEach(([key, area, band]) => bands[band].push({ key, area }));
  const A = tpl.reduce((s, r) => s + r[1], 0);
  let best = null;
  for (let W = Math.sqrt(A) * 0.7; W <= Math.sqrt(A) * 1.6; W += 0.05) {
    let worst = Infinity, z = 0; const rooms = [];
    for (const band of ['f', 'm', 'b']) {
      const list = bands[band], ba = list.reduce((s, r) => s + r.area, 0), d = ba / W; let x = 0;
      for (const r of list) { const w = r.area / d, [ma, md] = minOf(r.key); worst = Math.min(worst, Math.min(w, d) / md, r.area / ma); rooms.push({ key: r.key, he: HE[r.key], band, x, z, w, d, area: r.area }); x += w; }
      z += d;
    }
    if (!best || worst > best.worstSlack) best = { W, D: z, rooms, worstSlack: worst };
  }
  best.rooms.forEach(r => { const [ma, md] = minOf(r.key); r.ok = r.area >= ma - 1e-9 && Math.min(r.w, r.d) >= md - 1e-9; r.min = { area: ma, side: md }; });
  const bal = BALCONY[n] || 12, salon = best.rooms.find(r => r.key === 'salon');
  best.balcony = { area: bal, x: salon.x, z: -2.0, w: Math.min(bal / 2.0, best.W), d: 2.0 };
  best.net = A; best.gross = Math.round(A * NET_TO_GROSS * 10) / 10; best.n = n; best.ceiling = 2.6; best.floorH = 3.0;
  return best;
}

/* buildProperty(THREE, { rooms: 3|4|5, state: 'before'|'after', floor: 2, entranceWidth: 1.2 })
   מחזיר { group, plan, labels[{he,x,y,z}], drawCalls }. קואורדינטות מקומיות: x לרוחב החזית, z = 0 קו החזית לרחוב (z שלילי = מרפסת/רחוב), y למעלה.
   הדירה בקומה floor; גרעין המדרגות מאחורי הלובי. כל האטום במש אחד (צבעי קודקוד) + זכוכית במש שני = 2 קריאות ציור. */
function buildProperty(THREE, opts = {}) {
  const plan = planApartment(opts.rooms || 4), after = opts.state === 'after', FH = plan.floorH, fl = opts.floor == null ? 2 : opts.floor, y0 = fl * FH;
  const P = [], N = [], C = [], G = { P: [], N: [], C: [] };
  const box = (x0, ya, z0, x1, yb, z1, col, tgt) => { const T = tgt || { P, N, C }, f = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) { T.P.push(...p); T.N.push(...n); T.C.push(...col); } };
    f([x0, ya, z1], [x1, ya, z1], [x1, yb, z1], [x0, yb, z1], [0, 0, 1]); f([x1, ya, z0], [x0, ya, z0], [x0, yb, z0], [x1, yb, z0], [0, 0, -1]);
    f([x1, ya, z1], [x1, ya, z0], [x1, yb, z0], [x1, yb, z1], [1, 0, 0]); f([x0, ya, z0], [x0, ya, z1], [x0, yb, z1], [x0, yb, z0], [-1, 0, 0]);
    f([x0, yb, z1], [x1, yb, z1], [x1, yb, z0], [x0, yb, z0], [0, 1, 0]); f([x0, ya, z0], [x1, ya, z0], [x1, ya, z1], [x0, ya, z1], [0, -1, 0]); };
  const W = plan.W, D = plan.D, WALL = 0.12, EXT = 0.25, MAMAD_W = 0.25, CEIL = plan.ceiling;   // עובי קירות: proc
  const col = {
    floor: after ? [0.86, 0.84, 0.80] : [0.66, 0.62, 0.56], wet: after ? [0.78, 0.80, 0.82] : [0.55, 0.62, 0.60], wall: after ? [0.95, 0.95, 0.94] : [0.86, 0.80, 0.66],
    ext: [0.90, 0.87, 0.80], mamad: [0.70, 0.70, 0.68], wood: after ? [0.55, 0.42, 0.30] : [0.45, 0.32, 0.22], sofa: after ? [0.35, 0.45, 0.55] : [0.55, 0.35, 0.25],
    bed: [0.90, 0.88, 0.84], counter: after ? [0.25, 0.25, 0.27] : [0.70, 0.66, 0.58], lobby: [0.78, 0.76, 0.72], stair: [0.70, 0.68, 0.64], mail: [0.55, 0.57, 0.6],
  };
  // ---- לובי (קומת קרקע): רצפה, קירות עם פתח דלת לרחוב, תיבות דואר, מעלית, מדרגות עד קומת הדירה ----
  const LW = 5.0, LD = 6.0, lx = W + 0.6;   // הלובי והגרעין צמודים לדירה מצד ימין (proc)
  box(lx, -0.05, 0, lx + LW, 0, LD, col.lobby);
  const door = opts.entranceWidth || 1.2;
  box(lx, 0, -EXT, lx + (LW - door) / 2, CEIL, 0, col.ext); box(lx + (LW + door) / 2, 0, -EXT, lx + LW, CEIL, 0, col.ext); box(lx + (LW - door) / 2, 2.2, -EXT, lx + (LW + door) / 2, CEIL, 0, col.ext);
  box(lx + (LW - door) / 2, 0, -0.06, lx + (LW + door) / 2, 2.2, -0.02, [0.3, 0.35, 0.38], G);   // דלת זכוכית
  box(lx - EXT, 0, 0, lx, CEIL, LD, col.ext); box(lx + LW, 0, 0, lx + LW + EXT, CEIL, LD, col.ext);
  box(lx + 0.1, 1.0, 0.4, lx + 0.35, 1.8, 2.2, col.mail);                                         // תיבות דואר
  box(lx + LW - 1.8, 0, LD - 1.9, lx + LW - 0.1, CEIL + y0 + 0.5, LD - 0.1, [0.6, 0.6, 0.62]);     // פיר מעלית (מיוצג כגוש)
  const steps = Math.round(FH / 0.17), run = 0.28, sw = 1.2;   // רום 17 ס"מ, שלח 28 ס"מ (proc)
  for (let f = 0; f < fl; f++) for (let s = 0; s < steps; s++) { const half = s < steps / 2, i = half ? s : s - steps / 2, yb = f * FH + (s + 1) * FH / steps;
    const zA = 1.0 + i * run, x0 = half ? lx + 0.4 : lx + 0.4 + sw + 0.1; const zz = half ? zA : 1.0 + (steps / 2 - 1 - i) * run;
    box(x0, yb - 0.17, zz, x0 + sw, yb, zz + run, col.stair); }
  for (let f = 1; f <= fl; f++) box(lx, f * FH - 0.2, LD - 2.0, lx + LW, f * FH, LD, col.stair);   // משטחי קומה
  // ---- הדירה ----
  for (const r of plan.rooms) { const wet = r.key === 'bath' || r.key === 'wc' || r.key === 'suite' || (r.key === 'kitchen' && !after);
    box(r.x, y0 - 0.05, r.z, r.x + r.w, y0, r.z + r.d, wet ? col.wet : col.floor); }
  box(-EXT, y0 - 0.3, -EXT, W + EXT, y0 - 0.05, D + EXT, col.ext);   // תקרת הקומה שמתחת
  // קירות חוץ (חתך בגובה מלא, בלי תקרה – "בית בובות")
  const winGap = (x0, x1, z0, z1, axisX) => { const L = axisX ? x1 - x0 : z1 - z0, nW = Math.max(1, Math.floor(L / 3)), seg = L / nW;
    for (let i = 0; i < nW; i++) { const a = (axisX ? x0 : z0) + i * seg, b = a + seg, wa = a + seg * 0.3, wb = a + seg * 0.7;
      const B = (p0, p1, ya, yb) => axisX ? box(p0, y0 + ya, z0, p1, y0 + yb, z1, col.ext) : box(x0, y0 + ya, p0, x1, y0 + yb, p1, col.ext);
      B(a, wa, 0, CEIL); B(wb, b, 0, CEIL); B(wa, wb, 0, 0.9); B(wa, wb, 2.2, CEIL);
      axisX ? box(wa, y0 + 0.9, (z0 + z1) / 2 - 0.02, wb, y0 + 2.2, (z0 + z1) / 2 + 0.02, [0.5, 0.6, 0.66], G) : box((x0 + x1) / 2 - 0.02, y0 + 0.9, wa, (x0 + x1) / 2 + 0.02, y0 + 2.2, wb, [0.5, 0.6, 0.66], G); } };
  const salon = plan.rooms.find(r => r.key === 'salon');
  // חזית: פתח יציאה למרפסת ברוחב הסלון
  box(salon.x + salon.w, y0, -EXT, W + EXT, y0 + CEIL, 0, col.ext); box(-EXT, y0, -EXT, salon.x + 0.4, y0 + CEIL, 0, col.ext);
  box(salon.x + 0.4, y0 + 2.3, -EXT, salon.x + salon.w, y0 + CEIL, 0, col.ext);
  winGap(-EXT, W + EXT, D, D + EXT, true); winGap(-EXT, 0, 0, D, false); winGap(W, W + EXT, 0, D, false);
  // קירות פנים: בין רצועות ובין חדרים, עם פתחי דלת 0.9 מ' לצד המסדרון
  const bandZ = [...new Set(plan.rooms.map(r => r.z))].sort((a, b) => a - b).slice(1);
  const hall = plan.rooms.find(r => r.key === 'hall');
  for (const z of bandZ) { // קיר ארוך בין רצועות עם פתחים מול כל חדר שגובל במסדרון
    const cuts = plan.rooms.filter(r => (Math.abs(r.z - z) < 1e-6 || Math.abs(r.z + r.d - z) < 1e-6) && r.key !== 'hall').map(r => r.x + Math.min(0.5, r.w * 0.2));
    if (after) cuts.push(salon.x + salon.w * 0.3);
    let x = 0; cuts.sort((a, b) => a - b).forEach(c => { if (c > x) box(x, y0, z - WALL / 2, c, y0 + CEIL, z + WALL / 2, col.wall); x = c + 0.9; }); if (x < W) box(x, y0, z - WALL / 2, W, y0 + CEIL, z + WALL / 2, col.wall);
  }
  for (const r of plan.rooms) { if (r.x < 1e-6) continue;
    const neighbour = plan.rooms.find(q => q.band === r.band && Math.abs(q.x + q.w - r.x) < 1e-6);
    if (after && r.band === 'f' && (r.key === 'kitchen' || (neighbour && neighbour.key === 'kitchen'))) continue;   // אחרי: מטבח פתוח לסלון
    const th = r.key === 'mamad' || (neighbour && neighbour.key === 'mamad') ? MAMAD_W : WALL, c = r.key === 'mamad' || (neighbour && neighbour.key === 'mamad') ? col.mamad : col.wall;
    box(r.x - th / 2, y0, r.z, r.x + th / 2, y0 + CEIL, r.z + r.d, c); }
  // ריהוט מינימלי
  const fz = (r, a) => r.z + r.d * a, fx = (r, a) => r.x + r.w * a;
  box(fx(salon, 0.15), y0, fz(salon, 0.55), fx(salon, 0.75), y0 + 0.75, fz(salon, 0.55) + 0.9, col.sofa);
  box(fx(salon, 0.3), y0, fz(salon, 0.2), fx(salon, 0.6), y0 + 0.75, fz(salon, 0.2) + 0.9, col.wood);
  const kit = plan.rooms.find(r => r.key === 'kitchen'); box(kit.x + 0.05, y0, kit.z + kit.d - 0.65, kit.x + kit.w - 0.05, y0 + 0.9, kit.z + kit.d - 0.05, col.counter);
  for (const r of plan.rooms.filter(q => q.key === 'master' || q.key === 'bed' || q.key === 'mamad')) { const bw = r.key === 'master' ? 1.6 : 0.9;
    box(r.x + (r.w - bw) / 2, y0, r.z + r.d - 2.05, r.x + (r.w + bw) / 2, y0 + 0.5, r.z + r.d - 0.1, col.bed); }
  // מרפסת: לפני = סגורה (סגירת מרפסות: אלומיניום וזכוכית); אחרי = פתוחה עם מעקה זכוכית
  const B = plan.balcony; box(B.x, y0 - 0.25, B.z, B.x + B.w, y0, 0, col.ext);
  if (!after) { box(B.x, y0, B.z, B.x + B.w, y0 + 0.9, B.z + 0.1, col.ext); box(B.x, y0 + 0.9, B.z, B.x + B.w, y0 + CEIL, B.z + 0.05, [0.45, 0.55, 0.6], G);
    box(B.x, y0, B.z, B.x + 0.08, y0 + CEIL, 0, [0.8, 0.8, 0.78]); box(B.x + B.w - 0.08, y0, B.z, B.x + B.w, y0 + CEIL, 0, [0.8, 0.8, 0.78]); }
  else box(B.x, y0, B.z, B.x + B.w, y0 + 1.05, B.z + 0.04, [0.55, 0.7, 0.75], G);
  const mk = (A, transparent) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(A.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(A.C, 3));
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: !!transparent, opacity: transparent ? 0.45 : 1, depthWrite: !transparent })); return m; };
  const group = new THREE.Group(); group.name = 'esh-property'; group.add(mk({ P, N, C })); group.add(mk(G, true));
  const labels = plan.rooms.filter(r => r.area >= 4).map(r => ({ he: SHORT[r.key] + ' ' + Math.round(r.w * r.d) + ' מ"ר', x: r.x + r.w / 2, y: y0 + 1.4, z: r.z + r.d / 2 }));
  labels.push({ he: 'מרפסת ' + B.area + (after ? ' מ"ר' : ' (סגורה)'), x: B.x + B.w / 2, y: y0 + 1.2, z: B.z / 2 }, { he: 'לובי · דלת לרחוב', x: lx + LW / 2, y: 1.5, z: 1.5 });
  return { group, plan, labels, drawCalls: 2, tris: (P.length + G.P.length) / 9 };
}
return { MIN, HE, TEMPLATES, BALCONY, planApartment, buildProperty, NET_TO_GROSS };
});
