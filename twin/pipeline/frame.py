# -*- coding: utf-8 -*-
"""מקור אחד להיסט בין מסגרת אריחי הדגימה לרשת ישראל האמיתית (EPSG:2039).

ITM אמיתי = מסגרת הדגימה + SAMPLE_TO_ITM.
מקור: חציון של 7,427 בניינים משותפים לאריחי הדגימה ול-national-v1 (23.11.2026), ונמדד שוב מ-7,386 בניינים
בריצת israel-tiles (עקבי); פיזור 0.40/0.38 מ' (σ רדיאלי ≈0.56 מ'). אומת גם מול עוגני מפ"י (ג'מיני, 23.11.2026).

הערך הישן 1524.6/753.6 (כויל מעוגן אחד מעוגל – מונארט) שגוי ב-16.78/−4.16 מ' (17.29 מ').
אסור להשתמש בו בקוד; הבדיקה pipeline/tests/test_frame_offset.py נכשלת אם הוא חוזר.
בצד ה-JS המקור הוא twin/integration/world/js/itm.js → ITM.SAMPLE_OFFSET (מסונכרן לעותקים), והבדיקה דורשת זהות.
"""
SAMPLE_TO_ITM = (1507.82, 757.76)          # (dE, dN) במטרים
SAMPLE_TO_ITM_SIGMA = (0.40, 0.38)         # פיזור בין הבניינים המשותפים, מ'
LEGACY_WRONG = (1524.6, 753.6)             # לתיעוד בלבד – לא להשתמש


def sample_to_itm(x, y):
    return x + SAMPLE_TO_ITM[0], y + SAMPLE_TO_ITM[1]


def itm_to_sample(e, n):
    return e - SAMPLE_TO_ITM[0], n - SAMPLE_TO_ITM[1]
