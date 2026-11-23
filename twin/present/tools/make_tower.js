/* יוצר מודל glTF לדוגמה (מקורי, ללא נכסים חיצוניים): פודיום 2 קומות + מגדל 12 קומות, פסי תקרה וזכוכית.
 * יחידות: מטרים, Y למעלה, מקור = מרכז הבסיס. extras: קומות ושטח ברוטו (כדי שהניתוחים לא ינחשו).
 * הרצה: node tools/make_tower.js  → models/tower.gltf */
'use strict';
const fs = require('fs'), path = require('path');
const pos = [], nor = [], idxByMat = { 0: [], 1: [] };
function box(x0, y0, z0, x1, y1, z1, mat) {
  const F = [[[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]], [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
    [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]], [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]]];
  for (const [n, q] of F) { const b = pos.length / 3; for (const v of q) { pos.push(...v); nor.push(...n); } idxByMat[mat].push(b, b + 1, b + 2, b, b + 2, b + 3); }
}
const floors = []; let y = 0;
function stack(w, d, n, h) { for (let i = 0; i < n; i++) { box(-w / 2, y, -d / 2, w / 2, y + 0.45, d / 2, 0); box(-w / 2 + 0.25, y + 0.45, -d / 2 + 0.25, w / 2 - 0.25, y + h, d / 2 - 0.25, 1); floors.push(w * d); y += h; } }
stack(30, 22, 2, 4.5);      // פודיום מסחרי
stack(24, 16, 12, 3.1);     // מגדל מגורים
box(-12, y, -8, 12, y + 0.6, 8, 0);  // מעקה גג
box(-4, y, -3, 4, y + 3, 3, 0);      // חדר מכונות
const toBuf = (arr, T) => Buffer.from(new T(arr).buffer);
const P = toBuf(pos, Float32Array), N = toBuf(nor, Float32Array), I0 = toBuf(idxByMat[0], Uint32Array), I1 = toBuf(idxByMat[1], Uint32Array);
const bin = Buffer.concat([P, N, I0, I1]);
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
const gltf = {
  asset: { version: '2.0', generator: 'ESH27 present/tools/make_tower.js' },
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'proposed_tower', extras: { floors: floors.length, grossArea_m2: Math.round(floors.reduce((a, b) => a + b, 0)), height_m: +y.toFixed(2), note: 'מודל דוגמה גנרי, לא תכנון אמיתי' } }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }, { attributes: { POSITION: 0, NORMAL: 1 }, indices: 3, material: 1 }] }],
  materials: [{ name: 'slab', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.94, 0.91, 1], metallicFactor: 0, roughnessFactor: 0.85 } },
    { name: 'glass', pbrMetallicRoughness: { baseColorFactor: [0.42, 0.58, 0.70, 1], metallicFactor: 0.3, roughnessFactor: 0.25 } }],
  buffers: [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.length, target: 34962 }, { buffer: 0, byteOffset: P.length, byteLength: N.length, target: 34962 },
    { buffer: 0, byteOffset: P.length + N.length, byteLength: I0.length, target: 34963 }, { buffer: 0, byteOffset: P.length + N.length + I0.length, byteLength: I1.length, target: 34963 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5125, count: idxByMat[0].length, type: 'SCALAR' }, { bufferView: 3, componentType: 5125, count: idxByMat[1].length, type: 'SCALAR' }],
};
const out = path.join(__dirname, '..', 'models', 'tower.gltf');
fs.writeFileSync(out, JSON.stringify(gltf));
console.log('wrote', out, fs.statSync(out).size, 'bytes; floors', floors.length, 'gross', gltf.nodes[0].extras.grossArea_m2, 'height', y);
