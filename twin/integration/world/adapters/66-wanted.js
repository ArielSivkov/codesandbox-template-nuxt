/* 66-wanted.js – מערכת "מבוקש" (0–5 כוכבים), בהשראת earth1926 PoliceWantedSystem.cs. בלי אלימות: רק כוכבים, הודעה קצרה ותג קטן.
 * כמו במקור: עבירה מוסיפה "חום" (heat), 100 חום = כוכב, החום דועך עם הזמן. הבדלים מכוונים:
 *  • כוכבים = עיגול למעלה (כל תאונה מראה לפחות כוכב אחד), לא עיגול למטה כמו במקור (שם תאונה קטנה לא הייתה נראית).
 *  • דעיכה מתחילה 20 ש' אחרי העבירה האחרונה ("לא נראה") – במקור: כשאין ניידות; אצלנו אין ניידות, אז לפי זמן. ברגל דועך פי 2.
 *  • עבירה חוזרת תוך 30 ש' = פי 1.5 (שרשרת). אין ניידות ואין מרדף בשלב הזה.
 * העבירה שכבר קיימת במשחק: תאונה – רכב השחקן פוגע ברכב מעל ~11 קמ"ש (adapters/50-life-lite.js מסמן c.crash = 10). המודול רק מזהה את הסימון; לא משנה קוד קיים.
 * מודולים אחרים יכולים לדווח: YZW.bus.emit('offense', {heat, reason}) או YZWanted.add(heat, reason). ?wanted=0 מכבה.
 */
(function (root) {
  'use strict';
  // ---------------------------------------------------------------- לוגיקה טהורה (נבדקת ב-node: tools/test-mp.js)
  const core = {
    PER_STAR: 100, MAX: 5, COOLDOWN: 20, DECAY: 2.5, FOOT_MULT: 2, CHAIN_WIN: 30, CHAIN_MULT: 1.5,
    create() { return { heat: 0, level: 0, since: 1e9, t: 0, lastOff: -1e9, count: 0 }; },
    levelOf(heat) { return Math.max(0, Math.min(core.MAX, Math.ceil(heat / core.PER_STAR - 1e-9))); },
    crashHeat(kmh) { const k = Number.isFinite(kmh) ? Math.max(11, Math.min(200, kmh)) : 11; return Math.round(60 + k * 0.8); },   // 11 קמ"ש → 69 (כוכב 1), 50 → 100, 100 → 140 (2)
    add(w, amount, reason) {
      if (!(amount > 0)) return { from: w.level, to: w.level };
      if (w.t - w.lastOff < core.CHAIN_WIN) amount *= core.CHAIN_MULT;
      const from = w.level; w.heat = Math.min(w.heat + amount, core.PER_STAR * core.MAX); w.since = 0; w.lastOff = w.t; w.count++; w.reason = reason || '';
      w.level = core.levelOf(w.heat); return { from, to: w.level };
    },
    tick(w, dt, onFoot) {
      w.t += dt; w.since += dt; const from = w.level;
      if (w.heat > 0 && w.since > core.COOLDOWN) { const e = Math.min(dt, w.since - core.COOLDOWN); w.heat = Math.max(0, w.heat - core.DECAY * (onFoot ? core.FOOT_MULT : 1) * e); w.level = core.levelOf(w.heat); }   // רק החלק שאחרי ההמתנה
      return { from, to: w.level };
    },
    stars(n) { return '★'.repeat(n) + '☆'.repeat(core.MAX - n); },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (!root || !root.YZW || typeof location === 'undefined') return;
  if (/[?&]wanted=0\b/.test(location.search)) return;

  const st = core.create(), prev = new WeakMap();
  const WD = { core, st, el: null, level: () => st.level, add: null, offenses: [] };
  root.YZWanted = WD;
  function show(flash) {
    const el = WD.el; if (!el) return;
    if (!st.level) { el.hidden = true; return; }
    el.hidden = false; el.textContent = '🚨 ' + core.stars(st.level); el.setAttribute('aria-label', 'מבוקש: ' + st.level + ' כוכבים');
    if (flash) { el.classList.remove('fl'); void el.offsetWidth; el.classList.add('fl'); }
  }
  function offense(heat, reason) {
    const h0 = st.heat, r = core.add(st, heat, reason); WD.offenses.push({ t: Math.round(st.t * 10) / 10, heat: Math.round(st.heat - h0), reason: reason || '', level: st.level });   // heat = מה שנוסף בפועל (כולל מכפיל שרשרת ותקרה) if (WD.offenses.length > 50) WD.offenses.shift();
    if (r.to > r.from) { try { YZW.notice('🚨 מבוקש: ' + core.stars(r.to) + (reason ? ' (' + reason + ')' : ''), { kind: 'info', ms: 2600 }); } catch (e) { /* */ } }
    show(true); YZW.bus.emit('wanted', { level: st.level, heat: st.heat, reason });
  }
  WD.add = (heat, reason) => offense(+heat || 0, reason);
  YZW.register({
    id: 'wanted', name: 'מבוקש (כוכבים)', dept: 'integration', order: 66,
    init(world, api) {
      const css = document.createElement('style'); css.id = 'yzWantedCss';
      css.textContent = '#yzWanted{position:fixed;left:8px;top:calc(env(safe-area-inset-top) + 206px);z-index:11;font:13px system-ui,sans-serif;letter-spacing:1px;background:rgba(12,20,32,.78);border:1px solid #f2b84b;border-radius:9px;padding:1px 7px;color:#f6cf7f;pointer-events:none}#yzWanted[hidden]{display:none}#yzWanted.fl{animation:yzWfl .45s ease-in-out 3}@keyframes yzWfl{50%{background:#f2b84b;color:#1b0d03}}@media (prefers-reduced-motion:reduce){#yzWanted.fl{animation:none}}';
      document.head.appendChild(css); const el = document.createElement('div'); el.id = 'yzWanted'; el.hidden = true; el.setAttribute('role', 'status'); document.body.appendChild(el); WD.el = el;
      api.on('offense', o => { if (o && o.heat > 0) offense(+o.heat, String(o.reason || '').slice(0, 40)); });
    },
    update(dt, world) {
      // זיהוי תאונה: life-lite מסמן c.crash = 10 ברגע הפגיעה ואז סופר לאחור
      const L = root.YZTraffic, cars = L && L.cars;
      if (cars) for (const c of cars) { const cr = +c.crash || 0, p = prev.get(c) || 0;
        if (cr > 9 && cr > p + 0.5) { const S = world.G27.S, kmh = Math.abs(S.car.v) / 0.25 * 3.6;   // life-lite הכפיל את המהירות ב-−0.25 ברגע הפגיעה
          offense(core.crashHeat(kmh), 'תאונה ' + Math.round(Math.max(11, Math.min(200, kmh))) + ' קמ"ש'); }
        prev.set(c, cr); }
      const m = world.player.mode, r = core.tick(st, dt, m === 'walk' || m === 'jetpack');
      if (r.to !== r.from) { show(false); YZW.bus.emit('wanted', { level: st.level, heat: st.heat }); if (r.to === 0) { try { YZW.notice('✓ כבר לא מבוקש', { kind: 'info', ms: 1800 }); } catch (e) { /* */ } } }
    },
    hudPanels: [{ id: 'wanted', render(el) { if (!st.level && !st.count) return; el.innerHTML = '🚨 מבוקש ' + core.stars(st.level) + ' <small>חום ' + Math.round(st.heat) + ' · עבירות ' + st.count + (st.heat > 0 ? ' · דעיכה ' + (st.since > core.COOLDOWN ? 'פעילה' : 'בעוד ' + Math.ceil(core.COOLDOWN - st.since) + ' ש׳') : '') + '</small>'; } }],
    dispose() { if (WD.el) WD.el.remove(); WD.el = null; const c = document.getElementById('yzWantedCss'); if (c) c.remove(); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
