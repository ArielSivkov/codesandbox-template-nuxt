// node --test style-kernel/test/    (Node ≥ 18; no dependencies)
// Judge: PyEphem 4.2.1 values in reference.json (regenerate: python3 -I style-kernel/tools/make_reference.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../sky.js';

const here = new URL('.', import.meta.url);
const REF = JSON.parse(fs.readFileSync(new URL('reference.json', here), 'utf8'));
const STYLE = JSON.parse(fs.readFileSync(new URL('../style.json', here), 'utf8'));
const ASHDOD = { lat: 31.8014, lon: 34.6435, elevation: 10 };
const TOL = { sunDeg: 0.2, moonDeg: 0.7, illum: 0.015, riseSetMin: 2, moonTimesMin: 3, phaseMin: 5 };
const azDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
const placeOf = c => (c.place === 'ashdod' ? ASHDOD : { lat: c.lat, lon: c.lon, elevation: c.elev });
const minutes = (a, b) => Math.abs(Date.parse(a) - b.getTime()) / 60000;
const localNoon = (ymd, offMin) => Date.parse(ymd + 'T12:00:00Z') - offMin * 60000;

test('reference covers ≥ 40 timestamps across a year, incl. the artwork moment', () => {
  const ashdod = REF.positions.filter(p => p.place === 'ashdod');
  assert.ok(ashdod.length >= 40, `only ${ashdod.length}`);
  const months = new Set(ashdod.map(p => p.iso.slice(5, 7)));
  assert.equal(months.size, 12, 'all 12 months');
  assert.ok(REF.positions.some(p => p.iso === '2026-11-23T20:30:00Z'));
});

test(`sun alt/az within ${TOL.sunDeg}° of PyEphem (${REF.positions.length} cases, 6 places)`, () => {
  let worst = { alt: 0, az: 0, app: 0 };
  for (const c of REF.positions) {
    const s = S.sunPosition(c.iso, placeOf(c));
    const dAlt = Math.abs(s.alt - c.sun.alt), dAz = azDiff(s.az, c.sun.az);
    assert.ok(dAlt <= TOL.sunDeg, `${c.id}: sun alt ${s.alt} vs ${c.sun.alt}`);
    if (c.sun.alt < 89) assert.ok(dAz <= TOL.sunDeg, `${c.id}: sun az ${s.az} vs ${c.sun.az}`);
    if (c.sun.alt > -1) { const dApp = Math.abs(s.altApparent - c.sun.altApparent); assert.ok(dApp <= TOL.sunDeg, `${c.id}: apparent ${dApp}`); worst.app = Math.max(worst.app, dApp); }
    worst = { ...worst, alt: Math.max(worst.alt, dAlt), az: Math.max(worst.az, dAz) };
  }
  console.log('  sun worst (deg):', worst);
});

test(`moon alt/az within ${TOL.moonDeg}°, illumination within ${TOL.illum * 100}%`, () => {
  let worst = { alt: 0, az: 0, illum: 0, distKm: 0 };
  for (const c of REF.positions) {
    const m = S.moonPosition(c.iso, placeOf(c));
    const dAlt = Math.abs(m.alt - c.moon.alt), dAz = azDiff(m.az, c.moon.az), dI = Math.abs(m.illumination - c.moon.illumination);
    assert.ok(dAlt <= TOL.moonDeg, `${c.id}: moon alt ${m.alt} vs ${c.moon.alt}`);
    if (c.moon.alt < 89) assert.ok(dAz <= TOL.moonDeg, `${c.id}: moon az ${m.az} vs ${c.moon.az}`);
    assert.ok(dI <= TOL.illum, `${c.id}: illumination ${m.illumination} vs ${c.moon.illumination}`);
    if (c.moon.alt > -1) assert.ok(Math.abs(m.altApparent - c.moon.altApparent) <= TOL.moonDeg, `${c.id}: moon apparent alt`);
    assert.ok(Math.abs(m.distanceKm - c.moon.distanceKm) < 300, `${c.id}: distance ${m.distanceKm} vs ${c.moon.distanceKm}`);
    worst = { alt: Math.max(worst.alt, dAlt), az: Math.max(worst.az, dAz), illum: Math.max(worst.illum, dI), distKm: Math.max(worst.distKm, Math.abs(m.distanceKm - c.moon.distanceKm)) };
  }
  console.log('  moon worst:', worst);
});

test('the artwork moment: 23.11.2026 22:30 Israel — moon ~98.95% lit at ~80.6°', () => {
  const at = '2026-11-23T20:30:00Z';
  assert.equal(S.israelOffsetMinutes(at), 120);
  const m = S.moonPosition(at);   // default place = Ashdod
  assert.ok(Math.abs(m.illumination - 0.9895) <= TOL.illum, String(m.illumination));
  assert.ok(Math.abs(m.alt - 80.6) <= TOL.moonDeg, String(m.alt));
  assert.ok(m.waxing, 'waxing (full moon is 24.11 16:53)');
  assert.equal(m.phase.he, 'ירח מלא');
  const p = S.moonPhases('2026-11-20T00:00:00Z');
  assert.ok(Math.abs(p.fullMoon - Date.parse('2026-11-24T14:53:00Z')) / 60000 <= TOL.phaseMin, p.fullMoon.toISOString());
});

test('sunrise 24.11.2026 ≈ 06:17, sunset ≈ 16:39 (Ashdod, local time)', () => {
  const t = S.sunTimes('2026-11-24T10:00:00Z');
  assert.equal(t.date, '2026-11-24');
  const lt = d => S.localTime(d); const mins = d => lt(d).h * 60 + lt(d).min + lt(d).s / 60;
  assert.ok(Math.abs(mins(t.sunrise) - (6 * 60 + 17)) <= TOL.riseSetMin, t.local.sunrise);
  assert.ok(Math.abs(mins(t.sunset) - (16 * 60 + 39)) <= TOL.riseSetMin, t.local.sunset);
  assert.equal(t.local.solarNoon, '11:28');
  assert.ok(t.list.length >= 15 && t.list.every((e, i, a) => i === 0 || a[i - 1].time <= e.time), 'sorted Hebrew list');
});

test(`sun times (rise/set, noon, 3 twilights) within ${TOL.riseSetMin} min on ${REF.sunTimes.length} days`, () => {
  let worst = 0;
  for (const d of REF.sunTimes) {
    const opts = d.place === 'ashdod' ? { ...ASHDOD } : { lat: d.lat, lon: d.lon, elevation: d.elev, tz: d.tzOffsetMinutes };
    const t = S.sunTimes(localNoon(d.date, d.tzOffsetMinutes), opts);
    assert.equal(t.date, d.date, `${d.place} ${d.date}: local day`);
    for (const [k, v] of Object.entries(d.ref)) {
      if (v == null) { assert.equal(t[k], null, `${d.place} ${d.date} ${k}: expected none, got ${t[k] && t[k].toISOString()}`); continue; }
      assert.ok(t[k] instanceof Date, `${d.place} ${d.date} ${k}: expected ${v}, got none`);
      const e = minutes(v, t[k]); worst = Math.max(worst, e);
      assert.ok(e <= TOL.riseSetMin, `${d.place} ${d.date} ${k}: ${t[k].toISOString()} vs ${v} (${e.toFixed(2)} min)`);
    }
  }
  console.log('  sun times worst (min):', worst.toFixed(3));
});

test(`moonrise / moonset / transit within ${TOL.moonTimesMin} min (extra)`, () => {
  for (const d of REF.moonTimes) {
    const t = S.moonTimes(localNoon(d.date, S.israelOffsetMinutes(Date.parse(d.date + 'T10:00:00Z'))), ASHDOD);
    for (const k of ['rise', 'set', 'transit']) {
      if (d.ref[k] == null) { assert.equal(t[k], null, `${d.date} ${k}`); continue; }
      assert.ok(minutes(d.ref[k], t[k]) <= TOL.moonTimesMin, `${d.date} ${k}: ${t[k] && t[k].toISOString()} vs ${d.ref[k]}`);
    }
  }
});

test(`principal moon phases within ${TOL.phaseMin} min (extra)`, () => {
  for (const d of REF.moonPhases) {
    const p = S.moonPhases(d.from);
    for (const k of ['newMoon', 'firstQuarter', 'fullMoon', 'lastQuarter']) assert.ok(minutes(d[k], p[k]) <= TOL.phaseMin, `${d.from} ${k}: ${p[k].toISOString()} vs ${d[k]}`);
  }
});

test('Israel time zone rule matches zoneinfo (DST edges 2025–2030)', () => {
  for (const z of REF.israelOffset) assert.equal(S.israelOffsetMinutes(z.iso), z.offsetMinutes, z.iso);
});

test('polar day/night handled (Tromsø): nulls, not garbage', () => {
  const winter = S.sunTimes(Date.UTC(2026, 11, 21, 11), { lat: 69.6492, lon: 18.9553, tz: 60 });
  assert.equal(winter.sunrise, null); assert.equal(winter.polar, 'polar-night'); assert.equal(winter.dayLengthMinutes, 0);
  const summer = S.sunTimes(Date.UTC(2026, 5, 21, 10), { lat: 69.6492, lon: 18.9553, tz: 120 });
  assert.equal(summer.sunset, null); assert.equal(summer.polar, 'midnight-sun'); assert.equal(summer.dayLengthMinutes, 1440);
});

// ───────────────────────── style kernel ─────────────────────────
test('sky.js LIGHT mirrors style.json "light" exactly; versions match', () => {
  assert.deepEqual(S.LIGHT, STYLE.light);
  assert.equal(STYLE.version, S.VERSION);
});

test('style.json satisfies its own schema (required keys, types, hex format)', () => {
  const sc = STYLE.schema;
  assert.equal(sc.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.ok(typeof sc.description === 'string' && sc.description.length > 40);
  for (const k of sc.required) assert.ok(k in STYLE, 'missing ' + k);
  for (const [k, p] of Object.entries(sc.properties)) {
    if (!(k in STYLE)) continue;
    const v = STYLE[k], t = Array.isArray(v) ? 'array' : typeof v;
    assert.equal(t, p.type, `${k}: ${t} ≠ ${p.type}`);
    if (p.pattern) assert.match(v, new RegExp(p.pattern), k);
    for (const r of p.required || []) assert.ok(r in v, `${k}.${r} missing`);
    if (p.items && p.items.required) for (const it of v) for (const r of p.items.required) assert.ok(r in it, `${k}[].${r}`);
  }
  const bad = [];
  (function walk(o, path) {
    if (typeof o === 'string') { if (o.startsWith('#') && /^#[0-9A-Fa-f]+$/.test(o) && !/^#[0-9A-F]{6}$/.test(o)) bad.push(path + '=' + o); return; }
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path + '.' + k);
  })(STYLE, '');
  assert.deepEqual(bad, [], 'every colour is uppercase #RRGGBB');
});

test('the 7 rules, the sacred rule and the truth/privacy lists are present', () => {
  assert.equal(STYLE.rules.length, 7);
  assert.deepEqual(STYLE.rules.map(r => r.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(STYLE.rules[0].id, 'truth', 'truth comes first');
  assert.equal(STYLE.sacred.rule_he, 'דבר קדוש לא נמכר');
  assert.ok(STYLE.rules.some(r => r.he === 'דבר קדוש לא נמכר'));
  assert.ok(STYLE.truth.length >= 5 && STYLE.privacy.length >= 4 && STYLE.digitalAssets.rules.length >= 5);
  assert.ok(STYLE.truth.some(s => s.includes('משוער')) && STYLE.truth.some(s => s.includes('±')));
  assert.ok(STYLE.truth.some(s => s.includes('Google 3D Tiles')) && STYLE.truth.some(s => s.includes('ODbL')));
});

test('every material is labelled "השראה, לא מדידה"', () => {
  const items = Object.entries(STYLE.materials.items);
  assert.ok(items.length >= 7);
  for (const want of ['jerusalem_stone', 'plaster', 'concrete', 'sand', 'sea', 'port_steel', 'greenery']) assert.ok(STYLE.materials.items[want], want);
  for (const [k, m] of items) { assert.equal(m.label_he, 'השראה, לא מדידה', k); assert.equal(m.measured, false, k); }
});

test('focus accent is reserved and the calm roles fit the 35% brightness budget', () => {
  const F = STYLE.palette.focus, budget = STYLE.composition.brightnessBudget.othersMaxFractionOfFocus;
  assert.equal(STYLE.composition.focalElements, 1); assert.equal(budget, 0.35);
  assert.ok(F.reserved.includes('#FFC86B'));
  const limit = budget * S.luminance(F.night.core), bg = '#08102A';
  for (const [k, r] of Object.entries(STYLE.palette.roles)) {
    for (const v of ['night', 'dawn', 'day', 'dusk']) if (r[v]) assert.ok(!F.reserved.includes(r[v]), `${k}.${v} uses a reserved focus colour`);
    if (r.maxAlphaNight == null) continue;
    const y = S.luminance(r.night), yb = S.luminance(bg), composite = yb + r.maxAlphaNight * (y - yb);
    assert.ok(composite <= limit + 1e-9, `${k}: Y ${composite.toFixed(3)} at α${r.maxAlphaNight} > ${limit.toFixed(3)}`);
  }
  // nothing in the light model may use the reserved focus colours
  assert.ok(!JSON.stringify(STYLE.light).match(/#FFC86B|#FFF6E0|#FFFDF6/), 'sky/sunset never borrows the focus colours');
});

test('skyColors at the artwork moment reproduces the artwork night (#08102A → #16224A)', () => {
  const k = S.skyColors('2026-11-23T20:30:00Z');
  assert.equal(k.phase.id, 'night');
  const close = (a, b) => S.hexToRgb(a).every((v, i) => Math.abs(v - S.hexToRgb(b)[i]) <= 3);
  assert.ok(close(k.stops[0].hex, '#08102A'), k.stops[0].hex);
  assert.ok(close(k.stops[3].hex, '#16224A'), k.stops[3].hex);
  assert.equal(k.focus.mode, 'emissive'); assert.equal(k.sunLight.intensity, 0);
  assert.ok(k.moon.visible && k.moonFactor > 0.95);
  assert.ok(k.windowLightProbability > 0.3 && k.windowLightProbability < 0.6);
});

test('skyColors through 24.11.2026: phases in order, smooth, monotonic dawn, deterministic', () => {
  const t0 = Date.parse('2026-11-23T22:00:00Z');
  let prev = null, maxJump = 0; const seen = [];
  for (let i = 0; i <= 1440; i++) {   // every minute of the local day: no jumps anywhere
    const k = S.skyColors(t0 + i * 60000);
    if (seen[seen.length - 1] !== k.phase.id) seen.push(k.phase.id);
    if (prev) for (let s = 0; s < 4; s++) { const a = S.hexToRgb(prev.stops[s].hex), b = S.hexToRgb(k.stops[s].hex); maxJump = Math.max(maxJump, ...a.map((v, j) => Math.abs(v - b[j]))); }
    prev = k;
  }
  assert.deepEqual(seen, ['night', 'astronomical', 'nautical', 'civil', 'golden', 'day', 'golden', 'civil', 'nautical', 'astronomical', 'night']);
  assert.ok(maxJump <= 8, `largest 1-minute step ${maxJump}/255`);
  const noon = S.skyColors('2026-11-24T09:40:00Z');   // 11:40 local, just after solar noon (11:28)
  assert.equal(noon.phase.id, 'day'); assert.equal(noon.focus.mode, 'ink'); assert.equal(noon.windowLightProbability, 0);
  assert.ok(S.luminance(noon.stops[3].hex) > S.luminance(noon.stops[0].hex), 'by day the horizon is brighter than the zenith');
  assert.equal(noon.variant, 'dusk'); assert.equal(S.skyColors('2026-11-24T05:00:00Z').variant, 'dawn');
  let lum = -1;
  // from nautical dawn on, the zenith only brightens (earlier, the setting moon may dim it a hair — that is real)
  for (let m = 0; m <= 100; m += 5) { const y = S.luminance(S.skyColors(Date.parse('2026-11-24T03:00:00Z') + m * 60000).stops[0].hex); assert.ok(y >= lum - 2e-4, 'dawn zenith brightens'); lum = y; }
  assert.deepEqual(S.skyColors('2026-11-24T15:10:00Z'), S.skyColors('2026-11-24T15:10:00Z'));
});

test('seededRandom is deterministic and key-sensitive', () => {
  const a = S.seededRandom('parcel:1|2026-11-24'), b = S.seededRandom('parcel:1|2026-11-24'), c = S.seededRandom('parcel:2|2026-11-24');
  const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b), sc = Array.from({ length: 5 }, c);
  assert.deepEqual(sa, sb); assert.notDeepEqual(sa, sc);
  assert.ok(sa.every(x => x >= 0 && x < 1));
});

test('brightnessBudget: passes a calm frame, fails a second bright element', () => {
  const W = 120, H = 60, mk = () => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
  const paint = (img, x0, x1, y0, y1, hex) => { const c = S.hexToRgb(hex); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * W + x) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; } };
  const isFocal = (x) => x >= 100 && x < 104;
  const calm = mk(); paint(calm, 0, W, 0, H, '#08102A'); paint(calm, 100, 104, 0, H, '#FFF6E0'); paint(calm, 10, 40, 20, 40, '#6F7A9C');
  assert.ok(S.brightnessBudget(calm, isFocal).pass);
  const loud = mk(); paint(loud, 0, W, 0, H, '#08102A'); paint(loud, 100, 104, 0, H, '#FFF6E0'); paint(loud, 10, 40, 10, 50, '#F6EBD2');
  const r = S.brightnessBudget(loud, isFocal); assert.equal(r.pass, false); assert.ok(r.ratio > 0.35);
});

test('works without Intl and without a DOM (Workers-safe surface)', () => {
  const src = fs.readFileSync(new URL('../sky.js', here), 'utf8');
  assert.ok(!/\bimport\s/.test(src.replace(/^\s*\/\/.*$/gm, '')), 'no imports');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  assert.ok(!/\b(document|window|process|navigator)\s*\.|\b(require|fetch)\s*\(/.test(code), 'no host globals');
  const saved = globalThis.Intl;
  try { globalThis.Intl = undefined; const t = S.sunTimes('2026-07-01T12:00:00Z'); assert.equal(S.localTime(t.sunrise).offsetMinutes, 180); }
  finally { globalThis.Intl = saved; }
});

test('roleColor blends palette variants without jumps; street lamps warm the night', () => {
  const t0 = Date.parse('2026-11-23T22:00:00Z');
  let prev = null, maxJump = 0;
  for (let i = 0; i <= 1440; i += 2) {
    const k = S.skyColors(t0 + i * 60000);
    const w = k.weights; assert.ok(Math.abs(w.night + w.dawn + w.day + w.dusk - 1) < 1e-9, 'weights sum to 1');
    const c = S.roleColor(STYLE.palette.roles.sea_surface, k);
    if (prev) maxJump = Math.max(maxJump, ...S.hexToRgb(prev).map((v, j) => Math.abs(v - S.hexToRgb(c)[j])));
    prev = c;
  }
  assert.ok(maxJump <= 10, `sea colour jumps ${maxJump}/255 in 2 minutes`);
  const night = S.skyColors('2026-11-23T20:30:00Z'), noon = S.skyColors('2026-11-24T09:40:00Z');
  assert.equal(S.roleColor(STYLE.palette.roles.sea_surface, night), STYLE.palette.roles.sea_surface.night);
  assert.equal(S.roleColor(STYLE.palette.roles.sea_surface, noon), STYLE.palette.roles.sea_surface.day);
  assert.equal(S.roleColor(STYLE.palette.roles.city_light, noon), null, 'no city light by day');
  assert.ok(night.streetLight.on && !noon.streetLight.on);
  const plaster = STYLE.materials.items.plaster.base, lamp = S.shade(plaster, night, { lamp: 'sodium' }), dark = S.shade(plaster, night);
  assert.ok(S.luminance(lamp) > 4 * S.luminance(dark), 'a lamp lights the wall');
  const [r, , b] = S.hexToRgb(lamp); assert.ok(r > b, 'sodium is warm');
  assert.equal(S.shade(plaster, noon, { lamp: 'sodium' }), S.shade(plaster, noon), 'lamps are off by day');
});
