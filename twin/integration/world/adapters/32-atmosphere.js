/* מתאם: מחלקת האווירה (swarm/atmosphere/dist/esh27-atmosphere.mjs — קובץ אחד): מערך תאורה יום/לילה פיזיקלי, שמיים, עננים,
 * פנסי רחוב כמפת אור אפויה, אורות רכב, אובך לפי איכות אוויר, דירוג צבע (LUT ים־תיכוני) ועיבוד-אחרי. "משתלט": אורות, שמיים ו-render.
 * תיקון המסך השחור (03:13, לפי מחלקת האווירה): patchMaterial לכל חומר עם KIND (קיר/קרקע + גובה קומה), כי השיידר שלהם מחשב
 * חלונות/ערפל/תאורה לפי סוג המשטח; בלי זה החומרים יוצאים שחורים. + איכות אוויר: sharav / smog / clean.
 * כשפעיל: atmo-lite מושבת זמנית; עדכון היופי משאיר רק צללים/אנאיזוטרופיה (בלי חשיפה/עננים כפולים). ?atmosphere=0 לכיבוי.
 * נכשל → המארח חוזר לציור הרגיל באותו פריים, atmo-lite חוזר.
 */
(function () {
  'use strict';
  const Z = { atmo: null, lampT: 0, lp: null, liteWasOn: false, rs: null };
  const TIER = { low: 'low', medium: 'mid', high: 'high' };
  const KIND = { wall: { kind: 0, floorHeight: 3.1 }, ind: { kind: 0, floorHeight: 4.5 }, lo: { kind: 0, floorHeight: 3.1 }, roof: { kind: 0 }, tile: { kind: 0 }, terrain: { kind: 1 }, road: { kind: 1 }, walk: { kind: 1 } };
  function lamps(world) {
    if (world.providers.lamps && world.providers.lamps.length) return world.providers.lamps.slice(0, 1500).map(l => ({ x: l.x, z: l.z, y: l.y, type: l.type === 'sodium' ? 'sodium' : undefined, street: '' }));
    const P = world.player.pos, out = [], R2 = 700 * 700;
    for (const t of world.data.tiles.values()) for (const r of t.roads || []) { const p = r.p, off = r.w / 2 + 1.2; let acc = 0, side = 1;
      for (let i = 0; i < p.length / 2 - 1; i++) { const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, L = Math.hypot(dx, dz) || 1;
        for (let s = 30 - acc; s < L; s += 30) { const x = ax + dx * s / L, z = az + dz * s / L; side = -side; if ((x - P.x) ** 2 + (z - P.z) ** 2 > R2) continue;
          const lx = x - dz / L * side * off, lz = z + dx / L * side * off; out.push({ x: lx, z: lz, y: Math.max(0, world.data.H(lx, lz)), street: r.name || '' }); }
        acc = (acc + L) % 30; } }
    return out.slice(0, 1500); }
  function patchAll(world) { const M = world.data.MAT; for (const k of Object.keys(KIND)) if (M[k] && !M[k].userData.atmoPatched) { Z.atmo.patchMaterial(M[k], KIND[k]); M[k].userData.atmoPatched = true; M[k].needsUpdate = true; } }
  YZW.register({
    id: 'atmosphere', name: 'אווירה וכיוון אמנותי (מחלקת האווירה)', dept: 'atmosphere', order: 31, timeoutMs: 40000,
    async init(world, api) {
      const mod = await import(new URL('mods/atmosphere/esh27-atmosphere.mjs', location.href).href);
      if (YZW.plugins().find(p => p.id === 'atmo-lite' && p.state === 'on')) { YZW.enable('atmo-lite', false, true); Z.liteWasOn = true; }
      Z.atmo = mod.createAtmosphere({ THREE, renderer: world.renderer, scene: world.scene, camera: world.camera, tier: TIER[world.quality.tier] || 'mid', profile: 'phone' });
      if (world.sky) world.sky.visible = false;
      patchAll(world); world.providers.atmosphere = Z.atmo;
      const sync = () => { const w = world.weather; Z.atmo.setTime(world.clock.date); Z.atmo.setWeather({ cloud: w.cloud, rain: Math.min(1, (w.rain || 0) / 10), visibility_m: w.visibility });
        const a = w.aqi || 0; Z.atmo.setAirQuality(a > 150 ? 'sharav' : a > 90 ? 'smog' : 'clean'); };
      api.on('env', sync); api.on('quality', q => Z.atmo.setQualityTier(TIER[q.tier] || 'mid')); api.on('tile', () => patchAll(world));
      api.on('lamps', () => { Z.lampT = 0; Z.lp = null; }); sync();
      Z.atmo.nightLights.setLamps(lamps(world)); Z.lp = { ...world.player.pos };
      Z.rs = () => Z.atmo && Z.atmo.setSize(innerWidth, innerHeight); addEventListener('resize', Z.rs); Z.rs();
    },
    update(dt, world) { const P = world.player.pos; Z.atmo.setFocus(new THREE.Vector3(P.x, P.y, P.z), 120);
      Z.lampT -= dt; if (Z.lampT <= 0 && (!Z.lp || Math.hypot(P.x - Z.lp.x, P.z - Z.lp.z) > 250)) { Z.lampT = 3; Z.lp = { ...P }; Z.atmo.nightLights.setLamps(lamps(world)); }
      Z.atmo.update(dt); },
    render(world) { Z.atmo.render(); },
    dispose(world) { removeEventListener('resize', Z.rs); if (Z.atmo) { try { Z.atmo.dispose(); } catch (e) { /* */ } }
      world.scene.traverse(o => { if (o.isLight && !o.userData.esh27atmo) o.visible = true; }); if (world.sky) world.sky.visible = true; Z.atmo = null; world.providers.atmosphere = null;
      if (Z.liteWasOn) { Z.liteWasOn = false; setTimeout(() => YZW.enable('atmo-lite', true, true), 0); } },
  });
})();
