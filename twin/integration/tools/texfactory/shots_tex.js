// צילומי לפני/אחרי לטקסטורות (גדוד טקסטורות): אותה תנוחה בדיוק, 360x800, גוף ראשון ומבט נהג, יום ולילה.
//   node shots_tex.js <base-url> <out-dir> [variants=before,after] [times=12:30,21:30] [tier=medium] [street=הטיילת] [near=-2040,265]
// before = ?hd=0 (החומרים הישנים), after = ברירת המחדל (53-materials-hd). מדדים לכל צילום: קריאות ציור, משולשים, FPS (swiftshader – יחסי בלבד),
// זיכרון טקסטורות משוער של HD, מספר טקסטורות ב-three. פלט: <out>/<variant>-<view>-<hhmm>.png + metrics.json
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
const fs = require('fs');
(async () => {
  const [base, out, vs = 'before,after', ts = '12:30,21:30', tier = 'medium', street = 'הטיילת', near = '-2040,265'] = process.argv.slice(2);
  const VIEWS = (process.env.VIEWS || 'fp,car').split(','), TAG = process.env.TAG ? '-' + process.env.TAG : '';
  fs.mkdirSync(out, { recursive: true });
  const [nx, nz] = near.split(',').map(Number);
  const metrics = fs.existsSync(out + '/metrics.json') ? JSON.parse(fs.readFileSync(out + '/metrics.json', 'utf8')) : {};
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  for (const v of vs.split(',')) for (const tm of ts.split(',')) {
    const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|GL Driver|ERR_TUNNEL|404/.test(m.text())) errs.push(m.text().slice(0, 200)); });
    if (process.env.PARAMS) await p.addInitScript(js => { const o = JSON.parse(js); if (o.hd) window.YZHd = { params: o.hd }; if (o.night) window.YZNight = o.night; if (o.beauty) window.YZBeauty = o.beauty; }, process.env.PARAMS);
    await p.addInitScript(() => { const t = setInterval(() => { if (!window.YZW) return; clearInterval(t);
      YZW.register({ id: 'photo-cam', name: 'מצלמת השוואה (בדיקה)', dept: 'test', order: 99, init() {},
        modes: [{ id: 'photo', name: 'צילום', icon: '📷', enter() {}, update(dt, w) { const P = window.__pose; if (!P) return null; const c = w.camera; c.position.set(P.x, P.y, P.z);
          c.lookAt(P.x + Math.sin(P.h) * Math.cos(P.p) * 10, P.y + Math.sin(P.p) * 10, P.z - Math.cos(P.h) * Math.cos(P.p) * 10); c.fov = 70; c.near = 0.2; c.updateProjectionMatrix();
          if (w.sky) w.sky.position.copy(c.position); return { x: P.x, y: P.y - P.eh, z: P.z, speed: 0 }; } }] }); }, 5); });
    const q = `?auto&nointro&clean=1&nat=0&t=${tm}&tier=${tier}` + (v === 'before' ? '&hd=0' : '');
    const t0 = Date.now();
    await p.goto(base + q);
    await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 240000 });
    // תנוחה: הקטע הישר הקרוב לנקודה ברחוב המבוקש
    const pose = await p.evaluate(({ street, nx, nz }) => {
      const W = YZW.world.data.W; let best = null;
      for (const t of W.tiles.values()) for (const r of t.roads || []) { if (r.name !== street) continue; const q = r.p;
        for (let i = 0; i < q.length / 2 - 1; i++) { const ax = q[i * 2], az = q[i * 2 + 1], bx = q[i * 2 + 2], bz = q[i * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 25) continue;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2, d = Math.hypot(mx - nx, mz - nz); if (!best || d < best.d) best = { d, ax, az, bx, bz, L, w: r.w }; } }
      if (!best) return null;
      const fx = (best.bx - best.ax) / best.L, fz = (best.bz - best.az) / best.L, rx = -fz, rz = fx;   // ימין לכיוון הנסיעה
      const s = 0.55, cx = best.ax + (best.bx - best.ax) * s, cz = best.az + (best.bz - best.az) * s;
      const h = Math.atan2(fx, -fz);
      const s0 = 0.15, it = YZW.world.coords.toITM(best.ax + (best.bx - best.ax) * s0, best.az + (best.bz - best.az) * s0); YZW.placeAt(it.E, it.N, 0);   // השחקן והרכב החונה מאחורי המצלמה
      return { h, car: { x: cx + rx * best.w * (best.w > 9.5 ? 0.375 : 0.25), z: cz + rz * best.w * (best.w > 9.5 ? 0.375 : 0.25), eh: 1.2, p: -0.05 }, fp: { x: cx + rx * (best.w / 2 + 1.3), z: cz + rz * (best.w / 2 + 1.3), eh: 1.6, p: -0.12 }, w: best.w, L: best.L };
    }, { street, nx, nz });
    if (!pose) { console.log('no pose for', street); await p.close(); continue; }
    if (v === 'after') await p.waitForFunction(() => window.YZHd && YZHd.applied, null, { timeout: 120000 }).catch(() => errs.push('HD not applied'));
    for (const view of VIEWS) {
      const P0 = pose[view];
      await p.evaluate(({ P0, h }) => { const W = YZW.world; const y = Math.max(0, W.data.H(P0.x, P0.z)) + P0.eh; window.__pose = { x: P0.x, y, z: P0.z, eh: P0.eh, h, p: P0.p }; YZW.setMode('photo'); }, { P0, h: pose.h });
      await p.evaluate(async () => { const s = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200 && YZW.world.data.W.pending() > 0; i++) await s(150);
        const f = YZW.world.renderer.info.render.frame, t0 = Date.now(); while (YZW.world.renderer.info.render.frame - f < 24 && Date.now() - t0 < 60000) await s(60); });
      const m = await p.evaluate(async () => { const W = YZW.world, s = ms => new Promise(r => setTimeout(r, ms)); const f0 = W.renderer.info.render.frame, t0 = performance.now(); await s(4000);
        const fps = (W.renderer.info.render.frame - f0) / ((performance.now() - t0) / 1000);
        return { calls: W.stats.calls, tris: W.stats.tris, fps: +fps.toFixed(2), texs: W.renderer.info.memory.textures, geoms: W.renderer.info.memory.geometries, hd: window.YZHd && YZHd.stats ? YZHd.stats() : null, tier: W.quality.tier,
          heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; });
      const name = `${v}-${view}-${tm.replace(':', '')}${TAG}`;
      await p.screenshot({ path: `${out}/${name}.png` });
      metrics[name] = Object.assign(m, { pose: { view, h: +pose.h.toFixed(3), x: +P0.x.toFixed(1), z: +P0.z.toFixed(1), eh: P0.eh }, loadS: +((Date.now() - t0) / 1000).toFixed(1), errors: errs.slice(0, 5) });
      if (m.hd) { m.hdGpuMB = m.hd.gpuMB; m.hdGroups = m.hd.groups; m.lamps = m.hd.lamps; delete m.hd; }
      console.log(name, JSON.stringify({ calls: m.calls, tris: m.tris, fps: m.fps, texs: m.texs, hdGpuMB: m.hdGpuMB, lamps: m.lamps, tier: m.tier, errs: errs.length }));
    }
    await p.close();
  }
  fs.writeFileSync(out + '/metrics.json', JSON.stringify(metrics, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
