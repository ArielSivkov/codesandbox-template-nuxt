// "תסתכל במפה": מה יש בעולם סביב נקודה – בניינים, כבישים/שבילים, גובה קרקע, עצמי מעבדה. בלי לשנות קוד משחק.
// node probe_map.js <E_real> <N_real> [radius=400] [out.json]
// קואורדינטות: ITM אמיתי (EPSG:2039). העולם עובד במסגרת הדגימה = אמיתי − (1507.82, 757.76).
const fs = require('fs');
const { openWorld } = require('./lib/world_page');
(async () => {
  const [E, N] = [+process.argv[2], +process.argv[3]], R = +(process.argv[4] || 400), out = process.argv[5] || '/home/claude/swarm/photomatch-out/probe.json';
  if (!E || !N) { console.error('usage: node probe_map.js <E_real> <N_real> [radius] [out.json]'); process.exit(2); }
  const { browser, page, errors } = await openWorld({ width: 360, height: 800, atReal: { E, N } });
  const res = await page.evaluate(({ E, N, R }) => {
    const W = YZW.world, d = W.data, C = W.coords, c = C.fromRealITM(E, N), r1 = v => Math.round(v * 10) / 10;
    const toReal = (x, z) => { const p = C.toRealITM(x, z); return [r1(p.E), r1(p.N)]; };
    const blds = []; const seen = new Set();
    for (const t of d.tiles.values()) for (const b of t.blds || []) { if (seen.has(b.id)) continue; seen.add(b.id);
      const dist = Math.hypot(b.cx - c.x, b.cz - c.z); if (dist > R) continue;
      blds.push({ id: b.id, name: b.name, type: b.type, ty: b.ty, dist: r1(dist), c_real: toReal(b.cx, b.cz), base: r1(b.base), h: r1(b.h), top: r1(b.top), area: Math.round(b.area), floors: b.floors, src: b.src, conf: b.conf,
        w: r1(b.maxx - b.minx), d: r1(b.maxz - b.minz), bearing: Math.round(((Math.atan2(b.cx - c.x, -(b.cz - c.z)) * 180 / Math.PI) + 360) % 360) }); }
    blds.sort((a, b) => a.dist - b.dist);
    const roads = []; for (const t of d.tiles.values()) for (const rd of t.roads || []) { let best = 1e9, bi = 0; for (let i = 0; i < rd.p.length; i += 2) { const q = Math.hypot(rd.p[i] - c.x, rd.p[i + 1] - c.z); if (q < best) { best = q; bi = i; } }
      if (best < R) roads.push({ name: rd.name || '', c: rd.c, w: rd.w, dist: r1(best), nearest_real: toReal(rd.p[bi], rd.p[bi + 1]), n: rd.p.length / 2,
        pts_real: Array.from({ length: Math.min(40, rd.p.length / 2) }, (_, k) => { const j = Math.floor(k * (rd.p.length / 2 - 1) / Math.max(1, Math.min(40, rd.p.length / 2) - 1)) * 2; return toReal(rd.p[j], rd.p[j + 1]); }) }); }
    roads.sort((a, b) => a.dist - b.dist);
    const terrain = []; for (let dz = -R; dz <= R; dz += 25) { const row = []; for (let dx = -R; dx <= R; dx += 25) row.push(r1(d.H(c.x + dx, c.z - dz))); terrain.push(row); }
    const lab = []; W.scene.traverse(o => { if (/^lab-/.test(o.name) && o.parent === W.scene) lab.push({ name: o.name, real: o.userData.itm ? [o.userData.itm.E, o.userData.itm.N] : toReal(o.position.x, o.position.z), y: r1(o.position.y) }); });
    return { center_real: [E, N], center_scene: [r1(c.x), r1(c.z)], ground_here: r1(d.H(c.x, c.z)), terrain_step_m: 25, terrain_rows_north_to_south: terrain.reverse(), buildings: blds, roads: roads.slice(0, 60), lab,
      plugins: YZW.plugins().map(p => p.id + ':' + p.state), tiles: [...d.tiles.keys()] };
  }, { E, N, R });
  res.page_errors = errors.slice(0, 10);
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log('buildings', res.buildings.length, 'roads', res.roads.length, 'lab', res.lab.length, 'ground_here', res.ground_here, '→', out);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
