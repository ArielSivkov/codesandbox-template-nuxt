/* [Claude 23.11.2026 18:30] שילוב גרסה 3 של Gemini אחרי בדיקה נפרדת:
 *  ✔ הגוף אטום – נבדק: 360 משולשים, 0 צלעות פתוחות, 0 צלעות שאינן יריעה (tools/test-ariel-car.js).
 *  ✔ 0 ערכי NaN, ~4.3k משולשים (במקום 13.6k בגרסה 2).
 *  ✘→✔ הגוף והזכוכית היו הפוכים (נפח מסומן שלילי) – מבחוץ הקירות נעלמו. מתוקן כאן (flipWinding) ונבדק.
 *  ✘ 116 רשתות = 116 קריאות ציור – יותר מכל תקציב הטלפון. לכן מאחדים לפי חומר: גוף אחד לכל חומר + 4 גלגלים מאוחדים
 *    → 29 קריאות (גרסה 2: 34). לשם כך דיסק הבלם צבוע כמתכת הכהה, כובע הגלגל כחישורים, המחזיר כפנס האחורי (שינוי זעיר).
 *  ✘ החניה ברחוב האורן לא נכנסת: המיקום מחושב במסגרת "K Towers 2 = 0,0" שאינה מסגרת העולם – לא אומת, לא ממציאים.
 *  מקורב: הצורה לפי תמונות 075–083 (לא סריקה); אורך גוף 3.973 מ' (A1 8X אחרי מתיחת פנים; לפני: 3.954).
 */
'use strict';
/**
 * בס"ד
 * twin/integration/world/adapters/57-ariel-car.js
 *
 * גרסה 3 (אטומה ומעוגלת – מחליפה את קומיט 8c458eb לבקשת אריאל וקלוד מ-17:05):
 * - מעטפת גוף אחודה ואטומה לחלוטין (Watertight Stitched Cross-Section Loft ב-BufferGeometry):
 *   אפס חורים בדלת תא המטען, אפס חריצים במכסה המנוע ואפס משולשים תלושים בפגוש.
 * - מידות יצרן מדויקות של Audi A1 (8X) 3-Door Hatchback (תמונות 075–083):
 *   אורך 3.973 מ' · רוחב 1.740 מ' · גובה 1.416 מ' · בסיס גלגלים 2.469 מ' · רדיוס גלגל 0.308 מ'.
 * - פרטי אמת מצילומי השטח 075–083:
 *   1. גריל Singleframe משושה שחור-מבריק עם מסגרת כרום, 4 טבעות כרום שלובות ולוחית 73-464-53 (באישור אריאל).
 *   2. פנסי חזית טרפזיים חדים עם פס DRL חם וכונסי אוויר תחתונים בפינות הפגוש (תמונה 076).
 *   3. פרופיל 3 דלתות אמיתי (תמונה 079): דלת קדמית ארוכה, חלון צד אחורי משולש חד, קשת גג לבנה קמורה,
 *      ספוילר גג אחורי שחור-מבריק ומגב אחורי.
 *   4. דלת תא מטען Clamshell סגורה ואטומה עם פנסים אחוריים אדומים עוטפים, סמלי A1 / TFSI, 4 חיישני רוורס,
 *      דיפיוזר תחתון שחור וזוג יציאות מפלט בצד שמאל (תמונות 081–082).
 *   5. חישוקי סגסוגת 10 חישורים כסופים עם דיסקי בלימה וקליפרים + סיבוב והיגוי גלגלים חי.
 *   6. קוקפיט נהג שמאלי (מושבים בגוון בז' מתמונה 076, הגה 3 חישורים משמאל, שעונים באור אדום ומסך MMI מתמונה 083).
 *   7. מפרץ החניה ממרצפות כהות ברחוב האורן (ITM E=166022.4, N=635073.7 ב-EPSG:2039 מיושר לעוגן K Towers 2).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = root.ESHArielCar57 = factory();
  } else {
    var api = factory();
    root.ESHArielCar57 = api;
    root.ArielCar = api;
    // [Claude 23.11 18:30] בלי רישום אוטומטי: mountInWorld של החבילה מחפש world.playerCar (לא קיים אצלנו) וממקם רכב חונה
    // לפי מסגרת שאינה מסגרת העולם. הרישום נעשה בסוף הקובץ דרך החיבור הקיים (userData.wheels).
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  var SPECS = Object.freeze({
    id: 'ariel-car',
    adapterOrder: 57,
    model: 'Audi A1 (8X) 1.4 TFSI 3-Door Hatchback',
    lengthM: 3.973,
    widthM: 1.740,
    heightM: 1.416,
    wheelbaseM: 2.469,
    frontAxleZ: 1.245,
    rearAxleZ: -1.224,
    trackWidthM: 1.475,
    wheelRadiusM: 0.308,
    wheelWidthM: 0.215,
    driverEyeLocal: Object.freeze({ x: -0.37, y: 1.14, z: 0.10 }),
    driverSeatSidePhys2: +0.37,
    licensePlate: '73-464-53',
    ownerApprovedPlate: true,
    thirdPartyPlatesStored: 0,
    parkingBayItm: Object.freeze({
      easting: 166022.4,
      northing: 635073.7,
      epsg: 'EPSG:2039',
      headingDeg: 38.0
    }),
    anchorOriginItm: Object.freeze({
      name: 'K Towers 2',
      easting: 165894.9,
      northing: 634049.8
    }),
    sourceUrl: 'https://en.wikipedia.org/wiki/Audi_A1'
  });

  /**
   * 17 longitudinal stations from rear bumper (z = -1.9865) to front bumper (z = +1.9865).
   * Each station defines: [z, yBottom, halfWidthBottom, yBelt, halfWidthBelt, yShoulder, halfWidthShoulder, yTop, halfWidthTop]
   * Every adjacent station pair shares exact topology (12 perimeter vertices around cross-section)
   * with closed front and rear caps -> 100% watertight manifold shell!
   */
  var BODY_STATIONS = [
    // Rear bumper tip & lower diffuser curve
    [-1.9865, 0.27, 0.62, 0.44, 0.72, 0.60, 0.70, 0.72, 0.58],
    [-1.9200, 0.22, 0.75, 0.52, 0.83, 0.76, 0.79, 0.88, 0.67],
    // Clamshell tailgate & wraparound taillight belt
    [-1.7800, 0.21, 0.82, 0.58, 0.865, 0.88, 0.81, 1.01, 0.68],
    // Rear C-pillar base & sloped rear glass start (42 deg rake)
    [-1.5200, 0.22, 0.85, 0.62, 0.870, 0.94, 0.80, 1.22, 0.62],
    // Rear axle center (z = -1.224) with flared rear arch shoulder
    [-1.2240, 0.24, 0.86, 0.64, 0.875, 0.95, 0.80, 1.375, 0.585],
    // Rear quarter window & roof arch peak
    [-0.8200, 0.20, 0.855, 0.63, 0.868, 0.94, 0.795, 1.412, 0.595],
    // B-pillar (end of long 3-door front door)
    [-0.2800, 0.19, 0.855, 0.62, 0.868, 0.93, 0.795, 1.416, 0.600],
    // Cabin center / driver seat
    [ 0.1800, 0.19, 0.855, 0.61, 0.868, 0.92, 0.790, 1.395, 0.595],
    // Top of windshield / A-pillar header
    [ 0.5200, 0.19, 0.855, 0.60, 0.865, 0.91, 0.780, 1.335, 0.580],
    // Base of windshield / cowl (seamless transition to hood - NO gap!)
    [ 0.9600, 0.20, 0.855, 0.58, 0.862, 0.875, 0.770, 0.915, 0.650],
    // Front axle center (z = +1.245) with flared front arch
    [ 1.2450, 0.23, 0.860, 0.56, 0.872, 0.835, 0.755, 0.875, 0.630],
    // Mid-hood gentle curve
    [ 1.5600, 0.20, 0.840, 0.52, 0.850, 0.775, 0.725, 0.815, 0.590],
    // Headlight & Singleframe grille upper brow
    [ 1.8200, 0.19, 0.795, 0.46, 0.815, 0.695, 0.680, 0.730, 0.530],
    // Front bumper nose & Singleframe grille plane
    [ 1.9500, 0.19, 0.720, 0.40, 0.745, 0.600, 0.610, 0.650, 0.470],
    // Front lower lip tip
    [ 1.9865, 0.21, 0.610, 0.35, 0.640, 0.490, 0.530, 0.540, 0.410]
  ];

  function createRingPoints(st) {
    var z = st[0];
    var yB = st[1], wB = st[2];
    var yM = st[3], wM = st[4];
    var yS = st[5], wS = st[6];
    var yT = st[7], wT = st[8];
    // Lift bottom slightly near wheel wells so tires never z-fight underbody
    var inRearWell = Math.abs(z - SPECS.rearAxleZ) < 0.36;
    var inFrontWell = Math.abs(z - SPECS.frontAxleZ) < 0.36;
    var sideLift = (inRearWell || inFrontWell) ? 0.13 : 0.0;

    // 12 points counter-clockwise looking from +Z (front):
    return [
      [ 0.0,        yB,            z], // 0: bottom center
      [ wB * 0.72,  yB,            z], // 1: bottom right inner
      [ wB,         yB + sideLift, z], // 2: lower rocker right
      [ wM,         yM,            z], // 3: mid-body / Tornado bulge right
      [ wS,         yS,            z], // 4: beltline / shoulder right
      [ wT,         yT - 0.025,    z], // 5: roof cantrail right
      [ 0.0,        yT,            z], // 6: roof crown center
      [-wT,         yT - 0.025,    z], // 7: roof cantrail left
      [-wS,         yS,            z], // 8: beltline / shoulder left
      [-wM,         yM,            z], // 9: mid-body / Tornado bulge left
      [-wB,         yB + sideLift, z], // 10: lower rocker left
      [-wB * 0.72,  yB,            z]  // 11: bottom left inner
    ];
  }

  function buildWatertightBodyGeometry(THREE) {
    var ringSize = 12;
    var numRings = BODY_STATIONS.length;
    var positions = [];
    var indices = [];

    for (var r = 0; r < numRings; r++) {
      var pts = createRingPoints(BODY_STATIONS[r]);
      for (var p = 0; p < ringSize; p++) {
        positions.push(pts[p][0], pts[p][1], pts[p][2]);
      }
    }

    for (var r2 = 0; r2 < numRings - 1; r2++) {
      var baseA = r2 * ringSize;
      var baseB = (r2 + 1) * ringSize;
      for (var i = 0; i < ringSize; i++) {
        var next = (i + 1) % ringSize;
        var a0 = baseA + i;
        var a1 = baseA + next;
        var b0 = baseB + i;
        var b1 = baseB + next;
        indices.push(a0, b0, b1);
        indices.push(a0, b1, a1);
      }
    }

    // Rear cap (ring 0)
    var rearCenterIdx = positions.length / 3;
    positions.push(0.0, 0.50, BODY_STATIONS[0][0]);
    for (var j = 0; j < ringSize; j++) {
      var jNext = (j + 1) % ringSize;
      indices.push(rearCenterIdx, jNext, j);
    }

    // Front cap (last ring)
    var frontCenterIdx = positions.length / 3;
    var lastBase = (numRings - 1) * ringSize;
    positions.push(0.0, 0.38, BODY_STATIONS[numRings - 1][0]);
    for (var k = 0; k < ringSize; k++) {
      var kNext = (k + 1) % ringSize;
      indices.push(frontCenterIdx, lastBase + k, lastBase + kNext);
    }

    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  function buildGreenhouseLoftGeometry(THREE) {
    // Sleek dark-tinted wrap-around window shell slightlyproud (+6mm) over cabin beltline..roof
    // Stations from z = -1.50 (rear glass bottom) to z = +0.94 (windshield base)
    var winStations = [
      [-1.50, 0.945, 0.690, 1.215, 0.560],
      [-1.22, 0.955, 0.760, 1.355, 0.545],
      [-0.82, 0.945, 0.785, 1.385, 0.565],
      [-0.28, 0.935, 0.788, 1.388, 0.570],
      [ 0.18, 0.925, 0.782, 1.368, 0.565],
      [ 0.52, 0.915, 0.768, 1.312, 0.552],
      [ 0.93, 0.885, 0.690, 0.922, 0.610]
    ];
    var ringLen = 6;
    var pos = [];
    var idx = [];
    for (var r = 0; r < winStations.length; r++) {
      var s = winStations[r];
      var z = s[0], yLo = s[1], wLo = s[2] + 0.007, yHi = s[3], wHi = s[4] + 0.005;
      var ring = [
        [ 0.0,  yLo + 0.01, z + (r === winStations.length - 1 ? 0.012 : (r === 0 ? -0.012 : 0))],
        [ wLo,  yLo,        z],
        [ wHi,  yHi,        z],
        [ 0.0,  yHi + 0.005,z + (r === 0 ? -0.010 : 0)],
        [-wHi,  yHi,        z],
        [-wLo,  yLo,        z]
      ];
      for (var p = 0; p < ringLen; p++) {
        pos.push(ring[p][0], ring[p][1], ring[p][2]);
      }
    }
    for (var r2 = 0; r2 < winStations.length - 1; r2++) {
      var a = r2 * ringLen, b = (r2 + 1) * ringLen;
      for (var i = 0; i < ringLen; i++) {
        var n = (i + 1) % ringLen;
        idx.push(a + i, b + i, b + n);
        idx.push(a + i, b + n, a + n);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function makePlateMaterial(THREE, text) {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      try {
        var c = document.createElement('canvas');
        c.width = 256;
        c.height = 64;
        var ctx = c.getContext('2d');
        if (ctx) {
          // Black GOOD CAR surround frame
          ctx.fillStyle = '#111318';
          ctx.fillRect(0, 0, 256, 64);
          // Israeli yellow reflective plate
          ctx.fillStyle = '#facc15';
          ctx.fillRect(6, 6, 244, 48);
          // Blue IL euro-band on left
          ctx.fillStyle = '#1d4ed8';
          ctx.fillRect(6, 6, 30, 48);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 14px sans-serif';
          ctx.fillText('IL', 13, 46);
          // Crisp license digits (approved by owner Ariel)
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 33px monospace';
          ctx.fillText(text, 44, 42);
          var tex = new THREE.CanvasTexture(c);
          return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.08 });
        }
      } catch (_) {}
    }
    return new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.38, metalness: 0.1 });
  }

  function buildAudiRings(THREE, chromeMat, scale) {
    var grp = new THREE.Group();
    var r = 0.032 * scale;
    var tube = 0.0055 * scale;
    var spacing = 0.046 * scale;
    for (var i = 0; i < 4; i++) {
      var ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 5, 12), chromeMat);
      ring.position.x = (i - 1.5) * spacing;
      grp.add(ring);
    }
    return grp;
  }

  function buildAlloyWheel10Spoke(THREE, mats) {
    var wheelGroup = new THREE.Group();
    var R = SPECS.wheelRadiusM;
    var W = SPECS.wheelWidthM;

    // Rubber tire cylinder (rotated so cylinder axis = X)
    var tire = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 18), mats.tire);
    tire.rotation.z = Math.PI * 0.5;
    tire.castShadow = true;
    wheelGroup.add(tire);

    // Outer silver alloy rim barrel
    var rimR = R * 0.70;
    var rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, W + 0.006, 14), mats.alloy);
    rim.rotation.z = Math.PI * 0.5;
    wheelGroup.add(rim);

    // Recessed dark wheel well dish
    var dish = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.88, rimR * 0.88, W + 0.008, 14), mats.darkMetal);
    dish.rotation.z = Math.PI * 0.5;
    wheelGroup.add(dish);

    // Brake disc + caliper inside
    var disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.72, rimR * 0.72, 0.025, 12), mats.brakeDisc);
    disc.rotation.z = Math.PI * 0.5;
    wheelGroup.add(disc);

    // 10 crisp silver spokes on both outer faces (+X and -X so left & right wheels both look authentic)
    var spokeGeom = new THREE.BoxGeometry(0.016, rimR * 0.86, 0.024);
    for (var s = 0; s < 5; s++) {
      var ang = (s / 5) * Math.PI;
      var spR = new THREE.Mesh(spokeGeom, mats.alloyBright);
      spR.position.x = W * 0.48;
      spR.rotation.x = ang;
      wheelGroup.add(spR);

      var spL = new THREE.Mesh(spokeGeom, mats.alloyBright);
      spL.position.x = -W * 0.48;
      spL.rotation.x = ang;
      wheelGroup.add(spL);
    }

    // Center Audi hub cap
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, W + 0.022, 12), mats.chrome);
    cap.rotation.z = Math.PI * 0.5;
    wheelGroup.add(cap);

    return wheelGroup;
  }

  function buildAudiA1Mesh(THREE) {
    var car = new THREE.Group();
    car.name = 'ESH27_Ariel_Audi_A1_v3_Watertight';

    var mats = {
      paint: new THREE.MeshStandardMaterial({ color: 0xf7f8fa, roughness: 0.19, metalness: 0.14 }),
      glossBlack: new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.18, metalness: 0.35 }),
      matteBlack: new THREE.MeshStandardMaterial({ color: 0x181b20, roughness: 0.78, metalness: 0.08 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x141e2e, roughness: 0.06, metalness: 0.72, transparent: true, opacity: 0.84 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.12, metalness: 0.94 }),
      alloy: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.25, metalness: 0.78 }),
      alloyBright: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.18, metalness: 0.86 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x1f242d, roughness: 0.65, metalness: 0.45 }),
      brakeDisc: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.42, metalness: 0.70 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.88, metalness: 0.04 }),
      headlight: new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0xfff3c4, emissiveIntensity: 0.85, roughness: 0.12 }),
      taillight: new THREE.MeshStandardMaterial({ color: 0xb91c1c, emissive: 0xef4444, emissiveIntensity: 0.78, roughness: 0.18 }),
      reflector: new THREE.MeshStandardMaterial({ color: 0x991b1b, emissive: 0xdc2626, emissiveIntensity: 0.35 }),
      seatBeige: new THREE.MeshStandardMaterial({ color: 0xcbbba0, roughness: 0.72, metalness: 0.02 }),
      dashDark: new THREE.MeshStandardMaterial({ color: 0x1e2229, roughness: 0.62, metalness: 0.12 }),
      mmiScreen: new THREE.MeshStandardMaterial({ color: 0x1e1b18, emissive: 0xd97706, emissiveIntensity: 0.55 }),
      gaugeRed: new THREE.MeshStandardMaterial({ color: 0x221416, emissive: 0xef4444, emissiveIntensity: 0.65 }),
      plate: makePlateMaterial(THREE, SPECS.licensePlate)
    };

    // 1. Watertight outer white body shell (zero gaps, zero holes)
    var bodyMesh = new THREE.Mesh(buildWatertightBodyGeometry(THREE), mats.paint);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    car.add(bodyMesh);

    // 2. Wrap-around dark tinted greenhouse + white roof crown panel + white C-pillar arches
    var glassShell = new THREE.Mesh(buildGreenhouseLoftGeometry(THREE), mats.glass);
    car.add(glassShell);

    // White roof center panel sitting cleanly between left & right roof cantrails (matching 077/079/082)
    var roofCrown = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.032, 1.62), mats.paint);
    roofCrown.position.set(0, 1.404, -0.22);
    car.add(roofCrown);

    // 3-door B-pillar black vertical trim + white C-pillar fastback arch strips
    [-1, 1].forEach(function (side) {
      var bPillar = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.42, 0.075), mats.glossBlack);
      bPillar.position.set(side * 0.785, 1.15, -0.26);
      bPillar.rotation.z = side * 0.24;
      car.add(bPillar);

      var cArch = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.46, 0.18), mats.paint);
      cArch.position.set(side * 0.735, 1.15, -1.24);
      cArch.rotation.x = 0.58;
      cArch.rotation.z = side * 0.28;
      car.add(cArch);

      // Sleek Tornado character crease & body-colored 3-door handle (photo 079)
      var handle = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.034, 0.16), mats.paint);
      handle.position.set(side * 0.872, 0.84, -0.10);
      car.add(handle);

      // Door-shoulder white side mirrors on black stalks (photos 076, 079, 087)
      var stalk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), mats.glossBlack);
      stalk.position.set(side * 0.84, 0.90, 0.62);
      car.add(stalk);

      var mirrorCap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.095, 0.11), mats.paint);
      mirrorCap.position.set(side * 0.91, 0.94, 0.60);
      car.add(mirrorCap);

      // Sculpted wheel-arch lip flares (front & rear)
      [SPECS.frontAxleZ, SPECS.rearAxleZ].forEach(function (az) {
        var arch = new THREE.Mesh(
          new THREE.TorusGeometry(0.345, 0.032, 5, 12, Math.PI),
          mats.paint
        );
        arch.rotation.y = Math.PI * 0.5;
        arch.position.set(side * 0.842, 0.315, az);
        car.add(arch);

        // Dark inner wheelhouse liner so you never see through the arch!
        var liner = new THREE.Mesh(
          new THREE.CylinderGeometry(0.335, 0.335, 0.24, 10, 1, false, 0, Math.PI),
          mats.matteBlack
        );
        liner.rotation.z = Math.PI * 0.5;
        liner.rotation.x = -Math.PI * 0.5;
        liner.position.set(side * 0.74, 0.315, az);
        car.add(liner);
      });
    });

    // Gloss-black rear roof lip spoiler & rear wiper (photos 079, 081, 082)
    var spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.045, 0.19), mats.glossBlack);
    spoiler.position.set(0, 1.355, -1.29);
    spoiler.rotation.x = -0.12;
    car.add(spoiler);

    var rearWiper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.018, 0.022), mats.matteBlack);
    rearWiper.position.set(0.12, 0.96, -1.525);
    rearWiper.rotation.z = -0.08;
    car.add(rearWiper);

    // 3. Authentic Front Fascia (Photo 076): Singleframe grille, chrome surround, 4 rings, headlights, lower intakes
    var grilleChrome = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.42, 0.04), mats.chrome);
    grilleChrome.position.set(0, 0.44, 1.948);
    grilleChrome.rotation.x = -0.12;
    car.add(grilleChrome);

    var grilleCore = new THREE.Mesh(new THREE.BoxGeometry(0.77, 0.38, 0.046), mats.glossBlack);
    grilleCore.position.set(0, 0.44, 1.951);
    grilleCore.rotation.x = -0.12;
    car.add(grilleCore);

    var frontRings = buildAudiRings(THREE, mats.chrome, 1.0);
    frontRings.position.set(0, 0.555, 1.972);
    frontRings.rotation.x = -0.12;
    car.add(frontRings);

    var frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.115, 0.02), mats.plate);
    frontPlate.position.set(0, 0.375, 1.976);
    frontPlate.rotation.x = -0.10;
    car.add(frontPlate);

    // Angled wedge headlights + lower corner honeycomb fog intakes
    [-1, 1].forEach(function (side) {
      var hlHousing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.125, 0.16), mats.glossBlack);
      hlHousing.position.set(side * 0.61, 0.605, 1.845);
      hlHousing.rotation.y = -side * 0.28;
      hlHousing.rotation.z = -side * 0.11;
      car.add(hlHousing);

      var hlLens = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.095, 0.04), mats.headlight);
      hlLens.position.set(side * 0.615, 0.608, 1.915);
      hlLens.rotation.y = -side * 0.28;
      hlLens.rotation.z = -side * 0.11;
      car.add(hlLens);

      var fogIntake = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.105, 0.05), mats.matteBlack);
      fogIntake.position.set(side * 0.61, 0.285, 1.915);
      fogIntake.rotation.y = -side * 0.24;
      car.add(fogIntake);
    });

    // 4. Authentic Rear Clamshell Tailgate & Bumper (Photos 081, 082)
    [-1, 1].forEach(function (side) {
      var tlOuter = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.135, 0.16), mats.taillight);
      tlOuter.position.set(side * 0.60, 0.805, -1.855);
      tlOuter.rotation.y = side * 0.22;
      tlOuter.rotation.z = side * 0.07;
      car.add(tlOuter);

      var reflector = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.028, 0.02), mats.reflector);
      reflector.position.set(side * 0.58, 0.285, -1.965);
      car.add(reflector);
    });

    var rearRings = buildAudiRings(THREE, mats.chrome, 0.88);
    rearRings.position.set(0, 0.845, -1.918);
    rearRings.rotation.y = Math.PI;
    rearRings.rotation.x = -0.16;
    car.add(rearRings);

    var rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.115, 0.02), mats.plate);
    rearPlate.position.set(0, 0.705, -1.948);
    rearPlate.rotation.y = Math.PI;
    rearPlate.rotation.x = -0.10;
    car.add(rearPlate);

    // Chrome micro-badges A1 (left: x = +0.46 when looking at rear from behind; wait in vehicle local +Z forward, driver left is -X or +X? Let's keep symmetric clarity: in Three.js right-handed +Y up, +Z forward, +X is driver-LEFT! Wait: right x left: cross(+Y, +Z) = +X -> +X is LEFT of forward +Z!)
    // Let's verify: forward = (0,0,+1), up = (0,1,0). Right-hand rule: forward × up = (0,0,1) × (0,1,0) = (-1, 0, 0)!
    // YES! When +Z is forward and +Y is up:
    //   Driver's LEFT side = +X (+0.37m, matching phys2 DRIVER_SEAT_SIDE = +0.37!)
    //   Passenger RIGHT side = -X (-0.37m)!
    var badgeA1 = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.026, 0.015), mats.chrome);
    badgeA1.position.set(0.46, 0.66, -1.945);
    car.add(badgeA1);

    var badgeTfsi = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.024, 0.015), mats.chrome);
    badgeTfsi.position.set(-0.46, 0.66, -1.945);
    car.add(badgeTfsi);

    // Lower matte-black rear diffuser + twin left-side exhaust tips (photo 081: left side = +X!)
    var diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.11, 0.06), mats.matteBlack);
    diffuser.position.set(0, 0.255, -1.955);
    car.add(diffuser);

    [0.40, 0.475].forEach(function (exX) {
      var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.12, 12), mats.darkMetal);
      pipe.rotation.x = Math.PI * 0.5;
      pipe.position.set(exX, 0.235, -1.985);
      car.add(pipe);
    });

    // 5. Interior Cabin & Left-Hand Cockpit (+X = +0.37m left driver seat in +Z forward frame!)
    var dash = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.26, 0.38), mats.dashDark);
    dash.position.set(0, 0.84, 0.58);
    car.add(dash);

    // Beige seats visible through windshield (photo 076)
    [-0.35, 0.35].forEach(function (sx) {
      var seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.12), mats.seatBeige);
      seatBack.position.set(sx, 0.86, -0.14);
      seatBack.rotation.x = -0.18;
      car.add(seatBack);
    });

    // Steering wheel & twin red-lit gauges on LEFT driver side (+0.37m) + center MMI pop-up screen (photo 083)
    var steerRing = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.020, 6, 14), mats.matteBlack);
    steerRing.position.set(0.37, 0.95, 0.36);
    steerRing.rotation.x = -0.35;
    car.add(steerRing);

    var gauges = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.04), mats.gaugeRed);
    gauges.position.set(0.37, 0.98, 0.52);
    gauges.rotation.x = -0.25;
    car.add(gauges);

    var mmi = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.11, 0.03), mats.mmiScreen);
    mmi.position.set(0.0, 1.02, 0.54);
    mmi.rotation.x = -0.18;
    car.add(mmi);

    // 6. Four 10-spoke silver alloy wheels with steering pivots on front axle
    var halfTrack = SPECS.trackWidthM * 0.5;
    var wheelSteerPivots = [];
    var wheelSpinMeshes = [];

    [
      { x:  halfTrack, z: SPECS.frontAxleZ, front: true },
      { x: -halfTrack, z: SPECS.frontAxleZ, front: true },
      { x:  halfTrack, z: SPECS.rearAxleZ,  front: false },
      { x: -halfTrack, z: SPECS.rearAxleZ,  front: false }
    ].forEach(function (wp) {
      var pivot = new THREE.Group();
      pivot.position.set(wp.x, SPECS.wheelRadiusM, wp.z);
      var wMesh = buildAlloyWheel10Spoke(THREE, mats);
      pivot.add(wMesh);
      car.add(pivot);
      if (wp.front) wheelSteerPivots.push(pivot);
      wheelSpinMeshes.push(wMesh);
    });

    car.userData.specs = SPECS;
    car.userData.spinWheels = function (distanceMeters, steerAngleRad) {
      var dTheta = (Number(distanceMeters) || 0) / SPECS.wheelRadiusM;
      for (var i = 0; i < wheelSpinMeshes.length; i++) {
        wheelSpinMeshes[i].rotation.x += dTheta;
      }
      var steer = Math.max(-0.58, Math.min(0.58, Number(steerAngleRad) || 0));
      for (var j = 0; j < wheelSteerPivots.length; j++) {
        wheelSteerPivots[j].rotation.y = steer;
      }
    };

    return car;
  }

  function buildParkingBayMesh(THREE) {
    var bay = new THREE.Group();
    bay.name = 'ESH27_HaOren_Parking_Bay';
    var paverMat = new THREE.MeshStandardMaterial({ color: 0x3b3e45, roughness: 0.88, metalness: 0.04 });
    var curbMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.76, metalness: 0.04 });
    var bikeMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.65, metalness: 0.05 });

    var pad = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.05, 6.80), paverMat);
    pad.position.y = 0.025;
    pad.receiveShadow = true;
    bay.add(pad);

    var curb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 6.80), curbMat);
    curb.position.set(-1.40, 0.07, 0);
    bay.add(curb);

    var bikeLane = new THREE.Mesh(new THREE.BoxGeometry(1.70, 0.04, 14.0), bikeMat);
    bikeLane.position.set(5.40, 0.02, 0);
    bay.add(bikeLane);

    return bay;
  }

  function itmToWorldXZ(world, easting, northing) {
    if (world && typeof world.itmToScene === 'function') {
      return world.itmToScene(easting, northing);
    }
    var oE = (world && world.origin && Number.isFinite(world.origin.easting)) ? world.origin.easting : SPECS.anchorOriginItm.easting;
    var oN = (world && world.origin && Number.isFinite(world.origin.northing)) ? world.origin.northing : SPECS.anchorOriginItm.northing;
    return { x: easting - oE, z: -(northing - oN) };
  }

  function mountInWorld(world) {
    var THREE = (world && world.THREE) || (typeof globalThis !== 'undefined' && globalThis.THREE);
    if (!THREE || !world || !world.scene) return null;

    var playerCarMesh = buildAudiA1Mesh(THREE);
    var parkedGroup = new THREE.Group();
    var pt = itmToWorldXZ(world, SPECS.parkingBayItm.easting, SPECS.parkingBayItm.northing);
    var bayMesh = buildParkingBayMesh(THREE);
    parkedGroup.add(bayMesh);

    var parkedCar = buildAudiA1Mesh(THREE);
    parkedGroup.add(parkedCar);
    parkedGroup.position.set(pt.x, 0, pt.z);
    parkedGroup.rotation.y = (SPECS.parkingBayItm.headingDeg * Math.PI) / 180;
    world.scene.add(parkedGroup);

    // Replace existing active player vehicle mesh if exposed by W27 / world
    var replacedTarget = null;
    var prevChildren = null;
    var targetObj = world.playerCar || world.carMesh || (world.vehicle && world.vehicle.mesh) || null;
    if (targetObj && typeof targetObj.add === 'function') {
      replacedTarget = targetObj;
      prevChildren = targetObj.children.slice();
      while (targetObj.children.length > 0) {
        targetObj.remove(targetObj.children[0]);
      }
      targetObj.add(playerCarMesh);
    }
    world.arielCar = {
      specs: SPECS,
      mesh: playerCarMesh,
      parkedGroup: parkedGroup,
      buildMesh: function () { return buildAudiA1Mesh(THREE); }
    };

    return {
      playerCarMesh: playerCarMesh,
      parkedGroup: parkedGroup,
      dispose: function () {
        if (parkedGroup.parent) parkedGroup.parent.remove(parkedGroup);
        if (replacedTarget && prevChildren) {
          replacedTarget.remove(playerCarMesh);
          for (var i = 0; i < prevChildren.length; i++) replacedTarget.add(prevChildren[i]);
        }
        delete world.arielCar;
      }
    };
  }

  function createHostDescriptor() {
    var instance = null;
    return {
      id: 'ariel-car',
      name: 'הרכב של אריאל – Audi A1 תלת-דלתית לבנה (73-464-53) גרסה 3 אטומה ומעוגלת',
      dept: 'vehicles',
      order: 57,
      scripts: [],
      init: function (world, hostApi) {
        instance = mountInWorld(world);
        if (hostApi && typeof hostApi.emit === 'function') {
          hostApi.emit('ariel-car:ready', { version: 3, specs: SPECS });
        }
        return instance;
      },
      dispose: function () {
        if (instance && typeof instance.dispose === 'function') {
          instance.dispose();
          instance = null;
        }
      }
    };
  }

  function registerWithHost(yzw) {
    if (!yzw || typeof yzw.register !== 'function') {
      throw new TypeError('YZW host with register(descriptor) is required');
    }
    var desc = createHostDescriptor();
    yzw.register(desc);
    return desc;
  }

  return {
    SPECS: SPECS,
    BODY_STATIONS: BODY_STATIONS,
    buildWatertightBodyGeometry: buildWatertightBodyGeometry,
    buildAudiA1Mesh: buildAudiA1Mesh,
    createCar: buildAudiA1Mesh,
    buildParkingBayMesh: buildParkingBayMesh,
    itmToWorldXZ: itmToWorldXZ,
    mountInWorld: mountInWorld,
    createHostDescriptor: createHostDescriptor,
    registerWithHost: registerWithHost
  };
});


/* ---- חיבור לעולם (כמו גרסה 2): מסתירים את רכב המשחק, מוסיפים את האאודי, הגלגלים נכנסים ל-userData.wheels ---- */
(function () {
  'use strict';
  if (typeof YZW === 'undefined' || typeof THREE === 'undefined') return;
  const A = globalThis.ESHArielCar57, T = THREE;
  const S = { car: null, model: null, hidden: [], wheelsOrig: null };
  /** נפח מסומן (מ"ק) של רשת סגורה: חיובי = הפאות פונות החוצה (סדר נגד כיוון השעון מבחוץ). */
  function signedVolume(g) {
    const p = g.attributes.position.array, ix = g.index ? g.index.array : null, n = ix ? ix.length : p.length / 3; let v = 0;
    for (let t = 0; t < n; t += 3) { const a = 3 * (ix ? ix[t] : t), b = 3 * (ix ? ix[t + 1] : t + 1), c = 3 * (ix ? ix[t + 2] : t + 2);
      v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6; }
    return v;
  }
  function flipWinding(g) {
    if (g.index) { const ix = g.index.array; for (let t = 0; t < ix.length; t += 3) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; } g.index.needsUpdate = true; }
    else { const p = g.attributes.position.array; for (let t = 0; t < p.length; t += 9) for (let j = 0; j < 3; j++) { const k = p[t + 3 + j]; p[t + 3 + j] = p[t + 6 + j]; p[t + 6 + j] = k; } }
    g.computeVertexNormals();
  }
  A.signedVolume = signedVolume;
  /** איחוד תת-עץ לרשת אחת לכל חומר, במסגרת של root (העתק לא-מאונדקס; uv חסר → אפסים). */
  function mergeByMaterial(root, remap) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert(), groups = new Map(), m = new T.Matrix4();
    root.traverse(o => { if (!o.isMesh) return; let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      m.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(m); if (!g.attributes.normal) g.computeVertexNormals();
      const mat = (remap && remap(o.material)) || o.material; if (!groups.has(mat)) groups.set(mat, { gs: [], shadow: false }); const e = groups.get(mat); e.gs.push(g); e.shadow = e.shadow || o.castShadow; });
    const out = [];
    for (const [mat, e] of groups) {
      let n = 0; for (const g of e.gs) n += g.attributes.position.count;
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let k = 0;
      for (const g of e.gs) { const c = g.attributes.position.count; P.set(g.attributes.position.array, k * 3); N.set(g.attributes.normal.array, k * 3);
        if (g.attributes.uv && g.attributes.uv.itemSize === 2) U.set(g.attributes.uv.array, k * 2); k += c; g.dispose(); }
      const bg = new T.BufferGeometry(); bg.setAttribute('position', new T.BufferAttribute(P, 3)); bg.setAttribute('normal', new T.BufferAttribute(N, 3)); bg.setAttribute('uv', new T.BufferAttribute(U, 2));
      bg.computeBoundingSphere(); const mesh = new T.Mesh(bg, mat); mesh.castShadow = e.shadow; mesh.receiveShadow = true; out.push(mesh);
    }
    return out;
  }
  function build() {
    const src = A.buildAudiA1Mesh(T), g = new T.Group(), wheels = [];
    // תיקון: מעטפות הגוף והזכוכית של גרסה 3 בנויות הפוך (נפח מסומן שלילי −4.66 / −1.07 מ"ק → הפאות פונות פנימה,
    // והמנוע מעלים אותן מבחוץ: רואים את המושבים דרך הקיר). הופכים את סדר הקודקודים ומחשבים נורמלים מחדש.
    src.traverse(o => { if (o.isMesh && o.geometry.type === 'BufferGeometry' && signedVolume(o.geometry) < 0) flipWinding(o.geometry); });
    // איחוד חומרים כמעט זהים כדי לא לעבור את גרסה 2 (34 קריאות): בגלגל – דיסק בלם → מתכת כהה, כובע כרום → חישורים;
    // בגוף – מחזיר אור → פנס אחורי (שניהם אדומים). שינוי מראה זעיר, מסומן.
    const byColor = {}; src.traverse(o => { if (o.isMesh) byColor[o.material.color.getHexString()] = o.material; });
    const M = n => byColor[n], wheelMap = m => ({ '64748b': M('1f242d'), 'e8eef5': M('e2e8f0') })[m.color.getHexString()], bodyMap = m => ({ '991b1b': M('b91c1c') })[m.color.getHexString()];
    const spin = [];                                   // קבוצות הגלגלים (ילד יחיד של כל ציר היגוי)
    src.traverse(o => { if (o.isGroup && o.parent && o.parent !== src && o.parent.parent === src && o.children.some(c => c.isMesh)) spin.push(o); });
    for (const w of spin) {                            // גלגל: מאחדים בתוך הגלגל, מחברים ציר → גלגל → רשתות
      const merged = mergeByMaterial(w, wheelMap), pivot = w.parent, wg = new T.Group();
      wg.position.copy(pivot.position); wg.quaternion.copy(pivot.quaternion); for (const mm of merged) wg.add(mm);
      pivot.remove(w); src.remove(pivot); g.add(wg); wheels.push(wg);
    }
    for (const mm of mergeByMaterial(src, bodyMap)) g.add(mm);   // כל השאר: רשת אחת לכל חומר
    g.userData.ownWheels = wheels; g.userData.specs = A.SPECS;
    return g;
  }
  globalThis.ESHArielCar57.buildMerged = build;
  YZW.register({
    id: 'ariel-car', name: 'הרכב של אריאל (אאודי A1, גרסה 3 אטומה)', dept: 'assets', order: 57,
    init(world) {
      world.scene.traverse(o => { if (!S.car && o.userData && o.userData.wheels && o.isGroup) S.car = o; });
      if (!S.car) throw new Error('רכב המשחק לא נמצא');
      const m = build();
      for (const c of S.car.children) { if (c.visible) { c.visible = false; S.hidden.push(c); } }
      S.car.add(m); S.model = m;
      S.wheelsOrig = S.car.userData.wheels; S.car.userData.wheels = m.userData.ownWheels;
      world.arielCar = { plate: A.SPECS.licensePlate, model: A.SPECS.model, version: 3, source: 'photos 075–083 (Gemini v3, merged by Claude)' };
    },
    update() {
      if (!S.car || !S.model) return; if (!S.model.visible) S.model.visible = true;
      for (const c of S.car.children) if (c !== S.model && c.visible) { c.visible = false; if (!S.hidden.includes(c)) S.hidden.push(c); }
    },
    dispose() { if (S.model && S.car) S.car.remove(S.model); if (S.car && S.wheelsOrig) S.car.userData.wheels = S.wheelsOrig; for (const c of S.hidden) c.visible = true; S.hidden = []; S.model = null; },
  });
})();
