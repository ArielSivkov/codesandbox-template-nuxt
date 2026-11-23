/* 67-globe.js — קומה 1 של המנוע הגלובלי: כדור הארץ → ישראל → העיר (גדוד בנייה – כדור הארץ, ESH27, 23.11.2026)
 *
 * מה זה: במצב "העין הגדולה", כשמתרחקים מעבר לתקרה (6 ק"מ) וממשיכים להתרחק (גלגלת / צביטה / ▼), או בכפתור "🌍 כדור",
 * עוברים לכדור ארץ עם יום/לילה אמיתי לפי השעון האחד של העולם (world.clock.date → נקודת התת־שמש מ-SIM.sunPosition, NOAA).
 * ישראל ונקודת היציאה (אשדוד) מסומנות. הקשה על ישראל / צביטה פנימה / "🏙 לעיר" → טיסה חלקה חזרה, נחיתה בעין הגדולה.
 * הקשה על נקודה בישראל שבתוך תחום העולם הטעון → נוחתים שם (ולא בנקודת היציאה).
 *
 * בלי לשבור את העולם: מצב 'overlay' של המארח → העולם מושהה ולא מצויר; הכדור הוא סצנה + מצלמה + WebGLRenderer נפרדים על
 * קנבס משלו מעל העולם (render של three מוגדר על המופע ולא על ה-prototype, והעטיפה של המארח מריצה את המודולים שוב כשמושהה –
 * לכן הקשר WebGL שני, קטן, רק כל זמן שהכדור פתוח). ביציאה: dispose לכל הגאומטריות, החומרים והטקסטורות + forceContextLoss
 * והסרת הקנבס. כשהכדור לא בשימוש – אין אובייקט אחד שלו בזיכרון, ועדכון לכל פריים ≈ בדיקה אחת.
 *
 * חוזה קואורדינטות (שלב א' של המנוע הגלובלי: כדור / עיר / רחוב):
 *   WGS84 (lat, lon מעלות) ⇄ כדור: v = R·(cosλcosφ, sinφ, −sinλcosφ) — מסגרת three של SphereGeometry + מרקם equirect.
 *   הכדור עגול (R = 6371 ק"מ, יחידות ק"מ) — לתצוגה בלבד, לא למדידה. מדידה = ITM/WGS84 דרך js/itm.js (הלמרט 7 פרמטרים).
 *   ENU מקומי בנקודה: e = (−sinλ, 0, −cosλ), n = (−sinφcosλ, cosφ, sinφsinλ), u = v/|v|.
 *   רשת ישראל = מתאם: סצנה (x מזרח, z דרום) → toITM (מסגרת הדגימה) → +sampleOffset → ITM אמיתי → itmToWgs84 → כדור. ובחזרה.
 *
 * טקסטורות: mods/globe/ (מקור ורישיון – mods/globe/SOURCE.md). איכות חסכונית → 1k (127KB), אחרת 2k (450KB).
 * ?globe=1 – פותחים ישר בכדור (לבדיקות/צילומים). ?globe=0 – המודול כבוי.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, RE = 6371;   // ק"מ

  // ------------------------------------------------------------------ מתמטיקה טהורה (נבדקת ב-Node: twin/integration/tools/test-globe.js)
  const MATH = {
    RE_KM: RE,
    ll2v(lat, lon, r = 1) { const p = lat * D2R, l = lon * D2R; return [r * Math.cos(l) * Math.cos(p), r * Math.sin(p), -r * Math.sin(l) * Math.cos(p)]; },
    v2ll(x, y, z) { const r = Math.hypot(x, y, z); return { lat: Math.asin(Math.max(-1, Math.min(1, y / r))) * R2D, lon: Math.atan2(-z, x) * R2D, r }; },
    enu(lat, lon) { const p = lat * D2R, l = lon * D2R;
      return { e: [-Math.sin(l), 0, -Math.cos(l)], n: [-Math.sin(p) * Math.cos(l), Math.cos(p), Math.sin(p) * Math.sin(l)], u: [Math.cos(l) * Math.cos(p), Math.sin(p), -Math.sin(l) * Math.cos(p)] }; },
    gcKm(a, b) { const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;   // haversine על הכדור העגול
      const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * RE * Math.asin(Math.min(1, Math.sqrt(h))); },
    /** נקודת התת־שמש מתוך SIM.sunPosition (NOAA): רוחב = נטיית השמש; אורך = איפה שהשעה הסולרית האמיתית 12:00 */
    subsolar(date, SIM) { const s = SIM.sunPosition(date, 0, 0); const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
      let lon = (720 - utcMin - s.eot) / 4; lon = ((lon + 540) % 360 + 360) % 360 - 180; return { lat: s.declination, lon }; },
    /** קרן מול כדור ברדיוס R סביב הראשית → t הקרוב או null */
    raySphere(o, d, R) { const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - R * R, h = b * b - c; if (h < 0) return null; const t = -b - Math.sqrt(h); return t > 0 ? t : null; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MATH;
  if (!root.YZW || /[?&]globe=0\b/.test(root.location ? root.location.search : '')) return;

  const qs = new URLSearchParams(location.search);
  const ISRAEL = { lat: 31.4, lon: 35.0 };
  const ENTER_KM = 700, BACK_KM = 650, MIN_KM = 250;   // מרחקים מפני הקרקע (ק"מ); מבט הבית מחושב לפי יחס המסך
  const HOME = { lat: 25, lon: 31 };
  function homeKm() { const a = innerWidth / innerHeight, v = 42 * D2R / 2, h = Math.atan(Math.tan(v) * Math.min(1, a)); return RE / Math.sin(h * 0.9) - RE; }   // כל הכדור נכנס ברוחב המסך (טלפון לאורך: ~37 אלף ק"מ)
  const maxKm = () => homeKm() * 1.8;
  const S = { on: false, built: false, W: null, scene: null, cam: null, U: null, earth: null, objs: [], tex: [],
    C: { lat: ISRAEL.lat, lon: ISRAEL.lon, dist: 20000 }, fly: null, fade: { a: 0, b: 0, t: 1, dur: 0.3, cb: null },
    origin: null, ptr: new Map(), gest: null, intent: { wheel: 0, wheelT: 0, pinch0: 0, hold: 0 }, ui: {}, stats: { calls: 0, tris: 0, frames: 0, ms: 0, buildMs: 0 }, busy: false, labels: [] };
  const $ = id => document.getElementById(id);
  const dev = () => root.YZDev && root.YZDev.D;
  const eio = t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

  // ------------------------------------------------------------------ סצנה ⇄ WGS84 (רשת ישראל כמתאם)
  function sceneToLL(x, z) { const c = S.W.coords; if (!c.toITM || !c.itmToWgs84) return null; const s = c.toITM(x, z), o = c.sampleOffset || { dE: 0, dN: 0 }; return c.itmToWgs84(s.E + o.dE, s.N + o.dN); }
  function llToScene(lat, lon) { const c = S.W.coords; if (!c.wgs84ToItm || !c.fromRealITM) return null; const t = c.wgs84ToItm(lat, lon); return c.fromRealITM(t.E, t.N); }
  function inBounds(p) { const B = S.W.data && S.W.data.bounds; return !!(p && B && p.x >= B.minx && p.x <= B.maxx && p.z >= B.minz && p.z <= B.maxz); }

  // ------------------------------------------------------------------ בנייה (רק כשנכנסים) ושחרור (ביציאה)
  function labelSprite(text, color) {
    const cv = document.createElement('canvas'), dpr = 2, fs = 15 * dpr, ctx = cv.getContext('2d'), font = `700 ${fs}px Heebo,"Noto Sans Hebrew",system-ui,sans-serif`; ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width + 18 * dpr), h = Math.ceil(fs * 1.7); cv.width = w; cv.height = h;
    const c2 = cv.getContext('2d'); c2.font = font; c2.direction = 'rtl'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
    c2.fillStyle = 'rgba(8,12,22,.72)'; const r = h / 2; c2.beginPath(); c2.moveTo(r, 0); c2.lineTo(w - r, 0); c2.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); c2.lineTo(r, h); c2.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); c2.fill();
    c2.fillStyle = color; c2.fillText(text, w / 2, h / 2 + dpr);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; S.tex.push(t);
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthWrite: false, transparent: true }));
    m.userData.px = [w / dpr, h / dpr]; m.renderOrder = 5; return m;
  }
  function build(lowTier) {
    const t0 = performance.now(), T = THREE;
    const cv = document.createElement('canvas'); cv.id = 'yzGlobeCv'; cv.setAttribute('aria-label', 'כדור הארץ'); document.body.appendChild(cv);
    const R = new T.WebGLRenderer({ canvas: cv, antialias: false, alpha: false, powerPreference: 'high-performance' });
    R.setPixelRatio(S.W.renderer.getPixelRatio()); R.setSize(innerWidth, innerHeight, false); R.outputColorSpace = T.SRGBColorSpace; R.toneMapping = T.NoToneMapping;
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('wheel', onWheel, { passive: true }); S.R = R; S.cv = cv;
    const scene = new T.Scene(); scene.background = new T.Color(0x02040a);
    const cam = new T.PerspectiveCamera(42, 1, 10, 200000);
    const U = { day: { value: null }, night: { value: null }, sunDir: { value: new T.Vector3(1, 0, 0) }, camPos: { value: new T.Vector3() }, lightsGain: { value: 1.5 } };
    // shader של national-v1 (js/app.js) בלי שכבת הסקירה האזורית: יום/לילה, ברק ים, אורות עיר, רצועת שקיעה, שוליים כחולים, Reinhard
    const mat = new T.ShaderMaterial({ uniforms: U,
      vertexShader: 'varying vec3 vN; varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vN = normalize(position); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform sampler2D day, night; uniform vec3 sunDir, camPos; uniform float lightsGain; varying vec3 vN; varying vec2 vUv; varying vec3 vW;
        vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
        void main(){
          vec3 n = normalize(vN); float d = dot(n, sunDir);
          vec3 dc = toLin(texture2D(day, vUv).rgb), nc = toLin(texture2D(night, vUv).rgb);
          float dayF = smoothstep(-0.06, 0.10, d);
          float ocean = smoothstep(0.02, 0.10, dc.b - max(dc.r, dc.g));
          vec3 V = normalize(camPos - vW); vec3 R = reflect(-sunDir, n);
          float spec = pow(max(dot(R, V), 0.0), 60.0) * 0.6 * ocean;
          vec3 lit = dc * (0.03 + 1.15 * max(d, 0.0)) + vec3(1.0, 0.9, 0.75) * spec * dayF;
          float lights = max(nc.r + nc.g - 1.25 * nc.b, 0.0);
          vec3 nightCol = dc * 0.02 + vec3(1.0, 0.70, 0.36) * lights * 3.6 * lightsGain;
          vec3 col = mix(nightCol, lit, dayF);
          col += vec3(1.0, 0.42, 0.16) * 0.028 * exp(-pow(d / 0.025, 2.0)) * (1.0 - dayF * 0.5);
          float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          col += vec3(0.30, 0.55, 1.0) * rim * 0.35 * smoothstep(-0.25, 0.4, d);
          col = col / (1.0 + col);
          gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
        }` });
    const seg = lowTier ? [64, 32] : [96, 48];
    const earth = new T.Mesh(new T.SphereGeometry(RE, seg[0], seg[1]), mat); scene.add(earth);
    const atmo = new T.Mesh(new T.SphereGeometry(RE * 1.028, 64, 32), new T.ShaderMaterial({ uniforms: { sunDir: U.sunDir, camPos: U.camPos }, side: T.BackSide, transparent: true, blending: T.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform vec3 sunDir, camPos; varying vec3 vW;
        void main(){ vec3 V = normalize(vW - camPos); vec3 n = normalize(vW); float b = dot(V, -n);
          float a = pow(clamp(1.0 - abs(b) * 4.0, 0.0, 1.0), 2.2); float s = dot(n, sunDir);
          vec3 c = mix(vec3(1.0, 0.45, 0.2), vec3(0.35, 0.62, 1.0), smoothstep(-0.15, 0.3, s)) * smoothstep(-0.35, 0.05, s);
          gl_FragColor = vec4(c * a * 1.25, 1.0); }` }));
    scene.add(atmo);
    // כוכבים: שדה סינתטי (לא קטלוג!), זרע קבוע – קריאת ציור אחת
    { let sd = 27; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647; const n = 700, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), k = 0.25 + 0.75 * rnd() ** 3; p.set([s * Math.cos(th) * 150000, u * 150000, s * Math.sin(th) * 150000], i * 3); c.set([k, k, k * (0.9 + 0.2 * rnd())], i * 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3)); g.setAttribute('color', new T.BufferAttribute(c, 3));
      scene.add(new T.Points(g, new T.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }))); }
    // סימונים: ישראל + נקודת היציאה (אשדוד) — נקודות זוהרות + תוויות
    const o = S.origin, ptsG = new T.BufferGeometry();
    ptsG.setAttribute('position', new T.Float32BufferAttribute([...MATH.ll2v(ISRAEL.lat, ISRAEL.lon, RE * 1.002), ...MATH.ll2v(o.lat, o.lon, RE * 1.002)], 3));
    ptsG.setAttribute('color', new T.Float32BufferAttribute([0.55, 0.8, 1.0, 1.0, 0.78, 0.3], 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 32; { const c = dot.getContext('2d'); c.fillStyle = '#fff'; c.beginPath(); c.arc(16, 16, 11, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 4; c.stroke(); }
    const dt = new T.CanvasTexture(dot); S.tex.push(dt);
    const pts = new T.Points(ptsG, new T.PointsMaterial({ size: 11, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true, map: dt, alphaTest: 0.1 })); pts.renderOrder = 4; scene.add(pts);
    const lI = labelSprite('ישראל', '#cfe3ff'); lI.position.fromArray(MATH.ll2v(ISRAEL.lat + 1.2, ISRAEL.lon + 1.6, RE * 1.01)); lI.center.set(0, 0.5);
    const lA = labelSprite(o.name, '#ffd08a'); lA.position.fromArray(MATH.ll2v(o.lat, o.lon, RE * 1.01)); lA.center.set(1.08, 0.5);
    scene.add(lI, lA); S.labels = [lI, lA];
    // טקסטורות
    const dir = 'mods/globe/', sz = lowTier ? '1k' : '2k', L = new T.TextureLoader();
    const ld = (k, url) => L.load(url, t => { t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; U[k].value = t; t.needsUpdate = true; }, undefined, () => YZW.notice('🌍 טקסטורת כדור לא נטענה: ' + url, { ms: 3000 }));
    ld('day', dir + 'earth_day_' + sz + '.jpg'); ld('night', dir + 'earth_night_' + sz + '.jpg');
    S.stats.tex = sz;
    Object.assign(S, { scene, cam, U, earth, built: true }); S.stats.buildMs = Math.round(performance.now() - t0);
  }
  function teardown() {
    if (!S.built) return;
    S.scene.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) { for (const k of ['map']) if (n.material[k]) n.material[k].dispose(); n.material.dispose(); } });
    for (const k of ['day', 'night']) if (S.U[k].value) { S.U[k].value.dispose(); S.U[k].value = null; }
    for (const t of S.tex) t.dispose(); S.tex = []; S.labels = [];
    if (S.R) { S.cv.removeEventListener('pointerdown', onDown); S.cv.removeEventListener('wheel', onWheel); S.R.dispose(); try { S.R.forceContextLoss(); } catch (e) { /* */ } S.cv.remove(); }
    Object.assign(S, { scene: null, cam: null, U: null, earth: null, built: false, R: null, cv: null, size: null });
  }

  // ------------------------------------------------------------------ מצלמה, טיסה, ציור
  function placeCam() {
    const C = S.C, cam = S.cam, w = innerWidth, h = innerHeight;
    if (S.size !== w + 'x' + h) { S.size = w + 'x' + h; S.R.setSize(w, h, false); }
    const dir = MATH.ll2v(C.lat, C.lon, 1); cam.position.set(dir[0] * (RE + C.dist), dir[1] * (RE + C.dist), dir[2] * (RE + C.dist));
    cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
    cam.aspect = w / h; cam.near = Math.max(1, C.dist * 0.2); cam.far = C.dist + RE * 3 + 160000; cam.updateProjectionMatrix();
    S.U.camPos.value.copy(cam.position);
    const f = 1 / Math.tan(cam.fov * D2R / 2); for (const s of S.labels) { const [pw, ph] = s.userData.px; s.scale.set(pw * 2 / (f * h), ph * 2 / (f * h), 1); }
  }
  function flyTo(b, dur, cb) { const a = { lat: S.C.lat, lon: S.C.lon, dist: S.C.dist }; let dl = b.lon - a.lon; dl = ((dl + 540) % 360) - 180; S.fly = { a, b: { lat: b.lat, lon: a.lon + dl, dist: b.dist }, t: 0, dur, cb }; }
  function stepFly(dt) {
    const F = S.fly; if (!F) return; F.t = Math.min(1, F.t + dt / F.dur); const e = eio(F.t), la = Math.log(F.a.dist), lb = Math.log(F.b.dist), zin = lb < la;
    const ep = zin ? 1 - (1 - e) ** 2.2 : e ** 1.6;       // בהתקרבות: "נופלים" אל היעד; בהתרחקות: קודם עולים
    S.C.dist = Math.exp(la + (lb - la) * e); S.C.lat = F.a.lat + (F.b.lat - F.a.lat) * ep; S.C.lon = ((F.a.lon + (F.b.lon - F.a.lon) * ep + 540) % 360) - 180;
    if (F.t >= 1) { S.fly = null; F.cb && F.cb(); }
  }
  function fadeTo(b, dur, cb) { const el = S.ui.fade; S.fade = { a: el ? +el.style.opacity || 0 : 0, b, t: 0, dur, cb }; }
  function stepFade(dt) { const F = S.fade; if (F.t >= 1) return; F.t = Math.min(1, F.t + dt / F.dur); const v = F.a + (F.b - F.a) * F.t; if (S.ui.fade) { S.ui.fade.style.opacity = v.toFixed(3); S.ui.fade.style.display = v > 0.002 ? 'block' : 'none'; } if (F.t >= 1 && F.cb) { const cb = F.cb; F.cb = null; cb(); } }
  function draw() {
    const W = S.W, r = S.R, t0 = performance.now();
    const ss = MATH.subsolar(W.clock.date || new Date(), W.G27.SIM); S.U.sunDir.value.fromArray(MATH.ll2v(ss.lat, ss.lon, 1)); S.sub = ss;
    placeCam();
    r.render(S.scene, S.cam);
    S.stats.calls = r.info.render.calls; S.stats.tris = r.info.render.triangles; S.stats.geoms = r.info.memory.geometries; S.stats.texs = r.info.memory.textures; S.stats.frames++;
    S.stats.ms += (performance.now() - t0 - S.stats.ms) * 0.1;
  }

  // ------------------------------------------------------------------ מעברים
  function enterGlobe() {
    if (S.busy || S.on) return; const W = S.W, D = dev();
    const x = D && D.on ? D.tx : W.player.pos.x, z = D && D.on ? D.tz : W.player.pos.z, ll = sceneToLL(x, z);
    if (!ll) { YZW.notice('🌍 אין המרת קואורדינטות (itm.js) – הכדור לא זמין', { ms: 2500 }); return; }
    S.origin = { x, z, y: Math.max(0, W.data.H(x, z)), lat: ll.lat, lon: ll.lon, name: 'אשדוד' };
    S.busy = true; fadeTo(1, 0.25, () => { S.busy = false; if (!YZW.setMode('globe', false, { x, y: S.origin.y, z })) fadeTo(0, 0.3); });
  }
  function landAt(p) {   // p = {x,z,lat,lon} בתוך העולם
    if (S.busy || !S.on) return; S.busy = true; S.target = p;
    flyTo({ lat: p.lat, lon: p.lon, dist: ENTER_KM }, 2.6, () => fadeTo(1, 0.3, () => {
      const W = S.W, card = $('card'), cardWas = card && card.style.display === 'block';
      S.busy = false; YZW.setMode('dev', false, { x: p.x, y: Math.max(0, W.data.H(p.x, p.z)), z: p.z });
      const D = dev(); if (D && D.on) { D.dist = 6000; D.fly = { a: { x: p.x, z: p.z, d: 6000 }, b: { x: p.x, z: p.z, d: 1100 }, t: 0 }; }
      if (card && !cardWas && card.style.display === 'block') card.style.display = 'none';
      fadeTo(0, 0.7);
    }));
  }
  function backToCity() { const o = S.origin; if (o) landAt(o); }

  // ------------------------------------------------------------------ קלט בכדור: גרירה = סיבוב, צביטה/גלגלת = זום, הקשה = בחירה
  function kmPerPx() { const h = innerHeight; return S.C.dist * 2 * Math.tan(21 * D2R) / h; }
  function rotateBy(dx, dy) { const k = kmPerPx() / 111.2; S.C.lat = Math.max(-80, Math.min(80, S.C.lat + dy * k)); S.C.lon -= dx * k / Math.max(0.2, Math.cos(S.C.lat * D2R)); S.C.lon = ((S.C.lon + 540) % 360) - 180; }
  function zoomBy(f) { if (S.busy) return; S.fly = null; S.C.dist = Math.max(MIN_KM, Math.min(maxKm(), S.C.dist * f)); if (S.C.dist < BACK_KM) backToCity(); }
  function tap(cx, cy) {
    const cv = S.cv, r = cv.getBoundingClientRect(), cam = S.cam; if (!cam) return;
    const v = new THREE.Vector3((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    const o = cam.position.toArray(), d = v.toArray(), t = MATH.raySphere(o, d, RE); if (t == null) return;
    const ll = MATH.v2ll(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
    const p = llToScene(ll.lat, ll.lon);
    if (p && inBounds(p)) { landAt({ x: p.x, z: p.z, lat: ll.lat, lon: ll.lon }); return; }
    if (MATH.gcKm(ll, S.origin) < 450) { backToCity(); return; }
    YZW.notice('🌍 כאן עדיין אין עולם תלת־ממד — הקישו על ישראל או צבטו פנימה', { kind: 'info', ms: 2400 });
  }
  function onDown(e) { if (!S.on) return; S.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() }); if (S.ptr.size === 2) { const [a, b] = [...S.ptr.values()]; S.gest = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: S.C.dist }; } }
  function onMove(e) { if (!S.on) return; const p = S.ptr.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (S.ptr.size === 1 && !S.busy) { S.fly = null; rotateBy(dx, dy); }
    else if (S.ptr.size === 2 && S.gest) { const [a, b] = [...S.ptr.values()], d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)); if (!S.busy) { S.fly = null; S.C.dist = Math.max(MIN_KM, Math.min(maxKm(), S.gest.dist * S.gest.d / d)); if (S.C.dist < BACK_KM) backToCity(); } } }
  function onUp(e) { if (!S.on) return; const p = S.ptr.get(e.pointerId); S.ptr.delete(e.pointerId); if (S.ptr.size < 2) S.gest = null;
    if (p && S.ptr.size === 0 && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 10 && performance.now() - p.t < 450 && !S.busy) tap(e.clientX, e.clientY); }
  function onWheel(e) {
    const D = dev();
    if (S.on) { zoomBy(e.deltaY > 0 ? 1.15 : 0.87); return; }
    if (D && D.on && e.deltaY > 0 && D.dist >= 5900) { const now = performance.now(); S.intent.wheel = now - S.intent.wheelT < 900 ? S.intent.wheel + 1 : 1; S.intent.wheelT = now; if (S.intent.wheel >= 3) { S.intent.wheel = 0; enterGlobe(); } }
  }
  function onTouchMove(e) {   // בעין הגדולה, בתקרה: צביטה החוצה נוספת של 25% → כדור
    const D = dev(); if (S.on || !D || !D.on || e.touches.length !== 2) { S.intent.pinch0 = 0; return; }
    const a = e.touches[0], b = e.touches[1], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (D.dist < 5900) { S.intent.pinch0 = 0; return; } if (!S.intent.pinch0) S.intent.pinch0 = d; else if (d < S.intent.pinch0 * 0.75) { S.intent.pinch0 = 0; enterGlobe(); }
  }
  function onTouchEnd() { S.intent.pinch0 = 0; }

  // ------------------------------------------------------------------ ממשק
  function ui() {
    const st = document.createElement('style'); st.textContent = `#yzGlobeB{position:fixed;z-index:13;left:8px;top:calc(env(safe-area-inset-top) + 180px);font-weight:700;font-size:13px;padding:6px 10px;min-height:36px;display:none}
body[data-yz-mode=dev] #yzGlobeB,body[data-yz-mode=globe] #yzGlobeB{display:block}
#yzGlobeCv{position:fixed;inset:0;width:100vw;height:100vh;z-index:10;display:block;touch-action:none}
#yzGlobeFade{position:fixed;inset:0;z-index:11;background:#02040a;opacity:0;display:none;pointer-events:none}
#yzGlobeInfo{position:fixed;z-index:12;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom) + 10px);max-width:440px;margin:0 auto;background:rgba(10,14,24,.72);border:1px solid #ffffff1f;border-radius:14px;padding:7px 11px;color:#eef3f8;font-size:12px;direction:rtl;display:none;backdrop-filter:blur(8px)}
body[data-yz-mode=globe] #yzGlobeInfo{display:block}
#yzGlobeInfo b{font-size:14px}#yzGlobeInfo .m{color:#9aa6b6;font-size:11px;margin-top:2px}#yzGlobeInfo .a{color:#7d8a9a;font-size:10px;margin-top:3px}
#yzGlobeZ{position:fixed;z-index:12;left:8px;top:calc(env(safe-area-inset-top) + 224px);display:none;flex-direction:column;gap:6px}
body[data-yz-mode=globe] #yzGlobeZ{display:flex}#yzGlobeZ .btn{width:42px;height:42px;padding:0;font-size:20px}`;
    document.head.appendChild(st); S.ui.style = st;
    const b = document.createElement('button'); b.id = 'yzGlobeB'; b.className = 'btn'; b.setAttribute('aria-label', 'כדור הארץ או חזרה לעיר');
    b.onclick = () => { if (S.on) backToCity(); else enterGlobe(); }; document.body.appendChild(b); S.ui.btn = b;
    const f = document.createElement('div'); f.id = 'yzGlobeFade'; document.body.appendChild(f); S.ui.fade = f;
    const i = document.createElement('div'); i.id = 'yzGlobeInfo'; i.setAttribute('role', 'status'); document.body.appendChild(i); S.ui.info = i;
    const z = document.createElement('div'); z.id = 'yzGlobeZ'; z.innerHTML = '<button class="btn" aria-label="התקרבות">＋</button><button class="btn" aria-label="התרחקות">−</button>';
    z.children[0].onclick = () => zoomBy(0.6); z.children[1].onclick = () => zoomBy(1.6); document.body.appendChild(z); S.ui.zoom = z;
    label();
  }
  function label() { if (S.ui.btn) S.ui.btn.textContent = S.on ? '🏙 לעיר' : '🌍 כדור'; }
  let infoT = 0;
  function info(dt) {
    infoT -= dt; if (infoT > 0 || !S.ui.info) return; infoT = 0.5; const W = S.W, d = W.clock.date || new Date();
    const hm = d.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }), el = W.sun.elevation;
    const km = S.C.dist >= 10000 ? Math.round(S.C.dist).toLocaleString('he-IL') : S.C.dist.toFixed(0);
    S.ui.info.innerHTML = `<b>🌍 כדור הארץ</b> · ${hm} בישראל · ${el > 0 ? 'יום' : el > -6 ? 'דמדומים' : 'לילה'} באשדוד · גובה ${km} ק״מ`
      + '<div class="m">גרירה = סיבוב · צביטה = זום · הקשה על ישראל = נחיתה בעיר</div><div class="a">כדור הארץ: תצלומי נאס״א (Blue Marble / Black Marble) · יום/לילה לפי השעון של העולם</div>';
  }

  // ------------------------------------------------------------------ רישום
  root.YZGlobe = { S, MATH, enter: enterGlobe, back: backToCity, landAt, stats: () => Object.assign({ on: S.on, dist: S.C.dist, lat: S.C.lat, lon: S.C.lon, sub: S.sub }, S.stats) };
  YZW.register({
    id: 'globe', name: 'כדור הארץ → ישראל → העיר (קומה 1 של המנוע הגלובלי)', dept: 'globe (גדוד בנייה – כדור הארץ)', order: 67, provides: ['globe'],
    requires: () => !!(window.THREE && THREE.WebGLRenderer && window.YZW),
    init(world) {
      S.W = world; ui();
      const cv = world.renderer.domElement;
      addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
      cv.addEventListener('wheel', onWheel, { passive: true }); cv.addEventListener('touchmove', onTouchMove, { passive: true }); cv.addEventListener('touchend', onTouchEnd, { passive: true });
      if (qs.get('globe') === '1') { const t0 = performance.now(), iv = setInterval(() => { if (world.stats.startMs && YZW.mode && YZW.ready) { clearInterval(iv); setTimeout(() => { if (YZW.mode() !== 'dev') YZW.setMode('dev'); setTimeout(enterGlobe, 300); }, 400); } else if (performance.now() - t0 > 30000) clearInterval(iv); }, 100); }
    },
    update(dt, world) {
      stepFade(dt);
      if (S.on && S.built) { stepFly(dt); draw(); info(dt); return; }
      const D = dev(); // ▼ בעין הגדולה כשכבר בתקרה, החזקה של חצי שנייה → כדור
      if (D && D.on && D.dist >= 5950 && !S.busy) { const inp = YZW.readInput(); S.intent.hold = inp.down ? S.intent.hold + dt : 0; if (S.intent.hold > 0.5) { S.intent.hold = 0; enterGlobe(); } }
    },
    dispose(world) {
      const cv = world.renderer.domElement; removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
      cv.removeEventListener('wheel', onWheel); cv.removeEventListener('touchmove', onTouchMove); cv.removeEventListener('touchend', onTouchEnd);
      S.on = false; teardown(); for (const k of ['btn', 'fade', 'info', 'zoom', 'style']) if (S.ui[k]) S.ui[k].remove(); S.ui = {};
    },
    modes: [{
      id: 'globe', name: 'כדור הארץ', icon: '🌍', sub: 'כדור → ישראל → עיר', kind: 'overlay', group: 'dev',
      enter(world, from, pos) {
        if (!S.origin) { const ll = sceneToLL(pos.x, pos.z); if (!ll) throw new Error('אין המרת קואורדינטות'); S.origin = { x: pos.x, z: pos.z, y: pos.y || 0, lat: ll.lat, lon: ll.lon, name: 'אשדוד' }; }
        build(world.quality.tier === 'low'); S.on = true; S.ptr.clear(); S.gest = null;
        S.C = { lat: S.origin.lat, lon: S.origin.lon, dist: ENTER_KM };
        flyTo({ lat: HOME.lat, lon: HOME.lon, dist: homeKm() }, 2.8);
        fadeTo(0, 0.6); label(); infoT = 0;
      },
      exit() { S.on = false; S.fly = null; S.busy = false; teardown(); S.origin = null; label(); },
      update(dt, world) { const o = S.origin || world.player.pos; return { x: o.x, y: o.y || 0, z: o.z, speed: 0 }; },
    }],
  });
})(typeof window !== 'undefined' ? window : globalThis);
