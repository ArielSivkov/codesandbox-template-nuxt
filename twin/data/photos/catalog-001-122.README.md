# קטלוג צילומים 001–122 (Gemini, חבילה twin_world_v2_car57_givatyona_bundle, 23.11.2026 17:12)

נקלט כנתונים בלבד (בלי תמונות) ב-23.11.2026. קובץ: `catalog-001-122.gemini-v2.json` (‏130 KB, sha256 בדוח build-assets-report.md).

- 122 רשומות, בשתי סכמות: 91 בסכמה הישנה (001–091: photo_index, location_he, quality_he, extracted_stage1_he, itm_e/itm_n, anchor_landmark_id) ו-31 בסכמה חדשה (092–122: id, lat/lon, easting/northing, driveFileId, descriptionHe, extractedHe, twinWorldAsset).
- 6 עוגנים (פארק לכיש, שפך נחל לכיש, קיר ההנצחה, שער הנמל הדרומי, מגדלור, פרגולת גבעת יונה).
- פרטיות: 0 לוחיות רישוי של צד שלישי (third_party_plates_stored=false בכל 91 הישנות; חיפוש תבנית לוחית – 0); בחדשות privacyNote.

## אמינות – לשימוש זהיר
- **המיקומים משוערים** (בצילומים אין GPS – כתוב ברשומות עצמן). ב-31 החדשות easting/northing תואמים ל-lat/lon (‏≤0.1 מ' מול pyproj EPSG:2039) – אבל lat/lon עצמם הערכה.
- **סתירות ידועות:** עוגן "המגדלור" בקטלוג (31.81552, 34.64422; גובה 25 מ') רחוק ~270 מ' מקואורדינטת ויקיפדיה (31.813906, 34.646331) והגובה הרשמי 42 מ'. "canonicalOrigin" ‏K Towers 2 = (165894.9, 634049.8) שגוי ב-~400 מ' (המרה מדויקת של אותה נקודה: 166079.9, 633694.2). הערך "forbiddenLegacyOffsetRejected: 1507.8/757.8" הפוך – זה ההיסט הנכון (ראה LOG 23:40).
- גבהים ומידות בתיאורים (extracted*) – הערכות מתמונה, לא מדידה.
