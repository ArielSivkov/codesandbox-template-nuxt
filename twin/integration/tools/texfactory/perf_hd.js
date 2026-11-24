// מדידת עלות החומרים החדים בהחלפה לסירוגין באותו עמוד (מבטל סחיפה של swiftshader): old ⇄ hd, כמה סבבים.
//   node perf_hd.js <url-with-query> [rounds=3] [secs=6] [view=fp|car]
// מדפיס לכל תצורה: FPS חציוני, קריאות ציור, משולשים, טקסטורות, זיכרון HD משוער. swiftshader = יחסי בלבד (לא טלפון).
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
(async () => {
  const [url, rounds = '3', secs = '6', view = 'fp'] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { const t = setInterval(() => { if (!window.YZW) return; clearInterval(t);
    YZW.register({ id: 'photo-cam', name: 'מצלמת השוואה (בדיקה)', dept: 'test', order: 99, init() {},
      modes: [{ id: 'photo', name: 'צילום', icon: '📷', enter() {}, update(dt, w) { const P = window.__pose; if (!P) return null; const c = w.camera; c.position.set(P.x, P.y, P.z);
        c.lookAt(P.x + Math.sin(P.h) * Math.cos(P.p) * 10, P.y + Math.sin(P.p) * 10, P.z - Math.cos(P.h) * Math.cos(P.p) * 10); c.fov = 70; c.near = 0.2; c.updateProjectionMatrix();
        if (w.sky) w.sky.position.copy(c.position); return { x: P.x, y: P.y - P.eh, z: P.z, speed: 0 }; } }] }); }, 5); });
  await p.goto(url); await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 240000 });
  await p.evaluate(view => { const W = YZW.world.data.W; let best = null;
    for (const t of W.tiles.values()) for (const r of t.roads || []) { if (r.name !== 'הטיילת') continue; const q = r.p;
      for (let i = 0; i < q.length / 2 - 1; i++) { const ax = q[i * 2], az = q[i * 2 + 1], bx = q[i * 2 + 2], bz = q[i * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 25) continue; const d = Math.hypot((ax + bx) / 2 + 2040, (az + bz) / 2 - 265); if (!best || d < best.d) best = { d, ax, az, bx, bz, L, w: r.w }; } }
    const fx = (best.bx - best.ax) / best.L, fz = (best.bz - best.az) / best.L, rx = -fz, rz = fx, cx = best.ax + (best.bx - best.ax) * 0.55, cz = best.az + (best.bz - best.az) * 0.55;
    const it = YZW.world.coords.toITM(best.ax + (best.bx - best.ax) * 0.15, best.az + (best.bz - best.az) * 0.15); YZW.placeAt(it.E, it.N, 0);
    const off = view === 'car' ? best.w * (best.w > 9.5 ? 0.375 : 0.25) : best.w / 2 + 1.3, eh = view === 'car' ? 1.2 : 1.6, x = cx + rx * off, z = cz + rz * off;
    window.__pose = { x, y: Math.max(0, YZW.world.data.H(x, z)) + eh, z, eh, h: Math.atan2(fx, -fz), p: view === 'car' ? -0.05 : -0.12 }; YZW.setMode('photo'); }, view);
  const settle = async () => p.evaluate(async () => { const s = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200 && YZW.world.data.W.pending() > 0; i++) await s(150); await s(1500); });
  // זמן ציור של פריים אחד (render + gl.finish, חציון של 21) – מדד יציב יותר מ-FPS ב-swiftshader
  const measure = async () => p.evaluate(async secs => { const W = YZW.world, s = ms => new Promise(r => setTimeout(r, ms)); const f0 = W.renderer.info.render.frame, t0 = performance.now(); await s(secs * 1000);
    const fps = +((W.renderer.info.render.frame - f0) / ((performance.now() - t0) / 1000)).toFixed(2), calls = W.stats.calls, tris = W.stats.tris;
    const r = W.renderer, gl = r.getContext(), ts = []; for (let i = 0; i < 21; i++) { await s(20); const a = performance.now(); r.render(W.scene, W.camera); gl.finish(); ts.push(performance.now() - a); } ts.sort((x, y) => x - y);
    return { fps, renderMs: +ts[10].toFixed(1), calls, tris, texs: W.renderer.info.memory.textures, hd: window.YZHd && YZHd.stats ? YZHd.stats().gpuMB : 0 }; }, +secs);
  const setHD = async on => { await p.evaluate(on => YZW.enable('hd', on, true), on); if (on) await p.waitForFunction(() => YZHd.applied && YZW.plugins().find(x => x.id === 'hd').state === 'on' && YZHd.stats().groups.street === 'on', null, { timeout: 90000 }); await settle(); };
  const cfgs = {
    old: async () => setHD(false),
    hd: async () => { await setHD(true); await p.evaluate(() => { YZHd.params.lamps = true; }); },
    hd_nolamps: async () => { await p.evaluate(() => { YZHd.params.lamps = false; }); await settle(); },
  };
  await settle(); await p.waitForFunction(() => window.YZHd && YZHd.applied, null, { timeout: 90000 }).catch(() => {});
  const res = {};
  for (let r = 0; r < +rounds; r++) for (const [k, fn] of Object.entries(cfgs)) { await fn(); const m = await measure(); (res[k] = res[k] || []).push(m); console.log(r, k, JSON.stringify(m)); }
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  for (const [k, a] of Object.entries(res)) console.log('MEDIAN', k, 'renderMs', med(a.map(x => x.renderMs)), 'fps', med(a.map(x => x.fps)), 'calls', med(a.map(x => x.calls)), 'tris', med(a.map(x => x.tris)), 'texs', med(a.map(x => x.texs)), 'hdMB', med(a.map(x => x.hd)));
  console.log('errors', errs.slice(0, 5));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
