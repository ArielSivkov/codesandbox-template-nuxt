/* אווירה (גרסת גישור של מחלקת האינטגרציה) — עד שמחלקת האווירה (swarm/atmosphere) תמסור מודול.
 * עונה למשוב של אריאל "אין צבע, אין יום/לילה, אין אורות, אין זיהום אוויר":
 *  · דירוג צבע לפי השמש: שעת זהב חמה, צהריים נייטרלי, לילה כחול-כהה (חשיפה, צבע שמש/שמיים/קרקע)
 *  · לילה: חלונות דולקים (מסכת חלונות מתוך טקסטורת החזית של המשחק), פנסי רחוב עם כתמי אור חמים על האספלט
 *    (לפי תמונת השטח של אריאל מהארז: אור נתרן חם, שמיים כחולים-כהים עם עננים מוארים), כוכבים
 *  · זיהום אוויר: AQI → אובך חום-אפרפר וקיצור טווח ראייה
 * הכול נגזר ממקור האמת האחד (world.sun / world.weather). 3 קריאות ציור בלילה, 0 ביום.
 */
(function () {
  'use strict';
  // פרמטרי לילה – מכוילים מול תמונות השטח של אריאל (סבבי שימור-שיפור, rounds/*.json)
  const NIGHT = window.YZNight = Object.assign({ amb: 0.95, sky: 0x8c8678, gnd: 0x6e5c48, ev: 0.25, pool: 26, poolOp: 0.85, win: 0.9, lamp: 4.5, lampY: 8, ground: 0x3a3022 }, window.YZNight || {});
  const A = { night: 0, golden: 0, lamps: null, pools: null, stars: null, lampT: 0, mask: null, wallE: null, cnt: 0 };
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const C = (h) => new THREE.Color(h);
  function glowTex(inner, outer) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, inner); g.addColorStop(0.35, outer); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function windowMask(map) {
    const img = map && map.image; if (!img || !img.width) return null;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data, w = c.width, h = c.height;
    const cellOn = [0.9, 0, 0.35, 0],   // 01:00 בלילה: מעט חלונות דולקים (תמונות השטח)
      _u = 0, warm = [[255, 214, 150], [255, 236, 200], [255, 190, 120], [200, 220, 255]];
    for (let i = 0; i < w * h; i++) { const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2]; const win = b > r + 18 && b > 40;
      const cx = (i % w) * 2 / w | 0, cy = (i / w | 0) * 2 / h | 0, k = cy * 2 + cx, on = cellOn[k] * (win ? 1 : 0);
      p[i * 4] = warm[k][0] * on; p[i * 4 + 1] = warm[k][1] * on; p[i * 4 + 2] = warm[k][2] * on; p[i * 4 + 3] = 255; }
    x.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = map.wrapS; t.wrapT = map.wrapT; t.repeat.copy(map.repeat); t.offset.copy(map.offset); return t;
  }
  function lampPositions(world, max) {
    const P = world.player.pos, cand = [], R2 = 520 * 520;
    if (world.providers.lamps && world.providers.lamps.length) {   // פנסים אמיתיים-בסגנון מהריהוט הנגזר (procgen)
      const L = world.providers.lamps.map(l => [(l.x - P.x) ** 2 + (l.z - P.z) ** 2, l.x, l.z]).filter(a => a[0] < R2).sort((a, b) => a[0] - b[0]);
      const out = []; for (let i = 0; i < Math.min(max, L.length); i++) out.push(L[i][1], L[i][2]); return out; }
    for (const t of world.data.tiles.values()) for (const r of t.roads || []) {
      const p = r.p, off = r.w / 2 + 1.2; let acc = 0, side = 1;
      for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, L = Math.hypot(dx, dz) || 1;
        for (let s = (28 - acc); s < L; s += 28) { const x = ax + dx * s / L, z = az + dz * s / L, d2 = (x - P.x) ** 2 + (z - P.z) ** 2; side = -side; if (d2 > R2) continue;
          cand.push([d2, x - dz / L * side * off, z + dx / L * side * off]); }
        acc = (acc + L) % 28; } }
    cand.sort((a, b) => a[0] - b[0]); const out = []; for (let i = 0; i < Math.min(max, cand.length); i++) out.push(cand[i][1], cand[i][2]); return out;
  }
  function rebuildLamps(world) {
    const max = { low: 220, medium: 420, high: 700 }[world.quality.tier] || 300;
    const pos = lampPositions(world, max), n = pos.length / 2, H = world.data.H;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    A.pools.count = n; const lp = A.lamps.geometry.attributes.position;
    for (let i = 0; i < n; i++) { const x = pos[i * 2], z = pos[i * 2 + 1], g = Math.max(0, H(x, z)); v.set(x, g + 0.4, z); m.compose(v, q, s); A.pools.setMatrixAt(i, m); lp.setXYZ(i, x, g + NIGHT.lampY, z); }
    A.pools.instanceMatrix.needsUpdate = true; lp.needsUpdate = true; A.lamps.geometry.setDrawRange(0, n); A.lamps.geometry.computeBoundingSphere(); A.pools.computeBoundingSphere(); A.cnt = n;
  }
  function grade(world) {
    const el = world.sun.elevation, G = world.G27, r = world.renderer;
    A.night = clamp((2 - el) / 8, 0, 1); A.golden = clamp(1 - Math.abs(el - 6) / 9, 0, 1) * (1 - world.weather.cloud * 0.8);
    r.toneMappingExposure = 1.05 + A.golden * 0.18 + A.night * NIGHT.ev;   // מצב לילה של טלפון: חשיפה ארוכה
    if (world.sunLight) { if (A.golden > 0.05) world.sunLight.color.lerp(C(0xff9a48), A.golden * 0.85); world.sunLight.intensity *= 1 + A.golden * 0.45; }
    if (world.hemi) { world.hemi.color.set(0xdcecff).lerp(C(0xffc08a), A.golden * 0.65).lerp(C(0x3a4c7a), A.night); world.hemi.groundColor.set(0xa08f70).lerp(C(0x6a4a3a), A.golden * 0.4).lerp(C(0x2a2018), A.night);
      world.hemi.intensity = Math.max(world.hemi.intensity, NIGHT.amb * A.night + 0.18);   // אור עירוני מוחזר בלילה (לפי תמונות השטח: קירות טיח מוארים)
      if (A.night > 0.3) { world.hemi.color.lerp(C(NIGHT.sky), A.night * 0.8); world.hemi.groundColor.lerp(C(NIGHT.gnd), A.night * 0.8); } }
    // זיהום אוויר → אובך: גוון חום-אפור + הגבלת טווח
    const aqi = world.weather.aqi || 0, hz = clamp((aqi - 25) / 200, 0, 0.8); A.haze = hz;
    if (world.scene.fog && hz > 0) { const hc = A.night > 0.5 ? C(0x3a3640) : C(0xb8a58c); world.scene.fog.color.lerp(hc, hz * 0.6); world.scene.background && world.scene.background.lerp && world.scene.background.lerp(hc, hz * 0.4);
      const u = world.sky && world.sky.material.uniforms; if (u && u.hor) u.hor.value.lerp(hc, hz * 0.5); }
    // חלונות דולקים
    const MAT = world.data.MAT; if (MAT && MAT.wall) { if (!A.mask) { A.mask = windowMask(MAT.wall.map); }
      if (A.mask) { if (A.night > 0.05) { MAT.wall.emissiveMap = A.mask; MAT.wall.emissive.set(0xffffff); MAT.wall.emissiveIntensity = A.night * NIGHT.win; } else { MAT.wall.emissiveMap = null; MAT.wall.emissive.set(0x000000); }
        MAT.wall.needsUpdate = true; } }
    // קרקע מוארת בלילה (אספלט ומדרכות בהירים בתמונות — פנסים צפופים); לא אור אמיתי, הארה עצמית חלשה
    for (const k of ['road', 'walk', 'terrain']) { const m = MAT && MAT[k]; if (!m || !m.emissive) continue; m.emissive.setHex(NIGHT.ground).multiplyScalar(A.night * (k === 'terrain' ? 0.6 : 1)); }
    const vis = A.night > 0.05; A.lamps.visible = A.pools.visible = vis; A.stars.visible = !world.providers.starsReal && A.night > 0.5 && world.weather.cloud < 0.8;   // מחלקת השמיים מציירת כוכבים אמיתיים
    A.pools.material.opacity = NIGHT.poolOp * A.night; A.lamps.material.opacity = A.night; A.stars.material.opacity = (1 - world.weather.cloud) * A.night * (1 - hz);
    if (vis && !A.cnt) rebuildLamps(world);
  }
  window.YZAtmoLite = A;
  YZW.register({
    id: 'atmo-lite', name: 'אווירה: יום/לילה, אורות עיר, אובך (גישור)', dept: 'integration → atmosphere', order: 30,
    init(world, api) {
      const g = api.group(); const MAX = 700;
      const pg = new THREE.PlaneGeometry(NIGHT.pool, NIGHT.pool);
      A.pools = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.4, 1.0), map: glowTex('rgba(255,214,150,1)', 'rgba(255,186,110,0.5)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }), MAX);
      A.pools.count = 0; A.pools.frustumCulled = false; A.pools.renderOrder = 1; g.add(A.pools);
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3)); lg.setDrawRange(0, 0);
      A.lamps = new THREE.Points(lg, new THREE.PointsMaterial({ size: NIGHT.lamp, map: glowTex('rgba(255,245,220,1)', 'rgba(255,190,110,0.6)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true }));
      A.lamps.frustumCulled = false; g.add(A.lamps);
      const sp = new Float32Array(900 * 3); for (let i = 0; i < 900; i++) { const u = Math.random(), v = Math.random() * 0.9 + 0.1, th = u * Math.PI * 2, y = v, r = Math.sqrt(1 - y * y); sp[i * 3] = Math.cos(th) * r * 1800; sp[i * 3 + 1] = y * 1800; sp[i * 3 + 2] = Math.sin(th) * r * 1800; }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      A.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false })); A.stars.frustumCulled = false; A.stars.renderOrder = -1; g.add(A.stars);
      api.on('env', () => grade(world)); api.on('quality', () => { A.cnt = 0; }); api.on('tile', () => { A.lampDirty = true; }); api.on('lamps', () => { A.lampDirty = true; A.lampT = 0; });
      grade(world);
    },
    update(dt, world) {
      A.stars.position.copy(world.camera.position);
      if (A.night > 0.05) { A.lampT -= dt; const P = world.player.pos; const moved = !A.lp || Math.hypot(P.x - A.lp.x, P.z - A.lp.z) > 150;
        if (A.lampT <= 0 && (moved || A.lampDirty)) { A.lampT = 2; A.lampDirty = false; A.lp = { x: P.x, z: P.z }; rebuildLamps(world); } }
      if (A.haze > 0 && world.scene.fog && world.player.mode !== 'dev') { const f = world.scene.fog; // תקרה (אידמפוטנטית – לא מצטברת מול הריכוך של המשחק)
        const cap = Math.min(3000, 1150 + Math.max(0, world.camera.position.y - 30) * 7) / (1 + A.haze * 1.6); if (f.far > cap) { f.far = cap; f.near = cap * 0.2; } }
    },
    dispose(world) { const MAT = world.data.MAT; if (MAT && MAT.wall) { MAT.wall.emissiveMap = null; MAT.wall.emissive.set(0); MAT.wall.needsUpdate = true; } if (A.mask) A.mask.dispose(); A.mask = null; world.renderer.toneMappingExposure = 1.05; A.cnt = 0; },
    hudPanels: [{ id: 'aqi', render(el, world) { const a = world.weather.aqi; if (a > 100) el.textContent = `😷 איכות אוויר ${Math.round(a)} — אובך`; } }],
  });
})();
