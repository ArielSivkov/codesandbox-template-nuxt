/* ESH27 aviation — demo.js : stand-alone demo of the jet + spaceship modes over the Ashdod twin.
 * URL params: ?scn=takeoff|lowpass|high|orbit|globe|reentry  ?t=ISO-date (default: now)  ?q=0|1 (quality)  ?city=0 (no city)
 *             ?shot=1 (deterministic, for screenshots: fast-forwards the scenario script, then sets window.SHOT_READY) */
import { LocalFrame, D2R } from './src/geo.js';
import { FarField, decodeTerrain, useExponentialFog } from './src/farfield.js';
import { makeWorld, createJetMode, createShipMode } from './src/modes.js';
import { createControls, createHUD } from './src/ui.js';
import { makeRunway } from './src/models.js';
import { quatFromBasis } from './src/jet.js';
import { MU } from './src/spaceship.js';

const T = window.THREE, Q = new URLSearchParams(location.search), $ = id => document.getElementById(id);
useExponentialFog(T);   // near fog = the far field's Beer–Lambert haze (only for this page's three.js)
const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window, SHOT = Q.get('shot') === '1';
const quality = Q.has('q') ? +Q.get('q') : TOUCH ? 0 : 1;
const toast = (m, s = 2.5) => { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', s * 1000); };

// ---------------------------------------------------------------- renderer / scenes
const cv = $('cv'), renderer = new T.WebGLRenderer({ canvas: cv, antialias: !TOUCH, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, TOUCH ? 1.25 : 1.5)); renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.info.autoReset = false;
const near = new T.Scene(), camera = new T.PerspectiveCamera(62, 1, 0.5, 30000);
near.fog = new T.FogExp2(0xbfd2e0, 0.00005);
const sunL = new T.DirectionalLight(0xfff2de, 2.2), hemi = new T.HemisphereLight(0xdcecff, 0x8f8670, 1.0); near.add(sunL, sunL.target, hemi);
const SKY_C = new T.Color(0xdcecff), GND_C = new T.Color(0x8f8670), SPACE_C = new T.Color(0x1a2030), EARTH_C = new T.Color(0x7d9bbd);

// ---------------------------------------------------------------- data
const frame = new LocalFrame();                 // Ashdod origin = the game's (166265, 634406) ITM
const [region, terr] = await Promise.all(['data/region.json', 'data/terrain.json'].map(u => fetch(u).then(r => r.json())));
const terrain = decodeTerrain(terr);
const date = Q.get('t') ? new Date(Q.get('t')) : new Date();
const texRes = quality ? 2048 : 1024, TL = new T.TextureLoader();
const textures = await Promise.all(['region', 'globe'].map(n => TL.loadAsync(`data/tex/${n}_${texRes}.webp`).catch(() => null))).then(([region, globe]) => region && globe ? { region, globe } : null);
const world50 = textures ? null : await fetch('data/world.json').then(r => r.json());   // only needed to paint the globe at run time
const far = new FarField(T, { frame, region, world: world50, terrain, quality, date, textures });

// city of the game team (optional, unmodified): window.W27
const W = window.W27; let cityOk = false;
if (W) { try { $('loadT').textContent = 'טוען את העיר אשדוד…'; await W.init(near, { base: window.CITY_BASE + 'data/' }); cityOk = true; if (W.sea) W.sea.material = far.makeSeaMaterial(); } catch (e) { console.warn('city', e); } }

// fictional runway on the empty flat strip south-east of the city (checked: no buildings, h < 25 m in the twin data)
const RWY = { x: 2450, z: 4600, len: 2400, wid: 45, heading: 270, y: 0 };
if (cityOk) { W.radius = 2600; for (let i = 0; i < 300; i++) { W.update(RWY.x, RWY.z, 60); if (!W.pending() && i > 3) break; await new Promise(r => setTimeout(r, 40)); }
  let m = -1e9; for (let a = -RWY.len / 2 - 80; a <= RWY.len / 2 + 80; a += 20) for (const b of [-30, 0, 30]) m = Math.max(m, W.H(RWY.x + a, RWY.z + b)); RWY.y = m + 0.15; }
else RWY.y = Math.max(2, far.surface(RWY.x, RWY.z).y + 0.5);
const runway = makeRunway(T, RWY.len, RWY.wid); runway.rotation.y = Math.PI / 2; runway.position.set(RWY.x, RWY.y, RWY.z); near.add(runway);

const worldPhys = makeWorld({ frame, far, city: cityOk ? W : null, runway: RWY });
const controls = createControls(document.body, { canvas: cv }), hud = createHUD(document.body);
const onEvent = ev => { const m = { liftoff: 'המראה ✈', touchdown: 'נגיעה במסלול', 'touchdown-offrunway': 'נחיתה מחוץ למסלול', 'gear-up': 'גלגלים למעלה', 'gear-down': 'גלגלים למטה', crash: 'התרסקות 💥 · ↺ התחלה', 'newtonian-on': 'מצב ניוטוני: אין בלימה, כבידה אמיתית', 'dampers-on': 'בולמי אינרציה פעילים (ארקייד)', landed: 'נחתת' }[ev]; if (m && !SHOT) toast(m); };
const jet = createJetMode({ THREE: T, scene: near, world: worldPhys, frame, controls, hud, onEvent });
const ship = createShipMode({ THREE: T, scene: near, world: worldPhys, frame, controls, hud, onEvent });
let mode = jet;

// ---------------------------------------------------------------- scenarios
const lla = (lat, lon, h) => frame.llaToLocal(lat, lon, h);
function shipAt(lat, lon, h, opts) { const p = lla(lat, lon, h); ship.enter({ x: p.x, y: p.y, z: p.z, newtonian: !!opts.newtonian, heading: opts.heading || 0, pitch: opts.pitch || 0 });
  const s = ship.sim; if (opts.vel) s.vel = opts.vel(s); if (opts.aim) { const c = frame.center, tgt = opts.aim === 'earth' ? c : lla(...opts.aim); const f = new T.Vector3(tgt.x - p.x, tgt.y - p.y, tgt.z - p.z).normalize(), u0 = new T.Vector3(0, 0, -1); const r = new T.Vector3().crossVectors(f, u0).normalize(), u = new T.Vector3().crossVectors(r, f).normalize(); s.q = quatFromBasis(f, u); s.prev.q = { ...s.q }; }
  return s; }
function orbitalVel(s, headingDeg, fpaDeg = 0, k = 1) { const u = s.up(s.pos, {}), r = s.r(), v = Math.sqrt(MU / r) * k; let nx = u.x * u.z, ny = u.y * u.z, nz = -1 + u.z * u.z; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; const ex = ny * u.z - nz * u.y, ey = nz * u.x - nx * u.z, ez = nx * u.y - ny * u.x, h = headingDeg * D2R, g = fpaDeg * D2R;
  const dx = (nx * Math.cos(h) + ex * Math.sin(h)) * Math.cos(g) + u.x * Math.sin(g), dy = (ny * Math.cos(h) + ey * Math.sin(h)) * Math.cos(g) + u.y * Math.sin(g), dz = (nz * Math.cos(h) + ez * Math.sin(h)) * Math.cos(g) + u.z * Math.sin(g); return { x: dx * v, y: dy * v, z: dz * v }; }
const SCN = {
  takeoff: { he: 'המראה', run() { setMode(jet); jet.enter({ x: RWY.x + RWY.len / 2 - 120, z: RWY.z, heading: RWY.heading, onGround: true, throttle: 1.1 }); return { script: s => ({ throttle: 1.1, pitch: s.hud().kt > 135 ? 1 : 0 }), until: s => s.onGround === false && s.hud().agl > 6, extra: 0.6 }; } },
  lowpass: { he: 'מעבר נמוך מעל העיר', run() { setMode(jet); jet.enter({ x: 2600, y: 330, z: 1800, heading: 300, speed: 190, throttle: 0.85 }); jet.sim.gear = false; return { script: () => ({ throttle: 0.85, roll: -0.12 }), time: 1.6 }; } },
  climb: { he: 'טיפוס מעל העיר', run() { setMode(jet); jet.enter({ x: 4500, y: 2500, z: 6500, heading: 325, speed: 230, pitch: 8, throttle: 1.0 }); jet.sim.gear = false; return { script: () => ({ throttle: 1.0, pitch: 0.05 }), time: 1.0 }; } },
  high: { he: 'גובה רב', run() { setMode(jet); const p = lla(31.65, 34.45, 13000); jet.enter({ x: p.x, y: p.y, z: p.z, heading: 25, speed: 420, throttle: 1.1 }); jet.sim.gear = false; return { script: () => ({ throttle: 1.1 }), time: 1.0 }; } },
  ascent: { he: 'עלייה לחלל (45 ק"מ)', run() { setMode(ship); shipAt(31.35, 34.35, 45000, { heading: 35, pitch: -18 }); return { time: 0.4 }; } },
  orbit: { he: 'מסלול 400 ק"מ', run() { setMode(ship); const s = shipAt(29.3, 31.2, 400000, { newtonian: true, aim: [32.2, 35.0, 0] }); s.vel = orbitalVel(s, 40); s.aero = true; return { time: 0.5 }; } },
  globe: { he: 'כדור הארץ', run() { setMode(ship); const s = shipAt(24, 27, 9000000, { newtonian: true, aim: 'earth' }); s.vel = { x: 0, y: 0, z: 0 }; ship.rig.look.yaw = 0; return { time: 0.3 }; } },
  reentry: { he: 'כניסה לאטמוספרה', run() { setMode(ship); const s = shipAt(31.9, 32.4, 72000, { newtonian: true, heading: 95, pitch: 12 }); s.vel = orbitalVel(s, 95, -1.5, 0.93); return { time: 1.0 }; } },
};
$('scn').innerHTML = Object.entries(SCN).map(([k, v]) => `<button data-s="${k}">${v.he}</button>`).join('');
$('scn').onclick = e => { const k = e.target.dataset && e.target.dataset.s; if (k) { $('scn').classList.remove('open'); startScenario(k); } };
$('mScn').onclick = () => $('scn').classList.toggle('open');
function setMode(m) { if (mode !== m) mode.exit(); mode = m; $('mJet').classList.toggle('on', m === jet); $('mShip').classList.toggle('on', m === ship); }
$('mJet').onclick = () => startScenario('takeoff'); $('mShip').onclick = () => { setMode(ship); const p = { x: RWY.x - RWY.len / 2 - 150, z: RWY.z }; ship.enter({ x: p.x, y: worldPhys.surface(p.x, p.z).y + 2.3, z: p.z, heading: 270, landed: true }); toast('חללית: מחוון ההנעה מימין · ▲ מעלה · בולמים=ארקייד · ניוטוני=פיזיקה'); };
function startScenario(k) { const r = SCN[k].run(); if (k === 'takeoff' && !SHOT) { controls.setThrottle(0); jet.sim.thr = 0; jet.sim.eng = 0; toast('מצערת ימינה למעלה (או Shift) · ב-135 קשר משוך מקל לאחור'); for (let i = 0; i < 60; i++) jet.updateCamera(1 / 60, camera); return; } if (r.script || r.time) fastForward(r); if (Q.get('view') === 'cockpit') { mode.rig.view = 'cockpit'; for (let i = 0; i < 5; i++) mode.updateCamera(1 / 60, camera); } }
function fastForward(r) { // deterministic pre-roll in 1/60 s frames (also used by ?shot=1)
  const m = mode, s = m.sim; let t = 0, guard = 0, after = -1;
  while (guard++ < 60 * 120) { const inp = r.script ? r.script(s) : {}; m.update(1 / 60, inp); t += 1 / 60;
    if (r.until) { if (after < 0 && r.until(s)) after = t; if (after >= 0 && t - after >= (r.extra || 0)) break; } else if (t >= r.time) break; }
  if (mode === jet && r.script) { const i = r.script(s); if (i.throttle != null) controls.setThrottle(i.throttle); }
  for (let i = 0; i < 90; i++) m.updateCamera(1 / 60, camera);
}

// ---------------------------------------------------------------- frame loop
const fogC = {}, perf = { fps: 60, ms: 0 };
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 75 : 62; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let last = performance.now(), frames = 0, lastShown = 0;
function render(dt) {
  const t0 = performance.now();
  const cp = mode.updateCamera(dt, camera);
  far.update(cp, camera);
  // near scene: fog + sun consistent with the far field
  { const cx = cityOk ? (W.bounds.minx + W.bounds.maxx) / 2 : 0, cz = cityOk ? (W.bounds.minz + W.bounds.maxz) / 2 : 0, hd = Math.hypot(camera.position.x - cx, camera.position.z - cz), fd = Math.max(1500, Math.min(hd + 2000, Math.hypot(far.alt, hd)));
    far.fog(fogC, fd, 0); near.fog.color.setRGB(fogC.r, fogC.g, fogC.b); near.fog.density = fogC.density; }
  const el = Math.asin(Math.max(-1, Math.min(1, far.sun.dot(far.up)))) / D2R;
  sunL.position.copy(far.sun).multiplyScalar(1000).add(camera.position); sunL.target.position.copy(camera.position);
  if (far.alt < 60000) { sunL.intensity = 2.6 * Math.max(0, Math.sin(Math.max(0, el) * D2R)) ** 0.5 * (1 - far.alt / 60000) + 2.6 * (far.alt / 60000) * (el > -2 ? 1 : 0); hemi.intensity = 0.2 + 0.9 * far.day * Math.exp(-far.alt / 20000); }
  else { // space: full sun unless inside the Earth's cylindrical shadow; faint Earth-shine
    const c = frame.center, rx = camera.position.x - c.x, ry = camera.position.y - c.y, rz = camera.position.z - c.z, d = rx * far.sun.x + ry * far.sun.y + rz * far.sun.z, perp = Math.sqrt(Math.max(0, rx * rx + ry * ry + rz * rz - d * d));
    sunL.intensity = d < 0 && perp < frame.R ? 0 : 2.8; hemi.intensity = 0.9 * (0.3 + 0.7 * far.day); }
  { const k = Math.min(1, Math.max(0, (far.alt - 20000) / 60000)); hemi.color.copy(SKY_C).lerp(SPACE_C, k); hemi.groundColor.copy(GND_C).lerp(EARTH_C, k); hemi.position.copy(far.up); }
  if (cityOk) { const vis = far.alt < 30000; W.root.visible = vis; if (W.sea) W.sea.visible = vis && far.alt < (Q.has('seaAlt') ? +Q.get('seaAlt') : 1e9);
    const BB = W.manifest.bbox_itm;   // the game's flat placeholder tiles OUTSIDE the data box are hidden: the far field is the real fallback there
    for (const t of W.tiles.values()) if (t.empty && t.grp) { const E = (t.tx + 0.5) * 1000, N = (t.ty + 0.5) * 1000; t.grp.visible = E > BB[0] && E < BB[2] && N > BB[1] && N < BB[3]; }
    if (vis) { W.radius = Math.min(quality ? 9000 : 5500, 3500 + far.alt * 2.2); W.update(camera.position.x, camera.position.z, TOUCH ? 6 : 9);
      // above 250 m the game's 6 km sea plane is pinned to the city box (the far field draws the rest of the sea)
      // the game's 6 km sea plane is pinned to the data box (it follows the player in the game); the far field draws the rest
      // (clipped to the loaded radius too, so it never paints over land tiles that are not loaded yet)
      if (W.sea) { const B = W.bounds, p = 300, hf = W.radius * 0.7, cx = camera.position.x, cz = camera.position.z;
        const x0 = Math.max(B.minx + p, cx - hf), x1 = Math.min(B.maxx - p, cx + hf), z0 = Math.max(B.minz + p, cz - hf), z1 = Math.min(B.maxz - p, cz + hf);
        W.sea.visible = W.sea.visible && x1 > x0 && z1 > z0; if (W.sea.visible) { W.sea.position.set((x0 + x1) / 2, -0.05, (z0 + z1) / 2); W.sea.scale.set((x1 - x0) / 6000, 1, (z1 - z0) / 6000); } } } if (W.MAT && W.MAT.sea && W.MAT.sea.normalMap) W.MAT.sea.normalMap.offset.set(performance.now() * 1.2e-5, performance.now() * 7e-6); }
  runway.visible = far.alt < 40000;
  camera.near = far.alt > 3000 ? 2 : 0.5; camera.far = 30000; camera.updateProjectionMatrix();
  renderer.info.reset(); far.render(renderer); renderer.clearDepth(); renderer.autoClear = false; renderer.render(near, camera); renderer.autoClear = true;
  const s = far.sunInfo; mode.hudData({ layer: far.layer, fov: camera.fov, sunText: `שמש ${s.elevation.toFixed(0)}°/${s.azimuth.toFixed(0)}° · ${date.toISOString().slice(5, 16).replace('T', ' ')}Z` });
  perf.ms = perf.ms * 0.9 + (performance.now() - t0) * 0.1;
}
function loop(now) {
  requestAnimationFrame(loop); let dt = (now - last) / 1000; last = now; if (dt <= 0) return; dt = Math.min(dt, 0.1);
  perf.fps = perf.fps * 0.95 + (1 / dt) * 0.05;
  mode.update(dt); render(dt); frames++;
  if (now - lastShown > 500) { lastShown = now; const i = renderer.info; $('perf').textContent = `${perf.fps.toFixed(0)} fps · cpu ${perf.ms.toFixed(1)} ms\ncalls ${i.render.calls} · tris ${(i.render.triangles / 1000).toFixed(0)}k\nalt ${(far.alt / 1000).toFixed(1)} km · ${far.layer}`; }
}
$('load').style.display = 'none';
const scn = Q.get('scn') || 'takeoff';
if (SHOT) { startScenario(scn); render(1 / 60); if (cityOk && far.alt < 30000) { for (let i = 0; i < 400; i++) { render(1 / 60); if (!W.pending() && i > 4) break; await new Promise(r => setTimeout(r, 30)); } } render(1 / 60); const i = renderer.info; window.SHOT_INFO = { far: far.stats, calls: i.render.calls, tris: i.render.triangles, alt: far.alt, layer: far.layer, hud: mode.sim.hud(frame.gamma) }; window.SHOT_READY = true; }
else { startScenario(scn); requestAnimationFrame(loop); if (!TOUCH) toast('W/S גובה · A/D גלגול · Q/R הגה · Shift/Ctrl מצערת · B בלמים · G גלגלים · V מבט', 5); }
window.AV = { jet, ship, far, frame, startScenario, get mode() { return mode; }, render, renderer, camera };
