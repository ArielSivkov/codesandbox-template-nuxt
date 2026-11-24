/* חיים ברחוב (גרסת גישור של מחלקת האינטגרציה) — תנועה קלה והולכי רגל על המדרכות, עד שמחלקות התחבורה
 * (swarm/transport) והדמויות (swarm/npc) ימסרו מודולים עם ממשק לעולם. עונה ל"אין אנשים, אין תנועה".
 * רכבים: InstancedMesh אחד (גוף+תא ממוזגים), נוסעים בצד ימין של מרכז הכביש לאורך קווי הכבישים של האריחים.
 * הולכי רגל: InstancedMesh אחד, הולכים על המדרכה (קצה הכביש + 1.8 מ׳), נדנוד הליכה.
 * אור לילה לרכבים: נקודות פנסים/אורות אחוריים (2 קריאות ציור). צפיפות לפי איכות + "אזור התצוגה" סביב הארז.
 * שבת: תנועה ×0.12, הולכי רגל בלבן/כהה (לפי world.shabbat — גם שבת ידנית).
 * צוות תנועה וטעינה (24.11.2026): רכבים עוצרים ברמזור האדום (אותו מחזור של W.updateSignals), ממשיכים לכביש הבא בסוף הכביש
 * (פנייה/ישר) במקום "קפיצה", מהירות ותאוצה לפי סוג הכביש, שמירת מרחק בלי נעילה מול נתיב נגדי, שחרור רכב תקוע,
 * הופעה/היעלמות רק מחוץ לטווח הראייה, החלקת פינות. בדיקות: /home/claude/swarm/motion/tests (t_motion.js).
 */
(function () {
  'use strict';
  const L = { cars: [], peds: [], carMesh: null, pedMesh: null, heads: null, tails: null, roads: [], net: [], poles: null, roadT: 0, night: 0, stats: { turns: 0, uturns: 0, respawns: 0, redStops: 0, unstuck: 0 } };
  const TIER = { low: [22, 36], medium: [40, 70], high: [70, 120] };
  const PALETTE = [0xf2f2f2, 0x1d1d1f, 0x9aa1a8, 0xc8ccd0, 0x23408e, 0xb3262c, 0x6b6f75, 0xe9e4d4, 0x2d5a3d, 0x8a8f96];
  const CLOTH = [0x2f4b7c, 0xd9534f, 0xf0ad4e, 0x5cb85c, 0x6f42c1, 0x20c997, 0xe9ecef, 0x343a40, 0xfd7e14, 0x17a2b8];
  // מהירות יעד לפי סוג כביש (מ"ש): [מינימום, טווח] → 1: 22–34 קמ"ש, 2: 30–45, 3: 40–55, 4: 47–70 (עירוני, מקורב)
  const VCLS = { 1: [6, 3.5], 2: [8.4, 4.1], 3: [11, 4.3], 4: [13, 6.4] };
  const ACC = 2.0, DEC = 3.6, HARD = 7.5, VIS = 140;   // תאוצה/בלימה (מ"ש²), רדיוס "בטווח ראייה" להופעה/היעלמות
  function box(w, h, d, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y, z || 0); return g.toNonIndexed(); }
  function merge(gs) { let n = 0; gs.forEach(g => n += g.attributes.position.count); const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    for (const g of gs) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return g; }
  // ---------- רשת כבישים: מקטעים קרובים + חיבורי קצוות (פנייה בסוף כביש) + רמזורים
  const RCACHE = new WeakMap();   // אותו מערך נקודות → אותו אובייקט כביש (רכב לא "מאבד" את הכביש שלו בבנייה מחדש)
  function roadObj(r) { let o = RCACHE.get(r.p); if (o) return o; const p = r.p, seg = []; let len = 0;
    for (let i = 0; i < p.length / 2 - 1; i++) { const l = Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]); seg.push(l); len += l; }
    o = { p, seg, len, w: r.w, c: r.c, ends: [[], []] }; RCACHE.set(r.p, o); return o; }
  const ek = (x, z) => Math.round(x / 2.5) + ',' + Math.round(z / 2.5);
  function collectRoads(world) {
    const P = world.player.pos, R2 = 900 * 900, out = [], net = [];
    for (const t of world.data.tiles.values()) for (const r of t.roads || []) { const p = r.p; if (p.length < 4) continue;
      let near = false; for (let i = 0; i < p.length; i += 6) if ((p[i] - P.x) ** 2 + (p[i + 1] - P.z) ** 2 < R2) { near = true; break; }
      if (!near && !((p[p.length - 2] - P.x) ** 2 + (p[p.length - 1] - P.z) ** 2 < R2)) continue;
      const o = roadObj(r); if (o.len < 0.5) continue; if (o.c >= 1) net.push(o); if (o.len > 25) out.push(o); }
    // קצוות: מפתח רשת 2.5 מ' + שכנים (קצוות של אותו צומת / גבול אריח)
    const M = new Map(); const put = (k, v) => { let a = M.get(k); if (!a) M.set(k, a = []); a.push(v); };
    for (const o of net) { o.ends = [[], []]; const p = o.p, n = p.length; put(ek(p[0], p[1]), [o, 0]); put(ek(p[n - 2], p[n - 1]), [o, 1]); }
    for (const o of net) { const p = o.p, n = p.length;
      for (let e = 0; e < 2; e++) { const x = e ? p[n - 2] : p[0], z = e ? p[n - 1] : p[1], cx = Math.round(x / 2.5), cz = Math.round(z / 2.5), seen = new Set();
        for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) for (const [o2, e2] of M.get(a + ',' + b) || []) { if (o2 === o && e2 === e) continue; if (seen.has(o2)) continue;
          const q = o2.p, m = q.length, x2 = e2 ? q[m - 2] : q[0], z2 = e2 ? q[m - 1] : q[1]; if ((x2 - x) ** 2 + (z2 - z) ** 2 > 2.2 * 2.2) continue; seen.add(o2); o.ends[e].push([o2, e2]); } } }
    L.roads = out; L.net = net;
    // רמזורים (נתוני world.js: עמוד בצד ימין של כל זרוע נכנסת, מחזור 60 ש') → רשת 40 מ'
    const PG = new Map(); for (const t of world.data.tiles.values()) for (const s of t.sigPoles || []) { const k = Math.floor(s.x / 40) + ',' + Math.floor(s.z / 40); let a = PG.get(k); if (!a) PG.set(k, a = []); a.push({ x: s.x, z: s.z, dx: Math.sin(s.yaw), dz: Math.cos(s.yaw), axis: s.axis, ph: s.ph }); }
    L.poles = PG;
  }
  function nearPole(x, z, r) { const gx = Math.floor(x / 40), gz = Math.floor(z / 40); for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) for (const p of L.poles.get(a + ',' + b) || []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true; return false; }
  /** מצב הרמזור כמו W.updateSignals: 2 ירוק, 1 צהוב, 0 אדום */
  const sigState = (p, t) => { const c = ((t + p.ph) % 60 + 60) % 60, tc = p.axis ? (c + 30) % 60 : c; return tc < 27 ? 2 : tc < 30 ? 1 : 0; };
  L.sigState = sigState;
  function at(r, s) { // מיקום וכיוון לאורך הכביש במרחק s
    s = Math.max(0, Math.min(r.len, s)); let i = 0; while (i < r.seg.length - 1 && s > r.seg[i]) { s -= r.seg[i]; i++; }
    const p = r.p, ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, l = r.seg[i] || 1, k = Math.min(1, s / l);
    return { x: ax + dx * k, z: az + dz * k, fx: dx / l, fz: dz / l };
  }
  /** בטווח הראייה: קרוב לשחקן, או בחזית המצלמה עד 260 מ' */
  function seen(world, x, z) { const P = world.player.pos, d = Math.hypot(x - P.x, z - P.z); if (d < 70) return true; if (d > 420) return false;
    const cam = world.camera; if (!cam) return d < VIS; const e = cam.matrixWorld.elements, fx = -e[8], fz = -e[10], ox = x - cam.position.x, oz = z - cam.position.z;
    const dot = (ox * fx + oz * fz) / (Math.hypot(ox, oz) * (Math.hypot(fx, fz) || 1) || 1); return dot > 0.35 && d < 300 || d < VIS && dot > -0.2; }
  function pickRoad(world, wantCars, init) {
    if (!L.roads.length) return null; const sc = world.showcase, P = world.player.pos;
    for (let k = 0; k < 18; k++) { const r = L.roads[Math.random() * L.roads.length | 0]; if (wantCars && r.c < 1) continue; const s = 8 + Math.random() * Math.max(1, r.len - 16), q = at(r, s);
      const d = Math.hypot(q.x - P.x, q.z - P.z); if (d < 12) continue;
      if (wantCars && !init && seen(world, q.x, q.z)) continue;   // לא "צצים" מול העיניים
      if (wantCars && L.cars.some(o => o.r && o.px != null && Math.abs(o.px - q.x) < 9 && Math.abs(o.pz - q.z) < 9)) continue;   // לא על רכב אחר
      if (wantCars && L.poles && nearPole(q.x, q.z, 35)) continue;   // לא ממש לפני רמזור (רכב שמופיע במהירות לא יכול לעצור)
      let pr = d < 300 ? 1 : d < 500 ? 0.35 : 0.08; if (sc && Math.hypot(q.x - sc.x, q.z - sc.z) < sc.r) pr = Math.min(1, pr * 1.8);   // אזור התצוגה סביב הארז
      if (Math.random() < pr) return { r, s }; }
    return null;
  }
  function vmaxOf(r, c) { const k = VCLS[r.c] || VCLS[2]; return k[0] + (c.vr == null ? (c.vr = Math.random()) : c.vr) * k[1]; }
  function spawnCar(world, c, init) { const p = pickRoad(world, true, init); if (!p) { c.r = null; return; }
    Object.assign(c, p, { dir: Math.random() < 0.5 ? 1 : -1, vr: Math.random(), lane: Math.max(1.25, p.r.w * 0.25), cx: 0, cz: 0, rx: null, rz: null, stopT: 0, ghost: 0, q: 0, goP: null, px: null, crash: 0, gen: (c.gen || 0) + 1 });
    c.vmax = vmaxOf(c.r, c); c.v = c.vmax * (0.6 + Math.random() * 0.4); L.stats.respawns++; }
  function spawnPed(world, q) { const p = pickRoad(world, false); if (!p) { q.r = null; return; } Object.assign(q, p, { dir: Math.random() < 0.5 ? 1 : -1, v: 1.1 + Math.random() * 0.5, side: Math.random() < 0.5 ? 1 : -1, ph: Math.random() * 6 }); }
  /** סוף הכביש: ממשיכים לכביש מחובר (פנייה/ישר), אחרת פרסה. מחזיר false אם צריך הופעה מחדש. */
  function nextRoad(world, c) {
    const end = c.dir > 0 ? 1 : 0, r = c.r, over = c.dir > 0 ? c.s - r.len : -c.s, f = at(r, end ? r.len : 0), fx = f.fx * c.dir, fz = f.fz * c.dir;
    const opts = []; for (const [o2, e2] of r.ends[end]) { if (o2 === r || o2.c < 1) continue; const g = at(o2, e2 ? o2.len : 0), gx = e2 ? -g.fx : g.fx, gz = e2 ? -g.fz : g.fz, dot = fx * gx + fz * gz;
      if (dot < -0.5) continue; opts.push({ o2, e2, w: dot > 0.85 ? 3 : 1.6 }); }   // בלי פרסה בצומת; ישר מועדף
    if (opts.length) { let s = 0; for (const o of opts) s += o.w; let x = Math.random() * s, pk = opts[0]; for (const o of opts) { x -= o.w; if (x <= 0) { pk = o; break; } }
      c.r = pk.o2; c.dir = pk.e2 ? -1 : 1; c.s = pk.e2 ? pk.o2.len - Math.min(over, pk.o2.len) : Math.min(over, pk.o2.len); c.lane = Math.max(1.25, pk.o2.w * 0.25); c.vmax = vmaxOf(c.r, c); L.stats.turns++; return true; }
    // מבוי סתום: רחוק מהעין → הופעה מחדש; קרוב → פרסה איטית
    if (!seen(world, f.x, f.z)) return false;
    c.dir = -c.dir; c.s = end ? r.len - 0.5 : 0.5; c.v = Math.min(c.v, 2.5); L.stats.uturns++; return true;
  }
  function counts(world) { const t = TIER[world.quality.tier] || TIER.medium; const sh = world.shabbat.active;
    let carK = sh ? 0.12 : 1; if (world.providers.density) { try { carK = world.providers.density().cars; } catch (e) { /* */ } }
    if (sh) carK = Math.min(carK, 0.12);   // שבת ידנית (או לפי השעון) גוברת על הצפיפות של מחלקת הדמויות
    return [Math.round(t[0] * Math.max(0.05, Math.min(1.5, carK))), world.providers.pedestrians === 'npc' ? 0 : t[1]]; }   // הדמויות של מחלקת ה-NPC מחליפות את הקופסאות
  function recolorPeds(world) { const sh = world.shabbat.active, c = new THREE.Color();
    for (let i = 0; i < L.pedMesh.count; i++) { c.setHex(sh ? (i % 3 === 0 ? 0x22252a : 0xf4f4f0) : CLOTH[i % CLOTH.length]); L.pedMesh.setColorAt(i, c); } if (L.pedMesh.instanceColor) L.pedMesh.instanceColor.needsUpdate = true; }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  const angD = (a, b) => { let d = b - a; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; return d; };
  /** מהירות מרבית מותרת עכשיו לרכב (רמזור, רכב לפניי, השחקן). מחזיר {v, why} */
  function limit(world, c, i, nc, a0, fx, fz, x, z) {
    let v = c.vmax, why = '', by = null;
    const P = world.player.pos, t = world.G27.S.t;
    // השחקן לפניי (ברגל או ברכב)
    { const dpx = P.x - x, dpz = P.z - z, ah = dpx * fx + dpz * fz, sd = Math.abs(dpx * fz - dpz * fx); if (ah > 0 && ah < 14 && sd < 2.8) { const vv = Math.sqrt(Math.max(0, 2 * DEC * (ah - 5))); if (vv < v) { v = vv; why = 'player'; } } }
    // רמזור: קו העצירה = שורת העמוד (העמוד בצד ימין של הזרוע הנכנסת, פונה החוצה מהצומת)
    if (L.poles) { const gx = Math.floor(x / 40), gz = Math.floor(z / 40);
      // קצה הכביש שלי: עמוד שנמצא ליד הקצה (כביש מתעקל / כיכר) נבדק לפי כיוון הכביש בקצה, לא לפי הכיוון הנוכחי
      const rem = c.dir > 0 ? c.r.len - c.s : c.s, eA = rem < 65 ? at(c.r, c.dir > 0 ? c.r.len : 0) : null, efx = eA ? eA.fx * c.dir : 0, efz = eA ? eA.fz * c.dir : 0;
      for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) for (const p of L.poles.get(a + ',' + b) || []) {
        const ox = x - p.x, oz = z - p.z; let d = ox * p.dx + oz * p.dz, lat = Math.abs(ox * p.dz - oz * p.dx);
        if (fx * p.dx + fz * p.dz > -0.7) {   // לא זרוע שאני נכנס בה עכשיו — אולי בקצה הכביש
          if (!eA || efx * p.dx + efz * p.dz > -0.7) continue; const qx = eA.x - p.x, qz = eA.z - p.z, dE = qx * p.dx + qz * p.dz, lE = Math.abs(qx * p.dz - qz * p.dx);
          if (dE > 1 || dE < -14 || lE > 8) continue; d = rem + dE; lat = 0; }
        if (d <= 1.2 && d > -4 && lat < 6) { c.passP = { x: p.x, z: p.z, t }; continue; }   // עברתי את קו העצירה: בתוך הצומת
        if (c.passP && t - c.passP.t < 8 && (p.x - c.passP.x) ** 2 + (p.z - c.passP.z) ** 2 < 900) continue;   // אותו צומת (כמה צמתי OSM): מפנים את הצומת
        if (d < 1.2 || d > 62 || lat > 6) continue;
        const st = sigState(p, t), gap = d - 2.6; if (st === 2) continue;
        if (c.goP === p) { if (st === 0 && gap > 1 && c.v * c.v < 2 * HARD * gap) c.goP = null; else continue; }   // התחייבנו בצהוב אבל עוד אפשר לעצור באדום → עוצרים
        if (st === 1 && c.v * c.v > 2 * 5 * Math.max(0, gap)) {   // צהוב ואי אפשר לעצור (5 מ"ש²): עוברים רק אם מספיקים בבירור לפני האדום, אחרת בלימה חזקה אם אפשר
          const cc = ((t + p.ph) % 60 + 60) % 60, tc = p.axis ? (cc + 30) % 60 : cc, left = 30 - tc;
          if ((gap + 6) / Math.max(1, c.v) < left * 0.75 || c.v * c.v > 2 * HARD * Math.max(0, gap)) { c.goP = p; continue; } }
        if (st === 0 && c.v * c.v > 2 * HARD * Math.max(0, gap) + 4) { c.goP = p; continue; }   // אדום שאי אפשר לעצור לפניו (נכנס לכביש ממש לפני הקו)
        const vv = gap <= 0.3 ? 0 : Math.sqrt(2 * DEC * gap); if (vv < v) { v = vv; why = 'red'; } } }
    // הולך רגל על הכביש בנתיב שלי (דמויות מחלקת ה-NPC) → עוצרים לפניו
    if (L.pg) { const gx0 = Math.floor((x + fx * 8) / 10), gz0 = Math.floor((z + fz * 8) / 10);
      for (let a = gx0 - 1; a <= gx0 + 1; a++) for (let b = gz0 - 1; b <= gz0 + 1; b++) for (const q of L.pg.get(a * 7919 + b) || []) {
        const ex = q.x - x, ez = q.z - z, ah = ex * fx + ez * fz; if (ah <= 0 || ah > 18) continue; if (Math.abs(ex * fz - ez * fx) > 1.7) continue;
        const vv = Math.sqrt(2 * DEC * Math.max(0, ah - 3.6)); if (vv < v) { v = vv; why = 'ped'; } } }
    // רכב לפניי: אותו כיוון → מרחק לפי זמן (1.2 ש'); חוצה/נגדי → רק אם הוא בתוך הנתיב שלי
    if (!(c.ghost > 0)) for (let j = 0; j < nc; j++) { if (j === i) continue; const o = L.cars[j]; if (o.px == null || !o.r) continue;
      const ex = o.px - x, ez = o.pz - z; if (Math.abs(ex) > 30 || Math.abs(ez) > 30) continue;
      const ah = ex * fx + ez * fz; if (ah <= 0) continue; const sd = Math.abs(ex * fz - ez * fx), same = (o.hx || 0) * fx + (o.hz || 0) * fz;
      if (same > 0.6 ? sd > 2.3 : sd > 2.0) continue;
      if (same < 0.3 && c.stopT > 3 && o.stopT > 3 && c.id < o.id) continue;   // נעילה הדדית בצומת: למספר הנמוך זכות קדימה
      const gap = ah - 5.2, vv = same > 0.6 ? Math.max(0, Math.min(Math.sqrt(2 * DEC * Math.max(0, gap)) + Math.max(0, o.v) * 0.9, gap / 1.2)) : Math.sqrt(2 * DEC * Math.max(0, gap - 1));
      if (vv < v) { v = vv; why = 'car'; by = o; } }
    return { v: Math.max(0, v), why, by };
  }
  YZW.register({
    id: 'life-lite', name: 'חיים ברחוב: תנועה והולכי רגל (גישור)', dept: 'integration → transport + npc', order: 50,
    init(world, api) {
      const g = api.group(); const MAXC = 80, MAXP = 130;
      const cg = merge([box(1.8, 0.75, 4.3, 0.55), box(1.6, 0.6, 2.2, 1.2, 0.25)]);
      L.carMesh = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXC); L.carMesh.castShadow = false; L.carMesh.frustumCulled = false; g.add(L.carMesh);
      const pgm = merge([box(0.42, 0.85, 0.26, 1.05), box(0.36, 0.8, 0.22, 0.4), box(0.24, 0.26, 0.24, 1.62)]);
      L.pedMesh = new THREE.InstancedMesh(pgm, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXP); L.pedMesh.frustumCulled = false; g.add(L.pedMesh);
      const c = new THREE.Color(); for (let i = 0; i < MAXC; i++) { c.setHex(PALETTE[i % PALETTE.length]); L.carMesh.setColorAt(i, c); }
      const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, '#fff'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
      const mk = (col, size) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXC * 2 * 3), 3)); const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: col, size, map: dot, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));   /* נקודות עגולות (לא ריבועים אדומים ליד המצלמה) */ p.frustumCulled = false; g.add(p); return p; };
      L.heads = mk(0xfff4d6, 0.9); L.tails = mk(0xff2a1a, 0.45);
      for (let i = 0; i < MAXC; i++) L.cars.push({ id: i }); for (let i = 0; i < MAXP; i++) L.peds.push({});
      window.YZTraffic = L; collectRoads(world); L.cars.forEach(c2 => spawnCar(world, c2, true)); L.peds.forEach(q => spawnPed(world, q)); recolorPeds(world);
      api.on('shabbat', () => recolorPeds(world)); api.on('env', () => { L.night = Math.max(0, Math.min(1, (2 - world.sun.elevation) / 8)); });
      L.night = Math.max(0, Math.min(1, (2 - world.sun.elevation) / 8));
    },
    update(dt, world) {
      const H = world.data.H, P = world.player.pos, [nc, np] = counts(world);
      L.roadT -= dt; if (L.roadT <= 0) { L.roadT = world.G27.S.t < 15 ? 0.7 : 3; collectRoads(world); }   // בהתחלה בתדירות גבוהה: הרמזורים של האריחים נבנים אחרי האתחול
      // רכב שיוצא מהספירה (שבת/צפיפות): נעלם רק מחוץ לטווח הראייה
      let show = nc; for (let i = L.carMesh.count - 1; i >= nc; i--) { const c = L.cars[i]; if (c.r && c.px != null && seen(world, c.px, c.pz)) { show = i + 1; break; } }
      L.carMesh.count = Math.max(nc, Math.min(show, L.carMesh.count)); L.pedMesh.count = np;
      const n = L.carMesh.count;
      // רשת הולכי רגל בחוץ (10 מ') — לעצירה לפני הולך רגל שחוצה
      if (((L.fr = (L.fr || 0) + 1) & 3) === 1 || !L.pg) { const sim = window.G27NPC && window.G27NPC.sim; if (sim) { const pg = L.pg || (L.pg = new Map()); pg.clear();   // כל פריים רביעי (חוסך ~0.15 מ"ש)
        for (const q of sim.agents) { if (q.state !== 'walk') continue; if (Math.abs(q.x - P.x) > 260 || Math.abs(q.z - P.z) > 260) continue; const k = Math.floor(q.x / 10) * 7919 + Math.floor(q.z / 10); let a = pg.get(k); if (!a) pg.set(k, a = []); a.push(q); } } else L.pg = null; }
      const hp = L.heads.geometry.attributes.position, tp = L.tails.geometry.attributes.position;
      for (let i = 0; i < n; i++) { const c = L.cars[i]; if (!c.r) { spawnCar(world, c); if (!c.r) { c.px = null; M.makeScale(0, 0, 0); L.carMesh.setMatrixAt(i, M); continue; } }
        if (i >= nc && c.px != null && !seen(world, c.px, c.pz)) { c.r = null; c.px = null; M.makeScale(0, 0, 0); L.carMesh.setMatrixAt(i, M); continue; }
        const a0 = at(c.r, c.s), fx0 = a0.fx * c.dir, fz0 = a0.fz * c.dir, x0 = c.px != null ? c.px : a0.x, z0 = c.px != null ? c.pz : a0.z;
        // תאונה: רכב השחקן נכנס ברכב בתנועה מעל ~11 קמ"ש
        let lim;
        if (c.crash > 0) { c.crash -= dt; lim = { v: 0, why: 'crash' }; }
        else { lim = limit(world, c, i, n, a0, fx0, fz0, x0, z0);
          if (world.player.mode === 'car' && c.px != null) { const SC = world.G27.S.car; if (Math.hypot(SC.x - c.px, SC.z - c.pz) < 2.6 && Math.abs(SC.v) > 3) {
            c.crash = 10; c.yaw = (Math.random() - 0.5) * 0.9; const kmh = Math.round(Math.abs(SC.v) * 3.6); SC.v *= -0.25; c.v = 0;
            if (navigator.vibrate) navigator.vibrate([60, 40, 120]); try { YZW.notice('💥 תאונה! פגעת ברכב ב-' + kmh + ' קמ"ש', { kind: 'warn' }); } catch (e) { /* */ } } } }
        // מהירות: תאוצה/בלימה מוגבלות (בלי עצירה מיידית)
        c.why = lim.why; const vt = lim.v; c.v = vt > c.v ? Math.min(vt, c.v + ACC * dt) : Math.max(vt, c.v - (vt < c.v - 3 ? HARD : DEC) * dt);
        // בתור (ברמזור, או מאחורי רכב שבתור) = המתנה רגילה, לא "תקוע"
        c.q = lim.why === 'red' || lim.why === 'ped' || (lim.why === 'car' && lim.by && lim.by.q) ? 1 : 0;
        if (c.v < 0.3 && !c.q && lim.why !== 'player' && lim.why !== 'crash') c.stopT += dt; else if (c.v > 1 || c.q) c.stopT = 0;
        if (lim.why === 'red' && c.v < 0.5 && !c._red) { c._red = 1; L.stats.redStops++; } if (lim.why !== 'red') c._red = 0;
        // תקוע 25 ש' (לא ברמזור): רחוק מהעין → הופעה מחדש; קרוב → "רוח" ל-2.5 ש' (מתעלם מהרכב החוסם)
        if (c.stopT > 25) { c.stopT = 0; L.stats.unstuck++; if (!seen(world, x0, z0)) { c.r = null; c.px = null; continue; } c.ghost = 2.5; }
        if (c.ghost > 0) c.ghost -= dt;
        if (c.goP && ((x0 - c.goP.x) * c.goP.dx + (z0 - c.goP.z) * c.goP.dz < -4 || Math.hypot(x0 - c.goP.x, z0 - c.goP.z) > 50)) c.goP = null;
        c.s += c.dir * c.v * dt;
        if (c.s < 0 || c.s > c.r.len) { if (!nextRoad(world, c)) { if (!seen(world, x0, z0)) { c.r = null; c.px = null; continue; } c.s = Math.max(0, Math.min(c.r.len, c.s)); c.v = 0; } }
        if (Math.hypot(x0 - P.x, z0 - P.z) > 800 && !seen(world, x0, z0)) { c.r = null; c.px = null; continue; }   // רחוק מדי: מוחזר לבריכה
        const a = at(c.r, c.s), fx = a.fx * c.dir, fz = a.fz * c.dir;
        let x = a.x - fz * c.lane, z = a.z + fx * c.lane;
        // החלקה: קפיצה קטנה (פינה במקטע, החלפת כביש, פרסה) נבלעת בתיקון שדועך ב-~0.4 ש'
        if (c.rx != null) { const jx = c.rx - x, jz = c.rz - z, jd = Math.hypot(jx, jz); if (jd > c.v * dt + 0.25 && jd < 7) { c.cx += jx + fx * c.v * dt; c.cz += jz + fz * c.v * dt; } }
        c.rx = x; c.rz = z;
        { const cl = Math.hypot(c.cx, c.cz); if (cl > 0) { const nl = Math.max(0, Math.min(cl * Math.exp(-dt * 4), cl - 0.4 * dt) , cl - 3.5 * dt); const k = nl / cl; c.cx *= k; c.cz *= k; } }   // דעיכה, לכל היותר 3.5 מ"ש (בלי "החלקה" מהירה)
        x += c.cx; z += c.cz; const y = Math.max(0, H(x, z));
        // כיוון גוף: נע לכיוון התנועה בהדרגה
        const want = Math.atan2(fx, fz); c.hd = c.hd == null || c.px == null ? want : c.hd + angD(c.hd, want) * Math.min(1, dt * 7);
        c.hx = Math.sin(c.hd); c.hz = Math.cos(c.hd);
        c.px = x; c.pz = z; if (!(c.crash > 0)) c.yaw = 0;
        Q.setFromAxisAngle(UP, c.hd + (c.yaw || 0)); V.set(x, y, z); M.compose(V, Q, S1); L.carMesh.setMatrixAt(i, M);
        const hx = c.hx, hz = c.hz;
        if (L.night > 0.05) { hp.setXYZ(i * 2, x + hx * 2.2 + hz * 0.6, y + 0.65, z + hz * 2.2 - hx * 0.6); hp.setXYZ(i * 2 + 1, x + hx * 2.2 - hz * 0.6, y + 0.65, z + hz * 2.2 + hx * 0.6);
          tp.setXYZ(i * 2, x - hx * 2.2 + hz * 0.6, y + 0.7, z - hz * 2.2 - hx * 0.6); tp.setXYZ(i * 2 + 1, x - hx * 2.2 - hz * 0.6, y + 0.7, z - hz * 2.2 + hx * 0.6); } }
      for (let i = n; i < L.cars.length; i++) { const c = L.cars[i]; if (c.px != null) { c.px = null; c.r = null; } }
      L.carMesh.instanceMatrix.needsUpdate = true;
      L.heads.visible = L.tails.visible = L.night > 0.05; if (L.heads.visible) { L.heads.geometry.setDrawRange(0, n * 2); L.tails.geometry.setDrawRange(0, n * 2); hp.needsUpdate = tp.needsUpdate = true; L.heads.material.opacity = L.tails.material.opacity = L.night; }
      const t = world.clock.t;
      for (let i = 0; i < np; i++) { const q = L.peds[i]; if (!q.r) { spawnPed(world, q); if (!q.r) { M.makeScale(0, 0, 0); L.pedMesh.setMatrixAt(i, M); continue; } }
        q.s += q.dir * q.v * dt; const a = at(q.r, q.s);
        if (q.s < 0 || q.s > q.r.len || Math.hypot(a.x - P.x, a.z - P.z) > 450) { spawnPed(world, q); continue; }
        const off = (q.r.w / 2 + 1.8) * q.side; let x = a.x - a.fz * off, z = a.z + a.fx * off;
        const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz); if (d < 1.2 && d > 0.01) { x = P.x + dx / d * 1.2; z = P.z + dz / d * 1.2; }   // זזים הצידה מהשחקן
        const y = Math.max(0, world.data.floorAt ? Math.min(H(x, z) + 0.3, world.data.floorAt(x, z, H(x, z) + 1)) : H(x, z)) + Math.abs(Math.sin(t * 7 + q.ph)) * 0.05;
        Q.setFromAxisAngle(UP, Math.atan2(a.fx * q.dir, a.fz * q.dir)); V.set(x, y, z); M.compose(V, Q, S1); L.pedMesh.setMatrixAt(i, M); }
      L.pedMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { L.cars = []; L.peds = []; L.roads = []; L.net = []; L.poles = null; },
    hudPanels: [{ id: 'life', render(el, world) { if (world.player.mode === 'dev') return; } }],
    settings: [],
  });
})();
