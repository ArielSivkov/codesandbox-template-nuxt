/* Yazam tiled loader for three.js – drop-in replacement for the embedded YZ_DATA block.
 * Loads index.json -> city manifest -> only the 1 km tiles near the camera (phone friendly).
 * Fixes the 3 visual bugs seen on the phone:
 *  (1) sea speckles/stripes: no infinite water plane under the land. The sea is drawn only from
 *      the per-tile sea polygons, at y=-0.6, with polygonOffset; land is >= +0.3 m in the data;
 *      renderer uses logarithmicDepthBuffer and a near plane that follows the camera distance.
 *  (2) floating tilted slab: terrain exists only inside the study area (OUTSIDE samples are
 *      dropped), tile edges get a short vertical "skirt" down to y=-2 so there is no visible gap,
 *      and an outer ring fades into the fog colour instead of ending in a hard edge.
 *  (3) all buildings same height: every building carries h ± s, floors range and source; the
 *      colour mode "confidence" shows it and the quote receives the range.
 * Coordinates: scene x = ITM east - origin.x, z = -(ITM north - origin.y), y = up (metres).
 */
export function createYazamTiles(THREE, scene, camera, opts = {}) {
  const BASE = opts.base || '/map-data/';
  const SEA = -32768, OUT = -32767;
  const state = { origin: null, manifest: null, tiles: new Map(), loading: new Set(), group: new THREE.Group() };
  scene.add(state.group);
  const landMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const seaMat = new THREE.MeshPhongMaterial({ color: 0x2f6f9a, shininess: 60, specular: 0x88aacc,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const bMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  async function getJSON(p) { const r = await fetch(BASE + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); }
  async function getBin(p) { const r = await fetch(BASE + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.arrayBuffer(); }

  async function openCity(slug) {
    const m = await getJSON(`cities/${slug}/manifest.json`);
    state.manifest = m;
    const [x0, y0, x1, y1] = m.bbox_itm;
    state.origin = { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
    return m;
  }
  const sx = x => x - state.origin.x, sz = y => -(y - state.origin.y);

  function decodeRing(r, ox, oy) { const a = []; let x = ox, y = oy; for (let i = 0; i < r.length; i += 2) { x += r[i] / 10; y += r[i + 1] / 10; a.push([x, y]); } return a; }

  function terrainMesh(buf) {
    const dv = new DataView(buf);
    const tx = dv.getInt32(6, true), ty = dv.getInt32(10, true), nt = dv.getUint16(14, true), step = dv.getUint16(18, true);
    const z = new Int16Array(buf, 20, nt * nt);
    const x0 = tx * 1000, y1 = (ty + 1) * 1000;
    const pos = [], col = [], idx = [], vid = new Int32Array(nt * nt).fill(-1);
    const c = new THREE.Color();
    for (let r = 0; r < nt; r++) for (let k = 0; k < nt; k++) {
      const v = z[r * nt + k]; if (v === OUT || v === SEA) continue;     // no slab outside, no land in sea
      const h = v / 10; vid[r * nt + k] = pos.length / 3;
      pos.push(sx(x0 + k * step), h, sz(y1 - r * step));
      if (h < 4) c.setRGB(0.86, 0.80, 0.64); else if (h < 15) c.setRGB(0.74, 0.72, 0.62); else c.setRGB(0.62 + h / 400, 0.66, 0.52);
      col.push(c.r, c.g, c.b);
    }
    for (let r = 0; r < nt - 1; r++) for (let k = 0; k < nt - 1; k++) {
      const a = vid[r * nt + k], b = vid[r * nt + k + 1], d = vid[(r + 1) * nt + k], e = vid[(r + 1) * nt + k + 1];
      if (a >= 0 && b >= 0 && d >= 0) idx.push(a, d, b);
      if (b >= 0 && d >= 0 && e >= 0) idx.push(b, d, e);
    }
    // skirts on the outer edge of the study area (vertex present, neighbour missing)
    const skirt = (a, b) => { const i = pos.length / 3; pos.push(pos[a * 3], -2, pos[a * 3 + 2], pos[b * 3], -2, pos[b * 3 + 2]); col.push(0.55, 0.52, 0.46, 0.55, 0.52, 0.46); idx.push(a, i, b, b, i, i + 1); };
    for (let r = 0; r < nt; r++) for (let k = 0; k < nt - 1; k++) {
      const a = vid[r * nt + k], b = vid[r * nt + k + 1]; if (a < 0 || b < 0) continue;
      const up = r > 0 ? vid[(r - 1) * nt + k] : 0, dn = r < nt - 1 ? vid[(r + 1) * nt + k] : 0;
      if (up < 0 || dn < 0) skirt(a, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, landMat); m.name = 'terrain'; return m;
  }

  function seaMesh(tile) {
    const shapes = [];
    for (const poly of tile.sea) {
      const rings = poly.map(r => decodeRing(r, tile.o[0], tile.o[1]));
      const s = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(sx(x), -sz(y))));
      for (const h of rings.slice(1)) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(sx(x), -sz(y)))));
      shapes.push(s);
    }
    if (!shapes.length) return null;
    const g = new THREE.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2); g.translate(0, -0.6, 0);
    return new THREE.Mesh(g, seaMat);
  }

  const CONF_COL = [[0.22, 0.80, 0.45], [0.55, 0.80, 0.35], [0.97, 0.75, 0.30], [0.90, 0.40, 0.30]];
  function buildingsMesh(tile, mode) {
    const pos = [], col = [], owner = [];
    tile.b.forEach((b, bi) => {
      const ring = decodeRing(b.r[0], tile.o[0], tile.o[1]);
      const y0 = b.z / 10 - 0.5, y1 = b.z / 10 + b.h / 10;
      const cc = mode === 'confidence' ? CONF_COL[b.c] : [0.93, 0.91, 0.87];
      const pts = ring.map(([x, y]) => new THREE.Vector2(sx(x), sz(y)));
      for (let i = 0; i < pts.length; i++) {                          // walls
        const p = pts[i], q = pts[(i + 1) % pts.length];
        pos.push(p.x, y0, p.y, q.x, y0, q.y, q.x, y1, q.y, p.x, y0, p.y, q.x, y1, q.y, p.x, y1, p.y);
        for (let k = 0; k < 6; k++) { col.push(...cc); owner.push(bi); }
      }
      const tri = THREE.ShapeUtils.triangulateShape(pts, []);          // roof
      for (const t of tri) for (const k of t) { pos.push(pts[k].x, y1, pts[k].y); col.push(...cc); owner.push(bi); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, bMat); m.userData = { tile, owner }; return m;
  }

  async function loadTile(key, mode) {
    if (state.tiles.has(key) || state.loading.has(key)) return;
    state.loading.add(key);
    try {
      const [v, t] = await Promise.all([getJSON(`tiles/v/${key}.json.gz`), getBin(`tiles/t/${key}.bin.gz`)]);
      const grp = new THREE.Group(); grp.name = key;
      grp.add(terrainMesh(t)); const s = seaMesh(v); if (s) grp.add(s); if (v.b.length) grp.add(buildingsMesh(v, mode));
      state.group.add(grp); state.tiles.set(key, { grp, v });
    } catch (e) { console.warn('tile', key, e); } finally { state.loading.delete(key); }
  }

  /** call on camera move: loads tiles within `radius` m of the look-at point, unloads far ones */
  function update(target, radius = 2500, mode = 'base') {
    if (!state.manifest) return;
    const ex = target.x + state.origin.x, ny = -target.z + state.origin.y;
    const want = new Set(state.manifest.tiles.filter(k => {
      const [tx, ty] = k.split('_').map(Number);
      return Math.hypot((tx + 0.5) * 1000 - ex, (ty + 0.5) * 1000 - ny) < radius + 710;
    }));
    for (const k of want) loadTile(k, mode);
    for (const [k, t] of state.tiles) if (!want.has(k) && Math.hypot(...k.split('_').map(Number).map((v, i) => (v + 0.5) * 1000 - (i ? ny : ex))) > radius * 2) {
      state.group.remove(t.grp); t.grp.traverse(o => o.geometry && o.geometry.dispose()); state.tiles.delete(k);
    }
  }

  /** near plane follows the camera distance -> depth precision stays high on 16/24-bit phones */
  function tuneCamera(dist) { camera.near = Math.max(1, dist / 400); camera.far = Math.max(20000, dist * 12); camera.updateProjectionMatrix(); }

  /** quote basis with uncertainty: facade range instead of a single guessed number */
  function quoteBasis(b, perimeter) {
    const h = b.h / 10, s = b.s / 10, conf = ['מאומת', 'גבוה', 'בינוני', 'נמוך'][b.c];
    return { height_m: h, sigma_m: s, floors: b.f, floors_range: [b.fl, b.fh], confidence: conf, source: b.src,
      facade_gross_m2: Math.round(perimeter * h), facade_range_m2: [Math.round(perimeter * Math.max(0, h - s)), Math.round(perimeter * (h + s))] };
  }

  return { openCity, update, tuneCamera, quoteBasis, state };
}

/* Renderer settings that go with it (in the page):
 *   new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true })
 *   scene.fog = new THREE.Fog(bg, 3000, 9000)          // outer edge fades instead of a hard slab edge
 *   remove: the 120 km "water" PlaneGeometry at y=0
 * Header at 360 px (CSS):
 *   @media (max-width:420px){ header h1 .long{display:none} header .demo{display:none}
 *     .btn{padding:6px 8px} #toQuote .qlong{display:none} }
 *   <h1>לוח היזם<span class="long"> · תלת־ממד</span></h1>   + icon-only buttons (🔍 / ☰) with aria-label
 */
