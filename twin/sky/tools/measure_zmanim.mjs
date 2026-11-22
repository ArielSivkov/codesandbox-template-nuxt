import { readFileSync } from 'node:fs';
import { zmanim } from '../src/zmanim.js';
import * as H from '../src/hebrew.js';
import { calendarFromJd } from '../src/time.js';
const Z = JSON.parse(readFileSync(new URL('../ref/zmanim_refs.json', import.meta.url))).rows;
export function measureZmanim() {
  const st = {};
  for (const r of Z) {
    const [y, m, d] = r.date.split('-').map(Number);
    const z = zmanim(y, m, d, r.lat, r.lon, { elev: r.elev, useElevation: r.useElevation });
    for (const [k, v] of Object.entries(r)) {
      if (typeof v !== 'number' || ['lat', 'lon', 'elev'].includes(k)) continue;
      const mine = z.times[k]; if (mine == null) { st[k] = { max: Infinity }; continue; }
      const e = Math.abs((mine - 2440587.5) * 86400 - v);
      const s = st[k] || (st[k] = { max: 0, sum: 0, n: 0 }); s.n++; s.sum += e; if (e > s.max) { s.max = e; s.w = r.date + ' ' + r.place + (r.useElevation ? ' elev' : ''); }
    }
  }
  return st;
}
export function measureHebrew() {
  const R = JSON.parse(readFileSync(new URL('../ref/hebrew_refs.json', import.meta.url)));
  let bad = 0, badM = 0, maxMol = 0;
  for (const r of R.dates) { const h = H.hebrewFromRd(H.rdFromJd(r.jd)); if (h.y !== r.y || h.m !== r.m || h.d !== r.d) { bad++; if (bad < 4) console.log('date mismatch', r, h); } }
  for (const r of R.molad) { const mo = H.molad(r.y, r.m);
    // zmanim gives civil (midnight-based) date + hours 0..23 + minutes + chalakim-of-minute (Jerusalem local time)
    const lt = mo.moment; const c = calendarFromJd(H.jdFromRd(Math.floor(lt)), 'gregorian');
    const parts = Math.round((lt - Math.floor(lt)) * 25920); const hh = Math.floor(parts / 1080), mm = Math.floor((parts % 1080) / 18), ch = parts % 18;
    const iso = `${String(c.y).padStart(4, '0')}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
    if (iso !== r.greg || hh !== r.h || mm !== r.min || ch !== r.ch) { badM++; if (badM < 4) console.log('molad mismatch', r, iso, hh, mm, ch); } }
  return { dates: R.dates.length, bad, molads: R.molad.length, badM };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const st = measureZmanim(); for (const [k, s] of Object.entries(st)) console.log(k.padEnd(20), 'max', s.max.toFixed(1), 's  mean', (s.sum / s.n).toFixed(1), 's  n', s.n, s.w || '');
  console.log(measureHebrew());
}
