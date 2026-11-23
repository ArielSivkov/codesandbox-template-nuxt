// מדידת זמן פריים קבועה (SwiftShader, יחסית בלבד): node tools/fpsbench.js "<world>|<extra>" ...  — מבט קבוע ברחוב הארז 13:30, שכבה נמוכה, 60 פריימים
const { chromium } = require('/tmp/pw/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const spec of process.argv.slice(2)) {
    const [w, extra = ''] = spec.split('|'); const ctx = await b.newContext({ viewport: { width: 360, height: 640 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { const t = setInterval(() => { if (!window.YZW) return; clearInterval(t);
      YZW.register({ id: 'photo-cam', name: 'bench', dept: 'test', order: 99, init() {}, modes: [{ id: 'photo', name: 'b', icon: 'b', enter() {}, update(dt, W) { const P = window.__pose; if (!P) return null; const c = W.camera; c.position.set(P.x, P.y, P.z); c.lookAt(P.x + Math.sin(P.h) * 10, P.y + 0.6, P.z - Math.cos(P.h) * 10); c.updateProjectionMatrix(); return { x: P.x, y: P.y - 1.5, z: P.z, speed: 0 }; } }] }); }, 5); });
    await p.goto(`http://localhost:8940/${w}/index.html?auto&nointro&clean=1&tier=low&d=2026-11-23&t=13:30${extra}`);
    await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 300000 });
    await p.evaluate(({ CL, EH }) => { const process_env_cloud = CL, process_env_h = EH; const W = YZW.world, s = W.data.W.toScene(164744, 634146); YZW.setWeather({ cloud: +(process_env_cloud), rain: 0, aqi: 30 }); YZW.setTime({ min: 13 * 60 + 30, rate: 0 }); YZW.placeAt(164744, 634146, 0); window.__pose = { x: s.x, y: Math.max(0, W.data.H(s.x, s.z)) + (process_env_h), z: s.z, h: 22 * Math.PI / 180 }; YZW.setMode('photo'); }, { CL: +(process.env.CLOUD || 0.08), EH: +(process.env.EH || 1.5) });
    await p.waitForTimeout(15000);
    const r = await p.evaluate(async () => { const t0 = performance.now(), f0 = YZW.world.renderer.info.render.frame; await new Promise(res => { let n = 0; const f = () => { if (++n >= 60) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const dt = performance.now() - t0, fr = YZW.world.renderer.info.render.frame - f0; return { msPerFrame: +(dt / fr).toFixed(1), calls: YZW.world.stats.calls, tris: YZW.world.stats.tris }; });
    console.log(spec.padEnd(34), JSON.stringify(r), 'errors', errs.length); await ctx.close();
  }
  await b.close();
})();
