/* ESH27 twin — atmosphere — rig.js : the engine-facing API (needs THREE r160+).
 *
 *   import { createAtmosphere } from './atmosphere/src/index.js';
 *   const atmo = createAtmosphere({ THREE, renderer, scene, camera, tier: 'mid' });
 *   atmo.setLocalTime(2026, 11, 23, 16, 30);        // or atmo.setTime(Date | ms)
 *   atmo.setAirQuality('sharav');                   // preset name, or {pm25, pm10, dust, no2, rh, aod}
 *   atmo.setWeather({ cloud: 0.4 });                // from weather team: weatherToVisual(...) / Open-Meteo cloud_cover/100
 *   atmo.setQualityTier('low' | 'mid' | 'high');    atmo.setCameraProfile('physical' | 'phone');
 *   atmo.patchMaterial(myBuildingMaterial);         // windows + lamp pools + fog + water look
 *   atmo.nightLights.setLamps(lamps); atmo.nightLights.setVehicles(f32); atmo.nightLights.setBeacons(list);
 *   loop: atmo.update(dtSeconds); atmo.render();    // render() replaces renderer.render(scene, camera)
 */
import { computeLook } from './look.js';
import { localToUtc, starField, ASHDOD } from './astro.js';
import { AQ_PRESETS } from './airquality.js';
import { createSky, createStars } from './sky.js';
import { createShared, patchMaterial, bakeLampMap, createSprites } from './nightlights.js';
import { AtmoPost } from './post.js';
import { buildLUT, hexToLinear, LAMP_TYPES, lampTypeForStreet } from './palette.js';

export const TIERS = {
  low:  { post: 'low',  shadows: 0,    lampMap: 1024, dprMax: 1.25, stars: 400 },
  mid:  { post: 'mid',  shadows: 1024, lampMap: 2048, dprMax: 1.5,  stars: 900 },
  high: { post: 'high', shadows: 2048, lampMap: 2048, dprMax: 2.0,  stars: 1400 },
};

export function createAtmosphere({ THREE, renderer, scene, camera, site = ASHDOD, tier = 'mid', profile = 'physical', removeLights = true, shadowTarget = null } = {}) {
  const T = THREE;
  if (removeLights) scene.traverse(o => { if (o.isLight && !o.userData.esh27atmo) o.visible = false; });   // take over lighting (others' lights hidden, not deleted)
  renderer.outputColorSpace = T.SRGBColorSpace;
  const group = new T.Group(); group.name = 'esh27-atmosphere'; scene.add(group);
  const sky = createSky(T); group.add(sky.mesh);
  const stars = createStars(T, starField(TIERS.high.stars)); group.add(stars.points);
  const sunL = new T.DirectionalLight(0xffffff, 1); sunL.userData.esh27atmo = true; sunL.name = 'esh27-sun';
  const moonL = new T.DirectionalLight(0x9db4d8, 0); moonL.userData.esh27atmo = true; moonL.name = 'esh27-moon';
  const hemi = new T.HemisphereLight(0xffffff, 0xffffff, 1); hemi.userData.esh27atmo = true;
  group.add(sunL, sunL.target, moonL, moonL.target, hemi);
  const S = createShared(T);
  const lampSprites = createSprites(T, 'esh27-lamps'), carSprites = createSprites(T, 'esh27-vehicles'), beaconSprites = createSprites(T, 'esh27-beacons');
  group.add(lampSprites.points, carSprites.points, beaconSprites.points);
  const post = new AtmoPost(T, renderer, { lut: { data: buildLUT(32), size: 32 } });
  const st = { ms: Date.now(), aq: Object.assign({ source: 'preset' }, AQ_PRESETS.clean), weather: {}, tier, profile, t: 0, exposure: null, look: null, lampMap: null, lamps: null, focus: new T.Vector3() };
  const v3 = (o, a) => o.set(a[0], a[1], a[2]);
  // Host-friendly fog: if the host already owns scene.fog (e.g. a linear THREE.Fog whose near/far it animates), KEEP that object
  // and only drive its colour — replacing it broke the integration world (host read fog.far → NaN camera.far → black frame).
  const hostFog = scene.fog || null;
  const fogObj = hostFog || new T.FogExp2(0xffffff, 0.0001);   // ours: density = β (matches our exp fog at 1/β)
  const saved = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, background: scene.background, fog: scene.fog,
    shadow: renderer.shadowMap.enabled, autoClear: renderer.autoClear };

  function applyTier() {
    const c = TIERS[st.tier] || TIERS.mid;
    post.setTier(c.post);
    renderer.shadowMap.enabled = c.shadows > 0; renderer.shadowMap.type = T.PCFSoftShadowMap;
    sunL.castShadow = c.shadows > 0;
    if (c.shadows) { sunL.shadow.mapSize.set(c.shadows, c.shadows); if (sunL.shadow.map) { sunL.shadow.map.dispose(); sunL.shadow.map = null; } }
    S.uGrade.value.set(...(c.post === 'low' ? [1.02, 1.0, 0.975] : [1, 1, 1]));
    st.dirty = true;
  }
  function recompute() { st.look = computeLook({ ms: st.ms, site, aq: st.aq, weather: st.weather }); st.dirty = false; return st.look; }

  function apply(dt) {
    const L = st.dirty || !st.look ? recompute() : st.look;
    // exposure adaptation (eye/camera): ~1.5 s time constant in log space; instant on big jumps (slider scrubbing)
    const target = L.exposure;
    if (st.exposure == null || dt <= 0 || Math.abs(Math.log(target / st.exposure)) > 2.5) st.exposure = target;
    else st.exposure = Math.exp(Math.log(st.exposure) + (Math.log(target) - Math.log(st.exposure)) * (1 - Math.exp(-dt / 1.5)));
    // lights
    const f = st.focus;
    sunL.position.set(f.x + L.sun.dir.x * 3000, f.y + L.sun.dir.y * 3000, f.z + L.sun.dir.z * 3000); sunL.target.position.copy(f);
    v3(sunL.color, L.sun.color); sunL.intensity = L.sun.intensity; sunL.visible = L.sun.intensity > 1e-6;
    moonL.position.set(f.x + L.moon.dir.x * 3000, f.y + L.moon.dir.y * 3000, f.z + L.moon.dir.z * 3000); moonL.target.position.copy(f);
    v3(moonL.color, L.moon.color); moonL.intensity = L.moon.intensity; moonL.visible = L.moon.intensity > 1e-9 && L.moon.dir.y > 0;
    if (sunL.castShadow) { const sc = sunL.shadow.camera, R = st.shadowRadius || 900; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 100; sc.far = 6000; sc.updateProjectionMatrix(); sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.6; sunL.shadow.intensity = 0.85 + 0.15 * (1 - L.cloud); }
    v3(hemi.color, L.hemi.sky); v3(hemi.groundColor, L.hemi.ground); hemi.intensity = 1;
    // sky
    const U = sky.uniforms, K = L.sky;
    v3(U.sunDir.value, [L.sun.dir.x, L.sun.dir.y, L.sun.dir.z]);
    for (const k of ['preethamGain', 'turbidity', 'mieCoefficient', 'mieG', 'sunDisc', 'twi', 'twiSun', 'moonRad', 'halo', 'hazeHorizon', 'hazeZenith', 'hazeSpread', 'cloudCover']) U[k].value = K[k];
    for (const k of ['nightBase', 'cityGlow', 'moonScatter', 'hazeColor', 'sunGlow', 'cloudDay', 'cloudNight']) U[k].value.setRGB(K[k][0], K[k][1], K[k][2]);
    U.moonDir.value.set(K.moonDir.x, K.moonDir.y, K.moonDir.z); U.cloudTime.value = st.t * 6;
    // stars
    const m = L.starMatrix; stars.uniforms.rot.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    stars.uniforms.limitMag.value = L.stars.limitMag; stars.uniforms.gain.value = L.stars.gain; stars.uniforms.px.value = renderer.getPixelRatio();
    stars.points.visible = L.stars.limitMag > -0.5;
    // shared material uniforms
    S.uSunDir.value.set(L.sun.dir.x, L.sun.dir.y, L.sun.dir.z); S.uFogBeta.value = L.fog.beta; S.uFogCol.value.setRGB(...L.fog.color); S.uSunGlow.value.setRGB(...K.sunGlow);
    S.uHour.value = L.localHour; S.uOcc.value = L.night.occupancy; S.uWinGain.value = L.night.windowGain; S.uDayGlass.value = L.night.dayGlass;
    S.uSkyRefl.value.setRGB(...L.night.skyRefl); S.uLampOn.value = L.night.lightsOn * L.night.lampLux / 22; S.uCityUp.value.setRGB(...L.night.cityUp); S.uTime.value = st.t;
    S.uWarm.value.setRGB(...L.night.warm); S.uCool.value.setRGB(...L.night.cool); S.uTv.value.setRGB(...L.night.tv);
    // other teams' materials: standard FogExp2 with the same colour
    fogObj.color.setRGB(...L.fog.color); if (fogObj.isFogExp2) fogObj.density = L.fog.beta; if (scene.fog !== fogObj) scene.fog = fogObj;
    scene.background = null;
    // phone auto-white-balance at night: pulls the sodium/LED cast ~35% toward neutral (field photos: pools read #957E5F, not orange)
    { const n = L.night.lightsOn, c = [1.0, 0.78, 0.52].map(v => 1 / (1 - 0.35 * n * (1 - v))), m = c[1]; post.phoneWB = c.map(v => v / m); }
    // sprites
    const px = renderer.getPixelRatio(), rays = st.profile === 'phone' ? 1 : 0;
    for (const sp of [lampSprites, carSprites, beaconSprites]) { sp.uniforms.px.value = px; sp.uniforms.time.value = st.t; sp.uniforms.rays.value = rays; }
    lampSprites.uniforms.on.value = L.night.lampSprite; carSprites.uniforms.on.value = 0.0006 + 0.0022 * L.night.lightsOn; beaconSprites.uniforms.on.value = 0.004 * (0.15 + 0.85 * L.night.lightsOn);
  }

  // ---------------------------------------------------------------- night-light hooks
  const nightLights = {
    /** lamps: [{x, y, z, type?: 'sodium'|'led', street?: name, color?: [r,g,b] linear, lux?}] (world coordinates). Bakes the pool light-map too. */
    setLamps(lamps, { box } = {}) {
      const n = lamps.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), splat = new Float32Array(n * 6);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      lamps.forEach((l, i) => {
        const type = l.type || lampTypeForStreet(l.street || ''), c = l.color || hexToLinear(LAMP_TYPES[type].color), mx = Math.max(...c);
        pos.set([l.x, (l.y || 0) + LAMP_TYPES[type].height, l.z], i * 3); col.set(c.map(v => v / mx), i * 3); size[i] = type === 'led' ? 0.9 : 1.1;
        splat.set([l.x, l.z, c[0] / mx, c[1] / mx, c[2] / mx, l.lux || (type === 'led' ? 24 : 18)], i * 6);
        x0 = Math.min(x0, l.x); z0 = Math.min(z0, l.z); x1 = Math.max(x1, l.x); z1 = Math.max(z1, l.z);
      });
      lampSprites.set(pos, col, size);
      const b = box || { x0: x0 - 60, z0: z0 - 60, w: Math.max(x1 - x0, z1 - z0) + 120, d: Math.max(x1 - x0, z1 - z0) + 120 };
      if (st.lampMap) st.lampMap.rt.dispose();
      st.lampMap = n ? bakeLampMap(T, renderer, splat, b, (TIERS[st.tier] || TIERS.mid).lampMap) : null;
      S.uLampMap.value = st.lampMap ? st.lampMap.texture : null; if (st.lampMap) S.uLampBox.value.copy(st.lampMap.box);
      st.lamps = { count: n, box: b }; return st.lamps;
    },
    /** vehicles: Float32Array [x, y, z, yawRad] per vehicle (yaw 0 = facing −z/north, CCW). Head (white) + tail (red) pairs. */
    setVehicles(f32) {
      const n = f32.length / 4, pos = new Float32Array(n * 6), col = new Float32Array(n * 6), size = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { const x = f32[i * 4], y = f32[i * 4 + 1] + 0.7, z = f32[i * 4 + 2], a = f32[i * 4 + 3], dx = -Math.sin(a) * 2.2, dz = -Math.cos(a) * 2.2;
        pos.set([x + dx, y, z + dz, x - dx, y, z - dz], i * 6); col.set([1, 0.95, 0.85, 1, 0.04, 0.02], i * 6); size[i * 2] = 0.5; size[i * 2 + 1] = 0.35; }
      carSprites.set(pos, col, size);
    },
    /** beacons: [{x, y, z, color?: [r,g,b], blink?: true}] — aviation obstruction lights on towers/cranes (red, 1 Hz blink). */
    setBeacons(list) {
      const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n);
      list.forEach((b, i) => { pos.set([b.x, b.y, b.z], i * 3); col.set(b.color || [1, 0.05, 0.03], i * 3); size[i] = b.size || 0.8; ph[i] = b.blink === false ? -1 : (i * 0.37) % 1; });
      beaconSprites.set(pos, col, size, ph);
    },
    get lampCount() { return st.lamps ? st.lamps.count : 0; },
  };

  const api = {
    THREE: T, group, sky, stars, sun: sunL, moon: moonL, hemi, shared: S, post, nightLights,
    setTime(d) { st.ms = typeof d === 'number' ? d : d.getTime(); st.dirty = true; return api; },
    setLocalTime(y, m, d, hh = 12, mm = 0) { return api.setTime(localToUtc(y, m, d, hh, mm, 0, site.tz || 'Asia/Jerusalem')); },
    setAirQuality(aq) { st.aq = typeof aq === 'string' ? Object.assign({ source: 'preset', preset: aq }, AQ_PRESETS[aq] || AQ_PRESETS.clean) : Object.assign({}, aq); st.dirty = true; return api; },
    setWeather(w = {}) { st.weather = Object.assign({}, w); st.dirty = true; return api; },
    setQualityTier(t) { st.tier = TIERS[t] ? t : 'mid'; applyTier(); return api; },
    setCameraProfile(p) { st.profile = p === 'phone' ? 'phone' : 'physical'; post.setProfile(st.profile); return api; },
    /** Centre of interest (shadow frustum follows it). radius = half-size of the shadow box (m). */
    setFocus(v, radius) { st.focus.copy(v); if (radius) st.shadowRadius = radius; return api; },
    patchMaterial(m) { return patchMaterial(m, S); },
    setSize(w, h) { post.setSize(w, h); },
    update(dt = 0) { st.t += dt; apply(dt); return st.look; },
    render() {
      renderer.autoClear = true;   // hosts that render in passes may leave autoClear off — our HDR target must be cleared   // phone profile: night-mode multi-frame exposure is ~1–1.5 EV brighter than the eye-like auto exposure
      const e = st.exposure ?? 1, g = st.profile === 'phone' ? 1 + 1.0 * Math.min(1, Math.max(0, (Math.log10(e) - 1) / 2)) : 1;
      post.render(scene, camera, e * g, st.t); },
    get state() { return st.look; }, get exposure() { return st.exposure; }, get tier() { return st.tier; }, get profile() { return st.profile; },
    dispose() { post.dispose(); scene.remove(group); st.lampMap && st.lampMap.rt.dispose(); sky.material.dispose();
      renderer.toneMapping = saved.toneMapping; renderer.toneMappingExposure = saved.exposure; renderer.shadowMap.enabled = saved.shadow; renderer.autoClear = saved.autoClear;
      scene.background = saved.background; scene.fog = saved.fog; renderer.setRenderTarget(null); },
  };
  const sz = renderer.getSize(new T.Vector2()); post.setSize(sz.x, sz.y);
  applyTier(); if (profile === 'phone') api.setCameraProfile('phone');
  return api;
}
