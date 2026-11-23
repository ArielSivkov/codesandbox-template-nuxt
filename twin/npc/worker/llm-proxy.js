/* מחלקת הדמויות · worker/llm-proxy.js — שלד בלבד, לא פרוס. Cloudflare Worker שמחזיר שורת דיאלוג קצרה בעברית לדמות.
   אבטחה: מקור מורשה בלבד, אורך מוגבל, הגבלת קצב לכל IP (בזיכרון – להחליף ב-Rate Limiting binding / Durable Object לפני פריסה),
   בלי לשמור שאלות, בלי נתונים אישיים. הלקוח (dialogue.js → LLMHook) מגביל גם הוא: 4 לדקה, 30 לסשן, זמן קצוב 7 שנ', ונופל לעץ הלא-מקוון.
   עלות (מחירון Workers AI, נבדק 23.11.2026): 10,000 Neurons ביום חינם, אחר כך $0.011 ל-1,000 Neurons.
   @cf/meta/llama-3.1-8b-instruct-fp8: $0.152 למיליון אסימוני קלט, $0.287 למיליון אסימוני פלט.
   תשובה טיפוסית ≈ 400 אסימוני קלט + 80 פלט ≈ $0.00008 → אלף תשובות ≈ 8 סנט. הערה: עברית של מודל 8B בינונית – לבדוק איכות לפני שמפעילים. */
const ROLES = {
  'קבלן ביצוע': 'אתה אבי, קבלן ביצוע באתר בנייה באשדוד. ענה בקצרה, בעברית יומיומית ובנימוס. אל תמסור מחירים מדויקים; הצע לפתוח הצעה בלוח היזם.',
  'דיירת בבניין': 'את רחל, דיירת ותיקה בבניין באשדוד שמתעניינת בהתחדשות עירונית. שאלי ושתפי בחשש ובסקרנות. אל תיתני ייעוץ משפטי; המליצי לבדוק עם עו"ד ועם העירייה.',
  'בעל החנות': 'אתה יוסי, בעל חנות שכונתית באשדוד. ענה בקצרה ובחום.',
  'מצילה': 'את נועה, מצילה בחוף באשדוד. ענייני בטיחות במים בלבד, בקצרה. לעולם אל תעודדי כניסה למים בלי הצלה.',
};
const ALLOWED = ['https://yazam.esh27.com', 'https://esh27.com', 'https://raw.githack.com'];
const hits = new Map();   // זמני – לא משותף בין מופעים
export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const cors = { 'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0], 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'vary': 'origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST' || !ALLOWED.includes(origin)) return new Response('forbidden', { status: 403, headers: cors });
    const ip = req.headers.get('cf-connecting-ip') || 'x', now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60000);
    if (h.length >= 6) return new Response(JSON.stringify({ error: 'rate' }), { status: 429, headers: cors }); h.push(now); hits.set(ip, h);
    let body; try { body = await req.json(); } catch (e) { return new Response('bad json', { status: 400, headers: cors }); }
    const sys = ROLES[body.role]; const q = String(body.q || '').slice(0, 300).trim();
    if (!sys || !q) return new Response('bad request', { status: 400, headers: cors });
    const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', { max_tokens: 120, temperature: 0.6,
      messages: [{ role: 'system', content: sys + ' ענה בשני משפטים לכל היותר. זה משחק; אל תמציא עובדות על אנשים אמיתיים.' }, { role: 'user', content: q }] });
    const answer = String((r && r.response) || '').slice(0, 600);
    return new Response(JSON.stringify({ answer }), { headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, cors) });
  },
};
/* wrangler.toml (דוגמה, לא פרוס):
   name = "esh27-npc-llm"
   main = "worker/llm-proxy.js"
   compatibility_date = "2026-11-01"
   [ai]
   binding = "AI"
*/
