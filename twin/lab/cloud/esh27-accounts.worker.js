// esh27-accounts – משתמשים, סיסמאות, כמה פרופילים לכל משתמש, ודמות לכל פרופיל. Cloudflare Worker + D1.
// סיסמאות: PBKDF2-SHA256, 100,000 סבבים, מלח אקראי. כניסה: אסימון אקראי (32 בתים) שנשמר כגיבוב בלבד, תקף 60 יום.
// התחברות עם גוגל: POST /api/google עם id_token – פעיל רק כשמוגדר GOOGLE_CLIENT_ID.
const ORIGINS = [/^https:\/\/raw\.githack\.com$/, /^https:\/\/([a-z0-9-]+\.)?esh27\.com$/, /^https:\/\/[a-z0-9-]+\.ariel-sivkov\.workers\.dev$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
const MAX_PROFILES = 5, SESSION_DAYS = 60, ITER = 100000;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE, pw_hash TEXT, pw_salt TEXT, google_sub TEXT UNIQUE, email TEXT, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, expires INTEGER)`,
  `CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, avatar TEXT, state TEXT, created INTEGER, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS attempts (k TEXT PRIMARY KEY, n INTEGER, t INTEGER)`
];
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
async function sha(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITER }, k, 256));
}
function eq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function cors(req) {
  const o = req.headers.get('origin') || '';
  return ORIGINS.some(r => r.test(o)) ? { 'access-control-allow-origin': o, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', vary: 'origin' } : {};
}
const J = (req, o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(req) } });
const cleanName = s => String(s || '').trim().slice(0, 40);
const USER_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
function cleanAvatar(a) {   // רק שדות מוכרים, ערכים מוגבלים
  a = a && typeof a === 'object' ? a : {}; const col = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : undefined;
  const pick = (v, list) => list.includes(v) ? v : undefined;
  return JSON.stringify({ base: pick(a.base, ['m', 'f']) || 'm', skin: col(a.skin), hair: col(a.hair), top: col(a.top), bottom: col(a.bottom), shoes: col(a.shoes),
    hairStyle: pick(a.hairStyle, ['parted', 'buzzed', 'long', 'buns', 'none']) || 'parted', beard: !!a.beard, height: Math.min(2.05, Math.max(1.45, +a.height || 1.75)) });
}
async function init(db) { for (const s of SCHEMA) await db.prepare(s).run(); }
async function limited(db, k) {   // עד 10 ניסיונות כושלים ב-15 דקות לכל שם משתמש/כתובת
  const r = await db.prepare('SELECT n, t FROM attempts WHERE k=?').bind(k).first(); const now = Date.now();
  return r && now - r.t < 900000 && r.n >= 10;
}
async function fail(db, k) { const now = Date.now(); await db.prepare('INSERT INTO attempts (k,n,t) VALUES (?,1,?) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN ?-t > 900000 THEN 1 ELSE n+1 END, t = ?').bind(k, now, now, now).run(); }
async function session(db, uid) {
  const tok = rnd(32); await db.prepare('INSERT INTO sessions (token_hash,user_id,expires) VALUES (?,?,?)').bind(await sha(tok), uid, Date.now() + SESSION_DAYS * 864e5).run(); return tok;
}
async function auth(req, db) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') || ''); if (!m) return null;
  const s = await db.prepare('SELECT user_id, expires FROM sessions WHERE token_hash=?').bind(await sha(m[1])).first();
  return s && s.expires > Date.now() ? s.user_id : null;
}
async function me(db, uid) {
  const u = await db.prepare('SELECT id, username, email, created FROM users WHERE id=?').bind(uid).first();
  const p = (await db.prepare('SELECT id, name, avatar, state, updated FROM profiles WHERE user_id=? ORDER BY created').bind(uid).all()).results || [];
  return { user: u, profiles: p.map(x => ({ id: x.id, name: x.name, avatar: JSON.parse(x.avatar || '{}'), state: JSON.parse(x.state || '{}'), updated: x.updated })) };
}
async function newProfile(db, uid, name, avatar) {
  const n = (await db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE user_id=?').bind(uid).first()).c;
  if (n >= MAX_PROFILES) return null;
  const id = rnd(8), now = Date.now();
  await db.prepare('INSERT INTO profiles (id,user_id,name,avatar,state,created,updated) VALUES (?,?,?,?,?,?,?)').bind(id, uid, cleanName(name) || 'פרופיל ' + (n + 1), cleanAvatar(avatar), '{}', now, now).run();
  return id;
}
async function body(req) { try { return await req.json(); } catch (e) { return {}; } }

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url), p = url.pathname, db = env.DB;
    try {
      await init(db);
      if (p === '/api/health') return J(req, { ok: true, google: !!env.GOOGLE_CLIENT_ID });
      if (p === '/api/signup' && req.method === 'POST') {
        const b = await body(req), un = String(b.username || '').trim().toLowerCase(), pw = String(b.password || '');
        if (!USER_RE.test(un)) return J(req, { error: 'שם משתמש: 3–24 תווים, אותיות/מספרים/_.-' }, 400);
        if (pw.length < 8) return J(req, { error: 'סיסמה: לפחות 8 תווים' }, 400);
        if (await db.prepare('SELECT 1 FROM users WHERE username=?').bind(un).first()) return J(req, { error: 'שם המשתמש תפוס' }, 409);
        const id = rnd(8), salt = rnd(16);
        await db.prepare('INSERT INTO users (id,username,pw_hash,pw_salt,created) VALUES (?,?,?,?,?)').bind(id, un, await pbkdf2(pw, salt), salt, Date.now()).run();
        await newProfile(db, id, b.profileName || un, b.avatar);
        return J(req, { token: await session(db, id), ...(await me(db, id)) });
      }
      if (p === '/api/login' && req.method === 'POST') {
        const b = await body(req), un = String(b.username || '').trim().toLowerCase(), pw = String(b.password || ''), k = 'u:' + un;
        if (await limited(db, k)) return J(req, { error: 'יותר מדי ניסיונות. נסה שוב בעוד 15 דקות' }, 429);
        const u = await db.prepare('SELECT id, pw_hash, pw_salt FROM users WHERE username=?').bind(un).first();
        if (!u || !u.pw_hash || !eq(await pbkdf2(pw, u.pw_salt), u.pw_hash)) { await fail(db, k); return J(req, { error: 'שם משתמש או סיסמה שגויים' }, 401); }
        return J(req, { token: await session(db, u.id), ...(await me(db, u.id)) });
      }
      if (p === '/api/google' && req.method === 'POST') {
        if (!env.GOOGLE_CLIENT_ID) return J(req, { error: 'התחברות עם גוגל עוד לא הוגדרה' }, 501);
        const b = await body(req), r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(b.credential || ''));
        const t = r.ok ? await r.json() : null;
        if (!t || t.aud !== env.GOOGLE_CLIENT_ID || !/accounts\.google\.com$/.test(t.iss || '') || +t.exp * 1000 < Date.now()) return J(req, { error: 'אסימון גוגל לא תקף' }, 401);
        let u = await db.prepare('SELECT id FROM users WHERE google_sub=?').bind(t.sub).first();
        if (!u) { const id = rnd(8); await db.prepare('INSERT INTO users (id,username,google_sub,email,created) VALUES (?,?,?,?,?)').bind(id, null, t.sub, t.email || null, Date.now()).run(); await newProfile(db, id, t.given_name || 'פרופיל 1', {}); u = { id }; }
        return J(req, { token: await session(db, u.id), ...(await me(db, u.id)) });
      }
      const uid = await auth(req, db);
      if (!uid) return J(req, { error: 'צריך להתחבר' }, 401);
      if (p === '/api/me') return J(req, await me(db, uid));
      if (p === '/api/logout' && req.method === 'POST') { await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha((req.headers.get('authorization') || '').slice(7))).run(); return J(req, { ok: true }); }
      if (p === '/api/profiles' && req.method === 'POST') {
        const b = await body(req), id = await newProfile(db, uid, b.name, b.avatar);
        return id ? J(req, await me(db, uid)) : J(req, { error: 'אפשר עד ' + MAX_PROFILES + ' פרופילים' }, 400);
      }
      const m = /^\/api\/profiles\/([0-9a-f]{16})$/.exec(p);
      if (m) {
        const own = await db.prepare('SELECT id FROM profiles WHERE id=? AND user_id=?').bind(m[1], uid).first();
        if (!own) return J(req, { error: 'לא נמצא' }, 404);
        if (req.method === 'PUT') {
          const b = await body(req), sets = [], vals = [];
          if (b.name !== undefined) { sets.push('name=?'); vals.push(cleanName(b.name)); }
          if (b.avatar !== undefined) { sets.push('avatar=?'); vals.push(cleanAvatar(b.avatar)); }
          if (b.state !== undefined) { const s = JSON.stringify(b.state); if (s.length > 20000) return J(req, { error: 'מצב גדול מדי' }, 413); sets.push('state=?'); vals.push(s); }
          if (sets.length) await db.prepare('UPDATE profiles SET ' + sets.join(',') + ', updated=? WHERE id=?').bind(...vals, Date.now(), m[1]).run();
          return J(req, await me(db, uid));
        }
        if (req.method === 'DELETE') {
          const n = (await db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE user_id=?').bind(uid).first()).c;
          if (n <= 1) return J(req, { error: 'חייב להישאר פרופיל אחד' }, 400);
          await db.prepare('DELETE FROM profiles WHERE id=?').bind(m[1]).run(); return J(req, await me(db, uid));
        }
      }
      return J(req, { error: 'לא נמצא' }, 404);
    } catch (e) { return J(req, { error: 'שגיאת שרת' }, 500); }
  }
};
