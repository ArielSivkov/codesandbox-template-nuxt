/* המחלקה הימית — demo on the Ashdod sample: sea + port + marina + beach + boat mode.
 * URL: ?view=boat|beach|port|sunset  &wx=sea-breeze|calm-clear|winter-storm|sharav  &wind=U,fromDeg  &hour=HH.MM  &shot=1  &ais=1
 * Reads (does not modify): twin/game/js/world.js + twin/game/data (tiles), swarm/weather, swarm/physics (sun), swarm/aviation (WGS84→ITM).
 */
import { createMaritime, decodeTerrainBin, FixtureAIS, knots, beaufort } from './maritime.js';
import { presetWeather, windToVector } from '../weather/weather.js';
import { sunPosition, sunVector, itmConvergence, localToUtc } from '../physics/src/sun.js';
import { wgsToItm } from '../aviation/src/geo.js';

const T = window.THREE, W = window.W27;
const Q = new URLSearchParams(location.search);
const SHOT = Q.has('shot'), VIEW = Q.get('view') || 'boat';
const TWIN = window.TWIN, DATA = Q.get('data') || 'demo-data/';   // demo-data = sample copy with offshore OUTSIDE→SEA (tools/fix_sample_sea.py)
const SAMPLE_SHIFT = { dE: 1524.6, dN: 753.6 };          // real ITM = sample + shift (twin/groundtruth/README.txt)
const $ = id => document.getElementById(id);
const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (!TOUCH) document.body.classList.add('desk');
if (SHOT) document.body.classList.add('shot');
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// ---------------------------------------------------------------- renderer (same look settings as the game)
const cv = $('cv');
const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TOUCH ? 1.25 : 1.5));
renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(60, 1, 0.3, 40000);
scene.fog = new T.Fog(0xcfe0ec, 1500, 9000);
const skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new T.Color() }, hor: { value: new T.Color() }, sun: { value: new T.Vector3() }, sunCol: { value: new T.Color() }, glow: { value: new T.Color() } },
  vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }',
  fragmentShader: `uniform vec3 top, hor, sun, sunCol, glow; varying vec3 vD;
void main(){ vec3 d = normalize(vD); float h = clamp(d.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.5));
  float s = max(dot(d, sun), 0.0); c += glow * pow(s, 6.0) * (1.0 - h) * 0.9; c += sunCol * (smoothstep(0.9993, 0.9997, s) * 6.0 + pow(s, 300.0) * 0.6);
  if (d.y < 0.0) c = hor; gl_FragColor = vec4(c, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}` });
const sky = new T.Mesh(new T.SphereGeometry(30000, 32, 16), skyMat); sky.frustumCulled = false; scene.add(sky);
const hemi = new T.HemisphereLight(0xdcecff, 0xa08f70, 1.0); scene.add(hemi);
const sun = new T.DirectionalLight(0xfff1dc, 2.0); scene.add(sun); scene.add(sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); const SC = sun.shadow.camera; SC.left = SC.bottom = -140; SC.right = SC.top = 140; SC.near = 1; SC.far = 900;

// ---------------------------------------------------------------- sun & sky from the real sun (physics team's NOAA code)
const LAT = 31.80, LON = 34.65;
function sunAt(hourLocal) {
  const hh = Math.floor(hourLocal), mm = Math.round((hourLocal - hh) * 60);
  const ms = localToUtc(2026, 11, 23, hh, mm, 0, 'Asia/Jerusalem');
  const sp = sunPosition(ms, LAT, LON), v = sunVector(sp.elevation, sp.azimuth, itmConvergence(LAT, LON));
  return { v, elev: sp.elevation, az: sp.azimuth, ms };
}
function applySky(s, M) {
  const e = s.elev, low = clamp(1 - (e - 1) / 14, 0, 1), night = clamp(-e / 6, 0, 1);
  const top = new T.Color(0x3d7fc4).lerp(new T.Color(0x41628f), low * 0.7).lerp(new T.Color(0x0b1424), night);
  const hor = new T.Color(0xcfe0ec).lerp(new T.Color(0xf2b27c), low * 0.85).lerp(new T.Color(0x1a2333), night);
  const sc = new T.Color(0xfff1dc).lerp(new T.Color(0xff9a4a), low);
  skyMat.uniforms.top.value.copy(top); skyMat.uniforms.hor.value.copy(hor); skyMat.uniforms.sun.value.set(s.v.x, s.v.y, s.v.z);
  skyMat.uniforms.sunCol.value.copy(sc).multiplyScalar(e > -1 ? 1 : 0); skyMat.uniforms.glow.value.copy(new T.Color(0xffa060).multiplyScalar(low * 0.8));
  sun.color.copy(sc); sun.intensity = 2.2 * clamp(e / 8, 0.05, 1); hemi.intensity = 0.35 + 0.75 * clamp(e / 25, 0, 1);
  hemi.color.copy(top).lerp(new T.Color(0xffffff), 0.5);
  scene.fog.color.copy(hor);
  if (M) { M.setSun(s.v, { color: sc }); M.setSky({ top, hor, fogColor: hor, fogNear: 1800, fogFar: 26000 }); }
}

// ---------------------------------------------------------------- loading
async function fetchBuf(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  let buf = await r.arrayBuffer(); const u = new Uint8Array(buf, 0, 2);
  if (u[0] === 0x1f && u[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buf;
}
const json = async url => JSON.parse(new TextDecoder().decode(await fetchBuf(url)));

const S = { mode: SHOT && VIEW !== 'boat' ? 'view' : 'boat', cam: { yaw: 0, pitch: 0.22, dist: 12, lastDrag: -9 }, t: 0, hour: +(Q.get('hour') || (VIEW === 'sunset' ? 16.52 : 11.5)) };
let M, boat, buildIdx;

async function init() {
  const m = await W.init(scene, { base: DATA });
  if (W.sea) W.sea.visible = false;                                       // the maritime ocean replaces the game's flat sea
  const tileFrame = { toITM: (x, z) => W.toITM(x, z), toScene: (E, N) => W.toScene(E, N) };
  const toScene = (E, N) => W.toScene(E - SAMPLE_SHIFT.dE, N - SAMPLE_SHIFT.dN);   // REAL ITM → scene (sample frame)
  const [tiles, vt, fixture, aisFx] = await Promise.all([
    Promise.all(m.tiles.map(k => fetchBuf(DATA + 'tiles/t/' + k + '.bin.gz').then(b => decodeTerrainBin(new Uint8Array(b))))),
    Promise.all(m.tiles.map(k => json(DATA + 'tiles/v/' + k + '.json.gz').catch(() => null))),
    fetch('fixtures/ashdod_maritime_fixture.json').then(r => r.json()),
    fetch('fixtures/ais_fixture.json').then(r => r.json()),
  ]);
  buildIdx = buildingIndex(vt.filter(Boolean));
  const wx = Q.get('wind') ? null : presetWeather(Q.get('wx') || (VIEW === 'sunset' ? 'calm-clear' : 'sea-breeze'), { now: Date.now() });
  let windVec;
  if (Q.get('wind')) { const [U, dir] = Q.get('wind').split(',').map(Number); windVec = windToVector(U, dir); } else windVec = wx.current.wind_vec;
  M = createMaritime(T, {
    scene, toScene, tileFrame, tiles, bboxITM: m.bbox_itm, features: fixture.features,
    isBuilding: (x, z, pad) => buildIdx.near(x, z, pad),
    llToScene: (lat, lon) => { const p = wgsToItm(lat, lon); return toScene(p.E, p.N); },
  });
  M.setWind(windVec);
  applySky(sunAt(S.hour), M);
  if (Q.get('ais') === '1') toggleAIS(aisFx); $('bAis').onclick = () => toggleAIS(aisFx);
  // boat enters at the marina: start just inside the marina mouth, bow toward the open sea
  const mar = M.features.find(f => f.kind === 'marina');
  const lights = M.features.filter(f => f.kind === 'light').slice(-2);
  const mx = (lights[0].pts[0][0] + lights[1].pts[0][0]) / 2, mz = (lights[0].pts[0][1] + lights[1].pts[0][1]) / 2;
  boat = M.createBoat(mx + 25, mz + 70, Math.PI * 0.9);
  if (SHOT && Q.get('wx') === 'winter-storm') boat.place(mx - 1300, mz - 900, Math.PI * 0.9);   // storm shot: open water
  window.__boatStart = { x: mx, z: mz, marina: !!mar };
  setupView(VIEW);
  $('load').style.display = 'none';
  return m;
}

function toggleAIS(fx) {
  const on = !$('bAis').classList.contains('on');
  $('bAis').classList.toggle('on', on);
  if (on) M.useAIS(new FixtureAIS(fx)); else { M.traffic.setAIS([], null); }
}

function buildingIndex(vtiles) {
  const HC = 64, hash = new Map(), list = [];
  for (const v of vtiles) for (const b of v.b) {
    let x = v.o[0], y = v.o[1], minx = 1e9, minz = 1e9, maxx = -1e9, maxz = -1e9;
    const r = b.r[0];
    for (let i = 0; i < r.length; i += 2) { x += r[i] / 10; y += r[i + 1] / 10; const p = W.toScene(x, y); minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
    const o = { minx, minz, maxx, maxz }; list.push(o);
    for (let i = Math.floor(minx / HC); i <= Math.floor(maxx / HC); i++) for (let j = Math.floor(minz / HC); j <= Math.floor(maxz / HC); j++) { const k = i + ',' + j; if (!hash.has(k)) hash.set(k, []); hash.get(k).push(o); }
  }
  return { near(x, z, pad = 0) { const a = hash.get(Math.floor(x / HC) + ',' + Math.floor(z / HC)) || []; for (const o of a) if (x > o.minx - pad && x < o.maxx + pad && z > o.minz - pad && z < o.maxz + pad) return true; return false; }, count: list.length };
}

// ---------------------------------------------------------------- views for screenshots / buttons
const camPos = new T.Vector3(), camTgt = new T.Vector3();
function setupView(v) {
  const portArea = M.features.find(f => f.kind === 'port_area'), basin = M.features.find(f => f.kind === 'basin');
  const cen = p => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
  if (v === 'beachtop') {
    const t = M.beach.towers[Math.min(3, M.beach.towers.length - 1)]; S.mode = 'view'; camTgt.set(t.x, 0, t.z); camPos.set(t.x + 40, 140, t.z + 90);
  } else if (v === 'ais') {
    const [px, pz] = cen(basin.pts); S.mode = 'view'; camPos.set(px + 400, 520, pz + 500); camTgt.set(px - 2600, 0, pz - 900);
  } else if (v === 'top') {
    const [px, pz] = cen(basin.pts); S.mode = 'view'; camTgt.set(px, 0, pz); camPos.set(px, 2600, pz + 2);
  } else if (v === 'port') {
    const [px, pz] = cen(basin.pts);
    S.mode = 'view'; camTgt.set(px + 150, 0, pz + 60); camPos.set(px - 650, 430, pz + 820);
  } else if (v === 'beach' || v === 'sunset') {
    const t = M.beach.towers[Math.min(3, M.beach.towers.length - 1)];
    const sx = Math.sin(t.h), sz = Math.cos(t.h);                       // seaward unit vector (tower window faces the sea)
    const ax = 0.415, az = -0.91;                                        // along the coast, toward NNE
    S.mode = 'view';
    if (v === 'sunset') { const sd = M.ocean.uniforms.uSun.value; const px = t.x + sx * 18, pz = t.z + sz * 18; camPos.set(px, Math.max(0, -M.depthAt(px, pz)) + 2.0, pz); camTgt.set(px + sd.x * 400, 2, pz + sd.z * 400); }
    else { const px = t.x + sx * 4, pz = t.z + sz * 4; camPos.set(px, t.y + 6.4, pz); camTgt.set(px + ax * 110 + sx * 55, 0.5, pz + az * 110 + sz * 55); }   // on the lifeguard tower deck
  }
  if (S.mode === 'view') { S.cam.yaw = Math.atan2(camTgt.x - camPos.x, camTgt.z - camPos.z); S.cam.dist = camPos.distanceTo(camTgt); S.cam.pitch = Math.asin(clamp((camPos.y - camTgt.y) / S.cam.dist, -1, 1)); S.view = camTgt.clone(); }
  $('mBoat').classList.toggle('on', S.mode === 'boat'); $('mView').classList.toggle('on', S.mode === 'view');
}
$('mBoat').onclick = () => { S.mode = 'boat'; S.cam.dist = 12; S.cam.pitch = 0.22; setupView('boat'); };
$('mView').onclick = () => { S.mode = 'view'; S.view = new T.Vector3(boat.state.x, 0, boat.state.z); S.cam.dist = 160; S.cam.pitch = 0.5; setupView('free'); };
$('labels').onclick = () => $('labels').classList.toggle('open');
$('bTime').onclick = () => { S.hour = S.hour > 15 ? 11.5 : 16.52; $('bTime').textContent = S.hour > 15 ? '☀️ צהריים' : '🌅 שקיעה'; applySky(sunAt(S.hour), M); };

// ---------------------------------------------------------------- input (same conventions as twin/game: joystick left, buttons right, drag = camera)
const input = { x: 0, y: 0, up: false, down: false, keys: new Set() };
addEventListener('keydown', e => input.keys.add(e.code)); addEventListener('keyup', e => input.keys.delete(e.code));
const joy = $('joy'), knob = joy.querySelector('i'); let joyId = null, joyC = null;
joy.addEventListener('pointerdown', e => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); const r = joy.getBoundingClientRect(); joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 }; joyMove(e); e.preventDefault(); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; input.x = input.y = 0; knob.style.transform = ''; };
joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
function joyMove(e) { let dx = e.clientX - joyC.x, dy = e.clientY - joyC.y; const l = Math.hypot(dx, dy), m = joyC.R * 0.8; if (l > m) { dx *= m / l; dy *= m / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; input.x = dx / m; input.y = -dy / m; }
function hold(el, k) { const on = e => { input[k] = true; el.classList.add('hold'); e.preventDefault(); }, off = () => { input[k] = false; el.classList.remove('hold'); }; el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off); }
hold($('bA'), 'up'); hold($('bB'), 'down');
const drags = new Map();
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
cv.addEventListener('pointermove', e => { const d = drags.get(e.pointerId); if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; if (drags.size === 1) { S.cam.yaw -= dx * 0.006; S.cam.pitch = clamp(S.cam.pitch + dy * 0.004, -0.1, 1.45); S.cam.lastDrag = S.t; } });
const dEnd = e => drags.delete(e.pointerId); cv.addEventListener('pointerup', dEnd); cv.addEventListener('pointercancel', dEnd);
cv.addEventListener('wheel', e => { S.cam.dist = clamp(S.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 4, 3000); e.preventDefault(); }, { passive: false });
function readInput() {
  const k = input.keys; let x = input.x, y = input.y;
  if (k.has('KeyW') || k.has('ArrowUp')) y = 1; if (k.has('KeyS') || k.has('ArrowDown')) y = -1;
  if (k.has('KeyD') || k.has('ArrowRight')) x = 1; if (k.has('KeyA') || k.has('ArrowLeft')) x = -1;
  const rev = input.down || k.has('KeyC');
  return { throttle: rev ? -1 : y, steer: x, boost: input.up || k.has('ShiftLeft') || k.has('Space') };
}

// ---------------------------------------------------------------- camera
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
function updateCam(dt) {
  const c = S.cam; let tx, ty, tz;
  if (S.mode === 'boat') {
    const s = boat.state; tx = s.x; ty = s.y + 1.4; tz = s.z;
    if (S.t - c.lastDrag > 1.6 && Math.abs(s.u) > 1.5) c.yaw += angDiff(c.yaw, s.h) * Math.min(1, dt * 2.2);
  } else { tx = S.view.x; ty = S.view.y; tz = S.view.z; }
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  camPos.set(tx - Math.sin(c.yaw) * cp * c.dist, ty + sp * c.dist, tz - Math.cos(c.yaw) * cp * c.dist);
  const minY = Math.max(W.H(camPos.x, camPos.z), M.seaHeight(camPos.x, camPos.z) * 0) + 0.8;
  if (camPos.y < minY) camPos.y = minY;
  if (SHOT || camera.position.distanceTo(camPos) > 80) camera.position.copy(camPos); else camera.position.lerp(camPos, 1 - Math.exp(-dt * 10));
  camera.lookAt(tx, ty, tz);
  sky.position.copy(camera.position);
  const alt = camera.position.y; camera.near = alt > 150 ? 2 : 0.3; camera.updateProjectionMatrix();
  sun.position.set(tx + M.ocean.uniforms.uSun.value.x * 400, ty + Math.max(0.05, M.ocean.uniforms.uSun.value.y) * 400, tz + M.ocean.uniforms.uSun.value.z * 400); sun.target.position.set(tx, ty, tz);
  W.radius = alt > 200 ? 2300 : 1500; W.hiRadius = 650;
}

// ---------------------------------------------------------------- HUD / labels / perf
function hud(fps) {
  const s = boat.state;
  $('hSpd').textContent = knots(Math.abs(s.u)).toFixed(0); $('hKmh').textContent = (Math.abs(s.u) * 3.6).toFixed(0) + ' קמ״ש';
  $('hPlane').textContent = s.airborne ? '✈ באוויר' : s.planing > 0.8 ? 'גלישה' : s.planing > 0.2 ? 'מעבר לגלישה' : 'מים רדודים'.length && Math.abs(s.u) < 0.3 ? 'עומדת' : 'הדחקה';
  const sea = M.sea;
  $('labels').innerHTML = `<div>ⓘ משוער: גלים ${sea.HsTotal.toFixed(1)} מ' (CEM) · עומק מפרופיל · נמל סכמטי · ${M.labels.ais()}</div>` +
    [M.labels.waves(), M.labels.depth, M.labels.port, M.labels.traffic + ' · ' + M.labels.beach, 'סירה: מודל פיזיקלי מקורב (ציפה, גלישה, גרר) · שמש אמיתית לפי תאריך/שעה (NOAA) · בניינים/קרקע: OSM/SRTM מהדגימה'].map(t => `<div class="more">${t}</div>`).join('');
  const i = renderer.info;
  $('perf').textContent = `${fps.toFixed(0)} fps · ${i.render.calls} calls · ${(i.render.triangles / 1000).toFixed(0)}k tris`;
}

// ---------------------------------------------------------------- loop
let last = performance.now(), fpsS = 60, hudT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; S.t += dt; fpsS = fpsS * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  if (S.mode === 'boat') boat.step(dt, readInput()); else boat.step(dt, { throttle: 0, steer: 0 });
  M.update(dt, camera, { boats: [boat] });
  updateCam(dt);
  W.update(camera.position.x, camera.position.z, 6);
  renderer.render(scene, camera);
  hudT -= dt; if (hudT < 0) { hud(fpsS); hudT = 0.25; }
  requestAnimationFrame(frame);
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

function maritimeCost() {   // main-pass triangles / draw calls of the maritime groups only (shadow pass not included)
  let tris = 0, calls = 0, shadowCasters = 0; const by = {};
  const roots = [M.ocean.mesh, M.port.group, M.traffic.group, M.beach.group, boat.mesh];
  for (const r of roots) r.traverse(o => { if (!o.isMesh || !o.visible) return; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; const k = o.isInstancedMesh ? o.count : 1; if (!k) return; tris += n * k; calls++; by[o.name] = Math.round(n * k); if (o.castShadow) shadowCasters++; });
  return { tris: Math.round(tris), calls, shadowCasters, by };
}
// GPU ↔ CPU check: render the ocean's displaced height (vW.y) straight down with an orthographic camera into a
// 16-bit-encoded target and compare every pixel with M.seaHeight at that pixel's world x,z.
window.__gpucheck = function (size = 64, span = 40) {
  const s = boat.state, u = M.ocean.uniforms;
  const mat = new T.ShaderMaterial({ uniforms: u, vertexShader: M.ocean.mesh.material.vertexShader,
    fragmentShader: 'varying vec3 vW; varying vec3 vN; varying float vJac; varying vec2 vDS; void main(){ float h = clamp((vW.y + 4.0) / 8.0, 0.0, 1.0); float a = floor(h * 255.0); gl_FragColor = vec4(a / 255.0, fract(h * 255.0), 0.0, 1.0); }' });
  mat.toneMapped = false;
  const mesh = new T.Mesh(M.ocean.mesh.geometry, mat); mesh.frustumCulled = false;
  const sc = new T.Scene(); sc.add(mesh);
  const cam = new T.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 1, 200);
  cam.position.set(s.x, 100, s.z); cam.up.set(0, 0, -1); cam.lookAt(s.x, 0, s.z); cam.updateMatrixWorld();
  const camSave = u.uCam.value.clone(); u.uCam.value.set(s.x, 100, s.z);
  const rt = new T.WebGLRenderTarget(size, size, { type: T.UnsignedByteType }); rt.texture.colorSpace = T.NoColorSpace;
  renderer.setRenderTarget(rt); renderer.render(sc, cam); renderer.setRenderTarget(null);
  const px = new Uint8Array(size * size * 4); renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  u.uCam.value.copy(camSave);
  let max = 0, sum = 0, n = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const k = (j * size + i) * 4, h = (px[k] + px[k + 1] / 255) / 255 * 8 - 4;
    // pixel centre → world (camera up = −z/north: row 0 is the bottom = south)
    const x = s.x - span / 2 + (i + 0.5) * span / size, z = s.z + span / 2 - (j + 0.5) * span / size;
    const e = Math.abs(h - M.seaHeight(x, z, M.time)); max = Math.max(max, e); sum += e; n++;
  }
  rt.dispose(); mat.dispose();
  return { pixels: n, maxErrM: +max.toFixed(4), meanErrM: +(sum / n).toFixed(4), Hs: +M.sea.HsTotal.toFixed(2), note: 'GPU rendered surface (2.5 m mesh) vs CPU analytic sampler used by the boat' };
};

// deterministic screenshot driver: fixed clock, prerun the boat, wait for tiles, report stats
async function shot() {
  const dt = 1 / 30;
  if (VIEW === 'boat' || VIEW === 'sunset') {
    S.mode = VIEW === 'boat' ? 'boat' : S.mode;
    for (let i = 0; i < 30 * 20; i++) { boat.step(dt, { throttle: i < 150 ? 0.6 : 1, steer: i > 120 && i < 175 ? -0.5 : 0, boost: i > 200 }); M.update(dt, camera, { boats: [boat] }); }
    if (VIEW === 'boat') { S.cam.yaw = boat.state.h + 0.55; S.cam.pitch = 0.2; S.cam.dist = 13; }
  } else for (let i = 0; i < 60; i++) M.update(dt, camera, { boats: [boat] });
  for (let i = 0; i < 400; i++) {
    updateCam(dt); W.update(camera.position.x, camera.position.z, 200);
    if (W.pending() === 0 && i > 3) break;
    await new Promise(r => setTimeout(r, 30));
  }
  M.update(0.0001, camera, { boats: [boat] }); updateCam(0.0001);
  for (const n of (Q.get('hide') || '').split(',').filter(Boolean)) scene.traverse(o => { if (o.name === n) o.visible = false; });
  renderer.render(scene, camera); renderer.render(scene, camera);
  const i = renderer.info, mem = performance.memory;
  window.__mar = { ready: true, view: VIEW, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures,
    heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null, stats: M.stats(), maritime: maritimeCost(), boat: { kn: knots(boat.state.u), planing: boat.state.planing, x: boat.state.x, z: boat.state.z },
    labels: { waves: M.labels.waves(), ais: M.labels.ais() }, sunElev: sunAt(S.hour).elev,
    debug: Q.has('debug') ? { cam: camera.position.toArray().map(v => +v.toFixed(1)), towers: M.beach.towers.slice(0, 5).map(t => ({ x: +t.x.toFixed(0), z: +t.z.toFixed(0), y: +t.y.toFixed(2), H: +W.H(t.x, t.z).toFixed(2), depth: +M.depthAt(t.x, t.z).toFixed(2) })), umb: M.beach.umbrellas.slice(0, 4).map(u => [u.x | 0, u.z | 0, +u.y.toFixed(2), +W.H(u.x, u.z).toFixed(2)]) } : null };
  hud(0);
}

init().then(() => { if (SHOT) shot(); else requestAnimationFrame(t => { last = t; frame(t); }); })
  .catch(e => { $('load').textContent = 'שגיאה: ' + e.message; console.error(e); window.__mar = { ready: true, error: String(e.stack || e) }; });
