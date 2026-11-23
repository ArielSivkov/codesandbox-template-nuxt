/* מחלקת הדמויות · dialogue.js — שיח כנתונים (עצי JSON), בדיקת תקינות, מריץ, וחיבור אופציונלי למודל שפה.
   ברירת מחדל: לא מקוון לגמרי. מודל השפה רק אם הוגדרה כתובת (endpoint) – ואז עם הגבלת קצב, זמן קצוב, ונפילה חזרה לעץ. */
(function (root, factory) { const D = factory(); if (typeof module === 'object' && module.exports) module.exports = D; else root.NPCDialogue = D; })(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const D = {};

/** בדיקת עץ: כל הצמתים נגישים מההתחלה, אין מבוי סתום (מכל צומת אפשר להגיע לסיום), כל יעד קיים, יש טקסט לכל צומת ולכל אפשרות.
    אפשרויות עם cond נספרות כנגישות (לא מניחים מה התנאי), אבל צומת שכל האפשרויות שלו מותנות – חייב שתהיה לו לפחות אחת בלי תנאי. */
D.validate = function (tree) {
  const errors = [], nodes = tree && tree.nodes || {};
  if (!tree || !tree.id) errors.push('חסר id לעץ');
  if (!nodes[tree.start]) errors.push('צומת ההתחלה חסר: ' + tree.start);
  const ids = Object.keys(nodes);
  for (const id of ids) {
    const n = nodes[id];
    if (!n.text || !String(n.text).trim()) errors.push(`צומת ${id}: בלי טקסט`);
    if (!Array.isArray(n.options) || !n.options.length) { errors.push(`צומת ${id}: בלי אפשרויות (מבוי סתום)`); continue; }
    if (!n.options.some(o => !o.cond)) errors.push(`צומת ${id}: כל האפשרויות מותנות – עלול להיתקע`);
    n.options.forEach((o, i) => {
      if (!o.text || !String(o.text).trim()) errors.push(`צומת ${id} אפשרות ${i}: בלי טקסט`);
      if (o.end) return;
      if (!o.next) errors.push(`צומת ${id} אפשרות ${i}: בלי next ובלי end`);
      else if (!nodes[o.next]) errors.push(`צומת ${id} אפשרות ${i}: יעד לא קיים ${o.next}`);
      if (o.action && !['link', 'pre', 'llm', 'mark'].includes(o.action.type)) errors.push(`צומת ${id} אפשרות ${i}: פעולה לא מוכרת ${o.action.type}`);
    });
  }
  // נגישות מההתחלה
  const seen = new Set(); const st = [tree.start];
  while (st.length) { const id = st.pop(); if (seen.has(id) || !nodes[id]) continue; seen.add(id); for (const o of nodes[id].options || []) if (o.next) st.push(o.next); }
  const unreachable = ids.filter(id => !seen.has(id));
  for (const u of unreachable) errors.push('צומת לא נגיש: ' + u);
  // מבוי סתום: צמתים שאין מהם דרך לסיום (רק דרך אפשרויות לא מותנות או מותנות – כל קשת נחשבת)
  const canEnd = new Set(); let changed = true;
  while (changed) { changed = false; for (const id of ids) { if (canEnd.has(id)) continue; const n = nodes[id]; if ((n.options || []).some(o => o.end || (o.next && canEnd.has(o.next)))) { canEnd.add(id); changed = true; } } }
  const deadEnds = ids.filter(id => !canEnd.has(id));
  for (const d of deadEnds) errors.push('אין דרך לסיים מצומת: ' + d);
  return { ok: errors.length === 0, errors, unreachable, deadEnds, nodes: ids.length };
};

/** מילוי תבניות: {greet} {street} {name} {building} וכו' */
D.fill = (s, ctx) => String(s).replace(/\{(\w+)\}/g, (m, k) => ctx && ctx[k] != null ? ctx[k] : m);
D.greeting = function (clock, shabbatPhase) {
  if (shabbatPhase === 'shabbat') return 'שבת שלום';
  if (shabbatPhase === 'motzash') return 'שבוע טוב';
  const h = clock ? clock.min / 60 : 12;
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : 'ערב טוב';
};
const condOK = (c, ctx) => { if (!c) return true; const neg = c[0] === '!', k = neg ? c.slice(1) : c; const v = !!(ctx && ctx.flags && ctx.flags[k]); return neg ? !v : v; };

/** מריץ שיח: node() → {text, options:[{i,text}]}, choose(i) → {end, action} */
D.Runner = function (tree, ctx) {
  let cur = tree.start; const hist = [];
  const r = {
    tree, ctx,
    node() { const n = tree.nodes[cur]; const opts = n.options.map((o, i) => ({ i, o })).filter(x => condOK(x.o.cond, ctx));
      const text = Array.isArray(n.text) ? n.text[Math.floor((ctx && ctx.rand != null ? ctx.rand : Math.random()) * n.text.length)] : n.text;
      return { id: cur, text: D.fill(text, ctx), options: opts.map(x => ({ i: x.i, text: D.fill(x.o.text, ctx), action: x.o.action || null })) }; },
    choose(i) { const o = tree.nodes[cur].options[i]; if (!o) return { end: true }; hist.push([cur, i]); if (o.end) return { end: true, action: o.action || null }; cur = o.next; return { end: false, action: o.action || null }; },
    history: hist, get current() { return cur; },
  };
  return r;
};

/** חיבור אופציונלי למודל שפה (ממשק בלבד). לא נשלחים נתונים אישיים; רק תפקיד הדמות, הקשר המשחק והשאלה.
    endpoint: לדוגמה Cloudflare Worker (worker/llm-proxy.js) מאחורי הגבלת קצב. */
D.LLMHook = function (cfg) {
  cfg = Object.assign({ endpoint: null, perMinute: 4, perSession: 30, timeoutMs: 7000, maxChars: 300 }, cfg || {});
  let tokens = cfg.perMinute, last = Date.now(), used = 0;
  return {
    enabled: () => !!cfg.endpoint && (typeof navigator === 'undefined' || navigator.onLine !== false),
    remaining: () => Math.max(0, cfg.perSession - used),
    async ask(npc, question, gameCtx) {
      if (!this.enabled()) return { ok: false, reason: 'offline' };
      const now = Date.now(); tokens = Math.min(cfg.perMinute, tokens + (now - last) / 60000 * cfg.perMinute); last = now;
      if (tokens < 1 || used >= cfg.perSession) return { ok: false, reason: 'rate' };
      tokens -= 1; used++;
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null; const to = ac && setTimeout(() => ac.abort(), cfg.timeoutMs);
      try {
        const r = await fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac && ac.signal,
          body: JSON.stringify({ role: npc.role, name: npc.name, q: String(question).slice(0, cfg.maxChars), ctx: gameCtx || {} }) });
        if (!r.ok) return { ok: false, reason: 'http ' + r.status };
        const j = await r.json(); const a = String(j.answer || '').slice(0, 600).trim();
        return a ? { ok: true, text: a } : { ok: false, reason: 'empty' };
      } catch (e) { return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'net' }; }
      finally { if (to) clearTimeout(to); }
    },
  };
};
return D;
});
