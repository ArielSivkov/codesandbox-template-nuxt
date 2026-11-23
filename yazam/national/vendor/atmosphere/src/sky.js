/* ESH27 twin — atmosphere — sky.js  (needs THREE, passed in; r160+)
 * Physically based day sky: Preetham analytic model, ported from three.js examples/jsm/objects/Sky.js
 * (r186, MIT, © three.js authors: zz85, Simon Wallner, Martin Upitis) — including its procedural clouds.
 * Our additions (ESH27, labeled approximations):
 *   • twilight dome (civil/nautical): deep-blue zenith, sunward orange glow, earth-shadow + pink belt;
 *   • night base (airglow ≈ 0.0007 lux), city light-pollution glow (stronger over land/east than sea/west),
 *     clouds lit from below by the city (field photos 008/009: warm-grey) and by the moon (006: neutral grey);
 *   • moon disc with correct phase/orientation (lit by the real sun direction) + aureole (halo) that grows
 *     with cloud and haze (field photos 006/008);
 *   • aerosol veil: haze colour mixed over the whole dome (dust = sharav) + horizon band = fog colour,
 *     so the sky meets the ground fog seamlessly.
 * All outputs are radiance in the rig's "lux/30000/π" scale; tone mapping/exposure happen later.
 */
export function createSky(THREE) {
  const U = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, turbidity: { value: 2.5 }, rayleigh: { value: 1.0 },
    mieCoefficient: { value: 0.005 }, mieG: { value: 0.8 }, preethamGain: { value: 1.0 }, sunDisc: { value: 1.0 },
    twi: { value: 0.0 }, twiSun: { value: 0.0 }, nightBase: { value: new THREE.Color(0, 0, 0) },
    cityGlow: { value: new THREE.Color(0, 0, 0) }, moonDir: { value: new THREE.Vector3(0, -1, 0) },
    moonRad: { value: 0.0 }, moonScatter: { value: new THREE.Color(0, 0, 0) }, halo: { value: 0.3 },
    hazeColor: { value: new THREE.Color(0.5, 0.5, 0.5) }, hazeHorizon: { value: 0.5 }, hazeZenith: { value: 0.0 }, hazeSpread: { value: 0.06 },
    sunGlow: { value: new THREE.Color(0, 0, 0) },
    cloudCover: { value: 0.0 }, cloudTime: { value: 0.0 }, cloudDay: { value: new THREE.Color(0, 0, 0) }, cloudNight: { value: new THREE.Color(0, 0, 0) },
    grade: { value: new THREE.Vector3(1, 1, 1) },
  };
  const vs = /* glsl */`
    uniform vec3 sunDir; uniform float rayleigh, turbidity, mieCoefficient;
    varying vec3 vDir; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
    const float e = 2.718281828459045; const float pi = 3.141592653589793;
    const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
    const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
    const float cutoffAngle = 1.6110731556870734; const float steepness = 1.5; const float EE = 1000.0;
    void main() {
      vDir = (modelMatrix * vec4(position, 0.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w;
      float zc = clamp(sunDir.y, -1.0, 1.0);
      vSunE = EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zc)) / steepness)));
      vBetaR = totalRayleigh * rayleigh;   // three.js example uses a unit sunPosition → its 'sunfade' term is ≡ 1
      vBetaM = 0.434 * (0.2 * turbidity) * 10E-18 * MieConst * mieCoefficient;
    }`;
  const fs = /* glsl */`
    varying vec3 vDir; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
    uniform vec3 sunDir; uniform float mieG, preethamGain, sunDisc, twi, twiSun, moonRad, halo, hazeHorizon, hazeZenith, hazeSpread, cloudCover, cloudTime;
    uniform vec3 nightBase, cityGlow, moonDir, moonScatter, hazeColor, sunGlow, cloudDay, cloudNight, grade;
    const float pi = 3.141592653589793;
    vec2 grad2(vec2 i) { vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0; }
    float gnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float a = dot(grad2(i), f), b = dot(grad2(i + vec2(1, 0)), f - vec2(1, 0)), c = dot(grad2(i + vec2(0, 1)), f - vec2(0, 1)), d = dot(grad2(i + vec2(1, 1)), f - vec2(1, 1));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6; }
    float fbm(vec2 p, float drift) { float r = 0.0, a = 1.0; for (int i = 0; i < 4; i++) { r += a * gnoise(p); a *= 0.5; p = p * 2.0 + drift; } return r; }
    float hg(float c, float g) { float g2 = g * g; return 0.07957747 * (1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5); }
    void main() {
      vec3 dir = normalize(vDir);
      float y = dir.y, yp = max(y, 0.0);
      // ---- Preetham day sky (three.js Sky, MIT) ----
      float zen = acos(yp);
      float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - zen * 180.0 / pi, -1.253));
      vec3 Fex = exp(-(vBetaR * 8.4E3 * inv + vBetaM * 1.25E3 * inv));
      float cosT = dot(dir, sunDir);
      float rPh = 0.05968310365946075 * (1.0 + pow(cosT * 0.5 + 0.5, 2.0));
      vec3 bRT = vBetaR * rPh, bMT = vBetaM * hg(cosT, mieG);
      vec3 Lin = pow(vSunE * ((bRT + bMT) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
      Lin *= mix(vec3(1.0), pow(vSunE * ((bRT + bMT) / (vBetaR + vBetaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
      vec3 col = (Lin + vec3(0.1) * Fex * smoothstep(-0.08, 0.05, sunDir.y)) * 0.04 * preethamGain;   // L0 'night sky' term of the original only by day (we model the night ourselves)
      // ---- twilight dome ----
      vec2 sh = normalize(sunDir.xz + 1e-5), dh = normalize(dir.xz + 1e-5);
      float sunward = max(dot(sh, dh), 0.0), anti = max(-dot(sh, dh), 0.0);
      float hz = exp(-yp / 0.10);
      vec3 zenC = vec3(0.16, 0.26, 0.75), horC = vec3(0.55, 0.52, 0.62);
      vec3 tw = mix(horC, zenC, pow(yp, 0.45)) + vec3(1.0, 0.45, 0.16) * 2.2 * pow(sunward, 3.0) * hz * twiSun
              + vec3(0.62, 0.42, 0.55) * 0.6 * anti * exp(-abs(yp - 0.07) / 0.05) * twiSun;
      col += tw * twi;
      // ---- night: airglow + light pollution (land = east = +x is brighter than the sea) ----
      float land = mix(0.35, 1.0, smoothstep(-0.4, 0.5, dir.x));
      col += nightBase * (0.6 + 0.4 * hz) + cityGlow * land * (exp(-yp / 0.16) * 0.85 + 0.15);
      // ---- moon: Rayleigh-ish brightening + aureole ----
      float cm = dot(dir, moonDir);
      col += moonScatter * (0.35 + 0.65 * hz) + moonScatter * halo * (18.0 * pow(max(cm, 0.0), 300.0) + 3.0 * pow(max(cm, 0.0), 30.0));
      // ---- clouds (three.js Sky clouds, relit for day/twilight/night) ----
      if (y > 0.0 && cloudCover > 0.0) {
        vec2 cuv = dir.xz / (y * 0.55) * 0.0002 + cloudTime * 0.00002;
        float n = clamp(fbm(cuv * 1000.0, cloudTime * 0.006) * 0.7 + 0.5, 0.0, 1.0);
        float region = gnoise(cuv * 300.0) * 0.37 + 0.5;
        float cov = clamp(cloudCover + (region - 0.5) * 0.6, 0.0, 1.0), th = 1.0 - cov;
        float mask = smoothstep(th, th + 0.3, n) * smoothstep(0.0, 0.06, y);
        float depth = max(0.0, n - th), beer = exp(-4.0 * depth);
        float shade = mix(0.45, 1.0, clamp(beer * (1.0 - beer * beer) * 2.6, 0.0, 1.0));
        float silver = clamp(0.51 / pow(1.49 - cosT * 1.4, 1.5), 0.0, 3.0) * mask * (1.0 - mask) * 4.0;
        float msilver = clamp(0.51 / pow(1.49 - cm * 1.4, 1.5), 0.0, 3.0) * mask * (1.0 - mask) * 4.0;
        vec3 cc = cloudDay * (shade + silver * 0.6) + cloudNight * (0.55 + 0.45 * hz) * (1.2 - 0.5 * shade)
                + moonScatter * 3.0 * (shade + msilver * 1.5);
        float a = (1.0 - exp(-depth * 0.6 * 12.0)) * smoothstep(0.0, 0.06, y) * mask;
        col = mix(col, mix(col, cc, exp(-0.6 / max(y, 0.05) * 0.08)), a);
      }
      // ---- sun disc (Preetham) & moon disc (phase from the real sun direction) ----
      float sd = clamp((cosT - 0.99995667694644844) * 50000.0, 0.0, 1.0);
      col += 760.0 * sd * min(vSunE * Fex, vec3(80.0)) * 0.04 * preethamGain * sunDisc;
      float r = 0.00456;                                     // tan(0.26°)
      vec3 o = dir - moonDir * cm; float q = length(o) / r;
      if (cm > 0.0 && q < 1.0) {
        vec3 nrm = o / r - moonDir * sqrt(1.0 - q * q);
        float lit = smoothstep(-0.03, 0.06, dot(nrm, sunDir));
        float mare = 0.82 + 0.18 * gnoise(o.xz / r * 2.3 + 7.0);
        col += moonRad * lit * mare * vec3(1.0, 0.97, 0.92) * smoothstep(1.0, 0.92, q) + moonRad * 0.004;  // earthshine
      }
      // ---- aerosol veil + horizon band (matches the fog colour used on the ground) ----
      vec3 hz2 = hazeColor + sunGlow * (pow(max(cosT, 0.0), 8.0) * 1.5 + pow(max(cosT, 0.0), 48.0) * 4.0);
      float band = y < 0.0 ? 1.0 : mix(hazeHorizon, 1.0, exp(-y / 0.012)) * exp(-y / hazeSpread);   // = fog colour at the horizon line, so distant ground and sky meet without a seam
      col = mix(col, hz2, clamp(max(band, hazeZenith), 0.0, 1.0));
      gl_FragColor = vec4(col * grade, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const mat = new THREE.ShaderMaterial({ name: 'ESH27Sky', uniforms: U, vertexShader: vs, fragmentShader: fs, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.name = 'esh27-sky'; mesh.frustumCulled = false; mesh.renderOrder = -10;
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.scale.setScalar(cam.far * 0.9); mesh.updateMatrixWorld(); };
  return { mesh, uniforms: U, material: mat };
}

/** Star field as Points. Visible magnitude limit + fade are uniforms (light pollution, moon, haze, twilight). */
export function createStars(THREE, stars) {
  const n = stars.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n);
  stars.forEach((s, i) => { pos.set(s.v, i * 3); col.set(s.rgb, i * 3); mag[i] = s.mag; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  const U = { limitMag: { value: 4.0 }, gain: { value: 0.0 }, px: { value: 1.0 }, rot: { value: new THREE.Matrix3() }, radius: { value: 1000 }, cloudCover: { value: 0 } };
  const m = new THREE.ShaderMaterial({ name: 'ESH27Stars', uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      attribute float mag; attribute vec3 color; uniform float limitMag, gain, px, radius; uniform mat3 rot;
      varying vec3 vC; varying float vA;
      void main() {
        vec3 d = rot * position;
        vec4 mv = modelViewMatrix * vec4(cameraPosition + d * radius, 1.0);
        gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.99999;
        float rel = pow(10.0, -0.4 * (mag - limitMag + 0.5));          // brightness relative to the limit
        float ext = smoothstep(-0.02, 0.12, d.y);                       // extinction near the horizon
        vA = clamp(rel, 0.0, 6.0) * gain * ext * step(mag, limitMag + 0.3);
        vC = color;
        gl_PointSize = px * (1.6 + 1.2 * clamp(-mag + 1.5, 0.0, 3.0) * 0.5);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA;
      void main() { vec2 p = gl_PointCoord - 0.5; float r = dot(p, p) * 4.0; float a = exp(-r * 3.5) * vA;
        if (a < 0.002) discard; gl_FragColor = vec4(vC * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.name = 'esh27-stars'; pts.renderOrder = -9;
  pts.onBeforeRender = (r, s, cam) => { U.radius.value = cam.far * 0.85; };
  return { points: pts, uniforms: U };
}
