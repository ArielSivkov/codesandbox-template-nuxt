/* ESH27 twin — atmosphere — post.js  (needs THREE r160+, WebGL2)
 * Tiered post-processing for phones:
 *   low  : no post pass. Direct render, renderer ACES tone mapping + exposure, fog in-material,
 *          grade pre-baked into albedo ("vertex colour grading") + per-material multiplier.
 *   mid  : HDR target (HalfFloat, MSAA 4) → one composite pass: exposure, ACES (three.js' fit), sRGB,
 *          3D LUT grade (32³), vignette.
 *   high : mid + dual-Kawase bloom (4 levels from ½ res) + SSAO-lite (8 taps on the depth texture).
 * Camera profiles: 'physical' (clean) or 'phone' — the look of Ariel's night photos: starburst + strong
 *   bloom on LEDs, luma grain, navy-lifted blacks, slight motion blur (frame feedback), mild vignette.
 */
const FS_QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const ACES = /* glsl */`
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {   // three.js ACESFilmicToneMapping (exposure applied by caller, /0.6 included)
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = I * (c / 0.6); c = RRTAndODTFit(c); return clamp(O * c, 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }`;

export class AtmoPost {
  constructor(THREE, renderer, { lut } = {}) {
    this.T = THREE; this.r = renderer; this.tier = 'low'; this.profile = 'physical'; this.w = 1; this.h = 1;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad); this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    if (lut) { const t = new THREE.Data3DTexture(lut.data, lut.size, lut.size, lut.size); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true; this.lut = t; }
    this.U = {
      tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null }, tPrev: { value: null }, tLut: { value: this.lut || null },
      exposure: { value: 1 }, lutAmt: { value: this.lut ? 1 : 0 }, bloomAmt: { value: 0 }, aoAmt: { value: 0 }, near: { value: 1 }, far: { value: 1000 },
      res: { value: new THREE.Vector2(1, 1) }, wb: { value: new THREE.Vector3(1, 1, 1) }, grain: { value: 0 }, lift: { value: new THREE.Vector3(0, 0, 0) }, feedback: { value: 0 }, time: { value: 0 }, vign: { value: 0.18 }, sat: { value: 1 },
    };
    this.comp = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: FS_QUAD_VS, depthTest: false, depthWrite: false, toneMapped: false,
      fragmentShader: /* glsl */`
        precision highp sampler3D;
        uniform sampler2D tColor, tDepth, tBloom, tPrev; uniform sampler3D tLut;
        uniform float exposure, lutAmt, bloomAmt, aoAmt, near, far, grain, feedback, time, vign, sat; uniform vec2 res; uniform vec3 lift, wb; varying vec2 vUv;
        ${ACES}
        float lin(float z) { return near * far / (far - z * (far - near)); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 0.1) * 43758.5453); }
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          if (aoAmt > 0.0) {   // SSAO-lite: compare linear depth with 8 ring neighbours (range-limited, view-distance scaled)
            float d0 = lin(texture2D(tDepth, vUv).r); float occ = 0.0;
            float rad = clamp(900.0 / d0, 2.0, 18.0);
            for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398 + 0.39; vec2 o = vec2(cos(a), sin(a)) * rad / res * (i < 4 ? 1.0 : 0.5);
              float dn = lin(texture2D(tDepth, vUv + o).r); float dd = (d0 - dn) / d0;
              occ += smoothstep(0.004, 0.03, dd) * (1.0 - smoothstep(0.08, 0.2, dd)); }
            c *= 1.0 - aoAmt * occ / 8.0 * step(d0, far * 0.5);
          }
          c *= exposure * wb;
          if (bloomAmt > 0.0) c += texture2D(tBloom, vUv).rgb * bloomAmt;
          c = aces(c);
          float L = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(L), c, sat);
          c = c + lift * (1.0 - smoothstep(0.0, 0.25, L));
          vec3 s = toSRGB(clamp(c, 0.0, 1.0));
          if (lutAmt > 0.0) { vec3 g = texture(tLut, s * (31.0 / 32.0) + 0.5 / 32.0).rgb; s = mix(s, g, lutAmt); }
          vec2 q = vUv - 0.5; s *= 1.0 - vign * dot(q, q) * 2.2;
          if (grain > 0.0) { float n = hash(vUv * res + fract(time) * 91.7) - 0.5; float n2 = hash(vUv * res * 0.5 + 3.1 + fract(time * 1.3) * 17.0) - 0.5;
            float Ls = dot(s, vec3(0.299, 0.587, 0.114)); s += (n * 0.8 + n2 * 0.6) * grain * (1.0 - 0.8 * Ls) + vec3(n2, 0.0, -n2) * grain * 0.25 * (1.0 - Ls); }
          if (feedback > 0.0) s = mix(s, texture2D(tPrev, vUv).rgb, feedback);
          gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
        }` });
    const mk = (fs) => new THREE.ShaderMaterial({ uniforms: { t: { value: null }, texel: { value: new THREE.Vector2() }, thr: { value: 1 }, exposure: { value: 1 } }, vertexShader: FS_QUAD_VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false });
    this.bright = mk('uniform sampler2D t; uniform vec2 texel; uniform float thr, exposure; varying vec2 vUv; void main(){ vec3 c = vec3(0.0); for(int i=0;i<4;i++){ vec2 o = vec2(i==0||i==2?-1.0:1.0, i<2?-1.0:1.0)*texel; c += texture2D(t, vUv+o).rgb; } c *= 0.25 * exposure; float l = max(c.r, max(c.g, c.b)); float k = clamp((l - thr) / max(l, 1e-4), 0.0, 1.0); gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0); }');
    this.down = mk('uniform sampler2D t; uniform vec2 texel; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * 4.0; c += texture2D(t, vUv + texel * vec2(-1,-1)).rgb + texture2D(t, vUv + texel * vec2(1,-1)).rgb + texture2D(t, vUv + texel * vec2(-1,1)).rgb + texture2D(t, vUv + texel * vec2(1,1)).rgb; gl_FragColor = vec4(c / 8.0, 1.0); }');
    this.up = mk('uniform sampler2D t; uniform vec2 texel; varying vec2 vUv; void main(){ vec3 c = vec3(0.0); c += texture2D(t, vUv + texel * vec2(-2,0)).rgb + texture2D(t, vUv + texel * vec2(2,0)).rgb + texture2D(t, vUv + texel * vec2(0,-2)).rgb + texture2D(t, vUv + texel * vec2(0,2)).rgb; c += (texture2D(t, vUv + texel * vec2(-1,-1)).rgb + texture2D(t, vUv + texel * vec2(1,-1)).rgb + texture2D(t, vUv + texel * vec2(-1,1)).rgb + texture2D(t, vUv + texel * vec2(1,1)).rgb) * 2.0; gl_FragColor = vec4(c / 12.0, 1.0); }');
    this.up.blending = THREE.AdditiveBlending; this.up.transparent = true;
    this.copy = mk('uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }');
    this.levels = [];
    this.phoneWB = [1, 1, 1];   // set by the rig: partial grey-world auto white balance of a phone at night
  }
  _alloc() {
    const T = this.T; this._free();
    if (this.tier === 'low') return;
    const pr = this.r.getPixelRatio(), W = Math.max(1, Math.floor(this.w * pr)), H = Math.max(1, Math.floor(this.h * pr));
    const dt = this.tier === 'high' ? new T.DepthTexture(W, H) : null;
    this.hdr = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, samples: 4, depthTexture: dt, depthBuffer: true });
    this.U.res.value.set(W, H);
    const wantBloom = this.tier === 'high' || this.profile === 'phone';
    if (wantBloom) { let w = W >> 1, h = H >> 1; for (let i = 0; i < 5; i++) { this.levels.push(new T.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: T.HalfFloatType, depthBuffer: false })); w >>= 1; h >>= 1; } }
    if (this.profile === 'phone') { this.ldrA = new T.WebGLRenderTarget(W, H, { depthBuffer: false }); this.ldrB = new T.WebGLRenderTarget(W, H, { depthBuffer: false }); }
  }
  _free() { for (const k of ['hdr', 'ldrA', 'ldrB']) { if (this[k]) { this[k].depthTexture && this[k].depthTexture.dispose(); this[k].dispose(); this[k] = null; } } this.levels.forEach(l => l.dispose()); this.levels = []; }
  setSize(w, h) { this.w = w; this.h = h; this._alloc(); }
  setTier(t) { this.tier = t; this._alloc(); }
  setProfile(p) { this.profile = p; this._alloc(); }
  _pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.qs, this.qc); }
  render(scene, camera, exposure, time = 0) {
    const r = this.r, T = this.T;
    if (this.tier === 'low' || !this.hdr) {
      r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = exposure; r.setRenderTarget(null); r.render(scene, camera); return;
    }
    r.toneMapping = T.NoToneMapping;
    r.setRenderTarget(this.hdr); r.render(scene, camera);
    const U = this.U, phone = this.profile === 'phone';
    U.tColor.value = this.hdr.texture; U.exposure.value = exposure; U.time.value = time;
    U.tDepth.value = this.hdr.depthTexture || null; U.aoAmt.value = this.tier === 'high' && this.hdr.depthTexture ? 0.55 : 0; U.near.value = camera.near; U.far.value = camera.far;
    if (this.levels.length) {
      const L = this.levels;
      this.bright.uniforms.t.value = this.hdr.texture; this.bright.uniforms.texel.value.set(1 / this.hdr.width, 1 / this.hdr.height);
      this.bright.uniforms.thr.value = phone ? 1.0 : 1.2; this.bright.uniforms.exposure.value = exposure; this._pass(this.bright, L[0]);
      for (let i = 1; i < L.length; i++) { this.down.uniforms.t.value = L[i - 1].texture; this.down.uniforms.texel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height); this._pass(this.down, L[i]); }
      for (let i = L.length - 1; i > 0; i--) { this.up.uniforms.t.value = L[i].texture; this.up.uniforms.texel.value.set(0.5 / L[i].width, 0.5 / L[i].height); this.r.autoClear = false; this._pass(this.up, L[i - 1]); this.r.autoClear = true; }
      U.tBloom.value = L[0].texture; U.bloomAmt.value = phone ? 0.38 : 0.2;
    } else U.bloomAmt.value = 0;
    U.lutAmt.value = this.lut ? (phone ? 0.5 : 1) : 0;
    U.grain.value = phone ? 0.06 : 0; U.wb.value.set(...(phone ? this.phoneWB : [1, 1, 1])); U.sat.value = phone ? 0.9 : 1; U.vign.value = phone ? 0.35 : 0.16;
    U.lift.value.set(phone ? 0.010 : 0, phone ? 0.016 : 0, phone ? 0.034 : 0);   // field photos: sky gaps #0A0F1C, never black
    if (phone) {
      U.tPrev.value = this.ldrB.texture; U.feedback.value = 0.28; this._pass(this.comp, this.ldrA);
      this.copy.uniforms.t.value = this.ldrA.texture; this._pass(this.copy, null);
      const t = this.ldrA; this.ldrA = this.ldrB; this.ldrB = t;
    } else { U.feedback.value = 0; this._pass(this.comp, null); }
  }
  dispose() { this._free(); this.comp.dispose(); [this.bright, this.down, this.up, this.copy].forEach(m => m.dispose()); this.lut && this.lut.dispose(); }
}
