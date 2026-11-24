/* מצלמת שטח: תמונה + קובץ צד JSON (לפי schema/observation.schema.json) עם GPS, ITM, כיוון מצלמה אמיתי, הטיה, גלגול, זמן.
 * בלי שרת: הורדה / שיתוף בלבד. טקסטים רק דרך textContent. */
(function () {
  'use strict';
  const I = window.ESH_ITM, $ = id => document.getElementById(id);
  const S = { geo: null, ori: null, iosHeading: null, absolute: false, decl: I.DECL_DEFAULT, n: +(localStorage.getItem('esh_cap_n') || 0) };
  const SAMPLE_TO_ITM = [1507.82, 757.76];   // twin/pipeline/frame.py (הישן 1524.6/753.6 הזיז כל צילום GPS ב-17.29 מ')
  const set = (id, txt, cls) => { const e = $(id); e.textContent = txt; e.className = cls || ''; };

  function startGeo() {
    if (!navigator.geolocation) { set('gps', 'אין תמיכה במיקום', 'bad'); return; }
    navigator.geolocation.watchPosition(p => { S.geo = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, altAcc: p.coords.altitudeAccuracy, t: p.timestamp };
      const a = S.geo.acc; set('gps', `${S.geo.lat.toFixed(6)}, ${S.geo.lon.toFixed(6)} · ±${Math.round(a)} מ'`, a <= 10 ? 'ok' : a <= 25 ? 'warn' : 'bad');
      const [e, n] = I.wgs84ToITM(S.geo.lat, S.geo.lon, S.geo.alt || 0); S.geo.itm = [e, n]; set('itm', `${e.toFixed(1)} / ${n.toFixed(1)}`, 'mut'); updSky(); },
      err => set('gps', 'שגיאה: ' + err.message, 'bad'), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function onOri(e) {
    let alpha = e.alpha, absolute = e.absolute || e.type === 'deviceorientationabsolute';
    if (typeof e.webkitCompassHeading === 'number') { alpha = I.iosAlpha(e.webkitCompassHeading); absolute = true; S.iosAcc = e.webkitCompassAccuracy; }
    if (alpha == null || e.beta == null) return;
    const p = I.cameraPose(alpha, e.beta, e.gamma);
    S.ori = { mag: p.heading, heading: I.magToTrue(p.heading, S.decl), pitch: p.pitch, roll: p.roll, absolute, t: performance.now() };
    set('head', absolute ? `${S.ori.heading.toFixed(0)}° (מגנטי ${p.heading.toFixed(0)}° + ${S.decl}°)` : 'יחסי בלבד – אין צפון', absolute ? 'ok' : 'bad');
    set('tilt', `${p.pitch.toFixed(0)}° / ${p.roll.toFixed(0)}°`, 'mut'); drawCompass();
  }
  async function startOri() {
    try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') set('head', 'אין הרשאה לחיישנים – ממתין לנתונים', 'warn'); } } catch (e) { set('head', 'שגיאת הרשאה – ממתין לנתונים', 'warn'); }
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOri); else window.addEventListener('deviceorientation', onOri);
  }
  $('perm').onclick = () => { startGeo(); startOri(); $('perm').textContent = 'חיישנים פעילים'; loadSky(); };

  // שמש/ירח (מחלקת השמיים, sky.js) – בדיקת שפיות למצפן
  let SKY = null;
  async function loadSky() { try { SKY = await import('../../sky/src/sky.js')   /* נתיב יחסי לקובץ הסקריפט */; updSky(); } catch (e) { set('sky', 'מודול השמיים לא זמין', 'mut'); } }
  function updSky() {
    if (!SKY) return; const lat = S.geo ? S.geo.lat : 31.8055, lon = S.geo ? S.geo.lon : 34.6425, obs = SKY.observer(lat, lon, 20), t = SKY.time(new Date());
    const m = SKY.moon(t, obs, { apparent: true }), s = SKY.body('Sun', t, obs, { apparent: true });
    const vis = [m.alt > 0 ? `ירח ${m.az.toFixed(0)}° בגובה ${m.alt.toFixed(0)}°` : null, s.alt > 0 ? `שמש ${s.az.toFixed(0)}° בגובה ${s.alt.toFixed(0)}°` : null].filter(Boolean);
    set('sky', vis.join(' · ') || 'אין ירח/שמש מעל האופק', 'mut'); S.sky = { moon: { az: m.az, alt: m.alt }, sun: { az: s.az, alt: s.alt } };
    $('skyHint').textContent = vis.length ? 'כוון את מרכז המסך אל הירח/השמש: הכיוון למעלה צריך להראות את אותו אזימוט (±5°). אחרת – כיול בצורת 8.' : '';
  }
  setInterval(updSky, 30000);
  function drawCompass() { const c = $('compass'), x = c.getContext('2d'), W = c.width; x.clearRect(0, 0, W, W); x.save(); x.translate(W / 2, W / 2);
    x.strokeStyle = '#33435f'; x.lineWidth = 4; x.beginPath(); x.arc(0, 0, W / 2 - 6, 0, 6.283); x.stroke();
    const h = S.ori ? S.ori.heading : 0; x.rotate(-h * Math.PI / 180); x.fillStyle = '#e63946'; x.beginPath(); x.moveTo(0, -W / 2 + 14); x.lineTo(-10, -W / 2 + 40); x.lineTo(10, -W / 2 + 40); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 22px system-ui'; x.textAlign = 'center'; x.fillText('צ', 0, -W / 2 + 64);
    if (S.sky && S.sky.moon.alt > 0) { x.rotate(S.sky.moon.az * Math.PI / 180); x.fillStyle = '#ffe066'; x.beginPath(); x.arc(0, -W / 2 + 20, 9, 0, 6.283); x.fill(); }
    x.restore(); }

  // צילום
  let pre = null;
  const snap = () => ({ t_iso: new Date().toISOString(), geo: S.geo && Object.assign({}, S.geo), ori: S.ori && Object.assign({}, S.ori) });
  $('shutter').onclick = () => { pre = snap(); $('file').click(); };
  $('file').onchange = async () => {
    const f = $('file').files[0]; if (!f) return; const post = snap(); const buf = await f.arrayBuffer();
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
    S.n += 1; localStorage.setItem('esh_cap_n', String(S.n));
    const d = new Date(), pad = v => String(v).padStart(2, '0'), id = String(900 + (S.n % 100)).padStart(3, '0');   // 9xx = צילומי מצלמת השטח (לא מתנגש ב-001–899)
    const name = `${id}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.jpg`;
    const use = pre && pre.geo ? pre : post, g = use.geo, o = (pre && pre.ori) || post.ori;
    const moved = pre && pre.ori && post.ori ? Math.abs(((post.ori.heading - pre.ori.heading + 540) % 360) - 180) : null;
    const accConf = g ? Math.max(0.05, Math.min(0.95, 1 - g.acc / 50)) : 0;
    const side = { v: 1, frame: { sample_to_itm: SAMPLE_TO_ITM, crs: 'EPSG:2039' }, source: 'capture.html', photos: [{
      id, file: name, sha256: sha, time_local: use.t_iso, orientation: 'לאורך',
      pos: g ? { x: +(g.itm[0] - SAMPLE_TO_ITM[0]).toFixed(1), y: +(g.itm[1] - SAMPLE_TO_ITM[1]).toFixed(1), r_m: Math.round(g.acc), prov: 'נצפה', conf: +accConf.toFixed(2), src: 'GPS הטלפון (watchPosition, enableHighAccuracy)', street: null, itm: g.itm.map(v => +v.toFixed(2)), wgs84: [+g.lat.toFixed(7), +g.lon.toFixed(7)], alt_m: g.alt, alt_acc_m: g.altAcc }
             : { x: null, y: null, r_m: 0, prov: 'משוער', conf: 0, src: 'אין GPS', street: null, itm: null, wgs84: null },
      heading: o && o.absolute ? { v: +o.heading.toFixed(1), prov: 'נצפה', conf: 0.6, pm: 10, method: 'מצפן', src: `מגנטי ${o.mag.toFixed(1)}° + סטייה ${S.decl}° (משוער)` + (moved != null ? `; תזוזה בין לחיצה לחזרה ${moved.toFixed(1)}°` : '') }
               : { v: null, prov: 'משוער', conf: 0, method: 'לא ידוע', src: 'אין מצפן מוחלט' },
      pitch: o ? { v: +o.pitch.toFixed(1), prov: 'נצפה', conf: 0.6, pm: 5 } : { v: null, prov: 'משוער', conf: 0 },
      roll: o ? +o.roll.toFixed(1) : null,
      fov_h: { v: 54.9, prov: 'משוער', conf: 0.5, src: 'מצלמה ראשית ~26 מ"מ, לאורך' },
      style_class: { v: null, prov: 'משוער', conf: 0 }, quality: { he: 'ממתין לניתוח' }, findings: [], status: 'stub', sky: S.sky || null,
      privacy: { plates_visible: false, plates_recorded: false, private_names_recorded: false, faces: false } }] };
    const json = new Blob([JSON.stringify(side, null, 1)], { type: 'application/json' }), img = new File([buf], name, { type: f.type || 'image/jpeg' });
    const L = $('last'); L.textContent = '';
    const p = document.createElement('p'); p.textContent = `${name} · ${g ? '±' + Math.round(g.acc) + ' מ\'' : 'בלי GPS'} · ${o && o.absolute ? o.heading.toFixed(0) + '°' : 'בלי כיוון'}`; L.appendChild(p);
    const im = document.createElement('img'); im.alt = name; im.src = URL.createObjectURL(img); L.appendChild(im);
    const dl = (blob, fn, label) => { const b = document.createElement('button'); b.className = 's'; b.textContent = label; b.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click(); }; L.appendChild(b); };
    dl(img, name, 'הורד תמונה'); dl(json, name.replace('.jpg', '.json'), 'הורד קובץ נתונים');
    if (navigator.canShare && navigator.canShare({ files: [img] })) { const b = document.createElement('button'); b.className = 's'; b.textContent = 'שתף שניהם';
      b.onclick = () => navigator.share({ files: [img, new File([json], name.replace('.jpg', '.json'), { type: 'application/json' })], title: name }).catch(() => {}); L.appendChild(b); }
  };
  drawCompass();
})();
