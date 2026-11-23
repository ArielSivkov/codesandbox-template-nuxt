/* לוח היזם · תלת־ממד · מנוע אריחים (גדוד 6).
   קואורדינטות סצנה: x = מזרח (מ'), y = מעלה (מ'), z = −צפון (מ'), יחסית ל"ראשית התצוגה" VO (מונע אובדן דיוק Float32 בקואורדינטות ITM ארציות).
   נתונים: data/manifest.json + data/t/<tx>_<ty>.{lo,hi}.bin(.gz) בפורמט YZT1 (ראו report.md). */
(async function () {
'use strict';
const T = window.THREE;
const $ = id => document.getElementById(id);
const fmt = (v, d = 0) => Number(v).toLocaleString('he-IL', { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const qs = new URLSearchParams(location.search);
let toastT = null;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, ms); }
const PERF = { t0: performance.now(), firstFrame: 0, allVisible: 0, bytes: 0, tilesBuilt: 0, buildMs: 0 };
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
// פורמט גדוד 5: index.json → cities/<slug>/manifest.json → tiles/v + tiles/t (אריחי ITM של 1 ק"מ)
const BASE = new URL(qs.get('data') || 'data/', location.href).href;
$('loadTxt').textContent = 'אינדקס ערים';
const INDEX = await getJSON(BASE + 'index.json');
const SLUG = qs.get('city') && INDEX.cities[qs.get('city')] ? qs.get('city') : Object.keys(INDEX.cities)[0];
const MAN = await getJSON(BASE + INDEX.cities[SLUG].manifest);
if (MAN.crs !== 'EPSG:2039') console.warn('crs', MAN.crs);
const TILE = MAN.tile_m;
const [GX0, GY0, GX1, GY1] = MAN.bbox_itm;
const VO = { x: Math.round((GX0 + GX1) / 2), n: Math.round((GY0 + GY1) / 2) };   // ראשית תצוגה: מרכז התחום (ITM אמיתי נשאר מחוץ ל-Float32)
const SRC_HE = { M: 'נמדד/אושר בשטח', O: 'מודל תלת־ממד רשמי', H: 'גובה מ-OSM', L: 'קומות מ-OSM', V: 'Overture', S: 'צילום חזית + AI', P: 'תב"ע מאושרת', G: 'GlobalBuildingAtlas', F: '3D-GloBFP', D: 'פני שטח פחות קרקע', B: 'GHSL', N: 'בניינים שכנים', R: 'כלל אצבע', Q: 'מקור מתועד (רשימה/CTBUH)' };
const CONF_HE = ['מאומת', 'גבוה', 'בינוני', 'נמוך'];

// ---------- מדידות שטח (אותו מפתח כמו המפה המקורית – המדידות עוברות) ----------
const MKEY = 'yazam3d.v2.measurements';
let MEAS = {}; try { MEAS = JSON.parse(localStorage.getItem(MKEY) || '{}') || {}; } catch (e) { MEAS = {}; }
const measMap = () => { const o = {}; for (const [id, m] of Object.entries(MEAS)) if (m && m.floors) o[String(id).replace(/^w/, '')] = { floors: m.floors, source: m.source }; return o; };
const mid = id => String(id).replace(/^w/, '');   // מזהה OSM של גדוד 5 (w123) ↔ המפה המקורית (123)
function saveMeas() { try { localStorage.setItem(MKEY, JSON.stringify(MEAS)); } catch (e) { /* אין אחסון */ } $('mCount').textContent = Object.keys(MEAS).length; }

// ---------- Worker ----------
let W = null, LOCAL = null, msgId = 0; const pending = new Map();
try { W = new Worker('js/tileworker.js'); W.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.err ? p.rej(new Error(e.data.err)) : p.res(e.data.res); };
  W.onerror = () => { if (!LOCAL) { W = null; } }; } catch (e) { W = null; }
async function ensureLocal() { if (LOCAL) return LOCAL; await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/tileworker.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); LOCAL = window.YZWorkerLocal; return LOCAL; }
async function call(m) {
  if (W) return new Promise((res, rej) => { m.id = ++msgId; pending.set(m.id, { res, rej }); W.postMessage(m); });
  const L = await ensureLocal(); const r = await L.handle(m); return Array.isArray(r) ? r[0] : r;
}
const CFG = { base: BASE, tile: TILE };
await call({ type: 'init', cfg: CFG }); await call({ type: 'meas', meas: measMap() });
const ROOF_DEMO = qs.get('roofs') === 'demo'; if (ROOF_DEMO) await call({ type: 'roofdemo', on: true });

// ---------- רנדרר: יחס פיקסלים מוגבל, ציור לפי דרישה ----------
const DPR = Math.min(window.devicePixelRatio || 1, +qs.get('dpr') || 1.5);
const canvas = $('cv');
const renderer = new T.WebGLRenderer({ canvas, antialias: DPR < 2, powerPreference: 'default', stencil: false });
renderer.setPixelRatio(DPR);
renderer.outputColorSpace = T.SRGBColorSpace;
const BGC = new T.Color().setRGB(0.86, 0.86, 0.83, T.SRGBColorSpace);   // אובך ניטרלי – לא נראה כמו מים
const scene = new T.Scene(); scene.background = BGC; scene.fog = new T.Fog(BGC, 6000, 16000);
const camera = new T.PerspectiveCamera(45, 1, 5, 60000);
scene.add(new T.HemisphereLight(0xeaf4ff, 0x8a7a66, 1.9));
const sun = new T.DirectionalLight(0xfff1dc, 1.7); sun.position.set(-1800, 4000, 2600)   /* שמש מדרום-מערב (ישראל) */; scene.add(sun);

// חומר בניינים: למברט + קווי קומות בשיידר (בלי גאומטריה נוספת), נמוגים עם המרחק
const bmat = new T.MeshLambertMaterial({ vertexColors: true });
bmat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 afl;\nvarying vec2 vFl;\nvarying float vY;\nvarying float vDist;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFl = afl; vY = position.y;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvDist = -mvPosition.z;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFl;\nvarying float vY;\nvarying float vDist;')
    .replace('#include <color_fragment>', `#include <color_fragment>
    if (vFl.y > 5.0) { float f = (vY - vFl.x * 0.1) / (vFl.y * 0.1); float w = fwidth(f);
      float d = abs(fract(f + 0.5) - 0.5); float ln = 1.0 - smoothstep(0.0, w * 1.2 + 0.015, d);
      float fd = 1.0 - smoothstep(500.0, 1500.0, vDist); diffuseColor.rgb *= 1.0 - 0.22 * ln * fd * step(0.6, f); }`);
};
const gmat = new T.MeshLambertMaterial({ vertexColors: true });
const rmat = new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
const MAT = { b: null, r: null };   // וו חומרים (setMaterials)
const groups = { b: new T.Group(), g: new T.Group(), r: new T.Group(), h: new T.Group() };
Object.values(groups).forEach(g => scene.add(g)); groups.h.visible = false;

// ים רחוק (מחוץ לרשת השטח, רק מערבית לקו החוף) – מצולע אחד
// ים רחוק: מלבנים מערבית לקו החוף, מחושבים מקצוות הים של האריחים שנטענו (לגדוד 5 אין עדיין מצולע חוף גס – הצעה בדוח)
const seaFarMat = new T.MeshLambertMaterial({ color: new T.Color(48 / 255, 112 / 255, 153 / 255) });   // אותו גוון (ליניארי) כמו הים באריחים
let seaFar = null;
function rebuildSeaFar() {
  const F = 40000, rows = new Map(); let tyMin = Infinity, tyMax = -Infinity;
  for (const t of tiles.values()) { tyMin = Math.min(tyMin, t.ty); tyMax = Math.max(tyMax, t.ty); const r = rows.get(t.ty); if (!r || t.tx < r.tx) rows.set(t.ty, t); }
  const rects = [], edgeX = (t, side) => t && t.meta && t.meta.seaEdge && t.meta.seaEdge[side] >= 0 ? t.tx * TILE + t.meta.seaEdge[side] : null;
  for (const [ty, t] of rows) { if (!t.meta) { rects.push([GX0 - F, ty * TILE, Math.min(GX0, t.tx * TILE), ty * TILE + TILE]); continue; }
    if (t.meta.seaEdge && t.meta.seaEdge.w) rects.push([GX0 - F, ty * TILE, t.tx * TILE, ty * TILE + TILE]); else rects.push([GX0 - F, ty * TILE, Math.min(GX0, t.tx * TILE), ty * TILE + TILE]); }
  const sx = edgeX(rows.get(tyMin), 's'), nx = edgeX(rows.get(tyMax), 'n');
  rects.push([GX0 - F, tyMin * TILE - F, sx != null ? sx : GX0, tyMin * TILE]); rects.push([GX0 - F, (tyMax + 1) * TILE, nx != null ? nx : GX0, (tyMax + 1) * TILE + F]);
  const pos = []; for (const [x0, n0, x1, n1] of rects) { if (x1 <= x0) continue; const a = [x0 - VO.x, -(n0 - VO.n)], b = [x1 - VO.x, -(n0 - VO.n)], c = [x1 - VO.x, -(n1 - VO.n)], d = [x0 - VO.x, -(n1 - VO.n)];
    pos.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1], a[0], 0, a[1], c[0], 0, c[1], d[0], 0, d[1]); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(pos.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  if (seaFar) { seaFar.geometry.dispose(); scene.remove(seaFar); }
  seaFar = new T.Mesh(g, seaFarMat); seaFar.name = 'seaFar'; seaFar.material.side = T.DoubleSide; scene.add(seaFar); requestRender();
}
let seaFarT = 0; const seaFarSoon = () => { clearTimeout(seaFarT); seaFarT = setTimeout(rebuildSeaFar, 300); };

// ---------- אריחים ----------
const tiles = new Map();
for (const key of MAN.tiles) { const info = { hmax: 120 };
  const [tx, ty] = key.split('_').map(Number), ox = tx * TILE - VO.x, on = ty * TILE - VO.n;
  const box = new T.Box3(new T.Vector3(ox, -5, -(on + TILE)), new T.Vector3(ox + TILE, info.hmax + 60, -on));
  tiles.set(key, { key, tx, ty, info, ox, on, box, lod: -1, want: -1, busy: false, meta: null, mesh: {}, used: 0, verts: 0, vis: false, d: 1e9 });
}
const LOD_D = [0, 2200, 650];      // מרחק כניסה לרמה 1 ו-2 (מ')
const HYST = 1.25;
const GPU_BUDGET = +qs.get('budget') || 900000;  // קודקודים על ה-GPU (~25–35MB)
const MAX_INFLIGHT = Math.min(6, (navigator.hardwareConcurrency || 4) + 2);  // בקשות במקביל (רשת סלולרית: השהיה, לא רוחב פס)
let showB = true, inflight = 0, gpuVerts = 0, selected = null, paintMode = 'base', current = null;
const frustum = new T.Frustum(), pm = new T.Matrix4();
function wantedLod(t) {
  const d = t.d; let w = d < LOD_D[2] ? 2 : d < LOD_D[1] ? 1 : 0;
  if (t.lod > w && d < LOD_D[t.lod] * HYST) w = t.lod; // היסטרזיס – לא קופץ הלוך ושוב
  return w;
}
function scheduleTiles() {
  camera.updateMatrixWorld(); pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
  const now = performance.now(), cp = camera.position; let missing = 0;
  for (const t of tiles.values()) {
    t.vis = frustum.intersectsBox(t.box); t.d = t.box.distanceToPoint(cp);
    if (t.vis) { t.used = now; t.want = wantedLod(t); if (t.lod < 0 && !(t.failed >= 2)) missing++; } else t.want = t.d < 300 ? Math.max(t.lod, 0) : -1;
  }
  const q = [...tiles.values()].filter(t => !t.busy && !(t.failed >= 2) && t.want >= 0 && t.want !== t.lod && (t.vis || t.lod < 0))
    .sort((a, b) => ((a.lod < 0 ? 0 : 1) - (b.lod < 0 ? 0 : 1)) || (a.d - b.d));
  for (const t of q) { if (inflight >= MAX_INFLIGHT) break; requestTile(t, t.want); }
  // תקציב זיכרון גרפי: משחררים אריחים שמחוץ למסך, הישן ביותר קודם (LRU)
  if (gpuVerts > GPU_BUDGET) {
    const ev = [...tiles.values()].filter(t => !t.vis && t.lod >= 0 && !t.busy).sort((a, b) => a.used - b.used);
    for (const t of ev) { if (gpuVerts <= GPU_BUDGET * 0.85) break; dropTile(t); }
  }
  const P = $('prog');
  if (missing) { P.style.display = 'block'; P.textContent = `טוען אריחים… ${missing}`; } else { P.style.display = 'none'; if (!PERF.allVisible) PERF.allVisible = performance.now() - PERF.t0; }
  return missing;
}
function disposeMesh(t, k) { const m = t.mesh[k]; if (!m) return; m.parent && m.parent.remove(m); m.geometry.dispose();  t.mesh[k] = null; }
function dropTile(t) { for (const k of ['b', 'r', 'h']) disposeMesh(t, k); gpuVerts -= t.verts; t.verts = 0; t.lod = -1; }
async function requestTile(t, lod) {
  t.busy = true; inflight++;
  try {
    const res = await call({ type: 'build', key: t.key, lod, wantMeta: !t.meta });
    PERF.tilesBuilt++; PERF.buildMs += res.ms; if (!t.counted) { PERF.bytes += res.bytes; t.counted = true; }
    if (res.meta) { t.meta = res.meta; t.box.max.y = res.meta.hmax + 10; addIdx(t); if (res.meta.seaEdge) seaFarSoon(); }
    applyTile(t, res);
  } catch (e) { console.warn('tile', t.key, e); t.failed = (t.failed || 0) + 1; }
  t.busy = false; inflight--; requestRender(true);
  if (current && current.kind === 'street') drawStreet(current.name);
}
function applyTile(t, res) {
  const oldV = t.verts; let nv = 0;
  disposeMesh(t, 'b'); disposeMesh(t, 'r');
  if (res.m) {
    const b = res.m, g = new T.BufferGeometry(), n = b.pos.length / 3, col = new Uint8Array(n * 3);
    col.set(b.gcol, b.nb * 3);   // צבעי הקרקע/הים קבועים; צבעי הבניינים נצבעים ב-paintTile
    g.setAttribute('position', new T.BufferAttribute(b.pos, 3)); g.setAttribute('normal', new T.BufferAttribute(b.nrm, 3, true));
    g.setAttribute('color', new T.BufferAttribute(col, 3, true)); g.setAttribute('afl', new T.BufferAttribute(b.fl, 2));
    g.setIndex(new T.BufferAttribute(b.idx, 1)); g.computeBoundingSphere();
    const m = new T.Mesh(g, MAT.b || bmat); m.position.set(t.ox, 0, -t.on); m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData = { t, own: b.own, sh: b.sh, towner: b.towner, nib: b.nib }; if (!showB) g.setDrawRange(b.nib, Infinity); t.mesh.b = m; groups.b.add(m); paintTile(t); nv += n;
  }
  if (res.r && res.r.pos.length) {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(res.r.pos, 3)); g.setAttribute('color', new T.BufferAttribute(res.r.col, 3, true)); g.computeBoundingSphere();
    const m = new T.LineSegments(g, MAT.r || rmat); m.position.set(t.ox, 0, -t.on); m.matrixAutoUpdate = false; m.updateMatrix(); t.mesh.r = m; groups.r.add(m); nv += res.r.pos.length / 3;
  }
  t.lod = res.lod; t.verts = nv; gpuVerts += nv - oldV;
  if (groups.h.visible && t.heatTex && !t.mesh.h) heatMesh(t);
}
function heatMesh(t) { // רשת 11×11 על פני הקרקע, נבנית רק כשהשכבה פעילה
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const x = j * 100, n = i * 100; pos.push(x, H(t.tx * TILE + x, t.ty * TILE + n) + 1.5, -n); uv.push(j / 10, i / 10); }
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { const a = i * 11 + j; idx.push(a, a + 1, a + 12, a, a + 12, a + 11); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new T.Mesh(g, t.heatMat); m.position.set(t.ox, 0, -t.on); m.matrixAutoUpdate = false; m.updateMatrix(); m.renderOrder = 2; m.material.side = T.DoubleSide; t.mesh.h = m; groups.h.add(m);
}
// מפת חום: טקסטורת 10×10 לאריח (הדגמה – אותה נוסחה כמו במפה המקורית, מחושבת מראש)
const ramp = (t, c) => { t = Math.min(Math.max(t, 0), 1);
  const s = [[0.27, 0.46, 0.80], [0.30, 0.72, 0.55], [0.97, 0.82, 0.30], [0.90, 0.33, 0.25]], x = t * 3, i = Math.min(2, x | 0), f = x - i;
  c.setRGB(s[i][0] + (s[i + 1][0] - s[i][0]) * f, s[i][1] + (s[i + 1][1] - s[i][1]) * f, s[i][2] + (s[i + 1][2] - s[i][2]) * f); return c; };
function makeHeat(t) {
  const d = new Uint8Array(400), c = new T.Color();
  for (let i = 0; i < 100; i++) { const v = Math.min(1, t.meta.heat[i] / 1000); ramp(v, c); d.set([c.r * 255, c.g * 255, c.b * 255, v > 0.08 ? 60 + 180 * v : 0], i * 4); }
  const tex = new T.DataTexture(d, 10, 10); tex.magFilter = T.LinearFilter; tex.colorSpace = T.SRGBColorSpace; tex.needsUpdate = true;
  t.heatTex = tex; t.heatMat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
}

// ---------- צביעה ----------
const C_WALL = new T.Color(0.93, 0.91, 0.87), C_SEL = new T.Color(1.0, 0.62, 0.12), C_SRC = { est: new T.Color(0.66, 0.70, 0.76), ai: new T.Color(0.22, 0.80, 0.45), manual: new T.Color(0.66, 0.42, 0.90) };
function bInfo(t, k) { // {h: עד תקרת הגג, par: מעקה, f, sg, src, conf}
  const M = t.meta, m = MEAS[mid(M.ids[k])];
  if (m && m.floors) return { h: m.floors * 3, par: M.par[k] > 0 || M.roof[k] === 0 ? 1.0 : 0, f: m.floors, fl: m.floors, fh: m.floors, sg: Math.max(0.5, m.floors * 0.15 + 0.5), src: m.source === 'ai' ? 'ai' : 'manual', conf: 0 };
  return { h: M.h[k], par: M.par[k], f: M.f[k], fl: M.flo[k], fh: M.fhi[k], sg: M.sg[k], src: 'est', conf: M.conf[k] };
}
const CONF_T = [0.12, 0.38, 0.62, 0.95];
function colorOfConf(I, c) { return ramp(I.conf >= 0 ? CONF_T[I.conf] : 0.15 + Math.min(1, Math.max(0, (I.sg / Math.max(I.h, 1) - 0.12) / 0.4)) * 0.85, c); }
function colorOf(t, k, c) {
  if (selected && selected.t === t && selected.k === k) return c.copy(C_SEL);
  const I = bInfo(t, k);
  if (paintMode === 'height') return ramp((I.h - 3) / 40, c);
  if (paintMode === 'source') return c.copy(C_SRC[I.src]);
  if (paintMode === 'conf') return ramp(I.conf >= 0 ? CONF_T[I.conf] : 0.15 + Math.min(1, Math.max(0, (I.sg / Math.max(I.h, 1) - 0.12) / 0.4)) * 0.85, c); // ביטחון גדוד 5: מאומת→ירוק … נמוך→אדום
  return c.copy(C_WALL);
}
function paintTile(t) {
  const m = t.mesh.b; if (!m || !t.meta) return;
  const { own, sh } = m.userData, col = m.geometry.attributes.color.array, c = new T.Color(); let last = -1, r = 0, g = 0, b = 0;
  for (let v = 0; v < own.length; v++) { if (own[v] !== last) { last = own[v]; colorOf(t, last, c); r = c.r; g = c.g; b = c.b; }
    const s = sh[v] / 255 * 255; col[v * 3] = r * s; col[v * 3 + 1] = g * s; col[v * 3 + 2] = b * s; }
  m.geometry.attributes.color.needsUpdate = true;
}
function repaintAll() { for (const t of tiles.values()) paintTile(t); legend(); requestRender(); }

// ---------- גובה קרקע מאריחים טעונים ----------
function H(x, n) { // x,n במטרים מקומיים (לא יחסית ל-VO)
  const tx = Math.floor(x / TILE), ty = Math.floor(n / TILE), t = tiles.get(tx + '_' + ty);
  if (!t || !t.meta || !t.meta.terr) return 0;
  const N = t.meta.N, S = t.meta.step, c = Math.min(Math.max((x - tx * TILE) / S, 0), N - 1.001), r = Math.min(Math.max((n - ty * TILE) / S, 0), N - 1.001);
  const i = r | 0, j = c | 0, a = r - i, b = c - j, G = t.meta.terr;
  return Math.max(0, G[i * N + j] * (1 - a) * (1 - b) + G[i * N + j + 1] * (1 - a) * b + G[(i + 1) * N + j] * a * (1 - b) + G[(i + 1) * N + j + 1] * a * b);
}

// ---------- מצלמה ----------
const cam = { tx: 0, tz: 0, dist: 3400, theta: 0.5, phi: 0.95 };
const HOME = { ...cam };
function fitHome() { const a = window.innerWidth / window.innerHeight; Object.assign(HOME, { tx: 0, tz: 0, theta: -0.55, dist: a < 0.8 ? 13500 : a < 1.4 ? 10000 : 8800, phi: a < 0.8 ? 0.5 : 0.85 }); }
fitHome(); Object.assign(cam, HOME);
if (qs.get('at')) { const [x, n, d] = qs.get('at').split(',').map(Number); if (isFinite(x) && isFinite(n)) Object.assign(cam, { tx: x - VO.x, tz: -(n - VO.n), dist: d || 700, phi: 0.9 }); }   // קישור עמוק: ?at=<ITM x>,<ITM y>,<מרחק>
let dirty = true, fly = null, camMoved = true;
function applyCam() {
  cam.dist = Math.min(Math.max(cam.dist, 60), 22000); cam.phi = Math.min(Math.max(cam.phi, 0.12), 1.45);
  cam.tx = Math.min(Math.max(cam.tx, GX0 - VO.x), GX1 - VO.x); cam.tz = Math.min(Math.max(cam.tz, -(GY1 - VO.n)), -(GY0 - VO.n));
  const ty = H(cam.tx + VO.x, -cam.tz + VO.n), s = Math.sin(cam.phi);
  camera.position.set(cam.tx + cam.dist * s * Math.sin(cam.theta), ty + cam.dist * Math.cos(cam.phi), cam.tz + cam.dist * s * Math.cos(cam.theta));
  camera.lookAt(cam.tx, ty, cam.tz);
  // מישור קרוב/רחוק דינמי: דיוק עומק טוב יותר בטלפון (פחות z-fighting בחוף ובגגות)
  camera.near = Math.max(2, cam.dist * 0.02); camera.far = Math.max(20000, cam.dist * 4 + 30000); camera.updateProjectionMatrix();
  scene.fog.near = Math.max(5000, cam.dist * 0.9); scene.fog.far = Math.max(15000, cam.dist * 2.6);
  dirty = true; camMoved = true; requestRender();
}
function flyTo(x, n, dist = 650, cb) { fly = { a: { ...cam }, b: { tx: x - VO.x, tz: -(n - VO.n), dist, phi: 0.85, theta: cam.theta }, t0: performance.now(), dur: 900, cb }; requestRender(); }
function pan(dx, dy) {
  const k = cam.dist * 2 * Math.tan(camera.fov * Math.PI / 360) / canvas.clientHeight, c = Math.cos(cam.theta), s = Math.sin(cam.theta);
  cam.tx -= (dx * c + dy * s / Math.max(Math.cos(cam.phi), 0.35)) * k; cam.tz -= (-dx * s + dy * c / Math.max(Math.cos(cam.phi), 0.35)) * k; applyCam();
}
const ptrs = new Map(); let tap = null;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); if (drawDown(e)) { tap = null; return; } ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey || e.ctrlKey }); tap = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; fly = null; });
canvas.addEventListener('pointermove', e => {
  if (drawMove(e)) return;
  const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 7) tap = null;
  if (ptrs.size === 1) { if (p.b === 2 || p.sh) { cam.theta -= dx * 0.006; cam.phi -= dy * 0.005; applyCam(); } else pan(dx, dy); }
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], o = a === p ? b : a, nx = e.clientX, ny = e.clientY, d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(nx - o.x, ny - o.y);
    const a0 = Math.atan2(p.y - o.y, p.x - o.x), a1 = Math.atan2(ny - o.y, nx - o.x); if (d0 > 10 && d1 > 10) cam.dist *= d0 / d1;
    let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; cam.theta -= da; cam.phi -= dy * 0.003; pan(dx / 2, 0); applyCam(); }
  p.x = e.clientX; p.y = e.clientY;
});
const up = e => { if (drawUp()) { ptrs.delete(e.pointerId); tap = null; return; } if (drawing) hideLoupe(); if (tap && ptrs.size === 1 && performance.now() - tap.t < 500) (drawing ? addPlotPoint : pick)(e.clientX, e.clientY); ptrs.delete(e.pointerId); tap = null; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); tap = null; });
canvas.addEventListener('wheel', e => { e.preventDefault(); fly = null; cam.dist *= Math.exp(e.deltaY * 0.0012); applyCam(); }, { passive: false });
const hold = (id, fn) => { let t = null; const b = $(id); const go = () => { fn(); t = setTimeout(go, 60); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); fly = null; go(); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(n => b.addEventListener(n, () => clearTimeout(t))); };
hold('zIn', () => { cam.dist *= 0.9; applyCam(); }); hold('zOut', () => { cam.dist /= 0.9; applyCam(); });
hold('rL', () => { cam.theta += 0.06; applyCam(); }); hold('rR', () => { cam.theta -= 0.06; applyCam(); });
$('tilt').onclick = () => { cam.phi = cam.phi > 0.8 ? 0.35 : 1.1; applyCam(); };
$('home').onclick = () => { fitHome(); fly = null; Object.assign(cam, HOME); applyCam(); closeCard(); };
window.addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; const k = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key]; if (k) pan(k[0], k[1]); if (e.key === '+' || e.key === '=') { cam.dist *= 0.9; applyCam(); } if (e.key === '-') { cam.dist /= 0.9; applyCam(); } });

// ---------- בחירה ----------
const ray = new T.Raycaster(), ndc = new T.Vector2();
function hitAt(cx, cy) {
  const r = canvas.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
  const targets = groups.b.children.slice(); const sea = scene.getObjectByName('seaFar'); if (sea) targets.push(sea);
  return ray.intersectObjects(targets, false)[0] || null;
}
function pick(cx, cy) {
  const hit = hitAt(cx, cy); if (!hit) { closeCard(); return; }
  const own = hit.object.userData.towner ? hit.object.userData.towner[hit.faceIndex] : 65535;
  if (own !== 65535) showBuilding(hit.object.userData.t, own);
  else showCell(hit.point);
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const TYPE_HE = { '': 'לא מסווג', apartments: 'בניין דירות', residential: 'מגורים', house: 'בית', detached: 'בית צמוד קרקע', semidetached_house: 'דו־משפחתי', roof: 'גגון', commercial: 'מסחרי', retail: 'קמעונאות', industrial: 'תעשייה', warehouse: 'מחסן', school: 'בית ספר', kindergarten: 'גן ילדים', university: 'אקדמיה', college: 'מכללה', public: 'ציבורי', civic: 'מבנה עירוני', synagogue: 'בית כנסת', townhall: 'בניין עירייה', hospital: 'בית חולים', office: 'משרדים', construction: 'בבנייה', hotel: 'מלון', train_station: 'תחנת רכבת', manufacture: 'ייצור', sports_centre: 'מרכז ספורט', cowshed: 'רפת' };
const RES = new Set(['', 'apartments', 'residential', 'dormitory', 'house', 'detached', 'semidetached_house']);
function setSelected(t, k) { const prev = selected; selected = t ? { t, k } : null; if (prev) paintTile(prev.t); if (t && (!prev || prev.t !== t)) paintTile(t); requestRender(); }

// מדידות מהמודל: היקף, חזיתות לפי כיוון, גג, מעקה
const PARAPET = 1.05, OPEN = 0.2, PITCH_DEG = 30;
function measure(rings, I, roofCode) {
  const side = [0, 0, 0, 0]; let Po = 0, Pi = 0, A = 0;
  rings.forEach((r, ri) => { const m = r.length / 2; let a2 = 0;
    for (let i = 0; i < m; i++) { const j = (i + 1) % m, ax = r[i * 2], an = r[i * 2 + 1], bx = r[j * 2], bn = r[j * 2 + 1], L = Math.hypot(bx - ax, bn - an);
      a2 += ax * bn - bx * an; if (!L) continue; if (ri === 0) Po += L; else Pi += L;
      const nx = (bn - an) / L, nn = -(bx - ax) / L; let az = Math.atan2(nx, nn) * 180 / Math.PI; if (az < 0) az += 360;   // 0 = צפון, 90 = מזרח
      side[Math.round(az / 90) % 4] += L; }
    A += ri === 0 ? Math.abs(a2) / 2 : -Math.abs(a2) / 2; });
  const pitched = roofCode === 2 || roofCode === 3, par = pitched ? 0 : I.par, Hf = I.h + par;
  const gross = (Po + Pi) * Hf;
  return { Po, Pi, A, Hf, par, sides: side.map(L => L * Hf), sideLen: side, gross, grossErr: (Po + Pi) * I.sg, net: gross * (1 - OPEN), roof: pitched ? A / Math.cos(PITCH_DEG * Math.PI / 180) : A, pitched, parInner: par ? Po * par : 0 };
}
// אינדקס חיפוש: נבנה מהאריחים שנטענו (לגדוד 5 אין עדיין קובץ חיפוש לעיר – הצעה: cities/<slug>/search.json)
const STREETS = new Map(), BLDS = []; let IDX = [], idxDirty = true;
function addIdx(t) { const I = t.meta.idx; if (!I) return;
  for (const [nm, x, n, w, pts] of I.streets) { const o = STREETS.get(nm) || { sx: 0, sn: 0, w: 0, pts: [] }; o.sx += x * w; o.sn += n * w; o.w += w; for (let i = 0; i < pts.length; i += 2) o.pts.push(pts[i], pts[i + 1]); STREETS.set(nm, o); }
  for (const [nm, x, n, k, typ] of I.blds) BLDS.push({ kind: 'bld', label: nm, key: norm(nm), x, n, tile: t.key, k, sub: TYPE_HE[typ] || typ });
  idxDirty = true; }
function buildIdx() { if (!idxDirty) return; idxDirty = false;
  IDX = [...STREETS.entries()].map(([nm, o]) => { const cx = o.sx / o.w, cn = o.sn / o.w; let bx = cx, bn = cn, bd = Infinity, ext = 0;
    for (let i = 0; i < o.pts.length; i += 2) { const d = (o.pts[i] - cx) ** 2 + (o.pts[i + 1] - cn) ** 2; if (d < bd) { bd = d; bx = o.pts[i]; bn = o.pts[i + 1]; } }
    for (let i = 0; i < o.pts.length; i += 2) ext = Math.max(ext, Math.hypot(o.pts[i] - bx, o.pts[i + 1] - bn));
    return { kind: 'street', label: nm, key: norm(nm), x: bx, n: bn, ext, name: nm }; }).concat(BLDS); }
const loadSearch = async () => buildIdx();
function nearStreet(x, n) { let best = '', bd = 250 * 250; for (const [nm, o] of STREETS) for (let i = 0; i < o.pts.length; i += 2) { const d = (o.pts[i] - x) ** 2 + (o.pts[i + 1] - n) ** 2; if (d < bd) { bd = d; best = nm; } } return best; }
let shell = null;
function showShell(t, k, rings, I) { // מעטפת שקופה בין h−σ ל-h+σ סביב הבניין הנבחר
  if (shell) { scene.remove(shell); shell.geometry.dispose(); shell = null; }
  if (!rings) return;
  const base = t.meta.base[k], y0 = base + Math.max(0.5, I.h + I.par - I.sg), y1 = base + I.h + I.par + I.sg, r = rings[0], m = r.length / 2, pos = [];
  for (let i = 0; i < m; i++) { const j = (i + 1) % m, ax = r[i * 2], az = -r[i * 2 + 1], bx = r[j * 2], bz = -r[j * 2 + 1];
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  shell = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.22, side: T.DoubleSide, depthWrite: false }));
  shell.position.set(t.ox, 0, -t.on); shell.renderOrder = 5; scene.add(shell); requestRender();
}
async function showBuilding(t, k) {
  $('search').style.display = 'none'; setSelected(t, k); current = { kind: 'building', t, k };
  const M = t.meta, I = bInfo(t, k), id = mid(M.ids[k]), name = M.names ? M.names[k] : '', typ = M.typ[k];
  const cx = t.tx * TILE + M.cen[k * 2], cn = t.ty * TILE + M.cen[k * 2 + 1];
  let g; try { g = await call({ type: 'geom', key: t.key, k }); } catch (e) { g = null; }
  if (!current || current.t !== t || current.k !== k) return;
  const Q = measure(g ? g.rings : [], I, M.roof[k]), st = nearStreet(cx, cn);
  current.q = Q; current.st = st;
  showShell(t, k, g && g.rings, I);
  const rule = `מקור: ${SRC_HE[M.src[k]] || M.src[k] || '?'}${M.used[k] ? ' · שימשו: ' + esc([...M.used[k]].map(c => SRC_HE[c] || c).join(', ')) : ''} · ביטחון: ${CONF_HE[I.conf] || '—'}`;
  const cc = new T.Color(); colorOfConf(I, cc);
  const srcTag = I.src === 'est' ? '<span class="tag">משוער</span>' : `<span class="tag ai">${I.src === 'ai' ? 'נמדד מתמונה (AI)' : 'הוזן ידנית'} – לבדיקה</span>`;
  const sideNames = ['צפון', 'מזרח', 'דרום', 'מערב'];
  $('card').innerHTML = `<h2>בניין${name ? ' · ' + esc(name) : ''}<button class="btn x" id="cClose" aria-label="סגירה">✕</button></h2><table>` +
    row('כתובת', st ? `ליד רחוב ${esc(st)} <small style="color:var(--mut)">(אין מספרי בתים במקור)</small>` : '<span class="soon">לא ידועה</span>') +
    row('מזהה OSM', `<span class="ltr">${id}</span>`) + row('סוג (OSM)', esc(TYPE_HE[typ] || typ)) +
    row('קומות', `${I.f}${I.fl !== I.fh ? ` <small style="color:var(--mut)">(טווח ${I.fl}–${I.fh})</small>` : ''} ${srcTag}`) +
    row('גובה', `<span class="conf" style="background:#${cc.getHexString()}"></span><b>${fmt(I.h + I.par, 1)} ± ${fmt(I.sg, 1)} מ'</b><br><small style="color:var(--mut)">${I.src === 'est' ? rule : 'גובה = קומות × 3 מ\' + מעקה'} · טווח: ${fmt(Math.max(0, I.h + I.par - I.sg), 1)}–${fmt(I.h + I.par + I.sg, 1)} מ' (המעטפת הכתומה)</small>`) +
    row('גובה קרקע', fmt(M.base[k], 1) + ' מ\' מעל פני הים') + '</table>' +
    `<h3>מדידות מהמודל <span class="tag">משוער</span></h3><table>` +
    row('שטח טביעה (שרוך)', `${fmt(Q.A)} מ"ר <small style="color:var(--mut)">(מקור: ${fmt(M.area[k])} מ"ר)</small>`) +
    row('היקף', `${fmt(Q.Po)} מ'${Q.Pi ? ` + חצר פנימית ${fmt(Q.Pi)} מ'` : ''}`) +
    row('גובה חזית לחישוב', `${fmt(Q.Hf, 2)} מ'${Q.par ? ` (כולל מעקה גג ${fmt(Q.par, 2)} מ')` : ''}`) +
    row('חזיתות ברוטו', `<b>${fmt(Q.gross)}</b> ± ${fmt(Q.grossErr)} מ"ר`) + row(`חזיתות נטו (בניכוי ${OPEN * 100}% פתחים)`, `${fmt(Q.net)} מ"ר`) +
    row('גג', `${fmt(Q.roof)} מ"ר${Q.pitched ? ` (משופע ${PITCH_DEG}°: טביעה ÷ cos)` : ' (שטוח = שטח הטביעה)'}`) +
    (Q.parInner ? row('פנים המעקה (הגבהת איטום)', `${fmt(Q.parInner)} מ"ר · אורך ${fmt(Q.Po)} מ'`) : '') + '</table>' +
    `<div class="sides">${Q.sides.map((a, i) => `<div>${sideNames[i]}<b>${fmt(a)}</b>מ"ר · ${fmt(Q.sideLen[i])} מ'</div>`).join('')}</div>` +
    `<div class="formulas">חזית לכיוון = Σ אורך הצלעות שהנורמל החיצוני שלהן פונה לאותו רבע (±45°) × גובה חזית. ברוטו = היקף (חיצוני + חצרות) × (גובה + מעקה). נטו = ברוטו × ${1 - OPEN}. גג שטוח = שטח הטביעה בניכוי חצרות.</div>` +
    `<div class="acts"><button class="btn pri" id="cQuote">🧾 הצעת מחיר עם הכמויות</button><button class="btn" id="cManual">הזנת קומות ידנית</button>${MEAS[id] ? '<button class="btn" id="cMeasDel">מחיקת המדידה</button>' : ''}</div>
    <div id="manualBox" class="hidden" style="margin-top:6px"><div class="acts"><input id="manF" type="number" min="1" max="80" step="1" inputmode="numeric" style="width:90px;font-size:16px;padding:5px;border-radius:8px;border:1px solid var(--line);background:#0a111b;color:var(--fg)" aria-label="מספר קומות"><button class="btn pri" id="manSave">שמירה</button></div></div>
    <p class="note">הכמויות מחושבות מטביעת הבניין ומגובה ${I.src === 'est' ? 'משוער' : 'שהוזן'}. מודדים בשטח לפני שליחה ללקוח.</p>` +
    calcSection({ floors: I.f, foot: M.area[k], plate: M.area[k], plot: 0 }, I.src);
  $('card').style.display = 'block'; $('card').scrollTop = 0; wireCard();
  $('cQuote').onclick = () => openQuote(I, Q, st);
  $('cManual').onclick = () => { $('manualBox').classList.remove('hidden'); $('manF').value = I.f; $('manF').focus(); };
  $('manSave').onclick = async () => { const f = parseInt($('manF').value, 10); if (!(f >= 1 && f <= 80)) { toast('מספר קומות בין 1 ל-80'); return; }
    MEAS[id] = { osm_id: id, floors: f, source: 'manual', date: new Date().toISOString() }; saveMeas(); await remeas(t); showBuilding(t, k); toast('נשמר. הבניין עודכן בתלת־ממד.'); };
  if ($('cMeasDel')) $('cMeasDel').onclick = async () => { delete MEAS[id]; saveMeas(); await remeas(t); showBuilding(t, k); };
  requestRender();
}
async function remeas(t) { await call({ type: 'meas', meas: measMap() }); const l = t.lod; if (l >= 0 && !t.busy) await requestTile(t, l); }
function openQuote(I, Q, st) {
  const basis = `מעטפת בניין לפי מפת לוח היזם: היקף ${fmt(Q.Po + Q.Pi)} מ', גובה חזית ${fmt(Q.Hf, 1)} מ' (${I.f} קומות${I.src === 'est' ? `, משוער ±${fmt(I.sg, 1)} מ', ביטחון ${CONF_HE[I.conf] || '?'}` : ''}${Q.par ? ', כולל מעקה' : ''}), חזיתות ${fmt(Q.gross)} מ"ר ברוטו (טווח ${fmt(Math.max(0, Q.gross - Q.grossErr))}–${fmt(Q.gross + Q.grossErr)}) / ${fmt(Q.net)} מ"ר נטו, גג ${fmt(Q.roof)} מ"ר. כמויות משוערות – לאימות במדידה.`;
  const pre = { lines: [{ id: 'P001', qty: 1 }, { id: 'P002', qty: Math.round(Q.gross) }, { id: 'P037', qty: Math.round(Q.net) }, { id: 'P031', qty: Math.round(Q.roof) }, { id: 'P035', qty: 1 }, { id: 'P088', qty: 1 }], basis: basis.slice(0, 400), hint: (st || '').slice(0, 80) };
  location.href = new URL('../', location.href).href + '#pre=' + encodeURIComponent(JSON.stringify(pre));
}
function showCell(p) {
  if (selected) setSelected(null); if (shell) showShell(null); current = null;
  const x = p.x + VO.x, n = -p.z + VO.n, h = H(x, n), sea = p.y <= 0.05;
  $('card').innerHTML = `<h2>${sea ? 'ים' : 'קרקע'}<button class="btn x" id="cClose" aria-label="סגירה">✕</button></h2><table>` +
    (sea ? row('סוג', 'ים (קו חוף מתוקן מ-SRTM)') : row('גובה קרקע (SRTM)', fmt(h, 1) + ' מ\'') + row('סוג', 'נקודה על הקרקע — <b>לא</b> חלקה רשומה')) +
    row('גוש/חלקה · תב"ע · עסקאות', '<span class="soon">בקרוב</span>') + '</table>' + (sea ? '' : '<p class="note">רוצים לבדוק מגרש? "✏️ שרטוט מגרש".</p>');
  $('card').style.display = 'block'; $('cClose').onclick = closeCard; requestRender();
}
function closeCard() { $('card').style.display = 'none'; if (current && current.kind === 'street') clearStreet(); current = null; if (selected) setSelected(null); showShell(null); }

// ---------- מחשבון פוטנציאל (כמו במפה המקורית) ----------
const DEF = { u: 90, k: 3, s: 100, g: 1.3 };
function calcSection(d, src) {
  const srcTag = src === 'ai' ? '<span class="tag ai">מתמונה (AI)</span>' : src === 'manual' ? '<span class="tag ai">ידני</span>' : '<span class="tag">משוער</span>';
  return `<h3>מחשבון פוטנציאל התחדשות</h3><div class="disc">הערכה ראשונית למטרות סינון בלבד – לא ייעוץ תכנוני, שמאי או משפטי. המספרים אינם תב"ע ואינם זכויות בנייה.</div>
  <div class="calc" id="calc">
    <label for="iF">קומות קיימות (F) ${srcTag}</label><input id="iF" type="number" min="0" max="80" step="1" value="${d.floors}">
    <label for="iA">שטח טביעה קיים (A), מ"ר</label><input id="iA" type="number" min="0" step="1" value="${Math.round(d.foot)}">
    <label for="iU">שטח ברוטו לדירה קיימת (u), מ"ר <span class="tag">משוער</span></label><input id="iU" type="number" min="20" max="400" step="1" value="${DEF.u}">
    <label for="iE">דירות קיימות (E) <span class="tag">משוער</span><br><small>ריק = חישוב אוטומטי</small></label><input id="iE" type="number" min="0" step="1" placeholder="אוטו׳">
    <label for="iK">מקדם תוספת (k)<br><small>טווח מקובל לבדיקה 2.5–3.5</small></label><input id="iK" type="number" min="1" max="6" step="0.1" value="${DEF.k}">
    <label for="iS">גודל דירה חדשה ממוצע (S), מ"ר</label><input id="iS" type="number" min="30" max="300" step="1" value="${DEF.s}">
    <label for="iG">מקדם ברוטו (g)</label><input id="iG" type="number" min="1" max="2" step="0.05" value="${DEF.g}">
    <label for="iP">שטח קומה טיפוסית חדשה (P), מ"ר <span class="tag">משוער</span></label><input id="iP" type="number" min="1" step="1" value="${Math.round(d.plate)}">
  </div><table class="out" id="calcOut"></table><div class="formulas" id="calcF"></div>`;
}
function readCalc() {
  const v = id => { const x = parseFloat($(id).value); return isFinite(x) ? x : NaN; };
  const F = v('iF'), A = v('iA'), u = v('iU'), k = v('iK'), S = v('iS'), g = v('iG'), P = v('iP'), Eo = v('iE');
  const Eauto = A > 0 && F > 0 && u > 0 ? Math.round(A * F / u) : 0, E = isFinite(Eo) && Eo >= 0 ? Math.round(Eo) : Eauto;
  const N = Math.round(E * k), BA = N * S * g, Fn = P > 0 ? Math.ceil(BA / P) : NaN;
  return { F, A, u, k, S, g, P, E, Eauto, Emanual: isFinite(Eo) && Eo >= 0, N, dN: N - E, BA, Fn, dF: Fn - F, plot: current && current.kind === 'plot' ? plot.area : 0 };
}
function renderCalc() {
  if (!$('calcOut')) return; const c = readCalc(), ok = c.E > 0 && isFinite(c.k) && c.S > 0 && c.g > 0, dash = '—', m = '<span class="tag">משוער</span>';
  let h = row('דירות קיימות (E)', `<b>${fmt(c.E)}</b> ${c.Emanual ? '<span class="tag ok">הוזן</span>' : m}`) + row('סה"כ דירות (N)', ok ? `<b>${fmt(c.N)}</b> ${m}` : dash) +
    row('דירות חדשות נטו (N − E)', ok ? `<b>${fmt(c.dN)}</b> ${m}` : dash) + row('שטח בנוי כולל (BA)', ok ? `<b>${fmt(c.BA)}</b> מ"ר ${m}` : dash) +
    row('קומות בבניין החדש (Fn)', ok && isFinite(c.Fn) ? `<b>${fmt(c.Fn)}</b> ${m}` : dash) + row('תוספת קומות', ok && isFinite(c.dF) ? `<b>${c.dF >= 0 ? '+' : ''}${fmt(c.dF)}</b> ${m}` : dash);
  if (c.plot > 0 && ok) h += row('צפיפות (N ÷ דונם)', `${fmt(c.N / (c.plot / 1000), 1)} יח"ד לדונם ${m}`);
  $('calcOut').innerHTML = h;
  $('calcF').innerHTML = `<code>E = round(A × F ÷ u)</code> = ${fmt(c.Eauto)} · <code>N = round(E × k)</code> = ${fmt(c.N)} · <code>BA = N × S × g</code> = ${fmt(c.BA)} מ"ר · <code>Fn = ⌈BA ÷ P⌉</code> = ${isFinite(c.Fn) ? fmt(c.Fn) : '—'}`;
}
function wireCard() { $('cClose').onclick = closeCard; document.querySelectorAll('#calc input').forEach(i => i.addEventListener('input', renderCalc)); renderCalc(); }

// ---------- שרטוט מגרש (v2: אימות חיתוכים, גרירה, הוספה על צלע, מחיקה בלחיצה ארוכה, הצמדה, זכוכית מגדלת) ----------
let drawing = false, savedCam = null;
const plot = { pts: [], area: 0, perim: 0, done: false, bad: [] };
const plotGroup = new T.Group(); scene.add(plotGroup);
const SNAP_PX = 20, HIT_PX = 24, EDGE_PX = 16, LONG_MS = 600;
let drag = null, snapAt = null;
function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function pointIn(p, x, y) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function crossings(p) { // רשימת זוגות צלעות שחותכות זו את זו (צלע i = p[i]→p[i+1])
  const n = p.length, out = []; if (n < 4) return out;
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
    if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) out.push(i, j);
  }
  return out;
}
const v3 = q => new T.Vector3(q[0] - VO.x, H(q[0], q[1]) + 2, -(q[1] - VO.n));
function toScreen(q) { const v = v3(q).project(camera), r = canvas.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top]; }
function groundAt(cx, cy) { const h = hitAt(cx, cy); return h ? [h.point.x + VO.x, -h.point.z + VO.n] : null; }
function snapCandidates(cx, cy) { // פינות טביעות בניינים (קודקודי גג) באריחים הטעונים, במרחק SNAP_PX מהאצבע
  let best = null, bd = SNAP_PX * SNAP_PX; const r = canvas.getBoundingClientRect(), v = new T.Vector3();
  for (const m of groups.b.children) { if (!m.userData.own) continue; const t = m.userData.t, pos = m.geometry.attributes.position.array, nrm = m.geometry.attributes.normal.array, nb = m.userData.own.length;
    if (t.d > 1500) continue;
    for (let i = 0; i < nb; i++) { if (nrm[i * 3 + 1] < 120) continue; // רק קודקודי גג (נורמל למעלה)
      v.set(pos[i * 3] + t.ox, pos[i * 3 + 1], pos[i * 3 + 2] - t.on).project(camera); if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * r.width + r.left, sy = (1 - v.y) / 2 * r.height + r.top, d = (sx - cx) ** 2 + (sy - cy) ** 2;
      if (d < bd) { bd = d; best = [pos[i * 3] + t.ox + VO.x, -(pos[i * 3 + 2] - t.on) + VO.n]; } } }
  return best;
}
function placeAt(cx, cy) { const s = snapCandidates(cx, cy); snapAt = s; return s || groundAt(cx, cy); }
function nearestPoint(cx, cy) { let bi = -1, bd = HIT_PX * HIT_PX; plot.pts.forEach((q, i) => { const [x, y] = toScreen(q), d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; }
function nearestEdge(cx, cy) { const p = plot.pts, n = p.length; if (n < 2) return -1; let bi = -1, bd = EDGE_PX;
  for (let i = 0; i < (n >= 3 ? n : n - 1); i++) { const [ax, ay] = toScreen(p[i]), [bx, by] = toScreen(p[(i + 1) % n]), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / L2)); if (t < 0.08 || t > 0.92) continue; const d = Math.hypot(ax + t * dx - cx, ay + t * dy - cy); if (d < bd) { bd = d; bi = i; } }
  return bi; }
function drawPlot() {
  while (plotGroup.children.length) { const o = plotGroup.children.pop(); o.geometry && o.geometry.dispose(); }
  const p = plot.pts; plot.bad = crossings(p); if (!p.length) { requestRender(); return; }
  const v = p.map(v3), badE = new Set(plot.bad);
  const pts = new T.Points(new T.BufferGeometry().setFromPoints(v), new T.PointsMaterial({ color: 0xff3d7f, size: 14, sizeAttenuation: false, depthTest: false })); pts.renderOrder = 10; plotGroup.add(pts);
  if (p.length >= 2) { const ok = [], bad = []; const n = p.length;
    for (let i = 0; i < (n >= 3 ? n : n - 1); i++) (badE.has(i) ? bad : ok).push(v[i], v[(i + 1) % n]);
    if (ok.length) { const l = new T.LineSegments(new T.BufferGeometry().setFromPoints(ok), new T.LineBasicMaterial({ color: plot.bad.length ? 0xffffff : 0xff3d7f, depthTest: false })); l.renderOrder = 10; plotGroup.add(l); }
    if (bad.length) { // צלעות חותכות: סרט אדום עבה (קווי WebGL הם תמיד ברוחב פיקסל אחד)
      const w = Math.max(1.5, cam.dist / 110), rv = [];
      for (let i = 0; i < bad.length; i += 2) { const a = bad[i], b = bad[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ox = -(b.z - a.z) / L * w / 2, oz = (b.x - a.x) / L * w / 2;
        rv.push(a.x + ox, a.y, a.z + oz, a.x - ox, a.y, a.z - oz, b.x - ox, b.y, b.z - oz, a.x + ox, a.y, a.z + oz, b.x - ox, b.y, b.z - oz, b.x + ox, b.y, b.z + oz); }
      const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.Float32BufferAttribute(rv, 3));
      const l = new T.Mesh(rg, new T.MeshBasicMaterial({ color: 0xff1a1a, depthTest: false, side: T.DoubleSide })); l.renderOrder = 11; plotGroup.add(l);
      const bp = new T.Points(new T.BufferGeometry().setFromPoints(bad), new T.PointsMaterial({ color: 0xff1a1a, size: 8, sizeAttenuation: false, depthTest: false })); bp.renderOrder = 11; plotGroup.add(bp); } }
  if (p.length >= 3 && !plot.bad.length) { const top = Math.max(...v.map(q => q.y)); const g = new T.ShapeGeometry(new T.Shape(p.map(q => new T.Vector2(q[0] - VO.x, q[1] - VO.n)))); g.rotateX(-Math.PI / 2); g.translate(0, top, 0);
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0xff3d7f, transparent: true, opacity: 0.28, depthTest: false, side: T.DoubleSide })); m.renderOrder = 9; plotGroup.add(m); }
  if (snapAt && drawing) { const s = new T.Mesh(new T.RingGeometry(3.2, 4.6, 24).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x29d3ff, depthTest: false, side: T.DoubleSide }));
    s.scale.setScalar(Math.max(0.6, cam.dist / 300)); s.position.copy(v3(snapAt)); s.renderOrder = 12; plotGroup.add(s); }
  requestRender();
}
function updDrawBar() {
  const p = plot.pts, n = p.length; plot.bad = crossings(p); const valid = n >= 3 && !plot.bad.length;
  plot.area = valid ? Math.abs(polyArea(p)) : 0; plot.perim = 0; for (let i = 0; i < n; i++) if (n >= 3 || i < n - 1) { const a = p[i], b = p[(i + 1) % n]; plot.perim += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  $('drawTxt').innerHTML = n === 0 ? 'הקישו על הקרקע כדי לסמן פינות (לפחות 3). גררו נקודה להזזה · הקשה על צלע מוסיפה נקודה · לחיצה ארוכה על נקודה מוחקת אותה · נקודות נצמדות לפינות בניינים (עיגול תכלת).'
    : plot.bad.length ? `${n} נקודות · <span style="color:var(--warn)"><b>הקווים חותכים זה את זה</b> (מסומן באדום) — אין שטח תקין. גררו נקודה או "סדר נקודות".</span>`
    : n < 3 ? `${n} נקודות · צריך לפחות 3` : `${n} נקודות · שטח: <b>${fmt(plot.area)}</b> מ"ר (${fmt(plot.area / 1000, 2)} דונם) · היקף: ${fmt(plot.perim)} מ'`;
  $('dDone').disabled = !valid; $('dUndo').disabled = n === 0; $('dSort').disabled = n < 3;
}
function sortByAngle() { const p = plot.pts; if (p.length < 3) return; const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cn = p.reduce((s, q) => s + q[1], 0) / p.length;
  p.sort((a, b) => Math.atan2(a[1] - cn, a[0] - cx) - Math.atan2(b[1] - cn, b[0] - cx)); drawPlot(); updDrawBar();
  if (plot.bad.length) toast('גם אחרי הסידור יש חיתוך — המגרש לא קמור מספיק לסידור אוטומטי. גררו נקודה.'); }
function addPlotPoint(cx, cy) {
  if (nearestPoint(cx, cy) >= 0) return;               // הקשה על נקודה קיימת לא מוסיפה כפולה
  const q = placeAt(cx, cy); if (!q) return;
  const ei = nearestEdge(cx, cy);
  if (ei >= 0) plot.pts.splice(ei + 1, 0, q); else plot.pts.push(q);
  snapAt = null; drawPlot(); updDrawBar();
}
// לחיצה: גרירת נקודה קיימת / מחיקה בלחיצה ארוכה. מחזיר true אם האירוע נתפס.
function drawDown(e) {
  if (!drawing) return false; showLoupe(e.clientX, e.clientY);
  const i = nearestPoint(e.clientX, e.clientY); if (i < 0) return false;
  drag = { i, x: e.clientX, y: e.clientY, moved: false, timer: setTimeout(() => { if (drag && !drag.moved) { plot.pts.splice(drag.i, 1); drag = null; hideLoupe(); drawPlot(); updDrawBar(); toast('הנקודה נמחקה'); if (navigator.vibrate) navigator.vibrate(30); } }, LONG_MS) };
  return true;
}
function drawMove(e) {
  if (!drawing) return false; if (loupeOn) moveLoupe(e.clientX, e.clientY);
  if (!drag) return false;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) { drag.moved = true; clearTimeout(drag.timer); }
  if (drag.moved) { const q = placeAt(e.clientX, e.clientY); if (q) { plot.pts[drag.i] = q; drawPlot(); updDrawBar(); } }
  return true;
}
function drawUp() { hideLoupe(); if (!drag) return false; clearTimeout(drag.timer); drag = null; snapAt = null; drawPlot(); updDrawBar(); return true; }
// זכוכית מגדלת: מעתיקה אזור סביב האצבע מהקנבס מיד אחרי הציור (פי 2.5)
const loupe = document.createElement('canvas'); loupe.id = 'loupe'; loupe.width = loupe.height = 240; document.body.appendChild(loupe);
let loupeOn = false, loupeXY = [0, 0];
function showLoupe(x, y) { loupeOn = true; loupe.style.display = 'block'; moveLoupe(x, y); }
function moveLoupe(x, y) { loupeXY = [x, y]; const s = 120; loupe.style.left = Math.min(window.innerWidth - s - 6, Math.max(6, x - s / 2)) + 'px'; loupe.style.top = Math.max(56, y - s - 56) + 'px'; requestRender(); }
function hideLoupe() { loupeOn = false; loupe.style.display = 'none'; }
function paintLoupe() { if (!loupeOn) return; const c = loupe.getContext('2d'), r = canvas.getBoundingClientRect(), k = canvas.width / r.width, src = 48 * k;
  const sx = (loupeXY[0] - r.left) * k - src / 2, sy = (loupeXY[1] - r.top) * k - src / 2;
  c.fillStyle = '#ccd'; c.fillRect(0, 0, 240, 240); try { c.drawImage(canvas, sx, sy, src, src, 0, 0, 240, 240); } catch (e) { /* */ }
  c.strokeStyle = '#ff3d7f'; c.lineWidth = 2; c.beginPath(); c.moveTo(120, 96); c.lineTo(120, 144); c.moveTo(96, 120); c.lineTo(144, 120); c.stroke();
  if (snapAt) { c.strokeStyle = '#29d3ff'; c.lineWidth = 3; c.beginPath(); c.arc(120, 120, 16, 0, 7); c.stroke(); } }
function endDraw() { drawing = false; hideLoupe(); $('drawbar').style.display = 'none'; $('bDraw').classList.remove('on'); if (savedCam) { fly = { a: { ...cam }, b: { ...savedCam }, t0: performance.now(), dur: 700 }; savedCam = null; requestRender(); } }
$('bDraw').onclick = () => { if (drawing) { endDraw(); plot.pts = []; drawPlot(); return; } closeCard(); drawing = true; plot.pts = []; drawPlot(); $('drawbar').style.display = 'block'; $('bDraw').classList.add('on'); updDrawBar();
  savedCam = { ...cam }; fly = { a: { ...cam }, b: { ...cam, phi: 0.12, dist: Math.min(cam.dist, 900) }, t0: performance.now(), dur: 700 }; requestRender(); };   // מבט מלמעלה
$('dUndo').onclick = () => { plot.pts.pop(); drawPlot(); updDrawBar(); };
$('dSort').onclick = sortByAngle;
$('dCancel').onclick = () => { endDraw(); plot.pts = []; drawPlot(); };
$('dDone').onclick = () => { updDrawBar(); if (plot.pts.length < 3 || plot.bad.length) { toast('המגרש לא תקין — יש קווים חותכים'); return; } endDraw(); showPlot(); };
function showPlot() {
  updDrawBar(); if (selected) setSelected(null); current = { kind: 'plot' };
  const p = plot.pts; let foot = 0, ff = 0, nb = 0, nMeas = 0, missing = 0;
  const xs = p.map(q => q[0]), ns = p.map(q => q[1]);
  for (let tx = Math.floor(Math.min(...xs) / TILE); tx <= Math.floor(Math.max(...xs) / TILE); tx++) for (let ty = Math.floor(Math.min(...ns) / TILE); ty <= Math.floor(Math.max(...ns) / TILE); ty++) {
    const t = tiles.get(tx + '_' + ty); if (!t) continue; if (!t.meta) { missing++; continue; }
    for (let k = 0; k < t.meta.n; k++) { const x = tx * TILE + t.meta.cen[k * 2], n = ty * TILE + t.meta.cen[k * 2 + 1];
      if (pointIn(p, x, n)) { const I = bInfo(t, k), a = t.meta.area[k]; nb++; foot += a; ff += a * I.f; if (I.src !== 'est') nMeas++; } } }
  const avgF = foot ? Math.round(ff / foot) : 0, plate = foot > 0 ? foot : plot.area * 0.4;
  $('card').innerHTML = `<h2>מגרש משורטט<button class="btn x" id="cClose" aria-label="סגירה">✕</button></h2><table>` + row('סוג', 'פוליגון ששורטט ידנית — <b>לא</b> חלקה רשומה') +
    row('שטח', `<b>${fmt(plot.area)}</b> מ"ר (${fmt(plot.area / 1000, 2)} דונם)`) + row('היקף', fmt(plot.perim) + ' מ\'') + row('פינות', p.length) +
    row('מבנים בתוך המגרש', `${nb} · טביעה ${fmt(foot)} מ"ר${nb ? ` · ממוצע משוקלל ${avgF} קומות <span class="tag">${nMeas ? 'חלקם נמדדו' : 'משוער'}</span>` : ''}${missing ? ' <span class="tag">חלק מהאריחים עוד לא נטענו</span>' : ''}`) + '</table>' +
    '<p class="note">השטח בנוסחת השרוך (Shoelace) ברשת ישראל החדשה, בדיוק השרטוט על המסך. מצולע עם קווים חותכים נחסם ולא מקבל שטח.</p>' + calcSection({ floors: avgF, foot, plate, plot: plot.area }, nMeas ? 'manual' : 'est');
  $('card').style.display = 'block'; $('card').scrollTop = 0; wireCard();
}

// ---------- חיפוש ----------
const norm = s => String(s).replace(/[֑-ׇ]/g, '').replace(/["'`״׳]/g, '').replace(/[-–־_.,()]/g, ' ').replace(/^(רח|רחוב|שד|שדרות)\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
function search(q) { buildIdx(); const nq = norm(q); if (!nq) return []; const words = nq.split(' '), res = [];
  for (const e of IDX) { if (!words.every(w => e.key.includes(w))) continue; res.push([e.key === nq ? 0 : e.key.startsWith(nq) ? 1 : 2, e.kind === 'street' ? 0 : 1, e.label.length, e]); }
  res.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]); return res.slice(0, 30).map(r => r[3]); }
let lastRes = [];
function renderSearch() { const q = $('q').value; lastRes = search(q); const el = $('sres'); if (!q.trim()) { el.innerHTML = ''; return; }
  el.innerHTML = lastRes.length ? lastRes.map((e, i) => `<button data-i="${i}"><span>${esc(e.label)}</span><small>${e.kind === 'street' ? 'רחוב' : esc(e.sub || 'מבנה')}</small></button>`).join('') : '<div class="none">לא נמצא. החיפוש לפי שמות שקיימים ב-OSM בלבד.</div>'; }
let hiLine = null;
function clearStreet() { if (hiLine) { scene.remove(hiLine); hiLine.geometry.dispose(); hiLine = null; requestRender(); } }
async function drawStreet(name) {
  const r = await call({ type: 'street', name }); if (!current || current.kind !== 'street' || current.name !== name) return;
  clearStreet(); const s = r.segs, v = [], w = Math.max(6, cam.dist / 160);
  for (let i = 0; i < s.length; i += 6) { const x1 = s[i] - VO.x, n1 = s[i + 1] - VO.n, y1 = s[i + 2] + 3, x2 = s[i + 3] - VO.x, n2 = s[i + 4] - VO.n, y2 = s[i + 5] + 3, L = Math.hypot(x2 - x1, n2 - n1) || 1, ox = -(n2 - n1) / L * w / 2, on = (x2 - x1) / L * w / 2;
    v.push(x1 + ox, y1, -(n1 + on), x1 - ox, y1, -(n1 - on), x2 - ox, y2, -(n2 - on), x1 + ox, y1, -(n1 + on), x2 - ox, y2, -(n2 - on), x2 + ox, y2, -(n2 + on)); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
  hiLine = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0xff3d7f, depthTest: false, transparent: true, opacity: 0.9, side: T.DoubleSide })); hiLine.renderOrder = 9; scene.add(hiLine); requestRender();
}
function goResult(e) {
  $('search').style.display = 'none'; $('bSearch').setAttribute('aria-expanded', 'false'); $('q').blur();
  if (e.kind === 'street') { closeCard(); current = { kind: 'street', name: e.name }; const d = Math.min(4000, Math.max(700, e.ext * 2.2)); flyTo(e.x, e.n, d, () => drawStreet(e.name)); }
  else { clearStreet(); flyTo(e.x, e.n, 480, () => { const t = tiles.get(e.tile); const go = () => t.meta ? showBuilding(t, e.k) : setTimeout(go, 150); go(); }); }
}
$('q').addEventListener('input', renderSearch);
$('q').addEventListener('keydown', e => { if (e.key === 'Enter' && lastRes[0]) goResult(lastRes[0]); if (e.key === 'Escape') $('search').style.display = 'none'; });
$('sres').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) goResult(lastRes[+b.dataset.i]); });
$('bSearch').onclick = async () => { const s = $('search'), open = s.style.display !== 'block'; s.style.display = open ? 'block' : 'none'; $('bSearch').setAttribute('aria-expanded', open);
  if (open) { $('layers').classList.add('hide'); $('bLayers').setAttribute('aria-expanded', 'false'); $('q').focus(); await loadSearch(); renderSearch(); } };

// ---------- שכבות ומקרא ----------
function legend() {
  const L = $('legend'), parts = [], bar = 'linear-gradient(to left,#4575cc,#4db88c,#f7d14d,#e65440)';
  if (paintMode === 'height') parts.push(`<div>גובה בניין</div><div class="bar" style="background:${bar}"></div><div class="row"><span>3 מ'</span><span>43+ מ'</span></div>`);
  if (paintMode === 'conf') parts.push(`<div>ביטחון בגובה (צנרת גדוד 5)</div><div class="bar" style="background:linear-gradient(to left,#4575cc,#4db88c,#f7d14d,#e65440)"></div><div class="row"><span>מאומת</span><span>גבוה</span><span>בינוני</span><span>נמוך</span></div><div style="margin-top:3px">באשדוד כרגע אין מקור גובה אמיתי — הכול כלל אצבע.</div>`);
  if (paintMode === 'source') parts.push('<div>מקור הגובה</div><div><span class="sw" style="background:#a8b3c2"></span>משוער</div><div><span class="sw" style="background:#38cc73"></span>נמדד מתמונה – AI</div><div><span class="sw" style="background:#a86be6"></span>הוזן ידנית</div>');
  if ($('lP').checked) parts.push(`<div>פוטנציאל התחדשות — <b>הדגמה בלבד</b></div><div class="bar" style="background:${bar}"></div><div class="row"><span>נמוך</span><span>גבוה</span></div>`);
  if (ROOF_DEMO) parts.push('<div><b>הדגמת גגות רעפים</b> על בתים צמודי קרקע — לא נתון אמיתי</div>');
  L.innerHTML = parts.join('<hr style="border:0;border-top:1px solid var(--line)">'); L.style.display = parts.length ? 'block' : 'none';
}
document.querySelectorAll('input[name=paint]').forEach(i => i.onchange = e => { if (e.target.checked) { paintMode = e.target.value; repaintAll(); } });
$('lB').onchange = e => { showB = e.target.checked; for (const t of tiles.values()) { const m = t.mesh.b; if (m) m.geometry.setDrawRange(showB ? 0 : m.userData.nib, Infinity); } requestRender(); };
$('lR').onchange = e => { groups.r.visible = e.target.checked; requestRender(); };
$('lP').onchange = e => { if (e.target.checked) toast('מפת החום עדיין לא קיימת בפורמט האריחים הארצי (גדוד 5)'); e.target.checked = false; return;
  ((e) => { groups.h.visible = e.target.checked; if (e.target.checked) for (const t of tiles.values()) if (t.heatTex && t.lod >= 0 && !t.mesh.h) heatMesh(t); legend(); requestRender(); })(e); };
$('bLayers').onclick = () => { const l = $('layers'); l.classList.toggle('hide'); $('bLayers').setAttribute('aria-expanded', !l.classList.contains('hide')); if (!l.classList.contains('hide')) $('search').style.display = 'none'; };
$('bAbout').onclick = () => { $('about').style.display = 'flex'; };
$('bAboutClose').onclick = () => { $('about').style.display = 'none'; };
$('about').addEventListener('click', e => { if (e.target.id === 'about') $('about').style.display = 'none'; });
$('acc').innerHTML = Object.entries(MAN.sources || {}).map(([k, v]) => `<li><b class="ltr">${esc(k)}</b>: ${esc(v)}</li>`).join('') +
  `<li>תחום: ${MAN.boundary_kind === 'osm_admin8' ? 'גבול מוניציפלי מ-OSM' : 'משוער מהבניינים (לא גבול שיפוט)'} + שוליים. ${MAN.stats ? `בניינים: ${fmt(MAN.stats.buildings)} · חציון σ: ${MAN.stats.sigma_median_m} מ'` : ''}</li>` +
  `<li>הים מצויר רק כמצולע וקטורי (בלי מישור מים מתחת ליבשה), יבשה תמיד ≥ +0.3 מ', ומישור קרוב דינמי – זה התיקון לנקודות ולפסים הכחולים בחוף.</li>`;
$('mCount').textContent = Object.keys(MEAS).length;
if (window.innerWidth < 700 || window.innerHeight < 500) { $('layers').classList.add('hide'); $('bLayers').setAttribute('aria-expanded', 'false'); }
let showStats = qs.has('fps') || qs.has('stats');
$('bStats').onclick = () => { showStats = !showStats; $('stats').style.display = showStats ? 'block' : 'none'; requestRender(); };
legend();

// ---------- לולאה: ציור רק כשצריך ----------
let rafId = 0, frames = 0, fpsT = performance.now(), fps = 0;
function requestRender(force) { if (force) dirty = true; dirty = true; if (!rafId) rafId = requestAnimationFrame(frame); }
function frame() {
  rafId = 0;
  if (fly) { const t = Math.min(1, (performance.now() - fly.t0) / fly.dur), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    for (const k of ['tx', 'tz', 'phi', 'theta']) cam[k] = fly.a[k] + (fly.b[k] - fly.a[k]) * e; cam.dist = Math.exp(Math.log(fly.a.dist) + (Math.log(fly.b.dist) - Math.log(fly.a.dist)) * e);
    applyCam(); if (t >= 1) { const cb = fly.cb; fly = null; cb && cb(); } }
  if (camMoved || inflight === 0) { scheduleTiles(); camMoved = false; }
  if (dirty) { renderer.render(scene, camera); paintLoupe(); dirty = false; frames++; if (!PERF.firstFrame) PERF.firstFrame = performance.now() - PERF.t0; }
  const now = performance.now(); if (now - fpsT > 1000) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  if (showStats) { const i = info(); $('stats').textContent = `fps ${fps} · calls ${i.calls} · tris ${fmt(i.tris)}\ntiles ${i.tilesLoaded}/${i.tiles} (L0 ${i.lod[0]} · L1 ${i.lod[1]} · L2 ${i.lod[2]})\ngpu verts ${fmt(gpuVerts)} · geom ${i.geoms} · net ${fmt(PERF.bytes / 1024)}KB${i.heap ? ' · heap ' + i.heap + 'MB' : ''}`; }
  if (fly || showStats && qs.has('fps')) requestRender();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRender(true); });
function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); requestRender(true); }
window.addEventListener('resize', resize); resize(); rebuildSeaFar(); applyCam();
$('loading').remove();

function info() {
  const lod = [0, 0, 0]; let tl = 0; for (const t of tiles.values()) if (t.lod >= 0) { lod[t.lod]++; tl++; }
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geoms: renderer.info.memory.geometries, textures: renderer.info.memory.textures, tiles: tiles.size, tilesLoaded: tl, lod, gpuVerts,
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null, bytes: PERF.bytes, firstFrameMs: Math.round(PERF.firstFrame), allVisibleMs: Math.round(PERF.allVisible), tilesBuilt: PERF.tilesBuilt, workerBuildMs: Math.round(PERF.buildMs), dpr: DPR, worker: !!W };
}

/* ===================== ממשק מנוע (לעולם המשחק / twin/engine) =====================
   window.YZ.engine:
     loadAround(x, n, radius = 1500, lod = 1) → Promise<number>   טוען אריחים סביב נקודת ITM (גם מחוץ למסך); מחזיר כמה נבנו
     buildingAtScreen(px, py) → info|null                         בניין מתחת לפיקסל (raycast)
     buildingAtPoint(x, n) → Promise<info|null>                   בניין שמכיל נקודת ITM (נקודה־בפוליגון על הטביעה המדויקת)
       info = { key, k, id, name, type, base, h, par, sg, f, fl, fh, conf, src, rings }   (rings רק ב-buildingAtPoint)
     groundHeight(x, n) → מ'                                       מאריחים טעונים (0 אם לא טעון)
     setSun({ azimuth, altitude }) | setTime(date, lat = 31.8, lon = 34.65)   כיוון השמש (מעלות) / לפי תאריך-שעה
     setMaterials({ buildings, ground, roads })                    וו לחומרים של צוות הנכסים. לבניינים יש attributes: position, normal (Int8), color (Uint8), afl (בסיס/גובה קומה בדצ"מ)
     scene, camera, renderer, toScene(x, n, y) → THREE.Vector3, requestRender(), info(), dispose()
   קואורדינטות: ITM (EPSG:2039) במטרים; בסצנה x = x − VO.x, z = −(n − VO.n). */
function toScene(x, n, y = 0) { return new T.Vector3(x - VO.x, y, -(n - VO.n)); }
function infoOf(t, k) { const M = t.meta, I = bInfo(t, k); return { key: t.key, k, id: mid(M.ids[k]), name: M.names[k], type: M.typ[k], base: M.base[k], h: I.h, par: I.par, sg: I.sg, f: I.f, fl: I.fl, fh: I.fh, conf: I.conf, src: M.src[k] }; }
async function loadAround(x, n, radius = 1500, lod = 1) {
  const jobs = []; for (const t of tiles.values()) { const cx = t.tx * TILE + TILE / 2, cn = t.ty * TILE + TILE / 2;
    if (Math.hypot(cx - x, cn - n) < radius + TILE * 0.71 && t.lod < lod && !t.busy) { t.used = performance.now(); jobs.push(requestTile(t, lod)); } }
  await Promise.all(jobs); requestRender(); return jobs.length;
}
function buildingAtScreen(px, py) { const h = hitAt(px, py); if (!h || !h.object.userData.towner) return null; const k = h.object.userData.towner[h.faceIndex]; return k === 65535 ? null : infoOf(h.object.userData.t, k); }
async function buildingAtPoint(x, n) { // בניין שייך לאריח לפי נקודה מייצגת – לכן בודקים גם את האריחים השכנים
  const cand = [], TX = Math.floor(x / TILE), TY = Math.floor(n / TILE);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const t = tiles.get((TX + dx) + '_' + (TY + dy)); if (!t || !t.meta) continue;
    for (let k = 0; k < t.meta.n; k++) { const d = Math.hypot(t.tx * TILE + t.meta.cen[2 * k] - x, t.ty * TILE + t.meta.cen[2 * k + 1] - n); if (d < 150) cand.push([d, t, k]); } }
  cand.sort((a, b) => a[0] - b[0]);
  for (const [, t, k] of cand.slice(0, 16)) { const lx = x - t.tx * TILE, ln = n - t.ty * TILE, g = await call({ type: 'geom', key: t.key, k });
    const P = r => { const p = []; for (let i = 0; i < r.length; i += 2) p.push([r[i], r[i + 1]]); return p; };
    if (pointIn(P(g.rings[0]), lx, ln) && !g.rings.slice(1).some(h => pointIn(P(h), lx, ln))) return Object.assign(infoOf(t, k), { rings: g.rings }); }
  return null;
}
function setSun({ azimuth, altitude }) { // מעלות; אזימוט 0 = צפון, 90 = מזרח
  const az = azimuth * Math.PI / 180, al = Math.max(-5, altitude) * Math.PI / 180, R = 6000;
  sun.position.set(Math.sin(az) * Math.cos(al) * R, Math.sin(al) * R, -Math.cos(az) * Math.cos(al) * R);
  sun.intensity = 1.7 * Math.max(0, Math.min(1, (altitude + 2) / 12)); requestRender();
}
function setTime(date = new Date(), lat = 31.8, lon = 34.65) { // מיקום שמש מקורב (NOAA, דיוק ~1°)
  const d = (date.getTime() / 86400000) + 2440587.5 - 2451545.0, g = (357.529 + 0.98560028 * d) * Math.PI / 180, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180, e = (23.439 - 0.00000036 * d) * Math.PI / 180;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24, ha = ((gmst * 15 + lon) * Math.PI / 180) - ra, la = lat * Math.PI / 180;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  const r = { azimuth: (az * 180 / Math.PI + 360) % 360, altitude: alt * 180 / Math.PI }; setSun(r); return r;
}
function setMaterials({ buildings, ground, roads } = {}) {
  for (const t of tiles.values()) { if (t.mesh.b && (buildings || ground)) t.mesh.b.material = buildings || ground; if (t.mesh.r && roads) t.mesh.r.material = roads; }
  if (buildings || ground) MAT.b = buildings || ground; if (roads) MAT.r = roads; requestRender();
}
function dispose() { for (const t of tiles.values()) dropTile(t); if (W) W.terminate(); renderer.dispose(); cancelAnimationFrame(rafId); }

// ממשק לבדיקות (תואם בחלקו ל-window.YZ של המפה המקורית)
window.YZ = { engine: { loadAround, buildingAtScreen, buildingAtPoint, groundHeight: H, setSun, setTime, setMaterials, scene, camera, renderer, toScene, requestRender, info, dispose, VO }, ready: true, cam, applyCam, renderer, scene, camera, tiles, info, flyTo, closeCard, MAN, VO, INDEX, search: q => search(q), loadSearch,
  get loaded() { return inflight === 0 && ![...tiles.values()].some(t => t.vis && t.want >= 0 && t.lod !== t.want && !(t.failed >= 2)); },
  showBuildingAt(key, k) { const t = tiles.get(key); return t && t.meta ? showBuilding(t, k) : null; },
  pickAt: pick, plot, addPlotPoint, crossings, sortByAngle, toScreen, drawDown, drawMove, drawUp, get drawing() { return drawing; }, heightOf: (key, k) => { const t = tiles.get(key); return t && t.meta ? bInfo(t, k).h : 0; },
  bench(n = 30) { const gl = renderer.getContext(), px = new Uint8Array(4), s = performance.now();
    for (let i = 0; i < n; i++) { cam.theta += 0.01; applyCam(); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - s) / n; } };
})().catch(e => { const l = document.getElementById('loading'); if (l) l.textContent = 'שגיאה בטעינת המפה: ' + (e && e.message || e); console.error(e); });
