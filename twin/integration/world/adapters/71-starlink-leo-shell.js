/**
 * בס"ד
 * ESH27 Twin World — 71-starlink-leo-shell.js (v0.5.0-hr01)
 * First-Principles Starlink Phase 1 Shell 1 (1,584 sats, 72x22, 550 km, 53.0 deg)
 * Analytical J2 Secular Perturbations + Newton-Raphson Kepler Solver + WGS84 ECEF->ENU/ITM
 * + Ku-Band (11.7 GHz) Kinematic Doppler + Solar Umbra/Twilight + Single-Draw-Call InstancedMesh.
 *
 * Compatible with both Browser (window.TwinStarlinkLeoShell / THREE r128) and Node.js ESM/CJS tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TwinStarlinkLeoShell = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --- CODATA 2022 & WGS84 Exact Constants ---
  const CONSTANTS = Object.freeze({
    C_LIGHT_MPS: 299792458.0,
    MU_EARTH_M3_S2: 3.986004418e14,
    R_EARTH_EQ_M: 6378137.0,
    WGS84_INV_F: 298.257223563,
    WGS84_F: 1.0 / 298.257223563,
    WGS84_E2: (1.0 / 298.257223563) * (2.0 - 1.0 / 298.257223563),
    J2_EARTH: 1.08262668e-3,
    OMEGA_EARTH_RAD_S: 7.2921150e-5,
    KU_DOWNLINK_HZ: 11.7e9, // Center of 10.7-12.7 GHz Starlink user Ku downlink
    KU_UPLINK_HZ: 14.25e9,  // Center of 14.0-14.5 GHz user Ku uplink
    DEG2RAD: Math.PI / 180.0,
    RAD2DEG: 180.0 / Math.PI,
    TWO_PI: Math.PI * 2.0,
    J2000_UNIX_MS: Date.UTC(2000, 0, 1, 12, 0, 0, 0)
  });

  // --- Default Ashdod Twin Origin (HaErez 4, EPSG:2039 Verified) ---
  const ASHDOD_ORIGIN = Object.freeze({
    name: 'הארז 4, אשדוד (עוגן העולם התאום)',
    latDeg: 31.8044,
    lonDeg: 34.6553,
    altAslM: 13.17,
    itmEastM: 166263.8,
    itmNorthM: 634919.8,
    minElevationDeg: 25.0
  });

  // --- Default Starlink Phase 1, Shell 1 Walker-Delta 53.0°: 1584/72/1 ---
  const SHELL1_CONFIG = Object.freeze({
    shellName: 'Starlink Phase 1 Shell 1',
    planes: 72,
    satsPerPlane: 22,
    phasingF: 1,
    altitudeM: 550000.0,
    eccentricity: 0.00014,
    inclinationDeg: 53.0,
    argPerigee0Deg: 0.0
  });

  function wrapTwoPi(angle) {
    const r = angle % CONSTANTS.TWO_PI;
    return r < 0 ? r + CONSTANTS.TWO_PI : r;
  }

  /**
   * Greenwich Mean Sidereal Time (IAU expression in radians) from Unix timestamp (ms).
   */
  function computeGmstRad(unixMs) {
    const jd = unixMs / 86400000.0 + 2440587.5;
    const d = jd - 2451545.0;
    const t = d / 36525.0;
    const gmstDeg =
      280.46061837 +
      360.98564736629 * d +
      0.000387933 * t * t -
      (t * t * t) / 38710000.0;
    return wrapTwoPi(gmstDeg * CONSTANTS.DEG2RAD);
  }

  /**
   * Approximate inertial ECI unit vector toward the Sun for umbra/twilight illumination.
   */
  function computeSunVectorEci(unixMs) {
    const n = (unixMs - CONSTANTS.J2000_UNIX_MS) / 86400000.0;
    const L = wrapTwoPi((280.460 + 0.9856474 * n) * CONSTANTS.DEG2RAD);
    const g = wrapTwoPi((357.528 + 0.9856003 * n) * CONSTANTS.DEG2RAD);
    const lambda =
      L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2.0 * g)) * CONSTANTS.DEG2RAD;
    const eps = (23.439 - 0.0000004 * n) * CONSTANTS.DEG2RAD;
    const cosL = Math.cos(lambda);
    const sinL = Math.sin(lambda);
    return {
      x: cosL,
      y: Math.cos(eps) * sinL,
      z: Math.sin(eps) * sinL
    };
  }

  /**
   * WGS84 Geodetic (latDeg, lonDeg, altM) -> ECEF (meters) + local ENU basis vectors.
   */
  function geodeticToEcefAndBasis(latDeg, lonDeg, altM) {
    const lat = latDeg * CONSTANTS.DEG2RAD;
    const lon = lonDeg * CONSTANTS.DEG2RAD;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    const N =
      CONSTANTS.R_EARTH_EQ_M /
      Math.sqrt(1.0 - CONSTANTS.WGS84_E2 * sinLat * sinLat);

    const x = (N + altM) * cosLat * cosLon;
    const y = (N + altM) * cosLat * sinLon;
    const z = (N * (1.0 - CONSTANTS.WGS84_E2) + altM) * sinLat;

    return {
      x,
      y,
      z,
      east: { x: -sinLon, y: cosLon, z: 0.0 },
      north: { x: -sinLat * cosLon, y: -sinLat * sinLon, z: cosLat },
      up: { x: cosLat * cosLon, y: cosLat * sinLon, z: sinLat }
    };
  }

  /**
   * Solve Kepler's Equation M = E - e*sin(E) via Newton-Raphson to machine precision.
   */
  function solveKeplerRad(M, e) {
    const mWrap = wrapTwoPi(M);
    let E = mWrap + e * Math.sin(mWrap);
    for (let iter = 0; iter < 6; iter++) {
      const f = E - e * Math.sin(E) - mWrap;
      const fp = 1.0 - e * Math.cos(E);
      const delta = f / fp;
      E -= delta;
      if (Math.abs(delta) < 1e-13) break;
    }
    return E;
  }

  /**
   * Build deterministic Walker-Delta constellation state arrays + J2 secular rates.
   */
  function createConstellationEngine(options) {
    const cfg = Object.assign({}, SHELL1_CONFIG, options || {});
    const obsCfg = Object.assign({}, ASHDOD_ORIGIN, (options && options.observer) || {});
    const totalSats = cfg.planes * cfg.satsPerPlane;
    const a = CONSTANTS.R_EARTH_EQ_M + cfg.altitudeM;
    const e = cfg.eccentricity;
    const inc = cfg.inclinationDeg * CONSTANTS.DEG2RAD;
    const cosInc = Math.cos(inc);
    const sinInc = Math.sin(inc);
    const sin2Inc = sinInc * sinInc;

    const n0 = Math.sqrt(CONSTANTS.MU_EARTH_M3_S2 / (a * a * a));
    const p = a * (1.0 - e * e);
    const hAng = Math.sqrt(CONSTANTS.MU_EARTH_M3_S2 * p);
    const sqrtOneMinusE2 = Math.sqrt(1.0 - e * e);
    const kJ2 =
      1.5 *
      CONSTANTS.J2_EARTH *
      Math.pow(CONSTANTS.R_EARTH_EQ_M / p, 2) *
      n0;

    // First-order Brouwer/SGP4 secular drift rates (rad/s)
    const raanDot = -kJ2 * cosInc;
    const argPerigeeDot = 0.5 * kJ2 * (4.0 - 5.0 * sin2Inc);
    const meanAnomalyDot = n0 + 0.5 * kJ2 * sqrtOneMinusE2 * (2.0 - 3.0 * sin2Inc);

    // TypedArrays for zero-GC 60-FPS propagation
    const raan0 = new Float64Array(totalSats);
    const argp0 = new Float64Array(totalSats);
    const meanAnom0 = new Float64Array(totalSats);
    const planeIdx = new Uint16Array(totalSats);
    const slotIdx = new Uint16Array(totalSats);

    // Output state buffers
    const eciPos = new Float64Array(totalSats * 3);
    const ecefPos = new Float64Array(totalSats * 3);
    const enuPos = new Float64Array(totalSats * 3);
    const slantRangeM = new Float64Array(totalSats);
    const azimuthDeg = new Float32Array(totalSats);
    const elevationDeg = new Float32Array(totalSats);
    const rangeRateMps = new Float32Array(totalSats);
    const dopplerHz = new Float32Array(totalSats);
    const rttLatencyMs = new Float32Array(totalSats);
    // 0 = Earth Umbra (eclipsed), 1 = Sunlit orbital, 2 = Twilight optical flare over observer
    const illuminationFlag = new Uint8Array(totalSats);

    let idx = 0;
    for (let pIdx = 0; pIdx < cfg.planes; pIdx++) {
      const omega0 = (CONSTANTS.TWO_PI * pIdx) / cfg.planes;
      for (let sIdx = 0; sIdx < cfg.satsPerPlane; sIdx++) {
        raan0[idx] = omega0;
        argp0[idx] = cfg.argPerigee0Deg * CONSTANTS.DEG2RAD;
        meanAnom0[idx] = wrapTwoPi(
          (CONSTANTS.TWO_PI * sIdx) / cfg.satsPerPlane +
            (CONSTANTS.TWO_PI * cfg.phasingF * pIdx) / totalSats
        );
        planeIdx[idx] = pIdx;
        slotIdx[idx] = sIdx;
        idx++;
      }
    }

    let observer = geodeticToEcefAndBasis(
      obsCfg.latDeg,
      obsCfg.lonDeg,
      obsCfg.altAslM
    );
    const epochUnixMs = Date.UTC(2026, 10, 25, 4, 0, 0, 0); // 2026-11-25T06:00:00+02:00

    function setObserver(latDeg, lonDeg, altAslM) {
      obsCfg.latDeg = latDeg;
      obsCfg.lonDeg = lonDeg;
      obsCfg.altAslM = altAslM;
      observer = geodeticToEcefAndBasis(latDeg, lonDeg, altAslM);
    }

    /**
     * Propagate all 1,584 satellites at unixMs and select optimal serving beam over Ashdod.
     */
    function propagate(unixMs, customMinElDeg) {
      const dtSec = (unixMs - epochUnixMs) * 0.001;
      const gmst = computeGmstRad(unixMs);
      const cosGmst = Math.cos(gmst);
      const sinGmst = Math.sin(gmst);
      const sunEci = computeSunVectorEci(unixMs);

      // Sun vector in ECEF -> observer solar elevation for twilight detection
      const sunEcefX = cosGmst * sunEci.x + sinGmst * sunEci.y;
      const sunEcefY = -sinGmst * sunEci.x + cosGmst * sunEci.y;
      const sunEcefZ = sunEci.z;
      const sunUp =
        sunEcefX * observer.up.x +
        sunEcefY * observer.up.y +
        sunEcefZ * observer.up.z;
      const solarElevationDeg =
        Math.asin(Math.max(-1.0, Math.min(1.0, sunUp))) * CONSTANTS.RAD2DEG;
      const isObserverTwilight =
        solarElevationDeg >= -18.0 && solarElevationDeg <= -0.5;

      const minEl =
        typeof customMinElDeg === 'number'
          ? customMinElDeg
          : obsCfg.minElevationDeg;

      const sqrt1pe = Math.sqrt(1.0 + e);
      const sqrt1me = Math.sqrt(1.0 - e);
      const muOverH = CONSTANTS.MU_EARTH_M3_S2 / hAng;
      const rEarthSq = CONSTANTS.R_EARTH_EQ_M * CONSTANTS.R_EARTH_EQ_M;

      let visibleAboveConeCount = 0;
      let visibleAboveHorizonCount = 0;
      let sunlitCount = 0;
      let twilightVisibleCount = 0;
      let bestSatIndex = -1;
      let bestElevationDeg = -90.0;
      let backupSatIndex = -1;
      let backupElevationDeg = -90.0;

      for (let i = 0; i < totalSats; i++) {
        const raan = wrapTwoPi(raan0[i] + raanDot * dtSec);
        const argp = wrapTwoPi(argp0[i] + argPerigeeDot * dtSec);
        const M = wrapTwoPi(meanAnom0[i] + meanAnomalyDot * dtSec);
        const E = solveKeplerRad(M, e);

        const halfE = 0.5 * E;
        const nu = 2.0 * Math.atan2(sqrt1pe * Math.sin(halfE), sqrt1me * Math.cos(halfE));
        const r = a * (1.0 - e * Math.cos(E));
        const u = argp + nu;

        const cosO = Math.cos(raan);
        const sinO = Math.sin(raan);
        const cosU = Math.cos(u);
        const sinU = Math.sin(u);

        // Unit radial (ur) and transverse (uu) vectors in ECI
        const urx = cosO * cosU - sinO * sinU * cosInc;
        const ury = sinO * cosU + cosO * sinU * cosInc;
        const urz = sinU * sinInc;

        const uux = -cosO * sinU - sinO * cosU * cosInc;
        const uuy = -sinO * sinU + cosO * cosU * cosInc;
        const uuz = cosU * sinInc;

        const rxEci = r * urx;
        const ryEci = r * ury;
        const rzEci = r * urz;

        const vrOrb = muOverH * e * Math.sin(nu);
        const vuOrb = muOverH * (1.0 + e * Math.cos(nu));
        const vxEci = vrOrb * urx + vuOrb * uux;
        const vyEci = vrOrb * ury + vuOrb * uuy;
        const vzEci = vrOrb * urz + vuOrb * uuz;

        const i3 = i * 3;
        eciPos[i3] = rxEci;
        eciPos[i3 + 1] = ryEci;
        eciPos[i3 + 2] = rzEci;

        // Cylindrical Earth Shadow (Umbra) check in ECI
        const sunProj = rxEci * sunEci.x + ryEci * sunEci.y + rzEci * sunEci.z;
        let inUmbra = false;
        if (sunProj < 0.0) {
          const perpSq = r * r - sunProj * sunProj;
          if (perpSq < rEarthSq) {
            inUmbra = true;
          }
        }

        // ECI -> ECEF position & Earth-fixed velocity (including -omega_E x r_ECEF)
        const rxEcef = cosGmst * rxEci + sinGmst * ryEci;
        const ryEcef = -sinGmst * rxEci + cosGmst * ryEci;
        const rzEcef = rzEci;

        const vxRot = cosGmst * vxEci + sinGmst * vyEci;
        const vyRot = -sinGmst * vxEci + cosGmst * vyEci;
        const vxEcef = vxRot + CONSTANTS.OMEGA_EARTH_RAD_S * ryEcef;
        const vyEcef = vyRot - CONSTANTS.OMEGA_EARTH_RAD_S * rxEcef;
        const vzEcef = vzEci;

        ecefPos[i3] = rxEcef;
        ecefPos[i3 + 1] = ryEcef;
        ecefPos[i3 + 2] = rzEcef;

        // Line-of-sight vector from Ashdod observer in ECEF & ENU
        const dx = rxEcef - observer.x;
        const dy = ryEcef - observer.y;
        const dz = rzEcef - observer.z;
        const rho = Math.sqrt(dx * dx + dy * dy + dz * dz);
        slantRangeM[i] = rho;

        const eastM =
          dx * observer.east.x + dy * observer.east.y + dz * observer.east.z;
        const northM =
          dx * observer.north.x + dy * observer.north.y + dz * observer.north.z;
        const upM =
          dx * observer.up.x + dy * observer.up.y + dz * observer.up.z;

        enuPos[i3] = eastM;
        enuPos[i3 + 1] = northM;
        enuPos[i3 + 2] = upM;

        const sinEl = Math.max(-1.0, Math.min(1.0, upM / rho));
        const elDeg = Math.asin(sinEl) * CONSTANTS.RAD2DEG;
        let azDeg = Math.atan2(eastM, northM) * CONSTANTS.RAD2DEG;
        if (azDeg < 0.0) azDeg += 360.0;

        elevationDeg[i] = elDeg;
        azimuthDeg[i] = azDeg;

        // Radial velocity & Ku-band Doppler shift
        const rhoDot = (dx * vxEcef + dy * vyEcef + dz * vzEcef) / rho;
        rangeRateMps[i] = rhoDot;
        dopplerHz[i] =
          -CONSTANTS.KU_DOWNLINK_HZ * (rhoDot / CONSTANTS.C_LIGHT_MPS);

        // Physical RTT estimate: User->Sat + Sat->Gateway (~650 km regional PoP slant) + 21.5 ms baseband/PoP/fiber floor
        const sinElClamped = Math.max(0.087, sinEl);
        const tropoDelayM = 2.3 / sinElClamped;
        const oneWayUserSatS = (rho + tropoDelayM) / CONSTANTS.C_LIGHT_MPS;
        const feederSlantM = Math.max(550000.0, rho * 0.96);
        const rttMs =
          2.0 * (oneWayUserSatS + feederSlantM / CONSTANTS.C_LIGHT_MPS) * 1000.0 +
          18.2;
        rttLatencyMs[i] = rttMs;

        if (!inUmbra) {
          sunlitCount++;
          if (isObserverTwilight && elDeg >= 10.0) {
            illuminationFlag[i] = 2;
            twilightVisibleCount++;
          } else {
            illuminationFlag[i] = 1;
          }
        } else {
          illuminationFlag[i] = 0;
        }

        if (elDeg > 0.0) {
          visibleAboveHorizonCount++;
        }
        if (elDeg >= minEl) {
          visibleAboveConeCount++;
          if (elDeg > bestElevationDeg) {
            backupElevationDeg = bestElevationDeg;
            backupSatIndex = bestSatIndex;
            bestElevationDeg = elDeg;
            bestSatIndex = i;
          } else if (elDeg > backupElevationDeg) {
            backupElevationDeg = elDeg;
            backupSatIndex = i;
          }
        }
      }

      const activeSat =
        bestSatIndex >= 0
          ? getSatelliteTelemetry(bestSatIndex)
          : null;
      const backupSat =
        backupSatIndex >= 0
          ? getSatelliteTelemetry(backupSatIndex)
          : null;

      return {
        unixMs,
        dtSec,
        totalSats,
        solarElevationDeg,
        isObserverTwilight,
        visibleAboveConeCount,
        visibleAboveHorizonCount,
        sunlitCount,
        twilightVisibleCount,
        minElevationDeg: minEl,
        bestSatIndex,
        backupSatIndex,
        activeSat,
        backupSat
      };
    }

    function getSatelliteTelemetry(index) {
      if (index < 0 || index >= totalSats) return null;
      const i3 = index * 3;
      const pIdx = planeIdx[index];
      const sIdx = slotIdx[index];
      const eastM = enuPos[i3];
      const northM = enuPos[i3 + 1];
      const upM = enuPos[i3 + 2];
      return {
        index,
        satId:
          'SL-S1-P' +
          String(pIdx + 1).padStart(2, '0') +
          '-' +
          String(sIdx + 1).padStart(2, '0'),
        plane: pIdx + 1,
        slot: sIdx + 1,
        slantRangeKm: slantRangeM[index] * 0.001,
        azimuthDeg: azimuthDeg[index],
        elevationDeg: elevationDeg[index],
        rangeRateMps: rangeRateMps[index],
        dopplerKhz: dopplerHz[index] * 0.001,
        rttLatencyMs: rttLatencyMs[index],
        illumination: illuminationFlag[index], // 0=Umbra, 1=Sunlit, 2=TwilightFlare
        enuM: { east: eastM, north: northM, up: upM },
        itm2039: {
          east: obsCfg.itmEastM + eastM,
          north: obsCfg.itmNorthM + northM
        }
      };
    }

    return {
      CONSTANTS,
      config: cfg,
      observerConfig: obsCfg,
      orbitalMechanics: {
        semiMajorAxisM: a,
        meanMotionRadS: n0,
        keplerPeriodSec: CONSTANTS.TWO_PI / n0,
        orbitalSpeedMps: Math.sqrt(CONSTANTS.MU_EARTH_M3_S2 / a),
        raanDriftDegPerDay: raanDot * CONSTANTS.RAD2DEG * 86400.0,
        argPerigeeDriftDegPerDay: argPerigeeDot * CONSTANTS.RAD2DEG * 86400.0,
        meanAnomalyDriftRadS: meanAnomalyDot
      },
      buffers: {
        eciPos,
        ecefPos,
        enuPos,
        slantRangeM,
        azimuthDeg,
        elevationDeg,
        rangeRateMps,
        dopplerHz,
        rttLatencyMs,
        illuminationFlag,
        planeIdx,
        slotIdx
      },
      propagate,
      getSatelliteTelemetry,
      setObserver
    };
  }

  /**
   * Three.js Single-Draw-Call InstancedMesh Layer for Twin World (Globe or Local Sky Dome).
   * Guarantees 1 Draw Call for all 1,584 satellites + clean WebGL resource disposal.
   */
  function createThreeLeoLayer(THREE, scene, engine, layerOptions) {
    const opts = Object.assign(
      {
        mode: 'sky-dome', // 'sky-dome' (over Ashdod city twin) or 'globe' (orbital earth view)
        globeRadiusUnits: 120.0,
        skyDomeRadiusUnits: 420.0,
        satScale: 1.0
      },
      layerOptions || {}
    );

    const count = engine.config.planes * engine.config.satsPerPlane;
    const geometry = new THREE.OctahedronGeometry(1.35 * opts.satScale, 0);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff
    });

    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instancedMesh.name = 'StarlinkShell1_Instanced1584';
    instancedMesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const cConeActive = new THREE.Color(0x10b981); // Emerald active in 25° cone
    const cPrimary = new THREE.Color(0x38bdf8);    // Bright Ku-band cyan primary
    const cTwilight = new THREE.Color(0xf59e0b);   // Solar twilight flare amber
    const cSunlit = new THREE.Color(0x64748b);     // Sunlit out-of-cone slate
    const cUmbra = new THREE.Color(0x1e293b);      // Earth shadow dim slate

    // Initialize instanceColor buffer
    for (let i = 0; i < count; i++) {
      instancedMesh.setColorAt(i, cSunlit);
    }
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }

    // Active serving Ku-band beam line + backup handoff line (2 draw calls total for beams)
    const primaryBeamGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 50, 0)
    ]);
    const primaryBeamMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92
    });
    const primaryBeamLine = new THREE.Line(primaryBeamGeom, primaryBeamMat);
    primaryBeamLine.frustumCulled = false;

    const backupBeamGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 50, 0)
    ]);
    const backupBeamMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.45
    });
    const backupBeamLine = new THREE.Line(backupBeamGeom, backupBeamMat);
    backupBeamLine.frustumCulled = false;

    const group = new THREE.Group();
    group.name = 'TwinStarlinkLeoShellGroup';
    group.add(instancedMesh);
    group.add(primaryBeamLine);
    group.add(backupBeamLine);
    scene.add(group);

    const satScenePositions = new Float32Array(count * 3);

    function mapSatToScene(i, mode, outVec) {
      const i3 = i * 3;
      if (mode === 'globe') {
        const scale = opts.globeRadiusUnits / CONSTANTS.R_EARTH_EQ_M;
        // ECEF (X,Y,Z) -> Three.js Y-up (X = ecefX, Y = ecefZ, Z = -ecefY)
        outVec.set(
          engine.buffers.ecefPos[i3] * scale,
          engine.buffers.ecefPos[i3 + 2] * scale,
          -engine.buffers.ecefPos[i3 + 1] * scale
        );
      } else {
        // Local Ashdod ENU compressed onto true-azimuth/elevation sky shell above the city
        const elRad = engine.buffers.elevationDeg[i] * CONSTANTS.DEG2RAD;
        const azRad = engine.buffers.azimuthDeg[i] * CONSTANTS.DEG2RAD;
        if (elRad < -0.18) {
          // Tuck below-horizon satellites cleanly beneath deep subterranean clip plane
          outVec.set(0, -9999, 0);
        } else {
          const domeR = opts.skyDomeRadiusUnits;
          const horiz = domeR * Math.cos(elRad);
          // Three.js convention: +X = East, +Y = Up, -Z = North
          outVec.set(
            horiz * Math.sin(azRad),
            Math.max(18.0, domeR * Math.sin(elRad)),
            -horiz * Math.cos(azRad)
          );
        }
      }
    }

    const tmpVec = new THREE.Vector3();

    function update(unixMs, anchorWorldPos, modeOverride) {
      const activeMode = modeOverride || opts.mode;
      const summary = engine.propagate(unixMs);
      const minEl = summary.minElevationDeg;

      for (let i = 0; i < count; i++) {
        mapSatToScene(i, activeMode, tmpVec);
        const i3 = i * 3;
        satScenePositions[i3] = tmpVec.x;
        satScenePositions[i3 + 1] = tmpVec.y;
        satScenePositions[i3 + 2] = tmpVec.z;

        dummy.position.copy(tmpVec);
        const el = engine.buffers.elevationDeg[i];
        const illum = engine.buffers.illuminationFlag[i];

        if (i === summary.bestSatIndex) {
          dummy.scale.setScalar(2.35);
          instancedMesh.setColorAt(i, cPrimary);
        } else if (el >= minEl) {
          dummy.scale.setScalar(1.55);
          instancedMesh.setColorAt(i, cConeActive);
        } else if (illum === 2) {
          dummy.scale.setScalar(1.3);
          instancedMesh.setColorAt(i, cTwilight);
        } else if (illum === 1) {
          dummy.scale.setScalar(0.85);
          instancedMesh.setColorAt(i, cSunlit);
        } else {
          dummy.scale.setScalar(0.62);
          instancedMesh.setColorAt(i, cUmbra);
        }
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
      }

      instancedMesh.instanceMatrix.needsUpdate = true;
      if (instancedMesh.instanceColor) {
        instancedMesh.instanceColor.needsUpdate = true;
      }

      // Update primary & backup Ku-band beams to anchor target
      const anchor = anchorWorldPos || { x: 0, y: 2.5, z: 0 };
      if (summary.bestSatIndex >= 0) {
        const b3 = summary.bestSatIndex * 3;
        const posAttr = primaryBeamGeom.attributes.position;
        posAttr.setXYZ(0, anchor.x, anchor.y, anchor.z);
        posAttr.setXYZ(
          1,
          satScenePositions[b3],
          satScenePositions[b3 + 1],
          satScenePositions[b3 + 2]
        );
        posAttr.needsUpdate = true;
        primaryBeamLine.visible = true;
      } else {
        primaryBeamLine.visible = false;
      }

      if (summary.backupSatIndex >= 0) {
        const k3 = summary.backupSatIndex * 3;
        const posAttr2 = backupBeamGeom.attributes.position;
        posAttr2.setXYZ(0, anchor.x, anchor.y, anchor.z);
        posAttr2.setXYZ(
          1,
          satScenePositions[k3],
          satScenePositions[k3 + 1],
          satScenePositions[k3 + 2]
        );
        posAttr2.needsUpdate = true;
        backupBeamLine.visible = true;
      } else {
        backupBeamLine.visible = false;
      }

      return summary;
    }

    function dispose() {
      scene.remove(group);
      geometry.dispose();
      material.dispose();
      primaryBeamGeom.dispose();
      primaryBeamMat.dispose();
      backupBeamGeom.dispose();
      backupBeamMat.dispose();
      if (typeof instancedMesh.dispose === 'function') {
        instancedMesh.dispose();
      }
    }

    return {
      group,
      instancedMesh,
      primaryBeamLine,
      backupBeamLine,
      satScenePositions,
      update,
      dispose
    };
  }

  return {
    CONSTANTS,
    ASHDOD_ORIGIN,
    SHELL1_CONFIG,
    computeGmstRad,
    computeSunVectorEci,
    geodeticToEcefAndBasis,
    solveKeplerRad,
    createConstellationEngine,
    createThreeLeoLayer
  };
});
