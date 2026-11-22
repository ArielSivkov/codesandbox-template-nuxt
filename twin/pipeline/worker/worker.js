// Yazam map-data Worker: serves tiles from R2 and collects height corrections (data flywheel).
//   GET  /map-data/index.json                      country index (short cache)
//   GET  /map-data/cities/<slug>/manifest.json     city manifest (short cache)
//   GET  /map-data/tiles/v/<tx>_<ty>.json.gz       vector tile  (gzip passthrough, long cache)
//   GET  /map-data/tiles/t/<tx>_<ty>.bin.gz        terrain tile (gzip passthrough, long cache)
//   POST /map-data/api/corrections                 {osm_id, floors?, height_m?, method, note?}
//   GET  /map-data/api/corrections/export?since=YYYY-MM-DD   (Bearer EXPORT_TOKEN) -> JSON array
const PREFIX = '/map-data/';
// Tiles are public open data (ODbL) -> any origin may GET them. Writes are accepted only from our site.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-contractor-key,authorization' };
const WRITE_ORIGINS = ['https://yazam.esh27.com'];
function safeEqual(a, b) {               // constant-time string compare
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST' } });
    if (!url.pathname.startsWith(PREFIX)) return new Response('not found', { status: 404 });
    const key = url.pathname.slice(PREFIX.length);

    if (key === 'api/corrections' && req.method === 'POST') {
      const o = req.headers.get('origin');
      if (o && !WRITE_ORIGINS.includes(o)) return json({ ok: false, error: 'origin' }, 403);
      return saveCorrection(req, env);
    }
    if (key === 'api/corrections/export' && req.method === 'GET') return exportCorrections(req, env, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405, headers: CORS });
    if (!/^(index\.json|cities\/[a-z0-9-]+\/manifest\.json|tiles\/[vt]\/-?\d+_-?\d+\.(json|bin)\.gz)$/.test(key))
      return new Response('bad key', { status: 400, headers: CORS });

    const cache = caches.default;
    let res = await cache.match(req);
    if (res) return res;
    const obj = await env.BUCKET.get(key);
    if (!obj) return new Response('missing', { status: 404, headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } });
    const isTile = key.startsWith('tiles/');
    const h = new Headers(CORS);
    h.set('ETag', obj.httpEtag);
    h.set('Cache-Control', isTile ? 'public, max-age=86400, stale-while-revalidate=604800' : 'public, max-age=300');
    if (key.endsWith('.gz')) {
      // stored gzipped: let the browser inflate it transparently
      h.set('Content-Encoding', 'gzip');
      h.set('Content-Type', key.includes('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream');
    } else h.set('Content-Type', 'application/json; charset=utf-8');
    res = new Response(obj.body, { headers: h, encodeBody: 'manual' });
    ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  }
};

async function saveCorrection(req, env) {
  let j;
  try { j = await req.json(); } catch (e) { return json({ ok: false, error: 'json' }, 400); }
  const id = String(j.osm_id || '').slice(0, 40);
  const floors = j.floors == null ? null : Number(j.floors);
  const hm = j.height_m == null ? null : Number(j.height_m);
  if (!/^[wrov][\w:.-]+$|^\d+$/.test(id)) return json({ ok: false, error: 'osm_id' }, 400);
  if (floors != null && !(Number.isInteger(floors) && floors >= 1 && floors <= 80)) return json({ ok: false, error: 'floors' }, 400);
  if (hm != null && !(hm >= 2 && hm <= 400)) return json({ ok: false, error: 'height_m' }, 400);
  if (floors == null && hm == null) return json({ ok: false, error: 'empty' }, 400);
  const keys = String(env.CONTRACTOR_KEYS || '').split(',').filter(Boolean);
  const ck = req.headers.get('x-contractor-key') || '';
  const trust = keys.some(k => safeEqual(k, ck)) ? 'contractor' : 'anon';
  if (trust === 'anon') {                // at most one anonymous correction per IP per building per day
    const ip = req.headers.get('cf-connecting-ip') || '';
    const day0 = new Date().toISOString().slice(0, 10);
    const hb = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + id + '|' + day0));
    const rl = new Request('https://rl.yazam.invalid/' + [...new Uint8Array(hb)].map(x => x.toString(16).padStart(2, '0')).join(''));
    if (await caches.default.match(rl)) return json({ ok: false, error: 'rate' }, 429);
    await caches.default.put(rl, new Response('1', { headers: { 'Cache-Control': 'max-age=86400' } }));
  }
  const method = ['manual', 'laser', 'lidar', 'photo_ai', 'plan'].includes(j.method) ? j.method : 'manual';
  const rec = { osm_id: id, floors, height_m: hm, method, trust, note: String(j.note || '').slice(0, 300),
    date: new Date().toISOString(), contractor: trust === 'contractor' ? ck.slice(0, 6) : null };
  const day = rec.date.slice(0, 10);
  await env.BUCKET.put(`corrections/${day}/${crypto.randomUUID()}.json`, JSON.stringify(rec),
    { httpMetadata: { contentType: 'application/json' } });
  return json({ ok: true, trust });
}

async function exportCorrections(req, env, url) {
  if (!env.EXPORT_TOKEN || !safeEqual(req.headers.get('authorization') || '', `Bearer ${env.EXPORT_TOKEN}`)) return json({ ok: false }, 401);
  const since = url.searchParams.get('since') || '2000-01-01';
  const out = [];
  let cursor;
  do {
    const l = await env.BUCKET.list({ prefix: 'corrections/', cursor, limit: 1000 });
    for (const o of l.objects) {
      if (o.key.slice(12, 22) < since) continue;
      const b = await env.BUCKET.get(o.key);
      if (b) out.push(await b.json());
    }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return json(out);
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}
