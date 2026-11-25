/**
 * בס"ד
 * ESH27 Twin World — 72-rf-link-budget.js (v0.5.0-hr02)
 * First-Principles Ku/Ka-Band Phased-Array RF Link Budget (Friis FSPL, ITU-R P.676/P.838 Rain & Gas Fade,
 * ESA Cosine Roll-off, Boltzmann Thermal Noise, Shannon/DVB-S2X ACM) + 3D Urban AABB Ray-Casting
 * LOS Obstruction Dome over Ashdod (EPSG:2039) with Single-Draw-Call Vertex-Colored Hemisphere Mesh.
 *
 * Compatible with Browser (window.TwinRfLinkBudget / THREE r128) and Node.js ESM/CJS tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TwinRfLinkBudget = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RF_CONSTANTS = Object.freeze({
    C_LIGHT_MPS: 299792458.0,
    K_BOLTZMANN_J_K: 1.380649e-23,
    K_BOLTZMANN_DBW_K_HZ: 10.0 * Math.log10(1.380649e-23), // -228.599167 dBW/K/Hz
    KU_FREQ_HZ: 11.7e9,
    KA_FREQ_HZ: 28.5e9,
    CHANNEL_BW_HZ: 240.0e6,       // 240 MHz Starlink Ku user channel bandwidth
    SAT_EIRP_DBW: 37.5,           // Phased-array spot-beam effective EIRP towards user cell
    TERM_G_OVER_T_DB_K: 13.2,     // Standard flat-panel user terminal G/T at boresight
    ESA_SCAN_EXPONENT: 1.35,      // Cosine scan loss exponent for phased array
    GAS_ZENITH_KU_DB: 0.085,      // ITU-R P.676 clear-air zenith attenuation at 11.7 GHz
    RAIN_K_KU: 0.0188,            // ITU-R P.838 k coefficient at 11.7 GHz
    RAIN_ALPHA_KU: 1.217,         // ITU-R P.838 alpha exponent at 11.7 GHz
    RAIN_FREEZING_HEIGHT_KM: 3.2, // Ashdod Mediterranean effective rain ceiling
    BLDG_SHADOW_LOSS_DB: 28.5,    // Reinforced concrete high-rise direct occlusion loss
    ROOF_DIFFRACTION_LOSS_DB: 8.5,// Grazing knife-edge roof diffraction penalty
    DEG2RAD: Math.PI / 180.0,
    RAD2DEG: 180.0 / Math.PI
  });

  // DVB-S2X Adaptive Coding & Modulation (ACM) table (sorted high -> low spectral efficiency)
  const DVBS2X_MODCODS = Object.freeze([
    { name: '64APSK 5/6', minSnrDb: 16.5, specEffBpsHz: 4.90, userShareFactor: 0.25 },
    { name: '32APSK 5/6', minSnrDb: 13.8, specEffBpsHz: 4.10, userShareFactor: 0.25 },
    { name: '16APSK 4/5', minSnrDb: 10.6, specEffBpsHz: 3.15, userShareFactor: 0.25 },
    { name: '8PSK 3/4',   minSnrDb: 7.9,  specEffBpsHz: 2.22, userShareFactor: 0.25 },
    { name: 'QPSK 3/5',   minSnrDb: 2.3,  specEffBpsHz: 1.18, userShareFactor: 0.25 },
    { name: 'QPSK 1/4',   minSnrDb: -2.3, specEffBpsHz: 0.49, userShareFactor: 0.25 }
  ]);

  // Default Ashdod 3D Urban Obstacle Catalog (in local Twin meters relative to HaErez 4 origin)
  // Coordinates match the scene scale (1 scene unit = 2.5m horizontal) and real metric heights AGL
  const DEFAULT_ASHDOD_OBSTACLES = Object.freeze([
    { id: 'ktower_1',   name: 'מגדלי K (מגדל מערבי)', minX: -54, maxX: -42, minZ: 28,  maxZ: 40,  maxY: 51.3 },
    { id: 'ktower_2',   name: 'מגדלי K (מגדל מזרחי)', minX: -42, maxX: -30, minZ: 32,  maxZ: 44,  maxY: 51.3 },
    { id: 'dimri',      name: 'מגדל דמרי (41 קומות)', minX: 18,  maxX: 30,  minZ: 40,  maxZ: 52,  maxY: 49.1 },
    { id: 'hadekel_1',  name: 'מגדלי הדקל 1–3',       minX: -24, maxX: -12, minZ: -28, maxZ: -16, maxY: 35.0 },
    { id: 'hadekel_4',  name: 'מגדל הדקל 4 (שלד)',    minX: -11, maxX: -3,  minZ: -26, maxZ: -18, maxY: 21.0 },
    { id: 'rogozin_27', name: 'רוגוזין 27 (24 קומות)', minX: 10,  maxX: 20,  minZ: -18, maxZ: -8,  maxY: 29.0 },
    { id: 'canyon_n',   name: 'בלוק מגורים צפוני',     minX: -8,  maxX: 8,   minZ: -15, maxZ: -7,  maxY: 16.5 },
    { id: 'canyon_w',   name: 'בלוק מגורים מערבי',     minX: -16, maxX: -7,  minZ: -6,  maxZ: 6,   maxY: 18.0 },
    { id: 'givatyona',  name: 'גבעת יונה והמגדלור',   minX: -36, maxX: -24, minZ: -111,maxZ: -99, maxY: 28.5 },
    { id: 'port_crane', name: 'מנופי נמל אשדוד',      minX: -76, maxX: -60, minZ: -156,maxZ: -144,maxY: 22.0 }
  ]);

  /**
   * Exact Free-Space Path Loss (dB) from Friis Transmission Equation.
   */
  function computeFsplDb(distanceM, freqHz) {
    const f = freqHz || RF_CONSTANTS.KU_FREQ_HZ;
    const d = Math.max(1.0, distanceM);
    const fourPiDFOverC = (4.0 * Math.PI * d * f) / RF_CONSTANTS.C_LIGHT_MPS;
    return 20.0 * Math.log10(fourPiDFOverC);
  }

  /**
   * ITU-R P.676 Gaseous + ITU-R P.838 Rain Slant-Path Attenuation (dB).
   */
  function computeAtmosphericLossDb(elevationDeg, rainRateMmHr, obsAltKm) {
    const elClamped = Math.max(5.0, Math.min(90.0, elevationDeg));
    const sinEl = Math.sin(elClamped * RF_CONSTANTS.DEG2RAD);
    const gasLossDb = RF_CONSTANTS.GAS_ZENITH_KU_DB / sinEl;

    const r = Math.max(0.0, rainRateMmHr || 0.0);
    if (r <= 0.01) {
      return { gasLossDb, rainLossDb: 0.0, totalAtmoLossDb: gasLossDb };
    }
    const gammaR = RF_CONSTANTS.RAIN_K_KU * Math.pow(r, RF_CONSTANTS.RAIN_ALPHA_KU);
    const h0 = typeof obsAltKm === 'number' ? obsAltKm : 0.015;
    const slantRainKm = Math.max(0.2, (RF_CONSTANTS.RAIN_FREEZING_HEIGHT_KM - h0) / sinEl);
    // Horizontal path reduction factor per ITU-R P.530/P.618
    const pathReduction = 1.0 / (1.0 + 0.045 * slantRainKm * Math.pow(r, 0.35));
    const rainLossDb = gammaR * slantRainKm * pathReduction;
    return {
      gasLossDb,
      rainLossDb,
      totalAtmoLossDb: gasLossDb + rainLossDb
    };
  }

  /**
   * Phased-Array Electronically Steered Antenna (ESA) Cosine Scan Loss (dB).
   */
  function computePhasedArrayScanLossDb(elevationDeg) {
    const elClamped = Math.max(15.0, Math.min(90.0, elevationDeg));
    const scanAngleRad = (90.0 - elClamped) * RF_CONSTANTS.DEG2RAD;
    const cosTheta = Math.max(0.2, Math.cos(scanAngleRad));
    return -10.0 * RF_CONSTANTS.ESA_SCAN_EXPONENT * Math.log10(cosTheta);
  }

  /**
   * 3D Slab Ray-AABB Intersection Test for Urban LOS Obstruction.
   * Origin: (ox, oy, oz) in scene coordinates; Direction: unit vector (dx, dy, dz) from Az/El.
   */
  function rayIntersectsAabb(ox, oy, oz, dx, dy, dz, box) {
    // Ignore box if origin is inside the box's own horizontal footprint (self-rooftop terminal)
    if (ox >= box.minX + 0.2 && ox <= box.maxX - 0.2 && oz >= box.minZ + 0.2 && oz <= box.maxZ - 0.2 && oy >= box.maxY - 0.5) {
      return null;
    }

    let tmin = 0.25; // Start 0.25 units outside antenna radome
    let tmax = 1200.0;

    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < box.minX || ox > box.maxX) return null;
    } else {
      const invD = 1.0 / dx;
      let t1 = (box.minX - ox) * invD;
      let t2 = (box.maxX - ox) * invD;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    // Y slab (ground 0 to box.maxY)
    if (Math.abs(dy) < 1e-9) {
      if (oy < 0.0 || oy > box.maxY) return null;
    } else {
      const invD = 1.0 / dy;
      let t1 = (0.0 - oy) * invD;
      let t2 = (box.maxY - oy) * invD;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (oz < box.minZ || oz > box.maxZ) return null;
    } else {
      const invD = 1.0 / dz;
      let t1 = (box.minZ - oz) * invD;
      let t2 = (box.maxZ - oz) * invD;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    const hitY = oy + tmin * dy;
    const roofMargin = box.maxY - hitY;
    return {
      distanceUnits: tmin,
      hitY,
      roofMargin,
      obstacleId: box.id,
      obstacleName: box.name,
      isGrazingRoof: roofMargin >= 0.0 && roofMargin < 1.8
    };
  }

  /**
   * Convert (azimuthDeg, elevationDeg) to Three.js scene unit direction (+X=East, +Y=Up, -Z=North).
   */
  function azElToSceneDir(azimuthDeg, elevationDeg) {
    const az = azimuthDeg * RF_CONSTANTS.DEG2RAD;
    const el = elevationDeg * RF_CONSTANTS.DEG2RAD;
    const cosEl = Math.cos(el);
    return {
      dx: cosEl * Math.sin(az),
      dy: Math.sin(el),
      dz: -cosEl * Math.cos(az)
    };
  }

  /**
   * Check urban LOS obstruction along (azimuthDeg, elevationDeg) from terminal Pos (x,y,z).
   */
  function traceUrbanLos(terminalPos, azimuthDeg, elevationDeg, obstacles) {
    const list = obstacles || DEFAULT_ASHDOD_OBSTACLES;
    const dir = azElToSceneDir(azimuthDeg, elevationDeg);
    let closestHit = null;

    for (let i = 0; i < list.length; i++) {
      const hit = rayIntersectsAabb(
        terminalPos.x,
        terminalPos.y,
        terminalPos.z,
        dir.dx,
        dir.dy,
        dir.dz,
        list[i]
      );
      if (hit && (!closestHit || hit.distanceUnits < closestHit.distanceUnits)) {
        closestHit = hit;
      }
    }

    if (!closestHit) {
      return {
        obstructed: false,
        state: 'CLEAR_LOS',
        obstructionLossDb: 0.0,
        blockerName: null
      };
    }

    if (closestHit.isGrazingRoof) {
      return {
        obstructed: true,
        state: 'ROOF_DIFFRACTION',
        obstructionLossDb: RF_CONSTANTS.ROOF_DIFFRACTION_LOSS_DB,
        blockerName: closestHit.obstacleName,
        distanceUnits: closestHit.distanceUnits
      };
    }

    return {
      obstructed: true,
      state: 'BUILDING_BLOCKED',
      obstructionLossDb: RF_CONSTANTS.BLDG_SHADOW_LOSS_DB,
      blockerName: closestHit.obstacleName,
      distanceUnits: closestHit.distanceUnits
    };
  }

  /**
   * Full End-to-End Ku-Band Downlink RF Link Budget for a given satellite & Ashdod terminal.
   */
  function evaluateSatelliteLink(satTelemetry, terminalPos, options) {
    const opts = Object.assign({ rainRateMmHr: 0.0, obstacles: DEFAULT_ASHDOD_OBSTACLES }, options || {});
    const distM = satTelemetry.slantRangeKm * 1000.0;
    const elDeg = satTelemetry.elevationDeg;
    const azDeg = satTelemetry.azimuthDeg;

    const fsplDb = computeFsplDb(distM, RF_CONSTANTS.KU_FREQ_HZ);
    const atmo = computeAtmosphericLossDb(elDeg, opts.rainRateMmHr);
    const scanLossDb = computePhasedArrayScanLossDb(elDeg);
    const los = traceUrbanLos(terminalPos, azDeg, elDeg, opts.obstacles);

    const totalPathLossDb =
      fsplDb + atmo.totalAtmoLossDb + scanLossDb + los.obstructionLossDb;

    // Carrier-to-Noise Density C/N0 (dB-Hz) = EIRP - TotalLoss + G/T - k_B
    const cNoDbHz =
      RF_CONSTANTS.SAT_EIRP_DBW -
      totalPathLossDb +
      RF_CONSTANTS.TERM_G_OVER_T_DB_K -
      RF_CONSTANTS.K_BOLTZMANN_DBW_K_HZ;

    // SNR (C/N) in 240 MHz bandwidth
    const bwDbHz = 10.0 * Math.log10(RF_CONSTANTS.CHANNEL_BW_HZ); // 83.802 dB-Hz
    const snrDb = cNoDbHz - bwDbHz;
    const snrLinear = Math.pow(10.0, snrDb / 10.0);

    // Shannon theoretical channel capacity & realistic DVB-S2X ACM ModCod selection
    const shannonBeamMbps =
      (RF_CONSTANTS.CHANNEL_BW_HZ * Math.log2(1.0 + snrLinear)) * 1e-6;

    let selectedModCod = { name: 'NO_LOCK', minSnrDb: -2.3, specEffBpsHz: 0.0, userShareFactor: 0.0 };
    for (let i = 0; i < DVBS2X_MODCODS.length; i++) {
      if (snrDb >= DVBS2X_MODCODS[i].minSnrDb) {
        selectedModCod = DVBS2X_MODCODS[i];
        break;
      }
    }

    const linkMarginDb = snrDb - (-2.3); // Margin above QPSK 1/4 lock threshold
    const rawBeamThroughputMbps =
      (RF_CONSTANTS.CHANNEL_BW_HZ * selectedModCod.specEffBpsHz) * 1e-6;
    const netUserThroughputMbps =
      rawBeamThroughputMbps * selectedModCod.userShareFactor;

    return {
      satId: satTelemetry.satId,
      satIndex: satTelemetry.index,
      azimuthDeg: azDeg,
      elevationDeg: elDeg,
      slantRangeKm: satTelemetry.slantRangeKm,
      dopplerKhz: satTelemetry.dopplerKhz,
      rttLatencyMs: satTelemetry.rttLatencyMs,
      fsplDb,
      gasLossDb: atmo.gasLossDb,
      rainLossDb: atmo.rainLossDb,
      scanLossDb,
      obstructionLossDb: los.obstructionLossDb,
      losState: los.state,
      obstructed: los.obstructed,
      blockerName: los.blockerName,
      totalPathLossDb,
      cNoDbHz,
      snrDb,
      linkMarginDb,
      modCod: selectedModCod.name,
      shannonBeamMbps,
      netUserThroughputMbps
    };
  }

  /**
   * Compute full Polar Obstruction Dome (36 azimuth steps x 13 elevation rings above 25 deg)
   * and select Optimal Unobstructed Satellite (Smart Beam Handoff) across all visible LEO satellites.
   */
  function analyzeAshdodSkyAndSelectBeam(leoEngine, terminalPos, options) {
    const opts = Object.assign(
      {
        rainRateMmHr: 0.0,
        smartHandoff: true,
        minElevationDeg: 25.0,
        obstacles: DEFAULT_ASHDOD_OBSTACLES,
        azBins: 36,
        elBins: 13
      },
      options || {}
    );

    const totalDomeCells = opts.azBins * opts.elBins;
    let clearCells = 0;
    let diffractedCells = 0;
    let blockedCells = 0;
    const cellStates = new Uint8Array(totalDomeCells); // 0=clear, 1=diffraction, 2=blocked

    let cellIdx = 0;
    for (let eIdx = 0; eIdx < opts.elBins; eIdx++) {
      const elDeg = opts.minElevationDeg + ((90.0 - opts.minElevationDeg) * (eIdx + 0.5)) / opts.elBins;
      for (let aIdx = 0; aIdx < opts.azBins; aIdx++) {
        const azDeg = (360.0 * aIdx) / opts.azBins;
        const los = traceUrbanLos(terminalPos, azDeg, elDeg, opts.obstacles);
        if (los.state === 'CLEAR_LOS') {
          cellStates[cellIdx] = 0;
          clearCells++;
        } else if (los.state === 'ROOF_DIFFRACTION') {
          cellStates[cellIdx] = 1;
          diffractedCells++;
        } else {
          cellStates[cellIdx] = 2;
          blockedCells++;
        }
        cellIdx++;
      }
    }

    const skyClearancePct = (clearCells / totalDomeCells) * 100.0;

    // Evaluate all satellites currently inside the >=25 deg cone
    const totalSats = leoEngine.config.planes * leoEngine.config.satsPerPlane;
    const elBuf = leoEngine.buffers.elevationDeg;
    const candidateLinks = [];

    let highestElLink = null;
    let bestRfLink = null;

    for (let i = 0; i < totalSats; i++) {
      if (elBuf[i] >= opts.minElevationDeg) {
        const telem = leoEngine.getSatelliteTelemetry(i);
        const link = evaluateSatelliteLink(telem, terminalPos, opts);
        candidateLinks.push(link);

        if (!highestElLink || link.elevationDeg > highestElLink.elevationDeg) {
          highestElLink = link;
        }
        if (!bestRfLink || link.snrDb > bestRfLink.snrDb) {
          bestRfLink = link;
        }
      }
    }

    const selectedLink = opts.smartHandoff ? bestRfLink : highestElLink;
    const handoffTriggered =
      Boolean(opts.smartHandoff && highestElLink && bestRfLink && highestElLink.satIndex !== bestRfLink.satIndex);

    return {
      terminalPos,
      rainRateMmHr: opts.rainRateMmHr,
      totalDomeCells,
      clearCells,
      diffractedCells,
      blockedCells,
      skyClearancePct,
      cellStates,
      visibleConeSats: candidateLinks.length,
      unobstructedConeSats: candidateLinks.filter((c) => !c.obstructed).length,
      highestElLink,
      bestRfLink,
      selectedLink,
      handoffTriggered,
      candidateLinks
    };
  }

  /**
   * Create Single-Draw-Call Vertex-Colored 3D Obstruction Dome Mesh in Three.js.
   * Renders all 468 polar sky sectors (Az 0..360, El 25..90) in 1 THREE.Mesh (1 Draw Call).
   */
  function createThreeObstructionDome(THREE, scene, domeOptions) {
    const opts = Object.assign(
      {
        radiusUnits: 28.0,
        minElevationDeg: 25.0,
        azBins: 36,
        elBins: 13
      },
      domeOptions || {}
    );

    const azBins = opts.azBins;
    const elBins = opts.elBins;
    const quadCount = azBins * elBins;
    const vertexCount = quadCount * 6; // 2 triangles per polar cell

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    function setSphericalVertex(arr, vIdx, azDeg, elDeg, r) {
      const d = azElToSceneDir(azDeg, elDeg);
      const i3 = vIdx * 3;
      arr[i3] = d.dx * r;
      arr[i3 + 1] = d.dy * r;
      arr[i3 + 2] = d.dz * r;
    }

    let v = 0;
    for (let eIdx = 0; eIdx < elBins; eIdx++) {
      const el0 = opts.minElevationDeg + ((90.0 - opts.minElevationDeg) * eIdx) / elBins;
      const el1 = opts.minElevationDeg + ((90.0 - opts.minElevationDeg) * (eIdx + 1)) / elBins;
      for (let aIdx = 0; aIdx < azBins; aIdx++) {
        const az0 = (360.0 * aIdx) / azBins;
        const az1 = (360.0 * (aIdx + 1)) / azBins;

        setSphericalVertex(positions, v++, az0, el0, opts.radiusUnits);
        setSphericalVertex(positions, v++, az1, el0, opts.radiusUnits);
        setSphericalVertex(positions, v++, az1, el1, opts.radiusUnits);

        setSphericalVertex(positions, v++, az0, el0, opts.radiusUnits);
        setSphericalVertex(positions, v++, az1, el1, opts.radiusUnits);
        setSphericalVertex(positions, v++, az0, el1, opts.radiusUnits);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
      wireframe: false
    });

    const domeMesh = new THREE.Mesh(geometry, material);
    domeMesh.name = 'AshdodRfObstructionDome_1DrawCall';
    scene.add(domeMesh);

    function updateDome(terminalPos, cellStates) {
      domeMesh.position.set(terminalPos.x, terminalPos.y, terminalPos.z);
      const colAttr = geometry.attributes.color;
      const colArr = colAttr.array;

      for (let c = 0; c < quadCount; c++) {
        const st = cellStates[c];
        // 0 = Clear Emerald, 1 = Roof Diffraction Amber, 2 = Blocked Crimson
        let r = 0.06;
        let g = 0.72;
        let b = 0.50;
        if (st === 1) {
          r = 0.96;
          g = 0.62;
          b = 0.04;
        } else if (st === 2) {
          r = 0.94;
          g = 0.22;
          b = 0.27;
        }
        const base = c * 18;
        for (let k = 0; k < 18; k += 3) {
          colArr[base + k] = r;
          colArr[base + k + 1] = g;
          colArr[base + k + 2] = b;
        }
      }
      colAttr.needsUpdate = true;
    }

    function dispose() {
      scene.remove(domeMesh);
      geometry.dispose();
      material.dispose();
    }

    return {
      domeMesh,
      updateDome,
      dispose
    };
  }

  return {
    RF_CONSTANTS,
    DVBS2X_MODCODS,
    DEFAULT_ASHDOD_OBSTACLES,
    computeFsplDb,
    computeAtmosphericLossDb,
    computePhasedArrayScanLossDb,
    rayIntersectsAabb,
    traceUrbanLos,
    evaluateSatelliteLink,
    analyzeAshdodSkyAndSelectBeam,
    createThreeObstructionDome
  };
});
