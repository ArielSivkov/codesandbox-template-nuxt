// 📡 רדאר קוד פתוח — פעם ביום: מה חדש ב-HF וב-GitHub שרלוונטי ל"לוח היזם"
// בלי טוקנים של קלוד: שליפה חינמית + סיכום במודל הענן החינמי (gpt-oss-120b)
const HF_TAGS = ['depth-estimation', 'image-to-3d', 'text-to-3d', 'image-segmentation', 'text-to-speech', 'text-to-audio', 'mask-generation', 'keypoint-detection'];
const GH_TOPICS = ['gaussian-splatting', 'threejs', 'webgpu', '3d-reconstruction', 'photogrammetry', 'procedural-generation', 'openstreetmap', 'game-engine', 'slam'];
const UA = { 'user-agent': 'esh27-radar', accept: 'application/json' };
const day = () => new Date().toISOString().slice(0, 10);

async function hf(tag) {
  const r = await fetch(`https://huggingface.co/api/models?pipeline_tag=${tag}&sort=trendingScore&limit=8`, { headers: UA });
  if (!r.ok) return [];
  return (await r.json()).map(m => ({ src: 'hf', id: m.id || m.modelId, tag, likes: m.likes || 0, dl: m.downloads || 0, url: 'https://huggingface.co/' + (m.id || m.modelId) }));
}
async function gh(topic, since) {
  const q = encodeURIComponent(`topic:${topic} pushed:>${since} stars:>30`);
  const r = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=6`, { headers: UA });
  if (!r.ok) return [];
  return ((await r.json()).items || []).map(x => ({ src: 'gh', id: x.full_name, tag: topic, stars: x.stargazers_count, lic: x.license && x.license.spdx_id, desc: (x.description || '').slice(0, 160), url: x.html_url }));
}

export async function radar(env, model, force) {
  const d = day();
  if (!force && (await env.KV.get('radar:last')) === d) return null;
  if (!force && new Date().getUTCHours() < 1) return null;       // מחכים שהמכסה היומית תתחדש
  await env.KV.put('radar:last', d);
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const all = (await Promise.all([...HF_TAGS.map(hf), ...GH_TOPICS.map(t => gh(t, since))])).flat();
  const seen = new Set(JSON.parse((await env.KV.get('radar:seen')) || '[]'));
  const fresh = all.filter(x => x.id && !seen.has(x.src + ':' + x.id));
  fresh.forEach(x => seen.add(x.src + ':' + x.id));
  await env.KV.put('radar:seen', JSON.stringify([...seen].slice(-4000)));
  const rep = { date: d, scanned: all.length, fresh: fresh.length, summary: '', items: fresh.slice(0, 80) };
  await env.KV.put('radar:latest', JSON.stringify(rep));     // קודם שומרים את הנתונים הגולמיים
  return rep;
}

// סיכום בעברית — רק כשיש מכסה חינמית (לא בזמן השהיה), עד 3 ניסיונות ליום
export async function radarSummary(env, model) {
  const st = JSON.parse((await env.KV.get('status')) || '{}');
  if (st.pause_until && Date.now() < Date.parse(st.pause_until)) return;
  const rep = JSON.parse((await env.KV.get('radar:latest')) || 'null');
  if (!rep || rep.summary || !rep.fresh || (rep.tries || 0) >= 3) return;
  rep.tries = (rep.tries || 0) + 1;
  await env.KV.put('radar:latest', JSON.stringify(rep));
  const prompt = `אתה סורק טכנולוגיה עבור "לוח היזם": תאום תלת-ממדי של ישראל בדפדפן (three.js), סורק טלפון שמודד בניינים, מודלי ענן חינמיים.
מתוך הרשימה, בחר עד 8 פריטים שהכי יקדמו את המשחק (עומק/גובה בניינים, שחזור תלת-ממד, דמויות, קול עברי, ביצועים בדפדפן).
לכל פריט שורה אחת בעברית: אמוג'י, שם, מה זה נותן לנו, רישיון אם ידוע, וציון 1-5. אל תמציא נתונים שלא ברשימה.
${JSON.stringify(rep.items)}`;
  try {
    const out = await env.AI.run(model, { input: prompt, reasoning: { effort: 'low' } });
    rep.summary = out.output_text || (out.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('') || out.response || '';
  } catch (e) { rep.err = String(e.message || e).slice(0, 200); }
  await env.KV.put('radar:latest', JSON.stringify(rep));
  await env.KV.put('radar:' + rep.date, JSON.stringify(rep), { expirationTtl: 60 * 864e5 });
}
