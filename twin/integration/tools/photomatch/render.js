// render: מצלם את העולם מאותה נקודה, כיוון ושעה של כל צילום אמיתי (משימה אחת = מיקום אחד).
// node render.js --jobs <jobs.json> [--out DIR] [--sizes 360x800,1080x1920] [--only 096,095] [--shard k/N] [--cam game|photo] [--tier medium] [--keep-transient]
//
// מצלמה (ברירת מחדל --cam game): בדיוק מה שהשחקן רואה – מצב 'walk' + גוף ראשון של adapters/35-camera.js
//   (עיניים 1.6 מ' מעל הקרקע, 68° אנכי בפורטרט / 56° בנוף). שדה הראייה של המשחק קבוע, ולכן ההשוואה נעשית
//   על החלון הזוויתי המשותף לתמונה ולרינדור (compare.py חותך את שניהם לפי fov שנרשם כאן).
//   --cam photo: מצלמת בדיקה עם שדה הראייה של הטלפון (תוסף בדיקה שנרשם מבחוץ, כמו tools/photo_day.js) – לא נוגע בקוד המשחק.
// כיוון: אזימוט אמיתי (צפון גאוגרפי) → רשת ישראל: grid = true − γ (γ≈−0.29° באשדוד) → yaw = π − grid (x=מזרח, z=דרום).
// גובה עיניים: 35-camera קובע 1.6 מ' מעל S.p.y (placeAt מניח את השחקן על הקרקע/רצפה). pitch: S.cam.pitch = 0.3 − pitch/1.3 (המיפוי של 35-camera).
const fs = require('fs'), path = require('path');
const { openWorld, settle, frames, SAMPLE_OFFSET } = require('./lib/world_page');

function args() {
  const a = process.argv.slice(2), o = { sizes: '360x800,1080x1920', cam: 'game', tier: 'medium', out: '/home/claude/swarm/photomatch-out' };
  for (let i = 0; i < a.length; i++) { const k = a[i].replace(/^--/, ''); if (k === 'keep-transient') o.keepTransient = true; else o[k] = a[++i]; }
  return o;
}
const GAMMA_ASHDOD = -0.294;   // התכנסות רשת ITM מול צפון אמיתי (sky.js itmConvergenceDeg, 31.81°N 34.65°E)

async function renderJob(page, job, o) {
  const P = job.pose, gridAz = P.heading_true_deg - (job.grid_convergence_deg != null ? job.grid_convergence_deg : GAMMA_ASHDOD);
  const sample = { E: P.itm_real.E - SAMPLE_OFFSET.dE, N: P.itm_real.N - SAMPLE_OFFSET.dN };
  const [hh, mm] = job.time_il.split(':').map(Number);
  const r = await page.evaluate(({ sample, gridAz, P, job, hh, mm, cam }) => {
    const W = YZW.world, G = W.G27, S = G.S, D2R = Math.PI / 180;
    YZW.setWeather(Object.assign({ mode: 'manual', rain: 0, windSpeed: 3, gust: 1.2, aqi: 45 }, job.weather || {}));
    YZW.setTime({ ymd: job.date }); YZW.setTime({ min: hh * 60 + mm, rate: 0 });
    const yaw = Math.PI - gridAz * D2R;
    if (cam === 'game') {
      YZW.setMode('walk', true); if (window.YZCam) YZCam.view = 0;
      YZW.placeAt(sample.E, sample.N, yaw);
      S.cam.pitch = 0.3 - (P.pitch_deg * D2R) / 1.3;   // 35-camera: pitch = −(S.cam.pitch − 0.3)·1.3
    } else {
      const s = W.data.W.toScene(sample.E, sample.N), y = Math.max(0, W.data.H(s.x, s.z)) + P.cam_height_m;
      YZW.placeAt(sample.E, sample.N, yaw);
      window.__pmPose = { x: s.x, y, z: s.z, eh: P.cam_height_m, h: Math.PI - yaw, yaw, p: P.pitch_deg * D2R, fovV: job.render_fov_v_deg };
      YZW.setMode('pm-photo', true);
    }
    // הרכב של השחקן חונה ליד נקודת ההצבה (host.placeAt) – מזיזים אותו 80 מ' מאחורי המצלמה כדי שלא ייכנס לתמונה
    const fx = Math.sin(yaw), fz = Math.cos(yaw); Object.assign(S.car, { x: S.p.x - fx * 80, z: S.p.z - fz * 80, v: 0 }); S.car.y = Math.max(W.data.H(S.car.x, S.car.z), 0);
    return { yaw, ground: W.data.H(S.p.x, S.p.z) };
  }, { sample, gridAz, P, job, hh, mm, cam: o.cam });
  const st = await settle(page, { minFrames: 20 });
  await frames(page, 8);
  const meta = await page.evaluate(({ sample }) => {
    const W = YZW.world, c = W.camera, G = W.G27, S = G.S, R2D = 180 / Math.PI;
    const d = new THREE.Vector3(); c.getWorldDirection(d);
    const it = W.coords.toRealITM(c.position.x, c.position.z), g = W.data.H(c.position.x, c.position.z);
    const gridAz = ((Math.atan2(d.x, -d.z) * R2D) + 360) % 360, pitch = Math.asin(Math.max(-1, Math.min(1, d.y))) * R2D;
    return { camera: { itm_real: { E: +it.E.toFixed(2), N: +it.N.toFixed(2) }, y: +c.position.y.toFixed(2), ground: +g.toFixed(2), eye_above_ground: +(c.position.y - Math.max(g, 0)).toFixed(2),
        grid_az_deg: +gridAz.toFixed(2), pitch_deg: +pitch.toFixed(2), fov_v_deg: c.fov, aspect: +c.aspect.toFixed(5), near: c.near, far: c.far, player_mode: YZW.mode(), cam_view: window.YZCam ? YZCam.view : null },
      sun: { elevation: +W.sun.elevation.toFixed(2), azimuth: +W.sun.azimuth.toFixed(2) }, clock: W.clock.date.toISOString(), weather: { cloud: W.weather.cloud, aqi: W.weather.aqi },
      stats: { calls: W.stats.calls, tris: W.stats.tris, tier: W.quality.tier, pixelRatio: W.renderer.getPixelRatio(), fog_far: G.scene.fog ? Math.round(G.scene.fog.far) : null },
      faults: YZW.faults.length, plugins_off: YZW.plugins().filter(p => p.state !== 'on').map(p => p.id + ':' + p.state) };
  }, { sample });
  meta.settle = st; meta.placed = r;
  return meta;
}

// מעבר סמנטי (ID pass): אותה מצלמה, כל רשת מקבלת צבע מחלקה קבוע (בלי תאורה/ערפל/טון), השמיים = רקע.
// נותן מסכת אמת לרינדור (שמיים/מבנה/קרקע/כביש/צמחייה/מים/ציון-דרך/אחר). החומרים משוחזרים מיד – לא נוגע בקוד המשחק.
const SEG_KEYS = { sky: [255, 0, 255], terrain: [0, 255, 0], road: [128, 128, 128], bld: [255, 0, 0], veg: [0, 110, 0], water: [0, 0, 255], lab: [255, 140, 0], other: [255, 255, 0] };
async function semanticPass(page) {
  return page.evaluate((KEYS) => {
    const W = YZW.world, G = W.G27, T = THREE, R = W.renderer, cam = W.camera, scene = G.scene, cls = new Map();
    const tag = (root, c) => root && root.traverse(o => { if (!cls.has(o)) cls.set(o, c); });
    for (const t of W.data.tiles.values()) { if (!t.grp) continue; tag(t.terrain, 'terrain'); tag(t.roadGrp, 'road'); tag(t.hi, 'bld'); tag(t.lo, 'bld'); tag(t.solar, 'bld'); tag(t.palms, 'veg'); tag(t.furn, 'other');
      for (const k of t.grp.children) if (k.name === 'yz-yard') tag(k, 'veg'); }
    tag(W.sky, 'sky'); if (G.W && G.W.sea) tag(G.W.sea, 'water');
    for (const c of scene.children) { const n = c.name || '';
      if (/^yz:(sky|beauty|atmo)/.test(n)) tag(c, 'sky'); else if (/^yz:vegetation/.test(n)) tag(c, 'veg'); else if (/^yz:maritime/.test(n)) tag(c, 'water');
      else if (/^(yz:buildings|yz:beautyday)/.test(n)) tag(c, 'bld'); else if (/^lab-/.test(n)) tag(c, 'lab'); }
    const mats = {}; for (const [k, v] of Object.entries(KEYS)) { mats[k] = new T.MeshBasicMaterial({ color: new T.Color(v[0] / 255, v[1] / 255, v[2] / 255), toneMapped: false, fog: false, side: T.DoubleSide }); mats[k + 'L'] = new T.LineBasicMaterial({ color: mats[k].color, toneMapped: false, fog: false }); }
    const saved = [], count = {}, bs = new T.Sphere();
    scene.traverse(o => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      let c = cls.get(o);
      if (!c) { c = 'other'; if (o.isPoints || o.isSprite) c = 'sky'; else if (o.geometry) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); bs.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); if (bs.radius > 1500 && !o.isInstancedMesh) c = 'sky'; } }
      saved.push([o, o.material, o.visible, o.instanceColor]); count[c] = (count[c] || 0) + 1; if (o.isInstancedMesh) o.instanceColor = null;   // צבע למופע היה מכפיל את צבע המחלקה
      if (c === 'sky' || o.isPoints || o.isSprite) { o.visible = false; return; }
      o.material = o.isLine ? mats[c + 'L'] : mats[c];
    });
    const bg = scene.background, fog = scene.fog, tm = R.toneMapping, sz = new T.Vector2(); R.getDrawingBufferSize(sz);
    const rt = new T.WebGLRenderTarget(sz.x, sz.y, { samples: 0 }); scene.background = new T.Color(KEYS.sky[0] / 255, KEYS.sky[1] / 255, KEYS.sky[2] / 255); scene.fog = null;
    const realScene = G.scene; let px;
    try { G.scene = {}; R.setRenderTarget(rt); R.render(scene, cam); px = new Uint8Array(sz.x * sz.y * 4); R.readRenderTargetPixels(rt, 0, 0, sz.x, sz.y, px); }
    finally { G.scene = realScene; R.setRenderTarget(null); scene.background = bg; scene.fog = fog; R.toneMapping = tm; for (const [o, m, v, ic] of saved) { o.material = m; o.visible = v; if (o.isInstancedMesh) o.instanceColor = ic; } rt.dispose(); for (const m of Object.values(mats)) m.dispose(); }
    const frac = {}, keys = Object.entries(KEYS); let unk = 0;
    for (let i = 0; i < px.length; i += 4) { let hit = null; for (const [k, v] of keys) if (Math.abs(px[i] - v[0]) <= 10 && Math.abs(px[i + 1] - v[1]) <= 10 && Math.abs(px[i + 2] - v[2]) <= 10) { hit = k; break; } if (hit) frac[hit] = (frac[hit] || 0) + 1; else unk++; }
    const N = px.length / 4; for (const k in frac) frac[k] = +(frac[k] / N).toFixed(4); frac.unknown = +(unk / N).toFixed(4);
    const cv = document.createElement('canvas'); cv.width = sz.x; cv.height = sz.y; const x = cv.getContext('2d'), im = x.createImageData(sz.x, sz.y);
    for (let y = 0; y < sz.y; y++) im.data.set(px.subarray((sz.y - 1 - y) * sz.x * 4, (sz.y - y) * sz.x * 4), y * sz.x * 4);   // היפוך אנכי
    x.putImageData(im, 0, 0);
    return { png: cv.toDataURL('image/png').split(',')[1], w: sz.x, h: sz.y, meshes_by_class: count, pixel_frac: frac };
  }, SEG_KEYS);
}

(async () => {
  const o = args(); if (!o.jobs) { console.error('usage: node render.js --jobs jobs.json [--out DIR] [--sizes 360x800,1080x1920] [--only id,id] [--cam game|photo]'); process.exit(2); }
  const J = JSON.parse(fs.readFileSync(o.jobs, 'utf8')); let jobs = J.jobs.filter(j => j.render !== false);
  if (o.only) { const s = new Set(o.only.split(',')); jobs = jobs.filter(j => s.has(j.id)); }
  if (o.shard) { const [k, n] = o.shard.split('/').map(Number); jobs = jobs.filter((j, i) => i % n === k); }   // GitHub Actions: --shard <index>/<total>
  if (!jobs.length) { console.error('no jobs'); process.exit(1); }
  const summary = { started: new Date().toISOString(), cam: o.cam, tier: o.tier, sizes: o.sizes, jobs: {} };
  let browser = null;
  for (const size of o.sizes.split(',')) {
    const [w, h] = size.split('x').map(Number), dir = path.join(o.out, 'renders', size); fs.mkdirSync(dir, { recursive: true });
    const first = jobs[0];
    const ow = await openWorld({ browser, width: w, height: h, tier: o.tier, date: first.date, time: first.time_il, atReal: first.pose.itm_real, keepTransient: o.keepTransient });
    browser = ow.browser; const page = ow.page;
    await page.addStyleTag({ content: 'body > *:not(#cv){visibility:hidden!important}' });   // רק הקנבס בצילום
    if (o.cam === 'photo') await page.evaluate(() => {
      YZW.register({ id: 'pm-photo-cam', name: 'מצלמת השוואה (photomatch, בדיקה)', dept: 'test', order: 99, init() {},
        modes: [{ id: 'pm-photo', name: 'צילום', icon: '📷', enter() {}, update(dt, w) { const P = window.__pmPose; if (!P) return null; const c = w.camera; c.position.set(P.x, P.y, P.z);
          c.lookAt(P.x + Math.sin(P.yaw) * Math.cos(P.p) * 10, P.y + Math.sin(P.p) * 10, P.z + Math.cos(P.yaw) * Math.cos(P.p) * 10); c.fov = P.fovV; c.near = 0.2; c.updateProjectionMatrix();
          if (w.sky) w.sky.position.copy(c.position); return { x: P.x, y: P.y - P.eh, z: P.z, speed: 0 }; } }] }); });
    for (const job of jobs) {
      const t0 = Date.now();
      try {
        const meta = await renderJob(page, job, o);
        const png = path.join(dir, job.id + '.png'); await page.screenshot({ path: png });
        const seg = await semanticPass(page); const segPng = path.join(dir, job.id + '.seg.png'); fs.writeFileSync(segPng, Buffer.from(seg.png, 'base64'));
        meta.seg = { png: segPng, keys: SEG_KEYS, w: seg.w, h: seg.h, pixel_frac: seg.pixel_frac, meshes_by_class: seg.meshes_by_class };
        meta.id = job.id; meta.size = size; meta.viewport = { w, h }; meta.render_s = (Date.now() - t0) / 1000; meta.png = png; meta.url = ow.url; meta.page_errors = ow.errors.slice(0, 5);
        meta.requested = { heading_true_deg: job.pose.heading_true_deg, pitch_deg: job.pose.pitch_deg, itm_real: job.pose.itm_real, time_il: job.time_il, date: job.date };
        fs.writeFileSync(path.join(dir, job.id + '.json'), JSON.stringify(meta, null, 1));
        (summary.jobs[job.id] = summary.jobs[job.id] || {})[size] = { ok: true, s: meta.render_s, sun: meta.sun.elevation, cam: meta.camera };
        console.log(`[${size}] ${job.id} ok ${meta.render_s.toFixed(1)}s  cam az ${meta.camera.grid_az_deg} pitch ${meta.camera.pitch_deg} eye ${meta.camera.eye_above_ground}m  sun ${meta.sun.elevation}°  tris ${meta.stats.tris}`);
      } catch (e) {
        (summary.jobs[job.id] = summary.jobs[job.id] || {})[size] = { ok: false, error: String(e.message || e).slice(0, 300) };
        console.log(`[${size}] ${job.id} FAIL ${e.message}`);
      }
    }
    summary['blocked_hosts_' + size] = [...ow.blocked]; summary['load_s_' + size] = ow.loadS; summary['errors_' + size] = ow.errors.slice(0, 10);
    await ow.ctx.close();
  }
  if (browser) await browser.close();
  summary.finished = new Date().toISOString();
  fs.writeFileSync(path.join(o.out, 'renders', 'render-summary' + (o.shard ? '-' + o.shard.replace('/', 'of') : '') + '.json'), JSON.stringify(summary, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
