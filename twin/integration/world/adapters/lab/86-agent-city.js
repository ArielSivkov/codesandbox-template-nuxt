/* עיר הסוכנים v0 (מעבדת הפנים, 24.11.2026) – 100 סוכנים (50/50), לכל אחד חלקה (בניין אמיתי), הולכים ברשת הרחובות
 * לפי שעון העולם ובודקים תמונות (34 מההליכה של אריאל + 53 מקומונס). דטרמיניסטי: אותו תאריך ושעה → אותו מצב
 * אצל כל צופה, וזהה לדף הצפייה https://claude.ai/artifact/BQxNpx6Tbk7CQW3P7yHZTX (אותו city.json, אותם זרעים).
 * נתונים: mods/agent-city/city.json (נבנה ע"י esh27-core lab/interior/city/build_city.py מאריחי twin-world, קריאה בלבד).
 * כבוי: ?agents=0. מה עוד לא אמיתי: הסוכנים לא רואים את התמונות; ההתאמה לפי מיקום ושם רחוב, חושבה מראש.
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('agents') === '0') return;
  const TZ = 'Asia/Jerusalem', SPEED = 1.3, DAY_START = 7 * 60, SLOT = 75, SLOTS = 8, DWELL = 15;
  const NM = ['אבי','בועז','גדי','דוד','הלל','זיו','חן','טל','יואב','כרמי','ליאור','מאיר','נדב','עמית','פז','צחי','רון','שי','תום','אורי','ברק','גל','דניאל','הדר','זאב','חיים','יונתן','כפיר','לביא','משה','נועם','עידו','פלג','צור','רפאל','שגיא','תמיר','אלון','בני','גיא','דור','יאיר','ליאם','מתן','נתנאל','עוז','רועי','שחר','יהלי','אסף'];
  const NF = ['אביגיל','בתיה','גאיה','דנה','הילה','ורד','זהבה','חנה','טליה','יעל','כנרת','לאה','מיכל','נועה','עדי','פנינה','צופיה','רחל','שירה','תמר','אורית','ברכה','גלית','דבורה','הדס','זוהר','חוה','טובה','יפעת','כרמל','לירון','מרים','נטע','עינב','פזית','קרן','רוני','שני','תהל','אילה','בת שבע','גילה','דקלה','הודיה','יערה','ליה','מעיין','נגה','אסתר','שקד'];
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const fmtIL = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function il(d) { const p = fmtIL.formatToParts(d), g = k => +p.find(x => x.type === k).value;
    return { date: `${g('year')}-${String(g('month')).padStart(2, '0')}-${String(g('day')).padStart(2, '0')}`, min: g('hour') * 60 + g('minute') + g('second') / 60 }; }
  const A = { D: null, N: null, adj: null, jobs: [], agents: [], date: '', mesh: null, beacons: null, rings: null, out: 0, done: 0, cache: new Map(), m: new THREE.Matrix4(), ok: false };
  function graph() { const N = A.N, n = N.length, off = new Int32Array(n + 1);
    for (const [u, v] of A.D.e) { off[u + 1]++; off[v + 1]++; } for (let i = 0; i < n; i++) off[i + 1] += off[i];
    const to = new Int32Array(off[n]), w = new Float32Array(off[n]), f = off.slice(0, n);
    for (const [u, v] of A.D.e) { const d = Math.hypot(N[u][0] - N[v][0], N[u][1] - N[v][1]); to[f[u]] = v; w[f[u]++] = d; to[f[v]] = u; w[f[v]++] = d; }
    A.adj = { off, to, w }; }
  function path(a, b) { const key = a + '>' + b; if (A.cache.has(key)) return A.cache.get(key);
    const n = A.N.length, dist = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), h = [[0, a]], adj = A.adj; dist[a] = 0;
    while (h.length) { let i = 0; const top = h[0], last = h.pop();
      if (h.length) { h[0] = last; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[i], h[m]] = [h[m], h[i]]; i = m; } }
      const [du, u] = top; if (du > dist[u]) continue; if (u === b) break;
      for (let k = adj.off[u]; k < adj.off[u + 1]; k++) { const v = adj.to[k], nd = du + adj.w[k]; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; h.push([nd, v]); let j = h.length - 1; while (j > 0) { const p = (j - 1) >> 1; if (h[p][0] <= h[j][0]) break; [h[p], h[j]] = [h[j], h[p]]; j = p; } } } }
    const pts = []; for (let u = b; u !== -1; u = prev[u]) pts.push(u); pts.reverse();
    const res = { nodes: pts[0] === a ? pts : [a, b], len: dist[b] === Infinity ? 0 : dist[b] };
    if (A.cache.size > 4000) A.cache.clear(); A.cache.set(key, res); return res; }
  function along(p, d) { const ns = p.nodes, N = A.N; if (ns.length < 2) return [N[ns[0]], 0];
    for (let i = 1; i < ns.length; i++) { const a = N[ns[i - 1]], b = N[ns[i]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= L) { const t = L ? d / L : 0; return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], Math.atan2(b[0] - a[0], b[1] - a[1])]; } d -= L; }
    return [N[ns[ns.length - 1]], 0]; }
  function nearest(x, y) { let best = 0, bd = Infinity; for (let i = 0; i < A.N.length; i++) { const d = (A.N[i][0] - x) ** 2 + (A.N[i][1] - y) ** 2; if (d < bd) { bd = d; best = i; } } return best; }
  function makeAgents() { const r = rng(27), B = A.D.b, homes = B.map((b, i) => i).filter(i => B[i][2] >= 2 && B[i][2] <= 8);
    for (let k = 0; k < 100; k++) { const f = k % 2 === 1, bi = homes[Math.floor(r() * homes.length)], b = B[bi];
      A.agents.push({ k, f, name: (f ? NF : NM)[k >> 1], plot: bi, home: nearest(b[0], b[1]) }); } }
  function planDay(date) { const r = rng(hash(date)), order = A.jobs.map((j, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const a of A.agents) a.day = []; let c = 0;
    for (let s = 0; s < SLOTS; s++) for (const a of A.agents) { if (r() < 0.55) a.day.push(order[c++ % order.length]); }
    for (const a of A.agents) a.start = DAY_START + Math.floor(rng(hash(date + a.k))() * 60); }
  function state(a, m) { const t = m - a.start, idx = Math.floor(t / SLOT), J = A.jobs;
    if (t < 0 || idx >= a.day.length) {
      if (t >= 0 && a.day.length) { const p = path(J[a.day[a.day.length - 1]].node, a.home), el = (t - a.day.length * SLOT) * 60 * SPEED; if (el < p.len) { const [q, hd] = along(p, el); return { q, hd, out: 1, done: a.day.length }; } }
      return { q: A.N[a.home], hd: 0, out: 0, done: t < 0 ? 0 : a.day.length }; }
    const job = J[a.day[idx]], from = idx === 0 ? a.home : J[a.day[idx - 1]].node, p = path(from, job.node), el = (t - idx * SLOT) * 60 * SPEED;
    if (el < p.len) { const [q, hd] = along(p, el); return { q, hd, out: 1, done: idx }; }
    const dw = (t - idx * SLOT) - p.len / SPEED / 60; return { q: A.N[job.node], hd: 0, out: 1, done: dw < DWELL ? idx : idx + 1, work: dw < DWELL }; }
  YZW.register({ id: 'lab-agent-city', name: 'עיר הסוכנים (מעבדה)', dept: 'lab', order: 86, timeoutMs: 60000,
    async init(world, api) {
      const r = await fetch('mods/agent-city/city.json'); if (!r.ok) throw new Error('city.json ' + r.status);
      A.D = await r.json(); A.N = A.D.n; A.jobs = A.D.jobs.filter(j => j.node != null); graph(); makeAgents();
      const T = THREE, grp = api && api.group ? api.group() : world.scene;
      const body = new T.CapsuleGeometry ? new T.CapsuleGeometry(0.28, 1.1, 4, 8) : new T.CylinderGeometry(0.3, 0.3, 1.7, 8);
      A.mesh = new T.InstancedMesh(body, new T.MeshStandardMaterial({ roughness: 0.7 }), 100);
      A.beacons = new T.InstancedMesh(new T.OctahedronGeometry(0.35), new T.MeshBasicMaterial({ toneMapped: false }), 100);
      const ca = new T.Color(0x2b5fa8), cb = new T.Color(0xc2512e);
      for (let i = 0; i < 100; i++) { const c = A.agents[i].f ? cb : ca; A.mesh.setColorAt(i, c); A.beacons.setColorAt(i, c); }
      A.mesh.frustumCulled = false; A.beacons.frustumCulled = false; grp.add(A.mesh); grp.add(A.beacons);
      A.rings = new T.InstancedMesh(new T.TorusGeometry(1.6, 0.12, 6, 24), new T.MeshBasicMaterial({ color: 0xd99a1e, toneMapped: false }), A.jobs.length);
      A.rings.frustumCulled = false; grp.add(A.rings); A.grp = grp; A.ok = true; A.tAcc = 1;
      window.G27AgentCity = A;
    },
    update(dt, world) {
      if (!A.ok) return; const W = window.W27; if (!W || !W.toScene) return;
      const o = A.D.o, d = (world.clock && world.clock.date) || new Date(), t = il(d), T = THREE;
      if (t.date !== A.date) { A.date = t.date; planDay(t.date); }
      const ground = (x, z) => (W.H ? Math.max(W.H(x, z) || 0, 0) : 0);
      let out = 0, done = 0; const q = new T.Quaternion(), s1 = new T.Vector3(1, 1, 1), s0 = new T.Vector3(0.001, 0.001, 0.001), up = new T.Vector3(0, 1, 0), pos = new T.Vector3();
      for (let i = 0; i < 100; i++) { const a = A.agents[i], st = state(a, t.min); out += st.out; done += st.done;
        const p = W.toScene(o[0] + st.q[0], o[1] + st.q[1]), y = ground(p.x, p.z); q.setFromAxisAngle(up, st.hd);
        const vis = st.out ? s1 : s0;
        pos.set(p.x, y + 0.85, p.z); A.m.compose(pos, q, vis); A.mesh.setMatrixAt(i, A.m);
        pos.set(p.x, y + 2.6 + (st.work ? 0.3 * Math.sin(world.clock.t * 4 + i) : 0), p.z); A.m.compose(pos, q, vis); A.beacons.setMatrixAt(i, A.m); }
      A.mesh.instanceMatrix.needsUpdate = true; A.beacons.instanceMatrix.needsUpdate = true; A.out = out; A.done = done;
      if ((A.tAcc += dt) > 1) { A.tAcc = 0; for (let k = 0; k < A.jobs.length; k++) { const j = A.jobs[k], p = W.toScene(o[0] + A.N[j.node][0], o[1] + A.N[j.node][1]);
        pos.set(p.x, ground(p.x, p.z) + 0.15, p.z); q.setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2); A.m.compose(pos, q, s1); A.rings.setMatrixAt(k, A.m); }
        A.rings.instanceMatrix.needsUpdate = true; }
    },
    hudPanels: [{ id: 'agent-city', render(el) { el.textContent = A.ok ? `עיר הסוכנים · ${A.out} ברחוב · ${A.done} בדיקות היום` : 'עיר הסוכנים נטענת…'; } }],
    dispose() { if (A.grp) { for (const m of [A.mesh, A.beacons, A.rings]) if (m) { A.grp.remove(m); m.geometry.dispose(); m.material.dispose(); } } A.ok = false; },
  });
})();
