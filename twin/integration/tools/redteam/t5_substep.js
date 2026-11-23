const { launch, GAME, collect } = require('./pw_common');
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 480, height: 320 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = collect(p);
  await p.goto(GAME + '?auto'); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 }); await p.waitForTimeout(2000);
  // 1) Tunneling: emulate one frame of the game's own movement (pos += v*dt, then W.collide push-out) at dt=0.1 (frame cap)
  const tun = await p.evaluate(() => { const W = G27.W; const res = {};
    const cases = { car_34ms: [3.4, 1.05], heli_46ms: [4.6, 2.6], jet_11ms: [1.1, 0.35], foot_sprint: [0.85, 0.35] };
    const blds = []; for (const t of W.tiles.values()) for (const b of (t.blds || [])) blds.push(b);
    for (const [name, [step, r]] of Object.entries(cases)) { let tested = 0, through = 0, inside = 0; const ex = [];
      for (const b of blds) { // approach the middle of each wall perpendicularly from outside
        for (let i = 0; i < b.n; i++) { const j = (i + 1) % b.n, ax = b.p[i * 2], az = b.p[i * 2 + 1], bx = b.p[j * 2], bz = b.p[j * 2 + 1], L = Math.hypot(bx - ax, bz - az); if (L < 4) continue;
          let nx = -(bz - az) / L, nz = (bx - ax) / L; const mx = (ax + bx) / 2, mz = (az + bz) / 2; if (W.pip(b, mx + nx * 0.5, mz + nz * 0.5)) { nx = -nx; nz = -nz; } // outward normal
          let x = mx + nx * (r + 0.05), z = mz + nz * (r + 0.05); const y = b.base + 1; tested++;
          for (let k = 0; k < 6 * 5; k++) { x -= nx * step / 5; z -= nz * step / 5; const c = W.collide(x, z, r, y, y + 1.5); x = c.x; z = c.z; }
          const side = (x - mx) * nx + (z - mz) * nz; // >0 = still on the near side
          if (W.pip(b, x, z)) inside++; else if (side < -0.5) { through++; if (ex.length < 3) ex.push({ id: b.id, area: b.area, wall: +L.toFixed(1) }); }
          break; } }
      res[name] = { walls: tested, passedThrough: through, endedInside: inside, pct: +(100 * (through + inside) / tested).toFixed(1), ex }; }
    return res; });
  // 2) Fallback ground then real terrain (dunes ~48 m) – avoid the business-pin crash by clearing the pin (test harness only)
  const fg = await p.evaluate(async () => { const G = G27, S = G.S, W = G.W; G.setMode('foot'); G.biz.pin = null;
    const s = W.toScene(167950, 638975); S.p.set(s.x, 0, s.z); S.p.y = W.floorAt(s.x, s.z, 200); S.vy = 0; S.grounded = true;
    const before = { y: +S.p.y.toFixed(2), H: +W.H(s.x, s.z).toFixed(2), tileLoaded: W.tiles.has('167_638') };
    await new Promise(r => setTimeout(r, 15000)); const mid = { y: +S.p.y.toFixed(2), H: +W.H(S.p.x, S.p.z).toFixed(2), tileLoaded: !!(W.tiles.get('167_638') || {}).hgt };
    const x0 = S.p.x, z0 = S.p.z; G.input.override = { x: 0, y: 1, up: false, down: false }; await new Promise(r => setTimeout(r, 10000)); G.input.override = null;
    return { before, mid, movedWhileHoldingForward10s: +Math.hypot(S.p.x - x0, S.p.z - z0).toFixed(2), after: { y: +S.p.y.toFixed(2), H: +W.H(S.p.x, S.p.z).toFixed(2) }, gameSecondsElapsed: +S.t.toFixed(1) }; });
  // 3) heli at max speed into the tallest loaded building
  const hb = await p.evaluate(async () => { const G = G27, S = G.S, W = G.W; G.biz.pin = null; let best = null; for (const t of W.tiles.values()) for (const b of (t.blds || [])) if (!best || b.top > best.top) best = b;
    G.setMode('heli'); const h = S.heli; h.x = best.cx; h.z = best.cz + 60; h.y = best.base + 5; h.h = Math.PI; h.v = 46; h.vy = 0; h.rotor = 1;
    G.input.override = { x: 0, y: 1, up: false, down: false }; await new Promise(r => setTimeout(r, 6000)); G.input.override = null;
    return { building: best.id, top: best.top, w: +(best.maxx - best.minx).toFixed(1), d: +(best.maxz - best.minz).toFixed(1), heliInsideFootprint: W.pip(best, h.x, h.z), heliPastBuilding: h.z < best.minz, hz: +h.z.toFixed(1), y: +h.y.toFixed(1) }; });
  console.log(JSON.stringify({ tunneling: tun, fallbackGround: fg, heliRam: hb, errs: [...new Set(errs.filter(e => !/GL Driver|GPU stall/.test(e)))] }, null, 1));
  await b.close();
})();
