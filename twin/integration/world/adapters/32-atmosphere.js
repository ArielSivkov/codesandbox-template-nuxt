/* מתאם: מחלקת האווירה (swarm/atmosphere/src — ES module): מערך תאורה יום/לילה, שמיים, כוכבים, פנסי רחוב (מפת אור אפויה),
 * אורות רכב, אובך לפי איכות אוויר, דירוג צבע ועיבוד-אחרי. זה מודול "משתלט" (מחליף אורות, שמיים ו-render),
 * לכן כבוי כברירת מחדל עד שהמחלקה תסיים (קבצים עודכנו עד 01:36); הפעלה: לוח המודולים או ?atmosphere=1.
 * כשהוא פעיל, גרסת הגישור atmo-lite מושבתת; אם הוא נכשל – המארח חוזר לציור הרגיל ו-atmo-lite חוזר.
 */
(function () {
  'use strict';
  const Z = { atmo: null, lampT: 0, carT: 0, hidden: [] };
  const TIER = { low: 'low', medium: 'mid', high: 'high' };
  function lamps(world) { const P = world.player.pos, out = [], R2 = 700 * 700;
    for (const t of world.data.tiles.values()) for (const r of t.roads || []) { const p = r.p, off = r.w / 2 + 1.2; let acc = 0, side = 1;
      for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, L = Math.hypot(dx, dz) || 1;
        for (let s = 30 - acc; s < L; s += 30) { const x = ax + dx * s / L, z = az + dz * s / L; side = -side; if ((x - P.x) ** 2 + (z - P.z) ** 2 > R2) continue;
          const lx = x - dz / L * side * off, lz = z + dx / L * side * off; out.push({ x: lx, z: lz, y: Math.max(0, world.data.H(lx, lz)), street: r.name || '' }); }
        acc = (acc + L) % 30; } }
    return out.slice(0, 1500); }
  YZW.register({
    id: 'atmosphere', name: 'אווירה וכיוון אמנותי (מחלקת האווירה)', dept: 'atmosphere', order: 31, defaultOff: true,
    async init(world, api) {
      const mod = await import(new URL('mods/atmosphere/src/index.js', location.href).href);
      if (YZW.plugins().find(p => p.id === 'atmo-lite' && p.state === 'on')) { YZW.enable('atmo-lite', false, true); Z.liteWasOn = true; }
      Z.atmo = mod.createAtmosphere({ THREE, renderer: world.renderer, scene: world.scene, camera: world.camera, tier: TIER[world.quality.tier] || 'mid', profile: 'phone' });
      if (world.sky) { world.sky.visible = false; }
      const MAT = world.data.MAT; for (const k of ['wall', 'ind', 'roof', 'lo', 'terrain', 'road', 'walk']) if (MAT[k]) Z.atmo.patchMaterial(MAT[k]);
      const sync = () => { const w = world.weather; Z.atmo.setTime(world.clock.date); Z.atmo.setWeather({ cloud: w.cloud, rain: Math.min(1, w.rain / 10), visibility_m: w.visibility });
        const a = w.aqi || 0; Z.atmo.setAirQuality(a > 150 ? 'sharav' : a > 90 ? 'hazy' : 'clean'); };
      api.on('env', sync); api.on('quality', q => Z.atmo.setQualityTier(TIER[q.tier] || 'mid')); sync();
      Z.atmo.nightLights.setLamps(lamps(world)); Z.lp = { ...world.player.pos };
      this._rs = () => Z.atmo && Z.atmo.setSize(innerWidth, innerHeight); addEventListener('resize', this._rs);
    },
    update(dt, world) { const P = world.player.pos; Z.atmo.setFocus(new THREE.Vector3(P.x, P.y, P.z), 120);
      Z.lampT -= dt; if (Z.lampT <= 0 && Math.hypot(P.x - Z.lp.x, P.z - Z.lp.z) > 250) { Z.lampT = 3; Z.lp = { ...P }; Z.atmo.nightLights.setLamps(lamps(world)); }
      Z.atmo.update(dt); },
    render(world) { Z.atmo.render(); },
    dispose(world) { removeEventListener('resize', this._rs); if (Z.atmo) { try { Z.atmo.dispose(); } catch (e) { /* */ } }
      world.scene.traverse(o => { if (o.isLight && !o.userData.esh27atmo) o.visible = true; }); if (world.sky) world.sky.visible = true; Z.atmo = null;
      if (Z.liteWasOn) { Z.liteWasOn = false; setTimeout(() => YZW.enable('atmo-lite', true, true), 0); } },
  });
})();
