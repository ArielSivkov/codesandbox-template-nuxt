/* present/data.js — קורא את חוזה הנתונים של pipeline (v1, EPSG:2039, אריחי 1 ק"מ) ומחזיר "עולם" פשוט:
 * בניינים כמנסרות בקואורדינטות מקומיות (x מזרח, y צפון, מ') סביב מקור שלם, קרקע לדגימת גובה, כבישים.
 * ממשק העולם (אפשר לממש אותו גם מעל המנוע/המשחק):
 *   world.origin {E,N}; world.buildings[] {id, ring[[x,y]], base, height, sigma, floors, floorsRange, conf, area, cx, cy}
 *   world.byId Map; world.ground(x,y) → גובה קרקע (מ'); world.roads[] {name, cls, pts[[x,y]]}; world.terrain[] אריחי קרקע גולמיים
 *   world.near(x, y, r) → בניינים שמרכזם בטווח; world.sea[] פוליגוני ים (טבעת חיצונית + חורים). בדגימה: קו חוף סינתטי!
 */
(function (root) {
  'use strict';
  const SEA = -32768, OUT = -32767;
  async function fetchBuf(url) {
    const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    let buf = await r.arrayBuffer(); const u = new Uint8Array(buf, 0, 2);
    if (u[0] === 0x1f && u[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return buf;
  }
  const td = new TextDecoder();
  const fetchJSON = async url => JSON.parse(td.decode(await fetchBuf(url)));
  function decodeRing(r, ox, oy) { const a = []; let x = ox, y = oy; for (let i = 0; i < r.length; i += 2) { x += r[i] / 10; y += r[i + 1] / 10; a.push([x, y]); } return a; }
  const CONF = ['מאומת', 'גבוה', 'בינוני', 'נמוך'];

  /** opts: { base:'data/', city:'ashdod', center:{E,N} | siteId, radius_m (ברירת מחדל 1100) } */
  async function loadWorld(opts) {
    const G = root.PGEO, base = opts.base || 'data/';
    const manifest = await fetchJSON(base + 'cities/' + (opts.city || 'ashdod') + '/manifest.json');
    const tiles = manifest.tiles.slice();
    let center = opts.center;
    const raw = new Map();
    async function getTile(k) { if (!raw.has(k)) raw.set(k, Promise.all([fetchJSON(base + 'tiles/v/' + k + '.json.gz'), fetchBuf(base + 'tiles/t/' + k + '.bin.gz').catch(() => null)])); return raw.get(k); }
    if (!center && opts.siteTile) { const [v] = await getTile(opts.siteTile); const b = v.b.find(b => b.i === opts.siteId); if (b) { const ring = decodeRing(b.r[0], v.o[0], v.o[1]); const c = G.centroid(ring); center = { E: c[0], N: c[1] }; } }
    if (!center) { const [x0, y0, x1, y1] = manifest.bbox_itm; center = { E: (x0 + x1) / 2, N: (y0 + y1) / 2 }; }
    const R = opts.radius_m || 1100;
    const want = tiles.filter(k => { const [tx, ty] = k.split('_').map(Number); const dx = Math.max(tx * 1000 - center.E, 0, center.E - (tx + 1) * 1000), dy = Math.max(ty * 1000 - center.N, 0, center.N - (ty + 1) * 1000); return Math.hypot(dx, dy) < R; });
    const loaded = await Promise.all(want.map(k => getTile(k).then(r => [k, r]).catch(e => { console.warn('tile', k, e); return null; })));
    const O = { E: Math.round(center.E), N: Math.round(center.N) };
    const world = { origin: O, manifest, buildings: [], byId: new Map(), roads: [], sea: [], terrain: [], attribution: manifest.attribution || 'OSM (ODbL), SRTM' };
    for (const it of loaded) {
      if (!it) continue; const [k, [v, t]] = it;
      for (const b of v.b) {
        if (world.byId.has(b.i)) continue;
        const ring = G.dedupe(decodeRing(b.r[0], v.o[0], v.o[1]).map(p => [p[0] - O.E, p[1] - O.N])); if (ring.length < 3) continue;
        const c = G.centroid(ring);
        const B = { id: b.i, ring: G.ccw(ring), base: b.z / 10, height: b.h / 10, sigma: b.s / 10, floors: b.f, floorsRange: [b.fl, b.fh], conf: CONF[b.c] || '?', confIdx: b.c, src: b.src,
          type: b.t, name: b.n, area: b.a || G.area(ring), cx: c[0], cy: c[1], tile: k };
        B.bb = G.bbox(B.ring); world.buildings.push(B); world.byId.set(B.id, B);
      }
      for (const poly of v.sea || []) world.sea.push(poly.map(r => decodeRing(r, v.o[0], v.o[1]).map(p => [p[0] - O.E, p[1] - O.N])));
      for (const r of v.rd || []) world.roads.push({ name: r.n, cls: r.c, pts: decodeRing(r.r, v.o[0], v.o[1]).map(p => [p[0] - O.E, p[1] - O.N]) });
      if (t) {
        const dv = new DataView(t), tx = dv.getInt32(6, true), ty = dv.getInt32(10, true), nt = dv.getUint16(14, true), step = dv.getUint16(18, true);
        world.terrain.push({ key: k, x0: tx * 1000 - O.E, y1: (ty + 1) * 1000 - O.N, nt, step, z: new Int16Array(t.slice(20, 20 + nt * nt * 2)) });
      }
    }
    // דגימת קרקע בי-לינארית (גובה במטרים; ים/מחוץ לאזור → null)
    world.ground = function (x, y) {
      for (const T of world.terrain) {
        const k = (x - T.x0) / T.step, r = (T.y1 - y) / T.step; if (k < 0 || r < 0 || k > T.nt - 1 || r > T.nt - 1) continue;
        const k0 = Math.min(T.nt - 2, Math.floor(k)), r0 = Math.min(T.nt - 2, Math.floor(r)), fk = k - k0, fr = r - r0;
        const g = (rr, kk) => T.z[rr * T.nt + kk]; const a = g(r0, k0), b = g(r0, k0 + 1), c = g(r0 + 1, k0), d = g(r0 + 1, k0 + 1);
        if ([a, b, c, d].some(v => v === SEA || v === OUT)) { const ok = [a, b, c, d].filter(v => v !== SEA && v !== OUT); return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length / 10 : null; }
        return ((a * (1 - fk) + b * fk) * (1 - fr) + (c * (1 - fk) + d * fk) * fr) / 10;
      }
      return null;
    };
    world.near = (x, y, r) => world.buildings.filter(b => Math.hypot(b.cx - x, b.cy - y) <= r);
    world.SEA = SEA; world.OUT = OUT;
    return world;
  }
  root.PDATA = { loadWorld, fetchBuf, fetchJSON };
})(typeof self !== 'undefined' ? self : this);
