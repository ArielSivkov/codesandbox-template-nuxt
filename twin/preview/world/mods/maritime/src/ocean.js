/* ESH27 twin — maritime / ocean.js — phone-cheap ocean surface (THREE injected)
 *
 * Geometry: one mesh of 5 nested square rings (2, 8, 32, 128, 512 m spacing) following the camera; each ring
 * snaps to its own spacing in the vertex shader (no swimming). ≈ 32 k vertices, ≈ 42 k triangles, 1 draw call.
 * Vertex shader: ≤ 8 Gerstner waves (same formula as waves.js), amplitude × attenuation from the maritime grid
 * (manual bilinear texelFetch = grid.sampleGrid in JS) × distance fade (beyond uFade.x, documented).
 * Fragment shader: Fresnel (Schlick, F0 = 0.02) sky reflection, sun glint from the REAL sun vector
 * (Blinn/Phong lobes on geometric + tiled detail normal map), depth colour (shallow → deep), shore foam bands,
 * whitecaps from the Gerstner Jacobian, horizon fog. ACES + sRGB via three's chunks (same as the game).
 */
import { packUniforms } from './waves.js';

const MAXW = 8;

export const WAVE_CHUNK = /* glsl */`
#define MAXW ${MAXW}
uniform vec3 uCam;
uniform vec4 uWA[MAXW];
uniform vec2 uWB[MAXW];
uniform int uN;
uniform sampler2D uGrid;
uniform vec4 uGridInfo;   // x0, z0, cs, unused
uniform ivec2 uGridN;
uniform float uHb;
uniform vec2 uFade;
uniform vec3 uCoast;      // outside the grid: land if dot(p, uCoast.xy) > uCoast.z (fitted coast line)
vec2 gridAt(vec2 p){
  vec2 f = (p - uGridInfo.xy) / uGridInfo.z;
  if (f.x < 0.0 || f.y < 0.0 || f.x > float(uGridN.x - 1) || f.y > float(uGridN.y - 1)) return dot(p, uCoast.xy) > uCoast.z ? vec2(-5.0, 0.0) : vec2(250.0, 1.0);
  ivec2 i = min(uGridN - 2, ivec2(floor(f)));
  vec2 u = f - vec2(i);
  vec2 a = texelFetch(uGrid, i, 0).rg, b = texelFetch(uGrid, i + ivec2(1, 0), 0).rg;
  vec2 c = texelFetch(uGrid, i + ivec2(0, 1), 0).rg, d = texelFetch(uGrid, i + ivec2(1, 1), 0).rg;
  vec2 r0 = a + (b - a) * u.x, r1 = c + (d - c) * u.x;
  return r0 + (r1 - r0) * u.y;
}
float waveAtten(vec2 base, out vec2 ds){
  ds = gridAt(base);
  float t = clamp(ds.x / uHb, 0.0, 1.0);
  float dist = length(base - uCam.xz);
  return ds.y * t * t * (3.0 - 2.0 * t) * (1.0 - smoothstep(uFade.x, uFade.y, dist));
}
// height only, treating p as the undisplaced point (good to a few cm for decals such as wakes)
float waveY(vec2 p){
  vec2 ds; float a = waveAtten(p, ds); float y = 0.0;
  for (int i = 0; i < MAXW; i++) { if (i >= uN) break; vec4 w = uWA[i]; y += w.w * a * sin(w.z * dot(w.xy, p) + uWB[i].y); }
  return y;
}
`;

const VERT = /* glsl */`
${WAVE_CHUNK}
attribute float snap;
varying vec3 vW;
varying vec3 vN;
varying float vJac;
varying vec2 vDS;
void main(){
  vec2 base = position.xz + floor(uCam.xz / snap) * snap;
  vec2 ds; float a = waveAtten(base, ds);
  vec3 P = vec3(base.x, 0.0, base.y);
  vec3 N = vec3(0.0, 1.0, 0.0);
  float j = 0.0;
  for (int i = 0; i < MAXW; i++) {
    if (i >= uN) break;
    vec4 w = uWA[i]; vec2 q = uWB[i];
    float th = w.z * dot(w.xy, base) + q.y;
    // anti-aliasing on the coarse rings only (wavelength < 2–4 vertex spacings fades out); the 2.5 m ring around the
    // camera is untouched, so the CPU sampler (boat) matches it exactly
    float aa = snap > 2.6 ? smoothstep(2.0 * snap, 4.0 * snap, 6.2831853 / w.z) : 1.0;
    float s = sin(th), c = cos(th), A = w.w * a * aa, wa = w.z * A;
    P.x += q.x * A * w.x * c; P.z += q.x * A * w.y * c; P.y += A * s;
    N.x -= w.x * wa * c; N.z -= w.y * wa * c; N.y -= q.x * wa * s;
    j += q.x * wa * s;
  }
  P.y -= snap * 0.004 * step(2.5, snap);     // coarser rings sit a hair lower → the finer ring wins in overlaps
  vW = P; vN = N; vJac = 1.0 - j; vDS = ds;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3 uSun; uniform vec3 uSunCol; uniform float uSunVis;
uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uFogCol; uniform vec2 uFog;  // near, far (linear, like the game)
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSand;
uniform float uTime; uniform vec2 uWind; uniform float uWhite; uniform float uDetail; uniform float uFoamShore;
uniform sampler2D uNorm;
varying vec3 vW; varying vec3 vN; varying float vJac; varying vec2 vDS;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vno(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
void main(){
  float depth = vDS.x;
  if (depth < -0.3) discard;                       // land (terrain draws there)
  vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
  vec3 N = normalize(vN);
  // detail normals: two scrolling samples of a tiling normal map, faded with distance (mip-friendly)
  float df = uDetail * exp(-dist / 380.0);
  vec2 wd = uWind;
  vec3 n1 = texture2D(uNorm, vW.xz / 31.0 + wd * uTime * 0.021).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNorm, vec2(vW.z, -vW.x) / 11.0 - wd * uTime * 0.043 + 0.37).xyz * 2.0 - 1.0;
  N = normalize(N + vec3(n1.x + n2.x * 0.6, 0.0, n1.y + n2.y * 0.6) * df);
  float cosT = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 sky = mix(uSkyHor, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.55));
  float sd = max(dot(R, uSun), 0.0);
  vec3 glint = uSunCol * uSunVis * (pow(sd, 1400.0) * 60.0 + pow(sd, 160.0) * 3.0 + pow(sd, 24.0) * 0.18);
  // water body: shallow turquoise → deep blue (Beer-Lambert-like with depth), lit by sun elevation
  float dk = 1.0 - exp(-max(depth, 0.0) / 5.0);
  vec3 body = mix(uShallow, uDeep, dk);
  body = mix(uSand * 0.75, body, smoothstep(0.0, 2.2, depth));       // seeing the sand in very shallow water
  float lit = 0.18 + 0.82 * clamp(uSun.y * 2.5 + 0.1, 0.0, 1.0);
  body *= lit;
  // subsurface glow on crests facing away from the sun
  float sss = pow(max(dot(V, -uSun), 0.0), 4.0) * clamp(1.0 - vJac, 0.0, 1.0) * 0.6;
  body += uShallow * sss * uSunVis;
  vec3 col = mix(body, sky, F) + glint * (0.35 + 0.65 * F);
  // foam: shore bands + whitecaps
  float nz = vno(vW.xz * 0.35 + uTime * 0.2) * 0.6 + vno(vW.xz * 1.3 - uTime * 0.3) * 0.4;
  float shore = 1.0 - smoothstep(0.0, uFoamShore, depth);
  float bands = 0.5 + 0.5 * sin(depth * 9.0 - uTime * 1.6 + nz * 3.0);
  float foam = shore * smoothstep(0.35, 0.75, bands * 0.7 + nz * 0.5) ;
  foam = max(foam, smoothstep(0.08, 0.0, depth) * 0.9);
  float wc = smoothstep(0.42, 0.12, vJac) * uWhite * smoothstep(0.45, 0.75, nz);
  foam = clamp(foam + wc, 0.0, 1.0) * clamp(1.0 - dist / 1500.0, 0.0, 1.0);
  col = mix(col, vec3(0.93, 0.95, 0.96) * (0.25 + 0.75 * lit), foam * 0.88);
  // fog to the horizon colour (linear, same parameters as the scene fog)
  float fg = smoothstep(uFog.x, uFog.y, dist);
  col = mix(col, uFogCol, fg);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function ringGeometry(T, levels) {
  const pos = [], snap = [], idx = [];
  let base = 0, prevHalf = 0;
  for (const L of levels) {
    const { s, n } = L, half = s * n / 2;
    const hole = prevHalf > 0 ? prevHalf - 2 * s : -1;     // overlap of ≥ one coarse cell + snap slack
    const vid = new Int32Array((n + 1) * (n + 1)).fill(-1);
    const used = (i, j) => { const x0 = -half + i * s, z0 = -half + j * s; return !(hole > 0 && x0 >= -hole && x0 + s <= hole && z0 >= -hole && z0 + s <= hole); };
    const V = (i, j) => { const k = j * (n + 1) + i; if (vid[k] < 0) { vid[k] = base++; pos.push(-half + i * s, 0, -half + j * s); snap.push(s); } return vid[k]; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (!used(i, j)) continue;
      const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      idx.push(a, d, b, b, d, c);
    }
    prevHalf = half;
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('snap', new T.Float32BufferAttribute(snap, 1));
  g.setIndex(idx);
  g.boundingSphere = new T.Sphere(new T.Vector3(), 1e7);
  return g;
}

function detailNormalTexture(T, size = 256, seed = 7) {
  // tileable height field from integer-frequency sines → normals (procedural, CC0 by construction)
  const h = new Float32Array(size * size);
  let s = seed; const R = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const waves = []; for (let i = 0; i < 24; i++) { const fx = Math.round((R() - 0.5) * 24), fy = Math.round((R() - 0.5) * 24); if (!fx && !fy) continue; waves.push([fx, fy, R() * 6.283, 1 / Math.hypot(fx, fy)]); }
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let v = 0; const u = i / size * 6.283, w = j / size * 6.283;
    for (const [fx, fy, p, a] of waves) v += a * Math.sin(fx * u + fy * w + p);
    h[j * size + i] = v;
  }
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const l = h[j * size + (i + size - 1) % size], r = h[j * size + (i + 1) % size], d = h[((j + size - 1) % size) * size + i], u = h[((j + 1) % size) * size + i];
    let nx = (l - r) * 1.2, ny = (d - u) * 1.2, nz = 1; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const k = (j * size + i) * 4; data[k] = (nx * 0.5 + 0.5) * 255; data[k + 1] = (ny * 0.5 + 0.5) * 255; data[k + 2] = (nz * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  const t = new T.DataTexture(data, size, size, T.RGBAFormat);
  t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = T.NoColorSpace; t.needsUpdate = true;
  return t;
}

export function gridTexture(T, g) {
  const data = new Float32Array(g.nx * g.nz * 2);
  for (let k = 0; k < g.nx * g.nz; k++) { data[k * 2] = g.depth[k]; data[k * 2 + 1] = g.shelter[k]; }
  const t = new T.DataTexture(data, g.nx, g.nz, T.RGFormat, T.FloatType);
  t.magFilter = t.minFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

export function createOcean(T, { grid, levels, fadeNear = 380, fadeFar = 950 } = {}) {
  levels = levels || [{ s: 2.5, n: 64 }, { s: 10, n: 64 }, { s: 40, n: 48 }, { s: 160, n: 48 }, { s: 640, n: 48 }];
  const geo = ringGeometry(T, levels);
  const C = c => new T.Color(c);
  const uniforms = {
    uCam: { value: new T.Vector3() },
    uWA: { value: Array.from({ length: MAXW }, () => new T.Vector4()) },
    uWB: { value: Array.from({ length: MAXW }, () => new T.Vector2()) },
    uN: { value: 0 },
    uGrid: { value: gridTexture(T, grid) },
    uGridInfo: { value: new T.Vector4(grid.x0, grid.z0, grid.cs, 0) },
    uGridN: { value: new T.Vector2(grid.nx, grid.nz) },
    uHb: { value: 1.6 }, uCoast: { value: new T.Vector3(1, 0, 1e9) }, uFade: { value: new T.Vector2(fadeNear, fadeFar) },
    uSun: { value: new T.Vector3(0, 1, 0) }, uSunCol: { value: C(0xfff1dc) }, uSunVis: { value: 1 },
    uSkyTop: { value: C(0x3d7fc4) }, uSkyHor: { value: C(0xcfe0ec) }, uFogCol: { value: C(0xcfe0ec) }, uFog: { value: new T.Vector2(2000, 30000) },
    uDeep: { value: C(0x0a3150) }, uShallow: { value: C(0x2b7f86) }, uSand: { value: C(0xc9b58c) },
    uTime: { value: 0 }, uWind: { value: new T.Vector2(1, 0) }, uWhite: { value: 0 }, uDetail: { value: 0.35 }, uFoamShore: { value: 1.3 },
    uNorm: { value: detailNormalTexture(T) },
  };
  // ivec2 uniform: three uploads Vector2 to ivec2 fine via uniform2iv? use explicit array
  uniforms.uGridN.value = new T.Vector2(grid.nx, grid.nz);
  const mat = new T.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG });
  const mesh = new T.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.name = 'maritime-ocean'; mesh.renderOrder = 1;

  function setWaves(set, t) {
    const u = packUniforms(set, t, MAXW);
    for (let i = 0; i < MAXW; i++) { uniforms.uWA.value[i].fromArray(u.A, i * 4); uniforms.uWB.value[i].fromArray(u.B, i * 2); }
    uniforms.uN.value = u.n;
  }
  function setGrid(g) { uniforms.uGrid.value.dispose(); uniforms.uGrid.value = gridTexture(T, g); uniforms.uGridInfo.value.set(g.x0, g.z0, g.cs, 0); uniforms.uGridN.value.set(g.nx, g.nz); }
  return { mesh, uniforms, setWaves, setGrid, triangles: geo.index.count / 3, vertices: geo.attributes.position.count };
}
