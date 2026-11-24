/* host.js — מארח התוספים של "לוח היזם – עולם תאום" (מחלקת האינטגרציה, ESH27).
 *
 * עיקרון: המשחק (swarm/game) הוא הליבה ואיננו משנים את הקוד שלו. המארח נצמד אליו מבחוץ דרך window.G27
 * ועוטף את renderer.render כדי להריץ את כל המודולים פעם אחת לכל פריים, לפני הציור.
 *
 * מוסכמה אחת לכל העולם: x = מזרח, y = מעלה, z = דרום (צפון = −z), מטרים, ראשית ITM = מרכז bbox של המניפסט
 *   (W27.OX/OY). toScene(E,N) = {x: E−OX, z: −(N−OY)}. רוח: כיוון מטאורולוגי "מאיפה" → וקטור "לאן".
 *
 * תוסף:  YZW.register({ id, name, dept, order?, scripts?:[url], requires?:()=>bool, pending?:'סיבה',
 *          minTier?:'low'|'medium'|'high', init(world, api) (מותר async), update(dt, world), dispose(world),
 *          modes?:[{id,name,icon,sub,kind:'plugin'|'overlay', enter(world,from), exit(world,to), update(dt,world,input)
 *                   → {x,z,speed?,alt?} (מיקום לטעינת אריחים ול-HUD)}],
 *          hudPanels?:[{id, render(el, world)}], settings?:[{id,label,type:'toggle'|'range'|'select',min,max,step,options,get(),set(v)}] })
 * כל קריאה לתוסף עטופה ב-try/catch: מודול שנכשל מושבת, מוצגת הודעה, והעולם ממשיך.
 */
(function () {
'use strict';
const VERSION = '0.3.0';
const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const T0 = performance.now();
const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('yzw.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('yzw.' + k, JSON.stringify(v)); } catch (e) { /* אין אחסון */ } },
};
const LAT = 31.8014, LON = 34.6435;

// ---------------------------------------------------------------- אפיק אירועים
const subs = new Map();
const bus = {
  on(ev, fn, owner) { if (!subs.has(ev)) subs.set(ev, []); const s = { fn, owner }; subs.get(ev).push(s); return () => { const a = subs.get(ev); const i = a.indexOf(s); if (i >= 0) a.splice(i, 1); }; },
  emit(ev, arg) { const a = subs.get(ev); if (!a) return; for (const s of a.slice()) { try { s.fn(arg); } catch (e) { if (s.owner) fault(s.owner, 'אירוע ' + ev, e); else console.warn('[yzw] handler', ev, e); } } },
};

// ---------------------------------------------------------------- הודעות על המסך
function notice(msg, o = {}) {
  let box = $('yzNotices'); if (!box) { box = document.createElement('div'); box.id = 'yzNotices'; document.body.appendChild(box); }
  const el = document.createElement('div'); el.className = 'yzN ' + (o.kind || 'warn'); el.setAttribute('role', 'status');
  el.innerHTML = `<b>${esc(msg)}</b>`;
  if (o.action) { const b = document.createElement('button'); b.textContent = o.action.label; b.onclick = () => { el.remove(); o.action.fn(); }; el.appendChild(b); }
  const x = document.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', 'סגירה'); x.onclick = () => el.remove(); el.appendChild(x);
  box.appendChild(el); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), o.ms || 7000);
}

// ---------------------------------------------------------------- רישום תוספים + בידוד כשלים
const P = new Map(), faults = [];
let OFF = new Set(LS.get('off', []));
function register(def) {
  if (!def || !def.id) { console.warn('[yzw] register without id'); return; }
  if (P.has(def.id)) { console.warn('[yzw] duplicate plugin', def.id); return; }
  const rec = { id: def.id, def, state: 'registered', err: null, ms: 0, initMs: 0, unsub: [], group: null, modes: [] };
  P.set(def.id, rec);
  if (READY) initPlugin(rec);
  return rec;
}
function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = ok; s.onerror = () => no(new Error('לא נטען: ' + src)); document.head.appendChild(s); }); }
const withTimeout = (p, ms, what) => Promise.race([Promise.resolve(p), new Promise((_, no) => setTimeout(() => no(new Error(what + ': חריגת זמן ' + ms / 1000 + ' ש׳')), ms))]);
const TIER_N = { low: 0, medium: 1, high: 2 };
async function initPlugin(rec) {
  const d = rec.def;
  if (d.pending) { rec.state = 'pending'; rec.err = d.pending; refreshModes(); return; }
  if (OFF.has(rec.id) || qs.get(rec.id) === '0' || (qs.has('bare') && !d.core) || (d.defaultOff && !LS.get('on', []).includes(rec.id) && !qs.has(rec.id))) { rec.state = 'off'; refreshModes(); return; }
  if (d.minTier && TIER_N[world.quality.tier] < TIER_N[d.minTier]) { rec.state = 'off'; rec.err = 'כבוי באיכות ' + TIER_HE[world.quality.tier]; refreshModes(); return; }
  rec.state = 'loading'; rec.err = null; const t0 = performance.now();
  try {
    for (const s of d.scripts || []) await loadScript(s);
    if (d.requires && !d.requires(world)) throw new Error('תלות חסרה');
    const ir = await withTimeout(d.init ? d.init(world, api(rec)) : null, d.timeoutMs || 25000, 'אתחול');
    if (rec.state !== 'loading') return;            // הושבת בזמן האתחול
    if (typeof ir === 'string' && ir.startsWith('off:')) { rec.state = 'off'; rec.err = ir.slice(4); refreshModes(); return; }   // מודול שהוחלף במודול מלא יותר
    rec.state = 'on'; rec.initMs = performance.now() - t0;
    rec.modes = (d.modes || []).map(m => Object.assign({ kind: 'plugin' }, m, { owner: rec }));
    refreshModes(); bus.emit('plugin', { id: rec.id, state: 'on' }); if (world.providers.zmanim && rec.id === 'sky') computeShabbat();
  } catch (e) { fault(rec, 'אתחול', e); }
}
function api(rec) {
  return {
    id: rec.id,
    group(name) { if (!rec.group) { rec.group = new THREE.Group(); rec.group.name = 'yz:' + rec.id; world.scene.add(rec.group); } if (!name) return rec.group; const g = new THREE.Group(); g.name = name; rec.group.add(g); return g; },
    on(ev, fn) { const u = bus.on(ev, fn, rec); rec.unsub.push(u); return u; },
    emit: (ev, a) => bus.emit(ev, a),
    notice,
    store: { get: (k, d) => LS.get(rec.id + '.' + k, d), set: (k, v) => LS.set(rec.id + '.' + k, v) },
    eachTile(fn) { for (const t of world.data.tiles.values()) { try { fn(t, 'add'); } catch (e) { fault(rec, 'אריח', e); return; } } rec.unsub.push(bus.on('tile', a => fn(a.tile, a.kind), rec)); },
    loadScript,
  };
}
function disposeObj(o) {
  o.traverse(n => { if (n.geometry) n.geometry.dispose(); const ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
    for (const m of ms) { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose(); } });
}
function stopPlugin(rec, state) {
  if (cur && cur.owner === rec) setMode('walk', true);
  try { rec.def.dispose && rec.def.dispose(world); } catch (e) { console.warn('[yzw] dispose', rec.id, e); }
  rec.unsub.forEach(u => u()); rec.unsub = [];
  if (rec.group) { world.scene.remove(rec.group); try { disposeObj(rec.group); } catch (e) { /* */ } rec.group = null; }
  rec.modes = []; rec.state = state; refreshModes();
}
function fault(rec, phase, e) {
  const msg = (e && e.message) || String(e);
  console.warn('[yzw] plugin fault', rec.id, phase, e);
  faults.push({ id: rec.id, phase, msg, t: Math.round(performance.now() - T0) });
  rec.err = phase + ': ' + msg;
  if (rec.state === 'error') return;
  stopPlugin(rec, 'error'); rec.err = phase + ': ' + msg;
  notice(`⚠ המודול "${rec.def.name || rec.id}" נכשל (${phase}) והושבת — שאר העולם ממשיך`, { action: { label: 'נסה שוב', fn: () => enable(rec.id, true) } });
  renderSheetSoft();
}
function enable(id, on, temp) {
  const rec = P.get(id); if (!rec || rec.def.pending) return;
  if (temp) { if (on) { if (rec.state === 'off' && !OFF.has(id)) { rec.state = 'registered'; initPlugin(rec); } else if (rec.state === 'off') { OFF.delete(id); rec.state = 'registered'; initPlugin(rec).then(() => { OFF.add(id); }); } } else if (rec.state === 'on') stopPlugin(rec, 'off'); renderSheetSoft(); return; }
  if (on) { OFF.delete(id); LS.set('off', [...OFF]); if (rec.def.defaultOff) LS.set('on', [...new Set(LS.get('on', []).concat(id))]); if (rec.state !== 'on' && rec.state !== 'loading') { rec.state = 'registered'; initPlugin(rec).then(renderSheetSoft); } }
  else { OFF.add(id); LS.set('off', [...OFF]); if (rec.def.defaultOff) LS.set('on', LS.get('on', []).filter(x => x !== id)); if (rec.state === 'on' || rec.state === 'loading') stopPlugin(rec, 'off'); }
  renderSheetSoft();
}
// שגיאות אסינכרוניות שנזרקו מקובץ של מודול (setTimeout / promise) – משויכות לפי שם הקובץ
addEventListener('error', e => { const f = e.filename || ''; const m = f.match(/\/(?:mods|adapters)\/([\w-]+)/); if (!m) return; const k = m[1].replace(/^\d+-/, ''); for (const r of P.values()) if (r.id === k || (r.def.dept && r.def.dept === k)) { fault(r, 'שגיאה', e.error || e.message); e.preventDefault(); return; } });

// ---------------------------------------------------------------- העולם המשותף
// תקציב לפי swarm/assets/BUDGET-mobile.txt (גרסה 1): נמוכה 100 קריאות/150 אלף, בינונית (רדמי) 150/250 אלף, גבוהה 300/500 אלף
const TIERS = {
  low:    { lvl: 2, calls: 100, tris: 150000, density: 0.35, shadow: false },
  medium: { lvl: 1, calls: 150, tris: 250000, density: 0.65, shadow: true },
  high:   { lvl: 0, calls: 300, tris: 500000, density: 1.0, shadow: true },
};
const TIER_HE = { low: 'חסכונית', medium: 'בינונית', high: 'גבוהה' };
const world = {
  version: VERSION, THREE: null, scene: null, camera: null, renderer: null, G27: null, bus,
  coords: { x: 'מזרח', y: 'מעלה', z: 'דרום', unit: 'm', crs: 'EPSG:2039', origin: { E: 0, N: 0 }, toScene: null, toITM: null, itmToWgs84: null, wgs84ToItm: null },
  clock: { t: 0, dt: 0, frame: 0, date: null, rate: 1, real: false },
  sun: { elevation: 0, azimuth: 0, dir: { x: 0, y: 1, z: 0 }, source: 'game/sim.js (NOAA)' },
  weather: { mode: 'manual', source: 'ידני', windSpeed: 4, windFrom: 270, gust: 1.3, cloud: 0.2, rain: 0, tempC: 22, visibility: 20000, aqi: 45, wind: { x: 0, y: 0, z: 0 }, status: '' },
  shabbat: { setting: 'auto', active: false, start: null, end: null, note: 'כניסה = שקיעה − 18 דק׳, יציאה = שקיעה + 42 דק׳ (קירוב, לא פסק הלכה)' },
  player: { mode: 'walk', pos: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, inside: null, selected: null },
  quality: { tier: 'medium', setting: 'auto', auto: true, budget: TIERS.medium, reason: '' },
  stats: { fps: 60, calls: 0, tris: 0, geoms: 0, texs: 0, heapMB: null, loadMs: null, startMs: null, pluginMs: 0 },
  providers: { sun: null, sunTimes: null },   // מחלקת הפיזיקה מחליפה כאן את מקור השמש
  data: null, sky: null, sunLight: null, hemi: null,
  // שכבת גרפיקה: הרנדרר הקלאסי (WebGL2 של three) הוא ברירת המחדל. ?renderer=webgpu נרשם בלבד – אין העברת shaders עד תוצאת ההשוואה על הרדמי (swarm/webgpu/bench.html).
  gfx: { backend: 'classic-webgl2', requested: (qs.get('renderer') || 'classic'), webgpuAvailable: typeof navigator !== 'undefined' && !!navigator.gpu, migrated: false, note: 'WebGPU: מעבדה בלבד (swarm/webgpu); החלטה אחרי מדידת הרדמי' },
};

// ---------------------------------------------------------------- איכות
function gpuInfo(r) { try { const gl = r.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : ''; } catch (e) { return ''; } }
function autoTier() {
  // נמדד על הרדמי של אריאל (23.11 02:58): 51–52 fps ברחוב באיכות בינונית → טלפון בינוני מתחיל ב"בינונית" ועולה אוטומטית אם יש מרווח.
  let s = 0; const why = [];
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency || 4, gpu = gpuInfo(world.renderer);
  if (mem && mem <= 3) { s -= 2; why.push('זיכרון ' + mem + 'GB'); } else if (mem && mem >= 8) s += 1;
  if (cores <= 4) { s -= 1; why.push(cores + ' ליבות'); }
  if (/SwiftShader|llvmpipe/i.test(gpu)) { s -= 2; why.push('רינדור תוכנה'); }
  else if (/Mali-[GT][0-4]\d\b|Adreno \(TM\) [3-5]\d\d|PowerVR/i.test(gpu)) { s -= 1; why.push('GPU ' + gpu.replace(/ANGLE \(|\)/g, '').slice(0, 30)); }
  else if (/Adreno \(TM\) 7[3-9]\d|Apple|NVIDIA|GeForce|Radeon|Iris/i.test(gpu)) s += 1;
  if (!TOUCH && s >= 0) s += 1;
  const t = s <= -2 ? 'low' : s <= 0 ? 'medium' : 'high';
  return { t, why: why.join(' · ') || 'מכשיר טוב' };
}
// יחס פיקסלים לפי שכבה (קצוות הדמות היו מפוקסלים ב-0.8–1.25): נמוכה 1.0, בינונית 1.5, גבוהה 2.0 — לא מעל יחס המסך
const DPR = { low: 1.0, medium: 1.5, high: 2.0 };
function setTier(setting, silent) {
  const q = world.quality; q.setting = setting; LS.set('tier', setting);
  let t = setting; if (setting === 'auto') { const a = autoTier(); t = a.t; q.reason = 'אוטומטי: ' + a.why; } else q.reason = 'ידני';
  q.auto = setting === 'auto'; applyTier(t, silent);
}
function applyTier(t, silent) {
  const q = world.quality; q.tier = t; q.budget = TIERS[t];
  const G = world.G27; G.Q.auto = false; G.setQuality(TIERS[t].lvl);
  const pr = Math.min(window.devicePixelRatio || 1, DPR[t]); if (Math.abs(world.renderer.getPixelRatio() - pr) > 0.01) { world.renderer.setPixelRatio(pr); G.Q.pr = pr; dispatchEvent(new Event('resize')); }
  bus.emit('quality', { tier: t, budget: TIERS[t] });
  for (const r of P.values()) if (r.def.minTier && READY) { if (TIER_N[t] < TIER_N[r.def.minTier] && r.state === 'on') stopPlugin(r, 'off'); else if (TIER_N[t] >= TIER_N[r.def.minTier] && r.state === 'off' && !OFF.has(r.id)) initPlugin(r); }
  if (!silent) notice('איכות: ' + TIER_HE[t], { kind: 'info', ms: 1800 });
}
let lowT = 0, highT = 0, overT = 0, downgraded = false;
function autoQuality(dt) {
  const q = world.quality, st = world.stats; if (world.clock.t < 8 || paused) return;
  const b = q.budget, over = st.calls > b.calls * 1.15 || st.tris > b.tris * 1.15;
  overT = over ? overT + dt : Math.max(0, overT - dt);
  if (overT > 5) { overT = 0; bus.emit('budget', { tier: q.tier, calls: st.calls, tris: st.tris, budget: b }); }
  if (!q.auto) return;
  if (st.fps < 36) lowT += dt; else lowT = Math.max(0, lowT - dt * 0.5);
  if (st.fps > 50) highT += dt; else highT = 0;
  if (lowT > 5 && q.tier !== 'low') { lowT = 0; downgraded = true; applyTier(q.tier === 'high' ? 'medium' : 'low', true); notice('האיכות הותאמה לביצועי המכשיר', { kind: 'info', ms: 1800 }); }
  if (highT > 8 && !downgraded && q.tier !== 'high') { highT = 0; applyTier(q.tier === 'low' ? 'medium' : 'high', true); }
}

// ---------------------------------------------------------------- זמן, שמש, מזג אוויר, שבת = מקור אמת יחיד
const ilOff = d => world.G27.SIM.israelOffsetMin(d);
function ilParts(d) { const off = ilOff(d), l = new Date(d.getTime() + off * 60000); return { y: l.getUTCFullYear(), mo: l.getUTCMonth(), d: l.getUTCDate(), wd: l.getUTCDay(), min: l.getUTCHours() * 60 + l.getUTCMinutes() }; }
function fromIL(y, mo, d, min) { const g = new Date(Date.UTC(y, mo, d, 0, min)); return new Date(g.getTime() - ilOff(g) * 60000); }
// שבירת אור לפי מזג האוויר של העולם: לחץ (hPa) מ-Open-Meteo במצב חי (pressure_msl ≈ לחץ תחנה באשדוד, גובה <60 מ' → <0.7%), אחרת 1010 תקני; טמפרטורה = טמפרטורת העולם
function atmo() { const w = world.weather, P = Number.isFinite(w.pressureHpa) ? w.pressureHpa : 1010, T = Number.isFinite(w.tempC) ? w.tempC : 10;
  return { pressure: P, temperature: T, source: Number.isFinite(w.pressureHpa) ? 'מזג אוויר (' + (w.source || '') + ')' : 'לחץ תקני 1010 hPa · טמפרטורת העולם' }; }
function sunPos(date) { const a = atmo(), o = { pressure: a.pressure, temperature: a.temperature };
  if (world.providers.sun) { try { return world.providers.sun(date, LAT, LON, o); } catch (e) { console.warn('[yzw] sun provider', e); } } return world.G27.SIM.sunPosition(date, LAT, LON, o); }
const jdMs = jd => (jd - 2440587.5) * 86400000;
function zman(y, mo, d, key) { if (!world.providers.zmanim) return null; try { const z = world.providers.zmanim(y, mo + 1, d, LAT, LON); const v = z && z.times && z.times[key]; return v ? jdMs(v) : null; } catch (e) { return null; } }
function sunsetUTC(y, mo, d) { // ms; זמני היום ממחלקת השמיים → פיזיקה → חיפוש בינארי על גובה −0.833°
  const zs = zman(y, mo, d, 'sunset'); if (zs) return zs;
  if (world.providers.sunTimes) { try { const r = world.providers.sunTimes(y, mo, d, LAT, LON); if (r && r.sunset) return +r.sunset; } catch (e) { /* */ } }
  let a = +fromIL(y, mo, d, 12 * 60), b = +fromIL(y, mo, d, 21 * 60);
  for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (world.G27.SIM.sunPosition(new Date(m), LAT, LON).elevation > -0.833) a = m; else b = m; }
  return (a + b) / 2;
}
function computeShabbat() {
  const s = world.shabbat, d = world.clock.date, p = ilParts(d);
  // שבת הרלוונטית: יום שישי של השבוע הנוכחי (שבת → אתמול)
  const back = p.wd === 6 ? 1 : (p.wd + 2) % 7; const fri = new Date(Date.UTC(p.y, p.mo, p.d - back));
  const sat = new Date(Date.UTC(p.y, p.mo, p.d - back + 1));
  s.start = new Date(sunsetUTC(fri.getUTCFullYear(), fri.getUTCMonth(), fri.getUTCDate()) - 18 * 60000);
  const tz = zman(sat.getUTCFullYear(), sat.getUTCMonth(), sat.getUTCDate(), 'tzeis8_5');
  s.end = new Date(tz || sunsetUTC(sat.getUTCFullYear(), sat.getUTCMonth(), sat.getUTCDate()) + 42 * 60000);
  s.note = world.providers.zmanim ? 'הדלקת נרות = שקיעה − 18 דק׳, צאת שבת = צאת הכוכבים 8.5° (זמני היום של מחלקת השמיים, KosherJava ±4 שנ׳; לא פסק הלכה)' : 'כניסה = שקיעה − 18 דק׳, יציאה = שקיעה + 42 דק׳ (קירוב, לא פסק הלכה)';
  const auto = +d >= +s.start && +d < +s.end;
  const act = s.setting === 'on' ? true : s.setting === 'off' ? false : auto;
  if (act !== s.active) { s.active = act; bus.emit('shabbat', { active: act, start: s.start, end: s.end }); }
}
let envKey = '';
function snapshotWeather() {
  const w = world.weather, sw = world.G27.SIM.weather; w.windSpeed = sw.windSpeed; w.windFrom = sw.windFrom; w.gust = sw.gust; w.cloud = sw.cloud; w.rain = sw.rain;
  const r = w.windFrom * Math.PI / 180; w.wind = { x: -w.windSpeed * Math.sin(r), y: 0, z: w.windSpeed * Math.cos(r) };
}
function applyEnvAll() {
  const G = world.G27; if (!G) return;
  G.ENV.date = world.clock.date; G.applyEnv();
  const sp = sunPos(world.clock.date);
  if (world.providers.sun && world.sky) {   // שמש מהמחלקה: מעדכנים את הווקטור המשותף (כיפה + אור + צל)
    const v = world.providers.sunVector(sp); world.sky.material.uniforms.sun.value.set(v.x, v.y, v.z).normalize(); G.ENV.sun = sp;
  }
  const dv = world.sky ? world.sky.material.uniforms.sun.value : { x: 0, y: 1, z: 0 };
  Object.assign(world.sun, { elevation: sp.elevation, azimuth: sp.azimuth, dir: { x: dv.x, y: dv.y, z: dv.z }, refraction: sp.elevation - (sp.elevationGeometric ?? sp.elevation), atmosphere: atmo() });
  snapshotWeather(); computeShabbat();
  envKey = keyOf(); bus.emit('env', { date: world.clock.date, sun: world.sun, weather: world.weather });
}
function keyOf() { const G = world.G27, w = G.SIM.weather; return +G.ENV.date + '|' + w.windSpeed + '|' + w.windFrom + '|' + w.gust + '|' + w.cloud + '|' + w.rain; }
function setTime(o) {   // {date?:Date, min?:minutes IL, ymd?:'YYYY-MM-DD', preset?:'now'|'golden'|'noon'|'night', rate?}
  const c = world.clock; c.real = false;
  if (o.rate != null) c.rate = o.rate;
  if (o.preset === 'now') { c.date = new Date(); c.real = true; c.rate = 1; }
  else if (o.preset) { const p = ilParts(c.date); const ss = sunsetUTC(p.y, p.mo, p.d);
    c.date = o.preset === 'golden' ? new Date(ss - 40 * 60000) : o.preset === 'noon' ? fromIL(p.y, p.mo, p.d, 12 * 60 + 30) : new Date(ss + 150 * 60000); }
  if (o.date) c.date = new Date(o.date);
  if (o.ymd) { const [y, mo, d] = o.ymd.split('-').map(Number); if (y) c.date = fromIL(y, mo - 1, d, ilParts(c.date).min); }
  if (o.min != null) { const p = ilParts(c.date); c.date = fromIL(p.y, p.mo, p.d, o.min); }
  applyEnvAll();
}
function setWeather(o) {
  const w = world.weather, sw = world.G27.SIM.weather;
  if (o.mode) w.mode = o.mode;
  for (const k of ['windSpeed', 'windFrom', 'gust', 'cloud', 'rain']) if (o[k] != null) sw[k] = +o[k];
  for (const k of ['tempC', 'pressureHpa', 'visibility', 'aqi', 'source', 'status']) if (o[k] != null) w[k] = o[k];
  if (o.source) sw.source = o.source; else if (w.mode === 'manual') { sw.source = 'ידני'; w.source = 'ידני'; }
  applyEnvAll();
}
function setShabbat(v) { world.shabbat.setting = v; LS.set('shabbat', v); computeShabbat(); bus.emit('shabbat', { active: world.shabbat.active, start: world.shabbat.start, end: world.shabbat.end }); }

// ---------------------------------------------------------------- מצבים
const ORDER = ['dev', 'walk', 'car', 'heli', 'jetpack', 'drone', 'jet', 'spaceship', 'boat', 'present'];
const GAME_MODES = { walk: ['foot', '🚶', 'רגלי'], car: ['car', '🚗', 'רכב'], heli: ['heli', '🚁', 'מסוק'], jetpack: ['jet', '🎒', 'תרמיל סילון'], drone: ['drone', '🛸', 'רחפן'] };
const FROM_GAME = { foot: 'walk', car: 'car', heli: 'heli', jet: 'jetpack', drone: 'drone' };
const PLACEHOLDER = { dev: ['👁', 'העין הגדולה', 'מחלקת האינטגרציה'], jet: ['✈', 'מטוס סילון', 'מחלקת התעופה'], spaceship: ['🚀', 'חללית', 'מחלקת התעופה'], boat: ['🚤', 'סירה', 'מחלקת הים'], present: ['🎬', 'מצגת יזם', 'מחלקת המצגת'] };
const MODES = new Map();
function refreshModes() {
  MODES.clear();
  for (const [id, g] of Object.entries(GAME_MODES)) MODES.set(id, { id, gameMode: g[0], icon: g[1], name: g[2], kind: 'game', available: true, group: 'game' });
  for (const r of P.values()) if (r.state === 'on') for (const m of r.modes) MODES.set(m.id, Object.assign({ available: true, group: m.id === 'dev' || m.id === 'present' ? 'dev' : 'game' }, m));
  for (const [id, p] of Object.entries(PLACEHOLDER)) if (!MODES.has(id)) {
    const owner = [...P.values()].find(r => (r.def.provides || []).includes(id));
    const why = owner ? (owner.state === 'error' ? 'נכשל: ' + owner.err : owner.state === 'pending' ? 'בעבודה: ' + owner.err : owner.state === 'off' ? 'כבוי' : 'נטען…') : 'בעבודה — ' + p[2];
    MODES.set(id, { id, icon: p[0], name: p[1], kind: 'none', available: false, why, group: id === 'dev' || id === 'present' ? 'dev' : 'game' });
  }
  renderSheetSoft();
}
let cur = null;          // מצב תוסף פעיל (או null כשהמשחק שולט)
let curId = 'walk';
const ZERO = Object.freeze({ x: 0, y: 0, up: false, down: false, sprint: false });
let paused = false;
function readInput() {
  const G = world.G27, i = G.input, k = i.keys; let x = i.x, y = i.y;
  if (k.has('KeyW') || k.has('ArrowUp')) y += 1; if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1; if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), up: i.up || k.has('Space'), down: i.down || k.has('KeyC') || k.has('ShiftLeft'), yawL: k.has('KeyQ'), yawR: k.has('KeyR'), keys: k };
}
function playerPos() { const S = world.G27.S; const m = S.mode; const o = m === 'car' ? S.car : m === 'heli' ? S.heli : m === 'drone' ? S.drone : S.p; return { x: o.x, y: o.y, z: o.z }; }
function setMode(id, force, at) {
  const G = world.G27; if (!G || (!force && id === curId)) return true;
  const m = MODES.get(id); if (!m || !m.available) { notice((m ? m.name + ': ' + m.why : 'מצב לא ידוע: ' + id), { kind: 'info' }); return false; }
  if (G.S.inside) G.exitInterior();
  const from = curId, pos = at || (cur && cur.lastPos ? cur.lastPos : playerPos());
  if (cur) { const c = cur; cur = null; try { c.exit && c.exit(world, id); } catch (e) { fault(c.owner, 'יציאה ממצב', e); } leaveTakeover(c, pos); }
  if (m.kind === 'game') { G.setMode(m.gameMode); curId = id; }
  else {
    if (G.S.mode !== 'foot') G.setMode('foot');
    enterTakeover(m); cur = m; curId = id; m.lastPos = null;
    try { m.enter && m.enter(world, from, pos); } catch (e) { cur = null; leaveTakeover(m, pos); curId = 'walk'; fault(m.owner, 'כניסה למצב', e); return false; }
    $('modeT') && ($('modeT').textContent = m.name); const ic = $('mode') && $('mode').querySelector('.ic'); if (ic) ic.textContent = m.icon;
  }
  if (from === 'dev' && m.kind === 'game' && READY && world.stats.startMs) { const p = playerPos(), y = world.G27.S.cam.yaw; flyCam(world.camera.position.clone(), new THREE.Vector3(p.x - Math.sin(y) * 5.5, p.y + 2.4, p.z - Math.cos(y) * 5.5), new THREE.Vector3(p.x, p.y + 1.4, p.z), 1.1); }
  world.player.mode = curId; document.body.dataset.yzMode = curId; syncURL();
  LS.set('mode', curId); bus.emit('mode', { id: curId, from }); renderSheetSoft();
  return true;
}
function enterTakeover(m) {
  const G = world.G27; G.input.override = ZERO; const pl = world.scene.getObjectByName('player'); if (pl) pl.visible = false;
  document.body.classList.add('yz-pm'); if (m.kind === 'overlay') { paused = true; document.body.classList.add('yz-ovl'); }
}
function leaveTakeover(m, pos) {
  const G = world.G27, S = G.S; G.input.override = null; document.body.classList.remove('yz-pm', 'yz-ovl'); paused = false;
  const pl = world.scene.getObjectByName('player'); if (pl) pl.visible = true;
  if (pos) { const c = G.W.collide(pos.x, pos.z, 0.4, 0, 2); S.p.set(c.x, 0, c.z); S.p.y = G.W.floorAt(c.x, c.z, Math.max(G.W.H(c.x, c.z), 0) + 400); if (G.W.isSea(c.x, c.z) && S.p.y < -1.4) S.p.y = -1.4; S.vy = 0; S.grounded = true; }   // יורדים מסירה לים: צפים (מקורב), לא על קרקעית −2.5
  const ui = GAME_MODES[FROM_GAME[S.mode]]; if (ui && $('modeT')) { $('modeT').textContent = ui[2]; $('mode').querySelector('.ic').textContent = ui[1]; }
}

// ---------------------------------------------------------------- לולאה (נקראת מתוך renderer.render של המשחק)
let lastT = 0, fpsE = 60, hudT = 0, slowT = 0;
function pre(scene, cam) {
  const G = world.G27, now = performance.now(); let dt = lastT ? (now - lastT) / 1000 : 0.016; lastT = now; const raw = dt; if (dt > 0.1) dt = 0.1;
  const c = world.clock; c.dt = dt; c.t += dt; c.frame++; fpsE += (1 / Math.max(raw, 1e-3) - fpsE) * 0.1; world.stats.fps = fpsE;   // fps אמיתי (dt לא חתוך)
  if (!G.S.started) return;
  // זמן זורם
  if (c.real) { slowT += dt; if (slowT > 15) { slowT = 0; c.date = new Date(); applyEnvAll(); } }
  else if (c.rate) { c.date = new Date(+c.date + dt * 1000 * c.rate); slowT += dt; if (slowT > (c.rate > 10 ? 0.25 : 5)) { slowT = 0; applyEnvAll(); } }
  if (keyOf() !== envKey) { world.clock.date = new Date(G.ENV.date); applyEnvAll(); }   // שינוי מתוך פאנל המשחק
  // המשחק החליף מצב בעצמו (מקלדת F / 1-5)?
  if (!cur && FROM_GAME[G.S.mode] !== curId && MODES.get(curId) && MODES.get(curId).kind === 'game') { curId = FROM_GAME[G.S.mode]; world.player.mode = curId; bus.emit('mode', { id: curId }); }
  if (cur && G.S.mode !== 'foot') { const c2 = cur; cur = null; try { c2.exit && c2.exit(world, FROM_GAME[G.S.mode]); } catch (e) { /* */ } leaveTakeover(c2, null); curId = FROM_GAME[G.S.mode]; }
  // שחקן
  const pp = world.player; pp.inside = G.S.inside; pp.heading = G.S.heading; pp.speed = G.S.speed; if (!cur) pp.pos = playerPos();
  // תוספים
  let tot = runPlugins(dt, false);
  // מצב תוסף משתלט
  if (cur && !paused) {
    let res = null; try { res = cur.update ? cur.update(dt, world, readInput()) : null; } catch (e) { fault(cur.owner, 'מצב ' + cur.name, e); }
    if (cur && res) { cur.lastPos = res; pp.pos = { x: res.x, y: res.y || 0, z: res.z }; pp.speed = res.speed || 0;
      const S = G.S; S.p.x = res.x; S.p.z = res.z; S.p.y = Math.max(G.W.H(res.x, res.z), 0); S.vy = 0;
      if (world.sky) world.sky.position.copy(world.camera.position);
      { const sp = $('hSpd'), al = $('hAlt'); if (sp) sp.textContent = Math.round((res.speed || 0) * 3.6); if (al && res.alt != null) al.textContent = Math.round(res.alt); } }
  }
  tot += runPlugins(dt, true);   // late: מצלמה וכד׳ – אחרי מצב התוסף
  world.stats.pluginMs += (tot - world.stats.pluginMs) * 0.05;
  intro(dt);
}
function runPlugins(dt, late) {
  let tot = 0;
  for (const r of P.values()) { if (r.state !== 'on' || !r.def.update || !!r.def.late !== late) continue; const t0 = performance.now();
    try { r.def.update(dt, world); } catch (e) { fault(r, 'עדכון', e); continue; } const ms = performance.now() - t0; r.ms += (ms - r.ms) * 0.05; tot += ms; }
  return tot;
}
function post() {
  const i = world.renderer.info, st = world.stats; st.calls = i.render.calls; st.tris = i.render.triangles; st.geoms = i.memory.geometries; st.texs = i.memory.textures;
  if (performance.memory && (world.clock.frame % 60 === 0)) st.heapMB = performance.memory.usedJSHeapSize / 1048576;
  autoQuality(world.clock.dt);
  hudT -= world.clock.dt; if (hudT <= 0) { hudT = 0.5; renderHUD(); }
}

// ---------------------------------------------------------------- פתיחה מרשימה: מעוף מעל הים בשעת זהב
const INTRO = { on: false, t: 0, dur: 6, a: null, b: null };
function startIntro() {
  const p = playerPos(); INTRO.on = true; INTRO.t = 0; INTRO.dur = 6;
  INTRO.a = new THREE.Vector3(p.x - 1500, 140, p.z + 350); INTRO.b = new THREE.Vector3(p.x - Math.sin(world.G27.S.cam.yaw) * 6, p.y + 2.6, p.z - Math.cos(world.G27.S.cam.yaw) * 6); INTRO.look = new THREE.Vector3(p.x, p.y + 6, p.z);
  const skip = () => { INTRO.on = false; removeEventListener('pointerdown', skip, true); }; addEventListener('pointerdown', skip, true);
}
function intro(dt) {
  if (!INTRO.on) return; INTRO.t += dt; const k = clamp(INTRO.t / INTRO.dur, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const cam = world.camera; cam.position.lerpVectors(INTRO.a, INTRO.b, e); cam.position.y += Math.sin(k * Math.PI) * (INTRO.arc == null ? 60 : INTRO.arc);
  const look = new THREE.Vector3().lerpVectors(new THREE.Vector3(INTRO.look.x, 30, INTRO.look.z), INTRO.look, e); cam.lookAt(look);
  if (world.sky) world.sky.position.copy(cam.position);
  if (k >= 1) { INTRO.on = false; INTRO.arc = null; if (INTRO.t0) { world.stats.lastFlyMs = Math.round(performance.now() - INTRO.t0); INTRO.t0 = 0; } }
}

// ---------------------------------------------------------------- ממשק: גיליון תחתון (מצבים / הגדרות / מודולים / ביצועים)
let sheetTab = null;
function openSheet(tab) { sheetTab = tab; let el = $('yzSheet'); if (!el) return; ['menu', 'env', 'mine'].forEach(id => { const e = $(id); if (e) e.style.display = 'none'; }); el.style.display = 'block'; renderSheet(); }
function closeSheet() { sheetTab = null; const el = $('yzSheet'); if (el) el.style.display = 'none'; }
let softT = 0; function renderSheetSoft() { clearTimeout(softT); softT = setTimeout(() => { if (sheetTab && sheetTab !== 'settings') renderSheet(); }, 60); }
const seg = (name, opts, curV) => `<div class="seg" data-seg="${name}">${opts.map(o => Array.isArray(o) ? o : [o, String(o)]).map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(curV) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const hhmm = min => String(min / 60 | 0).padStart(2, '0') + ':' + String(min % 60 | 0).padStart(2, '0');
function renderSheet() {
  const el = $('yzSheet'); if (!el || !sheetTab) return;
  const tabs = [['modes', '🎮 מצבים'], ['settings', '⚙ הגדרות'], ['modules', '🧩 מודולים'], ['perf', '📊 ביצועים']];
  let h = `<div class="hd"><h2>לוח היזם · עולם תאום</h2><button class="yzBtn" id="yzX" aria-label="סגירה">✕</button></div><div class="tabs">${tabs.map(([k, l]) => `<button class="yzBtn ${k === sheetTab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
  if (sheetTab === 'modes') {
    const btn = m => `<button class="yzM ${m.id === curId ? 'on' : ''}" data-mode="${m.id}" ${m.available ? '' : 'disabled'} title="${esc(m.why || '')}"><span class="i">${m.icon}</span><b>${esc(m.name)}</b>${m.available ? '' : `<span class="s">${esc(m.why)}</span>`}</button>`;
    const list = ORDER.map(id => MODES.get(id)).filter(Boolean).concat([...MODES.values()].filter(m => !ORDER.includes(m.id)));
    h += `<h3>👁 העין הגדולה — מפה, שכבות, חיפוש, כרטיס בניין, שרטוט מגרש</h3><div class="grid">${list.filter(m => m.group === 'dev').map(btn).join('')}</div>`;
    h += `<h3>🧍 הדמות — אותו עולם, אותו מקום</h3><div class="grid">${list.filter(m => m.group !== 'dev').map(btn).join('')}</div>`;
    h += `<p class="mut">המעבר בין מצבים שומר מיקום, זמן, מזג אוויר ובניין נבחר.</p>`;
  } else if (sheetTab === 'settings') {
    const q = world.quality, c = world.clock, p = ilParts(c.date), w = world.weather, s = world.shabbat;
    const ds = `${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    h += `<h3>איכות גרפיקה</h3>${seg('tier', [['auto', 'אוטומטי'], ['low', 'חסכונית'], ['medium', 'בינונית'], ['high', 'גבוהה']], q.setting)}<div class="mut">כעת: ${TIER_HE[q.tier]} · ${esc(q.reason)}</div>`;
    h += `<h3>☀ זמן · <span id="yzHH">${hhmm(p.min)}</span> <span class="mut">שעון ישראל · שמש ${world.sun.elevation.toFixed(1)}°</span></h3>
      <div class="row"><button class="yzBtn" data-time="now">עכשיו</button><button class="yzBtn" data-time="golden">🌅 שעת זהב</button><button class="yzBtn" data-time="noon">☀ צהריים</button><button class="yzBtn" data-time="night">🌙 לילה</button></div>
      <div class="row"><input type="date" id="yzDate" value="${ds}"></div>
      <div class="row"><button class="yzBtn" id="yzSunMore" onclick="window.__yzGameEnv && window.__yzGameEnv()">🌅 זריחה, שקיעה ושעות שמש כאן</button></div>
      <label>שעה <input type="range" id="yzMin" min="0" max="1439" step="5" value="${p.min}"></label>
      <div class="row"><span class="mut">קצב הזמן</span>${seg('rate', [['0', 'עצור'], ['1', '×1'], ['60', '×60'], ['600', '×600']], c.real ? '1' : String(c.rate))}</div>`;
    h += `<h3>🌦 מזג אוויר · <span class="mut">${esc(w.source)}${w.status ? ' · ' + esc(w.status) : ''}</span></h3>${seg('wmode', [['manual', 'ידני'], ['live', 'חי (Open-Meteo)']], w.mode)}
      <label>רוח <span id="yzWsL">${w.windSpeed.toFixed(1)}</span> מ׳/ש׳<input type="range" data-w="windSpeed" min="0" max="25" step="0.5" value="${w.windSpeed}"></label>
      <label>נושבת מ־<span id="yzWdL">${Math.round(w.windFrom)}</span>°<input type="range" data-w="windFrom" min="0" max="355" step="5" value="${w.windFrom}"></label>
      <label>עננות <span id="yzClL">${Math.round(w.cloud * 100)}</span>%<input type="range" data-w="cloud" min="0" max="1" step="0.05" value="${w.cloud}"></label>
      <label>גשם <span id="yzRnL">${w.rain.toFixed(1)}</span> מ״מ/שעה<input type="range" data-w="rain" min="0" max="20" step="0.5" value="${w.rain}"></label>
      <label>זיהום אוויר / אובך (AQI) <span id="yzAqL">${Math.round(w.aqi)}</span><input type="range" data-w="aqi" min="0" max="300" step="5" value="${w.aqi}"></label>
      ${w.mode === 'live' ? '<div class="mut"><a style="color:#9cc0ff" href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a></div>' : ''}`;
    const f = d => d ? d.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    h += `<h3>🕯 מצב שבת ${s.active ? '<span class="yzSt on">פעיל</span>' : ''}</h3>${seg('shabbat', [['auto', 'לפי הזמן'], ['on', 'פעיל'], ['off', 'כבוי']], s.setting)}
      <div class="mut">כניסה ${f(s.start)} · יציאה ${f(s.end)} · ${esc(s.note)}. בשבת: תנועה דלילה, חנויות סגורות, הולכי רגל לבית הכנסת (לפי המודולים).</div>`;
    for (const r of P.values()) if (r.state === 'on' && r.def.settings && r.def.settings.length) {
      h += `<h3>${esc(r.def.name)}</h3>`;
      try { r.def.settings.forEach((st, i) => { let v; try { v = st.get(); } catch (e) { v = null; }
        if (st.type === 'toggle') h += `<div class="row"><button class="yzBtn ${v ? 'on' : ''}" data-ps="${r.id}:${i}">${v ? '✔' : '○'} ${esc(st.label)}</button></div>`;
        else if (st.type === 'range') h += `<label>${esc(st.label)}<input type="range" data-ps="${r.id}:${i}" min="${st.min}" max="${st.max}" step="${st.step || 1}" value="${v}"></label>`;
        else if (st.type === 'select') h += `<div class="row"><span class="mut">${esc(st.label)}</span>${seg('ps:' + r.id + ':' + i, st.options, v)}</div>`; }); } catch (e) { h += `<div class="mut">הגדרות המודול לא זמינות</div>`; console.warn('[yzw] settings', r.id, e); }
    }
  } else if (sheetTab === 'modules') {
    const SHE = { on: 'פעיל', error: 'נכשל', off: 'כבוי', pending: 'בעבודה', loading: 'נטען', registered: 'ממתין' };
    h += `<p class="mut">כל מחלקה היא מודול נפרד. מודול שנכשל מושבת לבד — העולם ממשיך.</p>`;
    for (const r of [...P.values()].sort((a, b) => (a.def.order || 50) - (b.def.order || 50))) {
      h += `<div class="mod"><div class="t"><b>${esc(r.def.name || r.id)}</b> <span class="yzSt ${r.state === 'registered' ? 'loading' : r.state}">${SHE[r.state] || r.state}</span><small>${esc(r.def.dept || '')}${r.state === 'on' ? ' · ' + r.ms.toFixed(2) + ' מ״ש/פריים · אתחול ' + Math.round(r.initMs) + ' מ״ש' : ''}${r.err ? ' · ' + esc(r.err) : ''}</small></div>
        ${r.def.pending || r.def.core ? '' : `<button class="yzBtn" data-tog="${r.id}">${r.state === 'on' || r.state === 'loading' ? 'כבה' : r.state === 'error' ? 'נסה שוב' : 'הפעל'}</button>`}</div>`;
    }
  } else if (sheetTab === 'perf') {
    h += `<div id="yzDiag">${esc(diagText())}</div><div class="row"><button class="yzBtn" id="yzCount">ספירת משולשים לפי מודול</button><button class="yzBtn" id="yzFps">מונה FPS</button></div><div id="yzCnt" class="mut"></div>`;
  }
  el.innerHTML = h;
  el.querySelector('#yzX').onclick = closeSheet;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { sheetTab = b.dataset.tab; renderSheet(); });
  el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (setMode(b.dataset.mode)) closeSheet(); });
  el.querySelectorAll('[data-tog]').forEach(b => b.onclick = () => { const r = P.get(b.dataset.tog); enable(r.id, !(r.state === 'on' || r.state === 'loading')); });
  el.querySelectorAll('[data-seg]').forEach(sg => sg.querySelectorAll('button').forEach(b => b.onclick = () => {
    const n = sg.dataset.seg, v = b.dataset.v;
    if (n === 'tier') setTier(v); else if (n === 'rate') setTime({ rate: +v }); else if (n === 'shabbat') setShabbat(v);
    else if (n === 'wmode') { setWeather({ mode: v }); bus.emit('weather-mode', v); }
    else if (n.startsWith('ps:')) { const [, id, i] = n.split(':'); try { P.get(id).def.settings[+i].set(v); } catch (e) { fault(P.get(id), 'הגדרה', e); } }
    renderSheet(); }));
  el.querySelectorAll('[data-time]').forEach(b => b.onclick = () => { setTime({ preset: b.dataset.time }); renderSheet(); });
  const md = el.querySelector('#yzMin'); if (md) md.oninput = e => { setTime({ min: +e.target.value }); $('yzHH').textContent = hhmm(+e.target.value); };
  const dd = el.querySelector('#yzDate'); if (dd) dd.onchange = e => { setTime({ ymd: e.target.value }); renderSheet(); };
  el.querySelectorAll('[data-w]').forEach(r => r.oninput = e => { const k = r.dataset.w, v = +e.target.value; setWeather({ [k]: v, mode: 'manual' });
    const lab = { windSpeed: ['yzWsL', v.toFixed(1)], windFrom: ['yzWdL', Math.round(v)], cloud: ['yzClL', Math.round(v * 100)], rain: ['yzRnL', v.toFixed(1)], aqi: ['yzAqL', Math.round(v)] }[k]; if (lab) $(lab[0]).textContent = lab[1]; });
  el.querySelectorAll('[data-ps]').forEach(c => { const [id, i] = c.dataset.ps.split(':'); const st = P.get(id).def.settings[+i];
    const f = v => { try { st.set(v); } catch (e) { fault(P.get(id), 'הגדרה', e); } };
    if (c.tagName === 'BUTTON') c.onclick = () => { let v; try { v = st.get(); } catch (e) { v = false; } f(!v); renderSheet(); }; else c.oninput = e => f(+e.target.value); });
  const cn = el.querySelector('#yzCount'); if (cn) cn.onclick = () => { $('yzCnt').textContent = countTris().map(([k, v]) => `${k}: ${(v / 1000).toFixed(1)}k`).join(' · '); };
  const fb = el.querySelector('#yzFps'); if (fb) fb.onclick = () => { const f = $('fps'); if (f) f.classList.toggle('hidden'); };
}
function countTris() {
  const out = []; const cnt = o => { let n = 0; o.traverse(m => { if (!m.isMesh || !m.geometry) return; const g = m.geometry, c = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0); n += c / 3 * (m.isInstancedMesh ? m.count : 1); }); return n; };
  for (const r of P.values()) if (r.group) out.push([r.def.name || r.id, cnt(r.group)]);
  let tiles = 0; for (const t of world.data.tiles.values()) if (t.grp) tiles += cnt(t.grp); out.unshift(['אריחי העיר (משחק)', tiles]);
  return out;
}
function diagText() {
  const s = world.stats, q = world.quality, b = q.budget, G = world.G27;
  const lines = [`fps ${s.fps.toFixed(0)}  tier ${q.tier} (${q.setting})  pr ${world.renderer.getPixelRatio().toFixed(2)}`,
    `draw calls ${s.calls} / budget ${b.calls}   tris ${(s.tris / 1000).toFixed(0)}k / ${(b.tris / 1000).toFixed(0)}k`,
    `geometries ${s.geoms}  textures ${s.texs}  heap ${s.heapMB ? s.heapMB.toFixed(0) + ' MB' : 'n/a'}`,
    `tiles ${G.W.tiles.size}  load→start ${s.startMs ? (s.startMs / 1000).toFixed(1) + ' s' : '—'}  plugins ${s.pluginMs.toFixed(2)} ms/frame`,
    `mode ${curId}  sun ${world.sun.elevation.toFixed(1)}°/${world.sun.azimuth.toFixed(0)}° (${world.providers.sun ? 'physics' : 'game sim'})`,
    `שבירת אור ${((world.sun.refraction || 0) * 60).toFixed(1)}′ · ${world.sun.atmosphere ? world.sun.atmosphere.pressure.toFixed(0) + ' hPa, ' + world.sun.atmosphere.temperature.toFixed(0) + '°C' : '1010 hPa, 10°C'} (מקורב: שכבה אחת; ליד האופק ±0.2°)`,
    `gfx ${world.gfx.backend} (requested ${world.gfx.requested}, webgpu ${world.gfx.webgpuAvailable ? 'yes' : 'no'})`,
    `faults ${faults.length}${faults.length ? ': ' + faults.slice(-3).map(f => f.id + '/' + f.phase).join(', ') : ''}`];
  return lines.join('\n');
}
const HUDX = new Set();   // לוחות HUD פתוחים (ברירת מחדל: שורה אחת, נגיעה פותחת)
function renderHUD() {
  let el = $('yzBadge'); if (!el || !READY || !world.clock.date) return;
  const p = ilParts(world.clock.date);
  el.innerHTML = `<span>${hhmm(p.min)}${world.clock.rate > 1 && !world.clock.real ? ' ⏩' : ''}</span>${world.shabbat.active ? '<span class="sh">🕯 שבת</span>' : ''}<span>${TIER_HE[world.quality.tier]}</span>`;
  const wu = $('hWind') && $('hWind').nextElementSibling; if (wu) wu.textContent = world.weather.mode === 'live' && world.weather.liveStatus === 'live' ? 'מ׳/ש׳ רוח (Open-Meteo)' : 'מ׳/ש׳ רוח לדוגמה';
  const hp = $('yzHUDp'); if (!hp) return;
  const want = []; for (const r of P.values()) if (r.state === 'on' && r.def.hudPanels) for (const pn of r.def.hudPanels) want.push([r, pn]);
  hp.textContent = '';
  for (const [r, pn] of want) { const d = document.createElement('div'); const key = r.id + ':' + pn.id; try { pn.render(d, world); if (d.innerHTML) { if (!HUDX.has(key)) d.className = 'c'; d.onclick = () => { HUDX.has(key) ? HUDX.delete(key) : HUDX.add(key); renderHUD(); }; hp.appendChild(d); } } catch (e) { fault(r, 'HUD', e); } }
  if (sheetTab === 'perf') { const dg = $('yzDiag'); if (dg) dg.textContent = diagText(); }
}

// ---------------------------------------------------------------- חיבור למשחק
let READY = false;
function attach() {
  if (qs.has('clean')) document.body.classList.add('yz-clean');
  const G = window.G27; world.G27 = G; world.THREE = window.THREE; world.scene = G.scene; world.camera = G.camera; world.renderer = G.renderer;
  const r = G.renderer, orig = r.render.bind(r);
  let inPR = false;
  r.render = function (sc, cam) { if (inPR) return orig(sc, cam); if (paused) { pre(sc, cam); return; } if (sc !== G.scene) { orig(sc, cam); return; } pre(sc, cam);
    let done = false; for (const rr of P.values()) if (rr.state === 'on' && rr.def.render) { inPR = true; try { rr.def.render(world, orig); done = true; } catch (e) { inPR = false; fault(rr, 'ציור', e); } inPR = false; break; }
    if (!done) orig(sc, cam); post(); };
  // UI
  const sh = document.createElement('div'); sh.id = 'yzSheet'; sh.setAttribute('role', 'dialog'); document.body.appendChild(sh);
  const bd = document.createElement('div'); bd.id = 'yzBadge'; document.body.appendChild(bd);
  const hp = document.createElement('div'); hp.id = 'yzHUDp'; document.body.appendChild(hp);
  const mb = $('mode'); if (mb) mb.onclick = () => openSheet('modes');
  const eb = $('bEnv'); if (eb) { const gameEnv = eb.onclick; window.__yzGameEnv = () => { closeSheet(); if (gameEnv) gameEnv(); }; eb.onclick = () => (sheetTab === 'settings' ? closeSheet() : openSheet('settings')); }
  const top = $('top'); if (top) { const b = document.createElement('button'); b.className = 'btn'; b.id = 'yzMods'; b.setAttribute('aria-label', 'מודולים וביצועים'); b.textContent = '🧩'; b.onclick = () => (sheetTab === 'modules' ? closeSheet() : openSheet('modules')); top.insertBefore(b, $('bMenu'));
    const h = document.createElement('button'); h.className = 'btn'; h.id = 'yzHome'; h.innerHTML = '🏠<span class="lbl"> השכונה שלי</span>'; h.setAttribute('aria-label', 'השכונה שלי'); h.onclick = goHome; top.insertBefore(h, $('bMine')); }
  // שתי כניסות במסך הפתיחה
  const go = $('go');
  if (go) { const wrap = document.createElement('div'); wrap.id = 'yzEntr'; wrap.className = 'hidden'; wrap.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center';
    wrap.innerHTML = '<button class="btn pri" id="yzGoGame" style="font-size:16px;padding:10px 18px">🧍 הדמות — לרחוב</button><button class="btn" id="yzGoDev" style="font-size:16px;padding:10px 18px;border-color:var(--acc)">👁 העין הגדולה — מפה וכלים</button>';
    go.after(wrap); go.style.display = 'none';
    const show = setInterval(() => { if (!go.classList.contains('hidden')) { wrap.classList.remove('hidden'); clearInterval(show); } }, 100);
    const begin = m => { audioUnlock(); G.start(); onStarted(m); };
    wrap.querySelector('#yzGoGame').onclick = () => begin(qs.get('mode') && qs.get('mode') !== 'dev' ? qs.get('mode') : 'walk');
    wrap.querySelector('#yzGoDev').onclick = () => begin('dev'); }
  const waitW = setInterval(() => { if (G.W.ready) { clearInterval(waitW); onWorldReady(); } }, 50);
}
function audioUnlock() { bus.emit('user-gesture', {}); }
addEventListener('pointerdown', function once() { removeEventListener('pointerdown', once, true); audioUnlock(); }, true);
function onWorldReady() {
  const G = world.G27, W = G.W;
  world.coords.origin = { E: W.OX, N: W.OY }; world.coords.toScene = W.toScene; world.coords.toITM = W.toITM;
  // מסגרת הדגימה ≠ ITM אמיתי: אמיתי = דגימה + היסט (groundtruth/ashdod_reference.json). toITM נשאר במסגרת הדגימה (תאימות לאחור).
  const OFF = window.ITM ? window.ITM.SAMPLE_OFFSET : { dE: 1507.82, dN: 757.76 }; world.coords.sampleOffset = OFF;
  world.coords.toRealITM = (x, z) => { const p = W.toITM(x, z); return { E: p.E + OFF.dE, N: p.N + OFF.dN }; };
  world.coords.fromRealITM = (E, N) => W.toScene(E - OFF.dE, N - OFF.dN);
  if (window.ITM) { world.coords.itmToWgs84 = window.ITM.itmToWgs84; world.coords.wgs84ToItm = window.ITM.wgs84ToItm; }   // הלמרט 7 פרמטרים + TM, ≤0.5 מ"מ מול PROJ
  else if (window.PGEO) { world.coords.itmToWgs84 = window.PGEO.itmToWgs84; world.coords.wgs84ToItm = window.PGEO.wgs84ToItm; }
  world.data = { W, tiles: W.tiles, H: W.H, floorAt: W.floorAt, near: W.near, buildingAt: W.buildingAt, onRoad: W.onRoad, nearestStreet: W.nearestStreet, collide: W.collide, pip: W.pip, edgeDist: W.edgeDist, MAT: W.MAT, bounds: W.bounds,
    buildingById(id) { for (const t of W.tiles.values()) for (const b of t.blds || []) if (b.id === id) return b; return null; } };
  const prevOn = W.onTile; W.onTile = (t, k) => { if (prevOn) prevOn(t, k); bus.emit('tile', { tile: t, kind: k }); };
  world.scene.traverse(o => { if (o.isMesh && o.material && o.material.uniforms && o.material.uniforms.sun && !world.sky) world.sky = o; if (o.isDirectionalLight && !world.sunLight) world.sunLight = o; if (o.isHemisphereLight && !world.hemi) world.hemi = o; });
  // שעון: ברירת מחדל = השעה האמיתית בישראל; ?t=HH:MM לשעה קבועה; בבדיקות (?auto) שעת זהב
  world.clock.date = new Date(G.ENV.date); world.clock.rate = 1;
  const t = qs.get('t'), d = qs.get('d');
  world.shabbat.setting = LS.get('shabbat', 'auto');
  if (d) setTime({ ymd: d });
  if (t === 'now') setTime({ preset: 'now' }); else if (t && /^\d{1,2}:\d{2}$/.test(t)) { const [a, b] = t.split(':').map(Number); setTime({ min: a * 60 + b }); } else setTime({ preset: qs.has('auto') ? 'golden' : 'now' });   // שעון אמיתי כברירת מחדל (משוב: "צריך לכוון כמו שעון"); ?t=17:30 לשעה קבועה, ?auto לבדיקות
  // מזג אוויר פתיחה: בריזת ים, מעט עננים, אובך קל
  setWeather({ windSpeed: 4.5, windFrom: 285, gust: 1.4, cloud: 0.22, rain: 0, aqi: 45 });
  setTier(qs.get('tier') || LS.get('tier', 'auto'), true);
  if (world.gfx.requested === 'webgpu') notice('WebGPU עדיין במעבדה — העולם רץ ברנדרר הקלאסי (' + (world.gfx.webgpuAvailable ? 'הדפדפן תומך ב-WebGPU' : 'אין WebGPU בדפדפן') + ')', { kind: 'info', ms: 4000 });
  READY = true; refreshModes();
  [...P.values()].sort((a, b) => (a.def.order || 50) - (b.def.order || 50)).forEach(r => initPlugin(r));
  bus.emit('ready', world);
  // ?auto – המשחק מתחיל לבד: מחכים לו
  const ws = setInterval(() => { if (G.S.started) { clearInterval(ws); if (!world.stats.startMs) onStarted(qs.get('view') === 'eye' ? 'dev' : qs.get('mode') || (qs.get('view') === 'char' ? 'walk' : LS.get('mode', 'walk'))); } }, 50);
}
// ---------------------------------------------------------------- השכונה שלי: רחוב הארז, אשדוד (מסגרת האריחים של גדוד 5!)
// אמצע מקטע הרחוב (164765.1,634196.2)→(164737.0,634132.0). ITM אמיתי = מסגרת הדגימה + (1507.82 מז׳, 757.76 צפ׳) – לא מערבבים.
const HOME = { E: 164751, N: 634164, side: 5.5, yaw: Math.atan2(164737.0 - 164765.1, -(634132.0 - 634196.2)), r: 500, name: 'רחוב הארז' };
world.home = HOME;
function placeAt(E, N, yaw, sidewalk) {
  const G = world.G27, W = G.W, S = G.S; let p = W.toScene(E, N);
  if (sidewalk) { const nx = Math.cos(yaw), nz = -Math.sin(yaw); p = { x: p.x + nx * HOME.side, z: p.z + nz * HOME.side }; }
  const c = W.collide(p.x, p.z, 0.4, 0, 2); S.p.set(c.x, W.floorAt(c.x, c.z, Math.max(W.H(c.x, c.z), 0) + 400), c.z);
  if (S.p.y > Math.max(W.H(c.x, c.z), 0) + 2) S.p.y = Math.max(W.H(c.x, c.z), 0);   // לא על גג
  S.heading = yaw; S.cam.yaw = yaw; S.vy = 0; S.grounded = true;
  // הרכב חונה לצד המדרכה
  const cx = c.x - Math.cos(yaw) * 3.2 + Math.sin(yaw) * 3, cz = c.z + Math.sin(yaw) * 3.2 + Math.cos(yaw) * 3; const r = W.collide(cx, cz, 1.6, 0, 1.5);
  Object.assign(S.car, { x: r.x, z: r.z, y: Math.max(W.H(r.x, r.z), 0), h: yaw, v: 0 });
  world.showcase = { x: c.x, z: c.z, r: HOME.r };
  if (G.W.update) G.W.update(c.x, c.z, 40);
}
function flyCam(a, b, look, dur) { INTRO.on = true; INTRO.t = 0; INTRO.dur = dur || 1; INTRO.a = a.clone(); INTRO.b = b.clone(); INTRO.look = look.clone(); INTRO.arc = 0; INTRO.t0 = performance.now(); }
// קישור עמוק אחד: ?view=eye|char&at=E,N,מרחק[&mode=...][&b=...]
let urlT = 0;
function syncURL() { clearTimeout(urlT); urlT = setTimeout(() => { if (!world.data || !world.stats.startMs) return; try {
  const u = new URL(location.href), p = world.player.pos, it = world.coords.toITM(p.x, p.z), eye = curId === 'dev';
  u.searchParams.set('view', eye ? 'eye' : 'char'); u.searchParams.set('at', Math.round(it.E) + ',' + Math.round(it.N) + (eye && world.eyeDist ? ',' + Math.round(world.eyeDist) : ''));
  if (!eye && curId !== 'walk') u.searchParams.set('mode', curId); else u.searchParams.delete('mode');
  if (world.player.selected) u.searchParams.set('b', world.player.selected.id); u.searchParams.delete('auto');
  history.replaceState(null, '', u.toString()); } catch (e) { /* */ } }, 300); }
function goHome() {
  const G = world.G27; if (G.S.inside) G.exitInterior(); setMode('walk', curId !== 'walk');
  const cam = world.camera.position.clone(); placeAt(HOME.E, HOME.N, HOME.yaw, true);
  const p = playerPos(); INTRO.on = true; INTRO.t = 0; INTRO.dur = 3; INTRO.a = cam.y < 60 ? cam.clone().setY(80) : cam; INTRO.b = new THREE.Vector3(p.x - Math.sin(HOME.yaw) * 6, p.y + 3, p.z - Math.cos(HOME.yaw) * 6); INTRO.look = new THREE.Vector3(p.x, p.y + 1.5, p.z);
  notice('🏠 ' + HOME.name + ', אשדוד', { kind: 'info', ms: 2200 });
}
function onStarted(mode) {
  const G = world.G27; if (world.stats.startMs) return; world.stats.startMs = performance.now() - T0;
  const at = qs.get('at'); let placed = false;
  if (at) { const [E, N] = at.split(',').map(Number); if (E && N) { placeAt(E, N, G.S.heading); placed = true; } }
  if (!placed && !qs.has('spawn')) placeAt(HOME.E, HOME.N, HOME.yaw, true);
  const go = () => { const ok = mode && mode !== 'walk' ? setMode(mode, true) : true; if (!ok) setMode('walk', true);
    const bid = qs.get('b'); if (bid) { const b = world.data.buildingById(bid); if (b) { world.player.selected = b; G.showCard(b); } }
    if (!/[?&](auto|nointro)/.test(location.search) && curId !== 'dev') startIntro(); bus.emit('started', { mode: curId }); };
  // מצב תוסף (יזם) צריך שהתוסף יהיה מוכן
  if (mode && !GAME_MODES[mode]) { const t0 = performance.now(); const w = setInterval(() => { const m = MODES.get(mode); if ((m && m.available) || performance.now() - t0 > 8000) { clearInterval(w); go(); } }, 50); } else go();
}
const wait = setInterval(() => { if (window.G27 && window.G27.renderer) { clearInterval(wait); try { attach(); } catch (e) { console.error('[yzw] attach failed', e); } } }, 20);

function frameFault(e) { faults.push({ id: 'game', phase: 'פריים', msg: e.message, t: Math.round(performance.now() - T0) }); if (!frameFault.shown) { frameFault.shown = true; notice('⚠ שגיאה בליבת המשחק נבלמה — הציור והטעינה ממשיכים', { kind: 'warn' }); } }
window.YZW = { version: VERSION, frameFault, world, bus, register, enable, setMode, setTier, setTime, setWeather, setShabbat, notice, faults, openSheet, closeSheet,
  plugins: () => [...P.values()].map(r => ({ id: r.id, name: r.def.name, dept: r.def.dept, state: r.state, err: r.err, ms: +r.ms.toFixed(3), initMs: Math.round(r.initMs) })),
  modes: () => [...MODES.values()].map(m => ({ id: m.id, name: m.name, available: m.available, kind: m.kind, why: m.why })),
  mode: () => curId, flyCam, syncURL, goHome, placeAt, readInput, diag: diagText, countTris, TIERS, get ready() { return READY; }, get paused() { return paused; }, intro: INTRO };
})();
