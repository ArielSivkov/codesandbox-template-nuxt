/* מעבדת WebGPU · לוח היזם – עולם תאום של ישראל
   סצנה אחת, שלושה מסלולי רינדור להשוואה הוגנת:
     mode=webgpu   → WebGPURenderer (אם אין WebGPU בדפדפן – נופל אוטומטית ל-WebGL2, והתג מראה זאת)
     mode=webgl2   → WebGPURenderer({ forceWebGL:true }) – אותו קוד TSL, מתורגם ל-GLSL
     mode=classic  → WebGLRenderer הישן + onBeforeCompile (כמו גדוד 6 והמשחק היום) + סימולציה על המעבד
   קואורדינטות כמו גדוד 6: x = מזרח, y = מעלה, z = −צפון, יחסית למרכז התחום (VO). */

const DEF = { walkers: 20000, trees: 20000, rain: 200000 };

export async function startLab(opt) {
  const o = Object.assign({ mode: 'webgpu', city: true, crowd: false, trees: false, rain: false, cull: true, dpr: 1, cam: 'orbit', data: null, onStatus: () => {} }, opt);
  const N = Object.assign({}, DEF, o.counts || {});
  const NODE = o.mode !== 'classic';
  const T = NODE ? await import('../vendor/three/three.webgpu.js') : await import('../vendor/three/three.module.js');
  const L = NODE ? await import('../vendor/three/three.tsl.js') : null;
  const canvas = o.canvas;
  const errors = [];

  // ---------- רנדרר ----------
  let renderer, backend, adapterInfo = null;
  if (NODE) {
    renderer = new T.WebGPURenderer({ canvas, antialias: false, forceWebGL: o.mode === 'webgl2', powerPreference: 'high-performance' });
    await renderer.init();
    backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    if (backend === 'WebGPU') { try { const d = renderer.backend.device; d.lost.then(i => errors.push('device lost: ' + i.message)); d.addEventListener && d.addEventListener('uncapturederror', e => errors.push(String(e.error && e.error.message || e).slice(0, 200)));
      const a = renderer.backend.adapter || await navigator.gpu.requestAdapter(); if (a && a.info) adapterInfo = { vendor: a.info.vendor, arch: a.info.architecture, desc: a.info.description, fallback: !!a.info.isFallbackAdapter }; } catch (e) {} }
  } else {
    renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    backend = 'WebGL-classic';
  }
  if (!adapterInfo) { try { const gl = canvas.getContext && (renderer.getContext ? renderer.getContext() : null); const g = gl || (renderer.backend && renderer.backend.gl); if (g) { const e = g.getExtension('WEBGL_debug_renderer_info'); adapterInfo = { gl: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER) }; } } catch (e) {} }
  renderer.setPixelRatio(o.dpr);
  renderer.outputColorSpace = T.SRGBColorSpace;
  const W = () => canvas.clientWidth || innerWidth, H = () => canvas.clientHeight || innerHeight;
  renderer.setSize(W(), H(), false);

  const BGC = new T.Color().setRGB(0.80, 0.84, 0.86, T.SRGBColorSpace);
  const scene = new T.Scene(); scene.background = BGC; scene.fog = new T.Fog(BGC, 2500, 9000);
  const camera = new T.PerspectiveCamera(50, W() / H(), 2, 60000);
  scene.add(new T.HemisphereLight(0xeaf4ff, 0x8a7a66, 1.8));
  const sun = new T.DirectionalLight(0xfff1dc, 1.7); sun.position.set(-1800, 4000, 2600); scene.add(sun);
  if (o.rain) { scene.background = new T.Color().setRGB(0.50, 0.54, 0.58, T.SRGBColorSpace); scene.fog.color = scene.background; scene.fog.near = 120; scene.fog.far = 2200; sun.intensity = 0.6; }

  // ---------- זמן משותף ----------
  const U = { time: { value: 0 } };
  const tU = NODE ? L.uniform(0) : null;

  // ---------- חומר העיר (בניינים + קרקע + ים בחומר אחד, כמו גדוד 6) ----------
  const cityMat = NODE ? cityMaterialTSL(T, L, tU) : cityMaterialGLSL(T, U);

  // ---------- טעינת העיר ----------
  o.onStatus('טוען עיר…');
  const city = o.data ? await loadAshdod(T, o.data, o.onStatus) : proceduralCity(T);
  const cityGroup = new T.Group(); scene.add(cityGroup);
  let cityTris = 0;
  for (const t of city.tiles) { const m = new T.Mesh(t.geo, cityMat); m.position.set(t.ox, 0, -t.on); m.matrixAutoUpdate = false; m.updateMatrix(); cityGroup.add(m); cityTris += t.geo.index.count / 3; }
  if (city.seaFar) { const m = new T.Mesh(city.seaFar, cityMat); cityGroup.add(m); }
  if (city.roads) { const rm = new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 });
    for (const r of city.roads) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(r.pos, 3)); g.setAttribute('color', new T.BufferAttribute(r.col, 3, true)); g.computeBoundingSphere();
      const m = new T.LineSegments(g, rm); m.position.set(r.ox, 0, -r.on); m.matrixAutoUpdate = false; m.updateMatrix(); cityGroup.add(m); } }
  cityGroup.visible = o.city;
  const segs = city.segs;   // {A: Float32Array(4n) x,y,z,len ; B: Float32Array(4n) x,y,z,flags ; n}
  const C = hotspot(segs);   // מרכז "רחוב סואן" – למצלמה ולפיזור

  // ---------- (א) הולכי רגל ----------
  let crowd = null;
  if (o.crowd && segs.n) crowd = NODE ? crowdTSL(T, L, renderer, scene, segs, C, N.walkers, o.cull && backend === 'WebGPU', camera, errors, backend !== 'WebGPU') : crowdCPU(T, scene, segs, C, N.walkers, U);
  let trees = null;
  if (o.trees && segs.n) trees = treesMesh(T, L, NODE, scene, segs, C, N.trees, U, tU);
  // ---------- (ב) גשם ----------
  let rain = null;
  if (o.rain) rain = NODE ? rainTSL(T, L, renderer, scene, N.rain, camera) : rainCPU(T, scene, N.rain, camera, U);

  // ---------- מצלמה ----------
  const CAM = { tx: C.x, tz: C.z, ty: C.y, dist: o.crowd || o.rain || o.trees ? 260 : 2600, theta: 0.6, phi: o.crowd || o.rain || o.trees ? 1.18 : 0.95, auto: o.cam === 'auto' };
  if (o.camPreset === 'street') { CAM.dist = 260; CAM.phi = 1.18; }
  if (o.rain && !o.crowd && !o.camPreset) { CAM.dist = 140; CAM.phi = 1.32; }
  if (o.camPreset === 'city') { CAM.dist = 2600; CAM.phi = 0.95; }
  function placeCam() { const s = Math.sin(CAM.phi); camera.position.set(CAM.tx + CAM.dist * s * Math.sin(CAM.theta), CAM.ty + CAM.dist * Math.cos(CAM.phi), CAM.tz + CAM.dist * s * Math.cos(CAM.theta)); camera.lookAt(CAM.tx, CAM.ty, CAM.tz); }
  placeCam();
  if (o.cam === 'orbit') controls(canvas, CAM);

  // ---------- לולאה + מדידה ----------
  const st = { frames: 0, dts: [], cpu: [], tms: [], last: 0, running: true, mark: 0 };
  let t0 = performance.now(), prev = t0;
  function onResize() { renderer.setSize(W(), H(), false); camera.aspect = W() / H(); camera.updateProjectionMatrix(); }
  addEventListener('resize', onResize);
  function frame(now) {
    if (!st.running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - prev) / 1000); if (st.frames > 0) { st.dts.push(now - prev); st.tms.push(now); if (st.dts.length > 20000) { st.dts.shift(); st.tms.shift(); st.cpu.shift(); } } prev = now;
    const tt = (now - t0) / 1000; U.time.value = tt; if (tU) tU.value = tt;
    if (CAM.auto) CAM.theta = 0.6 + tt * 0.12;
    placeCam(); camera.updateMatrixWorld();
    const c0 = performance.now();
    try {
      if (crowd) crowd.update(dt, camera);
      if (rain) rain.update(dt, camera);
      renderer.render(scene, camera);
    } catch (e) { errors.push(String(e && e.message || e).slice(0, 200)); }
    if (st.frames > 0) st.cpu.push(performance.now() - c0);
    st.frames++;
  }
  requestAnimationFrame(frame);

  const info = () => { const r = renderer.info && renderer.info.render || {}; return { calls: r.calls || r.drawCalls || 0, tris: r.triangles || 0 }; };
  return {
    T, renderer, scene, camera, backend, adapterInfo, errors, city: { tiles: city.tiles.length, tris: cityTris, buildings: city.buildings, segs: segs.n, source: city.source }, CAM,
    counts: { walkers: crowd ? N.walkers : 0, trees: trees ? N.trees : 0, rain: rain ? N.rain : 0, culling: crowd ? crowd.culling : 'none', crowdSim: crowd ? crowd.sim : '-', rainSim: rain ? rain.sim : '-' },
    visibleWalkers: () => crowd && crowd.visible ? crowd.visible() : null,
    resetStats() { st.mark = performance.now(); },
    stats(windowMs) { const from = windowMs ? performance.now() - windowMs : st.mark; let i = 0; while (i < st.tms.length && st.tms[i] < from) i++;
      return summarize(st.dts.slice(i), st.cpu.slice(i), st.frames, info()); },
    stop() { st.running = false; removeEventListener('resize', onResize); try { renderer.dispose(); } catch (e) {} },
  };
}

export function summarize(dts, cpu, frames, inf) {
  const a = dts.slice().sort((x, y) => x - y), n = a.length; const q = p => n ? a[Math.min(n - 1, Math.floor(p * n))] : 0;
  const mean = n ? a.reduce((s, v) => s + v, 0) / n : 0; const c = cpu.slice().sort((x, y) => x - y);
  return { n, frames, fps: mean ? 1000 / mean : 0, mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), long: a.filter(v => v > 50).length, cpu50: c.length ? c[Math.floor(c.length / 2)] : 0, calls: inf.calls, tris: inf.tris };
}

// =====================================================================================
//  חומרים
// =====================================================================================
// TSL: קווי קומות (כמו גדוד 6), חלונות פרוצדורליים לפי קומה, גלי ים, גוון קרקע. afl = (בסיס×10, גובה קומה×10); ים: afl.y = −1
function cityMaterialTSL(T, L, tU) {
  const { Fn, attribute, vertexColor, positionLocal, positionView, positionWorld, normalLocal, float, vec2, vec3, abs, fract, smoothstep, fwidth, step, mix, floor, hash, sin, dot, max } = L;
  const m = new T.MeshLambertNodeMaterial();
  const afl = attribute('afl', 'vec2');
  m.colorNode = Fn(() => {
    const c = vertexColor(0).rgb.toVar();
    const fh = max(afl.y.mul(0.1), 0.1), fb = afl.x.mul(0.1);
    const bld = step(5.0, afl.y);                       // בניין עם קומות
    const dist = positionView.z.negate();
    const f = positionLocal.y.sub(fb).div(fh);          // מספר קומה רציף
    const w = fwidth(f);                                // מחוץ לכל תנאי – חובה ב-WGSL (uniformity)
    const d = abs(fract(f.add(0.5)).sub(0.5));
    const ln = float(1).sub(smoothstep(0.0, w.mul(1.2).add(0.015), d));
    const fd = float(1).sub(smoothstep(500.0, 1500.0, dist));
    c.mulAssign(float(1).sub(ln.mul(fd).mul(step(0.6, f)).mul(bld).mul(0.22)));
    // חלונות: רק על קירות (|n.y| קטן), מרווח 3.2 מ', רצועה 0.36–0.80 מגובה הקומה
    const n = normalLocal;
    const wall = float(1).sub(step(0.3, abs(n.y)));
    const u = dot(positionLocal.xz, vec2(n.z.negate(), n.x));
    const fu = fract(u.div(3.2)), fv = fract(f);
    const wu = smoothstep(0.18, 0.23, fu).mul(float(1).sub(smoothstep(0.67, 0.72, fu)));
    const wv = smoothstep(0.36, 0.40, fv).mul(float(1).sub(smoothstep(0.78, 0.82, fv)));
    const wd = float(1).sub(smoothstep(250.0, 900.0, dist));
    const id = hash(floor(u.div(3.2)).add(floor(f).mul(57.0)).add(afl.x));
    const glass = mix(vec3(0.16, 0.22, 0.29), vec3(0.46, 0.53, 0.60), id);
    c.assign(mix(c, glass, wu.mul(wv).mul(wd).mul(wall).mul(bld).mul(step(0.6, f))));
    // ים: גלים מונפשים
    const sea = step(afl.y, -0.5);
    const p = positionWorld.xz, t = tU;
    const wv2 = sin(p.x.mul(0.045).add(t.mul(0.9))).mul(sin(p.y.mul(0.06).sub(t.mul(0.7)))).mul(0.5).add(sin(p.x.mul(0.11).sub(p.y.mul(0.09)).add(t.mul(1.7))).mul(0.25));
    c.mulAssign(mix(float(1), float(0.93).add(wv2.mul(0.09)), sea));
    // קרקע: גוון רך בקנה מידה גדול (ללא טקסטורה)
    const gr = float(1).sub(bld).mul(float(1).sub(sea)).mul(step(afl.y, 0.5)).mul(step(-0.5, afl.y));
    const gn = sin(p.x.mul(0.013)).mul(sin(p.y.mul(0.017))).mul(0.5).add(sin(p.x.mul(0.031).add(p.y.mul(0.027))).mul(0.5));
    c.mulAssign(mix(float(1), float(0.97).add(gn.mul(0.04)), gr));
    return c;
  })();
  return m;
}
// אותו דבר ב-GLSL ל-WebGLRenderer הישן (כמו ההאק של גדוד 6)
function cityMaterialGLSL(T, U) {
  const m = new T.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 afl; varying vec2 vFl; varying vec3 vPL; varying vec3 vNL; varying vec2 vWP; varying float vDist;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFl = afl; vPL = position; vNL = normal; vWP = (modelMatrix * vec4(position,1.0)).xz;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec2 vFl; varying vec3 vPL; varying vec3 vNL; varying vec2 vWP; varying float vDist;\nfloat h1(float x){ return fract(sin(x*12.9898)*43758.5453); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
{ vec3 c = diffuseColor.rgb; float fh = max(vFl.y*0.1, 0.1), fb = vFl.x*0.1; float bld = step(5.0, vFl.y);
  float f = (vPL.y - fb) / fh; float w = fwidth(f); float d = abs(fract(f + 0.5) - 0.5);
  float ln = 1.0 - smoothstep(0.0, w*1.2 + 0.015, d); float fd = 1.0 - smoothstep(500.0, 1500.0, vDist);
  c *= 1.0 - ln*fd*step(0.6, f)*bld*0.22;
  vec3 n = normalize(vNL); float wall = 1.0 - step(0.3, abs(n.y)); float u = dot(vPL.xz, vec2(-n.z, n.x));
  float fu = fract(u/3.2), fv = fract(f);
  float wu = smoothstep(0.18,0.23,fu)*(1.0 - smoothstep(0.67,0.72,fu)); float wv = smoothstep(0.36,0.40,fv)*(1.0 - smoothstep(0.78,0.82,fv));
  float wd = 1.0 - smoothstep(250.0, 900.0, vDist); float id = h1(floor(u/3.2) + floor(f)*57.0 + vFl.x);
  c = mix(c, mix(vec3(0.16,0.22,0.29), vec3(0.46,0.53,0.60), id), wu*wv*wd*wall*bld*step(0.6,f));
  float sea = step(vFl.y, -0.5); vec2 p = vWP; float t = uTime;
  float wv2 = sin(p.x*0.045 + t*0.9)*sin(p.y*0.06 - t*0.7)*0.5 + sin(p.x*0.11 - p.y*0.09 + t*1.7)*0.25;
  c *= mix(1.0, 0.93 + wv2*0.09, sea);
  float gr = (1.0-bld)*(1.0-sea)*step(vFl.y,0.5)*step(-0.5,vFl.y); float gn = sin(p.x*0.013)*sin(p.y*0.017)*0.5 + sin(p.x*0.031 + p.y*0.027)*0.5;
  c *= mix(1.0, 0.97 + gn*0.04, gr); diffuseColor.rgb = c; }`);
  };
  m.customProgramCacheKey = () => 'lab_city';
  return m;
}

// =====================================================================================
//  עיר: אשדוד מאריחי גדוד 5 (דרך ה-Worker של גדוד 6) או עיר פרוצדורלית (לבנצ'מרק בלי נתונים)
// =====================================================================================
const PAL = [[0.93, 0.91, 0.87], [0.96, 0.94, 0.89], [0.90, 0.88, 0.83], [0.95, 0.92, 0.86], [0.87, 0.86, 0.82], [0.94, 0.90, 0.84]];
function tileGeometry(T, m) {   // res.m של ה-Worker → BufferGeometry עם תכונות מרופדות ל-4 (WebGPU: אין פורמט קודקוד של 3×8 ביט)
  const n = m.pos.length / 3, nb = m.nb;
  const nrm = new Int8Array(n * 4), col = new Uint8Array(n * 4), afl = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) { nrm[v * 4] = m.nrm[v * 3]; nrm[v * 4 + 1] = m.nrm[v * 3 + 1]; nrm[v * 4 + 2] = m.nrm[v * 3 + 2]; }
  for (let v = 0; v < nb; v++) { const p = PAL[(m.own[v] * 2654435761 >>> 0) % PAL.length], s = m.sh[v] / 255;
    col[v * 4] = p[0] * s * 255; col[v * 4 + 1] = p[1] * s * 255; col[v * 4 + 2] = p[2] * s * 255; col[v * 4 + 3] = 255; afl[v * 2] = m.fl[v * 2]; afl[v * 2 + 1] = m.fl[v * 2 + 1]; }
  for (let v = nb; v < n; v++) { const g = (v - nb) * 3, r = m.gcol[g], gg = m.gcol[g + 1], b = m.gcol[g + 2];
    col[v * 4] = r; col[v * 4 + 1] = gg; col[v * 4 + 2] = b; col[v * 4 + 3] = 255; if (r === 48 && gg === 112 && b === 153) afl[v * 2 + 1] = -1; }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(m.pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nrm, 4, true));
  g.setAttribute('color', new T.BufferAttribute(col, 4, true)); g.setAttribute('afl', new T.BufferAttribute(afl, 2));
  g.setIndex(new T.BufferAttribute(m.idx, 1)); g.computeBoundingSphere();
  return g;
}
function seaGeometry(T, rects) {
  const pos = [], nrm = [], col = [], afl = [];
  for (const [x0, z0, x1, z1] of rects) for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]) { pos.push(x, -0.2, z); nrm.push(0, 127, 0, 0); col.push(48, 112, 153, 255); afl.push(0, -1); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(new Int8Array(nrm), 4, true));
  g.setAttribute('color', new T.BufferAttribute(new Uint8Array(col), 4, true)); g.setAttribute('afl', new T.Float32BufferAttribute(afl, 2));
  const idx = []; for (let i = 0; i < pos.length / 3; i += 3) idx.push(i, i + 2, i + 1);   // כלפי מעלה
  g.setIndex(idx); g.computeBoundingSphere(); return g;
}
function segBuilder() {
  const A = [], B = [];
  return { A, B, add(ax, ay, az, bx, by, bz, linkPrev) { const len = Math.hypot(bx - ax, by - ay, bz - az); if (len < 0.05) return false;
      const i = A.length / 4; let fl = 0;
      if (linkPrev && i > 0) { const j = (i - 1) * 4; if (Math.abs(B[j] - ax) < 0.02 && Math.abs(B[j + 2] - az) < 0.02) { B[j + 3] += 1; fl = 2; } }   // 1 = יש הבא, 2 = יש קודם
      A.push(ax, ay, az, len); B.push(bx, by, bz, fl); return true; },
    done() { return { A: new Float32Array(A), B: new Float32Array(B), n: A.length / 4 }; } };
}
async function loadAshdod(T, base, status) {
  const j = async u => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); };
  const idx = await j(base + 'index.json'), slug = Object.keys(idx.cities)[0], man = await j(base + idx.cities[slug].manifest);
  const [GX0, GY0, GX1, GY1] = man.bbox_itm, VO = { x: Math.round((GX0 + GX1) / 2), n: Math.round((GY0 + GY1) / 2) }, TILE = man.tile_m || 1000;
  let W = null, api = null, mid = 0; const pend = new Map();
  try { W = new Worker(new URL('./tileworker.js', import.meta.url), { type: 'module' }); W.onmessage = e => { const p = pend.get(e.data.id); if (!p) return; pend.delete(e.data.id); e.data.err ? p.rej(new Error(e.data.err)) : p.res(e.data.res); }; }
  catch (e) { W = null; await import('./tileworker.js'); api = self.__YZapi; }
  const call = m => W ? new Promise((res, rej) => { m.id = ++mid; pend.set(m.id, { res, rej }); W.postMessage(m); }) : api.handle(m).then(r => Array.isArray(r) ? r[0] : r);
  await call({ type: 'init', cfg: { base: new URL(base, location.href).href, tile: TILE } });
  const keys = man.tiles.slice(), out = [], S = segBuilder(); let done = 0, buildings = 0;
  const rows = new Map();
  async function one(key) {
    const res = await call({ type: 'build', key, lod: 1, wantMeta: true }), [tx, ty] = key.split('_').map(Number), ox = tx * TILE - VO.x, on = ty * TILE - VO.n;
    const t = { key, tx, ty, ox, on, res }; out.push(t); buildings += res.meta ? res.meta.n : 0;
    status(`טוען אריחים ${++done}/${keys.length}`);
  }
  const q = keys.slice(); await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) await one(q.shift()); }));
  if (W) W.terminate();
  out.sort((a, b) => a.key < b.key ? -1 : 1);
  const tiles = [], roads = [];
  for (const t of out) {
    if (t.res.r && t.res.r.pos.length) roads.push({ ox: t.ox, on: t.on, pos: t.res.r.pos, col: t.res.r.col });
    if (t.res.m) tiles.push({ key: t.key, ox: t.ox, on: t.on, geo: tileGeometry(T, t.res.m) });
    if (t.res.r) { const p = t.res.r.pos; for (let k = 0; k < p.length; k += 6) S.add(p[k] + t.ox, p[k + 1] - 0.8, p[k + 2] - t.on, p[k + 3] + t.ox, p[k + 4] - 0.8, p[k + 5] - t.on, true); }
    const r = rows.get(t.ty); if (!r || t.tx < r.tx) rows.set(t.ty, t);
  }
  // ים רחוק – כמו rebuildSeaFar של גדוד 6 (מלבנים מערבית לקו החוף)
  const F = 60000, rects = []; let tyMin = Infinity, tyMax = -Infinity;
  for (const t of out) { tyMin = Math.min(tyMin, t.ty); tyMax = Math.max(tyMax, t.ty); }
  const E = (t, s) => t && t.res.meta && t.res.meta.seaEdge && t.res.meta.seaEdge[s] >= 0 ? t.tx * TILE + t.res.meta.seaEdge[s] : null;
  for (const [ty, t] of rows) { const x1 = t.res.meta && t.res.meta.seaEdge && t.res.meta.seaEdge.w ? t.tx * TILE : Math.min(GX0, t.tx * TILE); rects.push([GX0 - F, ty * TILE, x1, ty * TILE + TILE]); }
  const sx = E(rows.get(tyMin), 's'), nx = E(rows.get(tyMax), 'n');
  rects.push([GX0 - F, tyMin * TILE - F, sx != null ? sx : GX0, tyMin * TILE]); rects.push([GX0 - F, (tyMax + 1) * TILE, nx != null ? nx : GX0, (tyMax + 1) * TILE + F]);
  const sr = rects.filter(r => r[2] > r[0]).map(([x0, n0, x1, n1]) => [x0 - VO.x, -(n0 - VO.n), x1 - VO.x, -(n1 - VO.n)]);
  return { tiles, roads, seaFar: seaGeometry(T, sr), segs: S.done(), buildings, source: 'ashdod' };
}
function proceduralCity(T) {   // רשת רחובות 3×3 ק"מ, ~3,000 בניינים מלבניים – כשאין גישה לנתונים
  let seed = 12345; const R = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const S = segBuilder(), tiles = []; let buildings = 0; const BL = 120, ST = 24, NB = 25, half = NB * BL / 2;
  for (let i = 0; i <= NB; i++) { const c = -half + i * BL - ST / 2;
    for (let j = 0; j < NB; j++) { S.add(c, 0, -half + j * BL, c, 0, -half + (j + 1) * BL, j > 0); }
    for (let j = 0; j < NB; j++) { S.add(-half + j * BL, 0, c, -half + (j + 1) * BL, 0, c, j > 0); } }
  for (let ti = 0; ti < 5; ti++) for (let tj = 0; tj < 5; tj++) {
    const pos = [], nrm = [], col = [], afl = [], idx = [];
    const box = (x0, z0, x1, z1, h, k) => { const p = PAL[k % PAL.length]; const fh = 30;
      const v = (x, y, z, nx, ny, nz, s) => { pos.push(x, y, z); nrm.push(nx * 127, ny * 127, nz * 127, 0); col.push(p[0] * s * 255, p[1] * s * 255, p[2] * s * 255, 255); afl.push(0, fh); return pos.length / 3 - 1; };
      const q = (a, b, c, d) => idx.push(a, b, c, a, c, d);
      q(v(x0, h, z1, 0, 1, 0, 0.94), v(x1, h, z1, 0, 1, 0, 0.94), v(x1, h, z0, 0, 1, 0, 0.94), v(x0, h, z0, 0, 1, 0, 0.94));
      for (const [ax, az, bx, bz, nx, nz] of [[x0, z1, x1, z1, 0, 1], [x1, z1, x1, z0, 1, 0], [x1, z0, x0, z0, 0, -1], [x0, z0, x0, z1, -1, 0]])
        q(v(ax, 0, az, nx, 0, nz, 0.72), v(bx, 0, bz, nx, 0, nz, 0.72), v(bx, h, bz, nx, 0, nz, 1), v(ax, h, az, nx, 0, nz, 1));
    };
    for (let bi = 0; bi < 5; bi++) for (let bj = 0; bj < 5; bj++) { const x = -half + (ti * 5 + bi) * BL + 4, z = -half + (tj * 5 + bj) * BL + 4, w = BL - ST - 8;
      for (let k = 0; k < 4; k++) { const sx = x + (k % 2) * w / 2, sz = z + (k >> 1) * w / 2, f = 2 + Math.floor(R() * R() * 14); box(sx + 3, sz + 3, sx + w / 2 - 3, sz + w / 2 - 3, f * 3 + 1, buildings++); } }
    const x0 = -half + ti * 5 * BL, z0 = -half + tj * 5 * BL, x1 = x0 + 5 * BL, z1 = z0 + 5 * BL, b = pos.length / 3;   // קרקע
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) { pos.push(x, 0, z); nrm.push(0, 127, 0, 0); col.push(200, 190, 160, 255); afl.push(0, 0); }
    idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(new Int8Array(nrm), 4, true));
    g.setAttribute('color', new T.BufferAttribute(new Uint8Array(col), 4, true)); g.setAttribute('afl', new T.Float32BufferAttribute(afl, 2));
    g.setIndex(new T.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1)); g.computeBoundingSphere();
    tiles.push({ key: ti + '_' + tj, ox: 0, on: 0, geo: g });
  }
  return { tiles, seaFar: seaGeometry(T, [[-half - 20000, half + 20000, -half - 300, -half - 20000]]), segs: S.done(), buildings, source: 'procedural' };
}
function hotspot(s) {   // אזור עם הכי הרבה מקטעי רחוב (רשת 400 מ') – שם שמים מצלמה ואנשים
  if (!s.n) return { x: 0, y: 0, z: 0 };
  const g = new Map(); let best = null, bc = 0;
  for (let i = 0; i < s.n; i++) { const k = Math.floor(s.A[i * 4] / 400) + ',' + Math.floor(s.A[i * 4 + 2] / 400); const c = (g.get(k) || 0) + 1; g.set(k, c); if (c > bc) { bc = c; best = k; } }
  const [gx, gz] = best.split(',').map(Number); let y = 0, k = 0; for (let i = 0; i < s.n; i++) if (Math.floor(s.A[i * 4] / 400) === gx && Math.floor(s.A[i * 4 + 2] / 400) === gz) { y += s.A[i * 4 + 1]; k++; }
  return { x: gx * 400 + 200, y: k ? y / k : 0, z: gz * 400 + 200 };
}
function pickSegs(s, C, n, seed0) {   // 70% בטווח 700 מ' מהמוקד, 30% בכל העיר
  let seed = seed0; const R = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const near = []; for (let i = 0; i < s.n; i++) if (Math.hypot(s.A[i * 4] - C.x, s.A[i * 4 + 2] - C.z) < 700) near.push(i);
  const out = new Uint32Array(n); for (let i = 0; i < n; i++) out[i] = (R() < 0.7 && near.length) ? near[(R() * near.length) | 0] : (R() * s.n) | 0;
  return { segIdx: out, R };
}

// =====================================================================================
//  (א) 20,000 הולכי רגל שהולכים לאורך הרחובות האמיתיים
// =====================================================================================
function personGeometry(T) {   // קופסאות: גוף+ראש (part 0), רגל שמאל (1), רגל ימין (2) – 60 משולשים
  const pos = [], part = [], nrm = [], idx = [];
  const box = (x0, y0, z0, x1, y1, z1, pt) => { const b = pos.length / 3;
    const F = [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0]];
    F.forEach((f, i) => { for (let k = 0; k < 4; k++) { pos.push(...f[k]); nrm.push(f[4], f[5], f[6]); part.push(pt); } const o = b + i * 4; idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }); };
  box(-0.22, 0.85, -0.13, 0.22, 1.50, 0.13, 0); box(-0.11, 1.52, -0.11, 0.11, 1.76, 0.11, 0);
  box(-0.20, 0.0, -0.08, -0.03, 0.86, 0.08, 1); box(0.03, 0.0, -0.08, 0.20, 0.86, 0.08, 2);
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3)); g.setAttribute('part', new T.Float32BufferAttribute(part, 1)); g.setIndex(idx);
  return g;
}
function initAgents(segs, C, n) {
  const { segIdx, R } = pickSegs(segs, C, n, 777); const st = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const s = segIdx[i]; st[i * 4] = s; st[i * 4 + 1] = R() * segs.A[s * 4 + 3]; st[i * 4 + 2] = (R() < 0.5 ? -1 : 1) * (0.9 + R() * 0.8); st[i * 4 + 3] = R() * 6.28; }
  return st;
}
const SHIRTS = [[0.85, 0.25, 0.2], [0.2, 0.4, 0.8], [0.95, 0.95, 0.92], [0.15, 0.15, 0.17], [0.3, 0.65, 0.35], [0.95, 0.7, 0.2], [0.55, 0.3, 0.6], [0.5, 0.7, 0.85]];
function crowdTSL(T, L, renderer, scene, segs, C, n, gpuCull, camera, errors, cpuSim) {
  const { Fn, If, float, int, uint, vec3, vec4, instancedArray, storage, instanceIndex, uniform, atan, sin, cos, mix, max, clamp, mod, abs, attribute, positionGeometry, hash, select, atomicAdd, atomicStore, length, dot, varying, PI } = L;
  const segA = instancedArray(segs.A, 'vec4');
  const segB = instancedArray(segs.B, 'vec4');
  const state = instancedArray(initAgents(segs, C, n), 'vec4');   // seg, t (מ'), מהירות±, פאזת צעד
  const apos = instancedArray(n, 'vec4');                          // x, y, z, כיוון
  const dtU = uniform(0.016);
  const sim = Fn(() => {
    const s = state.element(instanceIndex);
    const seg = int(s.x).toVar(), t = s.y.toVar(), v = s.z.toVar(), ph = s.w.toVar();
    t.addAssign(v.mul(dtU));
    const len = segA.element(seg).w, fl = segB.element(seg).w;
    If(t.greaterThan(len), () => {
      If(mod(fl, 2.0).greaterThan(0.5), () => { t.subAssign(len); seg.addAssign(1); }).Else(() => { t.assign(len); v.assign(v.negate()); });
    }).ElseIf(t.lessThan(0.0), () => {
      If(fl.greaterThanEqual(2.0), () => { seg.subAssign(1); t.addAssign(segA.element(seg).w); }).Else(() => { t.assign(0.0); v.assign(v.negate()); });
    });
    ph.addAssign(abs(v).mul(dtU).mul(4.4));
    const A = segA.element(seg), B = segB.element(seg);
    const k = clamp(t.div(max(A.w, 0.01)), 0.0, 1.0);
    const d = B.xyz.sub(A.xyz);
    const head = atan(d.x, d.z).add(select(v.lessThan(0.0), PI, 0.0));
    const lat = hash(instanceIndex).mul(2.5).add(3.0).mul(select(hash(instanceIndex.add(7)).greaterThan(0.5), 1.0, -1.0));   // מדרכה: 3–5.5 מ' מציר הרחוב
    const perp = vec3(d.z, 0.0, d.x.negate()).div(max(length(d), 0.01));
    const p = mix(A.xyz, B.xyz, k).add(perp.mul(lat));
    state.element(instanceIndex).assign(vec4(float(seg), t, v, ph));
    apos.element(instanceIndex).assign(vec4(p, head));
  })().compute(n);

  let culling = gpuCull ? 'gpu-indirect' : 'none';
  let visList = null, drawArgs = null, reset = null, cull = null; const planes = [], camP = uniform(new T.Vector3()), geo = personGeometry(T);
  if (gpuCull) {
    try {
      visList = instancedArray(n, 'uint');
      drawArgs = new T.IndirectStorageBufferAttribute(new Uint32Array([geo.index.count, 0, 0, 0, 0]), 5);
      geo.setIndirect(drawArgs);
      const args = storage(drawArgs, 'uint', 5).toAtomic();
      for (let i = 0; i < 6; i++) planes.push(uniform(new T.Vector4()));
      reset = Fn(() => { atomicStore(args.element(1), uint(0)); })().compute(1);
      cull = Fn(() => {
        const p = apos.element(instanceIndex).xyz;
        const ok = float(1).toVar();
        for (const pl of planes) ok.mulAssign(select(dot(pl.xyz, p).add(pl.w).greaterThan(-2.0), 1.0, 0.0));
        ok.mulAssign(select(length(p.sub(camP)).lessThan(1600.0), 1.0, 0.0));   // מעבר ל-1.6 ק"מ אדם הוא פחות מפיקסל
        If(ok.greaterThan(0.5), () => { const slot = atomicAdd(args.element(1), uint(1)); visList.element(slot).assign(instanceIndex); });
      })().compute(n);
    } catch (e) { errors.push('cull setup: ' + e.message); culling = 'none'; geo.setIndirect(null); }
  }
  const idxNode = culling === 'gpu-indirect' ? visList.element(instanceIndex) : instanceIndex;
  const mat = new T.MeshLambertNodeMaterial();
  const part = attribute('part', 'float');
  mat.positionNode = Fn(() => {
    const a = apos.element(idxNode), ph = state.element(idxNode).w;
    const p = positionGeometry;
    const sg = select(part.equal(1.0), 1.0, select(part.equal(2.0), -1.0, 0.0));
    const ang = sin(ph).mul(0.55).mul(sg);
    const dy = p.y.sub(0.85), ly = dy.mul(cos(ang)).sub(p.z.mul(sin(ang))).add(0.85), lz = dy.mul(sin(ang)).add(p.z.mul(cos(ang)));
    const h = a.w, ch = cos(h), sh = sin(h);
    return vec3(p.x.mul(ch).add(lz.mul(sh)), ly, lz.mul(ch).sub(p.x.mul(sh))).add(a.xyz);
  })();
  const agentId = varying(float(idxNode));
  const shirtPal = SHIRTS.map(c => vec3(...c));
  mat.colorNode = Fn(() => {
    const hId = hash(agentId);
    const shirt = mix(mix(shirtPal[0], shirtPal[1], hash(agentId.add(1.0))), mix(shirtPal[4], shirtPal[5], hash(agentId.add(2.0))), hId);
    const y = positionGeometry.y;
    return select(y.greaterThan(1.51), vec3(0.78, 0.6, 0.48), select(part.equal(0.0), shirt, vec3(0.16, 0.2, 0.3)));
  })();
  const mesh = new T.Mesh(geo, mat); mesh.count = n; mesh.frustumCulled = false; scene.add(mesh);
  const fr = new T.Frustum(), pm = new T.Matrix4();
  let readBusy = false, lastVis = null;
  // WebGL2 fallback: compute עם קריאה לאינדקס שרירותי (segA[seg]) לא עובד דרך transform feedback → סימולציה במעבד, העלאה לאותו storage
  const cst = cpuSim ? state.value.array.slice() : null, clat = cpuSim ? lateral(n) : null;
  return { culling, sim: cpuSim ? 'cpu-js→storage' : 'gpu-compute', mesh,
    update(dt, cam) {
      if (cpuSim) { const S = state.value.array, Pp = apos.value.array;
        cpuWalk(cst, segs, clat, dt, n, (i, x, y, z, h, ph) => { const j = i * 4; Pp[j] = x; Pp[j + 1] = y; Pp[j + 2] = z; Pp[j + 3] = h; S[j + 3] = ph; });
        state.value.needsUpdate = true; apos.value.needsUpdate = true; return; }
      dtU.value = dt; renderer.compute(sim);
      if (culling === 'gpu-indirect') {
        pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
        fr.planes.forEach((pl, i) => planes[i].value.set(pl.normal.x, pl.normal.y, pl.normal.z, pl.constant)); camP.value.copy(cam.position);
        renderer.compute(reset); renderer.compute(cull);
      }
    },
    visible() { if (culling !== 'gpu-indirect' || readBusy) return lastVis; readBusy = true;
      renderer.getArrayBufferAsync(drawArgs).then(b => { lastVis = new Uint32Array(b)[1]; readBusy = false; }).catch(() => { readBusy = false; }); return lastVis; } };
}
function cpuWalk(st, segs, lat, dt, n, out) {   // אותה לוגיקה כמו ה-compute; out(i, x, y, z, heading, phase)
  const A = segs.A, B = segs.B;
  for (let i = 0; i < n; i++) { const j = i * 4; let seg = st[j] | 0, t = st[j + 1], v = st[j + 2]; t += v * dt;
    const len = A[seg * 4 + 3], fl = B[seg * 4 + 3];
    if (t > len) { if (fl % 2 > 0.5) { t -= len; seg++; } else { t = len; v = -v; } } else if (t < 0) { if (fl >= 2) { seg--; t += A[seg * 4 + 3]; } else { t = 0; v = -v; } }
    st[j] = seg; st[j + 1] = t; st[j + 2] = v; st[j + 3] += Math.abs(v) * dt * 4.4;
    const a = seg * 4, k = Math.min(1, Math.max(0, t / Math.max(A[a + 3], 0.01))), dx = B[a] - A[a], dy = B[a + 1] - A[a + 1], dz = B[a + 2] - A[a + 2], dl = Math.max(Math.hypot(dx, dy, dz), 0.01);
    out(i, A[a] + dx * k + dz / dl * lat[i], A[a + 1] + dy * k, A[a + 2] + dz * k - dx / dl * lat[i], Math.atan2(dx, dz) + (v < 0 ? Math.PI : 0), st[j + 3]); }
}
function lateral(n) { let seed = 99; const R = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const lat = new Float32Array(n); for (let i = 0; i < n; i++) { R(); lat[i] = (3 + R() * 2.5) * (R() < 0.5 ? -1 : 1); } return lat; }
function crowdCPU(T, scene, segs, C, n, U) {   // הדרך "הישנה": מטריצות מופע מחושבות ב-JS בכל פריים ונשלחות ל-GPU
  const st = initAgents(segs, C, n), A = segs.A, B = segs.B;
  const geo = personGeometry(T); const phase = new T.InstancedBufferAttribute(new Float32Array(n), 1); phase.setUsage(T.DynamicDrawUsage); geo.setAttribute('aPh', phase);
  const mat = new T.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float part; attribute float aPh; varying float vPart; varying float vY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{ float sg = part == 1.0 ? 1.0 : (part == 2.0 ? -1.0 : 0.0); float ang = sin(aPh)*0.55*sg; float dy = transformed.y - 0.85;
  float ly = dy*cos(ang) - transformed.z*sin(ang) + 0.85; float lz = dy*sin(ang) + transformed.z*cos(ang); vY = transformed.y; transformed.y = ly; transformed.z = lz; vPart = part; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPart; varying float vY;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vY > 1.51) diffuseColor.rgb = vec3(0.78,0.6,0.48); else if (vPart > 0.5) diffuseColor.rgb = vec3(0.16,0.2,0.3);');
  };
  mat.customProgramCacheKey = () => 'lab_person';
  const mesh = new T.InstancedMesh(geo, mat, n); mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false;
  const c = new T.Color(); let seed = 99; const R = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) { const s = SHIRTS[(R() * SHIRTS.length) | 0]; mesh.setColorAt(i, c.setRGB(s[0], s[1], s[2])); }
  const lat = lateral(n);
  scene.add(mesh); const M = mesh.instanceMatrix.array, P = phase.array;
  return { culling: 'none (three frustum per object)', sim: 'cpu-js', mesh,
    update(dt) {
      cpuWalk(st, segs, lat, dt, n, (i, x, y, z, h, ph) => { const ch = Math.cos(h), sh = Math.sin(h), m = i * 16; P[i] = ph;
        M[m] = ch; M[m + 1] = 0; M[m + 2] = -sh; M[m + 3] = 0; M[m + 4] = 0; M[m + 5] = 1; M[m + 6] = 0; M[m + 7] = 0; M[m + 8] = sh; M[m + 9] = 0; M[m + 10] = ch; M[m + 11] = 0; M[m + 12] = x; M[m + 13] = y; M[m + 14] = z; M[m + 15] = 1; });
      mesh.instanceMatrix.needsUpdate = true; phase.needsUpdate = true;
    } };
}

// עצים: InstancedMesh רגיל בשני העולמות (מטריצות קבועות), נדנוד רוח בשיידר הקודקודים
function treesMesh(T, L, NODE, scene, segs, C, n) {
  const tr = new T.CylinderGeometry(0.18, 0.25, 2.6, 5, 1, true); tr.translate(0, 1.3, 0);
  const cr = new T.IcosahedronGeometry(1.9, 0); cr.translate(0, 3.9, 0);
  const crN = cr.index ? cr.toNonIndexed() : cr;
    const trN = tr.toNonIndexed(); const P = [...trN.attributes.position.array, ...crN.attributes.position.array];
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.computeVertexNormals();
  const nt = trN.attributes.position.count, col = new Float32Array(P.length); for (let v = 0; v < P.length / 3; v++) { const c = v < nt ? [0.38, 0.28, 0.2] : [0.32, 0.5, 0.26]; col.set(c, v * 3); }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  let mat;
  if (NODE) { const { Fn, positionGeometry, positionLocal, instanceIndex, hash, sin, vec3, clamp, time } = L; mat = new T.MeshLambertNodeMaterial(); mat.vertexColors = true;
    mat.positionNode = Fn(() => { const p = positionGeometry; const ph = hash(instanceIndex).mul(6.28); const s = sin(time.mul(1.4).add(ph)).mul(0.28).mul(clamp(p.y.div(5.0), 0.0, 1.0)); return positionLocal.add(vec3(s, 0.0, s.mul(0.6))); })();   // positionNode רץ אחרי ה-instancing ב-r187 → מוסיפים ל-positionLocal
  } else { mat = new T.MeshLambertMaterial({ vertexColors: true }); const U = arguments[7];
    mat.onBeforeCompile = sh => { sh.uniforms.uTime = U.time; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ float ph = fract(sin(float(gl_InstanceID)*12.9898)*43758.5453)*6.28; float s = sin(uTime*1.4 + ph)*0.28*clamp(position.y/5.0,0.0,1.0); transformed.x += s; transformed.z += s*0.6; }'); };
    mat.customProgramCacheKey = () => 'lab_tree'; }
  const mesh = new T.InstancedMesh(g, mat, n); mesh.frustumCulled = false;
  const { segIdx, R } = pickSegs(segs, C, n, 4242); const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), c = new T.Color(), up = new T.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) { const k = segIdx[i] * 4, A = segs.A, B = segs.B, f = R(), dx = B[k] - A[k], dz = B[k + 2] - A[k + 2], dl = Math.max(Math.hypot(dx, dz), 0.01), side = (R() < 0.5 ? -1 : 1) * (7 + R() * 3);
    p.set(A[k] + dx * f + dz / dl * side, A[k + 1] + (B[k + 1] - A[k + 1]) * f, A[k + 2] + dz * f - dx / dl * side); const sc = 0.7 + R() * 0.7; s.set(sc, sc * (0.8 + R() * 0.5), sc); q.setFromAxisAngle(up, R() * 6.28);
    mesh.setMatrixAt(i, m4.compose(p, q, s)); mesh.setColorAt(i, c.setRGB(0.8 + R() * 0.3, 0.85 + R() * 0.25, 0.75 + R() * 0.2)); }
  scene.add(mesh); return { mesh };
}

// =====================================================================================
//  (ב) 200,000 טיפות גשם
// =====================================================================================
const RB = { w: 360, h: 160 };   // קופסת גשם סביב המצלמה (מ')
function rainInit(n) { let seed = 5; const R = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { a[i * 4] = (R() - 0.5) * RB.w; a[i * 4 + 1] = R() * RB.h; a[i * 4 + 2] = (R() - 0.5) * RB.w; a[i * 4 + 3] = 8 + R() * 4; } return a; }
function rainTSL(T, L, renderer, scene, n, camera) {
  const { Fn, If, instancedArray, instanceIndex, uniform, vec3, vec4, mod, positionGeometry, float } = L;
  const rp = instancedArray(rainInit(n), 'vec4');   // מיקום יחסי לקופסה + מהירות נפילה
  const dtU = uniform(0.016), wind = uniform(new T.Vector3(2.2, 0, 1.1)), ctr = uniform(new T.Vector3()), right = uniform(new T.Vector3(1, 0, 0));
  const sim = Fn(() => {
    const p = rp.element(instanceIndex), q = p.xyz.toVar();
    q.addAssign(wind.mul(dtU)); q.y.subAssign(p.w.mul(dtU));
    If(q.y.lessThan(0.0), () => { q.y.addAssign(RB.h); });
    q.x.assign(mod(q.x.add(RB.w / 2), RB.w).sub(RB.w / 2)); q.z.assign(mod(q.z.add(RB.w / 2), RB.w).sub(RB.w / 2));
    rp.element(instanceIndex).assign(vec4(q, p.w));
  })().compute(n);
  const mat = new T.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  mat.positionNode = Fn(() => { const p = rp.element(instanceIndex), g = positionGeometry;
    const base = vec3(mod(p.x.sub(ctr.x).add(RB.w / 2), RB.w).sub(RB.w / 2).add(ctr.x), p.y.add(ctr.y).sub(RB.h * 0.4), mod(p.z.sub(ctr.z).add(RB.w / 2), RB.w).sub(RB.w / 2).add(ctr.z));
    return base.add(right.mul(g.x)).add(vec3(wind.x.mul(-0.05).mul(g.y), g.y, wind.z.mul(-0.05).mul(g.y))); })();
  mat.colorNode = vec3(0.82, 0.86, 0.92); mat.opacityNode = float(0.5);
  const geo = new T.PlaneGeometry(0.045, 1.4); const mesh = new T.Mesh(geo, mat); mesh.count = n; mesh.frustumCulled = false; scene.add(mesh);
  const v = new T.Vector3();
  return { sim: 'gpu-compute', update(dt, cam) { dtU.value = dt; ctr.value.set(0, 0, 0); right.value.copy(v.setFromMatrixColumn(cam.matrixWorld, 0));
    // הקופסה נעה עם המצלמה בקפיצות של רוחב שלם – הטיפות "עוטפות" אותה
    ctr.value.set(cam.position.x, Math.max(0, cam.position.y - RB.h * 0.35), cam.position.z); renderer.compute(sim); } };
}
function rainCPU(T, scene, n, camera, U) {
  const a = rainInit(n), off = new Float32Array(n * 3);
  const base = new T.PlaneGeometry(0.045, 1.4), g = new T.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.instanceCount = n;
  const ia = new T.InstancedBufferAttribute(off, 3); ia.setUsage(T.DynamicDrawUsage); g.setAttribute('aOff', ia);
  const uR = { value: new T.Vector3(1, 0, 0) };
  const mat = new T.MeshBasicMaterial({ color: new T.Color(0.82, 0.86, 0.92), transparent: true, opacity: 0.5, depthWrite: false });
  mat.onBeforeCompile = sh => { sh.uniforms.uR = uR; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aOff; uniform vec3 uR;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = aOff + uR*position.x + vec3(-0.11*position.y, position.y, -0.055*position.y);'); };
  mat.customProgramCacheKey = () => 'lab_rain';
  const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; scene.add(mesh); const v = new T.Vector3(), hw = RB.w / 2;
  return { sim: 'cpu-js', update(dt, cam) { uR.value.copy(v.setFromMatrixColumn(cam.matrixWorld, 0));
    const cx = cam.position.x, cy = Math.max(0, cam.position.y - RB.h * 0.35), cz = cam.position.z, wx = 2.2 * dt, wz = 1.1 * dt;
    const md = (x) => { x = (x + hw) % RB.w; if (x < 0) x += RB.w; return x - hw; };
    for (let i = 0; i < n; i++) { const j = i * 4; let x = a[j] + wx, y = a[j + 1] - a[j + 3] * dt, z = a[j + 2] + wz; if (y < 0) y += RB.h; x = md(x); z = md(z); a[j] = x; a[j + 1] = y; a[j + 2] = z;
      const k = i * 3; off[k] = md(x - cx) + cx; off[k + 1] = y + cy - RB.h * 0.4; off[k + 2] = md(z - cz) + cz; }
    ia.needsUpdate = true; } };
}

// =====================================================================================
//  שליטה במצלמה (מגע + עכבר): גרירה = סיבוב, צביטה/גלגלת = זום, שתי אצבעות = הזזה
// =====================================================================================
function controls(el, CAM) {
  const P = new Map(); let lastD = 0, lastM = null;
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => { P.set(e.pointerId, { x: e.clientX, y: e.clientY }); CAM.auto = false; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointerup', e => { P.delete(e.pointerId); lastD = 0; lastM = null; });
  el.addEventListener('pointercancel', e => { P.delete(e.pointerId); lastD = 0; lastM = null; });
  el.addEventListener('pointermove', e => { const p = P.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (P.size === 1) { CAM.theta -= dx * 0.006; CAM.phi = Math.min(1.45, Math.max(0.15, CAM.phi - dy * 0.005)); }
    else if (P.size === 2) { const [a, b] = [...P.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastD) CAM.dist = Math.min(20000, Math.max(30, CAM.dist * lastD / d));
      if (lastM) { const s = CAM.dist / 900, c = Math.cos(CAM.theta), sn = Math.sin(CAM.theta), mx = -(m.x - lastM.x) * s, mz = -(m.y - lastM.y) * s; CAM.tx += mx * c + mz * sn; CAM.tz += -mx * sn + mz * c; }
      lastD = d; lastM = m; } });
  el.addEventListener('wheel', e => { e.preventDefault(); CAM.dist = Math.min(20000, Math.max(30, CAM.dist * Math.exp(e.deltaY * 0.001))); CAM.auto = false; }, { passive: false });
}
