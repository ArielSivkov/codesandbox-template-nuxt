מחלקת הצמחייה – עולם 27 / לוח היזם (אשדוד, מישור החוף)
=========================================================
תיקייה: /home/claude/swarm/vegetation/   (לא נגענו ב-twin/game, twin/engine, swarm/game, swarm/transport)

קבצים
-----
species.json               מקור אמת אחד: 20 מינים + קרקע (מדשאה/שטח פתוח/חולית/חוף), גובה, קוטר, נשיר/ירוק-עד,
                           עלווה ופריחה חודשית, צבעים, מקורות (src) ומה משוער (est). משקלות שיבוץ (palettes) משוערים.
species.data.js            נוצר מ-species.json (tools/gen_species_js.py) – גם מעתיק ל-pipeline_work/yazam/species_veg.json
vegetation.js              מודול ES ל-three r186 (מקבל THREE מבחוץ). מודלים פרוצדורליים, אינסטנסים, רוח, עונות, LOD, קרקע.
demo.html                  הדגמה על דגימת אשדוד: רחוב/פארק/חולות/חוף/מסוק, בורר חודש, מחוון רוח, מונה ביצועים.
data/                      עותק דגימת אשדוד + השכבה החדשה tiles/g (79 אריחים, 1.5MB gz) + cities/ashdod/green.json
vegetation-pipeline.patch  טלאי לצינור twin/pipeline (git apply --check עובר; 46 בדיקות עוברות אחרי החלה)
pipeline_work/             עותק הצינור עם הטלאי מוחל (yazam/vegetation.py, sources_osm.py, build_city.py, tests/test_vegetation.py)
test/vegetation.test.mjs   9 בדיקות JS  →  cd /home/claude/swarm/vegetation && node --test test/*.test.mjs
fixtures/ndvi_SYNTHETIC_ashdod_4tiles.npz   NDVI סינתטי (מסומן) להרצת מסלול ה-NDVI. NDVI-DESIGN.txt – התכנון האמיתי.
tools/shoot.cjs            צילומי Playwright 360x800 → shots/   (PORT=8771, שרת סטטי בתיקייה)
tools/lc_png.py            מפת כיסוי קרקע + צמחים של כל העיר → shots/00-landcover-ashdod.png

חוזה הנתונים – שכבה חדשה, לא משנה אריחים קיימים
------------------------------------------------
tiles/g/<tx>_<ty>.json.gz:
  {"v":1,"k":"164_634","o":[164000,634000],"lc_step":10,
   "lc":"<base64 100x100 uint8, שורה 0 = צפון>",   // מחלקה | 0x80 = משוער
   "sp":["WASH","FMIC",...], "t":[dx_dm,dy_dm,sp_idx,h_dm,src, ...], "stats":{...}}
  מחלקות: 0 עירוני/לא ידוע 1 מדשאה 2 פארק 3 חורש 4 בתה 5 חול 6 חוף 7 חולית מיוצבת 8 שדה 9 מטע 10 בית עלמין
          11 מגרש ספורט 12 גינה/חצר 13 שטח פתוח/אחו 14 ים 15 חולית נודדת
  src: 0 OSM עץ · 1 OSM שורת עצים · 2 משבצת ממחלקת התחבורה · 3 משבצת רחוב משוערת · 4 פרוצדורלי בפוליגון OSM
       5 פרוצדורלי בכיסוי משוער · 6 NDVI
cities/<slug>/green.json: ספירות לפי מקור, מקורות, רישיונות.
דטרמיניסטי: רשת גלובלית מוטה (jitter) לפי מטרים מוחלטים ב-ITM + hash לכל תא וכלל → אותו קלט = אותם בתים בדיוק,
בלי תפרים בין אריחים, לא תלוי בסדר העיבוד (נבדק).

ממשק למחלקת התחבורה (משבצות עצים)
----------------------------------
צינור: build_city.py --tree-slots slots.json   כאשר slots.json = [{"x":ITM_E,"y":ITM_N,"cls":0..4,"street":"הרצל"}]
  → src=2, ואז לא נוצרות משבצות משוערות (src=3). מין אחד לרחוב (85%), 15% מעורב, לפי פלטת סוג הדרך.
זמן ריצה: veg.fillSlots(key, [{E,N,cls,street,species?,maxCrown?}])  (או {x,z} בצירי הסצנה)

API (vegetation.js)
-------------------
import { createVegetation } from './vegetation.js';
const veg = createVegetation(THREE, { renderer, scene, origin:{OX,OY}, heightAt:(x,z)=>y, budget:'phone'|'desktop', date });
veg.addTile(key, greenJson) / veg.removeTile(key)        // עם סטרימינג האריחים של המשחק
veg.applyGroundCover(terrainMesh, key)                   // משכפל את חומר הקרקע ומערבב דשא/חול/חולית/שטח פתוח לפי lc
veg.setDate(date)                                        // פריחה/נשירה/שלכת/דשא רדום + אפייה מחדש של כרטיסי ה-LOD
veg.setWind(weather.wind_vec)                            // מ-weather.js: x=מזרח,y=למעלה,z=דרום (מ/ש)
veg.update(camera, dt)                                   // כל פריים. בחירת LOD רק בתזוזה >4 מ' / סיבוב / כל 0.5 ש'
veg.setLight(k)                                          // עוצמת אור לכרטיסים הרחוקים (לילה/עננות)
veg.stats() → {drawCalls, tris, near, far, plants, tiles, considered, ms};  veg.coverAt(x,z) → {cls, estimated}
שילוב במשחק: לקרוא tiles/g/<key>.json.gz ליד tiles/v, ולקרוא addTile + applyGroundCover אחרי בניית הקרקע.
את palms() הקיים ב-world.js אפשר לכבות (הוא מכוסה כאן עם מינים אמיתיים) – החלטה של צוות המשחק.

רינדור
------
* מודל פרוצדורלי לכל מין (16 ארכיטיפים: וושינגטוניה, תמר, כדורי צפוף, רחב, אגרטל, מטרייה, פתוח, בקבוק, אקליפטוס,
  זית, אורן, עמוד-ברוש, שיח, רתם, בן-שיח, דגן). 14–464 משולשים למודל (דגן 14, לענה 60, עצים 88–184, דקלים 254–464). בלי קבצים חיצוניים.
  (בחבילה swarm/assets/pack יש 4 עצים – גם הם פרוצדורליים "עבודה עצמית"; לא נדרשו.)
* קרוב: InstancedMesh למין (+ מעבר צל) · רחוק: כרטיס פונה-מצלמה מאטלס שנאפה בזמן ריצה מאותו מודל
  (נוטה לכיוון המצלמה כשמסתכלים מלמעלה – מסוק/רחפן) · רחוק מאוד: כלום (צבע הקרקע נושא את הירוק).
  ≤ 3 קריאות ציור למין לכל העולם הטעון (לא לכל אריח).
* רוח ב-vertex shader: הטיה ~v² + תנודה בתדר טבעי לפי גובה העץ + רעד עלים; גמישות לפי מין (דקלים/דגן יותר).
  אותו קוד גם בחומר הצל (הצל זז עם העץ).
* עונה: גודל צמרת לפי עלווה (נשירים מתכווצים לענפים), ערבוב צבע פריחה בכתמים לפי כיסוי פריחה של המין,
  שלכת (אזדרכת), פרי (תמרים), מדשאה רדומה בחורף, שטח פתוח ירוק בחורף/צהוב בקיץ.

מה מדויק ומה משוער (חשוב!)
--------------------------
* בדגימת אשדוד אין בכלל נתוני צמחייה מ-OSM (הדגימה נבנתה מהמפה הישנה בלי landuse/natural, והרשת חסומה).
  לכן בדמו: כל העצים וכל כיסוי הקרקע משוערים (src 3/5, ביט 0x80), מסומן בממשק.
* הצינור כבר מושך מ-OSM: natural=tree (+species/genus/leaf_type/height), tree_row, wood, scrub, heath, sand,
  beach, dune, grassland, landuse=grass/meadow/forest/cemetery/orchard/farmland/village_green/recreation_ground,
  leisure=park/garden/pitch/golf_course/nature_reserve, amenity=grave_yard – Overpass, PBF ו-GeoJSON.
  ריצה הבאה עם PBF של Geofabrik תמלא את זה בנתונים אמיתיים, והערכות ימולאו רק בחורים.
* כללי ההערכה: חוף = יבשה עד 60 מ' מהים; חולית = שטח פתוח >100 מ' מבניינים, >25 מ' מכביש, עד 3 ק"מ מהים,
  רצוף ≥2 דונם (עד 250 מ' מהים – נודדת, הלאה – מיוצבת); פארק = פער סגור בתוך העיר 0.25–10 דונם ≥25 מ' מבניינים;
  חצר = עד 20 מ' מבניין מגורים; שטח פתוח = כל השאר >40 מ' מבניינים. עצים לא נכנסים לטביעת בניין (+1 מ', בדיקה מדויקת).

ביצועים (טלפון, budget='phone')
------------------------------
* 60 מבטים אקראיים על 9 אריחים (~19K צמחים): מקסימום 14.2K משולשי צמחייה (תקציב 30K), ≤3 קריאות למין.
* מעבר LOD: חציון 0.7 מ"ש CPU, p95 5 מ"ש (Node, שרת עמוס); רץ רק בתזוזה.
* דמו (Chrome swiftshader 360x800, DPR 2): קריאות ציור 14–64 סה"כ (צמחייה 4–35), משולשים 17–75K סה"כ
  (צמחייה 1.1–9.8K), ערימת JS 17–46MB. אטלס כרטיסים 1024x384 (~2MB GPU עם מיפמפים).
* נתונים: tiles/g ≈ 19KB gz לאריח (1.5MB לכל אשדוד, ~189K צמחים).

רישוי
-----
OSM © OpenStreetMap contributors (ODbL). three.js MIT (vendor/LICENSE-three.txt). המודלים והטקסטורות: קוד שלנו (CC0).
Sentinel-2 (כשיחובר): © Copernicus, קרדיט חובה.
