/* present/story.js — מצב סיפור: רצף צילומים מתוסרט עם כיתובים בעברית, ניגון אוטומטי, הבא/הקודם, קישור לשיתוף.
 * createStory(P, ui) → { shots, go(i), next(), prev(), play(), pause(), stop(), index, playing }
 * ui: { onShot(i, shot, text), onEnd(), onState(playing) }   הכיתובים מחושבים מהנתונים בפועל (ניתוח הצללה, מדדים).
 * הקלטת וידאו מהמסך – מחוץ לתחום (אפשר להקליט עם מקליט המסך של הטלפון). */
(function (root) {
  'use strict';
  const G = root.PGEO;
  const fmt = n => n == null ? '—' : Math.round(n).toLocaleString('he-IL');
  const f1 = n => n == null ? '—' : (+n).toFixed(1).replace(/\.0$/, '');
  const hhmm = h => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
  const AZN = az => ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'][Math.round(((az % 360) + 360) % 360 / 45) % 8];
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function nearestStreet(P, c) {
    let best = null;
    for (const r of P.world.roads) { if (!r.name || r.cls < 2) continue;
      for (let i = 0; i + 1 < r.pts.length; i++) { const a = r.pts[i], b = r.pts[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey; if (L2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ex + (c[1] - a[1]) * ey) / L2)), d = Math.hypot(a[0] + ex * t - c[0], a[1] + ey * t - c[1]);
        if (!best || d < best.d) best = { d, road: r, i, t }; } }
    return best;
  }
  /** מסלול הליכה ~220 מ' לאורך הרחוב הקרוב, בגובה עיניים מעל הקרקע */
  function walkPath(P, c, len = 220) {
    const ns = nearestStreet(P, c); if (!ns) return null;
    const pts = ns.road.pts, cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const s0 = cum[ns.i] + ns.t * (cum[ns.i + 1] - cum[ns.i]), a = Math.max(0, s0 - len / 2), b = Math.min(cum[cum.length - 1], s0 + len / 2);
    const at = s => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const k = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]; };
    const out = []; for (let s = a; s <= b + 1e-6; s += Math.max(5, (b - a) / 24)) { const p = at(s); out.push([p[0], p[1], (P.world.ground(p[0], p[1]) ?? 0) + 1.7]); }
    return { name: ns.road.name, dist: ns.d, pts: out };
  }

  function createStory(P, ui = {}) {
    const st = { index: -1, playing: false, token: 0 };
    const ctx = () => {
      const pr = P.state.proposal, site = P.world.byId.get(P.state.site), m = P.metrics(), an = P.lastAnalysis;
      const c = pr.center, z0 = pr.baseZ, H = pr.height;
      const k = P.camera.aspect > 1.3 ? 1.5 : 1;   // לרוחב: מעט יותר רחוק, כדי שהבניין לא ייחתך מתחת לכותרת
      return { pr, site, m, an, c, z0, H, k, street: nearestStreet(P, c) };
    };
    const winOf = x => {
      const an = x.an; const sc = (P.state.window && P.world.byId.get(P.state.window.building)) ? P.state.window : null;
      if (sc) return sc;
      const worst = an && an.per.find(p => p.lostMaxH > 0);
      const id = worst ? worst.id : (P.world.near(x.c[0], x.c[1], 80).filter(b => b.id !== x.site.id).sort((a, b) => Math.hypot(a.cx - x.c[0], a.cy - x.c[1]) - Math.hypot(b.cx - x.c[0], b.cy - x.c[1]))[0] || {}).id;
      return id ? { building: id, floor: 2 } : null;
    };
    const shots = [
      { id: 'flyin', title: 'המצב הקיים', view: 'before',
        text: x => `אשדוד${x.street ? ', ' + (x.street.d < 120 ? 'ליד ' : 'סמוך ל') + x.street.road.name : ''}. כך נראה המתחם היום – הבניין המסומן בכתום הוא הבניין שמוצע להחלפה.`,
        run: x => P.animate({ to: { pos: [x.c[0] + 170, x.c[1] - 250, x.z0 + 150], target: [x.c[0], x.c[1], x.z0 + 8] }, dur: 4.5 }),
        pre: x => { P.camera.position.copy(P.S(x.c[0] + 900, x.c[1] - 1400, x.z0 + 900)); P.ctl.target.copy(P.S(x.c[0], x.c[1], x.z0)); P.camera.lookAt(P.ctl.target); } },
      { id: 'existing', title: 'הבניין הקיים', view: 'before',
        text: x => `כ-${x.m.existing.floors} קומות (טווח ${x.m.existing.floorsRange[0]}–${x.m.existing.floorsRange[1]}, הערכה מהנתונים), גובה ~${f1(x.m.existing.height)} מ' ±${f1(x.m.existing.sigma)}, תכסית ${fmt(x.m.existing.footprintArea)} מ"ר.`,
        run: x => P.animate({ orbit: { target: [x.c[0], x.c[1], x.z0 + 6], r: 95 * x.k, az0: 210, az1: 250, pitch: 28 }, dur: 6 }) },
      { id: 'reveal', title: 'הפרויקט המוצע', view: 'swipe', swipe: 0,
        text: x => `${x.m.proposal.floors ? x.m.proposal.floors + ' קומות, ' : ''}גובה ${f1(x.m.proposal.height)} מ'${x.m.proposal.grossArea ? `, כ-${fmt(x.m.proposal.grossArea)} מ"ר ברוטו` : ''}${x.m.added ? ` (תוספת של כ-${fmt(x.m.added.gross)} מ"ר)` : ''}. גוררים את הפס כדי להשוות לפני/אחרי.`,
        run: x => P.animate({ to: { pos: [x.c[0] + 95 * x.k, x.c[1] - 150 * x.k, x.z0 + (x.H * 0.75 + 25) * x.k], target: [x.c[0], x.c[1], x.z0 + x.H * 0.45] }, dur: 5.5, onStep: u => P.setView('swipe', Math.min(0.5, u * 0.62)) }) },
      { id: 'orbit', title: 'גובה מול השכנים', view: 'after',
        text: x => `${f1(x.m.proposal.height)} מ' לעומת חציון של ${f1(x.m.neighbors.medianH)} מ' ומקסימום ${f1(x.m.neighbors.maxH)} מ' ב-${x.m.neighbors.count} הבניינים שבטווח ${x.m.neighbors.radius} מ' (גובהי השכנים – הערכה ±${f1(x.m.neighbors.sigmaTypical)} מ').`,
        run: x => P.animate({ orbit: { target: [x.c[0], x.c[1], x.z0 + x.H * 0.45], r: Math.max(110, x.H * 2.6) * x.k, az0: 160, az1: 520, pitch: 24 }, dur: 14 }) },
      { id: 'street', title: 'מבט מהרחוב', view: 'after',
        text: x => { const w = walkPath(P, x.c); return w ? `הליכה לאורך ${w.name}, בגובה עיניים (1.7 מ'), ${Math.round(w.dist)} מ' מהפרויקט.` : 'מבט בגובה הולך רגל.'; },
        run: x => { const w = walkPath(P, x.c); if (!w) return P.animate({ to: { pos: [x.c[0] + 60, x.c[1] - 60, x.z0 + 1.7], target: [x.c[0], x.c[1], x.z0 + x.H * 0.4] }, dur: 5 });
          return P.animate({ to: { pos: w.pts[0], target: [x.c[0], x.c[1], x.z0 + x.H * 0.35] }, dur: 3 }).then(ok => ok && P.animate({ path: { pts: w.pts, look: [x.c[0], x.c[1], x.z0 + x.H * 0.35] }, dur: 11 })); } },
      { id: 'shadow', title: 'הצללה – 21 בדצמבר', view: 'after', fan: true, heat: true,
        pre: () => { const d = P.state.date; if (!P.lastAnalysis || P.lastAnalysis.date !== d) P.analyzeShadows({ date: d }); },
        text: x => { const a = P.lastAnalysis; if (!a) return '';
          const top = a.per.filter(p => p.lostMaxH > 0).slice(0, 1)[0];
          return `${a.date.split('-').reverse().join('.')} בין ${hhmm(a.h0)} ל-${hhmm(a.h1)}: ${a.affected1h} בניינים מאבדים לפחות שעת שמש אחת בנקודה כלשהי בחזית, ${a.roofAffected} – צל נוסף על הגג (דודי שמש).${top ? ` הנפגע ביותר: עד ${f1(top.lostMaxH)} שעות, ${top.dist} מ' מהפרויקט.` : ''} כתום/אדום = יותר שעות צל נוספות.`; },
        run: x => { const d = P.state.date;
          return P.animate({ to: { pos: [x.c[0] + 40, x.c[1] - 260, x.z0 + 230], target: [x.c[0], x.c[1] + 60, x.z0] }, dur: 3.5 })
            .then(ok => ok && P.animate({ orbit: { target: [x.c[0], x.c[1] + 60, x.z0], r: 330, az0: 172, az1: 196, pitch: 42 }, dur: 9, onStep: u => P.setSun(d, 9 + u * 6) })); } },
      { id: 'window', title: 'מבט מחלון של שכן', view: 'swipe', swipe: 0.5,
        text: x => { const w = winOf(x); if (!w) return ''; const v = P.windowView(w); if (!v) return '';
          return `מחלון בקומה ${w.floor} בבניין שכן, פונה ל${AZN(v.facingAz)}: החזית המוצעת במרחק ${f1(v.distance)} מ' ומתנשאת עד ${f1(v.topAngleDeg)}° מעל קו האופק (היום: ${f1(v.existingTopAngleDeg)}°). ימין = היום, שמאל = אחרי.`; },
        run: x => { const w = winOf(x); if (!w) return Promise.resolve(true); const v = P.windowView(w); P.setSun(P.state.date, 12); return P.animate({ to: { pos: v.eye, target: v.target }, dur: 4 }); } },
      { id: 'top', title: 'מבט מהדירה העליונה', view: 'after',
        text: x => `מבט מקומה ${x.m.proposal.floors || 'עליונה'} של הפרויקט מערבה, לכיוון הים (גובה עיניים ${f1(x.z0 + x.H - 1.5)} מ' מעל פני הים). קו החוף וגובהי הבניינים בדרך הם הערכה – אם רואים ים או לא, זו עוד לא מסקנה.`,
        run: x => { const v = P.windowView({ building: 'proposal', floor: x.m.proposal.floors || 1, facing: 270 }); return P.animate({ to: { pos: v.eye, target: v.target }, dur: 4.5 }); } },
      { id: 'summary', title: 'סיכום', view: 'after',
        text: x => `${x.m.proposal.floors || '?'} קומות · ${f1(x.m.proposal.height)} מ' · ${x.m.proposal.grossArea ? fmt(x.m.proposal.grossArea) + ' מ"ר ברוטו' : 'שטח לא ידוע'}${P.lastAnalysis ? ` · ${P.lastAnalysis.affected1h} בניינים עם שעת צל נוספת או יותר (21.12)` : ''}. נתוני השכנים – הערכה; לפני הגשה יש להחליף במדידה.`,
        run: x => P.animate({ to: { pos: [x.c[0] - 220, x.c[1] - 300, x.z0 + 260], target: [x.c[0], x.c[1], x.z0 + 10] }, dur: 5 }) },
    ];

    async function go(i) {
      if (i < 0 || i >= shots.length) { if (i >= shots.length) { st.playing = false; ui.onState && ui.onState(false); ui.onEnd && ui.onEnd(); } return; }
      const tok = ++st.token; P.stopAnim(); st.index = i;
      const sh = shots[i];
      const x = ctx();
      P.setFan(!!sh.fan); P.setHeat(!!sh.heat); P.setFov(sh.id === 'window' || sh.id === 'top' ? 72 : 50);   // מבט מחלון: זווית רחבה כמו עין
      if (!sh.fan && sh.id !== 'shadow') P.setSun(P.state.date, P.state.hour);
      if (sh.pre) sh.pre(x);
      P.setView(sh.view, sh.swipe);
      if (sh.id === 'existing' || sh.id === 'flyin') P.select(P.state.site); else P.select(null);
      let text = ''; try { text = sh.text(ctx()); } catch (e) { console.warn(e); }
      ui.onShot && ui.onShot(i, sh, text);
      const ok = await sh.run(x);
      if (tok !== st.token) return;
      if (st.playing && ok !== false) { await wait(Math.max(2500, text.length * 45)); if (tok === st.token && st.playing) go(i + 1); }
    }
    const api = {
      shots, ctx, walkPath, nearestStreet, go,
      get index() { return st.index; }, get playing() { return st.playing; },
      play(from) { st.playing = true; ui.onState && ui.onState(true); go(from !== undefined ? from : (st.index < 0 || st.index >= shots.length - 1 ? 0 : st.index)); },
      pause() { st.playing = false; st.token++; ui.onState && ui.onState(false); },
      next() { st.playing = false; ui.onState && ui.onState(false); go(Math.min(shots.length - 1, st.index + 1)); },
      prev() { st.playing = false; ui.onState && ui.onState(false); go(Math.max(0, st.index - 1)); },
      stop() { st.playing = false; st.token++; P.stopAnim(); P.setFov(50); st.index = -1; ui.onState && ui.onState(false); },
    };
    return api;
  }
  root.ESHStory = { createStory, walkPath, nearestStreet };
})(typeof self !== 'undefined' ? self : this);
