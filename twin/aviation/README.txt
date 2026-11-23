מחלקת התעופה והחלל · 27wrld / לוח היזם – עולם תאום של ישראל
==================================================================
מצב "מטוס קרב" ומצב "חללית" + שכבת עולם רחוק (ישראל, הים התיכון, כדור הארץ) לעולם התאום של אשדוד.
מודולי ES בלי תלויות מלבד three.js (r186, אותו קובץ כמו במשחק). לא נגענו ב-twin/game.

הרצה
----
  node --test test/                      # 18 בדיקות (פיזיקה, אטמוספרה, גאודזיה, שמש, מסלול)
  שרת סטטי מתיקיית /home/claude ואז:  /swarm/aviation/demo.html
      ?scn=takeoff|lowpass|climb|high|ascent|orbit|globe|reentry   ?t=2026-11-23T13:20:00Z   ?q=0|1   ?city=0   ?view=cockpit
  node tools/shot.mjs <port>             # צילומי מסך 800×360 (Chrome + SwiftShader) → shots/
  node tools/bench.mjs                   # עלות מעבד של הסימולציה
  בניית הנתונים מחדש (נחלת הכלל, Natural Earth דרך GitHub + npm world-atlas):
    mkdir _dl; curl -o _dl/ne10.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
    curl -o _dl/lakes10.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson
    (cd /tmp/avnpm && npm i world-atlas@2 topojson-client)
    node tools/build_data.mjs _dl /tmp/avnpm/node_modules ; node tools/build_terrain.mjs ; node tools/bake.mjs

קבצים
-----
  src/jet.js        מודל טיסה (טהור, רץ ב-Node): JetSim, FIGHTER, liftCoef/dragCoef/thrustAvail, levelTrimSpeed, stallSpeed
  src/spaceship.js  חללית 6 דרגות חופש: ShipSim (ארקייד עם בולמי אינרציה / ניוטוני עם כבידה אמיתית), MU
  src/atmo.js       אטמוספרה סטנדרטית ISA / US76 עד 1000 ק"מ
  src/geo.js        WGS84, ECEF, רשת ישראל החדשה (EPSG:2039, מאומת מול pyproj < 0.5 מ'), LocalFrame (מסגרת המשחק)
  src/sun.js        השמש האמיתית דרך physics/src/sun.js (NOAA) של צוות הפיזיקה
  src/farfield.js   העולם הרחוק: אזור ישראל, כדור הארץ, אטמוספרה, שמיים, כוכבים, ערפל תואם, רינדור יחסי-מצלמה
  src/models.js     מודלים פרוצדורליים: makeJet, makeShip, makeRunway (בלי נכסים חיצוניים)
  src/camera.js     CameraRig: מרדף + תא טייס, גרירה להסתכלות
  src/ui.js         createControls (מקל, מחוון מצערת, כפתורי הגה, הטיית טלפון, מקלדת), createHUD
  src/modes.js      makeWorld, createJetMode, createShipMode — נקודת החיבור למשחק
  data/             region.json, world.json (Natural Earth, נחלת הכלל), terrain.json (תבליט FIXTURE – לא DEM), tex/*.webp

חיבור למשחק (twin/game)
-----------------------
  <script type="module">
    import { LocalFrame } from '../aviation/src/geo.js';
    import { FarField, decodeTerrain, useExponentialFog } from '../aviation/src/farfield.js';
    import { makeWorld, createJetMode, createShipMode } from '../aviation/src/modes.js';
    import { createControls, createHUD } from '../aviation/src/ui.js';
    const frame = new LocalFrame(W27.OX, W27.OY);              // אותה ראשית כמו world.js
    const far = new FarField(THREE, { frame, region, world, terrain: decodeTerrain(terr), quality, date, textures });
    const world = makeWorld({ frame, far, city: W27, runway: { x, z, len: 2400, wid: 45, heading: 270, y } });
    const ui = createControls(document.body, { canvas }), hud = createHUD(document.body);
    const jet = createJetMode({ THREE, scene, world, frame, controls: ui, hud });
    jet.enter({ x, z, heading: 270, onGround: true });          // או { x, y, z, heading, speed } באוויר
  </script>
  בכל פריים (במקום moveHeli וכו'):
    jet.update(dt)                       // קלט מהבקרים; או jet.update(dt, {pitch, roll, yaw, throttle, brake, gearToggle})
    const camPos = jet.updateCamera(dt, camera)
    far.update(camPos, camera); far.render(renderer); renderer.clearDepth();
    renderer.autoClear = false; renderer.render(scene, camera); renderer.autoClear = true;
    jet.hudData({ layer: far.layer, fov: camera.fov })   // מעדכן את ה-HUD ומחזיר אובייקט נתונים
  יציאה: jet.exit(); ui.destroy(); hud.destroy();
  חללית: אותו ממשק (createShipMode), קלט {pitch, roll, yaw, thrust, strafeY, boost, toggleDampers, toggleNewtonian}.
  התאמות שהמשחק צריך לעשות בזמן טיסה (כך עושה demo.js, בלי לשנות את world.js):
    • W27.sea: להצמיד לתיבת הנתונים ולהחליף חומר ל-far.makeSeaMaterial() (אין תפר בין הים העירוני לים הרחוק)
    • להסתיר אריחים ריקים (t.empty) מחוץ לתיבת הנתונים — העולם הרחוק הוא ה-fallback האמיתי
    • W27.radius לפי גובה; להסתיר את W27.root מעל ~30 ק"מ
    • useExponentialFog(THREE) + far.fog(out, dist, 0) לערפל של הסצנה הקרובה (אותה נוסחה כמו האובך הרחוק)

מוסכמות
-------
  מסגרת: x מזרח, y למעלה, z דרום (מטרים) סביב ראשית ITM ‏(166265, 634406). כיוון 0 = צפון רשת (−z).
  גוף כלי: אף = −Z, למעלה = +Y, כנף ימין = +X (כמו אובייקט three.js).
  קלט: pitch ‎+1 = אף למעלה (מקל אחורה). מקל המגע: למעלה = אף למטה (מוסכמת סימולטורים), invert:true הופך.
  מקלדת מטוס: W/S או חצים גובה · A/D גלגול · Q/R הגה · Shift/Space מצערת+ · Ctrl/C מצערת− · B בלמים · G גלגלים · V מבט · X עזר טיסה
  מקלדת חללית: אותו מקל · Space/Shift מנוע · C/Ctrl אחורה · Z/X מטה/מעלה · B האצה · H בולמים · N ניוטוני · M האצת זמן

מה פיזיקלי ומה ארקייד — ראו הכותרות של src/jet.js ו-src/spaceship.js. נתונים: Natural Earth (נחלת הכלל),
three.js (MIT). תבליט השטח הוא FIXTURE ידני כי אף שרת DEM לא היה נגיש מהמכונה (AWS/Copernicus/Open-Meteo חסומים).
