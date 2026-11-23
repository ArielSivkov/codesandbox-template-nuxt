/* ESH27 aviation — sun.js : the real sun for the far field, via the physics team's validated NOAA module
 * (/home/claude/swarm/physics/src/sun.js, tested vs USNO/NREL SPA). If that folder is not deployed next to this one,
 * copy physics/src/sun.js to ./vendor-physics-sun.js and change the import below — no other change needed. */
import { sunPosition, sunVector, solarCoordinates } from '../../physics/src/sun.js';
import { subsolarPoint } from './geo.js';
/** Sun direction in the local twin frame (unit vector, x east, y up, z south) seen from the frame origin.
 *  The sun is ~1.5e11 m away, so the same vector is valid for the whole globe (terminator from normal·sun). */
export function sunLocal(date, frame, { refraction = false } = {}) {
  const ms = typeof date === 'number' ? date : date.getTime();
  const sp = sunPosition(ms, frame.lat0, frame.lon0, { refraction });
  const v = sunVector(sp.elevation, sp.azimuth, frame.gamma);
  const sc = solarCoordinates(ms), ss = subsolarPoint(ms, sc.declination, sc.eqTime);
  return { dir: v, elevation: sp.elevation, azimuth: sp.azimuth, subsolar: ss };
}
