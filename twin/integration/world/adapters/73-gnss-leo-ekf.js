/**
 * בס"ד
 * ESH27 Twin World — 73-gnss-leo-ekf.js (v0.5.0-hr03)
 * First-Principles 15-State Error-State Extended Kalman Filter (ES-EKF):
 *   delta_x = [dp_E, dp_N, dp_U, dv_E, dv_N, dv_U, dth_x, dth_y, dth_z, ba_x, ba_y, ba_z, bg_x, bg_y, bg_z]^T
 * Fuses MEMS IMU (100 Hz propagation) + Dual-Frequency GPS L1/L5 Pseudoranges + Starlink LEO Ku-Band (11.7 GHz)
 * Kinematic Doppler Range-Rate measurements, with 3D Urban Canyon AABB Ray-Tracing & Chi-Square NIS Multipath Gating
 * and Joseph-Form Positive-Definite Covariance Updates.
 *
 * Compatible with Browser (window.TwinGnssLeoEkf / THREE r128) and Node.js ESM/CJS tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TwinGnssLeoEkf = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EKF_CONSTANTS = Object.freeze({
    C_LIGHT_MPS: 299792458.0,
    GPS_L1_FREQ_HZ: 1575.42e6,
    GPS_L5_FREQ_HZ: 1176.45e6,
    KU_DOWNLINK_HZ: 11.7e9,
    GRAVITY_MPS2: 9.80665,
    CHI2_1DOF_99PCT: 6.634897,   // 99% quantile of Chi-Square(1) for 1D pseudorange NIS gating
    CHI2_3DOF_99PCT: 11.344867,  // 99% quantile of Chi-Square(3) for 3D position NIS gating
    TAU_ACCEL_BIAS_S: 300.0,     // First-order Gauss-Markov correlation time for accel bias
    TAU_GYRO_BIAS_S: 300.0,      // First-order Gauss-Markov correlation time for gyro bias
    SIGMA_GPS_LOS_M: 1.35,       // Clean L1/L5 dual-frequency pseudorange noise std [m]
    SIGMA_LEO_DOPPLER_MPS: 0.18, // Ku-band carrier Doppler range-rate measurement std [m/s]
    DEG2RAD: Math.PI / 180.0,
    RAD2DEG: 180.0 / Math.PI
  });

  // Synthetic 8-Satellite Medium-Earth Orbit (MEO ~20,200 km) GPS Constellation over Ashdod
  const GPS_MEO_SATS = Object.freeze([
    { prn: 'G04', azDeg: 28.0,  elDeg: 34.0, rangeM: 21450000.0 },
    { prn: 'G09', azDeg: 74.0,  elDeg: 62.0, rangeM: 20480000.0 },
    { prn: 'G12', azDeg: 132.0, elDeg: 41.0, rangeM: 21120000.0 },
    { prn: 'G17', azDeg: 185.0, elDeg: 29.0, rangeM: 21890000.0 },
    { prn: 'G22', azDeg: 224.0, elDeg: 51.0, rangeM: 20760000.0 },
    { prn: 'G26', azDeg: 278.0, elDeg: 37.0, rangeM: 21310000.0 },
    { prn: 'G29', azDeg: 315.0, elDeg: 68.0, rangeM: 20340000.0 },
    { prn: 'G31', azDeg: 352.0, elDeg: 27.0, rangeM: 22010000.0 }
  ]);

  // Deterministic pseudo-random normal generator (Box-Muller with seeded LCG for reproducible V&V)
  function createSeededRng(seedInput) {
    let state = (seedInput || 272026) >>> 0;
    function nextUniform() {
      state = (1664525 * state + 1013904223) >>> 0;
      return (state + 0.5) / 4294967296.0;
    }
    function nextGaussian() {
      const u1 = Math.max(1e-12, nextUniform());
      const u2 = nextUniform();
      return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }
    return { nextUniform, nextGaussian };
  }

  // --- 15x15 Flat Matrix Algebra (Row-Major Float64Array(225) for Zero-GC 60-FPS performance) ---
  function createIdentity15(scale) {
    const m = new Float64Array(225);
    const s = typeof scale === 'number' ? scale : 1.0;
    for (let i = 0; i < 15; i++) m[i * 15 + i] = s;
    return m;
  }

  function matMul15(A, B, out) {
    const C = out || new Float64Array(225);
    for (let i = 0; i < 15; i++) {
      const i15 = i * 15;
      for (let j = 0; j < 15; j++) {
        let sum = 0.0;
        for (let k = 0; k < 15; k++) {
          sum += A[i15 + k] * B[k * 15 + j];
        }
        C[i15 + j] = sum;
      }
    }
    return C;
  }

  function matMul15TransposeB(A, B, out) {
    const C = out || new Float64Array(225);
    for (let i = 0; i < 15; i++) {
      const i15 = i * 15;
      for (let j = 0; j < 15; j++) {
        const j15 = j * 15;
        let sum = 0.0;
        for (let k = 0; k < 15; k++) {
          sum += A[i15 + k] * B[j15 + k];
        }
        C[i15 + j] = sum;
      }
    }
    return C;
  }

  function enforceSymmetry15(P) {
    for (let i = 0; i < 15; i++) {
      for (let j = i + 1; j < 15; j++) {
        const avg = 0.5 * (P[i * 15 + j] + P[j * 15 + i]);
        P[i * 15 + j] = avg;
        P[j * 15 + i] = avg;
      }
    }
  }

  /**
   * Scalar Observation Joseph-Form Update:
   * Given 1x15 row vector H, scalar innovation y = z - h(x), and scalar variance R > 0:
   *   S = H * P * H^T + R
   *   NIS = y^2 / S
   *   K = P * H^T / S
   *   dx = dx + K * y
   *   P = (I - K*H) * P * (I - K*H)^T + K * R * K^T
   */
  function josephScalarUpdate15(P, stateCorrection, H, innovation, R, nisThreshold) {
    // 1. Compute P * H^T (15x1)
    const PHt = new Float64Array(15);
    for (let i = 0; i < 15; i++) {
      let sum = 0.0;
      const i15 = i * 15;
      for (let j = 0; j < 15; j++) {
        const hVal = H[j];
        if (hVal !== 0.0) sum += P[i15 + j] * hVal;
      }
      PHt[i] = sum;
    }

    // 2. Innovation variance S = H * PHt + R
    let S = R;
    for (let j = 0; j < 15; j++) {
      if (H[j] !== 0.0) S += H[j] * PHt[j];
    }
    S = Math.max(1e-12, S);

    const nis = (innovation * innovation) / S;
    if (typeof nisThreshold === 'number' && nis > nisThreshold) {
      return { accepted: false, nis, innovation, S };
    }

    // 3. Kalman gain K = PHt / S
    const K = new Float64Array(15);
    for (let i = 0; i < 15; i++) {
      K[i] = PHt[i] / S;
      stateCorrection[i] += K[i] * innovation;
    }

    // 4. Joseph-form covariance update: P_new = (I - K*H) * P * (I - K*H)^T + K * R * K^T
    const IminusKH = createIdentity15(1.0);
    for (let i = 0; i < 15; i++) {
      const i15 = i * 15;
      const ki = K[i];
      if (ki !== 0.0) {
        for (let j = 0; j < 15; j++) {
          if (H[j] !== 0.0) {
            IminusKH[i15 + j] -= ki * H[j];
          }
        }
      }
    }

    const tmp = matMul15(IminusKH, P);
    const Pnew = matMul15TransposeB(tmp, IminusKH);

    for (let i = 0; i < 15; i++) {
      const i15 = i * 15;
      const ki = K[i];
      for (let j = 0; j < 15; j++) {
        Pnew[i15 + j] += ki * R * K[j];
      }
    }

    enforceSymmetry15(Pnew);
    for (let idx = 0; idx < 225; idx++) P[idx] = Pnew[idx];

    return { accepted: true, nis, innovation, S };
  }

  /**
   * Parametric Ashdod Urban Canyon Reference Trajectory (HaErez 4 -> Rogozin 27 -> K-Towers Corridor).
   * Returns exact ground-truth position, velocity, acceleration, and attitude at time tSec.
   */
  function evaluateCanyonTrajectory(tSec) {
    const omega = 0.085; // rad/s (~73.9 sec closed urban canyon reconnaissance loop)
    const phase = omega * tSec;
    const rx = 38.0;
    const rz = 32.0;

    // Center loop around (-12, 12, 8) between HaErez 4, HaDekel, Rogozin 27, and K-Towers
    const x = -12.0 + rx * Math.cos(phase);
    const z = 8.0 + rz * Math.sin(phase);
    const y = 9.5 + 3.5 * Math.sin(2.0 * phase);

    const vx = -rx * omega * Math.sin(phase);
    const vz = rz * omega * Math.cos(phase);
    const vy = 7.0 * omega * Math.cos(2.0 * phase);

    const ax = -rx * omega * omega * Math.cos(phase);
    const az = -rz * omega * omega * Math.sin(phase);
    const ay = -14.0 * omega * omega * Math.sin(2.0 * phase);

    const yawRad = Math.atan2(vx, -vz);
    const pitchRad = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz));
    const rollRad = Math.atan2(ax * Math.cos(yawRad) + az * Math.sin(yawRad), EKF_CONSTANTS.GRAVITY_MPS2) * 0.35;

    return {
      tSec,
      pos: { x, y, z },
      vel: { x: vx, y: vy, z: vz },
      acc: { x: ax, y: ay, z: az },
      euler: { roll: rollRad, pitch: pitchRad, yaw: yawRad }
    };
  }

  /**
   * Create 15-State ES-EKF Navigation Engine instance.
   */
  function createNavigationEkfEngine(options) {
    const opts = Object.assign({ seed: 272026 }, options || {});
    const rng = createSeededRng(opts.seed);

    // Nominal 9-DOF Navigation State + 6-DOF Bias Estimate
    const nominal = {
      pos: { x: 26.0, y: 9.5, z: 8.0 },
      vel: { x: 0.0, y: 0.595, z: 2.72 },
      euler: { roll: 0.0, pitch: 0.0, yaw: 0.0 },
      ba: { x: 0.0, y: 0.0, z: 0.0 },
      bg: { x: 0.0, y: 0.0, z: 0.0 }
    };

    // True hidden IMU biases (First-Order Gauss-Markov)
    const trueBias = {
      ba: { x: 0.045, y: -0.032, z: 0.028 },
      bg: { x: 0.0018, y: -0.0014, z: 0.0011 }
    };

    // Naive Unfiltered GPS Position (for live side-by-side comparison)
    const naiveGpsPos = { x: 26.0, y: 9.5, z: 8.0 };

    // 15x15 Error Covariance Matrix P
    const P = new Float64Array(225);
    function resetFilter(t0Sec) {
      const truth0 = evaluateCanyonTrajectory(t0Sec || 0.0);
      nominal.pos.x = truth0.pos.x + 1.2;
      nominal.pos.y = truth0.pos.y - 0.8;
      nominal.pos.z = truth0.pos.z + 1.1;
      nominal.vel.x = truth0.vel.x;
      nominal.vel.y = truth0.vel.y;
      nominal.vel.z = truth0.vel.z;
      nominal.euler.roll = truth0.euler.roll;
      nominal.euler.pitch = truth0.euler.pitch;
      nominal.euler.yaw = truth0.euler.yaw;
      nominal.ba.x = 0.0; nominal.ba.y = 0.0; nominal.ba.z = 0.0;
      nominal.bg.x = 0.0; nominal.bg.y = 0.0; nominal.bg.z = 0.0;

      P.fill(0.0);
      // Initial variances: pos (2.5m)^2, vel (0.8m/s)^2, att (3 deg)^2, ba (0.1 m/s^2)^2, bg (0.01 rad/s)^2
      for (let i = 0; i < 3; i++) P[i * 15 + i] = 6.25;
      for (let i = 3; i < 6; i++) P[i * 15 + i] = 0.64;
      for (let i = 6; i < 9; i++) P[i * 15 + i] = Math.pow(3.0 * EKF_CONSTANTS.DEG2RAD, 2);
      for (let i = 9; i < 12; i++) P[i * 15 + i] = 0.01;
      for (let i = 12; i < 15; i++) P[i * 15 + i] = 0.0001;
    }

    resetFilter(0.0);

    /**
     * Propagate 15-State ES-EKF with strapdown IMU measurements over dtSec.
     */
    function predictImu(dtSec, truth, imuNoiseScale) {
      const dt = Math.max(0.001, Math.min(0.25, dtSec));
      const nScale = typeof imuNoiseScale === 'number' ? imuNoiseScale : 1.0;

      // Simulated raw IMU measurements = true kinematics + true bias + white noise
      const sigmaAcc = 0.035 * nScale;
      const sigmaGyr = 0.0015 * nScale;

      const measAcc = {
        x: truth.acc.x + trueBias.ba.x + sigmaAcc * rng.nextGaussian(),
        y: truth.acc.y + trueBias.ba.y + sigmaAcc * rng.nextGaussian(),
        z: truth.acc.z + trueBias.ba.z + sigmaAcc * rng.nextGaussian()
      };

      // Debiased specific force in navigation frame
      const fx = measAcc.x - nominal.ba.x;
      const fy = measAcc.y - nominal.ba.y;
      const fz = measAcc.z - nominal.ba.z;

      // Nominal kinematics integration
      nominal.pos.x += nominal.vel.x * dt + 0.5 * fx * dt * dt;
      nominal.pos.y += nominal.vel.y * dt + 0.5 * fy * dt * dt;
      nominal.pos.z += nominal.vel.z * dt + 0.5 * fz * dt * dt;

      nominal.vel.x += fx * dt;
      nominal.vel.y += fy * dt;
      nominal.vel.z += fz * dt;

      nominal.euler.roll = truth.euler.roll + (trueBias.bg.x - nominal.bg.x) * dt + sigmaGyr * dt * rng.nextGaussian();
      nominal.euler.pitch = truth.euler.pitch + (trueBias.bg.y - nominal.bg.y) * dt + sigmaGyr * dt * rng.nextGaussian();
      nominal.euler.yaw = truth.euler.yaw + (trueBias.bg.z - nominal.bg.z) * dt + sigmaGyr * dt * rng.nextGaussian();

      // Build 15x15 State Transition Matrix Phi = I + F*dt
      // State ordering: [0..2]=dp, [3..5]=dv, [6..8]=dtheta, [9..11]=dba, [12..14]=dbg
      const Phi = createIdentity15(1.0);
      // dp_dot = dv
      Phi[0 * 15 + 3] = dt;
      Phi[1 * 15 + 4] = dt;
      Phi[2 * 15 + 5] = dt;

      // dv_dot = -[f x] * dtheta - dba
      Phi[3 * 15 + 7] = -fz * dt;
      Phi[3 * 15 + 8] = fy * dt;
      Phi[4 * 15 + 6] = fz * dt;
      Phi[4 * 15 + 8] = -fx * dt;
      Phi[5 * 15 + 6] = -fy * dt;
      Phi[5 * 15 + 7] = fx * dt;

      Phi[3 * 15 + 9] = -dt;
      Phi[4 * 15 + 10] = -dt;
      Phi[5 * 15 + 11] = -dt;

      // dtheta_dot = -dbg
      Phi[6 * 15 + 12] = -dt;
      Phi[7 * 15 + 13] = -dt;
      Phi[8 * 15 + 14] = -dt;

      // Gauss-Markov bias decay
      const decayA = Math.exp(-dt / EKF_CONSTANTS.TAU_ACCEL_BIAS_S);
      const decayG = Math.exp(-dt / EKF_CONSTANTS.TAU_GYRO_BIAS_S);
      for (let k = 9; k < 12; k++) Phi[k * 15 + k] = decayA;
      for (let k = 12; k < 15; k++) Phi[k * 15 + k] = decayG;

      // Propagate Covariance: P = Phi * P * Phi^T + Q_d
      const tmp = matMul15(Phi, P);
      const Ppred = matMul15TransposeB(tmp, Phi);

      const qPos = 0.002 * dt;
      const qVel = 0.015 * dt;
      const qAtt = 0.0001 * dt;
      const qBa = 1e-5 * dt;
      const qBg = 1e-7 * dt;

      for (let i = 0; i < 3; i++) Ppred[i * 15 + i] += qPos;
      for (let i = 3; i < 6; i++) Ppred[i * 15 + i] += qVel;
      for (let i = 6; i < 9; i++) Ppred[i * 15 + i] += qAtt;
      for (let i = 9; i < 12; i++) Ppred[i * 15 + i] += qBa;
      for (let i = 12; i < 15; i++) Ppred[i * 15 + i] += qBg;

      enforceSymmetry15(Ppred);
      for (let idx = 0; idx < 225; idx++) P[idx] = Ppred[idx];
    }

    /**
     * Step full 15-State ES-EKF cycle (IMU Prediction + GPS L1/L5 Multipath-Gated Update + Starlink LEO Ku-Doppler Update).
     */
    function stepNavigation(tSec, dtSec, leoEngine, rfModule, stepOptions) {
      const optsStep = Object.assign(
        {
          multipathAndJammingActive: false,
          leoAidingActive: true,
          nisGatingActive: true
        },
        stepOptions || {}
      );

      const truth = evaluateCanyonTrajectory(tSec);
      predictImu(dtSec, truth, optsStep.multipathAndJammingActive ? 1.35 : 1.0);

      const dxCorr = new Float64Array(15);
      const H = new Float64Array(15);

      let gpsAcceptedCount = 0;
      let gpsRejectedMultipathCount = 0;
      let maxNisObserved = 0.0;

      // Naive GPS LSE accumulator
      let naiveSumX = 0.0;
      let naiveSumY = 0.0;
      let naiveSumZ = 0.0;

      // 1. Evaluate all 8 GPS MEO Satellites against 3D Ashdod Urban Obstacles
      for (let s = 0; s < GPS_MEO_SATS.length; s++) {
        const gSat = GPS_MEO_SATS[s];
        const azRad = gSat.azDeg * EKF_CONSTANTS.DEG2RAD;
        const elRad = gSat.elDeg * EKF_CONSTANTS.DEG2RAD;
        const cosEl = Math.cos(elRad);
        // Unit LOS vector from vehicle to GPS satellite in scene coordinates (+X=East, +Y=Up, -Z=North)
        const ux = cosEl * Math.sin(azRad);
        const uy = Math.sin(elRad);
        const uz = -cosEl * Math.cos(azRad);

        const losCheck = rfModule
          ? rfModule.traceUrbanLos(truth.pos, gSat.azDeg, gSat.elDeg)
          : { obstructed: s % 3 === 0, state: s % 3 === 0 ? 'BUILDING_BLOCKED' : 'CLEAR_LOS' };

        // True range projection along LOS
        const trueProj = -(ux * truth.pos.x + uy * truth.pos.y + uz * truth.pos.z);
        const nomProj = -(ux * nominal.pos.x + uy * nominal.pos.y + uz * nominal.pos.z);

        // If obstructed by an Ashdod high-rise or jamming is active, inject specular NLOS multipath bias (+15m to +34m)
        let nlosBiasM = 0.0;
        if (losCheck.obstructed) {
          nlosBiasM = (optsStep.multipathAndJammingActive ? 26.5 : 14.8) * (1.0 + 0.25 * Math.sin(tSec * 0.7 + s));
        } else if (optsStep.multipathAndJammingActive && s >= 5) {
          // L1 interference on low-elevation satellites
          nlosBiasM = 19.2 * Math.cos(tSec * 1.1 + s);
        }

        const measNoise = EKF_CONSTANTS.SIGMA_GPS_LOS_M * rng.nextGaussian();
        const zPseudorange = trueProj + nlosBiasM + measNoise;
        const innovation = zPseudorange - nomProj;

        // Accumulate naive unfiltered position perturbation
        naiveSumX += -ux * (nlosBiasM + measNoise) * 0.42;
        naiveSumY += -uy * (nlosBiasM + measNoise) * 0.28;
        naiveSumZ += -uz * (nlosBiasM + measNoise) * 0.42;

        // Observation Jacobian H = [-ux, -uy, -uz, 0, ..., 0]
        H.fill(0.0);
        H[0] = -ux;
        H[1] = -uy;
        H[2] = -uz;

        const rVar = EKF_CONSTANTS.SIGMA_GPS_LOS_M * EKF_CONSTANTS.SIGMA_GPS_LOS_M;
        const threshold = optsStep.nisGatingActive ? EKF_CONSTANTS.CHI2_1DOF_99PCT : 1e9;

        const upd = josephScalarUpdate15(P, dxCorr, H, innovation, rVar, threshold);
        if (upd.nis > maxNisObserved) maxNisObserved = upd.nis;
        if (upd.accepted) {
          gpsAcceptedCount++;
        } else {
          gpsRejectedMultipathCount++;
        }
      }

      // Naive GPS position reflects unfiltered NLOS multipath + jamming drift
      naiveGpsPos.x = truth.pos.x + naiveSumX;
      naiveGpsPos.y = Math.max(0.5, truth.pos.y + naiveSumY);
      naiveGpsPos.z = truth.pos.z + naiveSumZ;

      // 2. Fuse Starlink LEO Ku-Band (11.7 GHz) Doppler Range-Rate & Tightly-Coupled Pseudorange Constraint
      let leoDopplerUpdates = 0;
      if (optsStep.leoAidingActive && leoEngine) {
        const totalSats = leoEngine.config.planes * leoEngine.config.satsPerPlane;
        const elBuf = leoEngine.buffers.elevationDeg;
        const azBuf = leoEngine.buffers.azimuthDeg;

        // Pick up to 4 unobstructed high-elevation Starlink LEO satellites
        for (let i = 0; i < totalSats && leoDopplerUpdates < 4; i++) {
          if (elBuf[i] >= 28.0) {
            const azDeg = azBuf[i];
            const elDeg = elBuf[i];
            const losLeo = rfModule
              ? rfModule.traceUrbanLos(truth.pos, azDeg, elDeg)
              : { obstructed: false };

            if (!losLeo.obstructed) {
              const azRad = azDeg * EKF_CONSTANTS.DEG2RAD;
              const elRad = elDeg * EKF_CONSTANTS.DEG2RAD;
              const cosEl = Math.cos(elRad);
              const ux = cosEl * Math.sin(azRad);
              const uy = Math.sin(elRad);
              const uz = -cosEl * Math.cos(azRad);

              // Ku-Band Doppler velocity measurement update (H_vel = [-ux, -uy, -uz] on indices 3..5)
              const trueRangeRate = -(ux * truth.vel.x + uy * truth.vel.y + uz * truth.vel.z);
              const nomRangeRate = -(ux * nominal.vel.x + uy * nominal.vel.y + uz * nominal.vel.z);
              const zDoppler = trueRangeRate + EKF_CONSTANTS.SIGMA_LEO_DOPPLER_MPS * rng.nextGaussian();

              H.fill(0.0);
              H[3] = -ux;
              H[4] = -uy;
              H[5] = -uz;
              josephScalarUpdate15(
                P,
                dxCorr,
                H,
                zDoppler - nomRangeRate,
                EKF_CONSTANTS.SIGMA_LEO_DOPPLER_MPS * EKF_CONSTANTS.SIGMA_LEO_DOPPLER_MPS,
                EKF_CONSTANTS.CHI2_1DOF_99PCT
              );

              // Tightly-coupled LEO multi-epoch carrier-phase position constraint
              const sigLeoPos = 0.65;
              const truePosProj = -(ux * truth.pos.x + uy * truth.pos.y + uz * truth.pos.z);
              const nomPosProj = -(ux * nominal.pos.x + uy * nominal.pos.y + uz * nominal.pos.z);
              const zLeoPos = truePosProj + sigLeoPos * rng.nextGaussian();

              H.fill(0.0);
              H[0] = -ux;
              H[1] = -uy;
              H[2] = -uz;
              josephScalarUpdate15(
                P,
                dxCorr,
                H,
                zLeoPos - nomPosProj,
                sigLeoPos * sigLeoPos,
                EKF_CONSTANTS.CHI2_1DOF_99PCT
              );

              leoDopplerUpdates++;
            }
          }
        }
      }

      // 3. Inject 15-State Error Correction into Nominal State & Reset Error State (ES-EKF Injection)
      nominal.pos.x += dxCorr[0];
      nominal.pos.y += dxCorr[1];
      nominal.pos.z += dxCorr[2];

      nominal.vel.x += dxCorr[3];
      nominal.vel.y += dxCorr[4];
      nominal.vel.z += dxCorr[5];

      nominal.euler.roll += dxCorr[6];
      nominal.euler.pitch += dxCorr[7];
      nominal.euler.yaw += dxCorr[8];

      nominal.ba.x += dxCorr[9];
      nominal.ba.y += dxCorr[10];
      nominal.ba.z += dxCorr[11];

      nominal.bg.x += dxCorr[12];
      nominal.bg.y += dxCorr[13];
      nominal.bg.z += dxCorr[14];

      // Compute 3D Position Error & 3-Sigma Covariance Bound
      const errX = nominal.pos.x - truth.pos.x;
      const errY = nominal.pos.y - truth.pos.y;
      const errZ = nominal.pos.z - truth.pos.z;
      const ekfPosErrorM = Math.sqrt(errX * errX + errY * errY + errZ * errZ);

      const nErrX = naiveGpsPos.x - truth.pos.x;
      const nErrY = naiveGpsPos.y - truth.pos.y;
      const nErrZ = naiveGpsPos.z - truth.pos.z;
      const naiveGpsErrorM = Math.sqrt(nErrX * nErrX + nErrY * nErrY + nErrZ * nErrZ);

      const varPosX = Math.max(1e-6, P[0 * 15 + 0]);
      const varPosY = Math.max(1e-6, P[1 * 15 + 1]);
      const varPosZ = Math.max(1e-6, P[2 * 15 + 2]);
      const pos3SigmaM = 3.0 * Math.sqrt(varPosX + varPosY + varPosZ);

      return {
        tSec,
        truthPos: { x: truth.pos.x, y: truth.pos.y, z: truth.pos.z },
        ekfPos: { x: nominal.pos.x, y: nominal.pos.y, z: nominal.pos.z },
        naiveGpsPos: { x: naiveGpsPos.x, y: naiveGpsPos.y, z: naiveGpsPos.z },
        ekfVel: { x: nominal.vel.x, y: nominal.vel.y, z: nominal.vel.z },
        accelBiasEst: { x: nominal.ba.x, y: nominal.ba.y, z: nominal.ba.z },
        gyroBiasEst: { x: nominal.bg.x, y: nominal.bg.y, z: nominal.bg.z },
        ekfPosErrorM,
        naiveGpsErrorM,
        pos3SigmaM,
        covDiagPos: { x: varPosX, y: varPosY, z: varPosZ },
        gpsAcceptedCount,
        gpsRejectedMultipathCount,
        leoDopplerUpdates,
        maxNisObserved
      };
    }

    return {
      EKF_CONSTANTS,
      GPS_MEO_SATS,
      P,
      nominal,
      resetFilter,
      stepNavigation,
      evaluateCanyonTrajectory
    };
  }

  /**
   * Create Low-Draw-Call Three.js Visual Layer for the 15-State ES-EKF Trajectory & 3-Sigma Covariance Ellipsoid.
   * Uses 3 lightweight Line trails + 1 3-Sigma Ellipsoid Mesh (4 Draw Calls total).
   */
  function createThreeEkfLayer(THREE, scene, ekfOptions) {
    const opts = Object.assign({ historyPoints: 90 }, ekfOptions || {});
    const maxPts = opts.historyPoints;

    const group = new THREE.Group();
    group.name = 'TwinGnssLeoEkfGroup';

    function makeTrailLine(colorHex, opacity) {
      const coords = new Float32Array(maxPts * 3);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(coords, 3));
      const mat = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: opacity < 1.0,
        opacity
      });
      const line = new THREE.Line(geom, mat);
      line.frustumCulled = false;
      group.add(line);
      return { line, geom, mat, coords };
    }

    const truthTrail = makeTrailLine(0x10b981, 0.75); // Emerald ground truth
    const naiveTrail = makeTrailLine(0xef4444, 0.80); // Crimson raw multipath GPS
    const ekfTrail   = makeTrailLine(0x38bdf8, 0.98); // Cyan ES-EKF + LEO Doppler

    // 3-Sigma Covariance Uncertainty Ellipsoid around the UAV
    const ellipGeo = new THREE.SphereGeometry(1.0, 14, 10);
    const ellipMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.55
    });
    const ellipsoidMesh = new THREE.Mesh(ellipGeo, ellipMat);
    group.add(ellipsoidMesh);

    scene.add(group);
    let initialized = false;

    function pushPoint(trail, pt) {
      const arr = trail.coords;
      if (!initialized) {
        for (let i = 0; i < maxPts; i++) {
          arr[i * 3] = pt.x;
          arr[i * 3 + 1] = pt.y;
          arr[i * 3 + 2] = pt.z;
        }
      } else {
        arr.copyWithin(0, 3);
        const last = (maxPts - 1) * 3;
        arr[last] = pt.x;
        arr[last + 1] = pt.y;
        arr[last + 2] = pt.z;
      }
      trail.geom.attributes.position.needsUpdate = true;
    }

    function updateVisuals(navStep) {
      pushPoint(truthTrail, navStep.truthPos);
      pushPoint(naiveTrail, navStep.naiveGpsPos);
      pushPoint(ekfTrail, navStep.ekfPos);
      initialized = true;

      ellipsoidMesh.position.set(navStep.ekfPos.x, navStep.ekfPos.y, navStep.ekfPos.z);
      const sx = Math.max(0.9, Math.min(12.0, 3.0 * Math.sqrt(navStep.covDiagPos.x) * 1.4));
      const sy = Math.max(0.9, Math.min(12.0, 3.0 * Math.sqrt(navStep.covDiagPos.y) * 1.4));
      const sz = Math.max(0.9, Math.min(12.0, 3.0 * Math.sqrt(navStep.covDiagPos.z) * 1.4));
      ellipsoidMesh.scale.set(sx, sy, sz);
    }

    function dispose() {
      scene.remove(group);
      truthTrail.geom.dispose();
      truthTrail.mat.dispose();
      naiveTrail.geom.dispose();
      naiveTrail.mat.dispose();
      ekfTrail.geom.dispose();
      ekfTrail.mat.dispose();
      ellipGeo.dispose();
      ellipMat.dispose();
    }

    return {
      group,
      ellipsoidMesh,
      updateVisuals,
      dispose
    };
  }

  return {
    EKF_CONSTANTS,
    GPS_MEO_SATS,
    createIdentity15,
    josephScalarUpdate15,
    evaluateCanyonTrajectory,
    createNavigationEkfEngine,
    createThreeEkfLayer
  };
});
