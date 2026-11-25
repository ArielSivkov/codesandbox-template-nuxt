'use strict';
/**
 * בס"ד
 * 12-phys2-core-fixes.js — חבילת תיקוני פיזיקה ותנועה קריטיים לעולם התאום (סבב 5)
 *
 * כולל את חמשת התיקונים המאומתים:
 * א. כבידת הדמות (G_FOOT): תיקון מ-22.0 ל-9.81 מ'/שנ'² (נפילה מ-30 מ' ב-~2.473 שנ' במקום 1.651 שנ').
 * ב. בלם ודינמיקת רכב ריאליים (phys2): צעד קבוע 60Hz בלתי תלוי ב-FPS (20/30/60/144 וריצוד),
 *    מרחק בלימה של ~41.4 מ' מ-100 קמ"ש באספלט יבש (במקום 5.76 מ' ב-12.5g), מתלים ב-4 פינות,
 *    והתנגשות רציפה (CCD Minkowski Capsule) באפס חדירות לקירות ובניינים.
 * ג. תיקון מלכודת קרקעית הים (y = -2.5): בנחיתת תרמיל סילון מעל הים או ביציאה מסירה בים,
 *    הצפת הדמות בגובה פני המים (y >= 0.0 במצב שחייה/ציפה) במקום הנחתה על הקרקעית ב-y = -2.5.
 * ד. תיקון מושב הנהג בגוף ראשון (35-camera / 57-vehicles): צד שמאל כנהוג בישראל (side = +0.37 במקום -0.38).
 * ה. תיקון ציר הצד ההפוך בג'ויסטיק ובמקשי A-D (moveFoot): לחיצה ימינה מזיזה ימינה במרחב התלת-ממדי.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const api = factory();
    root.ESHPhys2CoreFixes = api;
    if (root.YZW && typeof root.YZW.register === 'function') {
      api.registerWithHost(root.YZW);
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // === קבועים פיזיקליים קנוניים ===
  const G_FOOT = 9.81; // מ'/שנ'² (מחליף את 22.0 הישן ב-game.js)
  const LEGACY_G_FOOT = 22.0;
  const FIXED_HZ = 60;
  const FIXED_DT = 1 / FIXED_HZ; // 0.0166666667 שנ'
  const MAX_ACCUM_DT = 0.25; // מונע ספירלת מוות ושומר על קצב זמן אמיתי גם מתחת ל-10 FPS

  const SEA_LEVEL = 0.0; // גובה פני הים במטרים
  const LEGACY_SEAFLOOR_Y = -2.5;

  // מושב נהג ישראלי (צד שמאל של הרכב)
  const DRIVER_SEAT_SIDE = +0.37; // מחליף את -0.38 הישן ב-35-camera
  const LEGACY_DRIVER_SEAT_SIDE = -0.38;
  const DRIVER_CAMERA_DEFAULTS = Object.freeze({
    side: DRIVER_SEAT_SIDE,
    up: 1.18,
    forward: 0.12,
  });

  // רדיוסי גופים (תמיכה בזיהוי מפורש kind לפני נפילה לרדיוס)
  const BODY_RADII = Object.freeze({
    foot: 0.35,
    vehicle: 1.05,
    heli: 2.60,
    drone: 0.45,
    boat: 1.40,
  });

  // פרמטרי רכב נוסעים ריאלי על אספלט יבש (מכויל לבלימה של ~41.4 מ' מ-100 קמ"ש ו-0->100 ב-~6.4 שנ')
  const DEFAULT_VEHICLE_PARAMS = Object.freeze({
    massKg: 1420,
    wheelbaseM: 2.68,
    trackWidthM: 1.56,
    cgHeightM: 0.54,
    dragCoeff: 0.29,
    frontalAreaM2: 2.18,
    airDensity: 1.225,
    rollingResistance: 0.012,
    muAsphaltBrake: 0.9504, // מקדם חיכוך בלימה אפקטיבי (ABS אספלט יבש) -> ~41.40 מ' מ-100 קמ"ש
    muLateralMax: 0.92, // הגבלת תאוצה רוחבית ריאלית (~0.92g במקום 2.0-2.85g)
    brakeRampTauS: 0.045, // זמן עליית לחץ הידראולי במערכת הבלימה
    reverseBrakeG: 0.55, // האטת רוורס מתונה במקום 2.2g
    coastDecelMps2: 0.32, // גלישה חופשית ריאלית במקום 1.7g
    maxSpeedKmh: 122.0,
    enginePeakForceN: 7150,
    enginePeakPowerW: 108000,
    suspSpringNPerM: 28000,
    suspDamperNsPerM: 3400,
    suspMaxTravelM: 0.12,
    radiusM: BODY_RADII.vehicle,
    heightM: 1.52,
  });

  const CCD_SKIN = 1e-4;
  const MAX_CCD_SLIDES = 4;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function classifyEntity(entity) {
    if (entity && typeof entity.kind === 'string' && BODY_RADII[entity.kind]) {
      return entity.kind;
    }
    const r = entity && isFiniteNum(entity.radius) ? entity.radius : BODY_RADII.foot;
    if (r <= 0.55) return 'foot';
    if (r <= 1.65) return 'vehicle';
    return 'heli';
  }

  // =========================================================================
  // 1. תיקון כבידת דמות (G_FOOT = 9.81) + תיקון מלכודת קרקעית הים (y >= 0.0)
  // =========================================================================

  function isWaterLocation(x, z, groundY, env = {}) {
    if (env.isWater === true) return true;
    if (typeof env.isWaterAt === 'function' && env.isWaterAt(x, z)) return true;
    const seaLevel = isFiniteNum(env.seaLevel) ? env.seaLevel : SEA_LEVEL;
    return isFiniteNum(groundY) && groundY < seaLevel - 0.05;
  }

  /**
   * הצפה מיידית ובטוחה על פני הים ביציאה מסירה או בנחיתת תרמיל סילון מעל מים.
   * מונע לחלוטין נפילה לקרקעית הים ב-y = -2.5.
   */
  function ensureAboveSeaFloor(charState, env = {}) {
    const seaLevel = isFiniteNum(env.seaLevel) ? env.seaLevel : SEA_LEVEL;
    const groundY = isFiniteNum(env.groundY)
      ? env.groundY
      : typeof env.getGroundY === 'function'
      ? env.getGroundY(charState.x || 0, charState.z || 0)
      : LEGACY_SEAFLOOR_Y;

    const overWater = isWaterLocation(charState.x || 0, charState.z || 0, groundY, env);
    if (overWater) {
      if (!isFiniteNum(charState.y) || charState.y < seaLevel) {
        charState.y = seaLevel;
      }
      if (!isFiniteNum(charState.vy) || charState.vy < 0) {
        charState.vy = 0;
      }
      charState.onGround = false;
      charState.inWater = true;
      charState.mode = 'swim';
    } else {
      if (!isFiniteNum(charState.y) || charState.y < groundY) {
        charState.y = groundY;
        charState.vy = Math.max(0, charState.vy || 0);
        charState.onGround = true;
      }
      charState.inWater = false;
      if (charState.mode === 'swim') {
        charState.mode = 'walk';
      }
    }
    return charState;
  }

  function exitBoatSafe(boatState, charState = {}, env = {}) {
    const seaLevel = isFiniteNum(env.seaLevel) ? env.seaLevel : SEA_LEVEL;
    const bx = isFiniteNum(boatState?.x) ? boatState.x : 0;
    const bz = isFiniteNum(boatState?.z) ? boatState.z : 0;
    const yaw = isFiniteNum(boatState?.yaw) ? boatState.yaw : 0;
    // יציאה לצד הסירה בגובה פני המים ומעלה (לעולם לא ב-y = -2.5)
    charState.x = bx + Math.cos(yaw) * 1.6;
    charState.z = bz + Math.sin(yaw) * 1.6;
    const groundY = isFiniteNum(env.groundY)
      ? env.groundY
      : typeof env.getGroundY === 'function'
      ? env.getGroundY(charState.x, charState.z)
      : LEGACY_SEAFLOOR_Y;

    const surfaceFloor = isWaterLocation(charState.x, charState.z, groundY, env)
      ? Math.max(seaLevel, isFiniteNum(boatState?.deckY) ? boatState.deckY : seaLevel)
      : groundY;

    charState.y = Math.max(surfaceFloor, seaLevel);
    charState.vy = 0;
    return ensureAboveSeaFloor(charState, { ...env, groundY });
  }

  function landJetpackSafe(charState, env = {}) {
    charState.jetpackActive = false;
    return ensureAboveSeaFloor(charState, env);
  }

  /**
   * קידום אנכי מדויק של הדמות (Velocity-Verlet אנליטי בצעד קבוע) תחת G_FOOT = 9.81 מ'/שנ'²,
   * כולל חישוב רגע פגיעה תת-צעדי מדויק בקרקע או בפני הים.
   */
  function stepFootVerticalSubstep(state, dt, env = {}) {
    const g = isFiniteNum(env.gravity) ? env.gravity : G_FOOT;
    const seaLevel = isFiniteNum(env.seaLevel) ? env.seaLevel : SEA_LEVEL;
    const groundY = isFiniteNum(env.groundY)
      ? env.groundY
      : typeof env.getGroundY === 'function'
      ? env.getGroundY(state.x || 0, state.z || 0)
      : 0.0;

    const overWater = isWaterLocation(state.x || 0, state.z || 0, groundY, env);
    const floorY = overWater ? seaLevel : groundY;

    const y0 = isFiniteNum(state.y) ? state.y : floorY;
    const vy0 = isFiniteNum(state.vy) ? state.vy : 0;

    if (overWater && y0 <= seaLevel + 1e-6 && vy0 <= 0) {
      // ציפה יציבה על פני הים (y >= 0.0) עם שיכוך הידרודינמי
      state.y = seaLevel;
      state.vy = 0;
      state.inWater = true;
      state.onGround = false;
      state.mode = 'swim';
      state.elapsedTime = (state.elapsedTime || 0) + dt;
      return state;
    }

    const yNext = y0 + vy0 * dt - 0.5 * g * dt * dt;
    const vyNext = vy0 - g * dt;

    if (yNext <= floorY) {
      // חישוב אנליטי מדויק של תת-צעד הפגיעה בקרקע/פני הים: y0 + vy0*tau - 0.5*g*tau^2 = floorY
      const dy = y0 - floorY;
      let tau = dt;
      if (dy >= 0 && g > 0) {
        const disc = vy0 * vy0 + 2 * g * dy;
        if (disc >= 0) {
          const tRoot = (vy0 + Math.sqrt(disc)) / g;
          if (tRoot >= 0 && tRoot <= dt + 1e-9) {
            tau = clamp(tRoot, 0, dt);
          }
        }
      }
      if (state.impactTime === undefined || state.impactTime === null) {
        state.impactTime = (state.elapsedTime || 0) + tau;
      }
      state.y = floorY;
      state.vy = 0;
      state.inWater = overWater;
      state.onGround = !overWater;
      state.mode = overWater ? 'swim' : 'walk';
    } else {
      state.y = yNext;
      state.vy = vyNext;
      state.onGround = false;
      state.inWater = false;
    }

    state.elapsedTime = (state.elapsedTime || 0) + dt;
    return state;
  }

  function simulateFreeFall(heightM = 30.0, gravity = G_FOOT, frameHz = 60) {
    const state = {
      x: 0,
      y: heightM,
      z: 0,
      vy: 0,
      onGround: false,
      inWater: false,
      elapsedTime: 0,
      impactTime: null,
    };
    const dt = 1 / frameHz;
    let steps = 0;
    const maxSteps = Math.ceil(20 * frameHz);
    while (!state.onGround && steps < maxSteps) {
      stepFootVerticalSubstep(state, dt, { gravity, groundY: 0.0, isWater: false });
      steps++;
    }
    return {
      heightM,
      gravity,
      frameHz,
      steps,
      impactTimeS: state.impactTime,
      theoreticalTimeS: Math.sqrt((2 * heightM) / gravity),
      finalY: state.y,
    };
  }

  // =========================================================================
  // 2. התנגשות רציפה (CCD) מול קירות ובניינים — אפס חדירות בכל מהירות ו-FPS
  // =========================================================================

  function closestPointOnSegment2D(px, pz, ax, az, bx, bz) {
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    if (len2 < 1e-12) {
      return { cx: ax, cz: az, t: 0 };
    }
    const t = clamp(((px - ax) * abx + (pz - az) * abz) / len2, 0, 1);
    return {
      cx: ax + t * abx,
      cz: az + t * abz,
      t,
    };
  }

  /**
   * חיתוך קרן P(t) = P0 + t*D (עבור t in [0,1]) מול קפסולה סביב קטע קיר [A,B] ברדיוס R.
   * מחזיר { hit: true, t, nx, nz } או { hit: false }.
   */
  function rayVsWallCapsule2D(p0x, p0z, dx, dz, ax, az, bx, bz, radius) {
    const moveLen2 = dx * dx + dz * dz;
    if (moveLen2 < 1e-14) return { hit: false };

    let bestT = Infinity;
    let bestNx = 0;
    let bestNz = 0;

    const abx = bx - ax;
    const abz = bz - az;
    const segLen = Math.hypot(abx, abz);

    // א. חיתוך מול שני הקווים המקבילים לקטע הקיר במרחק radius
    if (segLen > 1e-9) {
      const ux = abx / segLen;
      const uz = abz / segLen;
      // שני נורמלים ניצבים לקטע הקיר
      const normals = [
        { nx: -uz, nz: ux },
        { nx: uz, nz: -ux },
      ];
      for (const n of normals) {
        const denom = dx * n.nx + dz * n.nz;
        if (denom < -1e-12) {
          // מרחק התחלתי מהישר המוזז (A + radius*n)
          const ox = p0x - (ax + radius * n.nx);
          const oz = p0z - (az + radius * n.nz);
          const distFromOffsetLine = ox * n.nx + oz * n.nz;
          if (distFromOffsetLine >= -1e-9) {
            const t = Math.max(0, -distFromOffsetLine / denom);
            if (t <= 1.0 && t < bestT) {
              const hx = p0x + t * dx;
              const hz = p0z + t * dz;
              const proj = (hx - ax) * ux + (hz - az) * uz;
              if (proj >= -1e-7 && proj <= segLen + 1e-7) {
                bestT = t;
                bestNx = n.nx;
                bestNz = n.nz;
              }
            }
          }
        }
      }
    }

    // ב. חיתוך מול שני מעגלי הקצה (קודקודי A ו-B) ברדיוס radius
    const endpoints = [
      { cx: ax, cz: az },
      { cx: bx, cz: bz },
    ];
    for (const ep of endpoints) {
      const fx = p0x - ep.cx;
      const fz = p0z - ep.cz;
      const bCoef = 2 * (fx * dx + fz * dz);
      const cCoef = fx * fx + fz * fz - radius * radius;
      if (cCoef <= 0) {
        // כבר נוגע בקצה בתחילת הצעד – בדוק אם מתקרבים פנימה
        if (bCoef < 0 && 0 < bestT) {
          const dist = Math.hypot(fx, fz);
          bestT = 0;
          bestNx = dist > 1e-9 ? fx / dist : -dx / Math.sqrt(moveLen2);
          bestNz = dist > 1e-9 ? fz / dist : -dz / Math.sqrt(moveLen2);
        }
        continue;
      }
      const disc = bCoef * bCoef - 4 * moveLen2 * cCoef;
      if (disc >= 0) {
        const sqrtDisc = Math.sqrt(disc);
        const t = (-bCoef - sqrtDisc) / (2 * moveLen2);
        if (t >= 0 && t <= 1.0 && t < bestT) {
          const hx = p0x + t * dx;
          const hz = p0z + t * dz;
          const invR = 1 / Math.max(1e-9, Math.hypot(hx - ep.cx, hz - ep.cz));
          bestT = t;
          bestNx = (hx - ep.cx) * invR;
          bestNz = (hz - ep.cz) * invR;
        }
      }
    }

    if (bestT <= 1.0) {
      return { hit: true, t: bestT, nx: bestNx, nz: bestNz };
    }
    return { hit: false };
  }

  /**
   * המרת רשימת בניינים/פוליגונים/קטעי קירות למערך אחיד של קטעי קיר.
   */
  function normalizeWallSegments(wallsOrBuildings = []) {
    const segs = [];
    for (const item of wallsOrBuildings) {
      if (!item) continue;
      if (isFiniteNum(item.ax) && isFiniteNum(item.az) && isFiniteNum(item.bx) && isFiniteNum(item.bz)) {
        segs.push({
          ax: item.ax,
          az: item.az,
          bx: item.bx,
          bz: item.bz,
          baseY: isFiniteNum(item.baseY) ? item.baseY : -10,
          topY: isFiniteNum(item.topY) ? item.topY : (isFiniteNum(item.h) ? item.h : 100),
        });
      } else if (Array.isArray(item.polygon) && item.polygon.length >= 2) {
        const baseY = isFiniteNum(item.baseY) ? item.baseY : 0;
        const topY = isFiniteNum(item.topY) ? item.topY : baseY + (isFiniteNum(item.h) ? item.h : 15);
        const poly = item.polygon;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          segs.push({
            ax: a.x ?? a[0],
            az: a.z ?? a[1],
            bx: b.x ?? b[0],
            bz: b.z ?? b[1],
            baseY,
            topY,
          });
        }
      } else if (
        isFiniteNum(item.minX) &&
        isFiniteNum(item.maxX) &&
        isFiniteNum(item.minZ) &&
        isFiniteNum(item.maxZ)
      ) {
        const baseY = isFiniteNum(item.baseY) ? item.baseY : 0;
        const topY = isFiniteNum(item.topY) ? item.topY : baseY + (isFiniteNum(item.h) ? item.h : 15);
        const pts = [
          [item.minX, item.minZ],
          [item.maxX, item.minZ],
          [item.maxX, item.maxZ],
          [item.minX, item.maxZ],
        ];
        for (let i = 0; i < 4; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % 4];
          segs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], baseY, topY });
        }
      }
    }
    return segs;
  }

  function measureMaxWallPenetration(x, z, y, height, radius, segments) {
    let maxPen = 0;
    const bodyTop = y + (isFiniteNum(height) ? height : 1.75);
    for (const s of segments) {
      if (bodyTop <= s.baseY || y >= s.topY) continue;
      const cp = closestPointOnSegment2D(x, z, s.ax, s.az, s.bx, s.bz);
      const dist = Math.hypot(x - cp.cx, z - cp.cz);
      const pen = Math.max(0, radius - dist - 1e-6);
      if (pen > maxPen) maxPen = pen;
    }
    return maxPen;
  }

  function depenetrateCircle(x, z, y, height, radius, segments) {
    let cx = x;
    let cz = z;
    const bodyTop = y + (isFiniteNum(height) ? height : 1.75);
    const rEff = radius + CCD_SKIN;

    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const s of segments) {
        if (bodyTop <= s.baseY || y >= s.topY) continue;
        const cp = closestPointOnSegment2D(cx, cz, s.ax, s.az, s.bx, s.bz);
        const vx = cx - cp.cx;
        const vz = cz - cp.cz;
        const dist = Math.hypot(vx, vz);
        if (dist < rEff) {
          let nx;
          let nz;
          if (dist > 1e-9) {
            nx = vx / dist;
            nz = vz / dist;
          } else {
            const segLen = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
            nx = -(s.bz - s.az) / segLen;
            nz = (s.bx - s.ax) / segLen;
          }
          const push = rEff - dist;
          cx += nx * push;
          cz += nz * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x: cx, z: cz };
  }

  /**
   * פתרון התנגשות רציפה (Swept Circle CCD + Iterative Wall Slide) באפס חדירות.
   */
  function collideCCD(startPos, targetPos, entity = {}, rawSegments = []) {
    const kind = classifyEntity(entity);
    const radius = isFiniteNum(entity.radius) ? entity.radius : BODY_RADII[kind];
    const y = isFiniteNum(startPos.y) ? startPos.y : 0;
    const height = isFiniteNum(entity.height) ? entity.height : 1.75;
    const bodyTop = y + height;
    const segments = Array.isArray(rawSegments) && rawSegments.length > 0 && isFiniteNum(rawSegments[0]?.ax)
      ? rawSegments
      : normalizeWallSegments(rawSegments);

    const startClean = depenetrateCircle(startPos.x, startPos.z, y, height, radius, segments);
    let curX = startClean.x;
    let curZ = startClean.z;
    let remDx = targetPos.x - curX;
    let remDz = targetPos.z - curZ;
    let hitCount = 0;
    let lastNormal = null;

    const rEff = radius + CCD_SKIN;

    for (let iter = 0; iter < MAX_CCD_SLIDES; iter++) {
      if (remDx * remDx + remDz * remDz < 1e-12) break;

      // סינון מהיר בתיבה תוחמת של הקטע הנסרק
      const minX = Math.min(curX, curX + remDx) - rEff - 0.05;
      const maxX = Math.max(curX, curX + remDx) + rEff + 0.05;
      const minZ = Math.min(curZ, curZ + remDz) - rEff - 0.05;
      const maxZ = Math.max(curZ, curZ + remDz) + rEff + 0.05;

      let earliest = null;
      for (const s of segments) {
        if (bodyTop <= s.baseY || y >= s.topY) continue;
        const sMinX = Math.min(s.ax, s.bx);
        const sMaxX = Math.max(s.ax, s.bx);
        const sMinZ = Math.min(s.az, s.bz);
        const sMaxZ = Math.max(s.az, s.bz);
        if (sMaxX < minX || sMinX > maxX || sMaxZ < minZ || sMinZ > maxZ) continue;

        const res = rayVsWallCapsule2D(curX, curZ, remDx, remDz, s.ax, s.az, s.bx, s.bz, rEff);
        if (res.hit && (!earliest || res.t < earliest.t)) {
          earliest = res;
        }
      }

      if (!earliest) {
        curX += remDx;
        curZ += remDz;
        remDx = 0;
        remDz = 0;
        break;
      }

      hitCount++;
      lastNormal = { nx: earliest.nx, nz: earliest.nz };

      // התקדמות בטוחה עד רגע המגע פחות מרווח זעיר
      const moveLen = Math.hypot(remDx, remDz);
      const safeBackT = moveLen > 1e-6 ? CCD_SKIN / moveLen : 0;
      const tSafe = Math.max(0, earliest.t - safeBackT);

      curX += remDx * tSafe;
      curZ += remDz * tSafe;

      const leftFactor = Math.max(0, 1 - earliest.t);
      const slideDx = remDx * leftFactor;
      const slideDz = remDz * leftFactor;
      // הטלת שארית התנועה על המישור המשיק לקיר (החלקה חלקה בלי חדירה)
      const vn = slideDx * earliest.nx + slideDz * earliest.nz;
      remDx = vn < 0 ? slideDx - vn * earliest.nx : slideDx;
      remDz = vn < 0 ? slideDz - vn * earliest.nz : slideDz;
    }

    const finalClean = depenetrateCircle(curX, curZ, y, height, radius, segments);
    let vx = isFiniteNum(entity.vx) ? entity.vx : 0;
    let vz = isFiniteNum(entity.vz) ? entity.vz : 0;
    if (lastNormal) {
      const vDotN = vx * lastNormal.nx + vz * lastNormal.nz;
      if (vDotN < 0) {
        const restitution = isFiniteNum(entity.restitution) ? entity.restitution : 0.0;
        vx -= (1 + restitution) * vDotN * lastNormal.nx;
        vz -= (1 + restitution) * vDotN * lastNormal.nz;
      }
    }

    return {
      x: finalClean.x,
      y,
      z: finalClean.z,
      vx,
      vz,
      collided: hitCount > 0,
      hitCount,
      lastNormal,
      kind,
      penetrationM: measureMaxWallPenetration(finalClean.x, finalClean.z, y, height, radius, segments),
    };
  }

  // =========================================================================
  // 3. דינמיקת רכב ריאלית (phys2) בצעד קבוע 60Hz + מתלים + בלם ~41.4 מ'
  // =========================================================================

  function createVehicleState(overrides = {}) {
    return {
      kind: 'vehicle',
      x: 0,
      y: 0,
      z: 0,
      prevX: 0,
      prevY: 0,
      prevZ: 0,
      yaw: 0, // 0 = מבט צפונה (-Z), +yaw = סיבוב ימינה (מזרחה +X)
      speedMps: 0, // מהירות קדימה במטרים לשנייה
      vx: 0,
      vz: 0,
      axLong: 0,
      ayLat: 0,
      brakePressure: 0,
      brakeHoldTimeS: 0,
      pitchRad: 0,
      rollRad: 0,
      suspension: {
        fl: { z: 0, vz: 0 },
        fr: { z: 0, vz: 0 },
        rl: { z: 0, vz: 0 },
        rr: { z: 0, vz: 0 },
      },
      accumS: 0,
      fixedTicks: 0,
      distanceTraveledM: 0,
      maxPenetrationM: 0,
      params: { ...DEFAULT_VEHICLE_PARAMS, ...(overrides.params || {}) },
      ...overrides,
    };
  }

  function stepVehicleSubstep60Hz(vehicle, input = {}, walls = []) {
    const p = vehicle.params || DEFAULT_VEHICLE_PARAMS;
    const dt = FIXED_DT;

    vehicle.prevX = vehicle.x;
    vehicle.prevY = vehicle.y;
    vehicle.prevZ = vehicle.z;

    const throttle = clamp(Number(input.throttle) || 0, 0, 1);
    const brake = clamp(Number(input.brake) || 0, 0, 1);
    const reverse = clamp(Number(input.reverse) || 0, 0, 1);
    const steer = clamp(Number(input.steer) || 0, -1, 1);

    let v = isFiniteNum(vehicle.speedMps) ? vehicle.speedMps : 0;
    const absV = Math.abs(v);
    const signV = v > 1e-5 ? 1 : v < -1e-5 ? -1 : 0;

    // 1. גרר אווירודינמי והתנגדות גלגול ריאלית
    const fAero = 0.5 * p.airDensity * p.dragCoeff * p.frontalAreaM2 * v * absV;
    const fRoll = signV * p.rollingResistance * p.massKg * G_FOOT;

    // 2. כוח הנעה או בלימה (ABS על אספלט יבש עם בניית לחץ הידראולי)
    let fDrive = 0;
    let fBrakeMag = 0;

    if (brake > 0.001) {
      vehicle.brakeHoldTimeS += dt;
      const ramp = 1 - Math.exp(-vehicle.brakeHoldTimeS / p.brakeRampTauS);
      vehicle.brakePressure = brake * ramp;
      fBrakeMag = vehicle.brakePressure * p.muAsphaltBrake * p.massKg * G_FOOT;
    } else {
      vehicle.brakeHoldTimeS = Math.max(0, vehicle.brakeHoldTimeS - dt * 3);
      vehicle.brakePressure = 0;
    }

    const maxSpeedMps = p.maxSpeedKmh / 3.6;
    if (throttle > 0.001 && brake <= 0.001) {
      if (v < maxSpeedMps) {
        const powerLimitedForce = absV > 8.0 ? p.enginePeakPowerW / absV : p.enginePeakForceN;
        const speedTaper = clamp(1 - Math.pow(Math.max(0, v) / maxSpeedMps, 4), 0, 1);
        fDrive = throttle * Math.min(p.enginePeakForceN, powerLimitedForce) * (0.35 + 0.65 * speedTaper);
      }
    } else if (reverse > 0.001 && brake <= 0.001) {
      if (v > 0.15) {
        // לחיצה על אחורה תוך נסיעה קדימה – האטה מתונה ובטוחה במקום 2.2g
        fBrakeMag = Math.max(fBrakeMag, reverse * p.reverseBrakeG * p.massKg * G_FOOT);
      } else if (v > -9.0) {
        fDrive = -reverse * 0.35 * p.enginePeakForceN;
      }
    } else if (throttle <= 0.001 && brake <= 0.001 && reverse <= 0.001 && signV !== 0) {
      // האטת גלישה טבעית בלי גז (~0.03g במקום 1.7g הישן)
      fBrakeMag += p.coastDecelMps2 * p.massKg;
    }

    // אינטגרציית מהירות אורכית ללא מעבר אפס כתוצאה מבלימה
    let netForce = fDrive - fAero - fRoll;
    if (signV !== 0 && fBrakeMag > 0) {
      netForce -= signV * fBrakeMag;
    }

    const ax = netForce / p.massKg;
    let vNext = v + ax * dt;
    if (fDrive === 0 && ((v > 0 && vNext < 0) || (v < 0 && vNext > 0))) {
      vNext = 0;
    }
    if (Math.abs(vNext) < 1e-4 && fDrive === 0) {
      vNext = 0;
    }

    const vMid = 0.5 * (v + vNext);
    vehicle.axLong = (vNext - v) / dt;
    vehicle.speedMps = vNext;

    // 3. היגוי אופניים קינמטי עם הגבלת אחיזה רוחבית ריאלית (muLateralMax * g)
    const maxSteerAngle = 0.52; // ~30 מעלות במהירות נמוכה
    const speedFactor = 1 / (1 + Math.pow(Math.abs(vMid) / 16.0, 1.4));
    const delta = steer * maxSteerAngle * speedFactor;
    let yawRate = Math.abs(vMid) > 0.02 ? (vMid / p.wheelbaseM) * Math.tan(delta) : 0;
    const maxYawRate = Math.abs(vMid) > 0.5 ? (p.muLateralMax * G_FOOT) / Math.abs(vMid) : 4.0;
    yawRate = clamp(yawRate, -maxYawRate, maxYawRate);
    vehicle.yaw += yawRate * dt;
    vehicle.ayLat = vMid * yawRate;

    // 4. מתלים ב-4 פינות (קפיץ-מרסן + העברת משקל בצלילת בלימה וגלגול פנייה)
    const mCorner = p.massKg * 0.25;
    const dFPitch = (-vehicle.axLong * p.massKg * p.cgHeightM) / p.wheelbaseM; // חיובי בבלימה -> עומס קדמי
    const dFRoll = (vehicle.ayLat * p.massKg * p.cgHeightM) / p.trackWidthM;

    const cornerLoads = {
      fl: 0.5 * dFPitch - 0.5 * dFRoll,
      fr: 0.5 * dFPitch + 0.5 * dFRoll,
      rl: -0.5 * dFPitch - 0.5 * dFRoll,
      rr: -0.5 * dFPitch + 0.5 * dFRoll,
    };

    for (const key of ['fl', 'fr', 'rl', 'rr']) {
      const c = vehicle.suspension[key];
      const fSusp = -p.suspSpringNPerM * c.z - p.suspDamperNsPerM * c.vz + cornerLoads[key] * 0.15;
      c.vz += (fSusp / mCorner) * dt;
      c.z = clamp(c.z + c.vz * dt, -p.suspMaxTravelM, p.suspMaxTravelM);
      if (Math.abs(c.z) >= p.suspMaxTravelM) c.vz *= 0.2;
    }

    const frontAvgZ = 0.5 * (vehicle.suspension.fl.z + vehicle.suspension.fr.z);
    const rearAvgZ = 0.5 * (vehicle.suspension.rl.z + vehicle.suspension.rr.z);
    const leftAvgZ = 0.5 * (vehicle.suspension.fl.z + vehicle.suspension.rl.z);
    const rightAvgZ = 0.5 * (vehicle.suspension.fr.z + vehicle.suspension.rr.z);
    vehicle.pitchRad = Math.atan2(frontAvgZ - rearAvgZ, p.wheelbaseM);
    vehicle.rollRad = Math.atan2(rightAvgZ - leftAvgZ, p.trackWidthM);

    // 5. התקדמות במרחב host.js (yaw=0 פונה צפונה: fx=sin(yaw), fz=-cos(yaw)) + CCD
    const fx = Math.sin(vehicle.yaw);
    const fz = -Math.cos(vehicle.yaw);
    const stepDist = vMid * dt;
    const targetX = vehicle.x + fx * stepDist;
    const targetZ = vehicle.z + fz * stepDist;

    vehicle.vx = fx * vehicle.speedMps;
    vehicle.vz = fz * vehicle.speedMps;

    if (walls && walls.length > 0) {
      const ccd = collideCCD(
        { x: vehicle.x, y: vehicle.y, z: vehicle.z },
        { x: targetX, y: vehicle.y, z: targetZ },
        {
          kind: 'vehicle',
          radius: p.radiusM,
          height: p.heightM,
          vx: vehicle.vx,
          vz: vehicle.vz,
          restitution: 0.0,
        },
        walls
      );
      const actualMove = Math.hypot(ccd.x - vehicle.x, ccd.z - vehicle.z);
      vehicle.x = ccd.x;
      vehicle.z = ccd.z;
      vehicle.vx = ccd.vx;
      vehicle.vz = ccd.vz;
      vehicle.speedMps = ccd.vx * fx + ccd.vz * fz;
      vehicle.distanceTraveledM += actualMove;
      if (ccd.penetrationM > vehicle.maxPenetrationM) {
        vehicle.maxPenetrationM = ccd.penetrationM;
      }
    } else {
      vehicle.x = targetX;
      vehicle.z = targetZ;
      vehicle.distanceTraveledM += Math.abs(stepDist);
    }

    vehicle.fixedTicks += 1;
    return vehicle;
  }

  /**
   * צעד פריים עם צובר זמן קבוע (Fixed Timestep Accumulator 60Hz) — בלתי תלוי לחלוטין ב-FPS!
   */
  function stepVehicleFrame(vehicle, input, frameDt, walls = []) {
    const safeDt = clamp(isFiniteNum(frameDt) ? frameDt : FIXED_DT, 0, MAX_ACCUM_DT);
    vehicle.accumS = (vehicle.accumS || 0) + safeDt;
    let substeps = 0;
    const normWalls = walls && walls.length > 0 ? normalizeWallSegments(walls) : [];

    while (vehicle.accumS + 1e-12 >= FIXED_DT) {
      stepVehicleSubstep60Hz(vehicle, input, normWalls);
      vehicle.accumS = Math.max(0, vehicle.accumS - FIXED_DT);
      substeps++;
    }

    const alpha = clamp(vehicle.accumS / FIXED_DT, 0, 1);
    return {
      substeps,
      alpha,
      renderX: vehicle.prevX + (vehicle.x - vehicle.prevX) * alpha,
      renderY: vehicle.prevY + (vehicle.y - vehicle.prevY) * alpha,
      renderZ: vehicle.prevZ + (vehicle.z - vehicle.prevZ) * alpha,
    };
  }

  /**
   * סימולציית בלימת חירום מ-100 קמ"ש (או כל מהירות התחלתית) באספלט יבש בכל רצף זמני פריים.
   */
  function simulateVehicleBraking(options = {}) {
    const initialSpeedKmh = isFiniteNum(options.initialSpeedKmh) ? options.initialSpeedKmh : 100.0;
    const fps = isFiniteNum(options.fps) ? options.fps : 60;
    const frameDts = Array.isArray(options.frameDts) ? options.frameDts : null;

    const car = createVehicleState({
      speedMps: initialSpeedKmh / 3.6,
      params: { ...DEFAULT_VEHICLE_PARAMS, ...(options.params || {}) },
    });

    let frameIdx = 0;
    let elapsedWallS = 0;
    let peakDecelG = 0;

    while (car.speedMps > 0 && frameIdx < 10000) {
      const dt = frameDts ? frameDts[frameIdx % frameDts.length] : 1 / fps;
      stepVehicleFrame(car, { throttle: 0, brake: 1.0, steer: 0 }, dt, []);
      const decelG = Math.max(0, -car.axLong / G_FOOT);
      if (decelG > peakDecelG) peakDecelG = decelG;
      elapsedWallS += dt;
      frameIdx++;
    }

    return {
      initialSpeedKmh,
      fps: frameDts ? 'jitter' : fps,
      stoppingDistanceM: car.distanceTraveledM,
      fixedTicks: car.fixedTicks,
      stoppingTimeS: car.fixedTicks * FIXED_DT,
      elapsedWallS,
      peakDecelG,
      maxNoseDiveDeg: Math.abs((car.pitchRad * 180) / Math.PI),
    };
  }

  // =========================================================================
  // 4. תיקון מושב הנהג בגוף ראשון (35-camera / 57-vehicles): side = +0.37 (שמאל)
  // =========================================================================

  /**
   * מחשב מיקום וכיוון מצלמת נהג בגוף ראשון בצד שמאל של הרכב כנהוג בישראל (side = +0.37).
   * מוסכמת host.js: +X מזרח, +Y למעלה, +Z דרום.
   * עבור וקטור קדימה אופקי (fx, 0, fz) ווקטור למעלה (0, 1, 0):
   *   ימין = forward × up = (-fz, 0, fx)
   *   שמאל = up × forward = (fz, 0, -fx)
   * לכן side = +0.37 מזיז ב-+0.37 מ' לאורך וקטור שמאל (מושב הנהג הישראלי).
   */
  function computeDriverCameraPose(vehiclePose = {}, offsets = DRIVER_CAMERA_DEFAULTS) {
    const yaw = isFiniteNum(vehiclePose.yaw) ? vehiclePose.yaw : 0;
    const fx = isFiniteNum(vehiclePose.fx) ? vehiclePose.fx : Math.sin(yaw);
    const fz = isFiniteNum(vehiclePose.fz) ? vehiclePose.fz : -Math.cos(yaw);
    const fLen = Math.hypot(fx, fz) || 1;
    const fwdX = fx / fLen;
    const fwdZ = fz / fLen;

    // וקטור שמאל של הרכב במערכת צירים ימנית (up × forward)
    const leftX = fwdZ;
    const leftZ = -fwdX;

    const side = isFiniteNum(offsets.side) ? offsets.side : DRIVER_SEAT_SIDE;
    const up = isFiniteNum(offsets.up) ? offsets.up : DRIVER_CAMERA_DEFAULTS.up;
    const forward = isFiniteNum(offsets.forward) ? offsets.forward : DRIVER_CAMERA_DEFAULTS.forward;

    const vx = isFiniteNum(vehiclePose.x) ? vehiclePose.x : 0;
    const vy = isFiniteNum(vehiclePose.y) ? vehiclePose.y : 0;
    const vz = isFiniteNum(vehiclePose.z) ? vehiclePose.z : 0;

    return {
      x: vx + leftX * side + fwdX * forward,
      y: vy + up,
      z: vz + leftZ * side + fwdZ * forward,
      side,
      up,
      forward,
      forwardVec: { x: fwdX, y: 0, z: fwdZ },
      leftVec: { x: leftX, y: 0, z: leftZ },
      rightVec: { x: -leftX, y: 0, z: -leftZ },
    };
  }

  function patchDriverCameraInWorld(world) {
    if (!world || typeof world !== 'object') return { patched: false };
    const targets = [
      world.cameraRig,
      world.cameraConfig,
      world.vehiclesConfig,
      world.mods && world.mods['35-camera'],
      world.mods && world.mods['57-vehicles'],
      world.YZVehicles,
    ].filter(Boolean);

    let patchedCount = 0;
    for (const t of targets) {
      if (typeof t === 'object') {
        if (t.driverSeatSide === undefined || t.driverSeatSide === LEGACY_DRIVER_SEAT_SIDE || t.side === LEGACY_DRIVER_SEAT_SIDE) {
          t.previousSide = t.side ?? t.driverSeatSide ?? LEGACY_DRIVER_SEAT_SIDE;
        }
        t.side = DRIVER_SEAT_SIDE;
        t.driverSeatSide = DRIVER_SEAT_SIDE;
        if (t.fpvOffset && typeof t.fpvOffset === 'object') {
          t.fpvOffset.side = DRIVER_SEAT_SIDE;
        }
        patchedCount++;
      }
    }

    world.driverCamera = {
      side: DRIVER_SEAT_SIDE,
      up: DRIVER_CAMERA_DEFAULTS.up,
      forward: DRIVER_CAMERA_DEFAULTS.forward,
      computePose: computeDriverCameraPose,
    };

    return { patched: true, side: DRIVER_SEAT_SIDE, targetsPatched: patchedCount };
  }

  // =========================================================================
  // 5. תיקון ציר הצד ההפוך בג'ויסטיק ובמקשי A-D (moveFoot)
  // =========================================================================

  /**
   * מחשב וקטור מהירות אופקי של הדמות כך ש:
   * - forwardInput > 0 (מקש W / ג'ויסטיק למעלה) מזיז קדימה בכיוון המבט (fx, 0, fz).
   * - strafeInput > 0 (מקש D / ג'ויסטיק ימינה) מזיז ימינה בכיוון (forward × up) = (-fz, 0, fx).
   * - strafeInput < 0 (מקש A / ג'ויסטיק שמאלה) מזיז שמאלה.
   */
  function computeFootHorizontalVelocity(input = {}, heading = {}, speedMps = 5.4) {
    let fx;
    let fz;
    if (isFiniteNum(heading.fx) && isFiniteNum(heading.fz)) {
      const len = Math.hypot(heading.fx, heading.fz) || 1;
      fx = heading.fx / len;
      fz = heading.fz / len;
    } else {
      const yaw = isFiniteNum(heading.yaw) ? heading.yaw : isFiniteNum(heading) ? heading : 0;
      fx = Math.sin(yaw);
      fz = -Math.cos(yaw);
    }

    // וקטור ימין במערכת צירים תלת-ממדית ימנית (X מזרח, Y למעלה, Z דרום):
    // right = forward × up = (fx, 0, fz) × (0, 1, 0) = (-fz, 0, fx)
    const rightX = -fz;
    const rightZ = fx;

    const rawForward =
      (Number(input.forward) || 0) +
      (input.keyW ? 1 : 0) -
      (input.keyS ? 1 : 0) +
      (Number(input.joyY) || 0);

    const rawStrafe =
      (Number(input.strafe) || 0) +
      (input.keyD ? 1 : 0) -
      (input.keyA ? 1 : 0) +
      (Number(input.joyX) || 0);

    const mag = Math.hypot(rawForward, rawStrafe);
    const normScale = mag > 1.0 ? 1 / mag : 1.0;
    const fCmd = rawForward * normScale;
    const sCmd = rawStrafe * normScale;

    const vx = (fx * fCmd + rightX * sCmd) * speedMps;
    const vz = (fz * fCmd + rightZ * sCmd) * speedMps;

    return {
      vx,
      vz,
      forwardVec: { x: fx, z: fz },
      rightVec: { x: rightX, z: rightZ },
      rightProjection: vx * rightX + vz * rightZ,
      forwardProjection: vx * fx + vz * fz,
    };
  }

  function moveFoot(charState, input = {}, dt = FIXED_DT, env = {}) {
    const speed = isFiniteNum(charState.walkSpeedMps) ? charState.walkSpeedMps : 5.4;
    const vel = computeFootHorizontalVelocity(input, { yaw: charState.yaw || 0 }, speed);
    const targetX = (charState.x || 0) + vel.vx * dt;
    const targetZ = (charState.z || 0) + vel.vz * dt;

    if (env.walls && env.walls.length > 0) {
      const ccd = collideCCD(
        { x: charState.x || 0, y: charState.y || 0, z: charState.z || 0 },
        { x: targetX, y: charState.y || 0, z: targetZ },
        { kind: 'foot', radius: BODY_RADII.foot, height: 1.78, vx: vel.vx, vz: vel.vz },
        env.walls
      );
      charState.x = ccd.x;
      charState.z = ccd.z;
      charState.vx = ccd.vx;
      charState.vz = ccd.vz;
    } else {
      charState.x = targetX;
      charState.z = targetZ;
      charState.vx = vel.vx;
      charState.vz = vel.vz;
    }

    if (input.jump && charState.onGround) {
      const jumpHeight = isFiniteNum(env.jumpHeightM) ? env.jumpHeightM : 1.05;
      charState.vy = Math.sqrt(2 * G_FOOT * jumpHeight);
      charState.onGround = false;
    }

    stepFootVerticalSubstep(charState, dt, env);
    return charState;
  }

  /**
   * עטיפה אידמפוטנטית של game.moveFoot הקיים: בודקת אוטומטית אם ציר הצד הפוך,
   * והופכת את אות הצד רק אם הפונקציה המקורית מזיזה שמאלה בלחיצה ימינה (מונע היפוך כפול).
   */
  function patchLegacyMoveFoot(gameObj) {
    if (!gameObj || typeof gameObj !== 'object') return { patched: false };
    if (gameObj.__eshMoveFootPatched) {
      return { patched: true, alreadyPatched: true, invertedDetected: gameObj.__eshWasInverted };
    }

    const orig = typeof gameObj.moveFoot === 'function' ? gameObj.moveFoot : null;
    if (!orig) {
      gameObj.moveFoot = moveFoot;
      gameObj.__eshMoveFootPatched = true;
      gameObj.__eshWasInverted = false;
      return { patched: true, installedCanonical: true };
    }

    // בדיקת גישוש יבשה על עותק מבודד כדי לזהות אם הפונקציה הישנה הופכת את ציר הצד
    let invertedDetected = true;
    try {
      const probe = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, vy: 0, onGround: true };
      orig.call(gameObj, probe, { strafe: 1, forward: 0, joyX: 0, joyY: 0 }, FIXED_DT, {});
      // במבט צפונה (yaw=0 -> forward=(0,-1)), ימינה הוא +X (מזרח). אם probe.x < 0, הציר הפוך!
      if (isFiniteNum(probe.x) && Math.abs(probe.x) > 1e-6) {
        invertedDetected = probe.x < 0;
      }
    } catch (_) {
      invertedDetected = true;
    }

    const wrapped = function patchedMoveFoot(state, input = {}, dt = FIXED_DT, env = {}) {
      const fixedInput = invertedDetected
        ? {
            ...input,
            strafe: -(Number(input.strafe) || 0),
            joyX: -(Number(input.joyX) || 0),
            keyA: Boolean(input.keyD),
            keyD: Boolean(input.keyA),
          }
        : input;
      const res = orig.call(this, state, fixedInput, dt, env);
      ensureAboveSeaFloor(state, env);
      return res;
    };

    gameObj.__origMoveFoot = orig;
    gameObj.moveFoot = wrapped;
    gameObj.__eshMoveFootPatched = true;
    gameObj.__eshWasInverted = invertedDetected;

    return { patched: true, invertedDetected };
  }

  // =========================================================================
  // 6. רישום מלא למארח YZW (host/host.js) ב-order: 12 עם dispose נקי
  // =========================================================================

  function applyAllFixesToWorld(world) {
    if (!world || typeof world !== 'object') {
      throw new TypeError('applyAllFixesToWorld requires a valid world object');
    }

    const prev = {
      G_FOOT: world.G_FOOT,
      collide: world.collide,
      gameGFoot: world.game ? world.game.G_FOOT : undefined,
    };

    world.G_FOOT = G_FOOT;
    if (world.game && typeof world.game === 'object') {
      world.game.G_FOOT = G_FOOT;
      patchLegacyMoveFoot(world.game);
    }

    patchDriverCameraInWorld(world);

    // החלפת W.collide בהתנגשות רציפה CCD השומרת תאימות לאחור
    world.collide = function phys2CollideAdapter(pos, prevPosOrRadius, maybeRadius, maybeHeight) {
      let startPos;
      let radius = BODY_RADII.foot;
      let height = 1.75;

      if (prevPosOrRadius && typeof prevPosOrRadius === 'object') {
        startPos = prevPosOrRadius;
        if (isFiniteNum(maybeRadius)) radius = maybeRadius;
        if (isFiniteNum(maybeHeight)) height = maybeHeight;
      } else {
        startPos = {
          x: isFiniteNum(pos.prevX) ? pos.prevX : pos.x,
          y: isFiniteNum(pos.prevY) ? pos.prevY : pos.y || 0,
          z: isFiniteNum(pos.prevZ) ? pos.prevZ : pos.z,
        };
        if (isFiniteNum(prevPosOrRadius)) radius = prevPosOrRadius;
        if (isFiniteNum(maybeRadius)) height = maybeRadius;
      }

      const walls = world.walls || world.buildings || [];
      const res = collideCCD(
        startPos,
        pos,
        { kind: pos.kind, radius, height, vx: pos.vx || 0, vz: pos.vz || 0 },
        walls
      );
      pos.x = res.x;
      pos.z = res.z;
      if (isFiniteNum(pos.vx)) pos.vx = res.vx;
      if (isFiniteNum(pos.vz)) pos.vz = res.vz;
      return res;
    };

    world.phys2 = {
      G_FOOT,
      FIXED_HZ,
      FIXED_DT,
      SEA_LEVEL,
      DRIVER_SEAT_SIDE,
      createVehicleState,
      stepVehicleFrame,
      simulateVehicleBraking,
      collideCCD,
      ensureAboveSeaFloor,
      exitBoatSafe,
      landJetpackSafe,
      computeDriverCameraPose,
      computeFootHorizontalVelocity,
      moveFoot,
    };

    return {
      restore() {
        world.G_FOOT = prev.G_FOOT;
        world.collide = prev.collide;
        if (world.game && prev.gameGFoot !== undefined) {
          world.game.G_FOOT = prev.gameGFoot;
        }
        if (world.game && world.game.__origMoveFoot) {
          world.game.moveFoot = world.game.__origMoveFoot;
          delete world.game.__origMoveFoot;
          delete world.game.__eshMoveFootPatched;
        }
        delete world.phys2;
      },
    };
  }

  function createHostDescriptor() {
    let handle = null;
    return {
      id: 'phys2-core-fixes',
      name: 'ליבת פיזיקה ותנועה מאוחדת (phys2 · G_FOOT=9.81 · בלם 41.4מ׳ · CCD · ים · נהג שמאל · A-D)',
      dept: 'architect',
      order: 12,
      scripts: [],
      init(world, hostApi) {
        handle = applyAllFixesToWorld(world);
        if (hostApi && typeof hostApi.emit === 'function') {
          hostApi.emit('phys2:ready', {
            G_FOOT,
            fixedHz: FIXED_HZ,
            driverSeatSide: DRIVER_SEAT_SIDE,
            seaLevel: SEA_LEVEL,
          });
        }
        return handle;
      },
      dispose() {
        if (handle && typeof handle.restore === 'function') {
          handle.restore();
          handle = null;
        }
      },
      get modes() {
        return [];
      },
    };
  }

  function registerWithHost(yzw) {
    if (!yzw || typeof yzw.register !== 'function') {
      throw new TypeError('YZW host with register(descriptor) is required');
    }
    const descriptor = createHostDescriptor();
    yzw.register(descriptor);
    return descriptor;
  }

  return {
    G_FOOT,
    LEGACY_G_FOOT,
    FIXED_HZ,
    FIXED_DT,
    SEA_LEVEL,
    LEGACY_SEAFLOOR_Y,
    DRIVER_SEAT_SIDE,
    LEGACY_DRIVER_SEAT_SIDE,
    DRIVER_CAMERA_DEFAULTS,
    BODY_RADII,
    DEFAULT_VEHICLE_PARAMS,
    isWaterLocation,
    ensureAboveSeaFloor,
    exitBoatSafe,
    landJetpackSafe,
    stepFootVerticalSubstep,
    simulateFreeFall,
    normalizeWallSegments,
    measureMaxWallPenetration,
    collideCCD,
    createVehicleState,
    stepVehicleSubstep60Hz,
    stepVehicleFrame,
    simulateVehicleBraking,
    computeDriverCameraPose,
    patchDriverCameraInWorld,
    computeFootHorizontalVelocity,
    moveFoot,
    patchLegacyMoveFoot,
    applyAllFixesToWorld,
    createHostDescriptor,
    registerWithHost,
  };
});
