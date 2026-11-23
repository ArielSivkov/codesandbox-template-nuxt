/* חיים ברחוב (גרסת גישור של מחלקת האינטגרציה) — תנועה קלה והולכי רגל על המדרכות, עד שמחלקות התחבורה
 * (swarm/transport) והדמויות (swarm/npc) ימסרו מודולים עם ממשק לעולם. עונה ל"אין אנשים, אין תנועה".
 * רכבים: InstancedMesh אחד (גוף+תא ממוזגים), נוסעים בצד ימין של מרכז הכביש לאורך קווי הכבישים של האריחים.
 * הולכי רגל: InstancedMesh אחד, הולכים על המדרכה (קצה הכביש + 1.8 מ׳), נדנוד הליכה.
 * אור לילה לרכבים: נקודות פנסים/אורות אחוריים (2 קריאות ציור). צפיפות לפי איכות + "אזור התצוגה" סביב הארז.
 * שבת: תנועה ×0.12, הולכי רגל בלבן/כהה (לפי world.shabbat).
 */
(function () {
  'use strict';
  const L = { cars: [], peds: [], carMesh: null, pedMesh: null, heads: null, tails: null, roads: [], roadT: 0, night: 0 };
  const TIER = { low: [22, 36], medium: [40, 70], high: [70, 120] };
  const PALETTE = [0xf2f2f2, 0x1d1d1f, 0x9aa1a8, 0xc8ccd0, 0x23408e, 0xb3262c, 0x6b6f75, 0xe9e4d4, 0x2d5a3d, 0x8a8f96];
  const CLOTH = [0x2f4b7c, 0xd9534f, 0xf0ad4e, 0x5cb85c, 0x6f42c1, 0x20c997, 0xe9ecef, 0x343a40, 0xfd7e14, 0x17a2b8];
  function box(w, h, d, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y, z || 0); return g.toNonIndexed(); }
  function merge(gs) { let n = 0; gs.forEach(g => n += g.attributes.position.count); const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    for (const g of gs) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return g; }
  function collectRoads(world) {
    const P = world.player.pos, R2 = 700 * 700, out = [];
    for (const t of world.data.tiles.values()) for (const r of t.roads || []) { const p = r.p; if (p.length < 4) continue;
      let near = false; for (let i = 0; i < p.length; i += 6) if ((p[i] - P.x) ** 2 + (p[i + 1] - P.z) ** 2 < R2) { near = true; break; } if (!near) continue;
      const seg = []; let len = 0; for (let i = 0; i < p.length / 2 - 1; i++) { const l = Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]); seg.push(l); len += l; }
      if (len > 25) out.push({ p, seg, len, w: r.w, c: r.c }); }
    L.roads = out;
  }
  function at(r, s) { // מיקום וכיוון לאורך הכביש במרחק s
    s = ((s % r.len) + r.len) % r.len; let i = 0; while (i < r.seg.length - 1 && s > r.seg[i]) { s -= r.seg[i]; i++; }
    const p = r.p, ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, l = r.seg[i] || 1, k = Math.min(1, s / l);
    return { x: ax + dx * k, z: az + dz * k, fx: dx / l, fz: dz / l };
  }
  function pickRoad(world, wantCars) {
    if (!L.roads.length) return null; const sc = world.showcase, P = world.player.pos;
    for (let k = 0; k < 14; k++) { const r = L.roads[Math.random() * L.roads.length | 0]; if (wantCars && r.c < 1) continue; const s = Math.random() * r.len, q = at(r, s);
      const d = Math.hypot(q.x - P.x, q.z - P.z); if (d < 12) continue;
      let pr = d < 160 ? 1 : d < 400 ? 0.3 : 0.08; if (sc && Math.hypot(q.x - sc.x, q.z - sc.z) < sc.r) pr = Math.min(1, pr * 1.8);   // אזור התצוגה סביב הארז
      if (Math.random() < pr) return { r, s }; }
    return null;
  }
  function spawnCar(world, c) { const p = pickRoad(world, true); if (!p) { c.r = null; return; } Object.assign(c, p, { dir: Math.random() < 0.5 ? 1 : -1, v: 7 + Math.random() * 7 + (p.r.c >= 3 ? 4 : 0), lane: p.r.w * 0.25 }); }
  function spawnPed(world, q) { const p = pickRoad(world, false); if (!p) { q.r = null; return; } Object.assign(q, p, { dir: Math.random() < 0.5 ? 1 : -1, v: 1.1 + Math.random() * 0.5, side: Math.random() < 0.5 ? 1 : -1, ph: Math.random() * 6 }); }
  function counts(world) { const t = TIER[world.quality.tier] || TIER.medium; const sh = world.shabbat.active;
    let carK = sh ? 0.12 : 1; if (world.providers.density) { try { carK = world.providers.density().cars; } catch (e) { /* */ } }
    return [Math.round(t[0] * Math.max(0.05, Math.min(1.5, carK))), world.providers.pedestrians === 'npc' ? 0 : t[1]]; }   // הדמויות של מחלקת ה-NPC מחליפות את הקופסאות
  function recolorPeds(world) { const sh = world.shabbat.active, c = new THREE.Color();
    for (let i = 0; i < L.pedMesh.count; i++) { c.setHex(sh ? (i % 3 === 0 ? 0x22252a : 0xf4f4f0) : CLOTH[i % CLOTH.length]); L.pedMesh.setColorAt(i, c); } if (L.pedMesh.instanceColor) L.pedMesh.instanceColor.needsUpdate = true; }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
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
      for (let i = 0; i < MAXC; i++) L.cars.push({}); for (let i = 0; i < MAXP; i++) L.peds.push({});
      window.YZTraffic = L; collectRoads(world); L.cars.forEach(c2 => spawnCar(world, c2)); L.peds.forEach(q => spawnPed(world, q)); recolorPeds(world);
      api.on('shabbat', () => recolorPeds(world)); api.on('env', () => { L.night = Math.max(0, Math.min(1, (2 - world.sun.elevation) / 8)); });
      L.night = Math.max(0, Math.min(1, (2 - world.sun.elevation) / 8));
    },
    update(dt, world) {
      const H = world.data.H, P = world.player.pos, [nc, np] = counts(world);
      L.roadT -= dt; if (L.roadT <= 0) { L.roadT = 3; collectRoads(world); }
      L.carMesh.count = nc; L.pedMesh.count = np;
      const hp = L.heads.geometry.attributes.position, tp = L.tails.geometry.attributes.position;
      for (let i = 0; i < nc; i++) { const c = L.cars[i]; if (!c.r) { spawnCar(world, c); if (!c.r) { M.makeScale(0, 0, 0); L.carMesh.setMatrixAt(i, M); continue; } }
        // עצירה לפני השחקן/רכב השחקן
        const a0 = at(c.r, c.s), dpx = P.x - a0.x, dpz = P.z - a0.z, ahead = (dpx * a0.fx + dpz * a0.fz) * c.dir, side = Math.abs(dpx * a0.fz - dpz * a0.fx);
        let stop = ahead > 0 && ahead < 9 && side < 3;
        // שמירת מרחק: רכב אחר לפניי (באותו נתיב/צומת) עד 8 מ' → עוצרים; עד 16 מ' → מאטים. כך רכבים לא עוברים זה דרך זה.
        let slow = 1;
        if (c.px != null) for (let j = 0; j < nc; j++) { if (j === i) continue; const o = L.cars[j]; if (o.px == null || !o.r) continue;
          const ex = o.px - c.px, ez = o.pz - c.pz; if (Math.abs(ex) > 17 || Math.abs(ez) > 17) continue;
          const fx0 = a0.fx * c.dir, fz0 = a0.fz * c.dir, ah = ex * fx0 + ez * fz0, sd = Math.abs(ex * fz0 - ez * fx0);
          if (ah > 0 && sd < 2.6) { if (ah < 8) { stop = true; break; } if (ah < 16) slow = Math.min(slow, (ah - 8) / 8); } }
        // תאונה: רכב השחקן נכנס ברכב בתנועה מעל ~11 קמ"ש
        if (c.crash > 0) { c.crash -= dt; stop = true; }
        else if (world.player.mode === 'car' && c.px != null) { const SC = world.G27.S.car; if (Math.hypot(SC.x - c.px, SC.z - c.pz) < 2.6 && Math.abs(SC.v) > 3) {
          c.crash = 10; c.yaw = (Math.random() - 0.5) * 0.9; const kmh = Math.round(Math.abs(SC.v) * 3.6); SC.v *= -0.25;
          if (navigator.vibrate) navigator.vibrate([60, 40, 120]); try { YZW.notice('💥 תאונה! פגעת ברכב ב-' + kmh + ' קמ"ש', { kind: 'warn' }); } catch (e) { /* */ } } }
        c.s += c.dir * (stop ? 0 : c.v * slow) * dt;
        if (c.s < 0 || c.s > c.r.len || Math.hypot(a0.x - P.x, a0.z - P.z) > 750) { spawnCar(world, c); c.px = null; c.crash = 0; continue; }
        const a = at(c.r, c.s), fx = a.fx * c.dir, fz = a.fz * c.dir, x = a.x - fz * c.lane, z = a.z + fx * c.lane, y = Math.max(0, H(x, z));
        c.px = x; c.pz = z; if (!(c.crash > 0)) c.yaw = 0;
        Q.setFromAxisAngle(UP, Math.atan2(fx, fz) + (c.yaw || 0)); V.set(x, y, z); M.compose(V, Q, S1); L.carMesh.setMatrixAt(i, M);
        if (L.night > 0.05) { hp.setXYZ(i * 2, x + fx * 2.2 + fz * 0.6, y + 0.65, z + fz * 2.2 - fx * 0.6); hp.setXYZ(i * 2 + 1, x + fx * 2.2 - fz * 0.6, y + 0.65, z + fz * 2.2 + fx * 0.6);
          tp.setXYZ(i * 2, x - fx * 2.2 + fz * 0.6, y + 0.7, z - fz * 2.2 - fx * 0.6); tp.setXYZ(i * 2 + 1, x - fx * 2.2 - fz * 0.6, y + 0.7, z - fz * 2.2 + fx * 0.6); } }
      L.carMesh.instanceMatrix.needsUpdate = true;
      L.heads.visible = L.tails.visible = L.night > 0.05; if (L.heads.visible) { L.heads.geometry.setDrawRange(0, nc * 2); L.tails.geometry.setDrawRange(0, nc * 2); hp.needsUpdate = tp.needsUpdate = true; L.heads.material.opacity = L.tails.material.opacity = L.night; }
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
    dispose() { L.cars = []; L.peds = []; L.roads = []; },
    hudPanels: [{ id: 'life', render(el, world) { if (world.player.mode === 'dev') return; } }],
    settings: [],
  });
})();
