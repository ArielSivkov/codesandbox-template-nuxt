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

  // ---------- מצלמת "גוגל ארת'" (eyecam, 24.11): רצף זום מ-15 מ' עד 22,000 ק"מ, הטיה מלמעלה-למטה עד קרוב לאופק, מחוות מגע מלאות.
  //   אצבע אחת = גרירת הקרקע (הנקודה נשארת מתחת לאצבע) + אינרציה · צביטה = זום סביב מרכז האצבעות · סיבוב שתי אצבעות = סיבוב
  //   שתי אצבעות למעלה/למטה = הטיה · הקשה כפולה = זום פנימה לנקודה · הקשה בשתי אצבעות = זום החוצה · לחיצה ארוכה = הנחת הדמות
  //   עכבר: גרירה = הזזה, גרירה ימנית / Ctrl = סיבוב והטיה, גלגלת = זום לכיוון הסמן.
  const MIN_D = 15, MAX_D = 2.2e7, PHI_MAX = 1.5533, RE = 6371000;
  const phiMin = d => 0.10 + Math.min(1, Math.max(0, Math.log10(d / 2e4) / 3)) * 0.95;   // ככל שמתרחקים — פחות אופק (כמו גוגל ארת')
  const clampD = d => Math.max(MIN_D, Math.min(MAX_D, d));
  const GS = { ptr: new Map(), mode: null, multi: false, grab: null, hist: [], lastTap: null, tapT: null, lpT: null, moved: false, t0: 0, two: null };
  D.phi = 0.95; D.vel = null; D.vyaw = 0; D.still = 0; D.ty = 0;
  const RC = new THREE.Raycaster(), NDC = new THREE.Vector2();
  function rayPlane(cx, cy, y) {
    const r = WLD.renderer.domElement.getBoundingClientRect(); NDC.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    RC.setFromCamera(NDC, WLD.camera); const o = RC.ray.origin, d = RC.ray.direction; if (d.y > -0.02) return null;
    const t = (y - o.y) / d.y; if (t < 0 || t > Math.max(4000, D.dist * 12)) return null; return o.clone().addScaledVector(d, t);
  }
  // מיקום המצלמה מתוך המצב (נקרא גם מתוך מחוות, כדי שהקרן הבאה תחושב מול המצלמה המעודכנת)
  function placeCam() {
    const G = WLD.G27, cam = WLD.camera, yaw = G.S.cam.yaw;
    D.dist = clampD(D.dist); D.phi = Math.max(phiMin(D.dist), Math.min(PHI_MAX, D.phi));
    const lim = D.dist > 2e4 ? 1.5e6 : null, B = WLD.data.bounds;
    if (lim) { D.tx = Math.max(-lim, Math.min(lim, D.tx)); D.tz = Math.max(-lim, Math.min(lim, D.tz)); }
    else if (B) { const m = 60000; D.tx = Math.max(B.minx - m, Math.min(B.maxx + m, D.tx)); D.tz = Math.max(B.minz - m, Math.min(B.maxz + m, D.tz)); }
    const ty = D.ty = Math.max(0, WLD.data.H(D.tx, D.tz)), cp = Math.cos(D.phi), s = Math.sin(D.phi);
    cam.position.set(D.tx - Math.sin(yaw) * cp * D.dist, ty + s * D.dist, D.tz - Math.cos(yaw) * cp * D.dist);
    // לא מתחת לקרקע ולא בתוך בניין
    const gy = Math.max(0, WLD.data.H(cam.position.x, cam.position.z)); let floor = gy + 2;
    const b = D.dist < 3000 && WLD.data.buildingAt(cam.position.x, cam.position.z, 1.5); if (b && cam.position.y < b.top + 3) floor = Math.max(floor, b.top + 3);
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(D.tx, ty, D.tz); cam.updateMatrixWorld();
  }
  // מבט אווירי: מה שלא נראה מגובה (דמויות, רכבים, ריהוט רחוב, אוניות, מדרכות) — מוסתר; מוחזר בירידה או ביציאה מהעין הגדולה
  const AH = { hidden: new Set(), band: 0, t: 0 };
  function aerialHide(world, alt, dt) {
    AH.t -= dt; const band = alt > 2500 ? 3 : alt > 1200 ? 2 : alt > 700 ? 1 : 0; if (AH.t > 0 && band === AH.band) return; AH.t = 0.4; AH.band = band;
    const W = world.data.W, keep = new Set([W.root, world.sky, W.sea, D.grp, window.YZFar && window.YZFar.grp]);
    for (const o of world.scene.children) { if (o.isLight || keep.has(o) || (o.name === 'yz:buildings') || (o.name === 'yz:maritime' && band < 3)) continue;
      const hide = band >= 1 && !(o.isObject3D && o.type === 'Object3D' && !o.children.length);
      if (hide && o.visible) { o.visible = false; AH.hidden.add(o); } else if (!hide && AH.hidden.has(o)) { o.visible = true; AH.hidden.delete(o); } }
    for (const t of W.tiles.values()) if (t.roadGrp) for (const m of t.roadGrp.children) if (m.material === W.MAT.walk) m.visible = band < 2;
  }
  function aerialRestore(world) { for (const o of AH.hidden) o.visible = true; AH.hidden.clear(); AH.band = 0; const W = world.data.W; for (const t of W.tiles.values()) if (t.roadGrp) for (const m of t.roadGrp.children) m.visible = true; }
  const kill = () => { D.vel = null; D.vyaw = 0; D.fly = null; D.tr = null; };
  function pickBuilding(cx, cy) {
    const W = WLD.data.W, r = WLD.renderer.domElement.getBoundingClientRect(); NDC.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    RC.setFromCamera(NDC, WLD.camera); RC.far = Math.max(900, D.dist * 4);
    const objs = []; for (const t of W.tiles.values()) { if (t.hi && t.hi.parent) objs.push(t.hi); if (t.lo && t.lo.parent) objs.push(t.lo); }
    const hit = RC.intersectObjects(objs, false)[0]; RC.far = Infinity;
    if (!hit) {   // גיבוי: צעידה לאורך הקרן מול אינדקס הבניינים (תוסף הבניינים משנה גבהים — תיבות התחימה של הרשת לא תמיד מעודכנות)
      const o = RC.ray.origin, d = RC.ray.direction, st = Math.max(0.5, D.dist / 500), H = WLD.data.H;
      for (let t = 0; t < Math.max(900, D.dist * 3); t += st) { const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; const b = WLD.data.buildingAt(x, z, 0);
        if (b && y <= b.top && y >= b.base - 1) return b; if (y < Math.max(0, H(x, z)) - 0.5) break; }
      return null; }
    const n = hit.face ? hit.face.normal : null; return WLD.data.buildingAt(hit.point.x - (n ? n.x * 0.3 : 0), hit.point.z - (n ? n.z * 0.3 : 0), 1.5);
  }
  function zoomAt(cx, cy, k) {   // k<1 = פנימה; הנקודה מתחת לסמן נשארת במקומה
    const p0 = rayPlane(cx, cy, D.ty); D.dist = clampD(D.dist * k); placeCam();
    if (p0) { const p1 = rayPlane(cx, cy, D.ty); if (p1) { D.tx += p0.x - p1.x; D.tz += p0.z - p1.z; placeCam(); } }
  }
  function flyZoom(cx, cy, k) { const p = rayPlane(cx, cy, D.ty); const x = p && k < 1 ? D.tx + (p.x - D.tx) * (1 - k) : D.tx, z = p && k < 1 ? D.tz + (p.z - D.tz) * (1 - k) : D.tz; D.fly = { a: { x: D.tx, z: D.tz, d: D.dist }, b: { x, z, d: clampD(D.dist * k) }, t: 0 }; }
  function panTo(cx, cy, ts) {   // גרירה: הנקודה שנתפסה נשארת מתחת לאצבע
    const g = GS.grab; if (!g) return;
    const p = rayPlane(cx, cy, g.y);
    if (p && g.p) { D.tx += g.p.x - p.x; D.tz += g.p.z - p.z; }
    else { const k = D.dist / innerHeight * 1.4, yaw = WLD.G27.S.cam.yaw, dx = (cx - g.cx) * k, dy = (cy - g.cy) * k;   // קרוב לאופק: גרירה יחסית
      D.tx += Math.cos(yaw) * dx - Math.sin(yaw) * dy; D.tz += -Math.sin(yaw) * dx - Math.cos(yaw) * dy; g.p = null; }
    g.cx = cx; g.cy = cy; placeCam();
    const now = ts || performance.now(); GS.hist.push([now, D.tx, D.tz]); while (GS.hist.length > 2 && now - GS.hist[0][0] > 120) GS.hist.shift();
  }
  function startGrab(cx, cy, ts) { GS.grab = { cx, cy, y: D.ty, p: rayPlane(cx, cy, D.ty) }; GS.hist = [[ts || performance.now(), D.tx, D.tz]]; }
  function twoState() { const [a, b] = [...GS.ptr.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), a: Math.atan2(b.y - a.y, b.x - a.x), ay: a.y, by: b.y }; }
  const angD = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  function onDown(e) {
    if (!D.on || e.target !== WLD.renderer.domElement) return;
    e.stopPropagation(); try { e.target.setPointerCapture(e.pointerId); } catch (er) { /* */ }
    kill(); D.still = 0;
    GS.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, btn: e.button, ctrl: e.ctrlKey || e.button === 2, ts: e.timeStamp });
    clearTimeout(GS.lpT);
    if (GS.ptr.size === 1) { GS.multi = false; GS.moved = false; GS.lp = false; GS.twoTap = false; GS.t0 = e.timeStamp; GS.mode = GS.ptr.get(e.pointerId).ctrl ? 'orbit' : 'pan'; startGrab(e.clientX, e.clientY, e.timeStamp);
      D.down = { x: e.clientX, y: e.clientY, t: GS.t0 };
      if (!D.draw && e.pointerType !== 'mouse') GS.lpT = setTimeout(() => requestAnimationFrame(() => { if (GS.ptr.size === 1 && !GS.moved && !GS.multi && GS.ptr.has(e.pointerId)) { GS.lp = true; dropHere(e.clientX, e.clientY); } }), 650); }   // rAF: אירועי מגע שבתור מעובדים לפני הבדיקה (דף איטי ≠ לחיצה ארוכה)
    else if (GS.ptr.size === 2) { GS.multi = true; GS.mode = 'two?'; GS.twoLast = performance.now(); for (const v of GS.ptr.values()) v.dirty = false; GS.two = Object.assign(twoState(), { t: performance.now() }); GS.two0 = GS.two; GS.two0ts = e.timeStamp; GS.grab = null; GS.hist = []; }
    else GS.multi = true;
  }
  function onMove(e) {
    const q = GS.ptr.get(e.pointerId); if (!q) return; if (!D.on) { GS.ptr.clear(); return; }
    e.stopPropagation(); q.x = e.clientX; q.y = e.clientY; const ts = e.timeStamp;
    if (Math.hypot(q.x - q.x0, q.y - q.y0) > 9) { GS.moved = true; clearTimeout(GS.lpT); }
    if (GS.ptr.size === 1) {
      if (!GS.moved) return;
      if (GS.mode === 'orbit') { const g = GS.grab; WLD.G27.S.cam.yaw -= (q.x - g.cx) * 0.006; D.phi += (q.y - g.cy) * 0.005; g.cx = q.x; g.cy = q.y; placeCam(); return; }
      if (GS.mode !== 'pan') { GS.mode = 'pan'; startGrab(q.x, q.y, ts); return; }   // אחרי הרמת אצבע שנייה: תופסים מחדש — בלי קפיצה
      panTo(q.x, q.y, ts); return;
    }
    // שתי אצבעות: רק שומרים מיקום; העיבוד פעם בפריים (processTwo) — הדפדפן שולח אירוע לכל אצבע בנפרד ולפעמים מאחד אירועים,
    // ועיבוד לכל אירוע גרם לגרירה מקבילה להיראות כמו סיבוב (נעילה שגויה ורעד)
  }
  function processTwo() {
    if (GS.ptr.size !== 2 || !GS.two) return;
    const s = twoState(), p = GS.two, s0 = GS.two0, ts = performance.now();
    if (s.cx === p.cx && s.cy === p.cy && s.d === p.d && s.a === p.a) return;
    if (GS.mode === 'two?') {   // נעילת סוג המחווה: הטיה (שתי אצבעות זזות יחד אנכית) או זום+סיבוב+הזזה
      const sc = Math.abs(Math.log(s.d / s0.d)), rot = Math.abs(angD(s.a, s0.a)), dya = s.ay - s0.ay, dyb = s.by - s0.by, dcx = Math.abs(s.cx - s0.cx);
      if (Math.sign(dya) === Math.sign(dyb) && Math.abs(dya) > 14 && Math.abs(dyb) > 14 && sc < 0.07 && rot < 0.12 && dcx < Math.abs(s.cy - s0.cy)) GS.mode = 'tilt';
      else if (sc > 0.05 || rot > 0.1 || Math.hypot(s.cx - s0.cx, s.cy - s0.cy) > 16) GS.mode = 'zr';
      else return;
      GS.moved = true;
    }
    if (GS.mode === 'tilt') { D.phi += (s.cy - p.cy) * 0.0055; placeCam(); }
    else {
      const g0 = rayPlane(p.cx, p.cy, D.ty);
      D.dist = clampD(D.dist * p.d / s.d); const da = angD(s.a, p.a); WLD.G27.S.cam.yaw += da; GS.ryaw = da / Math.max(1e-3, (ts - (p.t || 0)) / 1000);
      placeCam(); if (g0) { const g1 = rayPlane(s.cx, s.cy, D.ty); if (g1) { D.tx += g0.x - g1.x; D.tz += g0.z - g1.z; placeCam(); } }
    }
    GS.two = Object.assign(s, { t: ts });
  }
  function onUp(e) {
    const q = GS.ptr.get(e.pointerId); if (!q) return; e.stopPropagation(); q.x = e.clientX; q.y = e.clientY;
    if (GS.ptr.size === 2) processTwo(); else if (GS.ptr.size === 1 && GS.mode === 'pan' && GS.moved) panTo(q.x, q.y, e.timeStamp); GS.ptr.delete(e.pointerId); clearTimeout(GS.lpT);
    if (!D.on) { GS.ptr.clear(); return; }
    const now = e.timeStamp;
    if (GS.ptr.size === 1) { const [r] = [...GS.ptr.values()]; GS.mode = 'pan1'; GS.grab = null;   // נשארה אצבע אחת: ממשיכים לגרור ממנה
      if (GS.two0 && !GS.moved && now - GS.two0ts < 300) GS.twoTap = true;
      startGrab(r.x, r.y, now); GS.mode = 'pan'; return; }
    if (GS.ptr.size > 0) return;
    if (GS.twoTap) { GS.twoTap = false; if (!GS.moved) { flyZoom(innerWidth / 2, innerHeight / 2, 2.2); return; } }
    if (GS.lp) { GS.lp = false; return; }
    if (GS.multi) { if (GS.mode === 'zr' && Math.abs(GS.ryaw || 0) > 0.6) D.vyaw = Math.max(-3, Math.min(3, GS.ryaw)); GS.ryaw = 0; return; }   // אף פעם לא "הקשה" אחרי צביטה
    if (!GS.moved && now - GS.t0 < 320) {
      if (D.draw) { const p = groundHit(e.clientX, e.clientY); if (p) addPoint(p.x, p.z); return; }
      const lt = GS.lastTap;
      if (lt && now - lt.t < 330 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 40) { clearTimeout(GS.tapT); GS.lastTap = null; flyZoom(e.clientX, e.clientY, 0.4); return; }
      GS.lastTap = { t: now, x: e.clientX, y: e.clientY };
      GS.tapT = setTimeout(() => { const b = pickBuilding(e.clientX, e.clientY); if (b) { WLD.player.selected = b; WLD.G27.showCard(b); } }, 300);
      return;
    }
    // אינרציה של גרירה
    if (GS.mode === 'pan' && GS.hist.length > 1) { const a = GS.hist[0], b = GS.hist[GS.hist.length - 1], dt = (b[0] - a[0]) / 1000;
      if (dt > 0.01 && now - b[0] < 150) { const vx = (b[1] - a[1]) / dt, vz = (b[2] - a[2]) / dt, sp = Math.hypot(vx, vz), mx = D.dist * 3;
        if (sp > D.dist * 0.08) D.vel = { x: vx * Math.min(1, mx / sp), z: vz * Math.min(1, mx / sp) }; } }
  }
  function onCancel(e) { GS.ptr.delete(e.pointerId); clearTimeout(GS.lpT); if (!GS.ptr.size) { GS.mode = null; GS.grab = null; } }

  window.YZDev = { D, GS, drop: (x, y) => dropHere(x, y), addPoint: (...a) => addPoint(...a), finish: () => finishPlot(), stats: () => plotStats(), validate: (p, c) => validate(p, c), setLayer: l => setLayer(l), startDraw: () => { D.draw = true; D.pts = []; drawPlot(); renderBar(); },
    set(o) { if (o.dist != null) D.dist = clampD(o.dist); if (o.tilt != null) D.phi = o.tilt * Math.PI / 180; if (o.yaw != null) WLD.G27.S.cam.yaw = o.yaw * Math.PI / 180; kill(); if (D.on) placeCam(); },
    get() { return { dist: D.dist, tilt: D.phi * 180 / Math.PI, yaw: WLD.G27.S.cam.yaw * 180 / Math.PI, tx: D.tx, tz: D.tz, camY: WLD.camera.position.y }; }, place: () => placeCam(), phiMin, pick: (x, y) => pickBuilding(x, y) };
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
      // מחוות: מאזינים בשלב הלכידה על window — במצב העין הגדולה הם עוצרים את האירוע לפני שהמשחק (סיבוב מצלמה/הקשה על בניין) רואה אותו
      D.h = { down: onDown, move: onMove, up: onUp, cancel: onCancel };
      addEventListener('pointerdown', onDown, true); addEventListener('pointermove', onMove, true); addEventListener('pointerup', onUp, true); addEventListener('pointercancel', onCancel, true);
      const cv = world.renderer.domElement;
      D.wh = e => { if (!D.on) return; e.stopPropagation(); e.preventDefault(); kill(); zoomAt(e.clientX, e.clientY, Math.pow(1.0015, e.deltaY)); };
      addEventListener('wheel', D.wh, { capture: true, passive: false });
      D.ctx = e => { if (D.on && e.target === cv) e.preventDefault(); }; addEventListener('contextmenu', D.ctx, true);
      // מתג קבוע על המסך: העין הגדולה ⇄ הדמות
      const tg = document.createElement('button'); tg.id = 'yzEye'; tg.className = 'btn pri'; tg.setAttribute('aria-label', 'החלפת מבט: העין הגדולה או הדמות');
      tg.style.cssText = 'position:fixed;z-index:13;left:8px;top:calc(env(safe-area-inset-top) + 138px);font-weight:700;font-size:13px;padding:6px 10px;min-height:36px';
      tg.onclick = () => YZW.setMode(world.player.mode === 'dev' ? (D.back || 'walk') : 'dev'); document.body.appendChild(tg); D.tg = tg;
      const upd = () => { tg.textContent = world.player.mode === 'dev' ? '🧍 הדמות' : '👁 העין הגדולה'; }; api.on('mode', e => { if (e.id !== 'dev' && e.id !== 'present') D.back = e.id === 'walk' || ['car', 'heli', 'jetpack', 'drone'].includes(e.id) ? e.id : 'walk'; upd(); }); upd();
      // תקציב אריחים לפי גובה: המשחק קובע W.radius מתוך הערפל בכל פריים; בעין הגדולה התקרה שלנו גוברת (אחרת ב-6 ק"מ נטענו ~19 ק"מ של אריחים)
      const W = world.data.W; let rawR = W.radius, rawH = W.hiRadius;
      try { Object.defineProperty(W, 'radius', { configurable: true, enumerable: true, get: () => (D.on && D.rcap != null ? Math.min(rawR, D.rcap) : rawR), set: v => { rawR = v; } });
        Object.defineProperty(W, 'hiRadius', { configurable: true, enumerable: true, get: () => (D.on && D.hcap != null ? Math.min(rawH, D.hcap) : rawH), set: v => { rawH = v; } }); D.wrapped = true; } catch (e) { D.wrapped = false; }
    },
    dispose(world) { if (D.tg) D.tg.remove(); removeEventListener('pointerdown', onDown, true); removeEventListener('pointermove', onMove, true); removeEventListener('pointerup', onUp, true); removeEventListener('pointercancel', onCancel, true);
      removeEventListener('wheel', D.wh, true); removeEventListener('contextmenu', D.ctx, true);
      clearOverlay(); if (D.ui) D.ui.remove(); const lg = $('yzLeg'); if (lg) lg.remove(); if (D.style) D.style.remove(); D.on = false; },
    // ציור לפי דרישה: מצלמה עומדת + אין אריחים בדרך → 5 פריימים בשנייה במקום 60 (סוללה וחום); תזוזה מחזירה מיד
    render(world, orig) {
      if (D.on && D.still > 0.8 && !D.fly && !D.tr && !GS.ptr.size && world.data.W.pending() === 0) { const now = performance.now(); if (now - (D.lastR || 0) < 200) { D.skipped = (D.skipped || 0) + 1; return; } D.lastR = now; }
      else D.lastR = performance.now();
      orig(world.scene, world.camera);
    },
    modes: [{
      id: 'dev', name: 'העין הגדולה', icon: '👁', sub: 'מפה וכלים',
      enter(world, from, pos) {
        const G = world.G27, W = world.data; D.on = true; D.tx = pos.x; D.tz = pos.z; D.fly = null; kill(); GS.ptr.clear();
        D.dist = from === 'heli' || from === 'jet' || from === 'spaceship' ? Math.max(220, (pos.y || 0) * 1.6) : 260;
        D.phi = 0.95;
        const qd = new URLSearchParams(location.search).get('at'); if (!D.usedQ && qd && qd.split(',')[2]) { D.dist = clampD(+qd.split(',')[2]); } D.usedQ = true;
        D.tr = { a: world.camera.position.clone(), look: new THREE.Vector3(pos.x, (pos.y || 0) + 1.4, pos.z), t: 0, t0: performance.now() };
        D.pr0 = world.renderer.getPixelRatio(); D.prLow = false;
        const b = W.buildingAt(pos.x, pos.z, 1.5); if (b && (from !== 'walk' || pos.y > b.top - 1.5)) { world.player.selected = b; G.showCard(b); }
        else if (world.player.selected) G.showCard(world.player.selected);
        if (D.layer !== 'none') for (const t of world.data.tiles.values()) addTileOv(t);
        if (D.plotObj) D.plotObj.visible = true; renderBar(); legend();
      },
      exit(world) { D.on = false; D.draw = false; renderBar(); legend(); clearOverlay(); if (D.plotObj) D.plotObj.visible = false; kill(); GS.ptr.clear();
        if (world.sunLight) { const sc = world.sunLight.shadow.camera; sc.left = sc.bottom = -85; sc.right = sc.top = 85; sc.far = 900; sc.updateProjectionMatrix(); world.sunLight.shadow.autoUpdate = true; }
        if (D.prLow && D.pr0) { world.renderer.setPixelRatio(D.pr0); D.prLow = false; }
        world.data.W.root.visible = true; aerialRestore(world); if (window.YZFar) window.YZFar.view = null; D.rcap = D.hcap = null;
        if (world.scene.fog) { world.scene.fog.far = 1500; world.scene.fog.near = 450; }   // הערפל של המשחק דועך לאט — מחזירים אותו מיד כדי ש-W.radius לא יישאר עצום
        world.G27.S.cam.pitch = 0.3; },
      update(dt, world, inp) {
        const G = world.G27, cam = world.camera, yaw = G.S.cam.yaw, W = world.data.W;
        const c0x = D.tx, c0z = D.tz, c0d = D.dist, c0y = yaw, c0p = D.phi;
        if (D.fly) { D.fly.t = Math.min(1, D.fly.t + dt / 1.1); const k = D.fly.t < 0.5 ? 2 * D.fly.t ** 2 : 1 - (-2 * D.fly.t + 2) ** 2 / 2;
          D.tx = D.fly.a.x + (D.fly.b.x - D.fly.a.x) * k; D.tz = D.fly.a.z + (D.fly.b.z - D.fly.a.z) * k; D.dist = Math.exp(Math.log(D.fly.a.d) + (Math.log(D.fly.b.d) - Math.log(D.fly.a.d)) * k); if (D.fly.t >= 1) D.fly = null; }
        processTwo();
        // אינרציה
        if (D.vel && !GS.ptr.size) { D.tx += D.vel.x * dt; D.tz += D.vel.z * dt; const f = Math.exp(-dt * 3.2); D.vel.x *= f; D.vel.z *= f; if (Math.hypot(D.vel.x, D.vel.z) < D.dist * 0.01) D.vel = null; }
        if (D.vyaw && !GS.ptr.size) { G.S.cam.yaw += D.vyaw * dt; D.vyaw *= Math.exp(-dt * 4); if (Math.abs(D.vyaw) < 0.02) D.vyaw = 0; }
        // ג׳ויסטיק / מקלדת = הזזה, ▲/▼ = זום
        const sp = D.dist * 0.9 * dt, yw = G.S.cam.yaw; D.tx += (Math.sin(yw) * inp.y + Math.cos(yw) * inp.x) * sp; D.tz += (Math.cos(yw) * inp.y - Math.sin(yw) * inp.x) * sp;
        if (inp.up) D.dist = D.dist * (1 - dt * 1.2); if (inp.down) D.dist = D.dist * (1 + dt * 1.2);
        placeCam();
        const ty = D.ty;
        if (D.tr) { D.tr.t = Math.min(1, D.tr.t + dt / 1.0); const e = D.tr.t < 0.5 ? 2 * D.tr.t ** 2 : 1 - (-2 * D.tr.t + 2) ** 2 / 2; const goal = cam.position.clone();
          cam.position.lerpVectors(D.tr.a, goal, e); const lk = D.tr.look.clone().lerp(new THREE.Vector3(D.tx, ty, D.tz), e); cam.lookAt(lk);
          if (D.tr.t >= 1) { world.stats.lastFlyOutMs = Math.round(performance.now() - D.tr.t0); D.tr = null; } }
        G.S.cam.pitch = Math.max(0.07, Math.min(0.83, (D.phi - 0.2) / 1.5));
        world.eyeDist = D.dist;
        const moving = D.tx !== c0x || D.tz !== c0z || D.dist !== c0d || G.S.cam.yaw !== c0y || D.phi !== c0p || !!D.tr || GS.ptr.size > 0;
        D.still = moving ? 0 : D.still + dt;
        // גובה מעל הקרקע → ערפל, מישורי חיתוך, תקציב אריחים, צל
        const alt = Math.max(1, cam.position.y - Math.max(0, world.data.H(cam.position.x, cam.position.z)));
        const hd = Math.sqrt(2 * RE * alt + alt * alt);   // מרחק לאופק
        const f = world.scene.fog;
        if (alt < 120) { if (f) { f.far = Math.min(4000, Math.max(1150 + Math.max(0, alt - 30) * 7, D.dist * 3.2 + 600)); f.near = f.far * 0.45; } cam.near = 0.5; cam.far = (f ? f.far : 4000) + 2000; }
        else if (alt < 60000) { if (f) { f.near = Math.max(2500, D.dist * 1.2); f.far = Math.max(f.near * 2, hd * 0.6); } cam.near = Math.min(alt * 0.2, 2000); cam.far = hd * 1.3 + D.dist + 20000; }
        else { if (f) { f.near = 1e12; f.far = 2e12; } cam.near = Math.max(1000, alt * 0.2); cam.far = D.dist + RE * 2.2; }
        cam.updateProjectionMatrix();
        D.rcap = alt < 400 ? 1600 : alt < 1500 ? 2000 : alt < 6000 ? 3000 : alt < 20000 ? 2200 : 600;
        D.hcap = alt < 250 ? null : alt < 900 ? 320 : 0;
        W.root.visible = alt < 9000; aerialHide(world, alt, dt);
        if (window.YZFar) window.YZFar.view = { tx: D.tx, tz: D.tz, dist: D.dist, alt };
        if (world.sunLight && world.sky) { const sd = world.sky.material.uniforms.sun.value, L = world.sunLight; L.target.position.set(D.tx, ty, D.tz); L.position.set(D.tx + sd.x * 600, ty + sd.y * 600, D.tz + sd.z * 600);
          const r = Math.min(600, Math.max(85, D.dist * 0.8)), sc = L.shadow.camera; if (Math.abs(sc.right - r) > 5) { sc.left = sc.bottom = -r; sc.right = sc.top = r; sc.far = 2000; sc.updateProjectionMatrix(); }
          // מבט אווירי (perfci): מעל 120 מ' — בלי עדכון מפת צל (בלי קומפילציה מחדש של חומרים); מצלמה עומדת — עדכון אחד ואז קפוא
          L.shadow.autoUpdate = alt < 120 && moving; if (alt < 120 && !moving && D.still < 0.1) L.shadow.needsUpdate = true; }
        // רזולוציה נמוכה בזמן תנועה, חדה כשעוצרים (עידון הדרגתי)
        if (D.pr0) { const want = moving && D.still === 0 && alt > 60; if (want && !D.prLow) { D.prLow = true; D.prT = 0; world.renderer.setPixelRatio(Math.max(0.75, D.pr0 * 0.8)); }
          else if (!moving && D.prLow) { D.prT = (D.prT || 0) + dt; if (D.prT > 0.25) { D.prLow = false; world.renderer.setPixelRatio(D.pr0); } } }
        return { x: D.tx, y: ty, z: D.tz, speed: 0, alt: Math.round(alt) };
      },
    }],
  });
})();
