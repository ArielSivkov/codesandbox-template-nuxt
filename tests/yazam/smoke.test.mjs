// בדיקת עשן בדפדפן אמיתי, במסך בגודל טלפון (360×800).
// בודקת שהדף נטען בלי שגיאות JavaScript, בלי גלילה לרוחב, ושהוספת סעיף עובדת.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const file = process.argv[2] || 'yazam/index.html';
const url = pathToFileURL(resolve(file)).href;
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('✓ ' + msg); else { failed++; console.error('✗ ' + msg); } };

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
await page.waitForTimeout(500);
ok((await page.title()).includes('לוח היזם'), 'כותרת הדף');
ok(await page.evaluate(() => document.documentElement.dir === 'rtl'), 'כיוון מימין לשמאל');
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'אין גלילה לרוחב ב-360px');

const before = await page.evaluate(() => JSON.stringify(localStorage));
const add = page.locator('#items button:visible, .add:visible').first();
ok(await add.count() > 0, 'יש כפתור הוספה');
await add.click();
await page.waitForTimeout(300);
const after = await page.evaluate(() => JSON.stringify(localStorage));
ok(after !== before, 'הוספת סעיף נשמרה');

// שליחת טקסט עם תגית HTML בשם הלקוח לא מריצה קוד
await page.evaluate(() => { window.__xss = 0; });
const client = page.locator('#client');
if (await client.count() && await client.isVisible()) {
  await client.fill('<img src=x onerror="window.__xss=1">');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__xss === 0), 'שם לקוח עם קוד לא מורץ');
}

ok(errors.length === 0, 'אין שגיאות JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
if (failed) { console.error(`\n${failed} בדיקות נכשלו`); process.exit(1); }
console.log('\nבדיקת העשן עברה');
