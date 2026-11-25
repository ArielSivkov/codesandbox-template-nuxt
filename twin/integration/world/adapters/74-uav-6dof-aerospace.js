/**
 * בס"ד
 * ESH27 Twin World & Game — SpaceX / Starlink-Grade Engineering Sprint
 * Stage HR-04 (09:00): 74-uav-6dof-aerospace.js
 *
 * First-Principles 6-DOF Quaternion Rigid-Body Flight Dynamics Engine,
 * Ashdod Urban Canyon 3D Wind-Shear & Von Karman Tower Wake Vortex Field,
 * Geometric SO(3) Attitude + ES-EKF Wind-Feedforward Controller, and
 * D&A 38cc Hybrid Powerplant (PA12-CF + 1.5mm Electroformed Cu) Thermal/Power Bus.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TwinUav6DofAerospace = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HR04_6DOF_CONSTANTS = Object.freeze({
    GRAVITY_MPS2: 9.80665,
    AIR_DENSITY_SEA_LEVEL_KGM3: 1.225,
    SCALE_HEIGHT_M: 8500.0,
    UAV_MASS_KG: 6.80,
    INERTIA_DIAG_KGM2: Object.freeze([0.145, 0.162, 0.265]),
    EFFECTIVE_DRAG_AREA_M2: 0.048,
    WING_CHORD_M: 0.24,
    ABL_ALPHA_URBAN: 0.28,
    ABL_Z_REF_M: 10.0,
    COASTAL_WIND_FLOW_AZIMUTH_DEG: 110.0, // Wind from WNW (290 deg) blowing toward 110 deg ESE
    STROUHAL_NUMBER: 0.20,
    DA38CC_MAX_CONT_POWER_W: 1800.0,
    DA38CC_NOMINAL_RPM: 7200,
    DA38CC_BSFC_G_KWH: 420.0,
    DA38CC_FUEL_MASS_G: 1950.0,
    PA12CF_MAX_SAFE_TEMP_C: 110.0,
    PA12CF_ANNEAL_TEMP_C: 95.0,
    ASHDOD_TOWERS_ENU: Object.freeze([
      { id: 'Rogozin27', name: 'רוגוזין 27', x: 18.0, y: 24.0, w: 22.0, h: 52.0 },
      { id: 'HaErez4', name: 'הארז 4', x: -12.0, y: -10.0, w: 18.0, h: 30.0 },
      { id: 'KTowerA', name: 'מגדלי K', x: -85.0, y: 65.0, w: 32.0, h: 160.0 },
      { id: 'DimriTower', name: 'מגדל דמרי', x: 75.0, y: -55.0, w: 28.0, h: 142.0 }
    ])
  });

  function quatMul(q1, q2) {
    const [w1, x1, y1, z1] = q1;
    const [w2, x2, y2, z2] = q2;
    return [
      w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
      w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
      w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
      w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2
    ];
  }

  function quatNormalize(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    if (n < 1e-15) return [1, 0, 0, 0];
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  }

  function quatToRotMat(q) {
    const [w, x, y, z] = quatNormalize(q);
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
    ];
  }

  function quatToEulerDeg(q) {
    const [w, x, y, z] = quatNormalize(q);
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    const r2d = 180 / Math.PI;
    return {
      rollDeg: roll * r2d,
      pitchDeg: pitch * r2d,
      yawDeg: yaw * r2d
    };
  }

  function cross3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function norm3(a) {
    return Math.hypot(a[0], a[1], a[2]);
  }

  function evaluateAshdodWindField(posEnu, tSec, baseWindMps = 14.0) {
    const [x, y, z] = posEnu;
    const zEff = Math.max(2.0, z);
    const ablFactor = Math.pow(zEff / HR04_6DOF_CONSTANTS.ABL_Z_REF_M, HR04_6DOF_CONSTANTS.ABL_ALPHA_URBAN);
    const azRad = (HR04_6DOF_CONSTANTS.COASTAL_WIND_FLOW_AZIMUTH_DEG * Math.PI) / 180.0;

    let wx = baseWindMps * ablFactor * Math.sin(azRad);
    let wy = baseWindMps * ablFactor * Math.cos(azRad);
    let wz = 0.0;
    let tx = 0.0, ty = 0.0, tz = 0.0;
    let dominantTower = 'שכבת גבול ימית פתוחה';
    let maxInfluence = 0.0;

    for (const tw of HR04_6DOF_CONSTANTS.ASHDOD_TOWERS_ENU) {
      if (zEff <= tw.h * 1.15) {
        const dx = x - tw.x;
        const dy = y - tw.y;
        const distSq = dx * dx + dy * dy;
        const sigma = tw.w * 1.35;
        const influence = Math.exp(-distSq / (2.0 * sigma * sigma));
        if (influence > 0.01) {
          if (influence > maxInfluence) {
            maxInfluence = influence;
            dominantTower = tw.name;
          }
          const fShed = (HR04_6DOF_CONSTANTS.STROUHAL_NUMBER * Math.max(baseWindMps, 0.1)) / Math.max(tw.w, 10.0);
          const phase = 2.0 * Math.PI * fShed * tSec + (dx - dy) * 0.12;
          const shearGust = 0.42 * baseWindMps * influence * Math.sin(phase);
          const downdraft = -0.28 * baseWindMps * influence * (1.0 - zEff / (tw.h * 1.2));
          wx += shearGust * (-Math.cos(azRad));
          wy += shearGust * Math.sin(azRad);
          wz += downdraft;
          tx += 1.8 * influence * Math.sin(phase);
          ty += 1.5 * influence * Math.cos(phase * 1.1);
          tz += 0.9 * influence * Math.sin(phase * 0.7);
        }
      }
    }

    const windVec = [wx, wy, wz];
    const vortexTorque = [tx, ty, tz];
    return {
      windVec,
      windSpeedMps: norm3(windVec),
      downdraftMps: wz,
      vortexTorque,
      wakeInfluence: maxInfluence,
      dominantTower
    };
  }

  function evaluateReferenceCorridor(tSec) {
    const wPath = 0.11;
    const pRef = [
      45.0 * Math.sin(wPath * tSec),
      38.0 * Math.cos(wPath * tSec),
      42.0 + 12.0 * Math.sin(0.07 * tSec)
    ];
    const vRef = [
      45.0 * wPath * Math.cos(wPath * tSec),
      -38.0 * wPath * Math.sin(wPath * tSec),
      12.0 * 0.07 * Math.cos(0.07 * tSec)
    ];
    const aRef = [
      -45.0 * (wPath * wPath) * Math.sin(wPath * tSec),
      -38.0 * (wPath * wPath) * Math.cos(wPath * tSec),
      -12.0 * (0.07 * 0.07) * Math.sin(0.07 * tSec)
    ];
    return { pRef, vRef, aRef };
  }

  function evaluateDa38ccHybridPowerplant(thrustN, airspeedMps, soc = 0.82, dt = 0.05) {
    const hoverPowerW = 740.0 * Math.pow(Math.max(thrustN, 10.0) / (HR04_6DOF_CONSTANTS.UAV_MASS_KG * 9.80665), 1.5);
    const parasiticPowerW = 0.42 * Math.pow(Math.max(airspeedMps, 0.0), 2.4);
    const reqElectricalPowerW = Math.min(2450.0, Math.max(620.0, hoverPowerW + parasiticPowerW));

    const genPowerW = Math.min(HR04_6DOF_CONSTANTS.DA38CC_MAX_CONT_POWER_W, Math.max(950.0, reqElectricalPowerW * 1.04));
    const netBatteryPowerW = reqElectricalPowerW - genPowerW;
    const batteryCapacityWh = 333.0;
    const nextSoc = Math.max(0.15, Math.min(0.98, soc - (netBatteryPowerW * (dt / 3600.0)) / batteryCapacityWh));

    const tAmbC = 28.0;
    const loadFrac = genPowerW / 1280.0;
    const qCombWasteW = 1150.0 * (0.78 + 0.22 * loadFrac);
    const rCuAir = 0.245 / (0.88 + 0.12 * (Math.max(airspeedMps, 5.0) / 18.0));
    const zoneACuSleeveC = tAmbC + qCombWasteW * rCuAir;

    const rBaseNeck = 5.40;
    const rPtfe = 0.004 / (0.25 * 0.0018);
    const rCaseConv = 2.45;
    const qLeakW = (zoneACuSleeveC - tAmbC) / (rBaseNeck + rPtfe + rCaseConv);
    const zoneBPtfeFlangeC = zoneACuSleeveC - qLeakW * (rBaseNeck + 0.60 * rPtfe);
    const zoneCPa12cfCrankcaseC = tAmbC + qLeakW * rCaseConv;
    const zoneDAlternatorC = tAmbC + 0.55 * qLeakW * rCaseConv;

    const fuelRateGhr = (genPowerW / 1000.0) * HR04_6DOF_CONSTANTS.DA38CC_BSFC_G_KWH;
    const enduranceHours = HR04_6DOF_CONSTANTS.DA38CC_FUEL_MASS_G / Math.max(fuelRateGhr, 1.0);

    return {
      reqElectricalPowerW,
      genPowerW,
      netBatteryPowerW,
      soc: nextSoc,
      rpm: Math.round(5800 + 1400 * Math.min(1.1, genPowerW / 1800.0)),
      zoneACuSleeveC,
      zoneBPtfeFlangeC,
      zoneCPa12cfCrankcaseC,
      zoneDAlternatorC,
      pa12cfSafetyMarginC: HR04_6DOF_CONSTANTS.PA12CF_MAX_SAFE_TEMP_C - zoneCPa12cfCrankcaseC,
      fuelRateGhr,
      enduranceHours
    };
  }

  function stepUav6DofRk4(state, dt, tSec, options = {}) {
    const baseWindMps = options.baseWindMps ?? 14.0;
    const useSo3WindComp = options.useSo3WindComp ?? true;
    const m = HR04_6DOF_CONSTANTS.UAV_MASS_KG;
    const gVec = [0.0, 0.0, -HR04_6DOF_CONSTANTS.GRAVITY_MPS2];
    const [Jxx, Jyy, Jzz] = HR04_6DOF_CONSTANTS.INERTIA_DIAG_KGM2;

    const { pRef, vRef, aRef } = evaluateReferenceCorridor(tSec);
    const windInfo = evaluateAshdodWindField(state.p, tSec, baseWindMps);
    const windVec = windInfo.windVec;
    const vortexTau = windInfo.vortexTorque;

    function evaluateDerivatives(p, v, q, omega) {
      const R = quatToRotMat(q);
      const vRel = [v[0] - windVec[0], v[1] - windVec[1], v[2] - windVec[2]];
      const speedRel = norm3(vRel);
      const rho = HR04_6DOF_CONSTANTS.AIR_DENSITY_SEA_LEVEL_KGM3 * Math.exp(-Math.max(0.0, p[2]) / HR04_6DOF_CONSTANTS.SCALE_HEIGHT_M);
      const CdS = HR04_6DOF_CONSTANTS.EFFECTIVE_DRAG_AREA_M2;
      const fAeroEnu = [
        -0.5 * rho * CdS * speedRel * vRel[0],
        -0.5 * rho * CdS * speedRel * vRel[1],
        -0.5 * rho * CdS * speedRel * vRel[2]
      ];

      const ep = [pRef[0] - p[0], pRef[1] - p[1], pRef[2] - p[2]];
      const ev = [vRef[0] - v[0], vRef[1] - v[1], vRef[2] - v[2]];

      let fDesEnu;
      if (useSo3WindComp) {
        const kp = 6.8, kd = 4.4;
        fDesEnu = [
          m * (aRef[0] + kp * ep[0] + kd * ev[0] - gVec[0]) - 0.94 * fAeroEnu[0],
          m * (aRef[1] + kp * ep[1] + kd * ev[1] - gVec[1]) - 0.94 * fAeroEnu[1],
          m * (aRef[2] + kp * ep[2] + kd * ev[2] - gVec[2]) - 0.94 * fAeroEnu[2]
        ];
      } else {
        const kp = 1.6, kd = 2.4;
        fDesEnu = [
          m * (aRef[0] + kp * ep[0] + kd * ev[0] - gVec[0]),
          m * (aRef[1] + kp * ep[1] + kd * ev[1] - gVec[1]),
          m * (aRef[2] + kp * ep[2] + kd * ev[2] - gVec[2])
        ];
      }

      const normF = Math.max(norm3(fDesEnu), 1e-6);
      const b3Des = [fDesEnu[0] / normF, fDesEnu[1] / normF, fDesEnu[2] / normF];
      const yawDes = Math.atan2(vRef[0], vRef[1]);
      const b1c = [Math.sin(yawDes), Math.cos(yawDes), 0.0];
      let b2Des = cross3(b3Des, b1c);
      const normB2 = Math.max(norm3(b2Des), 1e-6);
      b2Des = [b2Des[0] / normB2, b2Des[1] / normB2, b2Des[2] / normB2];
      const b1Des = cross3(b2Des, b3Des);
      const Rdes = [
        [b1Des[0], b2Des[0], b3Des[0]],
        [b1Des[1], b2Des[1], b3Des[1]],
        [b1Des[2], b2Des[2], b3Des[2]]
      ];

      const M = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          M[i][j] = Rdes[0][i] * R[0][j] + Rdes[1][i] * R[1][j] + Rdes[2][i] * R[2][j];
        }
      }
      const eR = [
        0.5 * (M[2][1] - M[1][2]),
        0.5 * (M[0][2] - M[2][0]),
        0.5 * (M[1][0] - M[0][1])
      ];
      const Jomega = [Jxx * omega[0], Jyy * omega[1], Jzz * omega[2]];
      const gyroCross = cross3(omega, Jomega);

      let tauCtrl;
      if (useSo3WindComp) {
        const kR = 3.2, kW = 0.85;
        tauCtrl = [
          -kR * eR[0] - kW * omega[0] + gyroCross[0] - 0.88 * vortexTau[0],
          -kR * eR[1] - kW * omega[1] + gyroCross[1] - 0.88 * vortexTau[1],
          -kR * eR[2] - kW * omega[2] + gyroCross[2] - 0.88 * vortexTau[2]
        ];
      } else {
        const kR = 2.0, kW = 0.65;
        tauCtrl = [
          -kR * eR[0] - kW * omega[0],
          -kR * eR[1] - kW * omega[1],
          -kR * eR[2] - kW * omega[2]
        ];
      }

      const b3Curr = [R[0][2], R[1][2], R[2][2]];
      const thrustMag = Math.max(0.0, Math.min(m * 26.0, dot3(fDesEnu, b3Curr)));
      const fThrustEnu = [thrustMag * b3Curr[0], thrustMag * b3Curr[1], thrustMag * b3Curr[2]];

      const dp = [v[0], v[1], v[2]];
      const dv = [
        (fThrustEnu[0] + fAeroEnu[0]) / m + gVec[0],
        (fThrustEnu[1] + fAeroEnu[1]) / m + gVec[1],
        (fThrustEnu[2] + fAeroEnu[2]) / m + gVec[2]
      ];
      const dqRaw = quatMul(q, [0.0, omega[0], omega[1], omega[2]]);
      const dq = [0.5 * dqRaw[0], 0.5 * dqRaw[1], 0.5 * dqRaw[2], 0.5 * dqRaw[3]];
      const domega = [
        (tauCtrl[0] + vortexTau[0] - gyroCross[0]) / Jxx,
        (tauCtrl[1] + vortexTau[1] - gyroCross[1]) / Jyy,
        (tauCtrl[2] + vortexTau[2] - gyroCross[2]) / Jzz
      ];

      return { dp, dv, dq, domega, thrustMag, speedRel, attErrRad: norm3(eR) };
    }

    const p0 = state.p;
    const v0 = state.v;
    const q0 = state.q;
    const w0 = state.omega;

    const k1 = evaluateDerivatives(p0, v0, q0, w0);
    const k2 = evaluateDerivatives(
      [p0[0] + 0.5 * dt * k1.dp[0], p0[1] + 0.5 * dt * k1.dp[1], p0[2] + 0.5 * dt * k1.dp[2]],
      [v0[0] + 0.5 * dt * k1.dv[0], v0[1] + 0.5 * dt * k1.dv[1], v0[2] + 0.5 * dt * k1.dv[2]],
      [q0[0] + 0.5 * dt * k1.dq[0], q0[1] + 0.5 * dt * k1.dq[1], q0[2] + 0.5 * dt * k1.dq[2], q0[3] + 0.5 * dt * k1.dq[3]],
      [w0[0] + 0.5 * dt * k1.domega[0], w0[1] + 0.5 * dt * k1.domega[1], w0[2] + 0.5 * dt * k1.domega[2]]
    );
    const k3 = evaluateDerivatives(
      [p0[0] + 0.5 * dt * k2.dp[0], p0[1] + 0.5 * dt * k2.dp[1], p0[2] + 0.5 * dt * k2.dp[2]],
      [v0[0] + 0.5 * dt * k2.dv[0], v0[1] + 0.5 * dt * k2.dv[1], v0[2] + 0.5 * dt * k2.dv[2]],
      [q0[0] + 0.5 * dt * k2.dq[0], q0[1] + 0.5 * dt * k2.dq[1], q0[2] + 0.5 * dt * k2.dq[2], q0[3] + 0.5 * dt * k2.dq[3]],
      [w0[0] + 0.5 * dt * k2.domega[0], w0[1] + 0.5 * dt * k2.domega[1], w0[2] + 0.5 * dt * k2.domega[2]]
    );
    const k4 = evaluateDerivatives(
      [p0[0] + dt * k3.dp[0], p0[1] + dt * k3.dp[1], p0[2] + dt * k3.dp[2]],
      [v0[0] + dt * k3.dv[0], v0[1] + dt * k3.dv[1], v0[2] + dt * k3.dv[2]],
      [q0[0] + dt * k3.dq[0], q0[1] + dt * k3.dq[1], q0[2] + dt * k3.dq[2], q0[3] + dt * k3.dq[3]],
      [w0[0] + dt * k3.domega[0], w0[1] + dt * k3.domega[1], w0[2] + dt * k3.domega[2]]
    );

    const pNext = [
      p0[0] + (dt / 6.0) * (k1.dp[0] + 2 * k2.dp[0] + 2 * k3.dp[0] + k4.dp[0]),
      p0[1] + (dt / 6.0) * (k1.dp[1] + 2 * k2.dp[1] + 2 * k3.dp[1] + k4.dp[1]),
      p0[2] + (dt / 6.0) * (k1.dp[2] + 2 * k2.dp[2] + 2 * k3.dp[2] + k4.dp[2])
    ];
    const vNext = [
      v0[0] + (dt / 6.0) * (k1.dv[0] + 2 * k2.dv[0] + 2 * k3.dv[0] + k4.dv[0]),
      v0[1] + (dt / 6.0) * (k1.dv[1] + 2 * k2.dv[1] + 2 * k3.dv[1] + k4.dv[1]),
      v0[2] + (dt / 6.0) * (k1.dv[2] + 2 * k2.dv[2] + 2 * k3.dv[2] + k4.dv[2])
    ];
    const qNext = quatNormalize([
      q0[0] + (dt / 6.0) * (k1.dq[0] + 2 * k2.dq[0] + 2 * k3.dq[0] + k4.dq[0]),
      q0[1] + (dt / 6.0) * (k1.dq[1] + 2 * k2.dq[1] + 2 * k3.dq[1] + k4.dq[1]),
      q0[2] + (dt / 6.0) * (k1.dq[2] + 2 * k2.dq[2] + 2 * k3.dq[2] + k4.dq[2]),
      q0[3] + (dt / 6.0) * (k1.dq[3] + 2 * k2.dq[3] + 2 * k3.dq[3] + k4.dq[3])
    ]);
    const wNext = [
      w0[0] + (dt / 6.0) * (k1.domega[0] + 2 * k2.domega[0] + 2 * k3.domega[0] + k4.domega[0]),
      w0[1] + (dt / 6.0) * (k1.domega[1] + 2 * k2.domega[1] + 2 * k3.domega[1] + k4.domega[1]),
      w0[2] + (dt / 6.0) * (k1.domega[2] + 2 * k2.domega[2] + 2 * k3.domega[2] + k4.domega[2])
    ];

    const posErrM = norm3([pNext[0] - pRef[0], pNext[1] - pRef[1], pNext[2] - pRef[2]]);
    const hybridTelemetry = evaluateDa38ccHybridPowerplant(k1.thrustMag, k1.speedRel, state.soc ?? 0.82, dt);

    return {
      p: pNext,
      v: vNext,
      q: qNext,
      omega: wNext,
      soc: hybridTelemetry.soc,
      pRef,
      vRef,
      posErrM,
      attErrDeg: (k1.attErrRad * 180.0) / Math.PI,
      eulerDeg: quatToEulerDeg(qNext),
      thrustN: k1.thrustMag,
      airspeedMps: k1.speedRel,
      windInfo,
      hybridTelemetry
    };
  }

  function runAshdod6DofWindBenchmark(options = {}) {
    const dt = options.dt ?? 0.05;
    const steps = options.steps ?? 1200;
    const baseWindMps = options.baseWindMps ?? 14.0;

    let stSo3 = {
      p: [0.0, 38.0, 42.0],
      v: [4.95, 0.0, 0.84],
      q: [1.0, 0.0, 0.0, 0.0],
      omega: [0.0, 0.0, 0.0],
      soc: 0.82
    };
    let stNaive = {
      p: [0.0, 38.0, 42.0],
      v: [4.95, 0.0, 0.84],
      q: [1.0, 0.0, 0.0, 0.0],
      omega: [0.0, 0.0, 0.0],
      soc: 0.82
    };

    let sumSqSo3 = 0.0;
    let sumSqNaive = 0.0;
    let peakWindMps = 0.0;
    let maxQuatNormDrift = 0.0;
    const trailRef = [];
    const trailSo3 = [];
    const trailNaive = [];

    for (let k = 0; k < steps; k++) {
      const t = k * dt;
      stSo3 = stepUav6DofRk4(stSo3, dt, t, { baseWindMps, useSo3WindComp: true });
      stNaive = stepUav6DofRk4(stNaive, dt, t, { baseWindMps, useSo3WindComp: false });

      sumSqSo3 += stSo3.posErrM * stSo3.posErrM;
      sumSqNaive += stNaive.posErrM * stNaive.posErrM;
      if (stSo3.windInfo.windSpeedMps > peakWindMps) {
        peakWindMps = stSo3.windInfo.windSpeedMps;
      }
      const qDrift = Math.abs(Math.hypot(...stSo3.q) - 1.0);
      if (qDrift > maxQuatNormDrift) maxQuatNormDrift = qDrift;

      if (k % 6 === 0) {
        trailRef.push([...stSo3.pRef]);
        trailSo3.push([...stSo3.p]);
        trailNaive.push([...stNaive.p]);
      }
    }

    const rmseSo3M = Math.sqrt(sumSqSo3 / steps);
    const rmseNaiveM = Math.sqrt(sumSqNaive / steps);
    const errorReductionPct = 100.0 * (1.0 - rmseSo3M / Math.max(rmseNaiveM, 1e-6));

    return {
      steps,
      dt,
      baseWindMps,
      rmseSo3M,
      rmseNaiveM,
      errorReductionPct,
      peakWindMps,
      maxQuatNormDrift,
      finalHybridTelemetry: stSo3.hybridTelemetry,
      trailRef,
      trailSo3,
      trailNaive
    };
  }

  function createThreeUav6DofLayer(THREE, options = {}) {
    const group = new THREE.Group();
    group.name = 'HR04_UAV_6DOF_Aerospace_Layer';

    const uavGeom = new THREE.ConeGeometry(1.8, 5.2, 6);
    uavGeom.rotateX(Math.PI / 2);
    const uavMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.7
    });
    const uavMesh = new THREE.Mesh(uavGeom, uavMat);
    uavMesh.position.set(0, 42, -38);
    group.add(uavMesh);

    const windSegmentsCount = 36;
    const windPositions = new Float32Array(windSegmentsCount * 2 * 3);
    const windColors = new Float32Array(windSegmentsCount * 2 * 3);
    const windGeom = new THREE.BufferGeometry();
    windGeom.setAttribute('position', new THREE.BufferAttribute(windPositions, 3));
    windGeom.setAttribute('color', new THREE.BufferAttribute(windColors, 3));
    const windMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75
    });
    const windLines = new THREE.LineSegments(windGeom, windMat);
    group.add(windLines);

    function updateWindVectors(tSec, baseWindMps = 14.0) {
      const posAttr = windGeom.getAttribute('position');
      const colAttr = windGeom.getAttribute('color');
      let idx = 0;
      for (let gx = -3; gx <= 2; gx++) {
        for (let gy = -3; gy <= 2; gy++) {
          const px = gx * 28.0 + 14.0;
          const py = gy * 26.0 + 13.0;
          const pz = 26.0 + ((gx + gy + 6) % 3) * 16.0;
          const wInfo = evaluateAshdodWindField([px, py, pz], tSec, baseWindMps);
          const [wx, wy, wz] = wInfo.windVec;

          const x0 = px, y0 = pz, z0 = -py;
          const x1 = x0 + wx * 0.75;
          const y1 = y0 + wz * 1.4;
          const z1 = z0 - wy * 0.75;

          posAttr.setXYZ(idx, x0, y0, z0);
          posAttr.setXYZ(idx + 1, x1, y1, z1);

          const wake = Math.min(1.0, wInfo.wakeInfluence * 1.6);
          const r = 0.2 + 0.8 * wake;
          const g = 0.75 - 0.35 * wake;
          const b = 0.95 - 0.75 * wake;
          colAttr.setXYZ(idx, r, g, b);
          colAttr.setXYZ(idx + 1, r, g, b);
          idx += 2;
        }
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

    function updateUavPose(state6Dof) {
      const [e, n, u] = state6Dof.p;
      uavMesh.position.set(e, u, -n);
      const [qw, qx, qy, qz] = state6Dof.q;
      uavMesh.quaternion.set(qx, qz, -qy, qw).normalize();
    }

    function dispose() {
      uavGeom.dispose();
      uavMat.dispose();
      windGeom.dispose();
      windMat.dispose();
    }

    updateWindVectors(0, options.baseWindMps ?? 14.0);

    return {
      group,
      uavMesh,
      windLines,
      updateWindVectors,
      updateUavPose,
      dispose
    };
  }

  return {
    HR04_6DOF_CONSTANTS,
    quatMul,
    quatNormalize,
    quatToRotMat,
    quatToEulerDeg,
    evaluateAshdodWindField,
    evaluateReferenceCorridor,
    evaluateDa38ccHybridPowerplant,
    stepUav6DofRk4,
    runAshdod6DofWindBenchmark,
    createThreeUav6DofLayer
  };
});
