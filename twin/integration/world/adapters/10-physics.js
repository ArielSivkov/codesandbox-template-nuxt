/* מתאם: מחלקת הפיזיקה (swarm/physics → mods/physics/esh27-physics.js, window.ESH27Physics)
 * 1) מקור אמת יחיד לשמש: providers.sun / sunTimes / sunVector (γ = itmConvergence, ≈ −0.29° באשדוד).
 * 2) מחליף את מצב "רחפן" של המשחק ברחפן 6 דרגות חופש (createDrone + createStepper + createWind, Dryden).
 * המרת כיוונים: במשחק yaw=0 מביט דרומה (+z), ובפיזיקה heading נמדד מצפון עם השעון → ψ = π − yaw.
 */
(function () {
  'use strict';
  const LAT = 31.8014, LON = 34.6435;
  let PH = null, GAMMA = 0;
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const D = { drone: null, stepper: null, wind: null, windT: 0, mesh: null, camD: 3.4, hitT: 0 };

  function nearBoxes(world, x, z, r) {
    const out = []; let n = 0;
    for (const b of world.data.near(x, z, r) || []) { if (n++ > 60) break;
      out.push({ x: (b.minx + b.maxx) / 2, z: (b.minz + b.maxz) / 2, sx: b.maxx - b.minx, sz: b.maxz - b.minz, h: Math.max(3, b.top - Math.max(0, world.data.H(b.cx, b.cz))), rot: 0 }); }
    return out;
  }
  function buildWind(world, x, z) {
    const w = world.weather, B = nearBoxes(world, x, z, 160);
    const prev = D.wind; D.wind = PH.createWind({ speed10: w.windSpeed, fromDeg: w.windFrom, buildings: B, gusts: true, seed: 2711, gammaDeg: GAMMA, groundY: Math.max(0, world.data.H(x, z)), turbulenceScale: Math.max(1, w.gust - 0.3) });
    if (D.stepper && prev) D.stepper = PH.createStepper(D.drone, { wind: D.wind, collide: D.collide });
  }
  function collider(world) {
    return (p, r, v) => {
      const W = world.data; const c = W.collide(p.x, p.z, r, p.y - r, p.y + r);
      if (!c || (Math.abs(c.x - p.x) < 1e-6 && Math.abs(c.z - p.z) < 1e-6)) return null;
      let nx = c.x - p.x, nz = c.z - p.z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const vn = v.x * nx + v.z * nz; const nv = vn < 0 ? { x: v.x - 1.3 * vn * nx, y: v.y, z: v.z - 1.3 * vn * nz } : v;
      return { p: { x: c.x, y: p.y, z: c.z }, v: nv, impact: vn < 0 ? -vn : 0 };
    };
  }

  YZW.register({
    id: 'physics', name: 'פיזיקה (שמש NOAA, רחפן, רוח)', dept: 'physics', order: 10, provides: [],
    scripts: ['mods/physics/esh27-physics.js'],
    requires: () => !!window.ESH27Physics,
    init(world) {
      PH = window.ESH27Physics; GAMMA = PH.itmConvergence(LAT, LON);
      world.providers.sun = (date, lat, lon) => PH.sunPosition(date, lat, lon);
      world.providers.sunVector = sp => PH.sunVector(sp.elevation, sp.azimuth, GAMMA);
      world.providers.sunTimes = (y, mo, d, lat, lon) => PH.sunTimes(y, mo + 1, d, lat, lon);
      world.providers.gammaDeg = GAMMA; world.sun.source = 'physics ' + (PH.VERSION || '') + ' (NOAA, ±0.005°)';
      // בדיקת עקביות מול המשחק (מתועד ביומן)
      const d = new Date(), a = PH.sunPosition(d, LAT, LON), b = world.G27.SIM.sunPosition(d, LAT, LON);
      world.sun.crossCheck = { dEl: +(a.elevation - b.elevation).toFixed(4), dAz: +(a.azimuth - b.azimuth).toFixed(4) };
      D.collide = collider(world);
      YZW.setTime({ date: world.clock.date });  // מחשב מחדש עם המקור החדש
    },
    dispose(world) { world.providers.sun = null; world.providers.sunVector = null; world.providers.sunTimes = null; world.sun.source = 'game/sim.js (NOAA)'; },
    modes: [{
      id: 'drone', name: 'רחפן', icon: '🛸', sub: 'DJI פיזיקלי',
      enter(world, from, pos) {
        const G = world.G27, W = world.data; const yaw = G.S.heading;
        const x = pos.x + Math.sin(yaw) * 2, z = pos.z + Math.cos(yaw) * 2, gy = Math.max(W.floorAt(x, z, pos.y + 0.5), 0);
        D.drone = PH.createDrone({ position: [x, gy + 0.2, z], yaw: Math.PI - yaw, mode: 'gps', groundY: gy });
        buildWind(world, x, z); D.stepper = PH.createStepper(D.drone, { wind: D.wind, collide: D.collide });
        D.mesh = G.drone; D.mesh.visible = true; G.S.cam.yaw = yaw; D.camD = 3.4;
        YZW.notice('🛸 רחפן פיזיקלי (DJI Phantom 4): ▲ המראה · ג׳ויסטיק תנועה · גרירה לסיבוב · רוח אמיתית עם משבים', { kind: 'info', ms: 3500 });
      },
      exit(world) { if (D.mesh) D.mesh.visible = false; D.drone = null; D.stepper = null; },
      update(dt, world, inp) {
        const G = world.G27, W = world.data, s = D.drone.s, cam = world.camera;
        const ww = world.weather; if (D.wind) { D.wind.speed10 = ww.windSpeed; D.wind.fromDeg = ww.windFrom; }
        D.windT -= dt; if (D.windT <= 0) { D.windT = 2; if (D.wind) D.wind.buildings = nearBoxes(world, s.p.x, s.p.z, 160); }
        D.drone.groundY = Math.max(W.floorAt(s.p.x, s.p.z, s.p.y + 0.3), 0);
        const camYaw = G.S.cam.yaw, hd = D.drone.heading ? D.drone.heading() : 0;   // heading מצפון
        let yawIn = Math.max(-1, Math.min(1, angDiff(hd, Math.PI - camYaw) * 2.5)); if (inp.yawL) yawIn = -1; if (inp.yawR) yawIn = 1;
        const sticks = { throttle: inp.up ? 1 : inp.down ? -1 : 0, pitch: inp.y, roll: inp.x, yaw: yawIn };
        const al = D.stepper.advance(dt, sticks), pose = D.stepper.pose(al);
        D.mesh.position.set(pose.p.x, pose.p.y, pose.p.z); D.mesh.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
        for (const pr of D.mesh.userData.props || []) pr.visible = !s.landed;
        if (s.collided > 3 && D.hitT <= 0) { YZW.notice('💥 פגיעה במבנה (' + s.collided.toFixed(1) + ' מ׳/ש׳)', { ms: 1500 }); D.hitT = 1.5; } D.hitT -= dt;
        // מצלמה עוקבת מאחור
        const cp = Math.cos(G.S.cam.pitch), sp = Math.sin(G.S.cam.pitch), d = D.camD;
        const tx = pose.p.x, ty = pose.p.y + 0.25, tz = pose.p.z;
        const want = new THREE.Vector3(tx - Math.sin(camYaw) * cp * d, ty + sp * d, tz - Math.cos(camYaw) * cp * d);
        const g = Math.max(W.H(want.x, want.z), 0) + 0.5; if (want.y < g) want.y = g;
        cam.position.lerp(want, 1 - Math.exp(-dt * 12)); cam.lookAt(tx, ty, tz);
        if (world.sunLight) { const sd = world.sky.material.uniforms.sun.value; world.sunLight.target.position.set(tx, ty, tz); world.sunLight.position.set(tx + sd.x * 400, ty + sd.y * 400, tz + sd.z * 400); }
        const lw = D.drone.lastWind || { x: 0, z: 0 }; const wh = G.windHere; if (wh) { wh.x = lw.x || 0; wh.z = lw.z || 0; wh.speed = Math.hypot(wh.x, wh.z); }
        const sp2 = Math.hypot(s.v.x, s.v.z);
        return { x: pose.p.x, y: pose.p.y, z: pose.p.z, speed: sp2, alt: pose.p.y - D.drone.groundY, soc: D.drone.soc ? D.drone.soc() : null };
      },
    }],
    hudPanels: [{ id: 'drone', render(el, world) { if (world.player.mode !== 'drone' || !D.drone) return; const soc = D.drone.soc ? D.drone.soc() : 1;
      el.textContent = `🔋 ${(soc * 100).toFixed(0)}% · ${D.drone.mode === 'atti' ? 'ATTI' : 'GPS'} · רוח מקומית ${(D.drone.lastWind ? Math.hypot(D.drone.lastWind.x, D.drone.lastWind.z) : 0).toFixed(1)} מ׳/ש׳`; } }],
  });
})();
