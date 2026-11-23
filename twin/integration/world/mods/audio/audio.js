// audio.js — מחלקת הקול, לוח היזם / עולם תאום של ישראל
// מודול ES, Web Audio API בלבד, אפס קבצי קול חיצוניים (הכול מסונתז → אפס סיכון רישוי).
//
//   import { createAudio } from './audio.js';
//   const audio = createAudio({ shabbat: false });
//   audio.installUnlock(document.body);                 // מושתק עד נגיעה (מדיניות autoplay)
//   const car = audio.attachToVehicle('car', () => ({ x, y, z, vx, vy, vz, speed, throttle }), { player: true });
//   audio.setEnvironment({ weather, areaDist: { mainRoad: 40, park: 200, port: 1500 }, shoreDist: 300, buildings });
//   requestAnimationFrame loop → audio.update(dt)        // dt בשניות
//
import * as C from './audio-core.js';
export * from './audio-core.js';

const isOffline = ctx => typeof ctx.startRendering === 'function';
const AC = () => (typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null);

// ======================= יצירת באפרים פרוצדורליים (דטרמיניסטי) =======================
function onePoleLP(x, f, sr) { const a = Math.exp(-2 * Math.PI * f / sr); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } return x; }
function onePoleHP(x, f, sr) { const a = Math.exp(-2 * Math.PI * f / sr); let y = 0, px = 0; for (let i = 0; i < x.length; i++) { y = a * (y + x[i] - px); px = x[i]; x[i] = y; } return x; }
function biquadBP(x, f, Q, sr) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * Q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
function normPeak(x, peak) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m; return x; }
function normRms(x, rms) { let s = 0; for (const v of x) s += v * v; const r = Math.sqrt(s / x.length); if (r > 0) for (let i = 0; i < x.length; i++) x[i] *= rms / r; return x; }
function fadeLoop(x, n) { // מעבר חלק בתפר הלולאה
  for (let i = 0; i < n; i++) { const t = i / n; x[i] = x[i] * t + x[x.length - n + i] * (1 - t); }
  return x.subarray(0, x.length - n);
}
function toBuffer(ctx, data, sr) { const b = ctx.createBuffer(1, data.length, sr); b.getChannelData(0).set(data); return b; }

export function synthNoise(kind, seconds, sr, seed) {
  const r = C.rng(seed), n = Math.round(seconds * sr) + 2048, x = new Float32Array(n);
  if (kind === 'white') { for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; normPeak(x, 0.95); }
  else if (kind === 'pink') { // Paul Kellet
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) { const w = r() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; }
    normRms(x, 0.25);
  } else { let y = 0; for (let i = 0; i < n; i++) { y = 0.985 * y + (r() * 2 - 1) * 0.1; x[i] = y; } onePoleHP(x, 15, sr); normRms(x, 0.25); }
  return fadeLoop(x, 2048);
}
export function synthDust(seconds, sr, density, seed) {
  const r = C.rng(seed), x = new Float32Array(Math.round(seconds * sr)), p = density / sr;
  for (let i = 0; i < x.length; i++) if (r() < p) { const a = (r() * 2 - 1); const L = Math.min(x.length - i, 48); for (let k = 0; k < L; k++) x[i + k] += a * Math.exp(-k / 6); }
  return normPeak(x, 0.9);
}
export function synthRain(seconds, sr, seed) {
  const r = C.rng(seed), n = Math.round(seconds * sr) + 4096, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (r() * 2 - 1) * 0.3;
  onePoleHP(x, 700, sr); onePoleLP(x, 9000, sr);
  const drops = Math.round(seconds * 160);
  for (let d = 0; d < drops; d++) { // טיפות: טיק קצר + צליל זעיר
    const at = Math.floor(r() * (n - 600)), a = 0.15 + 0.6 * r() * r(), f = 2500 + 4000 * r(), dec = 0.0015 + 0.004 * r();
    for (let k = 0; k < 600; k++) { const t = k / sr; x[at + k] += a * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t); }
  }
  return normPeak(fadeLoop(x, 4096), 0.9);
}
export function synthFootstep(surface, variant, sr, seed) {
  const S = C.SURFACES[C.surfaceOf(surface)], r = C.rng(seed + variant * 101 + surface.length * 7);
  const n = Math.round(0.4 * sr), x = new Float32Array(n);
  const burst = (t0, amp) => {
    const i0 = Math.floor(t0 * sr), dec = S.decay * (0.85 + 0.3 * r()), L = Math.min(n - i0, Math.floor(dec * sr * 5));
    const nz = new Float32Array(L);
    for (let k = 0; k < L; k++) nz[k] = (r() * 2 - 1) * Math.exp(-k / (dec * sr)) * (k < sr * 0.002 ? k / (sr * 0.002) : 1);
    if (S.grit > 0) for (let k = 0; k < L; k++) if (r() < S.grit * 0.02) { const a = (r() * 2 - 1) * 1.5 * Math.exp(-k / (dec * sr * 1.4)); for (let j = 0; j < 30 && k + j < L; j++) nz[k + j] += a * Math.exp(-j / 4); }
    onePoleLP(nz, S.lp * (0.9 + 0.2 * r()), sr); onePoleHP(nz, S.hp, sr);
    const tf = S.thump * (0.9 + 0.2 * r());
    for (let k = 0; k < L; k++) {
      const t = k / sr; let v = nz[k] * 2.2 + S.thumpAmt * Math.sin(2 * Math.PI * tf * t) * Math.exp(-t / 0.018);
      if (S.ring) v += S.ring * Math.exp(-t / 0.12) * (Math.sin(2 * Math.PI * 1270 * t) * 0.5 + Math.sin(2 * Math.PI * 2930 * t) * 0.3 + Math.sin(2 * Math.PI * 4190 * t) * 0.2);
      if (S.bubbles) for (let b = 0; b < 3; b++) { const tb = t - 0.02 * b - 0.01; if (tb > 0 && tb < 0.04) v += 0.3 * Math.sin(2 * Math.PI * (350 + 600 * b + 18000 * tb) * tb) * Math.exp(-tb / 0.012); }
      x[i0 + k] += v * amp;
    }
  };
  burst(0.003, 1); burst(0.05 + 0.03 * r(), 0.45 + 0.2 * r()); // עקב ואז אצבעות
  return normPeak(x, 0.85 * S.gain);
}
function synthClank(sr, seed) {
  const r = C.rng(seed), n = Math.round(1.6 * sr), x = new Float32Array(n), f0 = 180 + 160 * r();
  const parts = [[1, 1, 0.5], [2.76, 0.6, 0.35], [5.4, 0.4, 0.2], [8.93, 0.25, 0.12]];
  for (let i = 0; i < n; i++) { const t = i / sr; let v = 0; for (const [m, a, d] of parts) v += a * Math.exp(-t / d) * Math.sin(2 * Math.PI * f0 * m * t); v += (r() * 2 - 1) * Math.exp(-t / 0.01) * 0.8; x[i] = v; }
  return normPeak(x, 0.8);
}
function synthHorn(sr) { // צופר אונייה: שני מסורים מכוונים מעט אחרת (חבטה איטית) דרך low-pass
  const n = Math.round(3.2 * sr), x = new Float32Array(n), f = 92; let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, env = Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (3.0 - t) / 0.5)); p1 = (p1 + f / sr) % 1; p2 = (p2 + f * 1.006 / sr) % 1; x[i] = (p1 + p2 - 1) * env; }
  onePoleLP(x, 900, sr); onePoleLP(x, 1400, sr); return normPeak(x, 0.85);
}
function synthUI(name, sr) {
  const len = name === 'click' ? 0.06 : 0.6, n = Math.round(len * sr), x = new Float32Array(n);
  const tones = name === 'click' ? [[2000, 0, 0.012]] : name === 'confirm' ? [[660, 0, 0.12], [990, 0.09, 0.2]] : [[880, 0, 0.18], [1320, 0.14, 0.3]];
  for (let i = 0; i < n; i++) { const t = i / sr; let v = 0; for (const [f, t0, d] of tones) if (t >= t0) v += Math.sin(2 * Math.PI * f * (t - t0)) * Math.exp(-(t - t0) / d) * Math.min(1, (t - t0) / 0.003); x[i] = v; }
  return normPeak(x, 0.5);
}
export function synthChatter(sr, seed) { // "קשר רדיו" סינתטי (לא דיבור אמיתי) — מדגים את אפיק voice וה-ducking
  const r = C.rng(seed), n = Math.round(1.8 * sr), src = new Float32Array(n);
  let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr, f = 125 + 18 * Math.sin(2 * Math.PI * 1.3 * t) + 10 * Math.sin(2 * Math.PI * 4.7 * t); ph += f / sr; src[i] = 2 * (ph % 1) - 1; }
  const out = new Float32Array(n), seg = Math.round(0.19 * sr);
  for (let s = 0; s * seg < n; s++) {
    const a = src.slice(s * seg, Math.min(n, (s + 1) * seg + 64)), b = a.slice();
    biquadBP(a, 400 + 500 * r(), 4, sr); biquadBP(b, 1000 + 1200 * r(), 5, sr);
    const amp = r() < 0.18 ? 0 : 0.6 + 0.4 * r();
    for (let k = 0; k < a.length && s * seg + k < n; k++) { const e = Math.sin(Math.PI * Math.min(1, k / seg)); out[s * seg + k] += (a[k] + 0.7 * b[k]) * amp * e; }
  }
  onePoleHP(out, 300, sr); onePoleLP(out, 3400, sr);
  for (let i = 0; i < n; i++) out[i] += (r() * 2 - 1) * 0.004;
  return normPeak(out, 0.7);
}

function softClipCurve(n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x); c[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28)); }
  return c;
}
function tanhCurve(drive, n = 1024) { const c = new Float32Array(n), k = Math.tanh(drive); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) / k; } return c; }
function pulseCurve(n = 1024, start = 0.35, pow = 3) { const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.pow(Math.max(0, (x - start) / (1 - start)), pow); } return c; }

// ======================= קול (Voice) =======================
let VID = 0;
class Voice {
  constructor(eng, kind, bus, { positional = true, spatial = {} } = {}) {
    this.eng = eng; this.kind = kind; this.bus = bus; this.positional = positional; this.spatial = spatial;
    this.id = kind + '#' + (++VID); this.built = false; this.score = 0; this.dist = 0; this.mem = {};
  }
  build() {
    const ctx = this.eng.ctx; this.nodes = []; this.srcs = []; this.mem = {};
    this.out = this.gain(0); this.lp = this.filt('lowpass', 20000, 0.5);
    this.out.connect(this.lp);
    if (this.positional) {
      const p = this.pan = ctx.createPanner(); this.nodes.push(p);
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = this.spatial.ref || 1; p.maxDistance = this.spatial.max || 10000; p.rolloffFactor = 1;
      this.lp.connect(p); p.connect(this.eng.buses[this.bus].in);
    } else this.lp.connect(this.eng.buses[this.bus].in);
    this.g = GRAPHS[this.kind].build(this, ctx);
    const t = ctx.currentTime; for (const s of this.srcs) s.start(t);
    this.built = true; this.hrtf = false;
  }
  teardown() {
    if (!this.built) return;
    for (const s of this.srcs) { try { s.stop(); } catch (e) {} }
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) {} }
    this.nodes = this.srcs = []; this.g = null; this.pan = null; this.built = false;
  }
  // ---- עוזרים לבניית גרף ----
  track(n) { this.nodes.push(n); return n; }
  osc(type, f) { const o = this.track(this.eng.ctx.createOscillator()); o.type = type; o.frequency.value = f; this.srcs.push(o); return o; }
  noise(name, rate = 1) { const s = this.track(this.eng.ctx.createBufferSource()); s.buffer = this.eng.buf(name); s.loop = true; s.playbackRate.value = rate; this.srcs.push(s); return s; }
  filt(type, f, Q = 0.707) { const b = this.track(this.eng.ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }
  gain(v) { const g = this.track(this.eng.ctx.createGain()); g.gain.value = v; return g; }
  shaper(curve) { const w = this.track(this.eng.ctx.createWaveShaper()); w.curve = curve; return w; }
  chain(...ns) { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; }
  set(param, v, tc = 0.04) { if (Number.isFinite(v)) param.setTargetAtTime(v, this.eng.ctx.currentTime, tc); }
}

// ---- גרפים לכל סוג קול: build(v, ctx) → אובייקט צמתים, update(v, g, st, dt, dop) ----
const GRAPHS = {
  car: {
    build(v) {
      const o1 = v.osc('sawtooth', 30), o2 = v.osc('square', 15), g2 = v.gain(0.35), n = v.noise('white');
      const bp = v.filt('bandpass', 600, 1.2), gi = v.gain(0), mix = v.gain(0.8), ws = v.shaper(tanhCurve(2.5)), lp = v.filt('lowpass', 800, 0.9), eng = v.gain(0.4);
      o1.connect(mix); v.chain(o2, g2, mix); v.chain(n, bp, gi, mix); v.chain(mix, ws, lp, eng, v.out);
      const tlp = v.filt('lowpass', 700), tg = v.gain(0); v.chain(n, tlp, tg, v.out);
      return { o1, o2, n, bp, gi, lp, eng, tg };
    },
    update(v, g, st, dt, dop) {
      const r = C.carRpm(st.speed, st.throttle, v.mem.gear || 1); v.mem.gear = r.gear; v.mem.rpm = r.rpm;
      const f = C.firingHz4(r.rpm) * dop, th = st.throttle;
      v.set(g.o1.frequency, f); v.set(g.o2.frequency, f / 2); v.set(g.bp.frequency, Math.min(8000, f * 7)); v.set(g.n.playbackRate, dop);
      v.set(g.gi.gain, 0.18 * th); v.set(g.lp.frequency, 300 + r.rpm * 0.35 + th * 1800); v.set(g.eng.gain, 0.18 + 0.2 * th);
      v.set(g.tg.gain, C.clamp(st.speed / 40, 0, 1) * 0.35);
    },
  },
  helicopter: {
    build(v) {
      const n = v.noise('white'), bp = v.filt('bandpass', 500, 0.8), slap = v.gain(0.05);
      const mod = v.osc('sawtooth', 26), ws = v.shaper(pulseCurve(1024, 0.3, 3)), depth = v.gain(0.9);
      v.chain(n, bp, slap, v.out); v.chain(mod, ws, depth, slap.gain);
      const th = v.osc('sine', 78), thg = v.gain(0.0), thlp = v.filt('lowpass', 200); v.chain(th, thg, thlp, v.out); depth.connect(thg.gain);
      const tail = v.osc('square', 140), tdepth = v.gain(0.06), tbp = v.filt('bandpass', 1800, 1.5), tg = v.gain(0.08);
      v.chain(n, tbp, tg, v.out); v.chain(tail, tdepth, tg.gain);
      const wh = v.osc('sine', 1800), wg = v.gain(0.02); v.chain(wh, wg, v.out);
      return { n, bp, mod, th, tail, wh, wg, slapOut: v.out };
    },
    update(v, g, st, dt, dop) {
      v.mem.spool = st.running === false ? Math.max(0, (v.mem.spool ?? 1) - dt / 10) : Math.min(1, (v.mem.spool ?? 1) + dt / 8);
      const sp = v.mem.spool, rpm = C.heliRotorRpm(st.collective, sp), bpf = C.bladePassHz(rpm) * dop;
      v.set(g.mod.frequency, Math.max(0.1, bpf)); v.set(g.th.frequency, 78 * dop * (0.6 + 0.4 * sp));
      v.set(g.tail.frequency, Math.max(0.1, bpf * C.HELI.tailRatio * C.HELI.tailBlades / C.HELI.blades));
      v.set(g.wh.frequency, (900 + 900 * sp) * dop); v.set(g.wg.gain, 0.02 * sp);
      v.set(g.bp.frequency, (380 + 420 * st.collective) * dop); v.set(g.n.playbackRate, dop);
      v.mem.level = 0.9 * sp;
    },
  },
  jet: {
    build(v) {
      const n = v.noise('white'), lpR = v.filt('lowpass', 800, 0.6), gR = v.gain(0.3); v.chain(n, lpR, gR, v.out);
      const w1 = v.osc('sine', 1500), w2 = v.osc('sine', 2200), gw = v.gain(0.03), gw2 = v.gain(0.015);
      v.chain(w1, gw, v.out); v.chain(w2, gw2, v.out);
      const lpA = v.filt('lowpass', 220, 0.9), gA = v.gain(0); v.chain(n, lpA, gA, v.out);
      const dust = v.noise('dust'), hpC = v.filt('highpass', 1500), gC = v.gain(0); v.chain(dust, hpC, gC, v.out);
      return { n, lpR, gR, w1, w2, gw, gw2, gA, gC, dust };
    },
    update(v, g, st, dt, dop) {
      v.mem.n1 = C.jetSpool(v.mem.n1 ?? 0.2, st.throttle, dt); const n1 = v.mem.n1;
      const ab = st.afterburner ? 1 : 0;
      v.set(g.lpR.frequency, (300 + 3200 * n1) * Math.min(1.5, dop)); v.set(g.gR.gain, 0.2 + 0.45 * n1);
      const wf = C.jetWhineHz(n1) * dop; v.set(g.w1.frequency, wf); v.set(g.w2.frequency, wf * 1.47);
      v.set(g.gw.gain, 0.03 * n1); v.set(g.gw2.gain, 0.015 * n1);
      v.set(g.gA.gain, 1.1 * ab, 0.15); v.set(g.gC.gain, 0.35 * ab, 0.15); v.set(g.n.playbackRate, dop); v.set(g.dust.playbackRate, dop);
    },
  },
  drone: {
    build(v) {
      const lp = v.filt('lowpass', 2600, 0.8), mix = v.gain(1); v.chain(mix, lp, v.out);
      const os = [0, 1, 2, 3].map(() => { const o = v.osc('sawtooth', 300), gg = v.gain(0.1); v.chain(o, gg, mix); return o; });
      const n = v.noise('white'), bp = v.filt('bandpass', 1400, 0.6), gN = v.gain(0.05); v.chain(n, bp, gN, v.out);
      return { os, gN, n };
    },
    update(v, g, st, dt, dop) {
      const det = [1, 1.013, 0.991, 1.021];
      const m = Array.isArray(st.motors) && st.motors.length === 4 ? st.motors : [st.thrust, st.thrust, st.thrust, st.thrust];
      let avg = 0; g.os.forEach((o, i) => { v.set(o.frequency, C.droneMotorHz(m[i]) * det[i] * dop, 0.03); avg += m[i] / 4; });
      v.set(g.gN.gain, 0.05 + 0.22 * avg); v.set(g.n.playbackRate, dop);
    },
  },
  spaceship: {
    build(v) {
      const o1 = v.osc('sine', 48), o2 = v.osc('sine', 72), o3 = v.osc('sawtooth', 96), lp = v.filt('lowpass', 300, 2);
      const lfo = v.osc('sine', 0.23), lg = v.gain(120); v.chain(lfo, lg, lp.frequency);
      const g1 = v.gain(0.18), g2 = v.gain(0.12), g3 = v.gain(0.45); v.chain(o1, g1, v.out); v.chain(o2, g2, v.out); v.chain(o3, lp, g3, v.out);
      const n = v.noise('pink'), bp = v.filt('bandpass', 900, 0.5), gW = v.gain(0); v.chain(n, bp, gW, v.out);
      return { o1, o2, o3, lp, gW, n };
    },
    update(v, g, st, dt, dop) {
      const f = C.spaceshipHz(st.throttle) * dop;
      v.set(g.o1.frequency, f); v.set(g.o2.frequency, f * 1.505); v.set(g.o3.frequency, f * 2);
      v.set(g.lp.frequency, 200 + 700 * st.throttle); v.set(g.gW.gain, C.clamp(st.speed / 200, 0, 1) * 0.5); v.set(g.n.playbackRate, dop);
    },
  },
  boat: {
    build(v) {
      const o1 = v.osc('square', 45), o2 = v.osc('sawtooth', 90), g2 = v.gain(0.3), mix = v.gain(0.7), ws = v.shaper(tanhCurve(2)), lp = v.filt('lowpass', 900, 1.1), eng = v.gain(0.3);
      o1.connect(mix); v.chain(o2, g2, mix); v.chain(mix, ws, lp, eng, v.out);
      const n = v.noise('white'), bp = v.filt('bandpass', 500, 0.7), gWa = v.gain(0), hp = v.filt('highpass', 3000), gSp = v.gain(0);
      v.chain(n, bp, gWa, v.out); v.chain(n, hp, gSp, v.out);
      return { o1, o2, lp, eng, gWa, gSp, n };
    },
    update(v, g, st, dt, dop) {
      const rpm = C.boatRpm(st.throttle), f = C.firingHz2(rpm, C.BOAT.cylinders) * dop; v.mem.rpm = rpm;
      v.set(g.o1.frequency, f); v.set(g.o2.frequency, f * 2); v.set(g.lp.frequency, 600 + 2000 * st.throttle); v.set(g.eng.gain, 0.13 + 0.15 * st.throttle);
      v.mem.t = (v.mem.t || 0) + dt; const slosh = 0.7 + 0.3 * Math.sin(v.mem.t * 2.1) * Math.sin(v.mem.t * 0.7 + 1);
      const s = C.clamp(st.speed / 15, 0, 1); v.set(g.gWa.gain, s * 0.25 * slosh + 0.02); v.set(g.gSp.gain, s * s * 0.12); v.set(g.n.playbackRate, dop);
    },
  },
  jetpack: {
    build(v) {
      const n = v.noise('white'), bp = v.filt('bandpass', 800, 0.6), gR = v.gain(0), lp = v.filt('lowpass', 160), gL = v.gain(0);
      v.chain(n, bp, gR, v.out); v.chain(n, lp, gL, v.out);
      const d = v.noise('dust'), hp = v.filt('highpass', 2500), gC = v.gain(0); v.chain(d, hp, gC, v.out);
      return { n, d, bp, gR, gL, gC };
    },
    update(v, g, st, dt, dop) {
      const t = C.clamp(st.thrust, 0, 1);
      v.set(g.bp.frequency, (600 + 900 * t) * dop); v.set(g.gR.gain, 0.08 + 0.55 * t); v.set(g.gL.gain, 0.9 * t); v.set(g.gC.gain, 0.25 * t);
      v.set(g.n.playbackRate, dop); v.set(g.d.playbackRate, dop);
    },
  },
  // ---------- אווירה ----------
  wind: {
    build(v) {
      const n = v.noise('pink'), bp = v.filt('bandpass', 500, 0.9), g1 = v.gain(1); v.chain(n, bp, g1, v.out);
      const bp2 = v.filt('bandpass', 1400, 9), g2 = v.gain(0); v.chain(n, bp2, g2, v.out);
      return { bp, bp2, g2 };
    },
    update(v, g, st) {
      const p = st.wp; v.set(g.bp.frequency, p.cutoff, 0.2); v.set(g.bp2.frequency, 900 + 60 * p.v, 0.3); v.set(g.g2.gain, p.whistle, 0.3);
    },
  },
  rain: {
    build(v) { const s = v.noise('rain'), hp = v.filt('highpass', 400); v.chain(s, hp, v.out); return {}; },
    update() {},
  },
  waves: {
    build(v) { const n = v.noise('brown'), lp = v.filt('lowpass', 1500, 0.6), env = v.gain(0.5); const n2 = v.noise('pink'), hp = v.filt('bandpass', 2500, 0.5), wash = v.gain(0); v.chain(n, lp, env, v.out); v.chain(n2, hp, wash, v.out); return { lp, env, wash }; },
    update(v, g, st) {
      const T = 9.5, ph = (st.t / T) % 1, crash = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, ph / 0.55))), 2);
      const washE = ph > 0.35 ? Math.exp(-(ph - 0.35) * 5) : 0;
      v.set(g.env.gain, 0.35 + 1.2 * crash, 0.15); v.set(g.wash.gain, 0.6 * washE * (st.cutoff / 4200), 0.2); v.set(g.lp.frequency, st.cutoff * (0.5 + 0.5 * crash), 0.2);
    },
  },
  traffic: {
    build(v) { const n = v.noise('brown'), lp = v.filt('lowpass', 380, 0.7), g1 = v.gain(1), n2 = v.noise('pink'), bp = v.filt('bandpass', 1100, 0.6), g2 = v.gain(0.2); v.chain(n, lp, g1, v.out); v.chain(n2, bp, g2, v.out); return { g1 }; },
    update(v, g, st) { v.set(g.g1.gain, 0.8 + 0.4 * st.mod, 0.5); },
  },
  birds: {
    build(v) { const o = v.osc('sine', 3000), g = v.gain(0), sp = v.eng.ctx.createStereoPanner ? v.track(v.eng.ctx.createStereoPanner()) : null; if (sp) v.chain(o, g, sp, v.out); else v.chain(o, g, v.out); return { o, g, sp }; },
    update(v, g, st) { // מתזמן ציוץ: סדרות של 2–6 הברות, מרווח 0.6–4 ש'
      const ctx = v.eng.ctx, now = ctx.currentTime, r = v.eng.rand;
      if (v.mem.next == null) v.mem.next = now + 0.3;
      if (now + 0.15 < v.mem.next) return;
      let t = Math.max(now + 0.02, v.mem.next); const syl = 2 + Math.floor(r() * 5), base = 2600 + 2600 * r(), sweep = (r() - 0.4) * 2400;
      if (g.sp) g.sp.pan.setValueAtTime(r() * 1.6 - 0.8, t);
      for (let i = 0; i < syl; i++) {
        const d = 0.04 + 0.08 * r();
        g.o.frequency.setValueAtTime(base, t); g.o.frequency.linearRampToValueAtTime(Math.max(800, base + sweep * (0.6 + 0.6 * r())), t + d);
        g.g.gain.setValueAtTime(0, t); g.g.gain.linearRampToValueAtTime(0.25, t + 0.008); g.g.gain.linearRampToValueAtTime(0, t + d);
        t += d + 0.03 + 0.06 * r();
      }
      v.mem.next = t + 0.6 + 3.4 * r();
    },
  },
  port: {
    build(v) { const n = v.noise('brown'), lp = v.filt('lowpass', 140, 0.8), g1 = v.gain(1.2), o = v.osc('sine', 50), g2 = v.gain(0.06), o2 = v.osc('sine', 100.7), g3 = v.gain(0.03); v.chain(n, lp, g1, v.out); v.chain(o, g2, v.out); v.chain(o2, g3, v.out); return {}; },
    update(v, g, st) { // אירועי מנופים וצופרים (one-shot) — מתוזמנים כאן
      const now = v.eng.ctx.currentTime, r = v.eng.rand;
      if (v.mem.clank == null) { v.mem.clank = now + 1 + 3 * r(); v.mem.horn = now + 6 + 20 * r(); }
      const pos = st.point || null, lvl = st.level;
      if (now >= v.mem.clank) { v.eng._oneShot('clank' + (Math.floor(r() * 3)), 'ambience', { pos, gain: 0.5 * lvl, ref: 40, priority: 2 }); v.mem.clank = now + 3 + 8 * r(); }
      if (now >= v.mem.horn) { v.eng._oneShot('horn', 'ambience', { pos, gain: 0.6 * lvl, ref: 150, priority: 2.5 }); v.mem.horn = now + 40 + 50 * r(); }
    },
  },
};

// ======================= המנוע =======================
export function createAudio(opts = {}) {
  const O = {
    maxVoices: 16, shabbat: false, shabbatAllowed: C.SHABBAT_ALLOWED, seed: 27, volume: 0.9,
    hrtf: 'auto', occlusionHz: 10, ctx: null, autoVisibility: true, ...opts,
  };
  const eng = {
    ctx: null, buses: {}, unlocked: false, userMuted: false, shabbat: !!O.shabbat, rand: C.rng(O.seed),
    entries: [], amb: {}, oneShots: [], env: { weather: C.weatherToAudio({}), area: { traffic: 0, park: 0, port: 0 }, shoreDist: Infinity, buildings: null, occlusion: null },
    listener: { x: 0, y: 1.7, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0 }, listenerSet: false,
    t: 0, stat: { updates: 0, updMsSum: 0, updMsMax: 0, stolen: 0, dropped: 0 }, _bufs: {}, prevActive: new Set(),
  };
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
  const hrtfMax = O.hrtf === false ? 0 : typeof O.hrtf === 'number' ? O.hrtf : isMobile ? 2 : 4;

  eng.buf = name => {
    if (eng._bufs[name]) return eng._bufs[name];
    const ctx = eng.ctx, sr = ctx.sampleRate, s = O.seed;
    let b;
    if (name === 'white') b = toBuffer(ctx, synthNoise('white', 3, sr, s + 1), sr);
    else if (name === 'pink') b = toBuffer(ctx, synthNoise('pink', 6, 24000, s + 2), 24000);
    else if (name === 'brown') b = toBuffer(ctx, synthNoise('brown', 7, 16000, s + 3), 16000);
    else if (name === 'dust') b = toBuffer(ctx, synthDust(2, sr, 260, s + 4), sr);
    else if (name === 'rain') b = toBuffer(ctx, synthRain(4, sr, s + 5), sr);
    else if (name.startsWith('step:')) { const [, surf, vv] = name.split(':'); b = toBuffer(ctx, synthFootstep(surf, +vv, sr, s + 6), sr); }
    else if (name.startsWith('clank')) b = toBuffer(ctx, synthClank(22050, s + 7 + +name.slice(5)), 22050);
    else if (name === 'horn') b = toBuffer(ctx, synthHorn(22050), 22050);
    else if (name === 'chatter') b = toBuffer(ctx, synthChatter(sr, s + 9), sr);
    else if (name.startsWith('ui:')) b = toBuffer(ctx, synthUI(name.slice(3), sr), sr);
    else throw new Error('unknown buffer ' + name);
    return (eng._bufs[name] = b);
  };

  function setupCtx(ctx) {
    eng.ctx = ctx;
    const master = eng.master = ctx.createGain(); master.gain.value = 0; // מושתק עד unlock()
    const comp = eng.comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.25;
    const clip = ctx.createWaveShaper(); clip.curve = softClipCurve();
    master.connect(comp); comp.connect(clip); clip.connect(ctx.destination);
    for (const b of C.BUSES) {
      const inn = ctx.createGain(), duck = ctx.createGain(), mask = ctx.createGain();
      inn.gain.value = { engines: 0.8, ambience: 0.7, ui: 0.6, voice: 0.9, music: 0.5 }[b];
      mask.gain.value = C.busAllowed(b, eng.shabbat, O.shabbatAllowed) ? 1 : 0;
      inn.connect(duck); duck.connect(mask); mask.connect(master);
      eng.buses[b] = { in: inn, duck, mask, duckUntil: 0 };
    }
    for (const k of ['wind', 'rain', 'waves', 'traffic', 'birds', 'port']) eng.amb[k] = new Voice(eng, k, 'ambience', { positional: false, spatial: { ref: 30, max: 5000 } });
    if (O.autoVisibility && !isOffline(ctx) && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) ctx.suspend?.();
        else if (eng.unlocked && !eng.userMuted) ctx.resume?.();
      });
    }
  }
  if (O.ctx) setupCtx(O.ctx);

  function ensureCtx() {
    if (eng.ctx) return eng.ctx;
    const A = AC(); if (!A) return null;
    setupCtx(new A({ latencyHint: 'playback' })); // latency גבוה = פחות התעוררויות CPU = חוסך סוללה
    return eng.ctx;
  }

  // ---------- מצב, נרמול ----------
  function normState(e, raw, dt) {
    const s = raw || {};
    const p = s.position || s.pos || s;
    const x = +p.x || 0, y = +p.y || 0, z = +p.z || 0;
    let vx = s.vx, vy = s.vy, vz = s.vz;
    if (s.velocity || s.vel) { const q = s.velocity || s.vel; vx = q.x; vy = q.y; vz = q.z; }
    if (vx == null) { // נגזרת מספרית
      if (e.prev && dt > 0) { vx = (x - e.prev.x) / dt; vy = (y - e.prev.y) / dt; vz = (z - e.prev.z) / dt; } else { vx = vy = vz = 0; }
    }
    e.prev = { x, y, z };
    const speed = s.speed != null ? Math.abs(+s.speed) : Math.hypot(vx, vy, vz);
    const throttle = C.clamp(s.throttle ?? s.collective ?? s.thrust ?? Math.min(1, speed / 30), 0, 1);
    return {
      x, y, z, vx: +vx || 0, vy: +vy || 0, vz: +vz || 0, speed, throttle,
      collective: C.clamp(s.collective ?? throttle, 0, 1), thrust: C.clamp(s.thrust ?? throttle, 0, 1), motors: s.motors,
      afterburner: !!s.afterburner, running: s.running, surface: s.surface, onGround: s.onGround !== false, sprint: !!s.running && e.mode === 'walk',
    };
  }

  function occlusionFor(src, lis) {
    const env = eng.env;
    if (typeof env.occlusion === 'function') return +env.occlusion(src, lis) || 0;
    if (env.buildings) {
      const b = typeof env.buildings === 'function' ? env.buildings(src, lis) : env.buildings;
      return C.countOccluders(src, lis, b);
    }
    return 0;
  }

  // ---------- one-shots ----------
  eng._oneShot = (bufName, bus, { pos = null, gain = 1, ref = 2, max = 500, priority = 1, rate = 1, pan = null } = {}) => {
    const ctx = eng.ctx; if (!ctx || !eng.unlocked) return false;
    if (!C.busAllowed(bus, eng.shabbat, O.shabbatAllowed)) return false;
    const now = ctx.currentTime; eng.oneShots = eng.oneShots.filter(o => o.end > now);
    const L = eng.listener; let score = priority * gain;
    if (pos) { const d = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z); score *= C.distanceGain(d, { ref, max }); }
    if (score < 1e-3) return false;
    const built = activeVoices();
    if (built.length + eng.oneShots.length >= O.maxVoices) { // תקציב מלא: גונבים את הקול החלש ביותר אם הוא חלש יותר
      const weakest = built.sort((a, b) => a.score - b.score)[0];
      if (!weakest || weakest.score >= score) { eng.stat.dropped++; return false; }
      weakest.teardown(); eng.prevActive.delete(weakest.id); eng.stat.stolen++;
    }
    const b = eng.buf(bufName), s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain; s.connect(g);
    let last = g;
    if (pos) { const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = max; setPos(p, pos); g.connect(p); last = p; }
    else if (pan != null && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); last = p; }
    last.connect(eng.buses[bus].in);
    s.start(now); const end = now + b.duration / rate;
    s.onended = () => { try { last.disconnect(); g.disconnect(); } catch (e) {} };
    eng.oneShots.push({ end, bus });
    return { end };
  };
  function setPos(p, q) {
    if (p.positionX) { p.positionX.value = q.x; p.positionY.value = q.y; p.positionZ.value = q.z; } else p.setPosition(q.x, q.y, q.z);
  }
  const activeVoices = () => [...eng.entries.map(e => e.voice).filter(Boolean), ...Object.values(eng.amb)].filter(v => v.built);

  // ---------- ducking ----------
  function duck(targets, untilT, now) {
    for (const [b, db] of Object.entries(targets)) {
      const B = eng.buses[b]; B.duck.gain.setTargetAtTime(C.dbToGain(db), now, 0.06);
      B.duckUntil = Math.max(B.duckUntil, untilT); B.duck.gain.setTargetAtTime(1, B.duckUntil, 0.35);
    }
  }

  // ---------- עדכון לפריים ----------
  function update(dt = 1 / 60) {
    const ctx = eng.ctx; if (!ctx) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    dt = C.clamp(dt, 0, 0.25); eng.t += dt;
    const L = eng.listener, env = eng.env;
    // מאזין ברירת מחדל = רכב השחקן
    const player = eng.entries.find(e => e.opts.player);
    const states = eng.entries.map(e => normState(e, safeCall(e.stateFn), dt));
    if (!eng.listenerSet && player) { const s = states[eng.entries.indexOf(player)]; Object.assign(L, { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz }); }
    const lis = { x: L.x, y: L.y, z: L.z }, lisV = { x: L.vx, y: L.vy, z: L.vz };
    const candidates = [];
    eng.entries.forEach((e, i) => {
      const st = e.state = states[i];
      e.dist = Math.hypot(st.x - lis.x, st.y - lis.y, st.z - lis.z);
      e.dop = e.opts.doppler === false ? 1 : C.dopplerFactor(st, { x: st.vx, y: st.vy, z: st.vz }, lis, lisV);
      e.occT = (e.occT || 0) - dt;
      if (e.occT <= 0) { e.occ = e.opts.player && e.dist < 15 ? 0 : occlusionFor(st, lis); e.occT = 1 / O.occlusionHz; }
      if (e.mode === 'walk') return stepper(e, st, dt);
      const sp = C.VEHICLE_SPATIAL[e.mode];
      const allowed = C.busAllowed('engines', eng.shabbat, O.shabbatAllowed) ? 1 : 0;
      const loud = sp.loud * (0.45 + 0.55 * st.throttle) * (e.mode === 'helicopter' && st.running === false ? 0.3 : 1);
      e.voice.score = allowed * (e.opts.priority ?? (e.opts.player ? 10 : sp.priority)) * loud * C.distanceGain(e.dist, { ref: sp.ref, max: sp.max }) * C.occlusionGain(e.occ);
      e.voice.dist = e.dist; candidates.push({ id: e.voice.id, score: e.voice.score });
    });
    // אווירה
    const w = env.weather, ambAllowed = C.busAllowed('ambience', eng.shabbat, O.shabbatAllowed) ? 1 : 0;
    eng.gustN = eng.gustN || C.smoothNoise(O.seed + 11);
    const wp = C.windParams(w.wind, w.gust, Math.pow(eng.gustN(eng.t * 0.35), 2));
    const wv = C.waveParams(env.shoreDist);
    const A = env.area, trafficMod = eng.gustN(eng.t * 0.08 + 40);
    const ambState = {
      wind: { level: wp.gain, wp }, rain: { level: C.rainGain(w.rain) },
      waves: { level: wv.gain, cutoff: wv.cutoff, t: eng.t },
      traffic: { level: 0.32 * A.traffic * (w.day ? 1 : 0.55), mod: trafficMod },
      birds: { level: w.day && w.rain < 0.3 ? 0.5 * A.park * (1 - C.clamp(w.wind / 14, 0, 1)) : 0 },
      port: { level: 0.4 * A.port, point: env.portPoint || null },
    };
    for (const [k, v] of Object.entries(eng.amb)) { v.score = ambAllowed * 3 * ambState[k].level; candidates.push({ id: v.id, score: v.score }); }

    // הקצאה
    const now = ctx.currentTime; eng.oneShots = eng.oneShots.filter(o => o.end > now);
    const { active } = C.allocateVoices(candidates, { max: O.maxVoices, prevActive: eng.prevActive, fixed: eng.oneShots.length });
    const all = [...eng.entries.filter(e => e.voice).map(e => e.voice), ...Object.values(eng.amb)];
    for (const v of all) { if (!active.has(v.id) && v.built) v.teardown(); }
    if (eng.unlocked) for (const v of all) { if (active.has(v.id) && !v.built) v.build(); }
    eng.prevActive = new Set(all.filter(v => v.built).map(v => v.id));

    // HRTF ל-K הקרובים
    const pos = eng.entries.filter(e => e.voice && e.voice.built && e.voice.pan).sort((a, b) => a.dist - b.dist);
    pos.forEach((e, i) => { const want = i < hrtfMax && !(e.opts.player && e.opts.spatial === false); if (want !== e.voice.hrtf) { e.voice.pan.panningModel = want ? 'HRTF' : 'equalpower'; e.voice.hrtf = want; } });

    for (const e of eng.entries) {
      const v = e.voice; if (!v || !v.built) continue; const st = e.state;
      if (v.pan) setPos(v.pan, st);
      v.set(v.lp.frequency, Math.min(C.airAbsorptionCutoff(e.dist), C.occlusionCutoff(e.occ)), 0.08);
      GRAPHS[e.mode].update(v, v.g, st, dt, e.dop);
      v.set(v.out.gain, (v.mem.level ?? 1) * C.occlusionGain(e.occ) * (e.opts.gain ?? 1), 0.08);
    }
    for (const [k, v] of Object.entries(eng.amb)) {
      if (!v.built) continue;
      GRAPHS[k].update(v, v.g, ambState[k], dt, 1);
      v.set(v.out.gain, ambState[k].level, k === 'birds' ? 0.05 : 0.4);
    }
    // מאזין
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = L.x; l.positionY.value = L.y; l.positionZ.value = L.z;
      l.forwardX.value = L.fx; l.forwardY.value = L.fy; l.forwardZ.value = L.fz; l.upX.value = L.ux; l.upY.value = L.uy; l.upZ.value = L.uz;
    } else { l.setPosition(L.x, L.y, L.z); l.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz); }

    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    eng.stat.updates++; eng.stat.updMsSum += ms; eng.stat.updMsMax = Math.max(eng.stat.updMsMax, ms);
  }
  function safeCall(f) { try { return f(); } catch (e) { return {}; } }

  function stepper(e, st, dt) { // צעדים: צבירת מרחק אופקי → צעד; משטח מהמצב או מהסביבה
    if (!st.onGround) { e.stepAcc = 0; return; }
    const hs = Math.hypot(st.vx, st.vz) || (st.speed || 0);
    if (hs < 0.3) { e.stepAcc = Math.min(e.stepAcc || 0, 0.3); return; }
    e.stepAcc = (e.stepAcc || 0) + hs * dt;
    const stride = C.strideLength(hs);
    if (e.stepAcc >= stride) {
      e.stepAcc -= stride; e.foot = (e.foot || 0) ^ 1;
      const surf = C.surfaceOf(st.surface || eng.env.surface || 'asphalt'), vv = Math.floor(eng.rand() * 3);
      const gain = (e.opts.gain ?? 1) * C.clamp(0.55 + hs / 8, 0.5, 1.1) * C.occlusionGain(e.occ);
      const rate = 0.94 + 0.12 * eng.rand();
      if (e.opts.player) eng._oneShot(`step:${surf}:${vv}`, 'ambience', { gain, pan: e.foot ? 0.12 : -0.12, priority: 6, rate });
      else eng._oneShot(`step:${surf}:${vv}`, 'ambience', { gain, pos: st, ref: 1.5, max: 60, priority: 1, rate });
    }
  }

  // ======================= API ציבורי =======================
  const api = {
    get ctx() { return eng.ctx; },
    get unlocked() { return eng.unlocked; },
    /** חייב להיקרא מתוך מחוות משתמש (נגיעה/לחיצה). יוצר/מחדש AudioContext ומעלה עוצמה. */
    async unlock() {
      const ctx = ensureCtx(); if (!ctx) return false;
      if (!eng.unlocked) {
        eng.unlocked = true;
        if (!isOffline(ctx) && ctx.state !== 'running') { try { await ctx.resume(); } catch (e) {} }
        if (!eng.userMuted) eng.master.gain.setTargetAtTime(O.volume, ctx.currentTime, 0.05);
        if (O.prewarm !== false) api.prewarm({ async: !isOffline(ctx) });
      }
      return true;
    },
    /** יוצר מראש את כל הבאפרים הפרוצדורליים (כדי שלא תהיה "קפיצה" בפריים הראשון שמשתמש בהם). מחזיר זמן במ"ש. */
    //  async (ברירת מחדל ב-unlock): באפר אחד לכל משימה — אין משימה ארוכה שחוסמת פריימים בטלפון.
    prewarm({ async = false } = {}) {
      if (!eng.ctx) return 0; const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const names = ['white', 'pink', 'brown', 'dust', 'rain', 'clank0', 'clank1', 'clank2', 'horn', 'chatter', 'ui:click', 'ui:notify', 'ui:confirm'];
      for (const sf of Object.keys(C.SURFACES)) for (let i = 0; i < 3; i++) names.push(`step:${sf}:${i}`);
      if (!async) { const t0 = now(); for (const n of names) eng.buf(n); return (eng.stat.prewarmMs = now() - t0); }
      let ms = 0, maxTask = 0;
      return names.reduce((p, n) => p.then(() => new Promise(r => setTimeout(() => { const t0 = now(); eng.buf(n); const d = now() - t0; ms += d; maxTask = Math.max(maxTask, d); r(); }, 0))), Promise.resolve())
        .then(() => { eng.stat.prewarmMs = ms; eng.stat.prewarmMaxTaskMs = maxTask; return ms; });
    },
    /** מאזין חד-פעמי לנגיעה הראשונה. */
    installUnlock(target = typeof document !== 'undefined' ? document : null) {
      if (!target) return;
      const evs = ['pointerdown', 'touchend', 'keydown', 'click'];
      const h = () => { api.unlock(); evs.forEach(ev => target.removeEventListener(ev, h, true)); };
      evs.forEach(ev => target.addEventListener(ev, h, true));
    },
    setMuted(m) {
      eng.userMuted = !!m; const ctx = eng.ctx; if (!ctx) return;
      eng.master.gain.setTargetAtTime(m || !eng.unlocked ? 0 : O.volume, ctx.currentTime, 0.05);
      if (!isOffline(ctx)) { if (m) setTimeout(() => eng.userMuted && ctx.suspend(), 120); else if (eng.unlocked) ctx.resume(); } // מושתק = AudioContext מושהה = אפס CPU
    },
    setVolume(v) { O.volume = C.clamp(v, 0, 1); if (eng.ctx && eng.unlocked && !eng.userMuted) eng.master.gain.setTargetAtTime(O.volume, eng.ctx.currentTime, 0.05); },
    setBusGain(bus, g) { const B = eng.buses[bus]; if (B) B.in.gain.setTargetAtTime(g, eng.ctx.currentTime, 0.05); },
    /** מצב שבת: רק אווירה. מנועים/ממשק/התראות/קול/מוזיקה מושתקים ולא נבנים בכלל (גם לא צורכים CPU). */
    setShabbat(on) {
      eng.shabbat = !!on; if (!eng.ctx) return;
      for (const b of C.BUSES) eng.buses[b].mask.gain.setTargetAtTime(C.busAllowed(b, eng.shabbat, O.shabbatAllowed) ? 1 : 0, eng.ctx.currentTime, 0.05);
    },
    get shabbat() { return eng.shabbat; },
    /**
     * mode: walk|car|helicopter|jetpack|drone|jet|spaceship|boat.
     * stateFn() → {x,y,z, vx?,vy?,vz?, speed?, throttle?, collective?, thrust?, motors?[4], afterburner?, running?, surface?, onGround?}
     * opts: {player, gain, priority, doppler:false, spatial:false}
     */
    attachToVehicle(mode, stateFn, opts = {}) {
      const m = C.normMode(mode); if (!C.MODES.includes(m)) throw new Error('unknown mode ' + mode);
      if (typeof stateFn !== 'function') { const o = stateFn; stateFn = () => o; }
      const e = { mode: m, stateFn, opts, voice: null, occ: 0 };
      if (m !== 'walk') { e.voice = new Voice(eng, m, 'engines', { spatial: C.VEHICLE_SPATIAL[m] }); }
      eng.entries.push(e);
      return {
        mode: m, get id() { return e.voice ? e.voice.id : 'walk'; }, get built() { return !!(e.voice && e.voice.built); },
        get rpm() { return e.voice && e.voice.mem.rpm; },
        setState(fn) { e.stateFn = typeof fn === 'function' ? fn : () => fn; },
        setOptions(o) { Object.assign(e.opts, o); },
        detach() { if (e.voice) e.voice.teardown(); eng.entries = eng.entries.filter(x => x !== e); },
      };
    },
    /**
     * weather: רשומת weather.js (sampleAt / current) או weatherToVisual(...).
     * area: {traffic,park,port} 0..1  או areaDist: {mainRoad, park, port} במטרים (→ areaMix).
     * shoreDist (מ'), portPoint {x,y,z}, surface (משטח צעדים ברירת מחדל),
     * buildings: מערך בניינים או fn(src,lis)→בניינים קרובים (למשל (a,b)=>W27.near((a.x+b.x)/2,(a.z+b.z)/2, d/2+20)),
     * occlusion: fn(src,lis)→מספר חוסמים (עוקף את buildings), listener: {x,y,z,fx,fy,fz,ux,uy,uz,vx,vy,vz}
     */
    setEnvironment(o = {}) {
      const env = eng.env;
      if (o.weather) env.weather = C.weatherToAudio(o.weather);
      if (o.area) env.area = { traffic: 0, park: 0, port: 0, ...o.area };       // משקלים 0..1
      if (o.areaDist) env.area = C.areaMix(o.areaDist);                        // או מרחקים במטרים
      for (const k of ['shoreDist', 'portPoint', 'surface', 'buildings', 'occlusion']) if (k in o) env[k] = o[k];
      if (o.listener) api.setListener(o.listener);
    },
    setListener(l) { Object.assign(eng.listener, l); eng.listenerSet = true; },
    /** מצלמת three.js (או כל אובייקט עם matrixWorld). מהירות נגזרת מהפריים הקודם. */
    setListenerFromCamera(cam, dt = 1 / 60) {
      const e = cam.matrixWorld.elements, L = eng.listener, x = e[12], y = e[13], z = e[14];
      const v = eng.listenerSet && dt > 0 ? { vx: (x - L.x) / dt, vy: (y - L.y) / dt, vz: (z - L.z) / dt } : { vx: 0, vy: 0, vz: 0 };
      api.setListener({ x, y, z, fx: -e[8], fy: -e[9], fz: -e[10], ux: e[4], uy: e[5], uz: e[6], ...v });
    },
    update,
    /** צלילי ממשק/התראות — נחסמים במצב שבת (מחזיר false). name: click|notify|confirm */
    playUI(name = 'click') { return eng._oneShot('ui:' + name, 'ui', { gain: 1, priority: 8 }); },
    /** אפיק קול (דיבור/קשר). buffer אופציונלי (AudioBuffer); אחרת "קשר רדיו" סינתטי. מנמיך מנועים ואווירה בזמן הניגון. */
    playVoice(buffer = null, { duckEnginesDb = -9, duckAmbienceDb = -6 } = {}) {
      if (!eng.ctx || !eng.unlocked || !C.busAllowed('voice', eng.shabbat, O.shabbatAllowed)) return false;
      if (buffer) eng._bufs.__voice = buffer;
      const r = eng._oneShot(buffer ? '__voice' : 'chatter', 'voice', { gain: 1, priority: 9 });
      if (r) duck({ engines: duckEnginesDb, ambience: duckAmbienceDb }, r.end, eng.ctx.currentTime);
      return r;
    },
    footstep(surface = 'asphalt', gain = 1) { return eng._oneShot(`step:${C.surfaceOf(surface)}:${Math.floor(eng.rand() * 3)}`, 'ambience', { gain, priority: 6 }); },
    stats() {
      const now = eng.ctx ? eng.ctx.currentTime : 0, live = eng.oneShots.filter(o => o.end > now).length, act = activeVoices();
      return {
        ctxState: eng.ctx ? eng.ctx.state : 'none', unlocked: eng.unlocked, shabbat: eng.shabbat,
        continuous: act.length, oneShots: live, voices: act.length + live, maxVoices: O.maxVoices,
        registered: eng.entries.length + Object.keys(eng.amb).length, hrtf: act.filter(v => v.hrtf).length,
        active: act.map(v => v.id), stolen: eng.stat.stolen, dropped: eng.stat.dropped,
        updateMsAvg: eng.stat.updates ? eng.stat.updMsSum / eng.stat.updates : 0, updateMsMax: eng.stat.updMsMax,
        compressorReductionDb: eng.comp ? eng.comp.reduction : 0, prewarmMs: eng.stat.prewarmMs || 0, prewarmMaxTaskMs: eng.stat.prewarmMaxTaskMs || 0,
        nodes: act.reduce((a, v) => a + v.nodes.length, 0),
      };
    },
    _eng: eng,
  };
  return api;
}

export default createAudio;
