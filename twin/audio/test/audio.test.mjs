import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../audio.js';
import { MockAudioContext } from './mock-ctx.mjs';
import { presetWeather, weatherToVisual } from '../../weather/weather.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b} (±${eps})`);

// ---------- מיפוי פרמטרים ----------
test('car: speed→gear→RPM monotonic within a gear, idle at standstill, shifts with hysteresis', () => {
  assert.equal(A.carRpm(0, 0).rpm, A.CAR.idle);
  assert.ok(A.carRpm(0, 1).rpm > 2500, 'throttle at standstill revs the engine (clutch slip)');
  let g = 1, prev = 0, shifts = 0;
  for (let v = 6; v <= 60; v += 0.5) {
    const r = A.carRpm(v, 0.7, g);
    if (r.gear === g) assert.ok(r.rpm >= prev - 1, `rpm rises within gear at ${v}`); else shifts++;
    assert.ok(r.rpm <= A.CAR.redline && r.rpm >= A.CAR.idle);
    g = r.gear; prev = r.rpm;
  }
  assert.ok(shifts >= 4 && g === 6, 'upshifts to top gear');
  // היסטרזיס: באותה מהירות, ההילוך תלוי בהיסטוריה
  assert.equal(A.carRpm(14, 0.5, 2).gear, 2); assert.equal(A.carRpm(14, 0.5, 3).gear, 3);
});
test('car: RPM→pitch (4-cyl 4-stroke firing frequency)', () => {
  near(A.firingHz4(800), 26.667, 0.01); near(A.firingHz4(6000), 200, 1e-9);
  near(A.firingHz2(5800, 3), 290, 1e-9);
});
test('helicopter blade-pass 26 Hz at 390 rpm × 4 blades; drone pitch ∝ √thrust', () => {
  near(A.bladePassHz(390, 4), 26, 1e-9);
  near(A.heliRotorRpm(0.5, 1), 390 * 1.0, 1);
  const f1 = A.droneMotorHz(0.25), f2 = A.droneMotorHz(1);
  near(f2 / f1, 2, 1e-9, '4× thrust → 2× rpm');
  assert.ok(A.droneMotorHz(0) > 0, 'idle spin never zero');
});
test('jet spool is first-order and slower to accelerate than decelerate', () => {
  let n = 0.2; for (let i = 0; i < 60; i++) n = A.jetSpool(n, 1, 1 / 60);
  near(n, 0.2 + 0.8 * (1 - Math.exp(-1 / 2.5)), 1e-6);
  let d = 1; for (let i = 0; i < 60; i++) d = A.jetSpool(d, 0, 1 / 60);
  assert.ok((1 - d) > (n - 0.2), 'spool-down faster');
  assert.ok(A.jetWhineHz(1) > A.jetWhineHz(0.2));
});
test('distanceGain matches W3C PannerNode formulas', () => {
  near(A.distanceGain(10, { model: 'inverse', ref: 5, rolloff: 1 }), 5 / (5 + 5), 1e-12);
  near(A.distanceGain(2, { ref: 5 }), 1, 1e-12, 'clamped below ref');
  near(A.distanceGain(55, { model: 'linear', ref: 5, max: 105, rolloff: 1 }), 0.5, 1e-12);
  near(A.distanceGain(20, { model: 'exponential', ref: 5, rolloff: 2 }), 1 / 16, 1e-12);
  let prev = 2; for (let d = 1; d < 3000; d *= 1.5) { const g = A.distanceGain(d, { ref: 6, max: 600 }); assert.ok(g <= prev); prev = g; }
});
test('doppler: approaching raises, receding lowers, 0 radial = 1, clamped', () => {
  const L = { x: 0, y: 0, z: 0 }, v0 = { x: 0, y: 0, z: 0 };
  near(A.dopplerFactor({ x: 100, y: 0, z: 0 }, { x: -34.3, y: 0, z: 0 }, L, v0), 343 / (343 - 34.3), 1e-9);
  assert.ok(A.dopplerFactor({ x: 100, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, L, v0) < 1);
  near(A.dopplerFactor({ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 50 }, L, v0), 1, 1e-12);
  assert.equal(A.dopplerFactor({ x: 100, y: 0, z: 0 }, { x: -1000, y: 0, z: 0 }, L, v0), 2);
  assert.ok(A.dopplerFactor({ x: 100, y: 0, z: 0 }, v0, L, { x: 20, y: 0, z: 0 }) > 1, 'listener moving toward');
});
test('occlusion: building between source and listener, roof clearance, polygon test', () => {
  const B = { minx: -10, maxx: 10, minz: -10, maxz: 10, top: 20 };
  assert.equal(A.countOccluders({ x: -50, y: 2, z: 0 }, { x: 50, y: 2, z: 0 }, [B]), 1);
  assert.equal(A.countOccluders({ x: -50, y: 2, z: 30 }, { x: 50, y: 2, z: 30 }, [B]), 0, 'passes beside');
  assert.equal(A.countOccluders({ x: -50, y: 40, z: 0 }, { x: 50, y: 40, z: 0 }, [B]), 0, 'passes over roof');
  const tri = { ...B, p: new Float32Array([-10, -10, 10, -10, -10, 10]), n: 3 }; // משולש: הפינה (+,+) ריקה
  assert.equal(A.countOccluders({ x: 9, y: 2, z: 30 }, { x: 9.5, y: 2, z: -30 }, [tri]), 1);
  assert.equal(A.countOccluders({ x: 30, y: 2, z: 9 }, { x: 9, y: 2, z: 30 }, [tri]), 0, 'crosses AABB corner only');
  assert.equal(A.countOccluders({ x: -50, y: 2, z: 0 }, { x: 50, y: 2, z: 0 }, [B, { ...B, minx: 20, maxx: 30 }]), 2);
  assert.ok(A.occlusionCutoff(1) < 2000 && A.occlusionCutoff(2) < A.occlusionCutoff(1) && A.occlusionCutoff(0) === 20000);
  assert.ok(A.occlusionGain(1) < 1 && A.occlusionGain(5) >= 0.12);
});
test('weather → audio: accepts weather.js records and weatherToVisual output', () => {
  const storm = presetWeather('winter-storm').current, calm = presetWeather('calm-clear').current;
  const a = A.weatherToAudio(storm), b = A.weatherToAudio(weatherToVisual(storm)), c = A.weatherToAudio(calm);
  near(a.wind, 12, 1e-9); near(b.wind, 12, 1e-6); near(a.rain, b.rain, 1e-9);
  assert.ok(a.rain > 0.7 && c.rain === 0);
  assert.ok(A.windParams(a.wind, a.gust).gain > A.windParams(c.wind, c.gust).gain);
  assert.equal(A.windParams(0.5, 0.5).gain, 0, 'calm → silent');
  assert.ok(A.windParams(12, 21, 1).cutoff > A.windParams(12, 21, 0).cutoff, 'gust raises pitch');
});
test('waves and area layers are distance-driven', () => {
  const w = d => A.waveParams(d).gain;
  assert.ok(w(10) > w(100) && w(100) > w(400) && w(400) > 0); assert.equal(w(Infinity), 0);
  assert.ok(A.waveParams(10).cutoff > A.waveParams(500).cutoff);
  const m = A.areaMix({ mainRoad: 20, park: 500, port: 5000 });
  assert.ok(m.traffic > 0.9 && m.park < 0.02 && m.port < 0.01);
});
test('footsteps: stride grows with speed; unknown surface falls back to asphalt', () => {
  assert.ok(A.strideLength(1.4) < A.strideLength(5));
  assert.equal(A.surfaceOf('lava'), 'asphalt'); assert.equal(A.surfaceOf('sand'), 'sand');
});
test('deterministic synthesis: same seed → identical buffers, different seed → different', () => {
  const a = A.synthNoise('pink', 0.5, 8000, 5), b = A.synthNoise('pink', 0.5, 8000, 5), c = A.synthNoise('pink', 0.5, 8000, 6);
  assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  assert.deepEqual(A.synthFootstep('grass', 1, 16000, 3), A.synthFootstep('grass', 1, 16000, 3));
  for (const s of Object.keys(A.SURFACES)) { const x = A.synthFootstep(s, 0, 16000, 1); let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); assert.ok(m > 0.2 && m <= 0.86, s + ' peak ' + m); }
});

// ---------- הקצאת ערוצים ----------
test('allocateVoices: never exceeds max, keeps loudest, hysteresis, one-shot reservation', () => {
  const c = Array.from({ length: 40 }, (_, i) => ({ id: 'v' + i, score: (i + 1) / 40 }));
  const r = A.allocateVoices(c, { max: 16 });
  assert.equal(r.active.size, 16); assert.ok(r.active.has('v39') && !r.active.has('v0'));
  const r2 = A.allocateVoices(c, { max: 16, fixed: 3 }); assert.equal(r2.active.size, 13);
  // היסטרזיס: v23 פעיל ובציון מעט נמוך מ-v24 שאינו פעיל → נשאר
  const pair = [{ id: 'a', score: 1.0 }, { id: 'b', score: 1.1 }];
  assert.ok(A.allocateVoices(pair, { max: 1, prevActive: new Set(['a']) }).active.has('a'));
  assert.ok(A.allocateVoices(pair, { max: 1 }).active.has('b'));
  assert.equal(A.allocateVoices([{ id: 'q', score: 1e-5 }], { max: 4 }).active.size, 0, 'inaudible culled');
});

function mkEngine(o = {}) {
  const ctx = new MockAudioContext();
  const audio = A.createAudio({ ctx, ...o });
  return { ctx, audio };
}
const step = (ctx, audio, n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { ctx.advance(dt); audio.update(dt); } };

test('engine: muted by default until unlock(); no graphs built before unlock', async () => {
  const { ctx, audio } = mkEngine();
  audio.attachToVehicle('car', { x: 3, y: 0, z: 0, throttle: 0.5, speed: 10 }, { player: true });
  step(ctx, audio, 3);
  assert.equal(audio.stats().voices, 0); assert.equal(audio._eng.master.gain.value, 0);
  await audio.unlock(); step(ctx, audio, 2);
  assert.ok(audio.stats().continuous >= 1); assert.ok(audio._eng.master.gain.value > 0);
});
test('engine: voice limit ≤ 16 with 40 vehicles + full ambience + footsteps; nearest win', async () => {
  const { ctx, audio } = mkEngine();
  await audio.unlock();
  audio.setEnvironment({ weather: presetWeather('winter-storm').current, area: { traffic: 1, park: 1, port: 1 }, shoreDist: 30, listener: { x: 0, y: 2, z: 0 } });
  const hs = [];
  for (let i = 0; i < 40; i++) { const m = A.MODES[1 + (i % 7)], d = 10 + i * 12; hs.push(audio.attachToVehicle(m, { x: d, y: 2, z: 0, throttle: 0.8, speed: 15, thrust: 0.6 })); }
  const walker = audio.attachToVehicle('walk', () => ({ x: 1, y: 0, z: 0, vx: 5, vz: 0, surface: 'wood' }), { player: true });
  let maxV = 0; for (let i = 0; i < 120; i++) { step(ctx, audio, 1); maxV = Math.max(maxV, audio.stats().voices); }
  assert.ok(maxV <= 16, 'max voices ' + maxV);
  assert.ok(hs[0].built && hs[1].built, 'nearest vehicles audible'); assert.ok(!hs[39].built, 'farthest virtualized');
  assert.ok(audio.stats().hrtf <= 4);
  const liveNodes = ctx.live.size; step(ctx, audio, 30); assert.ok(ctx.live.size <= liveNodes + 40, 'no node leak');
  walker.detach(); hs.forEach(h => h.detach());
});
test('engine: Shabbat mode → only ambience; engines not built, UI/voice refused, ambience still plays', async () => {
  const { ctx, audio } = mkEngine({ shabbat: true });
  await audio.unlock();
  audio.setEnvironment({ weather: presetWeather('sea-breeze').current, area: { traffic: 0.5, park: 1 }, shoreDist: 20 });
  const car = audio.attachToVehicle('car', { x: 2, y: 0, z: 0, throttle: 1 }, { player: true });
  step(ctx, audio, 10);
  assert.equal(car.built, false);
  assert.equal(audio.playUI('notify'), false); assert.equal(audio.playVoice(), false);
  const st = audio.stats(); assert.ok(st.active.some(id => id.startsWith('waves')) && st.active.some(id => id.startsWith('wind')));
  assert.equal(audio._eng.buses.engines.mask.gain.value, 0); assert.equal(audio._eng.buses.ui.mask.gain.value, 0); assert.equal(audio._eng.buses.ambience.mask.gain.value, 1);
  assert.ok(audio.footstep('sand'), 'footsteps are ambience → allowed');
  audio.setShabbat(false); step(ctx, audio, 2);
  assert.equal(car.built, true); assert.ok(audio.playUI('click'));
});
test('engine: voice ducks engines and ambience, then restores', async () => {
  const { ctx, audio } = mkEngine(); await audio.unlock();
  audio.attachToVehicle('car', { x: 2, y: 0, z: 0, throttle: 0.5 }, { player: true }); step(ctx, audio, 2);
  const r = audio.playVoice(); assert.ok(r);
  const ev = audio._eng.buses.engines.duck.gain.events;
  assert.ok(ev.some(e => e[0] === 'tgt' && Math.abs(e[1] - A.dbToGain(-9)) < 1e-9));
  assert.ok(ev.some(e => e[0] === 'tgt' && e[1] === 1 && e[2] >= r.end - 1e-9), 'restore scheduled at end');
});
test('engine: doppler & occlusion are applied to a passing car behind a building', async () => {
  const { ctx, audio } = mkEngine(); await audio.unlock();
  audio.setEnvironment({ listener: { x: 0, y: 1.7, z: 0 }, buildings: [{ minx: 20, maxx: 40, minz: -10, maxz: 10, top: 30 }] });
  let x = -200; const h = audio.attachToVehicle('car', () => ({ x, y: 1, z: 0, vx: 30, vy: 0, vz: 0, throttle: 0.8, speed: 30 }));
  step(ctx, audio, 3); const e = audio._eng.entries[0];
  assert.ok(e.dop > 1.05, 'approaching → higher pitch ' + e.dop); assert.equal(e.occ, 0);
  x = 200; step(ctx, audio, 6); assert.ok(e.dop < 0.95, 'receding'); assert.equal(e.occ, 1, 'building in between');
  assert.ok(e.voice.lp.frequency.value < 2000, 'low-passed ' + e.voice.lp.frequency.value);
  h.detach();
});
test('engine: velocity derived from positions when stateFn omits it; walk emits steps by distance', async () => {
  const { ctx, audio } = mkEngine(); await audio.unlock();
  let z = 0; audio.attachToVehicle('walk', () => ({ x: 0, y: 0, z }), { player: true });
  const before = ctx.created.bufsrc || 0;
  for (let i = 0; i < 60; i++) { z -= 1.5 / 30; step(ctx, audio, 1); } // 2 שניות × 1.5 מ/ש = 3 מ'
  const steps = (ctx.created.bufsrc || 0) - before;
  assert.ok(steps >= 3 && steps <= 6, 'steps ' + steps);
});
test('engine: every mode builds and updates without NaN', async () => {
  const { ctx, audio } = mkEngine(); await audio.unlock();
  for (const m of A.MODES.filter(m => m !== 'walk')) {
    const h = audio.attachToVehicle(m, { x: 5, y: 3, z: 0, throttle: 0.7, afterburner: true, thrust: 0.5 });
    step(ctx, audio, 5); assert.ok(h.built, m);
    for (const n of ctx.live) for (const k of ['frequency', 'gain', 'playbackRate']) if (n[k]) assert.ok(Number.isFinite(n[k].value), `${m} ${n.kind}.${k}`);
    h.detach();
  }
  assert.throws(() => audio.attachToVehicle('submarine', {}));
  assert.equal(audio.attachToVehicle('heli', {}).mode, 'helicopter');
});
