/* ESH27 twin — atmosphere — nightlights.js  (needs THREE)
 * 1. patchMaterial(): injects into any Lambert/Phong/Standard material
 *      • facade windows (procedural, deterministic per building + floor + column; occupancy by hour;
 *        warm 2700 K / cool LED / TV-blue mix measured from field photo 007; anti-aliased to an average
 *        glow at distance) — by day the same cells read as dark glass with a sky reflection;
 *      • street-light pools from a top-down LAMP LIGHT-MAP (lamps splatted once into a texture,
 *        ~4–8 m/texel) — pools on the ground, fall-off up the walls, dim mid-street (field 001/003/004);
 *      • physical exponential fog with sun-ward forward-scatter glow (the same formula as the sky veil);
 *      • low-tier colour grade (multiplier) when there is no post pass.
 *    Required attributes (optional ones degrade gracefully): afl (vec2: floor base, floor height, decimetres —
 *    b6 tile worker format), aseed (float, building id), akind (float: 0 building, 1 ground, 2 water).
 * 2. Lamp heads, vehicle head/tail lights, aviation beacons: additive point sprites (all tiers), optional
 *    6–8-point starburst for the "phone" camera profile.
 */
export function createShared(THREE) {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uFogBeta: { value: 5e-5 }, uFogCol: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uSunGlow: { value: new THREE.Color(0, 0, 0) }, uHour: { value: 12 }, uOcc: { value: 0.1 }, uWinGain: { value: 0 },
    uDayGlass: { value: 1 }, uSkyRefl: { value: new THREE.Color(0, 0, 0) }, uGrade: { value: new THREE.Vector3(1, 1, 1) },
    uLampMap: { value: null }, uLampOn: { value: 0 }, uLampScale: { value: 1 / 30000 }, uLampBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uCityUp: { value: new THREE.Color(0, 0, 0) }, uTime: { value: 0 }, uWarm: { value: new THREE.Color() }, uCool: { value: new THREE.Color() }, uTv: { value: new THREE.Color() },
    uWater: { value: 1 },
  };
}

const VERT_HEAD = /* glsl */`
attribute vec2 afl; attribute float aseed; attribute float akind;
varying vec3 vWP; varying vec3 vWN; varying vec2 vAfl; varying float vSeed; varying float vKind;`;
const VERT_BODY = /* glsl */`
{ vec4 wp4 = modelMatrix * vec4(transformed, 1.0); vWP = wp4.xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
  vAfl = afl; vSeed = aseed; vKind = akind; }`;
const FRAG_HEAD = /* glsl */`
varying vec3 vWP; varying vec3 vWN; varying vec2 vAfl; varying float vSeed; varying float vKind;
uniform vec3 uSunDir, uFogCol, uSunGlow, uSkyRefl, uGrade, uCityUp, uWarm, uCool, uTv; uniform float uFogBeta, uHour, uOcc, uWinGain, uDayGlass, uLampOn, uLampScale, uTime, uWater;
uniform sampler2D uLampMap; uniform vec4 uLampBox;
float h13(vec3 p) { p = fract(p * vec3(0.1031, 0.11369, 0.13787)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
vec3 lampAt(vec3 wp) { vec2 uv = (wp.xz - uLampBox.xy) / uLampBox.zw; if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(0.0);
  return texture2D(uLampMap, uv).rgb * uLampScale * uLampOn; }
float gWin = 0.0;`;
const FRAG_COLOR = /* glsl */`
float isWall = 1.0 - step(0.35, abs(vWN.y));
float fbase = vAfl.x * 0.1, fh = vAfl.y * 0.1;
vec3 winEm = vec3(0.0); float glass = 0.0;
if (vKind < 0.5 && isWall > 0.5 && fh > 2.2) {
  float fy = (vWP.y - fbase) / fh;
  vec2 tng = normalize(vec2(-vWN.z, vWN.x) + 1e-5);
  float u = dot(vWP.xz, tng) / 3.3;
  vec2 cell = floor(vec2(u, fy)), f = fract(vec2(u, fy));
  float px = max(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(fy), dFdy(fy))));
  float aa = 1.0 - smoothstep(0.18, 0.55, px);                       // window pattern → average when cells are sub-pixel
  float w = smoothstep(0.18, 0.2, f.x) * smoothstep(0.82, 0.8, f.x) * smoothstep(0.26, 0.28, f.y) * smoothstep(0.80, 0.78, f.y) * step(0.0, fy);
  float fill = 0.27;                                                  // window/facade area ratio (assumption)
  float sd = floor(vSeed + 0.5); cell = mod(cell, 997.0);
  float life = 0.55 + 0.9 * h13(vec3(sd, 3.1, 7.7));             // per-building "lifestyle"
  float hc = h13(vec3(cell, sd));
  float lit = step(hc, uOcc * life);
  float k = h13(vec3(cell.yx + 17.0, sd));
  vec3 wc = k < 0.62 ? uWarm : k < 0.9 ? uCool : uTv * (0.8 + 0.2 * sin(uTime * 7.0 + hc * 40.0));
  float shade = 0.55 + 0.45 * h13(vec3(cell + 5.0, sd));        // curtains / dimmers
  winEm = mix(uOcc * life * fill * mix(uWarm, uCool, 0.3) * 0.75, wc * lit * w * shade, aa) * uWinGain;
  glass = mix(fill, w, aa);
  diffuseColor.rgb *= 1.0 - 0.62 * glass;                              // glass/openings are dark (day: + sky reflection below)
}
gWin = glass;`;
const FRAG_EMIT = /* glsl */`
{ float isW = 1.0 - step(0.35, abs(vWN.y));
  totalEmissiveRadiance += winEm;
  totalEmissiveRadiance += uSkyRefl * gWin * 0.35 * uDayGlass;
  // street-light pools (ground) and their fall-off up the facades; city up-light on walls at night
  vec3 L = lampAt(vWP);
  float above = max(0.0, vWP.y - (vKind < 0.5 ? vAfl.x * 0.1 : 0.0));
  float wallF = isW * (exp(-above / 9.0) * 0.55 + exp(-above / 45.0) * 0.12);
  float groundF = (1.0 - isW) * step(0.5, vKind) * (vKind > 1.5 ? 0.25 : 1.0) + (1.0 - isW) * (1.0 - step(0.5, vKind)) * 0.15;
  totalEmissiveRadiance += diffuseColor.rgb * L * (groundF + wallF) * 0.3183;
  totalEmissiveRadiance += diffuseColor.rgb * uCityUp * isW * exp(-above / 14.0) * 0.3183; }`;
const FRAG_WATER = /* glsl */`
if (vKind > 1.5) {   // water: fresnel sky reflection + sun glitter (look only; maritime team owns the sea)
  vec3 V = normalize(cameraPosition - vWP); float wd = length(cameraPosition - vWP);
  float amp = 1.0 - smoothstep(250.0, 1400.0, wd);                    // ripples fade out before they alias (moiré)
  vec2 q = vWP.xz * 0.06 + vec2(uTime * 0.35, uTime * 0.21);
  vec3 N = normalize(vec3((sin(q.x) * 0.06 + sin(q.y * 1.7 + q.x) * 0.04) * amp, 1.0, (cos(q.y * 1.3) * 0.06 + sin(q.x * 2.1 - q.y) * 0.03) * amp));
  float fr = (0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0)) * 0.85;
  vec3 H = normalize(V + uSunDir); float sp = pow(max(dot(N, H), 0.0), mix(60.0, 220.0, amp)) * mix(8.0, 60.0, amp) + pow(max(dot(N, H), 0.0), 18.0) * 0.6;   // far: broad glitter path
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol * 0.92, fr * uWater) + uSunGlow * sp * step(0.0, uSunDir.y) * uWater * 2.0;
}`;
const FRAG_FOG = /* glsl */`
{ vec3 vd = vWP - cameraPosition; float dist = length(vd); vec3 vdir = vd / max(dist, 1e-3);
  float fogF = 1.0 - exp(-uFogBeta * dist);
  float cs = max(dot(vdir, uSunDir), 0.0);
  vec3 fc = uFogCol + uSunGlow * (pow(cs, 8.0) * 1.5 + pow(cs, 48.0) * 4.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogF) * uGrade; }`;

/** Patch a three.js material (Lambert / Phong / Standard). Shared uniforms object from createShared(). */
export function patchMaterial(material, S) {
  const prev = material.onBeforeCompile;
  material.fog = false;   // our own fog below
  material.onBeforeCompile = (sh, r) => {
    prev && prev(sh, r);
    Object.assign(sh.uniforms, S);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMIT)
      .replace('#include <tonemapping_fragment>', FRAG_WATER + '\n' + FRAG_FOG + '\n#include <tonemapping_fragment>')   // three fogs AFTER tone mapping; we fog in linear radiance, before
      .replace('#include <fog_fragment>', '');
  };
  material.customProgramCacheKey = () => 'esh27-atmo-v1';
  material.needsUpdate = true;
  return material;
}

// ------------------------------------------------------------------ lamp light-map (splat once)
/**
 * Render lamps top-down into a HalfFloat texture of illuminance (lux) at ground level.
 * lamps: Float32Array [x, z, r, g, b, lux] per lamp (world coordinates; colour linear, lux = peak under the head).
 * box: {x0, z0, w, d} world rectangle. Pool profile: peak·(1+(d/h)²)^-1.5·(directional cut-off) — the
 * cos³ law of a point source at mounting height h, with an asymmetric street-side spread folded into r.
 */
export function bakeLampMap(THREE, renderer, lamps, box, size = 2048) {
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  const n = lamps.length / 6, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (lamps[i * 6] - box.x0) / box.w * 2 - 1; pos[i * 3 + 1] = (lamps[i * 6 + 1] - box.z0) / box.d * 2 - 1; pos[i * 3 + 2] = 0;
    col[i * 3] = lamps[i * 6 + 2] * lamps[i * 6 + 5]; col[i * 3 + 1] = lamps[i * 6 + 3] * lamps[i * 6 + 5]; col[i * 3 + 2] = lamps[i * 6 + 4] * lamps[i * 6 + 5];
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const metersPerPx = box.w / size, R = 30;   // splat radius (m)
  const m = new THREE.ShaderMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    uniforms: { ps: { value: Math.max(3, 2 * R / metersPerPx) }, hR: { value: 8 / R } },
    vertexShader: 'attribute vec3 color; varying vec3 vC; uniform float ps; void main(){ vC = color; gl_Position = vec4(position.xy, 0.0, 1.0); gl_PointSize = ps; }',
    fragmentShader: 'varying vec3 vC; uniform float hR; void main(){ vec2 p = (gl_PointCoord - 0.5) * 2.0; float d = length(p); if (d > 1.0) discard; float x = d / hR; float k = pow(1.0 + x * x, -1.5) * smoothstep(1.0, 0.7, d); gl_FragColor = vec4(vC * k, 1.0); }' });
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1); sc.add(new THREE.Points(g, m));
  const prevRT = renderer.getRenderTarget(), prevCol = new THREE.Color(); renderer.getClearColor(prevCol); const pa = renderer.getClearAlpha();
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(sc, cam);
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCol, pa); g.dispose(); m.dispose();
  rt.texture.flipY = false;
  return { rt, texture: rt.texture, box: new THREE.Vector4(box.x0, box.z0, box.w, box.d) };
}

// ------------------------------------------------------------------ sprites: lamp heads, cars, beacons
const SPRITE_VS = /* glsl */`
attribute vec3 color; attribute float size; attribute float phase;
uniform float px, on, time, rays; varying vec3 vC; varying float vR;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1.0);
  float blink = phase < 0.0 ? 1.0 : step(0.5, fract(time * 0.5 + phase));   // aviation lights: 1 s on / 1 s off
  float s = size * px * 420.0 / d * (1.0 + rays * 2.0);
  gl_PointSize = clamp(s, 1.5 * px, 48.0 * px);
  vC = color * on * blink * clamp(s / (1.5 * px), 0.2, 1.0);   // sub-pixel lamps keep their energy, fade only a little
  vR = rays;
}`;
const SPRITE_FS = /* glsl */`
varying vec3 vC; varying float vR;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0; float d = length(p);
  float core = exp(-d * d * 60.0) * 2.5 + exp(-d * d * 12.0) * 0.5, glow = exp(-d * 4.0) * 0.12;
  float ang = atan(p.y, p.x);
  float star = vR * pow(abs(cos(ang * 4.0 + 0.3)), 220.0) * exp(-d * 1.3) * 1.6 + vR * pow(abs(cos(ang * 3.0 + 0.9)), 300.0) * exp(-d * 1.8) * 0.7;   // 8 + 6 diffraction spikes (phone lens)
  float a = (core + glow + star) * smoothstep(1.0, 0.75, d); if (a < 0.003) discard;
  gl_FragColor = vec4(vC * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function createSprites(THREE, name) {
  const U = { px: { value: 1 }, on: { value: 0 }, time: { value: 0 }, rays: { value: 0 } };
  const m = new THREE.ShaderMaterial({ name, uniforms: U, vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const g = new THREE.BufferGeometry();
  const pts = new THREE.Points(g, m); pts.name = name; pts.frustumCulled = false; pts.renderOrder = 5;
  function set(positions, colors, sizes, phases) {
    const n = positions.length / 3;
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sizes || new Float32Array(n).fill(1), 1)); g.setAttribute('phase', new THREE.BufferAttribute(phases || new Float32Array(n).fill(-1), 1));
    g.setDrawRange(0, n); g.computeBoundingSphere();
  }
  return { points: pts, uniforms: U, set, geometry: g };
}
