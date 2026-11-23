/* לוח היזם · כיסוי ארצי · כדור → ישראל → אשדוד → רחוב.
   שני עולמות, מצלמה אחת:
     • כדור (מעל 300 ק"מ): יחידות ק"מ, מרקמי NASA יום/לילה, קו יום-לילה אמיתי מנקודת התת-שמש (NOAA, physics/sun.js).
     • מקומי (מתחת ל-300 ק"מ): מטרים, ITM אמיתי סביב אשדוד; תאורה, שמיים, ירח, חלונות ופנסים – מחלקת האטמוספרה (rig.js, כמות שהיא).
   LOD: קרקע אזורית (NASA) → סקירה 100 מ' (שלנו) → גושי עיר (תאי 100 מ', LOD ביניים) → בניינים מאריחי 1 ק"מ.
   כללי צוות אדום: אין ?data= ממקור זר (BASE קבוע ויחסי), כל טקסט מהנתונים נכתב ב-textContent, גבהים מסומנים "משוער",
   אריחים שנכשלו מנוסים שוב (backoff), פריקה לא מפילה את הלולאה (try/catch לכל פריים). */
import { createAtmosphere } from '../vendor/atmosphere/src/index.js';
import { solarCoordinates, sunPosition } from '../vendor/physics/src/sun.js';
import { moonPosition, starField } from '../vendor/atmosphere/src/astro.js';
import { hexToRgb, PALETTE, lampTypeForStreet, srgbToLinear } from '../vendor/atmosphere/src/palette.js';
import { toITM, fromITM, ll2v } from './geo.js';
import earcut from '../vendor/earcut.js';

const T = window.THREE;
const $ = id => document.getElementById(id);
const BASE = 'data/';
const D2R = Math.PI / 180, RE = 6371;               // ק"מ
const SWITCH_KM = 1200;                              // מעבר כדור ↔ מקומי (מתחת: עולם שטוח ב-ITM עם הסקירה שלנו)
const Q = new URLSearchParams(location.search);
const PLACES = {
  globe:  { lat: 24, lon: 22, dist: 21000e3 },
  israel: { lat: 31.62, lon: 34.92, dist: 240e3 },
  ashdod: { lat: 31.785, lon: 34.66, dist: 11e3 },
  haerez: { itm: [166273, 634930], dist: 620, heading: 78 },     // מבט מערבה, אל הים: צללים בצד, שקיעה מול המצלמה
};

// ------------------------------------------------------------------ renderer
const canvas = $('cv');
const renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
let DPR = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.info.autoReset = false;                 // סופרים את כל המעברים של פריים אחד (סצנה + צל + עיבוד)

const status = { tiles: 0, tileErr: 0, netBytes: 0, frames: 0, fps: 0, mode: 'globe', builtBlocks: 0, lamps: 0, longFrames: 0, maxFrameMs: 0 };
const loadMsg = (m, p) => { $('lmsg').textContent = m; if (p != null) $('lbar').style.width = Math.round(p * 100) + '%'; };
function toast(m, ms = 2400) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', ms); }

// ------------------------------------------------------------------ time
const TZ = 'Asia/Jerusalem';
let simMs = Q.get('t') ? Date.parse(Q.get('t')) : Date.now();
let live = !Q.get('t');
function israelParts(ms) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute };
}
function msForLocalMinute(ms, minute) {     // אותו יום בישראל, דקה נתונה (00:00–23:59) – בלי ניחוש קיץ/חורף (ממצא 19)
  const p = israelParts(ms); const cur = p.hh * 60 + p.mm; let t = ms + (minute - cur) * 60000;
  for (let i = 0; i < 2; i++) { const q = israelParts(t); const c = q.hh * 60 + q.mm; if (c === minute) break; t += (minute - c) * 60000; }
  return Math.floor(t / 60000) * 60000;
}

// ------------------------------------------------------------------ GLOBE scene (ק"מ)
const gScene = new T.Scene();
const gCam = new T.PerspectiveCamera(42, innerWidth / innerHeight, 10, 200000);
const texL = new T.TextureLoader();
function loadTex(url, srgb = true) { return new Promise((res, rej) => texL.load(url, t => { if (srgb) t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, rej)); }
const gU = { day: { value: null }, night: { value: null }, ov: { value: null }, ovBox: { value: new T.Vector4(0, 0, 1, 1) }, sunDir: { value: new T.Vector3(1, 0, 0) }, camPos: { value: new T.Vector3() }, lightsGain: { value: 1.0 } };
const earthMat = new T.ShaderMaterial({
  uniforms: gU,
  vertexShader: `varying vec3 vN; varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vN = normalize(position); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform sampler2D day, night, ov; uniform vec4 ovBox; uniform vec3 sunDir, camPos; uniform float lightsGain; varying vec3 vN; varying vec2 vUv; varying vec3 vW;
    vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
    void main(){
      vec3 n = normalize(vN); float d = dot(n, sunDir);
      vec3 dc = toLin(texture2D(day, vUv).rgb), nc = toLin(texture2D(night, vUv).rgb);
      float dayF = smoothstep(-0.06, 0.10, d);
      float ocean = smoothstep(0.02, 0.10, dc.b - max(dc.r, dc.g));
      vec3 V = normalize(camPos - vW); vec3 R = reflect(-sunDir, n);
      float spec = pow(max(dot(R, V), 0.0), 60.0) * 0.6 * ocean;
      vec3 lit = dc * (0.03 + 1.15 * max(d, 0.0)) + vec3(1.0, 0.9, 0.75) * spec * dayF;
      float lights = max(nc.r + nc.g - 1.25 * nc.b, 0.0);                       // רק אורות עיר (הכחול הוא רקע מצויר)
      // הסקירה שלנו (100 מ', אזור אשדוד–ת"א) מעל NASA: שטח בנוי → אורות לילה חדים יותר
      vec2 ll = vec2(vUv.x * 360.0 - 180.0, vUv.y * 180.0 - 90.0); vec2 q = (ll - ovBox.xy) / (ovBox.zw - ovBox.xy);
      float ours = 0.0; if (all(greaterThan(q, vec2(0.0))) && all(lessThan(q, vec2(1.0)))) { vec4 o = texture2D(ov, vec2(q.x, q.y)); ours = o.r * o.a; dc = mix(dc, vec3(0.42, 0.40, 0.37), ours * 0.5 * o.b); }
      lights = max(lights, pow(ours, 1.5) * 0.9);
      vec3 nightCol = dc * 0.02 + vec3(1.0, 0.70, 0.36) * lights * 3.6 * lightsGain;
      vec3 col = mix(nightCol, lit, dayF);
      col += vec3(1.0, 0.42, 0.16) * 0.028 * exp(-pow(d / 0.025, 2.0)) * (1.0 - dayF * 0.5);   // רצועת שקיעה דקה (קירוב אמנותי)
      float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
      col += vec3(0.30, 0.55, 1.0) * rim * 0.35 * smoothstep(-0.25, 0.4, d);
      col = col / (1.0 + col);                                                        // tone map (Reinhard)
      gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
    }` });
const earth = new T.Mesh(new T.SphereGeometry(RE, 128, 64), earthMat); gScene.add(earth);
const atmoMat = new T.ShaderMaterial({
  uniforms: { sunDir: gU.sunDir, camPos: gU.camPos }, side: T.BackSide, transparent: true, blending: T.AdditiveBlending, depthWrite: false,
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform vec3 sunDir, camPos; varying vec3 vW;
    void main(){ vec3 V = normalize(vW - camPos); vec3 n = normalize(vW);
      float b = dot(V, -n);                                  // 0 בקצה הדיסק
      float a = pow(clamp(1.0 - abs(b) * 4.0, 0.0, 1.0), 2.2);
      float s = dot(n, sunDir);
      vec3 c = mix(vec3(1.0, 0.45, 0.2), vec3(0.35, 0.62, 1.0), smoothstep(-0.15, 0.3, s)) * smoothstep(-0.35, 0.05, s);
      gl_FragColor = vec4(c * a * 1.25, 1.0); }` });
const atmoShell = new T.Mesh(new T.SphereGeometry(RE * 1.028, 96, 48), atmoMat); gScene.add(atmoShell);
{ // כוכבים: 24 אמיתיים + שדה סינתטי (מסומן כסינתטי ב-astro.js)
  const st = starField(1500), n = st.length, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  st.forEach((s, i) => { p.set([s.v[0] * 150000, s.v[2] * 150000, -s.v[1] * 150000], i * 3); const k = Math.min(1, Math.pow(10, -0.4 * (s.mag - 1.5))) * 0.9 + 0.1; c.set(s.rgb.map(v => v * k), i * 3); });
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3)); g.setAttribute('color', new T.BufferAttribute(c, 3));
  gScene.add(new T.Points(g, new T.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
}
function subsolar(ms) {      // נקודת התת-שמש: רוחב = נטייה; אורך = −15°·(UTC−12) − משוואת הזמן/4
  const sc = solarCoordinates(ms), utcH = ((ms / 3600000) % 24 + 24) % 24;
  let lon = -15 * (utcH - 12) - sc.eqTime / 4; lon = ((lon + 540) % 360) - 180;
  return { lat: sc.declination, lon };
}

// ------------------------------------------------------------------ LOCAL scene (מטרים, ITM)
let IDX = null, OV = null;
let E0 = 166951.1, N0 = 634275.0;
const scene = new T.Scene();
const cam = new T.PerspectiveCamera(50, innerWidth / innerHeight, 1, 60000);
let atmo = null;
const L = (E, N) => [E - E0, -(N - N0)];                    // ITM → סצנה

function groundAttrs(g, kind) {
  const n = g.attributes.position.count;
  g.setAttribute('afl', new T.BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('aseed', new T.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('akind', new T.BufferAttribute(new Float32Array(n).fill(kind), 1));
}
const nightU = { uCityNight: { value: 0 }, uLightsTex: { value: null } };
function addNightEmissive(mat, chan) {   // אורות עיר מרחוק: שטח בנוי × חום × "אורות דולקים" (מחלקת האטמוספרה)
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, nightU);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCityNight; uniform sampler2D uLightsTex;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec4 lt = texture2D(uLightsTex, vMapUv); float b = ${chan}; totalEmissiveRadiance += vec3(1.0, 0.62, 0.30) * b * uCityNight * 0.6; }`);
  };
}
let farGround = null, nearGround = null, blocks = null;
async function buildGround() {
  const reg = await (await fetch('tex/region.json')).json();
  const [dayT, nightT] = await Promise.all([loadTex('tex/region_day.jpg'), loadTex('tex/region_night.jpg', false)]);
  const lat0 = 31.8, lon0 = 34.65, kx = 111320 * Math.cos(lat0 * D2R), kz = 110574;
  const x0 = (reg.lon[0] - lon0) * kx, x1 = (reg.lon[1] - lon0) * kx, z0 = -(reg.lat[1] - lat0) * kz, z1 = -(reg.lat[0] - lat0) * kz;
  const [cx, cz] = L(...toITM(lat0, lon0));
  const g = new T.PlaneGeometry(x1 - x0, z1 - z0, 1, 1); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2 + cx, -40, (z0 + z1) / 2 + cz); groundAttrs(g, 1);
  const m = new T.MeshLambertMaterial({ map: dayT });
  nightU.uLightsTex.value = nightT; addNightEmissive(m, 'max(lt.r + lt.g - 1.25 * lt.b, 0.0) * 1.6');
  atmo.patchMaterial(m);
  farGround = new T.Mesh(g, m); farGround.renderOrder = -2; farGround.frustumCulled = false; scene.add(farGround);
  // סקירה 100 מ' (שלנו): צבע לפי ים/יבשה/שטח בנוי; אורות לילה מהשטח הבנוי
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = BASE + 'nat/overview.png'; });
  const S = 2048, cv = document.createElement('canvas'); cv.width = cv.height = S; const cx2 = cv.getContext('2d', { willReadFrequently: true });
  cx2.drawImage(img, 0, 0, S, S); const id = cx2.getImageData(0, 0, S, S), d = id.data;
  // צבע בסיס של היבשה מ-NASA (תדר נמוך) כדי שהתפר מול הקרקע האזורית ייעלם; הפרטים (חוף, שטח בנוי) – שלנו
  const rc = document.createElement('canvas'); rc.width = rc.height = 512; const rcx = rc.getContext('2d', { willReadFrequently: true }); rcx.drawImage(dayT.image, 0, 0, 512, 512); const rd = rcx.getImageData(0, 0, 512, 512).data;
  const W0 = OV.size * OV.cell_m, [cLa, cLo] = fromITM(OV.origin_itm_nw[0] + W0 / 2, OV.origin_itm_nw[1] - W0 / 2);
  const regAt = (px, py) => { const E = (px + 0.5) / S * W0 - W0 / 2, N = W0 / 2 - (py + 0.5) / S * W0; const la = cLa + N / 110900, lo = cLo + E / (111320 * Math.cos(cLa * D2R));
    const fu = Math.min(510, Math.max(0, (lo - reg.lon[0]) / (reg.lon[1] - reg.lon[0]) * 512 - 0.5)), fv = Math.min(510, Math.max(0, (reg.lat[1] - la) / (reg.lat[1] - reg.lat[0]) * 512 - 0.5));
    const u = fu | 0, v = fv | 0, du = fu - u, dv = fv - v, o = [0, 0, 0];                                   // דגימה בילינארית
    for (const [uu, vv, w] of [[u, v, (1 - du) * (1 - dv)], [u + 1, v, du * (1 - dv)], [u, v + 1, (1 - du) * dv], [u + 1, v + 1, du * dv]]) { const k = (vv * 512 + uu) * 4; o[0] += rd[k] * w; o[1] += rd[k + 1] * w; o[2] += rd[k + 2] * w; }
    return o.map(x => x / 255); };
  const sea = hexToRgb(PALETTE.seaMid), seaD = hexToRgb(PALETTE.seaDeep), sand = hexToRgb(PALETTE.dryGround), dune = hexToRgb(PALETTE.sand), built = hexToRgb(PALETTE.pavement), green = [0.55, 0.58, 0.42];
  const lights = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const r = d[i * 4] / 255, hm = d[i * 4 + 1], land = d[i * 4 + 2] > 127, a = d[i * 4 + 3];
    let c;
    if (!land) c = sea.map((v, k) => v * 0.6 + seaD[k] * 0.4);
    else { const nz = ((i * 2654435761) >>> 24) / 255, px = i % S, py = (i / S) | 0, bm = regAt(px, py);
      c = sand.map((v, k) => (v * 0.45 + Math.min(1, bm[k] * 1.25) * 0.55) * (0.94 + 0.06 * nz)); c = c.map((v, k) => v + (built[k] - v) * Math.min(1, r * 1.3) - 0.10 * r * Math.min(1, hm / 40)); }
    const px = i % S, py = (i / S) | 0, edge = Math.min(px, py, S - 1 - px, S - 1 - py);
    d[i * 4] = c[0] * 255; d[i * 4 + 1] = c[1] * 255; d[i * 4 + 2] = c[2] * 255; d[i * 4 + 3] = Math.min(255, edge * 6);   // שוליים רכים, בלי עיגול חד
    lights[i * 4] = land ? d[i * 4] : 0; lights[i * 4] = land ? Math.round(r * 255) : 0; lights[i * 4 + 3] = 255;
  }
  cx2.putImageData(id, 0, 0);
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true;
  const lt = new T.DataTexture(lights, S, S); lt.flipY = true; lt.needsUpdate = true; lt.generateMipmaps = true; lt.minFilter = T.LinearMipmapLinearFilter; lt.magFilter = T.LinearFilter;
  const W = OV.size * OV.cell_m, [ox, oz] = L(OV.origin_itm_nw[0], OV.origin_itm_nw[1]);
  // יבשה: מצולע וקטורי (קו חוף OSM) עם מרקם הסקירה; ים: מצולע וקטורי עם חומר המים של מחלקת האטמוספרה (ברק שמש, פרנל)
  const polyMesh = (polys, y) => { const pos = [], uv = [], idx = [];
    for (const p of polys) { const flat = [], holes = []; p.forEach((r, k) => { if (k) holes.push(flat.length >> 1); for (const [a, b] of r) flat.push(a, b); });
      const tri = earcut(flat, holes, 2), v0 = pos.length / 3;
      for (let i = 0; i < flat.length; i += 2) { pos.push(ox + flat[i], y, oz + flat[i + 1]); uv.push(flat[i] / W, 1 - flat[i + 1] / W); }
      for (let i = 0; i < tri.length; i += 3) { const A = tri[i], B = tri[i + 1], Cc = tri[i + 2], ax = flat[2 * A], az = flat[2 * A + 1];
        const up = (flat[2 * B] - ax) * (flat[2 * Cc + 1] - az) - (flat[2 * B + 1] - az) * (flat[2 * Cc] - ax) < 0; if (up) idx.push(v0 + A, v0 + B, v0 + Cc); else idx.push(v0 + A, v0 + Cc, v0 + B); } }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new T.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3)); g.setIndex(idx); g.computeBoundingSphere(); return g; };
  const [landJ, seaJ] = await Promise.all([fetch(BASE + 'nat/land.json').then(r => r.json()), fetch(BASE + 'nat/sea.json').then(r => r.json())]);
  const g2 = polyMesh(landJ.polys, -0.6); groundAttrs(g2, 1);
  const gs = polyMesh(seaJ.polys, -0.9); groundAttrs(gs, 2);
  const ms = atmo.patchMaterial(new T.MeshLambertMaterial({ color: new T.Color().setRGB(...hexToRgb(PALETTE.seaMid), T.SRGBColorSpace) }));   // = צבע הים באריחים
  const seaMesh = new T.Mesh(gs, ms); seaMesh.receiveShadow = false; seaMesh.renderOrder = -1; scene.add(seaMesh);
  const m2 = new T.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: true });
  const nu = { uCityNight: nightU.uCityNight, uLightsTex: { value: lt } };
  m2.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, nu); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCityNight; uniform sampler2D uLightsTex;')
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float b = texture2D(uLightsTex, vMapUv).r; totalEmissiveRadiance += vec3(1.0, 0.64, 0.32) * pow(b, 1.6) * uCityNight; }`); };
  atmo.patchMaterial(m2);
  nearGround = new T.Mesh(g2, m2); nearGround.receiveShadow = true; nearGround.renderOrder = -1; scene.add(nearGround);
  status.gpuTexMB = (S * S * 4 * 2 * 1.33 + 512 * 512 * 4 * 2 * 1.33) / 1048576;
}

// ---------- גושי עיר (תאי 100 מ') – LOD ביניים, ציור אחד
const blockU = { uDetail: { value: new T.Vector3(0, 0, -1) } };
let blockData = null, blockAt = null;
async function loadBlocks() {
  const r = await fetch(BASE + 'nat/blocks.bin'); const buf = await r.arrayBuffer();
  const raw = new Uint8Array(buf);
  const ab = (raw[0] === 0x1f && raw[1] === 0x8b) ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : buf;
  blockData = new DataView(ab); status.blocksTotal = ab.byteLength / 6;
}
function buildBlocks(cx, cz, R) {
  if (!blockData) return;
  const n = blockData.byteLength / 6, cell = OV.cell_m, [ox, oz] = L(OV.origin_itm_nw[0], OV.origin_itm_nw[1]);
  const sel = [];
  for (let i = 0; i < n; i++) { const c = blockData.getInt16(i * 6, true), r = blockData.getInt16(i * 6 + 2, true); const x = ox + (c + 0.5) * cell, z = oz + (r + 0.5) * cell; if ((x - cx) ** 2 + (z - cz) ** 2 < R * R) sel.push(i); }
  const m = sel.length, V = m * 20, pos = new Float32Array(V * 3), nor = new Int8Array(V * 3), col = new Uint8Array(V * 3), afl = new Float32Array(V * 2), seed = new Float32Array(V), kind = new Float32Array(V), ctr = new Float32Array(V * 2);
  const idx = new Uint32Array(m * 30);
  const pal = [PALETTE.plaster, PALETTE.shikun, PALETTE.stone].flat().map(h => hexToRgb(h).map(srgbToLinear));
  const faces = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  let v = 0, k = 0;
  for (const i of sel) {
    const c = blockData.getInt16(i * 6, true), r = blockData.getInt16(i * 6 + 2, true), h = Math.max(4, blockData.getUint8(i * 6 + 4) * (0.75 + 0.5 * (((c * 2246822519 ^ r * 3266489917) >>> 0) / 4294967296))), fr = blockData.getUint8(i * 6 + 5) / 255;
    const j1 = ((c * 73856093 ^ r * 19349663) >>> 0) / 4294967296, j2 = ((c * 83492791 ^ r * 2654435761) >>> 0) / 4294967296;
    const x = ox + (c + 0.3 + 0.4 * j1) * cell, z = oz + (r + 0.3 + 0.4 * j2) * cell, s = cell * 0.5 * Math.min(0.9, Math.sqrt(fr) * (0.8 + 0.3 * j2));
    const cl = pal[(c * 31 + r * 17) % pal.length], sd = ((c * 7919 + r * 104729) % 9973) + 0.5;
    for (const [nx, ny, nz] of faces) {
      let q;
      if (ny) q = [[-s, h, -s], [-s, h, s], [s, h, s], [s, h, -s]];
      else if (nx) q = [[nx * s, 0, -s * nx], [nx * s, 0, s * nx], [nx * s, h, s * nx], [nx * s, h, -s * nx]];
      else q = [[s * nz, 0, nz * s], [-s * nz, 0, nz * s], [-s * nz, h, nz * s], [s * nz, h, nz * s]];
      const b = v;
      for (const p of q) { pos.set([x + p[0], p[1], z + p[2]], v * 3); nor.set([nx * 127, ny * 127, nz * 127], v * 3); col.set([cl[0] * 255, cl[1] * 255, cl[2] * 255], v * 3); afl.set([0, 30], v * 2); seed[v] = sd; ctr.set([x, z], v * 2); v++; }
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], k); k += 6;
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3, true)); g.setAttribute('color', new T.BufferAttribute(col, 3, true));
  g.setAttribute('afl', new T.BufferAttribute(afl, 2)); g.setAttribute('aseed', new T.BufferAttribute(seed, 1)); g.setAttribute('akind', new T.BufferAttribute(kind, 1)); g.setAttribute('actr', new T.BufferAttribute(ctr, 2));
  g.setIndex(new T.BufferAttribute(idx, 1)); g.computeBoundingSphere();
  if (!blocks) {
    const mt = new T.MeshLambertMaterial({ vertexColors: true });
    mt.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, blockU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 actr; uniform vec3 uDetail;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (uDetail.z > 0.0 && length(actr - uDetail.xy) < uDetail.z) transformed.y = -60.0;'); };
    atmo.patchMaterial(mt);
    blocks = new T.Mesh(g, mt); blocks.castShadow = false; blocks.receiveShadow = true; scene.add(blocks);
  } else { blocks.geometry.dispose(); blocks.geometry = g; }
  blockAt = [cx, cz, R]; status.builtBlocks = m;
}

// ---------- רשת הכבישים (מחלקה ≥1) – קו אחד לכל קטע, ציור אחד; ביום אספלט, בלילה פנסים (נתרן/לד לפי שם הרחוב)
let roadLines = null;
const roadU = { uDay: { value: 1 }, uNight: { value: 0 }, uDetail: blockU.uDetail, uAlpha: { value: 1 } };
async function loadRoads() {
  const r = await fetch(BASE + 'nat/roads.bin'); const buf = await r.arrayBuffer(); const raw = new Uint8Array(buf);
  const ab = (raw[0] === 0x1f && raw[1] === 0x8b) ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : buf;
  const dv = new DataView(ab); let o = 0, segs = 0;
  const recs = []; while (o + 11 <= ab.byteLength) { const f = dv.getUint8(o), n = dv.getUint16(o + 1, true); recs.push([o, f, n]); segs += n - 1; o += 11 + (n - 1) * 4; }
  const pos = new Float32Array(segs * 6), col = new Uint8Array(segs * 8); let v = 0;
  const sod = [255, 150, 60], led = [255, 228, 196];
  for (const [o0, f, n] of recs) {
    let x = dv.getInt32(o0 + 3, true), y = dv.getInt32(o0 + 7, true), p = o0 + 11; const c = f & 3, lc = f & 4 ? led : sod;
    let [px, pz] = L(x, y);
    for (let i = 1; i < n; i++) { x += dv.getInt16(p, true); y += dv.getInt16(p + 2, true); p += 4; const [qx, qz] = L(x, y);
      pos.set([px, 0.4, pz, qx, 0.4, qz], v * 3); for (let k = 0; k < 2; k++) col.set([lc[0], lc[1], lc[2], c * 85], (v + k) * 4); v += 2; px = qx; pz = qz; }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 4, true));
  const S = atmo.shared;
  const m = new T.ShaderMaterial({ uniforms: Object.assign({ uFogBeta: S.uFogBeta, uFogCol: S.uFogCol }, roadU), transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 color; varying vec4 vC; varying vec3 vW; void main(){ vC = color; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uDay, uNight, uFogBeta, uAlpha; uniform vec3 uFogCol, uDetail; varying vec4 vC; varying vec3 vW;
      void main(){ if (uDetail.z > 0.0 && length(vW.xz - uDetail.xy) < uDetail.z - 150.0) discard;
        float cls = vC.a * 3.0;                                    // 1 שכונתי, 2 עורק, 3 ראשי
        vec3 day = vec3(0.16, 0.16, 0.17) * (0.55 + 0.25 * cls) * uDay;
        vec3 night = vC.rgb * (0.35 + 0.45 * cls) * uNight;
        float d = length(vW - cameraPosition); float fog = 1.0 - exp(-uFogBeta * d);
        vec3 c = mix(day + night, uFogCol, fog);
        gl_FragColor = vec4(c, uAlpha * (0.55 + 0.15 * cls)); }` });
  roadLines = new T.LineSegments(g, m); roadLines.frustumCulled = false; roadLines.renderOrder = 1; scene.add(roadLines);
  status.roadSegs = segs;
}

// ---------- אריחי בניינים
const worker = new Worker(new URL('./tileworker.js', import.meta.url), { type: 'module' });
worker.postMessage({ type: 'cfg', base: new URL(BASE, location.href).href });     // מוחלט, אותו מקור (BASE קבוע בקוד – לא מפרמטר)
const tiles = new Map();          // key → {state, mesh, gmesh, meta, lamps, tries, nextTry, d}
let bMat = null, gMat = null, inflight = 0, reqSeq = 0;
const MAX_INFLIGHT = 4;
function mkGeom(o) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(o.pos, 3)); g.setAttribute('normal', new T.BufferAttribute(o.nor, 3, true)); g.setAttribute('color', new T.BufferAttribute(o.col, 3, true));
  g.setAttribute('afl', new T.BufferAttribute(o.afl, 2)); g.setAttribute('aseed', new T.BufferAttribute(o.aseed, 1)); g.setAttribute('akind', new T.BufferAttribute(o.akind, 1));
  g.setIndex(new T.BufferAttribute(o.index, 1)); g.computeBoundingSphere(); return g;
}
worker.onmessage = (e) => {
  const m = e.data; if (m.type !== 'tile') return;
  inflight = Math.max(0, inflight - 1);
  const t = tiles.get(m.key); if (!t || t.req !== m.req) return;            // כבר נפרק – מתעלמים (לא קופאים)
  if (!m.ok) { t.state = 'err'; t.tries++; t.nextTry = performance.now() + Math.min(30000, 1500 * 2 ** t.tries); status.tileErr++; return; }
  try {
    const r = m.res;
    for (const mm of [t.mesh, t.gmesh]) if (mm) { scene.remove(mm); mm.geometry.dispose(); }      // החלפת LOD: הישן יורד רק כשהחדש מוכן
    t.mesh = t.gmesh = null; t.lod = t.reqLod;
    if (r.b.verts) { t.mesh = new T.Mesh(mkGeom(r.b), bMat); t.mesh.castShadow = true; t.mesh.receiveShadow = true; scene.add(t.mesh); }
    if (r.g.verts) { t.gmesh = new T.Mesh(mkGeom(r.g), gMat); t.gmesh.receiveShadow = true; t.gmesh.renderOrder = 0; scene.add(t.gmesh); }
    t.meta = r.meta; t.lamps = r.lamps; t.lampStreet = r.lampStreet; t.state = 'ok'; t.count = r.count; status.netBytes += m.net; status.tiles++;
    lampsDirty = true; wake(1200);
  } catch (err) { t.state = 'err'; t.tries++; t.nextTry = performance.now() + 5000; }
};
function disposeTile(k) {
  const t = tiles.get(k); if (!t) return;
  for (const mm of [t.mesh, t.gmesh]) if (mm) { scene.remove(mm); mm.geometry.dispose(); }
  tiles.delete(k); lampsDirty = true;
}
function updateTiles(cx, cz, dist) {
  const want = new Set();
  const R = dist < 6000 ? Math.min(3200, Math.max(1100, dist * 1.6)) : 0;
  if (R > 0 && IDX) {
    const E = cx + E0, N = -cz + N0;
    const tx0 = Math.floor((E - R) / 1000), tx1 = Math.floor((E + R) / 1000), ty0 = Math.floor((N - R) / 1000), ty1 = Math.floor((N + R) / 1000);
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      const k = tx + '_' + ty; if (!IDX.tiles[k]) continue;
      const dx = Math.max(tx * 1000 - E, 0, E - (tx + 1) * 1000), dy = Math.max(ty * 1000 - N, 0, N - (ty + 1) * 1000);
      if (dx * dx + dy * dy <= R * R) want.add(k);
    }
  }
  for (const k of [...tiles.keys()]) if (!want.has(k)) {        // פריקה עם היסטרזיס
    const [tx, ty] = k.split('_').map(Number), E = cx + E0, N = -cz + N0;
    const dx = Math.max(tx * 1000 - E, 0, E - (tx + 1) * 1000), dy = Math.max(ty * 1000 - N, 0, N - (ty + 1) * 1000);
    if (R === 0 || dx * dx + dy * dy > (R * 1.35) ** 2) disposeTile(k);
  }
  const now = performance.now();
  const order = [...want].map(k => { const [tx, ty] = k.split('_').map(Number); return [k, ((tx + 0.5) * 1000 - (cx + E0)) ** 2 + ((ty + 0.5) * 1000 - (-cz + N0)) ** 2]; }).sort((a, b) => a[1] - b[1]);
  // הערה: ה-Worker תומך גם ב-lod 0 (פישוט DP 1 מ' + בלי מבנים <40 מ"ר), אבל נמדד רק 6% פחות משולשים באריח הצפוף ביותר
  // (178_663) – לא שווה טעינה כפולה. הצמצום האמיתי: רדיוס גושי העיר קטן ברחוב (למטה).
  for (const [k] of order) {
    if (inflight >= MAX_INFLIGHT) break;
    let t = tiles.get(k);
    if (!t) { t = { state: 'new', tries: 0, nextTry: 0, lod: -1 }; tiles.set(k, t); }
    if (t.state === 'new' || (t.state === 'err' && now >= t.nextTry)) {          // ניסיון חוזר לאריחים שנכשלו (ממצא 8)
      t.state = 'load'; t.req = ++reqSeq; t.reqLod = 1; inflight++;
      worker.postMessage({ type: 'tile', key: k, req: t.req, E0, N0, lod: 1 });
    }
  }
  blockU.uDetail.value.set(cx, cz, R > 0 ? Math.max(0, R - 250) : -1);
  status.wanted = want.size; status.loaded = [...tiles.values()].filter(t => t.state === 'ok').length;
}
let lampsDirty = false, lampsAt = null;
function updateLamps(cx, cz, lightsOn) {
  if (!atmo || lightsOn < 0.02) return;
  const moved = !lampsAt || Math.hypot(cx - lampsAt[0], cz - lampsAt[1]) > 1200;
  if (!lampsDirty && !moved) return;
  lampsDirty = false; lampsAt = [cx, cz];
  const out = [], R2 = 2600 ** 2;
  for (const t of tiles.values()) { if (t.state !== 'ok' || !t.lamps) continue;
    for (let i = 0; i < t.lamps.length; i += 2) { const x = t.lamps[i], z = t.lamps[i + 1]; if ((x - cx) ** 2 + (z - cz) ** 2 < R2) out.push({ x, y: 0, z, street: t.lampStreet[i >> 1], type: lampTypeForStreet(t.lampStreet[i >> 1]) }); } }
  if (out.length > 9000) out.length = 9000;
  atmo.nightLights.setLamps(out, { box: { x0: cx - 2800, z0: cz - 2800, w: 5600, d: 5600 } });
  status.lamps = out.length;
}

// ------------------------------------------------------------------ camera state (אחת לשני העולמות)
const C = { lat: PLACES.globe.lat, lon: PLACES.globe.lon, dist: PLACES.globe.dist, heading: 0, tiltAdd: 0 };
const TILT_K = [[6.2, 0], [5.4, 18], [4.5, 48], [3.5, 62], [2.75, 70]];       // log10(מרחק) → הטיה (°): מהחלל ישר למטה, ברחוב כמו הולך רגל ברחפן
function autoTilt(d) { const l = Math.log10(Math.max(d, 50)); if (l >= TILT_K[0][0]) return 0; for (let i = 1; i < TILT_K.length; i++) { const [l1, t1] = TILT_K[i], [l0, t0] = TILT_K[i - 1]; if (l >= l1) return t0 + (t1 - t0) * (l0 - l) / (l0 - l1); } return 70; }
const tiltOf = () => Math.max(0, Math.min(78, autoTilt(C.dist) + C.tiltAdd));
function placeLocal() {
  const [E, N] = toITM(C.lat, C.lon); const [x, z] = L(E, N);
  const t = tiltOf() * D2R, h = C.heading * D2R;
  cam.position.set(x + Math.sin(t) * Math.sin(h) * C.dist, Math.cos(t) * C.dist, z + Math.sin(t) * Math.cos(h) * C.dist);
  cam.up.set(0, 1, 0); cam.lookAt(x, 0, z);
  cam.near = Math.max(0.5, C.dist * 0.01); cam.far = Math.max(40000, C.dist * 14); cam.updateProjectionMatrix();
  return [x, z];
}
function placeGlobe() {
  const P = new T.Vector3(...ll2v(C.lat, C.lon, RE)), up = P.clone().normalize();
  const northPole = new T.Vector3(0, 1, 0), east = new T.Vector3().crossVectors(northPole, up).normalize(), north = new T.Vector3().crossVectors(up, east).normalize();
  const t = tiltOf() * D2R, h = C.heading * D2R, dkm = C.dist / 1000;
  const back = north.clone().multiplyScalar(-Math.cos(h)).add(east.clone().multiplyScalar(-Math.sin(h)));
  gCam.position.copy(P).addScaledVector(up, Math.cos(t) * dkm).addScaledVector(back, Math.sin(t) * dkm);
  gCam.up.copy(dkm > 4000 ? northPole : north); gCam.lookAt(dkm > 4000 ? new T.Vector3() : P);
  gCam.near = Math.max(1, dkm * 0.2); gCam.far = dkm + RE * 3 + 160000; gCam.updateProjectionMatrix();
  gU.camPos.value.copy(gCam.position);
}

// ------------------------------------------------------------------ flights
let fly = null;
function flyTo(name, dur) {
  const p = PLACES[name]; if (!p) return;
  const b = p.itm ? (() => { const [la, lo] = fromITM(p.itm[0], p.itm[1]); return { lat: la, lon: lo, dist: p.dist, heading: p.heading || 0 }; })() : { heading: 0, ...p };
  const a = { lat: C.lat, lon: C.lon, dist: C.dist };
  const span = Math.abs(Math.log(b.dist / a.dist));
  wake(); fly = { a, b, t0: performance.now(), dur: dur || Math.min(6500, 1400 + span * 700), heading0: C.heading, tilt0: C.tiltAdd };
  document.querySelectorAll('.jb').forEach(x => x.classList.toggle('on', x.dataset.go === name));
}
function stepFly(now) {
  if (!fly) return;
  let u = Math.min(1, (now - fly.t0) / fly.dur); const e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
  // מרחק: לוגריתמי; מיקום מתכנס מהר יותר בזמן התקרבות ("נפילה" אל היעד)
  const la = Math.log(fly.a.dist), lb = Math.log(fly.b.dist), zoomIn = lb < la;
  const ep = zoomIn ? 1 - (1 - e) ** 2.2 : e ** 2.2;
  C.dist = Math.exp(la + (lb - la) * e);
  C.lat = fly.a.lat + (fly.b.lat - fly.a.lat) * ep; C.lon = fly.a.lon + (fly.b.lon - fly.a.lon) * ep;
  C.heading = fly.heading0 + (fly.b.heading - fly.heading0) * e; C.tiltAdd = fly.tilt0 * (1 - e);
  if (u >= 1) { const cb = fly.cb; fly = null; cb && cb(); }
}
async function introSequence() {
  if (Q.get('nointro')) return;
  await new Promise(r => setTimeout(r, 700));
  await new Promise(r => { flyTo('israel', 5200); fly.cb = r; });
  await new Promise(r => setTimeout(r, 250));
  await new Promise(r => { flyTo('ashdod', 4200); fly.cb = r; });
  await new Promise(r => setTimeout(r, 200));
  await new Promise(r => { flyTo('haerez', 3600); fly.cb = r; });
}

// ------------------------------------------------------------------ input (אצבע: גרירה, צביטה, סיבוב)
const ptrs = new Map(); let gest = null;
function panBy(dxPx, dyPx) {
  const mPerPx = C.dist * 2 * Math.tan(25 * D2R) / innerHeight;
  const h = C.heading * D2R, m = mPerPx / Math.max(0.35, Math.cos(tiltOf() * D2R) ** 0.5);
  const dE = -dxPx * m * Math.cos(h) - dyPx * m * Math.sin(h), dN = -dxPx * m * Math.sin(h) + dyPx * m * Math.cos(h);   // ימין המסך = (cos h, sin h), קדימה = (−sin h, cos h)
  if (C.dist > SWITCH_KM * 1000) { C.lat = Math.max(-80, Math.min(80, C.lat + dN / 111000)); C.lon += dE / (111000 * Math.cos(C.lat * D2R)); C.lon = ((C.lon + 540) % 360) - 180; }
  else { const [E, N] = toITM(C.lat, C.lon); const [la, lo] = fromITM(E + dE, N + dN); C.lat = la; C.lon = lo; }
}
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() }); fly = null; gest = null; });
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return; wake();
  const px = p.x, py = p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) panBy(p.x - px, p.y - py);
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
    if (gest) { C.dist = Math.max(80, Math.min(25000e3, C.dist * gest.d / Math.max(d, 1))); let da = ang - gest.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; C.heading += da / D2R; C.tiltAdd = Math.max(-40, Math.min(25, C.tiltAdd + (my - gest.my) * 0.25)); }
    gest = { d, ang, my };
  }
});
const endPtr = e => { const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); gest = null; if (p && ptrs.size === 0 && Math.hypot(p.x - p.x0, p.y - p.y0) < 6 && performance.now() - p.t0 < 350) pick(e.clientX, e.clientY); };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => { e.preventDefault(); fly = null; wake(); C.dist = Math.max(80, Math.min(25000e3, C.dist * Math.exp(e.deltaY * 0.0015))); }, { passive: false });
$('zin').onclick = () => { fly = null; wake(); C.dist = Math.max(80, C.dist / 2.2); };
$('zout').onclick = () => { fly = null; wake(); C.dist = Math.min(25000e3, C.dist * 2.2); };
$('tilt').onclick = () => { wake(); C.tiltAdd = C.tiltAdd > 5 ? -30 : C.tiltAdd < -5 ? 0 : 14; };
$('north').onclick = () => { wake(); C.heading = 0; };
document.querySelectorAll('.jb').forEach(b => b.onclick = () => flyTo(b.dataset.go));
$('dbgb').onclick = () => { const d = $('dbg'); d.style.display = d.style.display === 'block' ? 'none' : 'block'; };
if (Q.get('debug')) $('dbg').style.display = 'block';

// ---------- בחירת בניין (כרטיס) – טקסט בלבד, textContent
const ray = new T.Raycaster();
function pick(x, y) {
  if (status.mode !== 'local') return;
  ray.setFromCamera(new T.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam);
  const ms = []; for (const t of tiles.values()) if (t.mesh) ms.push(t.mesh);
  const hit = ray.intersectObjects(ms, false)[0]; if (!hit) { $('card').style.display = 'none'; return; }
  const t = [...tiles.values()].find(q => q.mesh === hit.object); if (!t || !t.meta) return;
  const st = t.meta.triStart; let lo = 0, hi = st.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid] <= hit.faceIndex) lo = mid; else hi = mid - 1; }
  const M = t.meta, i = lo;
  $('ct').textContent = M.names[i] || (M.typ[i] ? 'בניין · ' + M.typ[i] : 'בניין');
  const cb = $('cb'); cb.textContent = '';
  const line = (txt, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = txt; cb.appendChild(d); return d; };
  const h = line('גובה ' + M.h[i].toFixed(0) + ' מ\' ± ' + M.sg[i].toFixed(0) + ' · כ-' + M.f[i] + ' קומות');
  const tag = document.createElement('span'); tag.id = 'tag'; tag.textContent = M.he[i] || 'משוער'; h.appendChild(tag);
  const [la, lo2] = fromITM(M.cx[i] + E0, -M.cz[i] + N0);
  line('מזהה OSM ' + M.ids[i] + ' · ITM ' + Math.round(M.cx[i] + E0) + ', ' + Math.round(-M.cz[i] + N0) + ' · ' + la.toFixed(5) + ', ' + lo2.toFixed(5), 'm');
  line(M.he[i] === 'משוער' ? 'הגובה הוא כלל אצבע לפי סוג ושטח – לא נמדד. אשרו או תקנו בשטח.' : 'מקור הגובה: ' + (M.he[i] || '-'), 'm');
  $('card').style.display = 'block';
}
$('cx').onclick = () => $('card').style.display = 'none';

// ---------- מסירה לעולם התאום (מארח האינטגרציה): ?embed=1 → כפתור "כניסה לרחוב" שולח ITM אמיתי להורה (אותו מקור בלבד)
const EMBED = Q.get('embed') === '1' && window.parent !== window;
let handBtn = null;
if (EMBED) {
  handBtn = document.createElement('button'); handBtn.className = 'jb glass'; handBtn.id = 'handoff'; handBtn.textContent = 'כניסה לרחוב ›';
  handBtn.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom) + 160px);z-index:7;display:none;border-color:var(--acc);color:var(--acc);font-size:15px;padding:12px 18px';
  document.body.appendChild(handBtn);
  handBtn.onclick = () => { const [E, N] = toITM(C.lat, C.lon);
    window.parent.postMessage({ type: 'yz-national-handoff', crs: 'EPSG:2039 (ITM אמיתי)', E: Math.round(E * 10) / 10, N: Math.round(N * 10) / 10, heading: C.heading, dist: C.dist, t: simMs }, location.origin); };
  const back = document.createElement('button'); back.className = 'rb glass'; back.id = 'embBack'; back.textContent = '✕'; back.setAttribute('aria-label', 'חזרה לעולם');
  back.style.cssText = 'position:fixed;left:10px;bottom:calc(env(safe-area-inset-bottom) + 170px);z-index:7';
  back.onclick = () => window.parent.postMessage({ type: 'yz-national-close' }, location.origin);
  document.body.appendChild(back);
}

// ------------------------------------------------------------------ time UI
const slider = $('time');
function setSim(ms, isLive) { wake(3500); simMs = ms; live = !!isLive; $('now').classList.toggle('live', live); $('now').textContent = live ? 'חי' : 'עכשיו'; }
slider.addEventListener('input', () => setSim(msForLocalMinute(simMs, +slider.value), false));
$('now').onclick = () => setSim(Date.now(), true);
function updTimeUI() {
  const p = israelParts(simMs), mins = p.hh * 60 + p.mm;
  $('clock').textContent = String(p.hh).padStart(2, '0') + ':' + String(p.mm).padStart(2, '0');
  if (document.activeElement !== slider) slider.value = mins;
  $('knob').style.left = (mins / 1439 * 100) + '%';
  const sp = sunPosition(simMs, 31.8, 34.65), mp = moonPosition(simMs, 31.8, 34.65);
  $('knob').classList.toggle('night', sp.elevation < -2);
  const ph = $('phase'); ph.textContent = '';
  const b = document.createElement('b'); b.textContent = (sp.elevation > 6 ? 'יום' : sp.elevation > -0.833 ? (p.hh < 12 ? 'זריחה' : 'שקיעה') : sp.elevation > -6 ? 'דמדומים' : 'לילה') + ' · ' + p.d + '.' + p.m + '.' + p.y; ph.appendChild(b);
  ph.appendChild(document.createElement('br'));
  ph.appendChild(document.createTextNode('שמש ' + sp.elevation.toFixed(0) + '° · ירח ' + (mp.elevation > 0 ? 'מעל האופק ' : 'מתחת לאופק ') + Math.round(mp.illumination * 100) + '% מואר'));
}

// ------------------------------------------------------------------ frame
let quietUntil = 0; const wake = (ms = 2500) => { quietUntil = Math.max(quietUntil, performance.now() + ms); };
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = last, lowFps = 0, highFps = 0;
const fadeCv = $('fade'), fadeCx = fadeCv.getContext('2d');
function snapshotFade() { fadeCv.width = canvas.width; fadeCv.height = canvas.height; fadeCx.drawImage(canvas, 0, 0); fadeCv.style.transition = 'none'; fadeCv.style.opacity = 1; requestAnimationFrame(() => { fadeCv.style.transition = 'opacity .45s ease'; fadeCv.style.opacity = 0; }); }
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000), fms = now - last; last = now;
  if (status.frames > 30) { status.maxFrameMs = Math.max(status.maxFrameMs, fms); if (fms > 100) status.longFrames++; }
  if (fly || ptrs.size || inflight || (status.wanted || 0) > (status.loaded || 0)) wake(400);
  if (live && Date.now() - simMs > 30000) { simMs = Date.now(); wake(1500); }
  if (now > quietUntil && status.frames > 5) { status.idle = true; last = now; fpsT = now; fpsN = 0; return; }   // אין שינוי → לא מציירים (סוללה)
  status.idle = false;
  renderer.info.reset();
  try {
    stepFly(now);
    const mode = C.dist > SWITCH_KM * 1000 ? 'globe' : 'local';
    if (mode !== status.mode && status.frames > 0) snapshotFade();
    status.mode = mode;
    if (mode === 'globe') {
      placeGlobe();
      const s = subsolar(simMs); gU.sunDir.value.set(...ll2v(s.lat, s.lon, 1));
      renderer.setRenderTarget(null); renderer.toneMapping = T.NoToneMapping; renderer.render(gScene, gCam);
    } else {
      const [x, z] = placeLocal();
      const bR = C.dist < 3500 ? 9000 : C.dist > 5000 ? 32000 : (blockAt ? blockAt[2] : 32000);                                   // ברחוב: גושים עד 9 ק"מ (מעבר לזה ערפל) → ~70% פחות משולשים
      if (!blockAt || blockAt[2] !== bR || Math.hypot(x - blockAt[0], z - blockAt[1]) > bR * 0.28) buildBlocks(x, z, bR);
      if (blocks) blocks.visible = C.dist < 60000;
      if (roadLines) { roadLines.visible = C.dist > 700 && C.dist < 420000; roadU.uAlpha.value = Math.min(1, (C.dist - 700) / 1500) * Math.min(1, (420000 - C.dist) / 150000) * ((atmo.state && atmo.state.night.lightsOn) > 0.5 ? 1 : Math.max(0.18, Math.min(1, 1 - (C.dist - 15000) / 120000))); }
      updateTiles(x, z, C.dist);
      atmo.setTime(simMs); atmo.setFocus(new T.Vector3(x, 0, z), Math.max(300, Math.min(1400, C.dist * 1.1)));
      const look = atmo.update(dt);
      const alt = cam.position.y, k = Math.min(1, Math.pow(1500 / Math.max(alt, 1), 1.2));   // מגובה רב: נתיב קצר יותר באוויר הצפוף → פחות אובך (קירוב אמנותי)
      atmo.shared.uFogBeta.value *= k; if (scene.fog) scene.fog.density *= k;
      atmo.sun.castShadow = C.dist < 5000 && look.sun.intensity > 0.002;
      const lo = look.night.lightsOn; nightU.uCityNight.value = lo * 7e-5 * Math.min(1, 0.35 + C.dist / 20000);   // סקאלת הרדיאנס של ה-rig (חלון דולק ≈ 9e-5)
      updateLamps(x, z, lo);
      roadU.uNight.value = lo * 1.6e-4 * (C.dist > 30000 ? 1.6 : 1);
      roadU.uDay.value = (look.sun.intensity * Math.max(0, look.sun.dir.y) + (look.hemi.sky[0] + look.hemi.sky[1] + look.hemi.sky[2]) / 3) / Math.PI;
      atmo.render();
    }
    status.calls = renderer.info.render.calls; status.tris = renderer.info.render.triangles;
    if (status.frames % 15 === 0) updHUD();
  } catch (err) { status.lastErr = String(err && err.message || err); }
  status.frames++;
  fpsAcc += dt; fpsN++;
  if (now - fpsT > 1000) {
    status.fps = fpsN / ((now - fpsT) / 1000); fpsT = now; fpsN = 0;
    if (status.fps < 40) { lowFps++; highFps = 0; } else if (status.fps > 57) { highFps++; lowFps = 0; }
    const locked = !!Q.get('tier');                       // ?tier= נועל איכות (בדיקות/צילומים)
    if (!locked && lowFps >= 2 && DPR > 1) { DPR = 1; renderer.setPixelRatio(DPR); resize(); lowFps = 0; }
    if (!locked && lowFps >= 4 && atmo && atmo.tier !== 'low') { atmo.setQualityTier('low'); lowFps = 0; }
  }
}
function fmtDist(m) { return m >= 10000 ? Math.round(m / 1000).toLocaleString('he-IL') + ' ק"מ' : m >= 1000 ? (m / 1000).toFixed(1) + ' ק"מ' : Math.round(m) + ' מ\''; }
function updHUD() {
  $('altv').textContent = fmtDist(C.dist);
  if (handBtn) handBtn.style.display = C.dist < 2500 && !fly ? 'block' : 'none';
  updTimeUI();
  if ($('dbg').style.display === 'block') {
    const i = renderer.info, mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + 'MB' : '-';
    $('dbg').textContent = `fps ${status.fps.toFixed(0)} dpr ${DPR}\nmode ${status.mode}\ncalls ${status.calls} tris ${((status.tris || 0) / 1000).toFixed(0)}k\ngeom ${i.memory.geometries} tex ${i.memory.textures}\ntiles ${status.loaded || 0}/${status.wanted || 0} err ${status.tileErr}\nblocks ${status.builtBlocks} lamps ${status.lamps}\nheap ${mem}\nnet ${(status.netBytes / 1048576).toFixed(1)}MB`;
  }
}
function resize() { wake(); renderer.setSize(innerWidth, innerHeight, false); for (const c of [cam, gCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); } atmo && atmo.setSize(canvas.width, canvas.height); }
addEventListener('resize', resize);

// ------------------------------------------------------------------ boot
window.NAT = { C, status, tiles, flyTo, get atmo() { return atmo; }, setTime: (iso) => setSim(Date.parse(iso), false), get mode() { return status.mode; }, renderer,
  stats: () => ({ ...status, geoms: renderer.info.memory.geometries, texs: renderer.info.memory.textures, heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null, tilesInMap: tiles.size }),
  wake, jump: (lat, lon, dist) => { fly = null; wake(5000); Object.assign(C, { lat, lon, dist }); }, jumpITM: (E, N, dist) => { fly = null; wake(5000); const [la, lo] = fromITM(E, N); Object.assign(C, { lat: la, lon: lo, dist }); } };
(async function boot() {
  try {
    loadMsg('טוען את כדור הארץ…', 0.1);
    const [d, n] = await Promise.all([loadTex('tex/earth_day_2k.jpg'), loadTex('tex/earth_night_2k.jpg')]);
    gU.day.value = d; gU.night.value = n;
    loadMsg('טוען את מפת ישראל…', 0.45);
    IDX = await (await fetch(BASE + 'nat/index.json')).json();
    OV = await (await fetch(BASE + 'nat/overview.json')).json();
    E0 = IDX.center_itm[0]; N0 = IDX.center_itm[1];
    { const ovT = await loadTex(BASE + 'nat/overview.png', false); ovT.minFilter = T.LinearMipmapLinearFilter; gU.ov.value = ovT;
      const W = OV.size * OV.cell_m, [la1, lo0] = fromITM(OV.origin_itm_nw[0], OV.origin_itm_nw[1]), [la0, lo1] = fromITM(OV.origin_itm_nw[0] + W, OV.origin_itm_nw[1] - W);
      gU.ovBox.value.set(lo0, la0, lo1, la1); }      // קירוב: תיבת אורך/רוחב לינארית (סטייה של מאות מטרים בקצוות – רק לתצוגת החלל)
    const nb = Object.values(IDX.tiles).reduce((s, v) => s + v[0], 0);
    const partial = /TAMA/.test(IDX.sources && IDX.sources.buildings_roads || '');
    $('cov').textContent = nb.toLocaleString('he-IL') + ' בניינים · ' + (partial ? 'כיסוי חלקי: אשדוד–גוש דן' : 'רדיוס ' + IDX.radius_km + ' ק"מ');
    atmo = createAtmosphere({ THREE: T, renderer, scene, camera: cam, tier: Q.get('tier') || 'mid' });
    atmo.setSize(canvas.width, canvas.height);
    bMat = atmo.patchMaterial(new T.MeshLambertMaterial({ vertexColors: true }));
    gMat = atmo.patchMaterial(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    await buildGround(); loadMsg('מכין את העיר…', 0.8);
    await loadBlocks();
    loadRoads().catch(e => { status.roadErr = String(e); });
    if (Q.get('at')) { const p = PLACES[Q.get('at')]; if (p) { if (p.itm) NAT.jumpITM(p.itm[0], p.itm[1], p.dist); else Object.assign(C, p); C.heading = p.heading || 0; } }
    if (Q.get('dist')) C.dist = +Q.get('dist');
    setSim(simMs, live);
    requestAnimationFrame(frame);
    loadMsg('', 1); $('load').style.opacity = 0; setTimeout(() => $('load').style.display = 'none', 650);
    window.NAT.ready = true;
    if (!Q.get('at')) introSequence();
  } catch (err) { loadMsg('שגיאה בטעינה: ' + (err && err.message || err)); window.NAT.bootErr = String(err); }
})();
