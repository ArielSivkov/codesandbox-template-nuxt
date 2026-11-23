/* present/app.js — חיווט ממשק ההדגמה (עברית, RTL) מעל ESHPresent + ESHStory. */
(async function () {
  'use strict';
  const G = window.PGEO, $ = id => document.getElementById(id);
  const DEF = { site: 'w552921285', floors: 14, floorHeight: 3.1, groundFloorHeight: 4.5, setbacks: [{ fromFloor: 11, inset: 2 }], date: '2026-12-21', hour: 12, view: 'after', swipe: 0.5 };
  const sc = Object.assign({}, DEF, G.decodeScenario(location.hash));
  const toast = (t, ms = 2200) => { const el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', ms); };
  const f1 = n => n == null ? '—' : (+n).toFixed(1).replace(/\.0$/, ''), fmt = n => n == null ? '—' : Math.round(n).toLocaleString('he-IL');
  const hhmm = h => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');

  let P;
  try {
    P = await ESHPresent.createPresenter({ canvas: $('cv'), base: 'data/', siteId: DEF.site, siteTile: '165_631', radius_m: 2600, labelLayer: $('labels'), preserveDrawingBuffer: /[?&]shot=1/.test(location.search) });
  } catch (e) { $('busy').innerHTML = '<div>שגיאה בטעינה: ' + String(e.message || e).replace(/</g, '&lt;') + '</div>'; throw e; }
  window.P = P;
  if (sc.site !== DEF.site && P.world.byId.has(sc.site)) await P.setSite(sc.site);
  P.state.date = sc.date; P.state.hour = sc.hour; P.setSun(sc.date, sc.hour);
  if (sc.window) P.state.window = sc.window;

  const specFromSc = () => sc.model ? { type: 'gltf', url: sc.model, floors: sc.modelFloors, grossArea: sc.modelGrossArea, rotation: sc.rotation || 0 }
    : { type: 'massing', footprint: sc.footprint || 'site', floors: sc.floors, floorHeight: sc.floorHeight, groundFloorHeight: sc.groundFloorHeight, setbacks: sc.setbacks || [], rotation: sc.rotation || 0 };
  await P.setProposal(specFromSc());
  P.setView(sc.view, sc.swipe);
  $('busy').remove();

  // ---------- כתובת (hash) – תמיד משקפת את התרחיש
  let story = null, storyOpen = false;
  function currentScenario(extra) {
    const sp = P.state.proposal.spec, s = { site: P.state.site };
    if (sp.type === 'gltf') Object.assign(s, { model: sp.url, modelFloors: sp.floors, modelGrossArea: sp.grossArea, rotation: sp.rotation || undefined });
    else Object.assign(s, { footprint: Array.isArray(sp.footprint) ? sp.footprint : undefined, floors: sp.floors, floorHeight: sp.floorHeight, groundFloorHeight: sp.groundFloorHeight, setbacks: sp.setbacks, rotation: sp.rotation || undefined });
    Object.assign(s, { date: P.state.date, hour: P.state.hour, view: P.state.view, swipe: P.state.view === 'swipe' ? +P.state.swipe.toFixed(2) : undefined, window: P.state.window });
    if (storyOpen && story.index >= 0) s.shot = story.index;
    return Object.assign(s, extra || {});
  }
  let hashT = 0;
  function syncHash() { clearTimeout(hashT); hashT = setTimeout(() => { const h = '#' + G.encodeScenario(currentScenario()); history.replaceState(null, '', h); $('link').value = location.href; }, 250); }
  const linkFor = extra => location.href.split('#')[0] + '#' + G.encodeScenario(currentScenario(extra));

  // ---------- תצוגה
  const vseg = $('vseg');
  function reflectView() {
    for (const b of vseg.children) b.classList.toggle('on', b.dataset.v === P.state.view);
    const sw = P.state.view === 'swipe'; $('swipe').classList.toggle('hidden', !sw); $('tagA').classList.toggle('hidden', !sw); $('tagB').classList.toggle('hidden', !sw);
  }
  vseg.addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; P.setView(v, v === 'swipe' ? 0.5 : undefined); });
  P.on('view', () => { reflectView(); syncHash(); }); reflectView();
  const kn = document.querySelector('#swipe .kn');
  kn.addEventListener('pointerdown', e => { kn.setPointerCapture(e.pointerId); kn.dragging = true; e.stopPropagation(); if (story) story.pause(); });
  kn.addEventListener('pointermove', e => { if (kn.dragging) P.setView('swipe', e.clientX / innerWidth); });
  kn.addEventListener('pointerup', () => kn.dragging = false);
  P.on('frame', () => { if (P.state.view === 'swipe') $('swipe').style.left = (P.state.swipe * 100).toFixed(2) + '%'; });

  // ---------- לוח: לשוניות ומזעור
  $('tabs').addEventListener('click', e => { const t = e.target.dataset.t; if (!t) return;
    for (const b of $('tabs').querySelectorAll('[data-t]')) b.classList.toggle('on', b.dataset.t === t);
    for (const s of $('pbody').children) s.classList.toggle('hidden', s.dataset.s !== t);
    if ($('panel').classList.contains('min')) toggleMin(false);
    if (t === 'anal') refreshMetrics(); if (t === 'share') $('link').value = location.href; updateInsets(); });
  function toggleMin(force) { const m = force ?? !$('panel').classList.contains('min'); $('panel').classList.toggle('min', m); document.body.classList.toggle('pmin', m); $('bMin').textContent = m ? '▴' : '▾'; updateInsets(); }
  // הסצנה "מתרכזת" בשטח הגלוי: מעל הגיליון (לאורך) או משמאל ללוח (לרוחב)
  function updateInsets() { requestAnimationFrame(() => {
    const portrait = innerHeight >= innerWidth, pr = $('panel').getBoundingClientRect(), st = $('story').getBoundingClientRect();
    if (storyOpen) P.setInsets({ bottom: innerHeight * (portrait ? 0.2 : 0.32) });   // קבוע – כדי שהתמונה לא תקפוץ כשאורך הכיתוב משתנה
    else if (portrait) P.setInsets({ bottom: $('panel').classList.contains('min') ? 0 : pr.height });
    else P.setInsets({ right: $('panel').classList.contains('min') ? 0 : pr.width + 8 });
  }); }
  addEventListener('resize', updateInsets);
  $('bMin').onclick = () => toggleMin();
  if (innerHeight < 500 || innerWidth < 500) toggleMin(true); else updateInsets();

  // ---------- פרויקט
  const kseg = $('kseg');
  function reflectKind() { const g = P.state.proposal.kind === 'gltf'; for (const b of kseg.children) b.classList.toggle('on', (b.dataset.k === 'gltf') === g); $('massingCtl').classList.toggle('hidden', g); $('gltfCtl').classList.toggle('hidden', !g); }
  function fillMassingInputs() { const sp = P.state.proposal.spec; if (sp.type !== 'massing') return;
    $('iFl').value = sp.floors; $('vFl').textContent = sp.floors; $('iFh').value = sp.floorHeight; $('vFh').textContent = sp.floorHeight; $('iGf').value = sp.groundFloorHeight; $('vGf').textContent = sp.groundFloorHeight;
    const sb = (sp.setbacks || [])[0]; $('iSbF').value = sb ? sb.fromFloor : 0; $('iSbI').value = sb ? sb.inset : 0; $('iRot').value = sp.rotation || 0; $('vRot').textContent = (sp.rotation || 0) + '°'; }
  let rebuildT = 0;
  function scheduleRebuild() { clearTimeout(rebuildT); rebuildT = setTimeout(async () => {
    const sbF = +$('iSbF').value, sbI = +$('iSbI').value;
    const prev = P.state.proposal.spec;
    await P.setProposal({ type: 'massing', footprint: prev.type === 'massing' ? prev.footprint : 'site', floors: +$('iFl').value, floorHeight: +$('iFh').value, groundFloorHeight: +$('iGf').value, setbacks: sbF > 1 && sbI > 0 ? [{ fromFloor: sbF, inset: sbI }] : [], rotation: +$('iRot').value });
  }, 120); }
  for (const [i, v, sfx] of [['iFl', 'vFl', ''], ['iFh', 'vFh', ''], ['iGf', 'vGf', ''], ['iRot', 'vRot', '°']]) $(i).addEventListener('input', () => { $(v).textContent = $(i).value + sfx; scheduleRebuild(); });
  $('iSbF').addEventListener('change', scheduleRebuild); $('iSbI').addEventListener('change', scheduleRebuild);
  $('iRotG').addEventListener('input', () => { $('vRotG').textContent = $('iRotG').value + '°'; clearTimeout(rebuildT); rebuildT = setTimeout(() => P.setProposal(Object.assign({}, P.state.proposal.spec, { rotation: +$('iRotG').value })), 150); });
  kseg.addEventListener('click', async e => { const k = e.target.dataset.k; if (!k || k === P.state.proposal.kind) return;
    if (k === 'gltf') { toast('טוען מודל glTF…'); await P.setProposal({ type: 'gltf', url: 'models/tower.gltf', rotation: +$('iRotG').value }); }
    else await P.setProposal({ type: 'massing', footprint: 'site', floors: +$('iFl').value, floorHeight: +$('iFh').value, groundFloorHeight: +$('iGf').value, setbacks: +$('iSbI').value > 0 ? [{ fromFloor: +$('iSbF').value, inset: +$('iSbI').value }] : [], rotation: +$('iRot').value }); });

  function siteInfo() { const b = P.world.byId.get(P.state.site); $('siteInfo').innerHTML = `מזהה OSM <span class="ltr">${b.id}</span> · תכסית ${fmt(b.area)} מ"ר · כ-${b.floors} קומות (${b.floorsRange[0]}–${b.floorsRange[1]}) · גובה ~${f1(b.height)} מ' ±${f1(b.sigma)} <span class="tag">${b.conf}</span>`; }
  P.on('site', siteInfo); siteInfo();

  // תווית מעל הפרויקט
  function updatePropLabel() { const pr = P.state.proposal; P.setLabel('prop', [pr.center[0], pr.center[1], pr.baseZ + pr.height + 2], `${pr.floors ? pr.floors + ' קומות · ' : ''}${f1(pr.height)} מ'`); const l = document.querySelector('.p-label'); if (l) l.classList.add('acc'); }
  P.on('proposal', () => { updatePropLabel(); reflectKind(); fillMassingInputs(); refreshMetrics(); fillWinSelect(); syncHash(); if ($('shRes').dataset.on) runShadow(); });
  updatePropLabel(); reflectKind(); fillMassingInputs();

  // ---------- ניתוחים
  function refreshMetrics() {
    const m = P.metrics(); if (!m) return;
    $('kpis').innerHTML = [
      [m.proposal.floors ?? '?', 'קומות מוצעות'], [f1(m.proposal.height) + ' מ\'', 'גובה מעל הקרקע'], [fmt(m.proposal.grossArea) + ' מ"ר', 'שטח ברוטו (קומות×תכסית)'],
      [m.added ? fmt(m.added.gross) : '—', 'תוספת משוערת, מ"ר'], [fmt(m.proposal.footprintArea), 'תכסית מוצעת, מ"ר'], [m.heightRatio ? '×' + m.heightRatio : '—', 'מול חציון השכנים'],
    ].map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('') +
      (m.added ? `<div class="note" style="grid-column:1/-1">תוספת בטווח ${fmt(m.added.range[0])}–${fmt(m.added.range[1])} מ"ר, לפי טווח הקומות המוערך של הקיים (${m.existing.floorsRange[0]}–${m.existing.floorsRange[1]}). ברוטו גאומטרי – לא "שטח עיקרי" לפי תקנות.</div>` : '<div class="note" style="grid-column:1/-1">למודל glTF בלי נתוני קומות/שטח – השטח לא מחושב (לא מנחשים).</div>');
    const mx = Math.max(m.proposal.height, m.neighbors.maxH || 0, m.existing.height + m.existing.sigma) * 1.05;
    const bar = (lbl, h, cls, sig) => `<div class="bar"><span>${lbl}</span><i class="${cls || ''}" style="width:${(h / mx * 62).toFixed(1)}%">${sig ? `<em style="right:${((h - sig) / h * 100).toFixed(1)}%;left:-${(sig / h * 100).toFixed(1)}%"></em>` : ''}</i><b>${f1(h)} מ'${sig ? ' ±' + f1(sig) : ''}</b></div>`;
    $('bars').innerHTML = bar('המוצע', m.proposal.height, 'p') + bar('הקיים', m.existing.height, '', m.existing.sigma) + (m.neighbors.medianH != null ? bar('חציון שכנים', m.neighbors.medianH, '', m.neighbors.sigmaTypical) + bar('הגבוה בסביבה', m.neighbors.maxH, '', m.neighbors.sigmaTypical) : '') +
      `<p class="note">${m.neighbors.count} בניינים ברדיוס ${m.neighbors.radius} מ'. גובהי הקיים – הערכה לפי כלל (רמת ביטחון "${m.existing.conf}").</p>`;
  }
  const HEATC = ['#e7e2d9', '#f9db73', '#f39e4d', '#db4d40'];
  const heatIdx = h => h <= 0.001 ? 0 : h <= 1 ? 1 : h <= 2 ? 2 : 3;
  function runShadow() {
    $('shRes').dataset.on = 1; $('shRes').innerHTML = '<p class="note">מחשב…</p>';
    setTimeout(() => {
      const a = P.analyzeShadows({ date: P.state.date }); if (!a) return;
      const rows = a.per.filter(p => p.lostMaxH > 0 || p.roofLostH > 0).slice(0, 8);
      $('shRes').innerHTML = `<div class="kpis"><div class="kpi"><b>${a.affected1h}</b><span>בניינים עם ≥1 שעת צל נוספת</span></div><div class="kpi"><b>${a.affectedAny}</b><span>בניינים עם צל נוסף כלשהו</span></div><div class="kpi"><b>${a.roofAffected}</b><span>גגות עם צל נוסף</span></div></div>
        <div class="legend"><span><i style="background:${HEATC[1]}"></i>עד שעה</span><span><i style="background:${HEATC[2]}"></i>1–2 שעות</span><span><i style="background:${HEATC[3]}"></i>מעל 2</span></div>
        <ul class="list">${rows.map(p => `<li data-id="${p.id}"><i class="sw" style="background:${HEATC[heatIdx(Math.max(p.lostMaxH, p.roofLostH))]}"></i><span class="t">${p.dist} מ' מהפרויקט · חזית: עד ${f1(p.lostMaxH)} ש' (ממוצע ${f1(p.lostMeanH)}) · גג: ${f1(p.roofLostH)} ש'</span></li>`).join('') || '<li>אין בניינים שמאבדים שמש בטווח</li>'}</ul>
        <p class="note">${a.receivers} בניינים ברדיוס ${a.radius} מ', דגימה כל 4 מ' בחזית וכל 3 מ' בגובה, כל 30 דק'. שיטה: ${a.method}. "צל נוסף" = שעות שבהן הנקודה הייתה בשמש היום ותהיה בצל אחרי (כולל הסרת הבניין הקיים). ${a.ms} מ"ש.</p>
        <div class="warn">גובהי השכנים הם הערכה (±6 מ') – התוצאה רגישה לכך. למסמך הצללה רשמי יש להזין גבהים מדודים.</div>`;
      $('cHeat').checked = true; P.setHeat(true); fillWinSelect();
    }, 30);
  }
  $('bShadow').onclick = runShadow;
  $('bSens').onclick = () => { $('sensRes').textContent = 'מחשב 3 תרחישים…'; setTimeout(() => {
    const r = [-1, 0, 1].map(k => P.analyzeShadows({ date: P.state.date, sigmaK: k, dry: true }));
    $('sensRes').textContent = `בניינים עם ≥1 שעת צל נוספת: ${r[0].affected1h} (שכנים נמוכים ב-σ) · ${r[1].affected1h} (הערכה) · ${r[2].affected1h} (גבוהים ב-σ). ${r[0].ms + r[1].ms + r[2].ms} מ"ש.`; }, 30); };
  $('shRes').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) { P.select(li.dataset.id); } });
  $('cHeat').onchange = () => { if ($('cHeat').checked && !P.lastAnalysis) runShadow(); P.setHeat($('cHeat').checked); };
  $('cFan').onchange = () => P.setFan($('cFan').checked);
  $('iDate').value = P.state.date; $('iHour').value = P.state.hour; $('vHour').textContent = hhmm(P.state.hour);
  $('iDate').onchange = () => { P.setSun($('iDate').value, +$('iHour').value); P.setFan(P.state.fan); if ($('shRes').dataset.on) runShadow(); syncHash(); };
  $('iHour').oninput = () => { $('vHour').textContent = hhmm(+$('iHour').value); P.setSun(P.state.date, +$('iHour').value); syncHash(); updateInsets(); };
  $('bSol').onclick = () => { $('iDate').value = '2026-12-21'; $('iDate').onchange(); };
  $('bEq').onclick = () => { $('iDate').value = '2027-03-21'; $('iDate').onchange(); };

  function fillWinSelect() {
    const pr = P.state.proposal, sel = $('iWinB'), cur = sel.value || (P.state.window && P.state.window.building);
    const an = P.lastAnalysis, lost = new Map(an ? an.per.map(p => [p.id, p.lostMaxH]) : []);
    const nb = P.world.near(pr.center[0], pr.center[1], 100).filter(b => b.id !== P.state.site).map(b => ({ b, d: Math.hypot(b.cx - pr.center[0], b.cy - pr.center[1]) })).sort((x, y) => (lost.get(y.b.id) || 0) - (lost.get(x.b.id) || 0) || x.d - y.d).slice(0, 14);
    sel.innerHTML = nb.map(({ b, d }) => `<option value="${b.id}">${Math.round(d)} מ' · ${f1(b.height)} מ' גובה${lost.get(b.id) ? ' · צל +' + f1(lost.get(b.id)) + ' ש\'' : ''}</option>`).join('');
    if (cur && nb.some(x => x.b.id === cur)) sel.value = cur;
  }
  fillWinSelect();
  async function windowViewUI(o) {
    const v = P.windowView(o); if (!v) return;
    P.state.window = o.building === 'proposal' ? P.state.window : { building: o.building, floor: o.floor }; syncHash();
    if (window.matchMedia('(orientation:portrait)').matches) toggleMin(true);
    P.setFov(72); await P.animate({ to: { pos: v.eye, target: v.target }, dur: 2.2 });
    $('winRes').textContent = o.building === 'proposal' ? `מבט מקומה ${o.floor} של הפרויקט, גובה עיניים ${f1(v.eye[2])} מ' מעל פני הים.` :
      `קומה ${o.floor}: החזית המוצעת במרחק ${f1(v.distance)} מ', מתנשאת עד ${f1(v.topAngleDeg)}° מעל קו האופק (היום ${f1(v.existingTopAngleDeg)}°). גובה קומה לשכן הונח 3 מ'.`;
  }
  $('bWin').onclick = () => windowViewUI({ building: $('iWinB').value, floor: +$('iWinF').value });
  $('bTopView').onclick = () => windowViewUI({ building: 'proposal', floor: P.state.proposal.floors || 1, facing: 270 });
  const overview = () => { const pr = P.state.proposal; P.setFov(50); return P.animate({ to: { pos: [pr.center[0] + 150, pr.center[1] - 230, pr.baseZ + 160], target: [pr.center[0], pr.center[1], pr.baseZ + pr.height * 0.35] }, dur: 1.8 }); };
  $('bReset').onclick = overview;

  // ---------- כרטיס בחירה
  P.on('select', b => {
    const c = $('card'); if (!b || storyOpen) { c.classList.add('hidden'); return; }
    if (b.id === 'proposal') { const m = P.metrics(); c.innerHTML = `<h3>הפרויקט המוצע <button class="btn sm x" data-a="x">✕</button></h3>${m.proposal.floors ?? '?'} קומות · ${f1(m.proposal.height)} מ' · ${fmt(m.proposal.grossArea)} מ"ר ברוטו`; c.classList.remove('hidden'); return; }
    const pr = P.state.proposal, d = Math.round(Math.hypot(b.cx - pr.center[0], b.cy - pr.center[1]));
    const a = P.lastAnalysis && P.lastAnalysis.per.find(p => p.id === b.id);
    c.innerHTML = `<h3>${b.id === P.state.site ? 'הבניין הקיים (מוחלף)' : 'בניין שכן'} <span class="tag">${b.conf}</span><button class="btn sm x" data-a="x">✕</button></h3>
      גובה ~${f1(b.height)} מ' ±${f1(b.sigma)} · כ-${b.floors} קומות (${b.floorsRange[0]}–${b.floorsRange[1]}) · תכסית ${fmt(b.area)} מ"ר · ${d} מ' מהפרויקט
      ${a ? `<br>צל נוסף ב-${P.lastAnalysis.date.split('-').reverse().join('.')}: חזית עד ${f1(a.lostMaxH)} ש', גג ${f1(a.roofLostH)} ש'` : ''}
      <div class="acts">${b.id !== P.state.site ? `<button class="btn sm" data-a="win">מבט מהחלון שלו</button><button class="btn sm" data-a="rep">החלף בבניין המוצע</button>` : ''}</div>`;
    c.classList.remove('hidden'); c.dataset.id = b.id;
  });
  $('card').addEventListener('click', async e => { const a = e.target.dataset.a; if (!a) return; const id = $('card').dataset.id;
    if (a === 'x') { P.select(null); }
    if (a === 'win') { $('iWinB').value = id; if ($('iWinB').value !== id) { const o = document.createElement('option'); o.value = id; o.textContent = 'נבחר'; $('iWinB').appendChild(o); $('iWinB').value = id; } windowViewUI({ building: id, floor: +$('iWinF').value }); }
    if (a === 'rep') { P.select(null); P.lastAnalysis = null; $('shRes').innerHTML = ''; delete $('shRes').dataset.on; await P.setSite(id); toast('הפרויקט הועבר לבניין שנבחר'); syncHash(); } });

  // ---------- מצגת
  const dots = $('dots');
  story = ESHStory.createStory(P, {
    onShot(i, sh, text) { $('sTitle').textContent = sh.title; $('sNum').textContent = `${i + 1}/${story.shots.length}`; $('sText').textContent = text;
      dots.innerHTML = story.shots.map((s, k) => `<i data-k="${k}" class="${k === i ? 'on' : ''}" title="${s.title}"></i>`).join(''); syncHash(); },
    onState(pl) { $('sPlay').textContent = pl ? '❚❚' : '▶'; },
    onEnd() { toast('סוף המצגת'); },
  });
  window.story = story;
  function openStory(i = 0, play = true) { storyOpen = true; document.body.classList.add('story'); $('story').classList.remove('hidden'); $('card').classList.add('hidden');
    updateInsets(); if (play) story.play(i); else story.go(i); }
  function closeStory() { storyOpen = false; story.stop(); document.body.classList.remove('story'); $('story').classList.add('hidden'); P.setFan($('cFan').checked); P.setHeat($('cHeat').checked); P.setSun(P.state.date, +$('iHour').value); syncHash(); updateInsets(); }
  $('bStory').onclick = () => openStory(0, true);
  $('sClose').onclick = closeStory;
  $('sPlay').onclick = () => story.playing ? story.pause() : story.play();
  $('sNext').onclick = () => story.next(); $('sPrev').onclick = () => story.prev();
  dots.addEventListener('click', e => { const k = e.target.dataset.k; if (k !== undefined) { story.pause(); story.go(+k); } });
  $('sShare').onclick = () => copy(linkFor({ shot: story.index }));
  P.on('interact', () => { if (storyOpen && story.playing) { story.pause(); toast('המצגת הושהתה – ▶ להמשך'); } });
  document.addEventListener('keydown', e => { if (!storyOpen) return; if (e.key === 'ArrowLeft') story.next(); if (e.key === 'ArrowRight') story.prev(); if (e.key === ' ') { e.preventDefault(); $('sPlay').onclick(); } if (e.key === 'Escape') closeStory(); });

  // ---------- שיתוף
  async function copy(t) { try { await navigator.clipboard.writeText(t); toast('הקישור הועתק'); } catch (e) { $('link').value = t; $('link').select(); toast('סמנו והעתיקו את הקישור מהתיבה'); } }
  $('bCopy').onclick = () => copy(location.href.split('#')[0] + '#' + G.encodeScenario(currentScenario()));
  $('bCopyPlay').onclick = () => copy(linkFor({ shot: 0, play: true }));

  // ---------- פתיחה מקישור
  syncHash();
  if (sc.shot !== undefined) { if (sc.play) openStory(sc.shot, true); else openStory(sc.shot, false); }
  else overview();
  window.__ready = true;
})();
