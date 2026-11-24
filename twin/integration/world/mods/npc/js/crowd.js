/* מחלקת הדמויות · crowd.js — רינדור המון זול לטלפון.
   דמויות Quaternius UBC (CC0) + אנימציות UAL (CC0) → "אפייה" של האנימציה לטקסטורת קודקודים (VAT) פעם אחת בטעינה,
   ואז כל הדמויות הקרובות בקריאת ציור אחת לכל גוף (גבר/אישה), בלי שלד על המעבד. רחוקות → דמויות שטוחות (impostor) בקריאה אחת.
   סה"כ ≤ 3 קריאות ציור להמון. וריאציה: גובה/רוחב, עור, שיער, בגדים, כיפה/כובע/כיסוי ראש, קסדה ואפוד, מטריה, כיסא, צל.
   ממשק לצוות התחבורה: crowd.push({x,y,z,heading,anim,speed,look,seed}) בכל פריים, ואז crowd.end(camera). */
(function () {
'use strict';
const T = window.THREE;
const C = window.NPCCrowd = {};

// שם פנימי → קליפ ב-UAL, מספר פריימים לאפייה, מהירות טבעית (גבהים לשנייה) לקליפי תנועה
const CLIPS = [
  ['idle', 'Idle_Loop', 16, 0], ['walk', 'Walk_Loop', 18, 0.78], ['run', 'Jog_Fwd_Loop', 14, 1.95], ['talk', 'Idle_Talking_Loop', 24, 0],
  ['sit', 'Sitting_Idle_Loop', 12, 0], ['sittalk', 'Sitting_Talking_Loop', 20, 0], ['arms', 'Idle_FoldArms_Loop', 12, 0],
  ['kneel', 'Fixing_Kneeling', 20, 0], ['carry', 'Walk_Carry_Loop', 18, 0.72],
];
C.CLIPS = CLIPS.map(c => c[0]);
// אזורים (צבע) וחלקים (נראות לפי מסכה)
const RG = { skin: 0, torso: 1, uarm: 2, larm: 3, hand: 4, pelvis: 5, thigh: 6, calf: 7, foot: 8, eyes: 9, brow: 10, hair: 11, beard: 12, stripe: 13,
  kippa: 20, cap: 21, sunhat: 22, scarf: 23, hardhat: 24, umb: 25, stick: 26, chair: 27, blob: 28 };
const PT = { hairA: 1, hairB: 2, beard: 3, kippa: 4, cap: 5, sunhat: 6, scarf: 7, hardhat: 8, umb: 9, chair: 10 };
C.RG = RG; C.PT = PT;
function boneRegion(n) {
  if (/^(Head|neck)/.test(n)) return RG.skin;
  if (/^(spine|clavicle)/.test(n)) return RG.torso;
  if (/^upperarm/.test(n)) return RG.uarm;
  if (/^lowerarm/.test(n)) return RG.larm;
  if (/^(hand|index|middle|pinky|ring|thumb)/.test(n)) return RG.hand;
  if (/^(pelvis|root)/.test(n)) return RG.pelvis;
  if (/^thigh/.test(n)) return RG.thigh;
  if (/^calf/.test(n)) return RG.calf;
  if (/^(foot|ball)/.test(n)) return RG.foot;
  return RG.torso;
}

// ---------- גאומטריות פרוצדורליות לחלקים (בחלל המנורמל: גובה 1)
function partGeos(hd) {
  // hd: {x,y,z,r} – מרכז וגודל הראש במנוחה; ch: {y} גובה מושב; ub: נקודת חזה
  const out = [];
  const add = (geo, part, reg, bone) => out.push({ geo: geo.toNonIndexed ? geo : geo, part, reg, bone });
  const r = hd.r;
  { const g = new T.SphereGeometry(r * 0.62, 10, 3, 0, Math.PI * 2, 0, Math.PI * 0.32); g.translate(hd.x, hd.top - r * 0.62 * 0.93, hd.z - r * 0.18); add(g, PT.kippa, RG.kippa, 'Head'); }
  { const g = new T.SphereGeometry(r * 1.06, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); g.translate(hd.x, hd.top - r * 1.0, hd.z); add(g, PT.cap, RG.cap, 'Head');
    const b = new T.CylinderGeometry(r * 0.75, r * 0.75, r * 0.06, 10, 1, false, -Math.PI * 0.5, Math.PI); b.scale(1, 1, 1.25); b.translate(hd.x, hd.top - r * 0.95, hd.z + r * 0.75); add(b, PT.cap, RG.cap, 'Head'); }
  { const g = new T.SphereGeometry(r * 1.04, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); g.translate(hd.x, hd.top - r * 0.95, hd.z); add(g, PT.sunhat, RG.sunhat, 'Head');
    const b = new T.CylinderGeometry(r * 2.1, r * 2.1, r * 0.05, 16); b.translate(hd.x, hd.top - r * 0.92, hd.z); add(b, PT.sunhat, RG.sunhat, 'Head'); }
  { const g = new T.SphereGeometry(r * 1.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62); g.rotateX(-0.35); g.translate(hd.x, hd.top - r * 1.05, hd.z - r * 0.12); add(g, PT.scarf, RG.scarf, 'Head');
    const k = new T.SphereGeometry(r * 0.55, 8, 6); k.translate(hd.x, hd.top - r * 1.15, hd.z - r * 1.05); add(k, PT.scarf, RG.scarf, 'Head'); }
  { const g = new T.SphereGeometry(r * 1.12, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); g.translate(hd.x, hd.top - r * 0.9, hd.z); add(g, PT.hardhat, RG.hardhat, 'Head');
    const b = new T.CylinderGeometry(r * 1.3, r * 1.3, r * 0.06, 14); b.scale(1, 1, 1.12); b.translate(hd.x, hd.top - r * 0.9, hd.z + r * 0.1); add(b, PT.hardhat, RG.hardhat, 'Head'); }
  // מטריה: מוחזקת מעל הראש, צמודה לחזה (לא מתנדנדת עם היד)
  { const ux = hd.x + 0.07, uz = hd.z + 0.05;
    const c = new T.ConeGeometry(0.33, 0.12, 8, 1, true); c.translate(ux, hd.top + 0.2, uz); add(c, PT.umb, RG.umb, 'spine_03');
    const s = new T.CylinderGeometry(0.006, 0.006, 0.42, 4); s.translate(ux, hd.top + 0.02, uz); add(s, PT.umb, RG.stick, 'spine_03'); }
  return out;
}
function chairGeo(seatY) {
  const g = []; const box = (w, h, d, x, y, z) => { const b = new T.BoxGeometry(w, h, d); b.translate(x, y, z); g.push(b); };
  box(0.26, 0.025, 0.24, 0, seatY, -0.02); box(0.26, 0.2, 0.02, 0, seatY + 0.11, -0.15);
  for (const [x, z] of [[-0.11, -0.12], [0.11, -0.12], [-0.11, 0.08], [0.11, 0.08]]) box(0.02, seatY, 0.02, x, seatY / 2, z);
  return g;
}

// ---------- אפייה
/** body: gltf.scene של UBC, anims: animations של UAL. מחזיר {geo, posTex, nrmTex, clips, verts} */
C.bake = function (body, anims, VW) {
  const t0 = performance.now(); VW = VW || 2048;
  const root = body; root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1); root.updateMatrixWorld(true);
  const meshes = []; root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  const bones = {}; meshes[0].skeleton.bones.forEach(b => { bones[b.name] = b; });
  // פוזת מנוחה = הפוזה שבקובץ (לא skeleton.pose(): הוא מתעלם מהטרנספורם של ה-Armature והופך את הדמות)
  const allBones = []; root.traverse(o => { if (o.isBone) allBones.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
  const restore = () => { for (const [b, p, q, sc] of allBones) { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(sc); } root.updateMatrixWorld(true); };
  const box = new T.Box3(); { const v = new T.Vector3(); for (const m of meshes) { const n = m.geometry.attributes.position.count; m.skeleton.update(); for (let i = 0; i < n; i += 3) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); box.expandByPoint(v); } } }
  const s = 1 / (box.max.y - box.min.y), y0 = box.min.y;   // גובה 1, רגליים ב-0
  const mixer = new T.AnimationMixer(root);
  // --- קודקודי גוף: אזור לפי העצם הדומיננטית / חומר
  const src = [];      // [meshIndex, vertexIndex, reg, part]
  meshes.forEach((m, mi) => {
    const nm = m.name, mat = (m.material && m.material.name) || '';
    let reg = null, part = 0;
    if (/Eye/i.test(mat) && !/brow/i.test(nm)) reg = RG.eyes;
    else if (/brow|^Face/i.test(nm)) reg = RG.brow;
    else if (/Hair/i.test(mat) || /Hair/.test(nm)) { reg = /Beard/.test(nm) ? RG.beard : RG.hair; part = /Beard/.test(nm) ? PT.beard : /Buzz|Buns/.test(nm) ? PT.hairB : PT.hairA; }
    const g = m.geometry, n = g.attributes.position.count, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    for (let i = 0; i < n; i++) { let r = reg;
      if (r == null) { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } } r = boneRegion(m.skeleton.bones[bi].name); }
      src.push([mi, i, r, part]); }
  });
  // --- פוזת מנוחה: מיקום הראש
  restore();
  const v3 = new T.Vector3();
  let hx = 0, hz = 0, hn = 0, htop = -1e9, hmin = 1e9;
  for (const m of meshes) m.skeleton.update();
  for (const [mi, i, r, part] of src) { if (r !== RG.skin || part) continue; meshes[mi].getVertexPosition(i, v3); v3.applyMatrix4(meshes[mi].matrixWorld); const y = (v3.y - y0) * s; if (y > 0.8) { hx += v3.x * s; hz += v3.z * s; hn++; htop = Math.max(htop, y); hmin = Math.min(hmin, y); } }
  const hd = { x: hx / hn, z: hz / hn, top: htop, r: (htop - Math.max(hmin, htop - 0.14)) * 0.5 };
  // --- גובה מושב מתוך אנימציית הישיבה
  let seatY = 0.26;
  { const sit = anims.find(a => a.name === 'Sitting_Idle_Loop'); if (sit) { const act = mixer.clipAction(sit); act.reset().play(); mixer.setTime(0.1); root.updateMatrixWorld(true);
      seatY = Math.max(0.12, (v3.setFromMatrixPosition(bones.pelvis.matrixWorld).y - y0) * s - 0.06); act.stop(); mixer.uncacheAction(sit); } }
  restore();
  const boneRestInv = { Head: bones.Head.matrixWorld.clone().invert(), spine_03: bones.spine_03.matrixWorld.clone().invert() };
  // --- חלקים (נשארים עם אינדקס – פחות קודקודים)
  const parts = partGeos(hd);
  for (const g of chairGeo(seatY)) parts.push({ geo: g, part: PT.chair, reg: RG.chair, bone: null });
  { const g = new T.CircleGeometry(0.2, 12); g.rotateX(-Math.PI / 2); g.translate(0, 0.015, 0); parts.push({ geo: g, part: 0, reg: RG.blob, bone: null }); }
  const pv = []; // [x,y,z,nx,ny,nz,boneName|null,reg,part]
  const idx = []; let base = 0;
  for (const m of meshes) { const g = m.geometry, n = g.attributes.position.count; if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base); else for (let i = 0; i < n; i++) idx.push(i + base); base += n; }
  for (const pr of parts) { const g = pr.geo, P = g.attributes.position, N = g.attributes.normal, b0 = base + pv.length;
    for (let i = 0; i < P.count; i++) pv.push([P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), pr.bone, pr.reg, pr.part]);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(b0 + g.index.getX(i)); else for (let i = 0; i < P.count; i++) idx.push(b0 + i); }
  const nV = src.length + pv.length, RPF = Math.ceil(nV / VW); VW = Math.ceil(nV / RPF);   // רוחב מינימלי (≤2048, מתאים לכל טלפון)
  // --- קליפים
  const clips = {}; let frames = 0;
  for (const [key, name, F, nom] of CLIPS) { const c = anims.find(a => a.name === name) || anims.find(a => a.name === 'Idle_Loop'); clips[key] = { row: frames, frames: F, dur: c.duration, fps: F / c.duration, nom, clip: c }; frames += F; }
  const TH = frames * RPF;
  const pos = new Uint16Array(VW * TH * 4), nrm = new Uint8Array(VW * TH * 4), toH = T.DataUtils.toHalfFloat;
  // --- נתוני סקינינג במערכים טיפוסיים
  const md = meshes.map(m => { const g = m.geometry, n = g.attributes.position.count, P = new Float32Array(n * 3), N = new Float32Array(n * 3), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { P[i * 3] = g.attributes.position.getX(i); P[i * 3 + 1] = g.attributes.position.getY(i); P[i * 3 + 2] = g.attributes.position.getZ(i);
      N[i * 3] = g.attributes.normal.getX(i); N[i * 3 + 1] = g.attributes.normal.getY(i); N[i * 3 + 2] = g.attributes.normal.getZ(i);
      for (let k = 0; k < 4; k++) { SI[i * 4 + k] = g.attributes.skinIndex.getComponent(i, k); SW[i * 4 + k] = g.attributes.skinWeight.getComponent(i, k); } }
    return { m, P, N, SI, SW, nb: m.skeleton.bones.length, BM: new Float32Array(m.skeleton.bones.length * 16) }; });
  const tmp = new T.Matrix4(), tmp2 = new T.Matrix4(), rel = new T.Matrix4(), rootB = bones.root || bones.pelvis;
  const restRoot = new T.Vector3().setFromMatrixPosition(rootB.matrixWorld);
  const put = (vi, row, x, y, z, nx, ny, nz) => { const o = ((row * RPF + Math.floor(vi / VW)) * VW + vi % VW) * 4; pos[o] = toH(x); pos[o + 1] = toH(y); pos[o + 2] = toH(z); pos[o + 3] = 15360;
    const l = Math.hypot(nx, ny, nz) || 1; nrm[o] = (nx / l * 0.5 + 0.5) * 255; nrm[o + 1] = (ny / l * 0.5 + 0.5) * 255; nrm[o + 2] = (nz / l * 0.5 + 0.5) * 255; nrm[o + 3] = 255; };
  const restP = new Float32Array(nV * 3);
  for (const key in clips) {
    const c = clips[key]; mixer.stopAllAction(); const act = mixer.clipAction(c.clip); act.reset().play();
    for (let f = 0; f < c.frames; f++) {
      mixer.setTime(f / c.frames * c.dur); root.updateMatrixWorld(true);
      const rp = v3.setFromMatrixPosition(rootB.matrixWorld), dx = bones.root ? rp.x - restRoot.x : 0, dz = bones.root ? rp.z - restRoot.z : 0; // ביטול תנועת שורש אופקית
      // מטריצה לכל עצם: matrixWorld · bindInv · boneMatrix · bind (ואחר כך נרמול גובה)
      for (const d of md) { const m = d.m; m.skeleton.update(); const bmA = m.skeleton.boneMatrices;
        for (let b = 0; b < d.nb; b++) { tmp.fromArray(bmA, b * 16); tmp2.multiplyMatrices(m.matrixWorld, m.bindMatrixInverse).multiply(tmp).multiply(m.bindMatrix); tmp2.toArray(d.BM, b * 16); } }
      const row = c.row + f; let vi = 0;
      for (const [mi, i] of src) {
        const d = md[mi], E = d.BM; let e0 = 0, e1 = 0, e2 = 0, e4 = 0, e5 = 0, e6 = 0, e8 = 0, e9 = 0, e10 = 0, e12 = 0, e13 = 0, e14 = 0;
        for (let k = 0; k < 4; k++) { const w = d.SW[i * 4 + k]; if (!w) continue; const o = d.SI[i * 4 + k] * 16;
          e0 += E[o] * w; e1 += E[o + 1] * w; e2 += E[o + 2] * w; e4 += E[o + 4] * w; e5 += E[o + 5] * w; e6 += E[o + 6] * w; e8 += E[o + 8] * w; e9 += E[o + 9] * w; e10 += E[o + 10] * w; e12 += E[o + 12] * w; e13 += E[o + 13] * w; e14 += E[o + 14] * w; }
        const px = d.P[i * 3], py = d.P[i * 3 + 1], pz = d.P[i * 3 + 2], nx = d.N[i * 3], ny = d.N[i * 3 + 1], nz = d.N[i * 3 + 2];
        const X = (e0 * px + e4 * py + e8 * pz + e12 - dx) * s, Y = (e1 * px + e5 * py + e9 * pz + e13 - y0) * s, Z = (e2 * px + e6 * py + e10 * pz + e14 - dz) * s;
        put(vi, row, X, Y, Z, e0 * nx + e4 * ny + e8 * nz, e1 * nx + e5 * ny + e9 * nz, e2 * nx + e6 * ny + e10 * nz);
        if (key === 'idle' && f === 0) { restP[vi * 3] = X; restP[vi * 3 + 1] = Y; restP[vi * 3 + 2] = Z; }
        vi++;
      }
      const relOf = {}; for (const bn in boneRestInv) { relOf[bn] = new T.Matrix4().multiplyMatrices(bones[bn].matrixWorld, boneRestInv[bn]).elements; }
      for (const q of pv) {
        let X = q[0], Y = q[1], Z = q[2], NX = q[3], NY = q[4], NZ = q[5];
        if (q[6]) { const e = relOf[q[6]], wx = X / s, wy = Y / s + y0, wz = Z / s;
          X = ((e[0] * wx + e[4] * wy + e[8] * wz + e[12]) - dx) * s; Y = ((e[1] * wx + e[5] * wy + e[9] * wz + e[13]) - y0) * s; Z = ((e[2] * wx + e[6] * wy + e[10] * wz + e[14]) - dz) * s;
          const a = e[0] * NX + e[4] * NY + e[8] * NZ, b = e[1] * NX + e[5] * NY + e[9] * NZ, cc = e[2] * NX + e[6] * NY + e[10] * NZ; NX = a; NY = b; NZ = cc; }
        put(vi, row, X, Y, Z, NX, NY, NZ);
        if (key === 'idle' && f === 0) { restP[vi * 3] = X; restP[vi * 3 + 1] = Y; restP[vi * 3 + 2] = Z; }
        vi++;
      }
    }
    act.stop(); mixer.uncacheAction(c.clip);
  }
  // --- גאומטריה: מזהה קודקוד + אזור + חלק
  const aReg = new Float32Array(nV), aPart = new Float32Array(nV), vid = new Float32Array(nV);
  src.forEach((v, k) => { aReg[k] = v[2]; aPart[k] = v[3]; }); pv.forEach((q, k) => { aReg[src.length + k] = q[7]; aPart[src.length + k] = q[8]; });
  for (let i = 0; i < nV; i++) vid[i] = i;
  // פסים מחזירי אור לאפוד: שתי רצועות גובה בגו
  for (let i = 0; i < src.length; i++) if (aReg[i] === RG.torso) { const y = restP[i * 3 + 1]; if ((y > 0.62 && y < 0.655) || (y > 0.71 && y < 0.745)) aReg[i] = RG.stripe; }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(restP, 3));
  geo.setAttribute('aVid', new T.BufferAttribute(vid, 1)); geo.setAttribute('aReg', new T.BufferAttribute(aReg, 1)); geo.setAttribute('aPart', new T.BufferAttribute(aPart, 1));
  geo.setIndex(nV > 65535 ? new T.Uint32BufferAttribute(idx, 1) : new T.Uint16BufferAttribute(idx, 1));
  geo.boundingSphere = new T.Sphere(new T.Vector3(0, 0.5, 0), 1e5);
  const posTex = new T.DataTexture(pos, VW, TH, T.RGBAFormat, T.HalfFloatType), nrmTex = new T.DataTexture(nrm, VW, TH, T.RGBAFormat, T.UnsignedByteType);
  for (const t of [posTex, nrmTex]) { t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true; }
  for (const k in clips) delete clips[k].clip;
  mixer.stopAllAction();
  return { geo, posTex, nrmTex, clips, verts: nV, VW, RPF, rows: TH, tris: idx.length / 3, ms: performance.now() - t0, gpuBytes: pos.byteLength + nrm.byteLength, seatY, head: hd };
};

// ---------- חומר VAT (Lambert + הזרקה, כך שתאורה וערפל זהים לעולם)
function vatMaterial(b) {
  const m = new T.MeshLambertMaterial({ color: 0xffffff });
  m.userData.u = { uPos: { value: b.posTex }, uNrm: { value: b.nrmTex }, uTime: { value: 0 } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aVid; attribute float aReg; attribute float aPart;
attribute vec4 iAnim; attribute vec4 iSkin; attribute vec4 iTop; attribute vec4 iBot; attribute vec4 iHair;
uniform highp sampler2D uPos; uniform sampler2D uNrm; uniform float uTime;
varying vec3 vCrowd; varying vec3 vBlob;`)
      .replace('#include <beginnormal_vertex>', `
float fr = max(0.0, (uTime - iAnim.z) * iAnim.w); float fl = mod(fr, iAnim.y); float f0 = floor(fl); float ft = fl - f0; float f1 = mod(f0 + 1.0, iAnim.y);
int vI = int(aVid + 0.5), vx = vI % ${b.VW}, vy = vI / ${b.VW};
ivec2 c0 = ivec2(vx, int(iAnim.x + f0) * ${b.RPF} + vy), c1 = ivec2(vx, int(iAnim.x + f1) * ${b.RPF} + vy);
vec3 vatP = mix(texelFetch(uPos, c0, 0).xyz, texelFetch(uPos, c1, 0).xyz, ft);
vec3 objectNormal = normalize(mix(texelFetch(uNrm, c0, 0).xyz, texelFetch(uNrm, c1, 0).xyz, ft) * 2.0 - 1.0);
int pm = int(iSkin.w + 0.5), pa = int(aPart + 0.5);
if (pa > 0 && ((pm >> pa) & 1) == 0) vatP = vec3(0.0);`)
      .replace('#include <begin_vertex>', `vec3 transformed = vatP;
{ int rg = int(aReg + 0.5), st = int(iTop.w + 0.5); vec3 col = iSkin.rgb; vBlob = vec3(0.0);
  bool longS = (st & 1) != 0, longB = (st & 2) != 0, dress = (st & 4) != 0, vest = (st & 8) != 0;
  int ac = int(iHair.w + 0.5);
  vec3 accs[6] = vec3[6](vec3(0.02), vec3(0.85), vec3(0.04,0.06,0.18), vec3(0.32,0.05,0.06), vec3(0.06,0.18,0.08), vec3(0.45,0.36,0.2));
  vec3 acc = accs[ac % 6];
  if (rg == 1 || rg == 2 || rg == 13) col = iTop.rgb;
  else if (rg == 3) col = longS ? iTop.rgb : iSkin.rgb;
  else if (rg == 5 || rg == 6) col = dress ? iTop.rgb * 0.92 : iBot.rgb;
  else if (rg == 7) col = dress ? iTop.rgb * 0.92 : (longB ? iBot.rgb : iSkin.rgb);
  else if (rg == 8) col = iBot.rgb * 0.3 + 0.03;
  else if (rg == 9) col = vec3(0.03);
  else if (rg == 10) col = iHair.rgb * 0.6;
  else if (rg == 11 || rg == 12) col = iHair.rgb;
  else if (rg == 20) col = acc;
  else if (rg == 21) col = iBot.rgb * 0.8 + 0.05;
  else if (rg == 22) col = vec3(0.62, 0.5, 0.3);
  else if (rg == 23) col = mix(iBot.rgb, acc, 0.5) * 0.9 + 0.04;
  else if (rg == 24) col = (ac % 2 == 0) ? vec3(0.95, 0.72, 0.05) : vec3(0.92);
  else if (rg == 25) col = accs[(ac + 2) % 6] * 0.6 + vec3(0.25, 0.05, 0.1) * float(ac % 3);
  else if (rg == 26) col = vec3(0.05);
  else if (rg == 27) col = vec3(0.85);
  else if (rg == 28) { col = vec3(0.0); vBlob = vec3(1.0, transformed.x / 0.2, transformed.z / 0.2); }
  if (vest && (rg == 1 || rg == 13)) col = rg == 13 ? vec3(0.85, 0.88, 0.9) : vec3(0.95, 0.62, 0.05);
  vCrowd = col; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrowd; varying vec3 vBlob;')
      .replace('#include <color_fragment>', `diffuseColor.rgb *= vCrowd;
if (vBlob.x > 0.5) { float r2 = dot(vBlob.yz, vBlob.yz); float a = 0.42 * (1.0 - r2);
  vec2 q = mod(floor(gl_FragCoord.xy), 4.0); float th = (mod(q.x * 2.0 + q.y * 3.0, 4.0) * 4.0 + mod(q.x + q.y * 2.0, 4.0)) / 16.0 + 0.03;
  if (a < th) discard; }`);
  };
  m.customProgramCacheKey = () => 'npc-vat-2-' + b.VW + '-' + b.RPF;
  return m;
}

// ---------- דמויות רחוקות: לוח שטוח שפונה למצלמה, צללית פשוטה
function impostorMaterial() {
  return new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 }, fogColor: { value: new T.Color() }, fogNear: { value: 300 }, fogFar: { value: 1200 } },
    vertexShader: `attribute vec4 iPos; attribute vec4 iTop; attribute vec4 iBot; attribute vec4 iSkin; uniform float uTime;
varying vec2 vUv; varying vec3 vT; varying vec3 vB; varying vec3 vS; varying float vPh; varying float vFog; varying float vFlags;
void main(){ vUv = uv; vT = iTop.rgb; vB = iBot.rgb; vS = iSkin.rgb; vPh = iTop.w > 0.5 ? fract(uTime * 1.6 + iBot.w) : -1.0; vFlags = iSkin.w;
  vec3 c = iPos.xyz; vec3 d = c - cameraPosition; vec3 r = normalize(vec3(d.z, 0.0, -d.x));
  float h = iPos.w, w = h * 0.42; vec3 p = c + r * (uv.x - 0.5) * w + vec3(0.0, uv.y * h, 0.0);
  vec4 mv = viewMatrix * vec4(p, 1.0); vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uLight; uniform vec3 fogColor; uniform float fogNear, fogFar;
varying vec2 vUv; varying vec3 vT; varying vec3 vB; varying vec3 vS; varying float vPh; varying float vFog; varying float vFlags;
float box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return max(d.x, d.y); }
void main(){ vec2 p = vec2((vUv.x - 0.5) * 0.42, vUv.y); vec3 col; bool hit = false;
  float sw = vPh < 0.0 ? 0.0 : sin(vPh * 6.2832) * 0.035;
  if (length((p - vec2(0.0, 0.915)) * vec2(1.0, 0.95)) < 0.06) { col = vS; hit = true; }
  else if (box(p - vec2(0.0, 0.69), vec2(0.075, 0.16)) < 0.0) { col = vT; hit = true; }
  else if (box(p - vec2(-0.1, 0.66), vec2(0.022, 0.15)) < 0.0 || box(p - vec2(0.1, 0.66), vec2(0.022, 0.15)) < 0.0) { col = vT * 0.9; hit = true; }
  else if (box(p - vec2(-0.04 + sw, 0.27), vec2(0.032, 0.27)) < 0.0 || box(p - vec2(0.04 - sw, 0.27), vec2(0.032, 0.27)) < 0.0) { col = vB; hit = true; }
  if (vFlags > 0.5 && length((p - vec2(0.0, 1.07)) * vec2(0.6, 2.2)) < 0.2) { col = vec3(0.25, 0.1, 0.12); hit = true; }
  if (!hit) discard;
  col *= uLight * (0.75 + 0.25 * vUv.y);
  float f = smoothstep(fogNear, fogFar, vFog); gl_FragColor = vec4(mix(col, fogColor, f), 1.0);
  #include <colorspace_fragment>
}`,
  });
}

// ---------- המון: יצירה
const lin = c => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
C.create = async function (opts) {
  opts = Object.assign({ maxNear: 80, maxFar: 400, nearR: 65, farR: 340, assets: 'assets/', vendor: 'vendor/' }, opts);
  if (!window.ESH_GLTF) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = opts.vendor + 'loaders.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  const G = window.ESH_GLTF, Ld = new G.GLTFLoader(); Ld.setMeshoptDecoder(G.MeshoptDecoder);
  const [mm, ff, aa] = await Promise.all(['ubc_male.glb', 'ubc_female.glb', 'ual_anims.glb'].map(f => Ld.loadAsync(opts.assets + f)));
  const bodies = [C.bake(mm.scene, aa.animations), C.bake(ff.scene, aa.animations)];
  const cr = { bodies, opts, list: [], n: 0, time: 0, stats: { near: 0, far: 0, culled: 0, drawCalls: 3, bakeMs: bodies[0].ms + bodies[1].ms, gpuMB: (bodies[0].gpuBytes + bodies[1].gpuBytes) / 1048576 } };
  const group = new T.Group(); group.name = 'npc-crowd'; opts.scene.add(group); cr.group = group;
  cr.mesh = bodies.map((b, k) => {
    const g = b.geo.clone(); const N = opts.maxNear;
    const at = (n, sz) => { const a = new T.InstancedBufferAttribute(new Float32Array(N * sz), sz); a.setUsage(T.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    const attrs = { iAnim: at('iAnim', 4), iSkin: at('iSkin', 4), iTop: at('iTop', 4), iBot: at('iBot', 4), iHair: at('iHair', 4) };
    const mat = vatMaterial(b); const im = new T.InstancedMesh(g, mat, N); im.instanceMatrix.setUsage(T.DynamicDrawUsage);
    im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; im.name = k ? 'npc-female' : 'npc-male';
    im.userData.attrs = attrs; group.add(im); return im;
  });
  { const g = new T.InstancedBufferGeometry(); const q = new T.PlaneGeometry(1, 1); q.translate(0.5, 0.5, 0); g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    const N = opts.maxFar, at = (n) => { const a = new T.InstancedBufferAttribute(new Float32Array(N * 4), 4); a.setUsage(T.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    const attrs = { iPos: at('iPos'), iTop: at('iTop'), iBot: at('iBot'), iSkin: at('iSkin') }; g.instanceCount = 0;
    const m = new T.Mesh(g, impostorMaterial()); m.frustumCulled = false; m.name = 'npc-far'; m.userData.attrs = attrs; group.add(m); cr.far = m; }

  // מראה → צבעים ארוזים (נשמר על הסוכן)
  function pack(a) {
    const L = a.look || C.randomLook(a.seed || 1); const sk = lin(L.skin), tp = lin(L.top), bt = lin(L.bottom), hr = lin(L.hair);
    const st = (L.longSleeve ? 1 : 0) | (L.longBottom ? 2 : 0) | (L.dress ? 4 : 0) | (L.vest ? 8 : 0);
    const acc = (a.seed >>> 3) % 6;
    return { sk, tp, bt, hr, st, acc, L };
  }
  function partsMask(L, anim) {
    let m = 0; const sitting = anim === 'sit' || anim === 'sittalk';
    if (!L.scarf) m |= 1 << (L.hairStyle ? PT.hairB : PT.hairA);
    if (L.beard) m |= 1 << PT.beard;
    if (L.hardhat) m |= 1 << PT.hardhat; else if (L.kippa) m |= 1 << PT.kippa; else if (L.cap) m |= 1 << PT.cap; else if (L.sunhat) m |= 1 << PT.sunhat; else if (L.scarf) m |= 1 << PT.scarf;
    if (L.umbrella && !sitting && anim !== 'kneel' && anim !== 'carry') m |= 1 << PT.umb;
    if (sitting) m |= 1 << PT.chair;
    return m;
  }
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _up = new T.Vector3(0, 1, 0);
  const frustum = new T.Frustum(), _pm = new T.Matrix4(), _sph = new T.Sphere();

  cr.begin = () => { cr.list.length = 0; };
  /** פריט: {x,y,z,heading,anim,speed,look,seed} (y אופציונלי: גובה הקרקע) */
  cr.push = it => { cr.list.push(it); };
  cr.end = function (camera, dt) {
    cr.time += dt || 0.016;
    for (const im of cr.mesh) im.material.userData.u.uTime.value = cr.time;
    cr.far.material.uniforms.uTime.value = cr.time;
    camera.updateMatrixWorld(); _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(_pm);
    const cx = camera.position.x, cz = camera.position.z, nr2 = opts.nearR * opts.nearR, fr2 = opts.farR * opts.farR;
    const vis = []; let culled = 0;
    for (const it of cr.list) {
      const dx = it.x - cx, dz = it.z - cz, d2 = dx * dx + dz * dz; if (d2 > fr2) continue;
      _sph.center.set(it.x, (it.y || 0) + 0.9, it.z); _sph.radius = 1.3;
      if (!frustum.intersectsSphere(_sph)) { culled++; continue; }
      it._cd2 = d2; vis.push(it);
    }
    vis.sort((a, b) => a._cd2 - b._cd2);
    const cnt = [0, 0]; let nf = 0;
    const fa = cr.far.userData.attrs;
    for (const it of vis) {
      if (!it._pk) it._pk = pack(it);
      const pk = it._pk, L = pk.L, h = (it.look && it.look.height) || 1.72, w = (it.look && it.look.width) || 1;
      const k = L.body ? 1 : 0;
      if (it._cd2 < nr2 && cnt[k] < opts.maxNear && cnt[0] + cnt[1] < opts.maxNear) {
        const im = cr.mesh[k], A = im.userData.attrs, i = cnt[k]++;
        _p.set(it.x, it.y || 0, it.z); _q.setFromAxisAngle(_up, it.heading || 0); _s.set(h * w, h, h * w);
        _m.compose(_p, _q, _s); im.setMatrixAt(i, _m);
        const c = bodies[k].clips[it.anim] || bodies[k].clips.idle;
        let fps = c.fps; if (c.nom && it.speed > 0.05) fps *= Math.max(0.35, Math.min(1.7, it.speed / (c.nom * h)));   // צוות תנועה: 0.6→0.35 – הליכה איטית בלי החלקת רגליים
        if (it._fk == null || Math.abs(it._fk - fps) > 0.15 * c.fps || it._fa !== it.anim) { it._fk = fps; it._fa = it.anim; }
        A.iAnim.setXYZW(i, c.row, c.frames, -((it.seed || 0) % 997) * 0.173, it._fk);
        A.iSkin.setXYZW(i, pk.sk[0], pk.sk[1], pk.sk[2], partsMask(L, it.anim));
        A.iTop.setXYZW(i, pk.tp[0], pk.tp[1], pk.tp[2], pk.st);
        A.iBot.setXYZW(i, pk.bt[0], pk.bt[1], pk.bt[2], 0);
        A.iHair.setXYZW(i, pk.hr[0], pk.hr[1], pk.hr[2], pk.acc);
      } else if (nf < opts.maxFar) {
        fa.iPos.setXYZW(nf, it.x, it.y || 0, it.z, h); fa.iTop.setXYZW(nf, pk.tp[0], pk.tp[1], pk.tp[2], it.speed > 0.3 ? 1 : 0);
        fa.iBot.setXYZW(nf, pk.bt[0], pk.bt[1], pk.bt[2], ((it.seed || 0) % 100) / 100); fa.iSkin.setXYZW(nf, pk.sk[0], pk.sk[1], pk.sk[2], L.umbrella ? 1 : 0); nf++;
      }
    }
    for (let k = 0; k < 2; k++) { const im = cr.mesh[k]; im.count = cnt[k]; im.visible = cnt[k] > 0; if (cnt[k]) { im.instanceMatrix.needsUpdate = true; for (const a of Object.values(im.userData.attrs)) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, cnt[k] * 4); } im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, cnt[k] * 16); } }
    cr.far.geometry.instanceCount = nf; cr.far.visible = nf > 0; if (nf) for (const a of Object.values(fa)) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, nf * 4); }
    const f = opts.scene.fog; if (f) { const u = cr.far.material.uniforms; u.fogColor.value.copy(f.color); u.fogNear.value = f.near; u.fogFar.value = f.far; }
    cr.stats.near = cnt[0] + cnt[1]; cr.stats.far = nf; cr.stats.culled = culled; cr.stats.drawCalls = (cnt[0] ? 1 : 0) + (cnt[1] ? 1 : 0) + (nf ? 1 : 0);
    cr.drawn = vis;
  };
  cr.setLight = v => { cr.far.material.uniforms.uLight.value = v; };
  cr.dispose = () => { opts.scene.remove(group); for (const im of cr.mesh) { im.geometry.dispose(); im.material.dispose(); im.dispose(); } for (const b of bodies) { b.posTex.dispose(); b.nrmTex.dispose(); } cr.far.geometry.dispose(); cr.far.material.dispose(); };
  return cr;
};
/** מראה אקראי מתוך זרע (לצוות התחבורה, אם אין להם מראה משלהם) */
C.randomLook = function (seed) {
  const L = window.NPCLife; const R = L.rng(seed >>> 0); const sex = R() < 0.5 ? 'm' : 'f';
  const look = L.makeLook(R, { sex, persona: 'worker', child: false }); look.body = sex === 'f' ? 1 : 0; return look;
};
})();
