/* vegetation.js — מחלקת הצמחייה של עולם 27 (לוח היזם – עולם תאום של ישראל)
   מודול ES ללא נכסים חיצוניים. מקבל את THREE מבחוץ (התאמה ל-window.THREE של המשחק, r186).

   import { createVegetation } from './vegetation.js';
   const veg = createVegetation(THREE, { renderer, scene, origin: { OX, OY }, heightAt: (x, z) => y, budget: 'phone' });
   veg.addTile(key, greenJson);            // tiles/g/<key>.json.gz (פענוח JSON) – עצים + כיסוי קרקע
   veg.fillSlots(key, slots);              // משבצות עצים ממחלקת התחבורה (אופציונלי)
   veg.applyGroundCover(mesh, key);        // צובע רשת קרקע קיימת: דשא/חול/חולית לפי כיסוי הקרקע
   veg.setDate(new Date());                // עונה: פריחה, נשירה, שלכת, דשא רדום
   veg.setWind({ x, y, z });               // weather.js wind_vec (x=מזרח, y=למעלה, z=דרום), מ/ש
   veg.update(camera, dt);                 // כל פריים: LOD + זמן לרוח
   veg.stats();                            // { drawCalls, tris, near, far, plants, tiles }

   צירים: סצנה x = E − OX, z = −(N − OY), y = למעלה (כמו swarm/game/js/world.js).
   LOD: רשת מלאה קרוב → כרטיס (impostor) מאטלס שנאפה בזמן ריצה → כלום. צל רק לרשת הקרובה.
   opts.flora (גדוד הצמחייה, 24.11.2026 — integration/world/js/flora.js): מודלים מכרטיסי עלים + גזע מעוגל עם קליפה, אטלס עלים+normal,
   תאורת לילה/פנסים, צל רק לעצים קרובים. בלי opts.flora — המודלים המצולעים הישנים (תאימות לאחור, demo.html).
   תקציב: ≤ 3 קריאות ציור למין (קרוב + צל קרוב + רחוק), סכום משולשים בטווח ראייה ≤ budget.tris. */
import SPECIES_DB from './species.data.js';

export const LC = { NONE: 0, LAWN: 1, PARK: 2, WOOD: 3, SCRUB: 4, SAND: 5, BEACH: 6, DUNE: 7, FARM: 8, ORCHARD: 9,
  CEMETERY: 10, PITCH: 11, GARDEN: 12, MEADOW: 13, SEA: 14, MOBILE: 15 };
export const EST = 0x80;
export const SRC_HE = ['OSM עץ בודד', 'OSM שורת עצים', 'משבצת תחבורה', 'משבצת רחוב משוערת', 'לפי פוליגון OSM', 'כיסוי קרקע משוער', 'NDVI'];
export const BUDGETS = {
  phone: { tris: 30000, nearTris: 23000, farMax: 3500, near: 150, far: 1100, shrubNear: 70, dwarfNear: 60, shadows: true, atlasCell: 128 },
  desktop: { tris: 160000, nearTris: 130000, farMax: 15000, near: 260, far: 2200, shrubNear: 140, dwarfNear: 90, shadows: true, atlasCell: 192 },
};
// עם flora (כרטיסי עלים): מרחק הרשת הקרובה קצר יותר — הכרטיס הרחוק נאפה מאותו מודל ונראה כמעט אותו דבר, והחיסכון הולך לפרטים מקרוב
export const FLORA_BUDGETS = {
  phone: { nearTris: 26000, near: 120, palmNear: 70, shrubNear: 55, dwarfNear: 40 },
  desktop: { nearTris: 60000, near: 170, palmNear: 95, shrubNear: 90, dwarfNear: 60, atlasCell: 256 },
};
export { SPECIES_DB };

// ------------------------------------------------------------------ phenology (pure, testable)
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** monthly value table (12) sampled at a date, linear between mid-months */
export function monthly(arr, date) {
  const d = date instanceof Date ? date : new Date(date);
  const m = d.getUTCMonth(), day = d.getUTCDate();
  const f = m + (day - 0.5) / MDAYS[m] - 0.5;           // 0 = mid-January
  const i0 = Math.floor(f), t = f - i0;
  const a = arr[(i0 + 12) % 12], b = arr[(i0 + 13) % 12];
  return a + (b - a) * t;
}
/** season state of one species at a date: leaf 0..1, flower 0..1, autumn 0..1 (leaf colouring before drop) */
export function phenology(sp, date) {
  const leaf = monthly(sp.leaf, date), flower = monthly(sp.flower, date);
  const d = date instanceof Date ? date : new Date(date);
  const next = monthly(sp.leaf, new Date(d.getTime() + 30 * 864e5));
  const autumn = sp.autumn_c ? Math.min(1, Math.max(0, (leaf - next) * 2.5)) : 0;
  return { leaf, flower, autumn };
}
export function lawnGreen(date) { return monthly(SPECIES_DB.ground.lawn.green, date); }

// ------------------------------------------------------------------ green tile decoding (pure)
function b64bytes(s) {
  if (typeof atob === 'function') { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  return new Uint8Array(Buffer.from(s, 'base64'));
}
/** tiles/g JSON -> { key, ox, oy, lc: Uint8Array(100*100, row0=north), n, E,N (Float64), code[], h, src } */
export function decodeGreenTile(g) {
  const t = g.t || [], n = (t.length / 5) | 0;
  const E = new Float64Array(n), N = new Float64Array(n), h = new Float32Array(n), sp = new Uint8Array(n), src = new Uint8Array(n);
  for (let i = 0; i < n; i++) { E[i] = g.o[0] + t[i * 5] / 10; N[i] = g.o[1] + t[i * 5 + 1] / 10; sp[i] = t[i * 5 + 2]; h[i] = t[i * 5 + 3] / 10; src[i] = t[i * 5 + 4]; }
  return { key: g.k, ox: g.o[0], oy: g.o[1], step: g.lc_step || 10, lc: g.lc ? b64bytes(g.lc) : g.lc === null ? null : new Uint8Array(10000), n, E, N, h, sp, src, codes: g.sp || [], stats: g.stats || {} };
}
/** street-tree slot -> species code. Deterministic: one species per street (85%), mixed 15%. */
export function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hashXY(x, y, salt) { let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) + salt * 374761393, 0x27d4eb2f); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; }
export function pickWeighted(pal, u) {
  const ks = Object.keys(pal).filter(k => k[0] !== '_'); let tot = 0; for (const k of ks) tot += pal[k];
  let acc = 0; for (const k of ks) { acc += pal[k] / tot; if (u < acc) return k; } return ks[ks.length - 1];
}
export function slotSpecies(slot) {
  const key = 'street_c' + Math.max(1, Math.min(3, slot.cls | 0 || 1)), pal = SPECIES_DB.palettes[key];
  const street = slot.street || `${Math.floor(slot.E / 200)}_${Math.floor(slot.N / 200)}`;
  const mix = hashXY(slot.E * 10, slot.N * 10, 3);
  return pickWeighted(pal, mix > 0.15 ? (hash32(street + key) % 100000) / 100000 : hashXY(slot.E, slot.N, 4));
}

// ------------------------------------------------------------------ procedural low-poly models
function rngF(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** builds a species model. Returns { geo, tris, H, box:{w,h,cy} }. Attributes: position, normal, color (AO grey),
    aPart (0 wood, 1 crown, 2 fruit, 3 dry frond), aCenter (collapse point), aBend (0 ground → 1 top), aMask (flower dither) */
export function buildSpeciesGeometry(THREE, sp) {
  const R = rngF(hash32(sp.code));
  const H = (sp.h[0] + sp.h[1]) / 2, CW = (sp.crown[0] + sp.crown[1]) / 2;
  const P = [], Nn = [], C = [], PART = [], CEN = [], MASK = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const vmask = p => { const q = Math.sin(p.x * 1.9 + p.y * 2.3) * 0.5 + Math.sin(p.z * 2.1 - p.y * 1.3 + p.x * 0.7) * 0.5; return Math.min(1, Math.max(0, 0.5 + q * 0.45 + (hashXY(Math.round(p.x * 3), Math.round(p.z * 3) + Math.round(p.y * 3) * 7919, 21) - 0.5) * 0.3)); };
  function tri(a, b, c, part, cen, ao, nrm) {
    const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const p of [a, b, c]) {
      const m = vmask(p);
      P.push(p.x, p.y, p.z);
      let n = fn;
      if (nrm) { n = nrm(p).normalize(); }
      Nn.push(n.x, n.y, n.z);
      const g = ao(p); C.push(g, g, g); PART.push(part); CEN.push(cen.x, cen.y, cen.z); MASK.push(m);
    }
  }
  // tapered cylinder segment (wood)
  function limb(a, b, r0, r1, sides, part = 0) {
    const axis = new THREE.Vector3().subVectors(b, a), len = axis.length(); axis.normalize();
    const t = Math.abs(axis.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, t).normalize(), w = new THREE.Vector3().crossVectors(axis, u);
    const ring = (c, r) => Array.from({ length: sides }, (_, i) => { const th = i / sides * Math.PI * 2; return c.clone().addScaledVector(u, Math.cos(th) * r).addScaledVector(w, Math.sin(th) * r); });
    const A = ring(a, r0), B = ring(b, r1);
    const ao = p => 0.55 + 0.45 * Math.min(1, p.y / Math.max(1, H * 0.5));
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; tri(A[i], A[j], B[j], part, a, ao); tri(A[i], B[j], B[i], part, a, ao); }
    if (len < 0) return;
  }
  // jittered icosahedron blob (crown); normals pushed outward from blob centre (soft foliage lighting)
  const ico = (g => g.index ? g.toNonIndexed() : g)(new THREE.IcosahedronGeometry(1, 0)).getAttribute('position');
  function blob(c, rx, ry, rz, part = 1, jit = 0.18, cy0 = 0, cy1 = H) {
    const tmp = [];
    const key = v => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`, J = new Map();
    for (let i = 0; i < ico.count; i++) {
      const v = V(ico.getX(i), ico.getY(i), ico.getZ(i)), k = key(v);
      if (!J.has(k)) J.set(k, 1 + (R() - 0.5) * 2 * jit);
      const s = J.get(k); tmp.push(V(c.x + v.x * rx * s, c.y + v.y * ry * s, c.z + v.z * rz * s));
    }
    const ao = p => 0.72 + 0.4 * Math.min(1, Math.max(0, (p.y - cy0) / Math.max(0.5, cy1 - cy0))) + (p.x - c.x + p.z - c.z) / (rx + rz) * 0.05;
    const nrm = p => new THREE.Vector3().subVectors(p, c).multiply(V(1 / rx, 1 / ry, 1 / rz)).normalize().add(V(0, 0.55, 0));
    for (let i = 0; i < tmp.length; i += 3) tri(tmp[i], tmp[i + 1], tmp[i + 2], part, c, ao, nrm);
  }
  // thin double-sided strip (palm frond / grass blade): path points + widths
  function strip(pts, widths, side, part, cen) {
    const ao = p => 0.7 + 0.3 * Math.min(1, p.y / H);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], wa = widths[i], wb = widths[i + 1];
      const a0 = a.clone().addScaledVector(side, -wa), a1 = a.clone().addScaledVector(side, wa);
      const b0 = b.clone().addScaledVector(side, -wb), b1 = b.clone().addScaledVector(side, wb);
      const up = p => V(0, 1, 0).add(new THREE.Vector3().subVectors(p, cen).setY(0).normalize().multiplyScalar(0.5));
      tri(a0, b0, b1, part, cen, ao, up); tri(a0, b1, a1, part, cen, ao, up);
      tri(a0, b1, b0, part, cen, ao, up); tri(a0, a1, b1, part, cen, ao, up);   // back side
    }
  }
  const arch = sp.arch;
  if (arch === 'palm_fan' || arch === 'palm_feather') {
    const fan = arch === 'palm_fan', T = H - (fan ? 1.2 : 2.0), lean = (R() - 0.5) * (fan ? 0.4 : 1.0);
    const top = V(lean, T, lean * 0.3);
    limb(V(0, 0, 0), V(lean * 0.4, T * 0.5, lean * 0.12), fan ? 0.42 : 0.45, fan ? 0.3 : 0.4, 6);
    limb(V(lean * 0.4, T * 0.5, lean * 0.12), top, fan ? 0.3 : 0.4, fan ? 0.24 : 0.36, 6);
    const n = fan ? 13 : 18, L = fan ? CW * 0.55 : CW * 0.55;
    if (fan) {   // dry skirt (part 3)
      limb(top.clone().add(V(0, -2.2, 0)), top.clone().add(V(0, -0.2, 0)), 0.75, 0.62, 7, 3);
    }
    for (let i = 0; i < n; i++) {
      const az = i / n * Math.PI * 2 + R() * 0.3, el = fan ? (R() * 1.1 - 0.25) : (0.55 - (i % 3) * 0.35 + R() * 0.2);
      const dir = V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const side = V(-Math.sin(az), 0, Math.cos(az));
      const pts = [], wid = [], segs = fan ? 3 : 5;
      for (let s = 0; s <= segs; s++) {
        const f = s / segs, droop = fan ? f * f * 0.4 : f * f * (1.6 + R() * 0.6);
        pts.push(top.clone().addScaledVector(dir, L * f).add(V(0, -droop, 0)));
        wid.push(fan ? (s === 0 ? 0.1 : 0.35 + f * 0.6) : 0.32 * Math.sin(Math.PI * Math.min(0.95, f + 0.08)));
      }
      strip(pts, wid, side, 1, top);
    }
    if (!fan) for (let i = 0; i < 4; i++) {   // date clusters (part 2, scaled by season)
      const az = i / 4 * Math.PI * 2 + 0.4; blob(top.clone().add(V(Math.cos(az) * 0.7, -0.9, Math.sin(az) * 0.7)), 0.35, 0.55, 0.35, 2, 0.1);
    } else for (let i = 0; i < 3; i++) {
      const az = i / 3 * Math.PI * 2 + 0.2; blob(top.clone().add(V(Math.cos(az) * 1.2, -0.6, Math.sin(az) * 1.2)), 0.12, 0.6, 0.12, 2, 0.1);
    }
  } else if (arch === 'column') {
    limb(V(0, 0, 0), V(0, 1.2, 0), 0.25, 0.2, 5);
    const segs = 5;
    for (let i = 0; i < segs; i++) { const f = i / segs, y = 1 + f * (H - 1) * 0.92, r = CW * 0.5 * Math.sin(Math.PI * (0.18 + f * 0.75)); blob(V((R() - 0.5) * 0.2, y + (H / segs) * 0.45, (R() - 0.5) * 0.2), r, H / segs * 0.75, r, 1, 0.12, 0, H); }
  } else if (arch === 'broom') {          // Retama: many thin, near-leafless green-grey twigs from one base
    for (let i = 0; i < 9; i++) {
      const az = i / 9 * Math.PI * 2 + R() * 0.5, lean = 0.25 + R() * 0.45, len = H * (0.75 + R() * 0.3);
      const tip = V(Math.cos(az) * lean * len * 0.6, len, Math.sin(az) * lean * len * 0.6);
      const mid = V(tip.x * 0.45, len * 0.55, tip.z * 0.45);
      limb(V(0, 0, 0), mid, 0.09, 0.07, 3, 0); limb(mid, tip, 0.22, 0.02, 4, 1);
    }
    blob(V(0, H * 0.45, 0), CW * 0.22, H * 0.3, CW * 0.22, 1, 0.3, 0, H);
  } else if (arch === 'shrub' || arch === 'dwarf') {
    const k = arch === 'dwarf' ? 3 : 5, r = CW / 2;
    for (let i = 0; i < k; i++) {
      const az = i / k * Math.PI * 2 + R(), d = i === 0 ? 0 : r * (arch === 'dwarf' ? 0.55 : 0.45);
      const c = V(Math.cos(az) * d, H * (arch === 'dwarf' ? (i === 0 ? 0.5 : 0.38) : i === 0 ? 0.55 : 0.4), Math.sin(az) * d);
      const rr = r * (i === 0 ? (arch === 'dwarf' ? 0.6 : 0.75) : (arch === 'dwarf' ? 0.48 : 0.55));
      blob(c, rr, H * (arch === 'dwarf' ? (i === 0 ? 0.48 : 0.36) : 0.5), rr, 1, arch === 'dwarf' ? 0.3 : 0.25, 0, H);
    }
  } else if (arch === 'tussock') {
    for (let i = 0; i < 7; i++) {
      const az = i / 7 * Math.PI * 2 + R() * 0.5, lean = 0.25 + R() * 0.35, dir = V(Math.cos(az) * lean, 1, Math.sin(az) * lean).normalize();
      const base = V(Math.cos(az) * 0.08, 0, Math.sin(az) * 0.08), side = V(-Math.sin(az), 0, Math.cos(az));
      const a = base.clone().addScaledVector(side, -0.05), b = base.clone().addScaledVector(side, 0.05), tip = base.clone().addScaledVector(dir, H * (0.75 + R() * 0.3));
      const ao = p => 0.6 + 0.5 * p.y / H, nrm = () => V(0, 1, 0);
      tri(a, b, tip, 1, V(0, 0, 0), ao, nrm); tri(a, tip, b, 1, V(0, 0, 0), ao, nrm);
    }
  } else {
    // broad-leaved trees: trunk height, branches, crown blobs
    const cfg = {
      round_dense: { tr: 0.38, blobs: 5, spread: 0.32, flat: 0.75, br: 3 },
      round_wide: { tr: 0.3, blobs: 6, spread: 0.42, flat: 0.55, br: 4 },
      vase: { tr: 0.38, blobs: 5, spread: 0.38, flat: 0.55, br: 3 },
      umbrella: { tr: 0.42, blobs: 7, spread: 0.42, flat: 0.5, br: 4 },
      round_open: { tr: 0.4, blobs: 5, spread: 0.36, flat: 0.65, br: 3 },
      bottle: { tr: 0.5, blobs: 3, spread: 0.25, flat: 0.8, br: 0 },
      eucalyptus: { tr: 0.45, blobs: 5, spread: 0.3, flat: 1.1, br: 2 },
      olive: { tr: 0.32, blobs: 4, spread: 0.36, flat: 0.62, br: 2 },
      pine: { tr: 0.55, blobs: 5, spread: 0.36, flat: 0.45, br: 3 },
    }[arch] || { tr: 0.4, blobs: 5, spread: 0.35, flat: 0.7, br: 3 };
    const tH = H * cfg.tr, r0 = Math.max(0.12, H * (arch === 'bottle' ? 0.06 : 0.028)), cr = CW / 2;
    if (arch === 'bottle') { limb(V(0, 0, 0), V(0, tH * 0.35, 0), r0 * 0.8, r0 * 1.5, 7); limb(V(0, tH * 0.35, 0), V(0, tH, 0), r0 * 1.5, r0 * 0.45, 7); }
    else if (arch === 'olive') { limb(V(0, 0, 0), V(0.3, tH * 0.6, 0.1), r0 * 1.4, r0, 6); limb(V(0.3, tH * 0.6, 0.1), V(-0.2, tH, 0.2), r0, r0 * 0.7, 5); }
    else limb(V(0, 0, 0), V(0, tH, 0), r0, r0 * 0.7, 6);
    const crownMid = tH + (H - tH) * 0.5;
    for (let i = 0; i < cfg.br; i++) {   // branches into the crown (visible when leafless)
      const az = i / Math.max(1, cfg.br) * Math.PI * 2 + R() * 0.6, d = cr * (arch === 'umbrella' ? 0.7 : 0.5);
      limb(V(0, tH * 0.95, 0), V(Math.cos(az) * d, crownMid + (R() - 0.3) * (H - tH) * 0.3, Math.sin(az) * d), r0 * 0.6, r0 * 0.25, 4);
    }
    const ry = (H - tH) * 0.5 * cfg.flat + 0.3;
    for (let i = 0; i < cfg.blobs; i++) {
      const first = i === 0, az = i / (cfg.blobs - 1) * Math.PI * 2 + R() * 0.5, d = first ? 0 : cr * cfg.spread * (0.85 + R() * 0.3);
      let y = first ? crownMid + ry * 0.35 : crownMid - ry * 0.1 + (R() - 0.5) * ry * 0.6;
      if (arch === 'pine') y = tH + (H - tH) * (0.35 + 0.55 * (i / cfg.blobs)) ;
      if (arch === 'eucalyptus') y = tH + (H - tH) * (0.3 + 0.6 * R());
      const rr = cr * (first ? 0.62 : 0.5) * (arch === 'eucalyptus' ? 0.75 : 1);
      blob(V(Math.cos(az) * d, Math.min(H - ry * 0.7, y), Math.sin(az) * d), rr, ry * (first ? 1 : 0.85), rr, 1, 0.2, tH, H);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(PART, 1));
  geo.setAttribute('aCenter', new THREE.Float32BufferAttribute(CEN, 3));
  geo.setAttribute('aMask', new THREE.Float32BufferAttribute(MASK, 1));
  geo.computeBoundingBox();
  const bb = geo.boundingBox, Hm = Math.max(0.3, bb.max.y);
  const bend = new Float32Array(P.length / 3);
  for (let i = 0; i < bend.length; i++) bend[i] = Math.max(0, P[i * 3 + 1] / Hm);
  geo.setAttribute('aBend', new THREE.BufferAttribute(bend, 1));
  geo.computeBoundingSphere();
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  return { geo, tris: P.length / 9, H: Hm, box: { w, h: bb.max.y - Math.min(0, bb.min.y), cy: (bb.max.y + Math.min(0, bb.min.y)) / 2 } };
}

// ------------------------------------------------------------------ shaders (patches of Lambert / Depth / Basic)
const VEG_HEAD = `
attribute float aPart; attribute vec3 aCenter; attribute float aBend; attribute float aMask;
uniform float uTime, uLeafAmt, uFlowerAmt, uFlowerCov, uAutumnAmt, uFlex, uH;
uniform vec3 uWind, uTrunk, uLeaf, uFlower, uAutumn, uDry, uFruit;
`;
const VEG_BEGIN = `#include <begin_vertex>
{ float crownS = mix(0.22, 1.0, clamp(max(uLeafAmt, uFlowerAmt * uFlowerCov), 0.0, 1.0));
  if (aPart > 0.5 && aPart < 1.5) transformed = mix(aCenter, transformed, crownS);
  else if (aPart > 1.5 && aPart < 2.5) transformed = mix(aCenter, transformed, clamp(uFlowerAmt * 1.2, 0.0, 1.0)); }`;
const VEG_PROJECT = `
vec4 vegW = vec4(transformed, 1.0);
vec3 iO = vec3(0.0); float iS = 1.0;
#ifdef USE_INSTANCING
  vegW = instanceMatrix * vegW; iO = vec3(instanceMatrix[3]); iS = length(vec3(instanceMatrix[1]));
#endif
vegW = modelMatrix * vegW; iO = (modelMatrix * vec4(iO, 1.0)).xyz;
{ float ph = dot(iO.xz, vec2(0.071, 0.113));
  float sp = length(uWind.xz); vec2 wd = sp > 0.01 ? uWind.xz / sp : vec2(1.0, 0.0);
  float gust = 0.7 + 0.3 * sin(uTime * 0.55 + ph * 0.5) * sin(uTime * 0.21 + ph);
  float hT = max(1.0, iS * uH);
  float lean = uFlex * sp * sp * 0.0016 * gust;
  float osc = uFlex * sp * 0.012 * sin(uTime * (2.2 / sqrt(hT / 6.0)) + ph);
  float b = aBend * aBend * hT;
  vegW.xz += wd * (lean + osc) * b * 0.1;
  float leafy = (aPart > 0.5 && aPart < 2.5) ? 1.0 : 0.0;
  vegW.xyz += leafy * aBend * min(sp, 25.0) * 0.006 * uFlex * vec3(sin(uTime * 7.0 + dot(vegW.xyz, vec3(1.3, 0.7, 1.1))), 0.5 * sin(uTime * 6.1 + vegW.x * 2.0), cos(uTime * 7.7 + vegW.z * 1.7)); }
vec4 mvPosition = viewMatrix * vegW;
gl_Position = projectionMatrix * mvPosition;`;
const VEG_COLOR = `#include <color_vertex>
{ float fl = smoothstep(aMask - 0.12, aMask + 0.12, uFlowerAmt * uFlowerCov);
  vec3 leafC = mix(mix(uLeaf, uAutumn, uAutumnAmt), uFlower, fl);
  vec3 base = aPart < 0.5 ? uTrunk : (aPart < 1.5 ? leafC * 1.18 : (aPart < 2.5 ? uFruit : uDry));
  vColor.rgb *= base; }`;

function patchVeg(mat, uni, withColor, FL) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = VEG_HEAD + sh.vertexShader
      .replace('#include <begin_vertex>', VEG_BEGIN)
      .replace('#include <project_vertex>', VEG_PROJECT);
    if (withColor) sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', VEG_COLOR);
    if (FL) FL.patch(sh, { depth: !withColor });   // flora: עלים דו-צדדיים, לילה ופנסים, אלפא במרחק, צל רק לקרובים
  };
  mat.customProgramCacheKey = () => 'veg27' + (withColor ? 'c' : 'd') + (FL ? 'f' : '');
  return mat;
}
const FAR_PROJECT = `
vec3 iO = vec3(instanceMatrix[3]); float iS = length(vec3(instanceMatrix[1]));
iO = (modelMatrix * vec4(iO, 1.0)).xyz;
vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 upV = normalize(mix(vec3(0.0, 1.0, 0.0), camU, uTilt));
vec3 ctr = iO + vec3(0.0, uCy * iS, 0.0);
vec3 vegW = ctr + camR * position.x * uSize * uAspect * iS + upV * position.y * uSize * iS;   // רוחב לפי צורת העץ (דקל צר ≠ ריבוע) — פחות מילוי שקוף
vec4 mvPosition = viewMatrix * vec4(vegW, 1.0);
gl_Position = projectionMatrix * mvPosition;`;
const FAR_FLORA_FRAG = `diffuseColor.rgb *= uLight;`;   // רחוק: בלי לולאת פנסים (חיסכון במילוי); הבהירות לפי יחס התאורה (setLight)

// ------------------------------------------------------------------ ground cover textures (procedural canvas)
function canvasTex(THREE, n, draw) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null; if (!c) return null;
  c.width = c.height = n; draw(c.getContext('2d'), n);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function makeGroundTextures(THREE) {
  const R = rngF(27);
  const speck = (x, n, k, cols, rmin, rmax) => { for (let i = 0; i < k; i++) { x.fillStyle = cols[(R() * cols.length) | 0]; const r = rmin + R() * (rmax - rmin); x.beginPath(); x.ellipse(R() * n, R() * n, r, r * (0.6 + R() * 0.6), R() * 3, 0, 7); x.fill(); } };
  const grass = canvasTex(THREE, 256, (x, n) => { x.fillStyle = '#bcbcbc'; x.fillRect(0, 0, n, n); speck(x, n, 2600, ['#a9a9a9', '#cfcfcf', '#9a9a9a', '#dcdcdc'], 0.6, 2.2); for (let i = 0; i < 900; i++) { x.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)'; const a = R() * n, b = R() * n; x.beginPath(); x.moveTo(a, b); x.lineTo(a + (R() - 0.5) * 3, b - 3 - R() * 4); x.stroke(); } });
  const sand = canvasTex(THREE, 256, (x, n) => { x.fillStyle = '#c4c4c4'; x.fillRect(0, 0, n, n); for (let y = 0; y < n; y += 3) { x.strokeStyle = `rgba(${R() < 0.5 ? '255,255,255' : '90,90,90'},${0.06 + R() * 0.08})`; x.lineWidth = 1 + R(); x.beginPath(); for (let X = 0; X <= n; X += 8) x.lineTo(X, y + Math.sin(X * 0.09 + y * 0.31) * 2.2); x.stroke(); } speck(x, n, 1500, ['#b4b4b4', '#d6d6d6', '#a6a6a6'], 0.4, 1.1); });
  // dune: sand + Artemisia/Retama dots (stabilised dune cover >25% per Coastal Wiki classes) – dark specks
  const dune = canvasTex(THREE, 256, (x, n) => { x.drawImage(sand.image, 0, 0); speck(x, n, 140, ['rgba(120,110,80,0.25)'], 3, 7); speck(x, n, 700, ['rgba(80,98,50,0.75)', 'rgba(105,118,70,0.7)', 'rgba(70,85,45,0.75)'], 0.8, 2.6); });
  return { grass, sand, dune };
}
const GROUND_FRAG_HEAD = `
uniform sampler2D uSplat, uGrassT, uSandT, uDuneT; uniform vec4 uTileRect; uniform vec3 uGrassC, uSandC, uDuneC, uBeachC, uMeadowC;
uniform float uWetY; varying vec3 vVegW;
`;
const GROUND_FRAG = `#include <color_fragment>
{ vec2 tuv = vec2((vVegW.x - uTileRect.x) / uTileRect.z, (vVegW.z - uTileRect.y) / uTileRect.w);
  if (tuv.x >= 0.0 && tuv.x <= 1.0 && tuv.y >= 0.0 && tuv.y <= 1.0) {
    vec4 w = texture2D(uSplat, tuv);
    vec2 duv = vVegW.xz / 9.0;
    vec3 g = uGrassC * texture2D(uGrassT, duv).rgb * 1.25;
    vec3 s = mix(uBeachC, uBeachC * 0.78, smoothstep(uWetY + 0.6, uWetY, vVegW.y)) * texture2D(uSandT, duv * 0.7).rgb * 1.2;
    vec3 d = uDuneC * texture2D(uDuneT, duv * 0.5).rgb * 1.22;
    vec3 me = uMeadowC * texture2D(uGrassT, duv * 0.6).rgb * 1.2;
    float tot = w.r + w.g + w.b + w.a;
    vec3 mixC = (g * w.r + s * w.g + d * w.b + me * w.a) / max(tot, 1e-3);
    diffuseColor.rgb = mix(diffuseColor.rgb, mixC, clamp(tot, 0.0, 1.0));
  } }`;

// ------------------------------------------------------------------ the system
export function createVegetation(THREE, opts = {}) {
  const FL = opts.flora && opts.flora.init ? opts.flora.init() : null, bk = opts.budget === 'desktop' ? 'desktop' : 'phone';
  const B = Object.assign({}, BUDGETS[bk] || BUDGETS.phone, FL ? FLORA_BUDGETS[bk] : {}, opts.budgetOverride || {});
  const scene = opts.scene, renderer = opts.renderer;
  const OX = opts.origin ? opts.origin.OX : 0, OY = opts.origin ? opts.origin.OY : 0;
  const heightAt = opts.heightAt || (() => 0);
  const root = new THREE.Group(); root.name = 'vegetation27'; if (scene) scene.add(root);
  const SP = SPECIES_DB.species, IDX = new Map(SP.map((s, i) => [s.code, i]));
  const kinds = SP.map(s => s.arch === 'dwarf' || s.arch === 'tussock' ? 'dwarf' : s.kind === 'shrub' ? 'shrub' : 'tree');
  const isPalm = SP.map(s => s.arch === 'palm_fan' || s.arch === 'palm_feather');
  const time = { value: 0 }, wind = { value: new THREE.Vector3(3, 0, 0) };
  let date = opts.date ? new Date(opts.date) : new Date();
  const models = [], nearMeshes = [], farMeshes = [], uniforms = [], farUni = [];
  const col = c => new THREE.Color(c);

  // ---- per-species meshes
  for (let i = 0; i < SP.length; i++) {
    const sp = SP[i], m = FL ? FL.speciesModel(sp, bk === 'desktop') : buildSpeciesGeometry(THREE, sp); models.push(m);
    const u = { uTime: time, uWind: wind, uLeafAmt: { value: 1 }, uFlowerAmt: { value: 0 }, uFlowerCov: { value: sp.fcov || 0 },
      uAutumnAmt: { value: 0 }, uFlex: { value: sp.flex || 1 }, uH: { value: m.H },
      uTrunk: { value: col(sp.trunk_c) }, uLeaf: { value: col(sp.leaf_c) }, uFlower: { value: col(sp.flower_c) },
      uAutumn: { value: col(sp.autumn_c || sp.leaf_c) }, uDry: { value: col('#8d7a55') }, uFruit: { value: col(sp.flower_c) } };
    uniforms.push(u);
    const mat = patchVeg(FL ? new THREE.MeshLambertMaterial({ vertexColors: true, map: FL.tex.map, normalMap: opts.floraNormal === false ? null : FL.tex.normal, normalScale: new THREE.Vector2(0.9, 0.9), alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color().setScalar(FL.gain || 1.3) })
      : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }), u, true, FL);
    const near = new THREE.InstancedMesh(m.geo, mat, 16); near.count = 0; near.frustumCulled = false;
    near.castShadow = !!B.shadows && kinds[i] !== 'dwarf'; near.receiveShadow = true; near.name = 'veg-near-' + sp.code;
    near.customDepthMaterial = patchVeg(new THREE.MeshDepthMaterial(FL ? { depthPacking: THREE.RGBADepthPacking, map: FL.tex.map, alphaTest: 0.5 } : { depthPacking: THREE.RGBADepthPacking }), u, false, FL);
    near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3).fill(1), 3);
    nearMeshes.push(near); root.add(near);
  }
  // ---- impostor atlas (baked from the same models at runtime, re-baked when the season changes)
  const CELL = B.atlasCell, COLS = 8, ROWS = Math.ceil(SP.length / COLS);
  const atlas = renderer ? new THREE.WebGLRenderTarget(CELL * COLS, CELL * ROWS, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }) : null;
  const farGeo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < SP.length; i++) {
    const m = models[i], size = Math.max(m.box.w, m.box.h) * 1.04;
    const aspect = Math.min(1, Math.max(0.25, m.box.w * 1.2 / size));   // החלק הרוחבי של התא שהעץ תופס באפייה (מסובב 0.5 ראד)
    const fu = { uSize: { value: size }, uAspect: { value: aspect }, uCy: { value: m.box.cy }, uTilt: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } };
    farUni.push(fu);
    const cx = i % COLS, cy = Math.floor(i / COLS);
    const mat = new THREE.MeshBasicMaterial({ map: atlas ? atlas.texture : null, alphaTest: 0.45, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, fu, { uCell: { value: new THREE.Vector4(cx / COLS, cy / ROWS, 1 / COLS, 1 / ROWS) } });
      sh.vertexShader = 'uniform float uSize, uAspect, uCy, uTilt; uniform vec4 uCell;\n' + sh.vertexShader
        .replace('#include <project_vertex>', FAR_PROJECT)
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = uCell.xy + vec2( 0.5 + ( uv.x - 0.5 ) * uAspect, uv.y ) * uCell.zw;\n#endif');
      sh.fragmentShader = 'uniform vec3 uLight;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + (FL ? FAR_FLORA_FRAG : 'diffuseColor.rgb *= uLight;'));
      if (FL) sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', FL.ABOOST || '#include <alphatest_fragment>');
    };
    mat.customProgramCacheKey = () => 'veg27far' + (FL ? 'f' : '');
    const far = new THREE.InstancedMesh(farGeo, mat, SP[i].kind === 'tree' || SP[i].kind === 'palm' ? 64 : 16);
    far.count = 0; far.frustumCulled = false; far.castShadow = false; far.receiveShadow = false; far.name = 'veg-far-' + SP[i].code;
    farMeshes.push(far); root.add(far);
  }
  function bakeAtlas() {
    if (!renderer || !atlas) return;
    const bs = new THREE.Scene();
    bs.add(new THREE.HemisphereLight(0xdfeaff, 0x6a5a40, 1.35));
    const dl = new THREE.DirectionalLight(0xfff2dd, 2.2); dl.position.set(0.5, 1, 0.8); bs.add(dl);
    const prevT = renderer.getRenderTarget(), prevC = new THREE.Color(); renderer.getClearColor(prevC); const prevA = renderer.getClearAlpha();
    atlas.scissorTest = false; atlas.viewport.set(0, 0, CELL * COLS, CELL * ROWS);
    renderer.setRenderTarget(atlas); renderer.setClearColor(0x6f7f5a, 0); renderer.clear(true, true, true);
    const savedW = wind.value.clone(); wind.value.set(0, 0, 0); if (FL) FL.bakeDay(true);
    for (let i = 0; i < SP.length; i++) {
      const m = models[i], size = farUni[i].uSize.value, cx = i % COLS, cy = Math.floor(i / COLS);
      const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.1, 200);
      cam.position.set(0, m.box.cy, 60); cam.lookAt(0, m.box.cy, 0); cam.updateMatrixWorld();
      const mesh = new THREE.Mesh(m.geo, nearMeshes[i].material); mesh.rotation.y = 0.5; bs.add(mesh);
      // render-target viewport/scissor are in RT pixels; row 0 = bottom of the texture (GL)
      atlas.viewport.set(cx * CELL, cy * CELL, CELL, CELL); atlas.scissor.set(cx * CELL, cy * CELL, CELL, CELL); atlas.scissorTest = true;
      renderer.setRenderTarget(atlas); renderer.render(bs, cam); bs.remove(mesh);
    }
    atlas.scissorTest = false; atlas.viewport.set(0, 0, CELL * COLS, CELL * ROWS);
    wind.value.copy(savedW); if (FL) FL.bakeDay(false);
    renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA);
  }

  // ---- season
  let lawnTint = 1, bakeKey = '';
  function setDate(d) {
    date = new Date(d); let key = '';
    for (let i = 0; i < SP.length; i++) { const p = phenology(SP[i], date); uniforms[i].uLeafAmt.value = p.leaf; uniforms[i].uFlowerAmt.value = p.flower; uniforms[i].uAutumnAmt.value = p.autumn; key += p.leaf.toFixed(2) + p.flower.toFixed(2) + p.autumn.toFixed(2); }
    lawnTint = lawnGreen(date);
    const L = SPECIES_DB.ground.lawn; groundU.uGrassC.value.copy(col(L.c_dormant)).lerp(col(L.c), lawnTint);
    const Me = SPECIES_DB.ground.meadow; groundU.uMeadowC.value.copy(col(Me.c_dry)).lerp(col(Me.c), monthly(Me.green, date));
    if (key !== bakeKey) { bakeKey = key; bakeAtlas(); }   // אפייה מחדש רק כשהעונה זזה (setDate נקרא כל 5–15 ש')
  }

  // ---- ground cover
  const gtex = typeof document !== 'undefined' ? makeGroundTextures(THREE) : null;
  const groundU = { uGrassC: { value: col(SPECIES_DB.ground.lawn.c) }, uSandC: { value: col(SPECIES_DB.ground.mobile_dune.c) },
    uDuneC: { value: col(SPECIES_DB.ground.dune.c) }, uMeadowC: { value: col(SPECIES_DB.ground.meadow.c) }, uBeachC: { value: col(SPECIES_DB.ground.beach.c) }, uWetY: { value: 0.9 },
    uGrassT: { value: gtex && gtex.grass }, uSandT: { value: gtex && gtex.sand }, uDuneT: { value: gtex && gtex.dune } };
  /** land-cover raster -> RGBA splat (R grass, G sand/beach, B dune) 100×100, linear filtered */
  function splatTexture(lc) {
    const n = Math.round(Math.sqrt(lc.length)), d = new Uint8Array(n * n * 4);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const v = lc[r * n + c] & 0x7f, o = (r * n + c) * 4;   // texture v=0 = north edge (tuv.y grows southwards)
      let g = 0, s = 0, du = 0, me = 0;
      if (v === LC.LAWN || v === LC.PARK || v === LC.PITCH || v === LC.GARDEN || v === LC.CEMETERY || v === LC.ORCHARD) g = v === LC.GARDEN ? 210 : 255;
      else if (v === LC.MEADOW) me = 255;
      else if (v === LC.WOOD || v === LC.SCRUB) { g = 140; du = 110; }
      else if (v === LC.BEACH || v === LC.SAND || v === LC.MOBILE) s = 255;
      else if (v === LC.DUNE) du = 255;
      else if (v === LC.FARM) { me = 200; s = 40; }
      d[o] = g; d[o + 1] = s; d[o + 2] = du; d[o + 3] = me;
    }
    const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  }
  function applyGroundCover(mesh, key) {
    const T = tiles.get(key); if (!T) return false;
    const base = mesh.material;
    const mat = base.clone();
    const u = Object.assign({ uSplat: { value: T.splat }, uTileRect: { value: new THREE.Vector4(T.ox - OX, -(T.oy + 1000 - OY), 1000, 1000) } }, groundU);
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'varying vec3 vVegW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvVegW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = GROUND_FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', GROUND_FRAG);
    };
    mat.customProgramCacheKey = () => 'veg27ground' + (base.customProgramCacheKey ? base.customProgramCacheKey() : '');
    mesh.material = mat; T.groundMeshes.push({ mesh, base });
    return true;
  }

  // ---- tiles
  const tiles = new Map();
  /** 10×10 cells of 100 m per tile (counting sort) so the LOD pass skips far / off-screen cells */
  function indexTile(T) {
    const cnt = new Int32Array(101), cell = new Uint8Array(T.n); let y0 = 1e9, y1 = -1e9;
    const x0 = T.ox - OX, z0 = -(T.oy + 1000 - OY);
    for (let i = 0; i < T.n; i++) {
      const c = Math.min(9, Math.max(0, ((T.X[i] - x0) / 100) | 0)), r = Math.min(9, Math.max(0, ((T.Z[i] - z0) / 100) | 0));
      cell[i] = r * 10 + c; cnt[cell[i] + 1]++; y0 = Math.min(y0, T.Y[i]); y1 = Math.max(y1, T.Y[i]);
    }
    for (let k = 0; k < 100; k++) cnt[k + 1] += cnt[k];
    const pos = cnt.slice(0, 100), idx = new Int32Array(T.n);
    for (let i = 0; i < T.n; i++) idx[pos[cell[i]]++] = i;
    T.cellStart = cnt; T.cellIdx = idx; T.x0 = x0; T.z0 = z0; T.y0 = T.n ? y0 : 0; T.y1 = T.n ? y1 + 40 : 40;
  }
  function addTile(key, g) {
    const d = g && g.t ? decodeGreenTile(g) : g;
    const n = d.n, X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), S = new Float32Array(n), SPI = new Uint8Array(n), ROT = new Float32Array(n), TINT = new Float32Array(n), HUE = new Float32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const code = d.codes[d.sp[i]], si = IDX.get(code); if (si === undefined) continue;
      const x = d.E[i] - OX, z = -(d.N[i] - OY);
      X[k] = x; Z[k] = z; Y[k] = heightAt(x, z) - 0.15; S[k] = Math.max(0.35, d.h[i] / models[si].H); SPI[k] = si;
      ROT[k] = hashXY(d.E[i] * 10, d.N[i] * 10, 9) * 6.2832; TINT[k] = 0.86 + hashXY(d.E[i] * 7, d.N[i] * 3, 11) * 0.28; HUE[k] = hashXY(d.E[i] * 5, d.N[i] * 9, 13) * 2 - 1; k++;
    }
    const T = { key, ox: d.ox, oy: d.oy, n: k, X, Y, Z, S, SPI, ROT, TINT, HUE, lc: d.lc, src: d.src, splat: d.lc ? splatTexture(d.lc) : null, groundMeshes: [], extra: [],
      cx: d.ox + 500 - OX, cz: -(d.oy + 500 - OY) };
    indexTile(T); removeTile(key); tiles.set(key, T); dirty = true; return { plants: k };
  }
  /** street-tree slots from the transport team: [{E,N,cls,street}] (ITM) or [{x,z,cls,street}] (scene)
      opts.dedupe = r (מ'): משבצת שיש לידה עץ קיים (או משבצת שכבר נוספה) ברדיוס r — מדולגת (עצי world.js שנמסרים לכאן) */
  function fillSlots(key, slots, opts) {
    const T = tiles.get(key); if (!T) return 0;
    const add = [], dd = opts && opts.dedupe ? opts.dedupe : 0, d2 = dd * dd;
    const taken = (x, z) => {
      for (const a of add) if ((a[0] - x) ** 2 + (a[2] - z) ** 2 < d2) return true;
      const c = Math.min(9, Math.max(0, ((x - T.x0) / 100) | 0)), r = Math.min(9, Math.max(0, ((z - T.z0) / 100) | 0));
      for (let rr = Math.max(0, r - 1); rr <= Math.min(9, r + 1); rr++) for (let cc = Math.max(0, c - 1); cc <= Math.min(9, c + 1); cc++) {
        const cell = rr * 10 + cc; for (let q = T.cellStart[cell]; q < T.cellStart[cell + 1]; q++) { const i = T.cellIdx[q]; if (kinds[T.SPI[i]] === 'tree' && (T.X[i] - x) ** 2 + (T.Z[i] - z) ** 2 < d2) return true; } }
      return false; };
    for (const s of slots) {
      const E = s.E !== undefined ? s.E : s.x + OX, N = s.N !== undefined ? s.N : OY - s.z;
      const code = s.species || slotSpecies({ E, N, cls: s.cls, street: s.street }), si = IDX.get(code); if (si === undefined) continue;
      const sp = SP[si], u = hashXY(E * 3, N * 3, 5), h = sp.h[0] + (sp.h[1] - sp.h[0]) * (0.15 + 0.85 * u) ** 0.9;
      let sc = h / models[si].H; if (s.maxCrown) sc = Math.min(sc, s.maxCrown / Math.max(1, models[si].box.w));
      const x = E - OX, z = -(N - OY); if (dd && taken(x, z)) continue;
      add.push([x, heightAt(x, z) - 0.15, z, sc, si, hashXY(E * 10, N * 10, 9) * 6.2832, 0.86 + u * 0.28, hashXY(E * 5, N * 9, 13) * 2 - 1]);
    }
    if (!add.length) return 0;
    const n = T.n + add.length, grow = a => { const b = new a.constructor(n); b.set(a.subarray(0, T.n)); return b; };
    ['X', 'Y', 'Z', 'S', 'SPI', 'ROT', 'TINT', 'HUE'].forEach(f => T[f] = grow(T[f]));
    add.forEach((a, j) => { const i = T.n + j; T.X[i] = a[0]; T.Y[i] = a[1]; T.Z[i] = a[2]; T.S[i] = a[3]; T.SPI[i] = a[4]; T.ROT[i] = a[5]; T.TINT[i] = a[6]; T.HUE[i] = a[7]; });
    T.n = n; indexTile(T); dirty = true; return add.length;
  }
  function removeTile(key) {
    const T = tiles.get(key); if (!T) return;
    for (const g of T.groundMeshes) { g.mesh.material.dispose(); g.mesh.material = g.base; }
    if (T.splat) T.splat.dispose(); tiles.delete(key); dirty = true;
  }

  // ---- LOD selection (CPU, throttled)
  let dirty = true, lastPos = new THREE.Vector3(1e9, 0, 0), lastDir = new THREE.Vector3(), since = 0;
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sphere = new THREE.Sphere(), cellBox = new THREE.Box3();
  const nearCount = new Int32Array(SP.length), farCount = new Int32Array(SP.length);
  const st = { drawCalls: 0, tris: 0, near: 0, far: 0, plants: 0, tiles: 0, considered: 0, ms: 0 };
  const BUCKET = 8, NB = Math.ceil(B.far / BUCKET) + 1;
  let bucketHead = new Int32Array(NB), next = new Int32Array(1024), candT = new Int32Array(1024), candI = new Int32Array(1024), candD = new Float32Array(1024);
  function ensure(mesh, need, isFar) {
    if (mesh.instanceMatrix.count >= need) return mesh;
    let cap = mesh.instanceMatrix.count; while (cap < need) cap *= 2;
    const nm = new THREE.InstancedMesh(mesh.geometry, mesh.material, cap);
    nm.count = 0; nm.frustumCulled = false; nm.castShadow = mesh.castShadow; nm.receiveShadow = mesh.receiveShadow; nm.name = mesh.name;
    nm.customDepthMaterial = mesh.customDepthMaterial;
    if (!isFar) nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    root.remove(mesh); mesh.dispose(); root.add(nm); return nm;
  }
  function select(camera) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    camera.updateMatrixWorld(); pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
    bucketHead.fill(-1); let nc = 0;
    const far2 = B.far * B.far, Tl = [...tiles.values()];
    for (let ti = 0; ti < Tl.length; ti++) {
      const T = Tl[ti]; const dx0 = Math.max(0, Math.abs(T.cx - cx) - 500), dz0 = Math.max(0, Math.abs(T.cz - cz) - 500);
      if (dx0 * dx0 + dz0 * dz0 > far2) continue;
      for (let cell = 0; cell < 100; cell++) {
        const s0 = T.cellStart[cell], s1 = T.cellStart[cell + 1]; if (s0 === s1) continue;
        const bx = T.x0 + (cell % 10) * 100, bz = T.z0 + ((cell / 10) | 0) * 100;
        const ex = Math.max(0, Math.abs(bx + 50 - cx) - 50), ez = Math.max(0, Math.abs(bz + 50 - cz) - 50);
        if (ex * ex + ez * ez > far2) continue;
        cellBox.min.set(bx - 12, T.y0, bz - 12); cellBox.max.set(bx + 112, T.y1, bz + 112);
        if (!frustum.intersectsBox(cellBox)) continue;
        for (let q = s0; q < s1; q++) {
        const i = T.cellIdx[q];
        const dx = T.X[i] - cx, dz = T.Z[i] - cz, d2 = dx * dx + dz * dz; if (d2 > far2) continue;
        const si = T.SPI[i], kd = kinds[si];
        const d = Math.sqrt(d2 + (cy - T.Y[i]) * (cy - T.Y[i]) * 0.25);
        if (kd === 'dwarf' && d > B.dwarfNear) continue;
        if (kd === 'shrub' && d > B.shrubNear * 2.5) continue;
        const m = models[si], s = T.S[i];
        sphere.center.set(T.X[i], T.Y[i] + m.box.cy * s, T.Z[i]); sphere.radius = Math.max(m.box.w, m.box.h) * 0.6 * s;
        if (!frustum.intersectsSphere(sphere)) continue;
        if (nc >= next.length) { const g = a => { const b = new a.constructor(a.length * 2); b.set(a); return b; }; next = g(next); candT = g(candT); candI = g(candI); candD = g(candD); }
        const b = Math.min(NB - 1, (d / BUCKET) | 0); candT[nc] = ti; candI[nc] = i; candD[nc] = d; next[nc] = bucketHead[b]; bucketHead[b] = nc; nc++;
        }
      }
    }
    nearCount.fill(0); farCount.fill(0);
    let nearTris = 0, farN = 0;
    // pass 1: count -> capacities
    const pick = new Uint8Array(nc);   // 0 none 1 near 2 far
    for (let b = 0; b < NB; b++) for (let c = bucketHead[b]; c !== -1; c = next[c]) {
      const T = Tl[candT[c]], i = candI[c], si = T.SPI[i], kd = kinds[si], d = candD[c];
      const palm = isPalm[si], lim = kd === 'tree' ? (palm && B.palmNear ? B.palmNear : B.near) : kd === 'shrub' ? B.shrubNear : B.dwarfNear;
      // big trees keep the mesh further away (screen size ~ height / distance); דקל: צללית דקה — הכרטיס הרחוק מספיק מוקדם יותר (מילוי)
      const big = kd === 'tree' ? Math.min(palm && B.palmNear ? 1.15 : 1.6, Math.max(0.7, T.S[i] * models[si].H / 10)) : 1;
      if (d < lim * big && nearTris + models[si].tris <= B.nearTris) { pick[c] = 1; nearTris += models[si].tris; nearCount[si]++; }
      else if (kd !== 'dwarf' && farN < B.farMax) { pick[c] = 2; farN++; farCount[si]++; }
    }
    for (let si = 0; si < SP.length; si++) {
      nearMeshes[si] = ensure(nearMeshes[si], nearCount[si], false); farMeshes[si] = ensure(farMeshes[si], farCount[si], true);
    }
    const nf = new Int32Array(SP.length), ff = new Int32Array(SP.length);
    for (let b = 0; b < NB; b++) for (let c = bucketHead[b]; c !== -1; c = next[c]) {   // מהקרוב לרחוק (עומק מוקדם לכרטיסי העלים)
      if (!pick[c]) continue;
      const T = Tl[candT[c]], i = candI[c], si = T.SPI[i], s = T.S[i];
      if (pick[c] === 1) {
        const mesh = nearMeshes[si], a = mesh.instanceMatrix.array, o = nf[si] * 16, r = T.ROT[i], co = Math.cos(r) * s, sn = Math.sin(r) * s;
        a[o] = co; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
        a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = co; a[o + 11] = 0; a[o + 12] = T.X[i]; a[o + 13] = T.Y[i]; a[o + 14] = T.Z[i]; a[o + 15] = 1;
        const ca = mesh.instanceColor.array, q = nf[si] * 3, tt = T.TINT[i], hu = T.HUE ? T.HUE[i] : 0; ca[q] = tt * (1 + 0.07 * hu); ca[q + 1] = tt * (0.97 + (tt - 1) * 0.3); ca[q + 2] = tt * 0.95 * (1 - 0.1 * hu);   // גודל, סיבוב, בהירות וגוון לכל עץ
        nf[si]++;
      } else {
        const mesh = farMeshes[si], a = mesh.instanceMatrix.array, o = ff[si] * 16;
        a[o] = s; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
        a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = s; a[o + 11] = 0; a[o + 12] = T.X[i]; a[o + 13] = T.Y[i]; a[o + 14] = T.Z[i]; a[o + 15] = 1;
        ff[si]++;
      }
    }
    let dc = 0, tris = 0;
    for (let si = 0; si < SP.length; si++) {
      const nm = nearMeshes[si], fm = farMeshes[si];
      nm.count = nf[si]; fm.count = ff[si];
      nm.visible = nf[si] > 0; fm.visible = ff[si] > 0;
      if (nf[si]) { nm.instanceMatrix.clearUpdateRanges(); nm.instanceMatrix.addUpdateRange(0, nf[si] * 16); nm.instanceMatrix.needsUpdate = true;
        nm.instanceColor.clearUpdateRanges(); nm.instanceColor.addUpdateRange(0, nf[si] * 3); nm.instanceColor.needsUpdate = true; dc += nm.castShadow ? 2 : 1; tris += nf[si] * models[si].tris; }
      if (ff[si]) { fm.instanceMatrix.clearUpdateRanges(); fm.instanceMatrix.addUpdateRange(0, ff[si] * 16); fm.instanceMatrix.needsUpdate = true; dc++; tris += ff[si] * 2; }
    }
    let plants = 0; for (const T of tiles.values()) plants += T.n;
    Object.assign(st, { drawCalls: dc, tris, near: nf.reduce((a, b) => a + b, 0), far: ff.reduce((a, b) => a + b, 0), plants, tiles: tiles.size, considered: nc,
      ms: +((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(2) });
  }
  const camDir = new THREE.Vector3();
  function update(camera, dt = 1 / 60) {
    time.value += dt; since += dt;
    camera.getWorldDirection(camDir);
    // impostor tilt: world-up cards when looking level, camera-facing when looking down (helicopter / drone)
    const tilt = Math.min(1, Math.max(0, (-camDir.y - 0.35) / 0.45));
    for (const f of farUni) f.uTilt.value = tilt;
    const moved = camera.position.distanceToSquared(lastPos), turned = 1 - camDir.dot(lastDir);
    if (dirty || moved > 16 || turned > 0.002 || since > 0.5) { select(camera); lastPos.copy(camera.position); lastDir.copy(camDir); dirty = false; since = 0; }
  }
  function setWind(v, gust) { if (v) wind.value.set(v.x || 0, 0, v.z || 0); }
  function setLight(k) { for (const f of farUni) f.uLight.value.setScalar(k); }
  function dispose() {
    for (const T of [...tiles.keys()]) removeTile(T);
    for (const m of nearMeshes) { m.geometry.dispose(); m.material.dispose(); m.customDepthMaterial.dispose(); m.dispose(); }
    for (const m of farMeshes) { m.material.dispose(); m.dispose(); }
    farGeo.dispose(); if (atlas) atlas.dispose(); if (gtex) Object.values(gtex).forEach(t => t && t.dispose());
    if (root.parent) root.parent.remove(root);
  }
  setDate(date);
  return {
    root, addTile, removeTile, fillSlots, applyGroundCover, setDate, setWind, setLight, update, dispose,
    get date() { return date; }, get atlas() { return atlas; }, models, species: SP, budget: B, flora: !!FL,
    stats: () => ({ ...st }),
    /** צמחים ברדיוס r סביב (x,z) בצירי הסצנה — לבדיקות ולכרטיסי ממשק: [{code, x, z, h}] */
    plantsNear(x, z, r) { const out = []; for (const T of tiles.values()) for (let i = 0; i < T.n; i++) { const d2 = (T.X[i] - x) ** 2 + (T.Z[i] - z) ** 2; if (d2 < r * r) out.push({ code: SP[T.SPI[i]].code, x: T.X[i], z: T.Z[i], h: +(T.S[i] * models[T.SPI[i]].H).toFixed(1) }); } return out; },
    /** what grows at a point (for UI cards): land-cover class and whether it's estimated */
    coverAt(x, z) { const E = x + OX, N = OY - z, key = Math.floor(E / 1000) + '_' + Math.floor(N / 1000), T = tiles.get(key); if (!T || !T.lc) return null;
      const c = Math.min(99, Math.floor((E - T.ox) / 10)), r = Math.min(99, Math.floor((T.oy + 1000 - N) / 10)), v = T.lc[r * 100 + c]; return { cls: v & 0x7f, estimated: (v & EST) !== 0 }; },
  };
}
