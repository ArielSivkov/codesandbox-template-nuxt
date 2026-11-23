/* ESH27 aviation — ui.js : touch controls (tilt-stick, throttle slider, rudder buttons), keyboard, and the HUD.
 * Style follows twin/game (dark panels, amber accent #f2b84b, RTL Hebrew, numbers LTR). Everything is created inside
 * `root` with the class prefix .av- so it can sit on top of the game's own UI and be removed by destroy().
 * Input conventions (same spirit as the game: joystick bottom-left, buttons bottom-right):
 *   stick: up = nose DOWN (flight-sim standard; set invert:true to flip), right = roll right.
 *   keyboard (jet): W/S or ↑/↓ pitch · A/D or ←/→ roll · Q/R rudder (game's yaw keys) · Shift/Space throttle up ·
 *     Ctrl/C throttle down · B brakes · G gear · V camera · X fly-by-wire on/off
 *   keyboard (ship): same stick keys · Space/Shift main engine · C/Ctrl reverse · Z/X down/up · B boost ·
 *     H dampers · N Newtonian · M time-warp · V camera */
const CSS = `
.av-ui{position:fixed;inset:0;pointer-events:none;z-index:40;font-family:system-ui,-apple-system,"Segoe UI",Arial,"Noto Sans Hebrew",sans-serif;color:#eef3f8;direction:rtl;user-select:none;-webkit-user-select:none}
.av-ui *{box-sizing:border-box}
.av-p{pointer-events:auto;touch-action:none}
.av-stick{position:fixed;left:calc(env(safe-area-inset-left) + 14px);bottom:calc(env(safe-area-inset-bottom) + 14px);width:136px;height:136px;border-radius:50%;background:rgba(255,255,255,.07);border:2px solid rgba(255,255,255,.25)}
.av-stick::before,.av-stick::after{content:"";position:absolute;background:rgba(255,255,255,.15)}.av-stick::before{left:50%;top:12%;bottom:12%;width:1px}.av-stick::after{top:50%;left:12%;right:12%;height:1px}
.av-stick i{position:absolute;left:43px;top:43px;width:50px;height:50px;border-radius:50%;background:rgba(242,184,75,.75);box-shadow:0 2px 8px #0008}
.av-thr{position:fixed;right:calc(env(safe-area-inset-right) + 14px);bottom:calc(env(safe-area-inset-bottom) + 14px);width:54px;height:170px;border-radius:14px;background:rgba(12,20,32,.6);border:2px solid rgba(255,255,255,.25);overflow:hidden}
.av-thr .ab{position:absolute;left:0;right:0;top:0;height:16%;background:linear-gradient(#ff7043,#ffb04b55);opacity:.55;font-size:10px;text-align:center;font-weight:700;direction:ltr;padding-top:2px}
.av-thr .fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(0deg,#5cc8a066,#f2b84b88)}
.av-thr .knob{position:absolute;left:4px;right:4px;height:22px;border-radius:7px;background:#f2b84b;box-shadow:0 2px 6px #000a}
.av-thr .lbl{position:absolute;left:0;right:0;bottom:4px;font-size:11px;text-align:center;font-weight:700;direction:ltr;text-shadow:0 1px 2px #000}
.av-btns{position:fixed;right:calc(env(safe-area-inset-right) + 78px);bottom:calc(env(safe-area-inset-bottom) + 14px);display:grid;grid-template-columns:repeat(3,56px);gap:7px;direction:ltr}
.av-b{height:46px;border-radius:13px;border:2px solid rgba(255,255,255,.28);background:rgba(12,20,32,.62);color:#fff;font:inherit;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-direction:column;line-height:1.05;padding:0}
.av-b span{font-size:17px}.av-b.on{border-color:#f2b84b;color:#f2b84b}.av-b.hold{background:rgba(242,184,75,.5);border-color:#f2b84b}
.av-top{position:fixed;top:calc(env(safe-area-inset-top) + 6px);left:calc(env(safe-area-inset-left) + 8px);display:flex;gap:4px;flex-wrap:wrap;max-width:178px;justify-content:flex-start;direction:rtl}
.av-top .av-b{height:30px;padding:0 7px;font-size:11px;flex-direction:row;gap:3px;width:auto;border-width:1px;border-radius:10px}
.av-hud{position:fixed;inset:0;pointer-events:none}
.av-box{position:fixed;top:50%;transform:translateY(-50%);background:rgba(8,14,22,.55);border:1px solid rgba(92,200,160,.55);border-radius:8px;padding:3px 8px;color:#9ff0c8;font:600 12px ui-monospace,Menlo,monospace;direction:ltr;text-align:center;min-width:74px;text-shadow:0 1px 2px #000}
.av-box b{display:block;font-size:20px;color:#d8fff0}.av-spd{left:170px}.av-alt{right:150px}
.av-hdg{position:fixed;top:calc(env(safe-area-inset-top) + 6px);left:50%;transform:translateX(-50%);width:220px;height:30px;overflow:hidden;border-radius:8px;background:rgba(8,14,22,.5);border:1px solid rgba(92,200,160,.45);direction:ltr}
.av-hdg canvas{display:block}
.av-mid{position:fixed;top:calc(env(safe-area-inset-top) + 40px);left:50%;transform:translateX(-50%);display:flex;gap:10px;font:600 12px ui-monospace,monospace;color:#9ff0c8;direction:ltr;text-shadow:0 1px 2px #000;white-space:nowrap}
.av-warn{position:fixed;top:30%;left:50%;transform:translateX(-50%);font-weight:800;font-size:20px;color:#ff5a4a;text-shadow:0 0 6px #000,0 0 12px #f005;display:none;white-space:nowrap}
.av-warn.blink{animation:avb .5s steps(2) infinite}@keyframes avb{50%{opacity:.25}}
.av-note{position:fixed;left:calc(env(safe-area-inset-left) + 160px);bottom:calc(env(safe-area-inset-bottom) + 3px);font-size:9.5px;color:#a3b3c5;background:rgba(8,14,22,.55);padding:1px 7px;border-radius:7px;white-space:nowrap;max-width:calc(100vw - 440px);overflow:hidden;text-overflow:ellipsis}
.av-bot{position:fixed;left:calc(env(safe-area-inset-left) + 160px);bottom:calc(env(safe-area-inset-bottom) + 21px);display:flex;gap:7px;align-items:center;background:rgba(8,14,22,.55);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:3px 9px;font:600 11px ui-monospace,monospace;direction:ltr;white-space:nowrap;max-width:calc(100vw - 440px);overflow:hidden}
.av-bar{width:56px;height:8px;border-radius:4px;background:#0007;border:1px solid #fff3;overflow:hidden}.av-bar i{display:block;height:100%;background:linear-gradient(90deg,#ff7043,#ffc640)}
.av-layer{position:fixed;left:calc(env(safe-area-inset-left) + 8px);top:calc(env(safe-area-inset-top) + 76px);font-size:10.5px;background:rgba(8,14,22,.6);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:3px 8px;max-width:190px;line-height:1.35;direction:rtl}
.av-layer b{color:#f2b84b}
.av-ladder{position:fixed;inset:0;width:100%;height:100%}
@media (max-height:420px){.av-spd{left:160px}.av-alt{right:142px}.av-thr{height:150px}.av-stick{width:124px;height:124px}.av-stick i{left:37px;top:37px}}`;

function el(tag, cls, parent, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }

export function createControls(root = document.body, opts = {}) {
  if (!document.getElementById('av-css')) { const s = el('style', null, document.head); s.id = 'av-css'; s.textContent = CSS; }
  const ui = el('div', 'av-ui', root), st = { mode: 'jet', invert: !!opts.invert, tilt: false, tilt0: null };
  const I = { stickX: 0, stickY: 0, throttle: 0, thrust: 0, rudder: 0, brake: false, boost: false, strafeY: 0, edges: new Set(), keys: new Set(), look: { dx: 0, dy: 0 } };
  // stick
  const stick = el('div', 'av-stick av-p', ui), knob = el('i', null, stick); let sid = null, sc = null;
  stick.addEventListener('pointerdown', e => { sid = e.pointerId; stick.setPointerCapture(sid); const r = stick.getBoundingClientRect(); sc = { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 * 0.78 }; mv(e); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) mv(e); });
  const end = e => { if (e.pointerId !== sid) return; sid = null; I.stickX = I.stickY = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  function mv(e) { let dx = e.clientX - sc.x, dy = e.clientY - sc.y; const l = Math.hypot(dx, dy); if (l > sc.R) { dx *= sc.R / l; dy *= sc.R / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; I.stickX = dx / sc.R; I.stickY = -dy / sc.R; }
  // throttle slider (0..1.1; top 1/11 = afterburner) — ship: 0..1 main engine
  const thr = el('div', 'av-thr av-p', ui), ab = el('div', 'ab', thr, 'AB'), fill = el('div', 'fill', thr), tk = el('div', 'knob', thr), tl = el('div', 'lbl', thr, '0%'); let tid = null;
  const setT = v => { I.throttle = Math.max(0, Math.min(1.1, v)); draw(); };
  function draw() { const f = I.throttle / 1.1, h = thr.clientHeight || 170; tk.style.bottom = (f * (h - 26) + 2) + 'px'; fill.style.height = (f * 100) + '%'; tl.textContent = st.mode === 'jet' ? (I.throttle > 1.001 ? 'AB' : Math.round(I.throttle * 100) + '%') : Math.round(Math.min(1, I.throttle) * 100) + '%'; }
  const tmv = e => { const r = thr.getBoundingClientRect(); setT((1 - (e.clientY - r.top - 11) / (r.height - 22)) * 1.1); };
  thr.addEventListener('pointerdown', e => { tid = e.pointerId; thr.setPointerCapture(tid); tmv(e); e.preventDefault(); });
  thr.addEventListener('pointermove', e => { if (e.pointerId === tid) tmv(e); });
  thr.addEventListener('pointerup', () => tid = null); thr.addEventListener('pointercancel', () => tid = null);
  // bottom-right buttons (rudder etc.) and top buttons
  const btns = el('div', 'av-btns av-p', ui), top = el('div', 'av-top av-p', ui);
  const hold = (b, on, off) => { b.addEventListener('pointerdown', e => { b.classList.add('hold'); on(); e.preventDefault(); }); const f = () => { b.classList.remove('hold'); off(); }; b.addEventListener('pointerup', f); b.addEventListener('pointercancel', f); b.addEventListener('pointerleave', f); };
  const tap = (b, ev) => b.addEventListener('click', () => I.edges.add(ev));
  const B = {};
  function layout() {
    btns.innerHTML = ''; top.innerHTML = '';
    if (st.mode === 'jet') {
      B.rl = el('button', 'av-b', btns, '<span>◀</span>הגה'); B.br = el('button', 'av-b', btns, '<span>■</span>בלמים'); B.rr = el('button', 'av-b', btns, '<span>▶</span>הגה');
      hold(B.rl, () => I.rudder = -1, () => I.rudder = 0); hold(B.rr, () => I.rudder = 1, () => I.rudder = 0); hold(B.br, () => I.brake = true, () => I.brake = false);
      B.gear = el('button', 'av-b', top, '⚙ גלגלים'); tap(B.gear, 'gear'); B.fbw = el('button', 'av-b on', top, '✈ עזר'); tap(B.fbw, 'fbw');
    } else {
      B.dn = el('button', 'av-b', btns, '<span>▼</span>מטה'); B.bo = el('button', 'av-b', btns, '<span>»</span>האצה'); B.up = el('button', 'av-b', btns, '<span>▲</span>מעלה');
      hold(B.dn, () => I.strafeY = -1, () => I.strafeY = 0); hold(B.up, () => I.strafeY = 1, () => I.strafeY = 0); hold(B.bo, () => I.boost = true, () => I.boost = false);
      B.yl = el('button', 'av-b', btns, '<span>↶</span>סבסוב'); B.rev = el('button', 'av-b', btns, '<span>⏪</span>לאחור'); B.yr = el('button', 'av-b', btns, '<span>↷</span>סבסוב');
      hold(B.yl, () => I.rudder = -1, () => I.rudder = 0); hold(B.yr, () => I.rudder = 1, () => I.rudder = 0); hold(B.rev, () => I.rev = true, () => I.rev = false);
      B.dam = el('button', 'av-b on', top, '🛡 בולמים'); tap(B.dam, 'dampers'); B.newt = el('button', 'av-b', top, '🍎 ניוטון'); tap(B.newt, 'newton'); B.warp = el('button', 'av-b', top, '⏩×1'); tap(B.warp, 'warp');
    }
    B.view = el('button', 'av-b', top, '🎥'); B.view.title = 'מצלמה: מרדף / תא טייס'; tap(B.view, 'view');
    B.tilt = el('button', 'av-b' + (st.tilt ? ' on' : ''), top, '📱'); B.tilt.title = 'הטיית הטלפון כמקל'; B.tilt.addEventListener('click', toggleTilt);
    B.reset = el('button', 'av-b', top, '↺'); tap(B.reset, 'reset');
    draw();
  }
  // device tilt as the stick (optional; calibrates the current pose as neutral)
  function onOri(e) { if (e.beta == null) return; const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let p = e.beta, r = e.gamma; if (ang === 90) { p = -e.gamma; r = e.beta; } else if (ang === -90 || ang === 270) { p = e.gamma; r = -e.beta; }
    if (!st.tilt0) st.tilt0 = { p, r }; st.tiltV = { x: Math.max(-1, Math.min(1, (r - st.tilt0.r) / 25)), y: Math.max(-1, Math.min(1, -(p - st.tilt0.p) / 25)) }; }
  async function toggleTilt() {
    if (!st.tilt) { try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch (e) { /* denied */ }
      st.tilt = true; st.tilt0 = null; addEventListener('deviceorientation', onOri); } else { st.tilt = false; st.tiltV = null; removeEventListener('deviceorientation', onOri); }
    B.tilt.classList.toggle('on', st.tilt);
  }
  // keyboard
  const kd = e => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; I.keys.add(e.code); const m = { KeyG: 'gear', KeyV: 'view', KeyX: st.mode === 'jet' ? 'fbw' : null, KeyH: 'dampers', KeyN: 'newton', KeyM: 'warp', Backspace: 'reset' }[e.code]; if (m) I.edges.add(m); if (/^(Space|Arrow)/.test(e.code)) e.preventDefault(); };
  const ku = e => I.keys.delete(e.code), bl = () => I.keys.clear();
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', bl);
  // drag on the free screen area = look around (camera), released → springs back
  let drag = null; const cv = opts.canvas;
  if (cv) { cv.addEventListener('pointerdown', e => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; }); cv.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) { I.look.dx += e.clientX - drag.x; I.look.dy += e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; } });
    const de = () => { drag = null; }; cv.addEventListener('pointerup', de); cv.addEventListener('pointercancel', de); }
  const ks = { p: 0, r: 0 };
  /** Returns the input object for JetSim.update / ShipSim.update for this frame (keyboard is ramped). */
  function poll(dt) {
    const k = I.keys, kp = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0), kr = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    ks.p += (kp - ks.p) * Math.min(1, dt * (kp ? 3 : 8)); ks.r += (kr - ks.r) * Math.min(1, dt * (kr ? 4 : 10));
    const up = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Space'), dn = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
    if ((up || dn) && st.mode === 'jet') setT(I.throttle + (up ? 1 : -1) * dt * 0.45);
    const tv = st.tiltV || { x: 0, y: 0 };
    const sx = Math.max(-1, Math.min(1, I.stickX + ks.r + tv.x));
    const pitch = Math.max(-1, Math.min(1, (st.invert ? 1 : -1) * (I.stickY + tv.y) + ks.p));   // + = nose up
    const yawK = (k.has('KeyR') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0), e = I.edges;
    const out = { pitch, roll: sx, yaw: Math.max(-1, Math.min(1, I.rudder + yawK)), edges: new Set(e), look: { dx: I.look.dx, dy: I.look.dy } };
    I.look.dx = I.look.dy = 0; e.clear();
    if (st.mode === 'jet') { out.throttle = I.throttle; out.brake = I.brake || k.has('KeyB'); out.gearToggle = out.edges.has('gear'); }
    else { const kb = k.has('KeyB'); out.thrust = I.rev || (dn && !up) ? -1 : Math.max(Math.min(1, I.throttle), up ? 1 : 0); out.boost = I.boost || kb; out.strafeY = I.strafeY + (k.has('KeyX') ? 1 : 0) - (k.has('KeyZ') ? 1 : 0);
      out.toggleDampers = out.edges.has('dampers'); out.toggleNewtonian = out.edges.has('newton'); }
    return out;
  }
  layout();
  return {
    root: ui, poll, buttons: B,
    setMode(m) { st.mode = m; I.throttle = m === 'jet' ? I.throttle : 0; layout(); },
    setThrottle: setT, get throttle() { return I.throttle; },
    sync(state) { if (B.gear) B.gear.classList.toggle('on', !!state.gear); if (B.fbw) B.fbw.classList.toggle('on', !!state.fbw); if (B.dam) B.dam.classList.toggle('on', !!state.dampers); if (B.newt) B.newt.classList.toggle('on', !!state.newtonian); if (B.warp && state.warp) B.warp.innerHTML = '⏩×' + state.warp; if (B.view && state.view) B.view.classList.toggle('on', state.view === 'cockpit'); },
    destroy() { removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', bl); if (st.tilt) removeEventListener('deviceorientation', onOri); ui.remove(); },
  };
}

const f0 = n => Math.round(n).toLocaleString('en-US');
export function createHUD(root = document.body) {
  if (!document.getElementById('av-css')) { const s = el('style', null, document.head); s.id = 'av-css'; s.textContent = CSS; }
  const h = el('div', 'av-ui av-hud', root);
  const ladder = el('canvas', 'av-ladder', h), lc = ladder.getContext('2d'); ladder.dir = 'ltr';
  const spd = el('div', 'av-box av-spd', h), alt = el('div', 'av-box av-alt', h);
  const hdgW = el('div', 'av-hdg', h), hc = el('canvas', null, hdgW); hc.width = 440; hc.height = 60; hc.dir = 'ltr'; hc.style.width = '220px'; hc.style.height = '30px'; const hx = hc.getContext('2d');
  const mid = el('div', 'av-mid', h), warn = el('div', 'av-warn', h), bot = el('div', 'av-bot', h), layer = el('div', 'av-layer', h), note = el('div', 'av-note', h);
  note.textContent = 'פרט עירוני: אשדוד בלבד · מחוץ לה: קו חוף Natural Earth (נחלת הכלל) ותבליט מקורב (לא מודל גבהים) · שמש: NOAA לפי התאריך · מסלול ההמראה בדיוני';
  function heading(deg) { const W = 440, H = 60; hx.clearRect(0, 0, W, H); hx.strokeStyle = '#9ff0c8'; hx.fillStyle = '#d8fff0'; hx.lineWidth = 2; hx.font = '600 22px ui-monospace,monospace'; hx.textAlign = 'center';
    for (let d = Math.floor(deg - 40); d <= deg + 40; d++) { if (d % 5) continue; const x = W / 2 + (d - deg) * 5.5, dd = ((d % 360) + 360) % 360; hx.beginPath(); hx.moveTo(x, H); hx.lineTo(x, H - (d % 10 ? 10 : 18)); hx.stroke();
      if (d % 10 === 0) hx.fillText(dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd / 10).padStart(2, '0'), x, 24); }
    hx.fillStyle = '#f2b84b'; hx.beginPath(); hx.moveTo(W / 2 - 9, 0); hx.lineTo(W / 2 + 9, 0); hx.lineTo(W / 2, 12); hx.fill(); }
  function drawLadder(d, view) { const W = ladder.width = innerWidth * Math.min(devicePixelRatio, 2), H = ladder.height = innerHeight * Math.min(devicePixelRatio, 2); lc.clearRect(0, 0, W, H); lc.direction = 'ltr';
    if (view !== 'cockpit' || d.pitch == null) return; const s = Math.min(devicePixelRatio, 2), cx = W / 2, cy = H / 2, ppd = (H / (d.fov || 60)); lc.save(); lc.translate(cx, cy); lc.rotate(-(d.bank || 0) * Math.PI / 180);
    lc.strokeStyle = 'rgba(120,255,180,.85)'; lc.fillStyle = 'rgba(160,255,200,.9)'; lc.lineWidth = 2 * s; lc.font = `${11 * s}px ui-monospace,monospace`;
    for (let p = -90; p <= 90; p += 10) { const y = (d.pitch - p) * ppd; if (Math.abs(y) > H * 0.42) continue; const w = p === 0 ? W * 0.5 : 70 * s; lc.setLineDash(p < 0 ? [8 * s, 6 * s] : []); lc.beginPath(); lc.moveTo(-w / 2, y); lc.lineTo(-24 * s, y); lc.moveTo(24 * s, y); lc.lineTo(w / 2, y); lc.stroke(); if (p) { lc.fillText(String(p), w / 2 + 6 * s, y + 4 * s); } }
    lc.setLineDash([]); lc.restore();
    if (d.fpm) { const x = cx + d.fpm.x * ppd, y = cy - d.fpm.y * ppd; lc.strokeStyle = 'rgba(120,255,180,.95)'; lc.lineWidth = 2 * s; lc.beginPath(); lc.arc(x, y, 8 * s, 0, 7); lc.moveTo(x - 20 * s, y); lc.lineTo(x - 8 * s, y); lc.moveTo(x + 8 * s, y); lc.lineTo(x + 20 * s, y); lc.moveTo(x, y - 8 * s); lc.lineTo(x, y - 16 * s); lc.stroke(); }
    lc.strokeStyle = 'rgba(242,184,75,.95)'; lc.lineWidth = 2 * s; lc.beginPath(); lc.moveTo(cx - 34 * s, cy); lc.lineTo(cx - 10 * s, cy); lc.lineTo(cx, cy + 8 * s); lc.lineTo(cx + 10 * s, cy); lc.lineTo(cx + 34 * s, cy); lc.stroke(); }
  let frame = 0;
  return {
    root: h,
    /** d: JetSim.hud() or ShipSim.hud() plus {mode, layer, view, fov, fpm} */
    update(d) {
      frame++; heading(d.heading || 0);
      if (d.mode === 'jet') {
        spd.innerHTML = `IAS<b>${f0(d.kt)}</b>kt · ${f0(d.kmh)} km/h`; alt.innerHTML = `ALT<b>${f0(d.alt)}</b>m · ${f0(d.altFt)} ft`;
        mid.innerHTML = `<span>G ${d.g.toFixed(1)}</span><span>α ${d.aoa.toFixed(1)}°</span><span>M ${d.mach.toFixed(2)}</span><span>VS ${f0(d.vs)} m/s</span><span>HDG ${f0(d.heading)}°</span>`;
        bot.innerHTML = `<span>${d.ab ? '<b style="color:#ff8a3a">AB</b>' : 'THR'} ${Math.round(Math.min(1, d.throttle) * 100)}%</span><span class="av-bar"><i style="width:${Math.round(d.fuelFrac * 100)}%"></i></span><span>${f0(d.fuel)} kg</span><span>${d.gear ? 'GEAR ▼' : 'GEAR ▲'}</span>${d.fbw ? '' : '<span style="color:#ff8a65">FBW OFF</span>'}`;
        let w = ''; if (d.crashed) w = '💥 ' + d.crashed + ' — ↺ התחלה'; else if (d.stalled) w = 'הזדקרות! הורד אף'; else if (d.stallWarn) w = 'זווית התקפה גבוהה'; else if (!d.onGround && d.agl < 150 && d.vs < -15) w = 'משוך! קרקע'; else if (!d.onGround && d.agl < 60 && !d.gear && d.kt < 200) w = 'גלגלים!'; else if (d.tailStrike) w = 'פגיעת זנב';
        warn.style.display = w ? 'block' : 'none'; warn.textContent = w; warn.classList.toggle('blink', !!(d.stalled || (d.vs < -15 && d.agl < 150)));
      } else {
        const o = d.orbit; spd.innerHTML = `SPD<b>${d.speed > 2000 ? (d.speed / 1000).toFixed(2) + ' km/s' : f0(d.speed) + ' m/s'}</b>${f0(d.kmh)} km/h`;
        alt.innerHTML = `ALT<b>${d.alt > 100000 ? f0(d.alt / 1000) + ' km' : f0(d.alt) + ' m'}</b>VS ${f0(d.vs)} m/s`;
        mid.innerHTML = `<span>${d.newtonian ? 'NEWTON' : 'ASSIST'}</span><span>Ap ${isFinite(o.apo) ? f0(o.apo / 1000) + ' km' : '∞'}</span><span>Pe ${f0(o.peri / 1000)} km</span><span>v_orb ${(o.vCirc / 1000).toFixed(2)} km/s</span><span>HDG ${f0(d.heading)}°</span>`;
        const hk = d.heatKW; bot.innerHTML = `<span>חום</span><span class="av-bar"><i style="width:${Math.min(100, hk / 20)}%"></i></span><span>${hk > 1 ? f0(hk) + ' kW/m²' : '—'}</span><span>${d.inOrbit ? 'במסלול ✓' : ''}</span>${d.warp > 1 ? `<span>⏩×${d.warp}</span>` : ''}`;
        let w = ''; if (d.crashed) w = '💥 ' + d.crashed; else if (hk > 800) w = 'חימום כניסה לאטמוספרה'; warn.style.display = w ? 'block' : 'none'; warn.textContent = w; warn.classList.toggle('blink', hk > 1500);
      }
      const L = { city: 'עיר: <b>אשדוד</b> (פרט מלא)', israel: '<b>ישראל</b>: קו חוף + תבליט מקורב', globe: '<b>כדור הארץ</b>: Natural Earth 1:50m' }[d.layer] || '';
      layer.innerHTML = `${L}<br>${d.sunText || ''}`;
      drawLadder(d, d.view);
    },
    destroy() { h.remove(); },
  };
}
