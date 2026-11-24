# שיפוט ויזואלי עם Qwen2.5-VL ב-Kaggle (photomatch)

> לא הורץ בסביבת הבנייה. הקבצים מוכנים; ההרצה הראשונה ב-Kaggle תאמת אותם.

## מה זה עושה
`compare.py` נותן מספרים: צבע, בהירות, קצוות, קו רקיע.
המודל מוסיף את מה שמספרים לא רואים: "חסרה בריכת מים עם כיפה", "המגדלור נמוך מדי", "עצים במקום שיחייה".
הפלט הוא JSON באותה סכמה כמו `DummyJudge` ב-`hook.py`, ולכן הצנרת לא משתנה כשמחליפים את הדמה במודל.

## שלב 1 – מקומית: הכנת זוגות
```bash
python3 -I twin/integration/tools/photomatch/vlm/hook.py --out /home/claude/swarm/photomatch-out --size 360x800
# → photomatch-out/vlm/tasks-360x800.jsonl  +  photomatch-out/vlm/360x800/pairs/<id>.photo.png / .render.png
```

## שלב 2 – העלאה ל-Kaggle כ-Dataset **פרטי**
- הזוגות כוללים את הצילומים של אריאל. לכן ה-Dataset חייב להיות **Private**.
- לפני העלאה: `pose_notes.json → privacy_review` צריך להיות 0 פנים ו-0 לוחיות. משימה שלא נבדקה יוצאת מפוקסלת.
- להעלות את התיקייה `photomatch-out/vlm` כ-Dataset בשם `photomatch-pairs`.

## שלב 3 – מחברת Kaggle
- Settings → Accelerator: **GPU T4 ×2** (או P100).
- Internet: **On**, כדי להוריד את המודל מ-Hugging Face. אפשר גם לצרף את Qwen2.5-VL מ-Kaggle Models.
- Add data: `photomatch-pairs`, ובנוסף את הקבצים `hook.py` ו-`kaggle_qwen25vl.py` (כ-Dataset קטן `photomatch-code` או בהעתקה לתא).

```python
!pip -q install "transformers>=4.49" accelerate qwen-vl-utils
!python /kaggle/input/photomatch-code/kaggle_qwen25vl.py \
    --tasks /kaggle/input/photomatch-pairs/tasks-360x800.jsonl \
    --root  /kaggle/input/photomatch-pairs \
    --out   /kaggle/working/results.jsonl \
    --model Qwen/Qwen2.5-VL-7B-Instruct      # מהיר יותר: Qwen/Qwen2.5-VL-3B-Instruct
```
- הסקריפט ממשיך מאיפה שעצר: שורות שכבר קיימות ב-`results.jsonl` מדולגות. אם הסשן נקטע, מריצים שוב את אותה פקודה.
- T4 לא תומך ב-bf16, ולכן הסקריפט טוען ב-`float16`. את המודל 7B מפצלים על 2×T4 (`device_map=auto`).

## שלב 4 – חזרה
```bash
python3 -I twin/integration/tools/photomatch/vlm/hook.py --validate results.jsonl   # בדיקת סכמה
```
את הקובץ שומרים ב-`photomatch-out/vlm/results-<size>.jsonl`.

השלב הבא (עוד לא נבנה): `fixes.py --vlm` יוסיף הבדלים מהמודל כראיה לתיקונים הקיימים, ותיקונים חדשים ייכנסו רק אם הם מופיעים ב-2 תמונות לפחות.
קלוד בודק את רשימת התיקונים ולא את התמונות עצמן.

## עלות והיקף (הערכה, [לא אומת])
- **מכסה:** לפי מקור משני, Kaggle נותן בחינם בערך 30 שעות GPU בשבוע (P100 16GB או 2×T4), עם סשן של עד 12 שעות.
- **קצב:**
  - 7B: הערכה של ~30–60 שניות לזוג (2 תמונות של עד 448×896 ועד 900 טוקנים בפלט).
  - 3B: בערך פי 2 מהר יותר.
- **100 משימות:** כ-1–1.5 שעות GPU עם 7B. נכנס בסשן אחד.
- **1,000 משימות:** כ-8–16 שעות עם 7B (2 סשנים), או כ-4–8 שעות עם 3B. נכנס במכסה השבועית החינמית.
- מעבר לזה יש שלוש אפשרויות:
  - לפצל לכמה שבועות.
  - לשפוט רק משימות שהציון המספרי שלהן גרוע.
  - לעבור ל-GPU בתשלום.

## הנחיה (prompt)
ההנחיה נמצאת ב-`hook.py → PROMPT`. היא באנגלית, כי Qwen2.5-VL עונה טוב יותר באנגלית, אבל מבקשת גם שדות בעברית (`what_he`, `suggested_fix_he`).
ההקשר כולל את הנתונים הבאים, שנמדדו ולא נוחשו:
- השעה
- הכיוון
- שדה הראייה
- הרכב המחלקות ברינדור
