/* מתאם: מחלקת הצמחייה (swarm/vegetation/vegetation.js — ES module): עצים לפי מין (פיקוס, זית, דקלים…), כיסוי קרקע (דשא/חול/דיונה),
 * עונות לפי תאריך העולם, נדנוד ברוח מהמקור האחד, LOD רשת→כרטיס. אריחים: mods/vegetation/data/tiles/g/<key>.json.gz לפי האריחים של המשחק.
 * כנות: כל הצמחייה באשדוד כרגע משוערת (אין עצי OSM בדגימה) — התווית מוצגת ב-HUD ובלוח המודולים.
 * גדוד הצמחייה (24.11.2026): עם js/flora.js (?flora=0 מכבה) — עצים מכרטיסי עלים עם טקסטורות, גזע מעוגל עם קליפה, לילה ופנסים, צל רק לקרובים.
 * מחלקת הצמחייה מציירת עכשיו את *כל* העצים: עצי הרחוב והדקלים של world.js נמסרים לה כמשבצות (בלי כפילות ברדיוס 6 מ'),
 * ו-world.js מפסיק לצייר אותם (W.setTreesExternal). אריחי הכיסוי הארצי (בלי שכבת צמחייה) מקבלים אריח ריק + המשבצות.
 */
(function () {
  'use strict';
  const V = window.YZVeg = { veg: null, keys: new Set(), pending: new Set(), fed: new Set(), F: null, lightT: 0, slots: 0 };
  const qs = new URLSearchParams(location.search);
  async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); let b = await r.arrayBuffer(); const u = new Uint8Array(b, 0, 2);
    if (u[0] === 0x1f && u[1] === 0x8b) b = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); return JSON.parse(new TextDecoder().decode(b)); }
  const owns = W => !!(W && W.setTreesExternal);   // world.js יודע להסתיר את העצים שלו → אפשר למסור אותם כמשבצות
  function emptyTile(key) { const [tx, ty] = key.split('_').map(Number); return { key, ox: tx * 1000, oy: ty * 1000, n: 0, E: new Float64Array(0), N: new Float64Array(0), h: new Float32Array(0), sp: new Uint8Array(0), src: new Uint8Array(0), codes: [], lc: null }; }
  /** עצי הרחוב (c=2) והדקלים (c≥3) של world.js → משבצות. מין לעצי רחוב לפי פלטת הרחוב של המחלקה; דקלים: תמר/וושינגטוניה לפי גוש 250 מ'. */
  function feed(world, t) {
    const W = world.data.W; if (!V.veg || !owns(W) || !W.treesExternal || !V.keys.has(t.key) || V.fed.has(t.key) || !t.hi) return;   // ?worldtrees=1 → world.js מצייר בעצמו, לא מוסרים
    const slots = [], tr = t.treeXZ, pa = t.palms && t.palms.userData && t.palms.userData.xz;
    if (tr) for (let i = 0; i < tr.length; i += 2) slots.push({ x: tr[i], z: tr[i + 1], cls: 2, maxCrown: 9 });
    if (pa) for (let i = 0; i < pa.length; i += 2) { const E = pa[i] + W.OX, N = W.OY - pa[i + 1], b = (Math.imul(Math.floor(E / 250), 73856093) ^ Math.imul(Math.floor(N / 250), 19349663)) >>> 0;
      slots.push({ x: pa[i], z: pa[i + 1], species: b % 100 < 55 ? 'PHOE' : 'WASH' }); }
    V.fed.add(t.key); if (slots.length) V.slots += V.veg.fillSlots(t.key, slots, { dedupe: 6 });
  }
  async function add(world, t) { const key = t.key; if (!t.blds || V.keys.has(key) || V.pending.has(key)) return; V.pending.add(key);
    try {
      if (window.W27 && W27.isExtra && W27.isExtra(key)) {   // לאריחי הכיסוי הארצי אין שכבת צמחייה — אריח ריק שמקבל את עצי world.js
        if (owns(world.data.W) && V.veg && world.data.tiles.has(key)) { V.veg.addTile(key, emptyTile(key)); V.keys.add(key); feed(world, t); } return; }
      const g = await fetchJSON('mods/vegetation/data/tiles/g/' + key + '.json.gz'); if (!V.veg || !world.data.tiles.has(key)) return; V.veg.addTile(key, g); if (t.terrain) V.veg.applyGroundCover(t.terrain, key); V.keys.add(key); feed(world, t); }
    catch (e) { /* אריח בלי צמחייה — לא שגיאה */ if (V.veg && owns(world.data.W) && !V.keys.has(key) && world.data.tiles.has(key)) { V.veg.addTile(key, emptyTile(key)); V.keys.add(key); feed(world, t); } }
    finally { V.pending.delete(key); } }
  // בהירות הכרטיסים הרחוקים (נאפו באור יום) = יחס התאורה עכשיו לתאורת האפייה → בלילה הם לא "זוהרים"
  const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  let BAKE = null;
  function farLight(world) {
    const h = world.hemi, s = world.sunLight; if (!h || !V.veg || !V.veg.setLight) return;
    if (!BAKE) { const C = x => new THREE.Color(x); BAKE = 1.35 * (lum(C(0xdfeaff)) * 0.6 + lum(C(0x6a5a40)) * 0.4) + 2.2 * lum(C(0xfff2dd)) * 0.5; }
    const now = h.intensity * (lum(h.color) * 0.6 + lum(h.groundColor) * 0.4) + (s && s.visible !== false ? s.intensity * lum(s.color) * 0.5 : 0);
    const lift = V.F ? V.F.uniforms.uFloraNight.value * Math.PI : 0;
    V.veg.setLight(Math.max(0.08, Math.min(1.25, (now + lift) / BAKE)));
  }
  YZW.register({
    id: 'vegetation', name: 'צמחייה: עצים, דשא, דיונות, עונות, רוח (משוער)', dept: 'vegetation', order: 48,
    late: true,   // בחירת LOD אחרי עדכון המצב והמצלמה: במצבי תוסף (עין גדולה, מטוס…) המצלמה שמציירת ≠ מצלמת המשחק — אחרת עצים שבתמונה לא נבחרים
    async init(world, api) {
      const mod = await import(new URL('mods/vegetation/vegetation.js', location.href).href);
      const W = world.data.W;
      V.F = qs.get('flora') !== '0' && window.ESHFlora && ESHFlora.init ? ESHFlora : null;
      V.veg = mod.createVegetation(THREE, { renderer: world.renderer, scene: api.group(), origin: { OX: W.OX, OY: W.OY }, heightAt: (x, z) => Math.max(0, world.data.H(x, z)), budget: world.quality.tier === 'high' ? 'desktop' : 'phone', flora: V.F, floraNormal: world.quality.tier === 'high' });   // מפת נורמל לעלים רק בשכבה הגבוהה: בטלפון היא ~חצי מעלות הציור של העצים הקרובים (נמדד)
      if (owns(W) && qs.get('worldtrees') !== '1') W.setTreesExternal(true);   // ?worldtrees=1 — להשוואה: גם העצים של world.js (כפילויות)
      const sync = () => { V.veg.setWind(world.weather.wind); V.veg.setDate(world.clock.date); }; api.on('env', sync); sync();
      api.eachTile((t, kind) => { if (kind === 'remove') { V.fed.delete(t.key); if (V.keys.delete(t.key)) V.veg.removeTile(t.key); } else if (kind === 'add') add(world, t); else if (kind === 'lod') feed(world, t); });
    },
    update(dt, world) { V.veg.update(world.camera, dt); if (V.F) V.F.update(world); V.lightT -= dt; if (V.lightT <= 0) { V.lightT = 1; farLight(world); } },
    dispose(world) { if (V.veg) try { V.veg.dispose(); } catch (e) { /* */ } V.veg = null; V.keys.clear(); V.fed.clear(); const W = world && world.data && world.data.W; if (owns(W)) W.setTreesExternal(false); },
    hudPanels: [{ id: 'veg', render(el, world) { if (world.player.mode === 'dev' && V.keys.size) el.textContent = '🌳 צמחייה משוערת — אין עדיין נתוני עצים מ-OSM באשדוד'; } }],
  });
})();
