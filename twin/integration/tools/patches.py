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

 # ===== טיפולוגיה (סבב 4, משוב אריאל "אין וילות, הכול אותו בלוק אפור") — נגזר מצורה, מסומן "נגזר" בכרטיס =====
 ('TY1-palettes', 'world.js',
  "const IND_PAL = [[0.78, 0.80, 0.82], [0.70, 0.74, 0.78], [0.82, 0.78, 0.70], [0.62, 0.68, 0.72]];",
  "const IND_PAL = [[0.78, 0.80, 0.82], [0.70, 0.74, 0.78], [0.82, 0.78, 0.70], [0.62, 0.68, 0.72]];\n"
  "// טיפולוגיה נגזרת (לא נמדדת): וילה = עד 2 קומות וטביעה קטנה; מגדל = 12+ קומות; אחרת בלוק. דטרמיניסטי לפי מזהה.\n"
  "const VILLA_PAL = [[0.98, 0.97, 0.94], [0.97, 0.94, 0.86], [0.96, 0.92, 0.84], [0.99, 0.98, 0.96], [0.93, 0.90, 0.84], [0.97, 0.90, 0.82]];\n"
  "const BLOCK_PAL = [[0.93, 0.90, 0.82], [0.88, 0.84, 0.76], [0.95, 0.93, 0.88], [0.86, 0.86, 0.84], [0.92, 0.86, 0.80], [0.84, 0.82, 0.78], [0.96, 0.94, 0.90], [0.90, 0.88, 0.84], [0.80, 0.78, 0.74], [0.94, 0.88, 0.84]];\n"
  "const TOWER_PAL = [[0.90, 0.90, 0.88], [0.84, 0.86, 0.88], [0.92, 0.90, 0.85], [0.78, 0.82, 0.86]];\n"
  "function tyOf(b) { if (b.ty) return b.ty; let t = 'block'; if (b.ind) t = 'ind'; else if (b.floors >= 12 || b.h >= 36) t = 'tower'; else if (b.floors <= 2 && b.area < 450 && b.area > 35) t = 'villa'; b.ty = t; return t; }\n"
  "W.tyOf = tyOf;\n"
  "function hipRoof(b, p, n, y1, gr, hs) { // גג רעפים על מלבן מכוון; רק כשהטביעה קרובה למלבן\n"
  "  let bi = 0, bl = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]); if (l > bl) { bl = l; bi = i; } }\n"
  "  const j0 = (bi + 1) % n, ux = (p[j0 * 2] - p[bi * 2]) / bl, uz = (p[j0 * 2 + 1] - p[bi * 2 + 1]) / bl, vx = -uz, vz = ux;\n"
  "  let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9; for (let i = 0; i < n; i++) { const u = p[i * 2] * ux + p[i * 2 + 1] * uz, w = p[i * 2] * vx + p[i * 2 + 1] * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }\n"
  "  const W_ = u1 - u0, D_ = w1 - w0; if (W_ * D_ <= 0 || b.area / (W_ * D_) < 0.72) return false;\n"
  "  const o = 0.45; u0 -= o; u1 += o; w0 -= o; w1 += o; const sw = D_ > W_; const L = sw ? D_ : W_, S = sw ? W_ : D_, hr = Math.min(3.6, Math.max(1.2, 0.36 * S));\n"
  "  const P = (u, w, y) => [u * ux + w * vx, y, u * uz + w * vz];\n"
  "  const um = (u0 + u1) / 2, wm = (w0 + w1) / 2, half = (S + 2 * o) / 2, yr = y1 + hr;\n"
  "  let r1, r2; if (!sw) { r1 = P(Math.min(um, u0 + half), wm, yr); r2 = P(Math.max(um, u1 - half), wm, yr); } else { r1 = P(um, Math.min(wm, w0 + half), yr); r2 = P(um, Math.max(wm, w1 - half), yr); }\n"
  "  const c00 = P(u0, w0, y1), c10 = P(u1, w0, y1), c11 = P(u1, w1, y1), c01 = P(u0, w1, y1);\n"
  "  const k = 0.82 + ((hs >>> 4) % 20) / 100, col = [0.70 * k, 0.34 * k, 0.22 * k];\n"
  "  const tri = (a, b2, c) => { const e1 = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];\n"
  "    if (ny < 0) { const t = b2; b2 = c; c = t; nx = -nx; ny = -ny; nz = -nz; } const l = Math.hypot(nx, ny, nz) || 1;\n"
  "    for (const q of [a, b2, c]) { gr.p.push(q[0], q[1], q[2]); gr.n.push(nx / l, ny / l, nz / l); gr.c.push(col[0], col[1], col[2]); gr.u.push((q[0] * ux + q[2] * uz) / 1.4, (q[1] - y1) / 0.55 + (q[0] * vx + q[2] * vz) * 0.0); } };\n"
  "  if (!sw) { tri(c00, c10, r2); tri(c00, r2, r1); tri(c11, c01, r1); tri(c11, r1, r2); tri(c10, c11, r2); tri(c01, c00, r1); }\n"
  "  else { tri(c00, c01, r2); tri(c00, r2, r1); tri(c11, c10, r1); tri(c11, r1, r2); tri(c01, c11, r2); tri(c10, c00, r1); }\n"
  "  return true;\n}"),
 ('TY2-color', 'world.js',
  "const pal = b.ind ? IND_PAL : PAL, hs = hash32(b.id), col = pal[hs % pal.length];",
  "const ty = tyOf(b), pal = b.ind ? IND_PAL : ty === 'villa' ? VILLA_PAL : ty === 'tower' ? TOWER_PAL : BLOCK_PAL, hs = hash32(b.id), col = pal[hs % pal.length];"),
 ('TY3-groups', 'world.js',
  "const G = [{ p: [], n: [], c: [], u: [] }, { p: [], n: [], c: [], u: [] }, { p: [], n: [], c: [], u: [] }];",
  "const G = [{ p: [], n: [], c: [], u: [] }, { p: [], n: [], c: [], u: [] }, { p: [], n: [], c: [], u: [] }, { p: [], n: [], c: [], u: [] }];   // 3 = גגות רעפים"),
 ('TY4-roof', 'world.js',
  "    // גג\n    v2.length = 0;",
  "    // גג (וילה: רעפים; אחרת שטוח)\n    if (!(!lo && ty === 'villa' && hipRoof(b, p, n, y1, G[3], hs))) {\n    v2.length = 0;"),
 ('TY5-roof-close', 'world.js',
  "      for (const q of seq) { gr.p.push(q.x, y1, q.y); gr.n.push(0, 1, 0); gr.c.push(...rc); gr.u.push(q.x / 10, q.y / 10); }\n    }\n",
  "      for (const q of seq) { gr.p.push(q.x, y1, q.y); gr.n.push(0, 1, 0); gr.c.push(...rc); gr.u.push(q.x / 10, q.y / 10); }\n    }\n    }\n"),
 ('TY6-solar-skip-villa', 'world.js',
  "if (!lo && !b.ind && b.area > 120 && b.area < 3000 && b.floors >= 2) {",
  "if (!lo && !b.ind && ty !== 'villa' && b.area > 120 && b.area < 3000 && b.floors >= 2) {"),
 ('TY7-group-list', 'world.js',
  "const groups = lo ? [[0, 1, 2]] : [[0], [1], [2]];",
  "const groups = lo ? [[0, 1, 2, 3]] : [[0], [1], [2], [3]];"),
 ('TY8-mats', 'world.js',
  "t.hi = new T.Mesh(r.geo, [MAT.wall, MAT.ind, MAT.roof]);",
  "t.hi = new T.Mesh(r.geo, [MAT.wall, MAT.ind, MAT.roof, MAT.tile || MAT.roof]);"),
 ('TY9-tile-mat', 'world.js',
  "  MAT.roof = new T.MeshLambertMaterial({ map: TEX.roof, vertexColors: true });",
  "  MAT.roof = new T.MeshLambertMaterial({ map: TEX.roof, vertexColors: true });\n"
  "  TEX.tile = canvasTex(64, 64, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) { x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, r * 16 + 13, w, 3); for (let c = 0; c < 4; c++) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(c * 16 + (r % 2) * 8, r * 16, 2, 16); } } noiseFill(x, w, h, 300, 0.12, 9, true); });\n"
  "  MAT.tile = new T.MeshLambertMaterial({ map: TEX.tile, vertexColors: true, side: T.DoubleSide });"),
 ('TY10-card', 'game.js',
  "row('סוג', esc(TYPE_HE[b.type] || b.type))",
  "row('סוג', esc(TYPE_HE[b.type] || b.type) + (b.ty && b.ty !== 'ind' ? ' <span class=\"tag\">' + ({ villa: 'וילה / בית פרטי', block: 'בלוק מגורים', tower: 'מגדל' }[b.ty] || '') + ' · נגזר מצורה</span>' : ''))"),

 # ===== עדכון היופי ביום (23.11 13:30): עקיפת גובה/קומות/טיפולוגיה לבניין מזוהה מתמונות השטח (window.YZ_BOVR, מוגדר במתאם 62-beautyday) =====
 ('BD1-bovr', 'world.js',
  "    const base = b.z / 10, h = Math.max(3, b.h / 10);",
  "    const _ov = window.YZ_BOVR && window.YZ_BOVR[b.i], base = b.z / 10, h = _ov && _ov.h ? _ov.h : Math.max(3, b.h / 10);"),
 ('BD2-bovr-fl', 'world.js',
  "floors: b.f, fl: b.fl,",
  "floors: _ov && _ov.f ? _ov.f : b.f, ty: _ov ? _ov.ty : undefined, ovr: _ov ? _ov.note : undefined, fl: b.fl,"),

 # ===== תוסף הקרקע (עותק): אספלט בהיר יותר בצהריים כמו בתמונות 055/064 (אפור שחוק ~125 sRGB), טלאים אפורים במקום "חורים" שחורים =====
 ('GR1-asphalt-lighter', '../mods/plugins/ground/plugin.js',
  "vec3 c = mix(gL(vec3(0.25, 0.25, 0.26)), gL(vec3(0.47, 0.455, 0.43)), wear);",
  "vec3 c = mix(gL(vec3(0.42, 0.415, 0.41)), gL(vec3(0.53, 0.515, 0.49)), wear);"),
 ('GR2-patch-grey', '../mods/plugins/ground/plugin.js',
  "{ c = gL(vec3(0.21, 0.21, 0.22)) * (0.85 + 0.25 * nD.a); wear = 0.1; }",
  "{ c = gL(vec3(0.34, 0.34, 0.35)) * (0.85 + 0.25 * nD.a); wear = 0.1; }"),

 ('GR3-trees-default-off', '../mods/plugins/ground/plugin.js',
  "opts: { trees: true, tufts: true, overlay: true, replaceVeg: true, wetForce: null }",
  "opts: { trees: false, tufts: true, overlay: true, replaceVeg: true, wetForce: null }"),   # עצי הקרקע (מיקומים משוערים מכיסוי קרקע) נכשלו בזוג הלילה 032 — מודול הצמחייה נשאר

 ('GR4-low-no-tufts', '../mods/plugins/ground/plugin.js',
  "low:    { ovR: 190, nearR: 70,  nearTris: 12000, farR: 480, farN: 1400, tuftR: 24, tuftN: 1000,",
  "low:    { ovR: 190, nearR: 70,  nearTris: 12000, farR: 480, farN: 1400, tuftR: 24, tuftN: 0,"),   # שכבה חסכונית: בלי דשא תלת־ממדי (נבנה מחדש כל 5 מ' תנועה — עלות ב-perf ×6)
 ('GR5-low-no-tufts-upd', '../mods/plugins/ground/plugin.js',
  "  if (S.opts.tufts && Math.hypot(P.x - S.tufts.lx, P.z - S.tufts.lz) > 5) buildTufts(world);",
  "  if (S.tufts.mesh && !cfg().tuftN) S.tufts.mesh.visible = false;\n  if (S.opts.tufts && cfg().tuftN > 0 && Math.hypot(P.x - S.tufts.lx, P.z - S.tufts.lz) > 5) buildTufts(world);"),

 # ===== תיקונים לעותקים של תוספי מחלקות אחרות (מדווחים להן) =====
 # הגנה: בניין עם גובה לא סופי לא מפיל את גאומטריית האריח (NaN בכל האריח)
 ('RT-nan-bld', 'world.js',
  "  for (const b of list) {\n    if (lo && b.area < 70) continue;",
  "  for (const b of list) {\n    if (!isFinite(b.top) || !isFinite(b.base)) { b.base = isFinite(b.base) ? b.base : 0; b.h = isFinite(b.h) ? b.h : (b.floors || 1) * 3.3 + 1; b.top = b.base + b.h; }\n    if (lo && b.area < 70) continue;"),

 # ===== כיול חלונות לילה מול תמונות השטח (סבב 4c): חלונות חמים ועמומים יותר, פחות לבן-כחול (01:00 בלילה) =====
 ('PB2-win-warm', '../mods/plugins/buildings/dept/facades.js',
  "vec3 lc = mix(vec3(1.0, 0.76, 0.46), vec3(0.82, 0.90, 1.0), step(0.72, eh(vec2(fi + 0.5, bi + seed * 0.003))));",
  "vec3 lc = mix(vec3(1.0, 0.72, 0.40), vec3(0.86, 0.88, 0.92), step(0.90, eh(vec2(fi + 0.5, bi + seed * 0.003))));"),
 ('PB3-win-dim', '../mods/plugins/buildings/dept/facades.js',
  "eshEmit = lc * mix(farE, nearE, det) * uNight * 0.85;",
  "eshEmit = lc * mix(farE, nearE, det) * uNight * 0.5;"),
]


def apply(world_js_dir, log):
    import os
    res = []
    skip = [x for x in os.environ.get('YZ_SKIP_PATCH', '').split(',') if x]
    for pid, f, old, new in PATCHES:
        if any(pid.startswith(x) for x in skip): res.append((pid, 'skipped-by-env')); continue
        p = os.path.join(world_js_dir, f); s = open(p, encoding='utf-8').read()
        n = s.count(old)
        if n == 1:
            s = s.replace(old, new); open(p, 'w', encoding='utf-8').write(s); res.append((pid, 'applied'))
        else:
            res.append((pid, 'SKIP (anchor %d)' % n))
    for r in res: log(r)
    return res
