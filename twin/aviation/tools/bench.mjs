// CPU cost of the pure simulation parts (Node, one core). Usage: node tools/bench.mjs
import fs from 'node:fs';
import { JetSim } from '../src/jet.js'; import { ShipSim } from '../src/spaceship.js'; import { LocalFrame } from '../src/geo.js'; import { decodeTerrain } from '../src/farfield.js';
const F = new LocalFrame(), TR = decodeTerrain(JSON.parse(fs.readFileSync(new URL('../data/terrain.json', import.meta.url))));
const surface = (x, z) => { const g = F.localToLla(x, 0, z); return { y: TR.at(g.lat, g.lon) - (x * x + z * z) / (2 * F.R), type: TR.isWater(g.lat, g.lon) ? 'water' : 'ground' }; };
const world = { center: F.center, R: F.R, surface };
const time = (n, f) => { const t0 = process.hrtime.bigint(); for (let i = 0; i < n; i++) f(i); return Number(process.hrtime.bigint() - t0) / n / 1000; };
const j = new JetSim(undefined, world); j.reset({ y: 3000, speed: 220, throttle: 0.8 }); j.gear = false;
const s = new ShipSim(undefined, world); s.reset({ y: 3000 });
const r = { jetStep_us: time(120 * 60, i => j.step(1 / 120, { pitch: Math.sin(i / 200) * 0.3, roll: 0.1, throttle: 0.8 })), shipStep_us: time(120 * 60, () => s.step(1 / 120, { thrust: 0.5, pitch: 0.1 })),
  localToLla_us: time(100000, i => F.localToLla(i, 0, -i)), terrainSurface_us: time(100000, i => surface(i * 3, -i * 2)) };
r.jetPerFrame60_ms = (r.jetStep_us * 2) / 1000; r.shipPerFrame60_ms = (r.shipStep_us * 2) / 1000;
console.log(JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
