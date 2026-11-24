/* הקרקע הרחוקה של העין הגדולה — רצף "רחוב → שכונה → עיר → אשדוד → החוף → ישראל → כדור הארץ" (בקשת אריאל 24.11 04:30).
 * פועל רק במצב העין הגדולה ורק מגובה 90 מ' ומעלה (ברחוב אין שום שינוי — שער התמונות לא מושפע).
 *  1. כיפה: טבעת קוטבית סביב מוקד המצלמה עד 400 ק"מ, על פני כדור (רדיוס כדור הארץ) שמשיק למוקד.
 *     צבע: region_day.jpg (NASA, 24–46°E) בכל מקום — בלי תפר מול הכדור. assets/far/far_ov.png (אשדוד ±100 ק"מ, תא 100 מ') = מסכה: קו חוף OSM ושטח בנוי.
 *     אין זיגזג: קו החוף נקבע לפי פיקסל במרקם (100 מ'), לא לפי ריבועי 1 ק"מ. אין "וילונות": בתוך אריח טעון הכיפה נמחקת (מסכת אריחים),
 *     מחוצה לו הגובה דועך מגובה קצה האריחים ל-0 על פני 2 ק"מ. אריחי "יבשה שטוחה" המשוערים (flatTile) מוסתרים כשהכיפה פעילה.
 *  2. כדור: SphereGeometry עם earth_day_2k.jpg (NASA Blue Marble דרך three-globe, נחלת הכלל), משיק למוקד ומסובב לפי קו הרוחב/האורך שלו.
 * מקור: window.YZFar.view (נכתב ע"י מצב dev בכל פריים): { tx, tz, dist, alt }.
 */
(function () {
  'use strict';
  const RE = 6371000, R1 = 12000;          // רדיוס כדור הארץ; עד R1 מהמוקד הכיפה שטוחה (תואם למישור הים של המשחק ולאריחים השטוחים)
  const NR = 48, NS = 96, RMAX = 400000;
  const OV = { o: [66000, 735000], size: 201000 };   // overview.png: פינה צפון-מערבית, 2010 תאים × 100 מ' (ITM אמיתי)
  const REG = { lon: [24, 46], lat: [20, 42] };
  let REF = [0.267, 0.197, 0.099];   // צבע יבשה ממוצע (ליניארי) של מרקם NASA סביב אשדוד — מכויל ב-tools/make_far.py
  const F = { ready: false, loading: false, on: false, grp: null, cap: null, globe: null, at: null, mask: null, maskT: 0, flatHidden: false, view: null, stats: {} };
  window.YZFar = F;
  const drop = r => r <= R1 ? 0 : (r * r - R1 * R1) / (2 * RE);   // ירידת פני הכדור מעבר לאזור השטוח (קירוב פרבולי — מספיק עד 400 ק"מ)

  function load(world) {
    F.loading = true; const L = new THREE.TextureLoader(), base = 'assets/far/';
    const ld = (n, data) => new Promise((ok, no) => L.load(base + n, t => { t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 4; ok(t); }, undefined, () => no(new Error(n))));
    return Promise.all([ld('far_ov.png', true), ld('region_day.jpg'), ld('earth_day_2k.jpg')]).then(([ov, reg, earth]) => { build(world, ov, reg, earth); F.ready = true; })
      .catch(e => { F.err = e.message; console.warn('[far]', e.message); }).finally(() => { F.loading = false; });
  }

  function build(world, ovT, regT, earthT) {
    const W = world.data.W;
    // מסכת אריחים טעונים: 128×128 תאים של 1 ק"מ סביב מרכז הדגימה (1 = יש אריח אמיתי → הכיפה לא מצוירת שם)
    F.mask = new THREE.DataTexture(new Uint8Array(128 * 128 * 4), 128, 128); F.mask.magFilter = F.mask.minFilter = THREE.NearestFilter; F.mask.needsUpdate = true;
    F.mask0 = [Math.floor(W.OX / 1000) - 64, Math.floor(W.OY / 1000) - 64];
    const seaC = new THREE.Color(0x3f86b0).convertSRGBToLinear();
    const U = { uOv: { value: ovT }, uReg: { value: regT }, uMask: { value: F.mask }, uMask0: { value: new THREE.Vector2(F.mask0[0], F.mask0[1]) }, uOrg: { value: new THREE.Vector2(W.OX, W.OY) },
      uSeaBox: { value: new THREE.Vector3(0, 0, 0) }, uSea: { value: new THREE.Vector3(seaC.r, seaC.g, seaC.b) }, uRef: { value: new THREE.Vector3(REF[0], REF[1], REF[2]) }, uLand: { value: new THREE.Vector3(0.75, 0.75, 0.75) } };
    F.U = U;
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true });
    m.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aOv; attribute vec2 aReg; varying vec2 vOv; varying vec2 vReg; varying vec3 vWp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOv = aOv; vReg = aReg; vWp = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uOv, uReg, uMask; uniform vec2 uMask0, uOrg; uniform vec3 uSeaBox, uSea, uRef, uLand; varying vec2 vOv; varying vec2 vReg; varying vec3 vWp;`)
        .replace('#include <map_fragment>', `
  vec2 en = vec2(vWp.x + uOrg.x, uOrg.y - vWp.z); vec2 cell = floor(en / 1000.0) - uMask0;
  float inTile = 0.0; if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < 128.0 && cell.y < 128.0) inTile = texture2D(uMask, (cell + 0.5) / 128.0).r;
  vec4 ov = texture2D(uOv, vOv); vec3 cr = texture2D(uReg, vReg).rgb;
  float inOv = 1.0 - smoothstep(0.44, 0.5, length(vOv - 0.5));          // בתוך עיגול הסקירה (100 ק"מ)
  float rsea = smoothstep(0.02, 0.08, cr.b - cr.r);                      // ים לפי NASA
  float land = mix(1.0 - rsea, smoothstep(0.35, 0.65, ov.g), inOv);      // קו חוף: OSM 100 מ' בעיגול, NASA מחוצה לו
  vec3 lc = mix(cr, uRef, rsea);                                         // NASA אומר ים והסקירה אומרת יבשה → צבע יבשה ממוצע
  vec2 nq = floor(vWp.xz / 180.0); float nz = fract(sin(dot(nq, vec2(12.9898, 78.233))) * 43758.5453);
  lc *= 0.93 + 0.14 * nz;                                                // פרטים עדינים מתחת לפיקסל של NASA
  lc = mix(lc, vec3(0.19, 0.18, 0.17), clamp(ov.r * inOv, 0.0, 0.6));   // שטח בנוי (אפור)
  vec3 c = mix(mix(uSea, cr, rsea * mix(1.0, 0.45, inOv)), lc, land);
  float sea = 1.0 - land;
  bool inBox = abs(vWp.x - uSeaBox.x) < uSeaBox.z && abs(vWp.z - uSeaBox.y) < uSeaBox.z;
  if (inTile > 0.5 && sea < 0.5) discard;          // יבשה של אריח טעון — האריח מצייר
  if (sea > 0.5 && inBox) discard;                 // ים בתוך מישור הים של המשחק — המשחק מצייר (גלים, השתקפות)
  diffuseColor.rgb *= c;`);
    };
    m.customProgramCacheKey = () => 'yz-far-cap';
    F.cap = new THREE.Mesh(new THREE.BufferGeometry(), m); F.cap.name = 'far-cap'; F.cap.frustumCulled = false; F.cap.renderOrder = -2; F.cap.receiveShadow = false;
    const gm = new THREE.MeshLambertMaterial({ map: earthT, fog: false });
    F.globe = new THREE.Mesh(new THREE.SphereGeometry(RE - 250, 128, 64), gm); F.globe.name = 'far-globe'; F.globe.visible = false; F.globe.renderOrder = -3;
    F.grp.add(F.cap, F.globe);
  }

  // כיפה סביב המוקד (tx,tz): טבעות גאומטריות 40 מ' → 400 ק"מ
  function buildCap(world, cx, cz) {
    const W = world.data.W, C = world.coords, R = W.radius, n = NR * NS + 1;
    const pos = new Float32Array(n * 3), aOv = new Float32Array(n * 2), aReg = new Float32Array(n * 2), idx = [];
    const edgeH = (x, z) => { const h = W.H(x, z); return h > 0.6 ? h : 0.15; };
    const put = (k, x, z) => {
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      let y = 0.15; if (d < R + 2600) { const kk = Math.min(1, (R - 40) / Math.max(d, 1)); const h0 = edgeH(cx + dx * kk, cz + dz * kk); const t = Math.min(1, Math.max(0, (d - R) / 2000)); y = h0 + (0.15 - h0) * t * t * (3 - 2 * t) - 0.35; }
      pos[k * 3] = x; pos[k * 3 + 1] = Math.max(y, 0.15) - drop(d); pos[k * 3 + 2] = z;
      const t = C.toRealITM(x, z); aOv[k * 2] = (t.E - OV.o[0]) / OV.size; aOv[k * 2 + 1] = 1 - (OV.o[1] - t.N) / OV.size;
      const g = C.itmToWgs84 ? C.itmToWgs84(t.E, t.N) : { lat: 31.8, lon: 34.65 }; aReg[k * 2] = (g.lon - REG.lon[0]) / (REG.lon[1] - REG.lon[0]); aReg[k * 2 + 1] = (g.lat - REG.lat[0]) / (REG.lat[1] - REG.lat[0]);
    };
    put(0, cx, cz);
    for (let i = 0; i < NR; i++) { const r = 40 * Math.pow(RMAX / 40, i / (NR - 1));
      for (let j = 0; j < NS; j++) { const a = j / NS * Math.PI * 2; put(1 + i * NS + j, cx + Math.cos(a) * r, cz + Math.sin(a) * r); } }
    for (let j = 0; j < NS; j++) idx.push(0, 1 + (j + 1) % NS, 1 + j);
    for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NS; j++) { const a = 1 + i * NS + j, b = 1 + i * NS + (j + 1) % NS, c = a + NS, d = b + NS; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aOv', new THREE.BufferAttribute(aOv, 2)); g.setAttribute('aReg', new THREE.BufferAttribute(aReg, 2));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }

  // כדור משיק למוקד: נקודת המוקד (lat,lon) למעלה, צפון אמיתי → צפון הרשת של המשחק (כולל התכנסות המרידיאנים)
  function placeGlobe(world, cx, cz) {
    const C = world.coords; if (!C.itmToWgs84) return;
    const t = C.toRealITM(cx, cz), g = C.itmToWgs84(t.E, t.N), la = g.lat * Math.PI / 180, lo = g.lon * Math.PI / 180;
    // מערכת הכדור של three: lon0 → +x, lon90 → −z, צפון → +y
    const P = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
    const E = new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo)), N = new THREE.Vector3().crossVectors(P, E);
    const S = new THREE.Matrix4().makeBasis(E, P, N.clone().negate()), Rm = S.clone().transpose();   // מפה E→x, P→y, N→−z
    // התכנסות: כיוון הצפון האמיתי בסצנה
    const n2 = C.wgs84ToItm(g.lat + 0.05, g.lon), s2 = C.fromRealITM(n2.E, n2.N), gam = Math.atan2(s2.x - cx, -(s2.z - cz));
    const q = new THREE.Quaternion().setFromRotationMatrix(Rm), qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -gam);
    F.globe.quaternion.copy(qy.multiply(q)); F.globe.position.set(cx, -RE - drop(R1 + 1), cz);
  }

  function updMask(world) {
    const W = world.data.W, d = F.mask.image.data; d.fill(0); let n = 0;
    if (W.root && W.root.visible) for (const t of W.tiles.values()) { if (!t.terrain || !t.grp || !t.grp.parent || t.empty) continue; const c = t.tx - F.mask0[0], r = t.ty - F.mask0[1]; if (c < 0 || r < 0 || c >= 128 || r >= 128) continue; d[(r * 128 + c) * 4] = 255; n++; }
    F.mask.needsUpdate = true; F.stats.maskTiles = n;
  }
  function hideFlat(world, hide) { for (const t of world.data.W.tiles.values()) if (t.empty && t.grp) t.grp.visible = !hide; F.flatHidden = hide; }

  YZW.register({
    id: 'far', name: 'העין הגדולה: קרקע רחוקה וכדור הארץ (בלי וילונות וזיגזג)', dept: 'integration (eyecam)', order: 41, late: true,
    init(world, api) { F.grp = api.group(); F.grp.visible = false; F.world = world; },
    update(dt, world) {
      const v = F.view, on = !!(v && world.player.mode === 'dev' && v.alt > 90);
      if (!on) { if (F.on) { F.grp.visible = false; F.on = false; if (F.oceanHidden && F.ocean) { F.ocean.visible = true; F.oceanHidden = false; } hideFlat(world, false); if (world.sky) world.sky.visible = true; if (F.bg !== undefined) { world.scene.background = F.bg; F.bg = undefined; } } return; }
      if (!F.ready) { if (!F.loading && !F.err) load(world); return; }
      F.on = true; F.grp.visible = true;
      const t0 = performance.now();
      if (!F.at || Math.hypot(v.tx - F.at[0], v.tz - F.at[1]) > Math.max(300, v.alt * 0.08) || F.at[2] !== world.data.W.radius) {
        F.cap.geometry.dispose(); F.cap.geometry = buildCap(world, v.tx, v.tz); placeGlobe(world, v.tx, v.tz); F.at = [v.tx, v.tz, world.data.W.radius]; F.stats.rebuilds = (F.stats.rebuilds || 0) + 1; }
      if (F.rootVis !== world.data.W.root.visible) { F.rootVis = world.data.W.root.visible; F.maskT = 0; }
      F.maskT -= dt; if (F.maskT <= 0) { F.maskT = 0.25; updMask(world); hideFlat(world, true); }
      const sea = world.data.W.sea; F.U.uSeaBox.value.set(sea ? sea.position.x : 0, sea ? sea.position.z : 0, sea && sea.visible ? 7990 : 0);
      if (!F.ocean) F.ocean = world.scene.getObjectByName('maritime-ocean') || null;
      if (F.ocean) { const hide = v.alt > 1500; if (hide && F.ocean.visible) { F.ocean.visible = false; F.oceanHidden = true; } else if (!hide && F.oceanHidden) { F.ocean.visible = true; F.oceanHidden = false; } }
      F.cap.visible = v.alt < 2.5e6; F.globe.visible = v.alt > 30000;
      // חלל: מעל 60 ק"מ בלי כיפת השמיים, רקע כהה
      const space = v.alt > 60000;
      if (world.sky) world.sky.visible = !space;
      if (space) { if (F.bg === undefined) { F.bg = world.scene.background; F.space = new THREE.Color(0x03060d); } world.scene.background = F.space; }   // כל פריים: תוספים אחרים (אווירה/יופי) קובעים רקע משלהם
      else if (!space && F.bg !== undefined) { world.scene.background = F.bg; F.bg = undefined; }
      F.stats.ms = +(performance.now() - t0).toFixed(2);
    },
    dispose(world) { if (F.on) hideFlat(world, false); if (world.sky) world.sky.visible = true; if (F.bg !== undefined) world.scene.background = F.bg; F.on = false; },
  });
})();
