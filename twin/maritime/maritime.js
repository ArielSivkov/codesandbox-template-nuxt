/* ESH27 twin — maritime department ("המחלקה הימית") — integration entry point (ES module).
 *
 *   import { createMaritime } from './maritime.js';
 *   const M = createMaritime(THREE, { scene, toScene, classify | tiles+tileFrame, bboxITM, features, ... });
 *   M.setWind(wind_vec);  M.setSun(sunVec);  M.setSky({ top, hor, fogColor, fogNear, fogFar });
 *   each frame: M.update(dt, camera);           // advances its own clock M.time
 *   M.seaHeight(x, z) / M.isWater(x, z) / M.depthAt(x, z) / M.solid(x, z)
 *   const boat = M.createBoat(x, z, heading);   boat.step(dt, { throttle, steer, boost })
 *
 * Frame: x = east, y = up, z = south (metres), as twin/game/js/world.js (x = E − OX, z = −(N − OY)).
 * Nothing here pretends to be live or measured: see M.labels (Hebrew) and README.txt.
 */
import { buildWaveSet, createSurface } from './src/waves.js';
import { seaStateFromWind, beaufort, coastFrame } from './src/seastate.js';
import { buildGrid, sampleGrid, attenuation, breakDepth, terrainSampler, decodeTerrainBin, fillFromTiles, BATHY_LABEL, smoothstep } from './src/grid.js';
import { createOcean } from './src/ocean.js';
import { createPort } from './src/port.js';
import { createTraffic } from './src/traffic.js';
import { createBeach } from './src/beach.js';
import { createBoat as createBoatPhysics, knots } from './src/boat.js';
import { makeKit } from './src/geom.js';
import { FixtureAIS, ServerProxyAIS, AIS_STATUS_HE } from './src/ais.js';

export { decodeTerrainBin, terrainSampler, FixtureAIS, ServerProxyAIS, AIS_STATUS_HE, knots, beaufort };
export const VERSION = '0.1.0';

/** pipeline 'mar' layer of a vector tile (see pipeline_patch) → features in ITM (same shape as the fixture) */
export const MAR_KINDS = ['breakwater', 'groyne', 'pier', 'quay_line', 'port_area', 'basin', 'marina', 'crane', 'buoy', 'beacon', 'light', 'lighthouse', 'river', 'beach', 'anchorage', 'fairway'];
export function decodeMarLayer(vt) {
  const out = [];
  for (const r of vt.mar || []) {
    let x = vt.o[0], y = vt.o[1]; const pts = [];
    const ring = r.g === 'p' ? r.p : r.r;
    for (let i = 0; i < ring.length; i += 2) { x += ring[i] / 10; y += ring[i + 1] / 10; pts.push([x, y]); }
    out.push({ id: r.i, kind: MAR_KINDS[r.k] || 'other', geom: r.g === 'a' ? 'area' : r.g === 'l' ? 'line' : 'point', coords: r.g === 'p' ? pts[0] : pts, tags: r.t || {}, src: 'osm', ...(r.w ? { width: r.w } : {}) });
  }
  return out;
}

export function createMaritime(T, o) {
  const {
    scene, toScene, features: featuresITM = [], groundH = null, isBuilding = null, llToScene = null,
    cs = 25, coastB = 0.45566, coastA = -125006.9, seaPadM = 6000, padNS = 1000, tileFrame = null,
  } = o;
  const t0 = performance.now();
  // ---------------------------------------------------------------- features → scene
  const features = featuresITM.map(f => {
    const P = f.geom === 'point' ? [f.coords] : f.coords;
    return { ...f, pts: P.map(([E, N]) => { const p = toScene(E, N); return [p.x, p.z]; }) };
  });
  // ---------------------------------------------------------------- maritime grid (scene coords, on the terrain lattice)
  let classify = o.classify;
  if (!classify && o.tiles) {
    const ts = terrainSampler(o.tiles, { A: coastA, B: coastB });
    classify = (x, z) => { const { E, N } = tileFrame.toITM(x, z); const c = ts(E, N); return { land: c.state === 'land' || c.state === 'unknown-land', h: c.h }; };
  }
  const [bE0, bN0, bE1, bN1] = o.bboxITM;                         // in the TILE frame (as the manifest)
  const E0 = Math.floor((bE0 - seaPadM) / cs) * cs, E1 = Math.ceil((bE1 + 200) / cs) * cs;
  const N0 = Math.floor((bN0 - padNS) / cs) * cs, N1 = Math.ceil((bN1 + padNS) / cs) * cs;
  const origin = tileFrame.toScene(E0, N1);                       // NW corner → (x0, z0)
  const basins = features.filter(f => f.kind === 'basin' || f.kind === 'marina').map(f => ({ poly: f.pts, depth: f.depth ?? (f.kind === 'marina' ? 4 : 14), shelter: f.shelter ?? (f.kind === 'marina' ? 0.08 : 0.15) }));
  const nx = (E1 - E0) / cs + 1, nz = (N1 - N0) / cs + 1;
  const prefill = o.tiles && !o.classify ? fillFromTiles(o.tiles, { E0, N1, nx, nz, cs, A: coastA, B: coastB }) : null;
  const grid = buildGrid({ x0: origin.x, z0: origin.z, nx, nz, cs, classify, prefill, basins });
  // seabed in world.js is flat at −2.5 m; keep near-shore depth consistent with it (waterline = terrain crossing)
  for (let k = 0; k < grid.depth.length; k++) if (!grid.land[k]) grid.depth[k] = Math.max(grid.depth[k], 2.5);
  // outside the grid: the fitted coast line decides land/sea (same as world.js fallbackH)
  const cf = coastFrame(coastB);
  const outsideLand = (x, z) => { const { E, N } = tileFrame.toITM(x, z); return E > coastA + coastB * N + 300; };
  const gridMs = performance.now() - t0;

  // ---------------------------------------------------------------- sea state + waves
  const st = { wind: { x: 4, y: 0, z: 0 }, sea: null, set: null, surf: null, hb: 1.6, time: 0 };
  const sGrid = {};
  const att0 = (x, z) => {
    const fx = (x - grid.x0) / grid.cs, fz = (z - grid.z0) / grid.cs;
    if (fx < 0 || fz < 0 || fx > grid.nx - 1 || fz > grid.nz - 1) return outsideLand(x, z) ? 0 : 1;
    sampleGrid(grid, x, z, sGrid); return sGrid.shelter * smoothstep(0, st.hb, sGrid.depth);
  };
  const ocean = createOcean(T, { grid });
  { const c = tileFrame.toITM(0, 0); ocean.uniforms.uCoast.value.set(1, coastB, coastA + coastB * c.N - c.E + 300); }
  scene.add(ocean.mesh);

  function setWind(windVec, opts = {}) {
    st.wind = { x: windVec.x || 0, y: 0, z: windVec.z || 0 };
    st.sea = seaStateFromWind(st.wind, { coastB, ...opts });
    st.set = buildWaveSet({ wind: st.sea.wind, swell: st.sea.swell, seed: opts.seed || 27 });
    st.hb = breakDepth(st.sea.HsTotal);
    st.surf = createSurface(st.set, att0);
    const u = ocean.uniforms; u.uHb.value = st.hb; u.uWhite.value = st.sea.whitecaps;
    const U = Math.hypot(st.wind.x, st.wind.z); u.uWind.value.set(U ? st.wind.x / U : 1, U ? st.wind.z / U : 0);
    u.uDetail.value = 0.18 + Math.min(0.35, U * 0.03);
    ocean.setWaves(st.set, st.time);
    return st.sea;
  }
  setWind(st.wind);
  const seaHeight = (x, z, t = st.time) => st.surf.height(x, z, t);
  const depthAt = (x, z) => { const fx = (x - grid.x0) / grid.cs, fz = (z - grid.z0) / grid.cs; if (fx < 0 || fz < 0 || fx > grid.nx - 1 || fz > grid.nz - 1) return outsideLand(x, z) ? -5 : 250; return sampleGrid(grid, x, z).depth; };

  // ---------------------------------------------------------------- port, traffic, beach
  const port = createPort(T, { features, grid, groundH, isBuilding, seaHeight, coastAlong: [cf.alongX, cf.alongZ] });
  scene.add(port.group);
  const traffic = createTraffic(T, { features, seaHeight, oceanUniforms: ocean.uniforms, llToScene });
  scene.add(traffic.group);
  const beach = createBeach(T, { grid, features, groundH, isBuilding, seaHeight });
  scene.add(beach.group);
  const solid = (x, z) => depthAt(x, z) < 0.25 || port.solid(x, z);
  const isWater = (x, z) => depthAt(x, z) > 0 && !port.solid(x, z);

  // ---------------------------------------------------------------- AIS
  let ais = null;
  function useAIS(adapter) { if (ais) ais.stop(); ais = adapter; adapter.on((list, status) => traffic.setAIS(list, status)); adapter.start(); return adapter; }

  // ---------------------------------------------------------------- boat (physics + mesh)
  const kit = makeKit(T);
  let boatGeo = null;
  function createBoat(x, z, h = 0) {
    const phys = createBoatPhysics({ heightAt: (X, Z, t) => st.surf.height(X, Z, t), solid, depthAt, x, z, h, t: st.time });
    boatGeo = boatGeo || kit.speedboat();
    const mesh = new T.Mesh(boatGeo, new T.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true; mesh.name = 'player-boat'; scene.add(mesh);
    const sync = () => { const s = phys.state; mesh.position.set(s.x, s.y, s.z); mesh.rotation.set(0, 0, 0); mesh.rotateY(s.h); mesh.rotateX(-s.pitch); mesh.rotateZ(s.roll); };
    sync();
    return { ...phys, mesh, sync, step(dt, input) { const r = phys.step(dt, input); sync(); return r; } };
  }

  // ---------------------------------------------------------------- environment
  function setSun(v, { color = null, visibility = null } = {}) {
    const u = ocean.uniforms; u.uSun.value.set(v.x, v.y, v.z).normalize();
    if (color) u.uSunCol.value.set(color);
    u.uSunVis.value = visibility != null ? visibility : Math.max(0, Math.min(1, (v.y + 0.02) * 12));
  }
  function setSky({ top, hor, fogColor, fogNear, fogFar } = {}) {
    const u = ocean.uniforms;
    if (top) u.uSkyTop.value.set(top); if (hor) u.uSkyHor.value.set(hor);
    if (fogColor) u.uFogCol.value.set(fogColor); if (fogNear != null) u.uFog.value.set(fogNear, fogFar);
  }

  const extra = [];
  function update(dt, camera, { boats = [] } = {}) {
    st.time += Math.min(Math.max(dt, 0), 0.1);
    const t = st.time, u = ocean.uniforms;
    u.uCam.value.copy(camera.position); u.uTime.value = t;
    ocean.setWaves(st.set, t);
    port.update(t);
    extra.length = 0; for (const b of boats) extra.push({ x: b.state.x, z: b.state.z, h: b.state.h, speed: Math.abs(b.state.u), len: b.params.L });
    traffic.update(t, st.wind, extra);
    beach.update(t, { swash: Math.min(1, 0.3 + st.sea.HsTotal * 0.5), lit: 0.35 + 0.65 * Math.max(0, Math.min(1, u.uSun.value.y * 3)) });
  }

  const labels = {
    waves: () => `גלים: גובה משמעותי ${st.sea.HsTotal.toFixed(2)} מ' (רוח ${st.sea.wind.Hs.toFixed(2)} + גל ים ${st.sea.swell ? st.sea.swell.Hs.toFixed(1) : 0}), מחזור ${st.sea.wind.Tp.toFixed(1)} ש' · רוח ${st.sea.U10.toFixed(1)} מ/ש (בופור ${beaufort(st.sea.U10)}) · משוער לפי CEM, גל ים מונח`,
    depth: BATHY_LABEL,
    port: 'נמל ומרינה: רציפים ונחל לכיש שורטטו מנתוני הגובה של הדגימה; שוברי גלים, אגן ומרינה – סכמטיים משוערים (לא OSM)',
    traffic: 'אוניות ויאכטות ברקע – תנועה פרוצדורלית, לא נתונים',
    ais: () => ais ? ais.label : AIS_STATUS_HE.offline,
    beach: 'שמשיות, סוכות מציל ושחיינים – מיקום פרוצדורלי',
  };
  function stats() {
    return { gridNodes: grid.nx * grid.nz, gridMs: Math.round(gridMs), oceanTris: ocean.triangles, oceanVerts: ocean.vertices, port: port.stats,
      ships: traffic.ships.length, yachts: traffic.yachts.length, towers: beach.towers.length, umbrellas: beach.umbrellas.length, swimmers: beach.swimmers.length,
      Hs: st.sea.HsTotal, Tp: st.sea.wind.Tp, waves: st.set.waves.length };
  }
  return {
    grid, ocean, port, traffic, beach, features, setWind, setSun, setSky, update, seaHeight, depthAt, isWater, solid, createBoat, useAIS, labels, stats,
    get time() { return st.time; }, set time(v) { st.time = v; }, get sea() { return st.sea; }, get surface() { return st.surf; },
  };
}
