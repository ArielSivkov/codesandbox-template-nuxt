/* 27wrld · אשדוד — game.js
   מצבים: רגלי / רכב / מסוק / תרמיל סילון. מגע (ג'ויסטיק + כפתורים) ומקלדת.
   "הנכסים שלי": הקשה/התקרבות לבניין → כרטיס, סימון כנכס (localStorage, זוהר), הצעה בלוח היזם (#pre).
   "האתר שלך כמקום": בניין עסק לדוגמה עם שלט, כניסה לחדר עם מסך. */
(function () {
'use strict';
const T = window.THREE, W = window.W27;
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const fmt = (n, d) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('he-IL', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (!TOUCH) document.body.classList.add('desk');

// ---------- קבועים
const SPAWN_ITM = { E: 165120, N: 633640 };            // שדרות הרצל, אשדוד
const BIZ = { id: (() => { try { return localStorage.getItem('w27.bizId') || ''; } catch (e) { return ''; } })(), name: 'אריאל שיפוצים', sub: 'שיפוצים · בנייה · ESH27', url: 'https://esh27.com/', color: '#f2b84b' };
const YAZAM = 'https://yazam.esh27.com/#pre=';
const OPEN = 0.2; // חלק החזית שהוא פתחים – כמו במפת לוח היזם
const TYPE_HE = { '': 'לא מסווג', apartments: 'בניין דירות', residential: 'מגורים', house: 'בית', detached: 'בית צמוד קרקע', semidetached_house: 'דו־משפחתי', roof: 'גגון', commercial: 'מסחרי', retail: 'קמעונאות', industrial: 'תעשייה', warehouse: 'מחסן', school: 'בית ספר', kindergarten: 'גן ילדים', university: 'אקדמיה', college: 'מכללה', public: 'ציבורי', civic: 'מבנה עירוני', synagogue: 'בית כנסת', townhall: 'בניין עירייה', hospital: 'בית חולים', office: 'משרדים', construction: 'בבנייה', hotel: 'מלון', train_station: 'תחנת רכבת', manufacture: 'ייצור', sports_centre: 'מרכז ספורט', cowshed: 'רפת' };
const SRC_HE = { M: 'נמדד/אושר בשטח', O: 'מודל תלת־ממד רשמי', H: 'גובה מ-OSM', L: 'קומות מ-OSM', V: 'Overture', S: 'צילום חזית + AI', P: 'תב"ע מאושרת', G: 'GlobalBuildingAtlas', F: '3D-GloBFP', D: 'מודל פני שטח', B: 'GHSL', N: 'בניינים שכנים', R: 'כלל אצבע' };
const CONF_HE = [['מאומת', 'ok'], ['גבוה', 'ok'], ['בינוני', 'mid'], ['נמוך', 'low']];
const MODES = ['foot', 'car', 'heli', 'jet', 'drone'];
const MODE_UI = { foot: ['🚶', 'רגלי'], car: ['🚗', 'רכב'], heli: ['🚁', 'מסוק'], jet: ['🎒', 'תרמיל סילון'], drone: ['🛸', 'רחפן'] };

// ---------- רנדרר
const cv = $('cv');
const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', stencil: false });
const Q = { pr: Math.min(window.devicePixelRatio || 1, TOUCH ? 1.25 : 1.5), auto: true, level: 0 };
renderer.setPixelRatio(Q.pr);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
const scene = new T.Scene();
const SKY_H = new T.Color(0xcfe0ec), SKY_T = new T.Color(0x3d7fc4);
scene.fog = new T.Fog(SKY_H.getHex(), 350, 1150);
scene.background = SKY_H.clone();
const camera = new T.PerspectiveCamera(62, 1, 0.3, 2600);
// שמיים: כיפה עם מעבר צבע + שמש + שכבת עננים פרוצדורלית (זול)
const sunDir = new T.Vector3(-0.62, 0.55, 0.56).normalize();
const skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: SKY_T.clone() }, hor: { value: SKY_H.clone() }, sun: { value: sunDir }, cloud: { value: 0.2 }, time: { value: 0 }, sunVis: { value: 1 } },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w*0.9999; }',
  fragmentShader: `uniform vec3 top,hor,sun; uniform float cloud,time,sunVis; varying vec3 vD;
float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hs(i),hs(i+vec2(1,0)),f.x), mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x), f.y); }
void main(){ vec3 d = normalize(vD); float h = clamp(d.y,0.0,1.0); vec3 c = mix(hor, top, pow(h,0.55));
  float s = max(dot(d, sun),0.0); c += vec3(1.0,0.86,0.6)*(pow(s,600.0)*2.5 + pow(s,8.0)*0.18)*sunVis;
  if (d.y > 0.02) { vec2 uv = d.xz / (d.y + 0.15) * 1.6 + vec2(time*0.004, time*0.002);
    float n = vn(uv)*0.5 + vn(uv*2.1)*0.3 + vn(uv*4.3)*0.2; float cv = smoothstep(1.0 - cloud*0.95 - 0.05, 1.05 - cloud*0.6, n) * smoothstep(0.02, 0.2, d.y);
    vec3 cc = mix(vec3(1.0), vec3(0.62,0.65,0.7), cloud) * (0.35 + 0.65*clamp(sun.y*3.0+0.2,0.0,1.0)); c = mix(c, cc, cv*0.92); }
  if(d.y<0.0) c = hor; gl_FragColor = vec4(c,1.0);
#include <colorspace_fragment>
}` });
const sky = new T.Mesh(new T.SphereGeometry(2000, 24, 12), skyMat); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
const hemi = new T.HemisphereLight(0xdcecff, 0xa08f70, 1.1); scene.add(hemi);
const sun = new T.DirectionalLight(0xfff1dc, 2.0); sun.position.copy(sunDir).multiplyScalar(100); scene.add(sun); scene.add(sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
{ const sc = sun.shadow.camera; sc.left = sc.bottom = -85; sc.right = sc.top = 85; sc.near = 1; sc.far = 900; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; }
// ---------- שמש אמיתית + מזג אוויר
const LAT = 31.8014, LON = 34.6435;                    // אשדוד (מרכז העיר, WGS84)
const GAMMA = SIM.itmConvergence(LAT, LON);           // ≈ −0.29°: הפרש צפון רשת/צפון אמיתי
const ENV = { date: null, sun: null, live: /[?&]live=1/.test(location.search) };
{ const now = new Date(), off = SIM.israelOffsetMin(now); const il = new Date(now.getTime() + off * 60000); // תאריך היום בשעון ישראל, 14:00
  ENV.date = new Date(Date.UTC(il.getUTCFullYear(), il.getUTCMonth(), il.getUTCDate(), 14, 0) - off * 60000); }
const _skyDay = new T.Color(0x3d7fc4), _horDay = new T.Color(0xcfe0ec), _skyN = new T.Color(0x0a1426), _horN = new T.Color(0x1b2638), _horSet = new T.Color(0xf0b27a), _grey = new T.Color(0x9aa4ae), _tc = new T.Color();
function applyEnv() {
  const sp = SIM.sunPosition(ENV.date, LAT, LON); ENV.sun = sp; const v = SIM.sunVector(sp, GAMMA);
  sunDir.set(v.x, v.y, v.z).normalize();
  const el = sp.elevation, day = clamp((el + 4) / 14, 0, 1), set = clamp(1 - Math.abs(el - 2) / 10, 0, 1) * (el > -4 ? 1 : 0);
  const cf = SIM.cloudFactor(SIM.weather.cloud), cl = SIM.weather.cloud;
  const top = _tc.copy(_skyN).lerp(_skyDay, day); top.lerp(_grey, cl * 0.7 * day); skyMat.uniforms.top.value.copy(top);
  const hor = new T.Color().copy(_horN).lerp(_horDay, day).lerp(_horSet, set * 0.55 * (1 - cl)); hor.lerp(_grey, cl * 0.5 * day);
  if (SIM.weather.rain > 0) hor.lerp(new T.Color(0x8b939b), Math.min(0.6, SIM.weather.rain / 8));
  skyMat.uniforms.hor.value.copy(hor); scene.fog.color.copy(hor); scene.background.copy(hor);
  skyMat.uniforms.cloud.value = cl; skyMat.uniforms.sunVis.value = (1 - cl * 0.85) * (el > -1 ? 1 : 0);
  const direct = Math.max(0, Math.sin(Math.max(0, el) * Math.PI / 180)) ** 0.6 * cf;
  sun.intensity = 2.4 * direct; sun.color.setHSL(0.09, 0.55, 0.62 + 0.3 * clamp(el / 30, 0, 1));
  hemi.intensity = 0.18 + 1.0 * day * (0.75 + 0.25 * cl);
  sun.castShadow = Q.level < 2 && el > 1 && cf > 0.3;
  W.MAT && W.MAT.sea && W.MAT.sea.color.setHex(day > 0.5 ? 0x2a6f93 : 0x10263a);
  rainSetup();
}

// ---------- מצב
const S = {
  mode: 'foot', t: 0, started: false,
  p: new T.Vector3(), vy: 0, heading: 0, speed: 0, grounded: true, fuel: 1,
  car: { x: 0, z: 0, y: 0, h: 0, v: 0, steer: 0, pitch: 0, roll: 0 },
  heli: { x: 0, z: 0, y: 0, h: 0, v: 0, vy: 0, tilt: 0, bank: 0, rotor: 0 },
  cam: { yaw: 0, pitch: 0.32, dist: 6, lastDrag: -10, x: 0, y: 0, z: 0 },
  inside: null, drone: SIM.newDrone(0, 0, 0, 0),
  near: null, nearBiz: false, nearOwned: null,
};
const input = { x: 0, y: 0, up: false, down: false, sprint: false, act: false, keys: new Set(), joy: false, override: null };
const mine = new Map(JSON.parse(localStorage.getItem('w27.mine') || '[]').map(o => [o.id, o]));
function saveMine() { localStorage.setItem('w27.mine', JSON.stringify([...mine.values()])); $('nMine').textContent = mine.size; }
$('nMine').textContent = mine.size;

const SIMW = { H: (x, z) => W.H(x, z), near: (x, z, r) => W.near(x, z, r), edge: (b, x, z) => W.edgeDist(b, x, z), collide: (x, z, r, a, b) => W.collide(x, z, r, a, b), floor: (x, z, y) => W.floorAt(x, z, y) };
const windHere = { x: 0, y: 0, z: 0, speed: 0 };
// ---------- דמות (Quaternius UBC + UAL, כמו באש 5), עם דמות זמנית עד שנטען
const player = new T.Group(); player.name = 'player'; scene.add(player);
const ph = new T.Group(); // placeholder
{ const body = new T.Mesh(new T.CapsuleGeometry(0.28, 0.9, 4, 10), new T.MeshLambertMaterial({ color: 0x2f6db5 })); body.position.y = 0.85; ph.add(body);
  const head = new T.Mesh(new T.SphereGeometry(0.2, 12, 8), new T.MeshLambertMaterial({ color: 0xe0b48c })); head.position.y = 1.62; ph.add(head); }
player.add(ph);
const jetpack = new T.Group();
{ const tank = new T.MeshLambertMaterial({ color: 0x8a96a3 }), red = new T.MeshLambertMaterial({ color: 0xc0392b });
  for (const sx of [-0.13, 0.13]) { const c = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.55, 10), sx < 0 ? tank : red); c.position.set(sx, 1.18, -0.22); jetpack.add(c); }
  const fl = new T.Mesh(new T.ConeGeometry(0.09, 0.6, 8), new T.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false }));
  fl.rotation.x = Math.PI; fl.position.set(0, 0.62, -0.22); fl.name = 'flame'; jetpack.add(fl);
  const fl2 = fl.clone(); fl2.position.x = 0.13; fl.position.x = -0.13; jetpack.add(fl2); jetpack.userData.fl = [fl, fl2]; }
jetpack.visible = false; player.add(jetpack);
const blob = new T.Mesh(new T.CircleGeometry(0.5, 16), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; blob.renderOrder = 3; scene.add(blob);
const AN = { mixer: null, acts: {}, cur: null, model: null };
function playAnim(name, fade) {
  if (!AN.mixer || AN.cur === name || !AN.acts[name]) return;
  const a = AN.acts[name], prev = AN.cur && AN.acts[AN.cur];
  a.reset().setEffectiveWeight(1).fadeIn(fade || 0.2).play(); if (prev) prev.fadeOut(fade || 0.2); AN.cur = name;
}
function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.appendChild(s); }); }
// בגדים: הגוף הבסיסי של Quaternius הוא בבגד ים – צובעים מכנסי ג'ינס, חולצת עבודה ונעליים לפי גובה במרחב ה-bind
function clothes(mesh) {
  // צירים מהשלד (כמו באש 5): מעלה = אגן→ראש, צד = ירך ימין→שמאל, במרחב ה-bind של הגוף
  const B = {}; for (const b of mesh.skeleton.bones) B[b.name] = b; const loc = b => new T.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(mesh.bindMatrixInverse);
  const pel = loc(B.pelvis), up = loc(B.Head).sub(pel).normalize(), side = loc(B.thigh_l).sub(loc(B.thigh_r)); side.addScaledVector(up, -side.dot(up)).normalize();
  const pa = mesh.geometry.attributes.position, v = new T.Vector3(); let lo = 1e9, hi = -1e9; for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); const h = v.dot(up); if (h < lo) lo = h; if (h > hi) hi = h; }
  const m = mesh.material.clone(); const U = { uUp: { value: up }, uSide: { value: side }, uLo: { value: lo }, uH: { value: hi - lo }, uMid: { value: pel.dot(side) } };
  m.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vB;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvB = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vB; uniform vec3 uUp, uSide; uniform float uLo, uH, uMid;')
      .replace('#include <map_fragment>', `#include <map_fragment>
{ float h = (dot(vB, uUp) - uLo) / uH; float s = abs(dot(vB, uSide) - uMid) / uH;
  float L = dot(diffuseColor.rgb, vec3(0.3,0.59,0.11)); float n = 0.85 + 0.3 * L;
  if (h < 0.045) diffuseColor.rgb = vec3(0.12,0.11,0.10);
  else if (h < 0.475 && s < 0.2) diffuseColor.rgb = vec3(0.16,0.25,0.42) * n;
  else if (h < 0.815 && (s < 0.125 || (h > 0.66 && s < 0.21))) diffuseColor.rgb = vec3(0.86,0.50,0.20) * n; }`); };
  m.customProgramCacheKey = () => 'w27_clothes'; return m;
}
async function loadCharacter() {
  try {
    if (!window.ESH_GLTF) await loadScript('vendor/loaders.js');
    const G = window.ESH_GLTF; const L = new G.GLTFLoader(); L.setMeshoptDecoder(G.MeshoptDecoder);
    const [m, a] = await Promise.all([L.loadAsync('assets/ubc_male.glb'), L.loadAsync('assets/ual_anims.glb')]);
    const root = m.scene; root.updateMatrixWorld(true); const box = new T.Box3().setFromObject(root); const h = box.max.y - box.min.y; const s = 1.78 / h;
    root.scale.setScalar(s); root.position.y = -box.min.y * s;
    root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; if (o.material && /Superhero/i.test(o.material.name)) o.material = clothes(o); } });
    AN.model = root; player.add(root); player.remove(ph);
    AN.mixer = new T.AnimationMixer(root);
    for (const c of a.animations) { // בלי תנועת שורש אופקית (המשחק מזיז את הדמות)
      c.tracks = c.tracks.filter(tr => !(/^(root|pelvis)\.position$/.test(tr.name) && /Loop/.test(c.name) && false));
      AN.acts[c.name] = AN.mixer.clipAction(c); }
    playAnim('Idle_Loop', 0);
  } catch (e) { console.warn('character', e); }
}

// ---------- רכבים פרוצדורליים
function mkCar() {
  const g = new T.Group(), paint = new T.MeshLambertMaterial({ color: 0xd2342c }), dark = new T.MeshLambertMaterial({ color: 0x1b2128 }), glass = new T.MeshLambertMaterial({ color: 0x27394a }), lightM = new T.MeshBasicMaterial({ color: 0xfff4c8 }), rear = new T.MeshBasicMaterial({ color: 0xff3030 });
  const body = new T.Mesh(new T.BoxGeometry(1.9, 0.62, 4.4), paint); body.position.y = 0.62; g.add(body);
  const cab = new T.Mesh(new T.BoxGeometry(1.66, 0.55, 2.2), glass); cab.position.set(0, 1.2, -0.25); g.add(cab);
  const roof = new T.Mesh(new T.BoxGeometry(1.6, 0.08, 1.9), paint); roof.position.set(0, 1.5, -0.3); g.add(roof);
  for (const sx of [-0.7, 0.7]) { const l = new T.Mesh(new T.BoxGeometry(0.4, 0.15, 0.05), lightM); l.position.set(sx, 0.72, 2.21); g.add(l); const r = new T.Mesh(new T.BoxGeometry(0.4, 0.15, 0.05), rear); r.position.set(sx, 0.72, -2.21); g.add(r); }
  const wg = new T.CylinderGeometry(0.36, 0.36, 0.28, 14); wg.rotateZ(Math.PI / 2); g.userData.wheels = [];
  for (const [x, z] of [[-0.92, 1.35], [0.92, 1.35], [-0.92, -1.35], [0.92, -1.35]]) { const w = new T.Mesh(wg, dark); w.position.set(x, 0.36, z); g.add(w); g.userData.wheels.push(w); }
  const sh = new T.Mesh(new T.PlaneGeometry(2.3, 4.9), new T.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.06; g.add(sh);
  return g;
}
function mkHeli() {
  const g = new T.Group(), paint = new T.MeshLambertMaterial({ color: 0xf2b84b }), dark = new T.MeshLambertMaterial({ color: 0x23282e }), glass = new T.MeshLambertMaterial({ color: 0x2b4459 });
  const body = new T.Mesh(new T.SphereGeometry(1.3, 16, 12), paint); body.scale.set(1, 0.95, 1.7); body.position.y = 1.6; g.add(body);
  const win = new T.Mesh(new T.SphereGeometry(1.0, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), glass); win.rotation.x = Math.PI / 2.3; win.position.set(0, 1.9, 1.2); win.scale.set(1.1, 1, 1); g.add(win);
  const tail = new T.Mesh(new T.CylinderGeometry(0.16, 0.42, 5, 8), paint); tail.rotation.x = Math.PI / 2; tail.position.set(0, 1.9, -4.2); g.add(tail);
  const fin = new T.Mesh(new T.BoxGeometry(0.1, 1.3, 0.8), paint); fin.position.set(0, 2.5, -6.5); g.add(fin);
  for (const sx of [-0.9, 0.9]) { const sk = new T.Mesh(new T.BoxGeometry(0.12, 0.12, 3.6), dark); sk.position.set(sx, 0.1, 0.1); g.add(sk); const st = new T.Mesh(new T.BoxGeometry(0.1, 0.8, 0.1), dark); st.position.set(sx * 0.8, 0.5, 0.6); g.add(st); const st2 = st.clone(); st2.position.z = -0.6; g.add(st2); }
  const mast = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.6, 8), dark); mast.position.y = 3.1; g.add(mast);
  const rotor = new T.Group(); rotor.position.y = 3.4; for (let i = 0; i < 2; i++) { const b = new T.Mesh(new T.BoxGeometry(10.5, 0.05, 0.32), dark); b.rotation.y = i * Math.PI / 2; rotor.add(b); } g.add(rotor);
  const disc = new T.Mesh(new T.CircleGeometry(5.2, 24), new T.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false, side: T.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.y = 3.38; g.add(disc);
  const tr = new T.Group(); tr.position.set(0.15, 2.6, -6.6); const tb = new T.Mesh(new T.BoxGeometry(0.05, 1.4, 0.12), dark); tr.add(tb); g.add(tr);
  g.userData = { rotor, tr, disc };
  return g;
}
function mkDrone() {
  const g = new T.Group(), body = new T.MeshLambertMaterial({ color: 0x2b2f36 }), acc = new T.MeshLambertMaterial({ color: 0xf2b84b }), prop = new T.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, depthWrite: false, side: T.DoubleSide });
  const b = new T.Mesh(new T.BoxGeometry(0.16, 0.07, 0.24), body); b.position.y = 0.1; g.add(b);
  const cam = new T.Mesh(new T.SphereGeometry(0.035, 8, 6), acc); cam.position.set(0, 0.07, 0.13); g.add(cam);
  g.userData.props = [];
  for (const [x, z] of [[0.17, 0.17], [-0.17, 0.17], [0.17, -0.17], [-0.17, -0.17]]) {
    const arm = new T.Mesh(new T.BoxGeometry(0.02, 0.02, 0.24), body); arm.position.set(x / 2, 0.11, z / 2); arm.rotation.y = Math.atan2(x, z); g.add(arm);
    const m = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.04, 6), acc); m.position.set(x, 0.12, z); g.add(m);
    const pr = new T.Mesh(new T.CircleGeometry(0.11, 14), prop); pr.rotation.x = -Math.PI / 2; pr.position.set(x, 0.145, z); g.add(pr); g.userData.props.push(pr);
    const leg = new T.Mesh(new T.BoxGeometry(0.015, 0.09, 0.015), body); leg.position.set(x * 0.5, 0.045, z * 0.5); g.add(leg); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
const drone = mkDrone(); drone.visible = false; scene.add(drone);
const car = mkCar(); car.visible = false; scene.add(car);
const heli = mkHeli(); heli.visible = false; scene.add(heli);
car.traverse(o => { if (o.isMesh && o.geometry.type !== 'PlaneGeometry') o.castShadow = true; }); heli.traverse(o => { if (o.isMesh && o.geometry.type !== 'CircleGeometry') o.castShadow = true; });
const heliShadow = new T.Mesh(new T.CircleGeometry(3, 20), new T.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.25, depthWrite: false })); heliShadow.rotation.x = -Math.PI / 2; heliShadow.visible = false; scene.add(heliShadow);

// ---------- מצבים
function setMode(m) {
  if (S.inside) return;
  const prev = S.mode; if (m === prev) return;
  const p = curPos();
  // יציאה מרכב/מסוק: הדמות לצד הרכב
  if (prev === 'car' || prev === 'heli') { const o = prev === 'car' ? S.car : S.heli, side = prev === 'car' ? 1.8 : 2.4;
    S.p.set(o.x + Math.cos(o.h) * side, o.y, o.z - Math.sin(o.h) * side); const c = W.collide(S.p.x, S.p.z, 0.35, S.p.y, S.p.y + 1.7); S.p.x = c.x; S.p.z = c.z; S.heading = o.h; }
  if (m === 'car' && car.visible && Math.hypot(S.car.x - p.x, S.car.z - p.z) < 15 && prev !== 'heli') { S.car.v = 0; toast('🚗 נכנסת לרכב החונה'); }
  else if (m === 'car') { const c = S.car; c.x = p.x; c.z = p.z; c.h = S.heading; c.v = 0; c.y = W.H(c.x, c.z);
    if (p.y > W.H(p.x, p.z) + 3) { toast('הרכב הונח ברחוב שמתחת'); }
    const r = W.collide(c.x, c.z, 1.6, c.y, c.y + 1.6); c.x = r.x; c.z = r.z; }
  if (m === 'heli') { const h = S.heli; h.x = p.x; h.z = p.z; h.h = S.heading; h.v = 0; h.vy = 0; h.y = Math.max(p.y, W.floorAt(p.x, p.z, p.y + 0.5)); const r = W.collide(h.x, h.z, 3, h.y, h.y + 3.5); h.x = r.x; h.z = r.z; }
  if (m === 'jet') { S.fuel = Math.max(S.fuel, 0.35); }
  if (m === 'drone') { const q = SIM.newDrone(p.x + Math.sin(S.heading) * 2, 0, p.z + Math.cos(S.heading) * 2, S.heading); q.gps = S.drone.gps; q.y = Math.max(W.floorAt(q.x, q.z, p.y + 0.5), 0); S.drone = q; S.cam.yaw = S.heading; toast('🛸 רחפן: ▲ להמראה · ג׳ויסטיק לתנועה · גרירה לסיבוב', 3); }
  if (prev === 'drone') { /* הטייס עמד במקום כל הזמן */ }
  if (m === 'foot' || m === 'jet') S.vy = 0;
  S.mode = m;
  car.visible = m === 'car' || (car.visible && m !== 'car'); heli.visible = m === 'heli' || (heli.visible && m !== 'heli');
  // רכב/מסוק נשארים חונים במקום כשיוצאים – אפשר לחזור אליהם
  player.visible = m === 'foot' || m === 'jet' || m === 'drone'; jetpack.visible = m === 'jet'; drone.visible = m === 'drone' || (drone.visible && S.drone.landed);
  heliShadow.visible = heli.visible;
  S.cam.dist = { foot: 5.2, car: 9, heli: 19, jet: 7, drone: 3.2 }[m];
  S.cam.pitch = { foot: 0.3, car: 0.26, heli: 0.38, jet: 0.3, drone: 0.28 }[m];
  const ui = MODE_UI[m]; $('mode').querySelector('.ic').textContent = ui[0]; $('modeT').textContent = ui[1];
  const lab = { foot: ['קפוץ', 'רוץ'], car: ['בלם', 'אחורה'], heli: ['למעלה', 'למטה'], jet: ['דחף', 'רוץ'], drone: ['למעלה', 'למטה'] }[m];
  $('bAt').textContent = lab[0]; $('bBt').textContent = lab[1];
  $('bA').querySelector('span').textContent = m === 'car' ? '■' : '▲'; $('bB').querySelector('span').textContent = m === 'car' ? '◀' : '▼';
  $('fuelW').style.display = $('fuelSep').style.display = m === 'jet' ? '' : 'none';
  $('hAltU').textContent = m === 'heli' || m === 'jet' || m === 'drone' ? 'מ׳ מעל הקרקע' : 'מ׳ מעל הים (משוער)';
}
function curPos() { if (S.mode === 'drone') return new T.Vector3(S.drone.x, S.drone.y, S.drone.z); if (S.mode === 'car') return new T.Vector3(S.car.x, S.car.y, S.car.z); if (S.mode === 'heli') return new T.Vector3(S.heli.x, S.heli.y, S.heli.z); return S.p.clone(); }
$('mode').onclick = () => setMode(MODES[(MODES.indexOf(S.mode) + 1) % MODES.length]);

// ---------- קלט
addEventListener('keydown', e => { if (e.target && e.target.tagName === 'INPUT') return; input.keys.add(e.code);
  if (e.code === 'Tab' || e.code === 'KeyF') { e.preventDefault(); $('mode').click(); }
  if (/^Digit[1-5]$/.test(e.code)) setMode(MODES[+e.code.slice(5) - 1]);
  if (e.code === 'KeyE' || e.code === 'Enter') interact();
  if (e.code === 'Escape') { closeCard(); $('mine').style.display = $('menu').style.display = 'none'; if (S.inside) exitInterior(); }
  if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => input.keys.delete(e.code));
addEventListener('blur', () => input.keys.clear());
function readKeys() {
  const k = input.keys; let x = 0, y = 0;
  if (k.has('KeyW') || k.has('ArrowUp')) y += 1; if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1; if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  return { x, y, up: k.has('Space'), down: k.has('KeyC') || k.has('ControlLeft') || (S.mode !== 'foot' && S.mode !== 'jet' && (k.has('ShiftLeft') || k.has('ShiftRight'))), yawL: k.has('KeyQ'), yawR: k.has('KeyR'), sprint: k.has('ShiftLeft') || k.has('ShiftRight') };
}
// ג'ויסטיק
const joy = $('joy'), knob = joy.querySelector('i'); let joyId = null, joyC = null;
joy.addEventListener('pointerdown', e => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); const r = joy.getBoundingClientRect(); joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 }; joyMove(e); e.preventDefault(); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; input.x = input.y = 0; input.joy = false; knob.style.transform = ''; };
joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
function joyMove(e) { let dx = e.clientX - joyC.x, dy = e.clientY - joyC.y; const l = Math.hypot(dx, dy), m = joyC.R * 0.8; if (l > m) { dx *= m / l; dy *= m / l; }
  knob.style.transform = `translate(${dx}px,${dy}px)`; input.x = dx / m; input.y = -dy / m; input.joy = true; }
function holdBtn(el, key) { const on = e => { input[key] = true; el.classList.add('hold'); e.preventDefault(); }, off = () => { input[key] = false; el.classList.remove('hold'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off); }
holdBtn($('bA'), 'up'); holdBtn($('bB'), 'down');
$('bE').addEventListener('click', () => interact());
// גרירה על המסך = סיבוב מצלמה; הקשה קצרה = בחירת בניין
const drags = new Map();
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() }); });
cv.addEventListener('pointermove', e => { const d = drags.get(e.pointerId); if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
  if (drags.size === 1) { S.cam.yaw -= dx * 0.006; S.cam.pitch = clamp(S.cam.pitch + dy * 0.004, -0.15, 1.35); S.cam.lastDrag = S.t; } });
const dragEnd = e => { const d = drags.get(e.pointerId); drags.delete(e.pointerId); if (!d) return;
  if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8 && performance.now() - d.t < 350) tap(e.clientX, e.clientY); };
cv.addEventListener('pointerup', dragEnd); cv.addEventListener('pointercancel', e => drags.delete(e.pointerId));
cv.addEventListener('wheel', e => { S.cam.dist = clamp(S.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 2.5, 80); e.preventDefault(); }, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());

// ---------- הקשה על בניין
const ray = new T.Raycaster(), ndc = new T.Vector2();
function tap(cx, cy) {
  if (S.inside) return;
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); ray.far = 900;
  const objs = []; for (const t of W.tiles.values()) { if (t.hi && t.hi.parent) objs.push(t.hi); if (t.lo && t.lo.parent) objs.push(t.lo); }
  for (const g of glows.values()) objs.push(g.shell);
  if (bizObj.sign) objs.push(bizObj.sign);
  const hit = ray.intersectObjects(objs, false)[0];
  if (!hit) return;
  if (hit.object === bizObj.sign) { showCard(bizObj.b); return; }
  const n = hit.face ? hit.face.normal : null; const px = hit.point.x - (n ? n.x * 0.3 : 0), pz = hit.point.z - (n ? n.z * 0.3 : 0);
  const b = W.buildingAt(px, pz, 1.5); if (b) showCard(b);
}

// ---------- כרטיס בניין
let cardB = null;
function qty(b) {
  const P = b.per, Hb = Math.max(3, b.h), gross = P * Hb, net = gross * (1 - OPEN), roof = b.area;
  return { P, Hb, gross, net, roof, lo: P * Math.max(0, b.h - b.sigma), hi: P * (b.h + b.sigma) };
}
function preLink(b) {
  const q = qty(b), st = W.nearestStreet(b.cx, b.cz, 250);
  const basis = `מעטפת בניין מתוך המשחק 27wrld (מפת לוח היזם): היקף ${fmt(q.P)} מ', גובה ${fmt(q.Hb, 1)} מ' (${b.floors} קומות, ${b.conf >= 2 ? 'משוער' : 'מקור: ' + (SRC_HE[b.src] || b.src)}), חזיתות ${fmt(q.gross)} מ"ר ברוטו / ${fmt(q.net)} מ"ר נטו, גג ${fmt(q.roof)} מ"ר. כמויות משוערות – לאימות במדידה. מזהה OSM ${b.id}.`;
  const pre = { lines: [{ id: 'P001', qty: 1 }, { id: 'P002', qty: Math.round(q.gross) }, { id: 'P037', qty: Math.round(q.net) }, { id: 'P031', qty: Math.round(q.roof) }, { id: 'P035', qty: 1 }, { id: 'P088', qty: 1 }], basis, hint: st };
  return YAZAM + encodeURIComponent(JSON.stringify(pre));
}
const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
function showCard(b) {
  cardB = b; const q = qty(b), st = W.nearestStreet(b.cx, b.cz, 250), own = mine.has(b.id), biz = b.id === BIZ.id;
  const cf = CONF_HE[b.conf] || ['—', ''];
  $('card').innerHTML = `<h2>${biz ? '🏪 ' + esc(BIZ.name) : own ? '⭐ הנכס שלי' : '🏢 בניין'}${b.name && !biz ? ' · ' + esc(b.name) : ''}<button class="btn x" id="cClose" aria-label="סגירה">✕</button></h2><table>` +
    row('כתובת', st ? esc(st) + ' <span class="tag">רחוב קרוב, משוער</span>' : 'לא ידוע') +
    row('מזהה OSM', `<span class="ltr">${esc(b.id)}</span>`) + row('סוג', esc(TYPE_HE[b.type] || b.type) + (b.ty && b.ty !== 'ind' ? ' <span class="tag">' + ({ villa: 'וילה / בית פרטי', block: 'בלוק מגורים', tower: 'מגדל' }[b.ty] || '') + ' · נגזר מצורה</span>' : '')) +
    row('קומות', `${b.floors} <span class="tag">טווח ${b.fl}–${b.fh}</span>`) +
    row('גובה', `${fmt(b.h, 1)} מ' ± ${fmt(b.sigma, 1)} ${b.src === 'R' || b.src === 'N' || b.src === 'B' ? '<span class="tag low">משוער, לא נמדד</span>' : '<span class="tag ' + cf[1] + '">ביטחון ' + cf[0] + '</span>'}`) +
    row('מקור הגובה', esc(SRC_HE[b.src] || b.src)) + row('שטח טביעה (גג)', fmt(b.area) + ' מ"ר') + row('היקף', fmt(q.P) + " מ'") + '</table>' +
    `<h3>שיפוץ מעטפת · כמויות <span class="tag">משוער</span></h3><table>` +
    row('חזיתות ברוטו', `${fmt(q.gross)} מ"ר <span class="tag">טווח ${fmt(q.lo)}–${fmt(q.hi)}</span>`) + row(`חזיתות נטו (בניכוי ${OPEN * 100}% פתחים)`, fmt(q.net) + ' מ"ר') + row('גג', fmt(q.roof) + ' מ"ר') + '</table>' +
    `<div class="acts"><button class="btn ${own ? '' : 'pri'}" id="cMine">${own ? '✖ בטל סימון נכס' : '⭐ סמן כנכס שלי'}</button><a class="btn pri" id="cQuote" href="${preLink(b)}" target="_blank" rel="noopener">🧾 פתח הצעה בלוח היזם</a>` +
    (biz ? `<button class="btn" id="cBiz">🚪 היכנס לעסק</button>` : own ? `<button class="btn" id="cIn">🚪 היכנס לנכס</button>` : '') + `</div>` +
    `<p class="note">הגובה והקומות הם הערכה (${esc(SRC_HE[b.src] || b.src)}). מודדים בשטח לפני שליחה ללקוח. נתוני מפה © תורמי OpenStreetMap.</p>`;
  $('card').style.display = 'block';
  $('cClose').onclick = closeCard;
  $('cMine').onclick = () => { toggleMine(b); showCard(b); };
  if ($('cBiz')) $('cBiz').onclick = () => { closeCard(); enterInterior('biz', b); };
  if ($('cIn')) $('cIn').onclick = () => { closeCard(); enterInterior('own', b); };
}
function closeCard() { $('card').style.display = 'none'; cardB = null; }
function toggleMine(b) {
  if (mine.has(b.id)) { mine.delete(b.id); removeGlow(b.id); toast('הסימון הוסר'); }
  else { mine.set(b.id, { id: b.id, tile: b.tile, cx: Math.round(b.cx), cz: Math.round(b.cz), E: Math.round(b.cx + W.OX), N: Math.round(W.OY - b.cz), crs: 'EPSG:2039 (מסגרת דגימת גדוד 5)', top: Math.round(b.top), name: b.name, street: W.nearestStreet(b.cx, b.cz, 250), area: Math.round(b.area), floors: b.floors, t: Date.now() }); addGlow(b); toast('⭐ נוסף להנכסים שלי'); }
  saveMine(); renderMine();
}
function renderMine() {
  const el = $('mine'); const list = [...mine.values()].sort((a, b) => b.t - a.t);
  el.innerHTML = `<h3>⭐ הנכסים שלי (${list.length})</h3>` + (list.length ? '' : '<div style="font-size:13px;color:var(--mut)">עוד אין. הקישו על בניין וסמנו "סמן כנכס שלי".</div>') +
    list.map(o => `<div class="it"><span class="t">${esc(o.name || o.street || 'בניין')} · ${o.floors} קומות · ${fmt(o.area)} מ"ר</span><button class="btn" data-go="${esc(o.id)}">🚁 טוס</button></div>`).join('') +
    '<div class="row" style="margin-top:6px"><button class="btn" id="mClose">סגירה</button></div>';
  el.querySelectorAll('[data-go]').forEach(bt => bt.onclick = () => { const o = mine.get(bt.dataset.go); el.style.display = 'none'; flyTo(o.cx, o.cz, o.top); });
  $('mClose').onclick = () => el.style.display = 'none';
}
$('bMine').onclick = () => { const el = $('mine'); $('menu').style.display = $('env').style.display = 'none'; if (el.style.display === 'block') { el.style.display = 'none'; return; } renderMine(); el.style.display = 'block'; };
function flyTo(x, z, top) { setMode('heli'); const h = S.heli; h.x = x + 30; h.z = z + 30; h.y = Math.max(top + 25, W.H(x, z) + 40); h.h = Math.atan2(x - h.x, z - h.z); h.v = 0; S.cam.yaw = h.h; toast('🚁 מעל הנכס – אפשר לנחות על הגג'); }

// ---------- זוהר לנכסים שלי
const glows = new Map();
const glowMat = new T.MeshBasicMaterial({ color: 0xffc640, transparent: true, opacity: 0.35, depthWrite: false, side: T.DoubleSide });
const beamMat = new T.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending });
function addGlow(b) {
  if (glows.has(b.id)) return;
  const P = [], p = b.p, n = b.n, y0 = b.base - 0.5, y1 = b.top + 0.4;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; let ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
    const k = 0.35, ex = (ax - b.cx), ez = (az - b.cz), fx = (bx - b.cx), fz = (bz - b.cz), le = Math.hypot(ex, ez) || 1, lf = Math.hypot(fx, fz) || 1;
    ax += ex / le * k; az += ez / le * k; bx += fx / lf * k; bz += fz / lf * k;
    P.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.computeVertexNormals();
  const shell = new T.Mesh(g, glowMat); shell.renderOrder = 5;
  const beam = new T.Mesh(new T.CylinderGeometry(0.8, 0.8, 140, 8, 1, true), beamMat); beam.position.set(b.cx, b.top + 70, b.cz); beam.renderOrder = 6;
  const grp = new T.Group(); grp.add(shell, beam); scene.add(grp); glows.set(b.id, { grp, shell, b });
}
function removeGlow(id) { const g = glows.get(id); if (!g) return; scene.remove(g.grp); g.grp.traverse(o => o.geometry && o.geometry.dispose()); glows.delete(id); }

// ---------- העסק לדוגמה
const bizObj = { b: null, sign: null, door: null, pin: null, grp: null };
function signTex(lines, w, h, bg) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg || '#14202e'; x.fillRect(0, 0, w, h); x.strokeStyle = BIZ.color; x.lineWidth = h * 0.05; x.strokeRect(x.lineWidth / 2, x.lineWidth / 2, w - x.lineWidth, h - x.lineWidth);
  x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach(([txt, size, col, y]) => { x.fillStyle = col; x.font = `bold ${size}px system-ui, Arial, sans-serif`; x.fillText(txt, w / 2, y); });
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
}
function setupBiz(b) {
  if (bizObj.b) return; bizObj.b = b;
  // הקיר הארוך שפונה לרחוב (הכי קרוב לנקודת ההתחלה)
  const sp = W.toScene(SPAWN_ITM.E, SPAWN_ITM.N); let best = null, bs = -1e9;
  for (let i = 0; i < b.n; i++) { const j = (i + 1) % b.n, ax = b.p[i * 2], az = b.p[i * 2 + 1], bx = b.p[j * 2], bz = b.p[j * 2 + 1], L = Math.hypot(bx - ax, bz - az); if (L < 5) continue;
    const nx = -(bz - az) / L, nz = (bx - ax) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2; const toS = Math.hypot(sp.x - mx, sp.z - mz); const score = L * 0.5 - toS + ((sp.x - mx) * nx + (sp.z - mz) * nz > 0 ? 30 : 0);
    if (score > bs) { bs = score; best = { mx, mz, nx, nz, L, ang: Math.atan2(nx, nz) }; } }
  if (!best) return;
  const g = new T.Group(); bizObj.grp = g; bizObj.wall = best;
  const sw = Math.min(best.L * 0.8, 11), sh = sw * 0.28;
  const sign = new T.Mesh(new T.PlaneGeometry(sw, sh), new T.MeshBasicMaterial({ map: signTex([[BIZ.name, 92, '#ffffff', 95], [BIZ.sub, 44, BIZ.color, 185]], 1024, 286) }));
  const gy = W.H(best.mx, best.mz);
  sign.position.set(best.mx + best.nx * 0.25, Math.max(gy, b.base) + 4.6, best.mz + best.nz * 0.25); sign.rotation.y = best.ang; g.add(sign); bizObj.sign = sign;
  const door = new T.Mesh(new T.PlaneGeometry(2.2, 2.7), new T.MeshLambertMaterial({ color: 0x3a2a1c })); door.position.set(best.mx + best.nx * 0.2, Math.max(gy, b.base) + 1.35, best.mz + best.nz * 0.2); door.rotation.y = best.ang; g.add(door);
  const glass = new T.Mesh(new T.PlaneGeometry(1.7, 1.9), new T.MeshBasicMaterial({ color: 0xffe2a0 })); glass.position.copy(door.position).add(new T.Vector3(best.nx * 0.02, 0.15, best.nz * 0.02)); glass.rotation.y = best.ang; g.add(glass);
  bizObj.door = { x: best.mx + best.nx * 1.6, z: best.mz + best.nz * 1.6, y: Math.max(gy, b.base) };
  const pin = new T.Sprite(new T.SpriteMaterial({ map: signTex([['🛠', 150, '#fff', 128]], 256, 256, BIZ.color), depthTest: true, fog: false })); pin.scale.set(5, 5, 1); pin.position.set(b.cx, b.top + 9, b.cz); g.add(pin); bizObj.pin = pin;
  const awn = new T.Mesh(new T.BoxGeometry(Math.min(best.L * 0.7, 8), 0.15, 1.6), new T.MeshLambertMaterial({ color: 0xf2b84b })); awn.position.set(best.mx + best.nx * 0.8, Math.max(gy, b.base) + 3.1, best.mz + best.nz * 0.8); awn.rotation.y = best.ang; g.add(awn);
  scene.add(g);
}

W.onTile = (t, ev) => {
  if (ev === 'add') { for (const b of t.blds || []) { if (mine.has(b.id)) addGlow(b); if (b.id === BIZ.id) setupBiz(b); } mmTile(t); }
  if (ev === 'remove') { for (const b of t.blds || []) { removeGlow(b.id); if (b.id === BIZ.id && bizObj.grp) { scene.remove(bizObj.grp); bizObj.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); bizObj.b = bizObj.sign = bizObj.grp = bizObj.pin = bizObj.door = bizObj.wall = null; } } mmTiles.delete(t.key); }
};

// ---------- פנים (חדר העסק / הנכס)
const IN = { scene: new T.Scene(), screen: null, link: '', ret: null };
(function buildInterior() {
  const s = IN.scene; s.background = new T.Color(0x1a1f26);
  s.add(new T.HemisphereLight(0xfff6e8, 0x6b5a48, 1.6)); const pl = new T.PointLight(0xffe2b8, 30, 20, 1.6); pl.position.set(0, 3.2, 0); s.add(pl);
  const woodC = document.createElement('canvas'); woodC.width = woodC.height = 256; const wx = woodC.getContext('2d');
  for (let i = 0; i < 8; i++) { wx.fillStyle = `hsl(30,${35 + (i * 7) % 15}%,${42 + (i * 13) % 12}%)`; wx.fillRect(0, i * 32, 256, 31); } wx.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 8; i++) wx.fillRect((i * 97) % 256, i * 32, 2, 32);
  const wood = new T.CanvasTexture(woodC); wood.wrapS = wood.wrapT = T.RepeatWrapping; wood.repeat.set(3, 3); wood.colorSpace = T.SRGBColorSpace;
  const floor = new T.Mesh(new T.PlaneGeometry(12, 8), new T.MeshLambertMaterial({ map: wood })); floor.rotation.x = -Math.PI / 2; s.add(floor);
  const wallM = new T.MeshLambertMaterial({ color: 0xece6dc, side: T.BackSide }); const room = new T.Mesh(new T.BoxGeometry(12, 3.6, 8), wallM); room.position.y = 1.8; s.add(room);
  const accent = new T.Mesh(new T.PlaneGeometry(12, 3.6), new T.MeshLambertMaterial({ color: 0x24384d })); accent.position.set(0, 1.8, -3.99); s.add(accent);
  const desk = new T.Mesh(new T.BoxGeometry(3.2, 0.9, 1.1), new T.MeshLambertMaterial({ color: 0x6b4a2f })); desk.position.set(-2.5, 0.45, -1.4); s.add(desk);
  const top = new T.Mesh(new T.BoxGeometry(3.3, 0.06, 1.2), new T.MeshLambertMaterial({ color: 0xf2b84b })); top.position.set(-2.5, 0.92, -1.4); s.add(top);
  const sofa = new T.Mesh(new T.BoxGeometry(2.6, 0.7, 0.9), new T.MeshLambertMaterial({ color: 0x3c6e8f })); sofa.position.set(3.4, 0.35, 1.8); s.add(sofa);
  for (const [x, z] of [[5.3, -3.3], [-5.3, -3.3]]) { const pot = new T.Mesh(new T.CylinderGeometry(0.3, 0.25, 0.5, 10), new T.MeshLambertMaterial({ color: 0x9c5b3b })); pot.position.set(x, 0.25, z); s.add(pot); const pl2 = new T.Mesh(new T.IcosahedronGeometry(0.6, 0), new T.MeshLambertMaterial({ color: 0x4f8a3a })); pl2.position.set(x, 1.0, z); s.add(pl2); }
  const scr = new T.Mesh(new T.PlaneGeometry(5.2, 2.6), new T.MeshBasicMaterial({ color: 0xffffff })); scr.position.set(0.6, 1.9, -3.95); s.add(scr); IN.screen = scr;
  const bez = new T.Mesh(new T.PlaneGeometry(5.4, 2.8), new T.MeshLambertMaterial({ color: 0x0c0c0c })); bez.position.set(0.6, 1.9, -3.96); s.add(bez);
  const door = new T.Mesh(new T.PlaneGeometry(1.6, 2.6), new T.MeshLambertMaterial({ color: 0x5a3d26 })); door.position.set(0, 1.3, 3.99); door.rotation.y = Math.PI; s.add(door);
  const mat = new T.Mesh(new T.PlaneGeometry(2, 1), new T.MeshLambertMaterial({ color: 0xc0392b })); mat.rotation.x = -Math.PI / 2; mat.position.set(0, 0.01, 3.3); s.add(mat);
})();
function screenTex(title, lines, footer) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#0f1c2b'); g.addColorStop(1, '#1d3550'); x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  x.fillStyle = BIZ.color; x.fillRect(0, 0, 1024, 92); x.direction = 'rtl'; x.textAlign = 'right'; x.textBaseline = 'middle';
  x.fillStyle = '#1b1300'; x.font = 'bold 54px system-ui, Arial'; x.fillText(title, 990, 48);
  x.fillStyle = '#e9eef5'; x.font = '34px system-ui, Arial'; lines.forEach((l, i) => x.fillText(l, 990, 150 + i * 52));
  x.fillStyle = BIZ.color; x.font = 'bold 32px system-ui, Arial'; x.fillText(footer, 990, 470);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
function enterInterior(kind, b) {
  if (S.inside) return; if (S.mode !== 'foot') setMode('foot');
  closeCard(); IN.ret = { p: S.p.clone(), h: S.heading };
  let tex;
  if (kind === 'biz') { tex = screenTex(BIZ.name + ' · האתר שלך כמקום', ['שיפוצים כלליים · שיפוץ מעטפת · בנייה', 'אשדוד, השפלה, המרכז והדרום', 'כמויות מהמפה → הצעת מחיר בלוח היזם', 'זה דף הדגמה: כל עסק יכול לקבל בניין משלו בעולם'], 'esh27.com ← לחצו "פתח את הדף"'); IN.link = BIZ.url; $('inLink').textContent = '🌐 פתח את דף העסק'; }
  else { const q = qty(b); tex = screenTex('הנכס שלי · ' + (W.nearestStreet(b.cx, b.cz, 250) || b.id), [`${b.floors} קומות · גובה ${fmt(b.h, 1)} מ' ± ${fmt(b.sigma, 1)}`, `חזיתות ${fmt(q.gross)} מ"ר ברוטו · ${fmt(q.net)} נטו`, `גג ${fmt(q.roof)} מ"ר · היקף ${fmt(q.P)} מ'`, 'נתונים משוערים – לאימות במדידה'], 'לוח היזם ← "פתח הצעה"'); IN.link = preLink(b); $('inLink').textContent = '🧾 פתח הצעה בלוח היזם'; }
  if (IN.screen.material.map) IN.screen.material.map.dispose(); IN.screen.material.map = tex; IN.screen.material.needsUpdate = true;
  S.inside = kind; IN.scene.add(player); player.visible = true; jetpack.visible = false;
  S.p.set(0.4, 0, 0.6); S.heading = Math.PI; S.vy = 0; S.cam.yaw = Math.PI; S.cam.pitch = 0.1; S.cam.dist = 3.2; document.body.classList.add('inside');
  $('inUI').style.display = 'flex'; $('prompt').style.display = 'none'; $('bE').classList.add('hidden');
}
function exitInterior() {
  if (!S.inside) return; S.inside = null; scene.add(player); S.p.copy(IN.ret.p); S.heading = IN.ret.h + Math.PI; S.cam.yaw = S.heading; S.cam.dist = 5.2; $('inUI').style.display = 'none'; document.body.classList.remove('inside');
}
$('inExit').onclick = exitInterior; $('inLink').onclick = () => window.open(IN.link, '_blank', 'noopener');

function interact() {
  if (S.inside) { exitInterior(); return; }
  if (S.mode === 'drone') { S.drone.gps = !S.drone.gps; toast(S.drone.gps ? 'GPS: הרחפן מחזיק מיקום מול הרוח' : 'ATTI: המקל קובע זווית – הרוח תסחף את הרחפן', 2.5); proxT = 0; return; }
  if (S.nearBiz) { enterInterior('biz', bizObj.b); return; }
  if (S.nearOwned) { enterInterior('own', S.nearOwned); return; }
  if (S.near) showCard(S.near);
}

// ---------- פיזיקה
const G_FOOT = 9.81, R_FOOT = 0.35;                 // כבידה תקנית
const V_JUMP = 3.0;                                 // קפיצה מעמידה: שיא ≈0.46 מ', 0.61 ש' באוויר (אדם ממוצע 0.3–0.5 מ') – מקורב
const K_DRAG = G_FOOT / (55 * 55);                  // גרר אוויר ריבועי, מהירות סופית ≈55 מ'/ש' (צנחן שטוח) – מקורב
const SWIM_Y = -1.4;                                // גובה הרגליים כשצפים במים עמוקים (הראש מעל המים) – מקורב
const MU_BRAKE = 0.95, MU_WET = 0.6, MU_LAT = 0.9;  // אספלט יבש + ABS: ‏100→0 ב-41.4 מ' (v²/2μg); רטוב וצידי – מקורבים
const _fw = new T.Vector3();
function moveFoot(dt, inp, inside) {
  const jet = S.mode === 'jet' && !inside;
  let mx = inp.x, my = inp.y; const mag = Math.min(1, Math.hypot(mx, my));
  const yaw = S.cam.yaw; // כיוון יחסית למצלמה
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
  let dx = fx * my + rx * mx, dz = fz * my + rz * mx;  /* (rx,rz) = ימין המצלמה */ const dl = Math.hypot(dx, dz); if (dl > 0) { dx /= dl; dz /= dl; }
  let spd = input.joy ? (mag < 0.55 ? 2.0 * mag / 0.55 : lerp(2.0, 5.4, (mag - 0.55) / 0.45)) : (mag > 0 ? 5.4 : 0);
  if (inp.sprint || (TOUCH && inp.down && S.mode === 'foot')) spd = mag > 0 ? 8.5 : 0;
  if (jet && !S.grounded) spd = mag * 11;
  if (inside) spd = Math.min(spd, 3.2);
  const swimming = !inside && !jet && S.p.y < SWIM_Y + 0.3 && W.isSea(S.p.x, S.p.z) && W.H(S.p.x, S.p.z) < SWIM_Y;
  if (swimming) spd = Math.min(spd, 1.0);            // שחייה ≈1 מ'/ש' – מקורב
  S.speed = damp(S.speed, spd, 10, dt);
  if (dl > 0) S.heading = S.heading + angDiff(S.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 12);
  const vx = Math.sin(S.heading) * S.speed * (dl > 0 ? 1 : 0.0), vz = Math.cos(S.heading) * S.speed * (dl > 0 ? 1 : 0.0);
  let nx = S.p.x + (dl > 0 ? dx * S.speed * dt : 0), nz = S.p.z + (dl > 0 ? dz * S.speed * dt : 0);
  // אנכי
  if (jet && inp.up && S.fuel > 0) { S.vy = Math.min(S.vy + 28 * dt, 13);   // ג'טפק בדיוני: תאוצה נטו +18 מ'/ש² כמו קודם
  S.fuel = Math.max(0, S.fuel - dt / 6); S.grounded = false; }
  else if (!jet && inp.up && S.grounded && !inside && !swimming) { S.vy = V_JUMP; S.grounded = false; }
  S.vy -= (G_FOOT + K_DRAG * S.vy * Math.abs(S.vy)) * dt; if (jet) S.vy = Math.max(S.vy, -18);
  let ny = S.p.y + S.vy * dt;
  if (inside) { nx = clamp(nx, -5.6, 5.6); nz = clamp(nz, -3.6, 3.75); const f = 0; if (ny <= f) { ny = f; S.vy = 0; S.grounded = true; } S.p.set(nx, ny, nz); if (nz > 3.6 && dz > 0.5) exitInterior(); return; }
  // ים: לא נכנסים ברגל למים עמוקים
  if (W.H(nx, nz) < -0.4 && S.p.y < 1.5 && W.H(S.p.x, S.p.z) >= -0.4) { nx = S.p.x; nz = S.p.z; }   // מהחוף לא נכנסים; מי שבמים – שוחה
  const c = W.collide(nx, nz, R_FOOT, ny + 0.3, ny + 1.7); nx = c.x; nz = c.z;
  let fl = W.floorAt(nx, nz, Math.max(ny, S.p.y) + 0.5); if (fl < SWIM_Y && W.isSea(nx, nz)) fl = SWIM_Y;   // צף, לא עומד על קרקעית −2.5 (מצייני מקום)
  if (ny <= fl) { // נחיתה / הליכה על הקרקע (מדרגה עד 0.6 מ')
    if (fl - S.p.y > 0.7 && S.grounded) { nx = S.p.x; nz = S.p.z; ny = S.p.y; }
    else { ny = fl; S.vy = 0; S.grounded = true; }
  } else if (ny > fl + 0.15) S.grounded = false; else if (S.grounded && S.vy <= 0) ny = fl;
  if (S.grounded && jet) S.fuel = Math.min(1, S.fuel + dt / 3);
  S.p.set(nx, ny, nz); bounds(S.p);
}
function bounds(o) { const B = W.bounds; if (!B) return; o.x = clamp(o.x, B.minx, B.maxx); o.z = clamp(o.z, B.minz, B.maxz); }
function moveCar(dt, inp) {
  const c = S.car, road = W.onRoad(c.x, c.z), vmax = road ? 34 : 14, v0 = c.v;
  let thr = inp.y; if (inp.down) thr = -1;              // כפתור "אחורה"
  const brake = inp.up;                                  // "בלם" / רווח
  const aB = (SIM.weather.rain > 0.5 ? MU_WET : MU_BRAKE) * G_FOOT * dt;   // בלימה מוגבלת חיכוך: a = μ·g
  if (thr > 0.05) { if (c.v < 0) c.v = Math.min(0, c.v + aB * thr); else c.v += 9 * (1 - c.v / vmax) * thr * dt; }
  else if (thr < -0.05) { if (c.v > 0) c.v = Math.max(0, c.v - aB * -thr); else c.v += -6 * (1 + c.v / 9) * -thr * dt; }
  else if (!brake) c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), (0.6 + 0.00027 * c.v * c.v) * dt);   // גלגול + אוויר + בלימת מנוע – מקורב
  if (brake) c.v = Math.abs(c.v) <= aB ? 0 : c.v - Math.sign(c.v) * aB;
  if (c.v > vmax) c.v = Math.max(vmax, c.v - aB);
  const steerMax = 0.6 / (1 + Math.abs(c.v) / 16); c.steer = damp(c.steer, -inp.x * steerMax, 8, dt);
  const yr = c.v / 2.6 * Math.tan(c.steer), yrMax = MU_LAT * G_FOOT / Math.max(Math.abs(c.v), 1);
  c.h += clamp(yr, -yrMax, yrMax) * dt;               // גבול אחיזה צידית ≈0.9g (תת־היגוי מקורב, בלי החלקת צמיגים)
  const vm = (v0 + c.v) / 2;                          // מהירות ממוצעת בצעד → מרחק עצירה לא תלוי בקצב הפריימים
  let nx = c.x + Math.sin(c.h) * vm * dt, nz = c.z + Math.cos(c.h) * vm * dt;
  if (W.H(nx, nz) < -0.3) { nx = c.x; nz = c.z; c.v *= -0.2; toast('🌊 הים! הרכב נעצר בחוף'); }
  // שני עיגולי התנגשות (חזית/אחור)
  for (const off of [1.3, -1.3]) { const px = nx + Math.sin(c.h) * off, pz = nz + Math.cos(c.h) * off; const r = W.collide(px, pz, 1.05, c.y + 0.2, c.y + 1.5);
    if (r.hit) { nx += r.x - px; nz += r.z - pz; const vd = Math.sin(c.h) * r.nx + Math.cos(c.h) * r.nz; if (vd * c.v < 0) c.v *= 0.25 * -Math.sign(vd * c.v) * -1; if (Math.abs(c.v) > 8) shake = 0.4; } }
  c.x = nx; c.z = nz; const B = { x: c.x, z: c.z }; bounds(B); c.x = B.x; c.z = B.z;
  const hf = W.H(c.x + Math.sin(c.h) * 1.4, c.z + Math.cos(c.h) * 1.4), hb = W.H(c.x - Math.sin(c.h) * 1.4, c.z - Math.cos(c.h) * 1.4);
  const hl = W.H(c.x + Math.cos(c.h) * 0.9, c.z - Math.sin(c.h) * 0.9), hr = W.H(c.x - Math.cos(c.h) * 0.9, c.z + Math.sin(c.h) * 0.9);
  const gy = Math.max(0, (hf + hb) / 2); c.y = c.y < gy - 2 || c.y > gy + 3 ? gy : damp(c.y, gy, 14, dt);
  c.pitch = damp(c.pitch, Math.atan2(hf - hb, 2.8), 10, dt); c.roll = damp(c.roll, Math.atan2(hl - hr, 1.8), 10, dt);
  S.speed = Math.abs(c.v);
}
function moveHeli(dt, inp) {
  const h = S.heli, gnd = W.floorAt(h.x, h.z, h.y + 0.5), onG = h.y <= Math.max(gnd, 0) + 0.05;
  h.rotor = Math.min(1, h.rotor + dt * 1.6);
  const tvy = inp.up ? 9 : inp.down ? -7 : 0; h.vy = damp(h.vy, h.rotor > 0.45 ? tvy : -3, 3, dt);
  if (!onG || inp.up) { h.h -= inp.x * 1.3 * dt; h.v = damp(h.v, inp.y * 46, 1.1, dt); } else h.v = damp(h.v, 0, 4, dt);
  SIM.windAt(h.x, h.y, h.z, S.t, SIMW, windHere); const drift = onG ? 0 : 0.25; // קירוב: סחיפה חלקית ברוח (לא דינמיקת מסוק)
  let nx = h.x + (Math.sin(h.h) * h.v + windHere.x * drift) * dt, nz = h.z + (Math.cos(h.h) * h.v + windHere.z * drift) * dt, ny = clamp(h.y + h.vy * dt, -10, 650);
  const r = W.collide(nx, nz, 2.6, ny, ny + 3.2); if (r.hit) { nx = r.x; nz = r.z; h.v *= 0.5; }
  const f = Math.max(W.floorAt(nx, nz, ny + 0.6), 0); if (ny < f) { ny = f; h.vy = Math.max(0, h.vy); }
  h.x = nx; h.z = nz; h.y = ny; const B = { x: h.x, z: h.z }; bounds(B); h.x = B.x; h.z = B.z;
  h.tilt = damp(h.tilt, clamp(inp.y * 0.22 * (onG ? 0 : 1), -0.2, 0.25), 3, dt); h.bank = damp(h.bank, onG ? 0 : -inp.x * 0.25, 3, dt);
  S.speed = Math.abs(h.v);
}

// ---------- מצלמה
let shake = 0;
const camT = new T.Vector3(), camP = new T.Vector3();
function updateCam(dt) {
  const c = S.cam, m = S.mode; let tx, ty, tz, follow = null;
  if (S.inside) { tx = S.p.x; ty = S.p.y + 1.5; tz = S.p.z; }
  else if (m === 'car') { tx = S.car.x; ty = S.car.y + 1.6; tz = S.car.z; follow = S.car.h; }
  else if (m === 'heli') { tx = S.heli.x; ty = S.heli.y + 2.5; tz = S.heli.z; follow = S.heli.h; }
  else if (m === 'drone') { tx = S.drone.x; ty = S.drone.y + 0.25; tz = S.drone.z; }
  else { tx = S.p.x; ty = S.p.y + 1.55; tz = S.p.z; if (S.speed > 0.5 && input.joy === false && (input.keys.size)) { /* מקלדת: מצלמה חופשית */ } }
  if (follow != null && S.t - c.lastDrag > 1.6 && S.speed > 1.5) c.yaw += angDiff(c.yaw, follow) * Math.min(1, dt * 2.2);
  camT.set(tx, ty, tz);
  let d = c.dist; const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const dir = new T.Vector3(-Math.sin(c.yaw) * cp, sp, -Math.cos(c.yaw) * cp);
  if (!S.inside) { // מצלמה לא נכנסת לבניינים
    for (let i = 0; i < 6; i++) { const px = tx + dir.x * d, pz = tz + dir.z * d, py = ty + dir.y * d; const b = W.buildingAt(px, pz, 0); if (b && py < b.top + 0.5 && py > b.base - 1) d *= 0.75; else break; }
    d = Math.max(d, m === 'drone' ? 0.8 : 1.6);
  } else d = Math.min(d, 3.6);
  camP.set(tx + dir.x * d, ty + dir.y * d, tz + dir.z * d);
  if (!S.inside) { const g = Math.max(W.H(camP.x, camP.z), 0) + 0.6; if (camP.y < g) camP.y = g; } else { camP.x = clamp(camP.x, -5.7, 5.7); camP.z = clamp(camP.z, -3.8, 3.8); camP.y = clamp(camP.y, 0.4, 3.3); }
  camera.position.lerp(camP, 1 - Math.exp(-dt * 14)); if (camera.position.distanceTo(camP) > 60) camera.position.copy(camP);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 1.5); }
  camera.lookAt(camT);
  // טווח ראייה לפי גובה
  const alt = camera.position.y; let far = clamp(1150 + Math.max(0, alt - 30) * 7, 1150, 3000);   // ככל שעולים רואים רחוק יותר (אופק פתוח במקום קיר ערפל) if (SIM.weather.rain > 0) far = Math.min(far, 1150 - SIM.weather.rain * 35); if (SIM.weather.cloud > 0.85) far *= 0.85;
  scene.fog.far = damp(scene.fog.far, Q.level >= 2 ? far * 0.8 : far, 1, dt); scene.fog.near = scene.fog.far * 0.3;
  W.radius = scene.fog.far + 50;
  camera.near = alt > 150 ? 2 : 0.3; camera.far = scene.fog.far + 600; camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  // אור השמש והצל עוקבים אחרי המטרה (מוצמד לטקסל כדי למנוע ריצוד)
  const tex = 170 / sun.shadow.mapSize.x, sx = Math.round(tx / tex) * tex, sz = Math.round(tz / tex) * tex;
  sun.target.position.set(sx, ty, sz); sun.position.set(sx + sunDir.x * 400, ty + sunDir.y * 400, sz + sunDir.z * 400);
}

// ---------- מפה מוקטנת: קנבס מוכן לכל אריח (0.256 פיקסל למטר), מסובב לפי המצלמה
const mmTiles = new Map(), MMS = 0.256;
function mmTile(t) {
  if (!t.tx && t.tx !== 0) return;
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const x0 = t.tx * 1000 - W.OX, z0 = -((t.ty + 1) * 1000 - W.OY);
  // קרקע/ים
  const h = t.hgt; if (h) for (let r = 0; r < 40; r++) for (let k = 0; k < 40; k++) { const v = h[r * 41 + k]; x.fillStyle = v < 0 ? '#2a6f93' : t.wild && t.wild[r * 41 + k] ? '#cdbf97' : '#b9b6a2'; x.fillRect(k * 6.4, r * 6.4, 7, 7); }
  x.lineCap = 'round';
  for (const rd of t.roads || []) { x.strokeStyle = rd.c >= 3 ? '#fff6d0' : '#ffffff'; x.lineWidth = Math.max(1.5, rd.w * MMS * 1.3); x.beginPath(); for (let i = 0; i < rd.p.length; i += 2) { const px = (rd.p[i] - x0) * MMS, pz = (rd.p[i + 1] - z0) * MMS; i ? x.lineTo(px, pz) : x.moveTo(px, pz); } x.stroke(); }
  x.fillStyle = '#6c7a89';
  for (const b of t.blds || []) { x.beginPath(); for (let i = 0; i < b.n; i++) { const px = (b.p[i * 2] - x0) * MMS, pz = (b.p[i * 2 + 1] - z0) * MMS; i ? x.lineTo(px, pz) : x.moveTo(px, pz); } x.closePath(); x.fill(); }
  mmTiles.set(t.key, { c, x0, z0 });
}
const mm = $('mm'), mx2 = mm.getContext('2d');
function drawMinimap() {
  const W2 = mm.width, R = W2 / 2, p = curPos(), sc = 0.42; // פיקסלים למטר בקנבס המפה
  mx2.save(); mx2.clearRect(0, 0, W2, W2); mx2.beginPath(); mx2.arc(R, R, R, 0, Math.PI * 2); mx2.clip();
  mx2.fillStyle = '#2a6f93'; mx2.fillRect(0, 0, W2, W2);
  mx2.translate(R, R); mx2.rotate(Math.PI + S.cam.yaw); mx2.scale(-1, 1);
  // סיבוב: כיוון המצלמה למעלה
  mx2.scale(sc / MMS, sc / MMS);
  for (const m of mmTiles.values()) { const ox = (m.x0 - p.x) * MMS, oz = (m.z0 - p.z) * MMS; if (Math.abs(ox + 128) > 600 || Math.abs(oz + 128) > 600) continue; mx2.drawImage(m.c, ox, oz); }
  mx2.scale(MMS / sc, MMS / sc);
  const dot = (x, z, col, r) => { mx2.fillStyle = col; mx2.beginPath(); mx2.arc((x - p.x) * sc, (z - p.z) * sc, r, 0, Math.PI * 2); mx2.fill(); };
  for (const o of mine.values()) dot(o.cx, o.cz, '#ffc640', 6);
  if (bizObj.b) { dot(bizObj.b.cx, bizObj.b.cz, '#ff7043', 8); }
  if (S.mode !== 'car' && car.visible) dot(S.car.x, S.car.z, '#d2342c', 5);
  if (S.mode !== 'heli' && heli.visible) dot(S.heli.x, S.heli.z, '#f2b84b', 5);
  mx2.restore();
  // חץ השחקן
  const hd = S.mode === 'car' ? S.car.h : S.mode === 'heli' ? S.heli.h : S.heading; const rel = -(hd - S.cam.yaw);
  mx2.save(); mx2.translate(R, R); mx2.rotate(rel); mx2.fillStyle = '#ffffff'; mx2.strokeStyle = '#0d1420'; mx2.lineWidth = 3; mx2.beginPath(); mx2.moveTo(0, -14); mx2.lineTo(10, 11); mx2.lineTo(0, 5); mx2.lineTo(-10, 11); mx2.closePath(); mx2.stroke(); mx2.fill(); mx2.restore();
  // צפון
  const nAng = S.cam.yaw; const nx = R + Math.sin(-nAng + Math.PI) * (R - 14) * -1, nz = R - Math.cos(-nAng + Math.PI) * (R - 14) * -1;
  const el = $('mmN'), rect = mm.getBoundingClientRect(); el.style.left = (rect.left + nx / W2 * rect.width - 4) + 'px'; el.style.top = (rect.top + nz / W2 * rect.height - 8) + 'px';
}

// ---------- HUD / קרבה
let toastT = 0;
function toast(msg, sec) { const el = $('toast'); el.textContent = msg; el.style.display = 'block'; toastT = sec || 2.2; }
function updateHUD(dt) {
  const p = curPos(); $('hSpd').textContent = Math.round(S.speed * 3.6);
  const agl = p.y - Math.max(W.H(p.x, p.z), 0);
  $('hAlt').textContent = (S.mode === 'heli' || S.mode === 'jet' || S.mode === 'drone') ? Math.max(0, Math.round(agl)) : Math.round(p.y);
  $('fuel').firstChild.style.width = Math.round(S.fuel * 100) + '%';
  SIM.windAt(p.x, p.y + (S.mode === 'foot' ? 1.5 : 0.2), p.z, S.t, SIMW, windHere);
  $('hWind').textContent = windHere.speed.toFixed(1); const wa = Math.atan2(windHere.x, -windHere.z) - (Math.PI - S.cam.yaw) * -1;
  $('hWarr').style.transform = `rotate(${(Math.atan2(windHere.x, windHere.z) - S.cam.yaw) * -180 / Math.PI + 180}deg)`;
  if (S.mode === 'drone') $('hSpd').textContent = Math.round(Math.hypot(S.drone.vx, S.drone.vz) * 3.6);
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.display = 'none'; }
}
let proxT = 0;
function proximity() {
  if (S.inside) return;
  const pr = $('prompt'), bE = $('bE');
  S.nearBiz = false; S.nearOwned = null; S.near = null;
  if (S.mode === 'foot' || S.mode === 'jet') {
    if (bizObj.door && Math.hypot(S.p.x - bizObj.door.x, S.p.z - bizObj.door.z) < 4 && Math.abs(S.p.y - bizObj.door.y) < 3) S.nearBiz = true;
    const b = W.buildingAt(S.p.x + Math.sin(S.heading) * 1.2, S.p.z + Math.cos(S.heading) * 1.2, 2.5);
    if (b && S.p.y < b.top) { S.near = b; if (mine.has(b.id)) S.nearOwned = b; }
  }
  let msg = '', btn = '';
  if (S.mode === 'drone') { const q = S.drone; msg = `🛸 ${q.gps ? 'GPS' : 'ATTI'} · אוויר ${q.air.toFixed(1)} מ'/ש' · רוח ${q.wind.speed.toFixed(1)} · דחף ${(q.thrust / (SIM.DRONE.mass * 9.81)).toFixed(2)}g`; btn = q.gps ? 'מעבר ל-ATTI (רוח מסיטה)' : 'מעבר ל-GPS (החזקת מיקום)'; }
  else if (S.nearBiz) { msg = `🏪 ${BIZ.name} — הכניסה כאן`; btn = '🚪 היכנס לעסק'; }
  else if (S.nearOwned) { msg = '⭐ הנכס שלך'; btn = '🚪 היכנס לנכס'; }
  else if (S.near) { msg = `🏢 ${S.near.floors} קומות · ${fmt(S.near.area)} מ"ר`; btn = 'ℹ פרטי בניין'; }
  pr.style.display = msg ? 'block' : 'none'; pr.textContent = msg + (TOUCH ? '' : '  ·  E');
  bE.classList.toggle('hidden', !btn); bE.textContent = btn;
}

// ---------- תפריט
function renderMenu() {
  const el = $('menu');
  el.innerHTML = `<h3>27wrld · אשדוד · אב־טיפוס</h3>
  <div>מקלדת: <kbd>W A S D</kbd> תנועה · <kbd>Space</kbd> קפיצה/למעלה/דחף/בלם · <kbd>Shift</kbd> ריצה/למטה · <kbd>C</kbd> למטה · <kbd>F</kbd> או <kbd>1-5</kbd> מצב · <kbd>Q</kbd>/<kbd>R</kbd> סיבוב רחפן · <kbd>E</kbd> פעולה · גרירה = מצלמה · גלגלת = זום · הקשה על בניין = כרטיס</div>
  <div>מגע: ג'ויסטיק משמאל, כפתורים מימין, גרירה על המסך מסובבת מצלמה, הקשה על בניין פותחת כרטיס.</div>
  <h3 style="margin-top:10px">איכות</h3>
  <div class="row"><button class="btn ${Q.level === 0 ? 'on' : ''}" data-q="0">גבוהה</button><button class="btn ${Q.level === 1 ? 'on' : ''}" data-q="1">בינונית</button><button class="btn ${Q.level === 2 ? 'on' : ''}" data-q="2">חסכונית</button><button class="btn ${Q.auto ? 'on' : ''}" id="qAuto">אוטומטי</button></div>
  <div class="row"><button class="btn" id="mSpawn">↩ חזרה לנקודת ההתחלה</button><button class="btn" id="mBiz">🏪 אל ${BIZ.name}</button><button class="btn" id="mFps">FPS</button></div>
  <div id="stats"></div>
  <p style="font-size:11px;color:var(--mut)">נתוני מפה © תורמי OpenStreetMap (ODbL) · גבהים משוערים (גדוד 5) · דמות Quaternius (CC0). זה אב־טיפוס: אין שמירה בשרת, אין משחק מרובה משתתפים.</p>
  <div class="row"><button class="btn" id="menuX">סגירה</button></div>`;
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { Q.auto = false; setQuality(+b.dataset.q); renderMenu(); });
  $('qAuto').onclick = () => { Q.auto = !Q.auto; renderMenu(); };
  $('mSpawn').onclick = () => { el.style.display = 'none'; spawn(); };
  $('mBiz').onclick = () => { el.style.display = 'none'; if (S.mode !== 'foot') setMode('foot'); spawn(); };
  $('mFps').onclick = () => { $('fps').classList.toggle('hidden'); };
  $('menuX').onclick = () => el.style.display = 'none';
  statsText();
}
function statsText() { const s = $('stats'); if (!s) return; const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : 'n/a'; const i = renderer.info;
  s.textContent = `fps ${fpsAvg.toFixed(0)} · pr ${renderer.getPixelRatio().toFixed(2)} · draw ${i.render.calls} · tris ${(i.render.triangles / 1000).toFixed(0)}k\ntiles ${W.tiles.size} · heap ${mem} · build ${W.stats.buildMs.toFixed(0)}ms/${W.stats.builds}`; }
$('bMenu').onclick = () => { const el = $('menu'); $('mine').style.display = $('env').style.display = 'none'; if (el.style.display === 'block') { el.style.display = 'none'; return; } renderMenu(); el.style.display = 'block'; };
function setQuality(l) {
  Q.level = l; const base = Math.min(window.devicePixelRatio || 1, TOUCH ? 1.25 : 1.5);
  Q.pr = [base, Math.min(base, 1.0), Math.min(base, 0.8)][l]; renderer.setPixelRatio(Q.pr); resize();
  W.hiRadius = [650, 480, 320][l]; applyEnv();
}

// ---------- גשם (קווים סביב המצלמה, נוטים עם הרוח)
const RAIN = { mesh: null, n: 0, pos: null };
function rainSetup() {
  const want = Math.round(Math.sqrt(clamp(SIM.weather.rain, 0, 20) / 20) * (TOUCH ? 1800 : 3000));
  if (want === RAIN.n) return;
  if (RAIN.mesh) { scene.remove(RAIN.mesh); RAIN.mesh.geometry.dispose(); RAIN.mesh = null; } RAIN.n = want; if (!want) return;
  const pos = new Float32Array(want * 6); for (let i = 0; i < want; i++) { pos[i * 6] = (Math.random() - 0.5) * 60; pos[i * 6 + 1] = Math.random() * 40; pos[i * 6 + 2] = (Math.random() - 0.5) * 60; }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
  RAIN.mesh = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xe8f0f8, transparent: true, opacity: 0.85, depthWrite: false, fog: false })); RAIN.mesh.frustumCulled = false; RAIN.pos = pos; scene.add(RAIN.mesh);
}
function rainUpdate(dt) {
  if (!RAIN.mesh) return; const p = RAIN.pos, c = camera.position, vy = -9, wx = windHere.x, wz = windHere.z;
  for (let i = 0; i < RAIN.n; i++) { const o = i * 6; let x = p[o] + wx * dt, y = p[o + 1] + vy * dt, z = p[o + 2] + wz * dt;
    const wr = (v, cc) => cc + (((v - cc + 30) % 60) + 60) % 60 - 30; x = wr(x, c.x); z = wr(z, c.z); y = c.y - 20 + (((y - c.y + 20) % 40) + 40) % 40;
    p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = x - wx * 0.09; p[o + 4] = y + 0.9; p[o + 5] = z - wz * 0.09; }
  RAIN.mesh.geometry.attributes.position.needsUpdate = true;
}
// ---------- פאנל זמן ומזג אוויר
const DIRS = ['צפון', 'צפון־מזרח', 'מזרח', 'דרום־מזרח', 'דרום', 'דרום־מערב', 'מערב', 'צפון־מערב'];
const dirName = d => DIRS[Math.round(((d % 360) + 360) % 360 / 45) % 8];
function ilParts(d) { const off = SIM.israelOffsetMin(d), l = new Date(d.getTime() + off * 60000); return { y: l.getUTCFullYear(), mo: l.getUTCMonth(), d: l.getUTCDate(), min: l.getUTCHours() * 60 + l.getUTCMinutes(), off }; }
function setIL(y, mo, d, min) { const guess = new Date(Date.UTC(y, mo, d, 0, min)); const off = SIM.israelOffsetMin(guess); ENV.date = new Date(guess.getTime() - off * 60000); applyEnv(); }
function renderEnv() {
  const el = $('env'), w = SIM.weather, ip = ilParts(ENV.date), sp = ENV.sun;
  const ds = `${ip.y}-${String(ip.mo + 1).padStart(2, '0')}-${String(ip.d).padStart(2, '0')}`, hh = `${String(ip.min / 60 | 0).padStart(2, '0')}:${String(ip.min % 60).padStart(2, '0')}`;
  el.innerHTML = `<h3>☀ שמש · ${hh} <span class="tag">שעון ישראל</span></h3>
  <div class="row"><input type="date" id="eDate" value="${ds}"><button class="btn" id="eNow">עכשיו</button></div>
  <label>שעה <input type="range" id="eTime" min="0" max="1430" step="10" value="${ip.min}"></label>
  <div class="ro">אזימוט ${sp.azimuth.toFixed(1)}° · גובה ${sp.elevation.toFixed(1)}° ${sp.elevation < 0 ? '(לילה)' : ''}<br><span class="mut">אשדוד ${LAT}°, ${LON}° · NOAA · צל מחושב סביב השחקן (±85 מ')</span></div>
  <h3>🌬 מזג אוויר <span class="tag">${esc(w.source)}</span></h3>
  <label>רוח ${w.windSpeed.toFixed(1)} מ'/ש' (${Math.round(w.windSpeed * 3.6)} קמ"ש) <input type="range" id="eWs" min="0" max="25" step="0.5" value="${w.windSpeed}"></label>
  <label>נושבת מ${dirName(w.windFrom)} (${Math.round(w.windFrom)}°) <input type="range" id="eWd" min="0" max="359" step="5" value="${w.windFrom}"></label>
  <label>משבים ×${w.gust.toFixed(1)} <input type="range" id="eWg" min="1" max="2.5" step="0.1" value="${w.gust}"></label>
  <label>עננות ${Math.round(w.cloud * 100)}% <input type="range" id="eCl" min="0" max="1" step="0.05" value="${w.cloud}"></label>
  <label>גשם ${w.rain.toFixed(1)} מ"מ/שעה <input type="range" id="eRn" min="0" max="20" step="0.5" value="${w.rain}"></label>
  <div class="row"><button class="btn" id="eLive" ${ENV.live ? '' : 'disabled'}>📡 נתוני אמת (Open-Meteo)</button><button class="btn" id="eX">סגירה</button></div>
  <div class="mut">${ENV.live ? 'מחובר לפי בקשה בלבד.' : 'כבוי בגרסה הלא־מקוונת. להפעלה: ‎?live=1‎ בכתובת.'}</div>`;
  const rr = (id, f) => { $(id).oninput = e => { f(+e.target.value); applyEnv(); renderEnvSoft(); }; };
  $('eTime').oninput = e => { const p2 = ilParts(ENV.date); setIL(p2.y, p2.mo, p2.d, +e.target.value); renderEnvSoft(); };
  $('eDate').onchange = e => { const [y, mo, d] = e.target.value.split('-').map(Number); if (y) { setIL(y, mo - 1, d, ilParts(ENV.date).min); renderEnv(); } };
  $('eNow').onclick = () => { ENV.date = new Date(); applyEnv(); renderEnv(); };
  rr('eWs', v => w.windSpeed = v); rr('eWd', v => w.windFrom = v); rr('eWg', v => w.gust = v); rr('eCl', v => w.cloud = v); rr('eRn', v => w.rain = v);
  $('eX').onclick = () => el.style.display = 'none';
  $('eLive').onclick = async () => { try { Object.assign(SIM.weather, await SIM.fetchWeather(LAT, LON)); applyEnv(); renderEnv(); toast('מזג אוויר עודכן מ-Open-Meteo'); } catch (e) { toast('לא הצלחתי למשוך נתונים: ' + e.message); } };
}
let envSoftT = null;
function renderEnvSoft() { clearTimeout(envSoftT); envSoftT = setTimeout(() => { // מעדכן טקסטים בלי לשבור גרירה של מחוון
  const el = $('env'); const sp = ENV.sun, w = SIM.weather, ip = ilParts(ENV.date), hh = `${String(ip.min / 60 | 0).padStart(2, '0')}:${String(ip.min % 60).padStart(2, '0')}`;
  const h3 = el.querySelector('h3'); if (h3) h3.firstChild.textContent = `☀ שמש · ${hh} `; const ro = el.querySelector('.ro'); if (ro) ro.firstChild.textContent = `אזימוט ${sp.azimuth.toFixed(1)}° · גובה ${sp.elevation.toFixed(1)}° ${sp.elevation < 0 ? '(לילה)' : ''}`;
  const L = el.querySelectorAll('label'); const tx = [null, null, `רוח ${w.windSpeed.toFixed(1)} מ'/ש' (${Math.round(w.windSpeed * 3.6)} קמ"ש) `, `נושבת מ${dirName(w.windFrom)} (${Math.round(w.windFrom)}°) `, `משבים ×${w.gust.toFixed(1)} `, `עננות ${Math.round(w.cloud * 100)}% `, `גשם ${w.rain.toFixed(1)} מ"מ/שעה `];
  L.forEach((l, i) => { const t = tx[i + 1]; if (t && l.firstChild.nodeType === 3) l.firstChild.textContent = t; }); }, 30); }
$('bEnv').onclick = () => { const el = $('env'); $('menu').style.display = $('mine').style.display = 'none'; if (el.style.display === 'block') { el.style.display = 'none'; return; } renderEnv(); el.style.display = 'block'; };

// ---------- לולאה
let fpsAvg = 60, fpsLow = 0, last = performance.now(), mmT = 0;
const clock = { frames: 0, t0: performance.now() };
let __ff = 0, __fm = '';
function frame(now) {
  requestAnimationFrame(frame);
  try { frameBody(now); } catch (e) {
    if (e.message !== __fm || __ff++ % 300 === 0) { __fm = e.message; console.warn('[frame] error contained:', e.message); if (window.YZW) YZW.frameFault(e); }
    try { const p = curPos(); if (isFinite(p.x) && isFinite(p.z)) W.update(p.x, p.z, 6); renderer.render(S.inside ? IN.scene : scene, camera); } catch (e2) { /* */ }
  }
}
function frameBody(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1; if (dt <= 0) return;
  S.t += dt; fpsAvg = lerp(fpsAvg, 1 / dt, 0.05);
  if (!S.started) { renderer.render(scene, camera); return; }
  const k = readKeys(), o = input.override;
  const inp = o || { x: clamp(input.x + k.x, -1, 1), y: clamp(input.y + k.y, -1, 1), up: input.up || k.up, down: input.down || k.down, sprint: k.sprint, yawL: k.yawL, yawR: k.yawR };
  if (S.inside) moveFoot(dt, inp, true);
  else if (S.mode === 'foot' || S.mode === 'jet' || S.mode === 'car' || S.mode === 'heli') { const __n = Math.max(1, Math.ceil(dt / 0.02)), __h = dt / __n;
    for (let __i = 0; __i < __n; __i++) { if (S.mode === 'car') moveCar(__h, inp); else if (S.mode === 'heli') moveHeli(__h, inp); else moveFoot(__h, inp, false); } }
  else if (S.mode === 'drone') { const q = S.drone; let yi = clamp(-angDiff(q.yaw, S.cam.yaw) * 2.5, -1, 1); if (inp.yawL) yi = -1; if (inp.yawR) yi = 1; if (inp.yawL || inp.yawR) S.cam.yaw = q.yaw;
    SIM.stepDrone(q, { x: inp.x, y: inp.y, up: inp.up, down: inp.down, yawIn: yi }, dt, S.t, SIMW); const B = { x: q.x, z: q.z }; bounds(B); q.x = B.x; q.z = B.z;
    S.speed = Math.hypot(q.vx, q.vz); if (q.hit > 3) { toast(`💥 פגיעה במבנה (${q.hit.toFixed(1)} מ'/ש')`, 1.5); shake = 0.15; } q.hit = 0; S.speed = Math.hypot(q.vx, q.vz); }
  // אובייקטים
  player.position.copy(S.p); player.rotation.y = S.heading;
  if (S.mode === 'car' || car.visible) { car.position.set(S.car.x, S.car.y, S.car.z); car.rotation.set(0, 0, 0); car.rotateY(S.car.h); car.rotateX(-S.car.pitch); car.rotateZ(S.car.roll); for (const w of car.userData.wheels) w.rotation.x += S.car.v * dt / 0.36; }
  if (heli.visible) { const h = S.heli; heli.position.set(h.x, h.y, h.z); heli.rotation.set(0, 0, 0); heli.rotateY(h.h); heli.rotateX(h.tilt); heli.rotateZ(h.bank);
    if (S.mode === 'heli') heli.userData.rotor.rotation.y += dt * 28 * h.rotor; else h.rotor = Math.max(0, h.rotor - dt * 0.3), heli.userData.rotor.rotation.y += dt * 28 * h.rotor;
    heli.userData.tr.rotation.x += dt * 40 * h.rotor; heli.userData.disc.visible = h.rotor > 0.5;
    const g = Math.max(W.floorAt(h.x, h.z, h.y + 0.5), 0); heliShadow.position.set(h.x, g + 0.08, h.z); const s = clamp(1 - (h.y - g) / 150, 0.2, 1); heliShadow.scale.setScalar(s); heliShadow.material.opacity = 0.28 * s; }
  if (!S.inside) { const g = W.floorAt(S.p.x, S.p.z, S.p.y + 0.3); blob.visible = player.visible && !sun.castShadow; blob.position.set(S.p.x, Math.max(g, 0) + 0.05, S.p.z); const s = clamp(1 - (S.p.y - g) / 20, 0.2, 1); blob.scale.setScalar(s); } else blob.visible = false;
  if (jetpack.visible) { const on = inp.up && S.fuel > 0; for (const f of jetpack.userData.fl) { f.visible = on || !S.grounded; f.scale.y = on ? 0.8 + Math.random() * 0.6 : 0.3; } }
  if (drone.visible) { const q = S.drone; drone.position.set(q.x, q.y, q.z); drone.rotation.set(0, 0, 0); drone.rotateY(q.yaw); drone.rotateX(-q.pitch); drone.rotateZ(q.roll);
    const spin = q.thrust > 0.1 ? 1 : 0; for (const pr of drone.userData.props) pr.visible = spin > 0; }
  // אנימציה
  if (AN.mixer) {
    let a = 'Idle_Loop';
    if (S.mode === 'jet' && !S.grounded && !S.inside) a = 'Jump_Loop';
    else if (!S.grounded && S.vy > -30) a = 'Jump_Loop';
    else if (S.speed > 7) a = 'Sprint_Loop'; else if (S.speed > 3) a = 'Jog_Fwd_Loop'; else if (S.speed > 0.3) a = 'Walk_Loop';
    playAnim(a, 0.18); const ac = AN.acts[a]; if (ac && a === 'Walk_Loop') ac.timeScale = clamp(S.speed / 1.6, 0.6, 1.6); if (ac && a === 'Jog_Fwd_Loop') ac.timeScale = clamp(S.speed / 4.2, 0.8, 1.4);
    AN.mixer.update(dt);
  }
  // זוהר נכסים
  glowMat.opacity = 0.22 + 0.16 * Math.sin(S.t * 3); beamMat.opacity = 0.25 + 0.12 * Math.sin(S.t * 3 + 1);
  if (bizObj.pin && bizObj.b) bizObj.pin.position.y = bizObj.b.top + 9 + Math.sin(S.t * 2) * 0.8;
  W.MAT.sea.normalMap.offset.set(S.t * (0.006 + SIM.weather.windSpeed * 0.0015), S.t * 0.007); skyMat.uniforms.time.value = S.t * (1 + SIM.weather.windSpeed * 0.3); rainUpdate(dt);
  updateCam(dt);
  const p = curPos(); W.update(p.x, p.z, Q.level >= 2 ? 6 : 9);
  // אוטומטי: ירידה באיכות אם קצב הפריימים נמוך לאורך זמן
  if (Q.auto && S.t > 6) { if (fpsAvg < 27) fpsLow += dt; else fpsLow = Math.max(0, fpsLow - dt * 0.5); if (fpsLow > 3 && Q.level < 2) { setQuality(Q.level + 1); fpsLow = 0; toast('איכות הותאמה לביצועי המכשיר', 1.6); } }
  proxT -= dt; if (proxT <= 0) { proxT = 0.2; proximity(); }
  mmT -= dt; if (mmT <= 0 && !S.inside) { mmT = 0.1; drawMinimap(); }
  updateHUD(dt);
  if (!$('fps').classList.contains('hidden')) $('fps').textContent = fpsAvg.toFixed(0) + ' fps';
  if ($('menu').style.display === 'block' && (clock.frames++ % 30 === 0)) statsText();
  renderer.render(S.inside ? IN.scene : scene, camera);
}
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 72 : 60; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

function spawn() {
  const sp = W.toScene(SPAWN_ITM.E, SPAWN_ITM.N);
  if (bizObj.door) { const d = bizObj.door, w = bizObj.wall; S.p.set(d.x + w.nx * 9, d.y, d.z + w.nz * 9); S.heading = Math.atan2(-w.nx, -w.nz); }
  else { S.p.set(sp.x, W.H(sp.x, sp.z), sp.z); }
  S.p.y = W.floorAt(S.p.x, S.p.z, S.p.y + 1); S.cam.yaw = S.heading; S.vy = 0; S.grounded = true;
  // רכב ומסוק חונים ליד
  S.car.x = S.p.x + Math.cos(S.heading) * 4; S.car.z = S.p.z - Math.sin(S.heading) * 4; S.car.h = S.heading + Math.PI / 2; S.car.y = W.H(S.car.x, S.car.z); car.visible = true; const r = W.collide(S.car.x, S.car.z, 1.6, S.car.y, S.car.y + 1.5); S.car.x = r.x; S.car.z = r.z;
}

// ---------- אתחול
async function boot() {
  const bar = $('lbar').firstChild, msg = $('lmsg');
  try {
    msg.textContent = 'טוען מפת אשדוד…'; bar.style.width = '10%';
    await W.init(scene, { base: 'data/' }); applyEnv();
    const sp = W.toScene(SPAWN_ITM.E, SPAWN_ITM.N); S.p.set(sp.x, 30, sp.z);
    camera.position.set(sp.x - 40, 60, sp.z + 40); camera.lookAt(sp.x, 0, sp.z);
    loadCharacter();
    // מחכים לאריחים הקרובים
    const t0 = performance.now();
    await new Promise(res => { const tick = () => { W.update(sp.x, sp.z, 40); const near = [...W.tiles.values()].filter(t => t.blds).length; bar.style.width = Math.min(95, 15 + near * 6) + '%'; msg.textContent = `טוען אריחים… ${near}`;
      if ((W.tiles.get(Math.floor(SPAWN_ITM.E / 1000) + '_' + Math.floor(SPAWN_ITM.N / 1000)) || {}).blds && W.pending() === 0 || performance.now() - t0 > 20000) res(); else setTimeout(tick, 60); }; tick(); });
    spawn(); S.mode = 'jet'; setMode('foot'); bar.style.width = '100%'; msg.textContent = 'מוכן';
    $('go').classList.remove('hidden'); $('go').onclick = start;
    if (/[?&]auto/.test(location.search)) start();
  } catch (e) { console.error(e); $('lerr').textContent = 'שגיאה בטעינה: ' + e.message + ' (צריך שרת קבצים, לא file://)'; }
}
function start() { $('load').style.display = 'none'; S.started = true; S.t = 0; last = performance.now(); if (!TOUCH) toast('WASD לתנועה · F להחלפת מצב · הקשה על בניין לפרטים', 4); else toast('ג׳ויסטיק משמאל · גרירה למצלמה · הקשה על בניין', 4); }
requestAnimationFrame(frame); boot();

// ---------- ממשק לבדיקות אוטומטיות
window.G27 = { phys: { moveFoot, moveCar }, SIM, ENV, applyEnv, drone, windHere, S, W, setMode, input, showCard, enterInterior, exitInterior, interact, toggleMine, spawn, flyTo, setQuality, Q, renderer, camera, scene, AN, biz: bizObj, mine, start, fps: () => fpsAvg, statsText };
})();
