לוח היזם · מודול "מצגת יזם" (present) — שתילת פרויקט בעולם התאום, לפני/אחרי, ניתוחי ועדה ומצב סיפור
==========================================================================================================

הרצה מקומית
  cd /home/claude/swarm/present && python3 -m http.server 8000   →  http://127.0.0.1:8000/index.html
  בדיקות מתמטיקה:   node tests/test_geo.js          (36 בדיקות)
  בדיקה חזותית:     node tools/shoot.js <port> [portrait,landscape] [dpr]   → shots/
  מודל glTF לדוגמה: node tools/make_tower.js         → models/tower.gltf

קבצים
  js/geo.js     מתמטיקה טהורה (node + דפדפן): פוליגונים, הזחה (נסיגות), מסה, NOAA שמש, שעון ישראל, ITM→WGS84,
                צל מנסרה, קרן↔מנסרה, דגימות חזית/גג, קידוד תרחיש לכתובת.
  js/data.js    קורא את חוזה הנתונים v1 של pipeline (EPSG:2039, אריחי 1 ק"מ, .json.gz/.bin.gz) → "עולם".
  js/present.js המודול: סצנה, שתילה, לפני/אחרי/החלקה, שמש, צל, ניתוחים, מבט מחלון, מצלמה, בחירה, תוויות.
  js/story.js   מצב סיפור: 9 צילומים, כיתובים מחושבים מהנתונים, ניגון/הבא/הקודם.
  js/app.js     ממשק ההדגמה (עברית RTL).  index.html – הדף.
  data/         תת-קבוצה של twin/pipeline/sample-out-ashdod (15 אריחים, אותו חוזה, לא שונה).
  vendor/       three r186 + loaders.js (GLTFLoader) – העתק מ-twin/game/vendor.

ממשק (API)
  const P = await ESHPresent.createPresenter({ canvas, base:'data/', city:'ashdod', siteId:'w552921285', siteTile:'165_631',
                                               radius_m:2600, labelLayer:divEl, world?:ownWorld, vendor:'vendor/' })
  await P.setSite(osmId)                       בניין שמוחלף (מוסתר מהעיר, מוצג רק ב"לפני", קו מקווקו ב"אחרי")
  await P.setProposal({ type:'massing', footprint:'site' | [[x,y],...] (מ' יחסית למרכז האתר, מזרח/צפון),
                        floors, floorHeight, groundFloorHeight, setbacks:[{fromFloor, inset}], rotation })
  await P.setProposal({ type:'gltf', url, floors?, grossArea?, rotation? })   glTF: מטרים, Y למעלה, מקור במרכז הבסיס;
                                               מיושר אוטומטית לצלע הארוכה של החלקה. extras.floors / extras.grossArea_m2 נקראים אם יש.
  P.setView('before'|'after'|'swipe', swipe0..1)   בהחלקה: שמאל = אחרי, ימין = לפני (קוראים מימין – קודם היום)
  P.setSun('2026-12-21', 9.5)                  שעון ישראל (כולל שעון קיץ), שמש NOAA, צללים חיים
  P.analyzeShadows({ date, h0:9, h1:15, step:0.5, radius:150, sigmaK:0, dry:false })
        → { per:[{id, dist, lostMaxH, lostMeanH, roofLostH, gainMaxH}], affected1h, affectedAny, roofAffected, times, method, ms }
  P.metrics(radius=100) → { proposal:{floors,height,grossArea,footprintArea}, existing:{floors,floorsRange,height,sigma,grossEst,grossRange},
                            added:{gross,range}, neighbors:{count,medianH,maxH,sigmaTypical}, heightRatio }
  P.windowView({ building:'proposal'|osmId, floor, facing? }) → { eye, target, facingAz, distance, topAngleDeg, existingTopAngleDeg }
  P.animate({ to:{pos,target} | orbit:{target,r,az0,az1,pitch} | path:{pts,look}, dur, onStep })  → Promise
  P.setFan(bool) מניפת צל 9–15 · P.setHeat(bool) מפת חום על השכנים · P.select(id) · P.setInsets({bottom,right})
  P.on('select'|'proposal'|'analysis'|'sun'|'view'|'site'|'frame'|'interact', fn)
  ESHStory.createStory(P, {onShot, onState, onEnd}) → { shots, go(i), play(from?), pause(), next(), prev(), stop() }
  PGEO.encodeScenario(obj) / PGEO.decodeScenario(hash)    כתובת לשיתוף, לדוגמה:
    #site=w552921285&fl=14&fh=3.1&gf=4.5&sb=11:2&d=2026-12-21&h=9.5&v=swipe&sw=0.4&shot=3&win=w552921286:2&play=1
    model= מותר רק models/... או https://...gltf|glb ; כל ערך מספרי נחתך לטווח סביר.

שילוב עם המנוע/המשחק (בלי לגעת בהם)
  - קואורדינטות: אותה מוסכמה (x = מזרח−OX, y = מעלה, z = −(צפון−OY)), אותו חוזה אריחים.
  - אפשר להעביר opts.world משלכם, בממשק: { origin:{E,N}, buildings:[{id, ring[[x,y]] מקומי, base, height, sigma, floors,
    floorsRange, conf, area, cx, cy, bb}], byId:Map, ground(x,y), roads:[{name,cls,pts}], sea:[rings], terrain:[], near(x,y,r) }.
  - geo.js עצמאי לגמרי וזמין לכל צוות (גם לשרת/node), למשל לחישוב צל ושמש.

כנות ודיוק
  - שמש: NOAA, נבדק מול NREL SPA (pvlib 0.16.1) ב-42 נקודות: סטייה מרבית 0.006° בגובה, 0.007° באזימוט.
  - צל: חיתוך קרן מדויק מול מנסרות; למודל glTF – Raycaster מול המשולשים. נבדק מול מקרה תיבה אנליטי
    (שטח הצל = w·d + L·(w|cos az| + d|sin az|), L = h/tan el) ומול 7,923 נקודות קרקע – התאמה מלאה.
  - "צל נוסף" = שעות שהנקודה בשמש היום ובצל אחרי (הבניין הקיים מוסר). דגימה כל 4 מ' בחזית, כל 3 מ' בגובה, כל 30 דק'.
  - גובהי הבניינים הקיימים בנתוני הדוגמה = הערכה לפי כלל (σ≈6 מ', רמת ביטחון "נמוך"/"בינוני"). כפתור "בדיקת רגישות" מריץ ±σ.
  - קו החוף בנתוני הדוגמה – סינתטי/משוער. קרקע SRTM 25 מ'. מניפת הצל מוטלת על מישור בגובה בסיס הפרויקט (מקורב בשיפוע).
  - שטח: ברוטו גאומטרי (קומות × שטח הקומה), לא "שטח עיקרי"/שירות לפי תקנות. שכנים: גובה קומה מונח 3 מ'.
  - לא מודל: מרפסות, עצים, גגות משופעים, השתקפויות. הזזה/עריכת קונטור – דרך הקישור/ה-API (אין עורך גרפי).
  - הקלטת סרטון מהמצגת – מחוץ לתחום (מקליט המסך של הטלפון עובד).
  - ביצועים על טלפון אמיתי לא נמדדו כאן (Playwright רץ על SwiftShader – רינדור תוכנה). מדדים: ~19 קריאות ציור, ~145 אלף משולשים.
