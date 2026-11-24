// גדוד הצמחייה — צילומי לפני/אחרי ומדידות תקציב לעצים (24.11.2026)
//   node tools/trees-shots.js <outdir> <tag> [tiers=low,medium,high] [shotTiers=medium,high] [base=http://127.0.0.1:8943/integration/world/index.html]
// לכל שכבת איכות: טעינה אחת, 3 נקודות × יום/לילה. מודד קריאות ציור, משולשים (כולל מעבר הצל), FPS יחסי (swiftshader),
// וזיכרון טקסטורות (סכום כל הטקסטורות שהחומרים בסצנה מפנים אליהן: רוחב×גובה×בתים×מיפמפים). צילום 360×800 רק בשכבות shotTiers.
// הנקודות: נקודה על קו הרחוב (לפי שם OSM) הכי קרובה לעוגן ITM, נתיב ימני, גובה עיני נהג 1.25 מ', מבט לאורך הרחוב.
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
const fs = require('fs');
const SPOTS = {
  palms: { road: ['רוגוזין', 'רוגזין'], E: 164660, N: 634240, eh: 1.25, pitch: 3, flip: false, lane: 0.25 },        // שדרת דקלים ליד הבית (דקלי תמר + דקלי world.js)
  bengurion: { road: ['בן גוריון', 'שדרות דוד בן גוריון', 'דוד בן גוריון'], E: 165150, N: 634700, eh: 1.25, pitch: 3, flip: false, lane: 0.25 },   // שדרת וושינגטוניות
  street: { home: true, eh: 1.6, pitch: 2 },                                                                    // שכונת מגורים: רחוב הארז (נקודת הבית)
};
const TIMES = { day: '13:30', night: '23:00' };
(async () => {
  const [outdir, tag, tiersA = 'low,medium,high', shotA = 'medium,high', base = 'http://127.0.0.1:8943/integration/world/index.html'] = process.argv.slice(2);
  if (!outdir || !tag) { console.error('usage: node tools/trees-shots.js <outdir> <tag> [tiers] [shotTiers] [base]'); process.exit(2); }
  fs.mkdirSync(outdir, { recursive: true });
  const tiers = tiersA.split(','), shotTiers = new Set(shotA.split(','));
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const all = { tag, when: new Date().toISOString(), tiers: {} };
  for (const tier of tiers) {
    const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(300000);
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|GL Driver|ERR_TUNNEL|404/.test(m.text())) errs.push(m.text().slice(0, 200)); });
    // המצלמה מוצבת גם ב-update של תוסף שנרשם ראשון (לפני כל המתאמים): מודולים שבוחרים LOD לפי המצלמה (צמחייה) רצים לפני עדכון
    // המצב — בלי זה הם רואים את מצלמת המשחק (30 מ' מאחור, פונה דרומה) והעצים שבתמונה לא נבחרים כקרובים. נרשמים ברגע ש-host.js יוצר את YZW.
    await p.addInitScript(() => {
      const setCam = wd => { const P = window.__pose; if (!P) return null; const c = wd.camera; c.position.set(P.x, P.y, P.z);
        c.lookAt(P.x + Math.sin(P.h) * Math.cos(P.p) * 10, P.y + Math.sin(P.p) * 10, P.z - Math.cos(P.h) * Math.cos(P.p) * 10); c.fov = 68; c.near = 0.2; c.updateProjectionMatrix(); c.updateMatrixWorld();
        if (wd.sky) wd.sky.position.copy(c.position); return { x: P.x, y: P.y - P.eh, z: P.z, speed: 0 }; };
      const def = { id: 'photo-cam', name: 'מצלמת השוואה (בדיקה)', dept: 'test', order: 1, init() {}, update(dt, wd) { if (window.YZW.mode() === 'photo') setCam(wd); },
        modes: [{ id: 'photo', name: 'צילום', icon: '📷', enter() {}, update(dt, wd) { return setCam(wd); } }] };
      let y; Object.defineProperty(window, 'YZW', { configurable: true, get() { return y; }, set(v) { y = v; try { v.register(def); } catch (e) { /* */ } } }); });
    const t0 = Date.now();
    await p.goto(`${base}?auto&nat=0&nointro&clean=1&d=2026-11-24&t=13:30&tier=${tier}`);
    await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 300000 });
    await p.waitForFunction(() => YZW.plugins().every(x => x.state !== 'loading' && x.state !== 'registered'), null, { timeout: 240000 }).catch(() => {});
    const res = { loadS: (Date.now() - t0) / 1000, spots: {} };
    for (const [sk, S] of Object.entries(SPOTS)) {
      const pose = await p.evaluate(S => { const W = YZW.world, D = W.data.W;
        let x, z, h;
        if (S.home) { const H = W.home, s = D.toScene(H.E, H.N); x = s.x + Math.cos(H.yaw) * H.side; z = s.z - Math.sin(H.yaw) * H.side; h = -H.yaw; }   // מדרכה (כמו נקודת הפתיחה), מבט לאורך הרחוב לכיוון המועדון
        else { const a = D.toScene(S.E, S.N); let best = null;
          for (const t of D.tiles.values()) for (const r of t.roads || []) { if (!S.road.includes(r.name)) continue; const q = r.p;
            for (let i = 0; i < q.length / 2 - 1; i++) { const ax = q[i * 2], az = q[i * 2 + 1], bx = q[i * 2 + 2], bz = q[i * 2 + 3], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; if (l2 < 400) continue;
              let s = ((a.x - ax) * dx + (a.z - az) * dz) / l2; s = Math.max(0.15, Math.min(0.5, s)); const px = ax + dx * s, pz = az + dz * s, d = Math.hypot(px - a.x, pz - a.z);
              if (!best || d < best.d) best = { d, px, pz, dx, dz, w: r.w, name: r.name }; } }
          if (!best) return null; const l = Math.hypot(best.dx, best.dz), fx = best.dx / l * (S.flip ? -1 : 1), fz = best.dz / l * (S.flip ? -1 : 1);
          x = best.px - fz * best.w * S.lane; z = best.pz + fx * best.w * S.lane; h = Math.atan2(fx, -fz); }
        const y = Math.max(0, W.data.H(x, z)) + S.eh, it = W.coords.toITM(x, z), bk = W.coords.toITM(x - Math.sin(h) * 30, z + Math.cos(h) * 30);
        YZW.placeAt(bk.E, bk.N, 0);   // השחקן והרכב 30 מ' מאחורי המצלמה (שהרכב לא יסתיר את העצים)
        window.__pose = { x, y, z, eh: S.eh, h, p: S.pitch * Math.PI / 180 }; YZW.setMode('photo');
        return { x: +x.toFixed(1), z: +z.toFixed(1), E: Math.round(it.E), N: Math.round(it.N), headingDeg: Math.round(h * 180 / Math.PI) }; }, S);
      if (!pose) { console.log('spot not found', sk); continue; }
      res.spots[sk] = { pose };
      for (const [tk, tm] of Object.entries(TIMES)) {
        const [hh, mm] = tm.split(':').map(Number);
        await p.evaluate(({ hh, mm }) => { YZW.setWeather({ cloud: 0.2, rain: 0, aqi: 40, windSpeed: 3 }); YZW.setTime({ ymd: '2026-11-24' }); YZW.setTime({ min: hh * 60 + mm, rate: 0 }); }, { hh, mm });
        const m = await p.evaluate(async () => {
          const W = YZW.world, r = W.renderer, sleep = ms => new Promise(f => setTimeout(f, ms));
          const waitF = async n => { const f = r.info.render.frame, t0 = Date.now(); while (r.info.render.frame - f < n && Date.now() - t0 < 120000) await sleep(30); };
          await waitF(24);   // סטרימינג + בחירת LOD + אפיית כרטיסים
          const calls = [], tris = []; const t0 = performance.now(), f0 = r.info.render.frame;
          while (performance.now() - t0 < 4000) { await sleep(5); calls.push(W.stats.calls); tris.push(W.stats.tris); }
          const fps = (r.info.render.frame - f0) / ((performance.now() - t0) / 1000);
          const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
          // זיכרון טקסטורות: כל טקסטורה שחומר בסצנה מפנה אליה (כולל uniforms וחומרי עומק)
          const seen = new Map(), add = t => { if (!t || !t.isTexture || seen.has(t.uuid)) return; const im = t.image || {}; const w = im.width || (t.source && t.source.data && t.source.data.width) || 0, h = im.height || (t.source && t.source.data && t.source.data.height) || 0;
            const bpp = t.type === 1015 ? 16 : t.type === 1016 ? 8 : 4, mip = t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1; seen.set(t.uuid, { name: t.name || '', w, h, mb: w * h * bpp * mip / 1048576 }); };
          const scanM = m => { if (!m) return; for (const k in m) { const v = m[k]; if (v && v.isTexture) add(v); } if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) add(v); } };
          W.scene.traverse(o => { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(scanM); scanM(o.customDepthMaterial); });
          const texMB = [...seen.values()].reduce((a, t) => a + t.mb, 0);
          // צמחייה לפי מערכת
          const veg = { near: 0, far: 0, nearMeshes: 0, farMeshes: 0, nearTris: 0 }; W.scene.traverse(o => { if (!o.isInstancedMesh || !o.visible || !o.count) return; const nm = o.name || '';
            const tri = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
            if (/^veg-near|^flora-/.test(nm)) { veg.near += o.count; veg.nearMeshes++; veg.nearTris += o.count * tri; } else if (/^veg-far/.test(nm)) { veg.far += o.count; veg.farMeshes++; } });
          const ws = W.data.W.streetStats ? W.data.W.streetStats() : {};
          return { calls: med(calls), tris: med(tris), fps: +fps.toFixed(2), texMB: +texMB.toFixed(1), texN: seen.size, geoms: r.info.memory.geometries, texs: r.info.memory.textures, veg, worldTrees: ws.trees, tier: W.quality.tier,
            heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null, flora: window.ESHFlora && ESHFlora.stats ? ESHFlora.stats() : null };
        });
        res.spots[sk][tk] = m;
        if (shotTiers.has(tier)) { await p.screenshot({ path: `${outdir}/${sk}-${tk}-${tier}-${tag}.png` }); }
        console.log(tier, sk, tk, JSON.stringify({ calls: m.calls, tris: m.tris, fps: m.fps, texMB: m.texMB, veg: m.veg, worldTrees: m.worldTrees }));
      }
    }
    res.faults = await p.evaluate(() => YZW.faults.filter(f => f.id !== 'photo-cam')); res.errs = errs.slice(0, 8);
    all.tiers[tier] = res; await ctx.close();
  }
  fs.writeFileSync(`${outdir}/measure-${tag}.json`, JSON.stringify(all, null, 1));
  console.log('saved', `${outdir}/measure-${tag}.json`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
