/* מתאם: מחלקת הצמחייה (swarm/vegetation/vegetation.js — ES module): עצים לפי מין (פיקוס, זית, דקלים…), כיסוי קרקע (דשא/חול/דיונה),
 * עונות לפי תאריך העולם, נדנוד ברוח מהמקור האחד, LOD רשת→כרטיס. אריחים: mods/vegetation/data/tiles/g/<key>.json.gz לפי האריחים של המשחק.
 * כנות: כל הצמחייה באשדוד כרגע משוערת (אין עצי OSM בדגימה) — התווית מוצגת ב-HUD ובלוח המודולים.
 */
(function () {
  'use strict';
  const V = window.YZVeg = { veg: null, keys: new Set(), pending: new Set() };   // חשוף לרחוב החי (fillSlots)
  async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); let b = await r.arrayBuffer(); const u = new Uint8Array(b, 0, 2);
    if (u[0] === 0x1f && u[1] === 0x8b) b = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); return JSON.parse(new TextDecoder().decode(b)); }
  async function add(world, t) { const key = t.key; if (!t.blds || V.keys.has(key) || V.pending.has(key)) return; V.pending.add(key);
    if (window.W27 && W27.isExtra && W27.isExtra(key)) return;   // לאריחי הכיסוי הארצי אין עדיין שכבת צמחייה
    try { const g = await fetchJSON('mods/vegetation/data/tiles/g/' + key + '.json.gz'); if (!V.veg || !world.data.tiles.has(key)) return; V.veg.addTile(key, g); if (t.terrain) V.veg.applyGroundCover(t.terrain, key); V.keys.add(key); }
    catch (e) { /* אריח בלי צמחייה — לא שגיאה */ } finally { V.pending.delete(key); } }
  YZW.register({
    id: 'vegetation', name: 'צמחייה: עצים, דשא, דיונות, עונות, רוח (משוער)', dept: 'vegetation', order: 48,
    async init(world, api) {
      const mod = await import(new URL('mods/vegetation/vegetation.js', location.href).href);
      const W = world.data.W;
      V.veg = mod.createVegetation(THREE, { renderer: world.renderer, scene: api.group(), origin: { OX: W.OX, OY: W.OY }, heightAt: (x, z) => Math.max(0, world.data.H(x, z)), budget: world.quality.tier === 'high' ? 'desktop' : 'phone' });
      const sync = () => { V.veg.setWind(world.weather.wind); V.veg.setDate(world.clock.date); }; api.on('env', sync); sync();
      api.eachTile((t, kind) => { if (kind === 'remove') { if (V.keys.delete(t.key)) V.veg.removeTile(t.key); } else if (kind === 'add') add(world, t); });
    },
    update(dt, world) { V.veg.update(world.camera, dt); },
    dispose() { if (V.veg) try { V.veg.dispose(); } catch (e) { /* */ } V.veg = null; V.keys.clear(); },
    hudPanels: [{ id: 'veg', render(el, world) { if (world.player.mode === 'dev' && V.keys.size) el.textContent = '🌳 צמחייה משוערת — אין עדיין נתוני עצים מ-OSM באשדוד'; } }],
  });
})();
