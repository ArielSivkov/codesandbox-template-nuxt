"""תיקוני הצוות האדום (redteam/world/FINDINGS.txt) — מוחלים על העותק world/js בלבד, לא על swarm/game.
כל תיקון: (מזהה, קובץ, טקסט ישן, טקסט חדש). אם העוגן נעלם (כנראה תוקן אצל צוות המשחק) – נרשם SKIP ולא נכשל.
לצוות המשחק: אותם תיקונים מומלצים במקור (ראו LOG.txt).
"""
PATCHES = [
 # 1 חוסם: קיפאון ~1.7 ק"מ – איפוס נעץ/דלת בפריקת אריח + שחרור טקסטורות (דליפה 21)
 ('RT1a-biz-unload', 'game.js',
  "if (b.id === BIZ.id && bizObj.grp) { scene.remove(bizObj.grp); bizObj.b = bizObj.sign = bizObj.grp = null; }",
  "if (b.id === BIZ.id && bizObj.grp) { scene.remove(bizObj.grp); bizObj.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); bizObj.b = bizObj.sign = bizObj.grp = bizObj.pin = bizObj.door = bizObj.wall = null; }"),
 ('RT1b-pin-guard', 'game.js',
  "if (bizObj.pin) bizObj.pin.position.y = bizObj.b.top",
  "if (bizObj.pin && bizObj.b) bizObj.pin.position.y = bizObj.b.top"),
 # 1 חוסם: עטיפת לולאת הפריים – שגיאה אחת לא עוצרת ציור/טעינה
 ('RT1c-frame-wrap', 'game.js',
  "function frame(now) {\n  requestAnimationFrame(frame);\n",
  "let __ff = 0, __fm = '';\nfunction frame(now) {\n  requestAnimationFrame(frame);\n  try { frameBody(now); } catch (e) {\n    if (e.message !== __fm || __ff++ % 300 === 0) { __fm = e.message; console.warn('[frame] error contained:', e.message); if (window.YZW) YZW.frameFault(e); }\n    try { const p = curPos(); if (isFinite(p.x) && isFinite(p.z)) W.update(p.x, p.z, 6); renderer.render(S.inside ? IN.scene : scene, camera); } catch (e2) { /* */ }\n  }\n}\nfunction frameBody(now) {\n"),
 # 8: תתי־צעדים לתנועה מהירה (מנהור בצעד 0.1 ש')
 ('RT8-substep', 'game.js',
  "  else if (S.mode === 'foot' || S.mode === 'jet') moveFoot(dt, inp, false);\n  else if (S.mode === 'car') moveCar(dt, inp);\n  else if (S.mode === 'heli') moveHeli(dt, inp);",
  "  else if (S.mode === 'foot' || S.mode === 'jet' || S.mode === 'car' || S.mode === 'heli') { const __n = Math.max(1, Math.ceil(dt / 0.02)), __h = dt / __n;\n    for (let __i = 0; __i < __n; __i++) { if (S.mode === 'car') moveCar(__h, inp); else if (S.mode === 'heli') moveHeli(__h, inp); else moveFoot(__h, inp, false); } }"),
 # 10: שלט "אריאל שיפוצים" רק על נכס שהמשתמש בחר (לא על בניין אמיתי אקראי)
 ('RT10-biz-choice', 'game.js',
  "const BIZ = { id: 'w239080011',",
  "const BIZ = { id: (() => { try { return localStorage.getItem('w27.bizId') || ''; } catch (e) { return ''; } })(),"),
 # 4: כנות גבהים – כלל אצבע מוצג "משוער, לא נמדד"
 ('RT4-height-label', 'game.js',
  "<span class=\"tag ${cf[1]}\">ביטחון ${cf[0]}</span>",
  "${b.src === 'R' || b.src === 'N' || b.src === 'B' ? '<span class=\"tag low\">משוער, לא נמדד</span>' : '<span class=\"tag ' + cf[1] + '\">ביטחון ' + cf[0] + '</span>'}"),
 ('RT4-alt-label', 'game.js',
  ": 'מ׳ מעל הים';",
  ": 'מ׳ מעל הים (משוער)';"),
 # 14: "הנכסים שלי" נשמרים גם ב-ITM
 ('RT14-mine-itm', 'game.js',
  "cx: Math.round(b.cx), cz: Math.round(b.cz),",
  "cx: Math.round(b.cx), cz: Math.round(b.cz), E: Math.round(b.cx + W.OX), N: Math.round(W.OY - b.cz), crs: 'EPSG:2039 (מסגרת דגימת גדוד 5)',"),
 # 5: רשומה פגומה מדולגת ומסומנת; אריח שבנייתו נכשלה לא תוקע את הטעינה
 ('RT5-bad-record', 'world.js',
  "for (const b of v.b) {\n    const en = decodeRingEN(b.r[0], ox, oy);",
  "for (const b of v.b) {\n    if (!b || !Array.isArray(b.r) || !b.r[0]) { W.badRecords = (W.badRecords || 0) + 1; continue; }\n    const en = decodeRingEN(b.r[0], ox, oy);"),
 ('RT5-build-try', 'world.js',
  "if (!W.tiles.has(j.key)) buildTile(j); did++;",
  "if (!W.tiles.has(j.key)) { try { buildTile(j); } catch (e) { console.warn('tile build failed', j.key, e.message); W.badTiles = (W.badTiles || 0) + 1; const tt = W.tiles.get(j.key); if (tt && tt.grp) root.remove(tt.grp); if (tt && tt.blds) for (const b of tt.blds) indexRemove(b); W.tiles.set(j.key, { key: j.key, failed: true, bad: true }); } } did++;"),
 # 5: קובץ קרקע קצר/פגום → האריח נכשל (מסומן) במקום גאומטריה עם NaN
 ('RT5-terrain-check', 'world.js',
  "  if (nt !== NT || step !== STEP) console.warn('terrain grid', nt, step);",
  "  if (nt !== NT || step !== STEP || buf.byteLength < 20 + NT * NT * 2) throw new Error('terrain grid ' + nt + ' ' + step + ' (' + buf.byteLength + 'B)');"),
 # 7: ניסיון חוזר לאריחים שנכשלו (השהיה מוכפלת עד 60 ש') + כשהרשת חוזרת
 ('RT7-retry-mark', 'world.js',
  "W.tiles.set(key, { key, failed: true }); }",
  "W._retry = W._retry || {}; W._retry[key] = Math.min(60000, (W._retry[key] || 1000) * 2); W.tiles.set(key, { key, failed: true, t: performance.now(), wait: W._retry[key] }); }"),
 ('RT7-retry-loop', 'world.js',
  "for (const [k] of want) { if (W.tiles.has(k)) continue;",
  "for (const [k] of want) { const __ex = W.tiles.get(k); if (__ex && __ex.failed && !__ex.bad && performance.now() - __ex.t > __ex.wait) W.tiles.delete(k); else if (__ex) continue;"),
]


def apply(world_js_dir, log):
    import os
    res = []
    for pid, f, old, new in PATCHES:
        p = os.path.join(world_js_dir, f); s = open(p, encoding='utf-8').read()
        n = s.count(old)
        if n == 1:
            s = s.replace(old, new); open(p, 'w', encoding='utf-8').write(s); res.append((pid, 'applied'))
        else:
            res.append((pid, 'SKIP (anchor %d)' % n))
    for r in res: log(r)
    return res
