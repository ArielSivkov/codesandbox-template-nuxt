// esh27-vision – תור משימות למודלי הענן של אש 27 (Workers AI)
// סוגי משימות: photo (ניתוח תמונה), code (טיוטת קוד), texture (טקסטורה), text (טקסט כללי)
// כל תוצאה נבדקת על ידי קלוד/בדיקות לפני שהיא נכנסת למשחק. דוגמאות שאושרו/נדחו נשמרות ב-ex:<type> ומשמשות כדוגמאות בפרומפט (למידה מדוגמאות).
import { Buffer } from 'node:buffer';
const REPO = 'ArielSivkov/codesandbox-template-nuxt', BR = 'twin-world', PHOTO_DIR = 'twin/data/photos';
const M = {
  vision: '@cf/meta/llama-4-scout-17b-16e-instruct',
  code: '@cf/qwen/qwen2.5-coder-32b-instruct',
  text: '@cf/openai/gpt-oss-120b',
  texture: '@cf/black-forest-labs/flux-1-schnell'
};
const PHOTO_PROMPT = `You analyze a street/landscape photo from Ashdod, Israel, to rebuild it in a 3D game with measured accuracy.
Return ONLY JSON:
{"scene":"","time_of_day":"","sky":{"colors_hex":[],"sun_or_moon":"none|sun|moon","sun_moon_position":"left|center|right + low|mid|high"},
"objects":[{"name":"","count":0,"colors_hex":[],"material":"","pattern":"","distance":"near|mid|far","position":"left|center|right"}],
"reference_objects":[{"name":"floor tile|paving stone|curb|lane marking|door|stair step|car|person|other","why_useful":"known standard size helps measure scale"}],
"ground":{"type":"","colors_hex":[]},"vegetation":[{"type":"","count":0}],"lighting":"","people_visible":0,"vehicles_visible":0,
"buildable_assets":[""],"confidence":0.0}
Do NOT guess heights in meters; heights come from measurement, not from you.`;
const CODE_SYS = `You write browser JavaScript for a three.js game (global THREE, plugin host YZW.register({id,order,init(world),update(dt,world),dispose()})).
world.scene is a THREE.Scene. Coordinates: x east, z south, y up, meters. Output ONLY the complete file content, no markdown fences, no explanations.`;

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 1), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' } });
const now = () => new Date().toISOString();
async function getJ(kv, k, d) { const v = await kv.get(k); return v ? JSON.parse(v) : d; }

async function examples(env, type) {
  const ex = await getJ(env.KV, 'ex:' + type, []);
  return ex.slice(-3).map(e => `Example (${e.verdict}): ${e.note}`).join('\n');
}

async function runPhoto(env, t) {
  let buf;
  if (t.input.kv) { buf = await env.SCAN.get(t.input.kv, 'arrayBuffer'); if (!buf) throw new Error('kv missing'); }
  else { const r = await fetch(t.input.url, { headers: { 'user-agent': 'esh27-vision' } }); if (!r.ok) throw new Error('fetch ' + r.status); buf = await r.arrayBuffer(); }
  if (buf.byteLength > 9e6) throw new Error('too big');
  const uri = 'data:image/jpeg;base64,' + Buffer.from(buf).toString('base64');
  const ex = await examples(env, 'photo');
  const s = await env.AI.run(M.vision, { messages: [{ role: 'user', content: [{ type: 'text', text: PHOTO_PROMPT + (ex ? '\nLessons from review:\n' + ex : '') }, { type: 'image_url', image_url: { url: uri } }] }], max_tokens: 1200 });
  let parsed = null, txt = '';
  if (s.response && typeof s.response === 'object') parsed = s.response;   // לפעמים המודל מחזיר אובייקט מוכן
  else { txt = String(s.response || '').replace(/^```(json)?|```$/gm, '').trim(); try { parsed = JSON.parse(txt); } catch (e) { } }
  return { model: M.vision, parsed, raw: parsed ? undefined : txt };
}
async function runCode(env, t) {
  let ctx = '';
  for (const u of (t.input.context_urls || []).slice(0, 3)) { const r = await fetch(u); if (r.ok) ctx += `\n// ---- ${u.split('/').pop()} ----\n` + (await r.text()).slice(0, 6000); }
  const ex = await examples(env, 'code');
  const out = await env.AI.run(M.code, { messages: [{ role: 'system', content: CODE_SYS + (ex ? '\nLessons from review:\n' + ex : '') }, { role: 'user', content: t.input.spec + (ctx ? '\nReference code:' + ctx : '') }], max_tokens: 3500, temperature: 0.2 });
  return { model: M.code, file: t.input.file, content: (out.response || '').replace(/^```[a-z]*\n?|```\s*$/gm, '') };
}
async function runText(env, t) {
  const out = await env.AI.run(M.text, { input: t.input.prompt, reasoning: { effort: 'low' } });
  const text = out.output_text || (out.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('') || out.response || JSON.stringify(out).slice(0, 4000);
  return { model: M.text, text };
}
async function runTexture(env, t) {
  const out = await env.AI.run(M.texture, { prompt: t.input.prompt, steps: 6 });
  await env.KV.put('img:' + t.id, out.image);   // base64 jpeg
  return { model: M.texture, image_key: 'img:' + t.id };
}
const RUN = { photo: runPhoto, code: runCode, text: runText, texture: runTexture };

async function syncPhotos(env) {   // כל תמונה חדשה בתיקיית הריפו נכנסת לתור אוטומטית
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${PHOTO_DIR}?ref=${BR}`, { headers: { 'user-agent': 'esh27-vision', accept: 'application/vnd.github+json' } });
  if (!r.ok) return 'gh ' + r.status;
  let n = 0;
  for (const f of await r.json()) {
    if (!/\.(jpe?g)$/i.test(f.name)) continue;
    const id = 'photo-' + f.name.replace(/\.[^.]+$/, '') + '-' + f.sha.slice(0, 7);
    if (await env.KV.get('t:' + id)) continue;
    await env.KV.put('t:' + id, JSON.stringify({ id, type: 'photo', status: 'pending', prio: 5, created: now(), input: { name: f.name, url: f.download_url } }));
    n++;
  }
  return n;
}

async function syncScan(env) {   // תמונות מהסורק באתר scan.esh27.com נכנסות לתור לבד
  if (!env.SCAN) return 'no scan';
  let n = 0, cursor;
  do {
    const l = await env.SCAN.list({ prefix: 'img/', cursor }); cursor = l.list_complete ? null : l.cursor;
    for (const k of l.keys) {
      if (!/\.jpe?g$/i.test(k.name)) continue;
      const id = 'scan-' + k.name.slice(4).replace(/[^\w.-]/g, '_');
      if (await env.KV.get('t:' + id)) continue;
      const meta = await env.SCAN.get('meta/' + k.name.slice(4) + '.json');
      await env.KV.put('t:' + id, JSON.stringify({ id, type: 'photo', status: 'pending', prio: 2, created: now(), input: { name: k.name, kv: k.name, sensors: meta ? JSON.parse(meta) : null } }));
      n++;
    }
  } while (cursor && n < 50);
  return n;
}

async function tick(env) {
  const st = await getJ(env.KV, 'status', { runs: 0 });
  st.runs++; st.t = now();
  if (st.runs % 10 === 1) st.sync = await syncPhotos(env);
  if (st.runs % 2 === 0) st.scan = await syncScan(env);
  const list = await env.KV.list({ prefix: 't:' });
  const tasks = [];
  for (const k of list.keys) { const t = await getJ(env.KV, k.name, null); if (t && t.status === 'pending') tasks.push(t); if (tasks.length >= 12) break; }
  tasks.sort((a, b) => (a.prio || 5) - (b.prio || 5));
  let done = 0;
  for (const t of tasks.slice(0, 2)) {
    const t0 = Date.now();
    try { t.result = await RUN[t.type](env, t); t.status = 'done'; }
    catch (e) { t.tries = (t.tries || 0) + 1; t.error = String(e).slice(0, 300); t.status = t.tries >= 3 ? 'failed' : 'pending'; }
    t.ms = Date.now() - t0; t.finished = now();
    await env.KV.put('t:' + t.id, JSON.stringify(t)); done++;
  }
  st.last_done = done;
  await env.KV.put('status', JSON.stringify(st));
}

export default {
  async scheduled(ev, env, ctx) { await tick(env); },
  async fetch(req, env) {   // לקריאה בלבד: מצב התור ותוצאות
    const u = new URL(req.url);
    if (u.pathname === '/status') {
      const list = await env.KV.list({ prefix: 't:' }); const c = {};
      for (const k of list.keys) { const t = await getJ(env.KV, k.name, {}); c[t.status] = (c[t.status] || 0) + 1; }
      return json({ status: await getJ(env.KV, 'status', {}), counts: c });
    }
    if (u.pathname === '/task' && !/^scan-/.test(u.searchParams.get('id') || '')) return json(await getJ(env.KV, 't:' + u.searchParams.get('id'), { error: 'not found' }));
    if (u.pathname === '/img') { const b = await env.KV.get('img:' + u.searchParams.get('id')); return b ? new Response(Buffer.from(b, 'base64'), { headers: { 'content-type': 'image/jpeg' } }) : json({ error: 'not found' }, 404); }
    return json({ name: 'esh27-vision', endpoints: ['/status', '/task?id=', '/img?id='] });
  }
};
