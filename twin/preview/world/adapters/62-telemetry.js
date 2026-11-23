/* יומן בדיקה לבודקים: פועל רק בקישור עם ?p=<שם> (למשל ?p=שון) – הבודק יודע שהוא בבדיקה (תג 🧪 על המסך).
 * כל 2 ש': מצב (רגלי/רכב/מסוק…), מיקום מקומי, גובה, מהירות, FPS, בתוך בניין. אירועים: החלפת מצב, שגיאות JS, יציאה/חזרה לדף.
 * נשלח כל 15 ש' ובסגירה לשרת esh27-telemetry (קלאודפלייר KV, נמחק אחרי 90 יום). ?tel=<כתובת> מחליף שרת (לבדיקות).
 */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search), name = (q.get('p') || '').trim().slice(0, 40);
  if (!name) return;
  const API = q.get('tel') || 'https://esh27-telemetry.ariel-sivkov.workers.dev/e';
  const sid = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  const T = { ev: [], lastMode: null, t0: Date.now(), sent: 0 };
  window.__w27tel = T;
  const push = (k, o) => { T.ev.push(Object.assign({ t: Date.now() - T.t0, k }, o || {})); if (T.ev.length > 600) T.ev.splice(0, T.ev.length - 600); };
  const r1 = v => Math.round(v * 10) / 10;
  function sample() {
    const G = window.G27; if (!G || !G.S) return; const S = G.S, m = S.mode;
    const p = m === 'car' ? S.car : (m === 'heli' ? S.heli : S.p);
    if (m !== T.lastMode) { push('mode', { m, from: T.lastMode }); T.lastMode = m; }
    let fps = null; try { fps = Math.round(G.fps()); } catch (e) { }
    push('s', { m, x: r1(p.x || 0), y: r1(p.y || 0), z: r1(p.z || 0), v: r1(Math.abs((m === 'car' ? S.car.v : m === 'heli' ? S.heli.v : S.speed) || 0)), fps, in: S.inside ? 1 : 0 });
  }
  function flush(beacon) {
    if (!T.ev.length) return; const body = JSON.stringify({ name, sid, ver: (document.querySelector('meta[name=w27-ver]') || {}).content || '', ev: T.ev.splice(0) });
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(API, new Blob([body], { type: 'text/plain' })); T.sent++; return; }
    fetch(API, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true }).then(() => { T.sent++; }).catch(() => { });
  }
  window.addEventListener('error', e => push('err', { msg: String(e.message || '').slice(0, 200), src: String(e.filename || '').split('/').pop(), line: e.lineno }));
  window.addEventListener('unhandledrejection', e => push('err', { msg: String((e.reason && e.reason.message) || e.reason || '').slice(0, 200) }));
  document.addEventListener('visibilitychange', () => { push(document.hidden ? 'hide' : 'show'); if (document.hidden) flush(true); });
  window.addEventListener('pagehide', () => flush(true));
  push('start', { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, touch: 'ontouchstart' in window ? 1 : 0 });
  setInterval(sample, 2000); setInterval(() => flush(false), 15000);
  const tag = () => { if (document.getElementById('w27tel')) return; const d = document.createElement('div'); d.id = 'w27tel'; d.textContent = '🧪 בדיקה: ' + name;
    d.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:9999;font:12px sans-serif;background:#0008;color:#fff;padding:2px 6px;border-radius:8px;pointer-events:none'; document.body.appendChild(d); };
  if (document.body) tag(); else addEventListener('DOMContentLoaded', tag);
})();
