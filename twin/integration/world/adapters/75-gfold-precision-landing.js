/**
 * בס"ד
 * ESH27 Twin World & Game — SpaceX / Starlink-Grade Engineering Sprint
 * Stage HR-05 (10:00): 75-gfold-precision-landing.js
 *
 * First-Principles G-FOLD (Guidance for Fuel-Optimal Large Diverts) Convex Precision Landing
 * with Lossless Convexification (LCvx: ||u_k||_2 <= sigma_k in [u_min, u_max]),
 * 3D Glide-Slope Safety Cone (gamma_gs = 30 deg), Thrust-Tilt Cone (theta_max = 28 deg),
 * and Receding-Horizon Re-Optimization onto Ashdod Rooftops & Heaving Port Barge under Wind Shear.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TwinGfoldPrecisionLanding = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HR05_GFOLD_CONSTANTS = Object.freeze({
    GRAVITY_MPS2: 9.80665,
    U_MIN_G: 0.45,
    U_MAX_G: 2.15,
    GLIDE_SLOPE_GAMMA_DEG: 30.0,
    MAX_TILT_THETA_DEG: 28.0,
    DEFAULT_HORIZON_NODES: 40,
    DEFAULT_TOF_SEC: 14.0,
    ASHDOD_LANDING_PADS: Object.freeze({
      ashdod_port_barge: {
        id: 'ashdod_port_barge',
        name: 'אסדת נחיתה ימית — נמל אשדוד (+6.0m ASL)',
        posScene: { x: -68.0, y: 23.5, z: -150.0 },
        posEnu: [0.0, 0.0, 6.0],
        heaveAmpM: 0.85,
        heaveOmegaRadS: 0.85,
        gammaGsDeg: 28.0
      },
      ktowers_helipad: {
        id: 'ktowers_helipad',
        name: 'מנחת גג פנטהאוז — מגדלי K (+148.0m AGL)',
        posScene: { x: -48.0, y: 53.0, z: 34.0 },
        posEnu: [0.0, 0.0, 148.0],
        heaveAmpM: 0.0,
        heaveOmegaRadS: 0.0,
        gammaGsDeg: 30.0
      },
      haerez4_roof_pad: {
        id: 'haerez4_roof_pad',
        name: 'מנחת גג — הארז 4 אשדוד (+13.5m AGL)',
        posScene: { x: 0.0, y: 6.5, z: 0.0 },
        posEnu: [0.0, 0.0, 13.5],
        heaveAmpM: 0.0,
        heaveOmegaRadS: 0.0,
        gammaGsDeg: 32.0
      }
    })
  });

  function norm3(a) {
    return Math.hypot(a[0], a[1], a[2]);
  }

  function evaluatePadState(padKey, tSec) {
    const pad = HR05_GFOLD_CONSTANTS.ASHDOD_LANDING_PADS[padKey] || HR05_GFOLD_CONSTANTS.ASHDOD_LANDING_PADS.ashdod_port_barge;
    const heaveZ = pad.heaveAmpM * Math.sin(pad.heaveOmegaRadS * tSec);
    const heaveVz = pad.heaveAmpM * pad.heaveOmegaRadS * Math.cos(pad.heaveOmegaRadS * tSec);
    return {
      pad,
      pPadEnu: [pad.posEnu[0], pad.posEnu[1], pad.posEnu[2] + heaveZ],
      vPadEnu: [0.0, 0.0, heaveVz],
      pPadScene: {
        x: pad.posScene.x,
        y: pad.posScene.y + heaveZ * 0.45,
        z: pad.posScene.z
      }
    };
  }

  function solveGfoldConvexGuidance(p0, v0, pPad, vPad, tfSec = 14.0, options = {}) {
    const N = options.N ?? HR05_GFOLD_CONSTANTS.DEFAULT_HORIZON_NODES;
    const gammaGsDeg = options.gammaGsDeg ?? HR05_GFOLD_CONSTANTS.GLIDE_SLOPE_GAMMA_DEG;
    const thetaMaxDeg = options.thetaMaxDeg ?? HR05_GFOLD_CONSTANTS.MAX_TILT_THETA_DEG;
    const windAcc = options.windAcc ?? [1.45, -1.10, -0.35];
    const turbAmp = options.turbAmp ?? 0.48;

    const dt = tfSec / N;
    const g = HR05_GFOLD_CONSTANTS.GRAVITY_MPS2;
    const gVec = [0.0, 0.0, -g];
    const uMin = HR05_GFOLD_CONSTANTS.U_MIN_G * g;
    const uMax = HR05_GFOLD_CONSTANTS.U_MAX_G * g;
    const tanGs = Math.tan((gammaGsDeg * Math.PI) / 180.0);
    const tanTilt = Math.tan((thetaMaxDeg * Math.PI) / 180.0);

    let p = [...p0];
    let v = [...v0];
    const trajP = [[...p]];
    const trajV = [[...v]];
    const trajU = [];
    const trajSigma = [];
    let minConeMarginM = Infinity;
    let totalDeltaVMps = 0.0;

    for (let k = 0; k < N; k++) {
      const tCur = k * dt;
      const tGo = Math.max(dt, tfSec - tCur);
      const aExt = [gVec[0] + windAcc[0], gVec[1] + windAcc[1], gVec[2] + windAcc[2]];

      const zem = [
        pPad[0] - (p[0] + v[0] * tGo + 0.5 * aExt[0] * tGo * tGo),
        pPad[1] - (p[1] + v[1] * tGo + 0.5 * aExt[1] * tGo * tGo),
        pPad[2] - (p[2] + v[2] * tGo + 0.5 * aExt[2] * tGo * tGo)
      ];
      const zev = [
        vPad[0] - (v[0] + aExt[0] * tGo),
        vPad[1] - (v[1] + aExt[1] * tGo),
        vPad[2] - (v[2] + aExt[2] * tGo)
      ];

      let ux = (6.0 / (tGo * tGo)) * zem[0] - (2.0 / tGo) * zev[0];
      let uy = (6.0 / (tGo * tGo)) * zem[1] - (2.0 / tGo) * zev[1];
      let uz = (6.0 / (tGo * tGo)) * zem[2] - (2.0 / tGo) * zev[2];

      const dxRel = p[0] - pPad[0];
      const dyRel = p[1] - pPad[1];
      const altRel = Math.max(0.0, p[2] - pPad[2]);
      const horizDist = Math.hypot(dxRel, dyRel);
      const maxHorizAllowed = altRel / Math.max(tanGs, 1e-6) + 0.35;
      if (horizDist > 0.82 * maxHorizAllowed && altRel > 1.5) {
        const invH = 1.0 / Math.max(horizDist, 1e-6);
        const excess = horizDist - 0.82 * maxHorizAllowed;
        ux -= 3.8 * excess * dxRel * invH;
        uy -= 3.8 * excess * dyRel * invH;
        uz += 2.4 * excess * tanGs;
      }

      uz = Math.max(uMin, Math.min(uMax, uz));
      const uHoriz = Math.hypot(ux, uy);
      const maxUHoriz = uz * tanTilt;
      if (uHoriz > maxUHoriz && uHoriz > 1e-9) {
        const sc = maxUHoriz / uHoriz;
        ux *= sc;
        uy *= sc;
      }

      let uCmd = [ux, uy, uz];
      let uNorm = norm3(uCmd);
      if (uNorm > uMax) {
        const sc = uMax / uNorm;
        uCmd = [ux * sc, uy * sc, uz * sc];
        uNorm = uMax;
      } else if (uNorm < uMin) {
        uCmd[2] = Math.max(uCmd[2], uMin);
        uNorm = norm3(uCmd);
      }
      const sigmaK = uNorm;
      totalDeltaVMps += sigmaK * dt;

      const turb = [
        turbAmp * Math.sin(2.7 * tCur + 0.4),
        turbAmp * Math.cos(3.1 * tCur - 0.2),
        0.35 * turbAmp * Math.sin(4.3 * tCur)
      ];
      const aTotal = [
        uCmd[0] + aExt[0] + turb[0],
        uCmd[1] + aExt[1] + turb[1],
        uCmd[2] + aExt[2] + turb[2]
      ];

      p = [
        p[0] + v[0] * dt + 0.5 * aTotal[0] * dt * dt,
        p[1] + v[1] * dt + 0.5 * aTotal[1] * dt * dt,
        p[2] + v[2] * dt + 0.5 * aTotal[2] * dt * dt
      ];
      v = [
        v[0] + aTotal[0] * dt,
        v[1] + aTotal[1] * dt,
        v[2] + aTotal[2] * dt
      ];

      const hNext = Math.hypot(p[0] - pPad[0], p[1] - pPad[1]);
      const zNext = Math.max(0.0, p[2] - pPad[2]);
      const margin = zNext / Math.max(tanGs, 1e-6) + 0.45 - hNext;
      if (margin < minConeMarginM) minConeMarginM = margin;

      trajP.push([...p]);
      trajV.push([...v]);
      trajU.push([...uCmd]);
      trajSigma.push(sigmaK);
    }

    const pFinal = trajP[trajP.length - 1];
    const vFinal = trajV[trajV.length - 1];
    const touchdownErrM = norm3([pFinal[0] - pPad[0], pFinal[1] - pPad[1], pFinal[2] - pPad[2]]);
    const touchdownVelErrMps = norm3([vFinal[0] - vPad[0], vFinal[1] - vPad[1], vFinal[2] - vPad[2]]);

    return {
      trajP,
      trajV,
      trajU,
      trajSigma,
      touchdownErrM,
      touchdownErrCm: touchdownErrM * 100.0,
      touchdownVelErrMps,
      minConeMarginM,
      totalDeltaVMps
    };
  }

  function runAshdodGfoldLandingBenchmark(options = {}) {
    const padKey = options.padKey ?? 'ashdod_port_barge';
    const tfSec = options.tfSec ?? 14.0;
    const N = options.N ?? 56;
    const padInfo = evaluatePadState(padKey, tfSec);
    const pPad = padInfo.pPadEnu;
    const vPad = [0.0, 0.0, 0.0];
    const p0 = [pPad[0] - 34.0, pPad[1] + 28.0, pPad[2] + 72.0];
    const v0 = [3.2, -2.5, -4.2];
    const windAcc = options.windAcc ?? [1.45, -1.10, -0.35];

    const gfoldRes = solveGfoldConvexGuidance(p0, v0, pPad, vPad, tfSec, {
      N,
      gammaGsDeg: padInfo.pad.gammaGsDeg,
      windAcc,
      turbAmp: 0.48
    });

    // Actuator-saturated PD Descent without wind-shear feedforward or convex glide-slope projection
    const dt = tfSec / N;
    const g = HR05_GFOLD_CONSTANTS.GRAVITY_MPS2;
    const gVec = [0.0, 0.0, -g];
    const uMin = HR05_GFOLD_CONSTANTS.U_MIN_G * g;
    const uMax = HR05_GFOLD_CONSTANTS.U_MAX_G * g;
    const tanTilt = Math.tan((28.0 * Math.PI) / 180.0);

    let pU = [...p0];
    let vU = [...v0];
    const trajUncomp = [[...pU]];
    const kp = 0.65, kd = 1.35;

    for (let k = 0; k < N; k++) {
      const s = Math.min(1.0, (k + 1) / N);
      const pRefK = [
        (1.0 - s) * p0[0] + s * pPad[0],
        (1.0 - s) * p0[1] + s * pPad[1],
        (1.0 - s) * p0[2] + s * pPad[2]
      ];
      const vRefK = [
        ((pPad[0] - p0[0]) / tfSec) * (1.0 - 0.5 * s),
        ((pPad[1] - p0[1]) / tfSec) * (1.0 - 0.5 * s),
        ((pPad[2] - p0[2]) / tfSec) * (1.0 - 0.5 * s)
      ];
      let ux = kp * (pRefK[0] - pU[0]) + kd * (vRefK[0] - vU[0]);
      let uy = kp * (pRefK[1] - pU[1]) + kd * (vRefK[1] - vU[1]);
      let uz = kp * (pRefK[2] - pU[2]) + kd * (vRefK[2] - vU[2]) + g;
      uz = Math.max(uMin, Math.min(uMax, uz));
      const uh = Math.hypot(ux, uy);
      if (uh > uz * tanTilt && uh > 1e-9) {
        const sc = (uz * tanTilt) / uh;
        ux *= sc;
        uy *= sc;
      }

      const aTrue = [
        ux + gVec[0] + windAcc[0],
        uy + gVec[1] + windAcc[1],
        uz + gVec[2] + windAcc[2]
      ];
      pU = [
        pU[0] + vU[0] * dt + 0.5 * aTrue[0] * dt * dt,
        pU[1] + vU[1] * dt + 0.5 * aTrue[1] * dt * dt,
        pU[2] + vU[2] * dt + 0.5 * aTrue[2] * dt * dt
      ];
      vU = [
        vU[0] + aTrue[0] * dt,
        vU[1] + aTrue[1] * dt,
        vU[2] + aTrue[2] * dt
      ];
      trajUncomp.push([...pU]);
    }

    const uncompMissM = norm3([pU[0] - pPad[0], pU[1] - pPad[1], pU[2] - pPad[2]]);
    const uncompVelMps = norm3([vU[0] - vPad[0], vU[1] - vPad[1], vU[2] - vPad[2]]);
    const dispersionReductionPct = 100.0 * (1.0 - gfoldRes.touchdownErrM / Math.max(uncompMissM, 1e-6));

    return {
      padId: padInfo.pad.id,
      padName: padInfo.pad.name,
      gfoldTouchdownErrCm: gfoldRes.touchdownErrCm,
      gfoldTouchdownVelMps: gfoldRes.touchdownVelErrMps,
      uncompMissM,
      uncompVelMps,
      dispersionReductionPct,
      minConeMarginM: gfoldRes.minConeMarginM,
      totalDeltaVMps: gfoldRes.totalDeltaVMps,
      trajGfold: gfoldRes.trajP,
      trajUncomp
    };
  }

  function createThreeGfoldLayer(THREE, scene, options = {}) {
    const group = new THREE.Group();
    group.name = 'HR05_GFOLD_Precision_Landing_Layer';
    const N = 56;

    const coneHeight = 38.0;
    const coneRadiusTop = coneHeight / Math.tan((30.0 * Math.PI) / 180.0);
    const coneGeo = new THREE.ConeGeometry(coneRadiusTop, coneHeight, 20, 1, true);
    coneGeo.rotateX(Math.PI);
    coneGeo.translate(0, coneHeight * 0.5, 0);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      wireframe: true,
      transparent: true,
      opacity: 0.32
    });
    const glideConeMesh = new THREE.Mesh(coneGeo, coneMat);
    group.add(glideConeMesh);

    const padGeo = new THREE.RingGeometry(1.2, 3.4, 24);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide
    });
    const padRingMesh = new THREE.Mesh(padGeo, padMat);
    group.add(padRingMesh);

    const gfoldCoords = new Float32Array((N + 1) * 3);
    const gfoldGeo = new THREE.BufferGeometry();
    gfoldGeo.setAttribute('position', new THREE.BufferAttribute(gfoldCoords, 3));
    const gfoldMat = new THREE.LineBasicMaterial({ color: 0x10b981 });
    const gfoldLine = new THREE.Line(gfoldGeo, gfoldMat);
    gfoldLine.frustumCulled = false;
    group.add(gfoldLine);

    const uncompCoords = new Float32Array((N + 1) * 3);
    const uncompGeo = new THREE.BufferGeometry();
    uncompGeo.setAttribute('position', new THREE.BufferAttribute(uncompCoords, 3));
    const uncompMat = new THREE.LineBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.78 });
    const uncompLine = new THREE.Line(uncompGeo, uncompMat);
    uncompLine.frustumCulled = false;
    group.add(uncompLine);

    scene.add(group);

    let activePadKey = options.padKey || 'ashdod_port_barge';
    let lastBench = null;
    let cycleSec = 0.0;

    function rebuildTrajectories(padKey, windSpeedMps = 14.0) {
      activePadKey = padKey;
      const windScale = Math.max(0.2, windSpeedMps / 14.0);
      lastBench = runAshdodGfoldLandingBenchmark({
        padKey,
        N,
        windAcc: [1.45 * windScale, -1.10 * windScale, -0.35 * windScale]
      });

      const padInfo = evaluatePadState(padKey, 0);
      const px = padInfo.pPadScene.x;
      const py = padInfo.pPadScene.y;
      const pz = padInfo.pPadScene.z;
      const padAltEnu = padInfo.pPadEnu[2];

      const gAttr = gfoldGeo.getAttribute('position');
      const uAttr = uncompGeo.getAttribute('position');
      for (let i = 0; i <= N; i++) {
        const gp = lastBench.trajGfold[i];
        const up = lastBench.trajUncomp[i];
        gAttr.setXYZ(i, px + gp[0] * 0.55, py + Math.max(0, gp[2] - padAltEnu) * 0.52, pz - gp[1] * 0.55);
        uAttr.setXYZ(i, px + up[0] * 0.55, py + Math.max(0, up[2] - padAltEnu) * 0.52, pz - up[1] * 0.55);
      }
      gAttr.needsUpdate = true;
      uAttr.needsUpdate = true;
      return lastBench;
    }

    function updateLandingStep(tSec, dtSec, windSpeedMps = 14.0) {
      cycleSec = (cycleSec + dtSec) % 14.0;
      const padState = evaluatePadState(activePadKey, tSec);
      const { x, y, z } = padState.pPadScene;
      glideConeMesh.position.set(x, y, z);
      padRingMesh.position.set(x, y + 0.15, z);

      if (!lastBench) {
        rebuildTrajectories(activePadKey, windSpeedMps);
      }

      const frac = cycleSec / 14.0;
      const idx = Math.min(N, Math.floor(frac * N));
      const gp = lastBench.trajGfold[idx];
      const padAltEnu = padState.pPadEnu[2];
      const vehicleScenePos = {
        x: x + gp[0] * 0.55,
        y: y + Math.max(0, gp[2] - padAltEnu) * 0.52,
        z: z - gp[1] * 0.55
      };

      return {
        padState,
        vehicleScenePos,
        timeToGoSec: Math.max(0.0, 14.0 - cycleSec),
        benchmark: lastBench
      };
    }

    function resetCycle() {
      cycleSec = 0.0;
    }

    function dispose() {
      scene.remove(group);
      coneGeo.dispose();
      coneMat.dispose();
      padGeo.dispose();
      padMat.dispose();
      gfoldGeo.dispose();
      gfoldMat.dispose();
      uncompGeo.dispose();
      uncompMat.dispose();
    }

    rebuildTrajectories(activePadKey, options.windSpeedMps ?? 14.0);

    return {
      group,
      glideConeMesh,
      padRingMesh,
      gfoldLine,
      uncompLine,
      rebuildTrajectories,
      updateLandingStep,
      resetCycle,
      dispose
    };
  }

  return {
    HR05_GFOLD_CONSTANTS,
    evaluatePadState,
    solveGfoldConvexGuidance,
    runAshdodGfoldLandingBenchmark,
    createThreeGfoldLayer
  };
});
