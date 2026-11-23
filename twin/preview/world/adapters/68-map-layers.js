/* 68-map-layers.js – שכבת יזם על המפה הדו־ממדית המלאה (מרחיב את window.YZMap של 64-map.js, לא משכתב אותו). 23.11.2026
 * הועבר ממפת היזם (twin/engine/map) מה שמתאים למפה שטוחה:
 *   🎨 טביעות בניינים מהאריחים הטעונים, צבע לפי גובה (אותו מדרג כמו שכבת "גובה" בעין הגדולה, 0–60+ מ').
 *   הקשה על בניין → כרטיס (קומות, גובה ±σ, טביעה, רחוב קרוב) · ⭐ סימון כנכס שלי · 👁 לראות בתלת־ממד · 📍 נקודה רגילה.
 *   ✏ שרטוט מגרש: פינות בהקשות, שטח במ"ר/דונם והיקף בזמן אמת. המצב המשותף הוא YZDev.D.pts (40-dev.js) –
 *      כל פינה עוברת ל-YZDev.addPoint (אותו אימות חיתוכים), ולכן המגרש מופיע מיד גם בתלת־ממד, ומגרש ששורטט בתלת־ממד מופיע כאן.
 *   🔍 חיפוש רחוב/בניין בשמות מהאריחים הטעונים (נרמול כמו במפת היזם: בלי ניקוד, "רח'", גרשיים), הדגשת הרחוב.
 *   ⭐ הנכסים שלי: כוכבים על המפה + רשימה (אותו מאגר G27.mine / localStorage w27.mine כמו במשחק).
 * המרות: סצנה → WGS84 דרך YZMap.sceneToLL (ITM + היסט הדגימה, itm.js). לכל אריח מחושבת פעם אחת העתקה אפינית
 *   סצנה → מרקטור (משיק במרכז האריח; שגיאה ≤0.1 פיקסל ≈ 2.5 ס"מ בזום 19 בתוך אריח של 1 ק"מ – נבדק ב-tools/test-map2d.js), כך שאלפי טביעות לא עוברות המרה מלאה.
 * שטח המגרש = נוסחת השרוך ברשת ישראל (מטרים של הסצנה), כמו ב-YZDev.stats(); סטיית קנה המידה של ITM באזור ~0.01% – זניחה.
 * ?maplayers=0 מכבה את המודול (המפה הבסיסית נשארת).
 */
(function () {
  'use strict';
  const TS = 256, IL = { E0: 100000, E1: 300000, N0: 350000, N1: 820000 };

  // ---------- חלק טהור (נבדק ב-node)
  const L = {};
  L.merc = (lat, lon) => { const s = Math.sin(lat * Math.PI / 180); return { X: (lon + 180) / 360, Y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }; };
  L.unmerc = (X, Y) => ({ lat: 180 / Math.PI * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * Y)), lon: X * 360 - 180 });
  L.shoelace = pts => { let a = 0; const n = pts.length; for (let i = 0; i < n; i++) { const q = pts[i], r = pts[(i + 1) % n]; a += q.x * r.z - r.x * q.z; } return Math.abs(a / 2); };
  L.perimeter = (pts, closed = true) => { let p = 0; const n = pts.length; for (let i = 0; i < (closed ? n : n - 1); i++) { const q = pts[i], r = pts[(i + 1) % n]; p += Math.hypot(r.x - q.x, r.z - q.z); } return n > 1 ? p : 0; };
  L.centroid = pts => { const n = pts.length; return n ? { x: pts.reduce((s, q) => s + q.x, 0) / n, z: pts.reduce((s, q) => s + q.z, 0) / n } : null; };
  /** העתקה אפינית סצנה(x,z) → מרקטור מנורמל [0..1], מ-3 נקודות סביב (x0,z0). toLL = (x,z) → {lat,lon} */
  L.affine = (toLL, x0, z0, d = 200) => {   // נגזרות מרכזיות (±d/2) – משיק במרכז האריח
    const h = d / 2, m = (x, z) => { const ll = toLL(x, z); return ll ? L.merc(ll.lat, ll.lon) : null; };
    const P = m(x0, z0), xa = m(x0 - h, z0), xb = m(x0 + h, z0), za = m(x0, z0 - h), zb = m(x0, z0 + h); if (!P || !xa || !xb || !za || !zb) return null;
    return { x0, z0, X0: P.X, Y0: P.Y, Xx: (xb.X - xa.X) / d, Yx: (xb.Y - xa.Y) / d, Xz: (zb.X - za.X) / d, Yz: (zb.Y - za.Y) / d };
  };
  L.apply = (A, x, z) => { const dx = x - A.x0, dz = z - A.z0; return { X: A.X0 + dx * A.Xx + dz * A.Xz, Y: A.Y0 + dx * A.Yx + dz * A.Yz }; };
  /** מטרים לפיקסל במרקטור בזום z */
  L.mpp = (lat, z) => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;
  // מדרג גובה – זהה ל-ramp של 40-dev.js (שכבת "גובה", 0–60 מ'), ב-8 דליים כדי לצייר מעט מסלולים
  const STOPS = [[0.18, 0.42, 0.85], [0.2, 0.75, 0.6], [0.98, 0.83, 0.3], [0.93, 0.36, 0.25]], NB = 8, HMAX = 60;
  L.bucket = h => Math.max(0, Math.min(NB - 1, Math.floor((h > 0 ? h : 0) / HMAX * NB)));
  L.bucketColor = i => { const t = (i + 0.5) / NB, f = t * 3, k = Math.min(2, Math.floor(f)), u = f - k, c = [0, 1, 2].map(j => Math.round(255 * (STOPS[k][j] + (STOPS[k + 1][j] - STOPS[k][j]) * u))); return `rgb(${c[0]},${c[1]},${c[2]})`; };
  L.norm = s => String(s || '').replace(/[֑-ׇ]/g, '').replace(/["'`״׳]/g, '').replace(/[-–־_.,()]/g, ' ').replace(/^(רח|רחוב|שד|שדרות)\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  L.pip = (p, n, x, z) => { let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1]; if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c; } return c; };
  /** אינדקס חיפוש מאריחים: רחובות (נקודה על הרחוב הקרובה למרכז) + בניינים עם שם */
  L.buildIndex = tiles => {
    const S = new Map(), out = [];
    for (const t of tiles) {
      for (const r of t.roads || []) { if (!r.name || !r.p) continue; const o = S.get(r.name) || { sx: 0, sz: 0, w: 0, pts: [] };
        for (let i = 0; i + 1 < r.p.length; i += 2) { o.sx += r.p[i]; o.sz += r.p[i + 1]; o.w++; o.pts.push(r.p[i], r.p[i + 1]); } S.set(r.name, o); }
      for (const b of t.blds || []) if (b.name) out.push({ kind: 'bld', name: b.name, key: L.norm(b.name), x: b.cx, z: b.cz, id: b.id });
    }
    for (const [nm, o] of S) { if (!o.w) continue; const cx = o.sx / o.w, cz = o.sz / o.w; let bx = cx, bz = cz, bd = Infinity;
      for (let i = 0; i < o.pts.length; i += 2) { const d = (o.pts[i] - cx) ** 2 + (o.pts[i + 1] - cz) ** 2; if (d < bd) { bd = d; bx = o.pts[i]; bz = o.pts[i + 1]; } }
      out.push({ kind: 'street', name: nm, key: L.norm(nm), x: bx, z: bz }); }
    return out;
  };
  L.search = (idx, q, max = 8) => { const nq = L.norm(q); if (nq.length < 2) return []; const w = nq.split(' '), r = [];
    for (const e of idx) if (w.every(x => e.key.includes(x))) r.push([e.key === nq ? 0 : e.key.startsWith(nq) ? 1 : 2, e.kind === 'street' ? 0 : 1, e.name.length, e]);
    r.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]); return r.slice(0, max).map(x => x[3]); };
  L.inIL = s => !!s && s.trueE > IL.E0 && s.trueE < IL.E1 && s.trueN > IL.N0 && s.trueN < IL.N1;

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  if (typeof window !== 'undefined') window.YZMapLayers = L;
  if (typeof YZW === 'undefined' || typeof document === 'undefined') return;
  if (/[?&](map|maplayers)=0\b/.test(location.search)) return;

  // ---------- חלק דפדפן
  const fmt = (v, d = 0) => Number(v).toLocaleString('he-IL', { maximumFractionDigits: d, minimumFractionDigits: d });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE_HE = { apartments: 'בניין דירות', residential: 'מגורים', house: 'בית', detached: 'בית צמוד קרקע', semidetached_house: 'דו־משפחתי', commercial: 'מסחרי', retail: 'קמעונאות', industrial: 'תעשייה', warehouse: 'מחסן', school: 'בית ספר', kindergarten: 'גן ילדים', university: 'אקדמיה', public: 'ציבורי', synagogue: 'בית כנסת', hospital: 'בית חולים', office: 'משרדים', construction: 'בבנייה', hotel: 'מלון' };
  let W = null, M = null, ui = null;
  const S = { heights: (() => { try { return localStorage.getItem('yz.map.heights') !== '0'; } catch (e) { return true; } })(), sel: null, street: null, idx: null, idxN: -1, panel: '', drawSig: '' };
  const proj = new WeakMap();   // אריח → { A, polys }
  const dev = () => window.YZDev && window.YZDev.D ? window.YZDev : null;
  const G = () => W && W.G27;

  function tileProj(t) {
    let P = proj.get(t); if (P && P.n === (t.blds ? t.blds.length : 0)) return P;
    const b0 = t.blds && t.blds[0], x0 = t.cx != null ? t.cx : b0 ? b0.cx : 0, z0 = t.cz != null ? t.cz : b0 ? b0.cz : 0;
    const A = L.affine(M.sceneToLL, x0, z0); if (!A) return null;
    const polys = []; let X0 = 1, X1 = 0, Y0 = 1, Y1 = 0;
    for (const b of t.blds || []) { const q = new Float64Array(b.n * 2); let a0 = 1, a1 = 0, c0 = 1, c1 = 0;
      for (let i = 0; i < b.n; i++) { const m = L.apply(A, b.p[i * 2], b.p[i * 2 + 1]); q[i * 2] = m.X; q[i * 2 + 1] = m.Y; a0 = Math.min(a0, m.X); a1 = Math.max(a1, m.X); c0 = Math.min(c0, m.Y); c1 = Math.max(c1, m.Y); }
      polys.push({ b, q, a0, a1, c0, c1, k: L.bucket(b.h != null ? b.h : b.top - b.base) }); X0 = Math.min(X0, a0); X1 = Math.max(X1, a1); Y0 = Math.min(Y0, c0); Y1 = Math.max(Y1, c1); }
    P = { A, polys, X0, X1, Y0, Y1, n: polys.length }; proj.set(t, P); return P;
  }

  // ---------- ציור (נקרא מתוך draw של 64-map דרך M.layers)
  function layer(cx, V) {
    const Sk = TS * 2 ** V.zi * V.sc, ox = V.w / 2 - V.cxp * V.sc, oy = V.h / 2 - V.cyp * V.sc;
    const vx0 = -ox / Sk, vx1 = (V.w - ox) / Sk, vy0 = -oy / Sk, vy1 = (V.h - oy) / Sk;
    const mineIds = new Set(G() && G().mine ? G().mine.keys() : []);
    const path = (q) => { cx.moveTo(q[0] * Sk + ox, q[1] * Sk + oy); for (let i = 2; i < q.length; i += 2) cx.lineTo(q[i] * Sk + ox, q[i + 1] * Sk + oy); cx.closePath(); };
    const showB = M.z >= 14 && W.data && W.data.tiles;
    let selP = null; const mineP = [];
    if (showB) {
      const buckets = S.heights ? Array.from({ length: NB }, () => []) : null;
      for (const t of W.data.tiles.values()) { if (!t.blds || !t.blds.length) continue; const P = tileProj(t); if (!P || P.X1 < vx0 || P.X0 > vx1 || P.Y1 < vy0 || P.Y0 > vy1) continue;
        for (const o of P.polys) { if (o.a1 < vx0 || o.a0 > vx1 || o.c1 < vy0 || o.c0 > vy1) continue;
          if (buckets) buckets[o.k].push(o.q); if (S.sel && o.b === S.sel) selP = o.q; if (mineIds.has(o.b.id)) mineP.push(o.q); } }
      if (buckets) { cx.globalAlpha = 0.72; for (let k = 0; k < NB; k++) { if (!buckets[k].length) continue; cx.beginPath(); for (const q of buckets[k]) path(q); cx.fillStyle = L.bucketColor(k); cx.fill(); }
        if (M.z >= 17) { cx.globalAlpha = 0.5; cx.lineWidth = 0.6; cx.strokeStyle = '#33415c'; cx.beginPath(); for (const B of buckets) for (const q of B) path(q); cx.stroke(); } cx.globalAlpha = 1; }
    }
    // רחוב מודגש
    if (S.street && W.data) { cx.strokeStyle = '#ff3d7f'; cx.globalAlpha = 0.85; cx.lineWidth = Math.max(4, Math.min(10, M.z - 10)); cx.lineCap = 'round'; cx.beginPath();
      for (const t of W.data.tiles.values()) { const P = t.roads && t.roads.length ? (proj.get(t) || tileProj(t)) : null; if (!P) continue;
        for (const r of t.roads) { if (r.name !== S.street || !r.p) continue; for (let i = 0; i + 1 < r.p.length; i += 2) { const m = L.apply(P.A, r.p[i], r.p[i + 1]); i ? cx.lineTo(m.X * Sk + ox, m.Y * Sk + oy) : cx.moveTo(m.X * Sk + ox, m.Y * Sk + oy); } } }
      cx.stroke(); cx.globalAlpha = 1; }
    // הנכסים שלי: מסגרת זהב + כוכב
    if (mineP.length) { cx.strokeStyle = '#ffc640'; cx.lineWidth = 3; cx.beginPath(); for (const q of mineP) path(q); cx.stroke(); }
    if (G() && G().mine) { cx.font = '17px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      for (const o of G().mine.values()) { const ll = M.sceneToLL(o.cx, o.cz); if (!ll) continue; const p = V.toPx(ll.lat, ll.lon); if (p.x < -20 || p.y < -20 || p.x > V.w + 20 || p.y > V.h + 20) continue;
        cx.fillStyle = '#1b1300cc'; cx.beginPath(); cx.arc(p.x, p.y, 11, 0, 7); cx.fill(); cx.fillStyle = '#ffc640'; cx.fillText('⭐', p.x, p.y + 1); } }
    // בניין נבחר
    if (selP) { cx.fillStyle = '#ff9f1f88'; cx.strokeStyle = '#ff9f1f'; cx.lineWidth = 3; cx.beginPath(); path(selP); cx.fill(); cx.stroke(); }
    // מגרש (המצב המשותף עם התלת־ממד)
    const D = dev() && dev().D;
    if (D && D.pts.length) { const px = D.pts.map(q => { const ll = M.sceneToLL(q.x, q.z); return ll ? V.toPx(ll.lat, ll.lon) : null; }).filter(Boolean);
      cx.lineWidth = 3; cx.strokeStyle = '#ff3d7f'; cx.fillStyle = '#ff3d7f40'; cx.beginPath(); px.forEach((p, i) => i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y)); if (px.length > 2) { cx.closePath(); cx.fill(); } cx.stroke();
      for (const p of px) { cx.fillStyle = '#fff'; cx.strokeStyle = '#ff3d7f'; cx.lineWidth = 3; cx.beginPath(); cx.arc(p.x, p.y, 6, 0, 7); cx.fill(); cx.stroke(); }
      if (D.pts.length > 2) { const c = L.centroid(px.map(p => ({ x: p.x, z: p.y }))), ly = Math.max(...px.map(p => p.y)) + 20, a = L.shoelace(D.pts), tx = fmt(a) + ' מ"ר';   // תווית מתחת למגרש – לא מתחת לסיכות
        cx.font = 'bold 13px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; const tw = cx.measureText(tx).width + 12;
        cx.fillStyle = '#0c1420e6'; cx.fillRect(c.x - tw / 2, ly - 11, tw, 22); cx.fillStyle = '#fff'; cx.fillText(tx, c.x, ly); } }
    // מקרא + סנכרון סרגל השרטוט (אם השרטוט שונה בתלת־ממד)
    ui.leg.style.display = showB && S.heights && !S.panel ? 'flex' : 'none';
    const sig = D ? (D.draw ? 1 : 0) + ':' + D.pts.length : ''; if (sig !== S.drawSig) { S.drawSig = sig; renderDraw(); }
  }

  // ---------- פאנלים בתחתית (אחד בכל פעם)
  function hidePk() { const pk = M.el && M.el.querySelector('.pk:not(.yzP)'); if (pk) pk.style.display = 'none'; M.pick = null; }
  function show(which, html) { S.panel = which; M.el.classList.toggle('yzPanel', !!which); ui.card.style.display = which === 'card' ? 'block' : 'none'; ui.draw.style.display = which === 'draw' ? 'block' : 'none';
    if (html != null) (which === 'draw' ? ui.draw : ui.card).innerHTML = html; if (which) hidePk(); M.dirty = true; }
  function hideCard() { if (S.panel === 'card') show(''); S.sel = null; M.dirty = true; }

  function buildingCard(b, ll) {
    S.sel = b; S.street = null; const g = G(), own = g && g.mine && g.mine.has(b.id), hgt = b.h != null ? b.h : b.top - b.base;
    const st = W.data.nearestStreet ? W.data.nearestStreet(b.cx, b.cz, 250) : '', est = b.conf == null || b.conf >= 2 || /[RNB]/.test(b.src || '');
    show('card', `<div class="yzH">🏢 ${esc(b.name || TYPE_HE[b.type] || 'בניין')}</div>
      <div class="yzK">${b.floors || '?'} קומות · גובה <b>${fmt(hgt, 0)}</b>${b.sigma ? ' ± ' + fmt(b.sigma, 0) : ''} מ' · טביעה ${fmt(b.area || 0)} מ"ר${est ? ' <span class="yzTag">משוער</span>' : ''}</div>
      ${st ? `<div class="yzK">ליד רחוב ${esc(st)}</div>` : ''}
      <div class="r"><button class="btn ${own ? 'on' : 'pri'}" id="yzLMine">${own ? '★ שלי ✓' : '⭐ סמן כשלי'}</button><button class="btn" id="yzL3d">👁 בתלת־ממד</button><button class="btn" id="yzLPt" aria-label="נקודה רגילה">📍</button><button class="btn" id="yzLX" aria-label="סגירה">✕</button></div>`);
    $('yzLX').onclick = hideCard;
    $('yzLPt').onclick = () => { hideCard(); M.choose(ll); };
    $('yzLMine').onclick = () => { if (g && g.toggleMine) { g.toggleMine(b); buildingCard(b, ll); } };
    $('yzL3d').onclick = () => { M.close(); if (g && g.S && g.S.inside) g.exitInterior(); W.player.selected = b; YZW.setMode('dev');
      setTimeout(() => { const d = dev(); if (d) { d.D.tx = b.cx; d.D.tz = b.cz; d.D.dist = Math.max(140, Math.min(400, Math.sqrt(b.area || 400) * 6)); } if (g && g.showCard) g.showCard(b); }, 60); };
  }
  const $ = id => document.getElementById(id);

  // ---------- שרטוט מגרש מהמפה (דרך YZDev – אותו אימות, אותו מצב, מסונכרן לתלת־ממד)
  function setPts(pts) { const d = dev(); d.startDraw(); for (const p of pts) d.addPoint(p.x, p.z); }
  function refreshDevBar() { const d = dev(); if (d) d.setLayer(d.D.layer); }   // מרענן את סרגל העין הגדולה (renderBar) בלי לשנות שכבה
  function renderDraw() {
    const d = dev(); if (!d) return; ui.tools.querySelector('[data-t=draw]').classList.toggle('on', !!d.D.draw);
    if (!d.D.draw) { if (S.panel === 'draw') show(''); return; }
    const p = d.D.pts, n = p.length, a = n > 2 ? L.shoelace(p) : 0;
    show('draw', `<div class="yzK">${n === 0 ? '✏ הקישו על פינות המגרש במפה (לפחות 3)' : n < 3 ? `✏ ${n} פינות · צריך לפחות 3` : `✏ ${n} פינות · שטח <b>${fmt(a)}</b> מ"ר (${fmt(a / 1000, 2)} דונם) · היקף ${fmt(L.perimeter(p))} מ'`}</div>
      <div class="r"><button class="btn pri" id="yzLDOk" ${n < 3 ? 'disabled' : ''}>✔ סיום</button><button class="btn" id="yzLDU" ${n ? '' : 'disabled'} aria-label="ביטול פינה אחרונה">↶</button><button class="btn" id="yzLDX" aria-label="ביטול השרטוט">✕</button></div>`);
    $('yzLDU').onclick = () => { setPts(d.D.pts.slice(0, -1)); M.dirty = true; };
    $('yzLDX').onclick = () => { d.startDraw(); d.D.draw = false; refreshDevBar(); S.drawSig = ''; M.dirty = true; };
    $('yzLDOk').onclick = () => { if (d.finish()) plotDone(); };
  }
  function plotDone() {
    const d = dev(), s = d.stats(), c = L.centroid(d.D.pts);
    show('card', `<div class="yzH">📐 מגרש משורטט</div><div class="yzK">שטח <b>${fmt(s.area)}</b> מ"ר (${fmt(s.area / 1000, 2)} דונם) · היקף ${fmt(s.per)} מ' · ${d.D.pts.length} פינות</div>
      <div class="yzK">מבנים בתוך המגרש: ${s.nb}${s.nb ? ` · טביעה ${fmt(s.foot)} מ"ר` : ''}<br><span class="yzTag">שרטוט ידני – לא חלקה רשומה</span></div>
      <div class="r"><button class="btn pri" id="yzLP3">👁 בתלת־ממד</button><button class="btn" id="yzLPX" aria-label="סגירה">✕</button></div>`);
    $('yzLPX').onclick = () => show('');
    $('yzLP3').onclick = () => { M.close(); YZW.setMode('dev'); setTimeout(() => { const D = dev().D, ext = Math.max(...D.pts.map(q => Math.hypot(q.x - c.x, q.z - c.z))); D.tx = c.x; D.tz = c.z; D.dist = Math.max(160, Math.min(1500, ext * 3.2)); dev().finish(); }, 60); };
  }
  function tapDraw(ll) {
    const s = M.llToSample(ll.lat, ll.lon); if (!L.inIL(s)) { YZW.notice('✏ שרטוט מגרש זמין רק בתחום ישראל (שם יש עולם תלת־ממד)', { kind: 'info', ms: 2200 }); return; }
    const p = W.coords.toScene(s.E, s.N); dev().addPoint(p.x, p.z); M.dirty = true;
  }

  // ---------- הקשה
  function onTap(ll, px, py, dbl) {
    const d = dev(); if (d && d.D.draw) { tapDraw(ll); return true; }   // בשרטוט: כל הקשה = פינה (בלי זום כפול)
    if (dbl) return false;
    if (S.panel === 'card') show('');
    S.sel = null;
    if (M.z >= 15 && W.data && W.data.buildingAt) { const s = M.llToSample(ll.lat, ll.lon);
      if (L.inIL(s)) { const p = W.coords.toScene(s.E, s.N), pad = Math.min(6, 10 * L.mpp(ll.lat, M.z)), b = W.data.buildingAt(p.x, p.z, pad); if (b) { buildingCard(b, ll); return true; } } }
    M.dirty = true; return false;
  }

  // ---------- חיפוש
  function getIdx() { const n = W.data.tiles.size; if (!S.idx || S.idxN !== n) { S.idx = L.buildIndex(W.data.tiles.values()); S.idxN = n; } return S.idx; }
  function goTo(x, z, zoom) { const ll = M.sceneToLL(x, z); if (!ll) return; M.lat = ll.lat; M.lon = ll.lon; M.z = Math.max(M.z, zoom); M.dirty = true; return ll; }
  function renderSearch() {
    const q = ui.q.value, res = L.search(getIdx(), q);
    ui.res.innerHTML = res.map((r, i) => `<button class="btn" data-i="${i}">${r.kind === 'street' ? '🛣' : '🏢'} ${esc(r.name)}</button>`).join('') || (L.norm(q).length > 1 ? '<div class="yzK">אין תוצאות באזור הטעון (החיפוש בשמות מ-OSM בתלת־ממד שנטען)</div>' : '');
    ui.res.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const r = res[+b.dataset.i]; closeSearch();
      if (r.kind === 'street') { S.sel = null; S.street = r.name; goTo(r.x, r.z, 16.5); show(''); }
      else { S.street = null; const ll = goTo(r.x, r.z, 18), bb = W.data.buildingById ? W.data.buildingById(r.id) : null; if (bb && ll) buildingCard(bb, ll); } });
  }
  function closeSearch() { ui.srch.style.display = 'none'; ui.tools.querySelector('[data-t=srch]').classList.remove('on'); ui.q.blur(); }

  // ---------- הנכסים שלי
  function mineList() {
    const g = G(), list = g && g.mine ? [...g.mine.values()].sort((a, b) => b.t - a.t) : [];
    show('card', `<div class="yzH">⭐ הנכסים שלי (${list.length})</div>` + (list.length ? `<div class="yzL">${list.map(o => `<button class="btn" data-id="${esc(o.id)}">${esc(o.name || o.street || 'בניין')} · ${o.floors || '?'} ק' · ${fmt(o.area || 0)} מ"ר</button>`).join('')}</div>`
      : '<div class="yzK">עוד אין. הקישו על בניין במפה ובחרו "⭐ סמן כשלי".</div>') + '<div class="r"><button class="btn" id="yzLMX" aria-label="סגירה">✕ סגירה</button></div>');
    $('yzLMX').onclick = () => show('');
    ui.card.querySelectorAll('[data-id]').forEach(bt => bt.onclick = () => { const o = g.mine.get(bt.dataset.id); if (!o) return; const ll = goTo(o.cx, o.cz, 18), b = W.data.buildingById ? W.data.buildingById(o.id) : null;
      if (b && ll) buildingCard(b, ll); else show(''); });
  }

  function build() {
    const css = document.createElement('style'); css.id = 'yzMapLayersCss'; css.textContent = `
#yzMap .yzT{position:absolute;right:8px;top:calc(env(safe-area-inset-top) + 62px);display:flex;flex-direction:column;gap:6px}
#yzMap .yzT .btn{width:44px;height:44px;min-height:44px;padding:0;font-size:19px;box-shadow:0 2px 8px #0004}
#yzMap .yzS{position:absolute;top:calc(env(safe-area-inset-top) + 62px);right:60px;left:8px;max-width:420px;margin-inline-start:auto;display:none;direction:rtl;background:rgba(12,20,32,.95);border:1px solid #ffffff26;border-radius:14px;padding:6px;box-shadow:0 8px 24px #0008}
#yzMap .yzS input{font:inherit;font-size:16px;width:100%;box-sizing:border-box;min-height:44px;padding:8px 10px;border-radius:10px;border:1px solid #ffffff33;background:#0a111b;color:#eef3f8;user-select:text}
#yzMap .yzS .res,#yzMap .yzL{max-height:38vh;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-top:4px}
#yzMap .yzS .res .btn,#yzMap .yzL .btn{min-height:40px;text-align:right;white-space:normal}
#yzMap .yzP .yzH{font-weight:700;font-size:14px;margin-bottom:4px}
#yzMap .yzP .yzK{font-size:12.5px;color:#cfd9e4;margin-bottom:6px;line-height:1.45}
#yzMap .yzP .r .btn,#yzMap .pk .r .btn{min-height:42px;min-width:42px}
#yzMap .tb .btn{min-height:42px;min-width:42px}
#yzMap.yzPanel .zm{top:calc(env(safe-area-inset-top) + 64px);bottom:auto}
#yzMap .yzP .r .btn:disabled{opacity:.45}
#yzMap .yzTag{font-size:10.5px;background:#ffffff1f;border-radius:6px;padding:1px 5px;color:#f6cf7f}
#yzMap .yzG{position:absolute;right:8px;bottom:calc(env(safe-area-inset-bottom) + 26px);display:none;align-items:center;gap:5px;font-size:10px;color:#222;background:#fffd;border-radius:6px;padding:1px 6px;direction:rtl}
#yzMap .yzG i{display:inline-block;width:70px;height:7px;border-radius:4px;background:linear-gradient(to left,${[0, 2, 5, 7].map(L.bucketColor).join(',')})}
`; document.head.appendChild(css);
    const el = M.el;
    const tools = document.createElement('div'); tools.className = 'yzT';
    tools.innerHTML = `<button class="btn ${S.heights ? 'on' : ''}" data-t="hgt" aria-label="צבע בניינים לפי גובה" title="צבע לפי גובה">🎨</button>` + (window.YZDev ? '<button class="btn" data-t="draw" aria-label="שרטוט מגרש" title="שרטוט מגרש">✏</button>' : '') +
      '<button class="btn" data-t="srch" aria-label="חיפוש רחוב" title="חיפוש רחוב">🔍</button><button class="btn" data-t="mine" aria-label="הנכסים שלי" title="הנכסים שלי">⭐</button>';
    const srch = document.createElement('div'); srch.className = 'yzS'; srch.innerHTML = '<input type="search" placeholder="רחוב או בניין…" aria-label="חיפוש רחוב או בניין" enterkeyhint="search"><div class="res"></div>';
    const card = document.createElement('div'); card.className = 'pk yzP'; card.setAttribute('aria-live', 'polite');
    const draw = document.createElement('div'); draw.className = 'pk yzP';
    const leg = document.createElement('div'); leg.className = 'yzG'; leg.innerHTML = '<span>גובה</span><span>0</span><i></i><span>60+ מ\'</span>';
    el.append(tools, srch, card, draw, leg);
    ui = { css, tools, srch, q: srch.querySelector('input'), res: srch.querySelector('.res'), card, draw, leg };
    // אירועי מצביע על הפאנלים לא יגיעו לקנבס (הם אחים שלו, לא ילדים) – אין צורך בעצירה
    tools.querySelector('[data-t=hgt]').onclick = e => { S.heights = !S.heights; e.currentTarget.classList.toggle('on', S.heights); try { localStorage.setItem('yz.map.heights', S.heights ? '1' : '0'); } catch (er) { /* */ } M.dirty = true; };
    const dr = tools.querySelector('[data-t=draw]'); if (dr) dr.onclick = () => { const d = dev(); if (!d) return; closeSearch(); S.sel = null;
      if (d.D.draw) { d.startDraw(); d.D.draw = false; refreshDevBar(); } else { d.startDraw(); if (M.z < 16) M.zoomAt(16, M.el.clientWidth / 2, M.el.clientHeight / 2); }
      S.drawSig = ''; M.dirty = true; };
    tools.querySelector('[data-t=srch]').onclick = e => { const open = srch.style.display !== 'block'; srch.style.display = open ? 'block' : 'none'; e.currentTarget.classList.toggle('on', open); if (open) { ui.q.focus(); renderSearch(); } };
    tools.querySelector('[data-t=mine]').onclick = () => { closeSearch(); if (S.panel === 'card' && ui.card.querySelector('#yzLMX')) show(''); else mineList(); };
    ui.q.addEventListener('input', renderSearch);
    ui.q.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = ui.res.querySelector('[data-i]'); if (b) b.click(); } if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); } });
  }

  YZW.register({
    id: 'map-layers', name: 'מפה דו־ממדית: בניינים, מגרש, חיפוש, נכסים', dept: 'integration (ממפת היזם)', order: 68,
    requires: () => !!window.YZMap,
    init(world) {
      W = world; M = window.YZMap; if (!M || !M.layers || !M.el) throw new Error('64-map.js בלי ווים (layers/onTap) – צריך את הגרסה המעודכנת');
      build(); M.layers.push(layer); M.onTap = onTap;
    },
    dispose() { if (!M) return; const i = M.layers.indexOf(layer); if (i >= 0) M.layers.splice(i, 1); if (M.onTap === onTap) M.onTap = null;
      if (ui) { ['tools', 'srch', 'card', 'draw', 'leg', 'css'].forEach(k => ui[k].remove()); ui = null; } M.dirty = true; },
  });
  window.YZMapLayers.S = S;
})();
