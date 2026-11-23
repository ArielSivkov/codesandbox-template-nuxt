/* מחולל פרוצדורלי לריהוט רחוב – עולם תאום ESH27 (אשדוד).
 * קלט: אריח וקטורי (o, b, rd) + style_rules.json. פלט: מופעים לכל סוג (x, y, סיבוב, קנה מידה) – לשכפול (InstancedMesh).
 * דטרמיניסטי: זרע = FNV-1a של (מפתח אריח | שם רחוב | נקודת התחלה וסוף מעוגלות). לאריחים אין מזהה דרך OSM ב-rd – לכן לפי גאומטריה.
 * כל אובייקט: מקור "נגזר מסגנון השכונה" + הפניה לרחוב (שם אמיתי מ-rd.n) + הסגנון שנבחר והסתברותו.
 * עובד גם ב-node (module.exports) וגם בדפדפן (window.ESH_PROCGEN). בלי תלות ב-three.js. */
(function (root) {
  'use strict';
  const PROV = 'נגזר מסגנון השכונה';
  const Q = 10;
  const HALF_W = { 1: 3.0, 2: 4.5, 3: 7.0, 4: 9.0, 5: 10.0 };   // משוער: חצי רוחב דרך לפי סוג
  const KINDS = ['lamp_curved_led', 'lamp_led_white', 'lamp_ornate_red_double', 'tree_ficus', 'tree_young', 'palm_date', 'fence', 'street_sign', 'curb_paint',
                 'crosswalk', 'tactile', 'ac_unit', 'balcony', 'shopfront', 'shop_sign'];
  // בסיס לכל סוג – כולם "נגזר מסגנון השכונה"; כאן פירוט מה מאחורי הכלל (כנות: מה נצפה ומה הנחה)
  const BASIS = { lamp_curved_led: 'נצפה ב-011, 015–017, 032', lamp_led_white: 'נצפה ב-004, 007, 009, 020, 027', lamp_ornate_red_double: 'נצפה ב-018, 019, 034, 035',
    tree_ficus: 'נצפה ב-019, 027, 035 (מין משוער)', tree_young: 'משוער', palm_date: 'נצפה ב-007, 019', fence: 'נצפה (סוגים) – מיקום משוער', street_sign: 'סגנון נצפה ב-015 (כחול) / 032 (לבן); מיקום בצומת – משוער',
    curb_paint: 'כלל נלמד: 3/4 תצפיות ליד צומת', crosswalk: 'נצפה ב-001, 020, 028, 035 (פס ~50 ס"מ)', tactile: 'נצפה ב-035', ac_unit: 'משוער – לא נמדד בתמונות', balcony: 'משוער – לפי קומות במודל',
    shopfront: 'נצפה ב-019, 027, 034, 035 (קומת מסחר בשדרות)', shop_sign: 'נצפה (שלטים מוארים) – תוכן/צבע משוער' };
  const TREE_MAP = { tree_broadleaf_large: 'tree_ficus', tree_ficus: 'tree_ficus', street_trees_young: 'tree_young', palm_date: 'palm_date', palm_small_pots: 'palm_date', cypress_row: 'tree_young' };
  const FENCE_KINDS = ['rail_white_metal', 'fence_white_picket', 'wall_stone_clad', 'fence_dark_slats', 'fence_metal_bars', 'rail_red_median', 'fence_blue_rail', 'rail_grey_metal'];

  function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function decode(r) { const a = new Float64Array(r.length); let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; a[i] = x / Q; a[i + 1] = y / Q; } return a; }
  function pick(rng, dist) { let s = 0; for (const k in dist) s += dist[k]; let u = rng() * s; for (const k in dist) { u -= dist[k]; if (u <= 0) return k; } return Object.keys(dist).pop(); }

  // רסטר תפוסה של בניינים (תא 2.5 מ') – לא מציבים אובייקט בתוך בניין
  function occupancy(tile) {
    const C = 2.5, N = Math.ceil(1100 / C), off = 50, g = new Uint8Array(N * N);
    for (const b of tile.b || []) {
      if (!b.r || !b.r[0]) continue;
      const p = decode(b.r[0]); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
      const xs = [];
      for (let cy = Math.max(0, Math.floor((y0 + off) / C)); cy <= Math.min(N - 1, Math.floor((y1 + off) / C)); cy++) {   // מילוי בשורות סריקה
        const py = cy * C - off + C / 2; xs.length = 0;
        for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const yi = p[i + 1], yj = p[j + 1]; if ((yi > py) !== (yj > py)) xs.push((p[j] - p[i]) * (py - yi) / (yj - yi) + p[i]); }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const ca = Math.max(0, Math.ceil((xs[k] + off) / C - 0.5)), cb = Math.min(N - 1, Math.floor((xs[k + 1] + off) / C - 0.5));
          for (let cx = ca; cx <= cb; cx++) g[cy * N + cx] = 1;
        }
      }
    }
    return (x, y) => { const cx = Math.floor((x + off) / C), cy = Math.floor((y + off) / C); return cx >= 0 && cy >= 0 && cx < N && cy < N && g[cy * N + cx] === 1; };
  }

  function junctionSet(roads) {   // צמתים: קודקוד שמופיע ביותר מדרך אחת (עיגול 0.5 מ')
    const m = new Map();
    roads.forEach((r, ri) => { for (let i = 0; i < r.p.length; i += 2) { const k = Math.round(r.p[i] * 2) + ',' + Math.round(r.p[i + 1] * 2); const s = m.get(k) || new Set(); s.add(ri); m.set(k, s); } });
    const J = new Set(); for (const [k, s] of m) if (s.size >= 2) J.add(k); return J;
  }

  function styleProbs(rules, cls, wx, wy, roadName) {
    const base = Object.assign({}, (rules.p_style_given_road_class.v[String(cls)] || rules.p_style_given_road_class.v['2']));
    const R = rules.proximity_m.v; let observed = false;
    for (const o of rules.observed_points) {
      const d = Math.hypot(o.x - wx, o.y - wy); if (d > 4 * R || !(o.cls in base)) continue;
      base[o.cls] += 2 * Math.exp(-d / R); if (d < 40) observed = true;
    }
    for (const k in base) if (!(k in rules.params)) delete base[k];
    let s = 0; for (const k in base) s += base[k]; for (const k in base) base[k] /= s || 1;
    return { probs: base, observed };
  }

  function generateTile(tile, rules, opts) {
    opts = opts || {};
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const key = tile.k, ox = tile.o[0], oy = tile.o[1];
    const roads = (tile.rd || []).map(r => ({ n: r.n || '', c: r.c, p: decode(r.r) }));
    const occ = occupancy(tile), J = junctionSet(roads);
    const isJ = (x, y) => J.has(Math.round(x * 2) + ',' + Math.round(y * 2));
    const out = { key, origin: [ox, oy], prov: PROV, roads: [], kinds: {} };
    const buf = {}; KINDS.forEach(k => buf[k] = []);
    const push = (k, x, y, rot, sc, ri, extra) => { if (x < -20 || y < -20 || x > 1020 || y > 1020) return; buf[k].push(x, y, rot, sc, ri, extra || 0); };
    roads.forEach((r, ri) => {
      const n = r.p.length / 2; if (n < 2) return;
      const seedKey = key + '|' + r.n + '|' + Math.round(r.p[0]) + ',' + Math.round(r.p[1]) + '|' + Math.round(r.p[2 * n - 2]) + ',' + Math.round(r.p[2 * n - 1]);
      const rng = mulberry32(fnv1a(seedKey));
      let L = 0; const seg = []; for (let i = 0; i < n - 1; i++) { const dx = r.p[2 * i + 2] - r.p[2 * i], dy = r.p[2 * i + 3] - r.p[2 * i + 1], l = Math.hypot(dx, dy); seg.push(l); L += l; }
      const mid = Math.floor((n - 1) / 2);
      const sp = styleProbs(rules, r.c, ox + r.p[2 * mid], oy + r.p[2 * mid + 1], r.n);
      const style = pick(rng, sp.probs), P = rules.params[style], pri = rules.classes[style] ? rules.classes[style].priors : null;
      out.roads.push({ i: ri, n: r.n, c: r.c, len: Math.round(L), style, p: Math.round(sp.probs[style] * 100) / 100, seed: seedKey, basis: sp.observed ? 'תצפית ברחוב זה' : 'סגנון השכונה' });
      const hw = HALF_W[r.c] || 4.5;
      const at = (s) => { let acc = 0; for (let i = 0; i < seg.length; i++) { if (acc + seg[i] >= s || i === seg.length - 1) { const u = seg[i] ? Math.min(1, (s - acc) / seg[i]) : 0, x = r.p[2 * i] + (r.p[2 * i + 2] - r.p[2 * i]) * u, y = r.p[2 * i + 1] + (r.p[2 * i + 3] - r.p[2 * i + 1]) * u; const ang = Math.atan2(r.p[2 * i + 3] - r.p[2 * i + 1], r.p[2 * i + 2] - r.p[2 * i]); return [x, y, ang]; } acc += seg[i]; } };
      const side = (pt, off) => [pt[0] - Math.sin(pt[2]) * off, pt[1] + Math.cos(pt[2]) * off];   // off>0 = שמאל לכיוון הדרך
      const jStart = isJ(r.p[0], r.p[1]), jEnd = isJ(r.p[2 * n - 2], r.p[2 * n - 1]);
      const nearJ = s => (jStart && s < 10) || (jEnd && L - s < 10);
      // פנסים
      if (L > 12) {
        const spc = P.lamp_spacing_m.v * (r.c === 1 ? 1.3 : 1);
        let k = 0;
        for (let s = rng() * spc * 0.6 + 4; s < L - 3; s += spc * (0.9 + 0.2 * rng()), k++) {
          const pt = at(s); let q;
          if (P.lamp_side.v === 'median' && r.c >= 3) q = [pt[0], pt[1]];
          else if (P.lamp_side.v === 'both') q = side(pt, (k % 2 ? 1 : -1) * (hw + 0.8));
          else q = side(pt, -(hw + 0.8));
          if (occ(q[0], q[1])) continue;
          push(P.lamp_kind, q[0], q[1], pt[2], P.lamp_h_m.v / 8, ri);
        }
      }
      // עצים
      if (pri && L > 10) {
        const td = {}; for (const kk in pri.tree) { const m = TREE_MAP[kk]; if (m) td[m] = (td[m] || 0) + pri.tree[kk].p; }
        const pTree = Math.min(0.85, 0.25 + pri.tree._n_total / Math.max(1, rules.classes[style].n_photos) * 0.3);
        const spc = P.tree_spacing_m.v;
        for (let s = rng() * spc + 3; s < L - 3; s += spc * (0.8 + 0.4 * rng())) {
          if (rng() > pTree || nearJ(s)) continue;
          const pt = at(s), sd = rng() < 0.5 ? 1 : -1, q = side(pt, sd * (hw + 2.2));
          if (occ(q[0], q[1])) continue;
          const kind = pick(rng, td);
          push(kind, q[0], q[1], rng() * 6.283, 0.8 + 0.4 * rng(), ri);
        }
      }
      // גדרות (מקטעים של 8 מ' – קנה מידה x = אורך)
      if (pri && r.c <= 2 && L > 16) {
        const fd = {}; FENCE_KINDS.forEach(f => { if (pri.fence[f] && f !== 'rail_red_median') fd[f] = pri.fence[f].p; });
        const setb = Math.max(2.5, P.fence_setback_m.v);
        for (const sd of [1, -1]) for (let s = 6; s < L - 6; s += 8) {
          if (nearJ(s) || rng() < 0.35) continue;
          const pt = at(s + 4), q = side(pt, sd * (hw + setb)); if (occ(q[0], q[1])) continue;
          push('fence', q[0], q[1], pt[2], 8, ri, FENCE_KINDS.indexOf(pick(rng, fd)));
        }
      }
      if (style === 'שדרה עירונית ותיקה' && r.c >= 3 && L > 20)   // מעקה אדום על אי התנועה – נצפה ב-018/019
        for (let s = 10; s < L - 10; s += 8) { const pt = at(s + 4); push('fence', pt[0], pt[1], pt[2], 8, ri, FENCE_KINDS.indexOf('rail_red_median')); }
      // שלטי שם רחוב בצמתים (סגנון 015: כחול, מסגרת לבנה, עברית למעלה/אנגלית למטה, עמוד לבן מעוטר)
      if (r.n && r.c >= 2) {
        for (const [isj, s, dir] of [[jStart, 2.5, 1], [jEnd, L - 2.5, -1]]) {
          if (!isj || L < 8) continue;
          const pt = at(s), q = side(pt, dir * (hw + 1.0)); if (occ(q[0], q[1])) continue;
          let ss = rules.sign_style_by_class ? rules.sign_style_by_class.v[style] : 'new_blue', bestD = 120;
          for (const o of rules.observed_signs || []) { const d = Math.hypot(o.x - ox - q[0], o.y - oy - q[1]); if (d < bestD) { bestD = d; ss = o.style; } }   // סגנון לפי קטע: שלט שנצפה קרוב קובע
          push('street_sign', q[0], q[1], pt[2] + Math.PI / 2, 1, ri, ss === 'old_white' ? 1 : 0);   // extra: 0 = כחול חדש (015), 1 = לבן ישן (032)
        }
      }
      // מעברי חצייה (פסים ~0.5 מ', לפי 028) + אריחים מישושיים בשני הצדדים (035)
      if (r.c >= 2) for (const [isj, s0, dir] of [[jStart, 0, 1], [jEnd, L, -1]]) {
        if (!isj || L < 16 || rng() > 0.55) continue;
        const pt = at(s0 + dir * 6), nx = -Math.sin(pt[2]), ny = Math.cos(pt[2]);
        for (let w = -hw + 0.6; w <= hw - 0.4; w += 1.0) push('crosswalk', pt[0] + nx * w, pt[1] + ny * w, pt[2], 1, ri);
        for (const sd of [1, -1]) { const q = [pt[0] + nx * sd * (hw + 0.9), pt[1] + ny * sd * (hw + 0.9)]; if (!occ(q[0], q[1])) push('tactile', q[0], q[1], pt[2], 1, ri); }
      }
      // צביעת שפה אדום-לבן ליד צמתים (כלל נלמד: p_near)
      const cr = rules.rules.find(x => x.id === 'curb_rw_near_junction');
      if (cr && r.c >= 2) {
        const W = cr.gen_param.paint_within_m;
        for (const [isj, s0, dir] of [[jStart, 0, 1], [jEnd, L, -1]]) {
          if (!isj || rng() > cr.p_near || L < W + 4) continue;
          for (let d = 4, k = 0; d < W + 4; d += 1.5, k++) { const pt = at(s0 + dir * d); for (const sd of [1, -1]) { const q = side(pt, sd * hw); push('curb_paint', q[0], q[1], pt[2], 1.5, ri, k % 2); } }
        }
      }
    });
    // חזיתות: מזגנים, מרפסות, חזית מסחרית מוארת – זרע לפי מזהה בניין (OSM)
    const grid = new Map(), G = 20;   // רשת דרכים ראשיות (סוג ≥3) לזיהוי חזית מסחרית
    roads.forEach(r => { if (r.c < 3) return; for (let i = 0; i < r.p.length; i += 2) { const k = Math.floor(r.p[i] / G) + ',' + Math.floor(r.p[i + 1] / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r.p[i], r.p[i + 1]); } });
    const nearMain = (x, y) => { let best = 1e9; const cx = Math.floor(x / G), cy = Math.floor(y / G); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const L = grid.get((cx + a) + ',' + (cy + b)); if (L) for (let i = 0; i < L.length; i += 2) best = Math.min(best, Math.hypot(L[i] - x, L[i + 1] - y)); } return best; };
    (tile.b || []).forEach((b, bi) => {
      if (!b.r || !b.r[0] || opts.noFacades) return;
      const p = decode(b.r[0]), f = b.f || 1, H = b.h / Q, fh = H / Math.max(1, f), rng = mulberry32(fnv1a(b.i || (key + bi)));
      let ccw = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) ccw += p[j] * p[i + 1] - p[i] * p[j + 1];
      const out_ = ccw > 0 ? 1 : -1, ref = -1 - bi;
      let nAC = 0, shop = false; const commercial = f >= 3 && b.t !== 'school' && b.t !== 'house' && b.t !== 'detached';
      let longest = -1, longL = 0;
      for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length, L = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]); if (L > longL) { longL = L; longest = i; } }
      for (let i = 0; i < p.length; i += 2) {
        const j = (i + 2) % p.length, x0 = p[i], y0 = p[i + 1], dx = p[j] - x0, dy = p[j + 1] - y0, L = Math.hypot(dx, dy);
        if (L < 4) continue;
        const ang = Math.atan2(dy, dx), nx = out_ * dy / L, ny = -out_ * dx / L, mx = x0 + dx / 2, my = y0 + dy / 2;
        if (commercial && L > 7 && nearMain(mx + nx * 6, my + ny * 6) < 16) {   // קומת קרקע מסחרית מול שדרה
          shop = true; const n = Math.max(1, Math.floor(L / 6));
          for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, x = x0 + dx * t + nx * 0.12, y = y0 + dy * t + ny * 0.12;
            push('shopfront', x, y, ang, L / n * 0.9, ref, 0); push('shop_sign', x + nx * 0.1, y + ny * 0.1, ang, L / n * 0.8, ref, Math.floor(rng() * 6)); }
        }
        if (f >= 2) for (let fl = shop ? 1 : 0; fl < f && nAC < 40; fl++) {   // מזגנים
          if (rng() > Math.min(0.8, L / 14)) continue;
          const t = 0.15 + 0.7 * rng(); push('ac_unit', x0 + dx * t + nx * 0.3, y0 + dy * t + ny * 0.3, ang, 1, ref, fl * fh + 0.6 + rng() * 0.8); nAC++;
        }
        if (i === longest && f >= 3 && L > 8 && b.t !== 'school') for (let fl = 1; fl < f; fl++) {   // מרפסות על הקיר הארוך
          const nb = L > 16 ? 2 : 1;
          for (let k = 0; k < nb; k++) { const t = (k + 0.5) / nb; push('balcony', x0 + dx * t + nx * 0.7, y0 + dy * t + ny * 0.7, ang, 1, ref, fl * fh); }
        }
      }
    });
    let total = 0;
    for (const k of KINDS) { const a = buf[k]; out.kinds[k] = { n: a.length / 6, data: Float32Array.from(a) }; total += a.length / 6; }
    out.total = total;
    out.ms = Math.round(((typeof performance !== 'undefined' ? performance : Date).now() - t0) * 100) / 100;
    return out;
  }

  function digest(res) {   // טביעת אצבע לבדיקת דטרמיניזם
    let h = 0x811c9dc5; for (const k of KINDS) { const d = res.kinds[k].data; for (let i = 0; i < d.length; i++) { h ^= Math.round(d[i] * 100) & 0xffffffff; h = Math.imul(h, 0x01000193); } }
    return (h >>> 0).toString(16);
  }

  const API = { generateTile, digest, KINDS, FENCE_KINDS, PROV, BASIS, fnv1a, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ESH_PROCGEN = API;
})(typeof self !== 'undefined' ? self : this);
