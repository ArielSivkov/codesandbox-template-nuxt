// ---- הצלבה: אילו בניינים בתמונה (מיקום+מצפן+אריחים) → ספירת קומות לכל בניין → איחוד תצפיות לכל בניין
const IL_BASE = 'https://raw.githubusercontent.com/ArielSivkov/codesandbox-template-nuxt/cedaa5b8cbec3a1c1488e30f5241f9b770e3015a/il/tiles/v/';
const ASH_BASE = 'https://raw.githubusercontent.com/ArielSivkov/codesandbox-template-nuxt/twin-world/twin/integration/world/data/tiles/v/';
async function gzJSON(url) { const r = await fetch(url, { cf: { cacheTtl: 86400 } }); if (!r.ok) return null;
  const ds = r.body.pipeThrough(new DecompressionStream('gzip')); return JSON.parse(await new Response(ds).text()); }
async function ashKeys(env) { let k = await env.KV.get('ashkeys'); if (k) return new Set(JSON.parse(k));
  const r = await fetch('https://raw.githubusercontent.com/ArielSivkov/codesandbox-template-nuxt/twin-world/twin/integration/world/data/cities/ashdod/manifest.json'); if (!r.ok) return new Set();
  const m = await r.json(); await env.KV.put('ashkeys', JSON.stringify(m.tiles), { expirationTtl: 86400 }); return new Set(m.tiles); }
async function inView(env, sensors) {
  const pos = sensors && (sensors.pos || sensors.gps), head = sensors && sensors.heading;
  if (!pos || pos.lat == null || head == null) return null;
  const it = wgs84ToItm(pos.lat, pos.lon), cam = { E: it.E - OFFSET[0], N: it.N - OFFSET[1], heading: head, hfov: hfovDeg((sensors.video && sensors.video.width) || 2160, (sensors.video && sensors.video.height) || 3840) };
  const tx = Math.floor(cam.E / 1000), ty = Math.floor(cam.N / 1000), ak = await ashKeys(env), tiles = new Map();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = (tx + dx) + '_' + (ty + dy); const t = await gzJSON((ak.has(k) ? ASH_BASE : IL_BASE) + k + '.json.gz'); if (t) tiles.set(k, t); }
  return { cam: { E: +cam.E.toFixed(1), N: +cam.N.toFixed(1), heading: head, hfov: +cam.hfov.toFixed(1), acc: pos.acc }, buildings: visible(tiles, cam).slice(0, 8) };
}
function viewPrompt(v) {
  if (!v || !v.buildings.length) return '';
  return '\n\nThe map says these buildings should be in the photo, listed left to right with their horizontal position as % of image width:\n' +
    v.buildings.map(b => `- ${b.id}: from ${b.from_pct}% to ${b.to_pct}%, about ${Math.round(b.dist_m)} m away`).join('\n') +
    '\nAdd to the JSON a field "buildings": [{"id":"<id from the list>","floors_counted":<integer or null if you cannot see it>,"roof_visible":true|false,"ground_visible":true|false,"confidence":0..1}]. Count only floors you can actually see; do not guess from the map.';
}
async function fuse(env, photoId, v, parsed) {
  if (!v || !parsed || !Array.isArray(parsed.buildings)) return 0; let n = 0;
  for (const o of parsed.buildings) {
    const ref = v.buildings.find(b => b.id === o.id); const f = parseInt(o.floors_counted, 10);
    if (!ref || !(f >= 1 && f <= 80)) continue;
    const rec = JSON.parse(await env.KV.get('bld:' + o.id) || '{"obs":[]}');
    rec.obs = rec.obs.filter(x => x.photo !== photoId).concat([{ photo: photoId, floors: f, roof: !!o.roof_visible, ground: !!o.ground_visible, conf: Math.max(0, Math.min(1, +o.confidence || 0.5)), dist: ref.dist_m, map_floors: ref.map_floors, t: new Date().toISOString() }]).slice(-30);
    // משקל: גג וקרקע בתמונה, ביטחון המודל, מרחק קצר. סטיית תקן לתצפית: 0.8 קומה אם רואים גג וקרקע, אחרת 2.
    let sw = 0, sx = 0, sxx = 0; for (const x of rec.obs) { const sg = x.roof && x.ground ? 0.8 : 2, w = x.conf / (sg * sg) / (1 + x.dist / 300); sw += w; sx += w * x.floors; sxx += w * x.floors * x.floors; }
    const mean = sx / sw, sd = Math.sqrt(Math.max(0, sxx / sw - mean * mean)), se = Math.sqrt(1 / sw) * Math.sqrt(Math.max(1, rec.obs.length > 1 ? 1 : 1));
    rec.est = { floors: +mean.toFixed(1), sigma_floors: +Math.max(sd / Math.sqrt(rec.obs.length), Math.min(se, 2)).toFixed(2), n: rec.obs.length, height_m: +(mean * 3.0 + 1.0).toFixed(1), height_sigma_m: +(Math.max(sd / Math.sqrt(rec.obs.length), Math.min(se, 2)) * 3.0 + 0.5).toFixed(1), map_floors: ref.map_floors, note: 'גובה = קומות×3 מ\' + 1 מ\' (משוער)' };
    await env.KV.put('bld:' + o.id, JSON.stringify(rec)); n++;
  }
  return n;
}
