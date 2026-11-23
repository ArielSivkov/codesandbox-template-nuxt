/* ESH27 twin — maritime / traffic.js — ambient ships & yachts (PROCEDURAL, not live), AIS vessels, wakes.
 *   - ships at anchor in the anchorage area: bow into the wind (weathervaning), positions deterministic
 *   - ships entering / leaving along the fairway (ping-pong path), yachts circling off the marina
 *   - AIS vessels (adapter) replace the ambient anchorage ships when present — labelled by the adapter status
 * Wakes: Kelvin wedge, half-angle arcsin(1/3) = 19.47° (Kelvin 1887; deep-water ship waves), drawn as an
 * instanced decal that drapes on the same Gerstner waves (shared GLSL chunk).
 */
import { makeKit, tintMaterial, instanced } from './geom.js';
import { pointInPoly, polyBounds, resample } from './grid.js';
import { rng } from './waves.js';
import { WAVE_CHUNK } from './ocean.js';

export const KELVIN = Math.asin(1 / 3);

function pathLen(p) { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; }
function along(p, cum, s) {
  let i = 1; while (i < p.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t, Math.atan2(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])];
}

function wakeMesh(T, oceanUniforms, max) {
  const g = new T.PlaneGeometry(1, 1, 6, 12); g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.5);   // spans z ∈ [−1, 0] (behind the stern)
  const str = new Float32Array(max), dim = new Float32Array(max * 2);
  g.setAttribute('aStr', new T.InstancedBufferAttribute(str, 1));
  g.setAttribute('aDim', new T.InstancedBufferAttribute(dim, 2));     // (half width m, length m)
  const uniforms = Object.assign({}, oceanUniforms, { uTime: oceanUniforms.uTime });
  const mat = new T.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `${WAVE_CHUNK}
attribute float aStr; attribute vec2 aDim; varying vec2 vM; varying float vS; varying float vL; varying float vD;
void main(){ vM = vec2((uv.x * 2.0 - 1.0) * aDim.x, uv.y * aDim.y); vS = aStr; vL = aDim.y;   // metres: (lateral, behind the stern)
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  wp.y = waveY(wp.xz) + 0.1; vD = length(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uTime; varying vec2 vM; varying float vS; varying float vL; varying float vD;
float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hs(i),hs(i+vec2(1,0)),f.x), mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x), f.y); }
void main(){
  float lat = abs(vM.x), bh = vM.y;
  float edge = bh * 0.35355;                                   // tan(19.47°): Kelvin wedge
  float qa = (lat - edge) / (0.8 + 0.03 * bh); float arm = exp(-qa * qa);
  float qc = lat / (0.6 + 0.05 * bh); float centre = exp(-qc * qc) * exp(-bh / (0.3 * vL));
  float n = vn(vec2(vM.x * 0.9, bh * 0.6 - uTime * 2.0));
  float a = (arm * 0.55 + centre * 0.9) * (1.0 - smoothstep(0.45 * vL, vL, bh)) * (0.45 + 0.55 * n);
  a *= vS * (1.0 - smoothstep(600.0, 1200.0, vD));
  gl_FragColor = vec4(vec3(0.88, 0.92, 0.94), clamp(a, 0.0, 1.0) * 0.6);
  #include <colorspace_fragment>
}` });
  const m = new T.InstancedMesh(g, mat, max); m.frustumCulled = false; m.count = 0; m.renderOrder = 3; m.name = 'wakes';
  m.setWake = (i, x, z, h, len, strength) => {
    const w = 2 * Math.tan(KELVIN) * len;
    const d = new T.Object3D(); d.position.set(x, 0, z); d.rotation.set(0, h, 0); d.scale.set(w, 1, len); d.updateMatrix();
    m.setMatrixAt(i, d.matrix); str[i] = strength; dim[i * 2] = w / 2; dim[i * 2 + 1] = len; g.attributes.aStr.needsUpdate = true; g.attributes.aDim.needsUpdate = true;
  };
  return m;
}

/**
 * opts: { features (scene coords), seaHeight(x,z,t), windDir: {x,z} (air moves to), oceanUniforms, llToScene?(lat,lon) }
 */
export function createTraffic(T, { features, seaHeight, oceanUniforms, llToScene = null, nAnchored = 7, nYachts = 5 }) {
  const kit = makeKit(T), group = new T.Group(); group.name = 'maritime-traffic';
  const byKind = k => features.filter(f => f.kind === k);
  const R = rng(2711);
  const ships = [];        // {type:'cont'|'tank', x,z,h, L, mode:'anchor'|'path'|'ais', ...}
  const anch = byKind('anchorage')[0], fair = byKind('fairway')[0], marina = byKind('marina')[0];
  const hullCols = [0x1f2e44, 0x7a1f1f, 0x23402e, 0x2b2b2b, 0x2f5a8a, 0x5a3b1f];
  if (anch) {
    const [x0, z0, x1, z1] = polyBounds(anch.pts);
    for (let tries = 0; ships.length < nAnchored && tries < 500; tries++) {
      const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
      if (!pointInPoly(anch.pts, x, z) || ships.some(s => Math.hypot(s.x - x, s.z - z) < 450)) continue;
      ships.push({ type: R() < 0.65 ? 'cont' : 'tank', x, z, h: 0, hOff: (R() - 0.5) * 0.5, L: 0, scale: 0.75 + R() * 0.5, mode: 'anchor', col: hullCols[ships.length % hullCols.length], speed: 0 });
    }
  }
  if (fair) {
    const p = resample(fair.pts, 20), cum = pathLen(p);
    for (let k = 0; k < 2; k++) ships.push({ type: 'cont', mode: 'path', path: p, cum, off: k * cum[cum.length - 1] * 0.9, v: 4.2, x: 0, z: 0, h: 0, scale: 0.8 + 0.2 * k, col: hullCols[(k + 3) % hullCols.length], speed: 4.2 });
  }
  const yachts = [];
  if (marina) {
    let cx = 0, cz = 0; for (const q of marina.pts) { cx += q[0]; cz += q[1]; } cx /= marina.pts.length; cz /= marina.pts.length;
    for (let i = 0; i < nYachts; i++) yachts.push({ cx: cx - 650 - R() * 500, cz: cz + (R() - 0.5) * 1400, rx: 220 + R() * 260, rz: 140 + R() * 200, ph: R() * 6.28, w: (R() < 0.5 ? 1 : -1) * (0.008 + R() * 0.008), len: 10 + R() * 8, sail: R() < 0.6, x: 0, z: 0, h: 0, col: [0xffffff, 0xf2efe6, 0x1f3550][i % 3] });
  }
  // meshes: container ships, tankers, yachts (instanced); wakes
  const mk = (geo, n, name) => { const m = instanced(T, geo, tintMaterial(T), Math.max(1, n)); m.count = n; m.name = name; group.add(m); return m; };   // far away: no shadow pass
  const MAXAIS = 40;
  const contMesh = mk(kit.containerShip(200, 30, 14), ships.filter(s => s.type === 'cont').length + MAXAIS, 'ships-container');
  const tankMesh = mk(kit.tanker(180, 32, 15), ships.filter(s => s.type === 'tank').length + MAXAIS, 'ships-tanker');
  const yachtMesh = mk(kit.yacht(12, 3.8, true, 8), yachts.length + MAXAIS, 'yachts');
  const wakes = wakeMesh(T, oceanUniforms, ships.length + yachts.length + MAXAIS + 2);
  group.add(wakes);
  let ais = [], aisStatus = null;
  const d = new T.Object3D();

  function setAIS(list, status) {
    aisStatus = status;
    ais = (llToScene ? list : []).map(v => ({ ...v, p: llToScene(v.lat, v.lon) }));
  }

  const draft = L => L > 60 ? 0.045 * L : 0.25;      // laden draught ≈ L/22 (approx)
  function poseOnWaves(x, z, h, L, t) {
    const fx = Math.sin(h), fz = Math.cos(h), y = seaHeight(x, z, t);
    const yb = seaHeight(x + fx * L * 0.4, z + fz * L * 0.4, t), ys = seaHeight(x - fx * L * 0.4, z - fz * L * 0.4, t);
    const yl = seaHeight(x + fz * L * 0.08, z - fx * L * 0.08, t), yr = seaHeight(x - fz * L * 0.08, z + fx * L * 0.08, t);
    const k = Math.min(1, 40 / L);
    return { y: (y * 2 + yb + ys) / 4, pitch: -Math.atan2(yb - ys, L * 0.8) * k, roll: Math.atan2(yl - yr, L * 0.16) * k * 0.6 };
  }

  /** extra: [{x,z,h,speed,len}] e.g. the player's boat, gets a wake */
  function update(t, wind, extra = []) {
    const wl = Math.hypot(wind.x, wind.z) || 1, windH = Math.atan2(-wind.x / wl, -wind.z / wl);   // bow into the wind
    let ic = 0, it = 0, iy = 0, iw = 0;
    const useAIS = ais.length > 0;
    const place = (mesh, i, x, z, h, s, L, col, t2) => {
      const p = poseOnWaves(x, z, h, L, t2);
      d.position.set(x, p.y - draft(L), z); d.rotation.set(0, 0, 0); d.rotateY(h); d.rotateX(p.pitch); d.rotateZ(p.roll); d.scale.set(s, s, s); d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix); if (col != null) mesh.setCol(i, col);
    };
    for (const s of ships) {
      if (s.mode === 'anchor' && useAIS) continue;
      const L = (s.type === 'cont' ? 200 : 180) * s.scale;
      if (s.mode === 'anchor') { s.h = windH + s.hOff; }
      else {
        const Lp = s.cum[s.cum.length - 1], u = ((t * s.v + s.off) % (2 * Lp) + 2 * Lp) % (2 * Lp), back = u > Lp;
        const [x, z, h] = along(s.path, s.cum, back ? 2 * Lp - u : u);
        s.x = x; s.z = z; s.h = back ? h + Math.PI : h;
      }
      if (s.type === 'cont') place(contMesh, ic++, s.x, s.z, s.h, s.scale, L, s.col, t); else place(tankMesh, it++, s.x, s.z, s.h, s.scale, L, s.col, t);
      if (s.mode === 'path') wakes.setWake(iw++, s.x - Math.sin(s.h) * L * 0.5, s.z - Math.cos(s.h) * L * 0.5, s.h, 260, 0.9);
    }
    for (const v of ais) {
      const L = v.length || (v.type === 'pleasure' ? 12 : v.type === 'tug' ? 30 : 180);
      const sp = (v.sog || 0) * 0.514444, cog = (v.cog || 0) * Math.PI / 180, dt = Math.min(600, Math.max(0, (Date.now() - v.ts) / 1000));
      // dead reckoning in the scene frame (x east, z south)
      const x = v.p.x + Math.sin(cog) * sp * dt, z = v.p.z - Math.cos(cog) * sp * dt;
      const hdg = v.heading != null ? v.heading : (sp > 0.5 ? v.cog : null);
      const h = hdg != null ? Math.atan2(Math.sin(hdg * Math.PI / 180), -Math.cos(hdg * Math.PI / 180)) : windH;
      if (v.type === 'pleasure' || v.type === 'tug') { if (iy < yachtMesh.instanceMatrix.count) place(yachtMesh, iy++, x, z, h, L / 12, L, v.type === 'tug' ? 0x2b2b2b : 0xffffff, t); }
      else if (v.type === 'tanker') place(tankMesh, it++, x, z, h, L / 180, L, 0x7a1f1f, t);
      else place(contMesh, ic++, x, z, h, L / 200, L, 0x1f2e44, t);
      if (sp > 0.8) wakes.setWake(iw++, x - Math.sin(h) * L * 0.5, z - Math.cos(h) * L * 0.5, h, Math.min(300, 40 + sp * 30), Math.min(1, sp / 5));
    }
    for (const y of yachts) {
      const a = y.ph + t * y.w, x = y.cx + Math.cos(a) * y.rx, z = y.cz + Math.sin(a) * y.rz;
      const h = Math.atan2(-Math.sin(a) * y.rx * y.w, Math.cos(a) * y.rz * y.w);
      y.x = x; y.z = z; y.h = h;
      place(yachtMesh, iy++, x, z, h, y.len / 12, y.len, y.col, t);
      wakes.setWake(iw++, x - Math.sin(h) * y.len * 0.45, z - Math.cos(h) * y.len * 0.45, h, 60, 0.7);
    }
    for (const e of extra) if (e.speed > 1) wakes.setWake(iw++, e.x - Math.sin(e.h) * e.len * 0.45, e.z - Math.cos(e.h) * e.len * 0.45, e.h, Math.min(140, 15 + e.speed * 5), Math.min(1, e.speed / 8));
    contMesh.count = ic; tankMesh.count = it; yachtMesh.count = iy; wakes.count = iw;
    for (const m of [contMesh, tankMesh, yachtMesh, wakes]) m.instanceMatrix.needsUpdate = true;
  }
  return { group, update, setAIS, ships, yachts, get aisStatus() { return aisStatus; }, wakes };
}
