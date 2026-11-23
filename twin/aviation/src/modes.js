/* ESH27 aviation — modes.js : plug-in modes for the game (jet fighter, spaceship) + the world adapter.
 *
 *   import { makeWorld, createJetMode, createShipMode } from '…/aviation/src/modes.js';
 *   const world = makeWorld({ frame, far, city: W27 (optional), runway });
 *   const jet = createJetMode({ THREE, scene, world, frame, controls, hud });
 *   jet.enter({ x, y, z, heading, speed, onGround, throttle });   // heading: grid degrees (0 = −z = north)
 *   each frame:  jet.update(dt, input?)  → physics (fixed 1/120 s inside); input defaults to controls.poll(dt)
 *                jet.updateCamera(dt, camera)  → writes camera.position/quaternion (float64 local frame)
 *                jet.hudData()  → plain object (speed kt/km/h, alt, heading, G, AoA, stall …)  — hud.update() is called for you
 *   jet.exit();  jet.sim is the JetSim, jet.object the THREE.Group, jet.rig the CameraRig.
 * The ship mode has the same shape. Both never touch the game's own DOM. */
import { JetSim, FIGHTER } from './jet.js';
import { ShipSim, SHIP } from './spaceship.js';
import { makeJet, makeShip } from './models.js';
import { CameraRig } from './camera.js';

/** World for the sims. city: the game's W27 (W.H, W.collide, W.bounds) or null. runway: {x, z, len, wid, heading (grid deg), y}. */
export function makeWorld({ frame, far, city = null, runway = null }) {
  const R = frame.R, center = frame.center;
  const rwy = runway && { ...runway, c: Math.cos(runway.heading * Math.PI / 180), s: Math.sin(runway.heading * Math.PI / 180) };
  const inCity = (x, z) => city && city.ready && city.bounds && x > city.bounds.minx && x < city.bounds.maxx && z > city.bounds.minz && z < city.bounds.maxz;
  return {
    center, R, frame,
    surface(x, z) {
      if (rwy) { const dx = x - rwy.x, dz = z - rwy.z, a = dx * rwy.s - dz * rwy.c, b = dx * rwy.c + dz * rwy.s; // along / across
        if (Math.abs(a) < rwy.len / 2 + 60 && Math.abs(b) < rwy.wid / 2 + 20) return { y: rwy.y, type: Math.abs(a) < rwy.len / 2 && Math.abs(b) < rwy.wid / 2 ? 'runway' : 'ground' }; }
      if (inCity(x, z)) { const h = city.H(x, z); return { y: Math.max(h, 0), type: h < -0.5 ? 'water' : 'ground' }; }
      return far ? far.surface(x, z) : { y: 0, type: 'water' };
    },
    collide(x, y, z) { if (!inCity(x, z) || !city.collide || y > 400) return false; const c = city.collide(x, z, 3, y - 1.2, y + 1.2); return !!(c && c.hit); },
  };
}

function bodyUp(sim) { return sim._up ? sim._up(sim.pos, {}) : sim.up(sim.pos, {}); }

export function createJetMode({ THREE: T, scene, world, frame, controls = null, hud = null, params = FIGHTER, onEvent = null }) {
  const sim = new JetSim(params, world), obj = makeJet(T), rig = new CameraRig(T); obj.visible = false; scene.add(obj);
  let start = null, pose = null, lastInp = {};
  const api = {
    name: 'jet', sim, object: obj, rig,
    enter(o = {}) { start = { ...o }; sim.reset(o); obj.visible = true; rig.ok = false; if (controls) { controls.setMode('jet'); controls.setThrottle(o.throttle != null ? o.throttle : sim.thr); } return api; },
    exit() { obj.visible = false; },
    update(dt, input) {
      const inp = input || (controls ? controls.poll(dt) : {}); lastInp = inp; const e = inp.edges || new Set();
      if (e.has('view')) rig.toggle(); if (e.has('fbw')) sim.fbw = !sim.fbw; if (e.has('reset') && start) api.enter(start);
      if (inp.look) { rig.look.yaw -= inp.look.dx * 0.006; rig.look.pitch = Math.max(-1.2, Math.min(1.2, rig.look.pitch + inp.look.dy * 0.004)); }
      if (!inp.look || (!inp.look.dx && !inp.look.dy)) { rig.look.yaw *= Math.exp(-dt * 0.8); rig.look.pitch *= Math.exp(-dt * 0.8); }
      sim.update(dt, inp);
      for (const ev of sim.events) onEvent && onEvent(ev, api); sim.events.length = 0;
      pose = sim.renderPose(pose || undefined);
      obj.position.set(pose.pos.x, pose.pos.y, pose.pos.z); obj.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
      const u = obj.userData, ab = sim.ab, en = sim.eng; u.flame.visible = en > 0.55 || ab > 0.05; u.flame.scale.set(0.7 + 0.5 * ab, 0.7 + 0.5 * ab, 0.25 + 0.4 * en + 1.1 * ab * (0.9 + Math.random() * 0.2));
      u.flameOuter.material.opacity = 0.15 + 0.5 * ab; u.gear.visible = sim.gear; obj.visible = rig.view !== 'cockpit';
      if (controls) controls.sync({ gear: sim.gear, fbw: sim.fbw, view: rig.view });
      return api;
    },
    updateCamera(dt, camera) { if (!pose) pose = sim.renderPose(); const up = bodyUp(sim), s = world.surface(pose.pos.x, pose.pos.z);
      rig.update(dt, pose, up, { dist: 26, height: 6.5, eye: obj.userData.eye, ahead: 10, stiff: 4, minY: s.y + 1.5 }); rig.apply(camera); return rig.pos; },
    hudData(extra = {}) { const d = sim.hud(frame ? frame.gamma : 0); d.mode = 'jet'; d.view = rig.view;
      const v = sim.vel, q = new T.Quaternion(sim.q.x, sim.q.y, sim.q.z, sim.q.w).invert(), vb = new T.Vector3(v.x, v.y, v.z).applyQuaternion(q);
      if (-vb.z > 1) d.fpm = { x: Math.atan2(vb.x, -vb.z) * 57.2958, y: Math.atan2(vb.y, -vb.z) * 57.2958 };
      Object.assign(d, extra); if (hud) hud.update(d); return d; },
  };
  return api;
}

export function createShipMode({ THREE: T, scene, world, frame, controls = null, hud = null, params = SHIP, onEvent = null }) {
  const sim = new ShipSim(params, world), obj = makeShip(T), rig = new CameraRig(T); obj.visible = false; scene.add(obj);
  let start = null, pose = null; const WARPS = [1, 10, 100, 1000];
  const api = {
    name: 'ship', sim, object: obj, rig,
    enter(o = {}) { start = { ...o }; sim.reset(o); if (o.vel) sim.vel = { ...o.vel }; sim.warp = 1; obj.visible = true; rig.ok = false; if (controls) controls.setMode('ship'); return api; },
    exit() { obj.visible = false; },
    update(dt, input) {
      const inp = input || (controls ? controls.poll(dt) : {}); const e = inp.edges || new Set();
      if (e.has('view')) rig.toggle(); if (e.has('reset') && start) api.enter(start);
      if (e.has('warp')) { sim.warp = WARPS[(WARPS.indexOf(sim.warp) + 1) % WARPS.length]; if (!sim.newtonian) sim.warp = 1; }
      if (inp.look) { rig.look.yaw -= inp.look.dx * 0.006; rig.look.pitch = Math.max(-1.3, Math.min(1.3, rig.look.pitch + inp.look.dy * 0.004)); }
      sim.update(dt, inp); if (!sim.newtonian) sim.warp = 1;
      for (const ev of sim.events) onEvent && onEvent(ev, api); sim.events.length = 0;
      pose = sim.renderPose(pose || undefined);
      obj.position.set(pose.pos.x, pose.pos.y, pose.pos.z); obj.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
      const u = obj.userData, th = Math.max(sim.thrustOn, inp.thrust > 0 ? 0.3 : 0); for (const c of u.thrusters) { c.visible = th > 0.02; c.scale.set(1, 0.3 + th * 1.6 * (0.9 + Math.random() * 0.2), 1); }
      const hf = Math.min(1, sim.heat / 1.5e6), fl = 0.85 + Math.random() * 0.15; u.plasma.userData.mats[0].opacity = hf * 0.45 * fl; u.plasma.userData.mats[1].opacity = hf * 0.8 * fl; u.plasma.visible = hf > 0.02; obj.visible = rig.view !== 'cockpit';
      if (controls) controls.sync({ dampers: sim.dampers, newtonian: sim.newtonian, warp: sim.warp, view: rig.view });
      return api;
    },
    updateCamera(dt, camera) { if (!pose) pose = sim.renderPose(); const up = sim.up(sim.pos, {});
      const alt = sim.altitude(), s = alt < 30000 ? world.surface(pose.pos.x, pose.pos.z) : null;
      const sp = Math.min(1, Math.max(0, (alt - 30000) / 70000));   // in space: higher, further back, looking past the ship
      rig.update(dt, pose, up, { dist: 34 + 26 * sp, height: 9 + 13 * sp, eye: obj.userData.eye, ahead: 14 + 90 * sp, stiff: 3, minY: s ? s.y + 2 : undefined }); rig.apply(camera); return rig.pos; },
    hudData(extra = {}) { const d = sim.hud(frame ? frame.gamma : 0); d.mode = 'ship'; d.view = rig.view; Object.assign(d, extra); if (hud) hud.update(d); return d; },
  };
  return api;
}
