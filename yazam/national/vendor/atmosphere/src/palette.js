/* ESH27 twin — atmosphere & art direction — palette.js
 * The Ashdod palette (art bible, see art/bible.txt) + the "Ashdod Mediterranean" grade (LUT).
 * Pure JS (no THREE). All palette values are sRGB hex as picked by eye from typical Ashdod
 * scenes (kurkar sandstone, white/cream plaster, 1960s-90s "shikun" concrete, new towers with
 * light stone cladding, terracotta roofs, bougainvillea). They are ART DIRECTION, not measurements.
 */

export const PALETTE = {
  // --- built fabric (albedo, sRGB) ---
  plaster:   ['#EDE6D6', '#E8DCC4', '#E3D6BC', '#DDD0B6', '#F1ECE2'],   // white/cream plaster (most common)
  stone:     ['#D9C9A8', '#CFBE9C', '#C9B79A', '#D6C7AB'],              // light limestone cladding (new towers)
  shikun:    ['#BDB7AA', '#B3AD9F', '#A9A498', '#C4BEB0'],              // older grey concrete blocks
  accentWall:['#E9C9A6', '#E3B98F', '#D8C3A0'],                         // ochre / peach plaster (rare)
  roofFlat:  ['#D8D4CC', '#CFCBC2', '#E2DED6', '#C6C1B6'],              // bitumen-white / grey roofs, solar heaters
  roofTile:  ['#B5643C', '#A85A36', '#C0714A'],                         // terracotta (pitched roofs)
  // --- ground ---
  sand:      '#E6D3A8',  dune: '#E9D7AE',  dryGround: '#CDBB92', asphalt: '#4A4A4C', pavement: '#BDB6A8',
  // --- sea (for the lighting look only; maritime team owns the water) ---
  seaDeep:   '#0E4C6E',  seaMid: '#1F6F8B', seaShallow: '#3FA7A8', foam: '#E8F1F0',
  // --- accents ---
  bougainvillea: '#C2185B', bougainvillea2: '#D81B60', shutterTeal: '#3E7C87', palmGreen: '#5E7A3A',
  // --- light sources (approximate blackbody → sRGB; Planck + CIE 1931, rounded) ---
  k1900: '#FF8A1F',   // high-pressure sodium (HPS) ~1900–2100 K, narrow-band orange
  k2700: '#FFA757',   // warm LED / incandescent windows
  k3000: '#FFB46B',
  k4000: '#FFD1A3',   // municipal LED (4000 K, common in Israeli retrofit programs — assumption)
  k5000: '#FFE4CE',
  k6500: '#FFF9FD',
  tvBlue: '#9DB8FF',  // TV / screen flicker in windows
  // --- reference skies (targets for the look; the renderer computes its own from the sun) ---
  noonZenith: '#3D7CC9', noonHorizon: '#BFD6E6',
  goldenSun:  '#FFB55A', goldenHaze: '#F2C38B',
  blueZenith: '#1C2E5A', blueHorizon: '#5C6F9A', venusBelt: '#C9A0AE',
  nightSky:   '#0B1020', moonlight: '#9DB4D8',
  sharavHaze: '#C9A46A', sharavSky: '#D8B984', sharavSun: '#FFE7B0',
  smogHaze:   '#A89F8E', no2Brown: '#9A7A55',
  stormSky:   '#6F7A84', stormCloud: '#4E5862', stormSea: '#3E5560',
};

export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
export function rgbToHex(c) { return '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join(''); }
export const srgbToLinear = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
export const linearToSrgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
export const hexToLinear = h => hexToRgb(h).map(srgbToLinear);
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Deterministic 32-bit hash → [0,1). Used for per-building colour / window choices. */
export function hash01(n) {
  let x = (n | 0) ^ 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export function hashString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * Albedo for a building, deterministic per id. typ = OSM building type; tall = height (m).
 * Mix (art direction for Ashdod): 50% plaster, 22% stone (more on towers), 22% shikun grey (more on 4–9 floor blocks), 6% ochre.
 * Returns {wall:[r,g,b] sRGB, roof:[r,g,b] sRGB}.
 */
export function buildingAlbedo(id, typ = '', h = 10, pitched = false) {
  const s = typeof id === 'number' ? id : hashString(String(id));
  const a = hash01(s), b = hash01(s * 7 + 3), c = hash01(s * 13 + 5);
  const tower = h > 40, block = h > 10 && h <= 30;
  let set;
  if (/industrial|warehouse|hangar|port/.test(typ)) set = a < 0.6 ? PALETTE.shikun : PALETTE.roofFlat;
  else if (tower) set = a < 0.55 ? PALETTE.stone : a < 0.9 ? PALETTE.plaster : PALETTE.shikun;
  else if (block) set = a < 0.4 ? PALETTE.plaster : a < 0.72 ? PALETTE.shikun : a < 0.92 ? PALETTE.stone : PALETTE.accentWall;
  else set = a < 0.6 ? PALETTE.plaster : a < 0.78 ? PALETTE.stone : a < 0.9 ? PALETTE.accentWall : PALETTE.shikun;
  const wall = hexToRgb(set[Math.floor(b * set.length)]);
  const rs = pitched ? PALETTE.roofTile : PALETTE.roofFlat;
  const roof = hexToRgb(rs[Math.floor(c * rs.length)]);
  // small per-building value jitter (±3%) so blocks of identical colour read as separate buildings
  const j = 0.97 + 0.06 * hash01(s * 31 + 11);
  return { wall: wall.map(v => Math.min(1, v * j)), roof: roof.map(v => Math.min(1, v * j)) };
}

// ------------------------------------------------------------------ the grade ("Ashdod Mediterranean")
/**
 * Display-referred grade, applied AFTER tone mapping, in sRGB [0,1].
 * Restrained on purpose (realistic, not "teal & orange"):
 *   • split tone: shadows +teal 1.5%, highlights +warm 2%   (Mediterranean: warm stone, cool shade)
 *   • saturation +8% in mid-tones, protected in highlights (no neon skies)
 *   • blues/cyans +6% saturation (sea), greens −6% (dusty summer vegetation)
 *   • gentle toe lift (+0.008) so night shadows hold a hint of blue instead of crushing to black.
 */
export function grade(rgb) {
  let [r, g, b] = rgb;
  const L = lum([r, g, b]);
  const sh = Math.max(0, 1 - L / 0.45), hl = Math.max(0, (L - 0.55) / 0.45);
  r += -0.010 * sh + 0.020 * hl; g += 0.004 * sh + 0.008 * hl; b += 0.015 * sh - 0.012 * hl;
  // hue-selective saturation
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), C = mx - mn;
  let hue = 0; if (C > 1e-6) { if (mx === r) hue = ((g - b) / C + 6) % 6; else if (mx === g) hue = (b - r) / C + 2; else hue = (r - g) / C + 4; }
  hue *= 60;
  const near = (h0, w) => Math.max(0, 1 - Math.abs(((hue - h0 + 540) % 360) - 180) / w);
  let sat = 1 + 0.08 * (1 - hl) + 0.06 * near(200, 40) - 0.06 * near(100, 40);
  const L2 = lum([r, g, b]);
  r = L2 + (r - L2) * sat; g = L2 + (g - L2) * sat; b = L2 + (b - L2) * sat;
  const toe = 0.008 * Math.max(0, 1 - L2 / 0.08);
  return [r + toe * 0.6, g + toe * 0.8, b + toe * 1.4].map(v => Math.min(1, Math.max(0, v)));
}

/** 3D LUT as Uint8 RGBA, size³ texels, layout [b][g][r] (Data3DTexture order: x=r fastest). */
export function buildLUT(size = 32) {
  const out = new Uint8Array(size * size * size * 4);
  let o = 0;
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const c = grade([ri / (size - 1), gi / (size - 1), bi / (size - 1)]);
    out[o++] = Math.round(c[0] * 255); out[o++] = Math.round(c[1] * 255); out[o++] = Math.round(c[2] * 255); out[o++] = 255;
  }
  return out;
}
/** Adobe/Resolve .cube text of the same grade (for colourists / other engines). */
export function buildCube(size = 33, title = 'ESH27 Ashdod Mediterranean v1') {
  const L = [`TITLE "${title}"`, `# ESH27 twin art direction. Display-referred (apply after ACES/AgX tone mapping, sRGB in/out).`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const c = grade([ri / (size - 1), gi / (size - 1), bi / (size - 1)]); L.push(c.map(v => v.toFixed(6)).join(' '));
  }
  return L.join('\n') + '\n';
}
/** Low tier has no post pass: we pre-grade the albedo palette instead ("vertex colour grading"). */
export function pregradeAlbedo(rgb, strength = 0.6) { const g = grade(rgb); return rgb.map((v, i) => v + (g[i] - v) * strength); }

// ------------------------------------------------------------------ FIELD GROUND TRUTH (night)
/**
 * Pixel-sampled from Ariel's 11 phone photos, רחוב הארז, Ashdod, 23.11.2026 00:58–01:02
 * (moon 96% at az 265° alt 45°, broken cloud). tools/sample_fieldphotos.py → fieldref/samples.json.
 * Values are sRGB as the PHONE JPEG encoded them (auto-exposure + auto white balance + tone curve
 * baked in) — they are LOOK TARGETS for the night grade and the "phone FPV" profile, not radiometry.
 * Medians of surface boxes; light sources = mean of pixels with luma 110–240 (unclipped fringe).
 */
export const FIELD_NIGHT = {
  sky_between_clouds: '#0A0F1C',     // 001/003/008: #080E1C #090F1C #0B1018 — dark navy, never black
  cloud_moonlit:      '#434348',     // 006 — neutral grey, slight violet
  cloud_city_lit_low: '#363133',     // 008 low clouds over the city: warm-magenta grey (h≈336°)
  cloud_lit:          '#292937',     // 001
  moon_halo:          '#6B737E',     // 006 — cool grey-blue corona around a 96% moon
  moon_core:          '#E5FEFF',     // 006/008 clipped, cyan-white (phone WB)
  // street lighting: two types side by side
  sodium_asphalt_pool:'#957E5F',     // 001 — hue 33°, amber pool
  sodium_asphalt_hot: '#DAC3A6',     // 003 — centre of the pool
  sodium_plaster:     '#645447',     // 001/003 cream plaster under sodium → #645447 / #574941
  asphalt_midstreet:  '#63513E',     // 001 — between pools (≈0.65× pool luma)
  asphalt_far_dark:   '#473A30',     // 003
  led_asphalt:        '#BBA994',     // 004 — under a 4000 K LED head (asphalt itself is warm beige)
  led_halo:           '#EBE4D6',     // 011 — near-white, faintly warm (≈4000 K after phone WB)
  car_shadow:         '#231E1D',     // 004 — hard, ~1/5 of the lit asphalt luma
  // materials
  red_pavers:         ['#614132', '#6A4A34', '#514036', '#917358'],   // 005 009 004 001 (interlocking "אבן משתלבת")
  grey_pavers:        '#7E664C',     // 011 (newer street, grey/beige pavers under LED)
  curb_stone:         '#8B7B6A',     // 005 white/grey curb under sodium
  limestone_wall:     '#987855',     // 011 villa block wall under LED
  stone_cladding:     ['#71523C', '#5D4836'],                        // 006 008
  garage_door:        '#181818',     // 004/005/006 dark grey
  // windows (interiors)
  window_warm:        '#EDCE94',     // 007 incandescent / warm LED
  window_warm_dim:    '#D4B592',
  window_cool_led:    '#7AA6BB',     // 007 cool LED / screen
  tower_windows_avg:  '#918166',     // 008/010 average of lit windows on the towers (warm dominant)
  tower_facade_unlit: '#5C554B',
  occupancy_0100:     0.15,          // eyeballed on the 008/010 towers: ~10–20% of windows lit at 01:00
  // crane (construction site next to the street)
  crane_blue_led:     '#2E6EC8',     // 007/009 LED strip along the jib (#2E6EC8 / #2A63A9)
  crane_red_light:    '#DEAAA2',     // 009 aviation obstruction light (clipped core → pink-white)
  crane_red_steel:    '#4C1815',     // 008 jib structure, lit
};

/** Street-light type is a PER-STREET attribute (both types exist side by side on הארז and neighbours).
 *  Deterministic from the street name; ratio is an assumption until municipal data arrive. */
export const LAMP_TYPES = {
  sodium: { kelvin: 2050, color: '#FF9A3C', label_he: 'נתרן (כתום)', lumens: 9000, height: 8 },
  led:    { kelvin: 4000, color: '#FFE2C0', label_he: 'לד לבן', lumens: 8000, height: 9 },
};
export function lampTypeForStreet(name = '', ledShare = 0.55) {
  return hash01(hashString(String(name) || 'unnamed')) < ledShare ? 'led' : 'sodium';
}
