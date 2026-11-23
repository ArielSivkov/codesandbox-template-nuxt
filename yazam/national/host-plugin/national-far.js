/* תוסף "טבעות מרחק" לעולם המאוחד (swarm/integration/host/host.js) – גדוד הכיסוי הארצי.
 * בקשת אריאל (03:45): לראות עד האופק, רחוק = פשוט יותר; בלי קצה חד במקום שהאריחים נגמרים; ים עד האופק; ≥40 פר"ש במבט-על.
 *
 * טבעות (מרחק מהשחקן/מוקד המצלמה):
 *   קרוב   ≤ R (1.15 ק"מ ברחוב, 0.85 במבט-על)  – אריחי המשחק כמות שהם (בניינים מלאים; LOD של המשחק עצמו ב-hiRadius)
 *   ביניים R–8 ק"מ   – "גושי עיר": תא 100 מ' = קופסה אחת בגובה הממוצע המשוקלל (5 פאות), צבע אפוי, רשת אחת לכל הטבעת
 *   רחוק   8–30 ק"מ  – אותם גושים כגג בלבד (2 משולשים) – שדה-גובה שטוח
 *   אופק   30–100 ק"מ – קרקע אחת: טבעת קוטבית (צפופה ליד, דלילה רחוק) עם מרקם צפיפות בנייה/יבשה/ים 100 מ' ואורות לילה
 *   מעבר ל-100 ק"מ   – ערפל האווירה (scene.fog של מחלקת האווירה/השיידרים – לא אנחנו קובעים את הצבע)
 * רציפות: גובה הטבעת ליד אריחי המשחק נדגם מ-W.H בתוך המעגל הטעון ודועך ל-1 מ' על פני 2 ק"מ – אין "צוק" בקצה האריחים.
 *   גושים מוסתרים בכל אריח משחק שיש בו בניינים (אין כפילות), ומופיעים בכל מקום אחר – גם בתוך אשדוד מחוץ לדגימה.
 * תקציב: +2 קריאות ציור. משולשים: טבעת ~15 אלף, גושים ~2–9 אלף (רחוב) / ~20–60 אלף (מבט-על) – נמדד בבדיקה.
 * מבט-על (מצלמה > 150 מ' מעל הקרקע): W.radius 1150→850, W.hiRadius 650→380 – פחות אריחים מלאים, הטבעת ממלאת. ניתן לכיבוי.
 * קואורדינטות: הנתונים הארציים ב-ITM אמיתי; המשחק במסגרת הדגימה = אמיתי − (1524.6, 753.6). world.coords.trueItmOffset גובר. */
(function () {
  'use strict';
  if (!window.YZW) { console.warn('[national-far] אין מארח YZW'); return; }
  const DATA = window.YZ_NATIONAL_DATA || (document.currentScript && document.currentScript.dataset.data) || 'national/data/';
  const Z = { on: false, ov: null, blocks: null, ring: null, img: null, ringAt: null, blkAt: null, blkT: 0, dirty: true, aerial: false, saveR: null, opt: { aerialSave: true } };
  const off = w => (w.coords && w.coords.trueItmOffset) || { dE: 1524.6, dN: 753.6 };
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  async function bin(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); const b = await r.arrayBuffer(), u = new Uint8Array(b, 0, 2);
    return (u[0] === 0x1f && u[1] === 0x8b) ? new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : b; }

  // ITM אמיתי ↔ סצנת המשחק
  function sceneOf(world, E, N) { const o = off(world); return world.coords.toScene(E - o.dE, N - o.dN); }
  function trueOf(world, x, z) { const o = off(world), t = world.coords.toITM(x, z); return { E: t.E + o.dE, N: t.N + o.dN }; }

  // גובה קרקע רציף: בתוך מעגל הטעינה – W.H של המשחק; מחוצה לו – דעיכה מגובה הקצה ל-1 מ' (יבשה) על פני 2 ק"מ
  function groundY(world, cx, cz, x, z, R, land) {
    if (!land) return -0.35;                                   // מתחת לים של המשחק (−0.05) – בתוך 8 ק"מ הים שלו מכסה, מעבר לזה שלנו
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz), k = Math.min(1, (R - 60) / Math.max(d, 1));
    let h = world.data.H(cx + dx * k, cz + dz * k); if (!(h > 0.6)) h = 1.0;
    return (h + (1.0 - h) * smooth(R, R + 2000, d)) - 0.8;     // 0.8 מ' מתחת לקרקע המשחק – המשחק מנצח בחפיפה
  }

  function buildTextures(world) {
    const S = 2048, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(Z.img, 0, 0, S, S); const id = c.getImageData(0, 0, S, S), d = id.data, lt = new Uint8Array(S * S * 4), lm = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) lm[i] = d[i * 4 + 2] > 127 ? 1 : 0;      // מסכת יבשה (קו חוף OSM) לפני הצביעה
    const sand = [0.80, 0.73, 0.57], dune = [0.88, 0.81, 0.64], built = [0.74, 0.71, 0.66], sea = [0.10, 0.30, 0.40];
    for (let i = 0; i < S * S; i++) {
      const r = d[i * 4] / 255, land = d[i * 4 + 2] > 127, n = ((i * 2654435761) >>> 24) / 255, n2 = (((i >> 6) * 2246822519) >>> 26) / 63;
      let col = land ? sand.map((v, k) => v + (dune[k] - v) * n2 * 0.6) : sea;
      if (land) col = col.map((v, k) => (v + (built[k] - v) * Math.min(1, r * 1.4)) * (0.95 + 0.05 * n));
      d[i * 4] = col[0] * 255; d[i * 4 + 1] = col[1] * 255; d[i * 4 + 2] = col[2] * 255; d[i * 4 + 3] = 255;
      const g = land ? Math.round(Math.pow(r, 1.3) * 255) : 0; lt[i * 4] = g; lt[i * 4 + 1] = g; lt[i * 4 + 2] = g; lt[i * 4 + 3] = 255;
    }
    c.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const lit = new THREE.DataTexture(lt, S, S); lit.flipY = true; lit.generateMipmaps = true; lit.minFilter = THREE.LinearMipmapLinearFilter; lit.magFilter = THREE.LinearFilter; lit.needsUpdate = true;
    Z.landAt = (E, N) => { const W0 = Z.ov.size * Z.ov.cell_m, u = (E - Z.ov.origin_itm_nw[0]) / W0, v = (Z.ov.origin_itm_nw[1] - N) / W0;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) return true; const px = Math.floor(u * S), py = Math.floor(v * S); return lm[py * S + px] === 1; };
    return { tex, lit };
  }

  // טבעת קרקע קוטבית: 56 טבעות גאומטריות 250 מ' → 100 ק"מ, 112 מגזרים
  function buildRing(world, cx, cz, R) {
    const NR = 56, NS = 112, r0 = 250, r1 = 100000, pos = new Float32Array(NR * NS * 3), uv = new Float32Array(NR * NS * 2), idx = [];
    const W0 = Z.ov.size * Z.ov.cell_m, o = Z.ov.origin_itm_nw;
    for (let i = 0; i < NR; i++) { const r = r0 * Math.pow(r1 / r0, i / (NR - 1));
      for (let j = 0; j < NS; j++) { const a = j / NS * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, t = trueOf(world, x, z), k = i * NS + j;
        const land = Z.landAt(t.E, t.N); pos[k * 3] = x; pos[k * 3 + 1] = groundY(world, cx, cz, x, z, R, land); pos[k * 3 + 2] = z;
        uv[k * 2] = (t.E - o[0]) / W0; uv[k * 2 + 1] = 1 - (o[1] - t.N) / W0; } }
    for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NS; j++) { const a = i * NS + j, b = i * NS + (j + 1) % NS, c = a + NS, d = b + NS; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }

  // גושים: מסתירים תא שנמצא באריח משחק טעון עם בניינים
  function loadedGameTiles(world) { const s = new Set(); for (const [k, t] of world.data.tiles) if (t && t.blds && t.blds.length && t.grp && t.grp.parent) s.add(k); return s; }
  function buildBlocks(world, cx, cz) {
    const dv = Z.blk, n = dv.byteLength / 6, cell = Z.ov.cell_m, o = Z.ov.origin_itm_nw, R = world.G27.W.radius, hide = loadedGameTiles(world), dd = off(world);
    const sel = [];
    for (let i = 0; i < n; i++) { const c = dv.getInt16(i * 6, true), r = dv.getInt16(i * 6 + 2, true), E = o[0] + (c + 0.5) * cell, N = o[1] - (r + 0.5) * cell, p = sceneOf(world, E, N), d = Math.hypot(p.x - cx, p.z - cz);
      if (d > 30000) continue; const gk = Math.floor((E - dd.dE) / 1000) + '_' + Math.floor((N - dd.dN) / 1000); if (hide.has(gk)) continue; sel.push([i, p.x, p.z, d]); }
    let nv = 0; for (const s of sel) nv += s[3] < 8000 ? 20 : 4;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), glow = new Float32Array(nv), idx = new Uint32Array(nv / 4 * 6);
    const pal = [[0.86, 0.80, 0.68], [0.78, 0.76, 0.70], [0.84, 0.76, 0.62], [0.70, 0.68, 0.63]];
    let v = 0, k = 0;
    for (const [i, x, z, d] of sel) {
      const c = dv.getInt16(i * 6, true), r = dv.getInt16(i * 6 + 2, true), h = Math.max(4, dv.getUint8(i * 6 + 4)), fr = dv.getUint8(i * 6 + 5) / 255;
      const j1 = ((c * 73856093 ^ r * 19349663) >>> 0) / 4294967296, s = cell * 0.5 * Math.min(0.9, Math.sqrt(fr) * (0.8 + 0.3 * j1)), cl = pal[(c * 31 + r * 17) & 3];
      const y0 = groundY(world, cx, cz, x, z, R, true) + 0.8, top = y0 + h * (0.8 + 0.4 * j1), gl = 0.25 + 0.75 * ((c * 2654435761 ^ r * 40503) >>> 0) / 4294967296;
      const faces = d < 8000 ? [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] : [[0, 1, 0]];
      for (const [nx, ny, nz] of faces) { let q;
        if (ny) q = [[-s, top, -s], [-s, top, s], [s, top, s], [s, top, -s]];
        else if (nx) q = [[nx * s, y0, -s * nx], [nx * s, y0, s * nx], [nx * s, top, s * nx], [nx * s, top, -s * nx]];
        else q = [[s * nz, y0, nz * s], [-s * nz, y0, nz * s], [-s * nz, top, nz * s], [s * nz, top, nz * s]];
        const b = v; for (const p of q) { pos.set([x + p[0], p[1], z + p[2]], v * 3); nor.set([nx, ny, nz], v * 3); col.set(cl, v * 3); glow[v] = ny ? 0.15 * gl : gl; v++; }
        idx.set([b, b + 1, b + 2, b, b + 2, b + 3], k); k += 6; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aglow', new THREE.BufferAttribute(glow, 1)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
    Z.stats.blocks = sel.length; Z.stats.blockTris = k / 3; Z.stats.hiddenTiles = hide.size;
    return g;
  }

  const U = { uNight: { value: 0 } };
  function nightMat(m, kind) {
    m.onBeforeCompile = sh => { sh.uniforms.uNight = U.uNight;
      if (kind === 'blocks') sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aglow; varying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aglow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;' + (kind === 'blocks' ? '\nvarying float vGlow;' : ''))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (kind === 'blocks'
          ? 'totalEmissiveRadiance += vec3(1.0, 0.66, 0.36) * vGlow * uNight * 0.55;'
          : 'totalEmissiveRadiance *= uNight;')); };
    m.customProgramCacheKey = () => 'yz-national-far-' + kind; return m;
  }

  YZW.register({
    id: 'national-far', name: 'טבעות מרחק עד האופק (כיסוי ארצי)', dept: 'national', order: 87, timeoutMs: 40000,
    settings: [{ id: 'aerialSave', label: 'חיסכון במבט-על (פחות אריחים מלאים)', type: 'toggle', get: () => Z.opt.aerialSave, set: v => { Z.opt.aerialSave = !!v; } }],
    async init(world, api) {
      const t0 = performance.now(); Z.stats = { };
      Z.ov = await (await fetch(DATA + 'nat/overview.json')).json();
      const [img, blk] = await Promise.all([new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('overview.png')); i.src = DATA + 'nat/overview.png'; }), bin(DATA + 'nat/blocks.bin')]);
      Z.img = img; Z.blk = new DataView(blk);
      const { tex, lit } = buildTextures(world);
      const grp = api.group();
      const gm = nightMat(new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffa75a, emissiveMap: lit, fog: true }), 'ground');
      Z.ring = new THREE.Mesh(new THREE.BufferGeometry(), gm); Z.ring.name = 'national-far-ring'; Z.ring.frustumCulled = false; Z.ring.renderOrder = -3; Z.ring.receiveShadow = false;
      Z.blocks = new THREE.Mesh(new THREE.BufferGeometry(), nightMat(new THREE.MeshLambertMaterial({ vertexColors: true, fog: true }), 'blocks')); Z.blocks.name = 'national-far-blocks'; Z.blocks.frustumCulled = false;
      grp.add(Z.ring, Z.blocks);
      api.on('tile', () => { Z.dirty = true; });
      Z.on = true; Z.stats.initMs = Math.round(performance.now() - t0); Z.t0 = t0;
      world.nationalFar = Z;
    },
    update(dt, world) {
      if (!Z.on) return;
      const W = world.G27.W, cam = world.camera, p = world.player.pos;
      // מבט-על: מוקד = הנקודה שמתחת למצלמה בכיוון המבט (קירוב: מיקום השחקן), גובה מצלמה מעל הקרקע
      const alt = cam.position.y - Math.max(0, world.data.H(cam.position.x, cam.position.z));
      const aerial = world.view && typeof world.view.aerial === 'boolean' ? world.view.aerial : (Z.aerial ? alt > 100 : alt > 150);   // מושל הביצועים (perfci) קובע אם קיים
      const governed = !!(world.refine || (world.stats && world.stats.gov));        // המושל מנהל את W.radius – לא נוגעים, רק מדווחים
      world.farRing = { from: W.radius, to: 100000, aerial, note: 'הטבעת ממלאת מעבר ל-W.radius – אפשר להקטין אותו במבט-על' };
      if (aerial !== Z.aerial) { Z.aerial = aerial;
        if (aerial && Z.opt.aerialSave && !governed) { Z.saveR = [W.radius, W.hiRadius]; W.radius = 850; W.hiRadius = 380; }
        else if (!aerial && Z.saveR) { [W.radius, W.hiRadius] = Z.saveR; Z.saveR = null; }
        Z.dirty = true; }
      const cx = p.x, cz = p.z, R = W.radius;
      if (!Z.ringAt || Math.hypot(cx - Z.ringAt[0], cz - Z.ringAt[1]) > 300 || Z.ringAt[2] !== R) {
        const g = buildRing(world, cx, cz, R); Z.ring.geometry.dispose(); Z.ring.geometry = g; Z.ringAt = [cx, cz, R]; }
      Z.blkT -= dt;
      if ((Z.dirty && Z.blkT <= 0) || !Z.blkAt || Math.hypot(cx - Z.blkAt[0], cz - Z.blkAt[1]) > 1500) {
        const g = buildBlocks(world, cx, cz); Z.blocks.geometry.dispose(); Z.blocks.geometry = g; Z.blkAt = [cx, cz]; Z.dirty = false; Z.blkT = 1.5;
        if (!Z.stats.firstFrameMs) Z.stats.firstFrameMs = Math.round(performance.now() - Z.t0); }
      // לילה: פנסים לפי גובה השמש (אותו מקור אמת של המארח); עוצמה יחסית לחשיפה של מחלקת האווירה אם פעילה
      const lightsOn = clamp((2 - (world.sun.elevation || 0)) / 8, 0, 1), atmo = world.providers.atmosphere, ex = atmo && atmo.exposure ? atmo.exposure : 1;
      U.uNight.value = lightsOn * 0.9 / Math.max(ex, 1e-3);
      Z.ring.material.emissiveIntensity = 1;
    },
    dispose(world) { const W = world.G27 && world.G27.W; if (W && Z.saveR) { [W.radius, W.hiRadius] = Z.saveR; Z.saveR = null; } Z.on = false; Z.ringAt = Z.blkAt = null; },
  });
})();
