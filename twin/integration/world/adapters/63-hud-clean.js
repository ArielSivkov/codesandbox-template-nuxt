/* 63-hud-clean.js – ממשק נקי (לבקשת אריאל, 23.11.2026)
 * בשורה העליונה נשארים רק: מצב + ⋯ (עוד) + ☰. כל שאר הכפתורים (⭐ ☀ 🔊 🧩 👤 🏠 מצלמה) עוברים למגירת "עוד", עם שם ליד כל אחד.
 * פסי המידע (צמחייה/פנסים/בניינים…) מוסתרים כברירת מחדל – כפתור ℹ במגירה מציג אותם.
 * מונה FPS מוסתר (?fps=1 מציג). תג האיכות ליד השעה מוסתר. סרגל העין הגדולה – שורה אחת.
 * לא נוגע בקוד של מודולים אחרים: רק מזיז את הכפתורים שלהם (המטפלים שלהם נשארים). ?hud=old מבטל הכול.
 */
(function () {
  if (/[?&]hud=old\b/.test(location.search)) return;
  const qs = new URLSearchParams(location.search);
  const KEEP = new Set(['mode', 'bMenu', 'yzMoreB']);
  const NAMES = { bMine: 'הנכסים שלי', bEnv: 'זמן ומזג אוויר', yzSnd: 'קול', yzMods: 'מודולים וביצועים', yzAcct: 'חשבון ודמות', yzHome: 'השכונה שלי', yzCam: 'מבט מצלמה' };

  const st = document.createElement('style'); st.id = 'yzHudCleanCss';
  st.textContent = `
#top{flex-wrap:nowrap!important}
#yzMoreB{font-size:17px;min-width:42px}
#yzMore{position:fixed;z-index:22;top:calc(env(safe-area-inset-top) + 54px);right:8px;width:min(300px,calc(100vw - 150px));display:none;grid-template-columns:1fr 1fr;gap:6px;background:rgba(12,20,32,.95);border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:8px;box-shadow:0 10px 26px #000a}
#yzMore.open{display:grid}
#yzMore .btn{width:100%;display:flex;align-items:center;gap:6px;justify-content:flex-start;min-height:42px;font-size:13px}
#yzMore .btn .lbl{display:inline!important}
#yzMore .btn[data-name]::after{content:attr(data-name);font-size:12px;color:#cfd9e4}
body:not(.yz-info) #yzHUDp{display:none!important}
body.yz-info #yzHUDp{top:calc(env(safe-area-inset-top) + 56px)!important}
#yzBadge span:not(:first-child):not(.sh){display:none}
#yzDevBar{flex-wrap:nowrap!important;overflow-x:auto;justify-content:flex-start!important;scrollbar-width:none;padding-bottom:2px}
#yzDevBar::-webkit-scrollbar{display:none}
#yzDevBar>*{flex:0 0 auto}
#yzDevBar:has(#yzSrch[style*="block"]){flex-wrap:wrap!important}
#yzDevBar #yzSrch{flex:1 1 100%}
#mm{cursor:pointer}
`;
  document.head.appendChild(st);

  const fps = document.getElementById('fps');
  if (fps && qs.get('fps') !== '1') fps.classList.add('hidden');

  function build() {
    const top = document.getElementById('top'); if (!top) return false;
    let more = document.getElementById('yzMore');
    if (!more) {
      more = document.createElement('div'); more.id = 'yzMore'; more.setAttribute('role', 'menu'); document.body.appendChild(more);
      const b = document.createElement('button'); b.className = 'btn'; b.id = 'yzMoreB'; b.textContent = '⋯'; b.setAttribute('aria-label', 'עוד'); b.setAttribute('aria-expanded', 'false');
      b.onclick = e => { e.stopPropagation(); const o = more.classList.toggle('open'); b.setAttribute('aria-expanded', o ? 'true' : 'false'); b.classList.toggle('on', o); };
      top.insertBefore(b, document.getElementById('bMenu'));
      const info = document.createElement('button'); info.className = 'btn'; info.id = 'yzInfoB'; info.textContent = 'ℹ'; info.dataset.name = 'פסי מידע';
      info.onclick = () => { const on = document.body.classList.toggle('yz-info'); info.classList.toggle('on', on); try { localStorage.setItem('yz.info', on ? '1' : '0'); } catch (e) { /* */ } };
      try { if (localStorage.getItem('yz.info') === '1') { document.body.classList.add('yz-info'); info.classList.add('on'); } } catch (e) { /* */ }
      more.appendChild(info);
      // לחיצה על כפתור במגירה סוגרת אותה (חוץ מ-ℹ וקול, שמחליפים מצב)
      more.addEventListener('click', e => { const t = e.target.closest('button'); if (t && t.id !== 'yzInfoB' && t.id !== 'yzSnd') { more.classList.remove('open'); b.classList.remove('on'); } });
      document.addEventListener('pointerdown', e => { if (more.classList.contains('open') && !more.contains(e.target) && e.target !== b) { more.classList.remove('open'); b.classList.remove('on'); } }, true);
    }
    for (const el of [...top.children]) {
      if (KEEP.has(el.id) || el.tagName !== 'BUTTON') continue;
      if (NAMES[el.id] && !el.querySelector('.lbl')) el.dataset.name = NAMES[el.id];
      more.appendChild(el);
    }
    return true;
  }

  const t = setInterval(() => {
    if (!build()) return; clearInterval(t);
    const top = document.getElementById('top');
    new MutationObserver(() => build()).observe(top, { childList: true });
  }, 50);
  setTimeout(() => clearInterval(t), 20000);
})();
