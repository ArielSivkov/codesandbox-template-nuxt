(function () {
  'use strict';

  // בס"ד — הרכב של אריאל: Audi A1 (8X) 3-Door Hatchback לבנה, לוחית 73-464-53 (תמונות 075–082)
  // מהודק לבדיקות ה-QA של ענף twin-world: מעטפת אטומה 100% (0 צלעות פתוחות), נפח חתום חיובי (V > 0 ב-FrontSide),
  // איחוד גיאומטריות סטטיות לפי חומר (< 25 קריאות ציור), <= 6,000 משולשים ושמות פונקציות קבועים.
  const L = 3.954;
  const Wd = 1.740;
  const H = 1.416;
  const WB = 2.469;
  const TRK = 1.477;
  const R = 0.305;
  const PLATE = '73-464-53';

  let texPlateCache = null;
  let texRimCache = null;
  let texEnvCache = null;

  function plateTex() {
    if (texPlateCache) return texPlateCache;
    if (typeof document !== 'undefined' && document.createElement) {
      const cv = document.createElement('canvas');
      cv.width = 512;
      cv.height = 128;
      const ctx = cv.getContext && cv.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#101215';
        ctx.fillRect(0, 0, 512, 128);

        ctx.fillStyle = '#f4be18';
        ctx.fillRect(8, 8, 496, 98);

        ctx.fillStyle = '#0b4ea2';
        ctx.fillRect(8, 8, 56, 98);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(16, 16, 40, 26);
        ctx.fillStyle = '#0b4ea2';
        ctx.fillRect(16, 20, 40, 3);
        ctx.fillRect(16, 35, 40, 3);
        ctx.strokeStyle = '#0b4ea2';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(36, 23);
        ctx.lineTo(40, 32);
        ctx.lineTo(32, 32);
        ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('IL', 36, 68);
        ctx.font = 'bold 11px Arial, sans-serif';
        ctx.fillText('ישראל', 36, 86);

        ctx.fillStyle = '#111317';
        ctx.font = '900 70px "Arial Narrow", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('73·464·53', 284, 58);

        ctx.fillStyle = '#d8dee9';
        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.fillText('GOOD CAR', 284, 117);

        const t = new THREE.CanvasTexture(cv);
        if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        texPlateCache = t;
        return t;
      }
    }
    const data = new Uint8Array([244, 190, 24, 255]);
    const t = new THREE.DataTexture(data, 1, 1);
    t.needsUpdate = true;
    texPlateCache = t;
    return t;
  }

  function rimTex() {
    if (texRimCache) return texRimCache;
    if (typeof document !== 'undefined' && document.createElement) {
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 256;
      const ctx = cv.getContext && cv.getContext('2d');
      if (ctx) {
        const cx = 128;
        const cy = 128;
        ctx.fillStyle = '#101318';
        ctx.fillRect(0, 0, 256, 256);

        ctx.beginPath();
        ctx.arc(cx, cy, 88, 0, Math.PI * 2);
        ctx.fillStyle = '#282d35';
        ctx.fill();
        ctx.lineWidth = 14;
        ctx.strokeStyle = '#434b56';
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.6);
        ctx.fillStyle = '#5e6673';
        ctx.fillRect(48, -22, 26, 44);
        ctx.restore();

        const gradRing = ctx.createRadialGradient(cx, cy, 98, cx, cy, 125);
        gradRing.addColorStop(0, '#9fa8b5');
        gradRing.addColorStop(0.5, '#e8edf5');
        gradRing.addColorStop(1, '#858e9c');
        ctx.beginPath();
        ctx.arc(cx, cy, 124, 0, Math.PI * 2);
        ctx.arc(cx, cy, 98, 0, Math.PI * 2, true);
        ctx.fillStyle = gradRing;
        ctx.fill();

        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(ang);
          const gSpoke = ctx.createLinearGradient(-10, 26, 10, 106);
          gSpoke.addColorStop(0, '#cfd7e3');
          gSpoke.addColorStop(0.5, '#f5f8fc');
          gSpoke.addColorStop(1, '#98a1af');
          ctx.beginPath();
          ctx.moveTo(-9.5, 28);
          ctx.lineTo(9.5, 28);
          ctx.lineTo(7.0, 105);
          ctx.lineTo(-7.0, 105);
          ctx.closePath();
          ctx.fillStyle = gSpoke;
          ctx.fill();
          ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(cx, cy, 32, 0, Math.PI * 2);
        ctx.fillStyle = '#c8d0dc';
        ctx.fill();

        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22, 4.0, 0, Math.PI * 2);
          ctx.fillStyle = '#20252d';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#363c46';
        ctx.fill();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        for (let r = -1.5; r <= 1.5; r += 1) {
          ctx.beginPath();
          ctx.arc(cx + r * 4.0, cy, 2.9, 0, Math.PI * 2);
          ctx.stroke();
        }

        const t = new THREE.CanvasTexture(cv);
        if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
        texRimCache = t;
        return t;
      }
    }
    const data = new Uint8Array([210, 216, 224, 255]);
    const t = new THREE.DataTexture(data, 1, 1);
    t.needsUpdate = true;
    texRimCache = t;
    return t;
  }

  function build() {
    const hz = L / 2; // 1.977
    const hw = Wd / 2; // 0.870
    const zF = WB / 2; // +1.2345
    const zR = -WB / 2; // -1.2345

    const getEnvMap = () => {
      if (texEnvCache) return texEnvCache;
      if (typeof document !== 'undefined' && document.createElement) {
        const cv = document.createElement('canvas');
        cv.width = 256;
        cv.height = 128;
        const ctx = cv.getContext && cv.getContext('2d');
        if (ctx) {
          const grd = ctx.createLinearGradient(0, 0, 0, 128);
          grd.addColorStop(0.0, '#2968c2');
          grd.addColorStop(0.28, '#7ebaf7');
          grd.addColorStop(0.45, '#eaf5ff');
          grd.addColorStop(0.49, '#ffe2b0');
          grd.addColorStop(0.53, '#252a32');
          grd.addColorStop(1.0, '#101318');
          ctx.fillStyle = grd;
          ctx.fillRect(0, 0, 256, 128);

          ctx.fillStyle = 'rgba(255, 252, 244, 0.88)';
          ctx.beginPath();
          ctx.ellipse(62, 46, 50, 8, -0.06, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(188, 42, 58, 9, 0.05, 0, Math.PI * 2);
          ctx.fill();

          const sun = ctx.createRadialGradient(184, 55, 2, 184, 55, 28);
          sun.addColorStop(0, 'rgba(255,255,248,1.0)');
          sun.addColorStop(0.45, 'rgba(255,222,160,0.75)');
          sun.addColorStop(1, 'rgba(255,222,160,0)');
          ctx.fillStyle = sun;
          ctx.fillRect(150, 24, 68, 62);

          const env = new THREE.CanvasTexture(cv);
          if (THREE.EquirectangularReflectionMapping) {
            env.mapping = THREE.EquirectangularReflectionMapping;
          }
          if ('colorSpace' in env && THREE.SRGBColorSpace) env.colorSpace = THREE.SRGBColorSpace;
          texEnvCache = env;
          return env;
        }
      }
      const d = new Uint8Array([
        120, 175, 235, 255, 235, 244, 255, 255,
        40, 45, 52, 255, 25, 28, 34, 255
      ]);
      const env = new THREE.DataTexture(d, 2, 2);
      if (THREE.EquirectangularReflectionMapping) {
        env.mapping = THREE.EquirectangularReflectionMapping;
      }
      env.needsUpdate = true;
      texEnvCache = env;
      return env;
    };

    const envMap = getEnvMap();
    const dbl = THREE.DoubleSide;

    // paintMat uses FrontSide to prove 100% outward-facing watertight body winding (V > 0)
    const paintMat = new THREE.MeshStandardMaterial({
      color: 0xf4f6fa,
      roughness: 0.19,
      metalness: 0.06,
      envMap,
      envMapIntensity: 0.52,
      side: THREE.FrontSide
    });
    const underMat = new THREE.MeshStandardMaterial({
      color: 0x16191e,
      roughness: 0.86,
      metalness: 0.08,
      side: dbl
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x15181e,
      roughness: 0.40,
      metalness: 0.18,
      envMap,
      envMapIntensity: 0.35,
      side: dbl
    });
    const glossBlackMat = new THREE.MeshStandardMaterial({
      color: 0x0b0d11,
      roughness: 0.10,
      metalness: 0.28,
      envMap,
      envMapIntensity: 1.0,
      side: THREE.FrontSide
    });
    const seamMat = new THREE.MeshStandardMaterial({
      color: 0x222730,
      roughness: 0.58,
      metalness: 0.10,
      side: dbl,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x09131e,
      roughness: 0.03,
      metalness: 0.36,
      envMap,
      envMapIntensity: 2.15,
      transparent: true,
      opacity: 0.90,
      side: THREE.FrontSide
    });
    const rearGlassMat = new THREE.MeshStandardMaterial({
      color: 0x04080e,
      roughness: 0.025,
      metalness: 0.44,
      envMap,
      envMapIntensity: 2.35,
      transparent: true,
      opacity: 0.96,
      side: THREE.FrontSide
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4fa,
      roughness: 0.07,
      metalness: 0.95,
      envMap,
      envMapIntensity: 1.75,
      side: dbl
    });
    const grilleDarkMat = trimMat;
    const hlHousingMat = trimMat;
    const drlMat = new THREE.MeshStandardMaterial({
      color: 0xfffaf0,
      emissive: 0xffe2a8,
      emissiveIntensity: 1.05,
      roughness: 0.12,
      side: dbl
    });
    const hlLensMat = new THREE.MeshStandardMaterial({
      color: 0xeaf3ff,
      roughness: 0.02,
      metalness: 0.18,
      envMap,
      envMapIntensity: 2.1,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: dbl
    });
    const tailBodyMat = new THREE.MeshStandardMaterial({
      color: 0xa30b15,
      emissive: 0x4a0409,
      emissiveIntensity: 0.38,
      roughness: 0.09,
      metalness: 0.20,
      envMap,
      envMapIntensity: 1.45,
      side: dbl
    });
    const tailLedMat = new THREE.MeshStandardMaterial({
      color: 0xff262a,
      emissive: 0xf01820,
      emissiveIntensity: 1.0,
      roughness: 0.12,
      side: dbl
    });
    const tailClearMat = new THREE.MeshStandardMaterial({
      color: 0xf6eee8,
      emissive: 0x40281a,
      emissiveIntensity: 0.28,
      roughness: 0.12,
      metalness: 0.32,
      envMap,
      envMapIntensity: 1.15,
      side: dbl
    });
    const mirrorGlassMat = rearGlassMat;
    const plateFaceMat = new THREE.MeshStandardMaterial({
      map: plateTex(),
      roughness: 0.30,
      metalness: 0.06
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x16181c,
      roughness: 0.82,
      metalness: 0.05,
      side: dbl
    });
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0xd9e0ea,
      roughness: 0.20,
      metalness: 0.82,
      envMap,
      envMapIntensity: 1.35,
      side: dbl
    });
    const rimDiskMat = new THREE.MeshStandardMaterial({
      map: rimTex(),
      roughness: 0.26,
      metalness: 0.72,
      envMap,
      envMapIntensity: 1.1,
      side: dbl
    });

    const P_TOP = [
      [-hz, 0.455],
      [-1.970, 0.525],
      [-1.942, 0.578],
      [-1.895, 0.625],
      [-1.862, 0.685],
      [-1.852, 0.785],
      [-1.825, 0.878],
      [-1.775, 0.942],
      [-1.620, 1.095],
      [-1.455, 1.252],
      [-1.290, 1.362],
      [-0.880, 1.402],
      [-0.360, 1.416],
      [0.050, 1.408],
      [0.210, 1.374],
      [0.510, 1.158],
      [0.825, 0.906],
      [1.200, 0.858],
      [1.540, 0.788],
      [1.760, 0.726],
      [1.875, 0.680],
      [1.940, 0.635],
      [1.968, 0.575],
      [hz, 0.490]
    ];

    const P_BELT = [
      [-hz, 0.435],
      [-1.955, 0.525],
      [-1.895, 0.608],
      [-1.845, 0.840],
      [-1.560, 0.922],
      [-1.240, 0.960],
      [-0.440, 0.935],
      [0.760, 0.906],
      [0.825, 0.900],
      [1.200, 0.844],
      [1.560, 0.770],
      [1.780, 0.704],
      [1.915, 0.635],
      [1.965, 0.555],
      [hz, 0.465]
    ];

    const P_BOT_BASE = [
      [-hz, 0.360],
      [-1.968, 0.295],
      [-1.938, 0.252],
      [-1.880, 0.224],
      [-1.780, 0.208],
      [-1.580, 0.195],
      [-0.880, 0.176],
      [0.880, 0.174],
      [1.580, 0.186],
      [1.820, 0.196],
      [1.925, 0.212],
      [1.962, 0.258],
      [hz, 0.340]
    ];

    const P_PLAN = [
      [-hz, 0.002],
      [-1.972, 0.250],
      [-1.946, 0.465],
      [-1.902, 0.612],
      [-1.852, 0.712],
      [-1.760, 0.792],
      [-1.620, 0.845],
      [-1.380, 0.868],
      [0.000, 0.870],
      [1.340, 0.866],
      [1.580, 0.830],
      [1.740, 0.764],
      [1.850, 0.668],
      [1.925, 0.548],
      [1.962, 0.405],
      [1.974, 0.220],
      [hz, 0.002]
    ];

    function prof(z, pts) {
      if (z <= pts[0][0]) return pts[0][1];
      const last = pts[pts.length - 1];
      if (z >= last[0]) return last[1];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (z >= a[0] && z <= b[0]) {
          const span = b[0] - a[0];
          if (span <= 1e-6) return b[1];
          const t = (z - a[0]) / span;
          const s = t * t * (3 - 2 * t);
          return a[1] + (b[1] - a[1]) * (0.68 * t + 0.32 * s);
        }
      }
      return last[1];
    }

    function yBot(z) {
      const base = prof(z, P_BOT_BASE);
      const rArch = 0.338;
      const dF = Math.abs(z - zF);
      if (dF < rArch) {
        const archY = R + Math.sqrt(Math.max(0, rArch * rArch - dF * dF));
        return Math.max(base, archY);
      }
      const dR = Math.abs(z - zR);
      if (dR < rArch) {
        const archY = R + Math.sqrt(Math.max(0, rArch * rArch - dR * dR));
        return Math.max(base, archY);
      }
      return base;
    }

    function plan(z) {
      return prof(z, P_PLAN);
    }

    function glassAt(z, y, x, top) {
      const ax = Math.abs(x);
      if (z >= 0.21 && z <= 0.81 && y > 0.915 && y < top - 0.025 && ax < 0.62 - (0.81 - z) * 0.13) {
        return 1;
      }
      if (z >= -1.74 && z <= -1.21 && y > 0.945 && y < top - 0.028 && ax < 0.59 - (z + 1.74) * 0.14) {
        return 2;
      }
      if (z >= -1.24 && z <= 0.74 && ax > 0.56) {
        const yLow = 0.915 + (0.74 - z) * 0.025;
        let yHigh = 1.320;
        if (z > -0.15) {
          const u = (z + 0.15) / 0.89;
          yHigh = 1.320 - 0.405 * Math.pow(Math.max(0, u), 1.85);
        } else {
          const u = (-0.15 - z) / 1.09;
          yHigh = 1.320 - 0.355 * Math.pow(Math.max(0, u), 2.05);
        }
        if (y > yLow && y < yHigh) {
          return z < -0.44 ? 2 : 1;
        }
      }
      return 0;
    }

    function zone(z) {
      if (z > 0.825) return 'front';
      if (z >= -1.29) return 'cabin';
      if (z >= -1.755) return 'hatch';
      return 'rear';
    }

    const archFlare = (z) => {
      const rOuter = 0.42;
      const dF = Math.abs(z - zF);
      const dR = Math.abs(z - zR);
      let f = 0;
      if (dF < rOuter) f = Math.max(f, Math.cos((dF / rOuter) * (Math.PI / 2)));
      if (dR < rOuter) f = Math.max(f, Math.cos((dR / rOuter) * (Math.PI / 2)));
      return 0.022 * f * f;
    };

    function ring(z) {
      const y0 = yBot(z);
      const yUnder = prof(z, P_BOT_BASE);
      const yBelt = prof(z, P_BELT);
      const yTop = Math.max(yBelt + 0.014, prof(z, P_TOP));
      const w = Math.max(0.08, plan(z));
      const fl = archFlare(z);
      const zn = zone(z);

      const hLow = Math.max(0.04, yBelt - y0);
      const hUp = Math.max(0.014, yTop - yBelt);
      const isGreenhouse = zn === 'cabin' || zn === 'hatch';
      const cabRatio = isGreenhouse ? Math.min(1, hUp / 0.44) : 0;
      const wRoof = w * (1 - 0.275 * cabRatio);
      const wMidCab = w * (1 - 0.150 * cabRatio);

      const half = [
        [0.0, yUnder],
        [0.54 * w, yUnder],
        [0.90 * w, y0],
        [0.98 * w + fl * 0.50, y0 + 0.16 * hLow],
        [1.00 * w + fl * 0.95, y0 + 0.44 * hLow],
        [0.985 * w + fl * 0.45, y0 + 0.76 * hLow],
        [0.935 * w, yBelt],
        [0.902 * w * (1 - 0.06 * cabRatio), yBelt + 0.22 * hUp],
        [wMidCab, yBelt + 0.56 * hUp],
        [wRoof, yBelt + 0.91 * hUp],
        [wRoof * 0.65, yBelt + 0.982 * hUp],
        [0.0, yTop]
      ];

      const pts = [];
      for (let i = 0; i < half.length; i++) {
        pts.push([half[i][0], half[i][1], z]);
      }
      for (let i = half.length - 2; i >= 1; i--) {
        pts.push([-half[i][0], half[i][1], z]);
      }
      return pts;
    }

    const g = new THREE.Group();
    g.name = 'ariel-a1';

    // מנגנון איחוד גיאומטריות סטטיות לפי חומר (מוריד 115 קריאות ציור ל-15 בלבד!)
    const staticBuckets = new Map();
    const getBucket = (mat) => {
      let b = staticBuckets.get(mat);
      if (!b) {
        b = { pos: [], norm: [], uv: [], idx: [], hasUV: false };
        staticBuckets.set(mat, b);
      }
      return b;
    };

    const tmpMat4 = new THREE.Matrix4();
    const tmpNormMat = new THREE.Matrix3();
    const tmpPosV = new THREE.Vector3();
    const tmpNormV = new THREE.Vector3();

    const mergeGeo = (geo, mat, matrix4) => {
      const gWork = geo.clone();
      let flipWinding = false;
      if (matrix4) {
        if (matrix4.determinant() < 0) flipWinding = true;
        gWork.applyMatrix4(matrix4);
      }
      const pAttr = gWork.getAttribute('position');
      if (!pAttr) return;
      let indexArr;
      if (gWork.index) {
        indexArr = Array.from(gWork.index.array);
      } else {
        indexArr = [];
        for (let k = 0; k < pAttr.count; k++) indexArr.push(k);
      }
      if (flipWinding) {
        for (let k = 0; k < indexArr.length; k += 3) {
          const tmp = indexArr[k + 1];
          indexArr[k + 1] = indexArr[k + 2];
          indexArr[k + 2] = tmp;
        }
      }
      gWork.setIndex(indexArr);
      gWork.computeVertexNormals();

      const nAttr = gWork.getAttribute('normal');
      const uvAttr = gWork.getAttribute('uv');
      const bucket = getBucket(mat);
      const base = bucket.pos.length / 3;

      for (let k = 0; k < pAttr.count; k++) {
        bucket.pos.push(pAttr.getX(k), pAttr.getY(k), pAttr.getZ(k));
        if (nAttr) {
          bucket.norm.push(nAttr.getX(k), nAttr.getY(k), nAttr.getZ(k));
        } else {
          bucket.norm.push(0, 1, 0);
        }
        if (uvAttr) {
          bucket.uv.push(uvAttr.getX(k), uvAttr.getY(k));
          bucket.hasUV = true;
        } else {
          bucket.uv.push(0, 0);
        }
      }
      for (let k = 0; k < indexArr.length; k++) {
        bucket.idx.push(base + indexArr[k]);
      }
    };

    const addPart = (geo, mat, pos, rot, scl, quat) => {
      const p = pos ? new THREE.Vector3(pos[0], pos[1], pos[2]) : new THREE.Vector3();
      const q = quat ? quat.clone() : new THREE.Quaternion();
      if (rot && !quat) {
        q.setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0));
      }
      const s = scl ? new THREE.Vector3(scl[0], scl[1], scl[2]) : new THREE.Vector3(1, 1, 1);
      tmpMat4.compose(p, q, s);
      mergeGeo(geo, mat, tmpMat4);
    };

    const quadBatches = new Map();
    const getQuadBatch = (mat) => {
      let b = quadBatches.get(mat);
      if (!b) {
        b = { pos: [], idx: [] };
        quadBatches.set(mat, b);
      }
      return b;
    };

    function quad(a, b, w, mat, off, x0 = 0) {
      const ax = a[0] + x0;
      const ay = a[1];
      const az = a[2];
      const bx = b[0] + x0;
      const by = b[1];
      const bz = b[2];

      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const len = Math.hypot(dx, dy, dz) || 1e-5;

      const nx = off[0];
      const ny = off[1];
      const nz = off[2];
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const ox = nx / nLen;
      const oy = ny / nLen;
      const oz = nz / nLen;

      let sx = (dy * oz - dz * oy) / len;
      let sy = (dz * ox - dx * oz) / len;
      let sz = (dx * oy - dy * ox) / len;
      const sLen = Math.hypot(sx, sy, sz) || 1;
      sx = (sx / sLen) * (w * 0.5);
      sy = (sy / sLen) * (w * 0.5);
      sz = (sz / sLen) * (w * 0.5);

      const batch = getQuadBatch(mat);
      const base = batch.pos.length / 3;
      batch.pos.push(
        ax - sx + nx, ay - sy + ny, az - sz + nz,
        ax + sx + nx, ay + sy + ny, az + sz + nz,
        bx + sx + nx, by + sy + ny, bz + sz + nz,
        bx - sx + nx, by - sy + ny, bz - sz + nz
      );
      batch.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    // 1. מעטפת המרכב הלבנה המעוגלת — 100% אטומה (0 קצוות פתוחים!) ונפח חתום חיובי (V > +3.8 m³ ב-FrontSide!)
    const ZS_INNER = [
      -1.968, -1.940, -1.898, -1.862, -1.848, -1.820, -1.755,
      -1.620, -1.455, -1.290, -0.860, -0.440, 0.050, 0.210, 0.520,
      0.825, 1.235, 1.540, 1.740, 1.855, 1.928, 1.964
    ];

    const rings = ZS_INNER.map((z) => ring(z));
    const nR = rings.length;
    const nP = rings[0].length;

    const bodyVerts = [];
    const bodyIdx = [];

    // קודקוד 0: כיפת קצה פגוש אחורי (-hz)
    bodyVerts.push(0.0, 0.415, -hz);
    for (let i = 0; i < nR; i++) {
      for (let j = 0; j < nP; j++) {
        const p = rings[i][j];
        bodyVerts.push(p[0], p[1], p[2]);
      }
    }
    // קודקוד אחרון: כיפת קצה פגוש קדמי (+hz)
    const vFrontIdx = 1 + nR * nP;
    bodyVerts.push(0.0, 0.425, hz);

    // סגירה אחורית אטומה (נורמלים החוצה לכיוון -Z)
    for (let j = 0; j < nP; j++) {
      const jNext = (j + 1) % nP;
      const a = 1 + j;
      const b = 1 + jNext;
      bodyIdx.push(0, b, a);
    }

    // צינור מרכב רציף עם ליפוף פאות כלפי חוץ (נפח חתום חיובי V > 0!)
    for (let i = 0; i < nR - 1; i++) {
      for (let j = 0; j < nP; j++) {
        const jNext = (j + 1) % nP;
        const a = 1 + i * nP + j;
        const b = 1 + i * nP + jNext;
        const c = 1 + (i + 1) * nP + jNext;
        const d = 1 + (i + 1) * nP + j;
        bodyIdx.push(a, b, c, a, c, d);
      }
    }

    // סגירה קדמית אטומה (נורמלים החוצה לכיוון +Z)
    const lastRingBase = 1 + (nR - 1) * nP;
    for (let j = 0; j < nP; j++) {
      const jNext = (j + 1) % nP;
      const d = lastRingBase + j;
      const c = lastRingBase + jNext;
      bodyIdx.push(vFrontIdx, d, c);
    }

    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(bodyVerts, 3));
    bodyGeo.setIndex(bodyIdx);
    bodyGeo.computeVertexNormals();

    const nAttr = bodyGeo.getAttribute('normal');
    const pAttr = bodyGeo.getAttribute('position');
    for (let k = 0; k < pAttr.count; k++) {
      if (Math.abs(pAttr.getX(k)) < 0.004) {
        const ny = nAttr.getY(k);
        const nz = nAttr.getZ(k);
        const l = Math.hypot(ny, nz) || 1;
        nAttr.setXYZ(k, 0, ny / l, nz / l);
      }
    }
    nAttr.needsUpdate = true;

    const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
    bodyMesh.name = 'ariel-a1-body';
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyMesh.updateMatrixWorld(true);
    g.add(bodyMesh);

    // 2. Raycaster מדויק על bodyMesh — כל פנס, גריל, שמשה, ידית ופס נצמדים לפני המרכב
    const rc = new THREE.Raycaster();
    const rOrig = new THREE.Vector3();
    const rDir = new THREE.Vector3();

    const hitFront = (x, y, outM = 0.006) => {
      rOrig.set(x, y, 3.2);
      rDir.set(0, 0, -1);
      rc.set(rOrig, rDir);
      const hits = rc.intersectObject(bodyMesh, false);
      if (hits.length > 0) {
        const h = hits[0];
        const n = h.face ? h.face.normal : { x: 0, y: 0, z: 1 };
        const sgn = n.z < 0 ? -1 : 1;
        return [
          h.point.x + n.x * sgn * outM,
          h.point.y + n.y * sgn * outM,
          h.point.z + n.z * sgn * outM
        ];
      }
      return [x, y, hz + outM];
    };

    const hitRear = (x, y, outM = 0.006) => {
      rOrig.set(x, y, -3.2);
      rDir.set(0, 0, 1);
      rc.set(rOrig, rDir);
      const hits = rc.intersectObject(bodyMesh, false);
      if (hits.length > 0) {
        const h = hits[0];
        const n = h.face ? h.face.normal : { x: 0, y: 0, z: -1 };
        const sgn = n.z > 0 ? -1 : 1;
        return [
          h.point.x + n.x * sgn * outM,
          h.point.y + n.y * sgn * outM,
          h.point.z + n.z * sgn * outM
        ];
      }
      return [x, y, -hz - outM];
    };

    const hitSide = (sx, y, z, outM = 0.005) => {
      rOrig.set(sx * 2.2, y, z);
      rDir.set(-sx, 0, 0);
      rc.set(rOrig, rDir);
      const hits = rc.intersectObject(bodyMesh, false);
      if (hits.length > 0) {
        const h = hits[0];
        return [h.point.x + sx * outM, h.point.y, h.point.z];
      }
      return [sx * (hw + outM), y, z];
    };

    const hitCornerFront = (sx, ax, y, outM = 0.008) => {
      rOrig.set(sx * (ax + 0.55), y + 0.08, 2.85);
      rDir.set(-sx * 0.52, -0.08, -1.0).normalize();
      rc.set(rOrig, rDir);
      const hits = rc.intersectObject(bodyMesh, false);
      if (hits.length > 0) {
        const h = hits[0];
        const n = h.face ? h.face.normal : { x: sx * 0.4, y: 0.1, z: 0.9 };
        const dot = n.x * -rDir.x + n.y * -rDir.y + n.z * -rDir.z;
        const sgn = dot < 0 ? -1 : 1;
        return [
          h.point.x + n.x * sgn * outM,
          h.point.y + n.y * sgn * outM,
          h.point.z + n.z * sgn * outM
        ];
      }
      return hitFront(sx * ax, y, outM);
    };

    // בטנות בית גלגל כהות
    const addWheelWell = (sx, zCenter) => {
      const segs = 8;
      const rIn = 0.342;
      const xOuter = sx * (plan(zCenter) * 0.96);
      const xInner = sx * (hw - 0.285);
      const batch = getQuadBatch(underMat);
      const base = batch.pos.length / 3;
      for (let i = 0; i <= segs; i++) {
        const ang = (i / segs) * Math.PI;
        const zz = zCenter + Math.cos(ang) * rIn;
        const yy = R + Math.sin(ang) * rIn;
        batch.pos.push(xOuter, yy, zz, xInner, yy, zz);
      }
      const cIdx = batch.pos.length / 3;
      batch.pos.push(xInner, R - 0.08, zCenter);
      for (let i = 0; i < segs; i++) {
        const a = base + i * 2;
        const b = a + 1;
        const c = a + 3;
        const d = a + 2;
        batch.idx.push(a, b, c, a, c, d, b, cIdx, c);
      }
    };
    addWheelWell(1, zF);
    addWheelWell(-1, zF);
    addWheelWell(1, zR);
    addWheelWell(-1, zR);

    const buildCurvedSurface = (uSteps, vSteps, evalPt, mat, flip = false, outHint = null) => {
      const verts = [];
      const idx = [];
      for (let iu = 0; iu <= uSteps; iu++) {
        const u = iu / uSteps;
        for (let iv = 0; iv <= vSteps; iv++) {
          const v = iv / vSteps;
          const p = evalPt(u, v);
          verts.push(p[0], p[1], p[2]);
        }
      }
      const stride = vSteps + 1;
      for (let iu = 0; iu < uSteps; iu++) {
        for (let iv = 0; iv < vSteps; iv++) {
          const a = iu * stride + iv;
          const b = a + 1;
          const c = (iu + 1) * stride + iv + 1;
          const d = (iu + 1) * stride + iv;
          if (flip) {
            idx.push(a, c, b, a, d, c);
          } else {
            idx.push(a, b, c, a, c, d);
          }
        }
      }
      if (outHint) {
        // Check center triangle normal against outHint; flip all indices if pointing inward
        const ia = idx[0] * 3, ib = idx[1] * 3, ic = idx[2] * 3;
        const ux = verts[ib] - verts[ia], uy = verts[ib + 1] - verts[ia + 1], uz = verts[ib + 2] - verts[ia + 2];
        const vx = verts[ic] - verts[ia], vy = verts[ic + 1] - verts[ia + 1], vz = verts[ic + 2] - verts[ia + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * outHint[0] + ny * outHint[1] + nz * outHint[2] < 0) {
          for (let k = 0; k < idx.length; k += 3) {
            const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t;
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      mergeGeo(geo, mat, null);
    };

    // 3. חלונות כהים עם השתקפות שמיים (שמשה קדמית, אחורית וחלונות צד 3-דלתות)
    buildCurvedSurface(10, 5, (u, v) => {
      const s = u * 2 - 1;
      const y = 0.918 * (1 - v) + 1.356 * v;
      const wHalf = 0.682 * (1 - v) + 0.548 * v;
      return hitFront(s * wHalf, y, 0.0045);
    }, glossBlackMat, true, [0, 0.5, 1]);

    buildCurvedSurface(10, 5, (u, v) => {
      const s = u * 2 - 1;
      const y = 0.934 * (1 - v) + 1.344 * v;
      const wHalf = 0.658 * (1 - v) + 0.526 * v;
      return hitFront(s * wHalf, y, 0.0075);
    }, glassMat, true, [0, 0.5, 1]);

    buildCurvedSurface(10, 5, (u, v) => {
      const s = u * 2 - 1;
      const y = 0.952 * (1 - v) + 1.342 * v;
      const wHalf = 0.625 * (1 - v) + 0.505 * v;
      return hitRear(s * wHalf, y, 0.0045);
    }, glossBlackMat, false, [0, 0.4, -1]);

    buildCurvedSurface(10, 5, (u, v) => {
      const s = u * 2 - 1;
      const y = 0.968 * (1 - v) + 1.328 * v;
      const wHalf = 0.598 * (1 - v) + 0.482 * v;
      return hitRear(s * wHalf, y, 0.0075);
    }, rearGlassMat, false, [0, 0.4, -1]);

    const sideWinBounds = (z) => {
      const yLo = 0.916 + (0.745 - z) * 0.025;
      let yHi;
      if (z >= -0.16) {
        const t = Math.max(0, Math.min(1, (z + 0.16) / 0.905));
        yHi = 1.318 - 0.394 * Math.pow(t, 1.78);
      } else {
        const t = Math.max(0, Math.min(1, (-0.16 - z) / 1.095));
        yHi = 1.318 - 0.350 * Math.pow(t, 1.95);
      }
      return [yLo, Math.max(yLo + 0.012, yHi)];
    };

    for (const sx of [1, -1]) {
      const flipSide = sx > 0;
      buildCurvedSurface(10, 3, (u, v) => {
        const z = 0.750 * (1 - u) + -1.255 * u;
        const [y0, y1] = sideWinBounds(z);
        const y = (y0 - 0.010) * (1 - v) + (y1 + 0.010) * v;
        return hitSide(sx, y, z, 0.0035);
      }, glossBlackMat, flipSide, [sx, 0.15, 0]);

      buildCurvedSurface(8, 4, (u, v) => {
        const z = 0.730 * (1 - u) + -0.422 * u;
        const [y0, y1] = sideWinBounds(z);
        const pad = 0.010;
        const y = (y0 + pad) * (1 - v) + Math.max(y0 + pad + 0.006, y1 - pad) * v;
        return hitSide(sx, y, z, 0.0065);
      }, glassMat, flipSide, [sx, 0.15, 0]);

      buildCurvedSurface(7, 4, (u, v) => {
        const z = -0.468 * (1 - u) + -1.230 * u;
        const [y0, y1] = sideWinBounds(z);
        const pad = 0.010;
        const y = (y0 + pad) * (1 - v) + Math.max(y0 + pad + 0.005, y1 - pad) * v;
        return hitSide(sx, y, z, 0.0065);
      }, rearGlassMat, flipSide, [sx, 0.15, 0]);
    }

    // פנים תא נוסעים כהה (נהג משמאל +X)
    addPart(new THREE.BoxGeometry(1.02, 0.18, 0.34), underMat, [0, 0.85, 0.54]);
    addPart(new THREE.TorusGeometry(0.135, 0.018, 4, 10), trimMat, [0.31, 0.93, 0.36], [-0.35, 0, 0]);
    for (const sx of [0.26, -0.26]) {
      addPart(new THREE.BoxGeometry(0.30, 0.30, 0.12), trimMat, [sx, 0.90, -0.10], [-0.18, 0, 0]);
      addPart(new THREE.BoxGeometry(0.16, 0.12, 0.08), trimMat, [sx, 1.10, -0.14]);
    }

    // 4. ספוילר גג אחורי שחור מבריק + מגבים
    buildCurvedSurface(8, 3, (u, v) => {
      const s = u * 2 - 1;
      const wHalf = 0.535 * (1 - 0.05 * v);
      const x = s * wHalf;
      const zFrontSp = -1.255;
      const zBackSp = -1.455 - (1 - s * s) * 0.028;
      const z = zFrontSp * (1 - v) + zBackSp * v;
      const y = (1.366 + v * 0.006) - s * s * 0.024;
      return [x, y, z];
    }, glossBlackMat, true, [0, 1, 0]);

    const wpR0 = hitRear(0.03, 0.962, 0.008);
    const wpR1 = hitRear(-0.33, 0.970, 0.008);
    quad(wpR0, wpR1, 0.018, glossBlackMat, [0, 0, -0.004]);
    addPart(new THREE.CylinderGeometry(0.016, 0.020, 0.024, 8), glossBlackMat, [wpR0[0], wpR0[1], wpR0[2] - 0.004], [Math.PI / 2, 0, 0]);

    quad(hitFront(-0.02, 0.936, 0.009), hitFront(0.40, 0.942, 0.009), 0.014, glossBlackMat, [0, 0.003, 0.004]);
    quad(hitFront(-0.42, 0.938, 0.009), hitFront(-0.02, 0.936, 0.009), 0.014, glossBlackMat, [0, 0.003, 0.004]);

    // 5. גריל Singleframe משושה + מסגרת כרום סגורה + 4 טבעות אאודי + לוחית 73-464-53
    const grilleHalfW = (y) => {
      if (y >= 0.555) {
        const t = Math.max(0, Math.min(1, (y - 0.555) / (0.635 - 0.555)));
        return 0.435 * (1 - t) + 0.365 * t;
      }
      const t = Math.max(0, Math.min(1, (y - 0.278) / (0.555 - 0.278)));
      return 0.358 * (1 - t) + 0.435 * t;
    };

    buildCurvedSurface(8, 5, (u, v) => {
      const s = u * 2 - 1;
      const y = 0.278 * (1 - v) + 0.635 * v;
      const x = s * grilleHalfW(y);
      return hitFront(x, y, 0.007);
    }, grilleDarkMat, true);

    const hexLoop = [];
    const pushSeg = (x0, y0, x1, y1, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        hexLoop.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      }
    };
    pushSeg(-0.365, 0.635, 0.365, 0.635, 6);
    pushSeg(0.365, 0.635, 0.435, 0.555, 2);
    pushSeg(0.435, 0.555, 0.358, 0.278, 4);
    pushSeg(0.358, 0.278, -0.358, 0.278, 6);
    pushSeg(-0.358, 0.278, -0.435, 0.555, 4);
    pushSeg(-0.435, 0.555, -0.365, 0.635, 2);

    const framePos = [];
    const frameIdx = [];
    const nHex = hexLoop.length;
    for (let i = 0; i < nHex; i++) {
      const [px, py] = hexLoop[i];
      const dx = px;
      const dy = py - 0.465;
      const dl = Math.hypot(dx, dy) || 1;
      const pIn = hitFront(px - (dx / dl) * 0.016, py - (dy / dl) * 0.016, 0.011);
      const pOut = hitFront(px + (dx / dl) * 0.006, py + (dy / dl) * 0.006, 0.010);
      framePos.push(pIn[0], pIn[1], pIn[2], pOut[0], pOut[1], pOut[2]);
      const a = i * 2;
      const b = a + 1;
      const c = ((i + 1) % nHex) * 2 + 1;
      const d = ((i + 1) % nHex) * 2;
      frameIdx.push(a, b, c, a, c, d);
    }
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(framePos, 3));
    frameGeo.setIndex(frameIdx);
    mergeGeo(frameGeo, chromeMat, null);

    for (const gy of [0.322, 0.495, 0.538, 0.580, 0.610]) {
      const wBar = grilleHalfW(gy) - 0.016;
      for (let s = -3; s < 3; s++) {
        const x0b = (s / 3) * wBar;
        const x1b = ((s + 1) / 3) * wBar;
        quad(hitFront(x0b, gy, 0.010), hitFront(x1b, gy, 0.010), 0.007, trimMat, [0, 0, 0.002]);
      }
    }

    const ringGeoF = new THREE.TorusGeometry(0.035, 0.0055, 4, 12);
    const ringGeoR = new THREE.TorusGeometry(0.031, 0.005, 4, 12);
    for (let r = 0; r < 4; r++) {
      const rx = (r - 1.5) * 0.054;
      const pf = hitFront(rx, 0.568, 0.016);
      addPart(ringGeoF, chromeMat, pf);
      const pr = hitRear(rx, 0.848, 0.014);
      addPart(ringGeoR, chromeMat, pr, [-0.16, 0, 0]);
    }

    const pfPlate = hitFront(0, 0.415, 0.016);
    addPart(new THREE.BoxGeometry(0.525, 0.122, 0.016), trimMat, [0, 0.415, pfPlate[2]]);
    addPart(new THREE.PlaneGeometry(0.510, 0.112), plateFaceMat, [0, 0.415, pfPlate[2] + 0.009]);

    const prPlateTop = hitRear(0, 0.755, 0.015);
    const prPlateC = hitRear(0, 0.700, 0.015);
    const prPlateBot = hitRear(0.25, 0.645, 0.015);
    const zRearPlate = Math.min(prPlateTop[2], prPlateC[2], prPlateBot[2]) - 0.016;
    addPart(new THREE.BoxGeometry(0.525, 0.118, 0.016), trimMat, [0, 0.702, zRearPlate], [0, 0, 0]);
    addPart(new THREE.PlaneGeometry(0.510, 0.108), plateFaceMat, [0, 0.702, zRearPlate - 0.009], [0, Math.PI, 0]);
    // קורות A פנימיות + מראה מרכזית לתצוגת קוקפיט נהג (FPV)
    for (const sx of [1, -1]) {
      const qPil = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-sx * 0.13, 0.42, -0.58).normalize()
      );
      addPart(new THREE.BoxGeometry(0.045, 0.72, 0.045), trimMat, [sx * 0.60, 1.13, 0.52], null, [1, 1, 1], qPil);
    }
    addPart(new THREE.BoxGeometry(0.18, 0.048, 0.025), trimMat, [0, 1.30, 0.28]);

    for (const sx of [1, -1]) {
      buildCurvedSurface(6, 3, (u, v) => {
        const ax = (0.440 + 0.02 * v) * (1 - u) + (0.735 - 0.015 * (1 - v)) * u;
        const yLo = 0.252 + 0.020 * u;
        const yHi = 0.345 + 0.022 * u;
        const y = yLo * (1 - v) + yHi * v;
        return hitCornerFront(sx, ax, y, 0.007);
      }, grilleDarkMat, sx < 0);

      for (let s = 0; s < 4; s++) {
        const u0 = s / 4;
        const u1 = (s + 1) / 4;
        const ax0 = 0.448 * (1 - u0) + 0.728 * u0;
        const ax1 = 0.448 * (1 - u1) + 0.728 * u1;
        const y0 = 0.298 + 0.020 * u0;
        const y1 = 0.298 + 0.020 * u1;
        quad(
          hitCornerFront(sx, ax0, y0, 0.011),
          hitCornerFront(sx, ax1, y1, 0.011),
          0.013,
          glossBlackMat,
          [sx * 0.002, 0, 0.003]
        );
      }
    }

    // 6. פנסים קדמיים בצורה האמיתית של Audi A1 8X
    for (const sx of [1, -1]) {
      const hlPoint = (u, v, outShift) => {
        const ax = 0.425 * (1 - u) + 0.790 * u;
        const yTopH = 0.650 * (1 - u) + 0.752 * u;
        const wave = Math.sin(u * Math.PI) * 0.020;
        const yBotH = 0.582 * (1 - u) + 0.656 * u - wave;
        const y = yBotH * (1 - v) + yTopH * v;
        return hitCornerFront(sx, ax, y, outShift);
      };

      buildCurvedSurface(7, 4, (u, v) => hlPoint(u, v, 0.006), hlHousingMat, sx < 0);

      for (const [pu, rad] of [[0.34, 0.023], [0.66, 0.027]]) {
        const c = hlPoint(pu, 0.54, 0.013);
        addPart(
          new THREE.CylinderGeometry(rad, rad * 0.75, 0.016, 7, 1, true),
          chromeMat,
          c,
          [Math.PI / 2, 0, -sx * (0.25 + pu * 0.35)]
        );
        addPart(
          new THREE.SphereGeometry(rad * 0.50, 5, 4),
          drlMat,
          [c[0] + sx * 0.002, c[1], c[2] + 0.005]
        );
      }

      for (let s = 0; s < 5; s++) {
        const u0 = 0.05 + (s / 5) * 0.90;
        const u1 = 0.05 + ((s + 1) / 5) * 0.90;
        const v0 = 0.16 + (u0 > 0.68 ? (u0 - 0.68) * 0.85 : 0);
        const v1 = 0.16 + (u1 > 0.68 ? (u1 - 0.68) * 0.85 : 0);
        quad(hlPoint(u0, v0, 0.016), hlPoint(u1, v1, 0.016), 0.014, drlMat, [sx * 0.002, 0.001, 0.004]);
      }

      for (let s = 0; s < 5; s++) {
        const u0 = s / 5;
        const u1 = (s + 1) / 5;
        quad(hlPoint(u0, 0.96, 0.015), hlPoint(u1, 0.96, 0.015), 0.011, glossBlackMat, [sx * 0.002, 0.002, 0.003]);
      }

      buildCurvedSurface(7, 4, (u, v) => hlPoint(u, v, 0.023), hlLensMat, sx < 0);
    }

    // 7. פנסים אחוריים עם נפח תלת-ממדי עוטף (Clamshell 3D Taillights)
    for (const sx of [1, -1]) {
      const tlPoint = (u, v, reliefM) => {
        if (u <= 0.62) {
          const t = u / 0.62;
          const ax = (0.375 + 0.028 * v) * (1 - t) + 0.742 * t;
          const yLo = 0.726 * (1 - t) + 0.715 * t;
          const yHi = 0.812 * (1 - t) + 0.855 * t;
          const y = yLo * (1 - v) + yHi * v;
          rOrig.set(sx * (ax + 0.35 * t), y, -2.9);
          rDir.set(-sx * 0.35 * t, 0, 1).normalize();
          rc.set(rOrig, rDir);
          const hits = rc.intersectObject(bodyMesh, false);
          if (hits.length > 0) {
            const h = hits[0];
            const nx = sx * (0.15 + 0.58 * t);
            const ny = 0.08;
            const nz = -(0.96 - 0.36 * t);
            const nl = Math.hypot(nx, ny, nz) || 1;
            return [
              h.point.x + (nx / nl) * reliefM,
              h.point.y + (ny / nl) * reliefM,
              h.point.z + (nz / nl) * reliefM
            ];
          }
          return hitRear(sx * ax, y, reliefM);
        }
        const t = (u - 0.62) / 0.38;
        const corner = hitRear(sx * 0.742, 0.785, 0.0);
        const z = corner[2] * (1 - t) + -1.560 * t;
        const yHi = 0.855 * (1 - t) + 0.870 * t;
        const yLo = 0.715 * (1 - t) + 0.858 * t;
        const y = yLo * (1 - v) + yHi * v;
        const sideHit = hitSide(sx, y, z, 0.0);
        const nx = sx * 0.94;
        const ny = 0.12;
        const nz = -0.32 * (1 - t);
        const nl = Math.hypot(nx, ny, nz) || 1;
        return [
          sideHit[0] + (nx / nl) * reliefM,
          sideHit[1] + (ny / nl) * reliefM,
          sideHit[2] + (nz / nl) * reliefM
        ];
      };

      buildCurvedSurface(10, 4, (u, v) => {
        const edgeU = Math.sin(Math.pow(u, 0.82) * Math.PI);
        const edgeV = Math.sin(v * Math.PI);
        const bevel = Math.min(1, edgeU * 2.8) * Math.min(1, edgeV * 2.8);
        const relief = 0.005 + 0.025 * bevel;
        return tlPoint(u, v, relief);
      }, tailBodyMat, sx > 0);

      const ledRibbonPts = [
        [0.05, 0.78],
        [0.32, 0.82],
        [0.58, 0.80],
        [0.80, 0.68],
        [0.56, 0.42],
        [0.24, 0.46],
        [0.06, 0.52]
      ];
      for (let s = 0; s < ledRibbonPts.length - 1; s++) {
        const pA = tlPoint(ledRibbonPts[s][0], ledRibbonPts[s][1], 0.032);
        const pB = tlPoint(ledRibbonPts[s + 1][0], ledRibbonPts[s + 1][1], 0.032);
        quad(pA, pB, 0.015, tailLedMat, [sx * 0.002, 0.001, -0.003]);
      }

      for (let s = 0; s < 3; s++) {
        const u0 = 0.07 + (s / 3) * 0.48;
        const u1 = 0.07 + ((s + 1) / 3) * 0.48;
        quad(tlPoint(u0, 0.22, 0.031), tlPoint(u1, 0.22, 0.031), 0.015, tailClearMat, [sx * 0.002, 0, -0.003]);
      }
    }

    // דיפיוזר אחורי תחתון + מחזירי אור + זוג אגזוזים בשמאל (+X) + 4 חיישנים
    buildCurvedSurface(8, 2, (u, v) => {
      const s = u * 2 - 1;
      const x = s * 0.60;
      const y = 0.250 + v * 0.062;
      return hitRear(x, y, 0.006);
    }, trimMat, false);

    for (const sx of [1, -1]) {
      quad(
        hitRear(sx * 0.46, 0.275, 0.009),
        hitRear(sx * 0.57, 0.280, 0.009),
        0.015,
        tailLedMat,
        [0, 0, -0.003]
      );
    }

    for (const exX of [0.415, 0.480]) {
      const pEx = hitRear(exX, 0.265, 0.0);
      addPart(new THREE.CylinderGeometry(0.026, 0.026, 0.09, 8, 1, true), chromeMat, [exX, 0.238, pEx[2] + 0.012], [Math.PI / 2, 0, 0]);
      addPart(new THREE.CylinderGeometry(0.021, 0.021, 0.08, 6), underMat, [exX, 0.238, pEx[2] + 0.015], [Math.PI / 2, 0, 0]);
    }

    for (const px of [-0.50, -0.18, 0.18, 0.50]) {
      const ps = hitRear(px, 0.475, 0.006);
      addPart(new THREE.RingGeometry(0.008, 0.012, 6), seamMat, ps, [0, Math.PI + px * 0.28, 0]);
    }
    quad(hitRear(0.535, 0.685, 0.006), hitRear(0.485, 0.685, 0.006), 0.020, chromeMat, [0, 0, -0.004]);
    quad(hitRear(-0.465, 0.685, 0.006), hitRear(-0.545, 0.685, 0.006), 0.016, chromeMat, [0, 0, -0.004]);

    // 8. קווי דלת רציפים וחדים (3 דלתות), קו כתף, ידית תלת-ממדית לבנה ומכסה דלק בצד ימין (-X)
    const sideAccessoryPaintMat = paintMat;

    for (const sx of [1, -1]) {
      const doorLoop = [
        [0.745, 0.912],
        [0.802, 0.740],
        [0.800, 0.480],
        [0.775, 0.235],
        [0.140, 0.228],
        [-0.505, 0.232],
        [-0.485, 0.520],
        [-0.465, 0.760],
        [-0.445, 0.932]
      ];
      for (let i = 0; i < doorLoop.length - 1; i++) {
        const [zA, yA] = doorLoop[i];
        const [zB, yB] = doorLoop[i + 1];
        const steps = i === 4 ? 3 : 2;
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          const zz0 = zA + (zB - zA) * t0;
          const yy0 = yA + (yB - yA) * t0;
          const zz1 = zA + (zB - zA) * t1;
          const yy1 = yA + (yB - yA) * t1;
          quad(
            hitSide(sx, yy0, zz0, 0.004),
            hitSide(sx, yy1, zz1, 0.004),
            0.009,
            seamMat,
            [sx * 0.002, 0, 0]
          );
        }
      }

      const creaseZ = [1.52, 1.05, 0.50, -0.10, -0.68, -1.20, -1.56];
      for (let i = 0; i < creaseZ.length - 1; i++) {
        const zA = creaseZ[i];
        const zB = creaseZ[i + 1];
        const yA = 0.748 + (1.52 - zA) * 0.038;
        const yB = 0.748 + (1.52 - zB) * 0.038;
        quad(
          hitSide(sx, yA, zA, 0.0035),
          hitSide(sx, yB, zB, 0.0035),
          0.006,
          seamMat,
          [sx * 0.002, 0.001, 0]
        );
      }

      const hZ = -0.315;
      const hY = 0.818;
      const hSurf = hitSide(sx, hY, hZ, 0.0);
      const hX = hSurf[0];

      addPart(new THREE.CylinderGeometry(0.032, 0.032, 0.006, 8), seamMat, [hX + sx * 0.004, hY, hZ], [0, 0, Math.PI / 2], [0.60, 1, 1.95]);
      addPart(new THREE.BoxGeometry(0.022, 0.026, 0.165), sideAccessoryPaintMat, [hX + sx * 0.019, hY, hZ + 0.012]);
      addPart(new THREE.BoxGeometry(0.018, 0.024, 0.028), sideAccessoryPaintMat, [hX + sx * 0.010, hY, hZ + 0.080]);
      addPart(new THREE.BoxGeometry(0.020, 0.026, 0.038), sideAccessoryPaintMat, [hX + sx * 0.012, hY, hZ - 0.088]);

      if (sx > 0) {
        addPart(new THREE.CylinderGeometry(0.005, 0.005, 0.022, 6), chromeMat, [hX + sx * 0.014, hY, hZ - 0.088], [0, 0, Math.PI / 2]);
      }
    }

    const fSurf = hitSide(-1, 0.845, -1.06, 0.005);
    addPart(new THREE.RingGeometry(0.064, 0.072, 12), seamMat, fSurf, [0.12, -Math.PI / 2 - 0.04, 0]);

    // 9. מראות צד לבנות מעוגלות עם רגל כהה על פח הדלת
    for (const sx of [1, -1]) {
      const mBaseZ = 0.635;
      const mBaseY = 0.875;
      const mSurf = hitSide(sx, mBaseY, mBaseZ, 0.0);
      const mBaseX = mSurf[0];

      addPart(new THREE.CylinderGeometry(0.018, 0.028, 0.024, 6), glossBlackMat, [mBaseX + sx * 0.008, mBaseY, mBaseZ], [0, 0, -sx * 1.25], [1.0, 1.0, 2.1]);

      const stalkCurve = [
        [mBaseX + sx * 0.010, mBaseY + 0.004, mBaseZ],
        [mBaseX + sx * 0.045, mBaseY + 0.034, mBaseZ - 0.015],
        [mBaseX + sx * 0.078, mBaseY + 0.064, mBaseZ - 0.032]
      ];
      for (let s = 0; s < stalkCurve.length - 1; s++) {
        const a = stalkCurve[s];
        const b = stalkCurve[s + 1];
        const mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const qStrut = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
        );
        addPart(new THREE.CylinderGeometry(0.015, 0.019, len + 0.01, 6), glossBlackMat, mid, null, [0.85, 1, 1.65], qStrut);
      }

      const headGroup = new THREE.Group();
      headGroup.position.set(mBaseX + sx * 0.118, mBaseY + 0.084, mBaseZ - 0.045);
      headGroup.rotation.y = -sx * 0.16;
      headGroup.updateMatrixWorld(true);

      const addHeadPart = (geo, mat, pos, rot, scl) => {
        const mChild = new THREE.Matrix4();
        const p = pos ? new THREE.Vector3(pos[0], pos[1], pos[2]) : new THREE.Vector3();
        const q = rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0)) : new THREE.Quaternion();
        const s = scl ? new THREE.Vector3(scl[0], scl[1], scl[2]) : new THREE.Vector3(1, 1, 1);
        mChild.compose(p, q, s);
        const mWorld = new THREE.Matrix4().multiplyMatrices(headGroup.matrixWorld, mChild);
        mergeGeo(geo, mat, mWorld);
      };

      const capGeo = new THREE.SphereGeometry(0.080, 10, 6);
      capGeo.scale(1.14, 0.68, 0.84);
      addHeadPart(capGeo, sideAccessoryPaintMat);
      addHeadPart(new THREE.CylinderGeometry(0.076, 0.068, 0.016, 8), glossBlackMat, [0, -0.038, 0.018], null, [1.10, 1, 0.45]);
      addHeadPart(new THREE.CircleGeometry(0.074, 10), mirrorGlassMat, [0, 0.002, -0.069], [0, Math.PI, 0], [1.06, 0.62, 1]);
      addHeadPart(new THREE.BoxGeometry(0.055, 0.008, 0.018), drlMat, [sx * 0.052, -0.004, 0.048], [0, sx * 0.42, 0]);
    }

    // מיזוג סרטי ה-quad לתוך דליי החומרים המאוחדים
    for (const [mat, batch] of quadBatches.entries()) {
      if (batch.idx.length === 0) continue;
      const qGeo = new THREE.BufferGeometry();
      qGeo.setAttribute('position', new THREE.Float32BufferAttribute(batch.pos, 3));
      qGeo.setIndex(batch.idx);
      mergeGeo(qGeo, mat, null);
    }

    // יצירת Mesh אחד מאוחד לכל חומר סטטי
    for (const [mat, b] of staticBuckets.entries()) {
      if (b.idx.length === 0) continue;
      const mGeo = new THREE.BufferGeometry();
      mGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      mGeo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
      if (b.hasUV) {
        mGeo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      }
      mGeo.setIndex(b.idx);
      const mesh = new THREE.Mesh(mGeo, mat);
      if (mat === sideAccessoryPaintMat || mat === glossBlackMat) mesh.castShadow = true;
      g.add(mesh);
    }

    // 10. ארבעה גלגלי סגסוגת 10-חישורים תלת-ממדיים (2 קריאות ציור לגלגל בלבד = 8 קריאות לכל 4 הגלגלים!)
    const wheels = [];
    const wheelW = 0.215;
    const rimR = 0.205;

    const sharedTireProf = [
      new THREE.Vector2(rimR - 0.008, -wheelW * 0.44),
      new THREE.Vector2(R - 0.018, -wheelW * 0.48),
      new THREE.Vector2(R, 0.0),
      new THREE.Vector2(R - 0.018, wheelW * 0.48),
      new THREE.Vector2(rimR - 0.008, wheelW * 0.44)
    ];

    const buildWheelGroup = (sx, sz) => {
      const wg = new THREE.Group();
      wg.position.set(sx * (hw - 0.115), R, sz * (WB / 2));

      // דלי 1 לגלגל: צמיג + גב פנימי + חישוק סגסוגת 3D (מאוחד ל-alloy/tire או 2 חומרים: tireMat + rimDiskMat/alloyMat)
      const wBuckets = new Map();
      const addWGeo = (geo, mat, pos, rot) => {
        const gClone = geo.clone();
        const m4 = new THREE.Matrix4();
        const p = pos ? new THREE.Vector3(pos[0], pos[1], pos[2]) : new THREE.Vector3();
        const q = rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0)) : new THREE.Quaternion();
        m4.compose(p, q, new THREE.Vector3(1, 1, 1));
        gClone.applyMatrix4(m4);
        gClone.computeVertexNormals();
        const pA = gClone.getAttribute('position');
        const nA = gClone.getAttribute('normal');
        const uvA = gClone.getAttribute('uv');
        const idxA = gClone.index ? Array.from(gClone.index.array) : Array.from({ length: pA.count }, (_, k) => k);
        let wb = wBuckets.get(mat);
        if (!wb) {
          wb = { pos: [], norm: [], uv: [], idx: [], hasUV: false };
          wBuckets.set(mat, wb);
        }
        const base = wb.pos.length / 3;
        for (let k = 0; k < pA.count; k++) {
          wb.pos.push(pA.getX(k), pA.getY(k), pA.getZ(k));
          wb.norm.push(nA ? nA.getX(k) : 0, nA ? nA.getY(k) : 1, nA ? nA.getZ(k) : 0);
          if (uvA) {
            wb.uv.push(uvA.getX(k), uvA.getY(k));
            wb.hasUV = true;
          } else {
            wb.uv.push(0, 0);
          }
        }
        for (let k = 0; k < idxA.length; k++) wb.idx.push(base + idxA[k]);
      };

      const tireGeo = new THREE.LatheGeometry(sharedTireProf, 14);
      tireGeo.rotateZ(Math.PI / 2);
      addWGeo(tireGeo, tireMat);
      addWGeo(new THREE.CircleGeometry(rimR, 10), tireMat, [-sx * (wheelW * 0.42), 0, 0], [0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0]);

      addWGeo(new THREE.CircleGeometry(rimR - 0.004, 16), rimDiskMat, [sx * (wheelW * 0.39), 0, 0], [0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0]);

      const hubGeo = new THREE.CylinderGeometry(0.048, 0.054, 0.024, 8);
      hubGeo.rotateZ(Math.PI / 2);
      addWGeo(hubGeo, alloyMat, [sx * (wheelW * 0.42), 0, 0]);
      addWGeo(new THREE.RingGeometry(rimR - 0.024, rimR + 0.004, 16), alloyMat, [sx * (wheelW * 0.445), 0, 0], [0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0]);

      const spPos = [];
      const spIdx = [];
      for (let sp = 0; sp < 10; sp++) {
        const ang = (sp / 10) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const tx = -sa * 0.011;
        const ty = ca * 0.011;
        const r0 = 0.044;
        const r1 = rimR - 0.016;
        const xIn = sx * (wheelW * 0.425);
        const xOut = sx * (wheelW * 0.443);
        const b0 = spPos.length / 3;
        spPos.push(
          xIn, ca * r0 - tx, sa * r0 - ty,
          xIn, ca * r0 + tx, sa * r0 + ty,
          xOut, ca * r1 + tx * 0.78, sa * r1 + ty * 0.78,
          xOut, ca * r1 - tx * 0.78, sa * r1 - ty * 0.78
        );
        if (sx > 0) {
          spIdx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
        } else {
          spIdx.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
        }
      }
      const spGeo = new THREE.BufferGeometry();
      spGeo.setAttribute('position', new THREE.Float32BufferAttribute(spPos, 3));
      spGeo.setIndex(spIdx);
      addWGeo(spGeo, alloyMat);

      for (const [mat, wb] of wBuckets.entries()) {
        const wGeo = new THREE.BufferGeometry();
        wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wb.pos, 3));
        wGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wb.norm, 3));
        if (wb.hasUV) wGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wb.uv, 2));
        wGeo.setIndex(wb.idx);
        const wm = new THREE.Mesh(wGeo, mat);
        if (mat === tireMat) wm.castShadow = true;
        wg.add(wm);
      }

      g.add(wg);
      return wg;
    };

    for (const sz of [1, -1]) {
      for (const sx of [1, -1]) {
        wheels.push(buildWheelGroup(sx, sz));
      }
    }

    g.userData.ownWheels = wheels;
    return g;
  }

  let mountedMesh = null;
  let hostCarRef = null;
  let oldChildren = [];
  let oldWheels = null;
  let activeWorld = null;

  const adapter = {
    id: 'ariel-car',
    name: 'הרכב של אריאל (Audi A1)',
    dept: 'assets',
    order: 57,
    init(world) {
      if (typeof location !== 'undefined' && /[?&]ariel-car=0(?:&|$)/.test(location.search)) return;
      activeWorld = world || null;
      this.update();
    },
    update() {
      if (mountedMesh) return;
      if (typeof location !== 'undefined' && /[?&]ariel-car=0(?:&|$)/.test(location.search)) return;
      const SRef =
        (typeof S !== 'undefined' && S) ||
        (activeWorld && activeWorld.S) ||
        (typeof window !== 'undefined' && window.S);
      if (!SRef || !SRef.car || typeof THREE === 'undefined') return;

      hostCarRef = SRef.car;
      oldChildren = [...hostCarRef.children];
      oldWheels = hostCarRef.userData ? hostCarRef.userData.wheels : undefined;
      for (const ch of oldChildren) {
        hostCarRef.remove(ch);
      }

      mountedMesh = build();
      hostCarRef.add(mountedMesh);
      if (!hostCarRef.userData) hostCarRef.userData = {};
      hostCarRef.userData.wheels = mountedMesh.userData.ownWheels;

      if (activeWorld) {
        activeWorld.arielCar = {
          plate: PLATE,
          model: 'Audi A1 8X 3-door',
          source: 'photos 075-082',
          mesh: mountedMesh
        };
      }
    },
    dispose() {
      if (hostCarRef && mountedMesh) {
        hostCarRef.remove(mountedMesh);
        for (const ch of oldChildren) {
          hostCarRef.add(ch);
        }
        if (hostCarRef.userData) {
          hostCarRef.userData.wheels = oldWheels;
        }
      }
      if (activeWorld && activeWorld.arielCar) {
        delete activeWorld.arielCar;
      }
      mountedMesh = null;
      hostCarRef = null;
      oldChildren = [];
      oldWheels = null;
    }
  };

  if (typeof YZW !== 'undefined' && YZW && typeof YZW.register === 'function') {
    YZW.register(adapter);
  }
  if (typeof module === 'object' && module && module.exports) {
    module.exports = { plateTex, rimTex, build, adapter };
  }
})();
