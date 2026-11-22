// The plugin (plugin/15-sky.js) against a mock of the integration host's contract (swarm/integration/host/host.js):
// YZW.register({id, init(world, api), update(dt, world), dispose(world), hudPanels, settings}); real three.js r186 in node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('..', import.meta.url).pathname;
globalThis.window = globalThis;
vm.runInThisContext(readFileSync(root + 'vendor/three.min.js', 'utf8'));
vm.runInThisContext(readFileSync(root + 'dist/esh27-sky.js', 'utf8'));
const THREE = globalThis.THREE, regs = [];
globalThis.YZW = { register: d => regs.push(d) };
vm.runInThisContext(readFileSync(root + 'plugin/15-sky.js', 'utf8'));
const def = regs[0];
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(62, 1, 0.3, 2600); camera.position.set(10, 30, -20);
const world = { THREE, scene, camera, renderer: null, clock: { date: new Date('2026-11-22T23:00:00Z') }, providers: { gammaDeg: -0.29565 }, weather: { cloud: 0, aqi: 30 }, player: { pos: { x: 0, y: 0, z: 0 } }, coords: null };
const api = { group: () => { const g = new THREE.Group(); scene.add(g); return g; }, on: () => () => {} };
test('contract: id/name/dept/scripts/requires/init/update/dispose/hudPanels/settings', () => {
  assert.equal(def.id, 'sky'); for (const k of ['init', 'update', 'dispose', 'requires']) assert.equal(typeof def[k], 'function', k);
  assert.ok(Array.isArray(def.scripts) && def.scripts[0].endsWith('esh27-sky.js')); assert.ok(def.requires(world)); assert.ok(def.hudPanels[0].render && def.settings.length >= 1);
});
test('init + update place the Moon where the ephemeris says (world frame incl. γ) and expose providers', () => {
  def.init(world, api); def.update(1 / 60, world);
  const moon = scene.children[0].children.find(o => o.material && o.material.uniforms && o.material.uniforms.uSun);
  const d = moon.position.clone().sub(camera.position).normalize();
  const S = globalThis.ESH27Sky, m = S.moon(world.clock.date, S.observer(31.8014, 34.6435), { gammaDeg: -0.29565 });
  assert.ok(Math.hypot(d.x - m.vec.x, d.y - m.vec.y, d.z - m.vec.z) < 1e-4, JSON.stringify([d, m.vec]));
  assert.ok(Math.abs(world.providers.moon().phase - 0.959) < 0.002);
  const z = world.providers.zmanim(2026, 11, 23); assert.match(z.local.sunset, /^16:3\d:\d\d$/);
  assert.equal(world.providers.hebrewDate(new Date('2026-11-23T10:00:00Z')).text, 'י״ג בכסלו ה׳תשפ״ז');
  const el = { innerHTML: '', textContent: '' }; def.hudPanels[0].render(el, world); assert.ok(el.innerHTML.includes('כסלו') && el.innerHTML.includes('שקיעה'));
});
test('star sphere: Sirius drawn in the direction of topocentric() (rotation matrix of the group)', () => {
  const S = globalThis.ESH27Sky, F = world.providers.sky.stars, i = F.names.indexOf('Sirius');
  const pts = scene.children[0].children[0]; pts.updateMatrixWorld(true);
  const p = new THREE.Vector3().fromBufferAttribute(pts.geometry.attributes.position, i).applyMatrix4(pts.matrixWorld).sub(camera.position).normalize();
  const st = S.star('Sirius', world.clock.date, S.observer(31.8014, 34.6435), { gammaDeg: -0.29565, refraction: false });   // the star sphere is a rigid rotation: no refraction (≤ 0.5° at the horizon, 0.03° at 30°)
  assert.ok(Math.hypot(p.x - st.vec.x, p.y - st.vec.y, p.z - st.vec.z) < 1e-4);
});
test('per-frame CPU time of update() < 1 ms (real-time clock, ×3600 fast-forward, and slider jumps)', () => {
  const run = (frames, step) => { const c0 = process.cpuUsage(); for (let f = 0; f < frames; f++) { world.clock.date = new Date(world.clock.date.getTime() + step(f)); def.update(1 / 60, world); } const c = process.cpuUsage(c0); return (c.user + c.system) / frames; };
  const rt = run(2000, () => 16.7), ff = run(2000, () => 60000), jumps = run(300, f => (f % 2 ? 1 : -1) * 86400000 * 400);
  console.log(`# plugin update CPU µs/frame: realtime ${rt.toFixed(1)}, ×3600 ${ff.toFixed(1)}, ±400-day jumps every frame ${jumps.toFixed(1)}`);
  assert.ok(rt < 1000 && ff < 1000 && jumps < 1500);
});
test('dispose clears providers', () => { def.dispose(world); assert.equal(world.providers.moon, null); });
