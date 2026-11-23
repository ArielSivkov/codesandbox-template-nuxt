/* גינות וגדרות לווילות (גישור של מחלקת האינטגרציה עד פלאגין הבניינים/הווילות של מחלקת השיידרים):
 * לכל בניין שסווג "וילה" (W27.tyOf — נגזר מצורה: עד 2 קומות, טביעה < 450 מ"ר) — מדשאה סביב הבית וגדר חיה/קיר נמוך בגבול מגרש משוער
 * (מלבן הטביעה + 3.5 מ'), עם פתח שער לכיוון הכביש הקרוב. צד שנוגע בכביש או בבניין אחר מקוצר/מושמט.
 * הכול "נגזר" — אין נתוני מגרשים. ציור: 2 רשתות ממוזגות לכל העולם (גדר + מדשאה), נבנות מחדש כשהשחקן זז 150 מ' או נטענים אריחים.
 */
(function () {
  'use strict';
  const Z = { hedge: null, lawn: null, T: 0, lp: null, dirty: true };
  const R = { low: 260, medium: 400, high: 600 };
  function rect(b) { const p = b.p, n = b.n; let bi = 0, bl = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]); if (l > bl) { bl = l; bi = i; } }
    const j0 = (bi + 1) % n, ux = (p[j0 * 2] - p[bi * 2]) / bl, uz = (p[j0 * 2 + 1] - p[bi * 2 + 1]) / bl, vx = -uz, vz = ux;
    let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9; for (let i = 0; i < n; i++) { const u = p[i * 2] * ux + p[i * 2 + 1] * uz, w = p[i * 2] * vx + p[i * 2 + 1] * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
    return { ux, uz, vx, vz, u0, u1, w0, w1 }; }
  function build(world) {
    const W = world.data, Wt = W.W, P = world.player.pos, rad = R[world.quality.tier] || 400;
    const hp = [], hn = [], hc = [], lp = [], ln = [], lc = [];
    const box = (ax, az, bx, bz, y, h, t, col) => { // קיר/גדר חיה כתיבה דקה לאורך קטע
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.5) return; const nx = -dz / L * t / 2, nz = dx / L * t / 2;
      const q = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
      const face = (a, b2, y0, y1, nrm) => { hp.push(a[0], y0, a[1], b2[0], y0, b2[1], b2[0], y1, b2[1], a[0], y0, a[1], b2[0], y1, b2[1], a[0], y1, a[1]); for (let k = 0; k < 6; k++) { hn.push(...nrm); hc.push(...col); } };
      face(q[0], q[1], y, y + h, [nx / (t / 2), 0, nz / (t / 2)]); face(q[2], q[3], y, y + h, [-nx / (t / 2), 0, -nz / (t / 2)]);
      hp.push(q[0][0], y + h, q[0][1], q[1][0], y + h, q[1][1], q[2][0], y + h, q[2][1], q[0][0], y + h, q[0][1], q[2][0], y + h, q[2][1], q[3][0], y + h, q[3][1]); for (let k = 0; k < 6; k++) { hn.push(0, 1, 0); hc.push(...col); } };
    let n = 0;
    for (const t of W.tiles.values()) for (const b of t.blds || []) {
      if ((b.cx - P.x) ** 2 + (b.cz - P.z) ** 2 > rad * rad || (Wt.tyOf ? Wt.tyOf(b) : 'block') !== 'villa') continue;
      const r = rect(b), o = 3.5, y = Math.max(0, W.H(b.cx, b.cz));
      const C = (u, w) => [u * r.ux + w * r.vx, u * r.uz + w * r.vz];
      const c = [C(r.u0 - o, r.w0 - o), C(r.u1 + o, r.w0 - o), C(r.u1 + o, r.w1 + o), C(r.u0 - o, r.w1 + o)];
      // מדשאה: מלבן המגרש (מתחת לבית; הבית מסתיר את מרכזו)
      const g = (hashId(b.id) % 3), lcol = [[0.33, 0.47, 0.22], [0.38, 0.50, 0.25], [0.30, 0.43, 0.20]][g];
      lp.push(c[0][0], y + 0.06, c[0][1], c[2][0], y + 0.06, c[2][1], c[1][0], y + 0.06, c[1][1], c[0][0], y + 0.06, c[0][1], c[3][0], y + 0.06, c[3][1], c[2][0], y + 0.06, c[2][1]);
      for (let k = 0; k < 6; k++) { ln.push(0, 1, 0); lc.push(...lcol); }
      // גדר: 4 צלעות; צלע על כביש → הצלע הקרובה לכביש מקבלת שער (פתח 3 מ') ; צלע שחותכת בניין אחר → מושמטת
      const hedge = (hashId(b.id) >>> 3) % 2 === 0, col = hedge ? [0.18, 0.32, 0.14] : [0.92, 0.90, 0.85], h = hedge ? 1.3 : 1.1, th = hedge ? 0.7 : 0.22;
      for (let i = 0; i < 4; i++) { const a = c[i], e = c[(i + 1) % 4], mx = (a[0] + e[0]) / 2, mz = (a[1] + e[1]) / 2;
        if (W.onRoad(mx, mz)) continue; const other = W.buildingAt(mx, mz, 0.5); if (other && other !== b) continue;
        const toRoad = W.onRoad(mx + (mx - b.cx) * 0.4, mz + (mz - b.cz) * 0.4);
        if (toRoad) { const L = Math.hypot(e[0] - a[0], e[1] - a[1]), k1 = Math.max(0, 0.5 - 1.5 / L), k2 = Math.min(1, 0.5 + 1.5 / L);
          box(a[0], a[1], a[0] + (e[0] - a[0]) * k1, a[1] + (e[1] - a[1]) * k1, y, h, th, col); box(a[0] + (e[0] - a[0]) * k2, a[1] + (e[1] - a[1]) * k2, e[0], e[1], y, h, th, col); }
        else box(a[0], a[1], e[0], e[1], y, h, th, col); }
      n++;
    }
    const mk = (P2, N2, C2) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C2, 3)); g.computeBoundingSphere(); return g; };
    Z.hedge.geometry.dispose(); Z.hedge.geometry = mk(hp, hn, hc); Z.lawn.geometry.dispose(); Z.lawn.geometry = mk(lp, ln, lc);
    Z.lp = { x: P.x, z: P.z }; Z.count = n;
  }
  function hashId(s) { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  YZW.register({
    id: 'gardens', name: 'גינות וגדרות לווילות (נגזר)', dept: 'integration → buildings', order: 26,
    requires: w => !!w.data.W.tyOf,
    init(world, api) { if (YZW.plugins().some(p => p.id === 'buildings' && p.dept === 'plugins/buildings' && p.state !== 'error')) return 'off:הוחלף בתוסף הבניינים המלא (גינות, גדרות ושערים)'; const g = api.group();
      Z.hedge = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true })); Z.hedge.castShadow = true; Z.hedge.receiveShadow = true; g.add(Z.hedge);
      Z.lawn = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); Z.lawn.receiveShadow = true; g.add(Z.lawn);
      api.on('tile', () => { Z.dirty = true; }); api.on('quality', () => { Z.dirty = true; }); },
    update(dt, world) { Z.T -= dt; const P = world.player.pos; if (Z.T <= 0 && (Z.dirty || !Z.lp || Math.hypot(P.x - Z.lp.x, P.z - Z.lp.z) > 150)) { Z.T = 2; Z.dirty = false; build(world); } },
    dispose() { Z.lp = null; },
    hudPanels: [{ id: 'gd', render(el, world) { if (world.player.mode === 'dev' && Z.count) el.textContent = `🏡 ${Z.count} וילות עם גינה וגדר — נגזר מצורה (אין נתוני מגרשים)`; } }],
  });
})();
