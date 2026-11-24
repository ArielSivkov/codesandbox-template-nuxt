// פתיחת העולם בדפדפן לבדיקה (משותף ל-probe_map.js ול-render.js). לא משנה קוד משחק – רק פרמטרים ב-URL ומצב ריצה.
// הרמטי: כל בקשה שלא ל-127.0.0.1/localhost נחסמת (בלי טלמטריה, חשבונות, מרובי משתתפים, אריחי ארצי) – תוצאה דטרמיניסטית יותר.
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
const SAMPLE_OFFSET = { dE: 1507.82, dN: 757.76 };   // js/itm.js – ITM אמיתי = דגימה + היסט
// תוספים חולפים (תנועה, אנשים, מטוסים, משטרה, רשת) – כבויים כברירת מחדל: רעש בהשוואה לתמונה סטטית. --keep-transient משאיר.
const TRANSIENT_OFF = ['npc', 'life-lite', 'aviation', 'wanted', 'multiplayer', 'account', 'audio'];
const BASE = process.env.PM_BASE || 'http://127.0.0.1:8944/integration/world/index.html';
const CHROME = process.env.PM_CHROME || '/usr/bin/google-chrome';

function worldURL(o = {}) {
  const q = ['auto', 'nointro', 'clean=1', 'nat=0'];
  if (o.date) q.push('d=' + o.date);
  if (o.time) q.push('t=' + o.time);
  q.push('tier=' + (o.tier || 'medium'));
  if (o.atReal) q.push('at=' + (o.atReal.E - SAMPLE_OFFSET.dE).toFixed(1) + ',' + (o.atReal.N - SAMPLE_OFFSET.dN).toFixed(1));
  for (const id of (o.keepTransient ? [] : TRANSIENT_OFF)) q.push(id + '=0');
  if (o.extra) q.push(o.extra.replace(/^[?&]/, ''));
  return BASE + '?' + q.join('&');
}

async function openWorld(o = {}) {
  const browser = o.browser || await PW.chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: o.width || 360, height: o.height || 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const errors = [], blocked = new Set();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|GL Driver|ERR_FAILED|ERR_BLOCKED|net::/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  await page.route('**/*', r => { const u = r.request().url(); if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u) || /^(data|blob):/.test(u)) return r.continue(); blocked.add(u.split('/').slice(0, 3).join('/')); return r.abort('blockedbyclient'); });
  const url = worldURL(o), t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 300000 });
  await page.waitForFunction(() => YZW.plugins().every(x => x.state !== 'loading' && x.state !== 'registered'), null, { timeout: 180000 }).catch(() => errors.push('plugins still loading after 180s'));
  await settle(page, { minFrames: 12 });
  return { browser, ctx, page, errors, blocked, url, loadS: (Date.now() - t0) / 1000 };
}

// מחכים שהאריחים ייטענו ושהסצנה תתייצב: אין טעינות ממתינות, ומספר המשולשים לא משתנה ב-6 פריימים רצופים.
async function settle(page, { minFrames = 16, timeoutMs = 240000 } = {}) {
  return page.evaluate(async ({ minFrames, timeoutMs }) => {
    const W = YZW.world, G = W.G27, R = W.renderer, t0 = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms));
    let f0 = R.info.render.frame, last = -1, same = 0;
    while (Date.now() - t0 < timeoutMs) {
      await sleep(60);
      const f = R.info.render.frame; if (f === f0) continue;
      const pend = G.W.pending ? G.W.pending() : 0, tris = W.stats.tris;
      same = (pend === 0 && Math.abs(tris - last) <= Math.max(50, last * 0.002)) ? same + (f - f0) : 0; last = tris; f0 = f;
      if (same >= 6 && f - (W.__pmF0 || 0) >= minFrames) break;
    }
    W.__pmF0 = R.info.render.frame;
    return { ms: Date.now() - t0, pending: G.W.pending ? G.W.pending() : null, tris: W.stats.tris, calls: W.stats.calls };
  }, { minFrames, timeoutMs });
}

async function frames(page, n, timeoutMs = 180000) {
  return page.evaluate(async ({ n, timeoutMs }) => { const R = YZW.world.renderer, f = R.info.render.frame, t0 = Date.now();
    while (R.info.render.frame - f < n && Date.now() - t0 < timeoutMs) await new Promise(r => setTimeout(r, 40)); return R.info.render.frame - f; }, { n, timeoutMs });
}

module.exports = { openWorld, settle, frames, worldURL, SAMPLE_OFFSET, TRANSIENT_OFF, PW, CHROME };
