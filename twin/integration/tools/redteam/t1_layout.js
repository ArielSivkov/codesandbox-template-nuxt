const { launch, GAME, collect } = require('./pw_common');
(async () => {
  const b = await launch(); const out = {};
  for (const [name, w, h] of [['portrait', 360, 800], ['landscape', 800, 360]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'he-IL' });
    const p = await ctx.newPage(); const errs = collect(p);
    await p.goto(GAME + '?auto'); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 90000 }); await p.waitForTimeout(3000);
    await p.screenshot({ path: `shots/layout-${name}.png` });
    const r = await p.evaluate(() => {
      const ids = ['top', 'mode', 'bMine', 'bMenu', 'bEnv', 'mm', 'hud', 'joy', 'acts', 'bA', 'bB', 'bE', 'prompt', 'fps'];
      const R = {}; for (const id of ids) { const e = document.getElementById(id); if (!e) continue; const s = getComputedStyle(e); if (s.display === 'none' || e.classList.contains('hidden')) continue; const q = e.getBoundingClientRect(); R[id] = [Math.round(q.left), Math.round(q.top), Math.round(q.right), Math.round(q.bottom)]; }
      const ov = []; const k = Object.keys(R).filter(x => !['top', 'acts'].includes(x));
      for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) { const a = R[k[i]], c = R[k[j]]; if (a[0] < c[2] && c[0] < a[2] && a[1] < c[3] && c[1] < a[3]) ov.push(k[i] + '×' + k[j]); }
      const off = Object.entries(R).filter(([, q]) => q[0] < 0 || q[1] < 0 || q[2] > innerWidth || q[3] > innerHeight).map(([id]) => id);
      const clipped = [...document.querySelectorAll('button,#hud,#prompt')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.textContent.slice(0, 20));
      return { R, overlaps: ov, offscreen: off, clipped };
    });
    // open card on a building + menu + env panel
    const card = await p.evaluate(() => { const W = G27.W; let b = null; for (const t of W.tiles.values()) if (t.blds && t.blds.length) { b = t.blds.find(x => x.name) || t.blds[0]; break; } G27.showCard(b); const c = document.getElementById('card').getBoundingClientRect(); return { h: Math.round(c.height), top: Math.round(c.top), sh: document.getElementById('card').scrollHeight, name: b.name }; });
    await p.screenshot({ path: `shots/card-${name}.png` });
    await p.evaluate(() => { document.getElementById('cClose').click(); document.getElementById('bMenu').click(); }); await p.waitForTimeout(300); await p.screenshot({ path: `shots/menu-${name}.png` });
    await p.evaluate(() => { document.getElementById('menu').style.display = 'none'; const e = document.getElementById('bEnv'); if (e) e.click(); }); await p.waitForTimeout(300); await p.screenshot({ path: `shots/env-${name}.png` });
    out[name] = { ...r, card, errs: errs.slice(0, 10) };
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1)); await b.close();
})();
