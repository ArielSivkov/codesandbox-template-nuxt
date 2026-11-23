// מדידת ביצועים עם האטת מעבד ×6 (כמו טלפון בינוני): node tools/perf.js
// מודד: זמן סימולציה לפריים, זמן הכנת ההמון (דחיפה+מיון+העלאה), בתרחיש רגיל ובתרחיש צפוף (80 דמויות מונפשות ליד השחקן).
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8790/npc/demo.html';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36' });
  const p = await ctx.newPage();
  await p.goto(BASE + '?preset=' + (process.env.PRESET || 'morning') + '&auto=1'); await p.waitForFunction(() => window.NPCDEMO && NPCDEMO.ready, null, { timeout: 180000 });
  await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);
  const measure = async (label, dense) => p.evaluate(({ label, dense }) => {
    const D = NPCDEMO, npc = D.npc, sim = npc.sim, P = D.P;
    if (dense) { // 120 סוכנים מסביב לשחקן, הולכים/עומדים, כדי למלא את תקציב 80 הקרובים
      let k = 0; for (const a of sim.agents) { if (k >= 120) break; if (a.parent != null) continue; const ang = k * 2.4, r = 4 + (k % 30);
        a.x = P.x + Math.cos(ang) * r; a.z = P.z + Math.sin(ang) * r; a.state = 'walk'; a.flee = 0; a.followOn = false; a.path = [a.x, a.z, a.x + Math.sin(ang) * 40, a.z - Math.cos(ang) * 40]; a.pi = 1; a.dest = { place: { x: a.x, z: a.z }, inside: false, spot: 'stroll', dwell: 999 }; a.next = sim.t + 999; k++; } }
    const simT = [], upT = [], crowdT = []; for (const k in sim.prof) sim.prof[k] = 0;
    const N = 300; const dt = 1 / 30; const B = 30, bs = [], bd = [];
    // המכונה משותפת: מנות של 30 פריימים, והמנה הנקייה ביותר מייצגת (שעון הדפדפן מעוגל ל-0.1ms, לכן ממוצע מנה)
    for (let i = 0; i < N; i += B) { let ss = 0, sd = 0;
      for (let j = 0; j < B; j++) { const t0 = performance.now(); sim.update(dt, npc.clock()); const t1 = performance.now(); npc.draw(dt); const t2 = performance.now(); ss += t1 - t0; sd += t2 - t1; simT.push(t1 - t0); upT.push(t2 - t1); }
      bs.push(ss / B); bd.push(sd / B); }
    const best = { simMin: +Math.min(...bs).toFixed(3), simMedBatch: +bs.slice().sort((a, b) => a - b)[bs.length >> 1].toFixed(3), drawMin: +Math.min(...bd).toFixed(3), drawMedBatch: +bd.slice().sort((a, b) => a - b)[bd.length >> 1].toFixed(3) };
    const tot = a => +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3);
    const st = a => { a = a.slice().sort((x, y) => x - y); return { avg: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3), p50: +a[a.length >> 1].toFixed(3), p95: +a[Math.floor(a.length * 0.95)].toFixed(3), max: +a[a.length - 1].toFixed(3) }; };
    return { label, agents: sim.agents.length, tiers: [sim.stats.t0, sim.stats.t1, sim.stats.t2], near: npc.crowd.stats.near, far: npc.crowd.stats.far, crowdDraws: npc.crowd.stats.drawCalls, batches: best, sim: st(simT), crowdPrep: st(upT) };
  }, { label, dense });
  const out = [];
  out.push(await measure('רגיל ×1', false));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  out.push(await measure('רגיל ×6', false));
  out.push(await measure('צפוף ×6', true));
  // אפייה ×6 (פעם אחת בטעינה)
  const bake = await p.evaluate(async () => { const t0 = performance.now(); const G = ESH_GLTF, Ld = new G.GLTFLoader(); Ld.setMeshoptDecoder(G.MeshoptDecoder);
    const [m, a] = await Promise.all([Ld.loadAsync(GAME + 'assets/ubc_female.glb'), Ld.loadAsync(GAME + 'assets/ual_anims.glb')]); const t1 = performance.now(); const r = NPCCrowd.bake(m.scene, a.animations); return { loadMs: Math.round(t1 - t0), bakeMs: Math.round(r.ms), verts: r.verts, tris: r.tris, texW: r.VW, texH: r.rows, gpuMB: +(r.gpuBytes / 1048576).toFixed(2) }; });
  out.push({ label: 'אפיית גוף אחד ×6', ...bake });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
