/* ESH27 twin — atmosphere — curves.js
 * Time-of-day light curves. Pure functions, no THREE → node --test.
 *
 * UNITS. Scene light intensities are "lux / LUX_UNIT" (LUX_UNIT = 30 000 lux): the noon sun ≈ 3.3,
 * full moon ≈ 1e-5. three.js Lambert/Standard treat directional and hemisphere irradiance the same
 * way (irradiance · albedo/π), so these numbers are a consistent radiometric scale, and auto-exposure
 * (exposureFor) brings any time of day back to a displayable range — the same thing a camera or the
 * eye does. Emissive city lights are in the same absolute scale, so they vanish by day and pop at night
 * without any special-casing.
 *
 * MODELS (labeled, approximate):
 *  • Air mass: Kasten & Young (1989), Applied Optics 28:4735.
 *  • Rayleigh optical depth: Bodhaine et al. (1999) J. Atmos. Ocean. Tech. 16:1854, sea level, at
 *    the Preetham primaries 680/550/450 nm (same wavelengths as three.js Sky).
 *  • Ozone Chappuis band (300 DU), NO2 absorption: rounded cross-sections (order of magnitude).
 *  • Aerosol: Ångström law τ(λ) = τ550 (λ/550)^−α.
 *  • Global horizontal illuminance (clear sky) and twilight: rounded table in the spirit of the
 *    classic tables (Bond & Henderson 1963; USNO), ±30% — enough for exposure and light ratios.
 *  • Moon: full moon at zenith ≈ 0.27 lux (normal incidence), phase law of Allen (1976): Δm = 0.026|i| + 4e-9 i^4.
 */

export const LUX_UNIT = 30000;
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const D2R = Math.PI / 180;

/** Relative optical air mass, Kasten & Young (1989). Finite at the horizon (≈38), extrapolated below. */
export function airMass(elevDeg) {
  const h = Math.max(-2, elevDeg);
  if (h <= 0) return 38 + (-h) * 6;   // below the horizon: keeps growing (only used for faint tails)
  return 1 / (Math.sin(h * D2R) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

export const LAMBDA_UM = [0.68, 0.55, 0.45];
/** Rayleigh optical depth at sea level (λ in µm), the common fit τ = 0.008569 λ⁻⁴ (1 + 0.0113 λ⁻² + 0.00013 λ⁻⁴). */
export function rayleighTau(um) { const l2 = um * um; return 0.008569 * Math.pow(um, -4) * (1 + 0.0113 / l2 + 0.00013 / (l2 * l2)); }
const TAU_R = LAMBDA_UM.map(rayleighTau);              // ≈ [0.041, 0.097, 0.224]
const TAU_O3 = [0.016, 0.027, 0.003];                  // Chappuis band, 300 DU (approx.)

/** Clean coastal-Mediterranean default aerosol (Ashdod): τ550 ≈ 0.12, α ≈ 0.9 (sea salt + background). */
export const CLEAN_AEROSOL = { tau550: 0.12, alpha: 0.9, no2: 15, absorb: 0.08 };

/** Spectral optical depth [r,g,b] for an aerosol state. */
export function opticalDepth(aer = CLEAN_AEROSOL) {
  const n = (aer.no2 || 0) / 40;                       // µg/m³ near surface → crude column proxy
  const tauNO2 = [0.0, 0.004 * n, 0.018 * n];
  return LAMBDA_UM.map((l, i) => TAU_R[i] + TAU_O3[i] + aer.tau550 * Math.pow(l / 0.55, -aer.alpha) + tauNO2[i]);
}

/** Direct-beam transmittance [r,g,b] along the sun's path. */
export function sunTransmittance(elevDeg, aer = CLEAN_AEROSOL) {
  const m = airMass(elevDeg), t = opticalDepth(aer);
  return t.map(x => Math.exp(-m * x));
}
const Y = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Global horizontal illuminance, clear sky, lux (sun elevation in degrees). Log-interpolated.
const GHI_E = [-90, -18, -15, -12, -9, -6, -4, -2, 0, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 90];
const GHI_L = [0.0007, 0.0007, 0.002, 0.008, 0.12, 3.4, 22, 120, 700, 1800, 4800, 12000, 21000, 31000, 52000, 70000, 86000, 100000, 110000, 118000];
export function globalIlluminanceClear(elevDeg) {
  const h = clamp(elevDeg, -90, 90);
  for (let i = 1; i < GHI_E.length; i++) if (h <= GHI_E[i]) {
    const t = (h - GHI_E[i - 1]) / (GHI_E[i] - GHI_E[i - 1]);
    return Math.exp(lerp(Math.log(GHI_L[i - 1]), Math.log(GHI_L[i]), t));
  }
  return GHI_L[GHI_L.length - 1];
}
export const E_SOLAR_LUX = 128000;   // extraterrestrial illuminance (mean, normal incidence)

/**
 * Sun + sky illuminance split.
 * @returns {{direct: lux on a surface normal to the beam, directH: lux horizontal, diffuse: lux horizontal (sky dome), total, sunRGB: normalised chroma, T: transmittance rgb}}
 */
export function sunSky(elevDeg, aer = CLEAN_AEROSOL, cloud = 0) {
  const T = sunTransmittance(elevDeg, aer), Tc = sunTransmittance(elevDeg, CLEAN_AEROSOL);
  const up = elevDeg > -0.833 ? smooth(-0.833, 0.5, elevDeg) : 0;          // upper limb at the horizon
  const s = Math.max(0, Math.sin(elevDeg * D2R));
  let direct = E_SOLAR_LUX * Y(T) * up;
  const directClean = E_SOLAR_LUX * Y(Tc) * up;
  // diffuse from the table, minus the clean direct part; aerosols move part of the beam into the sky (forward scatter) and absorb the rest
  const gClear = globalIlluminanceClear(elevDeg);
  let diffuse = Math.max(gClear * 0.13, gClear - directClean * s);
  diffuse += (1 - aer.absorb) * 0.75 * Math.max(0, directClean - direct) * s;
  // clouds: direct beam blocked (weather team curve), diffuse first brightens (broken cloud) then darkens (overcast)
  const cc = clamp(cloud, 0, 1);
  direct *= 1 - 0.95 * Math.pow(cc, 1.5);
  const cloudDiffuse = (1 + 0.9 * cc * (1 - cc) * 2) * (1 - 0.55 * Math.pow(cc, 2.2));
  diffuse = diffuse * cloudDiffuse + 0.35 * cc * directClean * s * (1 - cc);
  // chroma white-balanced to the zenith sun (art convention: the high sun reads white, low sun warm)
  const Tz = sunTransmittance(90, CLEAN_AEROSOL), rel = T.map((v, i) => v / Tz[i]), m = Math.max(...rel) || 1;
  return { direct, directH: direct * s, diffuse, total: direct * s + diffuse, sunRGB: rel.map(v => v / m), T };
}

/** Sky-light colour (linear, max=1) — chroma of the dome's irradiance as a function of sun elevation and haze. */
export function skyChroma(elevDeg, haze = 0, dustTint = [0.82, 0.62, 0.38]) {
  // day: Rayleigh blue; low sun: whiter/peach horizon; civil twilight: deep blue (ozone); night: neutral-blue
  const day = [0.55, 0.72, 1.0], low = [0.86, 0.84, 0.92], blue = [0.36, 0.48, 1.0], night = [0.42, 0.5, 0.75];
  let c;
  if (elevDeg >= 12) c = day;
  else if (elevDeg >= 2) c = day.map((v, i) => lerp(low[i], v, (elevDeg - 2) / 10));
  else if (elevDeg >= -6) c = low.map((v, i) => lerp(blue[i], v, (elevDeg + 6) / 8));
  else if (elevDeg >= -14) c = blue.map((v, i) => lerp(night[i], v, (elevDeg + 14) / 8));
  else c = night;
  const k = clamp(haze, 0, 1);
  c = c.map((v, i) => lerp(v, dustTint[i] * (elevDeg > -6 ? 1 : 0.6) + v * 0.15, k));
  const m = Math.max(...c); return c.map(v => v / m);
}

/** Moon illuminance (lux on a surface normal to the moonlight). */
export function moonIlluminance(moonElevDeg, phaseAngleDeg, aer = CLEAN_AEROSOL) {
  if (moonElevDeg < -0.5) return 0;
  const i = Math.abs(phaseAngleDeg), dm = 0.026 * i + 4e-9 * Math.pow(i, 4);
  const T = Y(sunTransmittance(moonElevDeg, aer));
  return 0.27 * Math.pow(10, -0.4 * dm) * T * smooth(-0.5, 1, moonElevDeg) / Y(sunTransmittance(90, CLEAN_AEROSOL));
}

/** Window occupancy: fraction of windows lit, by local hour (residential Ashdod; art-directed, anchored at 01:00 = 0.15 from Ariel's field photos 23.11.2026). */
const OCC_H = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24];
const OCC_V = [0.30, 0.15, 0.10, 0.07, 0.06, 0.09, 0.22, 0.24, 0.12, 0.08, 0.12, 0.2, 0.36, 0.5, 0.58, 0.6, 0.55, 0.44, 0.30];
export function windowOccupancy(hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < OCC_H.length; i++) if (h <= OCC_H[i]) return lerp(OCC_V[i - 1], OCC_V[i], (h - OCC_H[i - 1]) / (OCC_H[i] - OCC_H[i - 1]));
  return OCC_V[0];
}
/** Street lights: photocell switching ~ civil dusk (assume on below sun elevation +1°, off above +3° in the morning; smooth). */
export function streetLightsOn(sunElevDeg) { return 1 - smooth(-1.5, 2.5, sunElevDeg); }

/** City ambient light (lux) from street lighting averaged over the urban surface, and the sky-glow factor. */
export function cityAmbientLux(lightsOn, haze = 0) { return lightsOn * (0.9 + 1.2 * clamp(haze, 0, 1)); }

/** Adaptation illuminance (lux) seen by the "camera" — sun+sky+moon+city. */
export function adaptationLux({ sunElev, aer = CLEAN_AEROSOL, cloud = 0, moonElev = -90, moonPhaseAngle = 180, cityLux = 0 }) {
  const ss = sunSky(sunElev, aer, cloud);
  const mE = moonIlluminance(moonElev, moonPhaseAngle, aer) * Math.max(0, Math.sin(moonElev * D2R)) * (1 - 0.8 * cloud);
  return ss.total + mE + cityLux;
}

/**
 * Auto-exposure (approximation of eye/camera adaptation) for three.js toneMappingExposure.
 * Full adaptation would make midnight as bright as noon; we keep a "darkness preference":
 * exposure ∝ (E_ref/E)^0.8, capped. Monotone non-increasing in E.
 */
export const EXPOSURE = { key: 0.62, ref: 110000, p: 0.8, max: 9000 };
export function exposureFor(Elux, o = EXPOSURE) {
  const e = o.key * Math.pow(o.ref / Math.max(Elux, 1e-4), o.p);
  return clamp(e, o.key * 0.8, o.max);
}

/** Sky phase label in Hebrew for the UI. */
export function phaseHe(elev) {
  if (elev >= 20) return 'יום';
  if (elev >= 6) return 'אור נמוך';
  if (elev >= -0.833) return 'שעת הזהב';
  if (elev >= -6) return 'דמדומים (שעה כחולה)';
  if (elev >= -12) return 'דמדומים ימיים';
  if (elev >= -18) return 'דמדומים אסטרונומיים';
  return 'לילה';
}

/**
 * Preetham sky radiance in JS — the same maths as the sky shader (three.js Sky, MIT), so the fog colour
 * on the ground can equal the sky at the horizon (no seam). dir/sun: unit vectors, y up. Returns linear RGB
 * in the shader's units (× 0.04 included, before preethamGain).
 */
export function preethamRadiance(dir, sun, turbidity = 2.5, rayleigh = 1, mieCoefficient = 0.005, mieG = 0.8) {
  const TR = [5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5], MC = [1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14];
  const zc = Math.max(-1, Math.min(1, sun.y));
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(zc)) / 1.5)));
  const bR = TR.map(v => v * rayleigh), bM = MC.map(v => 0.434 * 0.2 * turbidity * 10E-18 * v * mieCoefficient);
  const yp = Math.max(dir.y, 0), zen = Math.acos(yp);
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zen * 180 / Math.PI, -1.253));
  const Fex = bR.map((r, i) => Math.exp(-(r * 8.4E3 * inv + bM[i] * 1.25E3 * inv)));
  const cosT = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  const rPh = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g2 = mieG * mieG, mPh = 0.07957747 * (1 - g2) / Math.pow(1 - 2 * mieG * cosT + g2, 1.5);
  const k = Math.max(0, Math.min(1, Math.pow(1 - sun.y, 5))), dayL0 = Math.max(0, Math.min(1, (sun.y + 0.08) / 0.13));
  return [0, 1, 2].map(i => {
    const ratio = (bR[i] * rPh + bM[i] * mPh) / (bR[i] + bM[i]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex[i]), 1.5);
    Lin *= 1 + (Math.pow(sunE * ratio * Fex[i], 0.5) - 1) * k;
    return (Lin + 0.1 * Fex[i] * dayL0 * dayL0 * (3 - 2 * dayL0)) * 0.04;
  });
}
