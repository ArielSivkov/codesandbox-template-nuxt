import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/hebrew.js';
import { measureHebrew } from '../tools/measure_zmanim.mjs';
test('400 random dates AM 1 … CE 3000 identical to python convertdate; 200 molads identical to KosherJava (zmanim)', () => {
  const m = measureHebrew(); assert.equal(m.bad, 0); assert.equal(m.badM, 0); assert.equal(m.dates, 400); assert.equal(m.molads, 200);
});
test('known dates: 1 Tishrei 5787 = 2026-09-12, 23 Nov 2026 = י״ג בכסלו ה׳תשפ״ז, 15 Nisan 5786 = 2026-04-02', () => {
  assert.equal(H.jdFromRd(H.newYear(5787)), 2461295.5);
  assert.equal(H.hebrewDate(2461367.6).text, 'י״ג בכסלו ה׳תשפ״ז');
  assert.equal(H.jdFromRd(H.rdFromHebrew(5786, 1, 15)), 2461132.5);
});
test('molad BaHaRaD (Tishrei AM 1) = Monday 5 h 204 parts; molad Tishrei 5787 day/hours/parts', () => {
  const m = H.molad(1, 7); assert.equal(m.dow, 1); assert.equal(m.hours, 5); assert.equal(m.chalakim, 204);
});
test('gematria', () => { assert.equal(H.gematria(15), 'ט״ו'); assert.equal(H.gematria(16), 'ט״ז'); assert.equal(H.gematria(5787, true), 'ה׳תשפ״ז'); assert.equal(H.gematria(1), 'א׳'); });
