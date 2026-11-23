/* מתאם: מחלקת הריהוט הפרוצדורלי (swarm/procgen/js/procgen.js → window.ESH_PROCGEN): פנסים (מעוקל LED / LED לבן / מעוטר אדום כפול)
 * ומעברי חצייה לפי סגנון השכונה (style_rules.json — נלמד מתמונות השטח). כל אובייקט "נגזר מסגנון השכונה" (מסומן ב-HUD במצב העין).
 * קלט: האריח הווקטורי הגולמי (data/tiles/v/<key>.json.gz — אותו קובץ שהמשחק כבר טען, מהמטמון). מסגרת: E = o[0] + x, N = o[1] + y.
 * ציור: 3 InstancedMesh לכל העולם (פנס, ראש פנס, פס חצייה) — הקרובים ביותר לשחקן, בתקציב השכבה.
 * מוסר את מיקומי הפנסים לאווירה (world.providers.lamps) → כתמי האור בלילה במקום הנכון ובסוג הנכון.
 * עצים מ-procgen לא מצוירים כאן (מחלקת הצמחייה אחראית על עצים).
 */
(function () {
  'use strict';
  const G = { rules: null, per: new Map(), pole: null, head: null, cw: null, T: 0, dirty: true, lp: null };
  const LAMPS = ['lamp_curved_led', 'lamp_led_white', 'lamp_ornate_red_double'];
  const COL = { lamp_curved_led: 0x5c6168, lamp_led_white: 0x8d939a, lamp_ornate_red_double: 0x7a2a24 };
  const MAXL = { low: 220, medium: 400, high: 700 }, MAXC = { low: 300, medium: 600, high: 1000 };
  async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); let b = await r.arrayBuffer(); const u = new Uint8Array(b, 0, 2);
    if (u[0] === 0x1f && u[1] === 0x8b) b = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); return JSON.parse(new TextDecoder().decode(b)); }
  function curvedPole() { // עמוד 1 מ' (מוגדל לפי גובה) + זרוע מעוקלת לכיוון הכביש (+x מקומי)
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector3(Math.sin(t * Math.PI / 2) * 0.22 * (t > 0.8 ? 1 : 0), t, 0)); }
    const g1 = new THREE.CylinderGeometry(0.06 / 8, 0.1 / 8, 1, 6); g1.translate(0, 0.5, 0);   // מנורמל לגובה 1; עובי אמיתי ב-8 מ'
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0, 1.07, 0), new THREE.Vector3(0.22, 1.05, 0));
    const g2 = new THREE.TubeGeometry(curve, 6, 0.04 / 8, 5, false);
    const m = (a, b) => { const A = a.toNonIndexed(), B = b.toNonIndexed(); const n = A.attributes.position.count + B.attributes.position.count, p = new Float32Array(n * 3), q = new Float32Array(n * 3);
      p.set(A.attributes.position.array); p.set(B.attributes.position.array, A.attributes.position.count * 3); q.set(A.attributes.normal.array); q.set(B.attributes.normal.array, A.attributes.normal.count * 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(q, 3)); return g; };
    return m(g1, g2);
  }
  function stripeTex() { const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.fillStyle = '#f2f2ee'; x.fillRect(0, 0, 4, 4); const t = new THREE.CanvasTexture(c); return t; }
  async function addTile(world, t) {
    if (!t.blds || G.per.has(t.key)) return; G.per.set(t.key, null);
    try { const v = await fetchJSON((window.W27 && W27.tileBase ? W27.tileBase(t.key) : 'data/') + 'tiles/v/' + t.key + '.json.gz'); if (!world.data.tiles.has(t.key)) { G.per.delete(t.key); return; }
      const res = window.ESH_PROCGEN.generateTile(v, G.rules, {}); const W = world.data.W, out = { lamps: [], cw: [] };
      for (const k of LAMPS) { const d = res.kinds[k] && res.kinds[k].data; if (!d) continue;
        for (let i = 0; i < d.length; i += 6) { const s = W.toScene(res.origin[0] + d[i], res.origin[1] + d[i + 1]); out.lamps.push({ x: s.x, z: s.z, a: d[i + 2], h: 8 * (d[i + 3] || 1), kind: k }); } }
      const c = res.kinds.crosswalk && res.kinds.crosswalk.data; if (c) for (let i = 0; i < c.length; i += 6) { const s = W.toScene(res.origin[0] + c[i], res.origin[1] + c[i + 1]); out.cw.push({ x: s.x, z: s.z, a: c[i + 2] }); }
      G.per.set(t.key, out); G.dirty = true;
    } catch (e) { G.per.delete(t.key); }
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
  function rebuild(world) {
    const P = world.player.pos, tier = world.quality.tier, H = world.data.H, onRoad = world.data.onRoad;
    const L = [], CW = []; for (const o of G.per.values()) if (o) { for (const l of o.lamps) L.push(l); for (const c of o.cw) CW.push(c); }
    const d2 = o => (o.x - P.x) ** 2 + (o.z - P.z) ** 2; L.sort((a, b) => d2(a) - d2(b)); CW.sort((a, b) => d2(a) - d2(b));
    const nL = Math.min(L.length, MAXL[tier] || 300), nC = Math.min(CW.length, MAXC[tier] || 500);
    const lampsOut = [];
    for (let i = 0; i < nL; i++) { const l = L[i], y = Math.max(0, H(l.x, l.z));
      // הזרוע פונה לכביש: בודקים איזה צד ניצב לכביש הוא כביש
      const ex = Math.cos(l.a), ez = -Math.sin(l.a), nx = -ez, nz = ex; const toward = onRoad(l.x + nx * 3, l.z + nz * 3) ? 1 : -1;
      const ang = Math.atan2(-(nz * toward), nx * toward);   // סיבוב סביב y כך ש-+x מקומי = לכיוון הכביש
      Q.setFromAxisAngle(UP, ang); V.set(l.x, y, l.z); S.set(l.h, l.h, l.h); M.compose(V, Q, S); G.pole.setMatrixAt(i, M); G.pole.setColorAt(i, C.setHex(COL[l.kind]));
      const hx = l.x + nx * toward * 0.22 * l.h, hz = l.z + nz * toward * 0.22 * l.h; V.set(hx, y + 1.03 * l.h, hz); S.set(1, 1, 1); M.compose(V, Q, S); G.head.setMatrixAt(i, M);
      lampsOut.push({ x: hx, z: hz, y, type: l.kind === 'lamp_ornate_red_double' ? 'sodium' : 'led', kind: l.kind }); }
    G.pole.count = G.head.count = nL; G.pole.instanceMatrix.needsUpdate = G.head.instanceMatrix.needsUpdate = true; if (G.pole.instanceColor) G.pole.instanceColor.needsUpdate = true;
    for (let i = 0; i < nC; i++) { const c = CW[i], y = Math.max(0, H(c.x, c.z)) + 0.2; Q.setFromAxisAngle(UP, c.a); V.set(c.x, y, c.z); S.set(1, 1, 1); M.compose(V, Q, S); G.cw.setMatrixAt(i, M); }
    G.cw.count = nC; G.cw.instanceMatrix.needsUpdate = true;
    [G.pole, G.head, G.cw].forEach(m => m.computeBoundingSphere());
    world.providers.lamps = lampsOut; YZW.bus.emit('lamps', lampsOut); G.lp = { x: P.x, z: P.z };
  }
  YZW.register({
    id: 'procgen', name: 'ריהוט רחוב נגזר: פנסים מעוקלים, מעברי חצייה', dept: 'procgen', order: 52,
    scripts: ['mods/procgen/js/procgen.js'], requires: () => !!window.ESH_PROCGEN,
    async init(world, api) {
      G.rules = await (await fetch('mods/procgen/data/style_rules.json')).json();
      const g = api.group(); const MX = 700;
      G.pole = new THREE.InstancedMesh(curvedPole(), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a2a2a }), MX); G.pole.count = 0; g.add(G.pole);
      G.head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.12, 0.25), new THREE.MeshBasicMaterial({ color: 0xfff2d8 }), MX); G.head.count = 0; g.add(G.head);
      const sg = new THREE.PlaneGeometry(2.6, 0.5); sg.rotateX(-Math.PI / 2);
      G.cw = new THREE.InstancedMesh(sg, new THREE.MeshLambertMaterial({ color: 0xf0f0ea, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }), 1000); G.cw.count = 0; g.add(G.cw);
      api.eachTile((t, kind) => { if (kind === 'remove') { if (G.per.delete(t.key)) G.dirty = true; } else if (kind === 'add') addTile(world, t); });
      api.on('quality', () => { G.dirty = true; });
    },
    update(dt, world) { G.T -= dt; const P = world.player.pos; if (G.T <= 0 && (G.dirty || !G.lp || Math.hypot(P.x - G.lp.x, P.z - G.lp.z) > 120)) { G.T = 1.5; G.dirty = false; rebuild(world); } },
    dispose(world) { G.per.clear(); world.providers.lamps = null; },
    hudPanels: [{ id: 'pg', render(el, world) { if (world.player.mode === 'dev' && G.pole && G.pole.count) el.textContent = `🏮 ${G.pole.count} פנסים · ${G.cw.count} פסי חצייה — נגזר מסגנון השכונה (לא נמדד)`; } }],
  });
})();
