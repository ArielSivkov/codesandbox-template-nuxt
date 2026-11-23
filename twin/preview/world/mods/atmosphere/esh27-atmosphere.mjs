/* ESH27 twin — atmosphere & art direction 0.1.0 — built from src/ by tools/build.mjs. Sky shader based on three.js examples Sky (MIT). Do not edit. */

// ../physics/src/sun.js
var D2R = Math.PI / 180;
var R2D = 180 / Math.PI;
var mod = (a, n) => (a % n + n) % n;
function julianDay(date) {
  const ms = typeof date === "number" ? date : date.getTime();
  return ms / 864e5 + 24405875e-1;
}
function solarCoordinates(date) {
  const jd = julianDay(date);
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 3032e-7), 360);
  const M = 357.52911 + T * (35999.05029 - 1537e-7 * T);
  const e = 0.016708634 - T * (42037e-9 + 1267e-10 * T);
  const Mr = M * D2R;
  const C = Math.sin(Mr) * (1.914602 - T * (4817e-6 + 14e-6 * T)) + Math.sin(2 * Mr) * (0.019993 - 101e-6 * T) + Math.sin(3 * Mr) * 289e-6;
  const trueLong = L0 + C;
  const trueAnom = M + C;
  const R = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(trueAnom * D2R));
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 569e-5 - 478e-5 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (59e-5 - T * 1813e-6))) / 60) / 60;
  const eps = eps0 + 256e-5 * Math.cos(omega * D2R);
  const lr = lambda * D2R, er = eps * D2R;
  const ra = mod(Math.atan2(Math.cos(er) * Math.sin(lr), Math.cos(lr)) * R2D, 360);
  const decl = Math.asin(Math.sin(er) * Math.sin(lr)) * R2D;
  const y = Math.tan(er / 2) ** 2;
  const L0r = L0 * D2R;
  const eqTime = 4 * R2D * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  return { jd, T, declination: decl, rightAscension: ra, eqTime, distanceAU: R, apparentLongitude: lambda };
}
function refractionNOAA(elevDeg, pressureHPa = 1010, tempC = 10) {
  const h = elevDeg;
  let r;
  if (h > 85) r = 0;
  else if (h > 5) {
    const t = Math.tan(h * D2R);
    r = 58.1 / t - 0.07 / t ** 3 + 86e-6 / t ** 5;
  } else if (h > -0.575) r = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)));
  else r = -20.774 / Math.tan(h * D2R);
  r /= 3600;
  return r * (pressureHPa / 1010) * (283 / (273 + tempC));
}
function sunPosition(date, lat, lon, o = {}) {
  const ms = typeof date === "number" ? date : date.getTime();
  const sc = solarCoordinates(ms);
  const utcMin = mod(ms / 6e4, 1440);
  const tst = mod(utcMin + sc.eqTime + 4 * lon, 1440);
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const latr = lat * D2R, dr = sc.declination * D2R, har = ha * D2R;
  const cz = Math.min(1, Math.max(-1, Math.sin(latr) * Math.sin(dr) + Math.cos(latr) * Math.cos(dr) * Math.cos(har)));
  let elevGeo = 90 - Math.acos(cz) * R2D;
  if (o.parallax) elevGeo -= 8.794 / 3600 * Math.cos(elevGeo * D2R) / sc.distanceAU;
  const refr = o.refraction === false ? 0 : refractionNOAA(elevGeo, o.pressure ?? 1010, o.temperature ?? 10);
  const elevation = elevGeo + refr;
  const az = mod(Math.atan2(Math.sin(har), Math.cos(har) * Math.sin(latr) - Math.tan(dr) * Math.cos(latr)) * R2D + 180, 360);
  return {
    elevation,
    azimuth: az,
    zenith: 90 - elevation,
    elevationGeometric: elevGeo,
    refraction: refr,
    declination: sc.declination,
    eqTime: sc.eqTime,
    hourAngle: ha
  };
}
function sunVector(elevationDeg, azimuthDeg, gammaDeg = 0) {
  const a = (azimuthDeg - gammaDeg) * D2R, e = elevationDeg * D2R;
  return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: -Math.cos(e) * Math.cos(a) };
}
var ITM_LON0 = 35 + 12 / 60 + 16.261 / 3600;
function itmConvergence(lat, lon) {
  const dl = (lon - ITM_LON0) * D2R, p = lat * D2R;
  return R2D * dl * Math.sin(p) * (1 + (dl * Math.cos(p)) ** 2 / 3);
}
function tzOffsetMinutes(date, timeZone = "Asia/Jerusalem") {
  const ms = typeof date === "number" ? date : date.getTime();
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - Math.floor(ms / 1e3) * 1e3) / 6e4);
  } catch (e) {
    if (timeZone === "Asia/Jerusalem") return israelOffsetRule(ms);
    throw e;
  }
}
function israelOffsetRule(ms) {
  const y = new Date(ms).getUTCFullYear();
  const lastSunday = (month) => {
    const d = new Date(Date.UTC(y, month + 1, 0));
    return d.getUTCDate() - d.getUTCDay();
  };
  const start = Date.UTC(y, 2, lastSunday(2) - 2, 0, 0);
  const end = Date.UTC(y, 9, lastSunday(9), -1, 0);
  return ms >= start && ms < end ? 180 : 120;
}
function localToUtc(y, m, d, hh = 0, mm = 0, ss = 0, timeZone = "Asia/Jerusalem") {
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss);
  let ms = naive - tzOffsetMinutes(naive, timeZone) * 6e4;
  ms = naive - tzOffsetMinutes(ms, timeZone) * 6e4;
  return new Date(ms);
}
function formatLocal(date, timeZone = "Asia/Jerusalem") {
  const ms = typeof date === "number" ? date : date.getTime();
  const t = new Date(ms + tzOffsetMinutes(ms, timeZone) * 6e4);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}
function sunTimes(y, m, d, lat, lon, timeZone = "Asia/Jerusalem", zenithDeg = 90.833) {
  const latr = lat * D2R;
  const event = (kind) => {
    let t = Date.UTC(y, m - 1, d, 12) - lon / 15 * 36e5;
    for (let i = 0; i < 4; i++) {
      const sc = solarCoordinates(t);
      const dr = sc.declination * D2R;
      let haDeg = 0;
      if (kind !== 0) {
        const c = Math.cos(zenithDeg * D2R) / (Math.cos(latr) * Math.cos(dr)) - Math.tan(latr) * Math.tan(dr);
        if (c > 1 || c < -1) return null;
        haDeg = Math.acos(c) * R2D * kind;
      }
      const utcDay = Math.floor(t / 864e5) * 864e5;
      let minUTC = 720 - 4 * (lon - haDeg) - sc.eqTime;
      let tn = utcDay + minUTC * 6e4;
      while (tn - t > 432e5) tn -= 864e5;
      while (t - tn > 432e5) tn += 864e5;
      t = tn;
    }
    return new Date(Math.round(t));
  };
  const sunrise = event(-1), sunset = event(1), solarNoon = event(0);
  const off = tzOffsetMinutes(solarNoon, timeZone);
  return {
    sunrise,
    sunset,
    solarNoon,
    dayLengthMin: sunrise && sunset ? (sunset - sunrise) / 6e4 : null,
    utcOffsetMin: off,
    local: {
      sunrise: sunrise && formatLocal(sunrise, timeZone),
      sunset: sunset && formatLocal(sunset, timeZone),
      solarNoon: formatLocal(solarNoon, timeZone)
    }
  };
}

// src/astro.js
var ASHDOD = { lat: 31.8014, lon: 34.6435, tz: "Asia/Jerusalem" };
var mod2 = (a, n) => (a % n + n) % n;
var sinD = (d) => Math.sin(d * D2R);
var cosD = (d) => Math.cos(d * D2R);
function gmstDeg(ms) {
  const jd = julianDay(ms), T = (jd - 2451545) / 36525;
  return mod2(280.46061837 + 360.98564736629 * (jd - 2451545) + T * T * (387933e-9 - T / 3871e4), 360);
}
function equatorialToHorizontal(raDeg, decDeg, ms, lat, lon) {
  const H = mod2(gmstDeg(ms) + lon - raDeg, 360);
  const sa = sinD(lat) * sinD(decDeg) + cosD(lat) * cosD(decDeg) * cosD(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sa))) * R2D;
  const az = mod2(Math.atan2(-cosD(decDeg) * sinD(H), cosD(lat) * sinD(decDeg) - sinD(lat) * cosD(decDeg) * cosD(H)) * R2D, 360);
  return { elevation: el, azimuth: az, hourAngle: H };
}
function moonPosition(date, lat, lon) {
  const ms = typeof date === "number" ? date : date.getTime();
  const jd = julianDay(ms), T = (jd - 2451545) / 36525;
  const Lp = mod2(218.3164477 + 481267.88123421 * T, 360);
  const D = mod2(297.8501921 + 445267.1114034 * T, 360);
  const M = mod2(357.5291092 + 35999.0502909 * T, 360);
  const Mp = mod2(134.9633964 + 477198.8675055 * T, 360);
  const F = mod2(93.272095 + 483202.0175233 * T, 360);
  const lonM = Lp + 6.288774 * sinD(Mp) + 1.274027 * sinD(2 * D - Mp) + 0.658314 * sinD(2 * D) + 0.213618 * sinD(2 * Mp) - 0.185116 * sinD(M) - 0.114332 * sinD(2 * F) + 0.058793 * sinD(2 * D - 2 * Mp) + 0.057066 * sinD(2 * D - M - Mp) + 0.053322 * sinD(2 * D + Mp) + 0.045758 * sinD(2 * D - M) - 0.040923 * sinD(M - Mp) - 0.03472 * sinD(D) - 0.030383 * sinD(M + Mp);
  const latM = 5.128122 * sinD(F) + 0.280602 * sinD(Mp + F) + 0.277693 * sinD(Mp - F) + 0.173237 * sinD(2 * D - F) + 0.055413 * sinD(2 * D - Mp + F) + 0.046271 * sinD(2 * D - Mp - F) + 0.032573 * sinD(2 * D + F);
  const distanceKm = 385000.56 - 20905.355 * cosD(Mp) - 3699.111 * cosD(2 * D - Mp) - 2955.968 * cosD(2 * D) - 569.925 * cosD(2 * Mp);
  const eps = 23.4392911 - 0.0130042 * T;
  const ra = mod2(Math.atan2(sinD(lonM) * cosD(eps) - Math.tan(latM * D2R) * sinD(eps), cosD(lonM)) * R2D, 360);
  const dec = Math.asin(sinD(latM) * cosD(eps) + cosD(latM) * sinD(eps) * sinD(lonM)) * R2D;
  const h = equatorialToHorizontal(ra, dec, ms, lat, lon);
  const elevGeo = h.elevation;
  h.elevation = elevGeo - Math.asin(6378.14 / distanceKm) * R2D * Math.cos(elevGeo * D2R);
  const sunLon = solarCoordinates(ms).apparentLongitude;
  const cpsi = cosD(latM) * cosD(lonM - sunLon);
  const elong = Math.acos(Math.max(-1, Math.min(1, cpsi))) * R2D;
  const phaseAngle = Math.atan2(1495978707e-1 * sinD(elong), distanceKm - 1495978707e-1 * cpsi) * R2D;
  const illumination = (1 + cosD(phaseAngle)) / 2;
  const waxing = mod2(lonM - sunLon, 360) < 180;
  const ageDays = mod2(lonM - sunLon, 360) / 360 * 29.530589;
  return { elevation: h.elevation, elevationGeocentric: elevGeo, azimuth: h.azimuth, ra, dec, lon: lonM, lat: latM, distanceKm, elongation: elong, phaseAngle, illumination, waxing, ageDays };
}
var PHASE_HE = ["\u05DE\u05D5\u05DC\u05D3", "\u05E1\u05D4\u05E8 \u05DE\u05EA\u05DE\u05DC\u05D0", "\u05E8\u05D1\u05E2 \u05E8\u05D0\u05E9\u05D5\u05DF", "\u05D9\u05E8\u05D7 \u05DE\u05EA\u05DE\u05DC\u05D0 (\u05D2\u05D9\u05D1\u05E0\u05D9)", "\u05D9\u05E8\u05D7 \u05DE\u05DC\u05D0", "\u05D9\u05E8\u05D7 \u05DE\u05EA\u05DE\u05E2\u05D8 (\u05D2\u05D9\u05D1\u05E0\u05D9)", "\u05E8\u05D1\u05E2 \u05D0\u05D7\u05E8\u05D5\u05DF", "\u05E1\u05D4\u05E8 \u05DE\u05EA\u05DE\u05E2\u05D8"];
function moonPhaseNameHe(m) {
  const i = Math.round(m.ageDays / 29.530589 * 8) % 8;
  return PHASE_HE[i];
}
function equatorialToTwinMatrix(ms, lat, lon) {
  const L = (gmstDeg(ms) + lon) * D2R, p = lat * D2R, cL = Math.cos(L), sL = Math.sin(L), cp = Math.cos(p), sp = Math.sin(p);
  return [
    -sL,
    cL,
    0,
    // x = east
    cp * cL,
    cp * sL,
    sp,
    // y = up
    sp * cL,
    sp * sL,
    -cp
    // z = south = −north
  ];
}
var BRIGHT_STARS = [
  ["Sirius", 6.7525, -16.716, -1.46, 0],
  ["Canopus", 6.3992, -52.696, -0.74, 0.15],
  ["Arcturus", 14.261, 19.182, -0.05, 1.23],
  ["Vega", 18.6156, 38.784, 0.03, 0],
  ["Capella", 5.2782, 45.998, 0.08, 0.8],
  ["Rigel", 5.2423, -8.202, 0.13, -0.03],
  ["Procyon", 7.655, 5.225, 0.34, 0.42],
  ["Betelgeuse", 5.9195, 7.407, 0.5, 1.85],
  ["Altair", 19.8464, 8.868, 0.76, 0.22],
  ["Aldebaran", 4.5987, 16.509, 0.85, 1.54],
  ["Antares", 16.4901, -26.432, 0.96, 1.83],
  ["Spica", 13.4199, -11.161, 0.97, -0.23],
  ["Pollux", 7.7553, 28.026, 1.14, 1],
  ["Fomalhaut", 22.9608, -29.622, 1.16, 0.09],
  ["Deneb", 20.6905, 45.28, 1.25, 0.09],
  ["Regulus", 10.1395, 11.967, 1.35, -0.11],
  ["Castor", 7.5767, 31.888, 1.58, 0.03],
  ["Alnilam", 5.6036, -1.202, 1.69, -0.18],
  ["Alnitak", 5.6793, -1.943, 1.77, -0.21],
  ["Dubhe", 11.0621, 61.751, 1.79, 1.07],
  ["Alkaid", 13.7923, 49.313, 1.86, -0.19],
  ["Polaris", 2.5303, 89.264, 1.98, 0.6],
  ["Mintaka", 5.5334, -0.299, 2.23, -0.22],
  ["Bellatrix", 5.4189, 6.35, 1.64, -0.22]
];
function bvToRgb(bv) {
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  return kelvinToRgb(T);
}
function kelvinToRgb(K) {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = [r, g, b].map((v) => Math.min(255, Math.max(0, v)) / 255);
  const lin = c.map((v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const m = Math.max(...lin);
  return lin.map((v) => v / m);
}
function starField(nSynthetic = 1400, seed = 27) {
  const out = [];
  for (const [name, raH, dec, mag, bv] of BRIGHT_STARS) {
    const a = raH * 15 * D2R, d = dec * D2R;
    out.push({ name, v: [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)], mag, rgb: bvToRgb(bv), real: true });
  }
  let s = seed >>> 0;
  const rnd = () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < nSynthetic; i++) {
    const z = rnd() * 2 - 1, ph = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const mag = 5 - Math.log10(1 + rnd() * (Math.pow(10, 0.6 * 2.7) - 1)) / 0.6;
    out.push({ v: [r * Math.cos(ph), r * Math.sin(ph), z], mag, rgb: bvToRgb(rnd() * 1.6 - 0.1), real: false });
  }
  return out;
}
function skyState(date, site = ASHDOD) {
  const ms = typeof date === "number" ? date : date.getTime();
  const sp = sunPosition(ms, site.lat, site.lon);
  const mp = moonPosition(ms, site.lat, site.lon);
  const gamma = site.gammaDeg != null ? site.gammaDeg : itmConvergence(site.lat, site.lon);
  return {
    ms,
    sun: sp,
    moon: mp,
    sunDir: sunVector(sp.elevation, sp.azimuth, gamma),
    moonDir: sunVector(mp.elevation, mp.azimuth, gamma),
    starMatrix: equatorialToTwinMatrix(ms, site.lat, site.lon),
    gammaDeg: gamma
  };
}

// src/curves.js
var LUX_UNIT = 3e4;
var clamp = (x, a, b) => x < a ? a : x > b ? b : x;
var smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
var lerp = (a, b, t) => a + (b - a) * t;
var D2R2 = Math.PI / 180;
function airMass(elevDeg) {
  const h = Math.max(-2, elevDeg);
  if (h <= 0) return 38 + -h * 6;
  return 1 / (Math.sin(h * D2R2) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}
var LAMBDA_UM = [0.68, 0.55, 0.45];
function rayleighTau(um) {
  const l2 = um * um;
  return 8569e-6 * Math.pow(um, -4) * (1 + 0.0113 / l2 + 13e-5 / (l2 * l2));
}
var TAU_R = LAMBDA_UM.map(rayleighTau);
var TAU_O3 = [0.016, 0.027, 3e-3];
var CLEAN_AEROSOL = { tau550: 0.12, alpha: 0.9, no2: 15, absorb: 0.08 };
function opticalDepth(aer = CLEAN_AEROSOL) {
  const n = (aer.no2 || 0) / 40;
  const tauNO2 = [0, 4e-3 * n, 0.018 * n];
  return LAMBDA_UM.map((l, i) => TAU_R[i] + TAU_O3[i] + aer.tau550 * Math.pow(l / 0.55, -aer.alpha) + tauNO2[i]);
}
function sunTransmittance(elevDeg, aer = CLEAN_AEROSOL) {
  const m = airMass(elevDeg), t = opticalDepth(aer);
  return t.map((x) => Math.exp(-m * x));
}
var Y = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
var GHI_E = [-90, -18, -15, -12, -9, -6, -4, -2, 0, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 90];
var GHI_L = [7e-4, 7e-4, 2e-3, 8e-3, 0.12, 3.4, 22, 120, 700, 1800, 4800, 12e3, 21e3, 31e3, 52e3, 7e4, 86e3, 1e5, 11e4, 118e3];
function globalIlluminanceClear(elevDeg) {
  const h = clamp(elevDeg, -90, 90);
  for (let i = 1; i < GHI_E.length; i++) if (h <= GHI_E[i]) {
    const t = (h - GHI_E[i - 1]) / (GHI_E[i] - GHI_E[i - 1]);
    return Math.exp(lerp(Math.log(GHI_L[i - 1]), Math.log(GHI_L[i]), t));
  }
  return GHI_L[GHI_L.length - 1];
}
var E_SOLAR_LUX = 128e3;
function sunSky(elevDeg, aer = CLEAN_AEROSOL, cloud = 0) {
  const T = sunTransmittance(elevDeg, aer), Tc = sunTransmittance(elevDeg, CLEAN_AEROSOL);
  const up = elevDeg > -0.833 ? smooth(-0.833, 0.5, elevDeg) : 0;
  const s = Math.max(0, Math.sin(elevDeg * D2R2));
  let direct = E_SOLAR_LUX * Y(T) * up;
  const directClean = E_SOLAR_LUX * Y(Tc) * up;
  const gClear = globalIlluminanceClear(elevDeg);
  let diffuse = Math.max(gClear * 0.13, gClear - directClean * s);
  diffuse += (1 - aer.absorb) * 0.75 * Math.max(0, directClean - direct) * s;
  const cc = clamp(cloud, 0, 1);
  direct *= 1 - 0.95 * Math.pow(cc, 1.5);
  const cloudDiffuse = (1 + 0.9 * cc * (1 - cc) * 2) * (1 - 0.55 * Math.pow(cc, 2.2));
  diffuse = diffuse * cloudDiffuse + 0.35 * cc * directClean * s * (1 - cc);
  const Tz = sunTransmittance(90, CLEAN_AEROSOL), rel = T.map((v, i) => v / Tz[i]), m = Math.max(...rel) || 1;
  return { direct, directH: direct * s, diffuse, total: direct * s + diffuse, sunRGB: rel.map((v) => v / m), T };
}
function skyChroma(elevDeg, haze = 0, dustTint = [0.82, 0.62, 0.38]) {
  const day = [0.55, 0.72, 1], low = [0.64, 0.77, 1], blue = [0.36, 0.48, 1], night = [0.42, 0.5, 0.75];
  let c;
  if (elevDeg >= 12) c = day;
  else if (elevDeg >= 2) c = day.map((v, i) => lerp(low[i], v, (elevDeg - 2) / 10));
  else if (elevDeg >= -6) c = low.map((v, i) => lerp(blue[i], v, (elevDeg + 6) / 8));
  else if (elevDeg >= -14) c = blue.map((v, i) => lerp(night[i], v, (elevDeg + 14) / 8));
  else c = night;
  const k = clamp(haze, 0, 1);
  c = c.map((v, i) => lerp(v, dustTint[i] * (elevDeg > -6 ? 1 : 0.6) + v * 0.15, k));
  const m = Math.max(...c);
  return c.map((v) => v / m);
}
function moonIlluminance(moonElevDeg, phaseAngleDeg, aer = CLEAN_AEROSOL) {
  if (moonElevDeg < -0.5) return 0;
  const i = Math.abs(phaseAngleDeg), dm = 0.026 * i + 4e-9 * Math.pow(i, 4);
  const T = Y(sunTransmittance(moonElevDeg, aer));
  return 0.27 * Math.pow(10, -0.4 * dm) * T * smooth(-0.5, 1, moonElevDeg) / Y(sunTransmittance(90, CLEAN_AEROSOL));
}
var OCC_H = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24];
var OCC_V = [0.3, 0.15, 0.1, 0.07, 0.06, 0.09, 0.22, 0.24, 0.12, 0.08, 0.12, 0.2, 0.36, 0.5, 0.58, 0.6, 0.55, 0.44, 0.3];
function windowOccupancy(hour) {
  const h = (hour % 24 + 24) % 24;
  for (let i = 1; i < OCC_H.length; i++) if (h <= OCC_H[i]) return lerp(OCC_V[i - 1], OCC_V[i], (h - OCC_H[i - 1]) / (OCC_H[i] - OCC_H[i - 1]));
  return OCC_V[0];
}
function streetLightsOn(sunElevDeg) {
  return 1 - smooth(-1.5, 2.5, sunElevDeg);
}
function cityAmbientLux(lightsOn, haze = 0) {
  return lightsOn * (0.9 + 1.2 * clamp(haze, 0, 1));
}
function adaptationLux({ sunElev, aer = CLEAN_AEROSOL, cloud = 0, moonElev = -90, moonPhaseAngle = 180, cityLux = 0 }) {
  const ss = sunSky(sunElev, aer, cloud);
  const mE = moonIlluminance(moonElev, moonPhaseAngle, aer) * Math.max(0, Math.sin(moonElev * D2R2)) * (1 - 0.8 * cloud);
  return ss.total + mE + cityLux;
}
var EXPOSURE = { key: 0.62, ref: 11e4, pDay: 0.9, E1: 1e3, pNight: 0.727, max: 9e3 };
function exposureFor(Elux, o = EXPOSURE) {
  const E = Math.max(Elux, 1e-4);
  const e1 = o.key * Math.pow(o.ref / o.E1, o.pDay);
  const e = E >= o.E1 ? o.key * Math.pow(o.ref / E, o.pDay) : e1 * Math.pow(o.E1 / E, o.pNight);
  return clamp(e, o.key * 0.8, o.max);
}
function phaseHe(elev) {
  if (elev >= 20) return "\u05D9\u05D5\u05DD";
  if (elev >= 6) return "\u05D0\u05D5\u05E8 \u05E0\u05DE\u05D5\u05DA";
  if (elev >= -0.833) return "\u05E9\u05E2\u05EA \u05D4\u05D6\u05D4\u05D1";
  if (elev >= -6) return "\u05D3\u05DE\u05D3\u05D5\u05DE\u05D9\u05DD (\u05E9\u05E2\u05D4 \u05DB\u05D7\u05D5\u05DC\u05D4)";
  if (elev >= -12) return "\u05D3\u05DE\u05D3\u05D5\u05DE\u05D9\u05DD \u05D9\u05DE\u05D9\u05D9\u05DD";
  if (elev >= -18) return "\u05D3\u05DE\u05D3\u05D5\u05DE\u05D9\u05DD \u05D0\u05E1\u05D8\u05E8\u05D5\u05E0\u05D5\u05DE\u05D9\u05D9\u05DD";
  return "\u05DC\u05D9\u05DC\u05D4";
}
function preethamRadiance(dir, sun, turbidity = 2.5, rayleigh = 1, mieCoefficient = 5e-3, mieG = 0.8) {
  const TR = [5804542996261093e-21, 13562911419845635e-21, 30265902468824876e-21], MC = [18399918514433978e-2, 27798023919660528e-2, 40790479543861094e-2];
  const zc = Math.max(-1, Math.min(1, sun.y));
  const sunE = 1e3 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(zc)) / 1.5)));
  const bR = TR.map((v) => v * rayleigh), bM = MC.map((v) => 0.434 * 0.2 * turbidity * 1e-17 * v * mieCoefficient);
  const yp = Math.max(dir.y, 0), zen = Math.acos(yp);
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zen * 180 / Math.PI, -1.253));
  const Fex = bR.map((r, i) => Math.exp(-(r * 8400 * inv + bM[i] * 1250 * inv)));
  const cosT = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  const rPh = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g2 = mieG * mieG, mPh = 0.07957747 * (1 - g2) / Math.pow(1 - 2 * mieG * cosT + g2, 1.5);
  const k = Math.max(0, Math.min(1, Math.pow(1 - sun.y, 5))), dayL0 = Math.max(0, Math.min(1, (sun.y + 0.08) / 0.13));
  return [0, 1, 2].map((i) => {
    const ratio = (bR[i] * rPh + bM[i] * mPh) / (bR[i] + bM[i]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex[i]), 1.5);
    Lin *= 1 + (Math.pow(sunE * ratio * Fex[i], 0.5) - 1) * k;
    return (Lin + 0.1 * Fex[i] * dayL0 * dayL0 * (3 - 2 * dayL0)) * 0.04;
  });
}

// src/airquality.js
var OPEN_METEO_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
var ATTRIBUTION_AQ = {
  openMeteo: '<a href="https://open-meteo.com/">Air quality data by Open-Meteo.com</a> \xB7 CAMS \u2014 Copernicus Atmosphere Monitoring Service',
  cams: "Generated using Copernicus Atmosphere Monitoring Service information " + (/* @__PURE__ */ new Date()).getUTCFullYear(),
  sviva: "\u05E0\u05EA\u05D5\u05E0\u05D9 \u05E0\u05D9\u05D8\u05D5\u05E8: \u05D4\u05DE\u05E9\u05E8\u05D3 \u05DC\u05D4\u05D2\u05E0\u05EA \u05D4\u05E1\u05D1\u05D9\u05D1\u05D4 \u2013 air.sviva.gov.il",
  preset: "\u05E0\u05EA\u05D5\u05E0\u05D9 \u05D3\u05D5\u05D2\u05DE\u05D4 (\u05DC\u05D0 \u05DE\u05D3\u05D9\u05D3\u05D4)"
};
var clamp2 = (x, a, b) => x < a ? a : x > b ? b : x;
var AQ_PRESETS = {
  clean: { label_he: "\u05D0\u05D5\u05D5\u05D9\u05E8 \u05E0\u05E7\u05D9", pm25: 8, pm10: 22, dust: 6, no2: 12, rh: 62, note: "\u05D1\u05E8\u05D9\u05D6\u05EA \u05D9\u05DD, \u05D0\u05D7\u05E8\u05D9 \u05D2\u05E9\u05DD" },
  sharav: { label_he: "\u05E9\u05E8\u05D1 (\u05D0\u05D1\u05E7)", pm25: 80, pm10: 420, dust: 360, no2: 18, rh: 18, note: '\u05E1\u05D5\u05E4\u05EA \u05D0\u05D1\u05E7 \u05DE\u05D6\u05E8\u05D7\u05D9\u05EA/\u05D3\u05E8\u05D5\u05DE\u05D9\u05EA; PM10 \u05E9\u05DC \u05DE\u05D0\u05D5\u05EA \u05E2\u05D3 \u05D0\u05DC\u05E4\u05D9 \u05DE\u05E7"\u05D2 \u05E0\u05DE\u05D3\u05D3\u05D9\u05DD \u05D1\u05D9\u05E9\u05E8\u05D0\u05DC \u05D1\u05D0\u05D9\u05E8\u05D5\u05E2\u05D9 \u05D0\u05D1\u05E7' },
  smog: { label_he: "\u05E2\u05E8\u05E4\u05D9\u05D7 \u05E2\u05D9\u05E8\u05D5\u05E0\u05D9", pm25: 48, pm10: 75, dust: 12, no2: 70, rh: 70, note: "\u05D4\u05D9\u05E4\u05D5\u05DA \u05D8\u05DE\u05E4\u05E8\u05D8\u05D5\u05E8\u05D4, \u05EA\u05E0\u05D5\u05E2\u05D4 \u05D5\u05E0\u05DE\u05DC, \u05D1\u05D5\u05E7\u05E8 \u05D7\u05D5\u05E8\u05E3" },
  storm: { label_he: "\u05E1\u05E2\u05E8\u05EA \u05D7\u05D5\u05E8\u05E3", pm25: 5, pm10: 30, dust: 2, no2: 8, rh: 92, note: "\u05E8\u05D9\u05E1\u05D5\u05E1 \u05D9\u05DE\u05D9 \u05D5\u05E8\u05D8\u05D9\u05D1\u05D5\u05EA, \u05E8\u05D0\u05D5\u05EA \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA \u05D1\u05D2\u05E9\u05DD" }
};
var ugToPpbNO2 = (ug) => ug / 1.88;
function fRH(rh = 60) {
  const r = clamp2(rh, 0, 95) / 100;
  return Math.min(4, Math.pow(1 - r, -0.5));
}
function dustExtinction(dust) {
  const c = Math.max(0, dust - 19);
  if (c <= 0) return 0;
  const Vkm = Math.pow(c / 914.06, -1 / 0.73);
  return 3912 / Vkm;
}
function estimateDust(aq) {
  if (aq.dust != null) return aq.dust;
  const pm10 = aq.pm10 || 0, pm25 = aq.pm25 != null ? aq.pm25 : pm10 * 0.5;
  return Math.max(0, pm10 - 1.8 * pm25) * (pm10 / Math.max(1, pm25) > 2.5 ? 1 : 0.4);
}
function aqToAtmosphere(aq = AQ_PRESETS.clean) {
  const pm10 = Math.max(0, aq.pm10 || 0), pm25 = Math.min(Math.max(0, aq.pm25 != null ? aq.pm25 : pm10 * 0.5), Math.max(pm10, aq.pm25 || 0));
  const dust = Math.max(0, estimateDust(aq)), no2 = Math.max(0, aq.no2 || 0), f = fRH(aq.rh != null ? aq.rh : 60);
  const fineDust = Math.min(pm25, 0.22 * dust);
  const fineOther = Math.max(0, pm25 - fineDust);
  const coarseOther = Math.max(0, pm10 - pm25 - Math.max(0, dust - fineDust));
  const parts = {
    rayleigh: 11,
    fine: 3 * f * fineOther,
    dust: Math.max(dustExtinction(dust), 1 * fineDust + 0.6 * Math.max(0, dust - fineDust)),
    coarse: 0.6 * coarseOther * (0.6 + 0.4 * f),
    // sea salt grows with humidity too
    no2: 0.33 * ugToPpbNO2(no2)
  };
  const bext = parts.rayleigh + parts.fine + parts.dust + parts.coarse + parts.no2;
  const visibility_m = 3.912 / (bext * 1e-6);
  const aerExt = bext - parts.rayleigh - parts.no2;
  const tauModel = (parts.fine + parts.coarse) * 1e-6 * 1200 + parts.dust * 1e-6 * 1300 + 0.05;
  const tau550 = aq.aod != null && isFinite(aq.aod) ? Math.max(aq.aod, 0.02) : tauModel;
  const wDust = parts.dust / Math.max(1e-6, aerExt), wFine = parts.fine / Math.max(1e-6, aerExt), wCoarse = parts.coarse / Math.max(1e-6, aerExt);
  const alpha = 0.15 * wDust + 1.45 * wFine + 0.35 * wCoarse;
  const absorb = clamp2(0.06 + 0.1 * wDust + 0.1 * wFine * (1 + no2 / 60), 0.04, 0.35);
  const cClean = [0.8, 0.86, 0.93], cSalt = [0.9, 0.91, 0.92], cDust = [0.86, 0.74, 0.56], cSmog = [0.7, 0.66, 0.6], cNO2 = [0.66, 0.53, 0.38];
  const smogF = clamp2((pm25 - 12) / 40, 0, 1);
  const w = { clean: parts.rayleigh, salt: parts.coarse + parts.fine * (1 - smogF), dust: parts.dust, smog: parts.fine * smogF, no2: parts.no2 * 4 };
  const W = w.clean + w.salt + w.dust + w.smog + w.no2;
  const hazeColor = [0, 1, 2].map((i) => (cClean[i] * w.clean + cSalt[i] * w.salt + cDust[i] * w.dust + cSmog[i] * w.smog + cNO2[i] * w.no2) / W);
  return {
    bext,
    visibility_m,
    beta: bext * 1e-6,
    tau550,
    alpha,
    absorb,
    no2,
    hazeColor,
    dustiness: clamp2(parts.dust / Math.max(1, bext) * clamp2(Math.log10(1 + parts.dust / 30), 0, 1.2), 0, 1),
    smogginess: clamp2((parts.fine + parts.no2) / Math.max(1, bext) * clamp2(Math.log10(1 + (parts.fine + parts.no2) / 30), 0, 1.2), 0, 1),
    parts
  };
}
var EAQI_BANDS = {
  pm25: [10, 20, 25, 50, 75],
  pm10: [20, 40, 50, 100, 150],
  no2: [40, 90, 120, 230, 340]
};
var EAQI_HE = ["\u05D8\u05D5\u05D1\u05D4", "\u05E1\u05D1\u05D9\u05E8\u05D4", "\u05D1\u05D9\u05E0\u05D5\u05E0\u05D9\u05EA", "\u05D9\u05E8\u05D5\u05D3\u05D4", "\u05D9\u05E8\u05D5\u05D3\u05D4 \u05DE\u05D0\u05D5\u05D3", "\u05D9\u05E8\u05D5\u05D3\u05D4 \u05D1\u05D9\u05D5\u05EA\u05E8"];
var EAQI_COLOR = ["#50F0E6", "#50CCAA", "#F0E641", "#FF5050", "#960032", "#7D2181"];
function eaqiLevel(aq) {
  let worst = 0, by = "pm10";
  for (const k of Object.keys(EAQI_BANDS)) {
    const v = aq[k];
    if (v == null) continue;
    let lvl = EAQI_BANDS[k].findIndex((t) => v <= t);
    if (lvl < 0) lvl = 5;
    if (lvl > worst) {
      worst = lvl;
      by = k;
    }
  }
  return { level: worst, by, label_he: EAQI_HE[worst], color: EAQI_COLOR[worst] };
}
function israelIndexCategory(v) {
  if (v == null || !isFinite(v)) return null;
  if (v >= 51) return { label_he: "\u05D0\u05D9\u05DB\u05D5\u05EA \u05D0\u05D5\u05D5\u05D9\u05E8 \u05D8\u05D5\u05D1\u05D4", color: "#00E400" };
  if (v >= 0) return { label_he: "\u05D6\u05D9\u05D4\u05D5\u05DD \u05D0\u05D5\u05D5\u05D9\u05E8 \u05D1\u05E8\u05DE\u05D4 \u05D1\u05D9\u05E0\u05D5\u05E0\u05D9\u05EA", color: "#FFFF00" };
  if (v >= -200) return { label_he: "\u05D6\u05D9\u05D4\u05D5\u05DD \u05D0\u05D5\u05D5\u05D9\u05E8 \u05D1\u05E8\u05DE\u05D4 \u05D2\u05D1\u05D5\u05D4\u05D4", color: "#FF0000" };
  return { label_he: "\u05D6\u05D9\u05D4\u05D5\u05DD \u05D0\u05D5\u05D5\u05D9\u05E8 \u05D1\u05E8\u05DE\u05D4 \u05D2\u05D1\u05D5\u05D4\u05D4 \u05DE\u05D0\u05D5\u05D3", color: "#7E0023" };
}
var POLL_HE = { pm25: "\u05D7\u05DC\u05E7\u05D9\u05E7\u05D9\u05DD \u05E2\u05D3\u05D9\u05E0\u05D9\u05DD PM2.5", pm10: "\u05D7\u05DC\u05E7\u05D9\u05E7\u05D9\u05DD PM10", no2: "\u05D7\u05E0\u05E7\u05DF \u05D3\u05D5-\u05D7\u05DE\u05E6\u05E0\u05D9", dust: "\u05D0\u05D1\u05E7" };
var fmtKm = (m) => m >= 1e4 ? Math.round(m / 1e3) + ' \u05E7"\u05DE' : Math.round(m / 100) / 10 + ' \u05E7"\u05DE';
function aqiChip(aq, atm = aqToAtmosphere(aq)) {
  const il = israelIndexCategory(aq.ilIndex);
  const e = eaqiLevel(aq);
  const main = il ? il.label_he : "\u05D0\u05D9\u05DB\u05D5\u05EA \u05D0\u05D5\u05D5\u05D9\u05E8 " + e.label_he;
  const dusty = atm.dustiness > 0.35;
  const parts = [];
  if (dusty) parts.push("\u05D0\u05D1\u05E7 " + Math.round(estimateDust(aq)) + ' \u05DE\u05E7"\u05D2/\u05DE"\u05E7');
  else parts.push(POLL_HE[e.by].split(" ").pop() + " " + Math.round(aq[e.by] || 0));
  parts.push("\u05E8\u05D0\u05D5\u05EA ~" + fmtKm(Math.min(atm.visibility_m, 99e3)));
  return {
    text: main + " \xB7 " + parts.join(" \xB7 "),
    main,
    detail: parts.join(" \xB7 "),
    color: il ? il.color : e.color,
    level: e.level,
    scale_he: il ? "\u05DE\u05D3\u05D3 \u05D9\u05E9\u05E8\u05D0\u05DC\u05D9 (100 \u05E2\u05D3 \u2212400)" : "\u05DE\u05D3\u05D3 \u05D0\u05D9\u05E8\u05D5\u05E4\u05D9 (EAQI) \u05DE\u05D7\u05D5\u05E9\u05D1 \u05DE\u05E8\u05D9\u05DB\u05D5\u05D6\u05D9\u05DD",
    source_he: aq.source === "sviva" ? ATTRIBUTION_AQ.sviva : aq.source === "open-meteo" ? "Open-Meteo / CAMS" : ATTRIBUTION_AQ.preset
  };
}
function normalizeOpenMeteoAQ(j) {
  if (!j || !j.hourly || !Array.isArray(j.hourly.time)) throw Object.assign(new Error("bad open-meteo body"), { code: "BAD_BODY" });
  const H = j.hourly, off = (j.utc_offset_seconds || 0) * 1e3, n = H.time.length, out = [];
  const num = (a, i) => a && a[i] != null && isFinite(a[i]) ? +a[i] : null;
  for (let i = 0; i < n; i++) {
    const t = H.time[i];
    const ms = typeof t === "number" ? t * 1e3 : Date.parse(t + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? "" : "Z")) - off;
    out.push({ time: ms, pm25: num(H.pm2_5, i), pm10: num(H.pm10, i), dust: num(H.dust, i), no2: num(H.nitrogen_dioxide, i), aod: num(H.aerosol_optical_depth, i), eaqi: num(H.european_aqi, i), source: "open-meteo" });
  }
  return out;
}
function openMeteoAQUrl({ lat, lon, base = OPEN_METEO_AQ_URL, apikey, pastDays = 1, forecastDays = 2 }) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "pm10,pm2_5,dust,nitrogen_dioxide,aerosol_optical_depth,european_aqi",
    timezone: "GMT",
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
    domains: "auto"
  });
  if (apikey) p.set("apikey", apikey);
  return base + "?" + p.toString();
}
function normalizeSviva(j, stationName = "") {
  const rows = j && (j.data || j.Data);
  if (!Array.isArray(rows)) throw Object.assign(new Error("bad sviva body"), { code: "BAD_BODY" });
  const map = { "PM10": "pm10", "PM2.5": "pm25", "PM25": "pm25", "NO2": "no2", "AQI": "ilIndex", "\u05DE\u05D3\u05D3": "ilIndex" };
  return rows.map((r) => {
    const rec = { time: Date.parse(r.datetime || r.DateTime), source: "sviva", station: stationName };
    for (const c of r.channels || r.Channels || []) {
      const k = map[c.name || c.Name];
      if (k && (c.valid !== false && c.Valid !== false) && isFinite(c.value ?? c.Value)) rec[k] = +(c.value ?? c.Value);
    }
    return rec;
  }).filter((r) => isFinite(r.time));
}
function sampleAQ(records, ms) {
  let best = null, bd = Infinity;
  for (const r of records || []) {
    const d = Math.abs(r.time - ms);
    if (d < bd && (r.pm10 != null || r.pm25 != null)) {
      bd = d;
      best = r;
    }
  }
  return best;
}
var memStore = /* @__PURE__ */ new Map();
var defaultStorage = () => {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("__aqt", "1");
      localStorage.removeItem("__aqt");
      return localStorage;
    }
  } catch (e) {
  }
  return { getItem: (k) => memStore.get(k) ?? null, setItem: (k, v) => memStore.set(k, v), removeItem: (k) => memStore.delete(k) };
};
async function getAirQuality({ lat = 31.8, lon = 34.65, preset = "clean", fetchImpl = globalThis.fetch, storage = defaultStorage(), ttlMs = 60 * 6e4, maxStaleMs = 24 * 36e5, timeoutMs = 8e3, now = Date.now(), base, apikey } = {}) {
  const key = `aq1:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  let cached = null;
  try {
    cached = JSON.parse(storage.getItem(key) || "null");
  } catch (e) {
    storage.removeItem(key);
  }
  const fromRecords = (recs, status, extra) => {
    const r = sampleAQ(recs, now);
    return r ? Object.assign({ status, aq: r, records: recs, attribution: ATTRIBUTION_AQ.openMeteo }, extra) : null;
  };
  if (cached && now - cached.at < ttlMs) {
    const r = fromRecords(cached.records, "cache");
    if (r) return r;
  }
  let error = null;
  if (typeof fetchImpl === "function") {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const to = ctl && setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(openMeteoAQUrl({ lat, lon, base, apikey }), ctl ? { signal: ctl.signal } : {});
      if (res.status === 429) error = { code: "RATE_LIMIT", message: "HTTP 429" };
      else if (!res.ok) error = { code: res.status >= 500 ? "SERVER" : "HTTP", message: "HTTP " + res.status };
      else {
        const recs = normalizeOpenMeteoAQ(await res.json());
        try {
          storage.setItem(key, JSON.stringify({ at: now, records: recs }));
        } catch (e) {
        }
        const r = fromRecords(recs, "live");
        if (r) return r;
        error = { code: "EMPTY", message: "no usable hours" };
      }
    } catch (e) {
      error = { code: e && e.name === "AbortError" ? "TIMEOUT" : e && e.code === "BAD_BODY" ? "BAD_BODY" : "NETWORK", message: String(e && e.message || e) };
    } finally {
      to && clearTimeout(to);
    }
  } else error = { code: "NO_FETCH", message: "fetch unavailable" };
  if (cached && now - cached.at < maxStaleMs) {
    const r = fromRecords(cached.records, "stale-cache", { error });
    if (r) return r;
  }
  const p = AQ_PRESETS[preset] || AQ_PRESETS.clean;
  return { status: "preset", aq: Object.assign({ source: "preset", time: now }, p), error, attribution: ATTRIBUTION_AQ.preset };
}

// src/palette.js
var PALETTE = {
  // --- built fabric (albedo, sRGB) ---
  plaster: ["#EDE6D6", "#E8DCC4", "#E3D6BC", "#DDD0B6", "#F1ECE2"],
  // white/cream plaster (most common)
  stone: ["#D9C9A8", "#CFBE9C", "#C9B79A", "#D6C7AB"],
  // light limestone cladding (new towers)
  shikun: ["#BDB7AA", "#B3AD9F", "#A9A498", "#C4BEB0"],
  // older grey concrete blocks
  accentWall: ["#E9C9A6", "#E3B98F", "#D8C3A0"],
  // ochre / peach plaster (rare)
  roofFlat: ["#D8D4CC", "#CFCBC2", "#E2DED6", "#C6C1B6"],
  // bitumen-white / grey roofs, solar heaters
  roofTile: ["#B5643C", "#A85A36", "#C0714A"],
  // terracotta (pitched roofs)
  // --- ground ---
  sand: "#E6D3A8",
  dune: "#E9D7AE",
  dryGround: "#CDBB92",
  asphalt: "#4A4A4C",
  asphaltWorn: "#8E877D",
  // worn Israeli asphalt reads light warm-grey (field 004/005: #B5A38D under lamps) pavement: '#BDB6A8',
  // --- sea (for the lighting look only; maritime team owns the water) ---
  seaDeep: "#0E4C6E",
  seaMid: "#1F6F8B",
  seaShallow: "#3FA7A8",
  foam: "#E8F1F0",
  // --- accents ---
  bougainvillea: "#C2185B",
  bougainvillea2: "#D81B60",
  shutterTeal: "#3E7C87",
  palmGreen: "#5E7A3A",
  // --- light sources (approximate blackbody → sRGB; Planck + CIE 1931, rounded) ---
  k1900: "#FF8A1F",
  // high-pressure sodium (HPS) ~1900–2100 K, narrow-band orange
  k2700: "#FFA757",
  // warm LED / incandescent windows
  k3000: "#FFB46B",
  k4000: "#FFD1A3",
  // municipal LED (4000 K, common in Israeli retrofit programs — assumption)
  k5000: "#FFE4CE",
  k6500: "#FFF9FD",
  tvBlue: "#9DB8FF",
  // TV / screen flicker in windows
  // --- reference skies (targets for the look; the renderer computes its own from the sun) ---
  noonZenith: "#3D7CC9",
  noonHorizon: "#BFD6E6",
  goldenSun: "#FFB55A",
  goldenHaze: "#F2C38B",
  blueZenith: "#1C2E5A",
  blueHorizon: "#5C6F9A",
  venusBelt: "#C9A0AE",
  nightSky: "#0B1020",
  moonlight: "#9DB4D8",
  sharavHaze: "#C9A46A",
  sharavSky: "#D8B984",
  sharavSun: "#FFE7B0",
  smogHaze: "#A89F8E",
  no2Brown: "#9A7A55",
  stormSky: "#6F7A84",
  stormCloud: "#4E5862",
  stormSea: "#3E5560"
};
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function rgbToHex(c) {
  return "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
}
var srgbToLinear = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
var linearToSrgb = (v) => v <= 31308e-7 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
var hexToLinear = (h) => hexToRgb(h).map(srgbToLinear);
var lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function hash01(n) {
  let x = (n | 0) ^ 2654435769;
  x = Math.imul(x ^ x >>> 16, 2246822507);
  x = Math.imul(x ^ x >>> 13, 3266489909);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function buildingAlbedo(id, typ = "", h = 10, pitched = false) {
  const s = typeof id === "number" ? id : hashString(String(id));
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
  const j = 0.97 + 0.06 * hash01(s * 31 + 11);
  return { wall: wall.map((v) => Math.min(1, v * j)), roof: roof.map((v) => Math.min(1, v * j)) };
}
function grade(rgb) {
  let [r, g, b] = rgb;
  const L = lum([r, g, b]);
  const sh = Math.max(0, 1 - L / 0.45), hl = Math.max(0, (L - 0.55) / 0.45);
  r += -0.02 * sh + 0.025 * hl;
  g += 4e-3 * sh + 0.01 * hl;
  b += 0.04 * sh - 0.015 * hl;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), C = mx - mn;
  let hue = 0;
  if (C > 1e-6) {
    if (mx === r) hue = ((g - b) / C + 6) % 6;
    else if (mx === g) hue = (b - r) / C + 2;
    else hue = (r - g) / C + 4;
  }
  hue *= 60;
  const near = (h0, w) => Math.max(0, 1 - Math.abs((hue - h0 + 540) % 360 - 180) / w);
  let sat = 1 + 0.08 * (1 - hl) + 0.06 * near(200, 40) - 0.06 * near(100, 40);
  const L2 = lum([r, g, b]);
  r = L2 + (r - L2) * sat;
  g = L2 + (g - L2) * sat;
  b = L2 + (b - L2) * sat;
  const toe = 8e-3 * Math.max(0, 1 - L2 / 0.08);
  return [r + toe * 0.6, g + toe * 0.8, b + toe * 1.4].map((v) => Math.min(1, Math.max(0, v)));
}
function buildLUT(size = 32) {
  const out = new Uint8Array(size * size * size * 4);
  let o = 0;
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const c = grade([ri / (size - 1), gi / (size - 1), bi / (size - 1)]);
    out[o++] = Math.round(c[0] * 255);
    out[o++] = Math.round(c[1] * 255);
    out[o++] = Math.round(c[2] * 255);
    out[o++] = 255;
  }
  return out;
}
function buildCube(size = 33, title = "ESH27 Ashdod Mediterranean v1") {
  const L = [`TITLE "${title}"`, `# ESH27 twin art direction. Display-referred (apply after ACES/AgX tone mapping, sRGB in/out).`, `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0"];
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const c = grade([ri / (size - 1), gi / (size - 1), bi / (size - 1)]);
    L.push(c.map((v) => v.toFixed(6)).join(" "));
  }
  return L.join("\n") + "\n";
}
function pregradeAlbedo(rgb, strength = 0.6) {
  const g = grade(rgb);
  return rgb.map((v, i) => v + (g[i] - v) * strength);
}
var FIELD_NIGHT = {
  sky_between_clouds: "#0A0F1C",
  // 001/003/008: #080E1C #090F1C #0B1018 — dark navy, never black
  cloud_moonlit: "#434348",
  // 006 — neutral grey, slight violet
  cloud_city_lit_low: "#363133",
  // 008 low clouds over the city: warm-magenta grey (h≈336°)
  cloud_lit: "#292937",
  // 001
  moon_halo: "#6B737E",
  // 006 — cool grey-blue corona around a 96% moon
  moon_core: "#E5FEFF",
  // 006/008 clipped, cyan-white (phone WB)
  // street lighting: two types side by side
  sodium_asphalt_pool: "#957E5F",
  // 001 — hue 33°, amber pool
  sodium_asphalt_hot: "#DAC3A6",
  // 003 — centre of the pool
  sodium_plaster: "#645447",
  // 001/003 cream plaster under sodium → #645447 / #574941
  asphalt_midstreet: "#63513E",
  // 001 — between pools (≈0.65× pool luma)
  asphalt_far_dark: "#473A30",
  // 003
  led_asphalt: "#BBA994",
  // 004 — under a 4000 K LED head (asphalt itself is warm beige)
  led_halo: "#EBE4D6",
  // 011 — near-white, faintly warm (≈4000 K after phone WB)
  car_shadow: "#231E1D",
  // 004 — hard, ~1/5 of the lit asphalt luma
  // materials
  red_pavers: ["#614132", "#6A4A34", "#514036", "#917358"],
  // 005 009 004 001 (interlocking "אבן משתלבת")
  grey_pavers: "#7E664C",
  // 011 (newer street, grey/beige pavers under LED)
  curb_stone: "#8B7B6A",
  // 005 white/grey curb under sodium
  limestone_wall: "#987855",
  // 011 villa block wall under LED
  stone_cladding: ["#71523C", "#5D4836"],
  // 006 008
  garage_door: "#181818",
  // 004/005/006 dark grey
  // windows (interiors)
  window_warm: "#EDCE94",
  // 007 incandescent / warm LED
  window_warm_dim: "#D4B592",
  window_cool_led: "#7AA6BB",
  // 007 cool LED / screen
  tower_windows_avg: "#918166",
  // 008/010 average of lit windows on the towers (warm dominant)
  tower_facade_unlit: "#5C554B",
  occupancy_0100: 0.15,
  // eyeballed on the 008/010 towers: ~10–20% of windows lit at 01:00
  // crane (construction site next to the street)
  crane_blue_led: "#2E6EC8",
  // 007/009 LED strip along the jib (#2E6EC8 / #2A63A9)
  crane_red_light: "#DEAAA2",
  // 009 aviation obstruction light (clipped core → pink-white)
  crane_red_steel: "#4C1815"
  // 008 jib structure, lit
};
var LAMP_TYPES = {
  sodium: { kelvin: 2050, color: "#FF9A3C", label_he: "\u05E0\u05EA\u05E8\u05DF (\u05DB\u05EA\u05D5\u05DD)", lumens: 9e3, height: 8 },
  led: { kelvin: 4e3, color: "#FFE2C0", label_he: "\u05DC\u05D3 \u05DC\u05D1\u05DF", lumens: 8e3, height: 9 }
};
var LAMP_OBSERVED = { "\u05D4\u05D0\u05E8\u05D6": "led", "\u05E8\u05D5\u05D2\u05D5\u05D6\u05D9\u05DF": "led", "\u05E8\u05D5\u05D2\u05D6\u05D9\u05DF": "led", "\u05D4\u05D0\u05D5\u05E8\u05DF": "led" };
function lampTypeForStreet(name = "", ledShare = 0.55) {
  if (LAMP_OBSERVED[name]) return LAMP_OBSERVED[name];
  return hash01(hashString(String(name) || "unnamed")) < ledShare ? "led" : "sodium";
}

// src/look.js
var PI = Math.PI;
var smooth2 = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
var norm = (c) => {
  const m = Math.max(...c) || 1;
  return c.map((v) => v / m);
};
var mul = (c, k) => c.map((v) => v * k);
var add = (a, b) => a.map((v, i) => v + b[i]);
var mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
var SODIUM = norm(hexToLinear(LAMP_TYPES.sodium.color));
var LED = norm(hexToLinear(LAMP_TYPES.led.color));
var CITY = norm(mix(SODIUM, LED, 0.7));
var GROUND_ALBEDO = hexToLinear("#9C9080");
var MOON_TINT = norm(hexToLinear("#9DB4D8"));
var W_WARM = norm(hexToLinear(FIELD_NIGHT.window_warm));
var W_COOL = norm(hexToLinear(FIELD_NIGHT.window_cool_led));
var W_TV = norm(hexToLinear("#9DB8FF"));
var LOOK_TUNING = {
  preethamGain: 0.65,
  // Preetham radiance → our scale. Value ladder: noon zenith displays ≈ #4682C8 (photo 044 sky at ~45°: #629BDD)
  windowRadiance: 9e-5,
  // lit window radiance (scene units) — ≈ 3 cd/m² equivalent; tuned to field photo 007/008
  lampSprite: 16e-4,
  // lamp head sprite radiance
  lampLux: 22,
  // peak illuminance under a lamp head (Israeli street lighting ~10–30 lux; SI 20.3 / EN 13201 classes)
  moonSky: 0.03,
  cityGlowSky: 0.022,
  cloudCity: 2,
  // night clouds 3–5× the gaps between them (photos 006/008/013)
  urbanSunlitGround: 0.35,
  // share of the ground bounce that carries direct sun (street canyons: most ground a wall sees is shaded)
  twilightSky: 1.6
  // twilight dome radiance factor (blue hour zenith ≈ 1–1.5× a white wall, as in photographs)
};
function lightsOnFor(Elux) {
  return 1 - smooth2(25, 120, Elux);
}
function computeLook({ ms, site = ASHDOD, aq = AQ_PRESETS.clean, weather = {} }) {
  const S = skyState(ms, site), atm = aqToAtmosphere(aq);
  const cloud = clamp(weather.cloud || 0, 0, 1), rain = clamp(weather.rain || 0, 0, 1);
  const aer = { tau550: atm.tau550, alpha: atm.alpha, no2: atm.no2, absorb: atm.absorb };
  const sunElev = S.sun.elevation, moonElev = S.moon.elevation;
  const ss = sunSky(sunElev, aer, cloud);
  const mEn = moonIlluminance(moonElev, S.moon.phaseAngle, aer) * (1 - 0.75 * cloud);
  const mEh = mEn * Math.max(0, S.moonDir.y);
  const lightsOn = lightsOnFor(ss.total);
  const haze = 1 - Math.exp(-atm.tau550 * 1.2);
  const cityLux = lightsOn * (0.9 + 1.5 * haze + 0.8 * cloud);
  const Eadapt = ss.total + mEh + cityLux;
  const exposure = exposureFor(Eadapt);
  const dust = atm.dustiness, smog = atm.smogginess;
  const chroma = skyChroma(sunElev, Math.max(dust, smog * 0.6), dust > smog ? [0.85, 0.66, 0.4] : [0.72, 0.66, 0.58]);
  const sun = { dir: S.sunDir, color: ss.sunRGB, intensity: ss.direct / LUX_UNIT };
  const moon = { dir: S.moonDir, color: MOON_TINT, intensity: mEn / LUX_UNIT * smooth2(-2, -8, sunElev) };
  const skyIrr = add(mul(chroma, ss.diffuse / LUX_UNIT), add(mul(MOON_TINT, mEh * 0.08 / LUX_UNIT), mul(CITY, cityLux * 0.35 / LUX_UNIT)));
  const groundIrr = add(GROUND_ALBEDO.map((a, i) => a * (ss.sunRGB[i] * ss.directH * LOOK_TUNING.urbanSunlitGround + chroma[i] * ss.diffuse + MOON_TINT[i] * mEh) / LUX_UNIT), mul(CITY, cityLux * 0.9 / LUX_UNIT));
  const visW = weather.visibility_m && isFinite(weather.visibility_m) ? weather.visibility_m : Infinity;
  const beta = Math.max(atm.beta, 3.912 / visW, rain * 3.912 / 8e3);
  const hazeAlb = ((c) => {
    const m = Math.max(...c);
    return c.map((v) => v / m * 0.92);
  })(hexToLinearArr(atm.hazeColor));
  const sunUp = smooth2(-1.5, 2, sunElev);
  const Eb = ss.directH + 0.25 * ss.direct * (1 - Math.max(0, S.sunDir.y));
  let fogRad = add(
    add(
      mul(hazeAlb.map((v, i) => v * chroma[i]), ss.diffuse * 0.95 / LUX_UNIT / PI),
      mul(hazeAlb.map((v, i) => v * ss.sunRGB[i]), Eb * 0.9 / LUX_UNIT / PI)
    ),
    add(mul(CITY, cityLux * (0.25 + 0.6 * haze + 0.5 * cloud) / LUX_UNIT / PI), mul(MOON_TINT, mEh * 0.05 / LUX_UNIT / PI))
  );
  {
    const sd = S.sunDir, tb = clamp(2 + 9 * (1 - Math.exp(-(atm.tau550 - 0.05) * 2.2)), 2, 11), mc = 4e-3 + 0.02 * haze, acc = [0, 0, 0];
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, d = { x: Math.cos(a) * 0.99966, y: 0.026, z: Math.sin(a) * 0.99966 };
      const r = preethamRadiance(d, sd, tb, 1, mc, 0.8 - 0.1 * dust);
      for (let i = 0; i < 3; i++) acc[i] += r[i] / 8;
    }
    let ph = acc.map((v) => v * LOOK_TUNING.preethamGain * (1 - 0.6 * cloud));
    const Yp = 0.2126 * ph[0] + 0.7152 * ph[1] + 0.0722 * ph[2], Yf = 0.2126 * fogRad[0] + 0.7152 * fogRad[1] + 0.0722 * fogRad[2];
    if (Yp > 1.3 * Yf && Yp > 0) ph = ph.map((v) => v * 1.3 * Yf / Yp);
    const w = 0.85 * smooth2(-2, 8, sunElev) * (1 - Math.min(1, (dust + smog) * 0.9)) * (1 - 0.7 * cloud);
    for (let i = 0; i < 3; i++) fogRad[i] = fogRad[i] * (1 - w) + ph[i] * w;
  }
  const g = 0.05 + 0.8 * (1 - Math.exp(-atm.tau550 * 1.5));
  const sunGlow = mul(ss.sunRGB.map((v, i) => v * (0.7 + 0.3 * hazeAlb[i])), ss.direct / LUX_UNIT / PI * g * 0.5 * sunUp * (1 - 0.8 * cloud));
  const twiE = globalIlluminanceClear(Math.min(sunElev, 4)) / LUX_UNIT / PI;
  const sky = {
    preethamGain: LOOK_TUNING.preethamGain * (1 - 0.6 * cloud),
    turbidity: clamp(2 + 9 * (1 - Math.exp(-(atm.tau550 - 0.05) * 2.2)), 2, 11),
    mieCoefficient: 4e-3 + 0.02 * haze,
    mieG: 0.8 - 0.1 * dust,
    sunDisc: clamp(Math.exp(-(atm.tau550 - CLEAN_AEROSOL.tau550) * 2), 0.02, 1) * (1 - 0.95 * cloud),
    twi: twiE * (1 - smooth2(-1, 5, sunElev)) * LOOK_TUNING.twilightSky,
    twiSun: 0,
    nightBase: mul([0.35, 0.42, 0.65], 7e-4 / LUX_UNIT / PI),
    cityGlow: mul(CITY, cityLux * LOOK_TUNING.cityGlowSky * (1 + 3 * haze + 1.5 * cloud) / LUX_UNIT / PI),
    moonDir: S.moonDir,
    moonRad: S.moon.elevation > -1 ? 2500 / LUX_UNIT * (1 - 0.7 * cloud) * clamp(Math.exp(-(atm.tau550 - 0.1)), 0.05, 1) : 0,
    moonScatter: mul([0.42, 0.56, 1], mEh * LOOK_TUNING.moonSky / LUX_UNIT / PI * (1 + 2 * cloud)),
    halo: 0.35 + 1.6 * cloud + 1.2 * haze,
    hazeColor: fogRad,
    hazeHorizon: 1 - Math.exp(-beta * 22e3),
    hazeZenith: clamp(1 - Math.exp(-Math.max(0, atm.tau550 - 0.12) * 1.3) + 0.15 * dust, 0, 0.97) + 0.5 * rain,
    // clean: 0 · smog ≈ 0.3 · sharav ≈ 0.8 (sky turns one dusty colour)
    hazeSpread: 0.03 + 0.35 * (1 - Math.exp(-beta * 1500)),
    sunGlow,
    cloudCover: cloud,
    cloudDay: add(mul(ss.sunRGB, ss.direct / LUX_UNIT / PI * 0.22), mul(chroma, ss.diffuse / LUX_UNIT / PI * 0.6)),
    cloudNight: add(mul(CITY, cityLux * LOOK_TUNING.cloudCity / LUX_UNIT / PI), mul([0.8, 0.85, 1], mEn * 2 * Math.max(0, S.moonDir.y + 0.2) / LUX_UNIT / PI))
    // city-lit bases + moonlit tops (field 006/008: clouds 3–5× the sky gaps)
  };
  sky.twiSun = smooth2(-10, -1, sunElev) * (1 - smooth2(1, 6, sunElev));
  const limitMag = 4.3 - 1.3 * mEh / 0.25 - 4 * haze - 3 * cloud - 6 * smooth2(-16, -6, sunElev);
  const stars = { limitMag, gain: limitMag > 0 ? 0.18 / exposure : 0 };
  const localHour = ((ms / 36e5 + tzOffsetMinutes(ms, site.tz || "Asia/Jerusalem") / 60) % 24 + 24) % 24;
  const night = {
    lightsOn,
    occupancy: windowOccupancy(localHour),
    windowGain: LOOK_TUNING.windowRadiance,
    warm: W_WARM,
    cool: W_COOL,
    tv: W_TV,
    lampSprite: LOOK_TUNING.lampSprite * lightsOn,
    lampLux: LOOK_TUNING.lampLux,
    cityUp: mul(CITY, cityLux * 0.22 / LUX_UNIT),
    dayGlass: smooth2(-4, 6, sunElev),
    skyRefl: mul(chroma, ss.diffuse / LUX_UNIT / PI * 0.8)
  };
  const st = sunTimes(...localYMD(ms, site), site.lat, site.lon, site.tz || "Asia/Jerusalem");
  return {
    ms,
    localHour,
    sky,
    sun,
    moon,
    hemi: { sky: skyIrr, ground: groundIrr },
    fog: { beta, color: fogRad, visibility_m: 3.912 / beta },
    exposure,
    Eadapt,
    stars,
    night,
    atm,
    aq,
    chip: aqiChip(aq, Object.assign({}, atm, { visibility_m: Math.min(atm.visibility_m, 3.912 / beta) })),
    phase_he: phaseHe(sunElev),
    moonPhase_he: moonPhaseNameHe(S.moon),
    sunPos: S.sun,
    moonPos: S.moon,
    starMatrix: S.starMatrix,
    sunTimes: st.local,
    cloud,
    rain,
    haze
  };
}
function hexToLinearArr(srgb) {
  return srgb.map((v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
}
function localYMD(ms, site) {
  const t = new Date(ms + tzOffsetMinutes(ms, site.tz || "Asia/Jerusalem") * 6e4);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

// src/sky.js
function createSky(THREE) {
  const U = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    turbidity: { value: 2.5 },
    rayleigh: { value: 1 },
    mieCoefficient: { value: 5e-3 },
    mieG: { value: 0.8 },
    preethamGain: { value: 1 },
    sunDisc: { value: 1 },
    twi: { value: 0 },
    twiSun: { value: 0 },
    nightBase: { value: new THREE.Color(0, 0, 0) },
    cityGlow: { value: new THREE.Color(0, 0, 0) },
    moonDir: { value: new THREE.Vector3(0, -1, 0) },
    moonRad: { value: 0 },
    moonScatter: { value: new THREE.Color(0, 0, 0) },
    halo: { value: 0.3 },
    hazeColor: { value: new THREE.Color(0.5, 0.5, 0.5) },
    hazeHorizon: { value: 0.5 },
    hazeZenith: { value: 0 },
    hazeSpread: { value: 0.06 },
    sunGlow: { value: new THREE.Color(0, 0, 0) },
    cloudCover: { value: 0 },
    cloudTime: { value: 0 },
    cloudDay: { value: new THREE.Color(0, 0, 0) },
    cloudNight: { value: new THREE.Color(0, 0, 0) },
    grade: { value: new THREE.Vector3(1, 1, 1) }
  };
  const vs = (
    /* glsl */
    `
    uniform vec3 sunDir; uniform float rayleigh, turbidity, mieCoefficient;
    varying vec3 vDir; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
    const float e = 2.718281828459045; const float pi = 3.141592653589793;
    const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
    const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
    const float cutoffAngle = 1.6110731556870734; const float steepness = 1.5; const float EE = 1000.0;
    void main() {
      vDir = (modelMatrix * vec4(position, 0.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w;
      float zc = clamp(sunDir.y, -1.0, 1.0);
      vSunE = EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zc)) / steepness)));
      vBetaR = totalRayleigh * rayleigh;   // three.js example uses a unit sunPosition \u2192 its 'sunfade' term is \u2261 1
      vBetaM = 0.434 * (0.2 * turbidity) * 10E-18 * MieConst * mieCoefficient;
    }`
  );
  const fs = (
    /* glsl */
    `
    varying vec3 vDir; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
    uniform vec3 sunDir; uniform float mieG, preethamGain, sunDisc, twi, twiSun, moonRad, halo, hazeHorizon, hazeZenith, hazeSpread, cloudCover, cloudTime;
    uniform vec3 nightBase, cityGlow, moonDir, moonScatter, hazeColor, sunGlow, cloudDay, cloudNight, grade;
    const float pi = 3.141592653589793;
    vec2 grad2(vec2 i) { vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0; }
    float gnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float a = dot(grad2(i), f), b = dot(grad2(i + vec2(1, 0)), f - vec2(1, 0)), c = dot(grad2(i + vec2(0, 1)), f - vec2(0, 1)), d = dot(grad2(i + vec2(1, 1)), f - vec2(1, 1));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6; }
    float fbm(vec2 p, float drift) { float r = 0.0, a = 1.0; for (int i = 0; i < 4; i++) { r += a * gnoise(p); a *= 0.5; p = p * 2.0 + drift; } return r; }
    float hg(float c, float g) { float g2 = g * g; return 0.07957747 * (1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5); }
    void main() {
      vec3 dir = normalize(vDir);
      float y = dir.y, yp = max(y, 0.0);
      // ---- Preetham day sky (three.js Sky, MIT) ----
      float zen = acos(yp);
      float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - zen * 180.0 / pi, -1.253));
      vec3 Fex = exp(-(vBetaR * 8.4E3 * inv + vBetaM * 1.25E3 * inv));
      float cosT = dot(dir, sunDir);
      float rPh = 0.05968310365946075 * (1.0 + pow(cosT * 0.5 + 0.5, 2.0));
      vec3 bRT = vBetaR * rPh, bMT = vBetaM * hg(cosT, mieG);
      vec3 Lin = pow(vSunE * ((bRT + bMT) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
      Lin *= mix(vec3(1.0), pow(vSunE * ((bRT + bMT) / (vBetaR + vBetaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
      vec3 col = (Lin + vec3(0.1) * Fex * smoothstep(-0.08, 0.05, sunDir.y)) * 0.04 * preethamGain;   // L0 'night sky' term of the original only by day (we model the night ourselves)
      // ---- twilight dome ----
      vec2 sh = normalize(sunDir.xz + 1e-5), dh = normalize(dir.xz + 1e-5);
      float sunward = max(dot(sh, dh), 0.0), anti = max(-dot(sh, dh), 0.0);
      float hz = exp(-yp / 0.10);
      vec3 zenC = vec3(0.16, 0.26, 0.75), horC = vec3(0.55, 0.52, 0.62);
      vec3 tw = mix(horC, zenC, pow(yp, 0.45)) + vec3(1.0, 0.45, 0.16) * 2.2 * pow(sunward, 3.0) * hz * twiSun
              + vec3(0.62, 0.42, 0.55) * 0.6 * anti * exp(-abs(yp - 0.07) / 0.05) * twiSun;
      col += tw * twi;
      // ---- night: airglow + light pollution (land = east = +x is brighter than the sea) ----
      float land = mix(0.35, 1.0, smoothstep(-0.4, 0.5, dir.x));
      col += nightBase * (0.6 + 0.4 * hz) + cityGlow * land * (exp(-yp / 0.16) * 0.85 + 0.15);
      // ---- moon: Rayleigh-ish brightening + aureole ----
      float cm = dot(dir, moonDir);
      col += moonScatter * (0.35 + 0.65 * hz) + moonScatter * halo * (18.0 * pow(max(cm, 0.0), 300.0) + 3.0 * pow(max(cm, 0.0), 30.0));
      // ---- clouds (three.js Sky clouds, relit for day/twilight/night) ----
      if (y > 0.0 && cloudCover > 0.0) {
        vec2 cuv = dir.xz / (y * 0.55) * 0.0002 + cloudTime * 0.00002;
        float n = clamp(fbm(cuv * 6500.0, cloudTime * 0.006) * 0.7 + 0.5, 0.0, 1.0);
        float region = gnoise(cuv * 1400.0) * 0.37 + 0.5;
        float cov = clamp(cloudCover + (region - 0.5) * 0.6, 0.0, 1.0), th = 1.0 - cov;
        float mask = smoothstep(th, th + 0.3, n) * smoothstep(0.0, 0.06, y);
        float depth = max(0.0, n - th), beer = exp(-4.0 * depth);
        float shade = mix(0.45, 1.0, clamp(beer * (1.0 - beer * beer) * 2.6, 0.0, 1.0));
        float silver = clamp(0.51 / pow(1.49 - cosT * 1.4, 1.5), 0.0, 3.0) * mask * (1.0 - mask) * 4.0;
        float msilver = clamp(0.51 / pow(1.49 - cm * 1.4, 1.5), 0.0, 3.0) * mask * (1.0 - mask) * 4.0;
        vec3 cc = cloudDay * (shade + silver * 0.6) + cloudNight * (0.55 + 0.45 * hz) * (1.2 - 0.5 * shade)
                + moonScatter * 8.0 * (shade + msilver * 1.5);
        float a = (1.0 - exp(-depth * 0.6 * 12.0)) * smoothstep(0.0, 0.06, y) * mask;
        col = mix(col, mix(col, cc, exp(-0.6 / max(y, 0.05) * 0.08)), a);
      }
      // ---- sun disc (Preetham) & moon disc (phase from the real sun direction) ----
      float sd = clamp((cosT - 0.99995667694644844) * 50000.0, 0.0, 1.0);
      col += 760.0 * sd * min(vSunE * Fex, vec3(80.0)) * 0.04 * preethamGain * sunDisc;
      float r = 0.00456;                                     // tan(0.26\xB0)
      vec3 o = dir - moonDir * cm; float q = length(o) / r;
      if (cm > 0.0 && q < 1.0) {
        vec3 nrm = o / r - moonDir * sqrt(1.0 - q * q);
        float lit = smoothstep(-0.03, 0.06, dot(nrm, sunDir));
        float mare = 0.82 + 0.18 * gnoise(o.xz / r * 2.3 + 7.0);
        col += moonRad * lit * mare * vec3(1.0, 0.97, 0.92) * smoothstep(1.0, 0.92, q) + moonRad * 0.004;  // earthshine
      }
      // ---- aerosol veil + horizon band (matches the fog colour used on the ground) ----
      vec3 hz2 = hazeColor + sunGlow * (pow(max(cosT, 0.0), 8.0) * 1.5 + pow(max(cosT, 0.0), 48.0) * 4.0);
      float band = y < 0.0 ? 1.0 : mix(hazeHorizon, 1.0, exp(-y / 0.012)) * exp(-y / hazeSpread);   // = fog colour at the horizon line, so distant ground and sky meet without a seam
      col = mix(col, hz2, clamp(max(band, hazeZenith), 0.0, 1.0));
      gl_FragColor = vec4(col * grade, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
  );
  const mat = new THREE.ShaderMaterial({ name: "ESH27Sky", uniforms: U, vertexShader: vs, fragmentShader: fs, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.name = "esh27-sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.onBeforeRender = (r, s, cam) => {
    mesh.position.copy(cam.position);
    mesh.scale.setScalar(cam.far * 0.9);
    mesh.updateMatrixWorld();
  };
  return { mesh, uniforms: U, material: mat };
}
function createStars(THREE, stars) {
  const n = stars.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n);
  stars.forEach((s, i) => {
    pos.set(s.v, i * 3);
    col.set(s.rgb, i * 3);
    mag[i] = s.mag;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("mag", new THREE.BufferAttribute(mag, 1));
  const U = { limitMag: { value: 4 }, gain: { value: 0 }, px: { value: 1 }, rot: { value: new THREE.Matrix3() }, radius: { value: 1e3 }, cloudCover: { value: 0 } };
  const m = new THREE.ShaderMaterial({
    name: "ESH27Stars",
    uniforms: U,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: (
      /* glsl */
      `
      attribute float mag; attribute vec3 color; uniform float limitMag, gain, px, radius; uniform mat3 rot;
      varying vec3 vC; varying float vA;
      void main() {
        vec3 d = rot * position;
        vec4 mv = modelViewMatrix * vec4(cameraPosition + d * radius, 1.0);
        gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.99999;
        float rel = pow(10.0, -0.4 * (mag - limitMag + 0.5));          // brightness relative to the limit
        float ext = smoothstep(-0.02, 0.12, d.y);                       // extinction near the horizon
        vA = clamp(rel, 0.0, 6.0) * gain * ext * step(mag, limitMag + 0.3);
        vC = color;
        gl_PointSize = px * (1.6 + 1.2 * clamp(-mag + 1.5, 0.0, 3.0) * 0.5);
      }`
    ),
    fragmentShader: (
      /* glsl */
      `
      varying vec3 vC; varying float vA;
      void main() { vec2 p = gl_PointCoord - 0.5; float r = dot(p, p) * 4.0; float a = exp(-r * 3.5) * vA;
        if (a < 0.002) discard; gl_FragColor = vec4(vC * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
    )
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.name = "esh27-stars";
  pts.renderOrder = -9;
  pts.onBeforeRender = (r, s, cam) => {
    U.radius.value = cam.far * 0.85;
  };
  return { points: pts, uniforms: U };
}

// src/nightlights.js
function createShared(THREE) {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uFogBeta: { value: 5e-5 },
    uFogCol: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uSunGlow: { value: new THREE.Color(0, 0, 0) },
    uHour: { value: 12 },
    uOcc: { value: 0.1 },
    uWinGain: { value: 0 },
    uDayGlass: { value: 1 },
    uSkyRefl: { value: new THREE.Color(0, 0, 0) },
    uGrade: { value: new THREE.Vector3(1, 1, 1) },
    uLampMap: { value: null },
    uLampOn: { value: 0 },
    uLampScale: { value: 1 / 3e4 },
    uLampBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uCityUp: { value: new THREE.Color(0, 0, 0) },
    uTime: { value: 0 },
    uWarm: { value: new THREE.Color() },
    uCool: { value: new THREE.Color() },
    uTv: { value: new THREE.Color() },
    uWater: { value: 1 }
  };
}
var VERT_HEAD = (
  /* glsl */
  `
attribute vec2 afl; attribute float aseed; attribute float akind;
varying vec3 vWP; varying vec3 vWN; varying vec2 vAfl; varying float vSeed; varying float vKind;`
);
var VERT_BODY = (
  /* glsl */
  `
{ vec4 wp4 = modelMatrix * vec4(transformed, 1.0); vWP = wp4.xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
  vAfl = afl; vSeed = aseed; vKind = akind;
#if ATMO_KIND >= 0
  vKind = float(ATMO_KIND);                                   // host geometry without the akind attribute
#endif
#if ATMO_FLOOR_DM > 0
  if (afl.y < 1.0) vAfl = vec2(0.0, float(ATMO_FLOOR_DM));    // host buildings without afl: default storey height
#endif
  if (aseed == 0.0) { vec2 c = floor(wp4.xz / 23.0); vSeed = floor(fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453) * 997.0); }   // no seed attr \u2192 per-block seed
}`
);
var FRAG_HEAD = (
  /* glsl */
  `
varying vec3 vWP; varying vec3 vWN; varying vec2 vAfl; varying float vSeed; varying float vKind;
uniform vec3 uSunDir, uFogCol, uSunGlow, uSkyRefl, uGrade, uCityUp, uWarm, uCool, uTv; uniform float uFogBeta, uHour, uOcc, uWinGain, uDayGlass, uLampOn, uLampScale, uTime, uWater;
uniform sampler2D uLampMap; uniform vec4 uLampBox;
float h13(vec3 p) { p = fract(p * vec3(0.1031, 0.11369, 0.13787)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
vec3 lampAt(vec3 wp) { vec2 uv = (wp.xz - uLampBox.xy) / uLampBox.zw; if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(0.0);
  return texture2D(uLampMap, uv).rgb * uLampScale * uLampOn; }
float gWin = 0.0;`
);
var FRAG_COLOR = (
  /* glsl */
  `
float isWall = 1.0 - step(0.35, abs(vWN.y));
float fbase = vAfl.x * 0.1, fh = vAfl.y * 0.1;
vec3 winEm = vec3(0.0); float glass = 0.0;
if (vKind < 0.5 && isWall > 0.5 && fh > 2.2) {
  float fy = (vWP.y - fbase) / fh;
  vec2 tng = normalize(vec2(-vWN.z, vWN.x) + 1e-5);
  float u = dot(vWP.xz, tng) / 3.3;
  vec2 cell = floor(vec2(u, fy)), f = fract(vec2(u, fy));
  float px = max(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(fy), dFdy(fy))));
  float aa = 1.0 - smoothstep(0.18, 0.55, px);                       // window pattern \u2192 average when cells are sub-pixel
  float w = smoothstep(0.18, 0.2, f.x) * smoothstep(0.82, 0.8, f.x) * smoothstep(0.26, 0.28, f.y) * smoothstep(0.80, 0.78, f.y) * step(0.0, fy);
  float fill = 0.27;                                                  // window/facade area ratio (assumption)
  float sd = floor(vSeed + 0.5); cell = mod(cell, 997.0);
  float life = 0.55 + 0.9 * h13(vec3(sd, 3.1, 7.7));             // per-building "lifestyle"
  float hc = h13(vec3(cell, sd));
  float lit = step(hc, uOcc * life);
  float k = h13(vec3(cell.yx + 17.0, sd));
  vec3 wc = k < 0.62 ? uWarm : k < 0.9 ? uCool : uTv * (0.8 + 0.2 * sin(uTime * 7.0 + hc * 40.0));
  float shade = 0.55 + 0.45 * h13(vec3(cell + 5.0, sd));        // curtains / dimmers
  winEm = mix(uOcc * life * fill * mix(uWarm, uCool, 0.3) * 0.75, wc * lit * w * shade, aa) * uWinGain;
  glass = mix(fill, w, aa);
  diffuseColor.rgb *= 1.0 - 0.62 * glass;                              // glass/openings are dark (day: + sky reflection below)
}
gWin = glass;`
);
var FRAG_EMIT = (
  /* glsl */
  `
{ float isW = 1.0 - step(0.35, abs(vWN.y));
  totalEmissiveRadiance += winEm;
  totalEmissiveRadiance += uSkyRefl * gWin * 0.35 * uDayGlass;
  // street-light pools (ground) and their fall-off up the facades; city up-light on walls at night
  vec3 L = lampAt(vWP);
  float above = max(0.0, vWP.y - (vKind < 0.5 ? vAfl.x * 0.1 : 0.0));
  float wallF = isW * (exp(-above / 9.0) * 0.55 + exp(-above / 45.0) * 0.12);
  float groundF = (1.0 - isW) * step(0.5, vKind) * (vKind > 1.5 ? 0.25 : 1.0) + (1.0 - isW) * (1.0 - step(0.5, vKind)) * 0.15;
  totalEmissiveRadiance += diffuseColor.rgb * L * (groundF + wallF) * 0.3183;
  totalEmissiveRadiance += diffuseColor.rgb * uCityUp * isW * exp(-above / 14.0) * 0.3183; }`
);
var FRAG_WATER = (
  /* glsl */
  `
if (vKind > 1.5) {   // water: fresnel sky reflection + sun glitter (look only; maritime team owns the sea)
  vec3 V = normalize(cameraPosition - vWP); float wd = length(cameraPosition - vWP);
  float amp = 1.0 - smoothstep(250.0, 1400.0, wd);                    // ripples fade out before they alias (moir\xE9)
  vec2 q = vWP.xz * 0.06 + vec2(uTime * 0.35, uTime * 0.21);
  vec3 N = normalize(vec3((sin(q.x) * 0.06 + sin(q.y * 1.7 + q.x) * 0.04) * amp, 1.0, (cos(q.y * 1.3) * 0.06 + sin(q.x * 2.1 - q.y) * 0.03) * amp));
  float fr = (0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0)) * 0.85;
  vec3 H = normalize(V + uSunDir); float sp = pow(max(dot(N, H), 0.0), mix(60.0, 220.0, amp)) * mix(8.0, 60.0, amp) + pow(max(dot(N, H), 0.0), 18.0) * 0.6;   // far: broad glitter path
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol * 0.92, fr * uWater) + uSunGlow * sp * step(0.0, uSunDir.y) * uWater * 2.0;
}`
);
var FRAG_FOG = (
  /* glsl */
  `
{ vec3 vd = vWP - cameraPosition; float dist = length(vd); vec3 vdir = vd / max(dist, 1e-3);
  float fogF = 1.0 - exp(-uFogBeta * dist);
  float cs = max(dot(vdir, uSunDir), 0.0);
  vec3 fc = uFogCol + uSunGlow * (pow(cs, 8.0) * 1.5 + pow(cs, 48.0) * 4.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogF) * uGrade; }`
);
function patchMaterial(material, S, opts = {}) {
  const prev = material.onBeforeCompile;
  const kind = opts.kind == null ? -1 : opts.kind | 0, floorDm = opts.floorHeight ? Math.round(opts.floorHeight * 10) : 0;
  material.fog = false;
  material.onBeforeCompile = (sh, r) => {
    prev && prev(sh, r);
    Object.assign(sh.uniforms, S);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
#define ATMO_KIND ${kind}
#define ATMO_FLOOR_DM ${floorDm}
` + VERT_HEAD).replace("#include <project_vertex>", "#include <project_vertex>\n" + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + FRAG_HEAD).replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_COLOR).replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + FRAG_EMIT).replace("#include <tonemapping_fragment>", FRAG_WATER + "\n" + FRAG_FOG + "\n#include <tonemapping_fragment>").replace("#include <fog_fragment>", "");
  };
  material.customProgramCacheKey = () => "esh27-atmo-v2:" + kind + ":" + floorDm;
  material.needsUpdate = true;
  return material;
}
function bakeLampMap(THREE, renderer, lamps, box, size = 2048) {
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  const n = lamps.length / 6, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (lamps[i * 6] - box.x0) / box.w * 2 - 1;
    pos[i * 3 + 1] = (lamps[i * 6 + 1] - box.z0) / box.d * 2 - 1;
    pos[i * 3 + 2] = 0;
    col[i * 3] = lamps[i * 6 + 2] * lamps[i * 6 + 5];
    col[i * 3 + 1] = lamps[i * 6 + 3] * lamps[i * 6 + 5];
    col[i * 3 + 2] = lamps[i * 6 + 4] * lamps[i * 6 + 5];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const metersPerPx = box.w / size, R = 30;
  const m = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    uniforms: { ps: { value: Math.max(3, 2 * R / metersPerPx) }, hR: { value: 8 / R } },
    vertexShader: "attribute vec3 color; varying vec3 vC; uniform float ps; void main(){ vC = color; gl_Position = vec4(position.xy, 0.0, 1.0); gl_PointSize = ps; }",
    fragmentShader: "varying vec3 vC; uniform float hR; void main(){ vec2 p = (gl_PointCoord - 0.5) * 2.0; float d = length(p); if (d > 1.0) discard; float x = d / hR; float k = pow(1.0 + x * x, -1.5) * smoothstep(1.0, 0.7, d); gl_FragColor = vec4(vC * k, 1.0); }"
  });
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  sc.add(new THREE.Points(g, m));
  const prevRT = renderer.getRenderTarget(), prevCol = new THREE.Color();
  renderer.getClearColor(prevCol);
  const pa = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0, 1);
  renderer.clear();
  renderer.render(sc, cam);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevCol, pa);
  g.dispose();
  m.dispose();
  rt.texture.flipY = false;
  return { rt, texture: rt.texture, box: new THREE.Vector4(box.x0, box.z0, box.w, box.d) };
}
var SPRITE_VS = (
  /* glsl */
  `
attribute vec3 color; attribute float size; attribute float phase;
uniform float px, on, time, rays; varying vec3 vC; varying float vR;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1.0);
  float blink = phase < 0.0 ? 1.0 : step(0.5, fract(time * 0.5 + phase));   // aviation lights: 1 s on / 1 s off
  float s = size * px * 420.0 / d * (1.0 + rays * 2.0);
  gl_PointSize = clamp(s, 1.5 * px, (20.0 + 28.0 * rays) * px);
  vC = color * on * blink * clamp(s / (1.5 * px), 0.2, 1.0) * clamp(60.0 / d, 0.25, 1.0);   // near lamps: big but not brighter (avoid bloom blobs)   // sub-pixel lamps keep their energy, fade only a little
  vR = rays;
}`
);
var SPRITE_FS = (
  /* glsl */
  `
varying vec3 vC; varying float vR;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0; float d = length(p);
  float core = exp(-d * d * 60.0) * 2.5 + exp(-d * d * 12.0) * 0.5, glow = exp(-d * 4.0) * 0.12;
  float ang = atan(p.y, p.x);
  float star = vR * pow(abs(cos(ang * 4.0 + 0.3)), 220.0) * exp(-d * 1.3) * 1.6 + vR * pow(abs(cos(ang * 3.0 + 0.9)), 300.0) * exp(-d * 1.8) * 0.7;   // 8 + 6 diffraction spikes (phone lens)
  float a = (core + glow + star) * smoothstep(1.0, 0.75, d); if (a < 0.003) discard;
  gl_FragColor = vec4(vC * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
);
function createSprites(THREE, name) {
  const U = { px: { value: 1 }, on: { value: 0 }, time: { value: 0 }, rays: { value: 0 } };
  const m = new THREE.ShaderMaterial({ name, uniforms: U, vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const g = new THREE.BufferGeometry();
  const pts = new THREE.Points(g, m);
  pts.name = name;
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  function set(positions, colors, sizes, phases) {
    const n = positions.length / 3;
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("size", new THREE.BufferAttribute(sizes || new Float32Array(n).fill(1), 1));
    g.setAttribute("phase", new THREE.BufferAttribute(phases || new Float32Array(n).fill(-1), 1));
    g.setDrawRange(0, n);
    g.computeBoundingSphere();
  }
  return { points: pts, uniforms: U, set, geometry: g };
}

// src/post.js
var FS_QUAD_VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
var ACES = (
  /* glsl */
  `
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {   // three.js ACESFilmicToneMapping (exposure applied by caller, /0.6 included)
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = I * (c / 0.6); c = RRTAndODTFit(c); return clamp(O * c, 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// AgX and Khronos PBR Neutral \u2014 copied from three.js r186 tonemapping_pars_fragment (MIT), exposure applied by the caller
const mat3 LIN_REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 LIN_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
vec3 agxContrast(vec3 x) { vec3 x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 color) {
  const mat3 Inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 Outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  color = Inset * (LIN_SRGB_TO_REC2020 * color); color = clamp((log2(max(color, 1e-10)) + 12.47393) / (4.026069 + 12.47393), 0.0, 1.0);
  color = Outset * agxContrast(color); color = pow(max(vec3(0.0), color), vec3(2.2)); return clamp(LIN_REC2020_TO_SRGB * color, 0.0, 1.0); }
vec3 neutralTM(vec3 color) {
  const float StartCompression = 0.8 - 0.04; const float Desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b)); float offset = x < 0.08 ? x - 6.25 * x * x : 0.04; color -= offset;
  float peak = max(color.r, max(color.g, color.b)); if (peak < StartCompression) return color;
  float d = 1. - StartCompression; float newPeak = 1. - d * d / (peak + d - StartCompression); color *= newPeak / peak;
  float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.); return mix(color, vec3(newPeak), g); }`
);
var AtmoPost = class {
  constructor(THREE, renderer, { lut } = {}) {
    this.T = THREE;
    this.r = renderer;
    this.tier = "low";
    this.profile = "physical";
    this.w = 1;
    this.h = 1;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qs = new THREE.Scene();
    this.qs.add(this.quad);
    this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    if (lut) {
      const t = new THREE.Data3DTexture(lut.data, lut.size, lut.size, lut.size);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      this.lut = t;
    }
    this.U = {
      tColor: { value: null },
      tDepth: { value: null },
      tBloom: { value: null },
      tPrev: { value: null },
      tLut: { value: this.lut || null },
      exposure: { value: 1 },
      lutAmt: { value: this.lut ? 1 : 0 },
      bloomAmt: { value: 0 },
      aoAmt: { value: 0 },
      near: { value: 1 },
      far: { value: 1e3 },
      res: { value: new THREE.Vector2(1, 1) },
      wb: { value: new THREE.Vector3(1, 1, 1) },
      tm: { value: 0 },
      grain: { value: 0 },
      lift: { value: new THREE.Vector3(0, 0, 0) },
      feedback: { value: 0 },
      time: { value: 0 },
      vign: { value: 0.18 },
      sat: { value: 1 }
    };
    this.comp = new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: FS_QUAD_VS,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fragmentShader: (
        /* glsl */
        `
        precision highp sampler3D;
        uniform sampler2D tColor, tDepth, tBloom, tPrev; uniform sampler3D tLut;
        uniform float exposure, lutAmt, bloomAmt, aoAmt, near, far, grain, feedback, time, vign, sat, tm; uniform vec2 res; uniform vec3 lift, wb; varying vec2 vUv;
        ${ACES}
        float lin(float z) { return near * far / (far - z * (far - near)); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 0.1) * 43758.5453); }
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          if (aoAmt > 0.0) {   // SSAO-lite: compare linear depth with 8 ring neighbours (range-limited, view-distance scaled)
            float d0 = lin(texture2D(tDepth, vUv).r); float occ = 0.0;
            float rad = clamp(900.0 / d0, 2.0, 18.0);
            for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398 + 0.39; vec2 o = vec2(cos(a), sin(a)) * rad / res * (i < 4 ? 1.0 : 0.5);
              float dn = lin(texture2D(tDepth, vUv + o).r); float dd = (d0 - dn) / d0;
              occ += smoothstep(0.004, 0.03, dd) * (1.0 - smoothstep(0.08, 0.2, dd)); }
            c *= 1.0 - aoAmt * occ / 8.0 * step(d0, far * 0.5);
          }
          c *= exposure * wb;
          if (bloomAmt > 0.0) c += texture2D(tBloom, vUv).rgb * bloomAmt;
          c = tm > 1.5 ? clamp(neutralTM(c), 0.0, 1.0) : tm > 0.5 ? agx(c) : aces(c);
          float L = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(L), c, sat);
          c = c + lift * (1.0 - smoothstep(0.0, 0.25, L));
          vec3 s = toSRGB(clamp(c, 0.0, 1.0));
          if (lutAmt > 0.0) { vec3 g = texture(tLut, s * (31.0 / 32.0) + 0.5 / 32.0).rgb; s = mix(s, g, lutAmt); }
          vec2 q = vUv - 0.5; s *= 1.0 - vign * dot(q, q) * 2.2;
          if (grain > 0.0) { float n = hash(vUv * res + fract(time) * 91.7) - 0.5; float n2 = hash(vUv * res * 0.5 + 3.1 + fract(time * 1.3) * 17.0) - 0.5;
            float Ls = dot(s, vec3(0.299, 0.587, 0.114)); s += (n * 0.8 + n2 * 0.6) * grain * (1.0 - 0.8 * Ls) + vec3(n2, 0.0, -n2) * grain * 0.25 * (1.0 - Ls); }
          if (feedback > 0.0) s = mix(s, texture2D(tPrev, vUv).rgb, feedback);
          gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
        }`
      )
    });
    const mk = (fs) => new THREE.ShaderMaterial({ uniforms: { t: { value: null }, texel: { value: new THREE.Vector2() }, thr: { value: 1 }, exposure: { value: 1 } }, vertexShader: FS_QUAD_VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false });
    this.bright = mk("uniform sampler2D t; uniform vec2 texel; uniform float thr, exposure; varying vec2 vUv; void main(){ vec3 c = vec3(0.0); for(int i=0;i<4;i++){ vec2 o = vec2(i==0||i==2?-1.0:1.0, i<2?-1.0:1.0)*texel; c += texture2D(t, vUv+o).rgb; } c *= 0.25 * exposure; float l = max(c.r, max(c.g, c.b)); float k = clamp((l - thr) / max(l, 1e-4), 0.0, 1.0); gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0); }");
    this.down = mk("uniform sampler2D t; uniform vec2 texel; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * 4.0; c += texture2D(t, vUv + texel * vec2(-1,-1)).rgb + texture2D(t, vUv + texel * vec2(1,-1)).rgb + texture2D(t, vUv + texel * vec2(-1,1)).rgb + texture2D(t, vUv + texel * vec2(1,1)).rgb; gl_FragColor = vec4(c / 8.0, 1.0); }");
    this.up = mk("uniform sampler2D t; uniform vec2 texel; varying vec2 vUv; void main(){ vec3 c = vec3(0.0); c += texture2D(t, vUv + texel * vec2(-2,0)).rgb + texture2D(t, vUv + texel * vec2(2,0)).rgb + texture2D(t, vUv + texel * vec2(0,-2)).rgb + texture2D(t, vUv + texel * vec2(0,2)).rgb; c += (texture2D(t, vUv + texel * vec2(-1,-1)).rgb + texture2D(t, vUv + texel * vec2(1,-1)).rgb + texture2D(t, vUv + texel * vec2(-1,1)).rgb + texture2D(t, vUv + texel * vec2(1,1)).rgb) * 2.0; gl_FragColor = vec4(c / 12.0, 1.0); }");
    this.up.blending = THREE.AdditiveBlending;
    this.up.transparent = true;
    this.copy = mk("uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }");
    this.levels = [];
    this.phoneWB = [1, 1, 1];
    this.toneMapper = null;
    this.paint = { radius: 4, alpha: 1, q: 8, zeroCross: 0.58, amount: 0.85, vibration: 1, canvas: 1 };
    const mk2 = (fs, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: FS_QUAD_VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false });
    this.tensor = mk2(`uniform sampler2D t; uniform vec2 texel; varying vec2 vUv;
      vec3 S(float x, float y) { return texture2D(t, vUv + vec2(x, y) * texel).rgb; }
      void main() { vec3 fx = (-S(-1.,-1.) - 2.0 * S(-1.,0.) - S(-1.,1.) + S(1.,-1.) + 2.0 * S(1.,0.) + S(1.,1.)) * 0.25;
        vec3 fy = (-S(-1.,-1.) - 2.0 * S(0.,-1.) - S(1.,-1.) + S(-1.,1.) + 2.0 * S(0.,1.) + S(1.,1.)) * 0.25;
        gl_FragColor = vec4(dot(fx, fx), dot(fx, fy), dot(fy, fy), 1.0); }`, { t: { value: null }, texel: { value: new THREE.Vector2() } });
    this.tblur = mk2(`uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;
      void main() { vec4 a = texture2D(t, vUv) * 1.0; float w[4]; w[0] = 0.8825; w[1] = 0.6065; w[2] = 0.3247; w[3] = 0.1353;
        for (int i = 0; i < 4; i++) { float o = float(i + 1); a += (texture2D(t, vUv + dir * o) + texture2D(t, vUv - dir * o)) * w[i]; }
        gl_FragColor = a / 4.898; }`, { t: { value: null }, dir: { value: new THREE.Vector2() } });
    this.kuwa = mk2(
      `uniform sampler2D tColor, tTensor; uniform vec2 srcTexel; uniform float radius, alpha, q, zeta, eta; varying vec2 vUv;
      void main() {
        vec3 T3 = texture2D(tTensor, vUv).xyz; float E = T3.x, F = T3.y, G = T3.z, D = sqrt(max(0.0, (E - G) * (E - G) + 4.0 * F * F));
        float l1 = 0.5 * (E + G + D), l2 = 0.5 * (E + G - D);
        vec2 tv = vec2(l1 - E, -F); vec2 dv = length(tv) > 1e-7 ? normalize(tv) : vec2(0.0, 1.0);
        float phi = -atan(dv.y, dv.x), A = (l1 + l2 > 1e-7) ? (l1 - l2) / (l1 + l2) : 0.0;
        float a = radius * clamp((alpha + A) / alpha, 0.1, 2.0), b = radius * clamp(alpha / (alpha + A), 0.1, 2.0);
        float cp = cos(phi), sp = sin(phi); mat2 SR = mat2(0.5 / a, 0.0, 0.0, 0.5 / b) * mat2(cp, -sp, sp, cp);
        float mx = sqrt(a * a * cp * cp + b * b * sp * sp), my = sqrt(a * a * sp * sp + b * b * cp * cp);
        vec4 m[8]; vec3 s[8]; for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
        for (int j = -8; j <= 8; j++) { if (abs(float(j)) > my) continue;
          for (int i = -8; i <= 8; i++) { if (abs(float(i)) > mx) continue;
            vec2 v = SR * vec2(float(i), float(j)); if (dot(v, v) > 0.25) continue;
            vec3 c = texture2D(tColor, vUv + vec2(float(i), float(j)) * srcTexel * 2.0).rgb;
            float w[8], z, vxx, vyy, sum = 0.0;
            vxx = zeta - eta * v.x * v.x; vyy = zeta - eta * v.y * v.y;
            z = max(0.0, v.y + vxx); w[0] = z * z; z = max(0.0, -v.x + vyy); w[2] = z * z; z = max(0.0, -v.y + vxx); w[4] = z * z; z = max(0.0, v.x + vyy); w[6] = z * z;
            vec2 u = 0.70710678 * vec2(v.x - v.y, v.x + v.y); vxx = zeta - eta * u.x * u.x; vyy = zeta - eta * u.y * u.y;
            z = max(0.0, u.y + vxx); w[1] = z * z; z = max(0.0, -u.x + vyy); w[3] = z * z; z = max(0.0, -u.y + vxx); w[5] = z * z; z = max(0.0, u.x + vyy); w[7] = z * z;
            for (int k = 0; k < 8; k++) sum += w[k];
            float g = exp(-3.125 * dot(v, v)) / max(sum, 1e-6);
            for (int k = 0; k < 8; k++) { float wk = w[k] * g; m[k] += vec4(c * wk, wk); s[k] += c * c * wk; } } }
        vec4 o = vec4(0.0);
        for (int k = 0; k < 8; k++) { if (m[k].w <= 1e-6) continue; vec3 mu = m[k].rgb / m[k].w; vec3 var = abs(s[k] / m[k].w - mu * mu);
          float wgt = 1.0 / (1.0 + pow(1000.0 * (var.r + var.g + var.b), 0.5 * q)); o += vec4(mu * wgt, wgt); }
        gl_FragColor = vec4(o.w > 0.0 ? o.rgb / o.w : texture2D(tColor, vUv).rgb, 1.0); }`,
      { tColor: { value: null }, tTensor: { value: null }, srcTexel: { value: new THREE.Vector2() }, radius: { value: 4 }, alpha: { value: 1 }, q: { value: 8 }, zeta: { value: 0.25 }, eta: { value: 3.6 } }
    );
    this.paintOut = mk2(
      `uniform sampler2D tPaint, tSharp; uniform vec2 res; uniform float amt, vib, canvas; varying vec2 vUv;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main() { vec3 p = texture2D(tPaint, vUv).rgb, o = texture2D(tSharp, vUv).rgb; vec2 px = vUv * res;
        vec2 cell = floor(px / 3.0); float h = h21(cell), h2 = h21(cell + 17.0);
        float L = dot(p, vec3(0.299, 0.587, 0.114)); vec3 ch = p - L, k = vec3(0.57735); float an = (h - 0.5) * 0.14 * vib;
        ch = ch * cos(an) + cross(k, ch) * sin(an) + k * dot(k, ch) * (1.0 - cos(an)); p = L + ch; p *= 1.0 + (h2 - 0.5) * 0.04 * vib;
        p += canvas * (sin(px.x * 1.3) * sin(px.y * 1.3) * 0.012 + (h21(floor(px)) - 0.5) * 0.012);
        gl_FragColor = vec4(clamp(mix(o, p, amt), 0.0, 1.0), 1.0); }`,
      { tPaint: { value: null }, tSharp: { value: null }, res: { value: new THREE.Vector2(1, 1) }, amt: { value: 0.85 }, vib: { value: 1 }, canvas: { value: 1 } }
    );
  }
  _alloc() {
    const T = this.T;
    this._free();
    if (this.tier === "low") return;
    const pr = this.r.getPixelRatio(), W = Math.max(1, Math.floor(this.w * pr)), H = Math.max(1, Math.floor(this.h * pr));
    const dt = this.tier === "high" ? new T.DepthTexture(W, H) : null;
    this.hdr = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, samples: 4, depthTexture: dt, depthBuffer: true });
    this.U.res.value.set(W, H);
    const wantBloom = this.tier === "high" || this.profile === "phone" || this.profile === "impression";
    if (wantBloom) {
      let w = W >> 1, h = H >> 1;
      for (let i = 0; i < 5; i++) {
        this.levels.push(new T.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: T.HalfFloatType, depthBuffer: false }));
        w >>= 1;
        h >>= 1;
      }
    }
    if (this.profile === "phone" || this.profile === "impression") {
      this.ldrA = new T.WebGLRenderTarget(W, H, { depthBuffer: false });
      this.ldrB = new T.WebGLRenderTarget(W, H, { depthBuffer: false });
    }
    if (this.profile === "impression") {
      const w2 = Math.max(1, W >> 1), h2 = Math.max(1, H >> 1);
      this.tenA = new T.WebGLRenderTarget(w2, h2, { type: T.HalfFloatType, depthBuffer: false });
      this.tenB = new T.WebGLRenderTarget(w2, h2, { type: T.HalfFloatType, depthBuffer: false });
      this.paintRT = new T.WebGLRenderTarget(w2, h2, { depthBuffer: false });
    }
  }
  _free() {
    for (const k of ["hdr", "ldrA", "ldrB", "tenA", "tenB", "paintRT"]) {
      if (this[k]) {
        this[k].depthTexture && this[k].depthTexture.dispose();
        this[k].dispose();
        this[k] = null;
      }
    }
    this.levels.forEach((l) => l.dispose());
    this.levels = [];
  }
  setSize(w, h) {
    this.w = w;
    this.h = h;
    this._alloc();
  }
  setTier(t) {
    this.tier = t;
    this._alloc();
  }
  setProfile(p) {
    this.profile = p;
    this._alloc();
  }
  _pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qs, this.qc);
  }
  render(scene, camera, exposure, time = 0) {
    const r = this.r, T = this.T;
    const tmName = this.toneMapper || (this.profile === "impression" ? "agx" : "aces");
    if (this.tier === "low" || !this.hdr) {
      r.toneMapping = tmName === "agx" ? T.AgXToneMapping : tmName === "neutral" ? T.NeutralToneMapping : T.ACESFilmicToneMapping;
      r.toneMappingExposure = exposure;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.toneMapping = T.NoToneMapping;
    r.setRenderTarget(this.hdr);
    r.render(scene, camera);
    const U = this.U, phone = this.profile === "phone", imp = this.profile === "impression";
    U.tm.value = tmName === "agx" ? 1 : tmName === "neutral" ? 2 : 0;
    U.tColor.value = this.hdr.texture;
    U.exposure.value = exposure;
    U.time.value = time;
    U.tDepth.value = this.hdr.depthTexture || null;
    U.aoAmt.value = this.tier === "high" && this.hdr.depthTexture ? 0.55 : 0;
    U.near.value = camera.near;
    U.far.value = camera.far;
    if (this.levels.length) {
      const L = this.levels;
      this.bright.uniforms.t.value = this.hdr.texture;
      this.bright.uniforms.texel.value.set(1 / this.hdr.width, 1 / this.hdr.height);
      this.bright.uniforms.thr.value = phone ? 1 : 1.2;
      this.bright.uniforms.exposure.value = exposure;
      this._pass(this.bright, L[0]);
      for (let i = 1; i < L.length; i++) {
        this.down.uniforms.t.value = L[i - 1].texture;
        this.down.uniforms.texel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height);
        this._pass(this.down, L[i]);
      }
      for (let i = L.length - 1; i > 0; i--) {
        this.up.uniforms.t.value = L[i].texture;
        this.up.uniforms.texel.value.set(0.5 / L[i].width, 0.5 / L[i].height);
        this.r.autoClear = false;
        this._pass(this.up, L[i - 1]);
        this.r.autoClear = true;
      }
      U.tBloom.value = L[0].texture;
      U.bloomAmt.value = phone ? 0.38 : imp ? 0.28 : 0.2;
    } else U.bloomAmt.value = 0;
    U.lutAmt.value = this.lut ? phone ? 0.5 : 1 : 0;
    U.grain.value = phone ? 0.06 : 0;
    U.wb.value.set(...phone ? this.phoneWB : [1, 1, 1]);
    U.sat.value = phone ? 0.9 : imp ? 1.1 : 1;
    U.vign.value = phone ? 0.35 : imp ? 0.2 : 0.16;
    U.lift.value.set(phone ? 25e-4 : 0, phone ? 4e-3 : 0, phone ? 0.01 : 0);
    if (phone) {
      U.tPrev.value = this.ldrB.texture;
      U.feedback.value = 0.28;
      this._pass(this.comp, this.ldrA);
      this.copy.uniforms.t.value = this.ldrA.texture;
      this._pass(this.copy, null);
      const t = this.ldrA;
      this.ldrA = this.ldrB;
      this.ldrB = t;
    } else if (imp) {
      U.feedback.value = 0;
      this._pass(this.comp, this.ldrA);
      const P = this.paint, z = 1 / Math.max(1, P.radius), sz = Math.sin(P.zeroCross);
      this.tensor.uniforms.t.value = this.ldrA.texture;
      this.tensor.uniforms.texel.value.set(1 / this.ldrA.width, 1 / this.ldrA.height);
      this._pass(this.tensor, this.tenA);
      this.tblur.uniforms.t.value = this.tenA.texture;
      this.tblur.uniforms.dir.value.set(1 / this.tenA.width, 0);
      this._pass(this.tblur, this.tenB);
      this.tblur.uniforms.t.value = this.tenB.texture;
      this.tblur.uniforms.dir.value.set(0, 1 / this.tenA.height);
      this._pass(this.tblur, this.tenA);
      const K = this.kuwa.uniforms;
      K.tColor.value = this.ldrA.texture;
      K.tTensor.value = this.tenA.texture;
      K.srcTexel.value.set(1 / this.ldrA.width, 1 / this.ldrA.height);
      K.radius.value = P.radius;
      K.alpha.value = P.alpha;
      K.q.value = P.q;
      K.zeta.value = z;
      K.eta.value = (z + Math.cos(P.zeroCross)) / (sz * sz);
      this._pass(this.kuwa, this.paintRT);
      const O = this.paintOut.uniforms;
      O.tPaint.value = this.paintRT.texture;
      O.tSharp.value = this.ldrA.texture;
      O.res.value.set(this.ldrA.width, this.ldrA.height);
      O.amt.value = P.amount;
      O.vib.value = P.vibration;
      O.canvas.value = P.canvas;
      this._pass(this.paintOut, null);
    } else {
      U.feedback.value = 0;
      this._pass(this.comp, null);
    }
  }
  dispose() {
    this._free();
    this.comp.dispose();
    [this.bright, this.down, this.up, this.copy, this.tensor, this.tblur, this.kuwa, this.paintOut].forEach((m) => m.dispose());
    this.lut && this.lut.dispose();
  }
};

// src/rig.js
var TIERS = {
  low: { post: "low", shadows: 0, lampMap: 1024, dprMax: 1.25, stars: 400 },
  mid: { post: "mid", shadows: 1024, lampMap: 2048, dprMax: 1.5, stars: 900 },
  high: { post: "high", shadows: 2048, lampMap: 2048, dprMax: 2, stars: 1400 }
};
function createAtmosphere({ THREE, renderer, scene, camera, site = ASHDOD, tier = "mid", profile = "physical", removeLights = true, shadowTarget = null, preExpose = true } = {}) {
  const T = THREE;
  if (removeLights) scene.traverse((o) => {
    if (o.isLight && !o.userData.esh27atmo) o.visible = false;
  });
  renderer.outputColorSpace = T.SRGBColorSpace;
  const group = new T.Group();
  group.name = "esh27-atmosphere";
  scene.add(group);
  const sky = createSky(T);
  group.add(sky.mesh);
  const stars = createStars(T, starField(TIERS.high.stars));
  group.add(stars.points);
  const sunL = new T.DirectionalLight(16777215, 1);
  sunL.userData.esh27atmo = true;
  sunL.name = "esh27-sun";
  const moonL = new T.DirectionalLight(10335448, 0);
  moonL.userData.esh27atmo = true;
  moonL.name = "esh27-moon";
  const hemi = new T.HemisphereLight(16777215, 16777215, 1);
  hemi.userData.esh27atmo = true;
  group.add(sunL, sunL.target, moonL, moonL.target, hemi);
  const S = createShared(T);
  const lampSprites = createSprites(T, "esh27-lamps"), carSprites = createSprites(T, "esh27-vehicles"), beaconSprites = createSprites(T, "esh27-beacons");
  group.add(lampSprites.points, carSprites.points, beaconSprites.points);
  const post = new AtmoPost(T, renderer, { lut: { data: buildLUT(32), size: 32 } });
  const st = { ms: Date.now(), aq: Object.assign({ source: "preset" }, AQ_PRESETS.clean), weather: {}, tier, profile, t: 0, exposure: null, look: null, lampMap: null, lamps: null, focus: new T.Vector3() };
  const v3 = (o, a) => o.set(a[0], a[1], a[2]);
  const hostFog = scene.fog || null;
  const fogObj = hostFog || new T.FogExp2(16777215, 1e-4);
  const saved = {
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    background: scene.background,
    fog: scene.fog,
    shadow: renderer.shadowMap.enabled,
    autoClear: renderer.autoClear
  };
  function applyTier() {
    const c = TIERS[st.tier] || TIERS.mid;
    post.setTier(c.post);
    renderer.shadowMap.enabled = c.shadows > 0;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    sunL.castShadow = c.shadows > 0;
    if (c.shadows) {
      sunL.shadow.mapSize.set(c.shadows, c.shadows);
      if (sunL.shadow.map) {
        sunL.shadow.map.dispose();
        sunL.shadow.map = null;
      }
    }
    S.uGrade.value.set(...c.post === "low" ? [1.02, 1, 0.975] : [1, 1, 1]);
    st.dirty = true;
  }
  function recompute() {
    st.look = computeLook({ ms: st.ms, site, aq: st.aq, weather: st.weather });
    st.dirty = false;
    return st.look;
  }
  function apply(dt) {
    const L = st.dirty || !st.look ? recompute() : st.look;
    const target = L.exposure;
    if (st.exposure == null || dt <= 0 || Math.abs(Math.log(target / st.exposure)) > 2.5) st.exposure = target;
    else {
      const tau = target < st.exposure ? 0.5 : 2.5;
      st.exposure = Math.exp(Math.log(st.exposure) + (Math.log(target) - Math.log(st.exposure)) * (1 - Math.exp(-dt / tau)));
    }
    const gain = st.profile === "phone" ? 1 + 1 * Math.min(1, Math.max(0, (Math.log10(st.exposure) - 1) / 2)) : 1;
    const X = preExpose ? st.exposure * gain : 1;
    st.renderExposure = preExpose ? 1 : st.exposure * gain;
    const sx = (a) => a.map((v) => v * X);
    const f = st.focus;
    sunL.position.set(f.x + L.sun.dir.x * 3e3, f.y + L.sun.dir.y * 3e3, f.z + L.sun.dir.z * 3e3);
    sunL.target.position.copy(f);
    v3(sunL.color, L.sun.color);
    sunL.intensity = L.sun.intensity * X;
    sunL.visible = L.sun.intensity > 1e-6;
    moonL.position.set(f.x + L.moon.dir.x * 3e3, f.y + L.moon.dir.y * 3e3, f.z + L.moon.dir.z * 3e3);
    moonL.target.position.copy(f);
    v3(moonL.color, L.moon.color);
    moonL.intensity = L.moon.intensity * X;
    moonL.visible = L.moon.intensity > 1e-9 && L.moon.dir.y > 0;
    if (sunL.castShadow) {
      const sc = sunL.shadow.camera, R = st.shadowRadius || 900;
      sc.left = -R;
      sc.right = R;
      sc.top = R;
      sc.bottom = -R;
      sc.near = 100;
      sc.far = 6e3;
      sc.updateProjectionMatrix();
      sunL.shadow.bias = -4e-4;
      sunL.shadow.normalBias = 0.6;
      sunL.shadow.intensity = 0.85 + 0.15 * (1 - L.cloud);
    }
    v3(hemi.color, L.hemi.sky);
    v3(hemi.groundColor, L.hemi.ground);
    hemi.intensity = X;
    const U = sky.uniforms, K = L.sky;
    v3(U.sunDir.value, [L.sun.dir.x, L.sun.dir.y, L.sun.dir.z]);
    for (const k of ["turbidity", "mieCoefficient", "mieG", "sunDisc", "twiSun", "halo", "hazeHorizon", "hazeZenith", "hazeSpread", "cloudCover"]) U[k].value = K[k];
    for (const k of ["preethamGain", "twi", "moonRad"]) U[k].value = K[k] * X;
    for (const k of ["nightBase", "cityGlow", "moonScatter", "hazeColor", "sunGlow", "cloudDay", "cloudNight"]) U[k].value.setRGB(K[k][0] * X, K[k][1] * X, K[k][2] * X);
    U.moonDir.value.set(K.moonDir.x, K.moonDir.y, K.moonDir.z);
    U.cloudTime.value = st.t * 6;
    const m = L.starMatrix;
    stars.uniforms.rot.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    stars.uniforms.limitMag.value = L.stars.limitMag;
    stars.uniforms.gain.value = L.stars.gain * X;
    stars.uniforms.px.value = renderer.getPixelRatio();
    stars.points.visible = L.stars.limitMag > -0.5;
    S.uSunDir.value.set(L.sun.dir.x, L.sun.dir.y, L.sun.dir.z);
    S.uFogBeta.value = L.fog.beta;
    S.uFogCol.value.setRGB(...sx(L.fog.color));
    S.uSunGlow.value.setRGB(...sx(K.sunGlow));
    S.uHour.value = L.localHour;
    S.uOcc.value = L.night.occupancy;
    S.uWinGain.value = L.night.windowGain * X;
    S.uDayGlass.value = L.night.dayGlass;
    S.uSkyRefl.value.setRGB(...sx(L.night.skyRefl));
    S.uLampScale.value = X / 3e4;
    S.uLampOn.value = L.night.lightsOn * L.night.lampLux / 22;
    S.uCityUp.value.setRGB(...sx(L.night.cityUp));
    S.uTime.value = st.t;
    S.uWarm.value.setRGB(...L.night.warm);
    S.uCool.value.setRGB(...L.night.cool);
    S.uTv.value.setRGB(...L.night.tv);
    fogObj.color.setRGB(...sx(L.fog.color));
    if (fogObj.isFogExp2) fogObj.density = L.fog.beta;
    if (scene.fog !== fogObj) scene.fog = fogObj;
    if (scene.background && scene.background.isColor) scene.background.setRGB(...sx(L.fog.color));
    {
      const n = L.night.lightsOn, c = [1, 0.78, 0.52].map((v) => 1 / (1 - 0.35 * n * (1 - v))), m2 = c[1];
      post.phoneWB = c.map((v) => v / m2);
    }
    const px = renderer.getPixelRatio(), rays = st.profile === "phone" ? 1 : 0;
    for (const sp of [lampSprites, carSprites, beaconSprites]) {
      sp.uniforms.px.value = px;
      sp.uniforms.time.value = st.t;
      sp.uniforms.rays.value = rays;
    }
    lampSprites.uniforms.on.value = L.night.lampSprite * X;
    carSprites.uniforms.on.value = (6e-4 + 22e-4 * L.night.lightsOn) * X;
    beaconSprites.uniforms.on.value = 4e-3 * (0.15 + 0.85 * L.night.lightsOn) * X;
  }
  const nightLights = {
    /** lamps: [{x, y, z, type?: 'sodium'|'led', street?: name, color?: [r,g,b] linear, lux?}] (world coordinates). Bakes the pool light-map too. */
    setLamps(lamps, { box } = {}) {
      const n = lamps.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), splat = new Float32Array(n * 6);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      lamps.forEach((l, i) => {
        const type = l.type || lampTypeForStreet(l.street || ""), c = l.color || hexToLinear(LAMP_TYPES[type].color), mx = Math.max(...c);
        pos.set([l.x, (l.y || 0) + LAMP_TYPES[type].height, l.z], i * 3);
        col.set(c.map((v) => v / mx), i * 3);
        size[i] = type === "led" ? 0.9 : 1.1;
        splat.set([l.x, l.z, c[0] / mx, c[1] / mx, c[2] / mx, l.lux || (type === "led" ? 24 : 18)], i * 6);
        x0 = Math.min(x0, l.x);
        z0 = Math.min(z0, l.z);
        x1 = Math.max(x1, l.x);
        z1 = Math.max(z1, l.z);
      });
      lampSprites.set(pos, col, size);
      const b = box || { x0: x0 - 60, z0: z0 - 60, w: Math.max(x1 - x0, z1 - z0) + 120, d: Math.max(x1 - x0, z1 - z0) + 120 };
      if (st.lampMap) st.lampMap.rt.dispose();
      st.lampMap = n ? bakeLampMap(T, renderer, splat, b, (TIERS[st.tier] || TIERS.mid).lampMap) : null;
      S.uLampMap.value = st.lampMap ? st.lampMap.texture : null;
      if (st.lampMap) S.uLampBox.value.copy(st.lampMap.box);
      st.lamps = { count: n, box: b };
      return st.lamps;
    },
    /** vehicles: Float32Array [x, y, z, yawRad] per vehicle (yaw 0 = facing −z/north, CCW). Head (white) + tail (red) pairs. */
    setVehicles(f32) {
      const n = f32.length / 4, pos = new Float32Array(n * 6), col = new Float32Array(n * 6), size = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const x = f32[i * 4], y = f32[i * 4 + 1] + 0.7, z = f32[i * 4 + 2], a = f32[i * 4 + 3], dx = -Math.sin(a) * 2.2, dz = -Math.cos(a) * 2.2;
        pos.set([x + dx, y, z + dz, x - dx, y, z - dz], i * 6);
        col.set([1, 0.95, 0.85, 1, 0.04, 0.02], i * 6);
        size[i * 2] = 0.5;
        size[i * 2 + 1] = 0.35;
      }
      carSprites.set(pos, col, size);
    },
    /** beacons: [{x, y, z, color?: [r,g,b], blink?: true}] — aviation obstruction lights on towers/cranes (red, 1 Hz blink). */
    setBeacons(list) {
      const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n);
      list.forEach((b, i) => {
        pos.set([b.x, b.y, b.z], i * 3);
        col.set(b.color || [1, 0.05, 0.03], i * 3);
        size[i] = b.size || 0.8;
        ph[i] = b.blink === false ? -1 : i * 0.37 % 1;
      });
      beaconSprites.set(pos, col, size, ph);
    },
    get lampCount() {
      return st.lamps ? st.lamps.count : 0;
    }
  };
  const api = {
    THREE: T,
    group,
    sky,
    stars,
    sun: sunL,
    moon: moonL,
    hemi,
    shared: S,
    post,
    nightLights,
    setTime(d) {
      st.ms = typeof d === "number" ? d : d.getTime();
      st.dirty = true;
      return api;
    },
    setLocalTime(y, m, d, hh = 12, mm = 0) {
      return api.setTime(localToUtc(y, m, d, hh, mm, 0, site.tz || "Asia/Jerusalem"));
    },
    setAirQuality(aq) {
      st.aq = typeof aq === "string" ? Object.assign({ source: "preset", preset: aq }, AQ_PRESETS[aq] || AQ_PRESETS.clean) : Object.assign({}, aq);
      st.dirty = true;
      return api;
    },
    setWeather(w = {}) {
      st.weather = Object.assign({}, w);
      st.dirty = true;
      return api;
    },
    setQualityTier(t) {
      st.tier = TIERS[t] ? t : "mid";
      applyTier();
      return api;
    },
    /** 'physical' (clean) · 'phone' (Ariel's night photos: starburst, bloom, grain) · 'impression' (painterly: AgX + anisotropic Kuwahara + broken colour). */
    setCameraProfile(p) {
      st.profile = p === "phone" || p === "impression" ? p : "physical";
      post.setProfile(st.profile);
      return api;
    },
    /** null = per profile · 'aces' | 'agx' | 'neutral' (Khronos PBR Neutral — e.g. developer presentation with true facade colours). */
    setToneMapper(name) {
      post.toneMapper = ["aces", "agx", "neutral"].includes(name) ? name : null;
      return api;
    },
    /** painterly parameters (impression profile): {radius, alpha, q, zeroCross, amount, vibration, canvas} */
    setPaint(o = {}) {
      Object.assign(post.paint, o);
      return api;
    },
    /** Centre of interest (shadow frustum follows it). radius = half-size of the shadow box (m). */
    setFocus(v, radius) {
      st.focus.copy(v);
      if (radius) st.shadowRadius = radius;
      return api;
    },
    /** opts: {kind: 0 building|1 ground/road|2 water, floorHeight: m} — for host geometry without afl/aseed/akind attributes. */
    patchMaterial(m, opts) {
      return patchMaterial(m, S, opts);
    },
    setSize(w, h) {
      post.setSize(w, h);
    },
    update(dt = 0) {
      st.t += dt;
      apply(dt);
      return st.look;
    },
    render() {
      renderer.autoClear = true;
      post.render(scene, camera, st.renderExposure ?? 1, st.t);
    },
    get state() {
      return st.look;
    },
    get exposure() {
      return st.exposure;
    },
    get tier() {
      return st.tier;
    },
    get profile() {
      return st.profile;
    },
    dispose() {
      post.dispose();
      scene.remove(group);
      st.lampMap && st.lampMap.rt.dispose();
      sky.material.dispose();
      renderer.toneMapping = saved.toneMapping;
      renderer.toneMappingExposure = saved.exposure;
      renderer.shadowMap.enabled = saved.shadow;
      renderer.autoClear = saved.autoClear;
      scene.background = saved.background;
      scene.fog = saved.fog;
      renderer.setRenderTarget(null);
    }
  };
  const sz = renderer.getSize(new T.Vector2());
  post.setSize(sz.x, sz.y);
  applyTier();
  if (profile !== "physical") api.setCameraProfile(profile);
  return api;
}

// src/index.js
var VERSION = "0.1.0";
export {
  AQ_PRESETS,
  ASHDOD,
  ATTRIBUTION_AQ,
  AtmoPost,
  BRIGHT_STARS,
  CLEAN_AEROSOL,
  EAQI_COLOR,
  EAQI_HE,
  EXPOSURE,
  E_SOLAR_LUX,
  FIELD_NIGHT,
  LAMBDA_UM,
  LAMP_OBSERVED,
  LAMP_TYPES,
  LOOK_TUNING,
  LUX_UNIT,
  OPEN_METEO_AQ_URL,
  PALETTE,
  TIERS,
  VERSION,
  adaptationLux,
  airMass,
  aqToAtmosphere,
  aqiChip,
  bakeLampMap,
  buildCube,
  buildLUT,
  buildingAlbedo,
  bvToRgb,
  cityAmbientLux,
  clamp,
  computeLook,
  createAtmosphere,
  createShared,
  createSky,
  createSprites,
  createStars,
  dustExtinction,
  eaqiLevel,
  equatorialToHorizontal,
  equatorialToTwinMatrix,
  estimateDust,
  exposureFor,
  fRH,
  getAirQuality,
  globalIlluminanceClear,
  gmstDeg,
  grade,
  hash01,
  hashString,
  hexToLinear,
  hexToRgb,
  israelIndexCategory,
  itmConvergence,
  julianDay,
  kelvinToRgb,
  lampTypeForStreet,
  lightsOnFor,
  linearToSrgb,
  localToUtc,
  moonIlluminance,
  moonPhaseNameHe,
  moonPosition,
  normalizeOpenMeteoAQ,
  normalizeSviva,
  openMeteoAQUrl,
  opticalDepth,
  patchMaterial,
  phaseHe,
  preethamRadiance,
  pregradeAlbedo,
  rayleighTau,
  rgbToHex,
  sampleAQ,
  skyChroma,
  skyState,
  solarCoordinates,
  srgbToLinear,
  starField,
  streetLightsOn,
  sunPosition,
  sunSky,
  sunTimes,
  sunTransmittance,
  sunVector,
  tzOffsetMinutes,
  windowOccupancy
};
