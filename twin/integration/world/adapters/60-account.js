/* חשבון, פרופילים ודמות: כל טלפון מקבל חשבון משלו אוטומטית (בלי הרשמה); אפשר להוסיף לו שם משתמש וסיסמה, או להתחבר לגוגל (כשיוגדר).
 * כפתור 👤 → כניסה/הרשמה (שם משתמש וסיסמה; גוגל כשיוגדר), עד 5 פרופילים לכל משתמש,
 * ועורך דמות (גבר/אישה, תסרוקת, זקן, צבעי עור/שיער/חולצה/מכנסיים/נעליים, גובה) עם תצוגה חיה על הדמות במשחק.
 * שרת: esh27-accounts (Cloudflare Worker + D1). בלי חשבון: הדמות נשמרת בטלפון בלבד (אורח). ?acct=<כתובת> מחליף שרת (לבדיקות).
 */
(function () {
  'use strict';
  // אבטחה (צוות אדום C2): ?acct= מתקבל רק בפיתוח מקומי – אחרת קישור זדוני היה שולח סוד מכשיר וסיסמה לשרת זר
  const ACCT_Q = new URLSearchParams(location.search).get('acct'), LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API = (LOCAL && ACCT_Q && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ACCT_Q)) ? ACCT_Q : 'https://esh27-accounts.ariel-sivkov.workers.dev';
  const HEX = c => (/^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : '#808080');
  const LS = 'w27.acct', DEF = { style: 'real', base: 'm', hairStyle: 'parted', beard: false, skin: '#ffffff', hair: '#3a2a1e', top: '#2f6db5', bottom: '#2b3340', shoes: '#1f1c1a', height: 1.75 };
  const A = { token: null, me: null, active: null, guest: null, google: false, el: null, edit: null };
  const store = { get() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } }, set(o) { try { localStorage.setItem(LS, JSON.stringify(Object.assign(store.get(), o))); } catch (e) { /* */ } } };
  async function call(method, path, body) {
    const r = await fetch(API + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, A.token ? { authorization: 'Bearer ' + A.token } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ error: 'אין תשובה מהשרת' })); if (!r.ok) throw new Error(j.error || ('שגיאה ' + r.status)); return j;
  }
  const profile = () => A.me && A.me.profiles.find(p => p.id === A.active);
  function avatar() { return Object.assign({}, DEF, A.edit || (profile() ? profile().avatar : A.guest) || {}); }
  function apply() { const G = window.G27; if (G && G.applyAvatar) G.applyAvatar(avatar()); }
  function devSecret() { const s = store.get(); if (s.dev && /^[0-9a-f]{64}$/.test(s.dev)) return s.dev;
    const d = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join(''); store.set({ dev: d }); return d; }
  async function deviceLogin() { gotMe(await call('POST', '/api/device', { secret: devSecret(), avatar: A.guest || DEF })); }
  function gotMe(j) { if (j.token) { A.token = j.token; store.set({ token: j.token }); } A.me = { user: j.user, profiles: j.profiles };
    if (!profile()) A.active = j.profiles[0] && j.profiles[0].id; store.set({ active: A.active }); A.edit = null; apply(); render(); }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render() {
    const el = A.el; if (!el || el.hidden) return; let h = '<div class="ac-head"><b>👤 ' + (A.me ? esc(A.me.user.username || A.me.user.email || 'החשבון של הטלפון הזה') : 'אורח') + '</b><button class="ac-x" data-a="close">✕</button></div>';
    if (!A.me) h += '<div class="ac-card"><div class="ac-t">כניסה או הרשמה</div><input id="acU" placeholder="שם משתמש" autocomplete="username"><input id="acP" type="password" placeholder="סיסמה (8+ תווים)" autocomplete="current-password">' +
      '<div class="ac-row"><button data-a="login">כניסה</button><button data-a="signup">הרשמה</button></div>' + (A.google ? '<div id="acG"></div>' : '<div class="ac-m">התחברות עם גוגל – בקרוב</div>') + '<div class="ac-m" id="acMsg"></div></div>';
    else h += '<div class="ac-card"><div class="ac-t">הפרופילים שלי</div><div class="ac-pl">' + A.me.profiles.map(p => '<button class="' + (p.id === A.active ? 'on' : '') + '" data-a="pick" data-id="' + esc(p.id) + '">' + esc(p.name) + '</button>').join('') +
      (A.me.profiles.length < 5 ? '<button data-a="new">➕ חדש</button>' : '') + '</div><div class="ac-row">' + (A.me.user.username ? '<button data-a="logout" class="ghost">יציאה</button>' : '') + (A.me.profiles.length > 1 ? '<button data-a="del" class="ghost">מחק פרופיל</button>' : '') + '</div></div>';
    if (A.me && !A.me.user.username) h += '<div class="ac-card"><div class="ac-t">🔗 להיכנס גם מטלפון או מחשב אחר</div><div class="ac-m">החשבון שמור בטלפון הזה. כדי להגיע אליו ממקום אחר – קבע שם משתמש וסיסמה' + (A.google ? ' או חבר לגוגל' : ' (חיבור לגוגל – בקרוב)') + '.</div>' +
      '<input id="acU" placeholder="שם משתמש" autocomplete="username"><input id="acP" type="password" placeholder="סיסמה (8+ תווים)" autocomplete="new-password"><div class="ac-row"><button data-a="claim">שמור שם וסיסמה</button><button data-a="other" class="ghost">יש לי כבר חשבון</button></div><div class="ac-m" id="acMsg"></div></div>';
    const v = avatar(), col = (k, l) => '<label>' + l + '<input type="color" data-k="' + k + '" value="' + HEX(v[k]) + '"></label>';
    h += '<div class="ac-card"><div class="ac-t">הדמות' + (profile() ? ' – ' + esc(profile().name) : '') + '</div>' + (profile() ? '<input id="acN" value="' + esc(profile().name) + '" maxlength="40">' : '') +
      '<div class="ac-seg">' + [['real', '🧍 מציאותי'], ['toon', '🎨 מצויר']].map(([k, l]) => '<button data-a="set" data-k="style" data-v="' + k + '" class="' + ((v.style || 'real') === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<div class="ac-seg">' + [['m', 'גבר'], ['f', 'אישה']].map(([k, l]) => '<button data-a="set" data-k="base" data-v="' + k + '" class="' + (v.base === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<div class="ac-seg">' + (v.base === 'f' ? [['long', 'ארוך'], ['buns', 'קוקו'], ['none', 'בלי']] : [['parted', 'קלאסי'], ['buzzed', 'קצוץ'], ['none', 'קרחת']]).map(([k, l]) => '<button data-a="set" data-k="hairStyle" data-v="' + k + '" class="' + (v.hairStyle === k ? 'on' : '') + '">' + l + '</button>').join('') +
      (v.base === 'm' ? '<button data-a="set" data-k="beard" data-v="' + (!v.beard) + '" class="' + (v.beard ? 'on' : '') + '">זקן</button>' : '') + '</div>' +
      '<div class="ac-cols">' + col('skin', 'עור') + col('hair', 'שיער') + col('top', 'חולצה') + col('bottom', 'מכנסיים') + col('shoes', 'נעליים') + '</div>' +
      '<label class="ac-h">גובה <b>' + v.height.toFixed(2) + ' מ\'</b><input type="range" min="1.45" max="2.05" step="0.01" data-k="height" value="' + v.height + '"></label>' +
      '<button data-a="save" class="main">💾 שמור</button><div class="ac-m" id="acS"></div></div>';
    el.querySelector('.ac-in').innerHTML = h;
  }
  function msg(id, t) { const e = document.getElementById(id); if (e) e.textContent = t; }
  async function act(a, d) {
    try {
      if (a === 'close') { A.el.hidden = true; if (window.YZCam && A.cam0 != null) { YZCam.view = A.cam0; A.cam0 = null; } return; }
      if (a === 'login' || a === 'signup') { const u = document.getElementById('acU').value, p = document.getElementById('acP').value; msg('acMsg', '…');
        gotMe(await call('POST', '/api/' + a, { username: u, password: p, avatar: a === 'signup' ? (A.guest || DEF) : undefined })); return; }
      if (a === 'claim') { msg('acMsg', '…'); gotMe(await call('POST', '/api/claim', { username: document.getElementById('acU').value, password: document.getElementById('acP').value })); msg('acS', '✓ עכשיו אפשר להיכנס מכל מקום'); return; }
      if (a === 'other') { A.me = null; A.token = null; render(); return; }
      if (a === 'logout') { try { await call('POST', '/api/logout'); } catch (e) { /* */ } A.token = null; A.me = null; store.set({ token: null }); deviceLogin().catch(() => { apply(); render(); }); return; }
      if (a === 'pick') { A.active = d.id; A.edit = null; store.set({ active: A.active }); apply(); render(); return; }
      if (a === 'new') { const n = prompt('שם לפרופיל החדש'); if (!n) return; const j = await call('POST', '/api/profiles', { name: n, avatar: DEF }); A.active = j.profiles[j.profiles.length - 1].id; gotMe(j); return; }
      if (a === 'del') { if (!confirm('למחוק את הפרופיל "' + profile().name + '"?')) return; const id = A.active; A.active = null; gotMe(await call('DELETE', '/api/profiles/' + id)); return; }
      if (a === 'set') { A.edit = Object.assign(avatar(), { [d.k]: d.v === 'true' ? true : d.v === 'false' ? false : d.v }); if (d.k === 'base') A.edit.hairStyle = d.v === 'f' ? 'long' : 'parted'; apply(); render(); return; }
      if (a === 'save') { const av = avatar();
        if (A.me && profile()) { msg('acS', 'שומר…'); const W = window.YZW && YZW.world, pos = W && W.player && W.player.pos ? [Math.round(W.player.pos.x), Math.round(W.player.pos.z)] : null;
          gotMe(await call('PUT', '/api/profiles/' + A.active, { name: (document.getElementById('acN') || {}).value, avatar: av, state: Object.assign({}, profile().state, { pos, saved: Date.now() }) })); msg('acS', '✓ נשמר בחשבון'); }
        else { A.guest = av; store.set({ guest: av }); A.edit = null; msg('acS', '✓ נשמר בטלפון (אורח). הירשם כדי לשמור בחשבון'); } }
    } catch (e) { msg(A.me ? 'acS' : 'acMsg', '⚠️ ' + e.message); }
  }
  function ui() {
    const css = document.createElement('style'); css.textContent = '#yzAcctP{position:fixed;inset:0;z-index:60;background:transparent;display:flex;align-items:flex-end;justify-content:center}#yzAcctP[hidden]{display:none}' +
      '.ac-in{background:#12171b;color:#eef2f4;width:100%;max-width:520px;max-height:52vh;overflow:auto;border-radius:18px 18px 0 0;padding:14px;font:15px system-ui,sans-serif;direction:rtl}' +
      '.ac-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.ac-card{background:#1b2227;border:1px solid #2b343a;border-radius:14px;padding:12px;margin-bottom:10px}.ac-t{font-weight:800;margin-bottom:8px}' +
      '.ac-in input:not([type=color]):not([type=range]){width:100%;box-sizing:border-box;background:#0d1113;color:#fff;border:1px solid #2b343a;border-radius:10px;padding:10px;margin-bottom:8px;font-size:15px}' +
      '.ac-in button{background:#2b343a;color:#fff;border:0;border-radius:10px;padding:9px 12px;font-size:14px;font-weight:700}.ac-in button.on,.ac-in button.main{background:#ff8a3d;color:#1b0d03}.ac-in button.ghost{background:transparent;border:1px solid #39444b}' +
      '.ac-row,.ac-seg,.ac-pl{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.ac-cols{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:8px}.ac-cols label{font-size:12px;color:#a9b4bc;text-align:center}' +
      '.ac-cols input{width:100%;height:38px;border:0;background:none;padding:0}.ac-h{display:block;font-size:13px;color:#a9b4bc;margin-bottom:10px}.ac-h input{width:100%}.ac-m{font-size:13px;color:#a9b4bc;margin-top:6px}.ac-x{background:none!important}';
    document.head.appendChild(css);
    const el = document.createElement('div'); el.id = 'yzAcctP'; el.hidden = true; el.innerHTML = '<div class="ac-in"></div>'; document.body.appendChild(el); A.el = el;
    el.addEventListener('click', e => { if (e.target === el) { act('close'); return; } const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a, b.dataset); });
    el.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; A.edit = Object.assign(avatar(), { [k]: k === 'height' ? +e.target.value : e.target.value }); apply();
      if (k === 'height') { const b = el.querySelector('.ac-h b'); if (b) b.textContent = (+e.target.value).toFixed(2) + " מ'"; } });
    const top = document.getElementById('top');
    if (top && !document.getElementById('yzAcct')) { const b = document.createElement('button'); b.className = 'btn'; b.id = 'yzAcct'; b.textContent = '👤'; b.setAttribute('aria-label', 'חשבון ודמות'); b.onclick = () => { el.hidden = false; if (window.YZCam) { A.cam0 = YZCam.view; YZCam.view = 2; } render(); };   /* מצלמה מלפנים כדי לראות את הדמות בזמן העריכה */ top.appendChild(b); }
  }
  YZW.register({ id: 'account', name: 'חשבון, פרופילים ודמות', dept: 'integration', order: 60, late: true,
    init() {
      ui(); const s = store.get(); A.token = s.token || null; A.active = s.active || null; A.guest = s.guest || null;
      fetch(API + '/api/health').then(r => r.json()).then(j => { A.google = !!j.google; }).catch(() => { /* אין שרת – מצב אורח */ });
      if (A.token) call('GET', '/api/me').then(gotMe).catch(() => { A.token = null; store.set({ token: null }); deviceLogin().catch(() => { /* אין שרת – אורח */ }); });
      else deviceLogin().catch(() => { /* אין שרת – מצב אורח בטלפון */ });
      let tries = 0; const iv = setInterval(() => { tries++; const G = window.G27; if (G && G.applyAvatar && G.applyAvatar(avatar())) clearInterval(iv); else if (tries > 120) clearInterval(iv); }, 500);
    },
    update() {}, dispose() { if (A.el) A.el.remove(); const b = document.getElementById('yzAcct'); if (b) b.remove(); } });
  window.YZAcct = A;
})();
