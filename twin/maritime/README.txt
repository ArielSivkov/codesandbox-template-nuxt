המחלקה הימית — לוח היזם / עולם תאום של ישראל (אשדוד)
=====================================================
תיקייה: /home/claude/swarm/maritime/   (לא נגענו ב-twin/game, swarm/game, weather, physics, aviation, assets, transport, vegetation)
גרסה 0.1.0 · 23.11.2026

הרצה
----
בדיקות:     cd /home/claude/swarm/maritime && node --test test/*.test.mjs        (17 בדיקות)
צינור:       cd twin && patch -p1 < /home/claude/swarm/maritime/pipeline_patch/maritime-pipeline.patch
             cd twin/pipeline && python -m pytest -q tests                        (16 = 11 קיימות + 5 חדשות, נבדק על עותק)
הדגמה:      demo.html (צריך את twin/game/js/world.js בנתיב ‎../../codesandbox-template-nuxt/twin/game/‎ או ?twin=…)
             פרמטרים: ?view=boat|beach|port|sunset|ais  &wx=sea-breeze|calm-clear|winter-storm|sharav  &wind=U,כיוון  &hour=16.5  &ais=1
צילומים:    node tools/shoot.cjs   (Playwright, 800x360 לרוחב, בלי שרת – הבקשות נענות מתוך רשימת תיקיות מותרות לקריאה בלבד)
             → shots/01-beach, 02-boat, 03-port-aerial, 04-sunset-glint, 05-boat-storm, 06-ais-fixture + report.json

קבצים
-----
maritime.js           נקודת הכניסה (ES module, THREE מוזרק מבחוץ)
src/waves.js          מתמטיקת הגלים: יחס הנפיצה, גלי גרסטנר, דגימה הפוכה (הסירה יושבת על המשטח המצויר)
src/seastate.js       רוח → מצב ים (CEM, מקורב)
src/grid.js           רשת ימית 25 מ' (עומק, מחסה), קו חוף, קריאת אריחי הצינור
src/ocean.js          משטח הים (שיידר), זוהר שמש, קצף חוף, כובעים לבנים, אופק
src/port.js           שוברי גלים, רציפים/משטח נמל, מכולות, עגורנים, מרינה וסירות קשורות, מצופים, נחל לכיש
src/traffic.js        אוניות במעגן ובנתיב, יאכטות, שובלים (טריז קלווין), כלי AIS
src/ais.js            ממשק AIS: מתאם fixture + תכנון מתאם שרת (לא חי)
src/beach.js          סוכות מציל, שמשיות, שחיינים, קו חול רטוב
src/boat.js           פיזיקת סירת מנוע (צעד קבוע 120 הרץ)
src/geom.js           מודלים פרוצדורליים low-poly
fixtures/             שכבה ימית לדוגמה, AIS בדוי, אריחי "mar" שנכתבו ע"י הצינור המתוקן (בדיקת חוזה)
demo-data/            עותק של אריחי הדגימה עם תיקון ים מחוץ לאזור המחקר (tools/fix_sample_sea.py) – המקור לא שונה
pipeline_patch/       הטלאי לצינור + bathy.py + test_maritime.py
tools/                make_fixture.py, fix_sample_sea.py, overview.py, shoot.cjs

ממשק שילוב (למשחק / למנוע)
--------------------------
import { createMaritime, FixtureAIS } from './maritime.js';
const M = createMaritime(THREE, {
  scene,
  tileFrame: { toITM: W.toITM, toScene: W.toScene },     // מסגרת האריחים (world.js)
  toScene: (E, N) => …,                                   // ITM אמיתי → סצנה (בדגימה: הזזה ‎-1524.6, ‎-753.6)
  tiles,                                                  // decodeTerrainBin() של tiles/t/*.bin.gz (או classify(x,z))
  bboxITM: manifest.bbox_itm,
  features,                                               // decodeMarLayer(vtile) מהצינור, או fixtures/ashdod_maritime_fixture.json
  isBuilding: (x, z, pad) => bool,  llToScene: (lat, lon) => {x, z},   groundH?: W.H
});
M.setWind(weather.current.wind_vec);                      // x=מזרח, z=דרום, לאן הרוח נושבת (מוסכמת צוות מזג האוויר)
M.setSun(sunVector(...)) ; M.setSky({ top, hor, fogColor, fogNear, fogFar });
בכל פריים: M.update(dt, camera, { boats: [boat] });
M.seaHeight(x, z) · M.depthAt(x, z) · M.isWater(x, z) · M.solid(x, z) · M.labels.* (טקסטים "משוער") · M.stats()
const boat = M.createBoat(x, z, heading);  boat.step(dt, { throttle, steer, boost });  boat.state = {x,y,z,h,u,pitch,roll,planing,airborne…}
M.useAIS(new FixtureAIS(json))  /  new ServerProxyAIS('wss://…/ais')   ← רק דרך השרת שלנו; התווית מציגה את המצב

שליטה (כמו ב-twin/game): ג'ויסטיק שמאל = מצערת (למעלה/למטה) והיגוי (ימין/שמאל), כפתור ▲ "טורבו", ◀ "אחורה",
גרירה על המסך = סיבוב מצלמה, גלגלת = מרחק. מקלדת: WASD/חצים, Shift/רווח = טורבו, C = אחורה.
הכניסה לסירה: בפתח המרינה (במשחק – להוסיף מצב 'boat' ל-MODES, ולהציג "היכנס לסירה" ליד המרינה).
המשחק כרגע מצייר מישור ים שטוח (W.sea) – להסתיר אותו כשמשתמשים במודול (כמו בהדגמה).

מה מנתונים, מה פרוצדורלי, מה משוער
----------------------------------
מנתונים:   קו החוף, יבשה/ים, גובה הקרקע (אריחי הדגימה, SRTM 2000 + OSM). שמש: מיקום אמיתי (קוד NOAA של צוות הפיזיקה).
            רוח: מודול מזג האוויר (בהדגמה – ערכה ידנית "בריזת ים" וכו', לא מדידה, הרשת חסומה).
שורטט מנתונים (±50 מ'): רציפי הנמל ונחל לכיש – זוהו בעין במפת הגובה של הדגימה (tools/overview.py) ושורטטו ידנית.
סכמטי משוער (לא OSM!): שוברי הגלים, אגן הנמל (עומק 15 מ'), המרינה ומיקומה, המעגן, נתיב הכניסה, מצופים ואורות.
            יוחלף אוטומטית בשכבת "mar" של הצינור כשירוץ עם רשת (OSM אמיתי: man_made, harbour, landuse=port, leisure=marina,
            seamark:*, waterway=river …).
פרוצדורלי: פריסת מכולות וצבעיהן, מיקום עגורנים לאורך שפת הרציף, סירות קשורות, אוניות ויאכטות ותנועתן, שמשיות, סוכות מציל, שחיינים.
משוער (נוסחה + תווית): גובה ומחזור הגלים (CEM), גל ים מונח (0.4 מ', 7 ש', מ-285°), עומק הים (פרופיל לפי מרחק מהחוף),
            ריסון גלים במים רדודים ובאגנים, פיזיקת הסירה (ציפה, גלישה, גרר), שובל קלווין.
AIS: אין נתונים חיים. מוצג רק fixture עם 7 כלים בדויים (MMSI 999…) והתווית אומרת "לא חי".

מקורות ורישיונות
----------------
עומק ים:
  GEBCO 2025 (15″ ≈ 460 מ') – נחלת הכלל, מותר מסחרית, חובה לציין מקור, אסור לניווט/בטיחות בים. https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use
  EMODnet Bathymetry DTM (1/16′ ≈ 115 מ') – CC BY 4.0, "DO NOT USE FOR NAVIGATION". אריח E1 לא מכסה את ישראל – צריך את אריח
    הים התיכון המזרחי.  https://emodnet.ec.europa.eu/
  חיא"ל (חקר ימים ואגמים לישראל) – לא נבדק ברשת מכאן; לבדוק רישיון לכל מאגר לפני שימוש.
  ← שניהם מאפשרים ייצוא ESRI ASCII; yazam/bathy.py ממיר לאריחים tiles/b/*.bin.gz (בדוק על נתון סינתטי בלבד).
גלים: U.S. Army Corps of Engineers, Coastal Engineering Manual EM 1110-2-1100, Part II-2, eq. II-2-36 (fetch-limited),
  C_D = 0.001(1.1+0.035U10). https://coastalengineeringmanual.tpub.com/Part-II-Chap2/Part-II-Chap20049.htm
  גרסטנר: GPU Gems 1 פרק 1. נפיצה ω²=gk·tanh(kh) (תורת גלים ליניארית). שובל: זווית קלווין arcsin(1/3)=19.47°.
AIS (תנאים מסחריים):
  aisstream.io – חינם, מפתח דרך GitHub, "Direct browser connections are not permitted" (רק דרך שרת), עד 3 חיבורים;
    שימוש מסחרי לא מוזכר בעמוד הבית → לשאול לפני מוצר.
  MarineTraffic (Kpler) – Basic ‎£10, Essential ‎£100 למשתמש לחודש (לפי G2); API רק ב-Enterprise ("צור קשר").
  VesselFinder – API בתשלום לפי קרדיטים. Global Fishing Watch – רישיון לא-מסחרי.
OSM: © OpenStreetMap contributors, ODbL 1.0 (בניינים/כבישים של הדגימה; שכבת mar כשתרוץ). מזג אוויר: Open-Meteo (CC BY 4.0) דרך צוות מזג האוויר.
כל המודלים התלת-ממדיים פרוצדורליים (נוצרו בקוד) – אין נכסים חיצוניים.

ביצועים (Chrome headless + SwiftShader, 800x360; לא נמדד על טלפון אמיתי – חובה לבדוק על Redmi)
------------------------------------------------------------------------------------------------
שכבה ימית בלבד: ‎≈86 אלף משולשים, 20 קריאות ציור (+6 מטילי צל). הים לבדו: 29.4 אלף משולשים / 15.3 אלף קודקודים, קריאה אחת.
  פירוט: שוברי גלים 10.3K · סירות קשורות 11.5K · שמשיות 6.3K · קו חול רטוב 5.2K · מכולות 4.6K · עגורנים 4.3K · אוניות 4.3K · שחיינים 2.3K …
כל הסצנה עם העיר (world.js): 81K–185K משולשים, 16–65 קריאות ציור (כולל מעבר צל), ערימת JS ‎≈37 MB בטעינה ראשונה.
בניית הרשת הימית (293 אלף צמתים): ‎≈0.3 ש' ב-Node, 0.3–1.9 ש' בדפדפן הבדיקה (מעבד משותף) – מועמד ל-Web Worker.
דיוק "הסירה על המשטח": השוואת פיקסלים GPU מול CPU (4096 נקודות, רשת 2.5 מ'): סטייה מרבית 5.5 ס"מ, ממוצעת 1.4 ס"מ (Hs 1.1 מ');
  בסערה (Hs 3.4 מ'): 4.5 / 1.1 ס"מ. זו שגיאת האינטרפולציה של הרשת עצמה; ההתאמה מובטחת בטווח ‎~60 מ' מהמצלמה (ברשתות הגסות יש סינון אליאסינג).

ממצאים לצוותים אחרים
---------------------
1. צינור (גדוד 5): tiles.py כותב OUTSIDE גם לים פתוח מחוץ לאזור המחקר; world.js ממלא תאים כאלה ביבשה → "רצועות חול" בתוך הים.
   התיקון בטלאי: keep_sea_outside (ברירת מחדל ב-build_city; ‎--no-keep-sea להתנהגות הישנה). להדגמה: demo-data/.
2. אריחי הדגימה עדיין בראשית הישנה (היסט 1.7 ק"מ) – הקואורדינטות האמיתיות ב-fixture מוזזות בהתאם; אחרי יצירה מחדש לבטל את ההזזה.
3. המשחק: far של המצלמה 1150–2300 מ' – כדי לראות ים עד האופק צריך ערפל בצבע האופק (כמו בהדגמה) או far גדול יותר לשכבת הים.

מגבלות ידועות
--------------
אין שבירת גלים אמיתית, אין שבירה/הסטה של גלים במים רדודים (רק ריסון), אין זרמים וגאות; הסירה – מודל משחקי עם מספרים פיזיקליים;
מהירות מרבית ‎≈40 קשר (בטורבו ‎≈46) – משוער; אוניות במעגן מסתובבות לפי הרוח בלבד; צבעי מכולות ועגורנים – כלליים, לא של חברה אמיתית.

עדכון 23.11.2026 09:50: הטלאי הוחל על הצינור המשותף (twin/pipeline) ומוזג ידנית עם שכבת הצמחייה. חוף רחצה נכנס גם לשכבת הצמחייה וגם לשכבה הימית. אריחי ים מחוץ לגבול העיר נכתבים כשיש בהם שובר גלים/מצוף (בלי להמציא בהם קרקע).
