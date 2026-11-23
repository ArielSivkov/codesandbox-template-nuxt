/* מצב יזם — "הכניסה השנייה" לאותו עולם (אותו מנוע, אותם נתונים, אותה שמש/מזג אוויר/זמן, אותו בניין נבחר).
 * מבוסס על תכונות המפה של גדוד 6 (b6/map): מצלמת מסלול מלמעלה, שכבות צבע (גובה / ודאות), כרטיס בניין עם כמויות
 * וקישור הצעה (הכרטיס של המשחק – אותו פורמט #pre=), שרטוט מגרש (שרוך, היקף, מבנים בתוך המגרש), חיפוש רחוב/בניין,
 * קישור עמוק ?mode=dev&at=E,N,מרחק&b=מזהה (מסגרת האריחים של גדוד 5), ומעבר למצגת.
 * פער (נרשם ביומן): המנוע של גדוד 6 עצמו (Worker, פורמט YZT1, מדידות שטח) עדיין אפליקציה נפרדת עם רנדרר משלה — כאן התכונות הועברו.
 */
(function () {
  'use strict';
  const D = { on: false, tx: 0, tz: 0, dist: 260, layer: 'none', draw: false, pts: [], ov: new Map(), grp: null, plotObj: null, pinch: null, ui: null, search: '' };
  const fmt = (n, d = 0) => Number(n).toLocaleString('he-IL', { maximumFractionDigits: d, minimumFractionDigits: d });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let WLD = null;
  const $ = id => document.getElementById(id);

  // ---------- שכבות: כיפות גג צבועות, ממוזגות לאריח
  const ramp = (t, c) => { t = Math.max(0, Math.min(1, t)); const s = [[0.18, 0.42, 0.85], [0.2, 0.75, 0.6], [0.98, 0.83, 0.3], [0.93, 0.36, 0.25]]; const f = t * 3, i = Math.min(2, Math.floor(f)), k = f - i; for (let j = 0; j < 3; j++) c[j] = s[i][j] + (s[i + 1][j] - s[i][j]) * k; return c; };
  const CONFC = [[0.2, 0.75, 0.45], [0.45, 0.8, 0.4], [0.98, 0.8, 0.3], [0.93, 0.36, 0.25]];
  function buildOverlay(t) {
    if (!t.blds || !t.blds.length) return null; const pos = [], col = [], c = [0, 0, 0];
    for (const b of t.blds) {
      if (D.layer === 'height') ramp((b.top - b.base) / 60, c); else { const cc = CONFC[b.src === 'R' || b.src === 'N' || b.src === 'B' ? 3 : b.conf != null ? Math.min(3, b.conf) : 3]; c[0] = cc[0]; c[1] = cc[1]; c[2] = cc[2]; }
      const pts = []; for (let i = 0; i < b.n; i++) pts.push(new THREE.Vector2(b.p[i * 2], b.p[i * 2 + 1]));
      let tri; try { tri = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { continue; }
      const y = b.top + 0.35; for (const tr of tri) for (const k of tr) { pos.push(pts[k].x, y, pts[k].y); col.push(c[0], c[1], c[2]); }
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.88, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.renderOrder = 2; return m;
  }
  function clearOverlay() { for (const m of D.ov.values()) { D.grp.remove(m); m.geometry.dispose(); m.material.dispose(); } D.ov.clear(); }
  function setLayer(l) { D.layer = l; clearOverlay(); if (l !== 'none') for (const t of WLD.data.tiles.values()) addTileOv(t); renderBar(); legend(); }
  function addTileOv(t) { if (D.layer === 'none' || D.ov.has(t.key)) return; const m = buildOverlay(t); if (m) { D.grp.add(m); D.ov.set(t.key, m); } }
  function legend() { const el = $('yzLeg'); if (!el) return; el.style.display = D.layer === 'none' || !D.on ? 'none' : 'block';
    el.innerHTML = D.layer === 'height' ? '<b>גובה בניין</b><div class="lg" style="background:linear-gradient(90deg,#2e6bd9,#33bf99,#fad44d,#ed5c40)"></div><span>0</span><span style="float:left">60+ מ׳</span>'
      : '<b>ודאות הגובה</b><div>🟩 נמדד · 🟨 מקור חיצוני · 🟥 משוער, לא נמדד (כלל אצבע)</div><div style="color:#ffb39a">כרגע כל הגבהים בנתונים משוערים — אין עדיין עוגני מדידה</div>'; }

  // ---------- שרטוט מגרש
  function groundHit(cx, cy) {
    const r = WLD.renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, WLD.camera); const o = rc.ray.origin, d = rc.ray.direction; if (d.y > -1e-3) return null;
    let y = Math.max(0, WLD.data.H(D.tx, D.tz)); let p = null;
    for (let i = 0; i < 3; i++) { const t = (y - o.y) / d.y; p = o.clone().addScaledVector(d, t); y = Math.max(0, WLD.data.H(p.x, p.z)); }
    return p;
  }
  function drawPlot() {
    if (D.plotObj) { D.grp.remove(D.plotObj); D.plotObj.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); }); D.plotObj = null; }
    if (!D.pts.length) return; const g = new THREE.Group(); const H = WLD.data.H;
    const v = D.pts.map(p => new THREE.Vector3(p.x, Math.max(0, H(p.x, p.z)) + 0.6, p.z)); if (v.length > 2) v.push(v[0]);
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: 0xf2b84b, depthTest: false, fog: false })));
    g.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(v), new THREE.PointsMaterial({ color: 0xffffff, size: 9, sizeAttenuation: false, depthTest: false, fog: false })));
    if (D.pts.length > 2) { const sh = new THREE.Shape(D.pts.map(p => new THREE.Vector2(p.x, p.z))); const sg = new THREE.ShapeGeometry(sh); sg.rotateX(Math.PI / 2);
      const avg = v.reduce((s, q) => s + q.y, 0) / v.length; const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xf2b84b, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, fog: false })); m.position.y = avg - 0.2; g.add(m); }
    g.children.forEach(c => c.renderOrder = 3); D.plotObj = g; D.grp.add(g);
  }
  function plotStats() {
    const p = D.pts, n = p.length; let a = 0, per = 0; for (let i = 0; i < n; i++) { const q = p[i], r = p[(i + 1) % n]; a += q.x * r.z - r.x * q.z; per += Math.hypot(r.x - q.x, r.z - q.z); }
    const area = Math.abs(a / 2); let nb = 0, foot = 0, ff = 0;
    const pin = (x, z) => { let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const A = p[i], B = p[j]; if ((A.z > z) !== (B.z > z) && x < (B.x - A.x) * (z - A.z) / (B.z - A.z) + A.x) c = !c; } return c; };
    for (const t of WLD.data.tiles.values()) for (const b of t.blds || []) if (pin(b.cx, b.cz)) { nb++; foot += b.area || 0; ff += (b.area || 0) * (b.floors || 1); }
    return { area, per, nb, foot, avgF: foot ? ff / foot : 0 };
  }
  function showPlotCard() {
    const s = plotStats(), card = $('card'); if (!card) return; const it = D.pts.map(q => WLD.coords.toITM(q.x, q.z));
    const basis = `מגרש משורטט במפת לוח היזם: שטח ${fmt(s.area)} מ"ר, היקף ${fmt(s.per)} מ', ${s.nb} מבנים בתוך המגרש (טביעה ${fmt(s.foot)} מ"ר). שרטוט ידני – לאימות מול מדידה.`;
    const pre = { lines: [{ id: 'P001', qty: 1 }], basis: basis.slice(0, 400), hint: 'מגרש' };
    card.innerHTML = `<h2>📐 מגרש משורטט <button class="btn x" id="yzPlX" aria-label="סגירה">✕</button></h2><table>
      <tr><td>סוג</td><td>פוליגון ששורטט ידנית — <b>לא</b> חלקה רשומה</td></tr>
      <tr><td>שטח</td><td><b>${fmt(s.area)}</b> מ״ר (${fmt(s.area / 1000, 2)} דונם)</td></tr><tr><td>היקף</td><td>${fmt(s.per)} מ׳ · ${D.pts.length} פינות</td></tr>
      <tr><td>מבנים בתוך המגרש</td><td>${s.nb} · טביעה ${fmt(s.foot)} מ״ר${s.nb ? ' · ממוצע ' + s.avgF.toFixed(1) + ' קומות' : ''}</td></tr>
      <tr><td>פינה ראשונה (ITM, מסגרת הדגימה)</td><td class="ltr">${it[0] ? Math.round(it[0].E) + ', ' + Math.round(it[0].N) : ''}</td></tr></table>
      <p class="note">שטח בנוסחת השרוך ברשת ישראל, בדיוק השרטוט על המסך.</p>
      <div class="acts"><a class="btn pri" target="_blank" rel="noopener" href="https://yazam.esh27.com/#pre=${encodeURIComponent(JSON.stringify(pre))}">💬 הצעה בלוח היזם</a><button class="btn" id="yzPlPres">🎬 מצגת על המגרש</button></div>`;
    card.style.display = 'block'; $('yzPlX').onclick = () => card.style.display = 'none';
    $('yzPlPres').onclick = () => YZW.setMode('present');
  }
  // אימות מצולע (צוות אדום 3): נקודה כפולה, נגיעה/חפיפה/חיתוך (כולל מגע בקודקוד), קודקוד על צלע, שטח אפסי/קולינארי
  const EPS = 0.3;
  function segDist(p, a, b) { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-12; let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz); }
  function segsTouch(a, b, c, d) { const o = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return segDist(a, c, d) < EPS || segDist(b, c, d) < EPS || segDist(c, a, b) < EPS || segDist(d, a, b) < EPS; }
  function validate(pts, closing) {
    const n = pts.length; if (n < 2) return '';
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 0.5) return 'נקודה כפולה';
    const E = []; for (let i = 0; i < n - 1; i++) E.push([i, i + 1]); if (closing && n >= 3) E.push([n - 1, 0]);
    for (let x = 0; x < E.length; x++) for (let y = x + 1; y < E.length; y++) { const [a, b] = E[x], [c, d] = E[y];
      const shared = a === c || a === d || b === c || b === d;
      if (!shared) { if (segsTouch(pts[a], pts[b], pts[c], pts[d])) return 'צלעות נוגעות או חותכות זו את זו'; }
      else { const o1 = a === c || a === d ? b : a, o2 = c === a || c === b ? d : c; // צלעות סמוכות: קיפול לאחור על אותו קו
        if (segDist(pts[o1], pts[c], pts[d]) < EPS || segDist(pts[o2], pts[a], pts[b]) < EPS) return 'קודקוד יושב על צלע'; } }
    if (closing) { if (n < 3) return 'צריך לפחות 3 פינות';
      let ar = 0, per = 0; for (let i = 0; i < n; i++) { const q = pts[i], r = pts[(i + 1) % n]; ar += q.x * r.z - r.x * q.z; per += Math.hypot(r.x - q.x, r.z - q.z); } ar = Math.abs(ar / 2);
      if (ar < 1 || ar < 0.002 * per * per) return 'שטח אפסי (נקודות על קו אחד)'; }
    return '';
  }
  D.validate = validate;
  function addPoint(x, z) { const next = D.pts.concat([{ x, z }]); const err = validate(next, false); if (err) { YZW.notice('✏ ' + err + ' — הנקודה לא נוספה', { ms: 2200 }); return false; } D.pts = next; drawPlot(); renderBar(); return true; }
  function finishPlot() { const err = validate(D.pts, true); if (err) { YZW.notice('✏ המצולע לא תקין: ' + err, { ms: 2600 }); return false; } D.draw = false; renderBar(); showPlotCard(); return true; }
  function tapDraw(e) {
    if (!D.on || !D.draw || e.target !== WLD.renderer.domElement) return;
    const s = D.down; if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10 || performance.now() - s.t > 450) return;
    e.stopPropagation(); const p = groundHit(e.clientX, e.clientY); if (!p) return; addPoint(p.x, p.z);
  }

  // ---------- חיפוש: שמות רחובות ובניינים מהאריחים הטעונים
  function dropHere(cx, cy) { const p = groundHit(cx, cy); if (!p) return; if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { /* */ }
    YZW.notice('🧍 הדמות הונחה כאן', { kind: 'info', ms: 1400 }); WLD.player.selected = null; YZW.setMode('walk', false, { x: p.x, y: p.y, z: p.z }); }
  function search(q) {
    q = q.trim(); if (q.length < 2) return []; const out = [], seen = new Set();
    for (const t of WLD.data.tiles.values()) {
      for (const r of t.roads || []) if (r.name && r.name.includes(q) && !seen.has('r' + r.name)) { seen.add('r' + r.name); out.push({ kind: 'רחוב', name: r.name, x: r.p[0], z: r.p[1] }); }
      for (const b of t.blds || []) if (b.name && b.name.includes(q) && !seen.has(b.id)) { seen.add(b.id); out.push({ kind: 'בניין', name: b.name, x: b.cx, z: b.cz, b }); }
      if (out.length > 12) break;
    }
    return out.slice(0, 12);
  }
  function flyTo(x, z, dist) { D.fly = { a: { x: D.tx, z: D.tz, d: D.dist }, b: { x, z, d: dist || 220 }, t: 0 }; }

  // ---------- סרגל כלים
  function renderBar() {
    const el = D.ui; if (!el) return; el.style.display = D.on ? 'flex' : 'none'; if (!D.on) return;
    el.innerHTML = `<div class="seg"><button data-l="none" class="${D.layer === 'none' ? 'on' : ''}">רגיל</button><button data-l="height" class="${D.layer === 'height' ? 'on' : ''}">גובה</button><button data-l="conf" class="${D.layer === 'conf' ? 'on' : ''}">ודאות</button></div>
      <button class="btn ${D.draw ? 'on' : ''}" id="yzDraw">✏ ${D.draw ? 'שרטוט פעיל · ' + D.pts.length : 'שרטוט מגרש'}</button>
      ${D.draw ? `<button class="btn pri" id="yzDrawOk" ${D.pts.length < 3 ? 'disabled' : ''}>✔ סיום</button><button class="btn" id="yzDrawUndo">↶</button><button class="btn" id="yzDrawX">✕</button>` : ''}
      <button class="btn" id="yzSrchB">🔍</button><button class="btn" id="yzLink">🔗</button><button class="btn" id="yzPres">🎬 מצגת</button><button class="btn" id="yzPlay">🎮 למשחק</button>
      <div id="yzSrch" style="display:${D.srchOpen ? 'block' : 'none'};width:100%"><input id="yzQ" placeholder="רחוב או בניין…" value="${esc(D.search)}" style="font:inherit;width:100%;padding:8px;border-radius:10px;border:1px solid #ffffff33;background:#0a111b;color:#eef3f8;user-select:text"><div id="yzRes"></div></div>`;
    el.querySelectorAll('[data-l]').forEach(b => b.onclick = () => setLayer(b.dataset.l));
    $('yzDraw').onclick = () => { D.draw = !D.draw; if (D.draw) { D.pts = []; drawPlot(); YZW.notice('✏ הקישו על הקרקע להוספת פינות; גרירה מסובבת מצלמה', { kind: 'info', ms: 2600 }); } renderBar(); };
    if (D.draw) { $('yzDrawOk').onclick = finishPlot; $('yzDrawUndo').onclick = () => { D.pts.pop(); drawPlot(); renderBar(); }; $('yzDrawX').onclick = () => { D.draw = false; D.pts = []; drawPlot(); renderBar(); }; }
    $('yzSrchB').onclick = () => { D.srchOpen = !D.srchOpen; renderBar(); if (D.srchOpen) $('yzQ').focus(); };
    const q = $('yzQ'); if (q) q.oninput = () => { D.search = q.value; const res = search(q.value);
      $('yzRes').innerHTML = res.map((r, i) => `<button class="btn" data-r="${i}" style="margin:3px 0 0 4px">${r.kind === 'רחוב' ? '🛣' : '🏢'} ${esc(r.name)}</button>`).join('') || (q.value.length > 1 ? '<span class="mut">אין תוצאות באזור הטעון</span>' : '');
      $('yzRes').querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const r = res[+b.dataset.r]; flyTo(r.x, r.z, r.b ? 160 : 300); if (r.b) { WLD.player.selected = r.b; WLD.G27.showCard(r.b); } D.srchOpen = false; renderBar(); }); };
    $('yzLink').onclick = () => { const it = WLD.coords.toITM(D.tx, D.tz), sel = WLD.player.selected;
      const u = location.origin + location.pathname + `?mode=dev&at=${Math.round(it.E)},${Math.round(it.N)},${Math.round(D.dist)}` + (sel ? '&b=' + encodeURIComponent(sel.id) : '');
      history.replaceState(null, '', u); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => YZW.notice('🔗 הקישור הועתק', { kind: 'info', ms: 1500 }), () => YZW.notice(u, { kind: 'info', ms: 6000 })); };
    $('yzPres').onclick = () => YZW.setMode('present'); $('yzPlay').onclick = () => YZW.setMode('walk');
  }

  window.YZDev = { D, drop: (x, y) => dropHere(x, y), addPoint: (...a) => addPoint(...a), finish: () => finishPlot(), stats: () => plotStats(), validate: (p, c) => validate(p, c), setLayer: l => setLayer(l), startDraw: () => { D.draw = true; D.pts = []; drawPlot(); renderBar(); } };
  YZW.register({
    id: 'dev', name: 'העין הגדולה ⇄ הדמות (מפה, שכבות, כרטיס, מגרש)', dept: 'integration (תכונות מגדוד 6)', order: 40, provides: ['dev'],
    init(world, api) {
      WLD = world; D.grp = api.group();
      const bar = document.createElement('div'); bar.id = 'yzDevBar';
      bar.style.cssText = 'position:fixed;z-index:12;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom) + 8px);display:none;gap:6px;flex-wrap:wrap;justify-content:center;align-items:center;direction:rtl;pointer-events:auto';
      document.body.appendChild(bar); D.ui = bar;
      const lg = document.createElement('div'); lg.id = 'yzLeg'; lg.style.cssText = 'position:fixed;z-index:11;left:8px;bottom:calc(env(safe-area-inset-bottom) + 64px);width:170px;background:rgba(12,20,32,.85);border:1px solid #ffffff26;border-radius:10px;padding:6px 8px;font-size:11px;color:#eef3f8;display:none;direction:rtl';
      document.body.appendChild(lg); const st = document.createElement('style'); st.textContent = '#yzLeg .lg{height:8px;border-radius:4px;margin:4px 0}body[data-yz-mode=dev] #joy,body[data-yz-mode=dev] #acts,body[data-yz-mode=dev] #hud{display:none!important}#yzDevBar .seg{display:flex;border:1px solid #ffffff33;border-radius:12px;overflow:hidden;background:rgba(12,20,32,.85)}#yzDevBar .seg button{font:inherit;font-size:13px;background:transparent;color:#eef3f8;border:0;padding:8px 10px;min-height:38px}#yzDevBar .seg button.on{background:#f2b84b;color:#1b1300;font-weight:700}'; document.head.appendChild(st); D.style = st;
      api.eachTile((t, kind) => { if (kind === 'remove') { const m = D.ov.get(t.key); if (m) { D.grp.remove(m); m.geometry.dispose(); m.material.dispose(); D.ov.delete(t.key); } } else if (kind === 'add' && D.on) addTileOv(t); });
      const cv = world.renderer.domElement;
      D.pd = e => { D.down = { x: e.clientX, y: e.clientY, t: performance.now() }; clearTimeout(D.lpT);
        if (D.on && !D.draw && !D.pinch) D.lpT = setTimeout(() => { const s2 = D.down; if (!s2 || !D.on || D.pinch || D.moved) return; dropHere(s2.x, s2.y); }, 600); D.moved = false; };
      D.pm = e => { if (D.down && Math.hypot(e.clientX - D.down.x, e.clientY - D.down.y) > 10) { D.moved = true; clearTimeout(D.lpT); } };
      D.pup = () => clearTimeout(D.lpT);
      cv.addEventListener('pointerdown', D.pd); cv.addEventListener('pointermove', D.pm); cv.addEventListener('pointerup', D.pup);
      // מתג קבוע על המסך: העין הגדולה ⇄ הדמות
      const tg = document.createElement('button'); tg.id = 'yzEye'; tg.className = 'btn pri'; tg.setAttribute('aria-label', 'החלפת מבט: העין הגדולה או הדמות');
      tg.style.cssText = 'position:fixed;z-index:13;left:8px;top:calc(env(safe-area-inset-top) + 138px);font-weight:700;font-size:13px;padding:6px 10px;min-height:36px';
      tg.onclick = () => YZW.setMode(world.player.mode === 'dev' ? (D.back || 'walk') : 'dev'); document.body.appendChild(tg); D.tg = tg;
      const upd = () => { tg.textContent = world.player.mode === 'dev' ? '🧍 הדמות' : '👁 העין הגדולה'; }; api.on('mode', e => { if (e.id !== 'dev' && e.id !== 'present') D.back = e.id === 'walk' || ['car', 'heli', 'jetpack', 'drone'].includes(e.id) ? e.id : 'walk'; upd(); }); upd();
      D.pu = e => tapDraw(e); addEventListener('pointerup', D.pu, true);
      D.wh = e => { if (!D.on) return; D.dist = Math.max(25, Math.min(6000, D.dist * (e.deltaY > 0 ? 1.12 : 0.89))); }; cv.addEventListener('wheel', D.wh, { passive: true });
      // צביטה = זום, שתי אצבעות = הזזה
      const tp = new Map(); D.tp = tp;
      D.ts = e => { if (!D.on) return; for (const t of e.changedTouches) tp.set(t.identifier, { x: t.clientX, y: t.clientY }); if (tp.size === 2) { const [a, b] = [...tp.values()]; D.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: D.dist, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; } };
      D.tm = e => { if (!D.on || !D.pinch) return; for (const t of e.changedTouches) tp.set(t.identifier, { x: t.clientX, y: t.clientY }); if (tp.size < 2) return; const [a, b] = [...tp.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y); D.dist = Math.max(25, Math.min(6000, D.pinch.dist * D.pinch.d / Math.max(d, 1)));
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, k = D.dist / innerHeight * 1.2, yaw = world.G27.S.cam.yaw;
        const dx = (mx - D.pinch.mx) * k, dy = (my - D.pinch.my) * k; D.pinch.mx = mx; D.pinch.my = my;
        D.tx -= Math.cos(yaw) * dx + Math.sin(yaw) * dy * -1; D.tz -= -Math.sin(yaw) * dx + Math.cos(yaw) * dy * -1; };
      D.te = e => { for (const t of e.changedTouches) tp.delete(t.identifier); if (tp.size < 2) D.pinch = null; };
      cv.addEventListener('touchstart', D.ts, { passive: true }); cv.addEventListener('touchmove', D.tm, { passive: true }); cv.addEventListener('touchend', D.te, { passive: true }); cv.addEventListener('touchcancel', D.te, { passive: true });
    },
    dispose(world) { const cv = world.renderer.domElement; cv.removeEventListener('pointerdown', D.pd); cv.removeEventListener('pointermove', D.pm); cv.removeEventListener('pointerup', D.pup); if (D.tg) D.tg.remove(); removeEventListener('pointerup', D.pu, true); cv.removeEventListener('wheel', D.wh);
      ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((ev, i) => cv.removeEventListener(ev, [D.ts, D.tm, D.te, D.te][i]));
      clearOverlay(); if (D.ui) D.ui.remove(); const lg = $('yzLeg'); if (lg) lg.remove(); if (D.style) D.style.remove(); D.on = false; },
    modes: [{
      id: 'dev', name: 'העין הגדולה', icon: '👁', sub: 'מפה וכלים',
      enter(world, from, pos) {
        const G = world.G27, W = world.data; D.on = true; D.tx = pos.x; D.tz = pos.z; D.fly = null;
        D.dist = from === 'heli' || from === 'jet' || from === 'spaceship' ? Math.max(220, (pos.y || 0) * 1.6) : 260;
        G.S.cam.pitch = 0.62;
        const qd = new URLSearchParams(location.search).get('at'); if (!D.usedQ && qd && qd.split(',')[2]) { D.dist = Math.max(25, Math.min(6000, +qd.split(',')[2])); } D.usedQ = true;
        D.tr = { a: world.camera.position.clone(), look: new THREE.Vector3(pos.x, (pos.y || 0) + 1.4, pos.z), t: 0, t0: performance.now() };
        // נחתתם במסוק/רחפן על גג? פותחים את הכרטיס שלו
        const b = W.buildingAt(pos.x, pos.z, 1.5); if (b && (from !== 'walk' || pos.y > b.top - 1.5)) { world.player.selected = b; G.showCard(b); }
        else if (world.player.selected) G.showCard(world.player.selected);
        if (D.layer !== 'none') for (const t of world.data.tiles.values()) addTileOv(t);
        if (D.plotObj) D.plotObj.visible = true; renderBar(); legend();
      },
      exit(world) { D.on = false; D.draw = false; renderBar(); legend(); clearOverlay(); if (D.plotObj) D.plotObj.visible = false;
        if (world.sunLight) { const sc = world.sunLight.shadow.camera; sc.left = sc.bottom = -85; sc.right = sc.top = 85; sc.far = 900; sc.updateProjectionMatrix(); }
        world.G27.S.cam.pitch = 0.3; },
      update(dt, world, inp) {
        const G = world.G27, cam = world.camera, yaw = G.S.cam.yaw;
        if (D.fly) { D.fly.t = Math.min(1, D.fly.t + dt / 1.1); const k = D.fly.t < 0.5 ? 2 * D.fly.t ** 2 : 1 - (-2 * D.fly.t + 2) ** 2 / 2;
          D.tx = D.fly.a.x + (D.fly.b.x - D.fly.a.x) * k; D.tz = D.fly.a.z + (D.fly.b.z - D.fly.a.z) * k; D.dist = D.fly.a.d + (D.fly.b.d - D.fly.a.d) * k; if (D.fly.t >= 1) D.fly = null; }
        // ג׳ויסטיק = הזזה, ▲/▼ = זום
        const sp = D.dist * 0.9 * dt; D.tx += (Math.sin(yaw) * inp.y + Math.cos(yaw) * inp.x) * sp; D.tz += (Math.cos(yaw) * inp.y - Math.sin(yaw) * inp.x) * sp;
        if (inp.up) D.dist = Math.max(25, D.dist * (1 - dt * 1.2)); if (inp.down) D.dist = Math.min(6000, D.dist * (1 + dt * 1.2));
        const B = world.data.bounds; if (B) { D.tx = Math.max(B.minx, Math.min(B.maxx, D.tx)); D.tz = Math.max(B.minz, Math.min(B.maxz, D.tz)); }
        const phi = Math.max(0.3, Math.min(1.45, G.S.cam.pitch * 1.5 + 0.2)); G.S.cam.pitch = Math.max(0.07, Math.min(0.83, G.S.cam.pitch));
        const ty = Math.max(0, world.data.H(D.tx, D.tz)), cp = Math.cos(phi), s = Math.sin(phi);
        cam.position.set(D.tx - Math.sin(yaw) * cp * D.dist, ty + s * D.dist, D.tz - Math.cos(yaw) * cp * D.dist);
        if (D.tr) { D.tr.t = Math.min(1, D.tr.t + dt / 1.0); const e = D.tr.t < 0.5 ? 2 * D.tr.t ** 2 : 1 - (-2 * D.tr.t + 2) ** 2 / 2; const goal = cam.position.clone();
          cam.position.lerpVectors(D.tr.a, goal, e); const lk = D.tr.look.clone().lerp(new THREE.Vector3(D.tx, ty, D.tz), e); cam.lookAt(lk);
          if (D.tr.t >= 1) { world.stats.lastFlyOutMs = Math.round(performance.now() - D.tr.t0); D.tr = null; } }
        else cam.lookAt(D.tx, ty, D.tz);
        world.eyeDist = D.dist;
        const f = world.scene.fog; if (f) { f.far = Math.max(f.far, D.dist * 3.2 + 600); f.near = f.far * 0.45; }
        cam.near = D.dist > 600 ? 3 : 0.5; cam.far = (f ? f.far : 4000) + 2000; cam.updateProjectionMatrix();
        if (world.sunLight && world.sky) { const sd = world.sky.material.uniforms.sun.value, L = world.sunLight; L.target.position.set(D.tx, ty, D.tz); L.position.set(D.tx + sd.x * 600, ty + sd.y * 600, D.tz + sd.z * 600);
          const r = Math.min(600, Math.max(85, D.dist * 0.8)), sc = L.shadow.camera; if (Math.abs(sc.right - r) > 5) { sc.left = sc.bottom = -r; sc.right = sc.top = r; sc.far = 2000; sc.updateProjectionMatrix(); } }
        return { x: D.tx, y: ty, z: D.tz, speed: 0, alt: D.dist };
      },
    }],
  });
})();
