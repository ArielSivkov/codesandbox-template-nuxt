// scan.esh27.com – הדף נמשך מהריפו (twin/scan/scan-site.html), כך שעדכון = git push.
// API: /api/upload (X-Key), /api/ping. התמונות נשמרות ב-KV SCAN, ומשם esh27-vision מכניס אותן לתור.
const SRC = 'https://raw.githubusercontent.com/ArielSivkov/codesandbox-template-nuxt/twin-world/twin/scan/scan-site.html';
const okKey = (req, env) => { const k = req.headers.get('X-Key'); return !!k && (k === env.SCAN_KEY || k === env.LINK_KEY); };
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
      const clean = s => (s || '').replace(/[^\w.\-]/g, '_').slice(0, 120);
      const session = clean(url.searchParams.get('session')), name = clean(url.searchParams.get('name'));
      if (!session || !name) return new Response('bad request', { status: 400 });
      const body = await req.arrayBuffer();
      if (body.byteLength < 1000 || body.byteLength > 24000000) return new Response('bad size', { status: 413 });
      let meta = '{}';
      try { meta = decodeURIComponent(escape(atob(req.headers.get('X-Meta') || ''))); JSON.parse(meta); } catch (e) { meta = '{}'; }
      await env.SCAN.put('img/' + session + '/' + name, body, { metadata: { bytes: body.byteLength, at: Date.now() } });
      await env.SCAN.put('meta/' + session + '/' + name + '.json', meta);
      return Response.json({ ok: true, key: 'img/' + session + '/' + name });
    }
    if (url.pathname === '/api/ping') return Response.json({ ok: true, key_ok: okKey(req, env) });
    return new Response('not found', { status: 404 });
  }
};
