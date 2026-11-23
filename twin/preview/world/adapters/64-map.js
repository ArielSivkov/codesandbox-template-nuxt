/* 64-map.js – מפה מלאה שאפשר ללחוץ עליה (לבקשת אריאל, 23.11.2026)
 * לחיצה על המפה המוקטנת (העיגול) פותחת מפה מלאה של כל העולם (אריחי רסטר של OSM/CARTO, נטענים רק כשהמפה פתוחה).
 * גרירה = הזזה, צביטה/גלגלת/＋− = זום, הקשה = בחירת נקודה → "ללכת לכאן" (הדמות קופצת), "מבט מלמעלה" (העין הגדולה), גוגל מפות.
 * קואורדינטות: סצנה → מסגרת הדגימה (toITM) → ITM אמיתי (+sampleOffset) → WGS84 (itm.js). בכיוון ההפוך לקפיצה.
 * מחוץ לישראל: אין עדיין עולם תלת־ממד – המפה מראה, הקפיצה מודיעה (שלב המנוע הגלובלי).
 * ?maptiles=<url עם {z}/{x}/{y}> מחליף מקור אריחים. ?map=0 מכבה.
 * ווים להרחבה (נוספו 23.11.2026 עבור 68-map-layers.js, שינוי מינימלי):
 *   M.layers = [f(ctx, view)] – נקראות אחרי ציור האריחים ולפני הסיכות; view = { w, h, zi, sc, cxp, cyp, toPx(lat, lon) }.
 *   M.onTap(ll, px, py, dbl) – נקרא בכל הקשה; מחזיר true = ההקשה טופלה (בלי בחירת נקודה/זום כפול).
 *   M.pxToLL, M.zoomAt, M.el – גישה לקריאה/הזזה מהמודול המרחיב.
 */
(function () {
  if (/[?&]map=0\b/.test(location.search)) return;
  const qs = new URLSearchParams(location.search);
  const SRC = qs.get('maptiles') || 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
  const ATTR = '© OpenStreetMap contributors · © CARTO';
  const TS = 256, MAXZ = 19, MINZ = 2;
  const IL = { E0: 100000, E1: 300000, N0: 350000, N1: 820000 };   // תחום רשת ישראל (גס) – שם יש עולם תלת־ממד
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = document.createElement('style'); css.textContent = `
#yzMap{position:fixed;inset:0;z-index:44;background:#e8e4da;display:none;touch-action:none}
#yzMap.open{display:block}
#yzMap canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
#yzMap .tb{position:absolute;top:calc(env(safe-area-inset-top) + 8px);right:8px;left:8px;display:flex;gap:6px;align-items:center;direction:rtl;pointer-events:none}
#yzMap .tb>*{pointer-events:auto}
#yzMap .tb h2{margin:0;font-size:15px;flex:1;color:#0d1420;text-shadow:0 1px 0 #fff8}
#yzMap .zm{position:absolute;left:10px;bottom:calc(env(safe-area-inset-bottom) + 120px);display:flex;flex-direction:column;gap:6px}
#yzMap .zm .btn{width:46px;height:46px;font-size:22px;padding:0}
#yzMap .at{position:absolute;left:6px;bottom:calc(env(safe-area-inset-bottom) + 4px);font-size:10px;color:#333;background:#fffb;border-radius:6px;padding:1px 6px;direction:ltr}
#yzMap .pk{position:absolute;right:8px;left:8px;bottom:calc(env(safe-area-inset-bottom) + 24px);max-width:440px;margin-inline-start:auto;background:rgba(12,20,32,.95);color:#eef3f8;border:1px solid #ffffff26;border-radius:14px;padding:8px 10px;display:none;direction:rtl;box-shadow:0 8px 24px #0008}
#yzMap .pk .c{font:11px ui-monospace,monospace;direction:ltr;text-align:right;color:#a3b3c5;margin-bottom:6px}
#yzMap .pk .r{display:flex;gap:6px;flex-wrap:wrap}
#yzMap .pk .n{font-size:11px;color:#f6cf7f;margin-top:4px}
`; document.head.appendChild(css);

  const M = { lat: 31.80, lon: 34.65, z: 15, open: false, pick: null, tiles: new Map(), ptrs: new Map(), drag: null, pinch: null, dirty: true, layers: [], onTap: null };
  window.YZMap = M;
  let W, el, cv, cx, pk;

  // ----- מרקטור
  const lon2x = (lon, z) => (lon + 180) / 360 * TS * 2 ** z;
  const lat2y = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TS * 2 ** z; };
  const x2lon = (x, z) => x / (TS * 2 ** z) * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / (TS * 2 ** z); return 180 / Math.PI * Math.atan(Math.sinh(n)); };

  // ----- סצנה ⇄ WGS84
  function sceneToLL(x, z) { const c = W.coords; if (!c.toITM || !c.itmToWgs84) return null; const s = c.toITM(x, z), o = c.sampleOffset || { dE: 0, dN: 0 }; return c.itmToWgs84(s.E + o.dE, s.N + o.dN); }
  function llToSample(lat, lon) { const c = W.coords; if (!c.wgs84ToItm) return null; const t = c.wgs84ToItm(lat, lon), o = c.sampleOffset || { dE: 0, dN: 0 }; return { E: t.E - o.dE, N: t.N - o.dN, trueE: t.E, trueN: t.N }; }

  // ----- אריחים
  function tileURL(z, x, y) { const n = 2 ** z; x = ((x % n) + n) % n; return SRC.replace('{s}', 'abcd'[(x + y) % 4]).replace('{z}', z).replace('{x}', x).replace('{y}', y); }
  function tile(z, x, y) {
    const k = z + '/' + x + '/' + y; let t = M.tiles.get(k);
    if (!t) { t = { img: new Image(), ok: false }; t.img.crossOrigin = 'anonymous'; t.img.onload = () => { t.ok = true; M.dirty = true; }; t.img.onerror = () => { t.bad = true; }; t.img.src = tileURL(z, x, y); M.tiles.set(k, t);
      if (M.tiles.size > 400) { for (const kk of M.tiles.keys()) { M.tiles.delete(kk); if (M.tiles.size < 300) break; } } }
    else { M.tiles.delete(k); M.tiles.set(k, t); }
    return t;
  }
  function parentImg(z, x, y) { for (let d = 1; d <= 4 && z - d >= 0; d++) { const k = (z - d) + '/' + (x >> d) + '/' + (y >> d), t = M.tiles.get(k); if (t && t.ok) return { t, d, sx: (x & ((1 << d) - 1)) * TS / 2 ** d, sy: (y & ((1 << d) - 1)) * TS / 2 ** d }; } return null; }

  function draw() {
    if (!M.open) return; M.dirty = false;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.fillStyle = '#e8e4da'; cx.fillRect(0, 0, w, h);
    const zi = Math.max(0, Math.min(MAXZ, Math.floor(M.z))), sc = 2 ** (M.z - zi);
    const cxp = lon2x(M.lon, zi), cyp = lat2y(M.lat, zi);
    const x0 = Math.floor((cxp - w / 2 / sc) / TS), x1 = Math.floor((cxp + w / 2 / sc) / TS), y0 = Math.max(0, Math.floor((cyp - h / 2 / sc) / TS)), y1 = Math.min(2 ** zi - 1, Math.floor((cyp + h / 2 / sc) / TS));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const sx = (tx * TS - cxp) * sc + w / 2, sy = (ty * TS - cyp) * sc + h / 2, sz = TS * sc + 0.5, t = tile(zi, tx, ty);
      if (t.ok) cx.drawImage(t.img, sx, sy, sz, sz);
      else { const p = parentImg(zi, ((tx % 2 ** zi) + 2 ** zi) % 2 ** zi, ty); if (p) cx.drawImage(p.t.img, p.sx, p.sy, TS / 2 ** p.d, TS / 2 ** p.d, sx, sy, sz, sz); }
    }
    const toPx = (lat, lon) => ({ x: (lon2x(lon, zi) - cxp) * sc + w / 2, y: (lat2y(lat, zi) - cyp) * sc + h / 2 });
    for (const f of M.layers) { try { cx.save(); f(cx, { w, h, zi, sc, cxp, cyp, toPx }); } catch (e) { console.warn('map layer', e); } finally { cx.restore(); } }   // וו שכבות (68-map-layers)
    // בית
    if (W.home && W.coords.toScene) { const s = W.coords.toScene(W.home.E, W.home.N), ll = sceneToLL(s.x, s.z); if (ll) { const p = toPx(ll.lat, ll.lon); cx.font = '20px system-ui'; cx.textAlign = 'center'; cx.fillText('🏠', p.x, p.y + 7); } }
    // נקודה שנבחרה
    if (M.pick) { const p = toPx(M.pick.lat, M.pick.lon); cx.fillStyle = '#e53935'; cx.strokeStyle = '#fff'; cx.lineWidth = 2; cx.beginPath(); cx.arc(p.x, p.y - 16, 9, 0, Math.PI * 2); cx.moveTo(p.x - 7, p.y - 11); cx.lineTo(p.x, p.y); cx.lineTo(p.x + 7, p.y - 11); cx.fill(); cx.stroke(); cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(p.x, p.y - 16, 3.5, 0, Math.PI * 2); cx.fill(); }
    // השחקן
    const me = W.player && W.player.pos && sceneToLL(W.player.pos.x, W.player.pos.z);
    if (me) { const p = toPx(me.lat, me.lon), S = W.G27.S, hd = S.mode === 'car' ? S.car.h : S.mode === 'heli' ? S.heli.h : S.heading;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(Math.PI - hd); cx.fillStyle = '#1e88e5'; cx.strokeStyle = '#fff'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(0, -13); cx.lineTo(10, 10); cx.lineTo(0, 4); cx.lineTo(-10, 10); cx.closePath(); cx.stroke(); cx.fill(); cx.restore(); }
  }

  function loop() { if (!M.open) return; if (M.dirty) draw(); requestAnimationFrame(loop); }

  function zoomAt(nz, px, py) {
    nz = Math.max(MINZ, Math.min(MAXZ, nz)); const w = cv.clientWidth, h = cv.clientHeight;
    const gx = lon2x(M.lon, M.z) + (px - w / 2), gy = lat2y(M.lat, M.z) + (py - h / 2);   // נקודה תחת האצבע נשארת במקום
    const lonP = x2lon(gx, M.z), latP = y2lat(gy, M.z); M.z = nz;
    M.lon = x2lon(lon2x(lonP, M.z) - (px - w / 2), M.z); M.lat = y2lat(lat2y(latP, M.z) - (py - h / 2), M.z); M.dirty = true;
  }
  function pan(dx, dy) { M.lon = x2lon(lon2x(M.lon, M.z) - dx, M.z); M.lat = Math.max(-85, Math.min(85, y2lat(lat2y(M.lat, M.z) - dy, M.z))); M.dirty = true; }
  function pxToLL(px, py) { const w = cv.clientWidth, h = cv.clientHeight; return { lat: y2lat(lat2y(M.lat, M.z) + py - h / 2, M.z), lon: x2lon(lon2x(M.lon, M.z) + px - w / 2, M.z) }; }

  function choose(ll) {
    M.pick = ll; M.dirty = true; const s = llToSample(ll.lat, ll.lon);
    const inIL = s && s.trueE > IL.E0 && s.trueE < IL.E1 && s.trueN > IL.N0 && s.trueN < IL.N1;
    pk.innerHTML = `<div class="c">${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}${s && inIL ? ` · ITM ${Math.round(s.trueE)}/${Math.round(s.trueN)}` : ''}</div>
      <div class="r"><button class="btn pri" id="yzMapGo">🚶 ללכת לכאן</button><button class="btn" id="yzMapEye">👁 מבט מלמעלה</button>
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${ll.lat.toFixed(6)},${ll.lon.toFixed(6)}" style="text-decoration:none;display:inline-flex;align-items:center">🧭 גוגל מפות</a><button class="btn" id="yzMapPkX">✕</button></div>
      ${inIL ? '' : '<div class="n">🌍 כאן עוד אין עולם תלת־ממד – יגיע עם המנוע הגלובלי. המפה עצמה מכסה את כל העולם.</div>'}`;
    pk.style.display = 'block';
    pk.querySelector('#yzMapPkX').onclick = () => { M.pick = null; pk.style.display = 'none'; M.dirty = true; };
    const go = pk.querySelector('#yzMapGo'), eye = pk.querySelector('#yzMapEye');
    if (!inIL) { go.disabled = true; eye.disabled = true; return; }
    go.onclick = () => { close(); const G = W.G27; if (G.S.inside) G.exitInterior(); YZW.setMode('walk', YZW.mode() !== 'walk'); YZW.placeAt(s.E, s.N, G.S.heading); YZW.syncURL && YZW.syncURL(); YZW.notice('🚶 קפצת לנקודה במפה', { kind: 'info', ms: 1800 }); };
    eye.onclick = () => { close(); const p = W.coords.toScene(s.E, s.N); YZW.setMode('dev'); setTimeout(() => { if (window.YZDev) { YZDev.D.tx = p.x; YZDev.D.tz = p.z; YZDev.D.dist = Math.max(YZDev.D.dist || 0, 300); } if (W.G27.W.update) W.G27.W.update(p.x, p.z, 40); }, 60); };
  }

  function open() {
    if (!W || !W.coords || !W.coords.itmToWgs84) { YZW.notice('המפה עוד נטענת…', { kind: 'info', ms: 1500 }); return; }
    const me = sceneToLL(W.player.pos.x, W.player.pos.z); if (me) { M.lat = me.lat; M.lon = me.lon; }
    M.open = true; el.classList.add('open'); pk.style.display = M.pick ? 'block' : 'none'; M.dirty = true; requestAnimationFrame(loop);
  }
  function close() { M.open = false; el.classList.remove('open'); M.ptrs.clear(); M.drag = M.pinch = null; }
  M.openMap = open; M.close = close; M.choose = choose; M.sceneToLL = sceneToLL; M.llToSample = llToSample; M.pxToLL = pxToLL; M.zoomAt = zoomAt;

  function ui() {
    el = document.createElement('div'); el.id = 'yzMap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'מפה');
    el.innerHTML = `<canvas></canvas><div class="tb"><button class="btn" id="yzMapX" aria-label="סגירה">✕</button><h2>🗺 מפה · הקישו על נקודה</h2><button class="btn" id="yzMapMe" aria-label="למיקום שלי">◎</button></div>
      <div class="zm"><button class="btn" id="yzMapZi" aria-label="הגדלה">＋</button><button class="btn" id="yzMapZo" aria-label="הקטנה">－</button></div><div class="pk"></div><div class="at">${esc(ATTR)}</div>`;
    document.body.appendChild(el); M.el = el; cv = el.querySelector('canvas'); cx = cv.getContext('2d'); pk = el.querySelector('.pk');
    el.querySelector('#yzMapX').onclick = close;
    el.querySelector('#yzMapMe').onclick = () => { const me = sceneToLL(W.player.pos.x, W.player.pos.z); if (me) { M.lat = me.lat; M.lon = me.lon; if (M.z < 15) M.z = 15; M.dirty = true; } };
    el.querySelector('#yzMapZi').onclick = () => zoomAt(Math.round(M.z) + 1, cv.clientWidth / 2, cv.clientHeight / 2);
    el.querySelector('#yzMapZo').onclick = () => zoomAt(Math.round(M.z) - 1, cv.clientWidth / 2, cv.clientHeight / 2);
    cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(M.z - Math.sign(e.deltaY) * 0.5, e.offsetX, e.offsetY); }, { passive: false });
    let lastTap = 0;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); M.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (M.ptrs.size === 1) M.drag = { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, t: performance.now(), moved: false };
      else if (M.ptrs.size === 2) { const [a, b] = [...M.ptrs.values()]; M.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: M.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; if (M.drag) M.drag.moved = true; } });
    cv.addEventListener('pointermove', e => { if (!M.ptrs.has(e.pointerId)) return; M.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (M.pinch && M.ptrs.size >= 2) { const [a, b] = [...M.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        pan(mx - M.pinch.mx, my - M.pinch.my); M.pinch.mx = mx; M.pinch.my = my; zoomAt(M.pinch.z + Math.log2(Math.max(d, 1) / Math.max(M.pinch.d, 1)), mx, my); }
      else if (M.drag) { const d = M.drag; if (Math.hypot(e.offsetX - d.x0, e.offsetY - d.y0) > 8) d.moved = true; if (d.moved) pan(e.offsetX - d.x, e.offsetY - d.y); d.x = e.offsetX; d.y = e.offsetY; } });
    const up = e => { const d = M.drag; M.ptrs.delete(e.pointerId); if (M.ptrs.size < 2) M.pinch = null;
      if (M.ptrs.size === 0) { if (d && !d.moved && performance.now() - d.t < 500 && e.type === 'pointerup') { const now = performance.now();
          const dbl = now - lastTap < 300, ll = pxToLL(e.offsetX, e.offsetY);
          if (!(M.onTap && M.onTap(ll, e.offsetX, e.offsetY, dbl))) { if (dbl) zoomAt(M.z + 1, e.offsetX, e.offsetY); else choose(ll); } lastTap = now; }   // וו הקשה (68-map-layers)
        M.drag = null; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    addEventListener('resize', () => { M.dirty = true; });
    addEventListener('keydown', e => { if (M.open && e.code === 'Escape') close(); });
  }

  YZW.register({
    id: 'map', name: 'מפה מלאה (לחיצה על המפה המוקטנת)', dept: 'integration', order: 64,
    init(world) {
      W = world; ui();
      const mm = document.getElementById('mm'); if (mm) { mm.setAttribute('role', 'button'); mm.setAttribute('aria-label', 'פתיחת מפה מלאה'); mm.title = 'מפה מלאה'; mm.addEventListener('click', open); }
      M.mmClick = open;
    },
    update(dt) { if (M.open && (M.acc = (M.acc || 0) + dt) > 0.5) { M.acc = 0; M.dirty = true; } },
    dispose() { const mm = document.getElementById('mm'); if (mm) mm.removeEventListener('click', open); close(); if (el) el.remove(); }
  });
})();
