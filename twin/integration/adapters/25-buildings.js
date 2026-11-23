/* מתאם: מחלקת הבניינים — ציוני דרך מצוטטים (swarm/buildings/src/landmarks.js) + מגדלי הדקל ממקור ציבורי (swarm/publicdata PUB-001).
 * לפני שהגאומטריה של האריח נבנית (אירוע tile add) מתקנים גובה/קומות של בניינים ידועים, כך שהציור, הכרטיס, ההתנגשות והנחיתה על הגג
 * כולם עקביים. מקור הגובה בכרטיס מוחלף בטקסט כן ("מצוטט: …" / "ממקור ציבורי: 29 קומות…").
 * מגדלי הדקל: 5 מגדלים × 29 קומות (mako 20.8.2023, yad2 project 18100). גובה = 29×3.3+1 ≈ 97 מ' (משוער מקומות).
 *   2 טביעות קיימות ב-OSM לאורך הדקל (>500 מ"ר) מקבלות את הגובה; 3 מגדלים שאינם ב-OSM מוצבים לאורך הרחוב בטביעה משוערת 24×24 מ'
 *   ומסומנים "ממקור ציבורי + תצפית, טביעה ומיקום משוערים" (אין להם התנגשות — מסומן).
 * מה לא כאן (נרשם ביומן): שיידר החזיתות המלא (facades.js) דורש תכונת afc בגאומטריית האריחים של world.js — שינוי במנוע; טיפולוגיית וילות בגישור 26-typology.
 */
(function () {
  'use strict';
  const DEKEL = { floors: 29, h: 29 * 3.3 + 1, src: 'ממקור ציבורי: 29 קומות (mako 20.8.2023, yad2 18100); גובה = קומות×3.3 משוער', street: 'הדקל' };
  const B = { LM: null, extra: null, done: new Set() };
  function cite(b, h, floors, txt, conf) { const base = b.base || 0; b.h = h; b.top = base + h; if (floors) { b.floors = floors; b.fl = b.fh = floors; } b.sigma = conf === 'high' ? 2 : 8; b.src = txt; b.conf = conf === 'high' ? 1 : 2; b.cited = true; }
  function towerGeo(w, d, h, mat) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
    const uv = g.attributes.uv, pos = g.attributes.position, n = g.attributes.normal, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const ny = n.getY(i); const u = uv.getX(i), v = uv.getY(i); const side = Math.abs(n.getX(i)) > 0.5 ? d : w;
      uv.setXY(i, ny ? u : u * side / 6.8, ny ? v : v * h / 6.6); col[i * 3] = 0.93; col[i * 3 + 1] = 0.91; col[i * 3 + 2] = 0.86; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
  }
  function placeDekel(world, t, grp) {
    const W = world.data; const road = (t.roads || []).find(r => r.name && r.name.includes(DEKEL.street)); if (!road) return;
    const mapped = (t.blds || []).filter(b => b.area > 500 && W.nearestStreet(b.cx, b.cz, 60) && W.nearestStreet(b.cx, b.cz, 60).includes(DEKEL.street)).slice(0, 5);
    for (const b of mapped) cite(b, DEKEL.h, DEKEL.floors, DEKEL.src + ' · טביעה מ-OSM', 'medium');
    const need = 5 - mapped.length; if (need <= 0 || B.extra) return;
    const p = road.p, L = []; let tot = 0; for (let i = 0; i < p.length / 2 - 1; i++) { const l = Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]); L.push(l); tot += l; }
    const at = s => { for (let i = 0; i < L.length; i++) { if (s <= L[i] || i === L.length - 1) { const k = Math.min(1, s / L[i]), ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az; return { x: ax + dx * k, z: az + dz * k, fx: dx / L[i], fz: dz / L[i] }; } s -= L[i]; } };
    const mat = W.MAT.wall, geo = towerGeo(24, 24, DEKEL.h); const placed = [];
    for (let s = 20; s < tot - 10 && placed.length < need; s += 12) { const q = at(s);
      for (const side of [-1, 1]) { const x = q.x - q.fz * 30 * side, z = q.z + q.fx * 30 * side;
        if (W.buildingAt(x, z, 14) || W.onRoad(x, z) || placed.some(o => Math.hypot(o.x - x, o.z - z) < 40) || mapped.some(b => Math.hypot(b.cx - x, b.cz - z) < 40)) continue;
        const m = new THREE.Mesh(geo, mat); m.position.set(x, Math.max(0, W.H(x, z)), z); m.rotation.y = Math.atan2(q.fx, q.fz); m.castShadow = m.receiveShadow = true;
        m.userData.landmark = { he: 'מגדלי הדקל (מגדל שאינו ב-OSM)', note: 'ממקור ציבורי + תצפית, טביעה ומיקום משוערים', h: DEKEL.h }; grp.add(m); placed.push({ x, z }); break; } }
    B.extra = placed;
  }
  YZW.register({
    id: 'buildings', name: 'בניינים: ציוני דרך מצוטטים + מגדלי הדקל', dept: 'buildings', order: 25,
    scripts: ['mods/buildings/src/landmarks.js'], requires: () => !!(window.ESHBuildings && ESHBuildings.landmarks),
    init(world, api) {
      B.LM = ESHBuildings.landmarks; const grp = api.group();
      // חשוב: לפני שהמשחק בונה גאומטריה (setLOD) — אירוע add מגיע מ-buildTile, לפני הבנייה
      api.eachTile((t, kind) => { if (kind !== 'add' || !t.blds) return;
        for (const b of t.blds) { const l = B.LM.landmarkOf(b.id); if (!l) continue; const th = B.LM.targetHeight(l); if (!th) continue;
          cite(b, th.h, l.floors, (th.basis === 'data' ? 'מצוטט: ' : 'קומות מצוטטות, גובה משוער: ') + l.he, l.conf); B.done.add(b.id);
          if (t.hi) { t.grp.remove(t.hi); t.hi.geometry.dispose(); t.hi = null; t.lod = -1; } }   // אריח שכבר נבנה – ייבנה מחדש
        placeDekel(world, t, grp);
        if (t.hi && t.blds.some(b => b.cited && !b._rebuilt)) { t.blds.forEach(b => { if (b.cited) b._rebuilt = true; }); t.grp.remove(t.hi); t.hi.geometry.dispose(); t.hi = null; t.lod = -1; } });
    },
    dispose() { B.extra = null; },
    hudPanels: [{ id: 'lm', render(el, world) { if (world.player.mode !== 'dev') return; const s = world.player.selected; if (s && s.cited) el.textContent = '🏙 ' + s.src; } }],
  });
})();
