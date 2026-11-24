/* מתאם: מחלקת "שמיים וזמן" (swarm/sky → mods/sky/esh27-sky.js, window.ESH27Sky) — תוסף למארח YZW.
 * חוזה המארח: YZW.register({ id, name, dept, order, scripts, requires, init(world, api), update(dt, world), dispose(world), hudPanels, settings }).
 * מה הוא עושה:
 *   1) כיפת שמיים אמיתית: 300 הכוכבים הבהירים (קטלוג ייל BSC5), ירח עם מופע נכון (מואר מכיוון השמש), 5 כוכבי לכת, שביל החלב (חזותי).
 *      מערכת צירים של העולם: x = מזרח, y = מעלה, z = דרום; צפון רשת ITM ≠ צפון אמיתי ב-γ (world.providers.gammaDeg, ≈ −0.29° באשדוד).
 *   2) ספקים לשאר המחלקות: world.providers.moon(), .skyAt(date), .zmanim(y,m,d), .hebrewDate(date), .sky (המצב המלא).
 *   3) לוח HUD: תאריך עברי, מופע הירח, זמני היום של היום הנוכחי.
 * תקציב: עבודה כבדה (VSOP/ELP) מחולקת על פני פריימים – לכל היותר גוף אחד בפריים, ורק כשהזמן יצא מחלון התוקף.
 * נמדד (test/plugin.test.mjs): ~20–90 מיקרו-שנייה CPU לפריים בצומת node; ראו README.txt.
 */
(function () {
  'use strict';
  const LAT = 31.8014, LON = 34.6435, R = 1500;                   // רדיוס כיפה (בתוך camera.far ≥ 1520 של המשחק)
  const K = { S: null, st: null, g: null, stars: null, mw: null, moon: null, sun: null, planets: null, labels: [], m4: null, zm: null, zmKey: '', hd: null, opts: { stars: true, mw: true, moonScale: 1 } };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  function bvColor(bv) {   // B−V → RGB (קירוב Ballesteros + גוף שחור)
    const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)), t = T / 100;
    let r, g, b; if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; } else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
    return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
  }
  const POINT_VS = 'attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale; gl_Position = projectionMatrix * mv; }';
  const POINT_FS = 'varying vec3 vC; uniform float uOpacity; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; float a = smoothstep(0.25, 0.0, r); gl_FragColor = vec4(vC, a * uOpacity); }';
  function pointsMat(THREE) {
    return new THREE.ShaderMaterial({ uniforms: { uOpacity: { value: 1 }, uScale: { value: 1 } }, vertexShader: POINT_VS, fragmentShader: POINT_FS,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
  }
  function buildStars(THREE, F) {
    const n = F.n, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = F.eq[i * 3] * R; pos[i * 3 + 1] = F.eq[i * 3 + 1] * R; pos[i * 3 + 2] = F.eq[i * 3 + 2] * R;
      const c = bvColor(F.bv[i]), b = Math.pow(10, -0.4 * (F.mag[i] - 1.5)); col.set(c.map(v => v * clamp(0.35 + 0.65 * b, 0.25, 1.4)), i * 3);
      size[i] = clamp(4.2 - 0.7 * F.mag[i], 1.6, 7); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const p = new THREE.Points(g, pointsMat(THREE)); p.frustumCulled = false; p.renderOrder = -0.5; p.matrixAutoUpdate = false; return p;
  }
  function buildMilkyWay(THREE, S, date) {
    const pts = S.milkyWay(date, 1600), n = pts.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = pts[i].v; pos.set([v[0] * R * 1.01, v[1] * R * 1.01, v[2] * R * 1.01], i * 3); const w = pts[i].w * 0.09; col.set([w * 0.9, w * 0.95, w * 1.1], i * 3); size[i] = 9; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const p = new THREE.Points(g, pointsMat(THREE)); p.frustumCulled = false; p.renderOrder = -0.6; p.matrixAutoUpdate = false; return p;
  }
  function buildMoon(THREE) {
    const m = new THREE.ShaderMaterial({ uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uOpacity: { value: 1 } }, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uSun; uniform float uOpacity; varying vec3 vN; void main(){ float l = max(dot(normalize(vN), normalize(uSun)), 0.0); vec3 c = vec3(0.93,0.91,0.86) * (0.03 + 1.1 * l); gl_FragColor = vec4(c, uOpacity); }' });
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m); s.frustumCulled = false; s.renderOrder = -0.4; return s;
  }
  function buildPlanets(THREE) {
    const n = 5, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const col = new Float32Array([0.9, 0.85, 0.75, 1, 0.98, 0.9, 1, 0.6, 0.45, 1, 0.93, 0.8, 0.95, 0.88, 0.65]); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n).fill(4), 1));
    const p = new THREE.Points(g, pointsMat(THREE)); p.frustumCulled = false; p.renderOrder = -0.45; return p;
  }
  function placeOf(world) {   // מיקום השחקן ב-WGS84 אם יש המרה, אחרת מרכז אשדוד
    try { const c = world.coords, p = world.player.pos; if (c && c.toITM && c.itmToWgs84) { const itm = (c.toRealITM || c.toITM)(p.x, p.z), w = c.itmToWgs84(itm.E, itm.N); if (w && isFinite(w.lat)) return { lat: w.lat, lon: w.lon }; } } catch (e) { /* */ }
    return { lat: LAT, lon: LON };
  }
  const p2 = n => String(n).padStart(2, '0');
  function ilYMD(world, d) { const off = world.G27 && world.G27.SIM && world.G27.SIM.israelOffsetMin ? world.G27.SIM.israelOffsetMin(d) : 120; const l = new Date(d.getTime() + off * 60000); return [l.getUTCFullYear(), l.getUTCMonth() + 1, l.getUTCDate()]; }

  YZW.register({
    id: 'sky', name: 'שמיים וזמן: ירח, כוכבי לכת, 300 כוכבים, זמני היום, לוח עברי', dept: 'sky', order: 15,
    scripts: ['mods/sky/esh27-sky.js'],
    requires: () => !!window.ESH27Sky,
    init(world, api) {
      const S = K.S = window.ESH27Sky, THREE = window.THREE, pl = placeOf(world);
      const gamma = world.providers.gammaDeg != null ? world.providers.gammaDeg : S.itmConvergenceDeg(pl.lat, pl.lon);
      K.st = S.createSkyState({ lat: pl.lat, lon: pl.lon, gammaDeg: gamma, maxRefreshPerFrame: 1 });
      const date = world.clock.date || new Date(); K.st.update(date, 7);
      K.g = api.group(); K.m4 = new THREE.Matrix4();
      K.stars = buildStars(THREE, K.st.stars); K.g.add(K.stars);
      K.mw = buildMilkyWay(THREE, S, date); K.g.add(K.mw);
      K.moon = buildMoon(THREE); K.g.add(K.moon);
      K.planets = buildPlanets(THREE); K.g.add(K.planets);
      world.providers.sky = K.st; world.providers.starsReal = 'sky';
      world.providers.moon = () => K.st.bodies.Moon;
      world.providers.skyAt = (d, lat = pl.lat, lon = pl.lon) => S.skyAt(d, lat, lon, { gammaDeg: gamma });
      world.providers.zmanim = (y, m, d, lat = pl.lat, lon = pl.lon, o) => S.zmanim(y, m, d, lat, lon, o);
      world.providers.hebrewDate = (d, o = {}) => S.hebrew.hebrewDate(S.jdFromDate(d), Object.assign({ tzHours: 2 }, o));
      api.on('env', () => { K.zmKey = ''; });
    },
    update(dt, world) {
      if (!K.st) return;
      const d = world.clock.date; if (!d) return;
      const st = K.st.update(d), cam = world.camera, M = st.matrix;
      // כוכבים + שביל החלב: סיבוב אחד (משווני-של-התאריך → עולם), צמוד למצלמה
      K.m4.set(M[0], M[1], M[2], 0, M[3], M[4], M[5], 0, M[6], M[7], M[8], 0, 0, 0, 0, 1); K.m4.setPosition(cam.position);
      if (st.stars !== K.lastStars) { const a = K.stars.geometry.attributes.position; for (let i = 0; i < st.stars.n * 3; i++) a.array[i] = st.stars.eq[i] * R; a.needsUpdate = true; K.lastStars = st.stars; }
      K.stars.matrix.copy(K.m4); K.mw.matrix.copy(K.m4); K.stars.matrixWorldNeedsUpdate = K.mw.matrixWorldNeedsUpdate = true;
      const sun = st.bodies.Sun, moon = st.bodies.Moon, w = world.weather || {};
      const dark = clamp((-sun.altApparent - 1) / 11, 0, 1), clear = 1 - clamp(w.cloud || 0, 0, 1) * 0.95, haze = clamp(((w.aqi || 0) - 40) / 250, 0, 0.6);
      K.stars.material.uniforms.uOpacity.value = dark * clear * (1 - haze); K.stars.visible = K.opts.stars && dark > 0.02;
      K.mw.material.uniforms.uOpacity.value = clamp((-sun.altApparent - 12) / 6, 0, 1) * clear * (1 - haze * 1.5); K.mw.visible = K.opts.mw && K.mw.material.uniforms.uOpacity.value > 0.02;
      // ירח: גודל זוויתי אמיתי ×1 (0.5°), מופע לפי כיוון השמש
      const mv = moon.vec, rM = R * 0.97, sd = Math.tan(moon.semidiameter * Math.PI / 180) * rM;
      K.moon.position.set(cam.position.x + mv.x * rM, cam.position.y + mv.y * rM, cam.position.z + mv.z * rM); K.moon.scale.setScalar(sd * K.opts.moonScale);
      K.moon.material.uniforms.uSun.value.set(sun.vec.x, sun.vec.y, sun.vec.z); K.moon.material.uniforms.uOpacity.value = (0.35 + 0.65 * dark) * clear; K.moon.visible = moon.altApparent > -1;
      const pa = K.planets.geometry.attributes.position, ps = K.planets.geometry.attributes.size, names = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
      for (let i = 0; i < 5; i++) { const b = st.bodies[names[i]], v = b.vec; pa.setXYZ(i, cam.position.x + v.x * R * 0.98, cam.position.y + v.y * R * 0.98, cam.position.z + v.z * R * 0.98); ps.setX(i, b.altApparent > -1 ? 4.5 : 0); }
      pa.needsUpdate = ps.needsUpdate = true; K.planets.material.uniforms.uOpacity.value = clamp(dark * 1.5, 0, 1) * clear; K.planets.visible = dark > 0.02;
      const sc = world.renderer ? world.renderer.getPixelRatio() : 1; K.stars.material.uniforms.uScale.value = K.mw.material.uniforms.uScale.value = K.planets.material.uniforms.uScale.value = sc;
    },
    dispose(world) { for (const k of ['sky', 'moon', 'skyAt', 'zmanim', 'hebrewDate', 'starsReal']) world.providers[k] = null; K.st = null; K.g = null; },
    hudPanels: [{ id: 'sky', render(el, world) {
      if (!K.st || !K.S) { el.textContent = '—'; return; }
      const S = K.S, d = world.clock.date, [y, m, dd] = ilYMD(world, d), key = y + '-' + m + '-' + dd;
      if (key !== K.zmKey) { K.zmKey = key; K.zm = S.zmanim(y, m, dd, K.st.obs.lat, K.st.obs.lon); }
      const moon = K.st.bodies.Moon, z = K.zm, after = z.times.sunset != null && S.jdFromDate(d) > z.times.sunset;
      const hd = S.hebrew.hebrewDate(S.jdFromDate(d), { tzHours: z.utcOffsetHours, afterSunset: after });
      const rows = z.list.filter(r => ['alos16_1', 'misheyakir11_5', 'sunrise', 'sofZmanShmaMGA72', 'sofZmanShmaGRA', 'sofZmanTfilaGRA', 'chatzos', 'minchaGedola', 'minchaKetana', 'plagHamincha', 'sunset', 'tzeis8_5', 'tzeisRT72'].includes(r.key));
      el.innerHTML = `<div dir="rtl"><b>${hd.text}</b> · ירח: ${moon.phase != null ? Math.round(moon.phase * 100) : '?'}% ${moon.waxing ? 'מתמלא' : 'מתמעט'} · גובה ${moon.altApparent.toFixed(1)}°</div>` +
        `<table dir="rtl" style="font-size:12px">${rows.map(r => `<tr><td>${r.he}</td><td style="direction:ltr">${r.local.slice(0, 5)}</td></tr>`).join('')}</table>` +
        `<div style="font-size:11px;opacity:.7" dir="rtl">חישוב, לא פסק הלכה. ${p2(dd)}.${p2(m)}.${y}</div>`;
    } }],
    settings: [
      { id: 'sky.stars', label: 'כוכבים אמיתיים (BSC5)', type: 'toggle', get: () => K.opts.stars, set: v => { K.opts.stars = !!v; } },
      { id: 'sky.mw', label: 'שביל החלב (חזותי)', type: 'toggle', get: () => K.opts.mw, set: v => { K.opts.mw = !!v; } },
      { id: 'sky.moonScale', label: 'הגדלת הירח (1 = גודל אמיתי 0.5°)', type: 'select', options: [1, 2, 4], get: () => K.opts.moonScale, set: v => { K.opts.moonScale = +v || 1; } },
    ],
  });
})();
