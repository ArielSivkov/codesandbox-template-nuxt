מחלקת הקול — לוח היזם / עולם תאום של ישראל (אשדוד)
=====================================================
תיקייה: /home/claude/swarm/audio/   (לא נגענו בתיקיות של צוותים אחרים; weather.js נקרא בלבד)

קבצים
-----
audio.js              מודול ES לייבוא — המנוע (Web Audio API, אפס תלויות, אפס קבצי קול)
audio-core.js         פונקציות טהורות (מיפוי פרמטרים, מרחק, דופלר, הסתרה, הקצאת ערוצים, שבת) — רץ גם ב-Node
demo.html             הדגמה לטלפון (360px): כפתור לכל כלי רכב ואווירה, מקור נע לדופלר/הסתרה, מצב שבת, סטטיסטיקה
test/audio.test.mjs   19 בדיקות node --test  →  cd /home/claude/swarm/audio && node --test test/*.test.mjs
test/render.mjs       בדיקת Playwright + OfflineAudioContext (94 בדיקות)  →  node test/render.mjs
test/offline.html     תרחישי הרינדור;  test/render-results.json, test/render-log.txt — תוצאות אחרונות
test/mock-ctx.mjs     AudioContext מדומה ל-Node
shots/demo-360x800.png
LICENSES.txt          רישוי: כל הצלילים מסונתזים, אין חומר מוקלט

שימוש (שילוב במשחק)
--------------------
import { createAudio } from './audio.js';
const audio = createAudio({ shabbat: settings.shabbat, maxVoices: 16 });
audio.installUnlock(document.body);        // מושתק עד הנגיעה הראשונה; ה-AudioContext נוצר רק אז
const me = audio.attachToVehicle(mode, () => ({ x, y, z, vx, vy, vz, speed, throttle, collective, thrust, afterburner, surface }), { player: true });
// mode: walk | car | helicopter | jetpack | drone | jet | spaceship | boat   (גם heli/plane/uav)
// שדות חסרים → ברירות מחדל; מהירות חסרה → נגזרת ממיקום. drone: motors:[4] אופציונלי. helicopter: running:false = כיבוי רוטור.
const npc = audio.attachToVehicle('car', npcStateFn);    // כלי רכב של NPC — אותו API, בלי player
audio.setEnvironment({
  weather: sampleAt(r.data.hourly, Date.now()),         // רשומת weather.js, או weatherToVisual(...)
  area: { traffic: 0..1, park: 0..1, port: 0..1 },      // או areaDist: { mainRoad: מ', park: מ', port: מ' }
  shoreDist: מטרים לקו המים, portPoint: {x,y,z}, surface: 'asphalt',
  buildings: (a, b) => W27.near((a.x+b.x)/2, (a.z+b.z)/2, Math.hypot(a.x-b.x, a.z-b.z)/2 + 20),   // הסתרה
});
loop: audio.setListenerFromCamera(camera, dt); audio.update(dt);
me.detach();  audio.setShabbat(true);  audio.setMuted(true);  audio.playUI('click');  audio.playVoice();  audio.stats();

מוסכמות: x מזרח, y למעלה, z דרום (כמו weather.js והמשחק). מטרים, מ/ש, שניות.
בניין להסתרה: {minx,maxx,minz,maxz, top | base+h, p?(Float32 x,z), n?} — אותו מבנה כמו W27 של המשחק.

ממה עשוי כל צליל
-----------------
מכונית      מהירות → הילוך אוטומטי (היסטרזיס) → סל"ד → תדר הצתה rpm/60·2 (4 צילינדרים), מסור + תת-הרמוניה + יניקה, עיוות tanh,
            low-pass עולה עם מצערת; רעש צמיגים לפי מהירות
מסוק        מעבר להבים 390 סל"ד × 4 = 26 הרץ: רעש מסונן מאופנן בפולסים (whop), טון נמוך, רוטור זנב, טורבינה; הנעה/כיבוי איטיים
סילון       סיבוב N1 בהשהיה (2.5 ש' עלייה / 1.6 ירידה), שריקת טורבינה, שאגה; מבער אחורי = רעם נמוך + פצפוץ
רחפן        4 מנועים, תדר ∝ √דחף, כוונון שונה מעט לכל מנוע (פעימות), רעש מדחפים
חללית       זמזום 48 הרץ ומעלה עם מצערת, מסנן מתנדנד, "וווש" לפי מהירות
סירה        מנוע חיצוני 2 פעימות 3 צילינדרים, מים/ריסוס לפי מהירות עם נדנוד
תרמיל סילון שאגה + רעם + פצפוץ לפי דחף
הליכה       צעדים לפי מרחק (אורך צעד גדל עם מהירות), 8 משטחים × 3 וריאציות: אספלט, בטון, אריחים, עץ, דשא, חול, מתכת, מים
אווירה      רוח (מהירות + משבים מ-weather, שריקה מעל 9 מ/ש), גשם (רעש + טיפות), גלים (מחזור 9.5 ש', עוצמה ובהירות לפי מרחק מהחוף),
            תנועה (המהום רחוק, שקט יותר בלילה), ציפורים (רק ביום, לא בגשם/רוח חזקה), נמל (המהום מכונות + חבטות מנופים + צופר אונייה)
ממשק/קול    click / notify / confirm ; playVoice(buffer?) — ברירת מחדל "קשר רדיו" סינתטי; מנמיך מנועים 9dB ואווירה 6dB

מרחב
-----
PannerNode inverse distance (refDistance לכל סוג רכב), HRTF רק ל-4 הקרובים (2 בטלפון), השאר equalpower.
בליעת אוויר: low-pass לפי מרחק. הסתרה: ספירת בניינים בקו מקור→מאזין (AABB + מצולע + בדיקת גובה גג), 10 פעמים בשנייה,
בניין אחד = low-pass ‏1 ק"הרץ ו- −6dB. דופלר מחושב ידנית (PannerNode כבר לא עושה): f'=f·(c+vL·u)/(c+vS·u), מוגבל ל-×0.5..×2,
מוחל על כל התדרים וקצבי הרעש של הקול.
מיקסר: engines / ambience / ui / voice / music → master → מדחס (limiter) → soft-clip (מבטיח שלא חוצה 0dBFS).

תקציב
-----
עד 16 ערוצים בו-זמנית (continuous + one-shots). מועמדים מדורגים לפי עדיפות × עוצמה משוערת (מרחק, הסתרה, מצערת);
מה שלא נכנס "וירטואלי" — הגרף שלו מפורק לגמרי (אפס CPU) ונבנה מחדש כשהוא חוזר. היסטרזיס ×1.25 נגד הבהוב.
one-shot כשהתקציב מלא גונב את הקול החלש ביותר רק אם הוא חזק ממנו, אחרת נזרק.
סוללה: AudioContext נוצר רק בנגיעה; latencyHint 'playback'; מושהה כשהטאב מוסתר; setMuted(true) משהה אותו לגמרי.
מצב שבת: רק אווירה (כולל צעדים). מנועים, ממשק, התראות, קול, מוזיקה — לא נבנים ולא מתנגנים. הרשימה ניתנת לשינוי (shabbatAllowed).

מדידות (מכונת ארגז חול, 2 ליבות, עומס 12–14 מצוותים אחרים — המספרים שמרניים ולא מייצגים טלפון)
-----------------------------------------------------------------------------------------------------
עומס מלא (30 רכבים + סערה + עיר + נמל + ים + צעדים) → 16 ערוצים, 213 צמתים.
רינדור offline: ‏1.4–1.9× זמן אמת עם HRTF×4, ‏1.7–2.4× בלי HRTF (משתנה עם העומס). ≈2.3–2.9× גרף ייחוס של 64 מתנדים+מסנן.
update(): ממוצע ~0.5 מ"ש לפריים (31 ישויות). יצירת באפרים: ~0.4–1.2 ש' בעומס הזה, מפוצלת למשימות (הארוכה ~60 מ"ש).
רמות: אין קליפינג בשום תרחיש (שיא עומס מלא −0.8 dBFS אחרי limiter), RMS בטווחים שבבדיקה.
דטרמיניזם: הבאפרים זהים ביט-לביט (Node); שני רינדורים מלאים ב-Chrome שונים ב-≤5e-7 (−126 dBFS) — סדר סכימה בתוך Chrome.
לא נמדד על Redmi אמיתי — צריך בדיקה על הטלפון.
