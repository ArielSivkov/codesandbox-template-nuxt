// esh27-mp – חדרי מרובה משתתפים ל"לוח היזם · עולם תאום". Cloudflare Worker + Durable Object (כל חדר = אובייקט אחד).
// הרעיון מ-earth1926/server/main.go: לכל שחקן מזהה מהשרת, מצב {מיקום, כיוון, מצב/רכב}, והשרת מפיץ לכולם.
// שינויים מול main.go: (1) מפיצים כל עדכון מיד לשאר החדר ולא שולחים את כל המפה 30 פעמים בשנייה – אין טיימר, האובייקט יכול "לישון"
// (WebSocket Hibernation) ולא עולה כסף כשאין תנועה; (2) בדיקת מקור (Origin) כמו בשאר השרתים שלנו – main.go קיבל כל מקור;
// (3) ניקוי ערכים (מספרים סופיים, תחום, מצב מרשימה) – השרת לא מעביר שדות שלא הכיר; (4) הגבלת קצב לכל שחקן ותקרת שחקנים לחדר.
// פרוטוקול (JSON בשורה אחת, מפתחות קצרים):
//   לקוח→שרת  {t:'s', E, N, y, h, m, v, w?}  E/N = ITM אמיתי (מ'), y = גובה (מ'), h = כיוון (רדיאנים), m = מצב, v = מהירות (מ'/ש'), w = כוכבי "מבוקש" 0–5
//             {t:'ping'}
//   שרת→לקוח  {t:'hi', id, room, rate, max, peers:[s…]}  ·  {t:'s', id, nm, …}  ·  {t:'bye', id}  ·  {t:'pong'}  ·  {t:'full', max}
// לא נפרס. פריסה: ראו README.md (החלטה של אריאל).
const VERSION = '0.1.0';
const ORIGINS = [/^https:\/\/raw\.githack\.com$/, /^https:\/\/([a-z0-9-]+\.)?esh27\.com$/, /^https:\/\/[a-z0-9-]+\.ariel-sivkov\.workers\.dev$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
export const LIMITS = { MAX_PLAYERS: 24, MAX_MSG: 512, MIN_GAP_MS: 120, RATE_HZ: 5 };
const ROOM_RE = /^[\p{L}\p{N}_-]{1,32}$/u;
const MODES = ['walk', 'car', 'heli', 'jetpack', 'drone', 'jet', 'spaceship', 'boat', 'dev', 'present'];
const fin = (v, a, b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;

// ניקוי מצב שהגיע מהלקוח. מחזיר אובייקט חדש עם שדות מוכרים בלבד, או null.
export function cleanState(o) {
  if (!o || typeof o !== 'object') return null;
  // ITM: מזרח 100–300 ק"מ, צפון 350–820 ק"מ (רשת ישראל, גס, עם שוליים); גובה −50…20,000 מ'
  if (!fin(o.E, 50000, 350000) || !fin(o.N, 300000, 870000) || !fin(o.y, -50, 20000)) return null;
  const h = fin(o.h, -1000, 1000) ? o.h : 0;
  const s = { E: r1(o.E), N: r1(o.N), y: r1(o.y), h: r3(Math.atan2(Math.sin(h), Math.cos(h))), m: MODES.includes(o.m) ? o.m : 'walk', v: fin(o.v, -400, 400) ? r1(o.v) : 0 };
  if (Number.isInteger(o.w) && o.w >= 0 && o.w <= 5) s.w = o.w;
  return s;
}
export const cleanName = s => String(s == null ? '' : s).replace(/[\u0000-\u001f<>"'&]/g, '').trim().slice(0, 24);
const rndId = () => [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join('');
const allowed = o => !!o && ORIGINS.some(r => r.test(o));
const J = (o, s = 200, origin) => new Response(JSON.stringify(o), { status: s, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, allowed(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}) });

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('origin') || '';
    if (url.pathname === '/health') return J({ ok: true, v: VERSION, rate: LIMITS.RATE_HZ, max: LIMITS.MAX_PLAYERS }, 200, origin);
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m) return J({ error: 'לא נמצא' }, 404, origin);
    let room; try { room = decodeURIComponent(m[1]); } catch (e) { return J({ error: 'שם חדר לא תקין' }, 400, origin); }
    if (!ROOM_RE.test(room)) return J({ error: 'שם חדר לא תקין' }, 400, origin);
    if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return J({ error: 'צריך WebSocket' }, 426, origin);
    if (!allowed(origin)) return J({ error: 'מקור לא מורשה' }, 403, origin);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
    return stub.fetch(req);
  },
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.st = new Map();     // id → מצב אחרון (בזיכרון; אחרי "שינה" מתמלא שוב מהעדכון הבא, תוך ~200 מ"ש)
    this.last = new Map();   // id → זמן ההודעה האחרונה (הגבלת קצב)
    try { if (typeof WebSocketRequestResponsePair !== 'undefined' && ctx.setWebSocketAutoResponse) ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}')); } catch (e) { /* סביבה בלי תמיכה */ }
  }
  async fetch(req) {
    const url = new URL(req.url), room = decodeURIComponent(url.pathname.split('/').pop() || '');
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.accept(server, cleanName(url.searchParams.get('n')), room);
    return new Response(null, { status: 101, webSocket: client });
  }
  // מופרד מ-fetch כדי שבדיקות יוכלו לחבר שקע מדומה
  accept(ws, name, room) {
    if (this.ctx.getWebSockets().length >= LIMITS.MAX_PLAYERS) {
      this.ctx.acceptWebSocket(ws); ws.send(JSON.stringify({ t: 'full', max: LIMITS.MAX_PLAYERS })); try { ws.close(4001, 'full'); } catch (e) { /* */ } return null;
    }
    const id = rndId(), nm = name || 'אורח-' + id.slice(0, 4);
    this.ctx.acceptWebSocket(ws); ws.serializeAttachment({ id, nm });
    const peers = []; for (const [pid, s] of this.st) peers.push(Object.assign({ id: pid }, s));
    ws.send(JSON.stringify({ t: 'hi', id, nm, room, rate: LIMITS.RATE_HZ, max: LIMITS.MAX_PLAYERS, peers }));
    return id;
  }
  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > LIMITS.MAX_MSG) return;
    const a = ws.deserializeAttachment(); if (!a || !a.id) return;
    let o; try { o = JSON.parse(msg); } catch (e) { return; }
    if (!o || typeof o !== 'object') return;
    if (o.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    if (o.t !== 's') return;
    const now = Date.now(); if (now - (this.last.get(a.id) || 0) < LIMITS.MIN_GAP_MS) return;   // מהר מדי – נזרק
    const s = cleanState(o); if (!s) return;
    this.last.set(a.id, now); s.nm = a.nm; this.st.set(a.id, s);
    this.broadcast(JSON.stringify(Object.assign({ t: 's', id: a.id }, s)), ws);
  }
  webSocketClose(ws, code) { this.drop(ws); try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (e) { /* כבר סגור */ } }
  webSocketError(ws) { this.drop(ws); }
  drop(ws) {
    const a = ws.deserializeAttachment(); if (!a || !a.id) return;   // שקע "מלא" שנדחה – אין לו מזהה
    this.st.delete(a.id); this.last.delete(a.id); this.broadcast(JSON.stringify({ t: 'bye', id: a.id }), ws);
  }
  broadcast(str, except) { for (const w of this.ctx.getWebSockets()) { if (w === except) continue; try { w.send(str); } catch (e) { /* שקע נסגר באמצע */ } } }
}
