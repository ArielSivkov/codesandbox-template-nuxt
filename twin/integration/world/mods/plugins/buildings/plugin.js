/* plugins/buildings/plugin.js — תוסף "בניינים" לעולם המשולב (מחלקת התוספים, ESH27).
 *
 * מתאם בין מודול מחלקת הבניינים (swarm/buildings/src: typology.js, landmarks.js, facades.js — נבנה ל-ESHBuildings.attach(THREE, YZ) של מנוע גדוד 6)
 * לבין מנוע העולם W27 (swarm/game/js/world.js). לא נוגעים בקוד של אף אחד מהם:
 *   · לכל אריח ברמת פירוט קרובה (t.hi) בונים גאומטריה חדשה מאותם נתונים (t.blds) עם התכונות שהשיידר של מחלקת הבניינים צריך
 *     (afl = [בסיס בדצ"מ, גובה קומה בדצ"מ], afc = [u לאורך הקיר בדצ"מ, אורך הקיר בדצ"מ, טיפולוגיה ארוזה, זרע]) ומחליפים את t.hi.geometry/material
 *     — "setMaterials" של W27: אותה קריאת ציור לאריח (2 קבוצות: חזיתות+גגות שטוחים, גגות רעפים) במקום 3 של המשחק.
 *   · טיפולוגיה (TY.classify) דטרמיניסטית לפי מזהה הבניין: וילה/בית פרטי (≤2 קומות או טביעה קטנה) → גג רעפים אדום משופע, גינה, גדר ושער;
 *     שיכון/בלוק → מרפסות (בשיידר + לוחות תלת־ממדיים ליד השחקן) וגווני טיח שונים; מגדלים; חזית חנויות בקומת הקרקע מול שדרות (משוער, מסומן).
 *   · ציוד גג (דודי שמש, מיכלים, מזגנים, חדרי מדרגות) — ערכת הגאומטריות של מחלקת הבניינים, 4 InstancedMesh לכל העולם, רק ליד השחקן.
 *   · ציוני דרך מצוטטים (landmarks.js) + מגדלי הדקל (5 מגדלים, 29 קומות, ~92–102 מ׳) עם קו מקווקו "משוער" (ראו dekel.json).
 *   · וו חומרים (plugins/_common/mathooks.js → window.YZMAT): buildings.facade / buildings.roofTile / buildings.yard / buildings.kit —
 *     מחלקת השיידרים (look-pro) מחליפה בלי לבנות גאומטריה מחדש.
 * הכול "נגזר" מסומן בכרטיס הבניין (שורה "טיפוס") ובלוח המודולים.
 */
(function () {
  'use strict';
  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const BASE = SRC.replace(/[^/]*$/, '');
  const ID = 'buildings';
  const S = { on: false, world: null, api: null, TY: null, LM: null, FX: null, mats: null, MATS: null, U: null, tiles: new Map(), kit: {}, balc: null,
    nearT: 0, nearKey: '', dekel: null, dekelObjs: [], dekelMesh: null, dekelLines: null, labels: [], origNear: null, patched: new Map(), cardObs: null,
    tileHints: new Map(), hintSrc: null,
    capScale: 1, capT: 0,
    stats: { tiles: 0, buildings: 0, byCode: {}, byBasis: {}, villas: 0, yards: 0, pitched: 0, shops: 0, landmarks: 0, dekel: 0, buildMs: 0 }, unsub: [] };
  const CAPS = {
    low:    { kitR: 90,  balcR: 60,  solar: 150,  tank: 60,  ac: 120, stair: 70,  balc: 160,  wallac: 120, awn: 60,  yard: true, lite: false },   // חלונות/תריסים/מרפסות בשיידר גם בשכבה הנמוכה (הרדמי עובד בה)
    medium: { kitR: 200, balcR: 140, solar: 700,  tank: 200, ac: 500, stair: 220, balc: 700,  wallac: 450, awn: 220, yard: true, lite: false },
    high:   { kitR: 380, balcR: 260, solar: 2200, tank: 600, ac: 1500, stair: 600, balc: 2200, wallac: 1400, awn: 600, yard: true, lite: false },
  };
  const cap = () => { const c = CAPS[S.world.quality.tier] || CAPS.medium, k = S.capScale; if (k >= 0.999) return c; const o = {}; for (const x in c) o[x] = typeof c[x] === 'number' ? Math.round(c[x] * (x.endsWith('R') ? Math.sqrt(k) : k)) : c[x]; return o; };
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const hash32 = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  // אותו גיבוב כמו eh() בשיידר של מחלקת הבניינים (דיוק float — התאמה כמעט תמיד; אי־התאמה היא קוסמטית בלבד)
  const fr = x => x - Math.floor(x), F = Math.fround;
  function eh(px, py) { let x = fr(F(px * 0.1031)), y = fr(F(py * 0.1031)), z = fr(F(px * 0.1031)); const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33); x += d; y += d; z += d; return fr((x + y) * z); }

  // ------------------------------------------------------------ חומרים
  function tileRoofMat(THREE) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff });
    new THREE.TextureLoader().load(BASE + 'tex/roof_tiles_albedo_512.webp', tx => { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 2; m.map = tx; m.needsUpdate = true; }, undefined, () => {});
    m.name = 'yz-roof-tile'; return m;
  }
  // ------------------------------------------------------------ גיוון חזיתות (מעל השיידר של מחלקת הבניינים, בלי לשכפל אותו)
  /* מוזרק בהרכבת השיידר (onBeforeCompile עטוף): לוח צבעי טיח רחב (8 גוונים, משקלים — מספריית המראה של מחלקת למידת התמונות כשקיימת),
     חיפוי אבן (קומת קרקע / פסי תקרה / פינות / קומה עליונה בגוון שני), גיוון רוחב/גובה חלונות ומפרצים לכל בניין, צבע תריסי אלומיניום ומסגרות לכל בניין,
     ותדירות תריסים מוגפים משתנה. הכול דטרמיניסטי לפי הזרע (afc.w). הפרמטרים ב-uniforms → look-pro יכול לשנות בלי קומפילציה. */
  const LOOK = {   // ברירת מחדל: הנחה חזותית (proc) — מוחלפת ב-look-library.json כשמחלקת למידת התמונות מוסרת
    pal: [[0.93, 0.92, 0.88], [0.94, 0.88, 0.74], [0.88, 0.80, 0.64], [0.93, 0.81, 0.69], [0.81, 0.81, 0.79], [0.95, 0.90, 0.68], [0.91, 0.79, 0.75], [0.78, 0.83, 0.86]],
    palW: [0.24, 0.17, 0.13, 0.11, 0.12, 0.08, 0.08, 0.07],
    clad: [0.22, 0.38, 0.50, 0.62],    // מצטבר: קומת קרקע אבן · פסי תקרה · פינות · קומה עליונה בגוון שני (השאר: בלי)
    stone: [0.84, 0.77, 0.62],
    shut: [[0.80, 0.79, 0.74], [0.90, 0.90, 0.88], [0.62, 0.60, 0.56], [0.70, 0.66, 0.58]],
    frame: [[0.86, 0.86, 0.84], [0.30, 0.31, 0.33], [0.62, 0.62, 0.60], [0.45, 0.36, 0.28]],
    source: 'proc (הנחה חזותית; אין עדיין ספריית מראה)',
  };
  const VAR_HEAD = `
uniform vec3 uYzPal[8]; uniform float uYzCum[8]; uniform vec4 uYzClad; uniform vec3 uYzStone; uniform vec3 uYzShut[4]; uniform vec3 uYzFrame[4]; uniform float uYzVar;
vec3 yzPal(float pc) { vec3 c = uYzPal[7]; for (int i = 7; i >= 0; i--) { if (pc < uYzCum[i]) c = uYzPal[i]; } return c; }
`;
  const VAR_BLOCK = `
      // ---- yz: גיוון לכל בניין (plugins/buildings) ----
      float yzS = vAfc.w;
      if (uYzVar > 0.5) {
        bay *= 0.88 + 0.26 * eh(vec2(yzS * 0.017, 21.0)); ww *= 0.84 + 0.32 * eh(vec2(yzS * 0.023, 22.0)); wh *= 0.90 + 0.22 * eh(vec2(yzS * 0.029, 23.0));
        balP *= 0.70 + 0.60 * eh(vec2(yzS * 0.047, 28.0)); shutP *= 0.55 + 0.95 * eh(vec2(yzS * 0.053, 29.0));
      }
      int yzSi = int(floor(eh(vec2(yzS * 0.031, 24.0)) * 3.999)); vec3 shutC = uYzShut[0]; for (int i = 1; i < 4; i++) if (i == yzSi) shutC = uYzShut[i];
      int yzFi = int(floor(eh(vec2(yzS * 0.037, 25.0)) * 3.999)); vec3 frameC = uYzFrame[0]; for (int i = 1; i < 4; i++) if (i == yzFi) frameC = uYzFrame[i];
      if (uYzVar > 0.5 && code > 1.5 && code < 8.5 && matId < 1.5) {
        float cm = eh(vec2(yzS * 0.041, 26.0)), fyM = fy * fh; bool clad = false, tone = false;
        if (cm < uYzClad.x) clad = fi < 0.5;
        else if (cm < uYzClad.y) clad = fyM < 0.34 && fi >= 0.5 && fi < floors;
        else if (cm < uYzClad.z) clad = u < 1.15 || u > L - 1.15;
        else if (cm < uYzClad.w) tone = fi >= floors - 1.0;
        if (clad) { vec3 sc = uYzStone * (0.90 + 0.14 * eh(vec2(yzS * 0.043, 27.0)));
          if (uHasTex > 0.5) sc *= mix(1.0, texture2D(uTexS, vec2(u, vY) / 1.2).g / 0.62, 0.7);
          float jy = fract(vY / 0.30), jx = fract((u + step(0.5, fract(vY / 0.60)) * 0.30) / 0.60);
          float joint = clamp((1.0 - step(0.07, jy)) + (1.0 - step(0.035, jx)), 0.0, 1.0) * (1.0 - smoothstep(25.0, 80.0, vDist));
          alb = mix(sc, sc * 0.80, joint); }
        if (tone) alb = yzPal(fract(eh(vec2(yzS * 0.011, 4.1)) + 0.47)) * 0.97;
      }
`;
  function addVariety(mat) {
    const orig = mat.onBeforeCompile, U = mat.userData.uniforms, THREE = S.world.THREE;
    U.uYzPal = { value: LOOK.pal.map(c => new THREE.Vector3(...c)) }; U.uYzCum = { value: [] }; U.uYzClad = { value: new THREE.Vector4(...LOOK.clad) };
    U.uYzStone = { value: new THREE.Vector3(...LOOK.stone) }; U.uYzShut = { value: LOOK.shut.map(c => new THREE.Vector3(...c)) }; U.uYzFrame = { value: LOOK.frame.map(c => new THREE.Vector3(...c)) }; U.uYzVar = { value: 1 };
    setPalette(LOOK.pal, LOOK.palW);
    S.varMiss = [];
    mat.onBeforeCompile = (sh, r) => {
      orig(sh, r); Object.assign(sh.uniforms, U);
      const rep = (a, b, tag) => { const n = sh.fragmentShader.replace(a, b); if (n === sh.fragmentShader) S.varMiss.push(tag); sh.fragmentShader = n; };
      rep('#include <common>', '#include <common>\n' + VAR_HEAD, 'head');
      rep(/wallC = pc < 0\.30 \?[^;]*;/, 'wallC = yzPal(pc);', 'palette');
      rep('float nb = (L < 2.0 || ww <= 0.0)', VAR_BLOCK + '      float nb = (L < 2.0 || ww <= 0.0)', 'block');
      rep('vec3 shut = vec3(0.80, 0.79, 0.74) *', 'vec3 shut = shutC *', 'shutter');
      rep('if (fr > 0.5) featC = vec3(0.86, 0.86, 0.84);', 'if (fr > 0.5) featC = frameC;', 'frame');
      if (S.varMiss.length) console.warn('[plugins/buildings] variety injection partial:', S.varMiss.join(','));
    };
    const ck = mat.customProgramCacheKey; mat.customProgramCacheKey = () => ck() + '-yzvar1';
  }
  function setPalette(pal, w) {
    const THREE = S.world.THREE, U = S.U || (S.mats && S.mats.facade.userData.uniforms); if (!U || !U.uYzPal) return;
    const n = Math.min(8, pal.length); let tot = 0; for (let i = 0; i < n; i++) tot += w[i] || 0; let acc = 0; const cum = [];
    for (let i = 0; i < 8; i++) { if (i < n) { acc += (w[i] || 0) / (tot || 1); U.uYzPal.value[i] = new THREE.Vector3(...pal[i]); } else U.uYzPal.value[i] = U.uYzPal.value[n - 1]; cum.push(i < n - 1 ? acc : 1.01); }
    U.uYzCum.value = cum;
  }
  // ספריית מראה (swarm/photolearn → look/look-library.json דרך tools/assemble.sh): פורמט סובלני; מה שלא מזוהה נשאר ברירת מחדל
  async function loadLook() {
    let idx; try { idx = await (await fetch(BASE + 'look/index.json')).json(); } catch (e) { return; }
    if (!idx || !idx.available) { S.look = { source: LOOK.source }; return; }
    let L; try { L = await (await fetch(BASE + 'look/' + (idx.file || 'look-library.json'))).json(); } catch (e) { return; }
    const used = [], TY = S.TY, U = S.U;
    const hex = c => typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c) ? [0, 2, 4].map(i => parseInt(c.replace('#', '').substr(i, 2), 16) / 255) : Array.isArray(c) && c.length >= 3 ? c.map(v => v > 1 ? v / 255 : v) : null;
    const lin = c => c.map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));   // swatch ב-sRGB → ליניארי
    const palSrc = L.plaster_palette || L.palette || (L.colors && L.colors.plaster) || (L.global && L.global.plaster_palette);
    if (Array.isArray(palSrc) && palSrc.length) { const pal = [], w = [];
      for (const e of palSrc.slice(0, 8)) { const c = hex(e.rgb || e.hex || e.color || e.srgb || e); if (!c) continue; pal.push(e.linear ? c : lin(c).map(v => Math.min(0.97, v))); w.push(+e.freq || +e.weight || +e.p || 1); }
      if (pal.length >= 2) { setPalette(pal, w); used.push('plaster_palette×' + pal.length); } }
    const per = L.typology || L.by_typology || L.per_typology || {};
    const NAME = { villa: TY.T.VILLA, walkup: TY.T.WALKUP, shikun: TY.T.WALKUP, rakevet: TY.T.RAKEVET, block: TY.T.BLOCK, tower: TY.T.TOWER, commercial: TY.T.COMMERCIAL, public: TY.T.PUBLIC };
    for (const k in per) { const code = NAME[k] != null ? NAME[k] : (+k >= 0 ? +k : null), P = code != null && TY.FACADE[code], f = per[k]; if (!P || !f) continue;
      const g = (...ks) => { for (const kk of ks) { const v = f[kk]; if (v != null && isFinite(+(v.p != null ? v.p : v.freq != null ? v.freq : v))) return clamp(+(v.p != null ? v.p : v.freq != null ? v.freq : v), 0, 1); } return null; };
      const m = { balc: g('balcony', 'balconies', 'balc'), closed: g('closed_balcony', 'balcony_closed', 'closed'), shut: g('shutters_closed', 'shutter', 'shutters'), ac: g('ac_unit', 'ac', 'ac_units'), pil: g('pilotis', 'pil') };
      for (const kk in m) if (m[kk] != null) { P[kk] = m[kk]; used.push(k + '.' + kk); }
      const cl = g('stone_cladding', 'cladding', 'stone'); if (cl != null && U && U.uYzClad) { const v = U.uYzClad.value, k2 = cl / Math.max(0.01, v.w); v.set(v.x * k2, v.y * k2, v.z * k2, v.w * k2); used.push(k + '.cladding'); }
    }
    if (used.length && S.mats) S.mats.facade.needsUpdate = true;   // FACADE נאפה לשיידר בהרכבה → הרכבה מחדש
    S.look = { source: 'look-library.json' + (L.version ? ' v' + L.version : ''), used };
  }

  function makeMats(THREE) {
    const FX = S.FX, lite = cap().lite;
    const facade = FX.createFacadeMaterial(THREE, { texBase: BASE + 'tex/', lite });
    S.U = facade.userData.uniforms; addVariety(facade);
    const roofTile = tileRoofMat(THREE);
    const yard = new THREE.MeshLambertMaterial({ vertexColors: true }); yard.name = 'yz-yard';
    const kit = new THREE.MeshLambertMaterial({ vertexColors: true }); kit.name = 'yz-kit';
    const rail = new THREE.MeshLambertMaterial({ vertexColors: true, map: barsTex(THREE), alphaTest: 0.5, side: THREE.DoubleSide }); rail.name = 'yz-rail';
    const awning = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); awning.name = 'yz-awning';
    const line = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: 0.9, depthWrite: false });
    const lineC = new THREE.LineDashedMaterial({ color: 0xf2b84b, dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: 0.95, depthWrite: false });
    S.U = facade.userData.uniforms;
    return { facade, roofTile, yard, kit, rail, awning, line, lineC };
  }
  function hookMats() {
    const Y = window.YZMAT, m = S.mats;
    Y.provide('buildings.facade', m.facade, { owner: ID, note: 'שיידר החזיתות של מחלקת הבניינים. תכונות: position, normal, color, afl(vec2: בסיס דצ"מ, גובה קומה דצ"מ; 0=גג/קיר בלי קומות), afc(vec4 Int16: u דצ"מ, אורך קיר דצ"מ, pack(code|floors<<4|pil<<10|shop<<11|mat<<12), זרע). uniforms: uNight, uLit, uDetail, uHide', attrs: ['afl', 'afc', 'color'] });
    Y.provide('buildings.roofTile', m.roofTile, { owner: ID, note: 'גגות רעפים משופעים (וילות). uv במטרים (u לאורך המרזב, v במעלה השיפוע), color = גוון לבניין', attrs: ['uv', 'color'] });
    Y.provide('buildings.yard', m.yard, { owner: ID, note: 'גינות, גדרות ושערים של וילות (צבעי קודקוד)', attrs: ['color'] });
    Y.provide('buildings.kit', m.kit, { owner: ID, note: 'ציוד גג + מרפסות טיח/זכוכית + מזגנים תלויים (InstancedMesh, צבעי קודקוד × instanceColor)', attrs: ['color', 'instanceColor'] });
    Y.provide('buildings.rail', m.rail, { owner: ID, note: 'מרפסות עם מעקה מוטות (map: חצי תחתון אטום, חצי עליון מוטות; alphaTest)', attrs: ['uv', 'color', 'instanceColor'] });
    Y.provide('buildings.awning', m.awning, { owner: ID, note: 'סוככי חנויות (instanceColor = צבע הבד)', attrs: ['color', 'instanceColor'] });
    const sw = (slot, set) => S.unsub.push(Y.on(slot, nw => { if (nw) set(nw); }));
    sw('buildings.facade', nw => { S.MATS[0] = nw; if (S.dekelMesh) S.dekelMesh.material = S.MATS; if (nw.userData && nw.userData.uniforms) S.U = nw.userData.uniforms; });
    sw('buildings.roofTile', nw => { S.MATS[1] = nw; });
    sw('buildings.yard', nw => { for (const r of S.tiles.values()) if (r.yard) r.yard.material = nw; });
    sw('buildings.kit', nw => { for (const k in S.kit) S.kit[k].material = nw; for (const m of [S.balc, S.wallac, S.stand]) if (m) m.material = nw; });
    sw('buildings.rail', nw => { if (S.bars) S.bars.material = nw; }); sw('buildings.awning', nw => { if (S.awn) S.awn.material = nw; });
  }

  // ------------------------------------------------------------ טיפולוגיה לבניין (דטרמיניסטית לפי מזהה)
  function obb(b) {   // מלבן חוסם מכוון לפי הקיר הארוך ביותר (קואורדינטות סצנה)
    const p = b.p, n = b.n; let best = 0, ux = 1, uz = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = p[j * 2] - p[i * 2], dz = p[j * 2 + 1] - p[i * 2 + 1], L = Math.hypot(dx, dz); if (L > best) { best = L; ux = dx / L; uz = dz / L; } }
    const vx = -uz, vz = ux; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let i = 0; i < n; i++) { const x = p[i * 2], z = p[i * 2 + 1], u = x * ux + z * uz, v = x * vx + z * vz; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    if (u1 - u0 < v1 - v0) { return obbSwap(ux, uz, u0, u1, v0, v1); }
    return { ux, uz, vx, vz, u0, u1, v0, v1, len: u1 - u0, wid: v1 - v0 };
  }
  function obbSwap(ux, uz, u0, u1, v0, v1) { return { ux: -uz, uz: ux, vx: -ux, vz: -uz, u0: v0, u1: v1, v0: -u1, v1: -u0, len: v1 - v0, wid: u1 - u0 }; }
  const P2 = (o, u, v) => [o.ux * u + o.vx * v, o.uz * u + o.vz * v];

  function mainRoadGrid(t) {   // נקודות דרכים ראשיות (סוג ≥ 3) ברשת 20 מ' — לזיהוי חזית מסחרית מול שדרה
    const g = new Map(), G = 20;
    for (const r of t.roads || []) { if (r.c < 3) continue; const p = r.p; for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3], L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / 6));
      for (let s = 0; s <= k; s++) { const x = ax + (bx - ax) * s / k, z = az + (bz - az) * s / k, key = Math.floor(x / G) + ',' + Math.floor(z / G); let a = g.get(key); if (!a) g.set(key, a = []); a.push(x, z); } } }
    return (x, z) => { let bd = 1e9; const cx = Math.floor(x / G), cz = Math.floor(z / G); for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const L = g.get((cx + a) + ',' + (cz + c)); if (L) for (let i = 0; i < L.length; i += 2) bd = Math.min(bd, Math.hypot(L[i] - x, L[i + 1] - z)); } return bd; };
  }
  // ------------------------------------------------------------ רמזים מבחוץ (מחלקת הנתונים האמיתיים swarm/realdata: גבהים v2, טיפוס, נקודות עניין)
  /* מקורות שנקראים (הראשון שעונה גובר), בלי שום בקשת רשת מיוזמתנו (אין 404 בקונסול):
       world.providers.buildingHints  — פונקציה (id, b, tileKey) → רמז | Map | אובייקט {id: רמז} | {get(id)}
       world.providers.realdata.buildingHints — אותו דבר ; world.providers.realdata.tileHints(tileKey) → Promise<{id: רמז}> (נטען פעם אחת לאריח)
       YZBuildings.setHints(מקור) — אותו דבר, ידני
     רמז: { ty|typology: קוד 0–10 או שם (villa/walkup/rakevet/block/tower/commercial/public/industrial/annex), floors, h|height_m (מ' עד הגג),
            gf|shops: 1/0, m|material: 0–3 או plaster/stone/concrete/glass, rs|roof: flat/gabled/hipped/pyramidal/tile, src, conf }
     (שדות ty/gf/m/rs/fs זהים ל-pipeline-facades.patch של מחלקת הבניינים). כשמגיע אירוע 'buildingHints' או 'realdata' על האפיק — האריחים נבנים מחדש. */
  const TY_NAME = { villa: 1, house: 1, cottage: 1, detached: 1, walkup: 2, shikun: 2, residential: 2, rakevet: 3, block: 4, midrise: 4, tower: 5, highrise: 5, commercial: 6, retail: 6, mall: 6, public: 7, civic: 7, industrial: 8, warehouse: 8, annex: 9, shed: 9, landmark: 10 };
  const MAT_NAME = { plaster: 0, stone: 1, limestone: 1, concrete: 2, metal: 2, glass: 3 };
  function hintFor(b) {
    const p = S.world.providers, srcs = [S.hintSrc, p.buildingHints, p.realdata && p.realdata.buildingHints];
    for (const src of srcs) { if (!src) continue; let h = null;
      try { if (typeof src === 'function') h = src(b.id, b, b.tile); else if (src instanceof Map) h = src.get(b.id); else if (typeof src.get === 'function') h = src.get(b.id); else h = src[b.id]; } catch (e) { h = null; }
      if (h) return h; }
    const th = S.tileHints.get(b.tile); return th && th !== 'loading' ? th[b.id] || null : null;
  }
  function wantTileHints(t) {
    const r = S.world.providers.realdata; if (!r || typeof r.tileHints !== 'function' || S.tileHints.has(t.key)) return;
    S.tileHints.set(t.key, 'loading');
    Promise.resolve().then(() => r.tileHints(t.key)).then(h => { if (!S.on) return; S.tileHints.set(t.key, h || {}); if (h && Object.keys(h).length) rebuildTile(t); }).catch(() => S.tileHints.set(t.key, {}));
  }
  function rebuildTile(t) { if (!t || !t.hi || !t.blds) return; for (const b of t.blds) delete b._yz; const r = S.tiles.get(t.key); if (r && r.yard) { t.grp.remove(r.yard); r.yard.geometry.dispose(); } S.tiles.delete(t.key); t.hi.userData.yzb = false; applyTile(t); }
  function rebuildAll() { for (const r of [...S.tiles.values()]) rebuildTile(r.t); S.nearKey = ''; }

  function classifyB(b, nearMain) {
    if (b._yz) return b._yz;
    const TY = S.TY, T = TY.T, LM = S.LM, o = obb(b), seed = TY.seedOf(b.id), D = S.dekelById && S.dekelById.get(b.id);
    const hint = hintFor(b), flagsInf = [];
    if (hint) { // גבהים v2: גוברים על כלל האצבע (אבל לא על גובה מצוטט של ציון דרך)
      const hh = +(hint.h != null ? hint.h : hint.height_m), hf = +hint.floors;
      if (hf > 0 || hh > 0) patchHeight(b, hh > 0 ? hh : hf * 3 + 1, hf > 0 ? Math.round(hf) : Math.max(1, Math.round(hh / 3.1)));
      if (hf > 0 || hh > 0) b.src = 'D';
    }
    let cls = TY.classify({ typ: b.type, name: b.name, area: b.area, floors: b.floors, h: b.h, len: o.len, wid: o.wid, floorsSrc: b.src });
    let floors = b.floors || Math.max(1, Math.round(b.h / 3));
    const hTy = hint ? (typeof (hint.ty != null ? hint.ty : hint.typology) === 'number' ? (hint.ty != null ? hint.ty : hint.typology) : TY_NAME[String(hint.ty || hint.typology || '').toLowerCase()]) : undefined;
    // וילה / בית פרטי: ≤2 קומות או טביעה קטנה (כלל המשימה) — מגורים בלבד
    const resid = !b.ind && ![T.COMMERCIAL, T.PUBLIC, T.INDUSTRIAL, T.ANNEX].includes(cls.code);
    if (hTy != null && hTy >= 0 && hTy <= 10) cls = { code: hTy, he: TY.T_HE[hTy], basis: 'data', why: 'רמז ממחלקת הנתונים האמיתיים' + (hint.src ? ' (' + hint.src + ')' : '') };
    else if (cls.code !== T.VILLA && resid && b.area >= 40 && ((floors <= 2 && b.area < 400) || (b.area < 150 && floors <= 3))) { cls = { code: T.VILLA, he: TY.T_HE[T.VILLA], basis: 'shape', why: floors + ' קומות, ' + Math.round(b.area) + ' מ"ר (כלל: ≤2 קומות או טביעה קטנה)' }; }
    let lm = LM.landmarkOf(b.id), tgt = LM.targetHeight(lm);
    if (!lm && !D && LM.BY_POINT && !(hint && (+hint.h > 0 || +hint.height_m > 0 || +hint.floors > 0))) {   // מגדלים לפי נקודה (משוער)
      const W27 = window.W27; if (W27 && W27.toScene) {
        for (const pt of LM.BY_POINT) { if (!pt._sc) pt._sc = W27.toScene(pt.itm[0], pt.itm[1]);
          if (Math.hypot(b.cx - pt._sc.x, b.cz - pt._sc.z) > pt.r) continue;
          if (pt._b && pt._b !== b && (pt._b.area || 0) >= (b.area || 0)) continue;   // רק הטביעה הגדולה ברדיוס
          pt._b = b; lm = { id: b.id, he: pt.he, floors: pt.floors, h: pt.h, conf: pt.conf, src: pt.src, note: 'גובה משוער מקומות (ג׳מיני)' }; tgt = { h: pt.h, basis: 'proc' }; break; }
      }
    }
    if (D) { lm = { id: b.id, he: D.he, floors: S.dekel.floors, h: S.dekel.h, conf: D.osm ? 'candidate' : 'estimated', src: S.dekel.sources.map(s => s.url), note: D.note }; tgt = { h: S.dekel.h, basis: 'data' }; }
    if (lm && tgt) {
      const hintH = hint && (+hint.h > 0 || +hint.height_m > 0 || +hint.floors > 0);
      if (!(hintH && tgt.basis === 'proc')) { floors = lm.floors || floors; patchHeight(b, tgt.h, floors); }   // גובה מצוטט גובר; "קומות × 3.3" נכנע לגבהים v2
      if (lm.h || (lm.floors && lm.floors >= 11)) cls = { code: D ? T.TOWER : T.LANDMARK, he: lm.he, basis: 'data', why: D ? 'מגדלי הדקל — התאמת טביעה משוערת' : 'ציון דרך מצוטט' };
      S.stats.landmarks++;
    }
    let shops; const hShop = hint ? (hint.gf != null ? hint.gf : hint.shops) : undefined;
    if (hShop != null) shops = !!+hShop || hShop === true;
    else if (/retail|commercial|supermarket|kiosk/.test(b.type)) shops = true;
    else if ([T.WALKUP, T.RAKEVET, T.BLOCK, T.TOWER].includes(cls.code) && floors >= 3 && nearMain && TY.rnd(seed, 41) < 0.55) {
      const p = b.p, n = b.n; for (let i = 0; i < n && !shops; i++) { const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], dx = p[j * 2] - ax, dz = p[j * 2 + 1] - az, L = Math.hypot(dx, dz); if (L < 7) continue;
        const nx = -dz / L, nz = dx / L; if (nearMain(ax + dx / 2 + nx * 6, az + dz / 2 + nz * 6) < 14) shops = true; }
      if (shops) flagsInf.push('חנויות בקומת הקרקע (משוער: חזית לשדרה)');
    }
    const flags = TY.facadeFlags(cls.code, seed, shops);
    if (hint) { const hm = hint.m != null ? hint.m : hint.material; const mi = typeof hm === 'number' ? hm : MAT_NAME[String(hm || '').toLowerCase()]; if (mi != null && mi >= 0 && mi <= 7) flags.mat = mi; }
    const villa = cls.code === T.VILLA;
    const rs = hint ? String(hint.rs || hint.roof || '').toLowerCase() : '';
    const pitched = rs ? /gabl|hip|pyram|tile|pitch|mansard|gambrel/.test(rs) && o.wid >= 3 : villa && o.wid >= 4 && o.wid <= 22 && o.len <= 40;
    if (rs && pitched) cls.why += ' · גג ' + rs + ' (נתון)';
    const fh = lm && tgt ? tgt.h / Math.max(1, floors) : clamp((b.h - (floors >= 3 ? 1 : 0.3)) / Math.max(1, floors), 2.6, 4.5);
    const info = { code: cls.code, he: cls.he, basis: cls.basis, why: cls.why, floors, fh, flags, seed, o, lm, villa, pitched, inferred: flagsInf, hint: !!hint,
      hip: rs ? /hip|pyram/.test(rs) : TY.rnd(seed, 31) < 0.62, packed: TY.pack(cls.code, floors, flags) };
    b._yz = info; return info;
  }
  function patchHeight(b, H, floors) {
    if (!S.patched.has(b)) S.patched.set(b, { h: b.h, top: b.top, floors: b.floors, conf: b.conf });
    b.h = H; b.top = b.base + H; b.floors = floors;
  }

  // ------------------------------------------------------------ בניית גאומטריה לאריח
  function Arr() { return { p: [], n: [], c: [], fl: [], ac: [], uv: [] }; }
  const NEUT = [0.93, 0.91, 0.87];
  function pushWall(A, ax, az, bx, bz, y0, y1, nx, nz, I, b, cTop, cBot, flY, Ld) {
    A.p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    for (let k = 0; k < 6; k++) A.n.push(nx, 0, nz);
    A.c.push(...cBot, ...cBot, ...cTop, ...cBot, ...cTop, ...cTop);
    const bd = Math.round(b.base * 10), fd = flY;
    for (let k = 0; k < 6; k++) A.fl.push(bd, fd);
    const L = Math.min(32767, Ld), pk = I.packed, sd = I.seed;
    A.ac.push(0, L, pk, sd, L, L, pk, sd, L, L, pk, sd, 0, L, pk, sd, L, L, pk, sd, 0, L, pk, sd);
  }
  function pushTri(A, a, b2, c, nrm, col, I, base, uvs) {
    A.p.push(a[0], a[1], a[2], b2[0], b2[1], b2[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) { A.n.push(nrm[0], nrm[1], nrm[2]); A.c.push(col[0], col[1], col[2]); }
    if (A.fl) { const bd = Math.round(base * 10); for (let k = 0; k < 3; k++) { A.fl.push(bd, 0); A.ac.push(0, 0, I.packed, I.seed); } }
    if (uvs) A.uv.push(...uvs);
  }
  function triNormal(a, b, c) { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; }

  const TILE_COL = [[1.0, 0.98, 0.96], [0.86, 0.80, 0.78], [1.06, 0.98, 0.90], [0.90, 0.88, 0.86], [0.96, 0.86, 0.80]];
  function pitchedRoof(F, R, b, I) {   // גג רעפים (ארבעה שיפועים או גמלון) על המלבן החוסם, בולט 0.35 מ'
    const o = I.o, ov = 0.35, u0 = o.u0 - ov, u1 = o.u1 + ov, v0 = o.v0 - ov, v1 = o.v1 + ov, w = v1 - v0, hw = w / 2, vm = (v0 + v1) / 2;
    const pitch = (24 + 8 * S.TY.rnd(I.seed, 33)) * Math.PI / 180, rise = Math.min(3.4, hw * Math.tan(pitch)), ye = b.top - 0.25, yr = ye + rise;
    const col = TILE_COL[I.seed % TILE_COL.length], hip = I.hip && (u1 - u0) > w * 0.9;
    const E = (u, v, y) => { const q = P2(o, u, v); return [q[0], y, q[1]]; };
    const A = E(u0, v0, ye), B = E(u1, v0, ye), C = E(u1, v1, ye), D = E(u0, v1, ye);
    const ru0 = hip ? Math.min(u0 + hw, (u0 + u1) / 2) : u0, ru1 = hip ? Math.max(u1 - hw, (u0 + u1) / 2) : u1;
    const R1 = E(ru0, vm, yr), R2 = E(ru1, vm, yr), slope = Math.hypot(hw, rise);
    const uvq = (P, e0, du) => { // u לאורך המרזב (מ'), v במעלה השיפוע (מ')
      const s = (P[0] - e0[0]) * du[0] + (P[2] - e0[2]) * du[1]; return [s, (P[1] - ye) / rise * slope]; };
    const face = (pts, e0, du) => { for (let i = 1; i + 1 < pts.length; i++) { let a = pts[0], bb = pts[i], c = pts[i + 1]; let nrm = triNormal(a, bb, c); if (nrm[1] < 0) { const t = bb; bb = c; c = t; nrm = [-nrm[0], -nrm[1], -nrm[2]]; }
      pushTri(R, a, bb, c, nrm, col, I, b.base, [...uvq(a, e0, du), ...uvq(bb, e0, du), ...uvq(c, e0, du)]); } };
    const du = [o.ux, o.uz], dv = [o.vx, o.vz];
    face([A, B, R2, R1], A, du); face([C, D, R1, R2], C, [-o.ux, -o.uz]);
    if (hip) { face([D, A, R1], D, [-dv[0], -dv[1]]); face([B, C, R2], B, dv); }
    else { // קירות גמלון משולשים (טיח, בלי קומות)
      for (const [a, bb, c] of [[D, A, R1], [B, C, R2]]) { let nrm = triNormal(a, bb, c); let x = bb, y = c; if (nrm[1] > 0.01) { x = c; y = bb; nrm = triNormal(a, x, y); }
        const n2 = [nrm[0], 0, nrm[2]]; const l = Math.hypot(n2[0], n2[2]) || 1; pushTri(F, a, x, y, [n2[0] / l, 0, n2[2] / l], NEUT, I, b.base); } }
    S.stats.pitched++;
  }
  // גינה + גדר + שער לווילה: מלבן חוסם מורחב (3 / 2 / 1.2 מ') שלא עולה על כביש או בניין שכן
  const HEDGE = [[0.17, 0.32, 0.12], [0.21, 0.37, 0.15], [0.15, 0.28, 0.13]];
  const YCOL = { grass: [[0.33, 0.47, 0.22], [0.38, 0.52, 0.25], [0.30, 0.43, 0.21]], pave: [[0.72, 0.68, 0.60], [0.66, 0.63, 0.58]],
    wall: [[0.92, 0.91, 0.88], [0.80, 0.74, 0.62], [0.24, 0.24, 0.25], [0.85, 0.85, 0.83]], gate: [[0.12, 0.13, 0.14], [0.20, 0.17, 0.14], [0.55, 0.57, 0.58]] };
  function yardFor(Y, b, I) {
    const W = S.world.data.W, o = I.o, TY = S.TY;
    let g = 0;
    for (const e of [3.0, 2.0, 1.2]) {
      const pts = []; for (const [u, v] of [[o.u0 - e, o.v0 - e], [o.u1 + e, o.v0 - e], [o.u1 + e, o.v1 + e], [o.u0 - e, o.v1 + e], [(o.u0 + o.u1) / 2, o.v0 - e], [(o.u0 + o.u1) / 2, o.v1 + e], [o.u0 - e, (o.v0 + o.v1) / 2], [o.u1 + e, (o.v0 + o.v1) / 2]]) pts.push(P2(o, u, v));
      let ok = true; for (const [x, z] of pts) { if (W.onRoad(x, z)) { ok = false; break; } const ob = W.buildingAt(x, z); if (ob && ob !== b) { ok = false; break; } }
      if (ok) { g = e; break; }
    }
    if (!g) return false;
    const u0 = o.u0 - g, u1 = o.u1 + g, v0 = o.v0 - g, v1 = o.v1 + g, H = (x, z) => W.H(x, z);
    const corner = (u, v, lift) => { const q = P2(o, u, v); return [q[0], H(q[0], q[1]) + lift, q[1]]; };
    const paved = TY.rnd(I.seed, 51) < 0.25, gc = paved ? YCOL.pave[I.seed % 2] : YCOL.grass[I.seed % 3];
    const a = corner(u0, v0, 0.07), bb = corner(u1, v0, 0.07), c = corner(u1, v1, 0.07), d = corner(u0, v1, 0.07);
    for (const [p1, p2, p3] of [[a, bb, c], [a, c, d]]) { let nrm = triNormal(p1, p2, p3), x = p2, y = p3; if (nrm[1] < 0) { x = p3; y = p2; nrm = [-nrm[0], -nrm[1], -nrm[2]]; } pushTri(Y, p1, x, y, nrm, gc, null, 0); }
    // גדר: קיר נמוך 0.9–1.3 מ' סביב הגינה, שער 1.4 מ' בצד הפונה לכביש
    const r57 = TY.rnd(I.seed, 57), style = r57 < 0.30 ? 0 : r57 < 0.48 ? 1 : r57 < 0.78 ? 2 : 3;   // 0 קיר טיח · 1 קיר אבן · 2 קיר נמוך + גדר חיה · 3 גדר חיה בלבד
    const wc = style === 1 ? YCOL.wall[1] : YCOL.wall[[0, 3, 0, 2][(I.seed >> 2) % 4]], gtc = YCOL.gate[(I.seed >> 4) % 3], fh = 0.9 + 0.4 * TY.rnd(I.seed, 53), th = style === 1 ? 0.3 : 0.16;
    const sides = [[u0, v0, u1, v0, 0, -1], [u1, v0, u1, v1, 1, 0], [u1, v1, u0, v1, 0, 1], [u0, v1, u0, v0, -1, 0]];
    let gs = -1, gd = 1e9;
    for (let s = 0; s < 4; s++) { const [su0, sv0, su1, sv1, nu, nv] = sides[s]; const m = P2(o, (su0 + su1) / 2 + nu * 4, (sv0 + sv1) / 2 + nv * 4); const r = W.onRoad(m[0], m[1]); if (r) { const d2 = 0; if (d2 < gd) { gd = d2; gs = s; break; } } }
    if (gs < 0) gs = 0;
    for (let s = 0; s < 4; s++) {
      const [su0, sv0, su1, sv1, nu, nv] = sides[s], L = Math.hypot(su1 - su0, sv1 - sv0); if (L < 0.5) continue;
      const segs = s === gs && L > 3 ? [[0, L / 2 - 0.7], [L / 2 + 0.7, L]] : [[0, L]];
      const du = (su1 - su0) / L, dv = (sv1 - sv0) / L;
      for (const [s0, s1] of segs) {
        const ua = su0 + du * s0, va = sv0 + dv * s0, ub = su0 + du * s1, vb = sv0 + dv * s1;
        if (style !== 3) fenceSeg(Y, o, ua, va, ub, vb, nu, nv, style === 2 ? 0.6 : fh, th, wc, H);          // קיר טיח/אבן (נמוך כשיש גדר חיה מאחוריו)
        if (style >= 2) { const ins = style === 2 ? 0.55 : 0.05, hc = HEDGE[(I.seed >> 5) % 3];                // גדר חיה (שיחים), בפנים
          fenceSeg(Y, o, ua - nu * ins + du * 0.3, va - nv * ins + dv * 0.3, ub - nu * ins - du * 0.3, vb - nv * ins - dv * 0.3, nu, nv, 1.35 + 0.35 * TY.rnd(I.seed, 55 + s), 0.65, hc, H); }
      }
      if (s === gs && L > 3) { // שער: לוח מתכת כהה בפתח
        const g0 = P2(o, su0 + du * (L / 2 - 0.7), sv0 + dv * (L / 2 - 0.7)), g1 = P2(o, su0 + du * (L / 2 + 0.7), sv0 + dv * (L / 2 + 0.7)), y0 = H(g0[0], g0[1]) + 0.05, y1 = y0 + fh + 0.25;
        const nn = P2(o, nu, nv);
        quadV(Y, g0, g1, y0, y1, nn, gtc); quadV(Y, g1, g0, y0, y1, [-nn[0], -nn[1]], gtc);
      }
    }
    S.stats.yards++; return true;
  }
  function quadV(Y, a, b2, y0, y1, nn, col) { const A = [a[0], y0, a[1]], B = [b2[0], y0, b2[1]], C = [b2[0], y1, b2[1]], D = [a[0], y1, a[1]]; const n3 = [nn[0], 0, nn[1]];
    let t = triNormal(A, B, C); if (t[0] * n3[0] + t[2] * n3[2] < 0) { pushTri(Y, A, C, B, n3, col, null, 0); pushTri(Y, A, D, C, n3, col, null, 0); } else { pushTri(Y, A, B, C, n3, col, null, 0); pushTri(Y, A, C, D, n3, col, null, 0); } }
  function fenceSeg(Y, o, ua, va, ub, vb, nu, nv, fh, th, col, H) {
    const a = P2(o, ua, va), b2 = P2(o, ub, vb), nn = P2(o, nu, nv), ia = P2(o, ua - nu * th, va - nv * th), ib = P2(o, ub - nu * th, vb - nv * th);
    const y0 = Math.min(H(a[0], a[1]), H(b2[0], b2[1])) - 0.1, y1 = y0 + 0.1 + fh;
    quadV(Y, a, b2, y0, y1, nn, col); quadV(Y, ib, ia, y0, y1, [-nn[0], -nn[1]], col);
    const top = [col[0] * 0.92, col[1] * 0.92, col[2] * 0.92];
    pushTri(Y, [a[0], y1, a[1]], [b2[0], y1, b2[1]], [ib[0], y1, ib[1]], [0, 1, 0], top, null, 0); pushTri(Y, [a[0], y1, a[1]], [ib[0], y1, ib[1]], [ia[0], y1, ia[1]], [0, 1, 0], top, null, 0);
  }
  function fixUp(Y) { // משולשים שפונים למטה בגלל סדר קודקודים → הופכים (כדי שלא ייחתכו ב-backface culling)
    const p = Y.p, n = Y.n; for (let i = 0; i < p.length; i += 9) { const a = [p[i], p[i + 1], p[i + 2]], b2 = [p[i + 3], p[i + 4], p[i + 5]], c = [p[i + 6], p[i + 7], p[i + 8]], t = triNormal(a, b2, c);
      if (t[0] * n[i] + t[1] * n[i + 1] + t[2] * n[i + 2] < 0) { for (let k = 0; k < 3; k++) { const x = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = x; } } } }

  function buildTile(t) {
    const THREE = S.world.THREE, t0 = performance.now(), TY = S.TY;
    const F = Arr(), R = { p: [], n: [], c: [], uv: [] }, Y = { p: [], n: [], c: [] };
    const nearMain = mainRoadGrid(t), v2 = [];
    const doYard = cap().yard;
    for (const b of t.blds) {
      if (!b.n || b.n < 3) continue;
      const I = classifyB(b, nearMain);
      S.stats.buildings++; S.stats.byCode[I.code] = (S.stats.byCode[I.code] || 0) + 1; S.stats.byBasis[I.basis] = (S.stats.byBasis[I.basis] || 0) + 1;
      if (I.villa) S.stats.villas++; if (I.flags.shop) S.stats.shops++;
      const p = b.p, n = b.n, y0 = b.base - 0.6, y1 = I.pitched ? b.top - 0.25 : b.top, flY = Math.round(I.fh * 10);
      const sh0 = 0.80, cBot = [NEUT[0] * sh0, NEUT[1] * sh0, NEUT[2] * sh0];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
        const nx = -dz / L, nz = dx / L, sh = 0.94 + 0.06 * Math.abs(nx), cTop = [NEUT[0] * sh, NEUT[1] * sh, NEUT[2] * sh];
        pushWall(F, ax, az, bx, bz, y0, y1, nx, nz, I, b, cTop, cBot, flY, Math.round(L * 10));
      }
      if (I.pitched) pitchedRoof(F, R, b, I);
      else { // גג שטוח (השיידר מזהה לפי normal.y)
        v2.length = 0; for (let i = 0; i < n; i++) v2.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
        let tri; try { tri = THREE.ShapeUtils.triangulateShape(v2, []); } catch (e) { tri = []; }
        const rc = [0.86, 0.85, 0.83];
        for (const tr of tri) { const a = v2[tr[0]], bb = v2[tr[1]], c = v2[tr[2]], cr = (bb.y - a.y) * (c.x - a.x) - (bb.x - a.x) * (c.y - a.y), seq = cr > 0 ? [a, bb, c] : [a, c, bb];
          pushTri(F, [seq[0].x, y1, seq[0].y], [seq[1].x, y1, seq[1].y], [seq[2].x, y1, seq[2].y], [0, 1, 0], rc, I, b.base); }
      }
      if (I.villa && doYard) yardFor(Y, b, I);
    }
    // גאומטריה: קבוצה 0 = חזיתות + גגות שטוחים (buildings.facade), קבוצה 1 = רעפים (buildings.roofTile)
    const nF = F.p.length / 3, nR = R.p.length / 3, geo = new THREE.BufferGeometry();
    const pos = new Float32Array((nF + nR) * 3); pos.set(F.p); pos.set(R.p, nF * 3);
    const nrm = new Float32Array((nF + nR) * 3); nrm.set(F.n); nrm.set(R.n, nF * 3);
    const col = new Float32Array((nF + nR) * 3); col.set(F.c); col.set(R.c, nF * 3);
    const afl = new Int16Array((nF + nR) * 2); afl.set(F.fl);
    const afc = new Int16Array((nF + nR) * 4); afc.set(F.ac);
    const uv = new Float32Array((nF + nR) * 2); uv.set(R.uv, nF * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('afl', new THREE.BufferAttribute(afl, 2)); geo.setAttribute('afc', new THREE.BufferAttribute(afc, 4)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.addGroup(0, nF, 0); if (nR) geo.addGroup(nF, nR, 1);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    let yard = null;
    if (Y.p.length) { fixUp(Y); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Y.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Y.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Y.c, 3)); g.computeBoundingSphere();
      yard = new THREE.Mesh(g, S.mats.yard); yard.name = 'yz-yard'; yard.receiveShadow = true; }
    S.stats.buildMs += performance.now() - t0;
    return { geo, yard, tris: (nF + nR) / 3 + Y.p.length / 9 };
  }
  function applyTile(t) {
    if (!t || !t.hi || !t.blds || t.hi.userData.yzb) return;
    const r = buildTile(t);
    const old = t.hi.geometry; t.hi.geometry = r.geo; old.dispose();
    t.hi.material = S.MATS; t.hi.userData.yzb = true; t.hiTris = r.tris;
    if (r.yard) t.grp.add(r.yard);
    S.tiles.set(t.key, { t, yard: r.yard }); S.stats.tiles++; S.nearKey = '';
    syncTileVis(t);
  }
  function syncTileVis(t) {
    const r = S.tiles.get(t.key); if (!r) return;
    if (r.yard) r.yard.visible = t.lod === 1;
    if (t.solar) t.solar.visible = t.lod === 1 && !(cap().kitR > 0);   // דודי השמש של המשחק מוחלפים בערכת הגג ליד השחקן
  }
  function onTile(t, kind) {
    if (kind === 'remove') { const r = S.tiles.get(t.key); if (r) { if (r.yard) { r.yard.geometry.dispose(); } S.tiles.delete(t.key); S.nearKey = ''; } if (t.key === (S.dekel && S.dekel.tile)) removeDekel(); return; }
    if (kind === 'add') wantTileHints(t);
    if (t.hi && !t.hi.userData.yzb) applyTile(t); else syncTileVis(t);
    if (S.dekel && t.key === S.dekel.tile && !S.dekelMesh && t.hgt) buildDekel(t);
  }

  // ------------------------------------------------------------ ציוד גג + מרפסות ליד השחקן (InstancedMesh גלובליים)
  const M4 = () => new S.world.THREE.Matrix4();
  let _m, _q, _v, _s, _up;
  function nearBuild() {
    const w = S.world, THREE = w.THREE, P = w.player.pos, c = cap(), TY = S.TY, W = w.data.W;
    const R = Math.max(c.kitR, c.balcR);
    const key = Math.round(P.x / 40) + ',' + Math.round(P.z / 40) + '|' + S.tiles.size + '|' + w.quality.tier + '|' + S.capScale.toFixed(2); if (key === S.nearKey) return; S.nearKey = key;
    if (!_m) { _m = new THREE.Matrix4(); _q = new THREE.Quaternion(); _v = new THREE.Vector3(); _s = new THREE.Vector3(1, 1, 1); _up = new THREE.Vector3(0, 1, 0); _c = new THREE.Color(); }
    const cand = { solar: [], tank: [], ac: [], stair: [] }, F = { bal: [], bars: [], wallac: [], awn: [] };
    const list = R ? W.near(P.x, P.z, R).slice().sort((a, b) => ((a.cx - P.x) ** 2 + (a.cz - P.z) ** 2) - ((b.cx - P.x) ** 2 + (b.cz - P.z) ** 2)) : [];
    for (const b of list) {
      const I = b._yz; if (!I) continue; const d = Math.hypot(b.cx - P.x, b.cz - P.z);
      if (d < c.kitR && !I.pitched) roofKitFor(b, I, cand);
      if (d < c.balcR) facadeProps(b, I, F);
    }
    const put = (im, arr, stride, cap, colOf) => { const n = Math.min(arr.length / stride, cap);
      for (let i = 0; i < n; i++) { const o = i * stride; _q.setFromAxisAngle(_up, arr[o + 3]); _v.set(arr[o], arr[o + 1], arr[o + 2]); _s.set(stride > 4 ? arr[o + 4] : 1, 1, 1); _m.compose(_v, _q, _s); im.setMatrixAt(i, _m);
        if (colOf) { _c.setRGB(...colOf(arr, o)); im.setColorAt(i, _c); } }
      im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); };
    for (const kd of ['solar', 'tank', 'ac', 'stair']) put(S.kit[kd], cand[kd], 4, c[kd]);
    const colAt = (arr, o) => [arr[o + 5], arr[o + 6], arr[o + 7]];
    put(S.balc, F.bal, 8, c.balc, colAt); put(S.bars, F.bars, 8, Math.round(c.balc * 0.8), colAt);
    put(S.wallac, F.wallac, 4, c.wallac); put(S.awn, F.awn, 8, c.awn, colAt);
    S.near = { kit: cand.solar.length / 4, balc: S.balc.count, bars: S.bars.count, wallac: S.wallac.count, awn: S.awn.count };
  }
  let _c;
  function pipB(b, x, z) { return S.world.data.W.pip(b, x, z); }
  function roofKitFor(b, I, out) {
    const TY = S.TY, W = S.world.data.W, kit = TY.roofKit(I.code, I.floors, b.area, b.h, I.seed); if (!kit) return;
    const y = b.top, occ = new Set(), o = I.o;
    const tryPlace = (kind, n, r, salt) => { let placed = 0;
      for (let i = 0; placed < n && i < n * 4 + 4; i++) {
        let u, v; if (kind === 'stair' && i === 0) { u = (o.u0 + o.u1) / 2; v = (o.v0 + o.v1) / 2; } else { u = o.u0 + r + (o.len - 2 * r) * TY.rnd(I.seed, salt + i * 3); v = o.v0 + r + (o.wid - 2 * r) * TY.rnd(I.seed, salt + i * 3 + 1); }
        const q = P2(o, u, v), x = q[0], z = q[1];
        if (!pipB(b, x, z) || W.edgeDist(b, x, z).d < r + 0.6) continue;
        const cs = 1.1, cells = []; let free = true;
        for (let gx = Math.floor((x - r) / cs); gx <= Math.floor((x + r) / cs); gx++) for (let gz = Math.floor((z - r) / cs); gz <= Math.floor((z + r) / cs); gz++) { const k = gx + ',' + gz; if (occ.has(k)) free = false; cells.push(k); }
        if (!free) continue; cells.forEach(k => occ.add(k));
        out[kind].push(x, y, z, kind === 'solar' ? 0 : TY.rnd(I.seed, salt + i * 5) * Math.PI * 2); placed++; } };
    tryPlace('stair', kit.stair, 1.6, 101); tryPlace('tank', kit.tank, 0.7, 211); tryPlace('solar', Math.min(kit.solar, 24), 1.15, 307); tryPlace('ac', Math.min(kit.ac, 16), 0.5, 401);
  }
  // צבע הטיח של הבניין — אותה בחירה כמו בשיידר (yzPal(eh(seed·0.011, 4.1)))
  function plasterOf(I) { const U = S.U; if (!U || !U.uYzCum) return [0.9, 0.88, 0.84]; const pc = eh(I.seed * 0.011, 4.1), cum = U.uYzCum.value, pal = U.uYzPal.value;
    if (I.flags.mat === 1) return LOOK.stone; for (let i = 0; i < 8; i++) if (pc < cum[i]) return [pal[i].x, pal[i].y, pal[i].z]; return [pal[7].x, pal[7].y, pal[7].z]; }
  const BARS = [[0.16, 0.17, 0.18], [0.92, 0.92, 0.90], [0.30, 0.24, 0.20], [0.55, 0.57, 0.58]];
  const GLASS = [0.52, 0.62, 0.66];
  const AWN = [[0.72, 0.16, 0.14], [0.12, 0.42, 0.26], [0.16, 0.30, 0.56], [0.86, 0.76, 0.52], [0.40, 0.40, 0.42], [0.86, 0.46, 0.16]];
  /* מאפייני חזית תלת־ממדיים ליד השחקן — באותן עמודות/קומות שהשיידר מצייר (eh + אותו גיוון לכל בניין):
     מרפסות פתוחות עם מעקה (טיח בגוון הבניין / מוטות מתכת / זכוכית — לפי בניין), מזגנים תלויים מתחת לחלון, סוככי חנויות מול שדרות. */
  function facadeProps(b, I, F) {
    const TY = S.TY, T = TY.T, P = TY.FACADE[I.code] || TY.FACADE[T.WALKUP], p = b.p, n = b.n, seed = I.seed, fh = I.fh, W = S.world.data.W;
    const resid = [T.WALKUP, T.RAKEVET, T.BLOCK, T.TOWER, T.VILLA].includes(I.code);
    const bay = P.bay * (0.88 + 0.26 * eh(seed * 0.017, 21.0)), ww = P.ww * (0.84 + 0.32 * eh(seed * 0.023, 22.0)), balP = P.balc * (0.70 + 0.60 * eh(seed * 0.047, 28.0));
    const rk = eh(seed * 0.059, 30.0), railType = rk < 0.42 ? 0 : rk < 0.80 ? 1 : 2;   // 0 טיח, 1 מוטות, 2 זכוכית
    const pc = plasterOf(I), barC = BARS[(seed >> 3) % 4];
    const w2 = ww * 0.5, sl = P.sill, maxF = Math.min(I.floors, 30);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], dx = p[j * 2] - ax, dz = p[j * 2 + 1] - az, L = Math.hypot(dx, dz); if (L < 2) continue;
      const nb = P.ww <= 0 ? 0 : Math.max(1, Math.floor(L / bay + 0.5)), bw = L / nb, nx = -dz / L, nz = dx / L, ang = Math.atan2(nx, nz);
      // סוככים: קיר חנויות שפונה לדרך ראשית (סוג ≥ 3)
      if (I.flags.shop && L >= 6) { let main = false; for (const off of [5, 8, 11]) { const r = W.onRoad(ax + dx / 2 + nx * off, az + dz / 2 + nz * off); if (r && r.c >= 3) { main = true; break; } }
        if (main) { const k = Math.max(1, Math.floor(L / 5)), aw = L / k; for (let q = 0; q < k; q++) { if (eh(q + 0.5, seed * 0.061 + 31.0) < 0.25) continue; const t = (q + 0.5) / k, col = AWN[Math.floor(eh(q + 1.5, seed * 0.067 + 32.0) * AWN.length) % AWN.length];
          F.awn.push(ax + dx * t + nx * 0.03, b.base + 0.76 * fh, az + dz * t + nz * 0.03, ang, aw * 0.86, col[0], col[1], col[2]); } } }
      if (!resid || !nb || L < 3) continue;
      for (let bi = 0; bi < nb; bi++) {
        const colBal = eh(bi + 0.37, seed * 0.013 + 2.1) <= balP, t = (bi + 0.5) * bw / L, x = ax + dx * t, z = az + dz * t;
        for (let fi = 1; fi < maxF; fi++) {
          if (colBal) {
            if (eh(bi + fi * 13.1, seed * 0.019 + 8.0) <= P.closed) continue;   // מרפסת סגורה – נשארת בשיידר בלבד
            if (I.code === T.VILLA) continue;
            const y = b.base + fi * fh;
            if (railType === 1) F.bars.push(x + nx * 0.02, y, z + nz * 0.02, ang, bw * 0.86, barC[0], barC[1], barC[2]);
            else { const c = railType === 2 ? GLASS : pc; F.bal.push(x + nx * 0.02, y, z + nz * 0.02, ang, bw * 0.86, c[0], c[1], c[2]); }
          } else if (eh(bi + fi * 3.7, seed * 0.023) < P.ac) {   // מזגן תלוי — במקום ובתנאי של המזגן המצויר בשיידר
            const tu = (bi + 0.5 + w2 - 0.12) * bw / L; if (tu <= 0 || tu >= 1) continue;
            F.wallac.push(ax + dx * tu + nx * 0.17, b.base + (fi + sl - 0.17) * fh - 0.06, az + dz * tu + nz * 0.17, ang);
          }
        }
      }
    }
  }
  function barsGeo(THREE) {   // מרפסת עם מעקה מוטות: לוחות (v<0.5 במרקם = אטום) + מעקה (v>0.5 = מוטות שקופים-חלקית, alphaTest)
    const P = [], N = [], C = [], U = [];
    const quad = (a, b, c, d, col, uv) => { const n = triNormal(a, b, c); const q4 = [a, b, c, d]; for (const k of [0, 1, 2, 0, 2, 3]) { P.push(...q4[k]); N.push(...n); C.push(...col); U.push(...uv[k]); } };
    const slab = [0.80, 0.79, 0.76], under = [0.55, 0.55, 0.53], rail = [1, 1, 1], S0 = [[0.1, 0.2], [0.2, 0.2], [0.2, 0.3], [0.1, 0.3]];
    const w = 0.5, d = 1.05, t = 0.14, h = 1.0, nb = 9;
    quad([-w, 0, 0], [-w, 0, d], [w, 0, d], [w, 0, 0], under, S0); quad([-w, 0, d], [-w, t, d], [w, t, d], [w, 0, d], slab, S0); quad([-w, t, 0], [w, t, 0], [w, t, d], [-w, t, d], slab, S0);
    const R = (x0, x1) => [[x0, 0.52], [x1, 0.52], [x1, 0.98], [x0, 0.98]];
    quad([-w, t, d], [w, t, d], [w, h, d], [-w, h, d], rail, R(0, nb));          // חזית (נראית משני הצדדים: DoubleSide)
    quad([w, t, d], [w, t, 0], [w, h, 0], [w, h, d], rail, R(0, nb * d)); quad([-w, t, 0], [-w, t, d], [-w, h, d], [-w, h, 0], rail, R(0, nb * d));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); return g;
  }
  function barsTex(THREE) {   // 32×32: חצי תחתון אטום לבן; חצי עליון: מעקה עליון/תחתון + מוט אנכי אחד לכל יחידת u
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 16, 32, 16); x.clearRect(0, 0, 32, 16);
    x.fillRect(0, 0, 32, 2); x.fillRect(0, 14, 32, 2); x.fillRect(14, 0, 4, 16);
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = true; t.magFilter = THREE.NearestFilter; return t;
  }
  function awningGeo(THREE) {   // סוכך: רוחב 1 מ' (מוגדל לפי המפרץ), בולט 1.25 מ' ויורד 0.45 מ', שוליים 0.22 מ', צדדים משולשים
    const P = [], N = [], C = [];
    const tri = (a, b, c, col) => { const n = triNormal(a, b, c); for (const q of [a, b, c]) { P.push(...q); N.push(...n); C.push(...col); } };
    const top = [1, 1, 1], dark = [0.72, 0.72, 0.72], w = 0.5, d = 1.25, dy = -0.45, v = -0.22;
    const A = [-w, 0, 0], B = [w, 0, 0], Cc = [w, dy, d], D = [-w, dy, d], E = [w, dy + v, d], Fq = [-w, dy + v, d];
    tri(A, D, Cc, top); tri(A, Cc, B, top); tri(A, B, Cc, dark); tri(A, Cc, D, dark);
    tri(D, Fq, E, top); tri(D, E, Cc, top);
    tri([w, 0, 0], [w, dy, d], [w, 0, 0.02], top); tri([w, 0, 0], [w, dy, 0.02], [w, dy, d], top);
    tri([-w, 0, 0], [-w, 0, 0.02], [-w, dy, d], top); tri([-w, 0, 0], [-w, dy, d], [-w, dy, 0.02], top);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); return g;
  }
  function balconyGeo(THREE) {   // לוח 1×1.05 מ' (רוחב מוגדל לפי המפרץ) + מעקה טיח 1.0 מ' — בולט ב-+z מקומי
    const P = [], N = [], C = [];
    const quad = (a, b, c, d, col) => { const n = triNormal(a, b, c); for (const q of [a, b, c, a, c, d]) { P.push(...q); N.push(...n); C.push(...col); } };
    const slab = [0.80, 0.79, 0.76], rail = [0.90, 0.89, 0.86], under = [0.55, 0.55, 0.53];
    const w = 0.5, d = 1.05, t = 0.14, h = 1.0;
    quad([-w, 0, 0], [-w, 0, d], [w, 0, d], [w, 0, 0], under);            // תחתית
    quad([-w, t, d], [-w, h, d], [w, h, d], [w, t, d], rail);              // מעקה קדמי (חוץ)
    quad([w, t, d - 0.08], [w, h, d - 0.08], [-w, h, d - 0.08], [-w, t, d - 0.08], rail); // מעקה קדמי (פנים)
    quad([-w, 0, d], [-w, t, d], [w, t, d], [w, 0, d], slab);
    quad([-w, h, d - 0.08], [-w, h, d], [w, h, d], [w, h, d - 0.08], slab); // ראש המעקה
    quad([w, 0, 0], [w, 0, d], [w, h * 0.55, d], [w, h * 0.55, 0], rail); quad([-w, 0, d], [-w, 0, 0], [-w, h * 0.55, 0], [-w, h * 0.55, d], rail);
    quad([-w, t, 0], [w, t, 0], [w, t, d - 0.08], [-w, t, d - 0.08], slab); // רצפה
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); return g;
  }

  // ------------------------------------------------------------ מגדלי הדקל (ציון דרך מצוטט, מיקום/טביעה משוערים) + ציוני דרך עצמאיים
  function dekelPoly(cx, cy, shape) { const W = S.world.data.W; let sx = 0, sy = 0; shape.forEach(q => { sx += q[0]; sy += q[1]; }); sx /= shape.length; sy /= shape.length; return shape.map(q => W.toScene(cx + q[0] - sx, cy + q[1] - sy)); }
  function buildDekel(t) {
    const w = S.world, THREE = w.THREE, W = w.data.W, D = S.dekel, TY = S.TY;
    const F = Arr(), lines = [], linesC = [];
    for (const tw of D.towers) {
      let b;
      if (tw.osm) { b = w.data.buildingById(tw.osm); if (!b) continue; tw._b = b; }
      else { // בניין סינתטי: נכנס ל-W.near (התנגשות, רצפת גג, כרטיס) — בלי לגעת באינדקס של המשחק
        const pts = dekelPoly(tw.itm[0], tw.itm[1], D.shape); let p = new Float32Array(pts.length * 2); pts.forEach((q, i) => { p[i * 2] = q.x; p[i * 2 + 1] = q.z; });
        let s = 0; const n = pts.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
        if (s > 0) { const q = new Float32Array(n * 2); for (let i = 0; i < n; i++) { q[i * 2] = p[(n - 1 - i) * 2]; q[i * 2 + 1] = p[(n - 1 - i) * 2 + 1]; } p = q; }
        let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, cx = 0, cz = 0; for (let i = 0; i < n; i++) { const x = p[i * 2], z = p[i * 2 + 1]; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); cx += x; cz += z; }
        cx /= n; cz /= n; let base = 1e9; for (let i = 0; i < n; i++) base = Math.min(base, W.H(p[i * 2], p[i * 2 + 1])); base = Math.min(base, W.H(cx, cz));
        b = { id: tw.id, name: tw.he, type: 'apartments', area: Math.abs(s) / 2, base, h: D.h, top: base + D.h, sigma: (D.h_max - D.h_min) / 2, floors: D.floors, fl: D.floors, fh: Math.round(D.h / D.floors * 10), src: 'E', conf: 0,
          p, n, minx, maxx, minz, maxz, cx, cz, per: 0, ind: false, tile: t.key, yzSynthetic: true };
        S.dekelObjs.push(b); tw._b = b;
      }
      const I = classifyB(b, null);
      if (b.yzSynthetic) {
        const p = b.p, n = b.n, flY = Math.round(I.fh * 10), cB = [0.75, 0.74, 0.71];
        for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
          pushWall(F, ax, az, bx, bz, b.base - 0.6, b.top, -dz / L, dx / L, I, b, NEUT, cB, flY, Math.round(L * 10)); }
        for (const [a, bb, c] of [[0, 1, 2], [0, 2, 3]]) { const A = [p[a * 2], b.top, p[a * 2 + 1]], B = [p[bb * 2], b.top, p[bb * 2 + 1]], C = [p[c * 2], b.top, p[c * 2 + 1]]; let x = B, y = C; if (triNormal(A, B, C)[1] < 0) { x = C; y = B; } pushTri(F, A, x, y, [0, 1, 0], [0.86, 0.85, 0.83], I, b.base); }
      }
      // קו מקווקו "משוער": טביעה בקרקע + בגג + 4 פינות
      const L = b.yzSynthetic ? lines : linesC, p = b.p, n = b.n;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; for (const y of [b.base + 0.25, b.top + 0.3]) L.push(p[i * 2], y, p[i * 2 + 1], p[j * 2], y, p[j * 2 + 1]); L.push(p[i * 2], b.base + 0.25, p[i * 2 + 1], p[i * 2], b.top + 0.3, p[i * 2 + 1]); }
      S.stats.dekel++;
    }
    const grp = S.api.group('dekel');
    if (F.p.length) {
      const nF = F.p.length / 3, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(F.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(F.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(F.c, 3));
      g.setAttribute('afl', new THREE.BufferAttribute(new Int16Array(F.fl), 2)); g.setAttribute('afc', new THREE.BufferAttribute(new Int16Array(F.ac), 4)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nF * 2), 2));
      g.addGroup(0, nF, 0); g.computeBoundingSphere();
      S.dekelMesh = new THREE.Mesh(g, S.MATS); S.dekelMesh.name = 'yz-dekel'; S.dekelMesh.castShadow = S.dekelMesh.receiveShadow = true; grp.add(S.dekelMesh);
    }
    for (const [arr, mat] of [[lines, S.mats.line], [linesC, S.mats.lineC]]) { if (!arr.length) continue; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); const ls = new THREE.LineSegments(g, mat); ls.computeLineDistances(); ls.name = 'yz-dekel-outline'; ls.renderOrder = 5; grp.add(ls); }
    // התנגשות/כרטיס למגדלים הסינתטיים: עוטפים את W.near (כל ההתנגשויות, הרצפה והבחירה עוברות דרכו)
    if (S.dekelObjs.length && !S.origNear) { const orig = W.near; S.origNear = orig;
      W.near = function (x, z, r) { const a = orig.call(W, x, z, r); for (const b of S.dekelObjs) if (!(x + r < b.minx || x - r > b.maxx || z + r < b.minz || z - r > b.maxz)) a.push(b); return a; }; }
    S.nearKey = '';
  }
  function removeDekel() {
    if (S.origNear) { S.world.data.W.near = S.origNear; S.origNear = null; }
    S.dekelObjs = []; if (S.dekelMesh) { S.dekelMesh.geometry.dispose(); S.dekelMesh = null; }
    const g = S.api && S.world.scene.getObjectByName('dekel'); if (g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); g.parent && g.parent.remove(g); }
  }
  function buildStandalone() {   // מגדלור גבעת יונה + מצודת אשדוד־ים (מודלים של מחלקת הבניינים, מקומות מצוטטים)
    const w = S.world, THREE = w.THREE, W = w.data.W, G = S.FX.standaloneGeometry(THREE), LM = S.LM;
    const base = Float32Array.from(G.P), P = new Float32Array(G.P.length);
    for (const s of LM.STANDALONE) { const sp = W.toScene(s.itm[0], s.itm[1]), gy = Math.max(0, W.H(sp.x, sp.z)), [a, b] = G.parts[s.key], ang = s.key === 'fort' ? -24.5 * Math.PI / 180 : 0, c = Math.cos(ang), sn = Math.sin(ang);
      for (let v = a; v < b; v++) { const x = base[v * 3], y = base[v * 3 + 1], z = base[v * 3 + 2]; P[v * 3] = sp.x + x * c - z * sn; P[v * 3 + 1] = gy + y; P[v * 3 + 2] = sp.z + x * sn + z * c; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(G.N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(G.C, 3)); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, S.mats.kit); m.name = 'yz-landmarks-standalone'; m.castShadow = true; S.api.group('standalone').add(m); S.stand = m; S.standGY = {};
  }
  function updLabels() {   // תוויות DOM למגדלי הדקל (0 קריאות ציור)
    const w = S.world, cam = w.camera, THREE = w.THREE; if (!S.dekel || !S.dekelObjs) return;
    if (!S.lblBox) { S.lblBox = document.createElement('div'); S.lblBox.id = 'yzBldLbl'; S.lblBox.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:8'; document.body.appendChild(S.lblBox); S._v3 = new THREE.Vector3(); }
    const W = innerWidth, H = innerHeight; let i = 0;
    for (const tw of S.dekel.towers) { const b = tw._b; if (!b) continue; let el = S.labels[i]; if (!el) { el = document.createElement('div'); el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);font:600 11px system-ui,Arial;color:#fff;background:rgba(12,20,32,.72);border:1px dashed #f2b84b;border-radius:8px;padding:2px 6px;white-space:nowrap;direction:rtl'; S.lblBox.appendChild(el); S.labels[i] = el; }
      const v = S._v3.set(b.cx, b.top + 6, b.cz), d = v.distanceTo(cam.position); v.project(cam);
      const vis = v.z < 1 && v.z > -1 && d < 1400 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && i < 5 && (i === 0 || d < 700);
      el.style.display = vis ? 'block' : 'none';
      if (vis) { el.style.left = ((v.x + 1) / 2 * W) + 'px'; el.style.top = ((1 - v.y) / 2 * H) + 'px'; el.textContent = i === 0 ? `מגדלי הדקל · ${S.dekel.floors} קומות · ~${S.dekel.h_min}–${S.dekel.h_max} מ׳ (משוער)` : `${tw.he.replace('מגדלי הדקל – ', '')}`; }
      i++; }
  }

  // ------------------------------------------------------------ כרטיס הבניין: שורת "טיפוס" (מה נגזר ומה מנתונים)
  function cardHook() {
    const card = document.getElementById('card'); if (!card) return;
    const BAS = { data: ['נתון', 'ok'], shape: ['נגזר מהצורה', 'mid'], rule: ['כלל אצבע', 'low'] };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    S.cardObs = new MutationObserver(() => {
      if (card.querySelector('.yzTypo')) return; const tb = card.querySelector('table'); if (!tb) return;
      const ids = [...card.querySelectorAll('.ltr')].map(e => e.textContent.trim()); let b = null;
      for (const id of ids) { b = S.world.data.buildingById(id) || S.dekelObjs.find(o => o.id === id); if (b) break; }
      if (!b || !b._yz) return; const I = b._yz, bs = BAS[I.basis] || BAS.rule;
      const parts = [`${esc(I.he)} <span class="tag ${bs[1]}">${bs[0]}</span>`];
      if (I.villa) parts.push(`<span class="tag mid">גג רעפים, גינה וגדר — נגזר (טיפוס)</span>`);
      if (I.flags.shop) parts.push(`<span class="tag mid">חנויות בקומת הקרקע${I.inferred.length ? ' — משוער' : ''}</span>`);
      parts.push(`<span class="tag">חזית פרוצדורלית: חלונות, מרפסות, תריסים, גוון טיח</span>`);
      let extra = '';
      if (I.lm && S.dekelById && (S.dekelById.has(b.id) || b.yzSynthetic)) extra = `<tr class="yzTypo"><td>מגדלי הדקל</td><td>${S.dekel.floors} קומות · ${S.dekel.units} יח"ד ב-5 מגדלים (מקור: <span class="ltr">mako 20.8.2023, yad2 18100</span>) · גובה ~${S.dekel.h_min}–${S.dekel.h_max} מ׳ <span class="tag low">משוער</span> · ${b.yzSynthetic ? 'מיקום וטביעה משוערים (קו מקווקו לבן)' : 'טביעת OSM — התאמה משוערת (קו מקווקו כתום)'}</td></tr>`;
      else if (I.lm) extra = `<tr class="yzTypo"><td>ציון דרך</td><td>${esc(I.lm.he)}${I.lm.h ? ' · ' + I.lm.h + ' מ׳' : ''} <span class="tag ok">מצוטט</span></td></tr>`;
      tb.insertAdjacentHTML('beforeend', `<tr class="yzTypo"><td>טיפוס (מחלקת הבניינים)</td><td>${parts.join(' ')}<div class="note">${esc(I.why)}</div></td></tr>` + extra);
    });
    S.cardObs.observe(card, { childList: true });
  }

  // ------------------------------------------------------------ זמן ולילה
  function israelHour(d) { try { const off = S.world.G27.SIM.israelOffsetMin(d); return (((d.getTime() / 60000 + off) / 60) % 24 + 24) % 24; } catch (e) { return d.getHours() + d.getMinutes() / 60; } }

  YZW.register({
    id: ID, name: 'בניינים: חזיתות, טיפוסים (וילות/שיכונים/מגדלים), ציוד גג, מגדלי הדקל', dept: 'plugins/buildings', order: 47,
    scripts: [BASE + '../_common/mathooks.js', BASE + 'dept/typology.js', BASE + 'dept/landmarks.js', BASE + 'dept/facades.js'],
    requires: () => !!(window.ESHBuildings && ESHBuildings.typology && ESHBuildings.landmarks && ESHBuildings.facades && window.YZMAT),
    async init(world, api) {
      S.stats = { tiles: 0, buildings: 0, byCode: {}, byBasis: {}, villas: 0, yards: 0, pitched: 0, shops: 0, landmarks: 0, dekel: 0, buildMs: 0 }; S.tileHints.clear(); S.capScale = 1; S.nearKey = '';
      S.world = world; S.api = api; S.on = true; S.TY = ESHBuildings.typology; S.LM = ESHBuildings.landmarks; S.FX = ESHBuildings.facades;
      const THREE = world.THREE;
      S.dekel = await (await fetch(BASE + 'dekel.json')).json();
      S.dekelById = new Map(S.dekel.towers.map(t => [t.osm || t.id, t]));
      S.mats = makeMats(THREE); S.MATS = [S.mats.facade, S.mats.roofTile]; hookMats(); loadLook().catch(e => console.warn('[plugins/buildings] look', e));
      const g = api.group('kit');
      const CAPMAX = CAPS.high;
      for (const kd of ['solar', 'tank', 'ac', 'stair']) { const m = new THREE.InstancedMesh(S.FX.kitGeometry(THREE, kd), S.mats.kit, CAPMAX[kd]); m.count = 0; m.name = 'yz-kit-' + kd; m.castShadow = true; g.add(m); S.kit[kd] = m; }
      S.balc = new THREE.InstancedMesh(balconyGeo(THREE), S.mats.kit, CAPMAX.balc); S.balc.count = 0; S.balc.name = 'yz-balcony'; S.balc.castShadow = true; g.add(S.balc);
      S.bars = new THREE.InstancedMesh(barsGeo(THREE), S.mats.rail, CAPMAX.balc); S.bars.count = 0; S.bars.name = 'yz-balcony-bars'; g.add(S.bars);
      S.wallac = new THREE.InstancedMesh(S.FX.kitGeometry(THREE, 'ac'), S.mats.kit, CAPMAX.wallac); S.wallac.count = 0; S.wallac.name = 'yz-wall-ac'; g.add(S.wallac);
      S.awn = new THREE.InstancedMesh(awningGeo(THREE), S.mats.awning, CAPMAX.awn); S.awn.count = 0; S.awn.name = 'yz-awning'; S.awn.castShadow = true; g.add(S.awn);
      api.on('budget', () => { S.capScale = Math.max(0.3, S.capScale * 0.7); S.nearKey = ''; });
      buildStandalone();
      api.eachTile((t, kind) => onTile(t, kind));
      api.on('quality', () => { const lite = cap().lite, m = S.mats.facade; if (!!(m.defines && m.defines.ESH_LITE) !== lite) { if (lite) m.defines.ESH_LITE = 1; else delete m.defines.ESH_LITE; m.needsUpdate = true; } S.nearKey = ''; for (const r of S.tiles.values()) syncTileVis(r.t); });
      cardHook();
      api.on('buildingHints', () => rebuildAll()); api.on('realdata', () => { S.tileHints.clear(); for (const r of S.tiles.values()) wantTileHints(r.t); rebuildAll(); });
      window.YZBuildings = { stats: () => JSON.parse(JSON.stringify(S.stats)), typologyOf: id => { const b = world.data.buildingById(id) || S.dekelObjs.find(o => o.id === id); return b && b._yz ? { code: b._yz.code, he: b._yz.he, basis: b._yz.basis, why: b._yz.why, floors: b._yz.floors, villa: b._yz.villa, pitched: b._yz.pitched, shop: !!b._yz.flags.shop, inferred: b._yz.inferred } : null; },
        dekel: () => S.dekel.towers.map(t => ({ id: t.id, osm: t.osm || null, basis: t.basis, x: t._b && t._b.cx, z: t._b && t._b.cz, top: t._b && t._b.top })), mats: () => window.YZMAT.slots(),
        setHints(src) { S.hintSrc = src || null; rebuildAll(); }, rebuild: rebuildAll };
    },
    update(dt, world) {
      if (S.U) { S.U.uNight.value = S.TY.nightFactor(world.sun.elevation); if (world.clock.date) S.U.uLit.value = S.TY.litFraction(israelHour(world.clock.date)); }
      S.nearT -= dt; if (S.nearT <= 0) { S.nearT = 0.8; nearBuild(); }
      S.capT += dt; if (S.capT > 12) { S.capT = 0; const st = world.stats, bu = world.quality.budget; if (S.capScale < 1 && st.tris < bu.tris * 0.8 && st.calls < bu.calls * 0.85) { S.capScale = Math.min(1, S.capScale * 1.15); S.nearKey = ''; } }
      if (S.stand) { const W = world.data.W; let moved = false; for (const s of S.LM.STANDALONE) { const sp = W.toScene(s.itm[0], s.itm[1]), gy = Math.max(0, W.H(sp.x, sp.z)); if (S.standGY[s.key] == null) S.standGY[s.key] = gy; else if (Math.abs(S.standGY[s.key] - gy) > 0.5) moved = true; } if (moved) { world.scene.getObjectByName('standalone').remove(S.stand); S.stand.geometry.dispose(); buildStandalone(); } }
      updLabels();
    },
    dispose(world) {
      S.on = false; S.unsub.forEach(u => u()); S.unsub = [];
      if (S.cardObs) S.cardObs.disconnect(); S.cardObs = null; if (S.lblBox) { S.lblBox.remove(); S.lblBox = null; S.labels = []; }
      removeDekel();
      for (const [b, o] of S.patched) Object.assign(b, o); S.patched.clear();
      // מחזירים את בנייני המשחק: מוחקים את t.hi שלנו → W27.update בונה מחדש את הגאומטריה המקורית בפריים הבא
      for (const r of S.tiles.values()) { const t = r.t; if (r.yard) { t.grp.remove(r.yard); r.yard.geometry.dispose(); }
        if (t.hi) { t.grp.remove(t.hi); t.hi.geometry.dispose(); t.hi = null; }
        for (const k of ['solar', 'palms']) if (t[k]) { t.grp.remove(t[k]); t[k].traverse(o => { if (o.isInstancedMesh) o.dispose(); }); t[k] = null; }
        if (t.blds) for (const b of t.blds) delete b._yz; t.lod = -1; }
      S.tiles.clear();
      const Y = window.YZMAT; if (Y) for (const s of ['buildings.facade', 'buildings.roofTile', 'buildings.yard', 'buildings.kit', 'buildings.rail', 'buildings.awning']) Y.withdraw(s);
      for (const k in S.mats || {}) { try { S.mats[k].dispose(); } catch (e) { /* */ } }
      S.kit = {}; S.balc = S.bars = S.wallac = S.awn = null; S.stand = null; S.U = null;
      delete window.YZBuildings;
    },
    settings: [
      { id: 'detail', label: 'פרטי חזית (חלונות, מרפסות)', type: 'toggle', get: () => !S.U || S.U.uDetail.value > 0.5, set: v => { if (S.U) S.U.uDetail.value = v ? 1 : 0; } },
    ],
    hudPanels: [{ id: 'bld', render(el, world) { if (world.player.mode !== 'dev') { el.textContent = ''; return; } const s = S.stats; el.textContent = `🏘 ${s.buildings} בניינים · ${s.villas} וילות (${s.pitched} גגות רעפים, ${s.yards} גינות) · ${s.shops} חזיתות חנויות · מגדלי הדקל ${s.dekel}/5 — טיפוסים נגזרים, מסומן בכרטיס`; } }],
  });
})();
