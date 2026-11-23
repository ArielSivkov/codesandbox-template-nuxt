import test from 'node:test'; import assert from 'node:assert/strict';
import { itmToWgs, wgsToItm, LocalFrame } from '../src/geo.js';
import { sunLocal } from '../src/sun.js';
// reference: pyproj 3.8 / PROJ, EPSG:2039 → EPSG:4326 (always_xy)
const REF = [[166265, 634406, 31.801149801965853, 34.642748502427935], [219529.584, 626907.39, 31.734763036508706, 35.20521378192299],
  [178000, 665000, 32.07753029724034, 34.76535514695796], [200000, 740000, 32.754431522801376, 34.99682393817974],
  [193000, 385000, 29.552478714950375, 34.931461496294816], [240000, 560000, 31.131151908877875, 35.41984027141249]];
test('ITM ↔ WGS84 matches pyproj within 0.5 m (Ashdod, Tel Aviv, Haifa, Eilat, Dead Sea)', () => {
  for (const [E, N, lat, lon] of REF) {
    const g = itmToWgs(E, N); const dN = (g.lat - lat) * 110900, dE = (g.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180);
    assert.ok(Math.hypot(dN, dE) < 0.5, `inv ${E},${N}: ${dN.toFixed(2)},${dE.toFixed(2)} m`);
    const b = wgsToItm(lat, lon); assert.ok(Math.hypot(b.E - E, b.N - N) < 0.5, `fwd ${b.E - E},${b.N - N}`);
  }
});
test('local frame = ITM − origin inside the city (< 0.5 m within 5 km), Earth drops by d²/2R', () => {
  const F = new LocalFrame();
  for (const [dE, dN] of [[3000, 0], [0, 4000], [-4000, -3000], [2500, -2500]]) {
    const g = itmToWgs(F.E0 + dE, F.N0 + dN), p = F.llaToLocal(g.lat, g.lon, 0);
    assert.ok(Math.hypot(p.x - dE, p.z + dN) < 0.5, `${dE},${dN} → ${p.x},${p.z}`);
    const d2 = dE * dE + dN * dN; assert.ok(Math.abs(p.y + d2 / (2 * F.R)) < 0.2, `drop ${p.y}`);
  }
  assert.ok(Math.abs(F.gamma - -0.296) < 0.01, `γ ${F.gamma}`);
});
test('sun vector in the local frame points at the NOAA subsolar point (terminator correct to < 0.05°)', () => {
  const F = new LocalFrame();
  for (const iso of ['2026-11-23T12:00:00Z', '2026-06-21T05:30:00Z', '2026-03-20T16:10:00Z']) {
    const s = sunLocal(Date.parse(iso), F), D = Math.PI / 180, la = s.subsolar.lat * D, lo = s.subsolar.lon * D;
    const e = F.dirToLocal(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
    const ang = Math.acos(Math.min(1, e.x * s.dir.x + e.y * s.dir.y + e.z * s.dir.z)) / D;
    assert.ok(ang < 0.05, `${iso}: ${ang}°`);
  }
});
