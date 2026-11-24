// גדוד הצמחייה — מדידת FPS יחסית (swiftshader) לפני/אחרי, לסירוגין, באותה נקודה ובאותה שעה (24.11.2026)
//   node tools/trees-fps.js <beforeBase> <afterBase> [spot=bengurion] [time=13:30] [tier=medium] [rounds=3] [seconds=6]
// כל סבב: טוען לפני ואז אחרי (דפדפן אחד, הקשר חדש לכל טעינה), מחכה לחימום, מודד זמני פריים. FPS = 1000/חציון זמן הפריים; מדפיס חציון לכל צד.
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
const SPOTS = { palms: { road: ['רוגוזין', 'רוגזין'], E: 164660, N: 634240, eh: 1.25 }, bengurion: { road: ['בן גוריון', 'שדרות דוד בן גוריון', 'דוד בן גוריון'], E: 165150, N: 634700, eh: 1.25 }, street: { home: true, eh: 1.6 } };
(async () => {
  const [before, after, spot = 'bengurion', tm = '13:30', tier = 'medium', rounds = '3', secs = '6'] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const S = SPOTS[spot], res = { before: [], after: [] };
  for (let r = 0; r < +rounds; r++) for (const [side, base] of [['before', before], ['after', after]]) {
    const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.setDefaultTimeout(300000);
    await p.addInitScript(() => {
      const setCam = wd => { const P = window.__pose; if (!P) return null; const c = wd.camera; c.position.set(P.x, P.y, P.z);
        c.lookAt(P.x + Math.sin(P.h) * 10, P.y + 0.5, P.z - Math.cos(P.h) * 10); c.fov = 68; c.near = 0.2; c.updateProjectionMatrix(); c.updateMatrixWorld(); if (wd.sky) wd.sky.position.copy(c.position); return { x: P.x, y: P.y - P.eh, z: P.z, speed: 0 }; };
      const def = { id: 'photo-cam', name: 'cam', dept: 'test', order: 1, init() {}, update(dt, wd) { if (window.YZW.mode() === 'photo') setCam(wd); }, modes: [{ id: 'photo', name: 'צילום', icon: '📷', enter() {}, update(dt, wd) { return setCam(wd); } }] };
      let y; Object.defineProperty(window, 'YZW', { configurable: true, get() { return y; }, set(v) { y = v; try { v.register(def); } catch (e) { /* */ } } }); });
    const [hh, mm] = tm.split(':').map(Number);
    await p.goto(`${base}?auto&nat=0&nointro&clean=1&d=2026-11-24&t=${tm}&tier=${tier}`);
    await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 300000 });
    await p.waitForFunction(() => YZW.plugins().every(x => x.state !== 'loading' && x.state !== 'registered'), null, { timeout: 240000 }).catch(() => {});
    const fps = await p.evaluate(async ({ S, hh, mm, secs }) => {
      const W = YZW.world, D = W.data.W, sleep = ms => new Promise(f => setTimeout(f, ms)); let x, z, h;
      if (S.home) { const H = W.home, s = D.toScene(H.E, H.N); x = s.x + Math.cos(H.yaw) * H.side; z = s.z - Math.sin(H.yaw) * H.side; h = -H.yaw; }
      else { const a = D.toScene(S.E, S.N); let best = null; for (const t of D.tiles.values()) for (const r of t.roads || []) { if (!S.road.includes(r.name)) continue; const q = r.p;
        for (let i = 0; i < q.length / 2 - 1; i++) { const ax = q[i * 2], az = q[i * 2 + 1], dx = q[i * 2 + 2] - ax, dz = q[i * 2 + 3] - az, l2 = dx * dx + dz * dz; if (l2 < 400) continue;
          let s = ((a.x - ax) * dx + (a.z - az) * dz) / l2; s = Math.max(0.15, Math.min(0.5, s)); const px = ax + dx * s, pz = az + dz * s, d = Math.hypot(px - a.x, pz - a.z); if (!best || d < best.d) best = { d, px, pz, dx, dz, w: r.w }; } }
        const l = Math.hypot(best.dx, best.dz), fx = best.dx / l, fz = best.dz / l; x = best.px - fz * best.w * 0.25; z = best.pz + fx * best.w * 0.25; h = Math.atan2(fx, -fz); }
      const bk = W.coords.toITM(x - Math.sin(h) * 30, z + Math.cos(h) * 30); YZW.placeAt(bk.E, bk.N, 0);
      window.__pose = { x, y: Math.max(0, W.data.H(x, z)) + S.eh, z, eh: S.eh, h }; YZW.setMode('photo');
      YZW.setWeather({ cloud: 0.2, rain: 0, aqi: 40, windSpeed: 3 }); YZW.setTime({ ymd: '2026-11-24' }); YZW.setTime({ min: hh * 60 + mm, rate: 0 });
      const r = W.renderer; let f = r.info.render.frame; while (r.info.render.frame - f < 30) await sleep(30);
      // זמני פריים בודדים (חותמת rAF): חציון = עמיד לקפיצות של קומפילציית שיידרים / איסוף זבל
      const dts = []; let last = 0, on = true; const tick = t => { if (last) dts.push(t - last); last = t; if (on) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      await sleep(secs * 1000); on = false; dts.sort((a, b) => a - b);
      return { fps: dts.length / (dts.reduce((a, b) => a + b, 0) / 1000), medMs: dts[dts.length >> 1], p90: dts[Math.floor(dts.length * 0.9)], n: dts.length }; }, { S, hh, mm, secs: +secs });
    res[side].push(+(1000 / fps.medMs).toFixed(2)); console.log(r, side, JSON.stringify(fps)); await ctx.close();
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  console.log(JSON.stringify({ spot, tm, tier, before: res.before, after: res.after, medBefore: med(res.before), medAfter: med(res.after), ratio: +(med(res.after) / med(res.before)).toFixed(3) }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
