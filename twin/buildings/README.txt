מחלקת הבניינים · לוח היזם – עולם תאום של ישראל (אשדוד) · 23.11.2026
=====================================================================
מטרה: בניינים ישראליים שנראים אמיתיים, בזול ובכנות: כל מה שפרוצדורלי מסומן ככזה.

קבצים
  src/typology.js     טיפולוגיה, מתמטיקת חזית (מפרצים/חלונות/קומות), רמות פירוט, אורות לילה, ציוד גג, אריזה לשיידר. טהור – דפדפן ו-node.
  src/landmarks.js    ציוני דרך עם מקורות (מגדלי K, מגדל דמרי, מונארט, עירייה, מלונות; מגדלור גבעת יונה, מצודת אשדוד-ים).
  src/facades.js      חומר החזיתות (שיידר), קישוט אריחי המנוע, ציוד גג (InstancedMesh), מודלי ציוני דרך, חיבור למנוע: ESHBuildings.attach().
  src/interiors.js    "הנכסים שלי": לובי + גרעין מדרגות/מעלית + דירת 3/4/5 חדרים, לפני/אחרי שיפוץ.
  demo.html           הדגמה על אריחי הדגימה של אשדוד (המנוע של גדוד 6 בתוך iframe, בלי שינוי בו).
                      פרמטרים: view=aerial|street|towers|landmarks|light|fort|property · t=day|night · state=before|after · rooms=3|4|5 · lite · facades=0 · hud
  pipeline/typology.py, test_typology.py     אותם כללים בפייתון + שדות חזית מנתונים בלבד (ty, gf, m, e, q, rs, fs).
  pipeline/pipeline-facades.patch            לצינור של גדוד 5 (tiles.py, sources_osm.py, build_city.py + yazam/facade_typology.py). נבדק: 11/11 בדיקות הצינור עוברות אחרי ההחלה.
  pipeline/engine-tileworker-facades.patch   שורה אחת ל-tileworker של גדוד 6: מעביר את שדות החזית למטא (M.fac). בלי הטלאי – הכללים בלקוח.
  tests/*.test.js     node --test tests/*.test.js   (14 בדיקות)
  tools/shoot.mjs     צילומי 360×800 ל-shots/ + perf.json ;  tools/ab_perf.mjs  השוואת A/B של זמן ציור ;  tools/typology_stats.js  התפלגות על כל העיר
  SOURCES.txt         מקורות לכל עובדה.

שילוב (API)
  <script src=".../typology.js"></script><script src=".../landmarks.js"></script><script src=".../facades.js"></script><script src=".../interiors.js"></script>
  const B = ESHBuildings.attach(THREE, window.YZ, { texBase: '<assets/pack/textures/>', lite: false, clutter: true, standalone: true, adjustLights: true });
     (חייב לרוץ באותו חלון/realm של THREE של המנוע; ב-demo נטען לתוך ה-iframe)
  B.setTime(date)        שמש (engine.setTime) + לילה + חלק החלונות הדולקים לפי שעון ישראל
  B.setHour(h)           לילה/יום לפי שעה בלבד (בלי שמש)
  B.setQuality('lite'|'full')   lite = בלי פרטי חלונות/טקסטורות (לטלפונים חלשים)
  B.setDetail(on)        הדלקה/כיבוי של פרטי חזית + ציוד גג
  B.typologyOf(tileKey, k) → { he, basis: data|shape|rule, floors, material, pilotis, shops, landmark, era, quarter, procedural[] }   לכרטיס הבניין
  B.findBuilding(osmId) → { key, k, info, base, h, dims{len,wid,ang,cx,cn} }    B.hideBuilding(osmId|null)  חתך (לפנים)
  B.labels(w, h)         תוויות ציוני דרך במסך (DOM – 0 קריאות ציור)
  B.stats(), B.dispose()
  ESHBuildings.interiors.buildProperty(THREE, { rooms: 4, state: 'before'|'after', floor: 2 }) → { group, plan, labels }   (planApartment(n) טהור)
  לעולם המשחק (game/js/world.js בונה גאומטריה משלו): להשתמש ב-createFacadeMaterial + תכונת afc (Int16×4: u דצ"מ, אורך קיר דצ"מ, pack(), זרע) + afl.

תקציב
  קריאות ציור: החזיתות באותה קריאה של האריח (מחליפות חומר). ציוד גג: 4 InstancedMesh לכל העולם (לא לאריח). ציוני דרך: מש 1. סה"כ +5 קבועות.
  זיכרון: afc = 8 בתים לקודקוד (≈2MB ל-250K קודקודים). 3 טקסטורות 512 (webp) ≈ 4MB GPU (ב-KTX2 ≈ 0.5MB – מוכנות בחבילה).
  משולשים: ציוד גג 12–24 משולשים לפריט, תקרה 3000/800/2000/800 ורדיוס תלוי גובה מצלמה (150 מ' ברחוב, 420 מ' באוויר).
  אזהרה: ב-SwiftShader (מעבד, בלי GPU) השיידר המלא יקר פי ~14 ממש למברט פשוט, lite פי ~2.5–5 (tools/ab_perf.mjs). SwiftShader מריץ את כל הענפים;
  ב-GPU אמיתי הענפים הקוהרנטיים (קרקע, רחוק) מדולגים. חובה מדידה בטלפון אמיתי (צוות אדום) והחלטה על ברירת מחדל lite/full.
