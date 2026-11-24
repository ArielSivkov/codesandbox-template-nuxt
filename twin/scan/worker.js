// scan.esh27.com – הדף נמשך מהריפו (twin/scan/scan-site.html), כך שעדכון = git push.
// אחסון (24.11.2026): KV החינמי מוגבל ל-1,000 כתיבות ביום לכל החשבון – כשנגמר, כל העלאה החזירה 500.
// עכשיו התמונות נשמרות ב-D1 (esh27-scan, 100,000 כתיבות ביום חינם) בחתיכות של 1MB; KV רק גיבוי אם D1 נכשל.
// כש-R2 יופעל בחשבון – לעבור אליו (10GB חינם) ולשמור את אותו ממשק. נפרס ל-esh27-scan ב-24.11.2026 (D1 9fe38da6-65f4-4228-b776-83c0e72fd9b8).
const SRC = 'https://raw.githubusercontent.com/ArielSivkov/codesandbox-template-nuxt/twin-world/twin/scan/scan-site.html';
const CHUNK = 1000000;
// סוג הקובץ לפי הסיומת – תמונות, מקטעי וידאו (webm/mp4) ויומני החיישנים שלהם
const mimeOf = n => /\.webm$/i.test(n) ? 'video/webm' : /\.mp4$/i.test(n) ? 'video/mp4' : /\.json$/i.test(n) ? 'application/json' : /\.png$/i.test(n) ? 'image/png' : 'image/jpeg';
const okKey = (req, env) => { const k = req.headers.get('X-Key'); return !!k && (k === env.SCAN_KEY || k === env.LINK_KEY); };
const clean = s => (s || '').replace(/[^\w.\-]/g, '_').slice(0, 120);

async function saveD1(env, session, name, body, meta) {
  const u8 = new Uint8Array(body), n = Math.ceil(u8.length / CHUNK), at = Date.now();
  const st = [env.DB.prepare('DELETE FROM chunks WHERE session=? AND name=?').bind(session, name)];
  for (let i = 0; i < n; i++) st.push(env.DB.prepare('INSERT INTO chunks(session,name,idx,data) VALUES(?,?,?,?)').bind(session, name, i, u8.slice(i * CHUNK, (i + 1) * CHUNK)));
  // הרשומה הראשית נכתבת אחרונה באותה עסקה – תמונה חלקית לא תופיע ברשימה
  st.push(env.DB.prepare('INSERT OR REPLACE INTO photos(session,name,bytes,at,meta,nchunks) VALUES(?,?,?,?,?,?)').bind(session, name, u8.length, at, meta, n));
  await env.DB.batch(st);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const cache = caches.default, ck = new Request(SRC);
      let r = await cache.match(ck);
      if (!r) { const g = await fetch(SRC, { cf: { cacheTtl: 60 } }); if (!g.ok) return new Response('הדף לא זמין כרגע', { status: 503 }); r = new Response(await g.text(), { headers: { 'cache-control': 'max-age=60' } }); ctx.waitUntil(cache.put(ck, r.clone())); }
      return new Response(r.body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'permissions-policy': 'camera=(self), microphone=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)' } });
    }
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      if (!okKey(req, env)) return new Response('unauthorized', { status: 401 });
      const session = clean(url.searchParams.get('session')), name = clean(url.searchParams.get('name'));
      if (!session || !name) return new Response('bad request', { status: 400 });
      const body = await req.arrayBuffer();
      if (body.byteLength < 1000 || body.byteLength > 24000000) return new Response('bad size', { status: 413 });
      let meta = '{}';
      try { meta = decodeURIComponent(escape(atob(req.headers.get('X-Meta') || ''))); JSON.parse(meta); } catch (e) { meta = '{}'; }
      try { await saveD1(env, session, name, body, meta); return Response.json({ ok: true, store: 'd1', key: session + '/' + name }); }
      catch (e1) {
        try {
          await env.SCAN.put('img/' + session + '/' + name, body, { metadata: { bytes: body.byteLength, at: Date.now() } });
          await env.SCAN.put('meta/' + session + '/' + name + '.json', meta);
          return Response.json({ ok: true, store: 'kv', key: 'img/' + session + '/' + name });
        } catch (e2) { return Response.json({ ok: false, error: 'storage', d1: String(e1.message || e1).slice(0, 200), kv: String(e2.message || e2).slice(0, 200) }, { status: 507 }); }
      }
    }
    if (url.pathname === '/api/list') {   // לצרכנים (פס הייצור): רשימת תמונות ב-D1
      if (!okKey(req, env)) return new Response('unauthorized', { status: 401 });
      const since = +url.searchParams.get('since') || 0;
      const r = await env.DB.prepare('SELECT session,name,bytes,at,meta FROM photos WHERE at>? ORDER BY at LIMIT 500').bind(since).all();
      return Response.json({ ok: true, photos: r.results });
    }
    if (url.pathname === '/api/img' || url.pathname === '/api/file') {
      if (!okKey(req, env)) return new Response('unauthorized', { status: 401 });
      const session = clean(url.searchParams.get('session')), name = clean(url.searchParams.get('name'));
      const r = await env.DB.prepare('SELECT data FROM chunks WHERE session=? AND name=? ORDER BY idx').bind(session, name).all();
      if (!r.results.length) return new Response('not found', { status: 404 });
      const parts = r.results.map(x => new Uint8Array(x.data)), out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
      return new Response(out, { headers: { 'content-type': mimeOf(name), 'content-disposition': 'inline; filename="' + name + '"' } });
    }
    if (url.pathname === '/api/ping') return Response.json({ ok: true, key_ok: okKey(req, env) });
    return new Response('not found', { status: 404 });
  }
};
