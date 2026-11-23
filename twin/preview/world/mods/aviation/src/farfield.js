/* ESH27 aviation — farfield.js : everything beyond the 9 km Ashdod city, for jet and space speeds.
 *
 *  • Region layer  : Israel + east Mediterranean (lon 30–39°E, lat 27.5–36.5°N) on the TRUE curved Earth (WGS84 → local),
 *                    226×226 vertex grid (≈4 km) with the coarse terrain FIXTURE (data/terrain.json, not a DEM), land/sea/
 *                    lake texture painted from Natural Earth 1:10m (public domain) — coastline ≈ 150–400 m accuracy.
 *  • Globe layer   : sphere (local Gaussian radius) with Natural Earth 1:50m land painted on an equirectangular canvas,
 *                    schematic colours (latitude belts), day/night from the REAL sun, ocean glint, terminator twilight.
 *  • Atmosphere    : two-component exponential haze (Rayleigh H = 8 km, aerosol H = 1.5 km; sea-level visibility ≈ 43 km),
 *                    the same formula for terrain, globe and the near-scene fog → one consistent horizon. Limb glow shell.
 *  • Sky           : dome (in atmosphere: blue → black with altitude, horizon dip, sunset tint) + sun disk + stars
 *                    (random, NOT a star catalogue — schematic).
 *  • Precision     : rendered CAMERA-RELATIVE: the far camera sits at (0,0,0) and every object is placed at (anchor − camera)
 *                    computed in float64 ⇒ no float32 jitter from the runway to 40 000 km. Separate depth range, then the
 *                    caller clears depth and draws the near scene (city, aircraft).
 * Usage:
 *   const ff = new FarField(THREE, { frame, region, terrain, world, quality });  ff.setTime(date);
 *   each frame: ff.update(camPos{x,y,z} (local, float64), camera);  ff.render(renderer, camera);  renderer.clearDepth(); renderer.render(near, camera)
 */
import { sunLocal } from './sun.js';
import { D2R } from './geo.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Switch three.js FogExp2 to a plain exponential (Beer–Lambert) fog: fogFactor = 1 − exp(−density·depth). Call once, before compiling. */
export function useExponentialFog(T) { T.ShaderChunk.fog_fragment = T.ShaderChunk.fog_fragment.replace('exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )', 'exp( - fogDensity * vFogDepth )'); }

export function decodeTerrain(T) {
  const bin = typeof Buffer !== 'undefined' ? Buffer.from(T.data, 'base64') : Uint8Array.from(atob(T.data), c => c.charCodeAt(0));
  const h = new Int16Array(bin.buffer, bin.byteOffset, T.nx * T.ny);
  const [lon0, lat0] = T.bbox, st = T.step;
  return { ...T, h, lon0, lat0, at(lat, lon) { // bilinear, metres; outside the box: 0 (sea)
    const fx = (lon - lon0) / st, fy = (lat - lat0) / st; if (fx < 0 || fy < 0 || fx > T.nx - 1.001 || fy > T.ny - 1.001) return 0;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * T.nx + i; return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + T.nx] * (1 - u) + h[k + T.nx + 1] * u) * v; },
    isWater(lat, lon) { const fx = Math.round((lon - lon0) / st), fy = Math.round((lat - lat0) / st); if (fx < 0 || fy < 0 || fx >= T.nx || fy >= T.ny) return true; const v = h[fy * T.nx + fx]; return v === 0 || v === -430 || v === -209; } };
}

// ---------------------------------------------------------------- shared GLSL: haze (optical depth of an exponential atmosphere)
const HAZE = `
uniform float uCamAlt; uniform vec3 uSun; uniform float uDay;
const float SR = 0.0116, HR = 8.0, SA = 0.05, HA = 1.5;   // per km at sea level (visibility ≈ 63 km), scale heights km
float odepth(float s0, float H, float h1, float h2, float d){ float dh = h2 - h1; float e1 = exp(-max(h1,-1.0)/H), e2 = exp(-max(h2,-1.0)/H);
  return abs(dh) < 0.05 ? s0*e1*d : s0*H*d/abs(dh)*abs(e1 - e2); }
vec3 haze(vec3 col, float distKm, float hKm, vec3 vdir, float dayL){
  float tr = odepth(SR, HR, uCamAlt, hKm, distKm), ta = odepth(SA, HA, uCamAlt, hKm, distKm);
  float T = exp(-min(tr + ta, 8.0));
  float mu = dot(vdir, uSun); vec3 ray = vec3(0.30,0.50,0.86), mie = vec3(0.74,0.77,0.82) * (1.0 + 1.2*pow(max(mu,0.0), 8.0));
  vec3 ins = (ray*tr + mie*ta) / max(tr + ta, 1e-6) * (0.08 + 0.62*dayL);
  return col * T + ins * (1.0 - T);
}`;

function rawTexture(T, d, W, H, aniso) {
  const out = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) out.set(d.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  const t = new T.DataTexture(out, W, H, T.RGBAFormat); t.colorSpace = T.SRGBColorSpace; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = aniso; t.needsUpdate = true; return t;
}

// Texture painters (also used by tools/bake.mjs to pre-bake WebP files). Alpha encodes water: 255 = water, 128 = land
// (not 0: a browser may premultiply image alpha, and RGB must survive).
export function paintGlobe(world, W) {
    const H = W / 2, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#fff'; c.beginPath();
    for (const r of world.land) { let px = null; for (let i = 0; i < r.length; i++) { const x = (r[i][0] + 180) / 360 * W, y = (90 - r[i][1]) / 180 * H; if (i === 0 || (px != null && Math.abs(x - px) > W / 2)) c.moveTo(x, y); else c.lineTo(x, y); px = x; } c.closePath(); }
    c.fill('evenodd');
    const img = c.getImageData(0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) { const lat = 90 - (y + 0.5) / H * 180, al = Math.abs(lat);
      const desert = Math.exp(-(((al - 24) / 8) ** 2)), ice = clamp((al - 62) / 8, 0, 1), green = 1 - desert;
      for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, land = d[i] > 127; const n = Math.sin(x * 0.07 + y * 0.11) * Math.sin(x * 0.023 - y * 0.05) * 0.5 + 0.5;
        if (land) { let r = 70 * green + 210 * desert, g = 98 * green + 184 * desert, b = 52 * green + 136 * desert; r += (n - 0.5) * 24; g += (n - 0.5) * 20;
          if (lat < -60 || (ice > 0 && lat > 0)) { const k = lat < -60 ? 1 : ice * 0.9; r += (236 - r) * k; g += (240 - g) * k; b += (245 - b) * k; }
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 128; }
        else { const sh = 1 - Math.min(1, al / 80) * 0.3; d[i] = 14 * sh; d[i + 1] = 52 * sh; d[i + 2] = 96 * sh + 10; d[i + 3] = 255; } } }
    return { d, W, H };
}

export function paintRegion(R, TR, W) {
    const [lon0, lat0, lon1, lat1] = R.bbox, H = Math.round(W * (lat1 - lat0) / (lon1 - lon0));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    const X = lon => (lon - lon0) / (lon1 - lon0) * W, Y = lat => (lat1 - lat) / (lat1 - lat0) * H;
    const path = rings => { c.beginPath(); for (const r of rings) { r.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); c.closePath(); } };
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H); path(R.land); c.fillStyle = '#f00'; c.fill('evenodd');
    path(R.lakes); c.fillStyle = '#00f'; c.fill('evenodd');
    // shallow shelf: a soft wide stroke of the coastline, kept in the green channel
    c.globalCompositeOperation = 'lighter'; path(R.land); c.strokeStyle = 'rgba(0,90,0,1)'; c.lineWidth = Math.max(3, W / 260); c.filter = 'blur(3px)'; c.stroke(); c.filter = 'none'; c.globalCompositeOperation = 'source-over';
    const img = c.getImageData(0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) { const lat = lat1 - (y + 0.5) / H * (lat1 - lat0);
      for (let x = 0; x < W; x++) { const lon = lon0 + (x + 0.5) / W * (lon1 - lon0), i = (y * W + x) * 4, land = d[i] > 127 && d[i + 2] < 127, lake = d[i + 2] > 127, shelf = d[i + 1] / 255;
        const n = (Math.sin(x * 0.9 + y * 0.37) * Math.sin(x * 0.13 - y * 0.71) * 0.5 + 0.5) * 0.6 + (Math.sin(x * 0.031 + y * 0.047) * 0.5 + 0.5) * 0.4;
        if (lake) { d[i] = 24; d[i + 1] = 70; d[i + 2] = 96; d[i + 3] = 255; continue; }
        if (!land) { d[i] = 16 + 30 * shelf; d[i + 1] = 58 + 60 * shelf; d[i + 2] = 92 + 40 * shelf; d[i + 3] = 255; continue; }
        const h = TR ? TR.at(lat, lon) : 50;
        // aridity: Mediterranean north/west → desert south/east (Negev, Sinai, Arava, Jordan, Egypt) — schematic
        let arid = clamp((31.55 - lat) / 0.9, 0, 1); arid = Math.max(arid, clamp((lon - 35.62) / 0.45, 0, 1) * clamp((33.0 - lat) / 0.6, 0, 1) * (h > 650 && lat > 31.7 ? 0.45 : 1));
        if (lon < 32.4 && lat > 30.0 && lat < 31.65 && lon > 29.9 && (lat - 30.0) > Math.abs(lon - 31.2) * 0.9) arid = 0.15;   // Nile delta
        if (lat > 33.3 || (lat > 34.4 && lon < 34.7)) arid = Math.min(arid, 0.35);                                              // Lebanon, Cyprus, Turkey
        if (Math.abs(lon - 35.5) < 0.12 && lat < 31.9 && lat > 30.5) arid = 1;                                                    // rift / Dead Sea
        let r = 104 + (n - 0.5) * 30, g = 116 + (n - 0.5) * 26, b = 70 + (n - 0.5) * 16;                                       // Mediterranean scrub / fields
        const sr = 214 + (n - 0.5) * 26, sg = 188 + (n - 0.5) * 22, sb = 140 + (n - 0.5) * 16;                                // sand / loess
        r += (sr - r) * arid; g += (sg - g) * arid; b += (sb - b) * arid;
        const rock = clamp((h - 700) / 900, 0, 1) * 0.6; r += (150 - r) * rock; g += (138 - g) * rock; b += (120 - b) * rock;
        if (arid > 0.6 && h > 450) { const red = clamp((h - 450) / 900, 0, 0.25) * arid; r += (186 - r) * red; g += (140 - g) * red; b += (100 - b) * red; }
        const snow = clamp((h - 2400) / 400, 0, 1); r += (235 - r) * snow; g += (238 - g) * snow; b += (242 - b) * snow;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 128; } }
    // thin bright surf line on the coastline (separate canvas, blended into the raw RGBA)
    c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.fillRect(0, 0, W, H); path(R.land); c.strokeStyle = '#fff'; c.lineWidth = Math.max(1, W / 1500); c.stroke();
    const sl = c.getImageData(0, 0, W, H).data; for (let i = 0; i < d.length; i += 4) { const k = sl[i] / 255 * 0.5; if (k > 0) { d[i] += (232 - d[i]) * k; d[i + 1] += (236 - d[i + 1]) * k; d[i + 2] += (228 - d[i + 2]) * k; } }
    return { d, W, H };
}

function prepTex(T, t, aniso) { t.colorSpace = T.SRGBColorSpace; t.premultiplyAlpha = false; t.anisotropy = aniso; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true; }

export class FarField {
  /** opts: { frame: LocalFrame, region: data/region.json, world: data/world.json, terrain: decodeTerrain(...), quality: 0 (phone) | 1 (desktop),
   *         textures?: { region: THREE.Texture, globe: THREE.Texture } (pre-baked data/tex/*.webp — else painted at start-up, ~2–5 s) } */
  constructor(THREE, opts) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now(); this.T = THREE; const T = THREE; this.o = opts; this.frame = opts.frame; this.q = opts.quality ?? 0; this.terrain = opts.terrain;
    this.scene = new T.Scene(); this.cam = new T.PerspectiveCamera(60, 1, 1, 1e8);
    this.sun = new T.Vector3(0, 1, 0); this.day = 1; this.alt = 0;
    const F = this.frame; this.center = F.center; this.R = F.R;
    this._buildSky(); this._buildStars(); this._buildGlobe(); this._buildRegion(); this._buildAtmo(); this._buildLabels();
    this.setTime(opts.date || new Date());
    this.stats.buildMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    const rt = this.regionMat.uniforms.map.value.image, gt = this.globeMat.uniforms.map.value.image; this.stats.texMB = +((rt.width * rt.height + gt.width * gt.height) * 4 * 1.33 / 1048576).toFixed(1);
  }
  // ------------------------------------------------------------ time / sun
  setTime(date) {
    this.date = date; const s = sunLocal(date, this.frame); this.sunInfo = s; this.sun.set(s.dir.x, s.dir.y, s.dir.z).normalize();
    for (const m of this._mats) if (m.uniforms.uSun) m.uniforms.uSun.value.copy(this.sun);
  }
  // ------------------------------------------------------------ sky dome
  _buildSky() {
    const T = this.T; this._mats = [];
    const m = new T.ShaderMaterial({ depthWrite: false, depthTest: false, side: T.BackSide, uniforms: { uSun: { value: new T.Vector3() }, uUp: { value: new T.Vector3(0, 1, 0) }, uAlt: { value: 0 }, uDip: { value: 0 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `uniform vec3 uSun, uUp; uniform float uAlt, uDip; varying vec3 vD;
void main(){ vec3 d = normalize(vD); float e = dot(d, uUp); float se = dot(uSun, uUp);
  float k = exp(-uAlt/7.5);                                   // column of air above (≈ ρ/ρ0 at altitude)
  float day = smoothstep(-0.12, 0.10, se);
  float hz = clamp((e + uDip) / (1.0 - 0.0), 0.0, 1.0);       // elevation above the (dipped) horizon
  vec3 zen = mix(vec3(0.0,0.0,0.01), vec3(0.16,0.38,0.78), pow(k, 0.55));
  vec3 hor = mix(vec3(0.02,0.03,0.06), vec3(0.72,0.82,0.92), pow(k, 0.35));
  float mu = dot(d, uSun); float sunset = (1.0 - smoothstep(0.0, 0.35, abs(se))) * day;
  hor = mix(hor, vec3(1.0,0.62,0.35), sunset * 0.55 * smoothstep(-0.2, 1.0, mu) * pow(k,0.3));
  vec3 c = mix(hor, zen, pow(hz, 0.45 + 0.4*(1.0-k)));
  c *= mix(0.04, 1.0, day);                                   // night
  c += vec3(1.0,0.85,0.6) * pow(max(mu,0.0), 12.0) * 0.25 * day * pow(k,0.5);   // forward scattering halo
  float disk = smoothstep(0.99985, 0.99993, mu);              // sun disk (0.53°) – visible also in space
  c += vec3(1.0,0.96,0.88) * disk * 4.0 + vec3(1.0,0.9,0.7)*pow(max(mu,0.0), 600.0)*(1.5 + 2.0*(1.0-k));
  if (e < -uDip - 0.002) c = mix(c, hor*0.6, 0.6);           // below the horizon: the ground will cover it
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}` });
    const g = new T.SphereGeometry(100, 32, 16); this.sky = new T.Mesh(g, m); this.sky.frustumCulled = false; this.sky.renderOrder = -10; this.scene.add(this.sky); this._mats.push(m); this.skyMat = m;
  }
  _buildStars() {
    const T = this.T, n = this.q ? 2600 : 1400, pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let s = 27;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) { const z = rnd() * 2 - 1, a = rnd() * 6.2832, r = Math.sqrt(1 - z * z), b = Math.pow(rnd(), 3) * 0.9 + 0.1, t = rnd();
      pos.set([r * Math.cos(a) * 90, z * 90, r * Math.sin(a) * 90], i * 3); col.set([b * (0.85 + 0.15 * t), b * 0.9, b * (1.05 - 0.2 * t)], i * 3); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
    this.starMat = new T.PointsMaterial({ size: this.q ? 1.6 : 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    this.stars = new T.Points(g, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -9; this.scene.add(this.stars);
  }
  // ------------------------------------------------------------ globe
  _globeTexture() { const t = this.o.textures && this.o.textures.globe; if (t) { prepTex(this.T, t, 4); return t; } const p = paintGlobe(this.o.world, this.q ? 2048 : 1024); return rawTexture(this.T, p.d, p.W, p.H, 4); }
  _buildGlobe() {
    const T = this.T, F = this.frame, nLon = this.q ? 128 : 80, nLat = nLon / 2, P = [], N = [], U = [], I = [];
    for (let j = 0; j <= nLat; j++) for (let i = 0; i <= nLon; i++) { const lat = 90 - j / nLat * 180, lon = -180 + i / nLon * 360, la = lat * D2R, lo = lon * D2R;
      const e = F.dirToLocal(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)); P.push(e.x, e.y, e.z); N.push(e.x, e.y, e.z); U.push(i / nLon, 1 - j / nLat); }
    for (let j = 0; j < nLat; j++) for (let i = 0; i < nLon; i++) { const a = j * (nLon + 1) + i, b = a + nLon + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setIndex(I);
    const m = new T.ShaderMaterial({ uniforms: { map: { value: this._globeTexture() }, uSun: { value: new T.Vector3() }, uCamAlt: { value: 0 }, uDay: { value: 1 }, uR: { value: 1 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uR;
void main(){ vUv = uv; vN = normal; vec4 mv = modelViewMatrix * vec4(position * uR, 1.0); vV = (modelMatrix * vec4(position*uR,1.0)).xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vN; varying vec3 vV;${HAZE}
void main(){ vec4 t = texture2D(map, vUv); vec3 n = normalize(vN); float ocean = smoothstep(0.6, 0.9, t.a); vec3 base = t.rgb;
  float ndl = dot(n, uSun); float lit = smoothstep(-0.08, 0.12, ndl);       // terminator with ~5° twilight
  vec3 v = normalize(-vV); vec3 h = normalize(uSun + v); float spec = pow(max(dot(n,h),0.0), 90.0) * ocean * lit * 0.9;
  vec3 col = base * (0.015 + 0.3*lit + 1.0*max(ndl,0.0)) + vec3(1.0,0.92,0.8)*spec;
  col += vec3(0.9,0.45,0.2) * (1.0 - smoothstep(0.0, 0.18, abs(ndl))) * 0.08;          // twilight band
  float dist = length(vV) / 1000.0; vec3 vd = normalize(vV);
  col = haze(col, dist, 0.0, vd, lit);
  float fres2 = pow(1.0 - max(dot(n, v), 0.0), 3.0); col += vec3(0.35,0.55,1.0) * fres2 * 0.45 * lit;   // limb haze
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}` });
    this.globe = new T.Mesh(g, m); this.globe.frustumCulled = false; this.globe.renderOrder = 0; this.scene.add(this.globe); this._mats.push(m); this.globeMat = m;
  }
  // ------------------------------------------------------------ region (Israel + east Med)
  _regionTexture() { const t = this.o.textures && this.o.textures.region; if (t) { prepTex(this.T, t, 8); return t; } const p = paintRegion(this.o.region, this.terrain, this.q ? 2048 : 1024); return rawTexture(this.T, p.d, p.W, p.H, 8); }
  _buildRegion() {
    const T = this.T, F = this.frame, TR = this.terrain, [lon0, lat0, lon1, lat1] = this.o.region.bbox;
    const step = this.q ? 1 : 1, nx = Math.floor((TR.nx - 1) / step) + 1, ny = Math.floor((TR.ny - 1) / step) + 1, P = new Float32Array(nx * ny * 3), U = new Float32Array(nx * ny * 2), A = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const lat = TR.lat0 + j * step * TR.step, lon = TR.lon0 + i * step * TR.step, h = Math.max(TR.h[j * step * TR.nx + i * step], -430), k = j * nx + i;
      const p = F.llaToLocal(lat, lon, Math.max(h, 0) + (h < 0 ? h : 0)); P[k * 3] = p.x; P[k * 3 + 1] = p.y; P[k * 3 + 2] = p.z; U[k * 2] = (lon - lon0) / (lon1 - lon0); U[k * 2 + 1] = (lat - lat0) / (lat1 - lat0); A[k] = h / 1000; }
    const I = new (nx * ny < 65536 ? Uint16Array : Uint32Array)((nx - 1) * (ny - 1) * 6); let o = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + nx; I[o++] = a; I[o++] = a + 1; I[o++] = b; I[o++] = b; I[o++] = a + 1; I[o++] = b + 1; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setAttribute('uv', new T.BufferAttribute(U, 2)); g.setAttribute('aH', new T.BufferAttribute(A, 1)); g.setIndex(new T.BufferAttribute(I, 1)); g.computeVertexNormals();
    const m = new T.ShaderMaterial({ uniforms: { map: { value: this._regionTexture() }, gmap: { value: this.globeMat.uniforms.map.value }, uBox: { value: new T.Vector4(lon0, lat0, lon1, lat1) }, uSun: { value: new T.Vector3() }, uCamAlt: { value: 0 }, uDay: { value: 1 }, uFade: { value: 1 } }, transparent: false,
      vertexShader: `attribute float aH; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vH;
void main(){ vUv = uv; vN = normal; vH = aH; vec4 w = modelMatrix * vec4(position,1.0); vV = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D map, gmap; uniform vec4 uBox; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vH;${HAZE}
void main(){ vec4 t = texture2D(map, vUv); vec3 n = normalize(vN);
  vec2 ll = mix(uBox.xy, uBox.zw, vUv); vec4 g = texture2D(gmap, vec2((ll.x + 180.0)/360.0, (ll.y + 90.0)/180.0));
  float edge = smoothstep(0.0, 0.07, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y))); t = mix(g, t, edge);
  float water = smoothstep(0.6, 0.9, t.a);
  float ndl = dot(n, uSun); float lit = smoothstep(-0.08, 0.12, ndl);
  vec3 v = normalize(-vV); vec3 h = normalize(uSun + v); float spec = pow(max(dot(n,h),0.0), 120.0) * water * lit * 0.8;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 col = t.rgb * (0.02 + 0.38*lit + 1.0*max(ndl,0.0)) + vec3(1.0,0.93,0.82)*spec + water * vec3(0.16,0.25,0.36) * (0.25 + 0.75*fres) * lit;
  col = haze(col, length(vV)/1000.0, max(vH, 0.0), -v, lit);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}` });
    this.region = new T.Mesh(g, m); this.region.frustumCulled = false; this.region.renderOrder = 1; this.scene.add(this.region); this._mats.push(m); this.regionMat = m;
    this.stats = { regionVerts: nx * ny, regionTris: (nx - 1) * (ny - 1) * 2 };
  }
  _buildAtmo() {
    const T = this.T, F = this.frame, g = new T.SphereGeometry(1, this.q ? 96 : 64, this.q ? 48 : 32);
    const m = new T.ShaderMaterial({ side: T.BackSide, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uSun: { value: new T.Vector3() }, uCamRel: { value: new T.Vector3() }, uR: { value: F.R / 1000 }, uTop: { value: F.R / 1000 + 90 }, uFade: { value: 1 } },
      vertexShader: 'varying vec3 vP; uniform float uTop; void main(){ vP = position * uTop; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uSun, uCamRel; uniform float uR, uTop, uFade; varying vec3 vP;
void main(){ vec3 d = normalize(vP - uCamRel); float t = -dot(uCamRel, d); vec3 c = uCamRel + d * max(t, 0.0); float hmin = length(c) - uR;
  if (hmin < 0.0 && t > 0.0) discard;
  float dens = exp(-max(hmin, 0.0) / 9.0); float path = 1.0 - exp(-dens * 6.0);
  vec3 nrm = normalize(c); float lit = smoothstep(-0.25, 0.25, dot(nrm, uSun));
  float sunset = 1.0 - smoothstep(0.0, 0.3, abs(dot(nrm, uSun)));
  vec3 col = mix(vec3(0.25,0.5,1.0), vec3(1.0,0.5,0.25), sunset*0.6) * path * lit * 1.1;
  gl_FragColor = vec4(col * uFade, 1.0); }` });
    this.atmo = new T.Mesh(g, m); this.atmo.frustumCulled = false; this.atmo.renderOrder = 2; this.scene.add(this.atmo); this._mats.push(m); this.atmoMat = m;
  }
  _buildLabels() {
    const T = this.T, F = this.frame; this.labels = new T.Group(); this.scene.add(this.labels);
    const PL = [['אשדוד', 31.80, 34.65], ['תל אביב', 32.08, 34.78], ['ירושלים', 31.78, 35.22], ['חיפה', 32.80, 34.99], ['באר שבע', 31.25, 34.79], ['אילת', 29.56, 34.95], ['ים המלח', 31.50, 35.50], ['כנרת', 32.82, 35.59], ['קפריסין', 35.05, 33.2], ['הים התיכון', 32.9, 33.3], ['סיני', 29.8, 33.6]];
    for (const [name, lat, lon] of PL) { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const c = cv.getContext('2d'); c.font = 'bold 34px system-ui, Arial, "Noto Sans Hebrew"'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.direction = 'rtl';
      c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.strokeText(name, 128, 32); c.fillStyle = name === 'אשדוד' ? '#f2b84b' : '#ffffff'; c.fillText(name, 128, 32);
      const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
      s.userData.p = F.llaToLocal(lat, lon, Math.max(0, this.terrain.at(lat, lon)) + 200); s.scale.set(0.16, 0.04, 1); s.renderOrder = 20; this.labels.add(s); }
  }
  // ------------------------------------------------------------ per frame
  /** camPos: local metres (float64). camera: the main PerspectiveCamera (orientation, fov, aspect are copied). */
  update(camPos, camera) {
    const F = this.frame, c = this.center, dx = camPos.x - c.x, dy = camPos.y - c.y, dz = camPos.z - c.z, r = Math.hypot(dx, dy, dz), alt = r - this.R; this.alt = alt;
    const up = new this.T.Vector3(dx / r, dy / r, dz / r); this.up = up;
    const dip = alt > 0 ? Math.acos(clamp(this.R / (this.R + alt), -1, 1)) : 0;
    this.cam.quaternion.copy(camera.quaternion); this.cam.fov = camera.fov; this.cam.aspect = camera.aspect;
    // depth range: near ∝ height above the far terrain; far reaches past the visible limb
    const near = clamp(alt * 0.25, 2, 2e5), horizon = Math.sqrt(Math.max(0, 2 * this.R * alt + alt * alt));
    this.cam.near = near; this.cam.far = Math.max(horizon * 1.3 + 600000, r + this.R * 0.2); this.cam.updateProjectionMatrix();
    // camera-relative placement (float64 → small float32 offsets)
    const margin = clamp(alt * 0.02, 300, 40000);
    this.globe.position.set(c.x - camPos.x, c.y - camPos.y, c.z - camPos.z); this.globeMat.uniforms.uR.value = this.R - margin;
    this.region.position.set(-camPos.x, -camPos.y, -camPos.z);
    this.atmo.position.copy(this.globe.position); this.atmo.scale.setScalar((this.R / 1000 + 90) * 1000);
    this.atmoMat.uniforms.uCamRel.value.set(dx / 1000, dy / 1000, dz / 1000); this.atmoMat.uniforms.uFade.value = clamp((alt - 15000) / 40000, 0, 1);
    // sun / day factor at the camera
    const se = up.dot(this.sun); this.day = clamp((se + 0.1) / 0.25, 0, 1);
    const ak = alt / 1000; for (const m of [this.globeMat, this.regionMat, this._nearSea]) if (m) { m.uniforms.uCamAlt.value = ak; m.uniforms.uDay.value = this.day; }
    this.skyMat.uniforms.uUp.value.copy(up); this.skyMat.uniforms.uAlt.value = Math.max(0, ak); this.skyMat.uniforms.uDip.value = Math.sin(dip);
    // stars: visible when the sky is dark (night or high)
    const skyB = this.day * Math.exp(-Math.max(0, ak) / 12); this.starMat.opacity = clamp(1 - skyB * 6, 0, 1) * 0.95;
    // region fades out (behind the globe) when very far; labels appear above ~ 25 km
    this.region.visible = alt < 3.0e6;
    const lf = clamp((alt - 20000) / 30000, 0, 1) * (alt < 2.5e6 ? 1 : 0); this.labels.visible = lf > 0.01;
    if (this.labels.visible) for (const s of this.labels.children) { const p = s.userData.p; s.position.set(p.x - camPos.x, p.y - camPos.y, p.z - camPos.z); s.material.opacity = lf * (0.4 + 0.6 * this.day); }
    this.layer = alt < 15000 ? 'city' : alt < 400000 ? 'israel' : 'globe';
  }
  /** A sea material for the NEAR scene (e.g. to replace the game's W.MAT.sea while flying) that is shaded and hazed
   *  exactly like the far-field sea, so the city's sea and the Mediterranean meet without a seam. */
  makeSeaMaterial() {
    const T = this.T, m = new T.ShaderMaterial({ uniforms: { uSun: { value: this.sun }, uCamAlt: { value: 0 }, uDay: { value: 1 }, uCol: { value: new T.Color(26 / 255, 76 / 255, 108 / 255).convertSRGBToLinear() } },
      vertexShader: 'varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vV = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uCol; varying vec3 vV;${HAZE}
void main(){ vec3 n = vec3(0.0,1.0,0.0); float ndl = dot(n, uSun); float lit = smoothstep(-0.08, 0.12, ndl); vec3 v = normalize(-vV); vec3 h = normalize(uSun + v);
  float spec = pow(max(dot(n,h),0.0), 120.0) * lit * 0.8; float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 col = uCol * (0.02 + 0.38*lit + 1.0*max(ndl,0.0)) + vec3(1.0,0.93,0.82)*spec + vec3(0.16,0.25,0.36) * (0.25 + 0.75*fres) * lit;
  col = haze(col, length(vV)/1000.0, 0.0, -v, lit); gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}` });
    this._mats.push(m); this._nearSea = m; return m;
  }
  render(renderer) { const ac = renderer.autoClear; renderer.autoClear = true; renderer.render(this.scene, this.cam); renderer.autoClear = ac; }
  /** Fog for the near scene that matches the far haze along a horizontal ray at the camera altitude. */
  /** Exponential fog for the near scene that reproduces the far haze for a ray from the camera to a target at
   *  distance distM (m) and height hM (m): out.density = τ/d (use with useExponentialFog(THREE), fogFactor = 1 − e^(−ρ·d)). */
  fog(out, distM = 3000, hM = 0) {
    const hc = Math.max(0, this.alt) / 1000, ht = Math.max(0, hM) / 1000, d = Math.max(0.05, distM / 1000);
    const od = (s0, H) => { const dh = ht - hc, e1 = Math.exp(-hc / H), e2 = Math.exp(-ht / H); return Math.abs(dh) < 0.05 ? s0 * e1 * d : s0 * H * d / Math.abs(dh) * Math.abs(e1 - e2); };
    const r = od(0.0116, 8), a = od(0.05, 1.5), s = r + a + 1e-9, day = 0.08 + 0.62 * this.day; out.density = s / (d * 1000);
    out.r = (0.30 * r + 0.74 * a) / s * day; out.g = (0.50 * r + 0.77 * a) / s * day; out.b = (0.86 * r + 0.82 * a) / s * day; return out; }
  /** Ground for physics outside the city: flat-frame y of the far terrain under (x, z) and its type. */
  surface(x, z) { const F = this.frame, g = F.localToLla(x, 0, z), h = this.terrain.at(g.lat, g.lon), water = this.terrain.isWater(g.lat, g.lon);
    const drop = (x * x + z * z) / (2 * F.R); return { y: (water ? Math.min(h, 0) : h) - drop, type: water ? 'water' : 'ground' }; }
  dispose() { this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); if (o.material.uniforms && o.material.uniforms.map) o.material.uniforms.map.value.dispose(); o.material.dispose(); } }); }
}
