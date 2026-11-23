/* ESH27 twin — atmosphere — look.js
 * The whole "look" for one instant as plain numbers (no THREE) — so it is unit-testable and the
 * engine-specific rig (rig.js) only copies values into uniforms/lights.
 * Radiance/irradiance scale: see curves.js (LUX_UNIT). Colours are LINEAR RGB.
 */
import { skyState, moonPhaseNameHe, sunTimes, ASHDOD, tzOffsetMinutes } from './astro.js';
import { preethamRadiance, sunSky, skyChroma, moonIlluminance, windowOccupancy, exposureFor, globalIlluminanceClear, phaseHe, LUX_UNIT, clamp, CLEAN_AEROSOL } from './curves.js';
import { aqToAtmosphere, aqiChip, AQ_PRESETS } from './airquality.js';
import { hexToLinear, FIELD_NIGHT, LAMP_TYPES } from './palette.js';

const PI = Math.PI;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const norm = c => { const m = Math.max(...c) || 1; return c.map(v => v / m); };
const mul = (c, k) => c.map(v => v * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const SODIUM = norm(hexToLinear(LAMP_TYPES.sodium.color)), LED = norm(hexToLinear(LAMP_TYPES.led.color));
const CITY = norm(mix(SODIUM, LED, 0.5));
const GROUND_ALBEDO = hexToLinear('#CDBB92');
const MOON_TINT = norm(hexToLinear('#9DB4D8'));   // film convention (Purkinje): moonlight rendered cool
const W_WARM = norm(hexToLinear(FIELD_NIGHT.window_warm)), W_COOL = norm(hexToLinear(FIELD_NIGHT.window_cool_led)), W_TV = norm(hexToLinear('#9DB8FF'));

export const LOOK_TUNING = {
  preethamGain: 0.24,     // Preetham radiance → our scale (matched by eye so the noon zenith ≈ #3D7CC9 target)
  windowRadiance: 9e-5,   // lit window radiance (scene units) — ≈ 3 cd/m² equivalent; tuned to field photo 007/008
  lampSprite: 0.0028,     // lamp head sprite radiance
  lampLux: 22,            // peak illuminance under a lamp head (Israeli street lighting ~10–30 lux; SI 20.3 / EN 13201 classes)
  moonSky: 0.03, cityGlowSky: 0.022, cloudCity: 0.8,
};

/** Photocell: street lights on below ~60 lux (on in a heavy storm/sharav afternoon too). */
export function lightsOnFor(Elux) { return 1 - smooth(25, 120, Elux); }

/**
 * @param {object} p {ms, site?, aq?, weather?: {cloud 0..1, visibility_m?, rain 0..1}}
 */
export function computeLook({ ms, site = ASHDOD, aq = AQ_PRESETS.clean, weather = {} }) {
  const S = skyState(ms, site), atm = aqToAtmosphere(aq);
  const cloud = clamp(weather.cloud || 0, 0, 1), rain = clamp(weather.rain || 0, 0, 1);
  const aer = { tau550: atm.tau550, alpha: atm.alpha, no2: atm.no2, absorb: atm.absorb };
  const sunElev = S.sun.elevation, moonElev = S.moon.elevation;
  const ss = sunSky(sunElev, aer, cloud);
  const mEn = moonIlluminance(moonElev, S.moon.phaseAngle, aer) * (1 - 0.75 * cloud);
  const mEh = mEn * Math.max(0, S.moonDir.y);
  const lightsOn = lightsOnFor(ss.total);
  const haze = 1 - Math.exp(-atm.tau550 * 1.2);
  const cityLux = lightsOn * (0.9 + 1.5 * haze + 0.8 * cloud);           // urban ambient (sky glow + spill)
  const Eadapt = ss.total + mEh + cityLux;
  const exposure = exposureFor(Eadapt);

  // --- lights (scene units) ---
  const dust = atm.dustiness, smog = atm.smogginess;
  const chroma = skyChroma(sunElev, Math.max(dust, smog * 0.6), dust > smog ? [0.85, 0.66, 0.40] : [0.72, 0.66, 0.58]);
  const sun = { dir: S.sunDir, color: ss.sunRGB, intensity: ss.direct / LUX_UNIT };
  const moon = { dir: S.moonDir, color: MOON_TINT, intensity: mEn / LUX_UNIT * smooth(-2, -8, sunElev) };   // only matters once the sun is down
  const skyIrr = add(mul(chroma, ss.diffuse / LUX_UNIT), add(mul(MOON_TINT, mEh * 0.08 / LUX_UNIT), mul(CITY, cityLux * 0.35 / LUX_UNIT)));
  const groundIrr = add(mul(GROUND_ALBEDO, (ss.total + mEh) / LUX_UNIT), mul(CITY, cityLux * 0.9 / LUX_UNIT));
  // --- haze / fog ---
  const visW = weather.visibility_m && isFinite(weather.visibility_m) ? weather.visibility_m : Infinity;
  const beta = Math.max(atm.beta, 3.912 / visW, rain * 3.912 / 8000);
  const hazeAlb = (c => { const m = Math.max(...c); return c.map(v => v / m * 0.92); })(hexToLinearArr(atm.hazeColor));   // tint only, single-scattering albedo ≈ 0.92
  const sunUp = smooth(-1.5, 2, sunElev);
  // airlight of a deep haze ≈ a white Lambertian veil lit by sun+sky: L ≈ a·E_total/π (a = aerosol single-scattering albedo
  // × phase average ≈ 0.9), tinted by the sky chroma (diffuse part) and the sun chroma (beam part)
  const Eb = ss.directH + 0.25 * ss.direct * (1 - Math.max(0, S.sunDir.y));   // low sun: forward-scattered beam brightens the veil
  let fogRad = add(add(mul(hazeAlb.map((v, i) => v * chroma[i]), ss.diffuse * 0.95 / LUX_UNIT / PI),
    mul(hazeAlb.map((v, i) => v * ss.sunRGB[i]), Eb * 0.9 / LUX_UNIT / PI)),
    add(mul(CITY, cityLux * (0.25 + 0.6 * haze + 0.5 * cloud) / LUX_UNIT / PI), mul(MOON_TINT, mEh * 0.05 / LUX_UNIT / PI)));
  // clean air by day: blend toward the Preetham horizon (8 azimuths at 1.5°) so ground fog meets the sky without a seam;
  // its brightness is capped at 1.3× the physical veil
  { const sd = S.sunDir, tb = clamp(2 + 9 * (1 - Math.exp(-(atm.tau550 - 0.05) * 2.2)), 2, 11), mc = 0.004 + 0.02 * haze, acc = [0, 0, 0];
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, d = { x: Math.cos(a) * 0.99966, y: 0.026, z: Math.sin(a) * 0.99966 };
      const r = preethamRadiance(d, sd, tb, 1, mc, 0.8 - 0.1 * dust); for (let i = 0; i < 3; i++) acc[i] += r[i] / 8; }
    let ph = acc.map(v => v * LOOK_TUNING.preethamGain * (1 - 0.6 * cloud));
    const Yp = 0.2126 * ph[0] + 0.7152 * ph[1] + 0.0722 * ph[2], Yf = 0.2126 * fogRad[0] + 0.7152 * fogRad[1] + 0.0722 * fogRad[2];
    if (Yp > 1.3 * Yf && Yp > 0) ph = ph.map(v => v * 1.3 * Yf / Yp);
    const w = 0.85 * smooth(-2, 8, sunElev) * (1 - Math.min(1, (dust + smog) * 0.9)) * (1 - 0.7 * cloud);
    for (let i = 0; i < 3; i++) fogRad[i] = fogRad[i] * (1 - w) + ph[i] * w; }
  const g = 0.05 + 0.8 * (1 - Math.exp(-atm.tau550 * 1.5));
  const sunGlow = mul(ss.sunRGB.map((v, i) => v * (0.7 + 0.3 * hazeAlb[i])), ss.direct / LUX_UNIT / PI * g * 0.5 * sunUp * (1 - 0.8 * cloud));
  // --- sky ---
  const twiE = globalIlluminanceClear(Math.min(sunElev, 4)) / LUX_UNIT / PI;
  const sky = {
    preethamGain: LOOK_TUNING.preethamGain * (1 - 0.6 * cloud),
    turbidity: clamp(2 + 9 * (1 - Math.exp(-(atm.tau550 - 0.05) * 2.2)), 2, 11),
    mieCoefficient: 0.004 + 0.02 * haze, mieG: 0.8 - 0.1 * dust,
    sunDisc: clamp(Math.exp(-(atm.tau550 - CLEAN_AEROSOL.tau550) * 2.0), 0.02, 1) * (1 - 0.95 * cloud),
    twi: twiE * (1 - smooth(-1, 5, sunElev)) * 0.55, twiSun: 0,
    nightBase: mul([0.35, 0.42, 0.65], 0.0007 / LUX_UNIT / PI),
    cityGlow: mul(CITY, cityLux * LOOK_TUNING.cityGlowSky * (1 + 3 * haze + 1.5 * cloud) / LUX_UNIT / PI),
    moonDir: S.moonDir, moonRad: S.moon.elevation > -1 ? 2500 / LUX_UNIT * (1 - 0.7 * cloud) * clamp(Math.exp(-(atm.tau550 - 0.1)), 0.05, 1) : 0,
    moonScatter: mul([0.42, 0.56, 1.0], mEh * LOOK_TUNING.moonSky / LUX_UNIT / PI * (1 + 2 * cloud)),
    halo: 0.35 + 1.6 * cloud + 1.2 * haze,
    hazeColor: fogRad, hazeHorizon: 1 - Math.exp(-beta * 22000), hazeZenith: clamp(1 - Math.exp(-atm.tau550 * 0.75) - 0.06, 0, 0.97) + 0.5 * rain,
    hazeSpread: 0.03 + 0.35 * (1 - Math.exp(-beta * 1500)),
    sunGlow, cloudCover: cloud,
    cloudDay: add(mul(ss.sunRGB, ss.direct / LUX_UNIT / PI * 0.22), mul(chroma, ss.diffuse / LUX_UNIT / PI * 0.6)),
    cloudNight: add(mul(CITY, cityLux * LOOK_TUNING.cloudCity / LUX_UNIT / PI), mul([0.8, 0.85, 1.0], mEn * 0.9 * Math.max(0, S.moonDir.y + 0.2) / LUX_UNIT / PI)),   // city-lit bases + moonlit tops (field 006/008: clouds 3–5× the sky gaps)
  };
  // twilight colour emphasis: the sunward glow is strongest in civil twilight
  sky.twiSun = smooth(-10, -1, sunElev) * (1 - smooth(1, 6, sunElev));
  // stars: limiting magnitude (Ashdod ≈ Bortle 7 → ~4.3 at best), brighter sky → fewer stars
  const limitMag = 4.3 - 1.3 * mEh / 0.25 - 4 * haze - 3 * cloud - 6 * smooth(-16, -6, sunElev);
  const stars = { limitMag, gain: limitMag > 0 ? 0.18 / exposure : 0 };   // perceptual: a limit-magnitude star displays at ~0.3
  // --- night city ---
  const localHour = ((ms / 3600000 + tzOffsetMinutes(ms, site.tz || 'Asia/Jerusalem') / 60) % 24 + 24) % 24;
  const night = {
    lightsOn, occupancy: windowOccupancy(localHour), windowGain: LOOK_TUNING.windowRadiance, warm: W_WARM, cool: W_COOL, tv: W_TV,
    lampSprite: LOOK_TUNING.lampSprite * lightsOn, lampLux: LOOK_TUNING.lampLux, cityUp: mul(CITY, cityLux * 0.22 / LUX_UNIT),
    dayGlass: smooth(-4, 6, sunElev), skyRefl: mul(chroma, ss.diffuse / LUX_UNIT / PI * 0.8),
  };
  const st = sunTimes(...localYMD(ms, site), site.lat, site.lon, site.tz || 'Asia/Jerusalem');
  return {
    ms, localHour, sky, sun, moon, hemi: { sky: skyIrr, ground: groundIrr }, fog: { beta, color: fogRad, visibility_m: 3.912 / beta }, exposure, Eadapt,
    stars, night, atm, aq, chip: aqiChip(aq, Object.assign({}, atm, { visibility_m: Math.min(atm.visibility_m, 3.912 / beta) })), phase_he: phaseHe(sunElev), moonPhase_he: moonPhaseNameHe(S.moon),
    sunPos: S.sun, moonPos: S.moon, starMatrix: S.starMatrix, sunTimes: st.local, cloud, rain, haze,
  };
}
function hexToLinearArr(srgb) { return srgb.map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); }
function localYMD(ms, site) { const t = new Date(ms + tzOffsetMinutes(ms, site.tz || 'Asia/Jerusalem') * 60000); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; }
