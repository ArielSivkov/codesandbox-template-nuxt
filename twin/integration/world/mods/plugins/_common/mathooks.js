/* plugins/_common/mathooks.js — וו חומרים וגאומטריות משותף לתוספים (מחלקת התוספים, ESH27).
 *
 * מטרה: מחלקת השיידרים ("look-pro", swarm/shaders) תוכל להחליף כל חומר/גאומטריה של התוספים בלי לגעת בקוד שלהם.
 * כל תוסף "מספק" (provide) חומר ברירת מחדל לחריץ (slot); מי שרוצה להחליף קורא override(slot, mat) ומקבל פונקציית ביטול.
 * הצרכנים (התוספים) מאזינים ב-on(slot, fn) ומחליפים את החומר בכל המשים שלהם (בלי בנייה מחדש של גאומטריה).
 *
 *   YZMAT.provide(slot, material, meta)   — ברירת מחדל (meta: { owner, attrs:['afl','afc',…], note })
 *   YZMAT.override(slot, matOrFactory)    — factory(defaultMat, meta) → material ; מחזיר restore()
 *   YZMAT.get(slot)                       — החומר הפעיל (override אם יש, אחרת ברירת המחדל)
 *   YZMAT.on(slot, fn)                    — fn(newMat, oldMat) בכל החלפה ; מחזיר ביטול הרשמה
 *   YZMAT.slots()                         — רשימת החריצים + מי מספק + האם הוחלף
 *   YZMAT.geometry.provide/override/get/on — אותו דבר לגאומטריות (למשל procgen.bench ← מודל CC0 של מחלקת הנכסים)
 *
 * בטוח לטעינה כפולה (כל תוסף טוען אותו ב-scripts). אין תלות ב-three.js.
 */
(function () {
  'use strict';
  if (window.YZMAT) return;
  function registry(kind) {
    const S = new Map();   // slot → { def, meta, ovr, subs:Set }
    const rec = slot => { let r = S.get(slot); if (!r) S.set(slot, r = { def: null, meta: {}, ovr: null, subs: new Set() }); return r; };
    const cur = r => r.ovr || r.def;
    const fire = (r, nw, old) => { if (nw === old) return; for (const fn of [...r.subs]) { try { fn(nw, old); } catch (e) { console.warn('[yzmat]', kind, e); } } };
    return {
      provide(slot, obj, meta) { const r = rec(slot), old = cur(r); r.def = obj; r.meta = Object.assign({}, meta || {}); if (!r.ovr) fire(r, obj, old); return obj; },
      override(slot, v) {
        const r = rec(slot), old = cur(r);
        let o = v; if (typeof v === 'function') { o = v(r.def, r.meta); }
        r.ovr = o || null; fire(r, cur(r), old);
        return () => { if (r.ovr !== o) return; const was = cur(r); r.ovr = null; fire(r, cur(r), was); };
      },
      get(slot) { const r = S.get(slot); return r ? cur(r) : null; },
      meta(slot) { const r = S.get(slot); return r ? r.meta : null; },
      on(slot, fn) { const r = rec(slot); r.subs.add(fn); return () => r.subs.delete(fn); },
      withdraw(slot) { const r = S.get(slot); if (!r) return; r.def = null; },
      slots() { return [...S.entries()].map(([k, r]) => ({ slot: k, owner: r.meta.owner || '', overridden: !!r.ovr, has: !!cur(r), note: r.meta.note || '' })); },
    };
  }
  const M = registry('material');
  M.geometry = registry('geometry');
  M.version = '1.0';
  window.YZMAT = M;
})();
