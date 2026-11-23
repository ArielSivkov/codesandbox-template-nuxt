/* ESH27 aviation — atmo.js : International Standard Atmosphere (ISO 2533:1975 = US Standard Atmosphere 1976 to 86 km).
 * Layers by geopotential altitude H = r0·h/(r0+h), r0 = 6356766 m. Above 86 km: log-linear interpolation of the
 * 1976 density table (T held at 186.87 K – approx.; real thermosphere is hot and varies with solar activity).
 * Constants: g0 = 9.80665, R = 287.05287 J/(kg·K), γ = 1.4, T0 = 288.15 K, p0 = 101325 Pa, ρ0 = 1.225 kg/m³. */
export const G0 = 9.80665, R_AIR = 287.05287, GAMMA = 1.4, T0 = 288.15, P0 = 101325, RHO0 = 1.225;
const R0 = 6356766;
// base geopotential altitude (m), lapse rate (K/m), base temperature (K), base pressure (Pa)
const L = [[0, -0.0065, 288.15, 101325], [11000, 0, 216.65, 22632.06], [20000, 0.001, 216.65, 5474.889], [32000, 0.0028, 228.65, 868.0187],
  [47000, 0, 270.65, 110.9063], [51000, -0.0028, 270.65, 66.93887], [71000, -0.002, 214.65, 3.956420], [84852, 0, 186.946, 0.3734]];
// US76 density above 86 km (geometric altitude m, kg/m³)
const UP = [[86000, 6.958e-6], [100000, 5.604e-7], [120000, 2.222e-8], [150000, 2.076e-9], [200000, 2.541e-10], [300000, 1.916e-11], [400000, 2.803e-12], [500000, 5.215e-13], [700000, 3.07e-14], [1000000, 3.561e-15]];
/** @param h geometric altitude (m) @returns {T (K), p (Pa), rho (kg/m³), a (m/s), sigma = ρ/ρ0} */
export function isa(h, out = {}) {
  const hh = Math.max(-2000, h);
  if (hh > 86000) { // log-linear interpolation of the US Standard Atmosphere 1976 density table (approx. T)
    let i = 0; while (i < UP.length - 2 && hh > UP[i + 1][0]) i++;
    const [h0, r0] = UP[i], [h1, r1] = UP[i + 1], t = (hh - h0) / (h1 - h0);
    out.T = 186.87; out.rho = hh > 2e6 ? 0 : Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * t); out.p = out.rho * R_AIR * out.T; out.a = Math.sqrt(GAMMA * R_AIR * out.T); out.sigma = out.rho / RHO0; return out;
  }
  const H = R0 * hh / (R0 + hh);
  let i = L.length - 1; while (i > 0 && H < L[i][0]) i--;
  const [Hb, Lb, Tb, Pb] = L[i], dH = H - Hb, T = Tb + Lb * dH;
  const p = Lb === 0 ? Pb * Math.exp(-G0 * dH / (R_AIR * Tb)) : Pb * Math.pow(T / Tb, -G0 / (R_AIR * Lb));
  out.T = T; out.p = p; out.rho = p / (R_AIR * T); out.a = Math.sqrt(GAMMA * R_AIR * T); out.sigma = out.rho / RHO0; return out;
}
export const density = h => isa(h).rho;
