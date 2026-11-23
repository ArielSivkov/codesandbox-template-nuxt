/* ESH27 · לוח היזם · מחלקת הבניינים — facades.js
   חזיתות פרוצדורליות זולות לבניינים המוחלצים של מנוע גדוד 6 (b6/map) – בלי לגעת במנוע.
   · חומר אחד (Lambert + onBeforeCompile) שמחליף את חומר הבניינים דרך engine.setMaterials → אותה קריאת ציור לאריח.
   · תכונת קודקוד אחת חדשה afc (Int16×4: u לאורך הקיר בדצ"מ, אורך הקיר בדצ"מ, טיפולוגיה|קומות|דגלים, זרע) נבנית פעם אחת לאריח.
   · ציוד גג (דודי שמש, מיכלים, מזגנים, חדרי מדרגות): 4 InstancedMesh גלובליים בסך הכול (לא לאריח), רק באריחים קרובים.
   · ציוני דרך: תיקון גובה מצוטט על הטביעה הקיימת + מודלים עצמאיים (מגדלור, מצודה) במש אחד.
   תלוי ב: typology.js, landmarks.js (נטענים לפני). three.js מועבר כפרמטר (THREE של חלון המנוע). */
(function (root) {
'use strict';
const NS = root.ESHBuildings = root.ESHBuildings || {};
const TY = NS.typology, LM = NS.landmarks;
const { T, FACADE, LOD } = TY;

// ---------- GLSL: פרמטרי הטיפולוגיה נוצרים מאותה טבלה של JS (אין סטייה בין הבדיקות לשיידר) ----------
const f1 = v => (Math.round(v * 1000) / 1000).toFixed(3);
function glslParams() {
  let s = 'float bay=3.0, ww=0.46, wh=0.42, sill=0.33, balP=0.3, cloP=0.5, shutP=0.4, acP=0.3;\n';
  for (const [code, P] of Object.entries(FACADE)) s += `if (abs(code - ${f1(+code)}) < 0.5) { bay=${f1(P.bay)}; ww=${f1(P.ww)}; wh=${f1(P.wh)}; sill=${f1(P.sill)}; balP=${f1(P.balc)}; cloP=${f1(P.closed)}; shutP=${f1(P.shut)}; acP=${f1(P.ac)}; }\n`;
  return s;
}
const FRAG_HEAD = `
uniform float uNight; uniform float uLit; uniform float uHide; uniform float uNear; uniform float uFar; uniform float uHasTex; uniform float uDetail;
uniform sampler2D uTexP; uniform sampler2D uTexS; uniform sampler2D uTexR;
varying vec2 vFl; varying float vY; varying float vDist; varying vec4 vAfc; varying float vNy; varying vec2 vWxz;
float eh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;
function fragBody() { return `
vec3 eshEmit = vec3(0.0);
{
  float pk = floor(vAfc.z + 0.5);
  float code = mod(pk, 16.0);
#ifdef ESH_HIDE
  if (code > 0.5 && abs(vAfc.w - uHide) < 0.5) discard;   // חתך: מסתירים את בניין המארח של "הנכס שלי" (מוגדר רק כשצריך – discard מבטל early-z)
#endif
  if (code > 0.5) {
    float floors = mod(floor(pk / 16.0), 64.0);
    float pil = mod(floor(pk / 1024.0), 2.0);
    float shop = mod(floor(pk / 2048.0), 2.0);
    float matId = floor(pk / 4096.0);
    float seed = vAfc.w;
    float s1 = eh(vec2(seed * 0.0137, 1.7));
    float lum = dot(vColor.rgb, vec3(0.33333));
    vec3 neutral = vec3(0.93, 0.91, 0.87) * (lum / 0.9033);
    float tintAmt = clamp(length(vColor.rgb - neutral) * 5.0 - 0.05, 0.0, 1.0);
    float ao = clamp(lum / 0.9033, 0.0, 1.2);
    vec3 wallC;
    if (matId < 0.5) {   // שליכט: לבן, שמנת, אפרפר, אפרסק, בז' (לוח צבעים חזותי – proc)
      float pc = eh(vec2(seed * 0.011, 4.1));
      wallC = pc < 0.30 ? vec3(0.93, 0.92, 0.88) : pc < 0.55 ? vec3(0.91, 0.86, 0.76) : pc < 0.72 ? vec3(0.82, 0.82, 0.80) : pc < 0.86 ? vec3(0.92, 0.82, 0.72) : vec3(0.84, 0.78, 0.66);
      wallC *= 0.97 + 0.06 * s1; }
    else if (matId < 1.5) wallC = mix(vec3(0.86, 0.80, 0.68), vec3(0.92, 0.88, 0.79), s1);
    else if (matId < 2.5) wallC = mix(vec3(0.64, 0.64, 0.62), vec3(0.74, 0.73, 0.70), s1);
    else wallC = mix(vec3(0.40, 0.50, 0.56), vec3(0.50, 0.59, 0.65), s1);
    float fade = (1.0 - smoothstep(uNear, uFar, vDist)) * uDetail;
    vec3 alb = wallC;
    if (vNy > 0.7) {
      alb = mix(vec3(0.76, 0.76, 0.74), vec3(0.87, 0.86, 0.83), eh(vec2(seed * 0.007, 9.0)));
      if (uHasTex > 0.5) { float tr = texture2D(uTexR, vWxz / 3.0).g; alb *= mix(1.0, tr / 0.62, 0.45 * fade + 0.1); }
    } else if (vFl.y > 5.0) {
      float fh = vFl.y * 0.1; float f = (vY - vFl.x * 0.1) / fh; float fi = floor(f); float fy = f - fi;
      float L = vAfc.y * 0.1; float u = vAfc.x * 0.1;
#ifdef ESH_LITE
      if (false) {
#else
      if (uHasTex > 0.5) {
#endif
        vec2 tuv = vec2(u, vY);
        float tx = matId < 0.5 ? texture2D(uTexP, tuv).g / 0.78 : (matId < 1.5 ? texture2D(uTexS, tuv / 1.2).g / 0.62 : 1.0);
        alb *= mix(1.0, tx, 0.6 * (1.0 - smoothstep(120.0, 700.0, vDist)) + 0.08);
      }
      ${glslParams()}
      float nb = (L < 2.0 || ww <= 0.0) ? 0.0 : max(1.0, floor(L / bay + 0.5));
      float bw = nb > 0.0 ? L / nb : 1.0;
      float bx = u / bw; float bi = floor(bx); float fx = bx - bi;
      float aa = max(fwidth(f), fwidth(bx));
      float det = fade * (1.0 - smoothstep(0.30, 0.65, aa));
      float winMask = 0.0; vec3 featC = alb; float lightable = 0.0;
      bool occ = fi >= 0.0 && fi < floors && nb > 0.0;
      if (fi < 0.0) { alb *= 0.80; }
      else if (fi >= floors && floors > 0.5) { alb *= 0.96; }
      else if (nb > 0.0 && det > 0.002) {   // רחוק: מדלגים על כל פרטי החלונות (חיסכון ב-GPU אמיתי; ב-SwiftShader כל הענפים רצים)
#ifndef ESH_LITE
        float slab = 1.0 - smoothstep(0.0, 0.04, fy);
        if (fi < 0.5 && pil > 0.5) {
          float colm = clamp(step(fx, 0.11) + step(0.89, fx), 0.0, 1.0);
          float lobby = step(abs(bi - floor(nb * 0.5)), 0.5);
          vec3 rec = lobby > 0.5 ? vec3(0.32, 0.36, 0.38) : vec3(0.17, 0.17, 0.16);
          featC = mix(rec, alb * 0.93, colm); if (fy > 0.88) featC = alb * 0.86;
          winMask = 1.0; lightable = lobby * (1.0 - colm) * step(fy, 0.88);
        } else if (fi < 0.5 && shop > 0.5) {
          float sgn = step(0.78, fy) * step(fy, 0.95);
          float gl = step(0.05, fx) * step(fx, 0.95) * step(0.04, fy) * step(fy, 0.74);
          vec3 sc = vec3(eh(vec2(bi, seed * 0.01)), eh(vec2(seed * 0.01, bi + 3.0)), eh(vec2(bi + 7.0, seed * 0.01))) * 0.55 + 0.25;
          if (gl > 0.5) featC = mix(vec3(0.30, 0.36, 0.40), vec3(0.52, 0.58, 0.60), fy);
          if (sgn > 0.5) featC = sc;
          winMask = max(gl, sgn); lightable = gl + sgn * 0.7;
        } else {
          float colBal = step(eh(vec2(bi + 0.37, seed * 0.013 + 2.1)), balP);
          float hh = eh(vec2(bi * 1.31 + fi * 7.17, seed * 0.017 + 5.3));
          if (colBal > 0.5) {
            float closed = step(eh(vec2(bi + fi * 13.1, seed * 0.019 + 8.0)), cloP);
            float inX = step(0.04, fx) * step(fx, 0.96);
            if (closed > 0.5) {
              float mull = clamp(step(0.93, fract(fx * 3.0)) + step(fy, 0.07) + step(0.93, fy) + step(abs(fy - 0.42), 0.018), 0.0, 1.0);
              featC = mix(mix(vec3(0.30, 0.37, 0.41), vec3(0.50, 0.57, 0.60), fy), vec3(0.83, 0.83, 0.81), mull);
              lightable = 1.0 - mull;
            } else {
              featC = fy < 0.36 ? alb * 0.97 : vec3(0.27, 0.26, 0.24);
              if (fy < 0.36 && fy > 0.325) featC = alb * 0.82;
              if (fy >= 0.36 && fx > 0.28 && fx < 0.72 && fy < 0.92) { featC = vec3(0.20, 0.24, 0.27); lightable = 1.0; }
            }
            winMask = inX;
          } else {
            float isMamad = step(abs(bi - floor(eh(vec2(seed * 0.021, 11.0)) * nb)), 0.5) * step(3.5, code) * step(code, 5.5);
            float w2 = isMamad > 0.5 ? 0.17 : ww * 0.5; float wh2 = isMamad > 0.5 ? 0.30 : wh; float sl = isMamad > 0.5 ? 0.40 : sill;
            float inW = step(0.5 - w2, fx) * step(fx, 0.5 + w2) * step(sl, fy) * step(fy, sl + wh2);
            if (inW > 0.5) {
              float wy = (fy - sl) / wh2;
              float shutter = isMamad > 0.5 ? 0.0 : step(1.0 - hh * shutP * 2.0, wy);
              vec3 glass = mix(vec3(0.19, 0.24, 0.28), vec3(0.44, 0.52, 0.58), clamp(wy * 0.75 + s1 * 0.2, 0.0, 1.0));
              vec3 shut = vec3(0.80, 0.79, 0.74) * (1.0 - 0.10 * step(0.5, fract(wy * wh2 * fh * 18.0)) * (1.0 - smoothstep(40.0, 120.0, vDist)));
              featC = shutter > 0.5 ? shut : glass;
              if (isMamad > 0.5) featC = vec3(0.46, 0.47, 0.48);
              float fr = step(fx, 0.5 - w2 + 0.03) + step(0.5 + w2 - 0.03, fx) + step(wy, 0.04);
              if (fr > 0.5) featC = vec3(0.86, 0.86, 0.84);
              winMask = 1.0; lightable = (1.0 - shutter) * (1.0 - min(fr, 1.0)) * (1.0 - isMamad * 0.6);
            } else if (fy < sl && fy > sl - 0.17 && fx > 0.5 + w2 - 0.24 && fx < 0.5 + w2 && eh(vec2(bi + fi * 3.7, seed * 0.023)) < acP) {
              featC = vec3(0.87, 0.87, 0.85); if (fy < sl - 0.15) featC *= 0.6; winMask = 1.0;
            }
          }
          float streak = step(0.5 - ww * 0.45, fx) * step(fx, 0.5 + ww * 0.45) * step(fy, sill) * (fy / max(sill, 0.01));
          alb *= 1.0 - 0.07 * streak * det * step(code, 4.5);                       // כתמי נזילה מתחת לאדני החלונות (בלויות – proc)
          alb = mix(alb, alb * 0.80, slab * det);
        }
#endif
      }
      vec3 farC = occ ? alb * (0.86 - 0.22 * ww * wh * 2.0) : alb;
      if (occ && fi < 0.5 && pil > 0.5) farC = alb * 0.45;
      vec3 nearC = mix(alb, featC, winMask);
      alb = mix(farC, nearC, det);
      if (uNight > 0.01 && occ) {
        float on = step(eh(vec2(bi * 0.73 + fi * 5.31, seed * 0.029 + 1.9)), uLit + shop * step(fi, 0.5) * 0.7 + pil * step(fi, 0.5) * 0.6);
        vec3 lc = mix(vec3(1.0, 0.76, 0.46), vec3(0.82, 0.90, 1.0), step(0.72, eh(vec2(fi + 0.5, bi + seed * 0.003))));
        float nearE = on * lightable * winMask;
        float farE = uLit * ww * wh * 1.6;
        eshEmit = lc * mix(farE, nearE, det) * uNight * 0.85;
      }
    }
    vec3 outC = alb * ao;
    diffuseColor.rgb = mix(outC, vColor.rgb, tintAmt * 0.85);
  }
}
`; }

function createFacadeMaterial(THREE, opts = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const U = { uHide: { value: -1 }, uNight: { value: 0 }, uLit: { value: 0.4 }, uNear: { value: LOD.NEAR }, uFar: { value: LOD.FAR }, uHasTex: { value: 0 }, uDetail: { value: 1 },
    uTexP: { value: null }, uTexS: { value: null }, uTexR: { value: null } };
  mat.userData.uniforms = U; mat.name = 'esh-facade';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 afl;\nattribute vec4 afc;\nvarying vec2 vFl; varying float vY; varying float vDist; varying vec4 vAfc; varying float vNy; varying vec2 vWxz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFl = afl; vY = position.y; vAfc = afc; vNy = normal.y; vWxz = (modelMatrix * vec4(position, 1.0)).xz;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + fragBody())
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += eshEmit;');
  };
  mat.defines = mat.defines || {}; if (opts.lite) mat.defines.ESH_LITE = 1;
  mat.customProgramCacheKey = () => 'esh-facade-v4' + (mat.defines.ESH_HIDE ? 'h' : '') + (mat.defines.ESH_LITE ? 'l' : '');
  if (opts.texBase) {   // CC0 מחבילת הנכסים (assets/pack/textures, נוצרו ע"י צוות הנכסים) – אופציונלי; בלעדיהם רעש פרוצדורלי בלבד
    const L = new THREE.TextureLoader(); let n = 0;
    const load = (file, key) => L.load(opts.texBase + file, tx => { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = 2; U[key].value = tx; if (++n === 3) { U.uHasTex.value = 1; opts.onReady && opts.onReady(); } }, undefined, () => {});
    load('plaster_light_albedo_512.webp', 'uTexP'); load('limestone_albedo_512.webp', 'uTexS'); load('roof_flat_albedo_512.webp', 'uTexR');
  }
  return mat;
}

// ---------- קישוט מש של אריח: תכונת afc + טיפולוגיה לכל בניין ----------
/* mesh.userData = { t, own, sh, towner, nib } כפי שהמנוע בונה (app.js applyTile). מחזיר מידע לכל בניין. */
function decorateMesh(THREE, mesh, opts = {}) {
  const g = mesh.geometry, ud = mesh.userData, t = ud.t, M = t && t.meta;
  if (!M || !ud.own || !g.attributes.afl) return null;
  const own = ud.own, nb = own.length, pos = g.attributes.position.array, nrm = g.attributes.normal.array, fl = g.attributes.afl.array, nv = pos.length / 3;
  const afc = new Int16Array(nv * 4), segs = new Array(M.n), quads = [];
  for (let v = 0; v < nb;) {
    const ny = nrm[v * 3 + 1];
    if (Math.abs(ny) < 20 && v + 3 < nb && own[v + 3] === own[v] && nrm[(v + 3) * 3] === nrm[v * 3] && nrm[(v + 3) * 3 + 2] === nrm[v * 3 + 2]) {
      const ax = pos[v * 3], az = pos[v * 3 + 2], bx = pos[(v + 1) * 3], bz = pos[(v + 1) * 3 + 2], L = Math.hypot(bx - ax, bz - az);
      quads.push(v, L); if (fl[v * 2 + 1] > 0) (segs[own[v]] || (segs[own[v]] = [])).push([ax, -az, bx, -bz]);
      v += 4;
    } else v++;
  }
  // לכל בניין: טיפולוגיה, דגלים, ציון דרך
  const info = new Array(M.n);
  for (let k = 0; k < M.n; k++) {
    const dims = TY.footprintDims(segs[k] || []), id = M.ids[k], lm = LM.landmarkOf(id), seed = TY.seedOf(id);
    let cls = TY.classify({ typ: M.typ[k], name: M.names[k], area: M.area[k], floors: M.f[k], h: M.h[k] + (M.par ? M.par[k] : 0), len: dims.len, wid: dims.wid, floorsSrc: M.src[k] });
    let floors = M.f[k] || Math.max(1, Math.round(M.h[k] / 3));
    const tgt = LM.targetHeight(lm);
    if (lm && tgt) {
      floors = lm.floors || floors;
      if (lm.h || (lm.floors && lm.floors >= 11)) cls = { code: T.LANDMARK, he: lm.he, basis: 'data', why: 'ציון דרך מצוטט' };
      if (opts.fixHeights !== false) fixHeight(mesh, k, tgt.h, floors);
    }
    const F = M.fac && M.fac[k];   // שדות מהצינור (pipeline-facades.patch + engine-tileworker-facades.patch) – גוברים על הכללים בלקוח
    if (F && F.ty != null && cls.code !== T.LANDMARK) cls = { code: F.ty, he: TY.T_HE[F.ty], basis: F.fs && F.fs[0] === 'D' ? 'data' : F.fs && F.fs[0] === 'S' ? 'shape' : 'rule', why: 'צינור' };
    const flags = TY.facadeFlags(cls.code, seed, F && F.gf ? true : /retail|commercial/.test(M.typ[k] || '') ? true : undefined);
    if (F && F.m != null) flags.mat = F.m;
    info[k] = { code: cls.code, he: cls.he, basis: cls.basis, why: cls.why, floors, flags, seed, dims, lm, era: F && F.e || null, quarter: F && F.q || null, packed: TY.pack(cls.code, floors, flags) };
  }
  for (let v = 0; v < nb; v++) { const I = info[own[v]]; afc[v * 4 + 2] = I.packed; afc[v * 4 + 3] = I.seed; }
  for (let i = 0; i < quads.length; i += 2) { const v = quads[i], Ld = Math.min(32767, Math.round(quads[i + 1] * 10));
    afc[v * 4 + 1] = afc[(v + 1) * 4 + 1] = afc[(v + 2) * 4 + 1] = afc[(v + 3) * 4 + 1] = Ld;
    afc[(v + 1) * 4] = afc[(v + 2) * 4] = Ld; }   // v0,v3: u=0 · v1,v2: u=L
  g.setAttribute('afc', new THREE.BufferAttribute(afc, 4));
  ud.esh = { info, roofCache: null };
  return info;
}
/* תיקון גובה לציון דרך מצוטט: מתיחה אנכית של קודקודי הבניין מעל הבסיס + עדכון גובה הקומה (afl) ומטא־הנתונים של הכרטיס */
function fixHeight(mesh, k, H, floors) {
  const g = mesh.geometry, ud = mesh.userData, M = ud.t.meta, own = ud.own, pos = g.attributes.position.array, fl = g.attributes.afl.array;
  if (ud.eshFixed && ud.eshFixed[k]) return;
  // הגאומטריה נבנית ב-Worker מהגובה המקורי – לכן מודדים מול h0 השמור, גם אם המטא כבר תוקן ברמת פירוט קודמת
  const base = M.base[k], cur = (M.eshFixed && M.eshFixed[k] ? M.eshFixed[k].h0 : M.h[k]) + (M.par ? M.par[k] : 0); if (!(cur > 0) || Math.abs(cur - H) < 0.5) return;
  const s = H / cur, fh = Math.round(H / Math.max(1, floors) * 10);
  for (let v = 0; v < own.length; v++) if (own[v] === k) { const y = pos[v * 3 + 1]; if (y > base + 0.05) pos[v * 3 + 1] = base + (y - base) * s; if (fl[v * 2 + 1] > 0) fl[v * 2 + 1] = fh; }
  g.attributes.position.needsUpdate = true; g.attributes.afl.needsUpdate = true; g.computeBoundingSphere();
  (ud.eshFixed || (ud.eshFixed = {}))[k] = true;
  if (!M.eshFixed) M.eshFixed = {};
  if (!M.eshFixed[k]) { M.eshFixed[k] = { h0: M.h[k], f0: M.f[k] }; M.h[k] = H - (M.par ? M.par[k] : 0); M.f[k] = floors; if (M.sg) M.sg[k] = 2; }
  ud.t.box.max.y = Math.max(ud.t.box.max.y, base + H + 10);
}

// ---------- ציוד גג: ערכת גאומטריות פרוצדורליות (proc – לא מודלים של יצרן) ----------
function kitGeometry(THREE, kind) {
  const P = [], C = [], N = [];
  const quad = (a, b, c, d, col) => { const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    for (const p of [a, b, c, a, c, d]) { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); C.push(col[0], col[1], col[2]); } };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const box = (x0, y0, z0, x1, y1, z1, col, top) => {
    quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), col); quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), col);
    quad(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), col); quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), col);
    quad(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), top || col); };
  const cyl = (cx, cy, cz, r, len, axis, seg, col) => { // גליל עם מכסים
    for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p = (a, s) => axis === 'x' ? V(cx + s * len / 2, cy + Math.sin(a) * r, cz + Math.cos(a) * r) : V(cx + Math.cos(a) * r, cy + s * len / 2 + len / 2, cz + Math.sin(a) * r);
      if (axis === 'x') quad(p(a0, -1), p(a1, -1), p(a1, 1), p(a0, 1), col); else quad(p(a1, -1), p(a0, -1), p(a0, 1), p(a1, 1), col);
      if (axis === 'y') { const c = V(cx, cy + len, cz); P.push(c.x, c.y, c.z, ...[p(a1, 1), p(a0, 1)].flatMap(q => [q.x, q.y, q.z])); for (let j = 0; j < 3; j++) { N.push(0, 1, 0); C.push(col[0] * 1.05, col[1] * 1.05, col[2] * 1.05); } } } };
  if (kind === 'solar') {   // 2 קולטים 1×2 מ' בשיפוע ~35° לדרום (+z) + דוד אופקי Ø0.55 מ' באורך 1.5 מ' (מידות מקובלות, proc)
    const tilt = 35 * Math.PI / 180, Ld = 2.0, hgt = Math.sin(tilt) * Ld, dep = Math.cos(tilt) * Ld, gl = [0.16, 0.22, 0.32], fr = [0.72, 0.73, 0.74];
    quad(V(-1.0, 0.25, dep / 2), V(1.0, 0.25, dep / 2), V(1.0, 0.25 + hgt, -dep / 2), V(-1.0, 0.25 + hgt, -dep / 2), gl);
    quad(V(1.0, 0.18, dep / 2), V(-1.0, 0.18, dep / 2), V(-1.0, 0.18 + hgt, -dep / 2), V(1.0, 0.18 + hgt, -dep / 2), fr);
    quad(V(-0.9, 0, -dep / 2), V(0.9, 0, -dep / 2), V(0.9, 0.25 + hgt, -dep / 2), V(-0.9, 0.25 + hgt, -dep / 2), fr);   // גב המתקן (במקום רגליים) – 2 משולשים
    cyl(0, 0.35 + hgt, -dep / 2 - 0.25, 0.28, 1.5, 'x', 5, [0.88, 0.88, 0.86]);
  } else if (kind === 'tank') { cyl(0, 0, 0, 0.6, 1.25, 'y', 8, [0.82, 0.83, 0.80]); }   // מיכל מים Ø1.2 מ' (proc)
  else if (kind === 'ac') { box(-0.42, 0, -0.16, 0.42, 0.62, 0.16, [0.88, 0.88, 0.86], [0.80, 0.80, 0.78]); quad(V(-0.3, 0.12, 0.161), V(0.1, 0.12, 0.161), V(0.1, 0.52, 0.161), V(-0.3, 0.52, 0.161), [0.35, 0.36, 0.37]); }
  else if (kind === 'stair') { box(-1.5, 0, -1.5, 1.5, 2.6, 1.5, [0.86, 0.84, 0.79], [0.74, 0.74, 0.72]); quad(V(-0.45, 0.0, 1.51), V(0.45, 0.0, 1.51), V(0.45, 2.05, 1.51), V(-0.45, 2.05, 1.51), [0.42, 0.40, 0.36]); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return geo;
}

/* מיקומי ציוד לגג בניין k (מטריצות עולם). משולשי גג = 3 קודקודים עם נורמל מעלה בגובה הגג (בלי כרכוב המעקה). */
function roofProps(mesh, k, I) {
  const ud = mesh.userData, g = mesh.geometry, M = ud.t.meta, pos = g.attributes.position.array, nrm = g.attributes.normal.array, idx = g.index.array, tw = ud.towner;
  if (!ud.esh.roofCache) { // משולשי גג לפי בניין – מעבר אחד על האינדקס
    const rc = new Map(); for (let tri = 0; tri < ud.nib / 3; tri++) { const kk = tw[tri]; if (kk === 65535) continue; const a = idx[tri * 3], b = idx[tri * 3 + 1], c = idx[tri * 3 + 2];
      if (nrm[a * 3 + 1] < 120 || nrm[b * 3 + 1] < 120 || nrm[c * 3 + 1] < 120) continue; (rc.get(kk) || rc.set(kk, []).get(kk)).push(a, b, c); }
    ud.esh.roofCache = rc; }
  const tris = ud.esh.roofCache.get(k); if (!tris) return null;
  let yr = Infinity; for (const v of tris) { const y = pos[v * 3 + 1]; if (y > M.base[k] + 1.5) yr = Math.min(yr, y); } if (!isFinite(yr)) return null;
  const T3 = []; let A = 0;
  for (let i = 0; i < tris.length; i += 3) { const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    if (Math.abs(pos[a * 3 + 1] - yr) > 0.05 || Math.abs(pos[b * 3 + 1] - yr) > 0.05 || Math.abs(pos[c * 3 + 1] - yr) > 0.05) continue;
    const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2], cx = pos[c * 3], cz = pos[c * 3 + 2], ar = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    if (ar < 0.05) continue; A += ar; T3.push([ax, az, bx, bz, cx, cz, A]); }
  if (!T3.length) return null;
  const kit = TY.roofKit(I.code, I.floors, Math.min(M.area[k], A), M.h[k], I.seed);
  const inside = (x, z) => T3.some(t => { const d = (t[3] - t[5]) * (t[0] - t[4]) + (t[4] - t[2]) * (t[1] - t[5]), l1 = ((t[3] - t[5]) * (x - t[4]) + (t[4] - t[2]) * (z - t[5])) / d, l2 = ((t[5] - t[1]) * (x - t[4]) + (t[0] - t[4]) * (z - t[5])) / d; return l1 >= 0 && l2 >= 0 && l1 + l2 <= 1; });
  let cx = 0, cz = 0; for (const t of T3) { cx += (t[0] + t[2] + t[4]) / 3; cz += (t[1] + t[3] + t[5]) / 3; } cx /= T3.length; cz /= T3.length;
  const occ = new Set(), out = { solar: [], tank: [], ac: [], stair: [] }, ox = mesh.position.x, oz = mesh.position.z;
  const tryPlace = (kind, n, r, salt) => { let placed = 0;
    for (let i = 0; placed < n && i < n * 4 + 4; i++) {
      let x, z;
      if (kind === 'stair' && i === 0) { x = cx; z = cz; }
      else { const w = TY.rnd(I.seed, salt + i * 3) * A; const t = T3.find(q => q[6] >= w) || T3[T3.length - 1]; let u = TY.rnd(I.seed, salt + i * 3 + 1), v = TY.rnd(I.seed, salt + i * 3 + 2); if (u + v > 1) { u = 1 - u; v = 1 - v; }
        x = t[0] + (t[2] - t[0]) * u + (t[4] - t[0]) * v; z = t[1] + (t[3] - t[1]) * u + (t[5] - t[1]) * v;
        const dx = cx - x, dz = cz - z, dl = Math.hypot(dx, dz); if (dl > 1.2) { x += dx / dl * 1.0; z += dz / dl * 1.0; } }
      const corners = [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];
      if (!inside(x, z) || !corners.every(c => inside(c[0], c[1]))) continue;
      const cells = []; let free = true; const cs = 1.1;
      for (let gx = Math.floor((x - r) / cs); gx <= Math.floor((x + r) / cs); gx++) for (let gz = Math.floor((z - r) / cs); gz <= Math.floor((z + r) / cs); gz++) { const key = gx + ',' + gz; if (occ.has(key)) free = false; cells.push(key); }
      if (!free) continue; cells.forEach(c => occ.add(c));
      const rot = kind === 'solar' ? 0 : TY.rnd(I.seed, salt + i * 5) * Math.PI * 2;
      out[kind].push(x + ox, yr, z + oz, rot); placed++; }
  };
  tryPlace('stair', kit.stair, 1.6, 101); tryPlace('tank', kit.tank, 0.7, 211); tryPlace('solar', kit.solar, 1.15, 307); tryPlace('ac', kit.ac, 0.5, 401);
  return out;
}

// ---------- מודלים עצמאיים לציוני דרך (מש אחד, צבעי קודקוד) ----------
function standaloneGeometry(THREE) {
  const P = [], N = [], C = [];
  const tri = (a, b, c, col) => { const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize(); for (const p of [a, b, c]) { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); C.push(...col); } };
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const prism = (pts, y0, y1, col, cap) => { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; quad(V(a[0], y0, a[1]), V(b[0], y0, b[1]), V(b[0], y1, b[1]), V(a[0], y1, a[1]), col); }
    if (cap) for (let i = 1; i + 1 < pts.length; i++) tri(V(pts[0][0], y1, pts[0][1]), V(pts[i + 1][0], y1, pts[i + 1][1]), V(pts[i][0], y1, pts[i][1]), cap); };
  const circle = (cx, cz, r, n) => Array.from({ length: n }, (_, i) => [cx + Math.cos(-i / n * Math.PI * 2) * r, cz + Math.sin(-i / n * Math.PI * 2) * r]);
  const parts = {};
  { // מגדלור: מנסרה משולשת 0–21 מ', גליל 21–42 מ' (עובדה: 42 מ', חצי/חצי); עובי – הנחה
    const s = 3.4, triP = [[0, -s * 1.155], [s, s * 0.577], [-s, s * 0.577]].map(p => [p[0], -p[1]]);
    const start = P.length / 3;
    prism(triP, -2, 21, [0.92, 0.92, 0.9], [0.85, 0.85, 0.83]); prism(circle(0, 0, 2.0, 14), 21, 39, [0.94, 0.94, 0.92]);
    prism(circle(0, 0, 2.5, 14), 39, 39.4, [0.3, 0.3, 0.3], [0.3, 0.3, 0.3]); prism(circle(0, 0, 1.5, 10), 39.4, 41.2, [0.55, 0.75, 0.8]); prism(circle(0, 0, 1.6, 10), 41.2, 42, [0.75, 0.15, 0.12], [0.75, 0.15, 0.12]);
    parts.light = [start, P.length / 3];
  }
  { // מצודה: 35×55 מ', קירות שרידים 4.5 מ' (הנחה), 4 מגדלים עגולים בפינות (הנחה)
    const start = P.length / 3, w = 17.5, l = 27.5, th = 2.2, col = [0.80, 0.72, 0.58], top = [0.72, 0.64, 0.50];
    const walls = [[[-w, -l], [w, -l], [w, -l + th], [-w, -l + th]], [[-w, l - th], [w, l - th], [w, l], [-w, l]], [[-w, -l], [-w + th, -l], [-w + th, l], [-w, l]], [[w - th, -l], [w, -l], [w, l], [w - th, l]]];
    for (const q of walls) { const r = q.slice().reverse(); prism(r, -1, 4.5, col, top); }
    for (const [x, z] of [[-w, -l], [w, -l], [w, l], [-w, l]]) prism(circle(x, z, 3.2, 10), -1, 5.5, col, top);
    prism(circle(0, -l, 3.0, 8), -1, 5.2, col, top);   // שער
    parts.fort = [start, P.length / 3];
  }
  return { P, N, C, parts };
}

// ---------- חיבור למנוע ----------
/* attach(THREE, YZ, opts) — YZ = window.YZ של b6/map (חייב YZ.engine). opts:
     texBase: נתיב לתיקיית הטקסטורות (אופציונלי) · clutter: true · standalone: true · adjustLights: true (לילה: עמעום תאורה ורקע)
   מחזיר API: setTime(date) · setHour(h) · setDetail(0|1) · typologyOf(key,k) · labels(w,h) · stats() · dispose() */
function attach(THREE, YZ, opts = {}) {
  const E = YZ.engine, scene = E.scene, camera = E.camera, TILE_M = (YZ.MAN && YZ.MAN.tile_m) || 1000;
  const mat = createFacadeMaterial(THREE, { texBase: opts.lite ? null : opts.texBase, lite: opts.lite, onReady: () => E.requestRender() });
  const U = mat.userData.uniforms;
  E.setMaterials({ buildings: mat });
  // ציוד גג: 4 קריאות ציור בסך הכול
  const kitMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const KINDS = ['solar', 'tank', 'ac', 'stair'], CAP = Object.assign({ solar: 3000, tank: 800, ac: 2000, stair: 800 }, opts.caps || {});
  const CR = opts.clutterRadius || TY.LOD.CLUTTER;   // רדיוס ציוד גג סביב המצלמה (מ')
  const inst = {}; const root = new THREE.Group(); root.name = 'esh-buildings'; scene.add(root);
  for (const kd of KINDS) { const m = new THREE.InstancedMesh(kitGeometry(THREE, kd), kitMat, CAP[kd]); m.count = 0; m.frustumCulled = false; m.name = 'esh-' + kd; root.add(m); inst[kd] = m; }
  let groupB = null, clutterKey = '', standalone = null, decorated = 0, lastSync = 0;
  const active = new Map();   // mesh → props לבניינים
  const st = { tilesDecorated: 0, buildings: 0, byCode: {}, byBasis: {}, instances: {} };
  function findGroup() { for (const c of scene.children) if (c.isGroup && c.children.some(m => m.userData && m.userData.towner)) return c; return null; }
  function sync() {
    if (!groupB || !groupB.children.length) groupB = findGroup() || groupB; if (!groupB) return;
    for (const m of groupB.children) if (!m.userData.esh && m.userData.t && m.userData.t.meta) {
      const info = decorateMesh(THREE, m, opts); if (!info) continue; decorated++;
      if (!m.userData.t.eshCounted) { m.userData.t.eshCounted = true; st.tilesDecorated++; for (const I of info) { st.buildings++; st.byCode[I.code] = (st.byCode[I.code] || 0) + 1; st.byBasis[I.basis] = (st.byBasis[I.basis] || 0) + 1; } }
    }
    if (opts.clutter !== false) updateClutter();
    if (opts.standalone !== false) updateStandalone();
  }
  function updateClutter() {
    const cp = camera.position, want = [];
    // מהרחוב לא רואים גגות: הרדיוס גדל עם גובה המצלמה מעל הקרקע (150 מ' ברחוב → CR באוויר)
    const camH = cp.y - E.groundHeight(cp.x + E.VO.x, -cp.z + E.VO.n), rad = Math.min(CR, Math.max(150, 120 + camH * 4)), R2 = rad * rad;
    for (const m of groupB.children) { if (!m.userData.esh || !m.geometry.boundingSphere) continue; const t = m.userData.t;
      const d = t.box.distanceToPoint(cp), was = active.has(m);
      if (t.lod === 2 && d < rad * (was ? TY.LOD.HYST : 1)) want.push(m); }
    // מפתח: קבוצת האריחים + תא של 60 מ' סביב המצלמה → בונים מחדש רק כשזה משתנה
    const key = want.map(m => m.uuid).join(',') + '|' + Math.round(cp.x / 60) + ',' + Math.round(cp.y / 60) + ',' + Math.round(cp.z / 60);
    for (const m of [...active.keys()]) if (!m.parent || !want.includes(m)) active.delete(m);
    if (key === clutterKey) return; clutterKey = key;
    for (const m of want) if (!active.has(m)) { const per = []; const info = m.userData.esh.info;
      for (let k = 0; k < info.length; k++) { const p = roofProps(m, k, info[k]); if (p) { p.seed = info[k].seed; per.push(p); } } active.set(m, per); }
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), yAx = new THREE.Vector3(0, 1, 0), pv = new THREE.Vector3();
    for (const kd of KINDS) { const im = inst[kd], cand = [];
      for (const per of active.values()) for (const p of per) { if (p.seed === U.uHide.value) continue; const a = p[kd]; for (let i = 0; i < a.length; i += 4) { const dx = a[i] - cp.x, dy = a[i + 1] - cp.y, dz = a[i + 2] - cp.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < R2) cand.push(d2, a, i); } }
      const ord = []; for (let j = 0; j < cand.length; j += 3) ord.push(j); if (ord.length > CAP[kd]) ord.sort((x, y) => cand[x] - cand[y]);   // הקרובים קודם
      let n = 0; for (const j of ord) { if (n >= CAP[kd]) break; const a = cand[j + 1], i = cand[j + 2]; q.setFromAxisAngle(yAx, a[i + 3]); pv.set(a[i], a[i + 1], a[i + 2]); mtx.compose(pv, q, one); im.setMatrixAt(n++, mtx); }
      im.count = n; im.instanceMatrix.needsUpdate = true; st.instances[kd] = n; }
  }
  function updateStandalone() {
    if (!standalone) { const G = standaloneGeometry(THREE), geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(G.P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(G.N, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(G.C, 3));
      standalone = { geo, parts: G.parts, base: geo.attributes.position.array.slice(), y: {} };
      const m = new THREE.Mesh(geo, kitMat); m.name = 'esh-landmarks'; m.frustumCulled = false; root.add(m); standalone.mesh = m; }
    let moved = false; const P = standalone.geo.attributes.position.array, B = standalone.base;
    for (const s of LM.STANDALONE) { const gy = E.groundHeight(s.itm[0], s.itm[1]); if (standalone.y[s.key] === gy) continue; standalone.y[s.key] = gy; moved = true;
      const sp = E.toScene(s.itm[0], s.itm[1], gy), [a, b] = standalone.parts[s.key], ang = s.key === 'fort' ? -24.5 * Math.PI / 180 : 0, c = Math.cos(ang), sn = Math.sin(ang);
      for (let v = a; v < b; v++) { const x = B[v * 3], y = B[v * 3 + 1], z = B[v * 3 + 2]; P[v * 3] = sp.x + x * c - z * sn; P[v * 3 + 1] = gy + y; P[v * 3 + 2] = sp.z + x * sn + z * c; } }
    if (moved) { standalone.geo.attributes.position.needsUpdate = true; standalone.geo.computeBoundingSphere(); }
  }
  const prevBR = scene.onBeforeRender;
  scene.onBeforeRender = function (...a) { try { sync(); } catch (e) { console.warn('esh-buildings', e); } if (prevBR) prevBR.apply(this, a); };

  // ---------- זמן / לילה ----------
  let hemi = null, hemiI = 0, bg0 = scene.background && scene.background.clone ? scene.background.clone() : null, sunL = null, sunI = 0;
  scene.traverse(o => { if (o.isHemisphereLight && !hemi) { hemi = o; hemiI = o.intensity; } if (o.isDirectionalLight && !sunL) { sunL = o; sunI = o.intensity; } });
  const NIGHT_BG = new THREE.Color().setRGB(0.035, 0.05, 0.09, THREE.SRGBColorSpace);
  function applyNight(night, hour) {
    U.uNight.value = night; U.uLit.value = TY.litFraction(hour);
    if (opts.adjustLights !== false) {
      if (hemi) hemi.intensity = hemiI * (1 - 0.82 * night);
      if (bg0 && scene.background) { scene.background.copy(bg0).lerp(NIGHT_BG, night); if (scene.fog) scene.fog.color.copy(scene.background); }
    }
    E.requestRender();
  }
  function israelHour(date) { try { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date); return +p.find(x => x.type === 'hour').value + +p.find(x => x.type === 'minute').value / 60; } catch (e) { return date.getHours() + date.getMinutes() / 60; } }
  function setTime(date = new Date()) { const s = E.setTime(date); applyNight(TY.nightFactor(s.altitude), israelHour(date)); return Object.assign({ night: U.uNight.value, lit: U.uLit.value }, s); }

  function labels(w, h) {
    const out = [], v = new THREE.Vector3();
    const push = (he, x, y, z, extra) => { v.set(x, y, z).project(camera); if (v.z > 1 || v.z < -1) return; const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h; if (sx < -50 || sx > w + 50 || sy < -20 || sy > h + 20) return;
      out.push(Object.assign({ he, x: sx, y: sy, d: camera.position.distanceTo(new THREE.Vector3(x, y, z)) }, extra)); };
    if (groupB) for (const m of groupB.children) { const es = m.userData.esh; if (!es) continue; const M = m.userData.t.meta;
      es.info.forEach((I, k) => { if (!I.lm) return; push(I.lm.he, m.position.x + M.cen[2 * k], M.base[k] + M.h[k] + 6, m.position.z - M.cen[2 * k + 1], { id: I.lm.id, conf: I.lm.conf, h: I.lm.h || null }); }); }
    for (const s of LM.STANDALONE) { const gy = E.groundHeight(s.itm[0], s.itm[1]), p = E.toScene(s.itm[0], s.itm[1], gy + s.h + 6); push(s.he, p.x, p.y, p.z, { id: s.key, conf: s.conf, h: s.h }); }
    return out.sort((a, b) => a.d - b.d);
  }
  function typologyOf(key, k) { const t = YZ.tiles && YZ.tiles.get(key); const m = t && t.mesh && t.mesh.b; const I = m && m.userData.esh && m.userData.esh.info[k]; if (!I) return null;
    return { code: I.code, he: I.he, basis: I.basis, why: I.why, floors: I.floors, era: I.era, quarter: I.quarter, material: TY.MAT_HE[I.flags.mat], pilotis: !!I.flags.pil, shops: !!I.flags.shop, landmark: I.lm ? I.lm.he : null, procedural: ['חומר', 'עמודים', 'מרפסות', 'תריסים', 'מזגנים', 'ציוד גג'] }; }
  /* findBuilding(osmId) → { key, k, info, dims (ITM), base, h } מאריחים טעונים */
  function findBuilding(id) { if (!groupB) return null; for (const m of groupB.children) { const es = m.userData.esh; if (!es) continue; const M = m.userData.t.meta, k = M.ids.indexOf(id); if (k < 0) continue;
    const I = es.info[k], t = m.userData.t; return { key: t.key, k, info: I, base: M.base[k], h: M.h[k], dims: Object.assign({}, I.dims, { cx: I.dims.cx + t.tx * TILE_M, cn: I.dims.cn + t.ty * TILE_M }) }; } return null; }
  /* hideBuilding(osmId|null): חתך – מסתיר בניין אחד בשיידר (בלי לבנות גאומטריה מחדש) */
  function hideBuilding(id) { U.uHide.value = id ? TY.seedOf(id) : -1; const want = !!id; if (!!mat.defines.ESH_HIDE !== want) { if (want) mat.defines.ESH_HIDE = 1; else delete mat.defines.ESH_HIDE; mat.needsUpdate = true; } clutterKey = ''; E.requestRender(); }
  function stats() { const r = E.info(); return Object.assign({ calls: r.calls, tris: r.tris, heapMB: r.heap, gpuVerts: r.gpuVerts, decoratedMeshes: decorated }, JSON.parse(JSON.stringify(st))); }
  function dispose() { scene.onBeforeRender = prevBR || (() => {}); scene.remove(root); for (const kd of KINDS) inst[kd].geometry.dispose(); if (standalone) standalone.geo.dispose(); kitMat.dispose(); mat.dispose(); }
  sync(); E.requestRender();
  return { material: mat, uniforms: U, setTime, findBuilding, hideBuilding, setHour(h) { applyNight(h >= 6 && h < 17.5 ? 0 : h >= 17.5 && h < 18.6 ? (h - 17.5) / 1.1 : h >= 5 && h < 6 ? 6 - h : 1, h); }, applyNight,
    setQuality(q) { const lite = q === 'lite'; if (!!mat.defines.ESH_LITE !== lite) { if (lite) mat.defines.ESH_LITE = 1; else delete mat.defines.ESH_LITE; mat.needsUpdate = true; E.requestRender(); } },
    setDetail(on) { U.uDetail.value = on ? 1 : 0; root.visible = !!on; E.requestRender(); }, typologyOf, labels, stats, dispose, sync, root, instances: inst };
}

NS.facades = { createFacadeMaterial, decorateMesh, fixHeight, kitGeometry, roofProps, standaloneGeometry, attach, glslParams };
NS.attach = attach;
})(typeof self !== 'undefined' ? self : this);
