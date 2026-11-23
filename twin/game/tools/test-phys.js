// בדיקות פיזיקה בדפדפן (הליכה, קפיצה, נפילה, ים, בלימה, היגוי, צד מצלמה): node tools/test-phys.js [url]
// מפעיל את moveFoot/moveCar עצמם בצעד קבוע, על נקודה שטוחה ופתוחה בעולם האמיתי.
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8931/index.html?auto';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 });
  const r = await p.evaluate(() => {
    const { S, W, phys, SIM } = G27; G27.Q.auto = false; const out = {}; const I = (o) => Object.assign({ x: 0, y: 0, up: false, down: false, sprint: false }, o);
    // נקודה פתוחה ושטוחה על יבשה: חיפוש ברשת
    let pt = null; const B = W.bounds;
    for (let x = B.minx + 50; x < B.maxx - 50 && !pt; x += 23) for (let z = B.minz + 50; z < B.maxz - 50 && !pt; z += 23) {
      const h = W.H(x, z); if (h < 0.5 || W.near(x, z, 60).length) continue;
      let flat = true; for (let k = -40; k <= 40; k += 10) if (Math.abs(W.H(x + k, z) - h) > 0.3 || Math.abs(W.H(x, z + k) - h) > 0.3) flat = false; if (flat) pt = { x, z, h }; }
    out.pt = pt; if (!pt) return out;
    const dt = 1 / 120; S.mode = 'foot'; S.inside = null;
    // קפיצה
    S.p.set(pt.x, W.floorAt(pt.x, pt.z, pt.h + 2), pt.z); S.vy = 0; S.grounded = true; const y0 = S.p.y; let top = y0, t = 0, air = 0;
    phys.moveFoot(dt, I({ up: true }), false); for (let i = 0; i < 600; i++) { phys.moveFoot(dt, I({}), false); top = Math.max(top, S.p.y); if (!S.grounded) air += dt; }
    out.jumpApex = top - y0; out.jumpAir = air + dt;
    // נפילה חופשית 30 מ'
    S.p.set(pt.x, y0 + 30, pt.z); S.vy = 0; S.grounded = false; t = 0; while (!S.grounded && t < 10) { phys.moveFoot(dt, I({}), false); t += dt; } out.fall30 = t;
    // צד: מקל ימינה, מצלמה בכל כיוון → תזוזה ימינה על המסך (וקטור ימין של מצלמה במבט לכיוון yaw = (−cos, sin))
    let right = 0; for (const yaw of [0, 1, 2, 3]) { S.cam.yaw = yaw; S.p.set(pt.x, y0, pt.z); S.grounded = true; S.speed = 0; S.heading = yaw;
      for (let i = 0; i < 60; i++) phys.moveFoot(dt, I({ x: 1 }), false);
      const dx = S.p.x - pt.x, dz = S.p.z - pt.z; right += (dx * -Math.cos(yaw) + dz * Math.sin(yaw)) > 0 ? 1 : 0; }
    out.strafeRight = right;
    // ים: נקודת ים עמוק
    let sea = null; for (let x = B.minx; x < B.maxx && !sea; x += 17) for (let z = B.minz; z < B.maxz && !sea; z += 17) if (W.isSea(x, z) && W.isSea(x + 30, z) && W.isSea(x - 30, z) && W.isSea(x, z + 30) && W.isSea(x, z - 30)) sea = { x, z };
    if (sea) { S.p.set(sea.x, 3, sea.z); S.vy = 0; S.grounded = false; for (let i = 0; i < 600; i++) phys.moveFoot(dt, I({}), false); out.seaY = S.p.y;
      const x0 = S.p.x, z0 = S.p.z; S.cam.yaw = 0; for (let i = 0; i < 120; i++) phys.moveFoot(dt, I({ y: 1 }), false); out.seaMove = Math.hypot(S.p.x - x0, S.p.z - z0); }
    // רכב: בלימה מ-100 קמ"ש, ישר על כביש פתוח – נמדד בלי התנגשויות (W.collide מוחלף זמנית), במישור
    const H0 = W.H, col = W.collide, onR = W.onRoad; W.H = () => 1; W.collide = (x, z) => ({ x, z, hit: false }); W.onRoad = () => true;
    const brakeRun = (inpB, f) => { const c = S.car; Object.assign(c, { x: 0, z: 0, y: 1, h: 0.3, v: 100 / 3.6, steer: 0 }); let d = 0, tt = 0, amax = 0, v0 = c.v; const h = 1 / f;
      while (c.v > 0.01 && tt < 30) { const x = c.x, z = c.z, vp = c.v; phys.moveCar(h, I(inpB)); d += Math.hypot(c.x - x, c.z - z); tt += h; amax = Math.max(amax, (vp - c.v) / h); } return { d, t: tt, g: amax / 9.81 }; };
    out.brake60 = brakeRun({ up: true }, 60); out.brake30 = brakeRun({ up: true }, 30); out.brake144 = brakeRun({ up: true }, 144); out.brakeS = brakeRun({ down: true }, 60);
    // היגוי מלא ב-100 קמ"ש: תאוצה צידית v·ω
    { const c = S.car; Object.assign(c, { x: 0, z: 0, y: 1, h: 0, v: 100 / 3.6, steer: 0 }); let alat = 0; for (let i = 0; i < 240; i++) { const h0 = c.h; phys.moveCar(1 / 120, I({ x: 1, y: 1 })); alat = Math.max(alat, Math.abs(c.v * (c.h - h0) * 120)); } out.latG100 = alat / 9.81; }
    W.H = H0; W.collide = col; W.onRoad = onR;
    return out;
  });
  console.log(JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  if (process.argv.includes('--report')) { await b.close(); return; }
  ok(r.pt, 'נמצאה נקודה שטוחה ופתוחה');
  ok(r.jumpApex > 0.38 && r.jumpApex < 0.55, `קפיצה מעמידה: שיא ${r.jumpApex.toFixed(2)} מ' (אדם ממוצע 0.3–0.5; היה 1.18)`);
  ok(Math.abs(r.fall30 - Math.sqrt(2 * 30 / 9.81)) < 0.1, `נפילה 30 מ' ב-${r.fall30.toFixed(2)} ש' (√(2h/g)=2.47; היה 1.65)`);
  ok(r.strafeRight === 4, `מקל ימינה מזיז ימינה על המסך ב-${r.strafeRight}/4 כיווני מצלמה (היה 0/4)`);
  ok(r.seaY > -1.6 && r.seaY < -1.2, `בים עמוק: צף בגובה רגליים ${r.seaY.toFixed(2)} מ' (ראש מעל המים; היה −2.5 קרקעית)`);
  ok(r.seaMove > 0.5 && r.seaMove < 3, `שחייה: ${r.seaMove.toFixed(2)} מ' ב-1 ש'`);
  for (const k of ['brake60', 'brake30', 'brake144', 'brakeS']) ok(Math.abs(r[k].d - 41.4) < 1.0 && r[k].g < 1.05, `בלימה ${k}: ${r[k].d.toFixed(1)} מ', ${r[k].t.toFixed(2)} ש', שיא ${r[k].g.toFixed(2)}g (μ=0.95 ⇒ 41.4 מ'; היה 5.8 מ' ב-12.5g)`);
  ok(r.latG100 < 0.95, `היגוי מלא ב-100 קמ"ש: ${r.latG100.toFixed(2)}g צידי (אחיזה ≤0.9g; היה 6.7g)`);
  ok(errs.length === 0, 'אין שגיאות JS' + (errs.length ? ': ' + errs[0] : ''));
  console.log(fail ? `${fail} נכשלו` : 'הכול עבר'); await b.close(); process.exit(fail ? 1 : 0);
})();
