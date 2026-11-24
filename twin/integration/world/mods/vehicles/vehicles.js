/* ESH_VEHICLES — מחלקת כלי הרכב (ESH27): צי רכבים ישראלי כללי לעולם התאום של אשדוד.
 * סקריפט רגיל (בלי מודולים). דורש window.THREE (r186) ו-window.ESH_GLTF (GLTFLoader + MeshoptDecoder, vendor/loaders.js).
 * מוסכמות: x מזרח / y מעלה / z דרום, מטרים. ברכב: +z מקומי = קדימה, +x מקומי = צד שמאל (צד הנהג בישראל), ראשית = קרקע, מרכז הרכב.
 *
 * ממשק:
 *   ESH_VEHICLES.init({ base:'mods/vehicles/models/', renderer, tier:'low'|'medium'|'high' }) → Promise   (פעם אחת)
 *   ESH_VEHICLES.types                       רשימת הסוגים · ESH_VEHICLES.info(type) מידות/משולשים/KB
 *   ESH_VEHICLES.load(types?) → Promise       טעינה מראש (אחרת create טוען לבד)
 *   ESH_VEHICLES.create(type, { colour, lod:'auto'|0|1|2, fpv, shadows }) → Promise<Vehicle>
 *        Vehicle (THREE.Group): setLights({head,brake,reverse,turn:-1|0|1,hazard,running,beacon}), setWheels(spin, steer),
 *        drive(dt, speed, steer) (מגלגל גלגלים לבד), setColour(c), setSpeedo(kmh), parts{steer,needle,drum,…}, eye (Vector3 מקומי), dispose()
 *   ESH_VEHICLES.fleet({ max, lod:[d0,d1], cull, shadows, glow, blobs }) → Fleet (BatchedMesh: קריאת ציור אחת לכל הצי)
 *        fleet.object (להוסיף לסצנה) · fleet.add(type,{x,y,z,h,colour,parked}) → id · fleet.set(id,x,y,z,h) · fleet.state(id,{…,speed})
 *        fleet.remove(id) · fleet.update(dt, camera) · fleet.stats()
 *   ESH_VEHICLES.parked(slots, opts) → Fleet   (slots: [{x,y,z,h,type?,colour?}] — מכוניות חונות, בלי אורות)
 *   ESH_VEHICLES.transportVisual(opts) → factory(T,max) → {object, update(out,n)}   (לחוזה TR.setCarVisual של מחלקת התחבורה)
 *   ESH_VEHICLES.randomColour(type, rnd) · ESH_VEHICLES.pickType(rnd, set) · ESH_VEHICLES.setNight(0..1) · ESH_VEHICLES.budget()
 * רישיון: CC0 (עבודה פרוצדורלית של המחלקה). אותיות "מונית" ושלט הקו: קווי מתאר של הגופן Heebo (SIL OFL 1.1).
 */
(function () {
  'use strict';
  const T = window.THREE; if (!T) { console.warn('[vehicles] THREE missing'); return; }
  const VERSION = '1.0.0';
  // ---------------------------------------------------------------- catalogue
  const TYPES = ['mini', 'hatch', 'sedan', 'suv', 'mpv', 'pickup', 'taxi', 'bus', 'minibus', 'van', 'garbage', 'mixer', 'excavator', 'crane', 'moto', 'scooter', 'escooter', 'bicycle', 'player', 'taxi_fpv'];
  const HE = { mini: 'מיני', hatch: 'האצ׳בק', sedan: 'סדאן', suv: 'קרוסאובר', mpv: 'מיניוואן', pickup: 'טנדר', taxi: 'מונית', bus: 'אוטובוס עירוני', minibus: 'מיניבוס', van: 'מסחרית',
    garbage: 'משאית זבל', mixer: 'מערבל בטון', excavator: 'מחפר', crane: 'עגורן צריח', moto: 'אופנוע', scooter: 'קטנוע שליחויות', escooter: 'קורקינט חשמלי', bicycle: 'אופניים', player: 'רכב השחקן', taxi_fpv: 'מונית (נהיגה)' };
  // Israeli street colour mix (estimate — white dominates in the hot climate; refine from photolearn/look-library.json)
  const PAINTS = [ // [weight, sRGB hex, name]
    [30, '#e9ebec', 'לבן'], [6, '#f1efe8', 'לבן פנינה'], [16, '#a9adb1', 'כסוף'], [10, '#8b9096', 'אפור'], [8, '#4a4e53', 'אפור כהה'], [11, '#151618', 'שחור'],
    [6, '#1f355e', 'כחול כהה'], [2, '#4f7fb5', 'כחול'], [4, '#8f1d1d', 'אדום'], [3, '#b9ab8f', 'בז׳'], [1.5, '#2f4a3c', 'ירוק כהה'], [1, '#5a4535', 'חום'], [1, '#c96f1e', 'כתום'], [0.5, '#d9b21c', 'צהוב']];
  const FIXED = { bus: '#f0f0ee', minibus: '#eeeeec', garbage: '#eeeeec', mixer: '#eeeeec', excavator: '#e2a214', crane: '#b51c17', taxi: null, taxi_fpv: null, van: null };
  const TAXI_PAINTS = [[55, '#eceeef'], [25, '#b6babe'], [12, '#8b9096'], [8, '#151618']];
  const VAN_PAINTS = [[78, '#eeeeec'], [10, '#a9adb1'], [6, '#1f355e'], [6, '#151618']];
  const TWO_PAINTS = [[25, '#151618'], [20, '#e9ebec'], [15, '#8b9096'], [12, '#8f1d1d'], [10, '#1f355e'], [8, '#2f4a3c'], [10, '#c96f1e']];
  // traffic mix (estimate for an Israeli city street); parked mix excludes buses/heavy
  const MIX_TRAFFIC = { mini: 13, hatch: 19, sedan: 17, suv: 19, mpv: 4, pickup: 4, taxi: 6, van: 6, minibus: 2, bus: 3, garbage: 0.6, mixer: 0.6, scooter: 3, moto: 2 };
  const MIX_PARKED = { mini: 15, hatch: 22, sedan: 18, suv: 20, mpv: 5, pickup: 5, taxi: 3, van: 6, scooter: 3, moto: 1.5, bicycle: 1, escooter: 0.5 };
  const LIGHT = { HEAD: 1, BRAKE: 2, REVERSE: 4, HAZARD: 8, RUN: 16, BEACON: 32 };

  const S = { single: new Set(), base: 'mods/vehicles/models/', manifest: null, kits: new Map(), loading: new Map(), renderer: null, tier: 'medium', night: 0, time: 0, env: null, envNight: -1, mats: new Map(), loader: null, ready: null, fleets: new Set(), stats: { loadMs: 0, kb: 0 } };
  const C = new T.Color();
  function hexLin(h) { return new T.Color(h); }      // THREE.Color(hex) converts sRGB → linear (ColorManagement on)
  function wpick(list, rnd) { let tot = 0; for (const e of list) tot += e[0]; let r = rnd() * tot; for (const e of list) { r -= e[0]; if (r <= 0) return e; } return list[list.length - 1]; }
  function randomColour(type, rnd = Math.random) {
    if (FIXED[type]) return hexLin(FIXED[type]);
    if (type === 'taxi' || type === 'taxi_fpv') return hexLin(wpick(TAXI_PAINTS, rnd)[1]);
    if (type === 'van') return hexLin(wpick(VAN_PAINTS, rnd)[1]);
    if (/moto|scooter|bicycle/.test(type)) return hexLin(wpick(TWO_PAINTS, rnd)[1]);
    return hexLin(wpick(PAINTS, rnd)[1]);
  }
  function pickType(rnd = Math.random, mix = MIX_TRAFFIC) { let tot = 0; for (const k in mix) tot += mix[k]; let r = rnd() * tot; for (const k in mix) { r -= mix[k]; if (r <= 0) return k; } return 'sedan'; }
  function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------------------------------------------------------------- environment (reflections) — own PMREM, not scene.environment
  function allMats() { return [...S.mats.values(), ...S.single]; }
  function makeEnv(night) {
    const r = S.renderer; if (!r) return null;
    const sc = new T.Scene();
    const top = night ? new T.Color(0.012, 0.016, 0.03) : new T.Color(0.20, 0.36, 0.62), hor = night ? new T.Color(0.10, 0.07, 0.05) : new T.Color(0.80, 0.84, 0.88), gnd = night ? new T.Color(0.02, 0.02, 0.02) : new T.Color(0.22, 0.2, 0.18);
    const mat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, uniforms: { top: { value: top }, hor: { value: hor }, gnd: { value: gnd }, sun: { value: new T.Vector3(0.4, 0.6, -0.5).normalize() }, night: { value: night ? 1 : 0 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top, hor, gnd, sun; uniform float night; varying vec3 vD;
        float h1(float x){ return fract(sin(x * 91.7) * 43758.5); }
        void main(){ vec3 d = normalize(vD); float y = d.y;
          vec3 c = y > 0.0 ? mix(hor, top, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(hor * 0.55, gnd, clamp(-y * 3.0, 0.0, 1.0));
          // city skyline band: blocks of buildings on the horizon (reflections read as a street)
          float az = atan(d.z, d.x); float cell = floor(az * 9.0); float hb = 0.03 + 0.16 * h1(cell) * h1(cell + 3.1);
          if (y > -0.02 && y < hb) c = night > 0.5 ? mix(vec3(0.03, 0.025, 0.02), vec3(0.9, 0.55, 0.25), step(0.82, h1(floor(az * 60.0) + floor(y * 80.0)))) : mix(c, vec3(0.42, 0.42, 0.40), 0.75);
          if (night < 0.5) c += vec3(1.0, 0.92, 0.8) * pow(max(dot(d, sun), 0.0), 220.0) * 30.0;
          else c += vec3(1.0, 0.6, 0.3) * 0.25 * pow(max(1.0 - abs(y + 0.02) * 6.0, 0.0), 3.0);
          gl_FragColor = vec4(c, 1.0); }` });
    sc.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), mat));
    const pm = new T.PMREMGenerator(r); const rt = pm.fromScene(sc, 0, 0.1, 50); pm.dispose(); mat.dispose(); sc.children[0].geometry.dispose();
    return rt.texture;
  }
  function envFor(n) { const want = n > 0.5 ? 1 : 0; if (S.envNight !== want || !S.env) { const old = S.env; S.env = makeEnv(want); S.envNight = want; for (const m of allMats()) if (m.userData.env) { m.envMap = S.env; m.needsUpdate = true; } if (old && old !== S.env) old.dispose(); } return S.env; }

  // ---------------------------------------------------------------- material (one shader for everything: per-vertex PBR + paint mask + lamps + wheel spin)
  function material(mode, o = {}) {   // mode: 'single' | 'inst' | 'batch'
    const tier = o.tier || S.tier, key = mode + ':' + tier + (o.double ? ':d' : '') + (o.glass ? ':g' : '');
    if (mode !== 'single' && S.mats.has(key)) return S.mats.get(key);
    let m;
    if (o.glass) m = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide, envMapIntensity: 1.6 });
    else if (tier === 'low') m = new T.MeshLambertMaterial({ vertexColors: true });
    else if (tier === 'high') m = new T.MeshPhysicalMaterial({ vertexColors: true, clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.0 });
    else m = new T.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 1.0 });
    if (o.double) m.side = T.DoubleSide;
    m.userData.env = tier !== 'low' || !!o.glass; if (m.userData.env) m.envMap = envFor(S.night);
    const U = m.userData.u = { uTime: { value: 0 }, uNight: { value: S.night }, uPaint: { value: new T.Color(1, 1, 1) }, uState: { value: new T.Vector4(0, 0, 0, 0) }, uInterior: { value: new T.Color(0.035, 0.036, 0.04) }, uVehState: { value: null } };
    m.userData.mode = mode;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.defines = sh.defines || {}; sh.defines['VEH_' + mode.toUpperCase()] = ''; if (o.double) sh.defines.VEH_DOUBLE = ''; if (o.glass) sh.defines.VEH_GLASS = '';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 aMat; attribute vec4 aWheel; varying vec4 vMat; varying vec3 vLamp; uniform float uTime; uniform float uNight;
#ifdef VEH_SINGLE
uniform vec3 uPaint; uniform vec4 uState;
#endif
#ifdef VEH_INST
attribute vec4 iState;
#endif
#ifdef VEH_BATCH
uniform highp sampler2D uVehState;
#endif`).replace('#include <color_vertex>', `
vec4 vs = vec4(0.0); vec3 paint = vec3(1.0);
#ifdef VEH_SINGLE
  vs = uState; paint = uPaint;
#endif
#ifdef VEH_INST
  vs = iState;
  #ifdef USE_INSTANCING_COLOR
  paint = instanceColor.rgb;
  #endif
#endif
#ifdef VEH_BATCH
  { float bi = getIndirectIndex(gl_DrawID); int sz = textureSize(uVehState, 0).x; int j = int(bi); vs = texelFetch(uVehState, ivec2(j % sz, j / sz), 0);
  #ifdef USE_BATCHING_COLOR
    paint = getBatchingColor(bi).rgb;
  #endif
  }
#endif
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec4(color.rgb, 1.0);
  vColor.rgb *= mix(vec3(1.0), paint, step(0.75, aMat.x));
#endif
vMat = aMat;
{ int lid = int(aMat.w * 15.0 + 0.5); float bits = vs.x; float head = mod(bits, 2.0), brake = mod(floor(bits * 0.5), 2.0), rev = mod(floor(bits * 0.25), 2.0), haz = mod(floor(bits * 0.125), 2.0), run = mod(floor(bits * 0.0625), 2.0), bea = mod(floor(bits * 0.03125), 2.0);
  float blink = step(0.5, fract(uTime * 1.45)); float on = 0.0; vec3 lc = color.rgb;
  if (lid == 1) { on = head * 7.0; lc = vec3(1.0, 0.93, 0.82); }
  else if (lid == 2) { on = run * mix(2.4, 1.2, head); lc = vec3(0.92, 0.96, 1.0); }
  else if (lid == 3) { on = head * 2.6 + brake * 5.0; lc = vec3(1.0, 0.045, 0.025); }
  else if (lid == 4) { on = brake * 6.5; lc = vec3(1.0, 0.04, 0.02); }
  else if (lid == 5) { on = blink * max(step(vs.y, -0.5), haz) * 6.0; lc = vec3(1.0, 0.42, 0.04); }
  else if (lid == 6) { on = blink * max(step(0.5, vs.y), haz) * 6.0; lc = vec3(1.0, 0.42, 0.04); }
  else if (lid == 7) { on = rev * 5.0; lc = vec3(1.0); }
  else if (lid == 8) { on = run * mix(0.5, 2.0, uNight); lc = color.rgb * 1.5 + 0.03; }
  else if (lid == 9) { on = run * 1.4; lc = color.rgb + 0.08; }
  else if (lid == 10) { on = bea * step(0.5, fract(uTime * 1.1 + 0.3)) * mix(3.0, 7.0, uNight); lc = color.rgb + 0.1; }
  vLamp = lc * on; }
mat3 wR = mat3(1.0);
if (aWheel.w > 0.5) { float a = vs.z, c = cos(a), s = sin(a); wR = mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
  if (aWheel.w > 1.5) { float b = vs.w, cb = cos(b), sb = sin(b); wR = mat3(cb, 0.0, -sb, 0.0, 1.0, 0.0, sb, 0.0, cb) * wR; } }
`).replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = wR * objectNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (aWheel.w > 0.5) transformed = wR * (transformed - aWheel.xyz) + aWheel.xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vMat; varying vec3 vLamp; uniform vec3 uInterior;')
        .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef VEH_DOUBLE
  if (!gl_FrontFacing) diffuseColor.rgb = uInterior;
#endif
#ifdef VEH_GLASS
  diffuseColor.rgb = vec3(0.02, 0.03, 0.035);
#endif`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = max(vMat.y, 0.03);
#ifdef VEH_DOUBLE
  if (!gl_FrontFacing) roughnessFactor = 0.9;
#endif`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = vMat.z;
#ifdef VEH_DOUBLE
  if (!gl_FrontFacing) metalnessFactor = 0.0;
#endif`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLamp;')
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= step(0.75, vMat.x);
#endif`);
    };
    m.customProgramCacheKey = () => 'esh-veh-1-' + mode + (o.double ? 'd' : '') + (o.glass ? 'g' : '');
    if (mode !== 'single') S.mats.set(key, m); else S.single.add(m);
    return m;
  }

  // ---------------------------------------------------------------- loading + merging (GLB → one geometry per LOD; wheels keep pivots for the shader)
  async function init(o = {}) {
    if (S.ready) return S.ready;
    S.base = o.base || S.base; S.renderer = o.renderer || S.renderer; if (o.tier) S.tier = o.tier;
    S.ready = (async () => {
      const G = window.ESH_GLTF; if (!G || !G.GLTFLoader) throw new Error('ESH_GLTF loaders missing (vendor/loaders.js)');
      S.loader = new G.GLTFLoader(); if (G.MeshoptDecoder) S.loader.setMeshoptDecoder(G.MeshoptDecoder);
      const r = await fetch(S.base + 'manifest.json'); if (!r.ok) throw new Error('manifest ' + r.status); S.manifest = await r.json();
      return S.manifest;
    })();
    return S.ready;
  }
  function info(type) { const t = S.manifest && S.manifest.types[type]; return t ? Object.assign({ type, name_he: HE[type] || t.name_he }, t) : null; }
  const _m = new T.Matrix4(), _n = new T.Matrix3(), _v = new T.Vector3(), _inv = new T.Matrix4();
  function mergeNode(lodNode, filter, rigInfo) {   // → BufferGeometry with position, normal, color, aMat, aWheel, index
    lodNode.updateMatrixWorld(true); _inv.copy(lodNode.matrixWorld).invert();
    const P = [], N = [], Cc = [], A = [], W = [], I = []; let base = 0;
    lodNode.traverse(o => {
      if (!o.isMesh) return; const part = partOf(o, lodNode); if (filter && !filter(part)) return;
      const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, ma = g.attributes._mat, idx = g.index;
      _m.multiplyMatrices(_inv, o.matrixWorld); _n.getNormalMatrix(_m); const flip = _m.determinant() < 0;
      const wheel = /^wheel_/.test(part.name) ? part : null; let piv = null, wf = 0;
      if (wheel) { const ri = rigInfo && rigInfo[part.name]; piv = new T.Vector3(); if (ri) piv.fromArray(ri.pivot); else { wheel.updateMatrixWorld(true); piv.setFromMatrixPosition(new T.Matrix4().multiplyMatrices(_inv, wheel.matrixWorld)); }
        wf = (ri ? ri.steer : wheel.userData && wheel.userData.steer) ? 2 : 1; }
      for (let i = 0; i < pa.count; i++) {
        _v.fromBufferAttribute(pa, i).applyMatrix4(_m); P.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(na, i).applyMatrix3(_n).normalize(); N.push(_v.x, _v.y, _v.z);
        if (ca) Cc.push(ca.getX(i), ca.getY(i), ca.getZ(i)); else Cc.push(1, 1, 1);
        if (ma) A.push(Math.round(ma.getX(i) * 255), Math.round(ma.getY(i) * 255), Math.round(ma.getZ(i) * 255), Math.round(ma.getW(i) * 255)); else A.push(0, 128, 0, 0);
        if (piv) W.push(piv.x, piv.y, piv.z, wf); else W.push(0, 0, 0, 0);
      }
      const n = idx ? idx.count : pa.count;
      for (let i = 0; i < n; i += 3) { const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2; if (flip) I.push(base + a, base + c, base + b); else I.push(base + a, base + b, base + c); }
      base += pa.count;
    });
    if (!P.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.BufferAttribute(new Int8Array(N.map(v => Math.round(v * 127))), 3, true));
    g.setAttribute('color', new T.BufferAttribute(new Uint8Array(Cc.map(v => Math.round(Math.min(1, v) * 255))), 3, true)); g.setAttribute('aMat', new T.BufferAttribute(new Uint8Array(A), 4, true));
    g.setAttribute('aWheel', new T.Float32BufferAttribute(W, 4)); g.setIndex(base > 65535 ? new T.Uint32BufferAttribute(I, 1) : new T.Uint16BufferAttribute(I, 1));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  function partOf(o, stop) { let p = o; while (p.parent && p.parent !== stop) p = p.parent; return p; }
  async function load(types) {
    await (S.ready || init()); types = types ? [].concat(types) : Object.keys(S.manifest.types);
    return Promise.all(types.map(loadOne));
  }
  function loadOne(type) {
    if (S.kits.has(type)) return Promise.resolve(S.kits.get(type));
    if (S.loading.has(type)) return S.loading.get(type);
    const t0 = performance.now();
    const p = new Promise((ok, no) => S.loader.load(S.base + type + '.glb', ok, undefined, no)).then(gltf => {
      const root = gltf.scene.getObjectByName(type) || gltf.scene.children[0]; const meta = (root.userData && root.userData.esh) || (S.manifest.types[type] || {});
      const lods = [];
      for (let l = 0; l < 3; l++) { const ln = root.getObjectByName('LOD' + l); if (!ln) break;
        const fleetGeo = mergeNode(ln, p => !/^(interior|glass|steer|needle)$/.test(p.name), meta.rig);
        const rig = { parts: {} };
        for (const nm of ['interior', 'glass', 'steer', 'needle', 'drum', 'slew', 'upper', 'boom', 'stick', 'bucket', 'hook', 'trolley']) { const pn = ln.getObjectByName(nm); if (pn && pn.parent === ln) rig.parts[nm] = pn; }
        lods.push({ geo: fleetGeo, rig, node: ln, tris: fleetGeo ? fleetGeo.index.count / 3 : 0 }); }
      const kit = { type, meta, lods, root, ms: performance.now() - t0 };
      S.kits.set(type, kit); S.stats.loadMs += kit.ms; return kit;
    });
    S.loading.set(type, p); return p;
  }

  // ---------------------------------------------------------------- single vehicle (player car, gameplay taxi/van, showroom)
  class Vehicle extends T.Group {
    constructor(kit, o = {}) {
      super(); this.type = kit.type; this.kit = kit; this.meta = kit.meta; this.name = 'veh:' + kit.type;
      this.mat = material('single', { tier: o.tier, double: !!o.fpv });
      this.u = this.mat.userData.u; this.u.uPaint.value.copy(o.colour ? new T.Color(o.colour) : randomColour(kit.type));
      this.lights = { head: false, brake: false, reverse: false, turn: 0, hazard: false, running: o.running !== false, beacon: false };
      this.spin = 0; this.steer = 0; this.parts = {}; this.eye = kit.meta.eye ? new T.Vector3().fromArray(kit.meta.eye) : null;
      const lodMode = o.lod == null ? 'auto' : o.lod;
      const mk = l => { const lv = kit.lods[l]; if (!lv || !lv.geo) return null; const mesh = new T.Mesh(lv.geo, this.mat); mesh.castShadow = o.shadows !== false; mesh.receiveShadow = false; mesh.name = 'LOD' + l; return mesh; };
      if (lodMode === 'auto') { this.lod = new T.LOD(); const d = o.lodDist || [0, 45, 160]; for (let l = 0; l < kit.lods.length; l++) { const m = mk(l); if (m) this.lod.addLevel(m, d[l] * (kit.meta.kind === 'heavy' ? 2.2 : 1)); } this.add(this.lod); this.body = this.lod.levels[0].object; }
      else { this.body = mk(Math.min(lodMode, kit.lods.length - 1)); this.add(this.body); }
      // rig parts (only LOD0 carries them): steering wheel, speedo needle, glass + interior for first person
      const rig = kit.lods[0].rig.parts, RI = kit.meta.rig || {};
      for (const nm in rig) {
        const src = rig[nm]; if (nm === 'interior' && !o.fpv && !o.interior) continue;
        const g = mergeNode(src.parent, p => p === src); if (!g) continue;
        const ri = RI[nm] || { pivot: [0, 0, 0], rot: null };
        const pivot = new T.Object3D(); pivot.name = nm; pivot.position.fromArray(ri.pivot); if (ri.rot) pivot.quaternion.setFromEuler(new T.Euler(ri.rot[0], ri.rot[1], ri.rot[2], 'YXZ'));
        pivot.updateMatrix(); g.applyMatrix4(pivot.matrix.clone().invert());             // part-local geometry, rotates about its own pivot
        const glassFpv = nm === 'glass' && o.fpv;
        const m = glassFpv ? material('single', { tier: o.tier, glass: true }) : this.mat;
        const mesh = new T.Mesh(g, m); mesh.castShadow = nm !== 'glass'; mesh.renderOrder = glassFpv ? 2 : 0; pivot.add(mesh);
        this.body.add(pivot); this.parts[nm] = pivot; pivot.userData.q0 = pivot.quaternion.clone();
      }
      this._apply();
    }
    setColour(c) { this.u.uPaint.value.set(c); return this; }
    setLights(l) { Object.assign(this.lights, l); this._apply(); return this; }
    setWheels(spin, steer) { this.spin = spin; this.steer = steer; this.u.uState.value.z = spin; this.u.uState.value.w = steer;
      const sw = this.parts.steer; if (sw) { sw.quaternion.copy(sw.userData.q0); sw.rotateZ(-steer * 6); }
      return this; }
    drive(dt, speed, steer) { const R = this.meta.wr || 0.32; this.spin = (this.spin + speed * dt / R) % (Math.PI * 2); this.setWheels(this.spin, steer || 0); return this; }
    setSpeedo(kmh) { const n = this.parts.needle; if (n) { n.quaternion.copy(n.userData.q0); n.rotateZ(2.2 - Math.min(kmh, 240) / 240 * 4.4); } return this; }
    _apply() { const L = this.lights; this.u.uState.value.x = (L.head ? 1 : 0) + (L.brake ? 2 : 0) + (L.reverse ? 4 : 0) + (L.hazard ? 8 : 0) + (L.running ? 16 : 0) + (L.beacon ? 32 : 0); this.u.uState.value.y = L.turn || 0; }
    dispose() { this.parent && this.parent.remove(this); this.mat.dispose(); S.single.delete(this.mat); for (const k in this.parts) this.parts[k].traverse(o => { if (o.isMesh && o.material !== this.mat) o.material.dispose(); }); }
  }
  async function create(type, o = {}) { await (S.ready || init()); const kit = await loadOne(type); return new Vehicle(kit, o); }
  function createSync(type, o = {}) { const kit = S.kits.get(type); if (!kit) throw new Error('vehicle not loaded: ' + type); return new Vehicle(kit, o); }

  // ---------------------------------------------------------------- fleet: BatchedMesh (one draw call) + lamp glows (1) + contact shadows (1)
  class Fleet {
    constructor(o = {}) {
      this.o = Object.assign({ max: 160, lod: [28, 110], cull: 650, shadows: S.tier !== 'low', glow: true, blobs: true, maxVerts: 0, maxIdx: 0 }, o);
      if (S.tier === 'low') this.o.lod = [16, 80];
      this.object = new T.Group(); this.object.name = 'esh-vehicles-fleet';
      this.items = []; this.free = []; this.geoIds = new Map(); this.kitsUsed = new Set();
      let mv = this.o.maxVerts, mi = this.o.maxIdx;
      if (!mv) { mv = 0; mi = 0; for (const t of (this.o.types || [...S.kits.keys()])) { const k = S.kits.get(t); if (!k) continue; for (const lv of k.lods) if (lv.geo) { mv += lv.geo.attributes.position.count; mi += lv.geo.index.count; } } mv = Math.max(mv, 4000); mi = Math.max(mi, 12000); }
      this.mat = material('batch', {});
      this.bm = new T.BatchedMesh(this.o.max, mv, mi, this.mat); this.bm.name = 'vehicles'; this.bm.castShadow = this.o.shadows; this.bm.receiveShadow = false;
      this.bm.perObjectFrustumCulled = true; this.bm.sortObjects = true; this.bm.frustumCulled = false; this.object.add(this.bm);
      const sz = Math.ceil(Math.sqrt(this.o.max)); this.stateData = new Float32Array(sz * sz * 4); this.stateTex = new T.DataTexture(this.stateData, sz, sz, T.RGBAFormat, T.FloatType); this.stateTex.needsUpdate = true;
      this.mat.userData.u.uVehState.value = this.stateTex;
      // blobs (ground contact shadows) — instanced quads, multiply blend
      if (this.o.blobs) { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'); const g = x.createRadialGradient(32, 32, 4, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,0.62)'); g.addColorStop(0.55, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
        const tex = new T.CanvasTexture(cv); const q = new T.PlaneGeometry(1, 1); q.rotateX(-Math.PI / 2);
        this.blobs = new T.InstancedMesh(q, new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0xffffff, toneMapped: false, opacity: 0.85 }), this.o.max);
        this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1; this.object.add(this.blobs); }
      // lamp glows at night — points
      if (this.o.glow) { const n = this.o.max * 4; const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3)); geo.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3));
        const cv = document.createElement('canvas'); cv.width = cv.height = 32; const x = cv.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32);
        this.glow = new T.Points(geo, new T.PointsMaterial({ size: 1.1, map: new T.CanvasTexture(cv), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true, toneMapped: false }));
        this.glow.frustumCulled = false; this.glow.renderOrder = 3; this.object.add(this.glow); }
      this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._p = new T.Vector3(); this._s = new T.Vector3(1, 1, 1); this._up = new T.Vector3(0, 1, 0); this._c = new T.Color();
      this.stats0 = { calls: 0 }; S.fleets.add(this);
    }
    _geo(type, lod) { const k = type + ':' + lod; if (this.geoIds.has(k)) return this.geoIds.get(k); const kit = S.kits.get(type); if (!kit) return -1;
      const lv = kit.lods[Math.min(lod, kit.lods.length - 1)]; let id;
      try { id = this.bm.addGeometry(lv.geo); } catch (e) {   // grow the shared buffers (rare: a new type joined later)
        const g = lv.geo, bm = this.bm; this.cap = this.cap || { v: bm._maxVertexCount, i: bm._maxIndexCount };
        this.cap.v += g.attributes.position.count * 3; this.cap.i += g.index.count * 3; bm.setGeometrySize(this.cap.v, this.cap.i); id = bm.addGeometry(g); }
      this.geoIds.set(k, id); this.kitsUsed.add(type); return id; }
    has(type) { return S.kits.has(type); }
    add(type, o = {}) {
      const kit = S.kits.get(type); if (!kit) { console.warn('[vehicles] not loaded', type); return -1; }
      const gid = this._geo(type, 2); if (gid < 0) return -1;
      let iid; try { iid = this.bm.addInstance(gid); } catch (e) { console.warn('[vehicles] fleet full', e.message); return -1; }
      const it = this.items[iid] = { iid, type, kit, lod: 2, x: o.x || 0, y: o.y || 0, z: o.z || 0, h: o.h || 0, speed: 0, spin: 0, steer: 0, bits: o.parked ? 0 : LIGHT.RUN, turn: 0, parked: !!o.parked, R: kit.meta.wr || 0.32, live: true,
        lamps: kit.meta.lamps || null, foot: [kit.meta.W || 1.8, kit.meta.L || 4.5], visible: true };
      this.bm.setColorAt(iid, o.colour ? this._c.set(o.colour) : randomColour(type, o.rnd || Math.random));
      this.set(iid, it.x, it.y, it.z, it.h); this._writeState(it); return iid;
    }
    set(id, x, y, z, h) { const it = this.items[id]; if (!it || !it.live) return; it.x = x; it.y = y; it.z = z; it.h = h;
      this._q.setFromAxisAngle(this._up, h); this._p.set(x, y, z); this._m.compose(this._p, this._q, this._s); this.bm.setMatrixAt(id, this._m); }
    state(id, s) { const it = this.items[id]; if (!it || !it.live) return; if (s.speed != null) it.speed = s.speed; if (s.steer != null) it.steer = s.steer; if (s.turn != null) it.turn = s.turn;
      let b = it.bits; const fl = (k, v) => { if (v === true) b |= k; else if (v === false) b &= ~k; };
      fl(LIGHT.HEAD, s.head); fl(LIGHT.BRAKE, s.brake); fl(LIGHT.REVERSE, s.reverse); fl(LIGHT.HAZARD, s.hazard); fl(LIGHT.RUN, s.running); fl(LIGHT.BEACON, s.beacon); it.bits = b; this._writeState(it); }
    _writeState(it) { const o = it.iid * 4; this.stateData[o] = it.bits; this.stateData[o + 1] = it.turn; this.stateData[o + 2] = it.spin; this.stateData[o + 3] = it.steer; this.stateTex.needsUpdate = true; }
    remove(id) { const it = this.items[id]; if (!it || !it.live) return; it.live = false; try { this.bm.deleteInstance(id); } catch (e) { /* */ } this.items[id] = null; }
    clear() { for (const it of this.items) if (it && it.live) this.remove(it.iid); }
    update(dt, camera) {
      const cp = camera.position, L0 = this.o.lod[0], L1 = this.o.lod[1], cull = this.o.cull; let nb = 0, ng = 0, cnt = 0;
      const night = S.night > 0.05, bp = this.blobs, gp = this.glow && this.glow.geometry.attributes.position, gc = this.glow && this.glow.geometry.attributes.color;
      for (let i = 0; i < this.items.length; i++) { const it = this.items[i]; if (!it || !it.live) continue; cnt++;
        const dx = it.x - cp.x, dz = it.z - cp.z, dy = it.y - cp.y, d = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.25);
        const heavy = it.kit.meta.kind === 'heavy' ? 2.2 : 1;
        let want = d < L0 * heavy ? 0 : d < L1 * heavy ? 1 : 2; if (want !== it.lod && Math.abs(d - (want < it.lod ? (want === 0 ? L0 : L1) : (it.lod === 0 ? L0 : L1)) * heavy) < 2) want = it.lod;   // hysteresis
        const vis = d < cull * heavy; if (vis !== it.visible) { it.visible = vis; this.bm.setVisibleAt(i, vis); }
        if (want !== it.lod) { it.lod = want; this.bm.setGeometryIdAt(i, this._geo(it.type, want)); }
        if (!it.parked && it.speed) { it.spin = (it.spin + it.speed * dt / it.R) % 6.2832; if (it.lod === 0) this._writeState(it); }
        if (bp && vis && d < 140) { const f = it.foot; this._q.setFromAxisAngle(this._up, it.h); this._p.set(it.x, it.y + 0.03, it.z); this._s.set(f[0] * 1.25, 1, f[1] * 1.12); this._m.compose(this._p, this._q, this._s); bp.setMatrixAt(nb++, this._m); this._s.set(1, 1, 1); }
        if (gp && night && vis && it.lamps && (it.bits & LIGHT.HEAD) && d < 420 && ng < this.o.max * 4 - 4) {
          const c = Math.cos(it.h), s = Math.sin(it.h);
          for (const [arr, col] of [[it.lamps.head, [1.0, 0.86, 0.62]], [it.lamps.tail, [1.0, 0.07, 0.03]]]) for (const p of arr) {
            gp.setXYZ(ng, it.x + p[0] * c + p[2] * s, it.y + p[1], it.z - p[0] * s + p[2] * c); gc.setXYZ(ng, col[0] * S.night, col[1] * S.night, col[2] * S.night); ng++; } }
      }
      if (bp) { bp.count = nb; bp.instanceMatrix.needsUpdate = true; }
      if (gp) { this.glow.geometry.setDrawRange(0, ng); gp.needsUpdate = gc.needsUpdate = true; this.glow.visible = ng > 0; }
      this.count = cnt;
    }
    stats() { let tri = 0, n = 0; const by = [0, 0, 0]; for (const it of this.items) { if (!it || !it.live || !it.visible) continue; n++; by[it.lod]++; tri += it.kit.lods[Math.min(it.lod, it.kit.lods.length - 1)].tris; }
      return { vehicles: n, byLod: by, tris: tri, drawCalls: 1 + (this.blobs && this.blobs.count ? 1 : 0) + (this.glow && this.glow.visible ? 1 : 0), types: [...this.kitsUsed] }; }
    dispose() { this.object.parent && this.object.parent.remove(this.object); this.bm.dispose(); this.stateTex.dispose(); if (this.blobs) { this.blobs.geometry.dispose(); this.blobs.material.map.dispose(); this.blobs.material.dispose(); } if (this.glow) { this.glow.geometry.dispose(); this.glow.material.map.dispose(); this.glow.material.dispose(); } S.fleets.delete(this); }
  }
  function fleet(o) { return new Fleet(o); }
  async function parked(slots, o = {}) {
    await (S.ready || init()); const rnd = mulberry(o.seed || 27);
    const types = new Set(); const plan = slots.map(s => { const t = s.type || pickType(rnd, o.mix || MIX_PARKED); types.add(t); return Object.assign({}, s, { type: t }); });
    await load([...types]); const f = new Fleet(Object.assign({ max: Math.max(16, plan.length + 8), glow: false, types: [...types] }, o));
    for (const s of plan) f.add(s.type, { x: s.x, y: s.y, z: s.z, h: s.h, colour: s.colour, parked: true, rnd });
    return f;
  }
  // ---------------------------------------------------------------- transport dept contract: TR.setCarVisual(ESH_VEHICLES.transportVisual())
  // out[i*8+0..7] = x, y, z, heading, speed, type(model index), colour index, active
  function transportVisual(o = {}) {
    const map = o.types || ['sedan', 'hatch', 'suv', 'mini', 'taxi', 'van', 'mpv', 'pickup', 'bus', 'minibus'];
    return function factory(T_, max) {
      const f = new Fleet(Object.assign({ max: max + 4, types: map }, o)); const ids = new Array(max).fill(-1), last = new Float32Array(max), rnd = mulberry(o.seed || 9);
      load(map).catch(e => console.warn('[vehicles] transport load', e));
      let tPrev = performance.now();
      return { object: f.object, fleet: f, tris: 0,
        update(out, n) {
          const now = performance.now(), dt = Math.min(0.1, (now - tPrev) / 1000); tPrev = now;
          for (let i = 0; i < max; i++) { const o8 = i * 8; const active = i < n && out[o8 + 7] > 0.5;
            if (!active) { if (ids[i] >= 0) { f.remove(ids[i]); ids[i] = -1; } continue; }
            const type = map[(out[o8 + 5] | 0) % map.length]; if (!f.has(type)) continue;
            if (ids[i] < 0 || !f.items[ids[i]] || f.items[ids[i]].type !== type) { if (ids[i] >= 0) f.remove(ids[i]); ids[i] = f.add(type, { rnd }); last[i] = out[o8 + 4]; }
            const id = ids[i]; if (id < 0) continue; const sp = out[o8 + 4];
            f.set(id, out[o8], out[o8 + 1], out[o8 + 2], out[o8 + 3]);
            f.state(id, { speed: sp, brake: sp < last[i] - 0.6 * dt * 10 || (sp < 0.3 && sp >= 0), head: S.night > 0.15 }); last[i] = sp; }
          if (S.camera) f.update(dt, S.camera);
        } };
    };
  }
  // ---------------------------------------------------------------- global clock / night
  function tick(dt, night, camera) {
    S.time += dt; if (night != null) setNight(night); if (camera) S.camera = camera;
    const k = 1 - 0.75 * S.night;
    for (const m of S.mats.values()) { const u = m.userData.u; if (u) { u.uTime.value = S.time; u.uNight.value = S.night; } if (m.envMap) m.envMapIntensity = (m.transparent ? 1.6 : 1.0) * k; }
    for (const m of S.single) { const u = m.userData.u; if (u) { u.uTime.value = S.time; u.uNight.value = S.night; } if (m.envMap) m.envMapIntensity = (m.transparent ? 1.6 : 1.0) * k; }
  }
  function setNight(n) { S.night = Math.max(0, Math.min(1, n)); envFor(S.night); }
  function budget() {
    const rows = []; if (!S.manifest) return rows;
    for (const t of TYPES) { const m = S.manifest.types[t]; if (!m) continue; rows.push({ type: t, he: HE[t], tris: m.tris, kb: m.kb, kind: m.kind }); }
    return rows;
  }
  window.ESH_VEHICLES = { version: VERSION, TYPES, HE, LIGHT, PAINTS, MIX_TRAFFIC, MIX_PARKED, init, load, create, createSync, fleet, parked, transportVisual, randomColour, pickType, mulberry, setNight, tick, info, budget, material,
    get types() { return S.manifest ? TYPES.filter(t => S.manifest.types[t]) : TYPES; }, get tier() { return S.tier; }, set tier(v) { S.tier = v; }, get night() { return S.night; }, _S: S, Vehicle, Fleet };
})();
