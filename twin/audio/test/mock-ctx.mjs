// AudioContext מדומה ל-Node: מספיק כדי להריץ את המנוע (בניית גרפים, הקצאה, שבת) בלי קול אמיתי.
class Param {
  constructor(v = 0) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['lin', v, t]); return this; }
  setTargetAtTime(v, t, tc) { this.value = v; this.events.push(['tgt', v, t, tc]); return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = new Set(); ctx.created[kind] = (ctx.created[kind] || 0) + 1; ctx.live.add(this); }
  connect(n) { this.outs.add(n); return n; }
  disconnect() { this.outs.clear(); this.ctx.live.delete(this); }
}
export class MockAudioContext {
  constructor({ sampleRate = 48000 } = {}) {
    this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'suspended'; this.created = {}; this.live = new Set(); this.started = 0; this.stopped = 0;
    this.destination = new Node(this, 'destination');
    const L = this.listener = {};
    for (const k of ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) L[k] = new Param(0);
  }
  startRendering() {} // מסומן כ-offline → אין resume/visibility
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
  createBiquadFilter() { const n = new Node(this, 'biquad'); n.frequency = new Param(350); n.Q = new Param(1); n.type = 'lowpass'; return n; }
  createWaveShaper() { const n = new Node(this, 'shaper'); n.curve = null; return n; }
  createDynamicsCompressor() { const n = new Node(this, 'comp'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); n.reduction = 0; return n; }
  createStereoPanner() { const n = new Node(this, 'stereo'); n.pan = new Param(0); return n; }
  createPanner() { const n = new Node(this, 'panner'); for (const k of ['positionX', 'positionY', 'positionZ']) n[k] = new Param(0); return n; }
  _src(kind) { const n = new Node(this, kind); const ctx = this; n.start = () => { ctx.started++; n.playing = true; }; n.stop = () => { ctx.stopped++; n.playing = false; }; return n; }
  createOscillator() { const n = this._src('osc'); n.frequency = new Param(440); n.type = 'sine'; return n; }
  createBufferSource() { const n = this._src('bufsrc'); n.playbackRate = new Param(1); n.loop = false; n.buffer = null; return n; }
  createBuffer(ch, len, sr) { const d = new Float32Array(len); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: () => d }; }
  advance(dt) { this.currentTime += dt; }
}
