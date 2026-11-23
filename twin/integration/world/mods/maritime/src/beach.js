/* ESH27 twin — maritime / beach.js — light beach life + wet-sand line (ALL PROCEDURAL placement, not data)
 *   lifeguard towers every ~380 m along open beaches, umbrella clusters around them (dry sand 22–60 m from the
 *   waterline), a few swimmers 8–35 m offshore bobbing on the waves, and a wet-sand / swash ribbon on the land
 *   side of the waterline (the grid's depth = 0 line, which matches the terrain mesh's sea-level crossing).
 */
import { makeKit, tintMaterial, instanced } from './geom.js';
import { contour, smoothLine, resample, sampleGrid, pointInPoly, lineLength } from './grid.js';
import { rng } from './waves.js';

export function createBeach(T, { grid, features = [], groundH = null, isBuilding = null, seaHeight, exclude = [], umbrellasPerTower = 26, swimmersPerTower = 3, maxTowers = 14, focus = null }) {
  const kit = makeKit(T), group = new T.Group(); group.name = 'maritime-beach';
  const R = rng(1948);
  const gH = (x, z) => groundH ? groundH(x, z) : Math.max(0, -sampleGrid(grid, x, z).depth);
  const ex = [...exclude, ...features.filter(f => ['port_area', 'basin', 'marina'].includes(f.kind)).map(f => f.pts)];
  const excluded = (x, z) => !grid.knownAt(x, z) || ex.some(p => pointInPoly(p, x, z) || nearPoly(p, x, z, 350));
  function nearPoly(p, x, z, r) { for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0; if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r) return true; } return false; }
  const landN = (x, z) => { const e = 10, gx = sampleGrid(grid, x + e, z).depth - sampleGrid(grid, x - e, z).depth, gz = sampleGrid(grid, x, z + e).depth - sampleGrid(grid, x, z - e).depth, l = Math.hypot(gx, gz) || 1; return [-gx / l, -gz / l]; };

  const lines = contour(grid, 0).map(l => smoothLine(l, 2)).filter(l => lineLength(l) > 600);
  const towers = [], umbrellas = [], swimmers = [];
  // ---- wet sand ribbon (all coast lines, outside port)
  const pos = [], wv = [], idx = [];
  for (const l of lines) {
    const pts = resample(l, 6); let run = -1;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      if (excluded(x, z)) { run = -1; continue; }
      const [nx, nz] = landN(x, z);
      const base = pos.length / 3;
      for (const [o, w] of [[-3, 0], [3, 0.35], [9, 0.75], [14, 1]]) {
        const px = x + nx * o, pz = z + nz * o;
        pos.push(px, Math.max(gH(px, pz), 0) + 0.06, pz); wv.push(w, i * 6);
      }
      if (run >= 0) for (let k = 0; k < 3; k++) idx.push(run + k, base + k, run + k + 1, run + k + 1, base + k, base + k + 1);
      run = base;
    }
  }
  let shore = null;
  if (idx.length) {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('aW', new T.Float32BufferAttribute(wv, 2)); g.setIndex(idx);
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
      uniforms: { uTime: { value: 0 }, uWet: { value: new T.Color(0x8a7a5e) }, uFoam: { value: new T.Color(0xf2f2ee) }, uLit: { value: 1 }, uSwash: { value: 0.5 } },
      vertexShader: 'attribute vec2 aW; varying vec2 vW; varying float vD; void main(){ vW = aW; vec4 w = modelMatrix * vec4(position,1.0); vD = length(w.xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime; uniform vec3 uWet; uniform vec3 uFoam; uniform float uLit; uniform float uSwash; varying vec2 vW; varying float vD;
float hs(float p){ return fract(sin(p * 127.1) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(hs(i), hs(i+1.0), f); }
void main(){
  float s = vW.y;                                                     // metres along the coast
  float swash = 0.25 + uSwash * (0.35 + 0.25 * sin(uTime * 0.9 + s * 0.031) + 0.15 * n1(s * 0.05 + uTime * 0.3));   // run-up (fraction of the band)
  float wet = 1.0 - smoothstep(swash, swash + 0.45, vW.x);
  float qf = (vW.x - swash) / 0.05; float foam = exp(-qf * qf) * (0.5 + 0.5 * n1(s * 0.4 + uTime));
  float a = clamp(wet * 0.55 + foam * 0.8, 0.0, 1.0) * (1.0 - smoothstep(700.0, 1400.0, vD));
  vec3 c = mix(uWet, uFoam, clamp(foam * 1.4, 0.0, 1.0)) * uLit;
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` });
    shore = new T.Mesh(g, mat); shore.name = 'wet-sand'; shore.renderOrder = 2; group.add(shore);
  }

  // ---- towers, umbrellas, swimmers
  for (const l of lines) {
    const pts = resample(l, 20);
    for (let i = 0; i < pts.length && towers.length < maxTowers; i += 19) {      // every ~380 m
      const [x, z] = pts[i];
      if (excluded(x, z)) continue;
      const [nx, nz] = landN(x, z);
      const tx = x + nx * 28, tz = z + nz * 28;
      if (gH(tx, tz) > 8 || (isBuilding && isBuilding(tx, tz, 6))) continue;
      towers.push({ x: tx, z: tz, y: gH(tx, tz), h: Math.atan2(-nx, -nz) });      // window (+z local) faces the sea
      for (let k = 0; k < umbrellasPerTower; k++) {
        const along = (R() - 0.5) * 300, off = 22 + R() * 38, j = Math.max(0, Math.min(pts.length - 1, i + Math.round(along / 20)));
        const [bx, bz] = pts[j], [mx, mz] = landN(bx, bz);
        const ux = bx + mx * off + (R() - 0.5) * 6, uz = bz + mz * off + (R() - 0.5) * 6;
        if (excluded(ux, uz) || gH(ux, uz) > 9 || sampleGrid(grid, ux, uz).depth > -0.1 || (isBuilding && isBuilding(ux, uz, 3))) continue;
        umbrellas.push({ x: ux, z: uz, y: gH(ux, uz), tilt: (R() - 0.5) * 0.25, rot: R() * 6.28, c: R() });
      }
      for (let k = 0; k < swimmersPerTower; k++) {
        const along = (R() - 0.5) * 120, off = 8 + R() * 27, j = Math.max(0, Math.min(pts.length - 1, i + Math.round(along / 20)));
        const [bx, bz] = pts[j], [mx, mz] = landN(bx, bz);
        swimmers.push({ x: bx - mx * off, z: bz - mz * off, ph: R() * 6.28, c: R() });
      }
    }
  }
  const d = new T.Object3D();
  if (towers.length) {
    const im = instanced(T, kit.lifeguardTower(), tintMaterial(T), towers.length);
    towers.forEach((t, i) => { d.position.set(t.x, t.y, t.z); d.rotation.set(0, t.h, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.name = 'lifeguard-towers'; im.castShadow = true; group.add(im);
  }
  const umbCols = [0xd9483b, 0x2f6fb5, 0xf2c94c, 0x2e9e6a, 0xf2f2f2, 0xe8772e, 0x7a4fb5];
  if (umbrellas.length) {
    const im = instanced(T, kit.umbrella(), tintMaterial(T, { side: T.DoubleSide }), umbrellas.length);
    umbrellas.forEach((u, i) => { d.position.set(u.x, u.y, u.z); d.rotation.set(u.tilt, u.rot, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setCol(i, umbCols[Math.floor(u.c * umbCols.length)]); });
    im.name = 'umbrellas'; im.castShadow = true; group.add(im);
  }
  let swimMesh = null;
  const skin = [0xc99b7a, 0x8d5f43, 0xe0b99a, 0x6e4a35];
  if (swimmers.length) {
    swimMesh = instanced(T, kit.swimmer(), tintMaterial(T), swimmers.length);
    swimmers.forEach((s, i) => swimMesh.setCol(i, skin[Math.floor(s.c * skin.length)]));
    swimMesh.name = 'swimmers'; group.add(swimMesh);
  }
  function update(t, { swash = 0.5, lit = 1 } = {}) {
    if (shore) { shore.material.uniforms.uTime.value = t; shore.material.uniforms.uSwash.value = swash; shore.material.uniforms.uLit.value = lit; }
    if (swimMesh) {
      swimmers.forEach((s, i) => { const y = seaHeight(s.x, s.z, t); d.position.set(s.x + Math.sin(t * 0.3 + s.ph) * 0.6, y, s.z); d.rotation.set(0, s.ph + t * 0.1, 0); d.updateMatrix(); swimMesh.setMatrixAt(i, d.matrix); });
      swimMesh.instanceMatrix.needsUpdate = true;
    }
  }
  return { group, update, towers, umbrellas, swimmers, shore };
}
