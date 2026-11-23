// בדיקות מודול הצמחייה: node --test test/   (Node 18+, בלי דפדפן; three r186 מ-vendor)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.self = globalThis;
require('../vendor/three.min.js');
const T = globalThis.THREE;
const V = await import('../vegetation.js');
const HERE = new URL('..', import.meta.url).pathname;
const g = k => JSON.parse(zlib.gunzipSync(fs.readFileSync(HERE + `data/tiles/g/${k}.json.gz`)));
const D = (m, d = 15) => new Date(Date.UTC(2026, m - 1, d));
const sp = c => V.SPECIES_DB.species.find(s => s.code === c);

test('species.data.js is generated from species.json (one source of truth)', () => {
  const j = JSON.parse(fs.readFileSync(HERE + 'species.json', 'utf8'));
  assert.deepEqual(V.SPECIES_DB, j);
  const pj = JSON.parse(fs.readFileSync(HERE + '../pipeline/yazam/species_veg.json', 'utf8'));
  assert.deepEqual(pj, j);
});

test('phenology: Jacaranda purple in May, bare-ish in Feb; Delonix red in June; Retama white in Feb', () => {
  assert.ok(V.phenology(sp('JACA'), D(5)).flower > 0.8);
  assert.ok(V.phenology(sp('JACA'), D(2)).flower < 0.05 && V.phenology(sp('JACA'), D(2)).leaf < 0.35);
  assert.ok(V.phenology(sp('DELO'), D(6)).flower > 0.8 && V.phenology(sp('DELO'), D(1)).flower === 0);
  assert.ok(V.phenology(sp('RETA'), D(2)).flower > 0.8 && V.phenology(sp('RETA'), D(8)).flower === 0);
  assert.ok(V.phenology(sp('MELI'), D(1)).leaf < 0.2 && V.phenology(sp('MELI'), D(7)).leaf === 1);
  assert.ok(V.phenology(sp('MELI'), D(11)).autumn > 0.5, 'Melia colours before leaf drop');
  for (let m = 1; m <= 12; m++) assert.equal(V.phenology(sp('FMIC'), D(m)).leaf, 1);
  assert.ok(V.lawnGreen(D(1)) < V.lawnGreen(D(7)), 'kikuyu dormant in winter');
});

test('season curves are continuous across months and the year boundary', () => {
  for (const s of V.SPECIES_DB.species) {
    let prev = V.monthly(s.flower, new Date(Date.UTC(2025, 11, 31, 12)));
    for (let d = 0; d < 366; d++) {
      const v = V.monthly(s.flower, new Date(Date.UTC(2026, 0, 1, 12) + d * 864e5));
      assert.ok(Math.abs(v - prev) < 0.06, `${s.code} jump at day ${d}`); prev = v;
    }
  }
});

test('procedural models: attributes, size matches the botany table, triangle budget', () => {
  for (const s of V.SPECIES_DB.species) {
    const m = V.buildSpeciesGeometry(T, s);
    for (const a of ['position', 'normal', 'color', 'aPart', 'aCenter', 'aBend', 'aMask']) assert.ok(m.geo.getAttribute(a), s.code + ' ' + a);
    const H = (s.h[0] + s.h[1]) / 2;
    assert.ok(Math.abs(m.H - H) / H < 0.25, `${s.code} height ${m.H.toFixed(1)} vs ${H}`);
    const lim = s.kind === 'tree' || s.kind === 'palm' ? 700 : s.arch === 'dwarf' || s.arch === 'tussock' ? 80 : 400;
    assert.ok(m.tris <= lim, `${s.code} ${m.tris} tris > ${lim}`);
    const bend = m.geo.getAttribute('aBend').array; assert.ok(Math.min(...bend) >= 0 && Math.max(...bend) <= 1.0001);
  }
});

test('green tile decode: plants inside their tile, species known', () => {
  const d = V.decodeGreenTile(g('164_634'));
  assert.equal(d.lc.length, 10000); assert.ok(d.n > 500);
  for (let i = 0; i < d.n; i++) {
    assert.ok(d.E[i] >= d.ox && d.E[i] < d.ox + 1000 && d.N[i] >= d.oy && d.N[i] < d.oy + 1000);
    assert.ok(sp(d.codes[d.sp[i]]));
  }
});

test('street slots: deterministic, one species per street', () => {
  const a = V.slotSpecies({ E: 164500, N: 634200, cls: 2, street: 'הרצל' }), b = V.slotSpecies({ E: 164500, N: 634200, cls: 2, street: 'הרצל' });
  assert.equal(a, b);
  const c = {}; for (let i = 0; i < 100; i++) { const s = V.slotSpecies({ E: 164000 + i * 11, N: 634200, cls: 2, street: 'הרצל' }); c[s] = (c[s] || 0) + 1; }
  assert.ok(Math.max(...Object.values(c)) >= 75, JSON.stringify(c));
});

// ---- LOD / budget on the real Ashdod sample (no renderer: impostor atlas not baked, everything else runs)
const KEYS = ['163_633', '164_633', '165_633', '163_634', '164_634', '165_634', '164_635', '165_635', '166_634'];
const OX = 166264, OY = 634406;   // bbox centre of the sample manifest (same as the game)
function makeVeg(budget = 'phone') {
  const v = V.createVegetation(T, { origin: { OX, OY }, heightAt: () => 2, budget, date: D(5) });
  for (const k of KEYS) v.addTile(k, g(k));
  return v;
}
function cam(x, y, z, yaw, pitch) { const c = new T.PerspectiveCamera(62, 360 / 800, 0.3, 6000); c.position.set(x, y, z); c.rotation.set(pitch, yaw, 0, 'YXZ'); c.updateMatrixWorld(); return c; }

test('phone budget: ≤ 30k vegetation triangles and ≤ 3 draw calls per species, 60 random views', () => {
  const v = makeVeg(); let worst = { tris: 0 }, times = [];
  let seed = 7; const R = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 60; i++) {
    const x = 164500 - OX + (R() - 0.5) * 1800, z = -(634500 - OY) + (R() - 0.5) * 1800, aerial = R() < 0.35;
    const c = cam(x, aerial ? 80 + R() * 300 : 1.7, z, R() * 6.28, aerial ? -0.3 - R() * 0.9 : (R() - 0.5) * 0.3);
    const u0 = process.cpuUsage(); v.update(c, 1); const u1 = process.cpuUsage(u0); const s = v.stats(); times.push(+((u1.user + u1.system) / 1000).toFixed(2));
    if (s.tris > worst.tris) worst = s;
    const visibleSpecies = v.root.children.filter(m => m.visible && m.count > 0).map(m => m.name.split('-').pop());
    const per = {}; for (const m of v.root.children) if (m.visible && m.count > 0) per[m.name.split('-').pop()] = (per[m.name.split('-').pop()] || 0) + (m.castShadow ? 2 : 1);
    for (const [k, n] of Object.entries(per)) assert.ok(n <= 3, `${k} ${n} calls`);
    assert.ok(s.drawCalls <= 3 * new Set(visibleSpecies).size);
    assert.ok(s.tris <= 30000, `view ${i}: ${s.tris} tris`);
  }
  times.sort((a, b) => a - b);
  console.log(`  worst view: ${worst.tris} tris, ${worst.drawCalls} calls, near ${worst.near}, far ${worst.far}; LOD pass CPU median ${times[30]} ms, p95 ${times[57]} ms (Node)`);
});

test('determinism: same input and camera -> identical instance buffers', () => {
  const a = makeVeg(), b = makeVeg(), c = cam(164400 - OX, 1.7, -(634300 - OY), 0.5, 0);
  a.update(c, 1); b.update(c, 1);
  assert.deepEqual(a.stats().near, b.stats().near);
  const ma = a.root.children.filter(m => m.count).map(m => [m.name, Array.from(m.instanceMatrix.array.slice(0, m.count * 16))]);
  const mb = b.root.children.filter(m => m.count).map(m => [m.name, Array.from(m.instanceMatrix.array.slice(0, m.count * 16))]);
  assert.deepEqual(ma, mb);
});

test('wind + season uniforms flow into the shaders; slots and removal work', () => {
  const v = makeVeg();
  v.setWind({ x: 7, y: 0, z: -2 });
  const m = v.root.children.find(o => o.name === 'veg-near-JACA');
  let sh = { uniforms: {}, vertexShader: '#include <begin_vertex>\n#include <project_vertex>\n#include <color_vertex>', fragmentShader: '' };
  m.material.onBeforeCompile(sh);
  assert.equal(sh.uniforms.uWind.value.x, 7); assert.ok(sh.vertexShader.includes('uWind') && sh.vertexShader.includes('instanceMatrix'));
  v.setDate(D(5)); assert.ok(sh.uniforms.uFlowerAmt.value > 0.8);
  v.setDate(D(10)); assert.ok(sh.uniforms.uFlowerAmt.value < 0.05);
  v.update(cam(0, 2, 0, 0, 0), 1); const n0 = v.stats().plants; const added = v.fillSlots('164_634', [{ E: 164500, N: 634500, cls: 3, street: 'שדרות' }, { E: 164512, N: 634500, cls: 3, street: 'שדרות' }]);
  assert.equal(added, 2);
  v.update(cam(0, 2, 0, 0, 0), 1); assert.equal(v.stats().plants, n0 + 2);
  v.removeTile('164_634'); v.update(cam(0, 2, 0, 0, 0), 1); assert.ok(v.stats().plants < n0);
  const cov = v.coverAt(165300 - OX, -(633300 - OY)); assert.ok(cov && typeof cov.estimated === 'boolean');
  v.dispose();
});
