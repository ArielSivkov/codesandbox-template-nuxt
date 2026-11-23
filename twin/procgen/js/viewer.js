/* צופה הנתונים – עולם תאום ESH27 (רובע א', אשדוד). three.js r186 (window.THREE), בלי מודולים חיצוניים.
 * כלל הצוות האדום: כל טקסט מהנתונים נכנס רק דרך textContent (אין innerHTML עם נתונים); אין טעינת נתונים לפי פרמטר בכתובת;
 * כל הנתיבים קבועים ובאותו מקור. כל ערך מוצג עם תווית נצפה / נגזר / משוער. */
(function () {
  'use strict';
  const T = window.THREE, PG = window.ESH_PROCGEN;
  const CFG = { tiles: '../b6/map/data/tiles/v/', assets: '../assets/pack/', data: 'data/', thumbs: 'thumbs/',
    keys: ['163_633', '163_634', '164_633', '164_634', '164_635', '165_633', '165_634', '165_635'], O: [164720, 634120] };
  const $ = id => document.getElementById(id);
  const el = (tag, txt, cls) => { const e = document.createElement(tag); if (txt != null) e.textContent = String(txt); if (cls) e.className = cls; return e; };
  const toV = (x, y, z = 0) => new T.Vector3(x - CFG.O[0], z, -(y - CFG.O[1]));
  const PROVCLS = { 'נצפה': 't-obs', 'ודאי': 't-obs', 'נגזר': 't-der', 'משוער': 't-est', 'נגזר מסגנון השכונה': 't-gen' };
  const tag = p => el('span', p, 'tag ' + (PROVCLS[p] || 't-est'));
  const KIND_HE = { lamp_curved_led: 'פנס LED, עמוד מעוקל', lamp_led_white: 'פנס LED, עמוד ישר', lamp_ornate_red_double: 'עמוד תאורה אדום מעוטר, ראש כפול', tree_ficus: 'פיקוס', tree_young: 'עץ רחוב צעיר', palm_date: 'דקל תמר',
    fence: 'גדר / מעקה', street_sign: 'שלט שם רחוב', curb_paint: 'שפה אדום-לבן', crosswalk: 'מעבר חצייה', tactile: 'אריחים מישושיים', ac_unit: 'מזגן', balcony: 'מרפסת', shopfront: 'חזית חנות', shop_sign: 'שלט חנות מואר' };
  const FENCE_COL = { rail_white_metal: 0xe8ecef, fence_white_picket: 0xf4f1e8, wall_stone_clad: 0xd8c8a8, fence_dark_slats: 0x3a3d42, fence_metal_bars: 0xd0d4d8, rail_red_median: 0xb3262b, fence_blue_rail: 0x2f6db5, rail_grey_metal: 0x8c939b };
  const FENCE_H = { rail_white_metal: 1.1, fence_white_picket: 1.2, wall_stone_clad: 1.5, fence_dark_slats: 1.8, fence_metal_bars: 1.3, rail_red_median: 1.0, fence_blue_rail: 0.6, rail_grey_metal: 1.0 };
  const SHOP_COL = [0xffd24a, 0x4fd1ff, 0xff6b6b, 0x8cff7a, 0xffffff, 0xff9a3c];

  // ---------- רנדרר ----------
  const canvas = $('cv');
  const R = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  R.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  R.outputColorSpace = T.SRGBColorSpace; R.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  const hemi = new T.HemisphereLight(0xbfd4ff, 0x404030, 0.9); scene.add(hemi);
  const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(-300, 400, 200); scene.add(sun);
  const persp = new T.PerspectiveCamera(55, 1, 1, 6000), ortho = new T.OrthographicCamera(-1, 1, 1, -1, -100, 3000);
  const ctl = { tx: 0, tz: 0, dist: 300, yaw: -0.9, pitch: 0.5, mode3d: true, zoom2d: 1.6 };
  let night = true, truth = false, dirty = true;
  const G = {};   // קבוצות שכבה
  ['bld', 'roads', 'photos', 'route', 'disc', 'ghost', 'gen', 'facade', 'pools'].forEach(k => { G[k] = new T.Group(); scene.add(G[k]); });

  function setNight(on) {
    night = on; $('bNight').setAttribute('aria-pressed', String(on)); $('bNight').textContent = on ? 'לילה' : 'יום';
    scene.background = new T.Color(on ? 0x0d1730 : 0xb8d4ee); scene.fog = new T.Fog(scene.background, 900, 2600);
    hemi.intensity = on ? 0.55 : 0.95; sun.intensity = on ? 0.25 : 1.7; sun.color.set(on ? 0x8fa8ff : 0xffffff);
    U.uNight.value = on ? 1 : 0; G.pools.visible = on && $('lGen').checked; for (const m of emissiveMats) m.emissiveIntensity = on ? 1.6 : 0.15;
    dirty = true;
  }
  const emissiveMats = [];
  const mat = (c, o = {}) => { const m = new T.MeshLambertMaterial(Object.assign({ color: c }, o)); if (o.emissive) emissiveMats.push(m); return m; };
  const vmat = new T.MeshLambertMaterial({ vertexColors: true });

  // ---------- גאומטריות פשוטות (ממוזגות, צבע לכל קודקוד) ----------
  function merged(parts) {   // parts: [geometry, color, matrix]
    const pos = [], col = [], nor = []; const c = new T.Color();
    for (const [g0, hex, m] of parts) { const g = g0.index ? g0.toNonIndexed() : g0; g.applyMatrix4(m); g.computeVertexNormals(); c.set(hex);
      const p = g.attributes.position.array, n = g.attributes.normal.array; for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); col.push(c.r, c.g, c.b); } }
    const out = new T.BufferGeometry(); out.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); out.setAttribute('color', new T.Float32BufferAttribute(col, 3)); return out;
  }
  const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
  const cyl = (r1, r2, h, s = 6) => new T.CylinderGeometry(r1, r2, h, s);
  const box = (a, b, c) => new T.BoxGeometry(a, b, c);
  const GEO = {
    // עמוד מעוקל (011/015): עמוד אפור-לבן, קשת, ראש LED שטוח
    lamp_curved_led: merged([[cyl(0.07, 0.11, 7.2), 0xc9ced4, M4(0, 3.6, 0)], [cyl(0.06, 0.06, 1.4), 0xc9ced4, M4(-0.45, 7.45, 0, 0, 0, 0.9)], [cyl(0.05, 0.05, 0.9), 0xc9ced4, M4(-1.25, 7.85, 0, 0, 0, 1.45)],
      [box(0.75, 0.1, 0.32), 0xf4f8ff, M4(-1.8, 7.85, 0)]]),
    lamp_led_white: merged([[cyl(0.08, 0.12, 7), 0x8e959d, M4(0, 3.5, 0)], [box(1.2, 0.08, 0.08), 0x8e959d, M4(-0.6, 6.95, 0)], [box(0.6, 0.12, 0.3), 0xf4f8ff, M4(-1.15, 6.9, 0)]]),
    // עמוד אדום מעוטר עם שני ראשים (018/019/034/035)
    lamp_ornate_red_double: merged([[cyl(0.16, 0.22, 1.0, 8), 0xa3202a, M4(0, 0.5, 0)], [cyl(0.08, 0.11, 7.6, 8), 0xb3262b, M4(0, 4.6, 0)], [box(2.2, 0.08, 0.08), 0xb3262b, M4(0, 8.2, 0)],
      [cyl(0.32, 0.18, 0.35, 8), 0xfff4e0, M4(-1.05, 8.05, 0)], [cyl(0.32, 0.18, 0.35, 8), 0xfff4e0, M4(1.05, 8.05, 0)], [cyl(0.05, 0.05, 0.5), 0xb3262b, M4(0, 8.5, 0)]]),
    tree_ficus: merged([[cyl(0.25, 0.4, 3.2), 0x6b5a48, M4(0, 1.6, 0)], [new T.IcosahedronGeometry(3.2, 1), 0x2f5a2c, M4(0, 5.2, 0, 0, 0, 0, 1.25, 0.8, 1.25)]]),
    tree_young: merged([[cyl(0.08, 0.12, 2.4), 0x6b5a48, M4(0, 1.2, 0)], [new T.IcosahedronGeometry(1.4, 0), 0x4c7a3a, M4(0, 3.4, 0)]]),
    palm_date: merged([[cyl(0.22, 0.3, 6.5, 7), 0x7a6a50, M4(0, 3.25, 0)], [new T.ConeGeometry(3.2, 1.6, 9, 1, true), 0x5c7d3a, M4(0, 6.7, 0, Math.PI, 0, 0)], [new T.SphereGeometry(0.6, 6, 4), 0x8a6a30, M4(0, 6.4, 0)]]),
    fence: new T.BoxGeometry(1, 1, 0.08).translate(0, 0.5, 0),
    // שלט רחוב (015): עמוד לבן מעוטר + לוח; צבע הלוח לפי סגנון (כחול חדש / לבן ישן) – instanceColor
    street_sign: merged([[cyl(0.045, 0.06, 2.9), 0xf2f2f2, M4(0, 1.45, 0)], [new T.SphereGeometry(0.07, 6, 4), 0xf2f2f2, M4(0, 2.95, 0)], [box(0.82, 0.32, 0.03), 0xffffff, M4(0.45, 2.55, 0)], [box(0.74, 0.25, 0.035), 0xdddddd, M4(0.45, 2.55, 0)]]),
    curb_paint: new T.BoxGeometry(1.5, 0.16, 0.18).translate(0, 0.08, 0),
    crosswalk: new T.BoxGeometry(3.0, 0.03, 0.5).translate(0, 0.02, 0),
    tactile: new T.BoxGeometry(0.6, 0.04, 1.2).translate(0, 0.03, 0),
    ac_unit: merged([[box(0.8, 0.55, 0.3), 0xe9e9e6, M4(0, 0, 0)], [box(0.36, 0.36, 0.02), 0x55595e, M4(0.12, 0, 0.16)]]),
    balcony: merged([[box(3.0, 0.15, 1.4), 0xd9d5cc, M4(0, 0, 0)], [box(3.0, 1.0, 0.05), 0x9aa3ad, M4(0, 0.55, 0.68)]]),
    shopfront: new T.BoxGeometry(1, 2.6, 0.06).translate(0, 1.4, 0),
    shop_sign: new T.BoxGeometry(1, 0.6, 0.12).translate(0, 3.2, 0),
  };
  const KMAT = {};
  for (const k of PG.KINDS) KMAT[k] = vmat;
  KMAT.fence = mat(0xffffff); KMAT.curb_paint = mat(0xffffff); KMAT.crosswalk = mat(0xf2f2f2); KMAT.tactile = mat(0xd8c070);
  KMAT.shopfront = mat(0x9fc7e0, { emissive: 0x3d6f8f, emissiveIntensity: 1.6 }); KMAT.shop_sign = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.6 });
  KMAT.street_sign = new T.MeshLambertMaterial({ vertexColors: true });
  const lampHeadMat = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.6 });

  // ---------- טעינה ----------
  async function getJSON(path) { const r = await fetch(path, { credentials: 'same-origin' }); if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); }
  async function getTile(key) {
    if (!/^\d{3}_\d{3}$/.test(key)) throw new Error('bad key');
    const r = await fetch(CFG.tiles + key + '.json.gz'); if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    if (b[0] === 0x1f && b[1] === 0x8b) { const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip')); return JSON.parse(await new Response(s).text()); }
    return JSON.parse(new TextDecoder().decode(b));
  }
  const decode = r => { const a = []; let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; a.push(x / 10, y / 10); } return a; };

  const DATA = { obs: null, rules: null, disc: null, route: null, tiles: [], gen: [], blds: [], roads: [] };
  const STATS = { genMs: 0, genN: 0 };

  // ---------- בניינים: גאומטריה אחת לכל האריחים (קריאת ציור אחת) ----------
  const discByBld = {};
  function bldColor(id) { const d = discByBld[id]; if (!d) return 0x7d8796; return d.severity === 'התאמה' ? 0x3fbf7f : 0xff6b6b; }
  function buildBuildings() {
    const pos = [], col = [], idx = [], owner = []; const c = new T.Color();
    for (const t of DATA.tiles) {
      const ox = t.o[0], oy = t.o[1];
      for (const b of t.b) {
        if (!b.r || !b.r[0]) continue;
        const ring = decode(b.r[0]); const n = ring.length / 2; if (n < 3) continue;
        const h = Math.max(2, b.h / 10), bi = DATA.blds.length; DATA.blds.push({ i: b.i, h, f: b.f, t: b.t, n: b.n, src: b.src });
        c.set(truth ? 0xffb547 : bldColor(b.i));
        const base = pos.length / 3; const pts2 = [];
        for (let i = 0; i < n; i++) { const v = toV(ox + ring[2 * i], oy + ring[2 * i + 1]); pts2.push(new T.Vector2(v.x, v.z)); }
        for (let i = 0; i < n; i++) { const a = pts2[i], b2 = pts2[(i + 1) % n], s = pos.length / 3;   // קירות
          pos.push(a.x, 0, a.y, b2.x, 0, b2.y, b2.x, h, b2.y, a.x, h, a.y); const k = 0.82 + 0.18 * Math.abs(Math.sin(Math.atan2(b2.y - a.y, b2.x - a.x)));
          for (let q = 0; q < 4; q++) { col.push(c.r * k, c.g * k, c.b * k); owner.push(bi); } idx.push(s, s + 1, s + 2, s, s + 2, s + 3, s, s + 2, s + 1, s, s + 3, s + 2); }
        const tri = T.ShapeUtils.triangulateShape(pts2, []); const rs = pos.length / 3;   // גג
        for (const p of pts2) { pos.push(p.x, h, p.y); col.push(c.r * 1.1, c.g * 1.1, c.b * 1.1); owner.push(bi); }
        for (const tr of tri) idx.push(rs + tr[0], rs + tr[2], rs + tr[1], rs + tr[0], rs + tr[1], rs + tr[2]);
      }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    G.bld.clear(); const m = new T.Mesh(g, bldMat()); m.userData.owner = owner; G.bld.add(m);
  }

  // חלונות פרוצדורליים בשיידר (בלי גאומטריה נוספת): רשת קומה 3 מ' × 2.6 מ', חלק מהחלונות דולקים בלילה (חם/קר) – אפקט, מסומן "נוצר"
  const U = { uNight: { value: 1 } };
  function bldMat() {
    const m = new T.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = sh => { sh.uniforms.uNight = U.uNight;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uNight;\nfloat h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (abs(vWN.y) < 0.3 && vWP.y > 3.2) {
            float along = abs(vWN.x) > abs(vWN.z) ? vWP.z : vWP.x;
            vec2 cell = vec2(floor(along / 2.6), floor(vWP.y / 3.0));
            vec2 f = vec2(fract(along / 2.6), fract(vWP.y / 3.0));
            float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.8);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, win);
            float lit = step(0.62, h21(cell + floor(vWP.xz / 40.0))) * win * uNight;
            vec3 wc = mix(vec3(1.0, 0.78, 0.45), vec3(0.75, 0.85, 1.0), step(0.8, h21(cell * 1.7)));
            totalEmissiveRadiance += wc * lit * 0.9;
          }`); };
    return m;
  }
  function buildRoads() {
    const pos = [], col = []; const c = new T.Color();
    for (const t of DATA.tiles) for (const r of t.rd) {
      const p = decode(r.r); c.set(r.c >= 3 ? 0xe8d38a : r.c === 2 ? 0xb9c4d6 : 0x6f7a8c);
      for (let i = 0; i + 3 < p.length; i += 2) { const a = toV(t.o[0] + p[i], t.o[1] + p[i + 1], 0.15), b = toV(t.o[0] + p[i + 2], t.o[1] + p[i + 3], 0.15); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
      DATA.roads.push({ n: r.n, c: r.c, tile: t.k, p: p.map((v, i) => v + t.o[i % 2]) });
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    G.roads.add(new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true })));
    // משטח קרקע
    const gr = new T.Mesh(new T.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new T.MeshLambertMaterial({ color: 0x2a2f36 })); gr.position.y = -0.05; gr.userData.ground = true; scene.add(gr); DATA.ground = gr;
  }

  // ---------- עולם נוצר: InstancedMesh לכל סוג (כל האריחים יחד) ----------
  const INST = {}; let glbOn = true; const GLB = {};
  function genAll() {
    const t0 = performance.now(); DATA.gen = [];
    for (const t of DATA.tiles) { const r = PG.generateTile(t, DATA.rules); DATA.gen.push(r); }
    STATS.genMs = Math.round(performance.now() - t0); STATS.genN = DATA.gen.reduce((a, r) => a + r.total, 0);
    buildInstances();
  }
  const FACADE = new Set(['ac_unit', 'balcony', 'shopfront', 'shop_sign']);
  function buildInstances() {
    for (const k in INST) for (const m of INST[k]) m.parent && m.parent.remove(m);
    G.pools.clear();
    const mtx = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), col = new T.Color(), up = new T.Vector3(0, 1, 0);
    const poolPts = [];
    for (const k of PG.KINDS) {
      let n = 0; for (const r of DATA.gen) n += r.kinds[k].n; INST[k] = []; if (!n) continue;
      const parts = (glbOn && GLB[k]) ? GLB[k] : [{ geo: GEO[k], mat: KMAT[k], m: null }];
      const meshes = parts.map(pt => { const im = new T.InstancedMesh(pt.geo, truth ? new T.MeshLambertMaterial({ color: 0xd65cff }) : pt.mat, n); im.userData = { kind: k, base: pt.m }; im.frustumCulled = false; return im; });
      let i = 0; const ref = [];
      for (const r of DATA.gen) {
        const d = r.kinds[k].data;
        for (let j = 0; j < d.length; j += 6) {
          const wx = r.origin[0] + d[j], wy = r.origin[1] + d[j + 1];
          let y = 0, sx = 1, sy = 1, sz = 1;
          if (k === 'fence') { const fk = PG.FENCE_KINDS[d[j + 5]] || 'rail_white_metal'; sx = d[j + 3]; sy = FENCE_H[fk]; }
          else if (k === 'curb_paint' || k === 'shopfront' || k === 'shop_sign') sx = d[j + 3];
          else if (k === 'ac_unit' || k === 'balcony') y = d[j + 5];
          else if (k === 'crosswalk') sx = 1;
          else { sx = sy = sz = d[j + 3]; }
          p.copy(toV(wx, wy, y)); q.setFromAxisAngle(up, d[j + 2]); s.set(sx, sy, sz); mtx.compose(p, q, s);
          for (const im of meshes) { const mm = im.userData.base ? mtx.clone().multiply(im.userData.base) : mtx; im.setMatrixAt(i, mm);
            if (k === 'fence') im.setColorAt(i, col.set(FENCE_COL[PG.FENCE_KINDS[d[j + 5]]] || 0xdddddd));
            else if (k === 'curb_paint') im.setColorAt(i, col.set(d[j + 5] ? 0xffffff : 0xc62828));
            else if (k === 'shop_sign') im.setColorAt(i, col.set(SHOP_COL[d[j + 5]] || 0xffffff));
            else if (k === 'street_sign') im.setColorAt(i, col.set(d[j + 5] ? 0xf4f4f0 : 0x2a62c9)); }
          ref.push(r, j);
          if (k.startsWith('lamp')) poolPts.push(wx, wy, k === 'lamp_ornate_red_double' ? 1 : 0);
          i++;
        }
      }
      const xz = new Float32Array(n * 2); for (let q = 0; q < n; q++) { xz[2 * q] = meshes[0].instanceMatrix.array[16 * q + 12]; xz[2 * q + 1] = meshes[0].instanceMatrix.array[16 * q + 14]; }
      for (const im of meshes) { im.userData.fullM = im.instanceMatrix.array.slice(); im.userData.fullC = im.instanceColor ? im.instanceColor.array.slice() : null; im.userData.xz = xz;
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; (FACADE.has(k) ? G.facade : G.gen).add(im); }
      INST[k] = meshes; INST[k].ref = ref; INST[k].vis = new Uint8Array(n).fill(1);
    }
    cull(true);
    // "בריכות אור" מתחת לפנסים בלילה: עיגול חיבורי אחד (קריאת ציור אחת) – אפקט, לא אור דינמי (תקציב מובייל)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'); const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const pm = new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: 0xffffff });
    const np = poolPts.length / 3; if (np) { const pool = new T.InstancedMesh(new T.PlaneGeometry(18, 18).rotateX(-Math.PI / 2), pm, np);
      for (let i = 0; i < np; i++) { mtx.makeTranslation(toV(poolPts[3 * i], poolPts[3 * i + 1], 0.2)); pool.setMatrixAt(i, mtx); pool.setColorAt(i, col.set(poolPts[3 * i + 2] ? 0xffd9a8 : 0xcfe0ff)); }
      pool.frustumCulled = false; G.pools.add(pool); }
    dirty = true;
  }

  window.__triBudget = () => { const o = {}; for (const k in INST) { let t = 0, n = 0; for (const im of INST[k]) { const g = im.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; n = im.count; } o[k] = { n, tris_each: Math.round(t), total: Math.round(t * n) }; } o.buildings = Math.round(G.bld.children[0].geometry.index.count / 3); return o; };
  // חיתוך לפי מרחק (תקציב מובייל ≤250 אלף משולשים): מעתיקים את המופעים הקרובים לראש המערך ומקטינים count. רץ רק כשהמצלמה נעצרת.
  const RAD = { facade: 300, small: 350, base: 600 };
  function cull(force) {
    const tc = performance.now();
    const R0 = ctl.mode3d ? Math.min(RAD.base, Math.max(150, ctl.dist * 0.8)) : Math.min(RAD.base, 300 / ctl.zoom2d * 1.6);
    const cx = ctl.tx, cz = ctl.tz;
    for (const k in INST) { const ms = INST[k]; if (!ms.length) continue;
      const R = FACADE.has(k) ? Math.min(R0, RAD.facade) : (k === 'fence' || k === 'curb_paint' || k === 'crosswalk' || k === 'tactile') ? Math.min(R0, RAD.small) : R0, R2 = R * R;
      const xz = ms[0].userData.xz, n = xz.length / 2, vis = ms.vis; let c = 0;
      for (let i = 0; i < n; i++) { const dx = xz[2 * i] - cx, dz = xz[2 * i + 1] - cz; vis[i] = dx * dx + dz * dz < R2 ? 1 : 0; }
      for (const im of ms) { const M = im.instanceMatrix.array, F = im.userData.fullM, C = im.instanceColor && im.instanceColor.array, FC = im.userData.fullC; c = 0;
        for (let i = 0; i < n; i++) if (vis[i]) { M.set(F.subarray(16 * i, 16 * i + 16), 16 * c); if (C) C.set(FC.subarray(3 * i, 3 * i + 3), 3 * c); c++; }
        im.count = c; im.instanceMatrix.needsUpdate = true; if (C) im.instanceColor.needsUpdate = true; } }
    if (window.__perf) window.__perf.cullMs = Math.round((performance.now() - tc) * 10) / 10;
    dirty = true;
  }
  let cullT = 0, lastCull = ''; function scheduleCull() { clearTimeout(cullT); cullT = setTimeout(() => { const key = [Math.round(ctl.tx / 40), Math.round(ctl.tz / 40), Math.round(Math.log(ctl.dist) * 6), Math.round(Math.log(ctl.zoom2d) * 6), ctl.mode3d].join(); if (key !== lastCull) { lastCull = key; cull(); } }, 150); }
  async function loadGLBs() {
    try {
      await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = CFG.assets + 'vendor/esh-assets-loaders.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
      const A = window.ESH_ASSETS; const L = new A.GLTFLoader().setMeshoptDecoder(A.MeshoptDecoder);
      const MAP = { lamp_led_white: ['street_light.glb', 7.5], tree_ficus: ['tree_ficus.glb', 7.5], tree_young: ['tree_olive.glb', 4.2], palm_date: ['palm_date.glb', 7.5] };   // מזגן נשאר קופסה פשוטה: 252 משולשים × עשרות אלפים = מיליוני משולשים (נמדד: 7.4M) – מעל התקציב
      for (const k in MAP) {
        const gl = await L.loadAsync(CFG.assets + 'models/' + MAP[k][0]); gl.scene.updateMatrixWorld(true);
        const bb = new T.Box3().setFromObject(gl.scene), H = bb.max.y - bb.min.y, sc = MAP[k][1] / H, parts = [];
        const norm = new T.Matrix4().makeScale(sc, sc, sc).multiply(new T.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, k === 'ac_unit' ? -(bb.min.y + bb.max.y) / 2 : -bb.min.y, -(bb.min.z + bb.max.z) / 2));
        gl.scene.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, m: norm.clone().multiply(o.matrixWorld) }); });
        GLB[k] = parts;
      }
      STATS.glb = Object.keys(GLB).length;
      if (glbOn) buildInstances();
    } catch (e) { STATS.glb = 'נכשל: ' + e.message; }
  }

  // ---------- תצפיות: נקודות, קונוסים, אי-ודאות ----------
  const PICK = [];   // {v: Vector3, type, data}
  // קונוסים וטבעות ממוזגים: קריאת ציור אחת לכל שכבה
  const CB = new Map();
  function cone(group, x, y, head, fov, len, color, op) {
    if (!CB.has(group)) CB.set(group, { tri: [], tc: [], ln: [], lc: [] }); const B = CB.get(group), c = new T.Color(color).multiplyScalar(op * 1.1);
    const a = toV(x, y, 1.5), n = 10; let prev = null;
    for (let i = 0; i <= n; i++) { const az = (head - fov / 2 + fov * i / n) * Math.PI / 180, q = toV(x + Math.sin(az) * len, y + Math.cos(az) * len, 1.5);
      if (prev) { B.tri.push(a.x, a.y, a.z, prev.x, prev.y, prev.z, q.x, q.y, q.z); for (let k = 0; k < 3; k++) B.tc.push(c.r, c.g, c.b); } prev = q; }
  }
  function ring(group, x, y, r, color) { if (!CB.has(group)) CB.set(group, { tri: [], tc: [], ln: [], lc: [] }); const B = CB.get(group), c = new T.Color(color);
    for (let i = 0; i < 32; i += 1) { if (i % 2) continue; const a0 = i / 32 * 6.283, a1 = (i + 1) / 32 * 6.283, p = toV(x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.6), q = toV(x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.6);
      B.ln.push(p.x, p.y, p.z, q.x, q.y, q.z); B.lc.push(c.r, c.g, c.b, c.r, c.g, c.b); } }
  function flush(group) { const B = CB.get(group); if (!B) return; CB.delete(group);
    if (B.tri.length) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(B.tri, 3)); g.setAttribute('color', new T.Float32BufferAttribute(B.tc, 3));
      group.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, side: T.DoubleSide, depthWrite: false }))); }
    if (B.ln.length) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(B.ln, 3)); g.setAttribute('color', new T.Float32BufferAttribute(B.lc, 3)); group.add(new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true }))); } }
  function buildPhotos() {
    G.photos.clear(); const dots = [];
    for (const p of DATA.obs.photos) {
      if (p.pos.x == null) continue; const v = toV(p.pos.x, p.pos.y, 2);
      const anchored = p.pos.conf >= 0.45; dots.push([v, anchored]);
      if (p.heading.v != null) cone(G.photos, p.pos.x, p.pos.y, p.heading.v, p.fov_h.v, p.heading.method === 'גרם שמיים' ? 90 : 50, p.heading.method === 'גרם שמיים' ? 0x38d97a : 0x4da3ff, p.heading.conf >= 0.5 ? 0.28 : 0.13);
      if (p.pos.r_m >= 20) ring(G.photos, p.pos.x, p.pos.y, p.pos.r_m, anchored ? 0x38d97a : 0xffb547);
      PICK.push({ v, type: 'photo', data: p });
    }
    const im = new T.InstancedMesh(new T.CylinderGeometry(2.2, 2.2, 4, 10), new T.MeshBasicMaterial({ color: 0xffffff }), dots.length); const m = new T.Matrix4(), c = new T.Color();
    dots.forEach(([v, a], i) => { m.makeTranslation(v); im.setMatrixAt(i, m); im.setColorAt(i, c.set(a ? 0x38d97a : 0x4da3ff)); }); G.photos.add(im); flush(G.photos);
  }
  function buildRoute() {
    G.route.clear(); if (!DATA.route) return;
    const pts = DATA.route.route_sample_xy.map(([x, y]) => toV(x, y, 3)); G.route.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0xffe066 })));
    for (const p of DATA.route.photos) { if (p.heading_deg != null) cone(G.route, p.x, p.y, p.heading_deg, 60, 45, 0xffe066, 0.18); PICK.push({ v: toV(p.x, p.y, 3), type: 'route', data: p }); }
    flush(G.route);
  }
  function buildDisc() {
    G.disc.clear(); G.ghost.clear();
    const pins = new T.InstancedMesh(new T.ConeGeometry(4, 12, 4).rotateX(Math.PI), new T.MeshBasicMaterial({ color: 0xffffff }), DATA.disc.items.length); G.disc.add(pins);
    DATA.disc.items.forEach((d, i) => { pins.setMatrixAt(i, new T.Matrix4().makeTranslation(toV(d.x, d.y, 16))); pins.setColorAt(i, new T.Color(d.severity === 'התאמה' ? 0x3fbf7f : d.severity === 'מידע' ? 0x6aa8ff : 0xff5a5a)); });
    for (const d of DATA.disc.items) {
      PICK.push({ v: toV(d.x, d.y, 16), type: 'disc', data: d });
      if (d.observed && d.observed.h_m_range && d.building) {   // רוח רפאים: הגובה המשוער לפי תצפית
        for (const t of DATA.tiles) for (const b of t.b) if (b.i === d.building) {
          const ring0 = decode(b.r[0]), sh = new T.Shape(); for (let i = 0; i < ring0.length; i += 2) { const v = toV(t.o[0] + ring0[i], t.o[1] + ring0[i + 1]); i ? sh.lineTo(v.x, -v.z) : sh.moveTo(v.x, -v.z); }
          const H = (d.observed.h_m_range[0] + d.observed.h_m_range[1]) / 2;
          const g = new T.ExtrudeGeometry(sh, { depth: H, bevelEnabled: false }).rotateX(-Math.PI / 2);
          G.ghost.add(new T.Mesh(g, new T.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.22, depthWrite: false })));
          G.ghost.add(new T.LineSegments(new T.EdgesGeometry(g), new T.LineBasicMaterial({ color: 0xff8080 })));
        }
      }
    }
  }

  // ---------- תוויות מספרים (DOM, textContent בלבד) ----------
  const labels = []; function buildLabels() { const host = $('labels'); host.textContent = '';
    for (const p of DATA.obs.photos) { if (p.pos.x == null) continue; const e = el('div', p.id, 'lbl' + (p.pos.conf >= 0.45 ? ' anc' : '')); host.appendChild(e); labels.push([e, toV(p.pos.x, p.pos.y, 6)]); } }
  function placeLabels(cam) { const w = canvas.clientWidth, h = canvas.clientHeight, v = new T.Vector3(), show = $('lPhotos').checked;
    const seen = new Set();
    for (const [e, p] of labels) { v.copy(p).project(cam); const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h; const k = Math.round(x / 18) + ',' + Math.round(y / 14);
      const vis = show && v.z < 1 && x > -20 && x < w + 20 && y > 40 && y < h && !seen.has(k); seen.add(k); e.style.display = vis ? '' : 'none'; if (vis) { e.style.left = x + 'px'; e.style.top = y + 'px'; } } }

  // ---------- כרטיס ----------
  function card(build) { const b = $('cardBody'); b.textContent = ''; build(b); $('card').classList.add('open'); }
  function kv(b, k, v, prov, conf) { const d = el('div'); d.appendChild(el('b', k + ': ')); d.appendChild(document.createTextNode(v == null ? '—' : String(v) + ' ')); if (prov) d.appendChild(tag(prov)); if (conf != null) d.appendChild(el('span', 'ביטחון ' + conf, 'tag')); b.appendChild(d); }
  function photoCard(p) { card(b => {
    b.appendChild(el('h2', 'תמונה ' + p.id + ' · ' + p.time_local.slice(11, 16)));
    if (/^\d{3}$/.test(p.id)) { const im = el('img'); im.alt = 'תמונה ' + p.id; im.loading = 'lazy'; im.src = CFG.thumbs + p.id + '.jpg'; b.appendChild(im); }
    kv(b, 'מיקום', p.pos.street ? 'רח\' ' + p.pos.street + ' ±' + p.pos.r_m + ' מ\'' : '±' + p.pos.r_m + ' מ\'', p.pos.prov, p.pos.conf); b.appendChild(el('div', p.pos.src, 'mut'));
    kv(b, 'כיוון מבט', p.heading.v == null ? 'לא ידוע' : p.heading.v + '° ±' + (p.heading.pm || '?') + '° (' + (p.heading.method || '') + ')', p.heading.prov, p.heading.conf);
    if (p.heading.check) kv(b, 'בדיקה צולבת', 'מגדל: נצפה ' + p.heading.check.observed_deg + '° מול מפה ' + p.heading.check.predicted_deg + '° (שארית ' + p.heading.check.residual_deg + '°)', 'נגזר');
    kv(b, 'סגנון רחוב', p.style_class.v, p.style_class.prov, p.style_class.conf);
    const ul = el('ul'); for (const f of p.findings) { const li = el('li'); li.appendChild(el('b', f.dept + ': ')); li.appendChild(document.createTextNode(f.he + (f.count ? ' ×' + f.count : '') + ' ')); li.appendChild(tag(f.prov)); ul.appendChild(li); } b.appendChild(ul);
    if (p.privacy) b.appendChild(el('div', 'פרטיות: לוחיות לא נרשמו, שמות פרטיים לא נרשמו', 'mut'));
  }); }
  function routeCard(p) { card(b => { b.appendChild(el('h2', 'מסלול משוחזר · תמונה ' + p.id));
    kv(b, 'מיקום', (p.street_matched || '—') + ' · שגיאה ~' + p.pos_err_m + ' מ\'', p.pos_prov); kv(b, 'עוגן', p.anchor || 'אין');
    kv(b, 'כיוון', p.heading_deg == null ? 'לא ידוע' : p.heading_deg + '°', p.heading_prov || 'משוער'); kv(b, 'זמן', p.t_local); }); }
  function discCard(d) { card(b => { b.appendChild(el('h2', d.severity === 'התאמה' ? 'התאמה מודל↔מציאות' : 'אי-התאמה: ' + d.severity)); b.appendChild(el('p', d.he));
    if (d.model) kv(b, 'במודל', JSON.stringify(d.model).replace(/[{}"]/g, ' '), 'משוער');
    if (d.observed) kv(b, 'בתצפית', JSON.stringify(d.observed).replace(/[{}"]/g, ' '), d.observed.prov, d.observed.conf);
    kv(b, 'תמונות', (d.photos || []).join(', ')); kv(b, 'פעולה', d.action); }); }
  function genCard(k, r, j) { const d = r.kinds[k].data; card(b => {
    b.appendChild(el('h2', KIND_HE[k] || k)); kv(b, 'מקור', 'נגזר מסגנון השכונה', 'נגזר מסגנון השכונה'); kv(b, 'בסיס הכלל', PG.BASIS[k]);
    const ri = d[j + 4];
    if (ri >= 0) { const rd = r.roads.find(x => x.i === ri); if (rd) { kv(b, 'רחוב (OSM)', rd.n || 'ללא שם'); kv(b, 'סגנון שנבחר', rd.style + ' (p=' + rd.p + ')', rd.basis === 'תצפית ברחוב זה' ? 'נגזר' : 'משוער'); kv(b, 'זרע', rd.seed); } }
    else kv(b, 'בניין (OSM)', 'מזהה ' + (DATA.tiles.find(t => t.k === r.key).b[-1 - ri] || {}).i);
    if (k === 'street_sign') kv(b, 'סגנון שלט', d[j + 5] ? 'לבן ישן, מסגרת אפורה (כמו 032)' : 'כחול, מסגרת לבנה, עברית/אנגלית (כמו 015)');
    if (k === 'fence') kv(b, 'סוג', PG.FENCE_KINDS[d[j + 5]]);
  }); }
  function bldCard(i) { const B = DATA.blds[i]; const d = discByBld[B.i]; card(b => { b.appendChild(el('h2', 'בניין ' + B.i));
    kv(b, 'טביעת רגל', 'OSM', 'נצפה'); kv(b, 'גובה', B.h.toFixed(1) + ' מ\' · ' + B.f + ' קומות', B.src === 'R' ? 'משוער' : 'נגזר'); b.appendChild(el('div', 'מקור הגובה: כלל אצבע (src=R) – לא נמדד', 'mut'));
    if (B.t) kv(b, 'סוג', B.t); if (B.n) kv(b, 'שם', B.n); if (d) { b.appendChild(el('p', d.he)); } }); }

  // ---------- בחירה בלחיצה ----------
  const ray = new T.Raycaster();
  function pick(cx, cy) {
    const cam = curCam(), w = canvas.clientWidth, h = canvas.clientHeight, v = new T.Vector3(); let best = null, bd = 26;
    const test = (pv, f) => { v.copy(pv).project(cam); if (v.z > 1) return; const d = Math.hypot((v.x + 1) / 2 * w - cx, (1 - v.y) / 2 * h - cy); if (d < bd) { bd = d; best = f; } };
    for (const P of PICK) { if ((P.type === 'photo' && !$('lPhotos').checked) || (P.type === 'route' && !$('lRoute').checked) || (P.type === 'disc' && !$('lDisc').checked)) continue; test(P.v, () => P.type === 'photo' ? photoCard(P.data) : P.type === 'route' ? routeCard(P.data) : discCard(P.data)); }
    if (!best && $('lGen').checked) { bd = 16; for (const k of PG.KINDS) { if (FACADE.has(k) && !$('lFacade').checked) continue; const ref = INST[k] && INST[k].ref; if (!ref) continue;
      for (let i = 0; i < ref.length; i += 2) { if (!INST[k].vis[i / 2]) continue; const r = ref[i], j = ref[i + 1], d = r.kinds[k].data; const y = (k === 'ac_unit' || k === 'balcony') ? d[j + 5] : 1; test(toV(r.origin[0] + d[j], r.origin[1] + d[j + 1], y), () => genCard(k, r, j)); } } }
    if (best) return best();
    ray.setFromCamera(new T.Vector2(cx / w * 2 - 1, -(cy / h) * 2 + 1), cam);
    const hit = ray.intersectObject(G.bld, true)[0]; if (hit && hit.face) { const own = hit.object.userData.owner; bldCard(own[hit.face.a]); return; }
    $('card').classList.remove('open');
  }

  // ---------- מצלמה ושליטה (מגע + עכבר) ----------
  function curCam() { return ctl.mode3d ? persp : ortho; }
  function updCam() { const w = canvas.clientWidth, h = canvas.clientHeight;
    if (ctl.mode3d) { persp.aspect = w / h; persp.updateProjectionMatrix(); const cp = Math.cos(ctl.pitch);
      persp.position.set(ctl.tx + ctl.dist * cp * Math.sin(ctl.yaw), ctl.dist * Math.sin(ctl.pitch), ctl.tz + ctl.dist * cp * Math.cos(ctl.yaw)); persp.lookAt(ctl.tx, 0, ctl.tz); }
    else { const s = 300 / ctl.zoom2d; ortho.left = -s * w / h; ortho.right = s * w / h; ortho.top = s; ortho.bottom = -s; ortho.position.set(ctl.tx, 1000, ctl.tz); ortho.up.set(0, 0, -1); ortho.lookAt(ctl.tx, 0, ctl.tz); ortho.updateProjectionMatrix(); } }
  const ptrs = new Map(); let downAt = null, moved = 0, pinch0 = null;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); downAt = [e.clientX, e.clientY]; moved = 0; pinch0 = null; });
  canvas.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; const [px, py] = ptrs.get(e.pointerId), dx = e.clientX - px, dy = e.clientY - py; ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) zoom(pinch0 / d); pinch0 = d; }
    else if (ctl.mode3d && !e.shiftKey && e.buttons !== 2) { ctl.yaw -= dx * 0.006; ctl.pitch = Math.min(1.45, Math.max(0.12, ctl.pitch + dy * 0.005)); }
    else pan(dx, dy);
    dirty = true; scheduleCull(); });
  const end = e => { ptrs.delete(e.pointerId); if (!ptrs.size && downAt && moved < 8) pick(e.clientX, e.clientY); downAt = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  function zoom(f) { if (ctl.mode3d) ctl.dist = Math.min(2500, Math.max(25, ctl.dist * f)); else ctl.zoom2d = Math.min(40, Math.max(0.2, ctl.zoom2d / f)); dirty = true; scheduleCull(); }
  function pan(dx, dy) { const k = ctl.mode3d ? ctl.dist / 700 : 300 / ctl.zoom2d / canvas.clientHeight * 2; const c = Math.cos(ctl.mode3d ? ctl.yaw : 0), s = Math.sin(ctl.mode3d ? ctl.yaw : 0);
    ctl.tx -= (dx * c + dy * s) * k; ctl.tz -= (-dx * s + dy * c) * k; }

  // ---------- ממשק ----------
  $('bLayers').onclick = () => { const o = $('layers').classList.toggle('open'); $('bLayers').setAttribute('aria-expanded', String(o)); };
  $('bMode').onclick = () => { ctl.mode3d = !ctl.mode3d; $('bMode').textContent = ctl.mode3d ? '2D' : '3D'; $('bMode').setAttribute('aria-pressed', String(!ctl.mode3d)); dirty = true; scheduleCull(); };
  $('bNight').onclick = () => setNight(!night);
  $('cardX').onclick = () => $('card').classList.remove('open');
  const vis = () => { G.bld.visible = $('lBld').checked; G.roads.visible = $('lRoads').checked; G.photos.visible = $('lPhotos').checked; G.route.visible = $('lRoute').checked; G.disc.visible = $('lDisc').checked;
    G.ghost.visible = $('lGhost').checked; G.gen.visible = $('lGen').checked; G.facade.visible = $('lFacade').checked; G.pools.visible = night && $('lGen').checked; dirty = true; };
  ['lBld', 'lRoads', 'lPhotos', 'lRoute', 'lDisc', 'lGhost', 'lGen', 'lFacade'].forEach(id => $(id).addEventListener('change', vis));
  $('lGlb').addEventListener('change', () => { glbOn = $('lGlb').checked; buildInstances(); });
  $('lTruth').addEventListener('change', () => { truth = $('lTruth').checked; buildBuildings(); buildInstances(); legend(); });
  function legend() { const L = $('legend'); L.textContent = '';
    const row = (c, t) => { const d = el('div'); const s = el('span', null, 'sw'); s.style.background = c; d.appendChild(s); d.appendChild(document.createTextNode(' ' + t)); L.appendChild(d); };
    if (truth) { row('#38d97a', 'נצפה בתמונה (נקודות/קונוסים)'); row('#d65cff', 'נוצר – נגזר מסגנון השכונה'); row('#ffb547', 'בניין: טביעה OSM, גובה משוער'); }
    else { row('#38d97a', 'צילום מעוגן (שלט/ירח)'); row('#4da3ff', 'צילום – מיקום משוער'); row('#ff5a5a', 'אי-התאמה'); row('#ffe066', 'מסלול משוחזר'); } }
  window.addEventListener('resize', () => { R.setSize(canvas.clientWidth, canvas.clientHeight, false); dirty = true; });

  // ---------- לולאה: רינדור לפי דרישה + מדידה ----------
  const perf = { frames: [], gaps: [], calls: 0, tris: 0 }; window.__perf = perf; let lastT = 0;
  let bench = 0; window.__bench = n => { bench = n; perf.frames = []; perf.gaps = []; lastT = performance.now(); };
  function loop() {
    requestAnimationFrame(loop);
    if (!dirty && !bench) return; dirty = false;
    if (bench) { bench--; ctl.yaw += 0.01; }
    const t0 = performance.now(); updCam(); R.render(scene, curCam()); const dt = performance.now() - t0; placeLabels(curCam());
    const now = performance.now(); if (bench || perf.gaps.length) perf.gaps.push(now - lastT); lastT = now;
    perf.frames.push(dt); if (perf.frames.length > 600) perf.frames.shift(); perf.calls = R.info.render.calls; perf.tris = R.info.render.triangles;
  }

  async function boot() {
    R.setSize(canvas.clientWidth, canvas.clientHeight, false); setNight(true); legend();
    try {
      const [obs, rules, disc] = await Promise.all([getJSON(CFG.data + 'observations.json'), getJSON(CFG.data + 'style_rules.json'), getJSON(CFG.data + 'discrepancies.json')]);
      DATA.obs = obs; DATA.rules = rules; DATA.disc = disc; try { DATA.route = await getJSON(CFG.data + 'route_photos.json'); } catch (e) { DATA.route = null; }
      for (const d of disc.items) if (d.building) discByBld[d.building] = d;
      DATA.tiles = (await Promise.all(CFG.keys.map(getTile))).filter(Boolean);
      buildBuildings(); buildRoads(); genAll(); buildPhotos(); buildRoute(); buildDisc(); buildLabels(); vis();
      const n = DATA.obs.photos.filter(p => p.pos.x != null).length;
      $('status').textContent = `אריחים ${DATA.tiles.length} · בניינים ${DATA.blds.length} · תמונות ממוקמות ${n}/${DATA.obs.photos.length} · נוצרו ${STATS.genN.toLocaleString('he-IL')} אובייקטים ב-${STATS.genMs} מ"ש · OSM © תורמים`;
      window.__ready = { tiles: DATA.tiles.length, blds: DATA.blds.length, gen: STATS.genN, genMs: STATS.genMs };
      loop(); loadGLBs().then(() => { window.__glb = STATS.glb; });
    } catch (e) { $('status').textContent = 'שגיאה בטעינה: ' + e.message; window.__err = e.message; }
  }
  boot();
})();
