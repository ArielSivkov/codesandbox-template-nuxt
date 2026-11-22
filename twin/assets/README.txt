חבילת נכסים לעולם התאום – צוות "נחלת הכלל ואיכות מובייל" (23.11.2026)

מבנה:
  pack/                החבילה עצמה – זה מה שמעתיקים למנוע/משחק
    models/            22 מודלי GLB (meshopt + כימות). 18 נוצרו בקוד (CC0), 4 של Kenney (CC0)
    textures/          9 חומרי PBR: albedo/normal/orm ב-512 (KTX2 + WebP) וב-1024 (WebP); materials.json
    sky/               3 HDRI של Poly Haven (CC0), 512x256
    fonts/             Heebo 400/700 + Noto Sans Hebrew 400 (OFL) – תת-קבוצה עברית, ‎5–7KB כל אחד
    vendor/            esh-assets-loaders.js (GLTFLoader+KTX2Loader+HDRLoader+MeshoptDecoder ל-window.THREE r186) + basis/ (transcoder)
    LOADER-snippet.js  קוד טעינה מוכן להעתקה
    manifest.json      כל קובץ: רישיון, מקור, גודל, sha256
    CREDITS.txt        קרדיטים
    report.json / REPORT-sizes.txt   לפני/אחרי לכל נכס, משולשים מול תקציב, זיכרון GPU
  tools/               הצינור: gen_textures.py, gen_models.mjs, embed.mjs, hdr_resize.py, optimize.mjs, make_manifest.mjs, build-loaders.sh, shot.mjs
  viewer.html          עמוד בדיקה (משתמש ב-../game/vendor/three.min.js, כמו המשחק). ?view=street|air|mat|veh  ?tex=webp  ?sky=venice_sunset
  shots/               צילומי מסך 360x800
  BUDGET-mobile.txt    תקציב ביצועים + 10 טכניקות עם מקורות
  LIBRARIES.txt        ספריות קוד פתוח עם רישיון שנבדק
  FETCH-LATER.txt      מה חסום ומה להביא אחר כך
  _src/ _build/        מקורות שהורדו (git) ותוצרי ביניים – לא לפריסה

הרצה מחדש (מתוך tools/, Node 22):
  npm ci   (או npm i – package.json בתיקייה)
  python3 -I gen_textures.py ../_build/tex 1024
  node gen_models.mjs ../_build/models
  node optimize.mjs ../_build ../pack            [--hi-ktx2] [--etc1s-normals] [--no-ktx2]
  ./build-loaders.sh
  node make_manifest.mjs ../pack
  (cd /home/claude/swarm && python3 -m http.server 8127) ; node shot.mjs

שקולי CLI של glTF-Transform (אותן פעולות כמו optimize.mjs):
  npx gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 512
  npx gltf-transform uastc / etc1s  – דורשים toktx (לא זמין כאן); לכן הצינור משתמש ב-ktx2-encoder (Basis WASM, MIT).

כללים: רק CC0/OFL/MIT/Apache. כל קובץ חדש בלי כלל רישיון ב-make_manifest.mjs מפיל את הסקריפט (exit 1) – בכוונה.
