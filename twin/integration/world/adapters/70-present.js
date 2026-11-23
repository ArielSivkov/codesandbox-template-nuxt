/* מתאם: מחלקת המצגת (swarm/present → mods/present). מצגת יזם = כניסת "יזם" שנייה.
 * פער ממשק (נרשם ביומן): createPresenter יוצר WebGLRenderer + סצנה + טעינת נתונים משלו, ולא מקבל את הסצנה המשותפת.
 * לכן מתאם דק: שכבת iframe מעל העולם, העולם מושהה (לא מצויר) כל זמן שהמצגת פתוחה, וההקשר עובר בכתובת:
 * הבניין הנבחר (site), התאריך והשעה מהשעון האחד. ביציאה חוזרים לאותה נקודה.
 */
(function () {
  'use strict';
  let ovl = null;
  YZW.register({
    id: 'present', name: 'מצגת יזם (שתילת פרויקט, צל, סיפור)', dept: 'present', order: 70, provides: ['present'],
    scripts: ['mods/present/js/geo.js'],
    requires: () => !!window.PGEO,
    init(world) { if (!world.coords.itmToWgs84) { world.coords.itmToWgs84 = PGEO.itmToWgs84; world.coords.wgs84ToItm = PGEO.wgs84ToItm; } },
    dispose() { if (ovl) { ovl.remove(); ovl = null; } },
    modes: [{
      id: 'present', name: 'מצגת יזם', icon: '🎬', sub: 'פרויקט מוצע', kind: 'overlay',
      enter(world, from, pos) {
        const sel = world.player.selected || world.data.buildingAt(pos.x, pos.z, 30);
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(world.clock.date);
        const g = k => (p.find(x => x.type === k) || {}).value; const hour = (+g('hour') % 24) + (+g('minute')) / 60;
        const sc = { date: `${g('year')}-${g('month')}-${g('day')}`, hour: +hour.toFixed(2) }; if (sel) sc.site = sel.id;
        let hash = ''; try { hash = window.PGEO && PGEO.encodeScenario ? PGEO.encodeScenario(sc) : ''; } catch (e) { hash = ''; }
        ovl = document.createElement('div'); ovl.id = 'yzOverlay'; ovl.style.display = 'block';
        ovl.innerHTML = `<iframe title="מצגת יזם" src="mods/present/index.html${hash ? '#' + hash : ''}" allow="clipboard-write"></iframe><button class="btn x" id="yzOvX">✕ חזרה לעולם</button>`;
        document.body.appendChild(ovl); document.getElementById('yzOvX').onclick = () => YZW.setMode(from === 'present' || !from ? 'dev' : from);
        YZW.world.presentFrom = from;
      },
      exit() { if (ovl) { ovl.remove(); ovl = null; } },
      update(dt, world) { const p = world.player.pos; return { x: p.x, y: p.y, z: p.z, speed: 0 }; },
    }],
  });
})();
