// Procedural low-poly models for an Israeli city twin (CC0, own work of the ESH27 swarm).
// Built from three.js primitives, grouped by material, written as GLB with glTF-Transform.
// Units: metres, +Y up, vehicles face +Z (glTF forward). Spinning parts are separate named nodes.
// Usage: node gen_models.mjs OUT_DIR
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
let seed = 27;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- palette (PBR factors) ----------
const M = {
  white: ['#eeeeea', 0.35, 0.0], silver: ['#b9bcc0', 0.3, 0.6], red: ['#9e1b1b', 0.35, 0.1], yellow: ['#f2c230', 0.4, 0.0],
  black: ['#1a1a1c', 0.6, 0.0], rubber: ['#111111', 0.9, 0.0], glass: ['#1d2a33', 0.05, 0.0], chrome: ['#d8d8d8', 0.15, 1.0],
  steel: ['#7c8186', 0.45, 0.8], galv: ['#a5a9ad', 0.5, 0.7], darkgrey: ['#3d4044', 0.6, 0.2], grey: ['#8b8f93', 0.6, 0.1],
  lightL: ['#fff4d6', 0.2, 0.0, '#fff1c8'], tail: ['#c0121a', 0.3, 0.0, '#5a0000'], wood: ['#8a5a33', 0.8, 0.0],
  concrete: ['#a7a49c', 0.9, 0.0], trunk: ['#6e5a45', 0.95, 0.0], palmtrunk: ['#7d6a53', 0.95, 0.0],
  frond: ['#4f7a35', 0.7, 0.0], frondDry: ['#8d7a45', 0.85, 0.0], olive: ['#7b8a62', 0.8, 0.0], ficus: ['#2f5a2a', 0.75, 0.0],
  ac: ['#e6e6e0', 0.5, 0.1], grille: ['#2c2c2c', 0.7, 0.3], solar: ['#14233a', 0.15, 0.3], tank: ['#e9e9e4', 0.4, 0.2],
  green: ['#2f6b3a', 0.55, 0.3], blue: ['#1f4e9a', 0.4, 0.1], orange: ['#ff7a1a', 0.5, 0.0], led: ['#ffffff', 0.2, 0.0, '#ffffff'],
  carbon: ['#2a2b2e', 0.4, 0.2], heli: ['#f0f0ec', 0.3, 0.1], heliStripe: ['#c41e24', 0.3, 0.1],
};

// ---------- helpers ----------
const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => xf(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => xf(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz);
const sph = (r, ws, hs, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); return xf(g, x, y, z); };
function xf(g, x, y, z, rx = 0, ry = 0, rz = 0) { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; }
function prep(g) { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; }
function jitter(g, a) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + (rnd() - .5) * a, p.getY(i) + (rnd() - .5) * a, p.getZ(i) + (rnd() - .5) * a); g.computeVertexNormals(); return g; }
// a leaf blade / frond: tapered quad strip along a curve
function blade(len, wid, droop, segs = 5) {
  const pos = [];
  const pt = (t) => new THREE.Vector3(0, Math.sin(t * Math.PI * 0.5) * len * 0.35 - droop * t * t * len, t * len);
  for (let i = 0; i < segs; i++) {
    const a = pt(i / segs), b = pt((i + 1) / segs), wa = wid * Math.sin(Math.PI * (0.15 + 0.85 * i / segs)), wb = wid * Math.sin(Math.PI * (0.15 + 0.85 * (i + 1) / segs));
    const A = [a.x - wa, a.y, a.z], B = [a.x + wa, a.y, a.z], C = [b.x + wb, b.y, b.z], D = [b.x - wb, b.y, b.z];
    const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2 + wid * 0.25, (a.z + b.z) / 2]; // slight V fold
    pos.push(...A, ...mid, ...D, ...mid, ...B, ...C, ...A, ...D, ...mid, ...B, ...C, ...mid);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}

// model = { name, parts: { nodeName: { mat: [geoms] } } }
async function write(name, nodes, extras = {}) {
  const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene(name);
  const mats = {}; let tris = 0;
  const mat = (k) => mats[k] || (mats[k] = (() => {
    const [c, r, m, e] = M[k]; const col = new THREE.Color(c); // sRGB hex -> linear factors
    const mm = doc.createMaterial(k).setBaseColorFactor([col.r, col.g, col.b, 1]).setRoughnessFactor(r).setMetallicFactor(m);
    if (e) { const ec = new THREE.Color(e); mm.setEmissiveFactor([ec.r, ec.g, ec.b]); }
    if (/frond|olive|ficus/.test(k)) mm.setDoubleSided(true);
    return mm;
  })());
  const root = doc.createNode(name); scene.addChild(root);
  for (const [nodeName, spec] of Object.entries(nodes)) {
    const { pivot = [0, 0, 0], ...groups } = spec;
    const mesh = doc.createMesh(nodeName);
    for (const [mk, geoms] of Object.entries(groups)) {
      const g = mergeGeometries(geoms.map(prep)); g.translate(-pivot[0], -pivot[1], -pivot[2]);
      const P = g.attributes.position.array, Nn = g.attributes.normal.array; tris += P.length / 9;
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(Nn)).setBuffer(buf))
        .setMaterial(mat(mk));
      mesh.addPrimitive(prim);
    }
    const n = doc.createNode(nodeName).setMesh(mesh).setTranslation(pivot); root.addChild(n);
  }
  root.setExtras(extras);
  await new NodeIO().write(`${OUT}/${name}.glb`, doc);
  console.log(name, 'tris', Math.round(tris));
  return tris;
}

// ================= vegetation =================
async function palmWashingtonia() { // ותשינגטוניה – the tall fan palm of Israeli boulevards
  const H = 11, trunk = [], fr = [], dry = [];
  for (let i = 0; i < 6; i++) { const t0 = i / 6, t1 = (i + 1) / 6; trunk.push(cyl(0.24 - 0.06 * t1, 0.26 - 0.06 * t0 + (i == 0 ? 0.08 : 0), H / 6, 7, Math.sin(t0 * 2) * 0.15, H * (t0 + t1) / 2, 0)); }
  dry.push(cyl(0.55, 0.3, 1.6, 8, 0.12, H - 0.7, 0)); // "skirt" of dead fronds
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2 + rnd() * 0.2, up = 0.2 + rnd() * 0.6;
    const g = blade(2.2, 0.55, 0.5 + rnd() * 0.3, 4); g.rotateX(-up); g.rotateY(a); g.translate(0.1, H + 0.1, 0); fr.push(g);
  }
  return write('palm_washingtonia', { palm: { palmtrunk: trunk, frond: fr, frondDry: dry } }, { he: 'דקל ושינגטוניה', height_m: H + 1.5 });
}
async function palmDate() { // דקל תמר – feather palm
  const H = 7, trunk = [], fr = [];
  for (let i = 0; i < 8; i++) { const t = i / 8; trunk.push(jitter(cyl(0.27, 0.29, H / 8 * 0.98, 8, 0, H * (i + 0.5) / 8, 0), 0.05)); }
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2 * 2.4, up = -0.4 + (i / 22) * 1.1;
    const g = blade(3.4, 0.38, 0.9, 6); g.rotateX(-up); g.rotateY(a); g.translate(0, H, 0); fr.push(g);
  }
  return write('palm_date', { palm: { palmtrunk: trunk, frond: fr } }, { he: 'דקל תמר', height_m: H + 2.5 });
}
function canopy(cx, cy, cz, r, n, sx = 1, sy = 0.8) { const out = []; for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, d = rnd() * r * 0.6; out.push(jitter(sph(r * (0.45 + rnd() * 0.25), 6, 4, cx + Math.cos(a) * d * sx, cy + (rnd() - .3) * r * sy, cz + Math.sin(a) * d * sx), r * 0.12)); } return out; }
async function olive() { // עץ זית – gnarled trunk, silver-green canopy
  const tr = [jitter(cyl(0.18, 0.32, 1.6, 7, 0, 0.8, 0), 0.08), jitter(cyl(0.1, 0.16, 1.3, 6, 0.35, 2.0, 0.1, 0, 0, -0.5), 0.05), jitter(cyl(0.09, 0.15, 1.2, 6, -0.3, 2.0, -0.1, 0.2, 0, 0.5), 0.05)];
  return write('tree_olive', { tree: { trunk: tr, olive: canopy(0, 3.0, 0, 2.0, 9, 1.3, 0.6) } }, { he: 'עץ זית', height_m: 4.5 });
}
async function ficus() { // פיקוס – dense street shade tree
  const tr = [jitter(cyl(0.22, 0.3, 2.6, 8, 0, 1.3, 0), 0.04), cyl(0.1, 0.14, 1.6, 6, 0.5, 3.0, 0, 0, 0, -0.6), cyl(0.1, 0.14, 1.6, 6, -0.5, 3.0, 0.2, 0, 0, 0.6)];
  return write('tree_ficus', { tree: { trunk: tr, ficus: canopy(0, 4.6, 0, 3.0, 12, 1.2, 0.5) } }, { he: 'פיקוס', height_m: 7 });
}

// ================= vehicles =================
function wheel(x, z, r = 0.32, w = 0.22) { return { rubber: [cyl(r, r, w, 12, x, r, z, 0, 0, Math.PI / 2)], silver: [cyl(r * 0.6, r * 0.6, w + 0.02, 8, x, r, z, 0, 0, Math.PI / 2)] }; }
async function car(name, he, paint, L, W, Hb, cabin) {
  const body = [
    box(W, Hb * 0.55, L, 0, 0.32 + Hb * 0.3, 0),                       // lower body
    box(W * 0.98, 0.18, L * 0.28, 0, 0.32 + Hb * 0.58 + 0.02, L * 0.33, -0.12), // bonnet slope
  ];
  const cab = box(W * 0.9, cabin.h, cabin.l, 0, 0.32 + Hb * 0.55 + cabin.h / 2, cabin.z);
  const glass = [box(W * 0.91, cabin.h * 0.62, cabin.l * 0.96, 0, 0.32 + Hb * 0.55 + cabin.h * 0.42, cabin.z)];
  const nodes = { body: { [paint]: [...body, cab], glass, black: [box(W * 1.01, 0.12, L * 1.01, 0, 0.36, 0), box(W * 0.6, 0.12, 0.05, 0, 0.5, L / 2)], lightL: [box(0.22, 0.09, 0.03, W * 0.35, 0.68, L / 2), box(0.22, 0.09, 0.03, -W * 0.35, 0.68, L / 2)], tail: [box(0.2, 0.09, 0.03, W * 0.38, 0.72, -L / 2), box(0.2, 0.09, 0.03, -W * 0.38, 0.72, -L / 2)] } };
  const wx = W / 2 - 0.08, wz = L * 0.33;
  [[wx, wz, 'wheel_FL'], [-wx, wz, 'wheel_FR'], [wx, -wz, 'wheel_RL'], [-wx, -wz, 'wheel_RR']].forEach(([x, z, n]) => { const w = wheel(0, 0); nodes[n] = { pivot: [x, 0.32, z], rubber: w.rubber.map(g => g.translate(x, 0, z)), silver: w.silver.map(g => g.translate(x, 0, z)) }; });
  return write(name, nodes, { he, length_m: L, width_m: W, wheel_nodes: ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'], forward: '+Z' });
}

async function helicopter() { // generic light helicopter (~EC135 proportions), main rotor node + tail rotor node
  const fus = [sph(1.1, 12, 8, 0, 1.4, 0.6, 1, 0.95, 1.6), box(0.5, 0.5, 4.2, 0, 1.75, -3.0), box(0.08, 1.1, 0.8, 0, 2.3, -5.0, 0.3)];
  const stripe = [box(2.02, 0.18, 2.4, 0, 1.15, 0.4)];
  const glass = [sph(1.0, 10, 6, 0, 1.75, 1.45, 1.02, 0.7, 1.0)];
  const skids = [cyl(0.05, 0.05, 3.2, 6, 0.85, 0.1, 0.4, Math.PI / 2), cyl(0.05, 0.05, 3.2, 6, -0.85, 0.1, 0.4, Math.PI / 2), cyl(0.04, 0.04, 0.9, 5, 0.6, 0.45, 1.2, 0, 0, 0.5), cyl(0.04, 0.04, 0.9, 5, -0.6, 0.45, 1.2, 0, 0, -0.5), cyl(0.04, 0.04, 0.9, 5, 0.6, 0.45, -0.4, 0, 0, 0.5), cyl(0.04, 0.04, 0.9, 5, -0.6, 0.45, -0.4, 0, 0, -0.5)];
  const mast = [cyl(0.1, 0.14, 0.5, 8, 0, 2.6, 0.3)];
  const blades = []; for (let i = 0; i < 4; i++) blades.push(xf(box(0.28, 0.04, 5.0, 0, 0, 2.6), 0, 2.88, 0.3, 0, i * Math.PI / 2, 0));
  blades.push(cyl(0.18, 0.18, 0.12, 8, 0, 2.88, 0.3));
  const tail = []; for (let i = 0; i < 2; i++) tail.push(xf(box(0.06, 1.1, 0.14, 0, 0, 0), 0.3, 2.2, -5.0, i * Math.PI / 2, 0, 0));
  return write('helicopter', {
    body: { heli: fus, heliStripe: stripe, glass, steel: skids, darkgrey: mast },
    rotor_main: { pivot: [0, 2.88, 0.3], black: blades },
    rotor_tail: { pivot: [0.3, 2.2, -5.0], black: tail },
  }, { he: 'מסוק קל', rotor_nodes: ['rotor_main (Y axis)', 'rotor_tail (X axis)'], forward: '+Z', mass_kg_ref: 2900 });
}

async function quadcopter() { // DJI-class ~0.35 m diagonal, prop nodes for spin, camera gimbal
  const arms = [], props = {}, motors = [];
  const r = 0.17;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    arms.push(xf(box(0.025, 0.018, r, 0, 0, r / 2), 0, 0.06, 0, 0, Math.PI / 2 - a, 0));
    motors.push(cyl(0.017, 0.02, 0.03, 10, x, 0.075, z));
    props[`prop_${i}`] = { pivot: [x, 0.095, z], black: [box(0.24, 0.004, 0.02, x, 0.095, z, 0, i * 0.7, 0)] };
  }
  return write('drone_quad', {
    body: { carbon: [box(0.09, 0.05, 0.19, 0, 0.06, 0), ...arms], darkgrey: [box(0.06, 0.035, 0.05, 0, 0.03, 0.08)], steel: motors, led: [box(0.01, 0.006, 0.01, 0.035, 0.085, -0.09)], glass: [sph(0.013, 8, 6, 0, 0.03, 0.105)] },
    ...props,
  }, { he: 'רחפן מרובע', diagonal_m: 0.34, mass_kg_ref: 0.9, prop_nodes: ['prop_0..3 (Y axis, alternate spin)'], forward: '+Z' });
}

async function jetpack() {
  return write('jetpack', {
    pack: { silver: [cyl(0.11, 0.11, 0.55, 12, 0.13, 0.45, -0.12), cyl(0.11, 0.11, 0.55, 12, -0.13, 0.45, -0.12), sph(0.11, 12, 6, 0.13, 0.72, -0.12, 1, 0.5, 1), sph(0.11, 12, 6, -0.13, 0.72, -0.12, 1, 0.5, 1)], black: [box(0.36, 0.5, 0.06, 0, 0.47, 0.0), box(0.06, 0.04, 0.4, 0.15, 0.62, 0.15), box(0.06, 0.04, 0.4, -0.15, 0.62, 0.15)], yellow: [box(0.3, 0.06, 0.24, 0, 0.32, -0.12)] },
    nozzle_L: { pivot: [0.13, 0.1, -0.12], darkgrey: [cyl(0.06, 0.09, 0.14, 10, 0.13, 0.1, -0.12)] },
    nozzle_R: { pivot: [-0.13, 0.1, -0.12], darkgrey: [cyl(0.06, 0.09, 0.14, 10, -0.13, 0.1, -0.12)] },
  }, { he: 'ג׳טפק', attach: 'גב הדמות, Spine2; הלהבה ב-nozzle_L/R לכיוון -Y' });
}

// ================= street furniture & Israeli kitbits =================
async function streetLight() { // 9 m double-arm pole typical of Israeli city avenues
  const pole = [cyl(0.07, 0.12, 9, 8, 0, 4.5, 0), cyl(0.2, 0.22, 0.6, 8, 0, 0.3, 0)];
  const arms = [xf(cyl(0.04, 0.04, 1.6, 6), 0.75, 8.8, 0, 0, 0, Math.PI / 2 - 0.15), xf(cyl(0.04, 0.04, 1.6, 6), -0.75, 8.8, 0, 0, 0, -Math.PI / 2 + 0.15)];
  return write('street_light', { pole: { galv: [...pole, ...arms], darkgrey: [box(0.55, 0.1, 0.25, 1.5, 8.95, 0), box(0.55, 0.1, 0.25, -1.5, 8.95, 0)], led: [box(0.45, 0.02, 0.18, 1.5, 8.89, 0), box(0.45, 0.02, 0.18, -1.5, 8.89, 0)] } }, { he: 'עמוד תאורה כפול', height_m: 9, light_points: [[1.5, 8.85, 0], [-1.5, 8.85, 0]] });
}
async function bench() {
  const slats = []; for (let i = 0; i < 4; i++) slats.push(box(1.8, 0.04, 0.09, 0, 0.45, -0.18 + i * 0.12));
  for (let i = 0; i < 3; i++) slats.push(box(1.8, 0.09, 0.035, 0, 0.6 + i * 0.12, -0.25, -0.15));
  return write('bench', { bench: { wood: slats, darkgrey: [box(0.06, 0.45, 0.5, 0.8, 0.225, 0), box(0.06, 0.45, 0.5, -0.8, 0.225, 0), box(0.06, 0.45, 0.05, 0.8, 0.7, -0.27, -0.15), box(0.06, 0.45, 0.05, -0.8, 0.7, -0.27, -0.15)] } }, { he: 'ספסל רחוב' });
}
async function busStop() { // shelter: steel frame, glass back, roof, bench, yellow-pole sign
  const frame = [box(0.08, 2.5, 0.08, 1.9, 1.25, -0.6), box(0.08, 2.5, 0.08, -1.9, 1.25, -0.6), box(0.08, 2.5, 0.08, 1.9, 1.25, 0.6), box(0.08, 2.5, 0.08, -1.9, 1.25, 0.6)];
  return write('bus_stop', { shelter: { steel: frame, grey: [box(4.2, 0.08, 1.6, 0, 2.55, 0, 0.05)], glass: [box(3.7, 1.8, 0.02, 0, 1.3, -0.6)], wood: [box(2.6, 0.05, 0.35, 0, 0.48, -0.38)], darkgrey: [box(0.06, 0.45, 0.3, 1.2, 0.24, -0.38), box(0.06, 0.45, 0.3, -1.2, 0.24, -0.38)], yellow: [cyl(0.04, 0.04, 2.8, 6, 2.6, 1.4, 0.7)], white: [box(0.5, 0.35, 0.03, 2.6, 2.65, 0.7)], blue: [box(0.5, 0.08, 0.035, 2.6, 2.79, 0.7)] } }, { he: 'תחנת אוטובוס', note: 'שלט ריק – לשים טקסט/מספר קו בטקסטורה' });
}
async function acUnit() { // outdoor split-AC condenser – the signature of every Israeli facade
  const fins = []; for (let i = 0; i < 9; i++) fins.push(box(0.02, 0.4, 0.01, 0.08 + i * 0.03, 0.28, 0.151));
  return write('ac_unit', { unit: { ac: [box(0.8, 0.55, 0.28, 0, 0.275, 0)], grille: [cyl(0.19, 0.19, 0.02, 16, -0.12, 0.28, 0.14, Math.PI / 2), ...fins], galv: [box(0.04, 0.04, 0.45, 0.33, -0.02, -0.08), box(0.04, 0.04, 0.45, -0.33, -0.02, -0.08), box(0.04, 0.4, 0.04, 0.33, -0.2, -0.29), box(0.04, 0.4, 0.04, -0.33, -0.2, -0.29)], black: [cyl(0.012, 0.012, 0.4, 5, 0.32, 0.12, -0.3, Math.PI / 2)] } }, { he: 'מעבה מזגן עם מתלה', size_m: [0.8, 0.55, 0.28], mount: 'הגב (z=-0.3) צמוד לקיר' });
}
async function railing() { // 1 m balcony railing module (aluminium bars), tileable along X
  const bars = []; for (let i = 0; i < 9; i++) bars.push(box(0.02, 0.95, 0.02, -0.45 + i * 0.1125, 0.5, 0));
  return write('balcony_railing', { rail: { white: [box(1.0, 0.05, 0.06, 0, 1.03, 0), box(1.0, 0.04, 0.04, 0, 0.05, 0), ...bars] } }, { he: 'מעקה מרפסת (מודול 1 מ׳)', module_m: 1.0, tile_axis: 'X' });
}
async function railingGlass() {
  return write('balcony_railing_glass', { rail: { glass: [box(1.0, 0.95, 0.015, 0, 0.53, 0)], chrome: [box(1.0, 0.05, 0.05, 0, 1.03, 0), box(0.04, 1.05, 0.04, 0.48, 0.52, 0)] } }, { he: 'מעקה זכוכית (מודול 1 מ׳)', module_m: 1.0, tile_axis: 'X' });
}
async function solarHeater() { // דוד שמש: horizontal tank + 2 tilted collectors on a frame
  const tilt = -0.6;
  return write('solar_water_heater', { unit: { tank: [cyl(0.28, 0.28, 1.7, 12, 0, 1.45, -0.55, 0, 0, Math.PI / 2)], solar: [box(0.95, 0.06, 1.9, -0.5, 0.95, 0.15, tilt), box(0.95, 0.06, 1.9, 0.5, 0.95, 0.15, tilt)], galv: [box(0.04, 1.4, 0.04, 0.9, 0.7, -0.6), box(0.04, 1.4, 0.04, -0.9, 0.7, -0.6), box(0.04, 0.4, 0.04, 0.9, 0.2, 0.9), box(0.04, 0.4, 0.04, -0.9, 0.2, 0.9), box(1.9, 0.04, 0.04, 0, 0.05, 0.9), box(1.9, 0.04, 0.04, 0, 0.05, -0.6)] } }, { he: 'דוד שמש וקולטים', note: 'לגגות שטוחים; ~2 קולטים לדירה' });
}
async function dumpster() { // green "frog" container (מכולת צפרדע)
  return write('dumpster_frog', { bin: { green: [box(1.6, 1.0, 1.1, 0, 0.6, 0), box(1.62, 0.08, 1.15, 0, 1.12, 0.02, -0.08)], darkgrey: [cyl(0.08, 0.08, 0.06, 8, 0.65, 0.08, 0.4, 0, 0, Math.PI / 2), cyl(0.08, 0.08, 0.06, 8, -0.65, 0.08, 0.4, 0, 0, Math.PI / 2), cyl(0.08, 0.08, 0.06, 8, 0.65, 0.08, -0.4, 0, 0, Math.PI / 2), cyl(0.08, 0.08, 0.06, 8, -0.65, 0.08, -0.4, 0, 0, Math.PI / 2)] } }, { he: 'מכולת אשפה ירוקה' });
}

await palmWashingtonia(); await palmDate(); await olive(); await ficus();
await car('car_sedan', 'מכונית סדאן', 'white', 4.6, 1.8, 0.75, { h: 0.55, l: 2.3, z: -0.25 });
await car('car_hatch', 'מכונית האצ׳בק', 'silver', 4.0, 1.75, 0.75, { h: 0.6, l: 2.2, z: -0.55 });
await car('car_taxi', 'מונית', 'yellow', 4.7, 1.8, 0.78, { h: 0.58, l: 2.4, z: -0.2 });
await helicopter(); await quadcopter(); await jetpack();
await streetLight(); await bench(); await busStop(); await acUnit(); await railing(); await railingGlass(); await solarHeater(); await dumpster();
