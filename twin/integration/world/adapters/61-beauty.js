/* עדכון היופי הגדול (מחלקת האינטגרציה) — קובץ אחד, ניתן להסרה: ?beauty=0 להשוואה. look-pro של מחלקת השיידרים יחליף אותו.
 * פרמטרים פשוטים ומתועדים (window.YZBeauty, אפשר לשנות בזמן ריצה):
 *   exposure.day/golden/night   חשיפה לפי גובה השמש (ACES Filmic, צבע sRGB)
 *   golden.sun / golden.sky     כמה חום בשעת זהב (צבע השמש / האופק) — היה "לבן מדי"
 *   shadow.size{tier} / extent{tier}   מפת צל השמש (PCF רך) ורדיוס סביב המצלמה; בשכבה נמוכה הצל כבוי
 *   clouds.min / speed / scale  שכבת עננים חיה (fbm 5 אוקטבות): כיסוי מהמזג (לעולם לא שמיים ריקים), מוארת בשמש ביום,
 *                               ירח וזוהר עירוני כתום בלילה
 *   aniso                       סינון אנאיזוטרופי לטקסטורות העולם
 * אין כאן גאומטריה חדשה מלבד כיפת עננים אחת (קריאת ציור אחת).
 */
(function () {
  'use strict';
  const B = window.YZBeauty = Object.assign({
    exposure: { day: 1.0, golden: 1.16, night: 1.32 },
    golden: { sun: 0.9, sky: 0.55 },
    shadow: { size: { low: 0, medium: 1536, high: 2048 }, extent: { low: 85, medium: 110, high: 150 } },
    clouds: { min: 0.28, speed: 0.012, scale: 1.0 },
    aniso: 8,
  }, window.YZBeauty || {});
  const Z = { dome: null, mat: null, golden: 0, night: 0 };
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const VS = 'varying vec3 vD; void main(){ vD = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99985; }';
  const FS = `uniform float uTime, uCover, uNight, uGolden, uScale; uniform vec3 uSun, uMoon, uMoonOn, uGlow; uniform vec2 uWind; varying vec3 vD;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vD); if (d.y < 0.0) discard;
  vec2 uv = d.xz / (d.y + 0.10) * 0.9 * uScale + uWind * uTime;
  float n = fbm(uv), cov = mix(mix(0.56, 0.20, uCover), mix(0.66, 0.26, uCover), uNight);   // ביום יותר עננים נראים ("אין עננים")
  float a = smoothstep(cov, cov + 0.20, n) * smoothstep(0.0, 0.18, d.y);
  if (a < 0.003) discard;
  float thick = smoothstep(cov, cov + 0.42, n);
  vec2 sdir = normalize(uSun.xz + 1e-4); float nl = fbm(uv + sdir * 0.06); float lit = clamp(0.55 + (n - nl) * 3.0, 0.0, 1.0);   // צד מואר מול צד מוצל
  float sd = max(dot(d, normalize(uSun)), 0.0);
  vec3 day = mix(vec3(0.62, 0.66, 0.73), vec3(1.0), lit * (1.0 - thick * 0.55)) + vec3(1.0, 0.95, 0.85) * pow(sd, 10.0) * (1.0 - thick) * 0.6;
  day = mix(day, day * vec3(1.0, 0.70, 0.48) + vec3(0.18, 0.06, 0.0) * (1.0 - thick), uGolden);
  float md = max(dot(d, normalize(uMoon)), 0.0);
  vec3 night = vec3(0.045, 0.055, 0.095) * (0.55 + 0.45 * lit) + uMoonOn * (vec3(0.30, 0.34, 0.42) * pow(md, 6.0) * (1.2 - thick) + vec3(0.03, 0.035, 0.05) * lit);   // כיול מול תמונות הלילה: עננים כהים-כחולים, מוארים רק סביב הירח
  night += uGlow * pow(1.0 - d.y, 5.0) * (0.25 + 0.45 * thick);   // זוהר עירוני כתום על תחתית העננים
  vec3 col = mix(day, night, uNight);
  gl_FragColor = vec4(col, a * mix(0.93, 0.78, uNight));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
  function env(world) {
    if (world.providers.atmosphere) { if (Z.dome) Z.dome.visible = false; return; }   // מחלקת האווירה פעילה: בלי חשיפה/עננים/זהב כפולים
    if (Z.dome) Z.dome.visible = true;
    const el = world.sun.elevation, w = world.weather, r = world.renderer, G = world.G27;
    Z.night = clamp((2 - el) / 8, 0, 1); Z.golden = clamp(1 - Math.abs(el - 6) / 9, 0, 1) * (1 - w.cloud * 0.7);
    r.toneMappingExposure = Z.night > 0.5 ? B.exposure.night : B.exposure.day + (B.exposure.golden - B.exposure.day) * Z.golden;
    if (world.sunLight && Z.golden > 0.02) { world.sunLight.color.lerp(new THREE.Color(1.0, 0.60, 0.33), Z.golden * B.golden.sun); }
    const u = world.sky && world.sky.material.uniforms;
    if (u) { u.cloud.value = 0;   // העננים של כיפת המשחק כבויים — שכבת העננים כאן מחליפה אותם
      if (Z.golden > 0.02) { u.hor.value.lerp(new THREE.Color(1.0, 0.66, 0.38), Z.golden * B.golden.sky); if (world.scene.fog) world.scene.fog.color.lerp(new THREE.Color(0.98, 0.72, 0.50), Z.golden * B.golden.sky * 0.8); }
      if (Z.night > 0.3) { u.hor.value.lerp(new THREE.Color(0.20, 0.15, 0.13), Z.night * 0.35); } }   // אופק עירוני חמים בלילה
    if (Z.mat) { const U = Z.mat.uniforms, sd = world.sun.dir; U.uSun.value.set(sd.x, Math.max(sd.y, 0.02), sd.z); U.uNight.value = Z.night; U.uGolden.value = Z.golden;
      U.uCover.value = clamp(Math.max(B.clouds.min, w.cloud), 0, 1); const wv = w.wind || { x: 0, z: 0 }; U.uWind.value.set(wv.x * B.clouds.speed * 0.05 + 0.004, wv.z * B.clouds.speed * 0.05 + 0.002);
      let mo = null; try { mo = world.providers.moon && world.providers.moon(); } catch (e) { /* */ }
      if (mo && mo.vec) { U.uMoon.value.set(mo.vec.x, mo.vec.y, mo.vec.z); const up = (mo.altApparent != null ? mo.altApparent : mo.alt || 0) > 0 ? 1 : 0; U.uMoonOn.value.setScalar(up * (mo.phase != null ? 0.3 + 0.7 * mo.phase : 1)); } else U.uMoonOn.value.setScalar(0); }
  }
  function shadows(world) {
    const L = world.sunLight, t = world.quality.tier; if (!L) return; const n = B.shadow.size[t] || 0;
    if (n && L.shadow.mapSize.x !== n) { L.shadow.mapSize.set(n, n); if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; } }
    L.shadow.radius = 2.5; L.shadow.bias = -0.0003; L.shadow.normalBias = 0.5;
  }
  function aniso(world) { const mx = Math.min(B.aniso, world.renderer.capabilities.getMaxAnisotropy ? world.renderer.capabilities.getMaxAnisotropy() : 1); const M = world.data.MAT;
    for (const k in M) { const m = M[k]; if (m && m.map && m.map.anisotropy !== mx) { m.map.anisotropy = mx; m.map.needsUpdate = true; } } }
  YZW.register({
    id: 'beauty', name: 'עדכון היופי: עננים חיים, שעת זהב, צללים רכים, חשיפה', dept: 'integration (→ look-pro)', order: 61,
    init(world, api) {
      const r = world.renderer; r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
      if (r.shadowMap.type !== THREE.PCFSoftShadowMap) { r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.needsUpdate = true; }
      Z.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
        uniforms: { uTime: { value: 0 }, uCover: { value: 0.4 }, uNight: { value: 0 }, uGolden: { value: 0 }, uScale: { value: B.clouds.scale }, uSun: { value: new THREE.Vector3(0, 1, 0) },
          uMoon: { value: new THREE.Vector3(0, 1, 0) }, uMoonOn: { value: new THREE.Vector3() }, uGlow: { value: new THREE.Color(0.42, 0.22, 0.10) }, uWind: { value: new THREE.Vector2(0.004, 0.002) } } });
      Z.dome = new THREE.Mesh(new THREE.SphereGeometry(1350, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), Z.mat); Z.dome.frustumCulled = false; Z.dome.renderOrder = -0.4; api.group().add(Z.dome);
      api.on('env', () => env(world)); api.on('quality', () => shadows(world)); api.on('tile', () => aniso(world));
      env(world); shadows(world); aniso(world);
    },
    update(dt, world) {
      if (world.providers.atmosphere && Z.dome.visible) Z.dome.visible = false;
      Z.dome.position.copy(world.camera.position); Z.mat.uniforms.uTime.value += dt;
      const L = world.sunLight, t = world.quality.tier, E = B.shadow.extent[t] || 85;
      if (L && world.player.mode !== 'dev') { const sc = L.shadow.camera; if (sc.right !== E) { sc.left = sc.bottom = -E; sc.right = sc.top = E; sc.updateProjectionMatrix(); } }
    },
    dispose(world) { const r = world.renderer; r.toneMappingExposure = 1.05; const u = world.sky && world.sky.material.uniforms; if (u) u.cloud.value = world.weather.cloud;
      const L = world.sunLight; if (L) { const sc = L.shadow.camera; sc.left = sc.bottom = -85; sc.right = sc.top = 85; sc.updateProjectionMatrix(); } },
  });
})();
