/* רחוב חי ביום (מחלקת האינטגרציה, 24.11.2026) — רחוב הארז / מועדון השחמט / השיטה / האורן, לפי תמונות היום 055–063.
 * חריגה אחת מהקפאת היכולות (אריאל, 24.11 00:50). קובץ אחד, ניתן להסרה: ?livestreet=0 מכבה הכול.
 * חלקים (דגל לכל חלק, ?ls_<חלק>=0/1):
 *   walk   — מדרכות: מרצפות אדומות מלבניות בקשר חצי-לבנה, פס בהיר ליד אבן השפה, אבן שפה אפורה, כחול-לבן בחניית נכים, מכסי ביוב עגולים
 *   walls  — קירות גינה מטויחים בז' + גדר עץ כהה מעליהם + שערי שלבים כהים; משוכות ושיחים צפופים, בוגנוויליה אדומה על הקירות
 *   poles  — עמודי חשמל בטון + חוטים עיליים (שקע קטנרי) + חיבורי בתים
 *   bins   — פחי אשפה ירוקים על גלגלים
 *   cars   — רכבים חונים (דגמי CC0 של מחלקת כלי הרכב, BatchedMesh + LOD): לאורך המדרכה המזרחית של הארז ובחניית המועדון
 *   trees  — עצים לפי מין דרך מודול הצמחייה (זית, וושינגטוניה, תמר, פיקוס; מעט קרובים בתלת־ממד, כרטיסים זולים רחוק);
 *            לא בתוך מסדרון המצלמה של תנוחות הלילה (006/008/015/032)
 *   facade — חומר חזית לבניינים שבקובץ הנתונים (טיח לבן / אפור / בז' / אבן עם פס) · typo — מיפוי חומר לפי טיפולוגיה ברדיוס 450 מ' (כבוי: הוריד את ציון היום)
 *   bovr   — עקיפות בניינים מקובץ הנתונים 63-livestreet.data.js (הסתרה/גובה/טיפוס/חומר חזית) — כל רשומה עם סיבה ומספר תמונה
 *   people — הולכי רגל: מוודא שיש כמה אנשים על המדרכות ליד השחקן ביום (מודול הדמויות; דליל)
 * כל הגאומטריה פרוצדורלית; אין כאן פיקסלים מהתמונות. מיקומי קירות/עמודים/רכבים — משוערים לפי קווי הרחוב והבניינים (לא מדידה).
 */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const OFF = qs.get('livestreet') === '0';
  const DEF = { walk: true, walls: true, poles: true, bins: true, cars: true, trees: true, bovr: true, facade: true, typo: false, people: true };
  const P = {}; for (const k in DEF) P[k] = !OFF && (qs.has('ls_' + k) ? qs.get('ls_' + k) !== '0' : DEF[k]);
  const DATA = window.YZ_LIVESTREET || { buildings: {}, trees: [], center: { E: 164750, N: 634161, r: 125 } };
  const S = { world: null, api: null, root: null, built: false, fleet: null, mats: [], geos: [], stats: {}, vegDone: false, t: 0 };
  window.YZLiveStreet = S;

  // ---------- עקיפות בניינים (לפני פענוח האריחים): הסתרה / גובה / קומות דרך YZ_BOVR (תיקון BD1–BD3 ב-world.js)
  if (P.bovr) {
    const ov = window.YZ_BOVR = window.YZ_BOVR || {};
    for (const id in DATA.buildings) { const r = DATA.buildings[id]; if ((!r.hide && !r.h) || (r.optIn && qs.get('ls_' + r.optIn) !== '1')) continue; if (ov[id] && !r.hide) continue;
      ov[id] = Object.assign({}, ov[id] || {}, r.hide ? { hide: 1 } : { h: r.h, f: r.floors, ty: r.ty }, { note: (r.tag || '') + ': ' + r.reason + ' (' + (r.photos || []).join(',') + ')' }); }
  }
  const MATS = { plaster: 0, stone: 1, concrete: 2, glass: 3, club_plaster: 4, grey_render: 5, beige_block: 6, stone_stripe: 7 };
  function hookHints(world) {
    if (!(P.bovr || P.facade) || !world || !world.providers || S.hinted) return false; S.hinted = true;
    const prev = world.providers.buildingHints, C = DATA.center, T = DATA.typology;
    const look = (id, b, tk) => !prev ? null : typeof prev === 'function' ? prev(id, b, tk) : prev instanceof Map || typeof prev.get === 'function' ? prev.get(id) : prev[id];
    world.providers.buildingHints = (id, b, tk) => {
      const base = look(id, b, tk), r0 = P.bovr && DATA.buildings[id], r = r0 && (!r0.optIn || qs.get('ls_' + r0.optIn) === '1') ? r0 : null;
      if (r) { const h = Object.assign({}, base || {}); if (r.ty) h.ty = r.ty; if (r.floors) h.floors = r.floors; if (r.h) h.h = r.h; if (r.rs) h.rs = r.rs; if (r.m && P.facade) h.m = MATS[r.m]; h.src = 'livestreet ' + (r.tag || '') + ' (' + (r.photos || []).join(',') + ')'; return h; }
      if (P.typo && T && b && world.coords.toScene) { const c = world.coords.toScene(C.E, C.N); if (Math.hypot(b.cx - c.x, b.cz - c.z) < T.r) {
        const ty = world.G27 && world.G27.W && world.G27.W.tyOf ? world.G27.W.tyOf(b) : (b.floors >= 12 ? 'tower' : b.floors <= 2 ? 'villa' : 'block'); const pal = T[ty];
        if (pal && pal.length) { const s = (parseInt(String(id).replace(/\D/g, '').slice(-6), 10) || 0) % pal.length; return Object.assign({}, base || {}, { m: MATS[pal[s]], src: (base && base.src ? base.src + ' + ' : '') + 'livestreet ' + T.tag }); } } }
      return base;
    };
    return true;
  }
  try { hookHints(window.YZW && YZW.world); } catch (e) { /* */ }

  // ---------- עזרים
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash = (x, z, k) => { let h = Math.imul((x * 73856093) ^ (z * 19349663) ^ (k * 83492791), 0x9E3779B1); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
  const lin = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  function G() { return { p: [], n: [], c: [], u: [] }; }
  function tri(A, a, b, c, col, uv) { const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (ny < -0.5) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; if (uv) uv = [uv[0], uv[2], uv[1]]; }   // משטחים אופקיים תמיד כלפי מעלה (שני צדי הרחוב)
    for (const [q, k] of [[a, 0], [b, 1], [c, 2]]) { A.p.push(q[0], q[1], q[2]); A.n.push(nx, ny, nz); A.c.push(col[0], col[1], col[2]); if (uv) A.u.push(uv[k][0], uv[k][1]); } }
  function quad(A, a, b, c, d, col, uv) { tri(A, a, b, c, col, uv && [uv[0], uv[1], uv[2]]); tri(A, a, c, d, col, uv && [uv[0], uv[2], uv[3]]); }
  // קופסה מכוונת: מרכז בסיס (x,y,z), כיוון u (יחידה במישור), רוחב לאורך u, עומק לאורך הנורמל, גובה
  function obox(A, x, y, z, ux, uz, len, dep, h, col, colTop) {
    const vx = -uz, vz = ux, hl = len / 2, hd = dep / 2;
    const P_ = (a, b, yy) => [x + ux * a + vx * b, yy, z + uz * a + vz * b];
    const c0 = P_(-hl, -hd, y), c1 = P_(hl, -hd, y), c2 = P_(hl, hd, y), c3 = P_(-hl, hd, y), d0 = P_(-hl, -hd, y + h), d1 = P_(hl, -hd, y + h), d2 = P_(hl, hd, y + h), d3 = P_(-hl, hd, y + h);
    quad(A, c0, c1, d1, d0, col); quad(A, c1, c2, d2, d1, col); quad(A, c2, c3, d3, d2, col); quad(A, c3, c0, d0, d3, col); quad(A, d0, d1, d2, d3, colTop || col);
  }
  function cyl(A, x, y, z, r0, r1, h, seg, col) { for (let i = 0; i < seg; i++) { const a0 = i / seg * 6.2832, a1 = (i + 1) / seg * 6.2832;
    quad(A, [x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0], [x + Math.cos(a1) * r1, y + h, z + Math.sin(a1) * r1], [x + Math.cos(a0) * r1, y + h, z + Math.sin(a0) * r1], col); } }
  function disc(A, x, y, z, r, seg, col) { for (let i = 0; i < seg; i++) { const a0 = i / seg * 6.2832, a1 = (i + 1) / seg * 6.2832; tri(A, [x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], col); } }
  function mesh(A, mat, name) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3)); if (A.u.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(A.u, 2)); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); S.geos.push(g); return m; }
  function pip(px, pz, p, n) { let ins = false; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) ins = !ins; } return ins; }

  // ---------- מרקמים (פרוצדורליים)
  function paverTex() {   // מרצפות מלבניות 20×10 ס"מ בקשר חצי-לבנה; גוון בבהירות בלבד — הצבע מגיע מצבעי הקודקוד (אדום / פס בהיר)
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), R = rng(5);
    g.fillStyle = '#a6a6a6'; g.fillRect(0, 0, 256, 256);
    const bw = 256 / 5, bh = 256 / 10;
    for (let r = 0; r < 10; r++) for (let k = -1; k < 6; k++) { const x = k * bw + (r % 2) * bw / 2, y = r * bh, v = 236 + (R() - 0.5) * 34;
      g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      for (let s = 0; s < 6; s++) { const w = (R() - 0.5) * 26; g.fillStyle = w > 0 ? `rgba(255,255,255,${(w / 120).toFixed(3)})` : `rgba(0,0,0,${(-w / 120).toFixed(3)})`; g.fillRect(x + 2 + R() * (bw - 8), y + 2 + R() * (bh - 6), 3 + R() * 6, 2 + R() * 3); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function slatTex() {   // שלבי עץ כהים אנכיים עם מרווחים — גדרות ושערים (057/058/062)
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d'), R = rng(9);
    g.fillStyle = '#1b1714'; g.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 16; i++) { const v = 0.85 + R() * 0.3; g.fillStyle = `rgb(${(78 * v) | 0},${(68 * v) | 0},${(58 * v) | 0})`; g.fillRect(i * 8 + 1, 0, 6, 64);
      for (let s = 0; s < 5; s++) { g.fillStyle = `rgba(0,0,0,${(0.08 + R() * 0.1).toFixed(2)})`; g.fillRect(i * 8 + 1 + R() * 5, R() * 64, 1, 6 + R() * 18); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---------- בניית הרחוב
  const FAR_NIGHT = ['015', '032'];   // תנוחות לילה רחוקות מהארז: מה שבמסדרון המבט שלהן מוצג רק ביום (015 הורע ב-3.5% כשהוצג גם בלילה)
  const NIGHT_POSES = [['006', 164761.9, 634188.8, 246.2], ['008', 164765.1, 634196.1, 257.8], ['015', 164655, 634174, 278], ['032', 164765, 634043, 281.5]];
  function inNightCorridor(world, x, z, margin, only) {   // בתוך חרוט המבט (±34°) של תנוחת לילה כלשהי עד 260 מ'
    for (const [id, E, N, hd] of NIGHT_POSES) { if (only && !only.includes(id)) continue; const s = world.coords.toScene(E, N), dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz); if (d > 260 || d < 1) continue;
      const h = hd * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h), cosA = (dx * fx + dz * fz) / d; if (cosA > Math.cos((34 + (margin || 0)) * Math.PI / 180)) return true; }
    return false;
  }
  function build(world) {
    const W = world.data.W, H = (x, z) => Math.max(0, world.data.H(x, z)), C = world.coords.toScene(DATA.center.E, DATA.center.N), R0 = DATA.center.r;
    const roads = [], blds = [];
    for (const t of W.tiles.values()) { for (const r of t.roads || []) { const p = r.p; let near = false; for (let i = 0; i < p.length; i += 2) if (Math.hypot(p[i] - C.x, p[i + 1] - C.z) < R0 + 40) { near = true; break; } if (near) roads.push(r); }
      for (const b of t.blds || []) if (Math.hypot(b.cx - C.x, b.cz - C.z) < R0 + 60) blds.push(b); }
    if (!roads.some(r => r.c === 2 && r.name === 'הארז')) return false;
    const inB = (x, z, pad) => { for (const b of blds) { if (x < b.minx - pad || x > b.maxx + pad || z < b.minz - pad || z > b.maxz + pad) continue; if (pip(x, z, b.p, b.n)) return b; if (pad > 0) { for (const [ox, oz] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad]]) if (pip(x + ox, z + oz, b.p, b.n)) return b; } } return null; };
    const roadDist = (x, z, skip) => { let bd = 1e9, bw = 0; for (const r of roads) { if (r === skip) continue; const p = r.p; for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, l2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), d = Math.hypot(ax + dx * t - x, az + dz * t - z) - r.w / 2; if (d < bd) { bd = d; bw = r.w; } } } return bd; };
    // שתי קבוצות: SN = תמיד; SD = רק ביום (שמש > 5°) — מה שהפריע לזוגות הלילה (מסדרון 015/032, רכב/עמוד בנקודת צלם)
    const SN = { walk: G(), prop: G(), fence: G(), hedge: [], bins: [] }, SD = { walk: G(), prop: G(), fence: G(), hedge: [], bins: [] };
    let A_walk = SN.walk, A_prop = SN.prop, A_fence = SN.fence, hedge = SN.hedge, bins = SN.bins; const walkPts = [], poles = [], cars = [], trees = [];
    const RED = lin('#e8ae98'), RED2 = lin('#dfa38d'), STRIPE = lin('#f2efe9'), KERB = lin('#c4c1ba'), KERBT = lin('#dedbd4'), BLUE = lin('#2c5fa8'), WHITE = lin('#e9e9e6'),
      WALL = [lin('#d8cdb9'), lin('#e0d8c8'), lin('#cfc3ad'), lin('#e6e1d6')], CAP = lin('#c9c1b2'), MH = lin('#4b4a47'), MH2 = lin('#6a6863'), POLE = lin('#9a9893'), BIN = lin('#2f6b3a'), BINL = lin('#285a31'),
      PAINT_B = lin('#2b5fae'), LINEW = lin('#dcdcd8');
    const SW = 2.4, KW = 0.16, Y_RD = 0.13, Y_SW = 0.25;
    let wallM = 0, walkM = 0, disabledDone = 0;
    const R = rng(2411), rej = [0, 0, 0, 0, 0], erezRej = {};
    for (const r of roads) {
      if (r.c !== 2 && r.c !== 1) continue; const p = r.p, n = p.length / 2, hw = r.w / 2; const isErez = r.name === 'הארז';
      for (let i = 0; i < n - 1; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 2) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        for (const side of [-1, 1]) {
          const nx = -uz * side, nz = ux * side; const STEP = 1.0, ns = Math.floor(L / STEP);
          // דגימות: מדרכה תקינה = בתוך הרדיוס, לא בצומת (רחוק מכביש אחר), לא בתוך בניין
          const ok = [], dayArr = []; for (let s = 0; s <= ns; s++) { const t = s * STEP + STEP / 2; if (t > L) { ok.push(false); continue; } const cx = ax + ux * t, cz = az + uz * t;
            const mx = cx + nx * (hw + 0.8), mz = cz + nz * (hw + 0.8);
            dayArr[s] = inNightCorridor(world, cx, cz, 0, FAR_NIGHT); const c1 = Math.hypot(cx - C.x, cz - C.z) < R0, c2 = c1 && roadDist(mx, mz, r) > 1.2, c3 = c2 && roadDist(cx + nx * (hw + 0.3), cz + nz * (hw + 0.3), r) > 0.5, c4 = c3 && !inB(mx, mz, 0);
            rej[c1 ? c2 ? c3 ? c4 ? 4 : 3 : 2 : 1 : 0]++; ok.push(c4); if (isErez) { const k = (side > 0 ? 'W' : 'E') + (c1 ? c2 ? c3 ? c4 ? 4 : 3 : 2 : 1 : 0); erezRej[k] = (erezRej[k] || 0) + 1; } }
          for (let s = 0; s < ns; s++) {
            if (!ok[s]) continue; { const SS = dayArr[s] ? SD : SN; A_walk = SS.walk; A_prop = SS.prop; A_fence = SS.fence; hedge = SS.hedge; bins = SS.bins; } const t0 = s * STEP, t1 = Math.min(L, t0 + STEP); const x0 = ax + ux * t0, z0 = az + uz * t0, x1 = ax + ux * t1, z1 = az + uz * t1;
            const h0 = H(x0, z0), h1 = H(x1, z1);
            const disabled = isErez && nx > 0 && t0 >= 23 && t0 < 28;   // חניית נכים אחת בצד המזרחי של הארז (057/058; מיקום משוער)
            if (P.walk) {
              const kin = hw, kout = hw + KW; const wout = hw + SW;   // רוחב מלא גם כשטביעת הבניין נכנסת למדרכה (062: מדרכה ~2.4 מ' עד החזית; הטביעה כנראה מוסטת ~1 מ')
              const at = (t, h, l, y) => { const x = ax + ux * t + nx * l, z = az + uz * t + nz * l; return [x, H(x, z) + y, z]; };
              // אבן שפה: פאה לכביש + פאה עליונה (כחול-לבן בחניית נכים)
              const kc = disabled ? ((s % 2) ? BLUE : WHITE) : KERB, kt = disabled ? kc : KERBT;
              quad(A_prop, at(t0, h0, kin, Y_RD - 0.04), at(t1, h1, kin, Y_RD - 0.04), at(t1, h1, kin, Y_SW + 0.01), at(t0, h0, kin, Y_SW + 0.01), kc);
              quad(A_prop, at(t0, h0, kin, Y_SW + 0.01), at(t1, h1, kin, Y_SW + 0.01), at(t1, h1, kout, Y_SW + 0.01), at(t0, h0, kout, Y_SW + 0.01), kt);
              // פס בהיר (2 שורות מרצפות) + מרצפות אדומות; uv במטרים (1 מ' = אריח מרקם)
              const sl = kout + 0.42, rc = hash(s, i, 3) < 0.5 ? RED : RED2;
              quad(A_walk, at(t0, h0, kout, Y_SW), at(t1, h1, kout, Y_SW), at(t1, h1, sl, Y_SW), at(t0, h0, sl, Y_SW), STRIPE, [[t0, kout], [t1, kout], [t1, sl], [t0, sl]]);
              quad(A_walk, at(t0, h0, sl, Y_SW), at(t1, h1, sl, Y_SW), at(t1, h1, wout, Y_SW), at(t0, h0, wout, Y_SW), rc, [[t0, sl], [t1, sl], [t1, wout], [t0, wout]]);
              walkM += STEP; if (s % 4 === 0) walkPts.push(ax + ux * t0 + nx * (hw + 1.2), az + uz * t0 + nz * (hw + 1.2));
              if (s % 23 === 11) { const mx = ax + ux * (t0 + 0.5) + nx * (hw + 1.5), mz = az + uz * (t0 + 0.5) + nz * (hw + 1.5); disc(A_prop, mx, h0 + Y_SW + 0.012, mz, 0.36, 12, MH2); disc(A_prop, mx, h0 + Y_SW + 0.016, mz, 0.29, 12, MH); }
              if (disabled && s === 23) { const l0 = hw - 2.5, l1 = hw - 0.05;   // צבע כחול על הכביש + קווים לבנים (058)
                const at2 = (t, l) => [ax + ux * t + nx * l, H(ax + ux * t, az + uz * t) + Y_RD + 0.008, az + uz * t + nz * l];
                quad(A_prop, at2(t0, l0), at2(t0, l1), at2(Math.min(L, t0 + 5), l1), at2(Math.min(L, t0 + 5), l0), PAINT_B);
                for (const tt of [t0, Math.min(L, t0 + 5) - 0.12]) quad(A_prop, at2(tt, l0), at2(tt, l1), at2(tt + 0.12, l1).map((v, k) => k === 1 ? v + 0.001 : v), at2(tt + 0.12, l0).map((v, k) => k === 1 ? v + 0.001 : v), LINEW);
                disabledDone++; }
            }
            // קיר גינה + גדר + משוכה: רק כשיש בניין עד 16 מ' מאחורי קו הקיר (מגרש מגורים), ולא בתוך בניין
            const wl = hw + SW + 0.12, wx = ax + ux * (t0 + 0.5) + nx * wl, wz = az + uz * (t0 + 0.5) + nz * wl;
            let lot = null; if (P.walls) for (const d of [3, 6, 9, 12, 16]) { lot = inB(wx + nx * d, wz + nz * d, 0); if (lot) break; }
            if (P.walls && lot && !inB(wx, wz, 0.25) && !(lot.id === 'w543568895')) {
              const lotSeed = parseInt(String(lot.id).replace(/\D/g, '').slice(-5), 10) || 7, style = lotSeed % 3, gate = ((s + lotSeed) % 13) === 0;
              const hWall = style === 1 ? 1.75 : 1.15 + (lotSeed % 5) * 0.06, hFence = style === 0 ? 0.75 : style === 2 ? 0.55 : 0, hy = H(wx, wz), wc = WALL[lotSeed % 4];
              if (gate) { const g0 = [wx - ux * 0.5, hy + 0.02, wz - uz * 0.5], g1 = [wx + ux * 0.5, hy + 0.02, wz + uz * 0.5];   // שער שלבים כהה
                quad(A_fence, g0, g1, [g1[0], hy + 1.95, g1[2]], [g0[0], hy + 1.95, g0[2]], [1, 1, 1], [[0, 0], [2, 0], [2, 1], [0, 1]]);
                quad(A_fence, g1, g0, [g0[0], hy + 1.95, g0[2]], [g1[0], hy + 1.95, g1[2]], [0.8, 0.8, 0.8], [[0, 0], [2, 0], [2, 1], [0, 1]]);
                if (P.bins && ((s + lotSeed) % 2 === 0)) bins.push([wx - nx * 0.55 + ux * 0.9, hy + Y_SW, wz - nz * 0.55 + uz * 0.9, Math.atan2(nx, nz)]);
              } else {
                obox(A_prop, wx, hy - 0.2, wz, ux, uz, 1.0, 0.2, hWall + 0.2, wc, CAP); wallM += 1;
                if (hFence > 0) { const f0 = [wx - ux * 0.5, hy + hWall, wz - uz * 0.5], f1 = [wx + ux * 0.5, hy + hWall, wz + uz * 0.5], top = hy + hWall + hFence;
                  quad(A_fence, f0, f1, [f1[0], top, f1[2]], [f0[0], top, f0[2]], [1, 1, 1], [[0, 0], [2, 0], [2, hFence], [0, hFence]]);
                  quad(A_fence, f1, f0, [f0[0], top, f0[2]], [f1[0], top, f1[2]], [0.8, 0.8, 0.8], [[0, 0], [2, 0], [2, hFence], [0, hFence]]); }
                // משוכות / שיחים צפופים מעבר לקיר (055/057/058/062), בוגנוויליה על חלק מהקירות
                const hv = hash(s, lotSeed, 7); if (hv < 0.8) { const boug = hash(s >> 2, lotSeed, 9) < 0.22, sz = boug ? 0.75 + hv * 0.5 : 1.1 + hv * 1.6;   // בוגנוויליה: גושים קטנים שנשפכים מעל הקיר
                  hedge.push([wx + nx * (boug ? 0.15 : 0.75) + ux * (hv - 0.4), hy + hWall + (boug ? 0.05 : -0.55) + sz * 0.25, wz + nz * (boug ? 0.15 : 0.75) + uz * (hv - 0.4), sz, boug ? 1 : 0, hv]); }
                if (P.trees && !dayArr[s] && s % 9 === (lotSeed % 9) && hash(s, lotSeed, 13) < 0.55) trees.push({ x: wx + nx * 3.2, z: wz + nz * 3.2, sp: ['OLEA', 'WASH', 'OLEA', 'PHOE', 'FMIC', 'WASH', 'CERA'][(lotSeed + s) % 7], crown: 6 });
              }
            }
            // עמודי חשמל: צד אחד לכל רחוב (בהארז — מערבי, 055), כל ~32 מ'
            if (P.poles && side === 1 && s % 30 === 12) { const px = ax + ux * (t0 + 0.5) + nx * (hw + 0.45), pz = az + uz * (t0 + 0.5) + nz * (hw + 0.45); poles.push({ x: px, y: H(px, pz) + Y_SW, z: pz, ux, uz, nx, nz, r, day: !!dayArr[s] }); }
            // רכבים חונים: מקבילים בצד המזרחי של הארז (055/062), מרווחים ופערים
            if (P.cars && isErez && nx > 0 && s % 6 === 0 && t0 > 6 && t0 < L - 10 && (t0 + 5.2 < 23 || t0 > 28) && hash(s, 1, 17) < 0.8) cars.push({ x: ax + ux * (t0 + 2.6) + nx * (hw - 1.15), z: az + uz * (t0 + 2.6) + nz * (hw - 1.15), h: Math.atan2(-ux, -uz) + (hash(s, 2, 3) - 0.5) * 0.06 });
            if (P.cars && isErez && nx > 0 && s === 23) cars.push({ x: ax + ux * 25.5 + nx * (hw - 1.15), z: az + uz * 25.5 + nz * (hw - 1.15), h: Math.atan2(-ux, -uz), colour: '#26282c', type: 'suv' });
          }
        }
      }
    }
    A_walk = SN.walk; A_prop = SN.prop; A_fence = SN.fence; hedge = SN.hedge; bins = SN.bins;
    // חניית מועדון השחמט: שורה של רכבים בניצב לחזית (061/063); לפי מלבן הבניין
    if (P.cars) { const cb = world.data.buildingById('w543568895'); if (cb) { const o = obb(cb), end = { x: -1500, z: 210 }; const sgn = ((end.x - o.cx) * o.vx + (end.z - o.cz) * o.vz) >= 0 ? 1 : -1, fx = o.vx * sgn, fz = o.vz * sgn;
      const COLS = ['#e9ebec', '#e9ebec', '#a9adb1', '#4a4e53', '#e9ebec', '#e9ebec', '#8b9096', '#e9ebec'], TYP = ['hatch', 'suv', 'suv', 'sedan', 'hatch', 'mini', 'suv', 'sedan'];
      for (let k = 0; k < 8; k++) { const a = -o.L / 2 + 2.2 + k * 2.75; if (a > o.L / 2 - 1) break; const d = o.D / 2 + 1.6 + 0.4 + 2.35; cars.push({ x: o.cx + o.ux * a + fx * d, z: o.cz + o.uz * a + fz * d, h: Math.atan2(fx, fz) + (hash(k, 5, 5) - 0.5) * 0.08, colour: COLS[k], type: TYP[k] }); } } }   // חונים ברוורס — החזית לרחוב (061/063)
    // נקודות הצלם (קובץ הנתונים): בלי רכב שעומד על מקום הצלם (3.2 מ') ובלי עמוד עד 5 מ'
    const FREE = (DATA.freeSpots || []).map(([E, N]) => world.coords.toScene(E, N)), nearFree = (x, z, r) => FREE.some(f => Math.hypot(f.x - x, f.z - z) < r);
    for (const c of cars) if (nearFree(c.x, c.z, 3.2)) c.day = true;   // לא נמחקים — מוצגים רק ביום
    for (const q of poles) if (nearFree(q.x, q.z, 5)) q.day = true;
    // עמודים + חוטים
    const wiresN = [], wiresD = []; let wires = wiresN;
    if (P.poles) { const byRoad = new Map(); for (const q of poles) { if (!byRoad.has(q.r)) byRoad.set(q.r, []); byRoad.get(q.r).push(q); }
      for (const q of poles) { A_prop = q.day ? SD.prop : SN.prop; cyl(A_prop, q.x, q.y - 0.3, q.z, 0.17, 0.10, 9.3, 6, POLE); obox(A_prop, q.x, q.y + 8.2, q.z, q.nx, q.nz, 1.6, 0.1, 0.1, POLE);
        disc(A_prop, q.x, q.y + 9.0, q.z, 0.1, 6, POLE); } A_prop = SN.prop;
      const sag = (a, b, n, s) => { for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n, y = t => a[1] + (b[1] - a[1]) * t - s * 4 * t * (1 - t); wires.push(a[0] + (b[0] - a[0]) * t0, y(t0), a[2] + (b[2] - a[2]) * t0, a[0] + (b[0] - a[0]) * t1, y(t1), a[2] + (b[2] - a[2]) * t1); } };
      for (const list of byRoad.values()) for (let k = 0; k < list.length - 1; k++) { const a = list[k], b = list[k + 1]; if (Math.hypot(a.x - b.x, a.z - b.z) > 45) continue; wires = a.day || b.day ? wiresD : wiresN;
        for (const off of [-0.7, 0, 0.7]) sag([a.x + a.nx * off, a.y + 8.25, a.z + a.nz * off], [b.x + b.nx * off, b.y + 8.25, b.z + b.nz * off], 8, 0.55); }
      for (const q of poles) { wires = q.day ? wiresD : wiresN; for (const side of [1, -1]) { const d = 9 + hash(q.x | 0, side, 3) * 4, tx = q.x + q.nx * side * d + q.ux * 4, tz = q.z + q.nz * side * d + q.uz * 4;   // חיבורי בתים (055)
        sag([q.x, q.y + 7.6, q.z], [tx, H(tx, tz) + 4.2, tz], 6, 0.35); } } }
    // ---------- רשתות (פעמיים: הקבוצה הקבועה והקבוצה של היום בלבד; המרקמים משותפים)
    const T = THREE, TX = {};
    const emit = (A_walk, A_prop, A_fence, wires, hedge, bins, parent) => {
    if (A_walk.p.length) { const m = new T.MeshLambertMaterial({ vertexColors: true, map: TX.pav || (TX.pav = paverTex()), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }); m.name = 'livestreet.pavers'; S.mats.push(m);
      const ms = mesh(A_walk, m, 'livestreet:pavers'); ms.receiveShadow = true; parent.add(ms); }
    if (A_prop.p.length) { const m = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }); m.name = 'livestreet.props'; S.mats.push(m); const ms = mesh(A_prop, m, 'livestreet:props'); ms.castShadow = world.quality.tier !== 'low'; ms.receiveShadow = true; parent.add(ms); }
    if (A_fence.p.length) { const m = new T.MeshLambertMaterial({ vertexColors: true, map: TX.slat || (TX.slat = slatTex()) }); m.name = 'livestreet.fence'; S.mats.push(m); parent.add(mesh(A_fence, m, 'livestreet:fences')); }
    if (wires.length) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(wires, 3)); const m = new T.LineBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.85 }); S.mats.push(m); S.geos.push(g);
      const l = new T.LineSegments(g, m); l.name = 'livestreet:wires'; l.matrixAutoUpdate = false; parent.add(l); }
    if (hedge.length) { const g = new T.IcosahedronGeometry(0.5, 0); const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), k = 0.82 + 0.36 * hash(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50) + 3); pa.setXYZ(i, x * k, y * k * 0.8, z * k); } g.computeVertexNormals(); S.geos.push(g);
      const m = new T.MeshLambertMaterial({ color: 0xffffff }); m.name = 'livestreet.hedge'; S.mats.push(m);
      const im = new T.InstancedMesh(g, m, hedge.length); im.name = 'livestreet:hedges'; const M = new T.Matrix4(), q = new T.Quaternion(), c = new T.Color();
      hedge.forEach((h, i) => { const sx = h[3] * (1.3 + h[5] * 0.6), sy = h[3] * (h[4] ? 0.75 : 1.0), sz = h[3] * 1.05; q.setFromAxisAngle(new T.Vector3(0, 1, 0), h[5] * 6.28); M.compose(new T.Vector3(h[0], h[1], h[2]), q, new T.Vector3(sx, sy, sz)); im.setMatrixAt(i, M);
        if (h[4]) c.setRGB(0.42 + 0.12 * h[5], 0.06, 0.13 + 0.06 * h[5]); else c.setRGB(0.16 + 0.08 * h[5], 0.30 + 0.12 * h[5], 0.10 + 0.04 * h[5]); im.setColorAt(i, c); });
      im.castShadow = world.quality.tier !== 'low'; im.receiveShadow = true; parent.add(im); }
    if (bins.length) { const A = G(); obox(A, 0, 0, 0, 1, 0, 0.58, 0.72, 1.0, BIN); obox(A, 0, 1.0, -0.02, 1, 0, 0.62, 0.78, 0.06, BINL); const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(A.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(A.n, 3)); g.setAttribute('color', new T.Float32BufferAttribute(A.c, 3)); S.geos.push(g);
      const m = new T.MeshLambertMaterial({ vertexColors: true }); S.mats.push(m); const im = new T.InstancedMesh(g, m, bins.length); im.name = 'livestreet:bins'; const M = new T.Matrix4(), q = new T.Quaternion();
      bins.forEach((b, i) => { q.setFromAxisAngle(new T.Vector3(0, 1, 0), b[3]); M.compose(new T.Vector3(b[0], b[1], b[2]), q, new T.Vector3(1, 1, 1)); im.setMatrixAt(i, M); }); im.castShadow = world.quality.tier !== 'low'; parent.add(im); }
    };
    emit(SN.walk, SN.prop, SN.fence, wiresN, SN.hedge, SN.bins, S.root);
    S.dayGroup = new THREE.Group(); S.dayGroup.name = 'livestreet:dayOnly'; S.root.add(S.dayGroup);
    emit(SD.walk, SD.prop, SD.fence, wiresD, SD.hedge, SD.bins, S.dayGroup);
    A_walk = SN.walk; A_prop = SN.prop; A_fence = SN.fence; hedge = SN.hedge.concat(SD.hedge); bins = SN.bins.concat(SD.bins); wires = wiresN.concat(wiresD);
    S.stats = { rej: rej.join('/'), erezRej, carsDay: cars.filter(c => c.day).length, polesDay: poles.filter(q => q.day).length, nRoads: roads.length, walkM, wallM, poles: poles.length, wireSegs: wires.length / 6, hedges: hedge.length, bins: bins.length, cars: cars.length, treesPlanned: trees.length, disabled: disabledDone,
      tris: (A_walk.p.length + A_prop.p.length + A_fence.p.length) / 9 + hedge.length * 20 + bins.length * 20 };
    S.cars = cars; S.trees = trees; S.walkPts = walkPts; return true;
  }
  function obb(b) {
    const p = b.p, n = b.n; let best = 0, bi = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]); if (l > best) { best = l; bi = i; } }
    const j = (bi + 1) % n, ux = (p[j * 2] - p[bi * 2]) / best, uz = (p[j * 2 + 1] - p[bi * 2 + 1]) / best, vx = -uz, vz = ux;
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (let i = 0; i < n; i++) { const a = p[i * 2] * ux + p[i * 2 + 1] * uz, c = p[i * 2] * vx + p[i * 2 + 1] * vz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, c); b1 = Math.max(b1, c); }
    const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2; return { cx: ca * ux + cb * vx, cz: ca * uz + cb * vz, ux, uz, vx, vz, L: a1 - a0, D: b1 - b0 };
  }
  // ---------- רכבים חונים (מחלקת כלי הרכב)
  async function cars(world, api) {
    if (!S.cars || !S.cars.length) return;
    if (!window.ESH_GLTF) await api.loadScript('vendor/loaders.js');
    if (!window.ESH_VEHICLES) await api.loadScript('mods/vehicles/vehicles.js');
    const V = window.ESH_VEHICLES; await V.init({ base: 'mods/vehicles/models/', renderer: world.renderer, tier: world.quality.tier });
    const H = (x, z) => Math.max(0, world.data.H(x, z)), R = rng(77);
    const PAL = [[42, '#e9ebec'], [20, '#a9adb1'], [14, '#8b9096'], [14, '#26282c'], [6, '#4a4e53'], [4, '#1f355e']];   // לבן/כסוף/אפור/שחור — לפי 055/059/060/061/063
    const pick = () => { let u = R() * 100; for (const [w, c] of PAL) { if ((u -= w) <= 0) return c; } return '#e9ebec'; };
    const TY = ['hatch', 'sedan', 'suv', 'mini', 'hatch', 'suv', 'mpv'];
    const slots = S.cars.map((c, i) => ({ x: c.x, y: H(c.x, c.z) + 0.13, z: c.z, h: c.h, type: c.type || TY[(i * 5 + 3) % TY.length], colour: c.colour || pick() }));
    const low = world.quality.tier === 'low';
    const opt = { seed: 24, shadows: !low, blobs: true, lod: low ? [9, 45] : [22, 90], cull: low ? 60 : 160 };
    const sN = slots.filter((q, i) => !S.cars[i].day), sD = slots.filter((q, i) => S.cars[i].day);
    if (sN.length) { S.fleet = await V.parked(sN, opt); if (low) S.fleet.o.lod = [9, 45]; S.root.add(S.fleet.object); }   // חסכונית: LOD0 רק עד 9 מ', ומעבר ל-60 מ' לא מציירים
    if (sD.length) { S.fleetDay = await V.parked(sD, Object.assign({}, opt, { seed: 25 })); if (low) S.fleetDay.o.lod = [9, 45]; S.dayGroup.add(S.fleetDay.object); }   // רכבים בנקודות צלם הלילה — רק ביום
  }
  // ---------- עצים לפי מין (מודול הצמחייה)
  function plantTrees(world) {
    const VG = window.YZVeg && window.YZVeg.veg; if (!VG || S.vegDone) return false;
    const list = []; const add = (x, z, sp, crown, h) => { if (inNightCorridor(world, x, z, 4)) { S.stats.treesSkippedNight = (S.stats.treesSkippedNight || 0) + 1; return; } list.push({ x, z, species: sp, maxCrown: crown, h }); };
    for (const t of S.trees || []) add(t.x, t.z, t.sp, t.crown);
    for (const t of DATA.trees || []) { const s = world.coords.toScene(t.E, t.N); add(s.x, s.z, t.sp, t.crown, t.h); }
    if (P.bovr) for (const id in DATA.buildings) { const r = DATA.buildings[id]; if (!r.hide || !r.replace || (r.optIn && qs.get('ls_' + r.optIn) !== '1')) continue; const b = findRaw(world, id); if (!b) continue;
      for (const q of r.replace) add(b.x + q.dE, b.z - q.dN, q.sp, q.crown, q.h); }
    if (!list.length) { S.vegDone = true; return true; }
    const byKey = new Map(); for (const q of list) { const E = q.x + world.data.W.OX, N = world.data.W.OY - q.z, key = Math.floor(E / 1000) + '_' + Math.floor(N / 1000); if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(q); }
    let n = 0; for (const [key, sl] of byKey) { try { n += VG.fillSlots(key, sl) || 0; } catch (e) { console.warn('[livestreet] trees', e); } }
    if (!n) return false; S.stats.trees = n; S.vegDone = true; return true;
  }
  function findRaw(world, id) {   // בניין מוסתר לא נמצא ב-t.blds — המרכז נשמר ב-YZ_BOVR_HIDDEN (תיקון BD3)
    const h = window.YZ_BOVR_HIDDEN && window.YZ_BOVR_HIDDEN[id]; if (h) return h;
    const b = world.data.buildingById(id); return b ? { x: b.cx, z: b.cz } : null;
  }
  // ---------- הולכי רגל: כמה אנשים על המדרכות ביום (מודול הדמויות)
  // ביום (שמש > 4°): אם פחות מ-3 הולכי רגל עד 55 מ' מהשחקן — מעבירים עד 2 הולכים רחוקים (>150 מ') לנקודת מדרכה מאחורי המצלמה, עם יעד לאורך הרחוב.
  // דליל בכוונה (בתמונות 055–063 כמעט אין אנשים); עלות: בדיקה אחת ל-6 ש', בלי גאומטריה חדשה.
  function people(world) {
    const N = window.G27NPC, sim = N && N.sim; if (!sim || !S.walkPts || !S.walkPts.length || world.sun.elevation < 4) return;
    const pp = world.player.pos, cam = world.camera, C = world.coords.toScene(DATA.center.E, DATA.center.N); if (Math.hypot(pp.x - C.x, pp.z - C.z) > DATA.center.r + 60) return;
    const fd = new THREE.Vector3(); cam.getWorldDirection(fd); let near = 0; const far = [];
    for (const a of sim.agents) { if (a.state !== 'walk') continue; const d = Math.hypot(a.x - pp.x, a.z - pp.z); if (d < 55) near++; else if (d > 150 && far.length < 4) far.push(a); }
    const st = S.stats.people = S.stats.people || { near: 0, moved: 0 }; st.near = near; if (near >= 3) return;
    const W = S.walkPts, cand = []; for (let i = 0; i < W.length; i += 2) { const dx = W[i] - pp.x, dz = W[i + 1] - pp.z, d = Math.hypot(dx, dz); if (d > 22 && d < 55 && (dx * fd.x + dz * fd.z) < 0) cand.push(i); }
    for (let k = 0; k < Math.min(2, 3 - near, far.length) && cand.length; k++) { const a = far[k], i = cand[(Math.random() * cand.length) | 0], j = cand[(Math.random() * cand.length) | 0];
      a.x = W[i]; a.z = W[i + 1]; a.target = { x: W[j], z: W[j + 1] }; a.path = null; a.pi = 0; sim.pathQueue.push(a); st.moved++; }
  }

  YZW.register({
    id: 'livestreet', name: 'רחוב חי ביום: מדרכות, קירות, שיחים, עמודים, רכבים, עצים', dept: 'integration', order: 63,
    init(world, api) {
      S.world = world; S.api = api; S.root = api.group('livestreet'); if (OFF) return;
      if (hookHints(world)) api.emit('buildingHints', { src: 'livestreet' });
      const tryBuild = () => { if (S.built) return; try { if (build(world)) { S.built = true; if (P.cars) cars(world, api).catch(e => console.warn('[livestreet] cars', e)); api.emit('livestreet', S.stats); } } catch (e) { console.warn('[livestreet] build', e); S.built = true; } };
      S.tryBuild = tryBuild; api.eachTile((t, kind) => { if (kind === 'add' && !S.built) setTimeout(tryBuild, 0); });
      window.YZLiveStreet = S;
    },
    update(dt, world) {
      if (OFF) return;
      // יום/לילה נפרדים: קבוצת "יום בלבד" מוצגת כשהשמש מעל 5°, ונעלמת מתחת ל-3° (היסטרזיס; בין לבין — המצב הקודם נשמר)
      if (S.dayGroup) { const el = world.sun.elevation; if (el > 5 && !S.dayGroup.visible) S.dayGroup.visible = true; else if (el < 3 && S.dayGroup.visible) S.dayGroup.visible = false; }
      if (S.fleet) S.fleet.update(dt, world.camera); if (S.fleetDay && S.dayGroup.visible) S.fleetDay.update(dt, world.camera);
      if ((S.fleet || S.fleetDay) && window.ESH_VEHICLES) ESH_VEHICLES.tick(dt, clamp((2 - world.sun.elevation) / 8, 0, 1), world.camera);
      S.tp = (S.tp || 0) + dt; if (S.tp > 6) { S.tp = 0; if (P.people) try { people(world); } catch (e) { /* */ } }
      S.t += dt; if (S.t > 1) { S.t = 0; if (!S.built && S.tryBuild) S.tryBuild(); if (S.built && P.trees && !S.vegDone) plantTrees(world); }
    },
    dispose() { for (const k of ['fleet', 'fleetDay']) if (S[k]) { try { S[k].dispose(); } catch (e) { /* */ } S[k] = null; } for (const m of S.mats) { if (m.map) m.map.dispose(); m.dispose(); } for (const g of S.geos) g.dispose(); S.mats = []; S.geos = []; },
  });
})();
