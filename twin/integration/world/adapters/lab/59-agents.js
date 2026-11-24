// סוכני העיר בתוך העולם (מעבדה, 24.11.2026, קַו). פועל כברירת מחדל באישור אריאל (24.11: "כן, לעלות לחיים"), כחריגה מההקפאה. לכיבוי: ?agents=0
// הנתונים: mods/agents/run.json, ריצה של esh27-core/lab/world/sim.py. כל סוכן גר בבניין אמיתי, הולך בגרף הרחובות
// האמיתי של אשדוד (1.4 מ'/ש'), ועושה עבודות בדיקה דרך חוזה העולם. רק הבודק משלם CRD, והפנקס שרשרת hash.
// צבע: אפור = 0 CRD, זהב = הכי הרבה. המסלול חוזר כל שעה לפי שעון העולם.
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  if (qs.get('agents') === '0') return;
  const S = { run: null, mesh: null, n: 0, ticks: 0, tickS: 10, cols: null, ready: false };
  const M = new (window.THREE ? THREE.Matrix4 : function () {})();

  function posAt(track, tick) {
    // track: [[tick, x, y], ...] ascending; local metres from run.o (twin tile frame)
    if (!track.length) return null;
    if (tick <= track[0][0]) return track[0];
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      if (tick <= b[0]) { const f = b[0] === a[0] ? 0 : (tick - a[0]) / (b[0] - a[0]); return [tick, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
    }
    return track[track.length - 1];
  }

  YZW.register({
    id: 'lab-agents', name: 'סוכני העיר (מעבדה)', dept: 'world-lab', order: 59, timeoutMs: 30000,
    async init(world, api) {
      const r = await fetch('mods/agents/run.json'); if (!r.ok) throw new Error('run.json HTTP ' + r.status);
      const run = S.run = await r.json();
      S.n = run.agents_tracks.length; S.ticks = run.ticks; S.tickS = run.tick_s || 10;
      const T = THREE, geo = new T.CylinderGeometry(0.35, 0.35, 1.7, 8).translate(0, 0.85, 0);
      const mat = new T.MeshStandardMaterial({ roughness: 0.6 });
      S.mesh = new T.InstancedMesh(geo, mat, S.n); S.mesh.castShadow = true; S.mesh.frustumCulled = false;
      const max = Math.max(1, ...run.agents_tracks.map(a => a.crd || 0)), c = new T.Color();
      run.agents_tracks.forEach((a, i) => { const k = (a.crd || 0) / max; c.setRGB(0.55 + 0.45 * k, 0.55 + 0.25 * k, 0.55 - 0.45 * k); S.mesh.setColorAt(i, c); });
      (api && api.group ? api.group() : world.scene).add(S.mesh);
      S.ready = true; window.YZW_AGENTS = S;
    },
    update(dt, world) {
      if (!S.ready) return;
      const W = window.W27; if (!W || !W.toScene) return;
      const d = (world.clock && world.clock.date) || new Date();
      const tick = ((d.getTime() / 1000 / S.tickS) % S.ticks + S.ticks) % S.ticks;
      const o = S.run.o, cam = world.camera;
      // seen from above, agents grow into markers (1x at street level, up to 12x from the Big Eye)
      const k = cam ? Math.min(12, Math.max(1, (cam.position.y - 20) / 25)) : 1;
      for (let i = 0; i < S.n; i++) {
        const p = posAt(S.run.agents_tracks[i].t, tick); if (!p) continue;
        const s = W.toScene(o[0] + p[1], o[1] + p[2]);
        const y = W.H ? Math.max(W.H(s.x, s.z) || 0, 0) : 0;
        M.makeScale(k, k, k).setPosition(s.x, y, s.z); S.mesh.setMatrixAt(i, M);
      }
      S.mesh.instanceMatrix.needsUpdate = true;
    },
    hudPanels: [{ id: 'agents', render(el) {
      if (!S.run) { el.textContent = 'סוכנים: נטען…'; return; }
      el.textContent = `🤖 ${S.n} סוכנים · ${S.run.crd_total} CRD · פנקס ${S.run.ledger_ok ? '✓' : '✗'} · מוח: ${S.run.brain}`;
    } }],
    dispose() { if (S.mesh) { S.mesh.parent && S.mesh.parent.remove(S.mesh); S.mesh.geometry.dispose(); S.mesh.material.dispose(); } S.ready = false; },
  });
})();
