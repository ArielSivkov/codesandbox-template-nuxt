ESH27 – לוח היזם – עולם תאום: מחלקת "שמיים וזמן" (גרסה 0.1.0, 23.11.2026)
=====================================================================
מודול עצמאי, JS טהור, בלי רשת ובלי תלויות. לא נוגע בענף twin-world (הכול כאן, ב-swarm/sky).

קבצים
-----
src/time.js     יום יוליאני, לוח יוליאני/גרגוריאני (מעבר אוטומטי 1582-10-15), ΔT (אספנק–מאוס + IERS) ואי-ודאות, זמן כוכבי
src/sky.js      אפמריס: שמש וכוכבי לכת (VSOP87D), ירח (מאוס פרק 47), נוטציה, פרצסיה, סטייה, טופוצנטרי, שבירה, זריחה/שקיעה,
                מופע הירח, 300 כוכבים (BSC5), שביל החלב (חזותי), וקטור לעולם התאום (x מזרח, y מעלה, z דרום, γ של ITM)
src/zmanim.js   זמני היום (עלות 16.1°, משיכיר 11.5°/11°/10.2°, הנץ, ק"ש ותפילה מג"א 72/16.1° וגר"א, חצות, מנחה גדולה/קטנה,
                פלג, שקיעה, צאת 8.5°/13.5/18/24 דק'/16.1°/ר"ת 72), גובה (אופק נראה) ואופק טופוגרפי
src/hebrew.js   לוח עברי קבוע (רמב"ם / ריינגולד–דרשוביץ), מולד, גימטריה
src/calib.js    כיול מצלמה מהשמיים: כיוון/הגבהה (גוף אחד), +הטיה/מוקד (שניים ומעלה)
src/state.js    מצב לפריים עם תקציב: חישוב כבד מחולק בין פריימים, מודל ריבועי לכל גוף
src/data/       vsop87d.js (2074 איברים), moon47.js, bsc300.js — נוצרים ע"י tools/make_data.py
dist/esh27-sky.js   סקריפט רגיל → window.ESH27Sky ;  dist/esh27-sky.mjs  מודול ES  (node tools/build.mjs)
plugin/15-sky.js    מתאם למארח YZW (id 'sky'): להעתיק ל-integration/world/adapters/ ואת dist/esh27-sky.js ל-world/mods/sky/
twin-sky-demo.html  הדגמה (טלפון): סרגל זמן, מקומות, רגעים היסטוריים, כיפה, זמני היום, כיול מצלמה. מריצה את התוסף האמיתי.
test/*.test.mjs     cd swarm/sky && npm test        (41 בדיקות)
ref/*.json          ערכי ייחוס: python ephem 4.2.1, skyfield + JPL DE421, python zmanim 0.3.1 (KosherJava), convertdate
tools/              make_refs.py, make_zmanim_refs.py, make_data.py, measure*.mjs, build.mjs, shot.mjs (צילומים → shots/)

שימוש
-----
const S = ESH27Sky;
S.skyAt(new Date(), 31.7995, 34.647, {gammaDeg: S.itmConvergenceDeg(31.7995, 34.647)})  → {sun, moon, planets[5], lst, deltaT, deltaTSigma}
   לכל גוף: az (מצפון אמיתי), alt (גאומטרי), altApparent (עם שבירה), ra/dec טופוצנטריים, vec {x,y,z} לעולם, phase (חלק מואר) …
S.moon(t, S.observer(lat, lon, elev))   S.body('Jupiter', t, obs)   S.star('Sirius', t, obs)
S.riseSet('Moon', jdUT_of_local_midnight, lat, lon)  → {rise, set, transit} (JD UT)
S.zmanim(2026, 11, 23, 31.7781, 35.2354, {elev: 740, useElevation: true, horizonDeg: 0})  → {times (JD UT), local 'HH:MM:SS', list}
S.hebrew.hebrewDate(jdUT, {tzHours: 2, afterSunset})  S.hebrew.molad(5787, 7)  S.hebrew.rdFromHebrew(y, m, d)
S.time({jdUT}) / S.jdFromCalendar(-762, 6, 15) (יוליאני אוטומטית) / S.deltaT(year) / S.deltaTSigma(year)
S.calibrateFromPhoto({date, lat, lon, W, H, fovDeg, marks:[{body:'Moon', u, v}], gammaDeg})  → {heading, headingGrid, pitch, roll, sigmaHeading}
S.createSkyState({lat, lon, gammaDeg}).update(date)  → .bodies, .matrix (משווני→עולם), .stars

דיוק נמדד (ראו README בדוח; כל המספרים מהבדיקות)
------------------------------------------------
ירח מול JPL DE421: ≤ 7.7"  ; מול ephem: ≤ 7.9"   (יעד 0.1° = 360")
כוכבי לכת מול DE421: ≤ 6.6" ; מול ephem: ≤ 4.9"  (יעד 0.05° = 180")
שמש מול DE421: ≤ 1.6" ; כוכבים מול skyfield: ≤ 0.53" ; חלק מואר של הירח מול ephem: ≤ 0.0002
זריחה/שקיעה/מעבר ירח ושמש מול ephem: ≤ 1.5 שנ'
זמני היום מול KosherJava (python zmanim): ≤ 3.6 שנ' (240 ימים × 3 מקומות × עם/בלי גובה); מול hebcal.com: זהה לדקה (28 זמנים)
לוח עברי: 400/400 תאריכים זהים ל-convertdate, 200/200 מולדות זהים ל-KosherJava
תקציב פריים (CPU, node): 7–30 מיקרו-שנייה במצב רגיל, ≤ 200 בקפיצת זמן כל פריים
