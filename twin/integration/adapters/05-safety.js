/* בטיחות ועמידות (תיקוני הצוות האדום שאפשר לעשות מבחוץ, בלי לגעת בקוד המשחק):
 *  6  הרמת השחקן/רכב/מסוק אל הקרקע כשהאריח שמתחתם נטען (לא "תקוע מתחת לחולות")
 *  7  כשהרשת חוזרת ('online') – כל האריחים שנכשלו מנוסים מחדש מיד
 *  8  הגנת NaN/Infinity: מיקום/מהירות לא סופיים → חזרה למצב התקין האחרון
 *  14 "הנכסים שלי" ב-ITM: הגירה של רשומות ישנות + חישוב מחדש של מיקום הסצנה מ-E/N
 *  10 שלט העסק רק על נכס שהמשתמש בחר: כפתור "🏪 זה העסק שלי" בכרטיס הבניין
 */
(function () {
  'use strict';
  const good = { p: null, car: null, heli: null };
  const fin = o => o && isFinite(o.x) && isFinite(o.y) && isFinite(o.z);
  const snap = o => ({ x: o.x, y: o.y, z: o.z });
  let nanFix = 0;
  YZW.register({
    id: 'safety', name: 'עמידות: NaN, קרקע, רשת, נכסים ב-ITM', dept: 'integration (צוות אדום)', order: 5, core: true,
    init(world, api) {
      const G = world.G27, W = world.data;
      // 6: אריח נטען מתחת לשחקן → מרימים לקרקע
      api.on('tile', ({ tile, kind }) => { if (kind !== 'add' || !tile.blds) return; const S = G.S;
        const lift = (o, r) => { const g = W.floorAt(o.x, o.z, o.y + 60); const h = Math.max(W.H(o.x, o.z), 0); if (o.y < h - 0.3) { o.y = Math.max(h, Math.min(g, h + 3)); if (r) S.vy = 0; return true; } return false; };
        if (lift(S.p, true)) world.stats.lifted = (world.stats.lifted || 0) + 1; lift(S.car); if (S.heli.y < Math.max(W.H(S.heli.x, S.heli.z), 0)) S.heli.y = Math.max(W.H(S.heli.x, S.heli.z), 0); });
      // 7: הרשת חזרה
      this._on = () => { let n = 0; for (const [k, t] of W.tiles) if (t.failed && !t.bad) { W.tiles.delete(k); n++; } if (n) YZW.notice('הרשת חזרה — טוען מחדש ' + n + ' אריחים', { kind: 'info', ms: 2000 }); };
      addEventListener('online', this._on);
      // 14: הגירת נכסים ל-ITM
      let mig = 0; for (const o of G.mine.values()) { if (o.E == null) { const it = W.W.toITM(o.cx, o.cz); o.E = Math.round(it.E); o.N = Math.round(it.N); mig++; } const s = W.W.toScene(o.E, o.N); o.cx = Math.round(s.x); o.cz = Math.round(s.z); }
      if (mig) try { localStorage.setItem('w27.mine', JSON.stringify([...G.mine.values()])); } catch (e) { /* */ }
      // 10: בחירת העסק מתוך הכרטיס
      const card = document.getElementById('card');
      this._mo = new MutationObserver(() => { const acts = card.querySelector('.acts'); if (!acts || acts.querySelector('#yzBiz')) return; const nm = card.querySelector('.ltr'); if (!nm) return;
        const id = nm.textContent.trim(); const cur = (() => { try { return localStorage.getItem('w27.bizId'); } catch (e) { return null; } })();
        const b = document.createElement('button'); b.className = 'btn'; b.id = 'yzBiz'; b.textContent = cur === id ? '🏪 העסק שלי ✓' : '🏪 זה העסק שלי';
        b.onclick = () => { try { if (cur === id) localStorage.removeItem('w27.bizId'); else localStorage.setItem('w27.bizId', id); } catch (e) { /* */ } YZW.notice(cur === id ? 'השלט יוסר בטעינה הבאה' : 'שלט "אריאל שיפוצים" יוצב על הבניין הזה בטעינה הבאה', { kind: 'info' }); b.textContent = cur === id ? '🏪 זה העסק שלי' : '🏪 העסק שלי ✓'; };
        acts.appendChild(b); const sel = world.data.buildingById(id); if (sel) world.player.selected = sel; });
      this._mo.observe(card, { childList: true });
    },
    update(dt, world) {
      const S = world.G27.S;
      for (const k of ['p', 'car', 'heli']) { const o = S[k]; if (fin(o) && (k !== 'car' || isFinite(o.h) && isFinite(o.v)) && (k !== 'heli' || isFinite(o.h) && isFinite(o.v) && isFinite(o.vy))) good[k] = snap(o);
        else if (good[k]) { Object.assign(o, good[k]); if ('v' in o) o.v = 0; if ('vy' in o) o.vy = 0; if (k === 'car') { if (!isFinite(o.h)) o.h = 0; o.steer = 0; o.pitch = o.roll = 0; } if (k === 'heli') { if (!isFinite(o.h)) o.h = 0; o.tilt = o.bank = 0; } nanFix++; world.stats.nanFix = nanFix; } }
      if (!isFinite(S.vy)) S.vy = 0; if (!isFinite(S.heading)) S.heading = 0; if (!isFinite(S.cam.yaw)) S.cam.yaw = 0; if (!isFinite(S.speed)) S.speed = 0;
      const q = S.drone; if (q && !(isFinite(q.x) && isFinite(q.y) && isFinite(q.z))) { Object.assign(q, { x: S.p.x, y: S.p.y + 1, z: S.p.z, vx: 0, vy: 0, vz: 0 }); nanFix++; }
    },
    dispose() { removeEventListener('online', this._on); if (this._mo) this._mo.disconnect(); },
  });
})();
