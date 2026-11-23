/* present/present.js — מודול "מצגת יזם" ללוח היזם: שתילת פרויקט מוצע בעולם התאום, לפני/אחרי, ניתוחי ועדה, מבטים.
 * תלוי ב: window.THREE (r186), PGEO (geo.js), PDATA (data.js). glTF: window.ESH_GLTF (vendor/loaders.js) – נטען לפי דרישה.
 * סצנה: x = מזרח − OX, y = מעלה, z = −(צפון − OY). מקומי (geo): [x מזרח, y צפון, z מעלה].
 * API ציבורי: ראו README.txt (createPresenter → P.setProposal / setView / setSun / analyzeShadows / metrics / windowView / shots).
 */
(function (root) {
  'use strict';
  const G = root.PGEO;
  const BAY = 3.4;

  async function createPresenter(opts) {
    const T = opts.THREE || root.THREE;
    const canvas = opts.canvas;
    const isTouch = matchMedia('(pointer:coarse)').matches;
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 2 : 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;            // r186: PCFSoft הוסר; PCF + radius
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 1, 1, 12000);
    const S = (x, y, z) => new T.Vector3(x, z, -y);                 // מקומי → סצנה
    const L = v => [v.x, -v.z, v.y];                                  // סצנה → מקומי

    // ---- שמיים, ערפל, אור
    const SKY_TOP = '#8fb3d6', SKY_BOT = '#e6edf2';
    { const c = document.createElement('canvas'); c.width = 2; c.height = 256; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, SKY_TOP); g.addColorStop(0.62, '#cfdde9'); g.addColorStop(1, SKY_BOT); x.fillStyle = g; x.fillRect(0, 0, 2, 256);
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; scene.background = t; }
    scene.fog = new T.Fog(SKY_BOT, 1400, 5200);
    const hemi = new T.HemisphereLight(0xe4eef8, 0xbfae92, 1.25); scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff0dc, 2.4); sun.castShadow = true;
    const SM = Math.min(renderer.capabilities.maxTextureSize, isTouch ? 2048 : 4096);
    sun.shadow.mapSize.set(SM, SM); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; sun.shadow.radius = 3;
    const sc = sun.shadow.camera; sc.left = -320; sc.right = 320; sc.top = 320; sc.bottom = -320; sc.near = 10; sc.far = 2000;
    scene.add(sun); scene.add(sun.target);

    // ---- עולם
    const world = opts.world || await root.PDATA.loadWorld({ base: opts.base || 'data/', city: opts.city || 'ashdod', siteId: opts.siteId, siteTile: opts.siteTile, radius_m: opts.radius_m || 1100 });
    const latlon = G.itmToWgs84(world.origin.E, world.origin.N);
    const P = { THREE: T, renderer, scene, camera, world, latlon, S, L, state: { view: 'after', swipe: 0.5, date: '2026-12-21', hour: 12, site: null, proposal: null, heat: false, fan: false } };
    let dirty = 2; const invalidate = () => { dirty = 2; };      // רינדור לפי דרישה: חוסך סוללה בטלפון
    const listeners = {}; P.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); }; const emit = (ev, a) => { if (ev !== 'frame') invalidate(); (listeners[ev] || []).forEach(f => f(a)); };

    // ---- קרקע
    const groundGroup = new T.Group(); scene.add(groundGroup);
    for (const t of world.terrain) {
      const pos = [], col = [], idx = [], vid = new Int32Array(t.nt * t.nt).fill(-1);
      for (let r = 0; r < t.nt; r++) for (let k = 0; k < t.nt; k++) {
        const v = t.z[r * t.nt + k]; if (v === world.SEA || v === world.OUT) continue;
        vid[r * t.nt + k] = pos.length / 3; const h = v / 10;
        pos.push(t.x0 + k * t.step, h - 0.05, -(t.y1 - r * t.step));
        const w = Math.min(1, Math.max(0, (h - 2) / 40)); col.push(0.80 - w * 0.06, 0.79 - w * 0.03, 0.74 - w * 0.08);
      }
      for (let r = 0; r < t.nt - 1; r++) for (let k = 0; k < t.nt - 1; k++) {
        const a = vid[r * t.nt + k], b = vid[r * t.nt + k + 1], d = vid[(r + 1) * t.nt + k], e = vid[(r + 1) * t.nt + k + 1];
        if (a >= 0 && b >= 0 && d >= 0) idx.push(a, d, b); if (b >= 0 && d >= 0 && e >= 0) idx.push(b, d, e);
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = true; groundGroup.add(m);
    }
    // כבישים: רצועות שטוחות על הקרקע
    { const W = { 1: 3.5, 2: 5, 3: 7, 4: 10, 5: 14 }, pos = [];
      const gz = (x, y) => (world.ground(x, y) ?? 0) + 0.12;
      for (const r of world.roads) { const w = (W[r.cls] || 5) / 2;
        for (let i = 0; i + 1 < r.pts.length; i++) { const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 0.1) continue;
          const nx = -dy / l * w, ny = dx / l * w, za = gz(a[0], a[1]), zb = gz(b[0], b[1]);
          const A = [a[0] + nx, za, -(a[1] + ny)], B = [a[0] - nx, za, -(a[1] - ny)], C = [b[0] - nx, zb, -(b[1] - ny)], D = [b[0] + nx, zb, -(b[1] + ny)];
          pos.push(...A, ...B, ...C, ...A, ...C, ...D); } }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      const m = new T.Mesh(g, new T.MeshLambertMaterial({ color: 0xc3c6c8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: T.DoubleSide }));
      m.receiveShadow = true; groundGroup.add(m); }

    // ים: פוליגוני הים מהאריחים (בדגימה – קו חוף סינתטי/משוער), מתחת לקרקע (יבשה ≥ +0.3 מ')
    if (world.sea && world.sea.length) {
      const shapes = world.sea.map(rings => { const sh = new T.Shape(rings[0].map(p => new T.Vector2(p[0], p[1]))); for (const h of rings.slice(1)) sh.holes.push(new T.Path(h.map(p => new T.Vector2(p[0], p[1])))); return sh; });
      const g = new T.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2); g.translate(0, -0.6, 0);
      const m = new T.Mesh(g, new T.MeshPhongMaterial({ color: 0x4f88ad, specular: 0x9fc3dd, shininess: 70, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
      m.name = 'sea'; groundGroup.add(m);
    }

    // ---- בניינים קיימים (גאומטריה ממוזגת אחת + בעלות לכל משולש)
    const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
    const baseColor = b => { const v = 0.97 + hash(b.id) * 0.05; return [0.905 * v, 0.885 * v, 0.85 * v]; };
    function prismGeometry(list, colorOf, withEdgesRadius) {
      const pos = [], col = [], triOwner = [], range = new Map(), epos = [];
      for (const b of list) {
        const start = pos.length / 3, y0 = b.base - 0.5, y1 = b.base + b.height, cc = colorOf(b), pts = b.ring;
        for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length];
          pos.push(p[0], y0, -p[1], q[0], y0, -q[1], q[0], y1, -q[1], p[0], y0, -p[1], q[0], y1, -q[1], p[0], y1, -p[1]);
          const lo = 0.80, hi = 1.0, fs = [lo, lo, hi, lo, hi, hi]; for (const f of fs) col.push(cc[0] * f, cc[1] * f, cc[2] * f);
          triOwner.push(b.id, b.id); }
        const tri = T.ShapeUtils.triangulateShape(pts.map(p => new T.Vector2(p[0], p[1])), []);
        for (const t of tri) { for (const k of [t[0], t[2], t[1]]) { pos.push(pts[k][0], y1, -pts[k][1]); col.push(cc[0] * 1.02, cc[1] * 1.02, cc[2] * 1.02); } triOwner.push(b.id); }
        range.set(b.id, [start, pos.length / 3 - start]);
        if (withEdgesRadius && Math.hypot(b.cx, b.cy) < withEdgesRadius) for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length];
          epos.push(p[0], y1, -p[1], q[0], y1, -q[1], p[0], y0 + 0.5, -p[1], p[0], y1, -p[1]); }
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
      let eg = null; if (epos.length) { eg = new T.BufferGeometry(); eg.setAttribute('position', new T.Float32BufferAttribute(epos, 3)); }
      return { g, eg, triOwner, range };
    }
    const cityMat = new T.MeshLambertMaterial({ vertexColors: true });
    const edgeMat = new T.LineBasicMaterial({ color: 0x3b4654, transparent: true, opacity: 0.22, fog: true });
    let city = null;
    function rebuildCity() {
      if (city) for (const m of city.meshes) { scene.remove(m); m.geometry.dispose(); }
      if (city && city.edges) { scene.remove(city.edges); city.edges.geometry.dispose(); }
      // קרוב (≤ 650 מ' מהאתר): מטיל צל. רחוק: רק מקבל – חוסך את רוב משולשי מעבר הצל בטלפון
      const site = world.byId.get(P.state.site) || { cx: 0, cy: 0 };
      const all = world.buildings.filter(b => b.id !== P.state.site), dist = b => Math.hypot(b.cx - site.cx, b.cy - site.cy);
      const parts = [all.filter(b => dist(b) <= 650), all.filter(b => dist(b) > 650)];
      city = { meshes: [], owners: [], range: new Map(), edges: null };
      const epos = [];
      parts.forEach((list, k) => {
        const r = prismGeometry(list, baseColor, 520);
        const mesh = new T.Mesh(r.g, cityMat); mesh.receiveShadow = true; mesh.castShadow = k === 0; mesh.name = 'city' + k; scene.add(mesh);
        city.meshes.push(mesh); city.owners.push(r.triOwner); for (const [id, rg] of r.range) city.range.set(id, [mesh, rg[0], rg[1]]);
        if (r.eg) epos.push(...r.eg.attributes.position.array);
      });
      if (epos.length) { const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.Float32BufferAttribute(epos, 3)); city.edges = new T.LineSegments(eg, edgeMat); city.edges.raycast = () => {}; scene.add(city.edges); }
      if (P.state.heat && P.lastAnalysis) applyHeat(P.lastAnalysis);
      invalidate();
    }
    function recolor(id, rgb) { const rg = city.range.get(id); if (!rg) return; const [mesh, st, cnt] = rg; const c = mesh.geometry.attributes.color, b = world.byId.get(id), base = rgb || baseColor(b);
      const pos = mesh.geometry.attributes.position; const y1 = b.base + b.height;
      for (let i = st; i < st + cnt; i++) { const f = Math.abs(pos.getY(i) - y1) < 0.01 ? 1.0 : 0.80; c.setXYZ(i, base[0] * f, base[1] * f, base[2] * f); } c.needsUpdate = true; invalidate(); }

    // ---- הבניין הקיים שמוחלף (רשת נפרדת, מוצגת רק ב"לפני")
    const existingGroup = new T.Group(); scene.add(existingGroup);
    const ghost = new T.Group(); scene.add(ghost);                   // קו מתאר של הקיים ב"אחרי"
    function buildExisting() {
      existingGroup.clear(); ghost.clear(); const b = world.byId.get(P.state.site); if (!b) return;
      const r = prismGeometry([b], () => [0.93, 0.86, 0.74], 1e9);
      const m = new T.Mesh(r.g, new T.MeshLambertMaterial({ vertexColors: true })); m.castShadow = m.receiveShadow = true; existingGroup.add(m);
      existingGroup.add(new T.LineSegments(r.eg, new T.LineBasicMaterial({ color: 0x8a5a14, transparent: true, opacity: 0.6 })));
      const pts = b.ring.map(p => new T.Vector3(p[0], b.base + 0.35, -p[1])); pts.push(pts[0].clone());
      const lg = new T.BufferGeometry().setFromPoints(pts); const ln = new T.Line(lg, new T.LineDashedMaterial({ color: 0xb06a00, dashSize: 1.6, gapSize: 1.0 })); ln.computeLineDistances(); ghost.add(ln);
    }

    // ---- חומרי הפרויקט המוצע
    function facadeTexture() {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d');
      x.fillStyle = '#f4f2ec'; x.fillRect(0, 0, 128, 128);
      const g = x.createLinearGradient(0, 22, 0, 128); g.addColorStop(0, '#9fb6c8'); g.addColorStop(0.55, '#6f8ca3'); g.addColorStop(1, '#58748b');
      x.fillStyle = g; x.fillRect(6, 22, 116, 106);
      x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(6, 22, 116, 3);
      x.fillStyle = '#e9e6de'; x.fillRect(62, 22, 4, 106); x.fillRect(0, 0, 128, 18);
      x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(0, 18, 128, 4);
      x.fillStyle = 'rgba(40,40,40,.55)'; x.fillRect(6, 92, 116, 2); for (let s = 8; s < 122; s += 6) x.fillRect(s, 92, 1, 36);   // מעקה
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; return t;
    }
    const propWallMat = new T.MeshLambertMaterial({ map: facadeTexture() });
    const propRoofMat = new T.MeshLambertMaterial({ color: 0xdedbd3 });
    const propEdgeMat = new T.LineBasicMaterial({ color: 0x1f2d3d, transparent: true, opacity: 0.85 });
    const proposalGroup = new T.Group(); proposalGroup.name = 'proposal'; scene.add(proposalGroup);

    function massingMeshes(m, baseZ) {
      const grp = new T.Group();
      const wpos = [], wuv = [];
      for (const f of m.floors) { const p = f.poly; let u = 0;
        for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]), u1 = u + l / BAY;
          const y0 = baseZ + f.z0, y1 = baseZ + f.z1;
          wpos.push(a[0], y0, -a[1], b[0], y0, -b[1], b[0], y1, -b[1], a[0], y0, -a[1], b[0], y1, -b[1], a[0], y1, -a[1]);
          wuv.push(u, 0, u1, 0, u1, 1, u, 0, u1, 1, u, 1); u = u1; } }
      const wg = new T.BufferGeometry(); wg.setAttribute('position', new T.Float32BufferAttribute(wpos, 3)); wg.setAttribute('uv', new T.Float32BufferAttribute(wuv, 2)); wg.computeVertexNormals();
      const wm = new T.Mesh(wg, propWallMat); wm.castShadow = wm.receiveShadow = true; grp.add(wm);
      const rpos = [], epos = [];
      for (const t of m.tiers) { const p = t.poly, y1 = baseZ + t.z1, y0 = baseZ + t.z0;
        for (const tr of T.ShapeUtils.triangulateShape(p.map(q => new T.Vector2(q[0], q[1])), [])) for (const k of [tr[0], tr[2], tr[1]]) rpos.push(p[k][0], y1, -p[k][1]);
        for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; epos.push(a[0], y1, -a[1], b[0], y1, -b[1], a[0], y0, -a[1], a[0], y1, -a[1], a[0], y0, -a[1], b[0], y0, -b[1]); } }
      const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.Float32BufferAttribute(rpos, 3)); rg.computeVertexNormals();
      const rm = new T.Mesh(rg, propRoofMat); rm.castShadow = rm.receiveShadow = true; grp.add(rm);
      const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.Float32BufferAttribute(epos, 3)); { const ln = new T.LineSegments(eg, propEdgeMat); ln.raycast = () => {}; grp.add(ln); }
      return grp;
    }

    let gltfCache = new Map();
    async function loadGLTF(url) {
      if (!root.ESH_GLTF) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = (opts.vendor || 'vendor/') + 'loaders.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      if (!gltfCache.has(url)) gltfCache.set(url, new Promise((res, rej) => { const Ld = new root.ESH_GLTF.GLTFLoader(); Ld.setMeshoptDecoder(root.ESH_GLTF.MeshoptDecoder); Ld.load(url, res, undefined, rej); }));
      return gltfCache.get(url);
    }

    /** spec: {type:'massing', footprint:'site'|[[x,y]] (מ' יחסית למרכז האתר), floors, floorHeight, groundFloorHeight, setbacks, rotation}
     *        {type:'gltf', url, floors?, grossArea?, rotation?}  (glTF: מטרים, Y למעלה, מקור במרכז הבסיס) */
    async function setProposal(spec) {
      const site = world.byId.get(P.state.site); if (!site) throw new Error('no site');
      const c = [site.cx, site.cy], baseZ = site.base;
      proposalGroup.clear();
      const pr = { spec: Object.assign({}, spec), baseZ, center: c };
      if (spec.type === 'gltf') {
        const gl = await loadGLTF(spec.url); const obj = gl.scene.clone(true);
        obj.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
        const ang = G.principalAngle(site.ring) + (spec.rotation || 0);
        obj.rotation.y = ang * G.D2R; obj.position.set(c[0], baseZ, -c[1]); proposalGroup.add(obj); obj.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(obj); const ex = (gl.scene.children[0] && gl.scene.children[0].userData) || {};
        // מעטפת: קודקודי המודל במקומי, לחישובי צל/מבט
        const verts = []; const v = new T.Vector3();
        obj.traverse(o => { if (o.isMesh) { const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i += Math.max(1, Math.floor(pa.count / 4000))) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); verts.push(L(v)); } } });
        const hull = G.convexHull(verts);
        pr.kind = 'gltf'; pr.object = obj; pr.height = box.max.y - baseZ; pr.verts = verts; pr.hull = hull;
        pr.floors = spec.floors || ex.floors || null; pr.grossArea = spec.grossArea || ex.grossArea_m2 || null; pr.footprintArea = G.area(hull);
        obj.traverse(o => { if (o.isMesh && o.geometry.attributes.position.count < 60000) { const e = new T.LineSegments(new T.EdgesGeometry(o.geometry, 35), propEdgeMat); e.raycast = () => {}; o.add(e); } }); // קווי מתאר
      } else {
        let fp = spec.footprint && spec.footprint !== 'site' ? spec.footprint.map(p => [p[0] + c[0], p[1] + c[1]]) : site.ring;
        if (spec.rotation) fp = G.rotate(fp, spec.rotation, c[0], c[1]);
        const m = G.buildMassing({ footprint: fp, floors: spec.floors, floorHeight: spec.floorHeight, groundFloorHeight: spec.groundFloorHeight, setbacks: spec.setbacks });
        pr.kind = 'massing'; pr.massing = m; pr.height = m.height; pr.floors = m.floorsBuilt; pr.grossArea = m.grossArea; pr.footprintArea = m.footprintArea;
        pr.prisms = m.tiers.map(t => ({ poly: t.poly, z0: baseZ + t.z0, z1: baseZ + t.z1, bb: G.bbox(t.poly) }));
        proposalGroup.add(massingMeshes(m, baseZ));
      }
      P.state.proposal = pr; P.lastAnalysis = null; if (P.state.heat) clearHeat();
      updateFan(); emit('proposal', pr); return pr;
    }
    /** בחירת הבניין שמוחלף (מזהה OSM מהאריח). מסתיר אותו מהעיר ומציג ב"לפני" */
    async function setSite(id) {
      if (!world.byId.has(id)) throw new Error('unknown building ' + id);
      P.state.site = id; rebuildCity(); buildExisting();
      if (P.state.proposal) await setProposal(P.state.proposal.spec);
      emit('site', world.byId.get(id));
    }

    // ---- שמש
    function sunAt(date, hour) { const ms = G.israelToUTC(date, hour); return G.solarPosition(ms, latlon[0], latlon[1]); }
    function setSun(date, hour) {
      P.state.date = date || P.state.date; P.state.hour = hour ?? P.state.hour;
      const s = sunAt(P.state.date, P.state.hour); P.state.sun = s;
      const sv = G.sunVector(s.azimuth, Math.max(s.apparentElevation, 0.5));
      const site = world.byId.get(P.state.site) || { cx: 0, cy: 0, base: 0 };
      const tgt = S(site.cx, site.cy, site.base);
      sun.target.position.copy(tgt); sun.position.copy(tgt).add(S(sv[0] * 900, sv[1] * 900, sv[2] * 900));
      const day = Math.max(0, Math.min(1, s.apparentElevation / 12));
      sun.intensity = 2.6 * day; hemi.intensity = 0.55 + 0.75 * day;
      sun.color.setHSL(0.09, 0.55 + 0.35 * (1 - day), 0.82 + 0.1 * day);
      emit('sun', s); return s;
    }

    // ---- מניפת צל (קווי מתאר של הצל של המוצע בכל שעה עגולה)
    const fanGroup = new T.Group(); scene.add(fanGroup);
    function proposalShadowPolys(az, el) {
      const pr = P.state.proposal; if (!pr || el <= 0.5) return [];
      if (pr.kind === 'massing') { const out = []; for (const p of pr.prisms) { const s = G.prismShadow(p.poly, p.z0, p.z1, pr.baseZ, az, el); if (s) out.push(...s.polys); } return out; }
      const sv = G.sunVector(az, el); return [G.convexHull(pr.verts.map(v => G.projectToPlane(v[0], v[1], v[2], pr.baseZ, sv)))];
    }
    function updateFan(h0 = 9, h1 = 15) {
      fanGroup.clear(); const pr = P.state.proposal; if (!pr || !P.state.fan) return;
      for (let h = h0; h <= h1; h++) {
        const s = sunAt(P.state.date, h); const polys = proposalShadowPolys(s.azimuth, s.apparentElevation);
        const col = new T.Color().setHSL(0.10 - (h - h0) / (h1 - h0) * 0.32 + (h > 12 ? 1 : 0) * 0, 0.75, 0.45);
        for (const poly of polys) { const pts = poly.map(p => new T.Vector3(p[0], (world.ground(p[0], p[1]) ?? pr.baseZ) + 0.45, -p[1])); pts.push(pts[0].clone());
          fanGroup.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }))); }
        const tip = polys.length ? polys[0].reduce((a, p) => (Math.hypot(p[0] - pr.center[0], p[1] - pr.center[1]) > Math.hypot(a[0] - pr.center[0], a[1] - pr.center[1]) ? p : a), polys[0][0]) : null;
        if (tip) fanGroup.add(makeTextSprite(String(h).padStart(2, '0') + ':00', tip[0], (world.ground(tip[0], tip[1]) ?? pr.baseZ) + 3, -tip[1], col.getStyle()));
      }
    }
    function makeTextSprite(text, x, y, z, color) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 48; const g = c.getContext('2d');
      g.fillStyle = 'rgba(255,255,255,.88)'; g.beginPath(); g.roundRect(4, 6, 120, 36, 12); g.fill(); g.fillStyle = color || '#333'; g.font = 'bold 24px system-ui,Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 25);
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; const s = new T.Sprite(new T.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
      s.position.set(x, y, z); s.scale.set(16, 6, 1); s.renderOrder = 10; return s;
    }
    function setFan(on) { P.state.fan = !!on; updateFan(); invalidate(); }

    // ---- ניתוח הצללה (כנה: קרניים מדויקות מול מנסרות; גובה שכנים = הערכת הנתונים)
    const raycaster = new T.Raycaster();
    function analyzeShadows(o = {}) {
      const pr = P.state.proposal, site = world.byId.get(P.state.site); if (!pr || !site) return null;
      const date = o.date || P.state.date, h0 = o.h0 ?? 9, h1 = o.h1 ?? 15, step = o.step || 0.5, R = o.radius || 150;
      const t0 = performance.now();
      const times = []; for (let h = h0 + step / 2; h < h1; h += step) { const s = sunAt(date, h); if (s.apparentElevation > 0.5) times.push({ h, s, sv: G.sunVector(s.azimuth, s.apparentElevation) }); }
      const receivers = world.buildings.filter(b => b.id !== site.id && Math.hypot(b.cx - site.cx, b.cy - site.cy) <= R);
      const k = o.sigmaK || 0, hOf = b => Math.max(3, b.height + k * b.sigma);   // בדיקת רגישות: גובה השכנים ± σ
      const occ = world.buildings.filter(b => Math.hypot(b.cx - site.cx, b.cy - site.cy) <= R + 250).map(b => ({ id: b.id, poly: b.ring, z0: b.base - 0.5, z1: b.base + hOf(b), bb: b.bb }));
      const propHit = pr.kind === 'massing'
        ? (p, d) => pr.prisms.some(q => G.rayPrism(p, d, q.poly, q.z0, q.z1, q.bb) >= 0)
        : (p, d) => { raycaster.set(S(p[0], p[1], p[2]), S(d[0], d[1], d[2]).normalize()); raycaster.far = 2000; return raycaster.intersectObject(pr.object, true).length > 0; };
      const per = [];
      for (const b of receivers) {
        const samples = G.surfaceSamples(b.ring, b.base, b.base + hOf(b), o.spacing || 4, 3, true);
        const near = occ.filter(q => q.id !== b.id && Math.hypot((q.bb[0] + q.bb[2]) / 2 - b.cx, (q.bb[1] + q.bb[3]) / 2 - b.cy) < 260);
        let fMax = 0, fSum = 0, fN = 0, roofMax = 0, gainMax = 0, minBefore = Infinity, minAfter = Infinity;
        for (const sm of samples) {
          let before = 0, after = 0;
          for (const t of times) {
            const facing = sm.n[0] * t.sv[0] + sm.n[1] * t.sv[1] + sm.n[2] * t.sv[2] > 0.02; if (!facing) continue;
            let blockedOther = false, blockedSite = false;
            for (const q of near) { if (G.rayPrism(sm.p, t.sv, q.poly, q.z0, q.z1, q.bb) >= 0) { if (q.id === site.id) blockedSite = true; else { blockedOther = true; break; } } }
            if (!blockedOther && !blockedSite) before += step;
            if (!blockedOther && !propHit(sm.p, t.sv)) after += step;
          }
          const lost = before - after;
          if (sm.kind === 'roof') roofMax = Math.max(roofMax, lost); else { fMax = Math.max(fMax, lost); if (before > 0) { fSum += lost; fN++; } minBefore = Math.min(minBefore, before); minAfter = Math.min(minAfter, after); }
          gainMax = Math.max(gainMax, -lost);
        }
        per.push({ id: b.id, dist: Math.round(Math.hypot(b.cx - site.cx, b.cy - site.cy)), samples: samples.length, lostMaxH: +fMax.toFixed(2), lostMeanH: fN ? +(fSum / fN).toFixed(2) : 0,
          roofLostH: +roofMax.toFixed(2), gainMaxH: +gainMax.toFixed(2), sunBeforeMinH: isFinite(minBefore) ? minBefore : null, sunAfterMinH: isFinite(minAfter) ? minAfter : null });
      }
      per.sort((a, b) => b.lostMaxH - a.lostMaxH || b.roofLostH - a.roofLostH);
      const res = { date, h0, h1, step, radius: R, times: times.map(t => ({ h: t.h, az: +t.s.azimuth.toFixed(2), el: +t.s.apparentElevation.toFixed(2) })), per,
        affected1h: per.filter(p => p.lostMaxH >= 1).length, affectedAny: per.filter(p => p.lostMaxH > 0 || p.roofLostH > 0).length, roofAffected: per.filter(p => p.roofLostH > 0).length,
        receivers: per.length, ms: Math.round(performance.now() - t0), method: pr.kind === 'massing' ? 'קרן↔מנסרה מדויק' : 'קרן↔משולשי המודל (Raycaster)' };
      res.sigmaK = k; if (o.dry) return res;
      P.lastAnalysis = res; if (P.state.heat) applyHeat(res); emit('analysis', res); return res;
    }
    const HEAT = [[0.905, 0.885, 0.85], [0.98, 0.86, 0.45], [0.96, 0.62, 0.30], [0.86, 0.30, 0.25]];
    function heatColor(h) { return h <= 0.001 ? null : h <= 1 ? HEAT[1] : h <= 2 ? HEAT[2] : HEAT[3]; }
    function applyHeat(res) { if (!city) return; for (const p of res.per) { const c = heatColor(Math.max(p.lostMaxH, p.roofLostH)); recolor(p.id, c); } }
    function clearHeat() { if (!city || !P.lastAnalysis) return; for (const p of P.lastAnalysis.per) recolor(p.id, null); }
    function setHeat(on) { if (!on) clearHeat(); P.state.heat = !!on; if (on && P.lastAnalysis) applyHeat(P.lastAnalysis); }

    // ---- מדדים: שטח, גובה מול שכנים
    function metrics(radius = 100) {
      const pr = P.state.proposal, site = world.byId.get(P.state.site); if (!pr || !site) return null;
      const nb = world.buildings.filter(b => b.id !== site.id && Math.hypot(b.cx - site.cx, b.cy - site.cy) <= radius);
      const hs = nb.map(b => b.height).sort((a, b) => a - b), med = hs.length ? hs[Math.floor(hs.length / 2)] : null;
      const tallest = nb.reduce((a, b) => (!a || b.height > a.height ? b : a), null);
      const exGross = site.area * site.floors, exRange = [site.area * site.floorsRange[0], site.area * site.floorsRange[1]];
      const gross = pr.grossArea;
      return {
        proposal: { kind: pr.kind, floors: pr.floors, height: +pr.height.toFixed(1), grossArea: gross ? Math.round(gross) : null, footprintArea: Math.round(pr.footprintArea) },
        existing: { id: site.id, floors: site.floors, floorsRange: site.floorsRange, height: site.height, sigma: site.sigma, conf: site.conf, footprintArea: Math.round(site.area), grossEst: Math.round(exGross), grossRange: exRange.map(Math.round) },
        added: gross ? { gross: Math.round(gross - exGross), range: [Math.round(gross - exRange[1]), Math.round(gross - exRange[0])] } : null,
        neighbors: { radius, count: nb.length, medianH: med, maxH: tallest ? tallest.height : null, maxId: tallest ? tallest.id : null, sigmaTypical: nb.length ? nb.map(b => b.sigma).sort((a, b) => a - b)[Math.floor(nb.length / 2)] : null },
        heightRatio: med ? +(pr.height / med).toFixed(2) : null,
      };
    }

    // ---- מבט מחלון
    /** {building:'proposal'|id, floor, facing?:deg (אזימוט למבט; ברירת מחדל: לעבר הפרויקט / מערבה לים), floorHeight?} */
    function windowView(o) {
      const pr = P.state.proposal, site = world.byId.get(P.state.site);
      const fh = o.floorHeight || 3.0;
      let ring, base, ctr, lookAz;
      if (o.building === 'proposal') {
        ring = pr.kind === 'massing' ? (pr.massing.floors[Math.min(o.floor, pr.massing.floors.length) - 1] || pr.massing.floors[0]).poly : pr.hull; base = pr.baseZ; ctr = pr.center; lookAz = o.facing ?? 270;
      } else {
        const b = world.byId.get(o.building); if (!b) return null; ring = b.ring; base = b.base; ctr = [b.cx, b.cy];
        lookAz = o.facing ?? (Math.atan2(pr.center[0] - b.cx, pr.center[1] - b.cy) * G.R2D + 360) % 360;
      }
      const want = [Math.sin(lookAz * G.D2R), Math.cos(lookAz * G.D2R)];
      const P2 = G.ccw(ring); let best = null;
      for (let i = 0; i < P2.length; i++) { const a = P2[i], b = P2[(i + 1) % P2.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 2) continue;
        const n = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l], sc = (n[0] * want[0] + n[1] * want[1]) * Math.min(1, l / 8); if (!best || sc > best.sc) best = { sc, a, b, n }; }
      let mid = [(best.a[0] + best.b[0]) / 2 + best.n[0] * 0.8, (best.a[1] + best.b[1]) / 2 + best.n[1] * 0.8];
      if (o.building !== 'proposal' && pr) {
        // בוחרים חלון על חזית שפונה לפרויקט, שהמבט ממנו לפרויקט הכי פחות חסום (קרן מול המנסרות הסמוכות, כולל הבניין עצמו)
        const zEye = base + (o.floor - 1) * fh + 1.5, tgtZ = pr.baseZ + pr.height * 0.5;
        const near = world.buildings.filter(q => q.id !== P.state.site && Math.hypot(q.cx - ctr[0], q.cy - ctr[1]) < 120);
        let bestScore = -1;
        for (let i = 0; i < P2.length; i++) { const a = P2[i], b = P2[(i + 1) % P2.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 3) continue;
          const n = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
          for (const u of [0.25, 0.5, 0.75]) { const e = [a[0] + (b[0] - a[0]) * u + n[0] * 0.8, a[1] + (b[1] - a[1]) * u + n[1] * 0.8];
            const dx = pr.center[0] - e[0], dy = pr.center[1] - e[1], dh = Math.hypot(dx, dy); if ((n[0] * dx + n[1] * dy) / dh < 0.35) continue;
            const d3 = [dx, dy, tgtZ - zEye], L3 = Math.hypot(...d3); const dir3 = d3.map(v => v / L3);
            let hit = Infinity; for (const q of near) { const t = G.rayPrism([e[0], e[1], zEye], dir3[2] > 0 ? dir3 : [dir3[0], dir3[1], 1e-6], q.ring, q.base - 0.5, q.base + q.height, q.bb); if (t >= 0 && t < hit && t < dh) hit = t; }
            const score = isFinite(hit) ? hit : 1e4 - Math.abs(dh - 35); /* לא חסום, ובמרחק שבו רואים את הבניין כולו (~35 מ') */ if (score > bestScore) { bestScore = score; mid = e; best = { a, b, n, sc: 0 }; } } }
      }
      const floorZ = o.building === 'proposal' && pr.kind === 'massing' ? (pr.massing.floors[Math.min(o.floor, pr.massing.floors.length) - 1] || {}).z0 || 0 : (o.floor - 1) * fh;
      const eye = [mid[0], mid[1], base + floorZ + 1.5];
      let dir = o.building === 'proposal' ? [best.n[0], best.n[1]] : [pr.center[0] - eye[0], pr.center[1] - eye[1]];
      { // מבט מחלון: לא יותר מ-45° מהניצב לחזית (אחרת רואים בעיקר את הקיר של הבניין עצמו)
        const a = Math.atan2(dir[1], dir[0]), an = Math.atan2(best.n[1], best.n[0]); let d = a - an; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const lim = 45 * G.D2R, b = an + Math.max(-lim, Math.min(lim, d)); dir = [Math.cos(b), Math.sin(b)]; }
      const dl = Math.hypot(dir[0], dir[1]); const tgt = [eye[0] + dir[0] / dl * 50, eye[1] + dir[1] / dl * 50, eye[2] + (o.building === 'proposal' ? -2 : 6)];
      const out = { eye, target: tgt, facingAz: (Math.atan2(dir[0], dir[1]) * G.R2D + 360) % 360 };
      if (o.building !== 'proposal' && pr) {                       // מספרים לחלון של שכן
        let dmin = Infinity; const fp = pr.kind === 'massing' ? pr.massing.footprint : pr.hull;
        for (let i = 0; i < fp.length; i++) { const a = fp[i], b = fp[(i + 1) % fp.length], ex = b[0] - a[0], ey = b[1] - a[1], t = Math.max(0, Math.min(1, ((eye[0] - a[0]) * ex + (eye[1] - a[1]) * ey) / (ex * ex + ey * ey)));
          dmin = Math.min(dmin, Math.hypot(a[0] + ex * t - eye[0], a[1] + ey * t - eye[1])); }
        out.distance = +dmin.toFixed(1); out.topAngleDeg = +(Math.atan2(pr.baseZ + pr.height - eye[2], dmin) * G.R2D).toFixed(1);
        const exb = site; let dEx = Infinity; for (let i = 0; i < exb.ring.length; i++) { const a = exb.ring[i], b = exb.ring[(i + 1) % exb.ring.length], ex = b[0] - a[0], ey = b[1] - a[1], t = Math.max(0, Math.min(1, ((eye[0] - a[0]) * ex + (eye[1] - a[1]) * ey) / (ex * ex + ey * ey))); dEx = Math.min(dEx, Math.hypot(a[0] + ex * t - eye[0], a[1] + ey * t - eye[1])); }
        out.existingTopAngleDeg = +(Math.atan2(exb.base + exb.height - eye[2], dEx) * G.R2D).toFixed(1);
      }
      return out;
    }

    // ---- מצלמה: שליטת מסלול + אנימציות
    const ctl = { target: new T.Vector3(), r: 300, az: 200 * G.D2R, pitch: 35 * G.D2R, enabled: true, minR: 8, maxR: 3000 };
    function applyOrbit() { invalidate(); const cp = Math.cos(ctl.pitch); camera.position.set(ctl.target.x + ctl.r * cp * Math.sin(ctl.az), ctl.target.y + ctl.r * Math.sin(ctl.pitch), ctl.target.z + ctl.r * cp * Math.cos(ctl.az)); camera.lookAt(ctl.target); tuneNear(); }
    function syncOrbitFromCamera(target) { ctl.target.copy(target); const d = camera.position.clone().sub(target); ctl.r = Math.max(ctl.minR, d.length()); ctl.pitch = Math.asin(Math.max(-0.99, Math.min(0.99, d.y / ctl.r))); ctl.az = Math.atan2(d.x, d.z); }
    function tuneNear() { const d = camera.position.distanceTo(ctl.target); camera.near = Math.max(0.3, Math.min(5, d / 300)); camera.far = Math.max(6000, d * 10); camera.updateProjectionMatrix(); }
    let anim = null;
    const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    /** תנועת מצלמה: {to:{pos:[x,y,z] מקומי, target:[x,y,z]}, dur} | {orbit:{target, r, az0, az1, pitch}, dur} | {path:{pts:[[x,y,z]..], look:[x,y,z]}, dur} */
    function animate(spec) {
      return new Promise(res => {
        const dur = (spec.dur || 2) * 1000, t0 = performance.now();
        const fromPos = camera.position.clone(), fromTgt = ctl.target.clone();
        anim = { spec, done: res, step(now) {
          const u = Math.min(1, (now - t0) / dur);
          if (spec.to) { const e = ease(u); const tp = S(...spec.to.pos), tt = S(...spec.to.target);
            camera.position.lerpVectors(fromPos, tp, e); ctl.target.lerpVectors(fromTgt, tt, e); camera.lookAt(ctl.target); }
          else if (spec.orbit) { const o = spec.orbit, tg = S(...o.target); const e = u; const az = (o.az0 + (o.az1 - o.az0) * e) * G.D2R, cp = Math.cos(o.pitch * G.D2R);
            if (u === 0 || !this.started) { this.started = true; }
            ctl.target.copy(tg); camera.position.set(tg.x + o.r * cp * Math.sin(az), tg.y + o.r * Math.sin(o.pitch * G.D2R), tg.z + o.r * cp * Math.cos(az)); camera.lookAt(tg); }
          else if (spec.path) { const pts = spec.path.pts, n = pts.length - 1, f = ease(u) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
            const a = pts[i], b = pts[i + 1]; const p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
            camera.position.copy(S(...p)); ctl.target.copy(S(...spec.path.look)); camera.lookAt(ctl.target); }
          if (spec.onStep) spec.onStep(u);
          tuneNear();
          if (u >= 1) { anim = null; syncOrbitFromCamera(ctl.target.clone()); res(true); }
        } };
      });
    }
    function stopAnim() { if (anim) { const a = anim; anim = null; syncOrbitFromCamera(ctl.target.clone()); a.done(false); } }
    P.ctl = ctl;

    // קלט: גרירה=סיבוב, צביטה=זום, שתי אצבעות/לחצן ימני=הזזה, הקשה=בחירה
    const ptrs = new Map(); let lastPinch = null, moved = 0, downAt = 0;
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button }); moved = 0; downAt = performance.now(); lastPinch = null; emit('interact'); if (anim) stopAnim(); });
    canvas.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p || !ctl.enabled) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (ptrs.size === 1 && p.b !== 2) { ctl.az -= dx * 0.006; ctl.pitch = Math.max(0.03, Math.min(1.5, ctl.pitch + dy * 0.005)); }
      else if (ptrs.size === 1 && p.b === 2) pan(dx, dy);
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (lastPinch) { ctl.r = Math.max(ctl.minR, Math.min(ctl.maxR, ctl.r * lastPinch / d)); pan(dx / 2, dy / 2); } lastPinch = d; }
      applyOrbit();
    });
    const up = e => { const was = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); if (ptrs.size < 2) lastPinch = null; if (was && moved < 8 && performance.now() - downAt < 400) pick(e.clientX, e.clientY); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); if (anim) stopAnim(); emit('interact'); ctl.r = Math.max(ctl.minR, Math.min(ctl.maxR, ctl.r * Math.exp(e.deltaY * 0.0012))); applyOrbit(); }, { passive: false });
    function pan(dx, dy) { const k = ctl.r * 0.0016; const fw = new T.Vector3(Math.sin(ctl.az), 0, Math.cos(ctl.az)), rt = new T.Vector3(fw.z, 0, -fw.x); ctl.target.addScaledVector(rt, -dx * k).addScaledVector(fw, -dy * k); }
    const ndc = new T.Vector2();
    function pick(cx, cy) {
      const r = canvas.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); raycaster.setFromCamera(ndc, camera);
      const objs = [...city.meshes]; if (proposalGroup.visible) objs.push(proposalGroup); if (existingGroup.visible) objs.push(existingGroup);
      const hit = raycaster.intersectObjects(objs, true)[0];
      if (!hit) { select(null); return; }
      let id = null; const ci = city.meshes.indexOf(hit.object); if (ci >= 0) id = city.owners[ci][hit.faceIndex]; else { let o = hit.object; while (o && o !== proposalGroup && o !== existingGroup) o = o.parent; id = o === proposalGroup ? 'proposal' : P.state.site; }
      select(id);
    }
    // הדגשה
    const selGroup = new T.Group(); scene.add(selGroup); P.selected = null;
    function select(id) {
      invalidate(); selGroup.clear(); P.selected = id;
      if (id && id !== 'proposal') { const b = world.byId.get(id); if (b) { const r = prismGeometry([Object.assign({}, b, { ring: G.insetPolygon(b.ring, -0.25) || b.ring, height: b.height + 0.25 })], () => [1, 0.75, 0.3], 1e9);
        const m = new T.Mesh(r.g, new T.MeshBasicMaterial({ color: 0xf2b84b, transparent: true, opacity: 0.28, depthWrite: false })); selGroup.add(m);
        selGroup.add(new T.LineSegments(r.eg, new T.LineBasicMaterial({ color: 0xe09a1a }))); } }
      emit('select', id ? (id === 'proposal' ? { id, proposal: P.state.proposal } : world.byId.get(id)) : null);
    }

    // ---- תוויות HTML מעל הסצנה
    const labels = new Map(); const labelLayer = opts.labelLayer || null;
    function setLabel(key, pos, html) {
      if (!labelLayer) return; let L1 = labels.get(key);
      if (!html) { if (L1) { L1.el.remove(); labels.delete(key); } return; }
      if (!L1) { const el = document.createElement('div'); el.className = 'p-label'; labelLayer.appendChild(el); L1 = { el }; labels.set(key, L1); }
      L1.el.innerHTML = html; L1.pos = S(...pos); invalidate();
    }
    const tmpV = new T.Vector3();
    function updateLabels(w, h, clipFrom, clipTo) {
      for (const [k, l] of labels) { tmpV.copy(l.pos).project(camera); const x = (tmpV.x + 1) / 2 * w, y = (1 - tmpV.y) / 2 * h;
        const vis = !(k === 'prop' && P.state.view === 'before') && tmpV.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20 && !(clipFrom !== undefined && (x < clipFrom || x > clipTo));
        l.el.style.display = vis ? '' : 'none'; if (vis) l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`; }
    }

    // ---- תצוגה: לפני / אחרי / החלקה
    function setView(v, sw) { if (v) P.state.view = v; if (sw !== undefined) P.state.swipe = Math.max(0, Math.min(1, sw)); emit('view', P.state); }
    function pass(which) { const after = which === 'after'; proposalGroup.visible = after; ghost.visible = after; fanGroup.visible = after && P.state.fan; existingGroup.visible = !after; }
    let W = 1, H = 1; const insets = { bottom: 0, right: 0 };
    /** שוליים שמכוסים בממשק (פיקסלים): מרכז ההיטל זז כך שמה שבמרכז הסצנה נשאר גלוי מעל הלוח/לידו */
    function setInsets(o) { insets.bottom = Math.max(0, o.bottom || 0); insets.right = Math.max(0, o.right || 0); applyOffset(); }
    function applyOffset() { if (!insets.bottom && !insets.right) camera.clearViewOffset(); else camera.setViewOffset(W, H, insets.right / 2, insets.bottom / 2, W, H); camera.updateProjectionMatrix(); }
    function resize() { invalidate(); const r = canvas.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height); renderer.setSize(W, H, false); camera.aspect = W / H; applyOffset(); }
    window.addEventListener('resize', resize); resize();
    let frames = 0, fpsT = performance.now(); P.fps = 0;
    function frame(now) {
      if (anim) { anim.step(now); invalidate(); }
      if (dirty <= 0) { emit('frame', now); requestAnimationFrame(frame); return; }
      dirty--;
      const v = P.state.view;
      if (v === 'swipe') {
        // החלקה: שמאל = אחרי, ימין = לפני (עברית: קוראים מימין – קודם המצב הקיים)
        const x = Math.round(W * P.state.swipe);
        renderer.setScissorTest(true);
        pass('after'); renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, x, H); renderer.render(scene, camera);
        pass('before'); renderer.setScissor(x, 0, W - x, H); renderer.render(scene, camera);
        renderer.setScissorTest(false); pass('after');
        updateLabels(W, H, 0, x);
      } else { pass(v); renderer.setViewport(0, 0, W, H); renderer.render(scene, camera); updateLabels(W, H); }
      frames++; if (now - fpsT > 1000) { P.fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
      emit('frame', now);
      requestAnimationFrame(frame);
    }

    // ---- התחלה
    Object.assign(P, { setFov: f => { camera.fov = f; camera.updateProjectionMatrix(); invalidate(); }, invalidate, isAnimating: () => !!anim, setInsets, setSite, setProposal, setView, setSun, sunAt, setFan, setHeat, analyzeShadows, metrics, windowView, animate, stopAnim, applyOrbit, syncOrbitFromCamera, select, setLabel, resize, proposalShadowPolys,
      groups: { proposal: proposalGroup, existing: existingGroup, fan: fanGroup, ghost, sel: selGroup }, getCity: () => city });
    if (opts.siteId) await setSite(opts.siteId);
    const s0 = world.byId.get(P.state.site) || { cx: 0, cy: 0, base: 0 };
    ctl.target.copy(S(s0.cx, s0.cy, s0.base + 10)); applyOrbit(); setSun(P.state.date, P.state.hour);
    requestAnimationFrame(frame);
    return P;
  }
  root.ESHPresent = { createPresenter };
})(typeof self !== 'undefined' ? self : this);
