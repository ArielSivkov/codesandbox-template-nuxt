/* ESH27 twin — maritime / port.js — port, marina, seamarks and the river mouth from maritime features.
 * Features (scene coords) come from the pipeline's 'mar' tile layer (real OSM tags) or from the fixture.
 * What is generated procedurally here (labelled in the README): breakwater cross-sections, container stack
 * placement and colours, crane placement along the quay edges, moored boats along pontoons.
 */
import { makeKit, tintMaterial, instanced } from './geom.js';
import { pointInPoly, polyBounds, resample, contour, smoothLine, sampleGrid } from './grid.js';
import { rng } from './waves.js';

const KIND_COLORS = { red: 0xd23a2a, green: 0x2f9e44, yellow: 0xe8c547, white: 0xf2f2f2 };

export function createPort(T, { features, grid, groundH = null, isBuilding = null, seaHeight = null, coastAlong = [0.415, -0.91] }) {
  const kit = makeKit(T), group = new T.Group(); group.name = 'maritime-port';
  const stats = { breakwaterM: 0, containers: 0, cranes: 0, moored: 0, buoys: 0, lights: 0 };
  const byKind = k => features.filter(f => f.kind === k);
  const gH = (x, z) => groundH ? groundH(x, z) : Math.max(0, -sampleGrid(grid, x, z).depth);
  const segs = [];               // solid segments for the boat: [ax, az, bx, bz, halfWidth]

  // ------------------------------------------------------------ breakwaters (rubble mound, jittered, merged)
  const basins = [...byKind('basin'), ...byKind('marina')];
  const centroid = p => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
  {
    const pos = [], col = [], R = rng(41);
    const rock = [[0.55, 0.53, 0.5], [0.62, 0.6, 0.56], [0.7, 0.68, 0.63], [0.5, 0.49, 0.47]];
    const toLin = c => new T.Color().setRGB(c[0], c[1], c[2], T.SRGBColorSpace);
    for (const f of byKind('breakwater').concat(byKind('groyne'))) {
      const w = f.width || 20, crest = f.crest || 5, wt = Math.max(4, w * 0.32), bot = -7;
      const line = resample(f.pts, 6);
      if (line.length < 2) continue;
      let L = 0; for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      stats.breakwaterM += L;
      for (let i = 0; i < f.pts.length - 1; i++) segs.push([...f.pts[i], ...f.pts[i + 1], w * 0.5]);
      // wall on the side facing away from the sheltered basin
      let wallSide = 1;
      const b = basins.find(B => f.pts.some(p => pointInPoly(B.pts, p[0], p[1]) || Math.min(...B.pts.map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))) < 60));
      const cen = b ? centroid(b.pts) : null;
      const prof = [[-w / 2, bot], [-wt / 2 - w * 0.12, crest * 0.5], [-wt / 2, crest], [wt / 2, crest], [wt / 2 + w * 0.12, crest * 0.5], [w / 2, bot]];
      const ring = [];
      for (let i = 0; i < line.length; i++) {
        const p = line[i], q = line[Math.min(i + 1, line.length - 1)], o = line[Math.max(i - 1, 0)];
        let tx = q[0] - o[0], tz = q[1] - o[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const nx = -tz, nz = tx;
        if (i === 0 && cen) wallSide = ((p[0] - cen[0]) * nx + (p[1] - cen[1]) * nz) > 0 ? 1 : -1;
        ring.push(prof.map(([a, y], k) => {
          const j = (k === 1 || k === 4) ? (R() - 0.5) * 1.6 : (k === 0 || k === 5) ? 0 : (R() - 0.5) * 0.15;
          return [p[0] + nx * (a + j), y + ((k === 1 || k === 4) ? (R() - 0.5) * 1.0 : 0), p[1] + nz * (a + j)];
        }));
        // round head: close ends later
      }
      const quad = (a, b2, c, d, cA, cB) => { pos.push(...a, ...b2, ...c, ...a, ...c, ...d); for (let k = 0; k < 3; k++) col.push(cA.r, cA.g, cA.b); for (let k = 0; k < 3; k++) col.push(cB.r, cB.g, cB.b); };
      for (let i = 0; i < ring.length - 1; i++) for (let k = 0; k < prof.length - 1; k++) {
        const top = k === 2, c = top ? toLin([0.74, 0.72, 0.68]) : toLin(rock[Math.floor(R() * rock.length)]);
        const c2 = top ? c : toLin(rock[Math.floor(R() * rock.length)]);
        quad(ring[i][k], ring[i][k + 1], ring[i + 1][k + 1], ring[i + 1][k], c, c2);
      }
      // end caps
      for (const [rI, s] of [[0, -1], [ring.length - 1, 1]]) {
        const r = ring[rI], c = toLin(rock[1]);
        for (let k = 1; k < prof.length - 2; k++) { pos.push(...r[0], ...(s > 0 ? r[k] : r[k + 1]), ...(s > 0 ? r[k + 1] : r[k])); for (let m = 0; m < 3; m++) col.push(c.r, c.g, c.b); }
      }
      // crown wall (2.2 m) on the exposed side
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i][wallSide > 0 ? 3 : 2], d = ring[i + 1][wallSide > 0 ? 3 : 2];
        const up = (p, h) => [p[0], p[1] + h, p[2]];
        const c = toLin([0.8, 0.78, 0.74]);
        quad(a, up(a, 2.2), up(d, 2.2), d, c, c); quad(d, up(d, 2.2), up(a, 2.2), a, c, c);
      }
    }
    if (pos.length) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      m.name = 'breakwaters'; m.castShadow = true; m.receiveShadow = true; group.add(m);
    }
  }

  // ------------------------------------------------------------ piers / pontoons (merged boxes)
  const piers = byKind('pier').concat(byKind('quay_line'));
  const moored = [];
  if (piers.length) {
    const P = [];
    for (const f of piers) {
      const w = f.width || 3, y = f.floating ? 0.45 : 2.2;
      for (let i = 0; i < f.pts.length - 1; i++) {
        const [ax, az] = f.pts[i], [bx, bz] = f.pts[i + 1], L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az);
        P.push(kit.part(new T.BoxGeometry(w, f.floating ? 0.5 : 4, L), f.floating ? 0x8d7b63 : 0xb5b0a6, { pos: [(ax + bx) / 2, y - (f.floating ? 0.25 : 2), (az + bz) / 2], rot: [0, ang, 0] }));
        segs.push([ax, az, bx, bz, w / 2 + 0.5]);
        if (f.floating) {   // berths both sides every 6.5 m (procedural occupancy ~75 %)
          const R = rng(Math.round(ax * 7 + az * 3));
          for (let s = 6; s < L - 4; s += 6.5) for (const side of [-1, 1]) {
            if (R() > 0.75) continue;
            const t = s / L, px = ax + (bx - ax) * t, pz = az + (bz - az) * t, nx = (bz - az) / L * side, nz = -(bx - ax) / L * side;
            const len = 8 + R() * 6;
            moored.push({ x: px + nx * (w / 2 + len / 2 + 0.6), z: pz + nz * (w / 2 + len / 2 + 0.6), h: Math.atan2(-nx, -nz), len, sail: R() < 0.55, c: R() });
          }
        }
      }
    }
    const g = kit.merge(P), m = new T.Mesh(g, tintMaterial(T)); m.name = 'piers'; m.receiveShadow = true; group.add(m);
  }

  // ------------------------------------------------------------ moored boats (instanced, 2 variants)
  const dummy = new T.Object3D();
  if (moored.length) {
    const hullCols = [0xffffff, 0xf4f1ea, 0x1f3550, 0xffffff, 0x9b2b2b, 0xe9e9e9];
    for (const sail of [true, false]) {
      const list = moored.filter(b => b.sail === sail); if (!list.length) continue;
      const im = instanced(T, kit.yacht(12, 3.8, sail, 4, true), tintMaterial(T), list.length);
      list.forEach((b, i) => { const sc = b.len / 12; dummy.position.set(b.x, -0.25, b.z); dummy.rotation.set(0, b.h, 0); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setCol(i, hullCols[Math.floor(b.c * hullCols.length)]); });
      im.name = sail ? 'moored-sail' : 'moored-motor'; group.add(im); stats.moored += list.length;
    }
  }

  // ------------------------------------------------------------ container yards (instanced blocks of 6 stacks)
  const areas = byKind('port_area');
  const blocks = [];
  if (areas.length) {
    const [ax, az] = coastAlong, cx = -az, cz = ax;           // along-quay axis and cross axis
    const landAt = (x, z) => sampleGrid(grid, x, z).depth < -0.2;
    const nearWater = (x, z, r) => { for (let a = 0; a < 6.283; a += 0.785) for (const d of [r, r * 2.2, r * 3.6]) if (sampleGrid(grid, x + Math.cos(a) * d, z + Math.sin(a) * d).depth > 0) return true; return false; };
    for (const f of areas) {
      const [x0, z0, x1, z1] = polyBounds(f.pts), R = rng(Math.round(x0 * 13 + z0));
      const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2, rad = Math.hypot(x1 - x0, z1 - z0) / 2;
      let iCross = 0;
      for (let c = -rad; c < rad; c += 30, iCross++) {
        let iAl = 0;
        for (let a = -rad; a < rad; a += 13.4, iAl++) {
          if (iAl % 8 === 7) continue;                         // cross roads every 7 bays
          const x = cxm + ax * a + cx * c, z = czm + az * a + cz * c;
          if (!pointInPoly(f.pts, x, z)) continue;
          let ok = true;
          for (const [dx, dz] of [[30, 0], [-30, 0], [0, 30], [0, -30], [0, 0]]) if (!landAt(x + dx, z + dz)) { ok = false; break; }
          if (!ok || (isBuilding && isBuilding(x, z, 12))) continue;
          if (R() < 0.3) continue;                             // empty slots
          if (nearWater(x, z, 70) === false) continue;           // yards near the quays only (rest: roads, sheds)
          const tiers = 1 + Math.floor(Math.pow(R(), 0.7) * 5);
          blocks.push({ x, z, y: gH(x, z), tiers, h: Math.atan2(ax, az) });
        }
      }
    }
    if (blocks.length) {
      const mat = tintMaterial(T);
      const pal = [[0.61, 0.23, 0.18], [0.18, 0.35, 0.54], [0.24, 0.48, 0.29], [0.55, 0.56, 0.58], [0.78, 0.45, 0.17], [0.87, 0.86, 0.82], [0.42, 0.29, 0.2], [0.29, 0.56, 0.71], [0.83, 0.7, 0.2], [0.12, 0.2, 0.32]];
      const old = mat.onBeforeCompile;
      mat.onBeforeCompile = sh => {
        old(sh);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc; varying vec2 vSeed; varying float vTop;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position; vLoc.y *= length(instanceMatrix[1].xyz); vSeed = instanceMatrix[3].xz; vTop = step(0.5, normal.y);');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vLoc; varying vec2 vSeed; varying float vTop;
const vec3 PAL[10] = vec3[10](${pal.map(c => `vec3(${c.map(v => (v ** 2.2).toFixed(4)).join(',')})`).join(',')});
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
{ float colI = floor((vLoc.x + 7.6) / 2.5334); float tier = floor(vLoc.y / 2.59 - vTop * 0.5);
  int k = int(floor(h3(vec3(colI, tier, dot(vSeed, vec2(0.013, 0.007)))) * 9.999));
  vec3 cc = PAL[k];
  float fx = fract((vLoc.x + 7.6) / 2.5334), fy = fract(vLoc.y / 2.59);
  float seam = smoothstep(0.0, 0.05, fx) * smoothstep(1.0, 0.95, fx) * mix(smoothstep(0.0, 0.05, fy) * smoothstep(1.0, 0.96, fy), 1.0, vTop);
  float rib = 0.93 + 0.07 * step(0.5, fract(vLoc.z * 3.3)) + vTop * 0.12;
  diffuseColor.rgb *= cc * mix(0.45, 1.0, seam) * rib; }`);
      };
      mat.customProgramCacheKey = () => 'containers1';
      const im = instanced(T, kit.containerBlock(), mat, blocks.length);
      blocks.forEach((b, i) => { dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, b.h, 0); dummy.scale.set(1, b.tiers, 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      im.name = 'containers'; im.castShadow = true; im.receiveShadow = true; group.add(im); stats.containers = blocks.reduce((s, b) => s + b.tiers * 6, 0);
    }
  }

  // ------------------------------------------------------------ port apron (concrete/asphalt overlay on the port land, on the terrain lattice)
  if (areas.length) {
    const pos = [], col = [], c = grid.cs, R2 = rng(77);
    for (const f of areas) {
      const [x0, z0, x1, z1] = polyBounds(f.pts);
      for (let z = Math.floor((z0 - grid.z0) / c) * c + grid.z0; z < z1; z += c) for (let x = Math.floor((x0 - grid.x0) / c) * c + grid.x0; x < x1; x += c) {
        if (!pointInPoly(f.pts, x + c / 2, z + c / 2) || sampleGrid(grid, x + c / 2, z + c / 2).depth > -0.2) continue;
        const v = [[x, z], [x + c, z], [x + c, z + c], [x, z + c]].map(([X, Z]) => [X, Math.max(0.3, gH(X, Z)) + 0.12, Z]);
        const g = 0.5 + R2() * 0.06, cc = new T.Color().setRGB(g, g, g * 0.98, T.SRGBColorSpace);
        for (const k of [0, 3, 2, 0, 2, 1]) { pos.push(...v[k]); col.push(cc.r, cc.g, cc.b); }
      }
    }
    if (pos.length) {
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
      const m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
      m.name = 'port-apron'; m.receiveShadow = true; group.add(m);
    }
  }

  // ------------------------------------------------------------ STS cranes along quay edges (procedural placement)
  const cranes = [];
  if (areas.length) {
    const lines = contour(grid, 0).map(l => smoothLine(l, 1));
    const inPort = (x, z) => areas.some(a => pointInPoly(a.pts, x, z)) || basins.some(b => b.kind === 'basin' && pointInPoly(b.pts, x, z));
    for (const l of lines) {
      const pts = resample(l, 5);
      let last = -1e9, acc = 0;
      for (let i = 2; i < pts.length - 2; i++) {
        acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const [x, z] = pts[i];
        if (!inPort(x, z) || acc - last < 95) continue;
        // straight quay check: direction change over ±10 m small
        const a = pts[i - 2], b = pts[i + 2], c = pts[i];
        const d1 = Math.atan2(c[0] - a[0], c[1] - a[1]), d2 = Math.atan2(b[0] - c[0], b[1] - c[1]);
        if (Math.abs(Math.atan2(Math.sin(d1 - d2), Math.cos(d1 - d2))) > 0.25) continue;
        // seaward normal from the depth gradient
        const e = 12, gx = sampleGrid(grid, x + e, z).depth - sampleGrid(grid, x - e, z).depth, gz = sampleGrid(grid, x, z + e).depth - sampleGrid(grid, x, z - e).depth;
        const gl = Math.hypot(gx, gz); if (gl < 1e-3) continue;
        const nx = gx / gl, nz = gz / gl;
        const px = x - nx * 17, pz = z - nz * 17;
        if (sampleGrid(grid, px, pz).depth > -0.2 || (isBuilding && isBuilding(px, pz, 8))) continue;
        cranes.push({ x: px, z: pz, y: gH(px, pz), h: Math.atan2(nx, nz) }); last = acc;
        if (cranes.length >= 18) break;
      }
    }
    if (cranes.length) {
      const im = instanced(T, kit.gantryCrane(), tintMaterial(T), cranes.length);
      cranes.forEach((c, i) => { dummy.position.set(c.x, c.y, c.z); dummy.rotation.set(0, c.h, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      im.name = 'cranes'; im.castShadow = true; group.add(im); stats.cranes = cranes.length;
    }
  }

  // ------------------------------------------------------------ seamarks: buoys (bobbing) and lights (fixed)
  const buoys = byKind('buoy');
  let buoyMesh = null;
  if (buoys.length) {
    buoyMesh = instanced(T, kit.buoy(), tintMaterial(T), buoys.length);
    buoys.forEach((b, i) => buoyMesh.setCol(i, KIND_COLORS[(b.tags && (b.tags['seamark:buoy_lateral:colour'] || b.tags['seamark:buoy_cardinal:colour'] || '')).split(';')[0]] || KIND_COLORS.yellow));
    buoyMesh.name = 'buoys'; group.add(buoyMesh); stats.buoys = buoys.length;
  }
  const lights = byKind('light').concat(byKind('lighthouse'));
  if (lights.length) {
    const im = instanced(T, kit.lighthouse(lights.some(l => l.kind === 'lighthouse') ? 16 : 7), tintMaterial(T), lights.length);
    lights.forEach((l, i) => {
      const [x, z] = l.pts[0];
      let y = Math.max(0, gH(x, z));
      for (const f of byKind('breakwater')) for (let k = 0; k < f.pts.length; k++) if (Math.hypot(f.pts[k][0] - x, f.pts[k][1] - z) < 40) y = Math.max(y, (f.crest || 5));
      dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      im.setCol(i, KIND_COLORS[(l.tags && l.tags['seamark:light:colour']) || 'white'] || KIND_COLORS.white);
    });
    im.name = 'lights'; group.add(im); stats.lights = lights.length;
  }

  // ------------------------------------------------------------ river (calm water ribbon)
  for (const f of byKind('river')) {
    const line = resample(smoothLine(f.pts, 2), 8), w0 = f.width || 20, pos = [], idx = [];
    for (let i = 0; i < line.length; i++) {
      const p = line[i], q = line[Math.min(i + 1, line.length - 1)], o = line[Math.max(i - 1, 0)];
      let tx = q[0] - o[0], tz = q[1] - o[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const w = w0 * (1 - 0.45 * i / line.length) / 2, y = Math.min(3, Math.max(0.15, gH(p[0], p[1]) + 0.2));
      pos.push(p[0] - tz * w, y, p[1] + tx * w, p[0] + tz * w, y, p[1] - tx * w);
      if (i) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, new T.MeshPhongMaterial({ color: 0x3f6b62, specular: 0x9fb8c0, shininess: 80, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.name = 'river'; group.add(m);
  }

  // ------------------------------------------------------------ solid test for the boat (spatial hash of segments)
  const HC = 50, hash = new Map();
  segs.forEach((s, i) => {
    const [ax, az, bx, bz, r] = s;
    for (let x = Math.floor((Math.min(ax, bx) - r) / HC); x <= Math.floor((Math.max(ax, bx) + r) / HC); x++)
      for (let z = Math.floor((Math.min(az, bz) - r) / HC); z <= Math.floor((Math.max(az, bz) + r) / HC); z++) { const k = x + ',' + z; if (!hash.has(k)) hash.set(k, []); hash.get(k).push(i); }
  });
  function solid(x, z) {
    const a = hash.get(Math.floor(x / HC) + ',' + Math.floor(z / HC)); if (!a) return false;
    for (const i of a) {
      const [ax, az, bx, bz, r] = segs[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r) return true;
    }
    return false;
  }

  function update(t) {
    if (buoyMesh && seaHeight) {
      buoys.forEach((b, i) => {
        const [x, z] = b.pts[0], y = seaHeight(x, z, t), yx = seaHeight(x + 1, z, t), yz = seaHeight(x, z + 1, t);
        dummy.position.set(x, y - 0.3, z); dummy.rotation.set((yz - y) * 0.8, 0, -(yx - y) * 0.8); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); buoyMesh.setMatrixAt(i, dummy.matrix);
      });
      buoyMesh.instanceMatrix.needsUpdate = true;
    }
  }
  return { group, solid, update, stats, cranes, blocks, moored, segs };
}
