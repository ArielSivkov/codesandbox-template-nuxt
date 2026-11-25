/**
 * בס"ד
 * ESH27 Twin World & Game — SpaceX / Starlink-Grade Engineering Sprint
 * Stage HR-06 (11:00): 76-mission-control-hud.js
 *
 * First-Principles Dragon / Starship Flight Director Vector Mission Control HUD:
 * 1. 3D Quaternion FDAI Navball Orthographic Projection (Horizon, Pitch Ladder, Prograde & G-FOLD Director)
 * 2. Specific Proper Acceleration G-Load Meter (n_G = ||a_kin - g|| / g_0)
 * 3. Ku-Band SNR & Shannon-Hartley Spectral Efficiency Waterfall (log2(1 + SNR) bps/Hz)
 * 4. 600-Frame Zero-GC TypedArray Black-Box Flight Data Recorder (FDR) with IEEE 802.3 CRC-32 & Time-Scrubbing Replay
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TwinMissionControlHud = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HR06_HUD_CONSTANTS = Object.freeze({
    GRAVITY_MPS2: 9.80665,
    KU_CHANNEL_BW_MHZ: 240.0,
    FDR_CAPACITY_FRAMES: 600,
    FDR_CHANNELS_PER_FRAME: 16,
    WATERFALL_HISTORY_LEN: 60,
    CRC32_POLY: 0xedb88320
  });

  // Precompute IEEE 802.3 CRC-32 lookup table
  const CRC32_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (HR06_HUD_CONSTANTS.CRC32_POLY ^ (c >>> 1)) : (c >>> 1);
    }
    CRC32_TABLE[i] = c >>> 0;
  }

  /**
   * Computes IEEE 802.3 CRC-32 checksum over a Float64Array or Uint8Array buffer view.
   */
  function computeCrc32(floatArraySlice) {
    const bytes = new Uint8Array(
      floatArraySlice.buffer,
      floatArraySlice.byteOffset,
      floatArraySlice.byteLength
    );
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      const idx = (crc ^ bytes[i]) & 0xff;
      crc = (CRC32_TABLE[idx] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function formatCrc32Hex(crcUint32) {
    return '0x' + (crcUint32 >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  /**
   * Computes dimensionless Proper G-Load Factor n_G = ||a_kin - g_vec||_2 / g_0
   * and Shannon-Hartley Spectral Efficiency eta = log2(1 + 10^(SNR_dB/10)) [bps/Hz].
   */
  function evaluateTelemetryInvariants(velPrev, velCurr, dtSec, snrDb) {
    const g0 = HR06_HUD_CONSTANTS.GRAVITY_MPS2;
    const dt = Math.max(1e-4, dtSec);
    const ax = (velCurr[0] - velPrev[0]) / dt;
    const ay = (velCurr[1] - velPrev[1]) / dt;
    const az = (velCurr[2] - velPrev[2]) / dt;
    // Specific force f = a_kinematic - [0, 0, -g0]
    const fx = ax;
    const fy = ay;
    const fz = az + g0;
    const properGLoad = Math.hypot(fx, fy, fz) / g0;

    const snrLin = Math.pow(10.0, Math.max(-15.0, Math.min(35.0, snrDb)) / 10.0);
    const shannonEfficiencyBpsHz = Math.log2(1.0 + snrLin);
    const shannonCapacityMbps = HR06_HUD_CONSTANTS.KU_CHANNEL_BW_MHZ * shannonEfficiencyBpsHz;

    return {
      properGLoad,
      shannonEfficiencyBpsHz,
      shannonCapacityMbps
    };
  }

  /**
   * Projects 3D unit attitude quaternion q = [qw, qx, qy, qz], relative velocity vRel,
   * and G-FOLD command vector uCmd onto 2D orthographic FDAI Navball coordinates in [-1, +1]^2.
   */
  function projectQuaternionNavball(quat, vRel = [5, 0, 0], uCmd = [0, 0, 9.81]) {
    const nq = Math.hypot(quat[0], quat[1], quat[2], quat[3]) || 1.0;
    const qw = quat[0] / nq, qx = quat[1] / nq, qy = quat[2] / nq, qz = quat[3] / nq;

    // Exact Euler extraction for horizon line & pitch ladder rendering, while markers use full rotation matrix R^T
    const sinr_cosp = 2 * (qw * qx + qy * qz);
    const cosr_cosp = 1 - 2 * (qx * qx + qy * qy);
    const rollRad = Math.atan2(sinr_cosp, cosr_cosp);

    const sinp = 2 * (qw * qy - qz * qx);
    const pitchRad = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

    const siny_cosp = 2 * (qw * qz + qx * qy);
    const cosy_cosp = 1 - 2 * (qy * qy + qz * qz);
    const yawRad = Math.atan2(siny_cosp, cosy_cosp);

    // Rotation matrix Body-to-ENU R
    const R00 = 1 - 2 * (qy * qy + qz * qz);
    const R01 = 2 * (qx * qy - qw * qz);
    const R02 = 2 * (qx * qz + qw * qy);
    const R10 = 2 * (qx * qy + qw * qz);
    const R11 = 1 - 2 * (qx * qx + qz * qz);
    const R12 = 2 * (qy * qz - qw * qx);
    const R20 = 2 * (qx * qz - qw * qy);
    const R21 = 2 * (qy * qz + qw * qx);
    const R22 = 1 - 2 * (qx * qx + qy * qy);

    function projectEnuVecToNavball(vec) {
      const nv = Math.hypot(vec[0], vec[1], vec[2]);
      if (nv < 1e-6) return { x: 0.0, y: 0.0, visible: true };
      const ux = vec[0] / nv, uy = vec[1] / nv, uz = vec[2] / nv;
      // Transform into body frame: v_B = R^T * u_ENU
      const bx = R00 * ux + R10 * uy + R20 * uz;
      const by = R01 * ux + R11 * uy + R21 * uz;
      const bz = R02 * ux + R12 * uy + R22 * uz;
      return {
        x: Math.max(-0.92, Math.min(0.92, by)),
        y: Math.max(-0.92, Math.min(0.92, bz - 0.55 * bx)),
        visible: bx >= -0.35
      };
    }

    return {
      rollRad,
      pitchRad,
      yawRad,
      rollDeg: (rollRad * 180.0) / Math.PI,
      pitchDeg: (pitchRad * 180.0) / Math.PI,
      yawDeg: ((yawRad * 180.0) / Math.PI + 360.0) % 360.0,
      horizonOffsetNorm: Math.max(-0.88, Math.min(0.88, Math.sin(pitchRad))),
      progradeMarker: projectEnuVecToNavball(vRel),
      gfoldDirectorMarker: projectEnuVecToNavball(uCmd)
    };
  }

  /**
   * Creates a deterministic Zero-GC 600-Frame Black-Box Flight Data Recorder (FDR) Ring Buffer
   * with per-frame CRC-32 integrity hashing and instant time-scrubbing replay.
   */
  function createBlackBoxFdrRecorder(options = {}) {
    const capacity = options.capacity ?? HR06_HUD_CONSTANTS.FDR_CAPACITY_FRAMES;
    const stride = HR06_HUD_CONSTANTS.FDR_CHANNELS_PER_FRAME;
    const dataBuffer = new Float64Array(capacity * stride);
    const crcBuffer = new Uint32Array(capacity);

    let writeHead = 0;
    let frameCount = 0;
    let replayMode = false;
    let scrubNormalized = 1.0; // 1.0 = latest frame, 0.0 = oldest frame in buffer

    // Rolling 60-sample SNR & Shannon capacity waterfall buffers
    const wfLen = HR06_HUD_CONSTANTS.WATERFALL_HISTORY_LEN;
    const wfSnrDb = new Float32Array(wfLen);
    const wfShannonEff = new Float32Array(wfLen);
    const wfEkfErrM = new Float32Array(wfLen);
    let wfHead = 0;

    function recordFrame(telemetry) {
      const base = writeHead * stride;
      dataBuffer[base + 0] = telemetry.tSec ?? 0.0;
      dataBuffer[base + 1] = telemetry.p?.[0] ?? 0.0;
      dataBuffer[base + 2] = telemetry.p?.[1] ?? 0.0;
      dataBuffer[base + 3] = telemetry.p?.[2] ?? 0.0;
      dataBuffer[base + 4] = telemetry.v?.[0] ?? 0.0;
      dataBuffer[base + 5] = telemetry.v?.[1] ?? 0.0;
      dataBuffer[base + 6] = telemetry.v?.[2] ?? 0.0;
      dataBuffer[base + 7] = telemetry.q?.[0] ?? 1.0;
      dataBuffer[base + 8] = telemetry.q?.[1] ?? 0.0;
      dataBuffer[base + 9] = telemetry.q?.[2] ?? 0.0;
      dataBuffer[base + 10] = telemetry.q?.[3] ?? 0.0;
      dataBuffer[base + 11] = telemetry.properGLoad ?? 1.0;
      dataBuffer[base + 12] = telemetry.snrDb ?? 18.4;
      dataBuffer[base + 13] = telemetry.shannonEfficiencyBpsHz ?? 6.12;
      dataBuffer[base + 14] = telemetry.ekfErrM ?? 0.79;
      dataBuffer[base + 15] = telemetry.pa12cfTempC ?? 69.2;

      const slice = dataBuffer.subarray(base, base + stride);
      const crc = computeCrc32(slice);
      crcBuffer[writeHead] = crc;

      writeHead = (writeHead + 1) % capacity;
      if (frameCount < capacity) frameCount++;

      // Push into waterfall ring
      wfSnrDb[wfHead] = telemetry.snrDb ?? 18.4;
      wfShannonEff[wfHead] = telemetry.shannonEfficiencyBpsHz ?? 6.12;
      wfEkfErrM[wfHead] = telemetry.ekfErrM ?? 0.79;
      wfHead = (wfHead + 1) % wfLen;

      return {
        frameIndex: (writeHead + capacity - 1) % capacity,
        storedFrames: frameCount,
        crc32: crc,
        crc32Hex: formatCrc32Hex(crc)
      };
    }

    function readFrameByNormalizedScrub(norm01 = scrubNormalized) {
      if (frameCount === 0) return null;
      const clamped = Math.max(0.0, Math.min(1.0, norm01));
      const oldestIdx = frameCount < capacity ? 0 : writeHead;
      const offset = Math.min(frameCount - 1, Math.floor(clamped * (frameCount - 1)));
      const idx = (oldestIdx + offset) % capacity;
      const base = idx * stride;
      const slice = dataBuffer.subarray(base, base + stride);
      const storedCrc = crcBuffer[idx];
      const verifiedCrc = computeCrc32(slice);

      return {
        frameIndex: idx,
        storedFrames: frameCount,
        crcValid: storedCrc === verifiedCrc,
        crc32: storedCrc,
        crc32Hex: formatCrc32Hex(storedCrc),
        tSec: dataBuffer[base + 0],
        p: [dataBuffer[base + 1], dataBuffer[base + 2], dataBuffer[base + 3]],
        v: [dataBuffer[base + 4], dataBuffer[base + 5], dataBuffer[base + 6]],
        q: [dataBuffer[base + 7], dataBuffer[base + 8], dataBuffer[base + 9], dataBuffer[base + 10]],
        properGLoad: dataBuffer[base + 11],
        snrDb: dataBuffer[base + 12],
        shannonEfficiencyBpsHz: dataBuffer[base + 13],
        ekfErrM: dataBuffer[base + 14],
        pa12cfTempC: dataBuffer[base + 15]
      };
    }

    function setReplayState(isReplay, normScrub = scrubNormalized) {
      replayMode = Boolean(isReplay);
      scrubNormalized = Math.max(0.0, Math.min(1.0, normScrub));
    }

    return {
      capacity,
      dataBuffer,
      crcBuffer,
      wfSnrDb,
      wfShannonEff,
      wfEkfErrM,
      getWfHead: () => wfHead,
      getStoredFrames: () => frameCount,
      isReplayMode: () => replayMode,
      getScrubNormalized: () => scrubNormalized,
      setReplayState,
      recordFrame,
      readFrameByNormalizedScrub
    };
  }

  /**
   * Renders the Dragon / Starship Vector FDAI Navball and Ku-Band SNR Waterfall onto a 2D HTML5 Canvas
   * in 60 FPS with zero WebGL Draw Call overhead and zero CSS blur.
   */
  function renderVectorHudCanvas(canvasEl, navballProj, fdrRecorder, liveMetrics = {}) {
    if (!canvasEl || typeof canvasEl.getContext !== 'function') return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);

    // Background grid
    ctx.fillStyle = '#070D19';
    ctx.fillRect(0, 0, w, h);

    // --- Left Half: Ku-Band SNR & Shannon Spectral Efficiency Waterfall ---
    const wfX = 8;
    const wfY = 16;
    const wfW = Math.floor(w * 0.54) - 14;
    const wfH = h - 24;

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    ctx.strokeRect(wfX, wfY, wfW, wfH);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('SNR & SHANNON WATERFALL (11.7GHz)', wfX + 2, 12);

    const wfLen = HR06_HUD_CONSTANTS.WATERFALL_HISTORY_LEN;
    const head = fdrRecorder.getWfHead();
    const snrBuf = fdrRecorder.wfSnrDb;
    const barW = Math.max(1.5, wfW / wfLen);

    ctx.beginPath();
    for (let i = 0; i < wfLen; i++) {
      const idx = (head + i) % wfLen;
      const snr = snrBuf[idx];
      const norm = Math.max(0.05, Math.min(1.0, (snr + 5.0) / 30.0));
      const bx = wfX + i * barW;
      const bh = norm * (wfH - 6);
      const by = wfY + wfH - bh;

      ctx.fillStyle = snr >= 12.0 ? 'rgba(16, 185, 129, 0.45)' : snr >= 3.0 ? 'rgba(56, 189, 248, 0.45)' : 'rgba(244, 63, 94, 0.55)';
      ctx.fillRect(bx, by, Math.max(1, barW - 0.6), bh);

      if (i === 0) ctx.moveTo(bx, by);
      else ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // --- Right Half: Dragon/Starship Vector FDAI Navball ---
    const cx = Math.floor(w * 0.77);
    const cy = Math.floor(h * 0.52);
    const r = Math.min(Math.floor(h * 0.40), Math.floor(w * 0.20));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Rotate artificial horizon by -rollRad and shift by horizonOffsetNorm
    ctx.translate(cx, cy);
    ctx.rotate(-navballProj.rollRad);
    const pitchPx = navballProj.horizonOffsetNorm * r * 0.85;

    // Sky hemisphere
    ctx.fillStyle = '#0C4A6E';
    ctx.fillRect(-r * 1.5, -r * 1.5 + pitchPx, r * 3, r * 1.5);
    // Ground hemisphere
    ctx.fillStyle = '#3B2314';
    ctx.fillRect(-r * 1.5, pitchPx, r * 3, r * 1.5);
    // Horizon line
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-r, pitchPx);
    ctx.lineTo(r, pitchPx);
    ctx.stroke();

    // Pitch ladder rungs (+-15 deg, +-30 deg)
    ctx.strokeStyle = 'rgba(241, 245, 249, 0.65)';
    ctx.lineWidth = 1;
    for (const deg of [-30, -15, 15, 30]) {
      const py = pitchPx - (deg / 45.0) * (r * 0.65);
      const lw = Math.abs(deg) === 30 ? r * 0.36 : r * 0.22;
      ctx.beginPath();
      ctx.moveTo(-lw, py);
      ctx.lineTo(lw, py);
      ctx.stroke();
    }
    ctx.restore();

    // Prograde Velocity Marker (emerald circle)
    const pm = navballProj.progradeMarker;
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + pm.x * r * 0.72, cy - pm.y * r * 0.72, 4.2, 0, Math.PI * 2);
    ctx.stroke();

    // G-FOLD Flight Director Reticle (amber crosshair)
    const dm = navballProj.gfoldDirectorMarker;
    const dx = cx + dm.x * r * 0.72;
    const dy = cy - dm.y * r * 0.72;
    ctx.strokeStyle = '#F59E0B';
    ctx.beginPath();
    ctx.moveTo(dx - 5, dy);
    ctx.lineTo(dx + 5, dy);
    ctx.moveTo(dx, dy - 5);
    ctx.lineTo(dx, dy + 5);
    ctx.stroke();

    // Fixed Aircraft Reference Wings & Outer Bezel
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx - 3, cy);
    ctx.moveTo(cx + 3, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.stroke();

    ctx.strokeStyle = liveMetrics.isReplay ? '#F59E0B' : '#38BDF8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  return {
    HR06_HUD_CONSTANTS,
    computeCrc32,
    formatCrc32Hex,
    evaluateTelemetryInvariants,
    projectQuaternionNavball,
    createBlackBoxFdrRecorder,
    renderVectorHudCanvas
  };
});
