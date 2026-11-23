/* תוסף למארח העולם המאוחד (swarm/integration/host/host.js) – גדוד הכיסוי הארצי.
 * מצב "מהחלל" (kind 'overlay' – המארח עוצר את ציור המשחק, כך שרק הקשר הגרפי של השכבה מצייר):
 *   שכבה במסך מלא (iframe מאותו מקור בלבד) של national/index.html?embed=1 – כדור → ישראל → אשדוד → רחוב, יום/לילה אמיתי.
 *   בגובה רחוב מופיע "כניסה לרחוב ›": השכבה שולחת {E,N} ב-ITM אמיתי (postMessage, אותו מקור), והתוסף מציב את השחקן במשחק.
 *
 * חיבור (מחלקת האינטגרציה):
 *   1. להעתיק את swarm/national/web (כולל data/ – קישור סימבולי ל-../data, להעתיק עם cp -rL) אל world/national/
 *   2. להעתיק קובץ זה אל world/adapters/86-national.js ולהוסיף <script src="adapters/86-national.js"></script> אחרי 70-present.js
 *   (נתיב אחר: <script src="..." data-src="נתיב/ל/index.html"> או window.YZ_NATIONAL_SRC לפני הטעינה)
 *
 * מסגרות קואורדינטות – חשוב:
 *   הנתונים הארציים = ITM אמיתי (EPSG:2039).  אריחי המשחק הנוכחיים = "מסגרת הדגימה" של גדוד 5:
 *   ITM אמיתי = דגימה + (1524.6 מזרח, 753.6 צפון)  (groundtruth/README.txt, host.js שורה 526).
 *   במסירה: E_game = E − dE, N_game = N − dN.  כשהמשחק יעבור לנתונים ב-ITM אמיתי: world.coords.trueItmOffset = {dE:0, dN:0}.
 * מזהי בניינים: "w<OSM id>" – זהים לגדוד 5 ולמשחק (קבצי ה-sidecar של מחלקת הנתונים האמיתיים מתאימים בלי המרה). */
(function () {
  'use strict';
  if (!window.YZW) { console.warn('[national] אין מארח YZW'); return; }
  const SRC = window.YZ_NATIONAL_SRC || (document.currentScript && document.currentScript.dataset.src) || 'national/index.html';
  let frame = null, offMsg = null;
  const offset = (w) => (w.coords && w.coords.trueItmOffset) || { dE: 1524.6, dN: 753.6 };
  function close() { if (frame) { frame.remove(); frame = null; } if (offMsg) { removeEventListener('message', offMsg); offMsg = null; } }
  function inGame(world, E, N) {          // האם הנקודה בתוך אריחי המשחק (כרגע: אשדוד בלבד)
    const d = world.data, b = d && d.W && d.W.bounds; if (!b || !world.coords.toScene) return true;
    const p = world.coords.toScene(E, N); return p.x >= b.minx && p.x <= b.maxx && p.z >= b.minz && p.z <= b.maxz;
  }
  YZW.register({
    id: 'national', name: 'ישראל מלמעלה (כיסוי ארצי)', dept: 'national', order: 86,
    init() { /* אין עבודה ברקע: הכול נטען רק כשנכנסים למצב */ },
    dispose: close,
    modes: [{
      id: 'globe', name: 'מהחלל', icon: '🌍', sub: 'כדור → ישראל → אשדוד → רחוב', kind: 'overlay',
      enter(world) {
        close();
        const u = new URL(SRC, location.href);
        if (u.origin !== location.origin) { YZW.notice('שכבת "מהחלל" חייבת להיות מאותו אתר'); return; }
        u.searchParams.set('embed', '1');
        if (world.clock && world.clock.date) u.searchParams.set('t', new Date(world.clock.date).toISOString());
        frame = document.createElement('iframe');
        frame.src = u.toString(); frame.title = 'ישראל מלמעלה';
        frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:60;background:#05070d';
        document.body.appendChild(frame);
        offMsg = (e) => {
          if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
          const m = e.data || {};
          if (m.type === 'yz-national-close') { YZW.setMode('walk', true); return; }
          if (m.type !== 'yz-national-handoff' || !isFinite(m.E) || !isFinite(m.N)) return;
          const o = offset(world), E = +m.E - o.dE, N = +m.N - o.dN;
          if (!inGame(world, E, N)) { YZW.notice('העולם התאום ברמת רחוב מכסה כרגע את אשדוד בלבד – בחרו נקודה באשדוד', { kind: 'info', ms: 4000 }); return; }
          close();
          try {
            YZW.setMode('walk', true);
            YZW.placeAt(E, N, (+m.heading || 0) * Math.PI / 180, false);
            world.national = { lastHandoff: { trueITM: [+m.E, +m.N], gameFrame: [E, N], t: m.t } };
            YZW.notice('ברוכים הבאים לרחוב', { kind: 'info', ms: 1800 });
          } catch (err) { YZW.notice('המסירה לעולם נכשלה: ' + (err && err.message || err)); }
        };
        addEventListener('message', offMsg);
      },
      exit() { close(); },
      update(dt, world) { const p = world.player && world.player.pos; return p ? { x: p.x, z: p.z } : null; },
    }],
  });
})();
