// Measures accuracy against ref/sky_refs.json; prints a table (used for the report; the tests assert the same).
import { readFileSync } from 'node:fs';
import * as S from '../src/sky.js';
import { STARS } from '../src/data/bsc300.js';
const R = JSON.parse(readFileSync(new URL('../ref/sky_refs.json', import.meta.url)));
const D2R = Math.PI / 180;
export const sepAltAz = (a1, h1, a2, h2) => { const c = Math.sin(h1 * D2R) * Math.sin(h2 * D2R) + Math.cos(h1 * D2R) * Math.cos(h2 * D2R) * Math.cos((a1 - a2) * D2R); return Math.acos(Math.min(1, c)) / D2R; };
const names = ['Moon', 'Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
function run(refKey, dtKey, ownDT) {
  const st = {}; for (const n of names) st[n] = { max: 0, sum: 0, n: 0, worst: '' };
  for (const c of R.cases) {
    if (!c[refKey]) continue;
    const ctx = S.time(new Date(c.iso), ownDT ? {} : { deltaT: c[dtKey] }), obs = S.observer(c.lat, c.lon, 0);
    for (const n of names) {
      const b = S.body(n, ctx, obs, { refraction: false }), r = c[refKey][n];
      const e = sepAltAz(b.az, b.alt, r.az, r.alt) * 3600;
      const s = st[n]; s.n++; s.sum += e; if (e > s.max) { s.max = e; s.worst = c.iso; }
    }
  }
  return st;
}
function phaseErr() { let m = 0; for (const c of R.cases) { const ctx = S.time(new Date(c.iso), { deltaT: c.ephemDeltaT }); const b = S.moon(ctx, S.observer(c.lat, c.lon, 0)); m = Math.max(m, Math.abs(b.phase - c.ephem.Moon.phase)); } return m; }
function starErr() { let m = 0, n = 0, w = ''; for (const c of R.cases) { if (!c.de421Stars) continue; const ctx = S.time(new Date(c.iso), { deltaT: c.skyfieldDeltaT }), obs = S.observer(c.lat, c.lon, 0);
  for (const [hr, r] of Object.entries(c.de421Stars)) { const b = S.star(+hr, ctx, obs, { refraction: false }); const e = sepAltAz(b.az, b.alt, r.az, r.alt) * 3600; n++; if (e > m) { m = e; w = hr + ' ' + c.iso; } } } return { max: m, n, w }; }
function ancient() { const st = {}; for (const n of names) st[n] = 0; for (const c of R.ancient) { const ctx = S.time({ jdUT: c.jdUT }, { deltaT: c.ephemDeltaT }), obs = S.observer(31.7781, 35.2354, 0);
  for (const n of names) { const b = S.body(n, ctx, obs, { refraction: false }), r = c.ephem[n]; st[n] = Math.max(st[n], sepAltAz(b.az, b.alt, r.az, r.alt) * 3600); } } return st; }
function riseSet() { let m = { MoonRise: 0, MoonSet: 0, MoonTransit: 0, SunRise: 0, SunSet: 0, SunTransit: 0 }; for (const r of R.riseSet) for (const b of ['Moon', 'Sun']) {
  const x = S.riseSet(b, r.jd0, 31.7995, 34.647); for (const k of ['Rise', 'Set', 'Transit']) { const ref = r[b + k], mine = x[k.toLowerCase()]; if (ref == null && mine == null) continue;
    if (ref == null || mine == null) { if (Math.abs((ref ?? mine) - r.jd0 - 1) * 86400 > 120 && Math.abs((ref ?? mine) - r.jd0) * 86400 > 120) m[b + k] = Infinity; continue; }
    m[b + k] = Math.max(m[b + k], Math.abs(ref - mine) * 86400); } } return m; }
export function measureAll() { return { ephem: run('ephem', 'ephemDeltaT'), ephemOwnDT: run('ephem', 'ephemDeltaT', true), de421: run('de421', 'skyfieldDeltaT'), de421OwnDT: run('de421', 'skyfieldDeltaT', true), phase: phaseErr(), stars: starErr(), ancient: ancient(), riseSet: riseSet() }; }
if (import.meta.url === `file://${process.argv[1]}`) {
  const m = measureAll(); const fmt = st => Object.entries(st).map(([k, s]) => `${k}: max ${s.max.toFixed(1)}" mean ${(s.sum / s.n).toFixed(1)}" (n=${s.n})`).join('\n  ');
  console.log('vs ephem (same ΔT):\n  ' + fmt(m.ephem)); console.log('vs ephem (own ΔT):\n  ' + fmt(m.ephemOwnDT));
  console.log('vs DE421 (same ΔT):\n  ' + fmt(m.de421)); console.log('vs DE421 (own ΔT):\n  ' + fmt(m.de421OwnDT));
  console.log('moon phase max |Δk| vs ephem', m.phase.toFixed(5)); console.log('stars vs DE421/skyfield', m.stars.max.toFixed(2) + '"', 'n=' + m.stars.n, m.stars.w);
  console.log('ancient vs ephem (same ΔT), max arcsec', JSON.stringify(Object.fromEntries(Object.entries(m.ancient).map(([k, v]) => [k, +v.toFixed(1)]))));
  console.log('rise/set vs ephem, max seconds', JSON.stringify(Object.fromEntries(Object.entries(m.riseSet).map(([k, v]) => [k, +v.toFixed(1)]))));
}
