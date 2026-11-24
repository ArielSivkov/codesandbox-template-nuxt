/* מחלקת הדמויות · npc.js — חיבור: עולם (W27) + סימולציה (life) + המון (crowd) + שיח (dialogue) + ממשק הקשה לדיבור.
   שימוש:  const npc = await NPC.create({ scene, camera, renderer, W: window.W27, assets, vendor, data, player: () => ({x,z,vx,vz,mode,speed}), clock: () => Date, weather: () => ({rain}) });
           בכל פריים: npc.update(dt)    ·    הקשה: npc.tap(clientX, clientY) → true אם נתפסה */
(function () {
'use strict';
const T = window.THREE, L = window.NPCLife, D = window.NPCDialogue;
const NPC = window.NPC = {};
const YAZAM = 'https://yazam.esh27.com/#pre=';
const fmt = n => Number(n).toLocaleString('he-IL', { maximumFractionDigits: 0 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** קישור הצעה ללוח היזם – אותו פורמט #pre כמו במשחק (game.js preLink), עם בסיס שמציין שהגיע מדמות */
NPC.preLink = function (W, b, who) {
  const P = b.per, Hb = Math.max(3, b.h), gross = P * Hb, net = gross * 0.8, roof = b.area;
  const st = W.nearestStreet ? W.nearestStreet(b.cx, b.cz, 250) : '';
  const basis = `מעטפת בניין מתוך 27wrld (${who}): היקף ${fmt(P)} מ', גובה ${Hb.toFixed(1)} מ' (${b.floors} קומות, ${b.conf >= 2 ? 'משוער' : 'מקור ' + b.src}), חזיתות ${fmt(gross)} מ"ר ברוטו / ${fmt(net)} מ"ר נטו, גג ${fmt(roof)} מ"ר. כמויות משוערות – לאימות במדידה. מזהה OSM ${b.id}.`;
  const pre = { lines: [{ id: 'P001', qty: 1 }, { id: 'P002', qty: Math.round(gross) }, { id: 'P037', qty: Math.round(net) }, { id: 'P031', qty: Math.round(roof) }, { id: 'P035', qty: 1 }, { id: 'P088', qty: 1 }], basis, hint: st };
  return YAZAM + encodeURIComponent(JSON.stringify(pre));
};

// ---------- מתאם עולם: W27 → ממשק הסימולציה
function worldAdapter(W) {
  const buildings = [], roads = [];
  for (const t of W.tiles.values()) { if (t.blds) for (const b of t.blds) buildings.push(b); if (t.roads) for (const r of t.roads) roads.push(r); }
  return {
    buildings, roads, H: W.H, isSea: W.isSea,
    blocked: (x, z) => !!W.buildingAt(x, z),
    // צוות תנועה: נקודת יציאה מבניין (השפה הקרובה + 0.6 מ'), ועל הכביש עצמו (לא על המדרכה)
    exitPoint: (x, z) => { const b = W.buildingAt(x, z); if (!b || !W.edgeDist) return null; const e = W.edgeDist(b, x, z), dx = e.px - x, dz = e.pz - z, d = Math.hypot(dx, dz) || 1; return { x: e.px + dx / d * 0.6, z: e.pz + dz / d * 0.6 }; },
    onRoadway: (x, z) => { const E = x + W.OX, N = W.OY - z, t = W.tiles.get(Math.floor(E / 1000) + '_' + Math.floor(N / 1000)); if (!t || !t.roads) return false;
      // רשת מקטעים לכל אריח (20 מ'), נבנית פעם אחת — בדיקה זולה גם בתכנון מסלול
      if (!t._rg || t._rgN !== t.roads.length) { const g = t._rg = new Map(); t._rgN = t.roads.length;
        for (const r of t.roads) { const p = r.p; for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3], m = r.w / 2 + 1;
          for (let cx = Math.floor((Math.min(ax, bx) - m) / 20); cx <= Math.floor((Math.max(ax, bx) + m) / 20); cx++) for (let cz = Math.floor((Math.min(az, bz) - m) / 20); cz <= Math.floor((Math.max(az, bz) + m) / 20); cz++) {
            const k = cx * 7919 + cz; let a = g.get(k); if (!a) g.set(k, a = []); a.push(ax, az, bx, bz, r.w); } } } }
      const a = t._rg.get(Math.floor(x / 20) * 7919 + Math.floor(z / 20)); if (!a) return false;
      for (let i = 0; i < a.length; i += 5) { const ax = a[i], az = a[i + 1], dx = a[i + 2] - ax, dz = a[i + 3] - az, hw = a[i + 4] / 2 - 0.2, l2 = dx * dx + dz * dz || 1e-9;
        let s = ((x - ax) * dx + (z - az) * dz) / l2; s = s < 0 ? 0 : s > 1 ? 1 : s; const qx = ax + dx * s - x, qz = az + dz * s - z; if (qx * qx + qz * qz < hw * hw) return true; } return false; },
    nearBuilding: (x, z, r) => { const a = W.near(x, z, r); for (const b of a) { if (W.pip(b, x, z) || W.edgeDist(b, x, z).d < r) return true; } return false; },
    nearRoad: null,
    // נמל (מקורב): בניין תעשייה גדול שיש ים עד 700 מ' ממערב לו
    isPort: b => b.area > 1500 && (W.isSea(b.cx - 400, b.cz) || W.isSea(b.cx - 700, b.cz)),
  };
}

NPC.create = async function (o) {
  o = Object.assign({ maxAgents: /Android|iPhone|Mobi/i.test(navigator.userAgent) ? 700 : 1100, radius: 300, timeScale: 1 }, o);
  const W = o.W;
  const crowd = await NPCCrowd.create({ scene: o.scene, assets: o.assets, vendor: o.vendor, maxNear: o.maxNear || 80, maxFar: o.maxFar || 400 });
  const data = o.dialogues || await (await fetch(o.data)).json();
  const trees = {}; for (const t of data.trees) { const v = D.validate(t); if (!v.ok) console.warn('dialogue', t.id, v.errors); trees[t.id] = t; }
  const npc = { crowd, sim: null, trees, data, named: {}, llm: D.LLMHook(o.llm || {}), o, ui: null, talking: null, stats: {} };
  let world = null, center = null;

  // ---------- אוכלוסייה סביב נקודה (בנייה מחדש כשמתרחקים 450 מ')
  // צוות תנועה וטעינה: הגרף נבנה מחדש רק כשסט האריחים עם כבישים השתנה (חוסך ~22 מ"ש ×6 בכל אכלוס מחדש),
  // והאכלוס מחדש תוך כדי משחק מתפצל לשני פריימים (בנייה / "התיישבות") — במקום עצירה אחת ארוכה.
  let gCache = null;
  const roadsKey = () => { const a = []; for (const t of W.tiles.values()) if (t.roads && t.roads.length) a.push(t.key + ':' + t.roads.length); return a.sort().join(';'); };
  function buildSim(x, z) {
    const wd = worldAdapter(W); if (o.crossWait) wd.crossWait = o.crossWait;
    const key = roadsKey(); if (!gCache || gCache.key !== key) gCache = { key, g: L.buildGraph(wd.roads) };
    const g = gCache.g;
    wd.nearRoad = (px, pz, r) => !!W.onRoad(px, pz) || (r > 20 && L.nearestNode(g, px, pz, r) >= 0);
    const sp = L.findSpots(wd, x, z, Math.min(o.radius + 200, 900), 26);
    wd.openSpots = sp.open; wd.beachSpots = sp.beach.length ? sp.beach : L.findBeach(wd, x, z, 1200, 30);
    const sim = L.createSim(wd, { maxAgents: o.maxAgents, center: { x, z }, radius: o.radius, seed: 27 });
    sim.graph = g; sim.populate(); if (npc._weather) sim.setWeather(npc._weather);
    return { wd, g, sim, sp, x, z };
  }
  function finishSim(j) {
    j.sim.settle(npc.clock()); world = j.wd; center = { x: j.x, z: j.z }; npc.sim = j.sim; npc.graph = j.g; placeNamed(j.x, j.z);
    return { agents: j.sim.agents.length, nodes: j.g.n, open: j.sp.open.length, beach: j.sp.beach.length, buildings: j.wd.buildings.length };
  }
  npc.spawnAround = function (x, z) { npc._job = null; return finishSim(buildSim(x, z)); };

  // ---------- דמויות בעלות שם
  function nearestTyped(re, x, z, maxD) { let best = null, bd = (maxD || 4000) ** 2; for (const b of world.buildings) { if (!re.test(b.type)) continue; const d = (b.cx - x) ** 2 + (b.cz - z) ** 2; if (d < bd) { bd = d; best = b; } } return best; }
  function standAt(b, out) { const d = npc.sim.door(b, null); return d ? { x: d.x + (d.nx || 0) * (out || 1.5), z: d.z + (d.nz || 0) * (out || 1.5), h: Math.atan2(d.nx || 0, d.nz || 1) } : { x: b.cx, z: b.cz, h: 0 }; }
  const dayOK = (c, from, to) => c.min >= from && c.min <= to;
  function placeNamed(x, z) {
    const sim = npc.sim; sim.named.length = 0; npc.named = {};
    const add = (key, spec) => { const n = sim.addNamed(Object.assign({ key }, spec)); npc.named[key] = n; return n; };
    const site = nearestTyped(/^construction$/, x, z, 5000);
    if (site) { const p = standAt(site, 2.2); add('contractor', { x: p.x, z: p.z, heading: p.h, building: site, tree: 'contractor', sex: 'm', persona: 'builder', anim: 'arms', baseAnim: 'arms', greetAnim: 'idle',
      look: { hardhat: true, vest: true, height: 1.8, top: [0.95, 0.95, 0.93], bottom: [0.2, 0.28, 0.45], longBottom: true },
      presence: c => { const dt = L.dayType(c); return (dt === 'weekday' && dayOK(c, 400, 1020)) || (dt === 'friday' && dayOK(c, 400, 750)); } }); }
    const apt = nearestTyped(/^(apartments|residential)$/, x, z, 5000);
    if (apt) { const p = standAt(apt, 1.6); add('resident', { x: p.x, z: p.z, heading: p.h, building: apt, tree: 'resident', sex: 'f', persona: 'retiree', anim: 'idle', baseAnim: 'idle',
      look: { hair: [0.7, 0.69, 0.66], top: [0.32, 0.42, 0.6], dress: true, height: 1.6, scarf: false, sunhat: false },
      presence: c => dayOK(c, 420, 1260) }); }
    const shop = nearestTyped(/^(retail|commercial)$/, x, z, 5000);
    if (shop) { const p = standAt(shop, 1.4); add('shop', { x: p.x, z: p.z, heading: p.h, building: shop, tree: 'shop', sex: 'm', persona: 'worker', anim: 'arms', baseAnim: 'arms', greetAnim: 'idle',
      look: { kippa: true, cap: false, top: [0.92, 0.86, 0.72], bottom: [0.12, 0.14, 0.2], height: 1.74, beard: true },
      presence: c => { const dt = L.dayType(c); return (dt === 'weekday' && dayOK(c, 480, 1200)) || (dt === 'friday' && dayOK(c, 480, 840)) || (dt === 'motzash' && dayOK(c, c.sunset + 90, c.sunset + 210)); } }); }
    let bp = null, bd = 1e18; for (const s of world.beachSpots) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; bp = s; } }
    if (bp) add('lifeguard', { x: bp.x + 4, z: bp.z, heading: -Math.PI / 2, tree: 'lifeguard', sex: 'f', persona: 'young', anim: 'arms', baseAnim: 'arms', greetAnim: 'idle',
      look: { top: [0.85, 0.12, 0.1], bottom: [0.85, 0.12, 0.1], longBottom: false, longSleeve: false, sunhat: true, scarf: false, height: 1.7 },
      presence: c => c.min > c.sunrise + 60 && c.min < c.sunset - 30 });
  }

  // ---------- שעון ומזג אוויר
  npc.center = () => center;
  npc.clock = () => L.clock(o.clock ? o.clock() : new Date());
  npc.density = () => L.density(npc.clock(), npc.sim ? npc.sim.weather : { rain: 0 });
  npc.isShabbat = () => L.shabbat(npc.clock()).active;
  npc.warmup = function (minutes, step) {
    // הרצה מהירה כדי שהעיר "חיה" כבר בפתיחה (כל הסוכנים במצב רחוק = מעקב מסלול מדויק)
    step = step || 4; const sim = npc.sim, now = o.clock ? o.clock() : new Date(), t0 = performance.now(); const keep = sim.opts.tier0R, keep1 = sim.opts.tier1R;
    sim.settle(L.clock(new Date(now.getTime() - minutes * 60000)));   // מתחילים ממצב מיושב בתחילת החלון
    const pm = sim.opts.pathMs; sim.opts.pathMs = 40; sim.opts.pathsPerFrame = 200;
    sim.opts.tier0R = 0; sim.opts.tier1R = 0; sim.setPlayer({ x: 1e7, z: 1e7, speed: 0, mode: 'foot', vx: 0, vz: 0 });
    for (let s = minutes * 60; s > 0; s -= step) { const c = L.clock(new Date(now.getTime() - s * 1000)); sim.update(step, c); }
    sim.opts.tier0R = keep; sim.opts.tier1R = keep1; sim.opts.pathMs = pm; sim.opts.pathsPerFrame = 6; return performance.now() - t0;
  };

  // ---------- עדכון לפריים
  const ndc = new T.Vector3();
  npc.update = function (dt) {
    const sim = npc.sim; if (!sim) return;
    const p = o.player(); sim.setPlayer(p);
    if (o.weather) { const w = o.weather(); npc._weather = w; if ((w.rain > 0.2) !== (sim.weather.rain > 0.2)) sim.setWeather(w); }
    if (npc._job) { const j = npc._job; npc._job = null; finishSim(j); }   // פריים 2: התיישבות והחלפה
    else if (center && Math.hypot(p.x - center.x, p.z - center.z) > 200 && W.pending && W.pending() === 0) npc._job = buildSim(p.x, p.z);   // פריים 1: בנייה
    sim.update(dt * o.timeScale, npc.clock());
    npc.draw(dt);
  };
  /** רק הכנת ההמון לציור (בלי צעד סימולציה) */
  npc.draw = function (dt) {
    const sim = npc.sim; if (!sim) return;
    crowd.begin();
    for (const a of sim.agents) {
      if (a.state === 'inside' || a.state === 'stay-done' && !a.path) continue;
      if (a.d2 > 360 * 360) continue;
      // גובה קרקע: דוגמים מחדש רק אחרי תזוזה של 1.5 מ' (W.H יוצר מחרוזת מפתח לכל קריאה)
      const mx = a.x - (a._hx || 1e9), mz = a.z - (a._hz || 1e9); if (mx * mx + mz * mz > 2.25) { a.y = W.H(a.x, a.z); a._hx = a.x; a._hz = a.z; }
      crowd.push(a);
    }
    for (const n of sim.named) { if (!n.present) continue; if (n.y == null) n.y = W.H(n.x, n.z); crowd.push(n); }
    if (o.extra) for (const e of o.extra()) crowd.push(e);
    crowd.end(o.camera, dt);
    crowd.setLight(o.light ? o.light() : 1);
    if (npc.ui) npc.ui.frame();
    npc.stats = { agents: sim.agents.length, outdoor: sim.stats.outdoor, near: crowd.stats.near, far: crowd.stats.far, crowdDraws: crowd.stats.drawCalls, simMs: +sim.stats.ms.toFixed(3), tiers: [sim.stats.t0, sim.stats.t1, sim.stats.t2], groups: sim.stats.groups, dayType: L.dayType(sim.clock) };
  };

  // ---------- הקשה: מוצאים דמות קרובה על המסך
  npc.pick = function (cx, cy, maxPx) {
    maxPx = maxPx || 38; const cam = o.camera, el = o.renderer.domElement, r = el.getBoundingClientRect();
    let best = null, bd = maxPx * maxPx;
    const test = (a) => { const h = (a.look && a.look.height) || 1.7; for (const k of [0.55, 0.9]) { ndc.set(a.x, (a.y || 0) + h * k, a.z).project(cam); if (ndc.z > 1) return;
      const sx = r.left + (ndc.x + 1) / 2 * r.width, sy = r.top + (1 - ndc.y) / 2 * r.height, d = (sx - cx) ** 2 + (sy - cy) ** 2; const w = a.named ? 0.45 : 1; if (d * w < bd) { bd = d * w; best = a; } } };
    for (const n of npc.sim.named) if (n.present && n.d2 < 60 * 60) test(n);
    for (const a of crowd.drawn || []) if (a._cd2 < 45 * 45 && !a.named) test(a);
    return best;
  };
  npc.tap = function (cx, cy) {
    const a = npc.pick(cx, cy); if (!a) return false;
    if (a.named) npc.talk(a.key); else npc.ambientLine(a);
    return true;
  };
  npc.ctx = function (a) {
    const c = npc.clock(), sh = L.shabbat(c);
    const street = (W.nearestStreet && W.nearestStreet(a.x, a.z, 250)) || 'הרחוב';
    return { greet: D.greeting(c, sh.active ? 'shabbat' : sh.phase), street, name: a.name || '', flags: { shabbat: sh.active, rain: npc.sim.weather.rain > 0.2, evening: c.min > 17 * 60, llm: npc.llm.enabled(), summer: c.doy > 120 && c.doy < 290 } };
  };
  npc.ambientLine = function (a) {
    const ctx = npc.ctx(a), A = data.ambient; let pool = A.default;
    if (a.child) pool = A.kid; else if (ctx.flags.shabbat) pool = A.shabbat; else if (ctx.flags.rain) pool = A.rain; else if (ctx.flags.evening) pool = A.evening;
    const line = D.fill(pool[(a.seed >>> 4) % pool.length], ctx);
    a.lookAt = (npc.sim.t || 0) + 3; const p = o.player(); a.heading = Math.atan2(p.x - a.x, p.z - a.z);
    if (npc.ui) npc.ui.bubble(a, line);
    return line;
  };
  npc.talk = function (key) {
    const n = npc.named[key]; if (!n || !n.present) return null;
    const tree = trees[n.tree]; const ctx = npc.ctx(n); const run = D.Runner(tree, ctx);
    npc.talking = { n, run, tree }; n.talking = true; n.name = tree.npc.name;
    if (npc.ui) npc.ui.open(npc.talking);
    return run;
  };
  npc.action = function (act, n) {
    if (!act) return null;
    if (act.type === 'pre') { const b = n.building || (act.target === 'site' ? npc.named.contractor && npc.named.contractor.building : null); if (!b) return null;
      const url = NPC.preLink(W, b, (trees[n.tree].npc.name + ', ' + trees[n.tree].npc.role)); if (o.openLink) o.openLink(url); else window.open(url, '_blank', 'noopener'); return url; }
    if (act.type === 'link' && act.url) { window.open(act.url, '_blank', 'noopener'); return act.url; }
    return null;
  };
  npc.endTalk = function () { if (npc.talking) npc.talking.n.talking = false; npc.talking = null; };
  if (o.ui !== false) npc.ui = NPC.makeUI(npc, o);
  return npc;
};

// ---------- ממשק: תגיות שם, בועות, חלון שיח (עברית, מימין לשמאל)
NPC.makeUI = function (npc, o) {
  const css = document.createElement('style');
  css.textContent = `.npcTag{position:fixed;z-index:8;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;background:rgba(12,20,32,.85);color:#fff;border:1px solid #f2b84b;border-radius:10px;padding:2px 8px;font:600 12px system-ui,"Noto Sans Hebrew",sans-serif;white-space:nowrap;direction:rtl}
.npcTag i{font-style:normal;color:#f2b84b}
.npcBub{position:fixed;z-index:8;transform:translate(-50%,-100%);pointer-events:none;background:#fff;color:#111;border-radius:12px;padding:4px 10px;font:13px system-ui,"Noto Sans Hebrew",sans-serif;max-width:220px;direction:rtl;box-shadow:0 2px 8px #0005}
.npcBub:after{content:"";position:absolute;bottom:-6px;left:50%;margin-left:-6px;border:6px solid transparent;border-top-color:#fff;border-bottom:0}
#npcDlg{position:fixed;z-index:25;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom) + 8px);max-width:460px;margin:0 auto;background:rgba(12,20,32,.94);border:1px solid #f2b84b;border-radius:16px;padding:10px 12px 12px;color:#eef3f8;font:14px/1.45 system-ui,"Noto Sans Hebrew",sans-serif;direction:rtl;display:none;box-shadow:0 10px 30px #000a;max-height:62vh;overflow:auto}
#npcDlg .who{display:flex;gap:8px;align-items:center;margin-bottom:6px}#npcDlg .who b{font-size:15px;color:#f2b84b}#npcDlg .who span{color:#a3b3c5;font-size:12px}#npcDlg .x{margin-inline-start:auto;background:none;border:0;color:#a3b3c5;font-size:18px;cursor:pointer}
#npcDlg .say{margin:2px 0 10px}#npcDlg .opts{display:flex;flex-direction:column;gap:6px}
#npcDlg button.o{font:inherit;text-align:right;background:#ffffff12;color:#fff;border:1px solid #ffffff24;border-radius:10px;padding:7px 10px;cursor:pointer;min-height:38px}#npcDlg button.o.act{border-color:#f2b84b;color:#f6cf7f}
#npcDlg .note{font-size:11px;color:#a3b3c5;margin-top:6px}#npcDlg input{font:inherit;width:100%;padding:6px 8px;border-radius:8px;border:1px solid #ffffff30;background:#0006;color:#fff;margin-top:4px}
@media (max-height:420px){#npcDlg{max-height:80vh;max-width:420px;margin-inline-end:8px;margin-inline-start:auto;bottom:6px}}`;
  document.head.appendChild(css);
  const tags = {}, bubs = [];
  const dlg = document.createElement('div'); dlg.id = 'npcDlg'; document.body.appendChild(dlg);
  const v = new T.Vector3();
  function screen(a, k) { const h = (a.look && a.look.height) || 1.7; v.set(a.x, (a.y || 0) + h * (k || 1.12), a.z).project(o.camera); if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null; const r = o.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }
  const ui = {
    frame() {
      const sim = npc.sim; if (!sim) return;
      for (const n of sim.named) {
        let el = tags[n.key];
        if (!el) { el = tags[n.key] = document.createElement('div'); el.className = 'npcTag'; const t = npc.trees[n.tree].npc; el.innerHTML = `<i>💬</i> ${esc(t.name)} · ${esc(t.role)}`; el.onclick = () => npc.talk(n.key); document.body.appendChild(el); }
        const s = n.present && n.d2 < 55 * 55 && !n.talking ? screen(n, 1.18) : null;
        el.style.display = s ? 'block' : 'none'; if (s) { el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; }
      }
      const now = performance.now();
      for (let i = bubs.length - 1; i >= 0; i--) { const b = bubs[i]; const s = now < b.until ? screen(b.a, 1.15) : null; if (!s) { b.el.remove(); bubs.splice(i, 1); continue; } b.el.style.left = s.x + 'px'; b.el.style.top = s.y + 'px'; }
    },
    bubble(a, text) { const el = document.createElement('div'); el.className = 'npcBub'; el.textContent = text; document.body.appendChild(el); bubs.push({ a, el, until: performance.now() + 2800 }); if (bubs.length > 4) { bubs[0].el.remove(); bubs.shift(); } },
    open(t) { dlg.style.display = 'block'; ui.render(); },
    close() { dlg.style.display = 'none'; npc.endTalk(); },
    render(extra, sayText) {
      const t = npc.talking; if (!t) return; const nd = t.run.node(), meta = t.tree.npc;
      dlg.innerHTML = `<div class="who"><b>${esc(meta.name)}</b><span>${esc(meta.role)}</span><button class="x" aria-label="סגירה">✕</button></div><div class="say">${esc(sayText || nd.text)}</div>${extra || ''}<div class="opts"></div>`;
      dlg.querySelector('.x').onclick = () => ui.close();
      const box = dlg.querySelector('.opts');
      for (const op of nd.options) { const b = document.createElement('button'); b.className = 'o' + (op.action ? ' act' : ''); b.textContent = (op.action && op.action.type === 'pre' ? '🏗️ ' : '') + op.text; box.appendChild(b);
        b.onclick = async () => {
          if (op.action && op.action.type === 'llm') return ui.free();
          const r = t.run.choose(op.i); const url = npc.action(r.action, t.n);
          if (r.end) return ui.close();
          ui.render(url ? `<div class="note">נפתח קישור ללוח היזם (כמויות משוערות).</div>` : '');
        }; }
    },
    free() {
      const t = npc.talking; const meta = t.tree.npc;
      dlg.querySelector('.opts').innerHTML = `<input id="npcQ" maxlength="300" placeholder="מה תרצה לשאול את ${esc(meta.name)}?"><button class="o act" id="npcAsk">שליחה</button><div class="note">שאלה חופשית עוברת למודל שפה בשרת (אם מחובר). בלי חיבור – חוזרים לשיח הרגיל.</div>`;
      dlg.querySelector('#npcAsk').onclick = async () => { const q = dlg.querySelector('#npcQ').value.trim(); if (!q) return;
        const r = await npc.llm.ask({ role: meta.role, name: meta.name }, q, { greet: npc.ctx(t.n).greet });
        ui.render(`<div class="note">${r.ok ? 'תשובה ממודל שפה – לא מקור מוסמך.' : 'מודל השפה לא זמין (' + esc(r.reason) + ') – שיח לא מקוון.'}</div>`, r.ok ? r.text : 'סליחה, לא שמעתי טוב. בוא נמשיך מכאן.'); };
    },
  };
  return ui;
};
})();
