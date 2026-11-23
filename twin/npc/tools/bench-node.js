// מדידת זמן מעבד של הסימולציה על נתוני אשדוד האמיתיים (Node, זמן CPU של התהליך – לא מושפע מעומס של תהליכים אחרים).
// node tools/bench-node.js [gameDir]   →  ms/פריים במחשב הזה; "טלפון" = ×6 (כמו האטת מעבד ×6 ב-Chrome)
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const L = require('../js/life.js');
const GAME = process.argv[2] || '/home/claude/codesandbox-template-nuxt/twin/game';
const man = JSON.parse(fs.readFileSync(path.join(GAME, "data/cities/ashdod/manifest.json"), "utf8"));
const [x0, y0, x1, y1] = man.bbox_itm, OX = Math.round((x0 + x1) / 2), OY = Math.round((y0 + y1) / 2);
const SP = { E: 165120, N: 633640 }, sx = SP.E - OX, sz = -(SP.N - OY);
const COAST_A = -125006.9, COAST_B = 0.45566;
// פענוח אריחים (כמו world.js): בניינים + כבישים בקואורדינטות סצנה
const buildings = [], roads = [];
const dec = (r, ox, oy) => { const a = []; let x = ox, y = oy; for (let i = 0; i < r.length; i += 2) { x += r[i] / 10; y += r[i + 1] / 10; a.push(x - OX, -(y - OY)); } return a; };
for (const key of man.tiles) {
  const [tx, ty] = key.split('_').map(Number); if (Math.hypot((tx + 0.5) * 1000 - SP.E, (ty + 0.5) * 1000 - SP.N) > 1800) continue;
  const v = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(GAME, 'data/tiles/v', key + '.json.gz'))));
  for (const b of v.b) { const p = dec(b.r[0], v.o[0], v.o[1]); let n = p.length / 2; if (n > 3 && Math.abs(p[0] - p[n * 2 - 2]) < 0.05 && Math.abs(p[1] - p[n * 2 - 1]) < 0.05) n--; if (n < 3) continue;
    let cx = 0, cz = 0, minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, per = 0; for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; minx = Math.min(minx, p[i * 2]); maxx = Math.max(maxx, p[i * 2]); minz = Math.min(minz, p[i * 2 + 1]); maxz = Math.max(maxz, p[i * 2 + 1]); }
    buildings.push({ id: b.i, type: b.t || '', area: b.a, h: b.h / 10, floors: b.f, p: Float32Array.from(p.slice(0, n * 2)), n, cx: cx / n, cz: cz / n, minx, maxx, minz, maxz }); }
  for (const r of v.rd) roads.push({ p: Float32Array.from(dec(r.r, v.o[0], v.o[1])), w: [0, 5, 7, 8.5, 10][r.c] || 5 });
}
// אינדקס מרחבי לבדיקת "בתוך בניין"
const HC = 64, grid = new Map(); for (const b of buildings) for (let i = Math.floor(b.minx / HC); i <= Math.floor(b.maxx / HC); i++) for (let j = Math.floor(b.minz / HC); j <= Math.floor(b.maxz / HC); j++) { const k = i * 100003 + j; (grid.get(k) || grid.set(k, []).get(k)).push(b); }
const pip = (b, x, z) => { const p = b.p, n = b.n; let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const near = (x, z, r) => { const out = new Set(); for (let i = Math.floor((x - r) / HC); i <= Math.floor((x + r) / HC); i++) for (let j = Math.floor((z - r) / HC); j <= Math.floor((z + r) / HC); j++) { const a = grid.get(i * 100003 + j); if (a) for (const b of a) if (!(x + r < b.minx || x - r > b.maxx || z + r < b.minz || z - r > b.maxz)) out.add(b); } return out; };
const world = { buildings, roads, H: () => 1, isSea: (x, z) => (x + OX) < COAST_A + COAST_B * (OY - z) - 150,
  blocked: (x, z) => { for (const b of near(x, z, 0)) if (pip(b, x, z)) return true; return false; },
  nearBuilding: (x, z, r) => near(x, z, r).size > 0, isPort: b => false };
const g = L.buildGraph(roads); world.nearRoad = (x, z, r) => L.nearestNode(g, x, z, r) >= 0;
const sp = L.findSpots(world, sx, sz, 580, 26); world.openSpots = sp.open; world.beachSpots = L.findBeach(world, sx, sz, 1200, 30);
const results = [];
for (const N of [700, 1100]) {
  const sim = L.createSim(world, { maxAgents: N, center: { x: sx, z: sz }, radius: 300 }); sim.graph = g; sim.populate();
  const base = Date.parse('2026-06-16T05:00:00Z');
  // חימום 45 דק' משחק
  sim.opts.pathMs = 40; sim.opts.pathsPerFrame = 200; sim.opts.tier0R = 0; sim.opts.tier1R = 0; sim.setPlayer({ x: 1e7, z: 1e7, mode: 'foot', speed: 0, vx: 0, vz: 0 });
  for (let s = 2700; s > 0; s -= 5) sim.update(5, L.clock(new Date(base - s * 1000)));
  sim.opts.pathMs = 0.6; sim.opts.pathsPerFrame = 6; sim.opts.tier0R = 70; sim.opts.tier1R = 260;
  const busy = sim.busiest(sx, sz, 300) || { x: sx, z: sz };
  const place = (dense) => {
    if (dense) { let k = 0; for (const a of sim.agents) { if (k >= 120) break; if (a.parent != null) continue; const ang = k * 2.4, r = 4 + (k % 30);
      a.x = busy.x + Math.cos(ang) * r; a.z = busy.z + Math.sin(ang) * r; a.state = 'walk'; a.followOn = false; a.path = [a.x, a.z, a.x + Math.sin(ang) * 40, a.z - Math.cos(ang) * 40]; a.pi = 1; a.dest = { place: { x: a.x, z: a.z }, inside: false, spot: 'stroll', dwell: 999 }; a.next = sim.t + 999; k++; } }
  };
  const run = (label, dense) => {
    sim.setPlayer({ x: busy.x, z: busy.z, mode: 'foot', speed: 0, vx: 0, vz: 0 });
    let t0max = 0;
    // המכונה משותפת (עומס גבוה) → 5 חזרות, לוקחים את החזרה הנקייה ביותר
    const F = 600; let avg = 1e9, per = null;
    for (let rep = 0; rep < 5; rep++) { place(dense); for (let w = 0; w < 30; w++) sim.update(1 / 30, L.clock(new Date(base))); t0max = Math.max(t0max, sim.stats.t0); const pr = []; const c0 = process.cpuUsage();
      for (let f = 0; f < F; f++) { const a = process.cpuUsage(); sim.update(1 / 30, L.clock(new Date(base + (rep * F + f) * 33))); const b = process.cpuUsage(a); pr.push((b.user + b.system) / 1000); }
      const tot = process.cpuUsage(c0), av = (tot.user + tot.system) / 1000 / F; pr.sort((a, b) => a - b); if (av < avg) { avg = av; per = pr; } }
    results.push({ agents: sim.agents.length, scenario: label, tier0: t0max, outdoor: sim.stats.outdoor, cpu_ms_avg: +avg.toFixed(3), cpu_ms_p95: +per[Math.floor(F * 0.95)].toFixed(3), phone_ms_avg_x6: +(avg * 6).toFixed(2), phone_ms_p95_x6: +(per[Math.floor(F * 0.95)] * 6).toFixed(2) });
  };
  run('רגיל (במקום הכי חי)', false); run('צפוף (120 סביב השחקן)', true);
}
console.log(JSON.stringify({ buildings: buildings.length, roads: roads.length, graphNodes: g.n, open: sp.open.length, beach: world.beachSpots.length, results }, null, 1));
