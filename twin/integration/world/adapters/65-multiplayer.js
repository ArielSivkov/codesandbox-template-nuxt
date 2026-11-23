/* 65-multiplayer.js – מרובה משתתפים: שחקנים אחרים באותו חדר מופיעים כ"רוחות" (דמות / רכב / כלי טיס פשוטים, עם שם).
 * כבוי כברירת מחדל. פועל רק בקישור עם ?mp=<חדר> (למשל ?mp=שון). ?mpsrv=<wss://…> מחליף שרת, ?mpn=<כינוי> מחליף שם.
 * הרעיון מ-earth1926/server/main.go: מזהה מהשרת, מצב {מיקום, כיוון, מצב/רכב}, הפצה לכולם. כאן: שליחה ~5 פעמים בשנייה,
 * ובצד המקבל החלקה (interpolation) באיחור קבוע של 0.3 ש' בין שתי דגימות + המשך קצר (עד 0.4 ש') אם חבילה מאחרת.
 * מיקום נשלח ב-ITM אמיתי (לא בקואורדינטות הסצנה) – כך גרסאות שונות של העולם עדיין מסכימות איפה כל אחד עומד.
 * אין שרת / נפל החיבור: ניסיון חוזר עם המתנה גדלה (1→30 ש'), בלי חריגות ובלי הודעות קופצות; תג קטן מראה את המצב.
 * שרת: twin/servers/esh27-mp (Durable Object, לא נפרס).
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  // ---------------------------------------------------------------- לוגיקה טהורה (נבדקת ב-node: tools/test-mp.js)
  const core = {
    RATE_HZ: 5, DELAY: 0.3, EXTRAP: 0.4, STALE: 12, MAXBUF: 24, HIDE_DIST: 2500,
    MODES: ['walk', 'car', 'heli', 'jetpack', 'drone', 'jet', 'spaceship', 'boat', 'dev', 'present'],
    wrap(a) { return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; },
    lerpAngle(a, b, k) { return a + core.wrap(b - a) * k; },
    kind(m) { return m === 'car' ? 'car' : (m === 'heli' || m === 'drone' || m === 'jet' || m === 'spaceship') ? 'air' : m === 'boat' ? 'boat' : (m === 'dev' || m === 'present') ? 'eye' : 'foot'; },
    // ניקוי מצב שהגיע משחקן אחר (לא סומכים על השרת שיעשה את זה בשבילנו)
    clean(o) {
      const f = (v, a, b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
      if (!o || !f(o.E, 50000, 350000) || !f(o.N, 300000, 870000) || !f(o.y, -50, 20000)) return null;
      return { E: o.E, N: o.N, y: o.y, h: f(o.h, -1000, 1000) ? core.wrap(o.h) : 0, m: core.MODES.includes(o.m) ? o.m : 'walk', v: f(o.v, -400, 400) ? o.v : 0,
        w: Number.isInteger(o.w) && o.w >= 0 && o.w <= 5 ? o.w : 0, nm: String(o.nm == null ? '' : o.nm).slice(0, 24) };
    },
    push(buf, t, s) {   // s = מצב נקי; t = זמן הגעה (ש')
      const last = buf[buf.length - 1]; if (last && t <= last.t) t = last.t + 1e-3;
      buf.push(Object.assign({ t }, s)); if (buf.length > core.MAXBUF) buf.splice(0, buf.length - core.MAXBUF); return buf;
    },
    // מיקום מוחלק לזמן ההצגה rt (= עכשיו − DELAY). מחזיר {E,N,y,h,m,v,w,ext} או null.
    sample(buf, rt) {
      const n = buf.length; if (!n) return null;
      if (rt <= buf[0].t || n === 1) { const a = buf[0], o = Object.assign({}, a, { ext: 0 }); if (n === 1 && rt > a.t) o.ext = Math.min(rt - a.t, core.EXTRAP); return o; }
      const L = buf[n - 1];
      if (rt >= L.t) {   // אין עדיין חבילה חדשה – ממשיכים קצת בכיוון התנועה האחרון, ואז עוצרים
        const P = buf[n - 2], d = Math.max(L.t - P.t, 1e-3), e = Math.min(rt - L.t, core.EXTRAP), k = e / d;
        const jump = Math.hypot(L.E - P.E, L.N - P.N) / d > 120;   // "קפיצה" (שינוי מקום במפה) – לא ממשיכים קפיצה
        return Object.assign({}, L, jump ? {} : { E: L.E + (L.E - P.E) * k, N: L.N + (L.N - P.N) * k, y: L.y + (L.y - P.y) * k }, { ext: e });
      }
      let i = n - 2; while (i > 0 && buf[i].t > rt) i--;
      const a = buf[i], b = buf[i + 1], k = (rt - a.t) / Math.max(b.t - a.t, 1e-6);
      if (Math.hypot(b.E - a.E, b.N - a.N) > 200) return Object.assign({}, k < 0.5 ? a : b, { ext: 0 });   // קפיצה – בלי "מעוף" באמצע
      return { E: a.E + (b.E - a.E) * k, N: a.N + (b.N - a.N) * k, y: a.y + (b.y - a.y) * k, h: core.lerpAngle(a.h, b.h, k), m: k < 0.5 ? a.m : b.m, v: a.v + (b.v - a.v) * k, w: b.w, nm: b.nm, ext: 0 };
    },
    prune(buf, rt) { while (buf.length > 2 && buf[1].t < rt) buf.shift(); return buf; },
    backoff(n, r) { const base = Math.min(30000, 1000 * Math.pow(2, Math.max(0, n))); return Math.round(base * (0.75 + 0.5 * (r == null ? 0.5 : r))); },
    // האם לשלוח עכשיו: כל 1/RATE ש' אם זז/הסתובב/החליף מצב, אחרת פעם ב-2 ש' (סימן חיים)
    shouldSend(last, s, since) {
      if (since < 1 / core.RATE_HZ - 1e-3) return false; if (!last) return true; if (since >= 2) return true;
      return Math.hypot(s.E - last.E, s.N - last.N) > 0.05 || Math.abs(s.y - last.y) > 0.05 || Math.abs(core.wrap(s.h - last.h)) > 0.01 || s.m !== last.m || s.w !== last.w;
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (!root || !root.YZW || typeof location === 'undefined') return;

  const qs = new URLSearchParams(location.search), ROOM = (qs.get('mp') || '').trim().slice(0, 32);
  if (!ROOM) return;   // כבוי כברירת מחדל
  const SRV = (qs.get('mpsrv') || 'wss://esh27-mp.ariel-sivkov.workers.dev').replace(/\/+$/, '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MP = { core, room: ROOM, srv: SRV, ws: null, id: null, status: 'off', tries: 0, timer: 0, peers: new Map(), sent: 0, recv: 0, lastSent: null, sinceSend: 9, dead: false, full: false, W: null, grp: null, chip: null };
  root.YZMP = MP;
  const now = () => performance.now() / 1000;

  function myName() {
    const n = qs.get('mpn') || qs.get('p'); if (n) return n.trim().slice(0, 24);
    try { const A = root.YZAcct; if (A && A.me) { const p = A.me.profiles && A.me.profiles.find(x => x.id === A.active); return String(A.me.user.username || (p && p.name) || '').slice(0, 24); } } catch (e) { /* */ }
    return '';
  }
  // ---------------------------------------------------------------- חיבור
  function setStatus(s) { MP.status = s; chip(); }
  function connect() {
    if (MP.dead) return; clearTimeout(MP.timer); MP.timer = 0;
    if (typeof WebSocket === 'undefined') { setStatus('none'); return; }
    let ws; setStatus('connecting');
    try { ws = new WebSocket(SRV + '/room/' + encodeURIComponent(ROOM) + '?n=' + encodeURIComponent(myName())); } catch (e) { retry(); return; }
    MP.ws = ws;
    ws.onopen = () => { if (MP.ws !== ws) return; MP.tries = 0; MP.lastSent = null; MP.sinceSend = 9; setStatus('open'); };
    ws.onmessage = ev => { if (MP.ws !== ws) return; let o; try { o = JSON.parse(ev.data); } catch (e) { return; } onMsg(o); };
    ws.onerror = () => { /* onclose מגיע אחריו */ };
    ws.onclose = ev => { if (MP.ws !== ws) return; MP.ws = null; MP.id = null; clearPeers(); if (MP.dead) return; if (ev && ev.code === 4001) MP.full = true; retry(); };
  }
  function retry() { if (MP.dead) return; const ms = MP.full ? 60000 : core.backoff(MP.tries++, Math.random()); MP.nextMs = ms; setStatus(MP.full ? 'full' : 'down'); MP.timer = setTimeout(connect, ms); }
  function send(o) { const ws = MP.ws; if (!ws || ws.readyState !== 1) return false; try { ws.send(JSON.stringify(o)); MP.sent++; return true; } catch (e) { return false; } }
  function onMsg(o) {
    if (!o || typeof o !== 'object') return; MP.recv++;
    if (o.t === 'hi') { MP.id = o.id; MP.full = false; (o.peers || []).forEach(p => peerState(p)); setStatus('open'); }
    else if (o.t === 's') peerState(o);
    else if (o.t === 'bye') removePeer(o.id);
    else if (o.t === 'full') { MP.full = true; }
  }
  function peerState(o) {
    if (!o || typeof o.id !== 'string' || o.id === MP.id) return; const s = core.clean(o); if (!s) return;
    let p = MP.peers.get(o.id); if (!p) { if (MP.peers.size >= 32) return; p = { id: o.id, buf: [], obj: null, kind: null, label: '', seen: 0 }; MP.peers.set(o.id, p); }
    core.push(p.buf, now(), s); p.seen = now();
  }
  function removePeer(id) { const p = MP.peers.get(id); if (!p) return; if (p.obj) { MP.grp && MP.grp.remove(p.obj); disposeObj(p.obj); } MP.peers.delete(id); }
  function clearPeers() { for (const id of [...MP.peers.keys()]) removePeer(id); }
  // ---------------------------------------------------------------- רוחות (גאומטריה פשוטה, משותפת)
  let GEO = null;
  function geos(T) {
    if (GEO) return GEO;
    GEO = { body: new T.CylinderGeometry(0.24, 0.28, 1.15, 10), head: new T.SphereGeometry(0.2, 12, 8), car: new T.BoxGeometry(1.8, 0.75, 4.2), cab: new T.BoxGeometry(1.6, 0.6, 2.1),
      air: new T.BoxGeometry(1.4, 0.9, 3.2), rotor: new T.CylinderGeometry(3.2, 3.2, 0.04, 20), eye: new T.OctahedronGeometry(0.7) };
    return GEO;
  }
  function colorOf(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'hsl(' + (h % 360) + ',70%,55%)'; }
  function labelSprite(T, text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = 'rgba(12,20,32,.75)'; g.beginPath(); if (g.roundRect) g.roundRect(4, 8, 248, 48, 20); else g.rect(4, 8, 248, 48); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 28px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl'; g.fillText(text, 128, 33);
    const tex = new T.CanvasTexture(c); const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(2.4, 0.6, 1); sp.name = 'label'; return sp;
  }
  function build(p, kind) {
    const T = root.THREE, G = geos(T), col = new T.Color(colorOf(p.id)), m = new T.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.82 });
    const o = new T.Group(); o.name = 'mp:' + p.id; let top = 2.1;
    if (kind === 'car' || kind === 'boat') { const b = new T.Mesh(G.car, m); b.position.y = 0.55; const c = new T.Mesh(G.cab, m); c.position.set(0, 1.2, -0.3); o.add(b, c); top = 2.3; }
    else if (kind === 'air') { const b = new T.Mesh(G.air, m); b.position.y = 0.6; const r = new T.Mesh(G.rotor, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false })); r.position.y = 1.3; r.name = 'rotor'; o.add(b, r); top = 2.4; }
    else if (kind === 'eye') { const e = new T.Mesh(G.eye, m); e.position.y = 1.2; e.name = 'spin'; o.add(e); top = 2.4; }
    else { const b = new T.Mesh(G.body, m); b.position.y = 0.6 + 0.575; const h = new T.Mesh(G.head, m); h.position.y = 1.55; o.add(b, h); }
    o.userData.top = top; return o;
  }
  function setLabel(p, s) {
    const txt = (s.nm || 'שחקן') + (s.w ? ' ' + '★'.repeat(s.w) : ''); if (p.obj && p.label === txt) return;
    const old = p.obj.getObjectByName('label'); if (old) { p.obj.remove(old); old.material.map.dispose(); old.material.dispose(); }
    const sp = labelSprite(root.THREE, txt); sp.position.y = p.obj.userData.top + 0.5; p.obj.add(sp); p.label = txt;
  }
  function disposeObj(o) { o.traverse(n => { if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); } }); }   // הגאומטריה משותפת – לא משחררים
  // ---------------------------------------------------------------- מצב שלי
  function mine(world) {
    const c = world.coords, S = world.G27 && world.G27.S; if (!c || !c.toRealITM || !S) return null;
    const pos = world.player.pos, it = c.toRealITM(pos.x, pos.z), m = world.player.mode || 'walk';
    const h = m === 'car' ? S.car.h : m === 'heli' ? S.heli.h : m === 'drone' && S.drone && S.drone.h != null ? S.drone.h : S.heading;
    const wl = root.YZWanted && root.YZWanted.level ? root.YZWanted.level() : 0;
    return { t: 's', E: Math.round(it.E * 10) / 10, N: Math.round(it.N * 10) / 10, y: Math.round((pos.y || 0) * 10) / 10, h: Math.round(core.wrap(h || 0) * 1000) / 1000, m, v: Math.round((world.player.speed || 0) * 10) / 10, w: wl | 0 };
  }
  // ---------------------------------------------------------------- תג על המסך
  const LBL = { off: 'כבוי', none: 'אין תמיכה', connecting: 'מתחבר…', open: 'מחובר', down: 'לא מחובר – מנסה שוב', full: 'החדר מלא' };
  function chip() {
    let el = MP.chip; if (!el) return;
    const n = MP.peers.size; el.textContent = '👥 ' + (MP.status === 'open' ? (n + 1) + ' בחדר' : LBL[MP.status] || MP.status) + ' · ' + ROOM;
    el.dataset.st = MP.status;
  }
  YZW.register({
    id: 'multiplayer', name: 'מרובה משתתפים (?mp=חדר)', dept: 'integration', order: 65,
    init(world, api) {
      MP.W = world; MP.grp = api.group('mp-ghosts'); MP.dead = false;
      const css = document.createElement('style'); css.id = 'yzMpCss';
      css.textContent = '#yzMp{position:fixed;left:8px;top:calc(env(safe-area-inset-top) + 230px);z-index:11;font:11px system-ui,sans-serif;background:rgba(12,20,32,.75);border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:1px 7px;color:#eef3f8;pointer-events:none;direction:rtl;max-width:44vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#yzMp[data-st=open]{border-color:#5fd38d}#yzMp[data-st=down],#yzMp[data-st=full]{color:#a9b4bc}';
      document.head.appendChild(css); const el = document.createElement('div'); el.id = 'yzMp'; el.setAttribute('role', 'status'); document.body.appendChild(el); MP.chip = el;
      MP.vis = () => { if (!document.hidden && !MP.ws && (MP.status === 'down')) connect(); };   // חזרה ללשונית – לא מחכים לסוף ההמתנה
      document.addEventListener('visibilitychange', MP.vis);
      connect();
    },
    update(dt, world) {
      // שליחה
      MP.sinceSend += dt;
      if (MP.status === 'open' && MP.id) { const s = mine(world); if (s && core.shouldSend(MP.lastSent, s, MP.sinceSend)) { if (send(s)) { MP.lastSent = s; MP.sinceSend = 0; } } }
      // רוחות
      const t = now(), rt = t - core.DELAY, c = world.coords, me = world.player.pos, T = root.THREE;
      for (const p of [...MP.peers.values()]) {
        if (t - p.seen > core.STALE) { removePeer(p.id); continue; }
        core.prune(p.buf, rt); const s = core.sample(p.buf, rt); if (!s || !c.fromRealITM) continue;
        const k = core.kind(s.m); if (!p.obj || p.kind !== k) { if (p.obj) { MP.grp.remove(p.obj); disposeObj(p.obj); } p.obj = build(p, k); p.kind = k; p.label = ''; MP.grp.add(p.obj); }
        setLabel(p, s);
        const q = c.fromRealITM(s.E, s.N); let y = s.y;
        if (k === 'foot' || k === 'car') { const g = Math.max(0, world.data.H(q.x, q.z)); if (Math.abs(y - g) > 6) y = g; }   // קרקע מקומית אם הגובה שנשלח רחוק מדי ממנה
        p.obj.position.set(q.x, y, q.z); p.obj.rotation.y = s.h;
        p.obj.visible = Math.hypot(q.x - me.x, q.z - me.z) < core.HIDE_DIST;
        const r = p.obj.getObjectByName('rotor'); if (r) r.rotation.y += dt * 25; const sp = p.obj.getObjectByName('spin'); if (sp) sp.rotation.y += dt * 1.5;
      }
      MP.chT = (MP.chT || 0) + dt; if (MP.chT > 0.5) { MP.chT = 0; chip(); }
    },
    hudPanels: [{ id: 'mp', render(el) { el.innerHTML = '👥 <b>' + esc(ROOM) + '</b> · ' + esc(LBL[MP.status] || MP.status) + (MP.status === 'open' ? ' · ' + (MP.peers.size + 1) + ' שחקנים' : '') + ' <small>נשלחו ' + MP.sent + ' · התקבלו ' + MP.recv + '</small>'; } }],
    dispose() {
      MP.dead = true; clearTimeout(MP.timer); MP.timer = 0; const ws = MP.ws; MP.ws = null; if (ws) { try { ws.close(1000, 'bye'); } catch (e) { /* */ } }
      clearPeers(); document.removeEventListener('visibilitychange', MP.vis); if (MP.chip) MP.chip.remove(); MP.chip = null; const css = document.getElementById('yzMpCss'); if (css) css.remove();
      if (GEO) { for (const g of Object.values(GEO)) g.dispose(); GEO = null; } setStatus('off');
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
