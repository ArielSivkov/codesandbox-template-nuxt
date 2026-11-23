// Contract tests: pipeline tiles ↔ maritime module; AIS honesty; the real Ashdod sample tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMarLayer, MAR_KINDS } from '../maritime.js';
import { decodeTerrainBin, fillFromTiles, buildGrid, contour, lineLength } from '../src/grid.js';
import { FixtureAIS, ServerProxyAIS, shipClass, deadReckon } from '../src/ais.js';
import { KELVIN } from '../src/traffic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(HERE, '../../pipeline/sample-out-ashdod');

test('pipeline "mar" layer (written by the patched pipeline) decodes into maritime features', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures/mar_tiles_from_patch.json'), 'utf8'));
  const feats = fx.tiles.flatMap(t => decodeMarLayer(t));
  assert.deepEqual([...new Set(feats.map(f => f.kind))].sort(), fx.expect);
  const bw = feats.filter(f => f.kind === 'breakwater');
  const len = bw.reduce((s, f) => { let L = 0; for (let i = 1; i < f.coords.length; i++) L += Math.hypot(f.coords[i][0] - f.coords[i - 1][0], f.coords[i][1] - f.coords[i - 1][1]); return s + L; }, 0);
  assert.ok(len >= fx.breakwater_len_m * 0.98, `breakwater pieces ${len} vs ${fx.breakwater_len_m}`);
  const buoy = feats.find(f => f.kind === 'buoy');
  assert.equal(buoy.geom, 'point'); assert.equal(buoy.tags['seamark:buoy_lateral:colour'], 'red'); assert.equal(buoy.src, 'osm');
});

test('Ashdod sample: terrain tiles → maritime grid has one long coastline near the fitted line', { skip: !fs.existsSync(SAMPLE) }, () => {
  const dir = path.join(SAMPLE, 'tiles/t');
  const tiles = fs.readdirSync(dir).map(f => decodeTerrainBin(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))))));
  assert.ok(tiles.length > 50 && tiles[0].nt === 41 && tiles[0].step === 25);
  const E0 = 157000, N1 = 640000, cs = 25, nx = 561, nz = 441;
  const pre = fillFromTiles(tiles, { E0, N1, nx, nz, cs });
  const g = buildGrid({ x0: 0, z0: 0, nx, nz, cs, prefill: pre });
  const lines = contour(g, 0).filter(l => lineLength(l) > 3000);
  assert.ok(lines.length >= 1, 'a long coastline exists');
  // every coast point lies within 900 m of the world.js fit E = A + B·N
  let worst = 0;
  for (const [x, z] of lines[0]) { const E = E0 + x, N = N1 - z; worst = Math.max(worst, Math.abs(E - (-125006.9 + 0.45566 * N))); }
  assert.ok(worst < 900, 'coast vs fit ' + worst);
});

test('AIS: fixture adapter never reports live; proxy without WebSocket reports offline', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures/ais_fixture.json'), 'utf8'));
  const a = new FixtureAIS(fx, { now: () => 1e12 }); let got = null;
  a.on((list, st) => { got = { n: list.length, st }; }); a.start();
  assert.equal(got.st, 'fixture'); assert.equal(a.isLive, false); assert.equal(got.n, fx.vessels.length);
  assert.ok(fx.vessels.every(v => v.mmsi.startsWith('999')), 'fixture MMSIs are fictional');
  const p = new ServerProxyAIS(null, { WebSocketImpl: null }); p.start(); assert.equal(p.status, 'offline'); assert.equal(p.isLive, false);
  assert.equal(shipClass(71), 'cargo'); assert.equal(shipClass(84), 'tanker'); assert.equal(shipClass(37), 'pleasure');
  const r = deadReckon({ lat: 31.8, lon: 34.6, sog: 10, cog: 90, ts: 0 }, 60e3);   // 10 kn east for 60 s ≈ 308.7 m
  assert.ok(Math.abs((r.lon - 34.6) * 111320 * Math.cos(31.8 * Math.PI / 180) - 308.67) < 0.5);
});

test('Kelvin wake half-angle = arcsin(1/3) ≈ 19.47°', () => { assert.ok(Math.abs(KELVIN * 180 / Math.PI - 19.4712) < 1e-3); });

test('MAR_KINDS in maritime.js is identical (same order) to the pipeline sources_osm.py list', () => {
  const py = fs.readFileSync(path.join(HERE, '../../pipeline/yazam/sources_osm.py'), 'utf8');
  const m = py.match(/MAR_KINDS = \[([\s\S]*?)\]/);
  assert.ok(m, 'MAR_KINDS not found in pipeline');
  const pyKinds = [...m[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]);
  assert.deepEqual(MAR_KINDS, pyKinds);
});
