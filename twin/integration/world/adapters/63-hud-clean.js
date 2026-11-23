/* 63-hud-clean.js – ממשק נקי (לבקשת אריאל, 23.11.2026)
 * בשורה העליונה נשארים רק: מצב + ⋯ (עוד) + ☰. כל שאר הכפתורים (⭐ ☀ 🔊 🧩 👤 🏠 מצלמה) עוברים למגירת "עוד", עם שם ליד כל אחד.
 * פסי המידע (צמחייה/פנסים/בניינים…) מוסתרים כברירת מחדל – כפתור ℹ במגירה מציג אותם.
 * מונה FPS מוסתר (?fps=1 מציג). תג האיכות ליד השעה מוסתר. סרגל העין הגדולה – שורה אחת.
 * לא נוגע בקוד של מודולים אחרים: רק מזיז את הכפתורים שלהם (המטפלים שלהם נשארים). ?hud=old מבטל הכול.
 */
(function () {
  if (/[?&]hud=old\b/.test(location.search)) return;
  const qs = new URLSearchParams(location.search);
  // #bMine נשאר ב-#top (מוסתר): מודולים אחרים עושים insertBefore(…, bMine) – העברה שלו הפילה את מודול המצלמה (צוות אדום א1/א2)
  const KEEP = new Set(['mode', 'bMenu', 'yzMoreB', 'bMine']);
  const NAMES = { bMine: 'הנכסים שלי', bEnv: 'זמן ומזג אוויר', yzSnd: 'קול', yzMods: 'מודולים וביצועים', yzAcct: 'חשבון ודמות', yzHome: 'השכונה שלי', yzCam: 'מבט מצלמה' };

  const st = document.createElement('style'); st.id = 'yzHudCleanCss';
  st.textContent = `
#top{flex-wrap:nowrap!important}
#top #bMine{display:none!important}
#yzMoreB{font-size:17px;min-width:42px}
#yzMore{position:fixed;z-index:22;top:calc(env(safe-area-inset-top) + 54px);right:8px;width:min(300px,calc(100vw - 150px));display:none;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;background:rgba(12,20,32,.95);border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:8px;box-shadow:0 10px 26px #000a}
#yzMore.open{display:grid}
#yzMore .btn{width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px;justify-content:flex-start;min-height:42px;font-size:13px}
#yzMore .btn .lbl{display:inline!important}
#yzMore .btn[data-name]::after{content:attr(data-name);font-size:12px;color:#cfd9e4}
body[data-yz-mode=dev]:not(.yz-info) #yzHUDp{display:none!important}
body.yz-info #yzHUDp{top:calc(env(safe-area-inset-top) + 56px)!important}
#yzBadge span:not(:first-child):not(.sh){display:none}
#yzDevBar{flex-wrap:nowrap!important;overflow-x:auto;justify-content:flex-start!important;scrollbar-width:none;padding-bottom:2px}
#yzDevBar::-webkit-scrollbar{display:none}
#yzDevBar>*{flex:0 0 auto}
#yzDevBar:has(#yzSrch[style*="block"]){flex-wrap:wrap!important}
#yzDevBar #yzSrch{flex:1 1 100%}
#mm{cursor:pointer}
body.inside #yzMore,body.yz-ovl #yzMore,body.yz-clean #yzMore,body.yz-clean #yzMoreB{display:none!important}
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
      const shut = () => { more.classList.remove('open'); b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); };
      b.onclick = e => { e.stopPropagation(); const o = more.classList.toggle('open'); b.setAttribute('aria-expanded', o ? 'true' : 'false'); b.classList.toggle('on', o); };
      top.insertBefore(b, document.getElementById('bMenu'));
      const info = document.createElement('button'); info.className = 'btn'; info.id = 'yzInfoB'; info.textContent = 'ℹ'; info.dataset.name = 'פסי מידע';
      info.onclick = () => { const on = document.body.classList.toggle('yz-info'); info.classList.toggle('on', on); try { localStorage.setItem('yz.info', on ? '1' : '0'); } catch (e) { /* */ } };
      try { if (localStorage.getItem('yz.info') === '1') { document.body.classList.add('yz-info'); info.classList.add('on'); } } catch (e) { /* */ }
      more.appendChild(info);
      const mine = document.createElement('button'); mine.className = 'btn'; mine.id = 'yzMineP';
      const syncMine = () => { const n = document.getElementById('nMine'); mine.textContent = '⭐ הנכסים שלי ' + (n ? n.textContent : ''); };
      mine.onclick = () => { const b0 = document.getElementById('bMine'); if (b0) b0.click(); }; syncMine();
      const nm = document.getElementById('nMine'); if (nm) new MutationObserver(syncMine).observe(nm, { childList: true, characterData: true, subtree: true });
      more.appendChild(mine);
      // לחיצה על כפתור במגירה סוגרת אותה (חוץ מ-ℹ וקול, שמחליפים מצב)
      more.addEventListener('click', e => { const t = e.target.closest('button'); if (t && t.id !== 'yzInfoB' && t.id !== 'yzSnd') shut(); });
      addEventListener('keydown', e => { if (e.code === 'Escape' && more.classList.contains('open')) shut(); });
      document.addEventListener('pointerdown', e => { if (more.classList.contains('open') && !more.contains(e.target) && e.target !== b) shut(); }, true);
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
