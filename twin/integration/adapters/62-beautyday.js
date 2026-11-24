/* עדכון היופי ביום (מחלקת האינטגרציה, 23.11.2026 13:30) — לפי 12 תמונות שטח ביום (רחוב הארז / מועדון השחמט) (054–065).
 * קובץ אחד, ניתן להסרה: ?beautyday=0 מכבה את כל מה שכאן (וגם את מסלול היום ב-61-beauty).
 *  1) מועדון שחמט אשדוד: הבניין שסוגר את קצה רחוב הארז (w543568895, 26.7×12.5 מ') מקבל גובה קומה אחת (4.5 מ' — נגזר מ-061/063),
 *     ודגם מעליו: טיח לבן מחוספס, חלונות קטנים גבוהים עם סורגים, שלט גג כחול-לבן, מפלס מוגבה עם מעקה לבן ורמפה, גגון כניסה.
 *     זיהוי הבניין: [לא אומת בשטח] — נגזר מכך שהמועדון סוגר את קצה הרחוב בתמונות 064/062 ושהחניה בניצב מולו (061).
 *     המידות מהמחלקה למו"פ (rnd/plugin/inspired: גובה קיר 4.3 מ', מפלס 0.45 מ'); הטקסטורה פרוצדורלית בלבד — אין פיקסלים מהתמונות.
 *     3 קריאות ציור (קירות+שלט במרקם אחד, פרטים בצבעי קודקוד, מוטות מעקה) — רק כשהאריח טעון.
 *  2) עצי תוסף הקרקע בלילה: "הרמה" קלה (emissive) כדי שלא יהיו צלליות שחורות לגמרי מול פנסים (נמדד בסבב הלילה 032).
 * אין כאן שינוי מראה ללילה מלבד סעיף 2.
 */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const OFF = qs.get('beautyday') === '0';
  const D = window.YZDay = Object.assign({ club: !OFF && qs.get('club') !== '0', treeNight: OFF ? 0 : qs.has('bd_tree') ? +qs.get('bd_tree') : 0.035 }, window.YZDay || {});
  const CLUB_ID = 'w543568895', STREET_END = { x: -1500, z: 210 };   // קצה הארז (סצנה) — הצד של המועדון שפונה אליו = החזית
  if (D.club) window.YZ_BOVR = Object.assign(window.YZ_BOVR || {}, { [CLUB_ID]: { h: 4.6, f: 1, ty: 'block', note: 'מועדון שחמט אשדוד — קומה אחת (נגזר מתמונות היום 061/063; הזיהוי לא אומת בשטח)' } });
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const S = { world: null, api: null, root: null, club: null, mats: [], hinted: false };
  // רמז לתוסף הבניינים (world.providers.buildingHints): מבנה ציבור, קומה אחת, טיח, גג שטוח — בלי גג רעפים/גינה/מרפסות של "וילה"
  const CLUB_HINT = { ty: 'public', floors: 1, h: 4.6, m: 'plaster', rs: 'flat', gf: 0, src: 'beautyday (תמונות 061/063)', conf: 0.5 };
  function hookHints(world) {
    if (!D.club || !world || !world.providers || S.hinted) return false; const prev = world.providers.buildingHints; S.hinted = true;
    world.providers.buildingHints = (id, b, tk) => id === CLUB_ID ? CLUB_HINT : !prev ? null : typeof prev === 'function' ? prev(id, b, tk) : prev instanceof Map || typeof prev.get === 'function' ? prev.get(id) : prev[id];
    return true;
  }
  try { hookHints(window.YZW && YZW.world); } catch (e) { /* */ }

  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---------- מרקם אחד (אטלס 2048×640): חזית קדמית, חזית אחורית, צד, שלט
  const PPM = 40;   // פיקסלים למטר בחזית
  function atlas(L, D_, H) {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 640; const g = c.getContext('2d'); const R = rng(895);
    // טיח מחוספס: אריח רעש 128² אחד (נוצר פעם אחת) שנמרח כתבנית — זול בטעינה
    const nz = document.createElement('canvas'); nz.width = nz.height = 128; { const q = nz.getContext('2d'); q.fillStyle = '#ECE8DE'; q.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 700; i++) { const a = (R() - 0.5) * 0.16; q.fillStyle = a > 0 ? `rgba(255,255,255,${a.toFixed(3)})` : `rgba(90,80,65,${(-a).toFixed(3)})`; const s = 1 + R() * 2.5; q.fillRect(R() * 128, R() * 128, s, s); } }
    const pat = g.createPattern(nz, 'repeat');
    const plaster = (x, y, w, h) => { g.fillStyle = pat; g.fillRect(x, y, w, h);
      const gr = g.createLinearGradient(0, y + h * 0.82, 0, y + h); gr.addColorStop(0, 'rgba(120,110,95,0)'); gr.addColorStop(1, 'rgba(120,110,95,0.28)'); g.fillStyle = gr; g.fillRect(x, y + h * 0.82, w, h * 0.18); };   // לכלוך תחתון
    const win = (x, y, w, h) => { g.fillStyle = '#D9D5CB'; g.fillRect(x - 3, y - 3, w + 6, h + 6); g.fillStyle = '#2A3036'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(150,170,190,0.35)'; g.fillRect(x, y, w, h * 0.35);
      g.strokeStyle = '#F2F2EE'; g.lineWidth = 2.2; for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(x + w * k / 5, y); g.lineTo(x + w * k / 5, y + h); g.stroke(); }   // סורגים
      g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke();
      g.fillStyle = 'rgba(110,95,80,0.25)'; g.fillRect(x + w * 0.1, y + h + 3, w * 0.8, 10); };   // כתם ניקוז מתחת לאדן
    const strip = (y0, len, door) => { const wpx = Math.min(2048, Math.round(len * PPM)), hpx = 192; plaster(0, y0, wpx, hpx);
      const sx = wpx / (len * PPM), n = Math.max(2, Math.floor(len / 2.6)), ww = 0.95 * PPM * sx, wh = 0.8 * PPM, top = y0 + (0.55 / H) * hpx;
      for (let i = 0; i < n; i++) { const cx = (door ? 3.2 : 1.4) * PPM * sx + i * ((len - (door ? 4.4 : 2.8)) / Math.max(1, n - 1)) * PPM * sx; win(cx - ww / 2, top, ww, wh * (hpx / (H * PPM))); }
      if (door) { const dx = 1.0 * PPM * sx, dw = 1.25 * PPM * sx, dh = (2.3 / H) * hpx; g.fillStyle = '#5A4A3B'; g.fillRect(dx, y0 + hpx - dh, dw, dh); g.fillStyle = '#3C3128'; g.fillRect(dx + dw * 0.48, y0 + hpx - dh, dw * 0.04, dh);
        g.fillStyle = '#26406E'; g.beginPath(); g.arc(dx + dw + 0.8 * PPM * sx, y0 + hpx - (1.9 / H) * hpx, 0.3 * PPM * sx, 0, 7); g.fill(); }
      return wpx; };
    const fw = strip(0, L, true), bw = strip(192, L, false);
    plaster(0, 384, 1024, 128); win(1024 * 0.42, 384 + (0.55 / H) * 128, 1024 * 0.95 / D_, 0.8 / H * 128);
    // שלט גג: לבן עם מסגרת כחולה, כיתוב "מועדון שחמט אשדוד" + סמל
    g.fillStyle = '#F7F7F5'; g.fillRect(1024, 384, 1024, 256); g.fillStyle = '#1F4E9A'; g.fillRect(1024, 384, 1024, 22); g.fillRect(1024, 618, 1024, 22);
    g.fillStyle = '#1F4E9A'; g.font = 'bold 96px Heebo, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl'; g.fillText('מועדון שחמט אשדוד', 1536 - 60, 512);
    g.fillStyle = '#2E7D32'; g.beginPath(); g.arc(1990, 512, 34, 0, 7); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
    return { tex: t, fu: fw / 2048, bu: bw / 2048 };
  }

  // ---------- גאומטריה ממוזגת
  function geo() { return { p: [], n: [], u: [], c: [] }; }
  function quad(G, a, b, c, d, nrm, uv, col) {   // a,b,c,d בכיוון נגד השעון במבט מבחוץ
    const P = [a, b, c, a, c, d], U = uv ? [uv[0], uv[1], uv[2], uv[0], uv[2], uv[3]] : null;
    for (let i = 0; i < 6; i++) { G.p.push(P[i][0], P[i][1], P[i][2]); G.n.push(nrm[0], nrm[1], nrm[2]); if (U) G.u.push(U[i][0], U[i][1]); if (col) G.c.push(col[0], col[1], col[2]); }
  }
  function boxG(G, x0, x1, y0, y1, z0, z1, col) {
    const v = (x, y, z) => [x, y, z];
    quad(G, v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), [0, 0, 1], null, col);
    quad(G, v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), [0, 0, -1], null, col);
    quad(G, v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), [1, 0, 0], null, col);
    quad(G, v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), [-1, 0, 0], null, col);
    quad(G, v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0), [0, 1, 0], null, col);
  }
  function mesh(G, mat) {
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(G.p, 3)); bg.setAttribute('normal', new THREE.Float32BufferAttribute(G.n, 3));
    if (G.u.length) bg.setAttribute('uv', new THREE.Float32BufferAttribute(G.u, 2)); if (G.c.length) bg.setAttribute('color', new THREE.Float32BufferAttribute(G.c, 3));
    bg.computeBoundingSphere(); const m = new THREE.Mesh(bg, mat); m.castShadow = m.receiveShadow = true; return m;
  }
  const lin = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };   // צבעי קודקוד במרחב ליניארי (three ממיר מ-sRGB)

  function obb(b) {
    const p = b.p, n = b.n; let best = 0, bi = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]); if (l > best) { best = l; bi = i; } }
    const j = (bi + 1) % n, ux = (p[j * 2] - p[bi * 2]) / best, uz = (p[j * 2 + 1] - p[bi * 2 + 1]) / best, vx = -uz, vz = ux;
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (let i = 0; i < n; i++) { const a = p[i * 2] * ux + p[i * 2 + 1] * uz, c = p[i * 2] * vx + p[i * 2 + 1] * vz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, c); b1 = Math.max(b1, c); }
    const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2; return { cx: ca * ux + cb * vx, cz: ca * uz + cb * vz, ux, uz, vx, vz, L: a1 - a0, D: b1 - b0 };
  }

  function buildClub(b) {
    const o = obb(b), pad = 0.18, L = o.L + 2 * pad, Dd = o.D + 2 * pad, H = 4.75, TH = 0.45, TD = 1.6;
    // החזית = הצד הארוך שפונה לקצה הרחוב
    const s = ((STREET_END.x - o.cx) * o.vx + (STREET_END.z - o.cz) * o.vz) >= 0 ? 1 : -1;
    const nx = o.vx * s, nz = o.vz * s, rx = nz, rz = -nx;   // ימין של מי שעומד מול החזית
    const A = atlas(L, Dd, H), V = 192 / 640, base = b.base || 0;
    const W = geo(), K = geo();
    // קירות: z=0 חזית, z=-Dd אחור, x∈[0,L]
    quad(W, [0, 0, 0], [L, 0, 0], [L, H, 0], [0, H, 0], [0, 0, 1], [[0, 1 - V], [A.fu, 1 - V], [A.fu, 1], [0, 1]]);
    quad(W, [L, 0, -Dd], [0, 0, -Dd], [0, H, -Dd], [L, H, -Dd], [0, 0, -1], [[0, 1 - 2 * V], [A.bu, 1 - 2 * V], [A.bu, 1 - V], [0, 1 - V]]);
    const sv0 = 1 - 2 * V, sv1 = 1 - 2 * V - 128 / 640;
    quad(W, [L, 0, 0], [L, 0, -Dd], [L, H, -Dd], [L, H, 0], [1, 0, 0], [[0, sv1], [0.5, sv1], [0.5, sv0], [0, sv0]]);
    quad(W, [0, 0, -Dd], [0, 0, 0], [0, H, 0], [0, H, -Dd], [-1, 0, 0], [[0, sv1], [0.5, sv1], [0.5, sv0], [0, sv0]]);
    // שלט גג (דו-צדדי) ליד הקצה השמאלי, על עמודים
    const sw = 4.2, sh = 1.05, sx0 = 1.2, sy0 = H + 0.55, sz = -0.35, us = [[0.5, 0], [1, 0], [1, 1 - 2 * V], [0.5, 1 - 2 * V]];   // v קטן = תחתית האזור באטלס
    quad(W, [sx0, sy0, sz], [sx0 + sw, sy0, sz], [sx0 + sw, sy0 + sh, sz], [sx0, sy0 + sh, sz], [0, 0, 1], us);
    quad(W, [sx0 + sw, sy0, sz - 0.02], [sx0, sy0, sz - 0.02], [sx0, sy0 + sh, sz - 0.02], [sx0 + sw, sy0 + sh, sz - 0.02], [0, 0, -1], us);
    // פרטים (צבעי קודקוד)
    const roof = lin('#A19D94'), cap = lin('#E2DDD2'), terr = lin('#B9ADA0'), rail = lin('#F3F3F1'), grey = lin('#8E8C88'), kerbC = lin('#9A9894'), ac = lin('#D2D2CE'), canopy = lin('#ECE9E2'), ramp = lin('#C9C2B6');
    boxG(K, 0, L, H - 0.05, H + 0.02, -Dd, 0, roof);
    boxG(K, -0.06, L + 0.06, H, H + 0.22, -0.22, 0.04, cap); boxG(K, -0.06, L + 0.06, H, H + 0.22, -Dd - 0.04, -Dd + 0.22, cap);
    boxG(K, -0.06, 0.2, H, H + 0.22, -Dd, 0, cap); boxG(K, L - 0.2, L + 0.06, H, H + 0.22, -Dd, 0, cap);
    boxG(K, -0.02, L + 0.02, 0, 0.35, -Dd - 0.02, 0.03, grey);   // צוקל אפור
    for (const dx of [0.35, sw - 0.35]) boxG(K, sx0 + dx - 0.04, sx0 + dx + 0.04, H, sy0 + 0.1, sz - 0.12, sz - 0.04, grey);
    boxG(K, L * 0.62, L * 0.62 + 1.0, H, H + 0.6, -2.2, -1.5, ac); boxG(K, L * 0.3, L * 0.3 + 0.9, H, H + 0.55, -Dd + 1.2, -Dd + 1.9, ac);
    boxG(K, 0, L, 0, TH, 0, TD, terr);                         // מפלס מוגבה מול החזית
    boxG(K, 0, L, 0, 0.14, TD, TD + 0.16, kerbC);              // אבן שפה
    const rampW = 1.5, rx0 = L * 0.55;                         // רמפה בניצב לחזית (063)
    for (let i = 0; i < 6; i++) { const z0 = TD + i * 0.9; boxG(K, rx0, rx0 + rampW, 0, TH * (1 - (i + 1) / 7), z0, z0 + 0.9, ramp); }
    boxG(K, 0.3, 2.9, H - 1.95, H - 1.85, 0, 1.2, canopy);      // גגון מעל הכניסה
    // מעקה לבן: מאחז עליון + תחתון לאורך המפלס (עם פתח לרמפה) + מעקה הרמפה
    const RH = 1.0, rlz = TD - 0.06, runs = [[3.2, rx0 - 0.05], [rx0 + rampW + 0.05, L - 0.15]];
    const bars = [];
    for (const [a, c] of runs) { if (c - a < 0.5) continue; boxG(K, a, c, TH + RH - 0.03, TH + RH + 0.03, rlz - 0.03, rlz + 0.03, rail); boxG(K, a, c, TH + 0.1, TH + 0.14, rlz - 0.02, rlz + 0.02, rail);
      for (let x = a; x <= c; x += 0.14) bars.push([x, TH + 0.12, TH + RH, rlz]); }
    for (const xx of [rx0 - 0.05, rx0 + rampW + 0.05]) { boxG(K, xx - 0.03, xx + 0.03, TH * 0.2 + RH - 0.03, TH + RH + 0.03, TD, TD + 5.4, rail);
      for (let z = TD; z <= TD + 5.4; z += 1.1) boxG(K, xx - 0.025, xx + 0.025, 0, TH + RH, z, z + 0.05, rail); }
    const Bg = geo(); for (const [x, y0, y1, z] of bars) boxG(Bg, x - 0.012, x + 0.012, y0, y1, z - 0.012, z + 0.012, rail);
    const wm = new THREE.MeshLambertMaterial({ map: A.tex, side: THREE.FrontSide }), km = new THREE.MeshLambertMaterial({ vertexColors: true });
    wm.name = 'beautyday.club.walls'; km.name = 'beautyday.club.detail'; S.mats.push(wm, km);
    const g = new THREE.Group(); g.name = 'beautyday:chessclub'; g.add(mesh(W, wm)); g.add(mesh(K, km)); const bm = mesh(Bg, km); bm.castShadow = false; g.add(bm);
    const m4 = new THREE.Matrix4().makeBasis(new THREE.Vector3(rx, 0, rz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz));
    m4.setPosition(o.cx + nx * (Dd / 2) - rx * (L / 2), base - 0.02, o.cz + nz * (Dd / 2) - rz * (L / 2));
    g.matrixAutoUpdate = false; g.matrix.copy(m4); g.matrixWorldNeedsUpdate = true;
    g.userData = { prov: 'בהשראת תמונות היום 061/063 + מידות מו"פ — דמיון אמנותי, לא מדידה; זיהוי הבניין לא אומת', building: b.id, L: +L.toFixed(1), D: +Dd.toFixed(1) };
    return g;
  }
  function tryClub() {
    if (!D.club || S.club) return; const b = S.world.data.buildingById(CLUB_ID); if (!b) return;
    try { S.club = buildClub(b); S.root.add(S.club); S.api.emit && S.api.emit('beautyday-club', S.club.userData); } catch (e) { console.warn('[beautyday] club', e); }
  }

  // ---------- עצי תוסף הקרקע בלילה
  function treeLift(world) {
    if (!window.YZMAT || !D.treeNight) return; const el = world.sun.elevation, night = clamp((2 - el) / 8, 0, 1);
    for (const slot of ['ground.trees', 'ground.impostors']) { const m = YZMAT.get(slot); if (m && m.emissive) m.emissive.setRGB(0.16, 0.15, 0.10).multiplyScalar(D.treeNight * night * 3.0); }
  }

  YZW.register({
    id: 'beautyday', name: 'עדכון היופי ביום: מועדון השחמט, עצים בלילה', dept: 'integration', order: 62,
    init(world, api) {
      S.world = world; S.api = api; S.root = api.group('beautyday'); if (hookHints(world)) api.emit('buildingHints', { src: 'beautyday' });
      api.on('env', () => treeLift(world)); treeLift(world);
      if (D.club) { const later = () => setTimeout(tryClub, 0); later(); api.eachTile((t, kind) => { if (kind === 'add' && !S.club) later(); if (kind === 'remove' && S.club && !world.data.buildingById(CLUB_ID)) { S.root.remove(S.club); S.club = null; } }); }
      window.YZBeautyDay = S;
    },
    update(dt, world) { if (S._t === undefined) S._t = 0; S._t += dt; if (S._t > 2) { S._t = 0; treeLift(world); } },
    dispose() { if (S.club) S.root.remove(S.club); S.club = null; for (const m of S.mats) { if (m.map) m.map.dispose(); m.dispose(); } S.mats = []; },
  });
})();
