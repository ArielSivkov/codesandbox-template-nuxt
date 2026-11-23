/* מחלקת הדמויות · bridge-game.js — חיבור למשחק הקיים (twin/game) בלי לשנות את קבצי המשחק.
   שילוב (צוות המשחק מחליט): אחרי <script src="js/game.js"> להוסיף:
     <script src="../npc/js/life.js"></script><script src="../npc/js/dialogue.js"></script>
     <script src="../npc/js/crowd.js"></script><script src="../npc/js/npc.js"></script><script src="../npc/js/bridge-game.js"></script>
   הגשר: מחכה ל-G27.S.started, יוצר את האנשים סביב השחקן, מעדכן בכל פריים (requestAnimationFrame משלו, אחרי הציור של המשחק לא נדרש – הסצנה משותפת),
   ותופס הקשות על דמויות לפני שהמשחק מפרש אותן כהקשה על בניין. */
(function () {
'use strict';
const NPC_BASE = (document.currentScript && document.currentScript.src.replace(/js\/bridge-game\.js.*$/, '')) || '../npc/';
async function boot() {
  const G = window.G27, W = window.W27;
  if (!G || !G.S.started || !W.ready || W.pending() > 0) return setTimeout(boot, 500);
  const S = G.S;
  const posOf = () => S.mode === 'car' ? { x: S.car.x, z: S.car.z, vx: Math.sin(S.car.h) * S.car.v, vz: Math.cos(S.car.h) * S.car.v, speed: Math.abs(S.car.v) }
    : S.mode === 'heli' ? { x: S.heli.x, z: S.heli.z, vx: 0, vz: 0, speed: Math.abs(S.heli.v) } : { x: S.p.x, z: S.p.z, vx: 0, vz: 0, speed: S.speed || 0 };
  const npc = await NPC.create({ scene: G.scene, camera: G.camera, renderer: G.renderer, W, assets: 'assets/', vendor: 'vendor/', data: NPC_BASE + 'data/dialogues.json',
    player: () => Object.assign(posOf(), { mode: S.mode === 'car' ? 'car' : S.mode === 'foot' ? 'foot' : 'air' }),
    clock: () => new Date(), weather: () => ({ rain: (window.SIM && SIM.weather.rain) || 0 }) });
  const p = posOf(); npc.spawnAround(p.x, p.z); npc.warmup(30, 5);
  window.G27NPC = npc;
  // הקשה על דמות קודמת להקשה על בניין
  const cv = G.renderer.domElement; let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; }, true);
  cv.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return; if (npc.tap(e.clientX, e.clientY)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  let last = performance.now();
  (function tick(now) { requestAnimationFrame(tick); const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!S.inside) npc.update(dt); })(last);
}
boot();
})();
