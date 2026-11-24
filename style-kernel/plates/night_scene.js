// night_scene.js — the night reference plate, drawn in the browser (Canvas 2D for the engraving, SVG for every word).
// Called by plates/render_night.mjs through _work/plates/night.html:  draw(PLATE, SKY)  (SKY = style-kernel/sky.js).
// Kernel rules applied here: truth before beauty (geometry only from the twin's tiles, sun/moon only from sky.js),
// everything not from data is labelled "סכמטי"/"משוער", one gold focus, the rest ≤ 35 % of its brightness, seeded only.
export async function draw(P, SKY) {
  const W = P.W, H = P.H, DPR = window.devicePixelRatio || 1, U = H / 1080;          // u = short side / 1080
  const D = P.data, T = D.terrain, K = P.kernel, R = SKY.seededRandom;
  const qa = { notes: [], counts: {} }; window.__qa = qa;
  const lw = (xu, minPx = 1) => Math.max(minPx / DPR, xu * U);                         // stroke width in logical px
  const rgba = (hex, a) => { const [r, g, b] = SKY.hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
  const mix = SKY.mixHex;

  // ───────────── palette (kernel roles at night; tones for unlit/lit faces are style, not photometry)
  const C = {
    fieldTop: P.sky.stops[0], fieldBot: P.sky.stops[1], ink: K.roles.ink, brass: K.roles.hairline, pearl: K.roles.pearl,
    silver: K.roles.silver, grid: K.roles.grid, region: K.roles.region_title, city: K.roles.city_light,
    seaFar: mix(K.roles.sea_surface, K.roles.sea_deep, 0.3), seaNear: mix(K.roles.sea_surface, K.roles.sea_deep, 0.55),
    shadow: P.sky.shadowTint.hex, sodium: P.sky.streetLight.sodium,
    groundLo: '#0A112C', groundHi: '#161F44', roof: '#303C6B', wallDark: '#060A1D', wallLit: '#121B40',
    section: '#080D22', window: '#BE8848', windowGlow: '#A8743C', focusCore: K.focus.core, focusGlow: K.focus.glow, bead: K.focus.bead,
  };

  // ───────────── canvas
  const cv = document.getElementById('c');
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const ctx = cv.getContext('2d');
  const reset = (c = ctx) => c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const off = () => { const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height; const c = o.getContext('2d'); reset(c); return [o, c]; };
  reset();

  // ───────────── view: parallel (axonometric) projection, camera at azimuth v_az+180 looking along +v, elevation EL
  const V = P.view, EL = V.elevation_deg * Math.PI / 180, sE = Math.sin(EL), cE = Math.cos(EL), cot = cE / sE;
  const [U0, U1] = D.frame.u_range_m, [V0, V1] = D.frame.v_range_m;
  const s = V.px_per_m, OX = V.left + (0 - U0) * s, OY = V.frontY;                     // OY: screen y of (v = V0, z = 0)
  const pj = (u, v, z) => [OX + u * s, OY - (v - V0) * sE * s - z * cE * s];
  const groundT = c => c.setTransform(DPR * s, 0, 0, -DPR * s * sE, DPR * OX, DPR * (OY + V0 * sE * s));   // (u, v') with v' = v + z·cot

  // terrain sampler (10 m grid from the twin's 25 m SRTM nodes)
  const zAt = (u, v) => {
    const fx = Math.max(0, Math.min(T.nu - 1.0001, (u - T.u0) / T.grid_m)), fy = Math.max(0, Math.min(T.nv - 1.0001, (v - T.v0) / T.grid_m));
    const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j, g = (ii, jj) => T.z_m[jj * T.nu + ii] ?? 0;
    return (1 - ay) * ((1 - ax) * g(i, j) + ax * g(i + 1, j)) + ay * ((1 - ax) * g(i, j + 1) + ax * g(i + 1, j + 1));
  };
  const landAt = (u, v) => { const i = Math.round((u - T.u0) / T.grid_m), j = Math.round((v - T.v0) / T.grid_m); if (i < 0 || j < 0 || i >= T.nu || j >= T.nv) return null; return T.land[j * T.nu + i]; };

  // moon (light) and camera vectors in (u, v, z)
  const d2r = Math.PI / 180, UD = [Math.sin(D.frame.u_az_deg * d2r), Math.cos(D.frame.u_az_deg * d2r)], VD = [Math.sin(D.frame.v_az_deg * d2r), Math.cos(D.frame.v_az_deg * d2r)];
  const en2uv = (e, n) => [e * UD[0] + n * UD[1], e * VD[0] + n * VD[1]];
  const mAlt = P.moon.alt * d2r, mAz = P.moon.az * d2r;
  const [Mu, Mv] = en2uv(Math.cos(mAlt) * Math.sin(mAz), Math.cos(mAlt) * Math.cos(mAz)), Mz = Math.sin(mAlt);
  const shadowPerM = [-Mu / Mz, -Mv / Mz];                                              // ground offset per metre of height
  qa.moonShadow = { per_m: Math.hypot(...shadowPerM), toward_az: (P.moon.az + 180) % 360 };

  // ═════════════ 1. field
  {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, C.fieldTop); g.addColorStop(1, C.fieldBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W * 0.38, H * 0.5, H * 0.2, W * 0.38, H * 0.5, W * 0.75);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(2,4,12,0.6)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    const rnd = R('plate:night/field|2026-11-23|22');                                     // paper grain (style)
    ctx.fillStyle = rgba(C.ink, 0.035);
    for (let i = 0; i < 9000; i++) { const x = rnd() * W, y = rnd() * H; ctx.fillRect(x, y, lw(0.25), lw(0.25)); }
  }

  // ═════════════ 2. front section (terrain profile at v = V0, from the data; below ground = schematic)
  const DATUM = -8;
  const prof = []; for (let u = U0; u <= U1 + 0.01; u += 2) prof.push([u, zAt(u, V0)]);
  {
    ctx.beginPath(); prof.forEach(([u, z], i) => { const p = pj(u, V0, z); i ? ctx.lineTo(...p) : ctx.moveTo(...p); });
    ctx.lineTo(...pj(U1, V0, DATUM)); ctx.lineTo(...pj(U0, V0, DATUM)); ctx.closePath();
    ctx.fillStyle = C.section; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = rgba(C.ink, 0.08); ctx.lineWidth = lw(0.25);
    for (let z = DATUM + 1.5; z < 40; z += 1.5) { const rnd = R('section:' + z); ctx.beginPath(); for (let u = U0; u <= U1; u += 8) { const p = pj(u, V0, z + (rnd() - 0.5) * 0.5); u === U0 ? ctx.moveTo(...p) : ctx.lineTo(...p); } ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); prof.forEach(([u, z], i) => { const p = pj(u, V0, z); i ? ctx.lineTo(...p) : ctx.moveTo(...p); });
    ctx.strokeStyle = rgba(C.ink, 0.55); ctx.lineWidth = lw(0.375); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...pj(U0, V0, DATUM)); ctx.lineTo(...pj(U1, V0, DATUM));
    ctx.setLineDash([lw(3), lw(3)]); ctx.strokeStyle = rgba(C.brass, 0.22); ctx.lineWidth = lw(0.25); ctx.stroke(); ctx.setLineDash([]);
    for (const u of [U0, U1]) { ctx.beginPath(); ctx.moveTo(...pj(u, V0, DATUM)); ctx.lineTo(...pj(u, V0, zAt(u, V0))); ctx.strokeStyle = rgba(C.brass, 0.3); ctx.lineWidth = lw(0.25); ctx.stroke(); }
  }

  // ═════════════ 3. sea (polygons from the tiles; the sample's coastline is SYNTHETIC → soft edge + dashed line)
  {
    const [so, sc] = off(); groundT(sc);
    sc.beginPath();
    for (const p of D.sea) p.ring_uv.forEach(([u, v], i) => (i ? sc.lineTo(u, v) : sc.moveTo(u, v)));
    const g = sc.createLinearGradient(0, V1, 0, V0); g.addColorStop(0, C.seaFar); g.addColorStop(1, C.seaNear);
    sc.fillStyle = g; sc.fill();
    // water engraving: horizontal lines, spacing grows toward the viewer
    reset(sc); sc.globalCompositeOperation = 'source-atop';
    sc.strokeStyle = rgba(C.silver, 0.085); sc.lineWidth = lw(0.25);
    const yTop = pj(0, V1, 0)[1], yBot = pj(0, V0, 0)[1];
    for (let y = yTop, k = 0; y < yBot; k++) {
      const rnd = R('sea-line:' + k), x0 = rnd() * 40;
      sc.beginPath();
      for (let x = -x0; x < W * 0.8; x += 26 + rnd() * 40) { const len = 10 + rnd() * 60; sc.moveTo(x, y); sc.lineTo(x + len, y); }
      sc.stroke();
      y += 2.6 + 0.010 * (y - yTop);
    }
    sc.globalCompositeOperation = 'source-over';
    ctx.save(); reset(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = `blur(${(3.5 * s * DPR).toFixed(1)}px)`; ctx.globalAlpha = 0.55; ctx.drawImage(so, 0, 0);
    ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.drawImage(so, 0, 0); ctx.restore();
  }

  // ═════════════ 4. ground (land cells of the twin's 10 m land mask; tone from the moon-facing slope)
  const cellZ = (i, j) => T.z_m[j * T.nu + i] ?? 0;
  {
    const flat = Mz, [go, gc] = off(), [mo, mc] = off();
    for (let j = T.nv - 2; j >= 0; j--) for (let i = 0; i < T.nu - 1; i++) {
      const land = T.land[j * T.nu + i] + T.land[j * T.nu + i + 1] + T.land[(j + 1) * T.nu + i] + T.land[(j + 1) * T.nu + i + 1];
      if (!land) continue;
      const u = T.u0 + i * T.grid_m, v = T.v0 + j * T.grid_m, g = T.grid_m;
      const z00 = cellZ(i, j), z10 = cellZ(i + 1, j), z01 = cellZ(i, j + 1), z11 = cellZ(i + 1, j + 1);
      const du = (z10 + z11 - z00 - z01) / (2 * g), dv = (z01 + z11 - z00 - z10) / (2 * g), n = Math.hypot(du, dv, 1);
      const lam = (-du * Mu - dv * Mv + Mz) / n;
      const t = Math.max(0, Math.min(1, 0.5 + (lam - flat) * 9));
      const a = land / 4;
      for (const c of [gc, mc]) {
        c.beginPath(); c.moveTo(...pj(u, v, z00)); c.lineTo(...pj(u + g, v, z10)); c.lineTo(...pj(u + g, v + g, z11)); c.lineTo(...pj(u, v + g, z01)); c.closePath();
        c.fillStyle = c === mc ? rgba('#000000', 0.5 + 0.5 * a) : mix(C.groundLo, C.groundHi, t);
        c.fill(); c.strokeStyle = c.fillStyle; c.lineWidth = lw(0.3); c.stroke();
      }
    }
    // smooth the 10 m facets (blur the tones), keep the crisp outline of the land (mask = unblurred cells)
    {
      const [bo, bc] = off(); bc.setTransform(1, 0, 0, 1, 0, 0);
      bc.filter = `blur(${(6 * s * DPR).toFixed(1)}px)`; bc.drawImage(go, 0, 0); bc.filter = 'none';
      bc.globalCompositeOperation = 'destination-over'; bc.drawImage(go, 0, 0);                 // fill blur fringes at the edges
      bc.globalCompositeOperation = 'destination-in'; bc.drawImage(mo, 0, 0);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bo, 0, 0); ctx.restore();
    }
    // stipple (engraving of open ground; style only)
    const rnd = R('ground-stipple|2026-11-23');
    ctx.fillStyle = rgba(C.ink, 0.09);
    for (let k = 0; k < 26000; k++) { const u = U0 + rnd() * (U1 - U0), v = V0 + rnd() * (V1 - V0); if (landAt(u, v) !== 1) continue; const p = pj(u, v, zAt(u, v)); ctx.fillRect(p[0], p[1], lw(0.3), lw(0.3)); }
  }

  // ═════════════ 5. contours every 2 m (marching squares on the SRTM grid) — index contours every 10 m
  {
    const lvls = []; for (let z = 1; z <= 34; z += 1) lvls.push(z);
    for (const L of lvls) {
      ctx.beginPath();
      for (let j = 0; j < T.nv - 1; j++) for (let i = 0; i < T.nu - 1; i++) {
        if (!(T.land[j * T.nu + i] && T.land[j * T.nu + i + 1] && T.land[(j + 1) * T.nu + i] && T.land[(j + 1) * T.nu + i + 1])) continue;
        const z = [cellZ(i, j), cellZ(i + 1, j), cellZ(i + 1, j + 1), cellZ(i, j + 1)];
        const P4 = [[0, 0], [1, 0], [1, 1], [0, 1]], pts = [];
        for (let e = 0; e < 4; e++) { const a = z[e], b = z[(e + 1) % 4]; if ((a < L) !== (b < L)) { const t = (L - a) / (b - a), A = P4[e], B = P4[(e + 1) % 4]; pts.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); } }
        for (let k = 0; k + 1 < pts.length; k += 2) {
          const a = pj(T.u0 + (i + pts[k][0]) * T.grid_m, T.v0 + (j + pts[k][1]) * T.grid_m, L), b = pj(T.u0 + (i + pts[k + 1][0]) * T.grid_m, T.v0 + (j + pts[k + 1][1]) * T.grid_m, L);
          ctx.moveTo(...a); ctx.lineTo(...b);
        }
      }
      const idx = L % 10 === 0, mid = L % 5 === 0;
      ctx.strokeStyle = rgba(C.ink, idx ? 0.24 : mid ? 0.12 : 0.06); ctx.lineWidth = lw(idx ? 0.375 : 0.25); ctx.stroke();
    }
  }

  // ═════════════ 6. coastline of the data (synthetic in the sample) — dashed = schematic
  const coastSegs = [];
  {
    for (const p of D.sea) {
      const r = p.ring_uv;
      for (let k = 0; k < r.length; k++) {
        const a = r[k], b = r[(k + 1) % r.length], mu = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.5) continue;
        const nu = (b[1] - a[1]) / L, nv = -(b[0] - a[0]) / L;
        const s1 = landAt(mu + nu * 6, mv + nv * 6), s2 = landAt(mu - nu * 6, mv - nv * 6);
        if (s1 != null && s2 != null && s1 !== s2) coastSegs.push([a, b]);
      }
    }
    ctx.beginPath();
    for (const [a, b] of coastSegs) { ctx.moveTo(...pj(a[0], a[1], zAt(a[0], a[1]))); ctx.lineTo(...pj(b[0], b[1], zAt(b[0], b[1]))); }
    ctx.setLineDash([lw(5), lw(4)]); ctx.strokeStyle = rgba(C.brass, 0.34); ctx.lineWidth = lw(0.375); ctx.stroke(); ctx.setLineDash([]);
    qa.counts.coastSegments = coastSegs.length;
  }

  // ═════════════ 7. streets: centrelines from OSM (measured); widths by class and the sodium wash are SCHEMATIC
  const ROAD_W = { 1: 11, 2: 7.5, 3: 6, 4: 4 };
  const roadPts = r => r.line_uv.map(([u, v]) => [u, v + (zAt(u, v) + 0.15) * cot]);
  {
    const [ro, rc] = off(); groundT(rc); rc.lineCap = 'round'; rc.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const cls of [4, 3, 2, 1]) {
        rc.beginPath();
        for (const r of D.roads) if (r.cls === cls) roadPts(r).forEach(([u, v], i) => (i ? rc.lineTo(u, v) : rc.moveTo(u, v)));
        const w = ROAD_W[cls] ?? 5;
        if (pass === 0) { rc.strokeStyle = rgba(C.ink, 0.5); rc.lineWidth = w + 1.1; } else { rc.globalCompositeOperation = 'destination-out'; rc.strokeStyle = '#000'; rc.lineWidth = w; }
        rc.stroke(); rc.globalCompositeOperation = 'source-over';
      }
    }
    // the asphalt itself: slightly darker than the moonlit ground
    const [ao, ac] = off(); groundT(ac); ac.lineCap = 'round'; ac.lineJoin = 'round';
    for (const cls of [4, 3, 2, 1]) { ac.beginPath(); for (const r of D.roads) if (r.cls === cls) roadPts(r).forEach(([u, v], i) => (i ? ac.lineTo(u, v) : ac.moveTo(u, v))); ac.strokeStyle = '#04071A'; ac.lineWidth = ROAD_W[cls]; ac.stroke(); }
    // sodium wash along classes 1–3 (street lighting is on at this sun altitude — positions unknown, so a wash, not lamps)
    const [lo, lc] = off(); groundT(lc); lc.lineCap = 'round'; lc.lineJoin = 'round'; lc.beginPath();
    for (const r of D.roads) if (r.cls <= 3) roadPts(r).forEach(([u, v], i) => (i ? lc.lineTo(u, v) : lc.moveTo(u, v)));
    lc.strokeStyle = rgba(C.sodium, 0.06); lc.lineWidth = 16; lc.stroke();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.3; ctx.drawImage(ao, 0, 0);
    ctx.globalAlpha = 0.16; ctx.drawImage(ro, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = `blur(${(5 * s * DPR).toFixed(1)}px)`; ctx.globalCompositeOperation = 'screen'; ctx.drawImage(lo, 0, 0);
    ctx.restore();
  }

  // ═════════════ 8. buildings: prepare
  const B = D.buildings.map(b => {
    let ring = b.ring_uv.slice(); let A = 0; for (let k = 0; k < ring.length; k++) { const p = ring[k], q = ring[(k + 1) % ring.length]; A += p[0] * q[1] - q[0] * p[1]; }
    if (A < 0) ring = ring.reverse();
    const cu = ring.reduce((t, p) => t + p[0], 0) / ring.length, cv = ring.reduce((t, p) => t + p[1], 0) / ring.length;
    return { ...b, ring, cu, cv, z0: b.base_m, z1: b.base_m + b.h_m };
  });

  // moon shadows: two layers (h and h+σ) so the ± stays visible as a soft fringe
  {
    const mk = extra => {
      const [o, c] = off(); groundT(c); c.fillStyle = '#000';
      for (const b of B) {
        const h = b.h_m + extra * b.sigma_m, du = shadowPerM[0] * h, dv = shadowPerM[1] * h, lift = b.z0 * cot, r = b.ring;
        const poly = pts => { c.beginPath(); pts.forEach(([u, v], i) => (i ? c.lineTo(u, v + lift) : c.moveTo(u, v + lift))); c.closePath(); c.fill(); };
        poly(r); poly(r.map(([u, v]) => [u + du, v + dv]));
        for (let k = 0; k < r.length; k++) { const a = r[k], q = r[(k + 1) % r.length]; poly([a, q, [q[0] + du, q[1] + dv], [a[0] + du, a[1] + dv]]); }
      }
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = C.shadow; c.fillRect(0, 0, o.width, o.height);
      return o;
    };
    const soft = mk(1), core = mk(0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = P.sky.shadowTint.alpha * 0.45; ctx.drawImage(soft, 0, 0);
    ctx.globalAlpha = P.sky.shadowTint.alpha * 0.75; ctx.drawImage(core, 0, 0);
    // 45° hatch inside the core shadow (kernel: shadow = 45°)
    const [ho, hc] = off(); hc.strokeStyle = rgba(C.ink, 0.5); hc.lineWidth = lw(0.25);
    hc.beginPath(); for (let x = -H; x < W; x += 3.2) { hc.moveTo(x, H); hc.lineTo(x + H, 0); } hc.stroke();
    hc.setTransform(1, 0, 0, 1, 0, 0); hc.globalCompositeOperation = 'destination-in'; hc.drawImage(core, 0, 0);
    ctx.globalAlpha = 0.14; ctx.drawImage(ho, 0, 0); ctx.restore();
  }

  const focus = { pts: [] };
  // ═════════════ THE FOCUS — one line of light: the ground outline (OSM) of the measured-most building.
  // Drawn in painter order right after its building, so nearer buildings still cover it (the focus never hides data).
  const drawFocus = b => {
    const r = b.ring, n = r.length;
    // visible part of the ring = the camera-facing edges, as one run
    const vis = []; for (let k = 0; k < n; k++) { const a = r[k], q = r[(k + 1) % n], L = Math.hypot(q[0] - a[0], q[1] - a[1]); if (L < 0.05) continue; if ((-(q[0] - a[0]) / L) < 0) vis.push(k); }
    let start = vis.find(k => !vis.includes((k - 1 + n) % n)) ?? vis[0];
    const run = [r[start]]; for (let k = start, c = 0; vis.includes(k) && c < n; k = (k + 1) % n, c++) run.push(r[(k + 1) % n]);
    focus.pts = run.map(([u, v]) => pj(u, v, b.z0 + 0.2));
    const path = () => { ctx.beginPath(); focus.pts.forEach((pt, i) => (i ? ctx.lineTo(...pt) : ctx.moveTo(...pt))); };
    // halo: the line drawn wide into its own layer and blurred (no stepped bands), screened onto the plate
    for (const [wu, blurU, a] of [[12, 18, 0.6], [4, 5, 0.55]]) {
      const [fo, fc] = off(); fc.lineCap = 'round'; fc.lineJoin = 'round';
      fc.beginPath(); focus.pts.forEach((pt, i) => (i ? fc.lineTo(...pt) : fc.moveTo(...pt))); fc.strokeStyle = C.focusGlow; fc.lineWidth = wu * U; fc.stroke();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = a;
      ctx.filter = `blur(${(blurU * U * DPR).toFixed(1)}px)`; ctx.drawImage(fo, 0, 0); ctx.restore();
    }
    path(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = C.focusCore; ctx.lineWidth = lw(1.75, 2); ctx.stroke();
    // one bead at the corner nearest the viewer
    const near = run.reduce((m, pt) => (pt[1] < m[1] ? pt : m), [0, 1e9]); const bp = pj(near[0], near[1], b.z0 + 0.2);
    const g = ctx.createRadialGradient(bp[0], bp[1], 0, bp[0], bp[1], 9 * U); g.addColorStop(0, rgba(C.bead, 0.9)); g.addColorStop(0.25, rgba(C.focusGlow, 0.35)); g.addColorStop(1, rgba(C.focusGlow, 0));
    ctx.fillStyle = g; ctx.fillRect(bp[0] - 9 * U, bp[1] - 9 * U, 18 * U, 18 * U);
    ctx.beginPath(); ctx.arc(bp[0], bp[1], lw(1.3, 2), 0, 7); ctx.fillStyle = C.bead; ctx.fill();
    focus.bead = bp; focus.radius = 40 * U;
  };
  // ═════════════ 9. buildings: back to front
  const p = P.sky.windowLightProbability;
  const focusId = P.focus.building;
  const winPts = [], labelAnchors = {};
  let litN = 0, winN = 0;
  B.sort((a, b) => b.cv - a.cv || (a.id < b.id ? -1 : 1));
  for (const b of B) {
    const r = b.ring, n = r.length, sig = b.sigma_m, zTopLo = Math.max(b.z0, b.z1 - sig), zTopHi = b.z1 + sig;
    const walls = [];
    for (let k = 0; k < n; k++) {
      const a = r[k], q = r[(k + 1) % n], L = Math.hypot(q[0] - a[0], q[1] - a[1]); if (L < 0.05) continue;
      const nu = (q[1] - a[1]) / L, nv = -(q[0] - a[0]) / L;
      if (nv >= -1e-6) continue;                                                         // faces away from the camera
      const lam = Math.max(0, nu * Mu + nv * Mv);                                        // moonlight on a vertical face (≤ cos alt)
      walls.push({ a, q, L, nu, nv, lam, k, mid: (a[1] + q[1]) / 2 });
    }
    walls.sort((x, y) => y.mid - x.mid);
    const lamMax = Math.cos(mAlt);
    for (const w of walls) {
      const tone = mix(C.wallDark, C.wallLit, Math.min(1, w.lam / lamMax));
      const quad = [pj(w.a[0], w.a[1], b.z0), pj(w.q[0], w.q[1], b.z0), pj(w.q[0], w.q[1], b.z1), pj(w.a[0], w.a[1], b.z1)];
      ctx.beginPath(); quad.forEach((pt, i) => (i ? ctx.lineTo(...pt) : ctx.moveTo(...pt))); ctx.closePath();
      ctx.fillStyle = tone; ctx.fill(); ctx.strokeStyle = tone; ctx.lineWidth = lw(0.2); ctx.stroke();
      // engraving: vertical hatch, denser on the darker faces
      ctx.save(); ctx.clip();
      const xs = quad.map(q => q[0]), ys = quad.map(q => q[1]), sp = 2.6 + 3.2 * (w.lam / lamMax);
      ctx.beginPath(); for (let x = Math.min(...xs); x <= Math.max(...xs); x += sp) { ctx.moveTo(x, Math.min(...ys)); ctx.lineTo(x, Math.max(...ys)); }
      ctx.strokeStyle = rgba('#03050D', 0.35); ctx.lineWidth = lw(0.25); ctx.stroke();
      // windows: floors from the data (f), columns every 3.4 m — SCHEMATIC; lit by the kernel's probability for 22:30
      const f = Math.max(1, b.floors | 0), fh = (b.h_m - 1.2) / f, ncol = Math.floor((w.L - 0.8) / 3.4);
      const winPx = 1.2 * s * Math.abs(w.nv);                                             // on-screen width of one window
      if (ncol >= 1 && fh > 2.2 && winPx >= 1.1) {
        for (let fl = 0; fl < f; fl++) for (let c = 0; c < ncol; c++) {
          const t0 = (c + 0.5) * w.L / ncol, half = 0.6, za = b.z0 + fl * fh + 0.95, zb = za + Math.min(1.45, fh - 1.1);
          const at = t => [w.a[0] + (w.q[0] - w.a[0]) * t / w.L, w.a[1] + (w.q[1] - w.a[1]) * t / w.L];
          const [pa, pb] = [at(t0 - half), at(t0 + half)];
          const lit = R(`window:${b.id}/w${w.k}/f${fl}/u${Math.floor(c / 2)}|2026-11-23|22`)() < p;
          const pts = [pj(pa[0], pa[1], za), pj(pb[0], pb[1], za), pj(pb[0], pb[1], zb), pj(pa[0], pa[1], zb)];
          winN++;
          if (lit) { litN++; pts.k = Math.min(1, winPx / 3); winPts.push(pts); }
          else { ctx.beginPath(); pts.forEach((pt, i) => (i ? ctx.lineTo(...pt) : ctx.moveTo(...pt))); ctx.fillStyle = rgba('#03050E', 0.55 * (0.35 + w.lam / lamMax)); ctx.fill(); }
        }
      }
      ctx.restore();
      // lit windows of this face (drawn after the clip so the glow may breathe)
      for (const pts of winPts.splice(0)) {
        const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
        const gr = 4.2 * U * pts.k, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr); g.addColorStop(0, rgba(C.windowGlow, 0.16 * pts.k)); g.addColorStop(1, rgba(C.windowGlow, 0));
        ctx.fillStyle = g; ctx.fillRect(cx - gr, cy - gr, 2 * gr, 2 * gr);
        ctx.beginPath(); pts.forEach((pt, i) => (i ? ctx.lineTo(...pt) : ctx.moveTo(...pt))); ctx.fillStyle = rgba(C.window, 0.92); ctx.fill();
      }
    }
    // roof (moon almost overhead → the brightest built surface); seeded ±3 % tone (style)
    const rr = R('roof:' + b.id)();
    ctx.beginPath(); r.forEach(([u, v], i) => { const pt = pj(u, v, b.z1); i ? ctx.lineTo(...pt) : ctx.moveTo(...pt); }); ctx.closePath();
    ctx.fillStyle = mix(C.roof, rr < 0.5 ? C.wallLit : '#2C3762', Math.abs(rr - 0.5) * 0.25); ctx.fill();
    // roof engraving: fine lines parallel to the longest footprint edge (style), the camera-facing crest catches the moon
    {
      let best = 0, dir = [1, 0];
      for (let k = 0; k < r.length; k++) { const a = pj(...r[k], b.z1), q = pj(...r[(k + 1) % r.length], b.z1), L = Math.hypot(q[0] - a[0], q[1] - a[1]); if (L > best) { best = L; dir = [(q[0] - a[0]) / L, (q[1] - a[1]) / L]; } }
      const pts = r.map(([u, v]) => pj(u, v, b.z1)), cx = pts.reduce((t, q) => t + q[0], 0) / pts.length, cy = pts.reduce((t, q) => t + q[1], 0) / pts.length;
      const ext = Math.max(...pts.map(q => Math.hypot(q[0] - cx, q[1] - cy))) + 2, nx = -dir[1], ny = dir[0];
      ctx.save(); ctx.clip(); ctx.beginPath();
      for (let o = -ext; o <= ext; o += 3) { ctx.moveTo(cx + nx * o - dir[0] * ext, cy + ny * o - dir[1] * ext); ctx.lineTo(cx + nx * o + dir[0] * ext, cy + ny * o + dir[1] * ext); }
      ctx.strokeStyle = rgba('#0B1230', 0.32); ctx.lineWidth = lw(0.25); ctx.stroke(); ctx.restore();
    }
    // edges: footprint (measured) sharp; corners fade through the ±σ band; roof outline soft
    ctx.lineCap = 'round';
    for (const w of walls) {
      ctx.beginPath(); ctx.moveTo(...pj(w.a[0], w.a[1], b.z0)); ctx.lineTo(...pj(w.q[0], w.q[1], b.z0));
      ctx.strokeStyle = rgba(C.ink, 0.5); ctx.lineWidth = lw(0.375); ctx.stroke();
      for (const c of [w.a, w.q]) {
        const p0 = pj(c[0], c[1], b.z0), p1 = pj(c[0], c[1], zTopLo), p2 = pj(c[0], c[1], b.z1);
        ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.strokeStyle = rgba(C.ink, 0.26); ctx.lineWidth = lw(0.25); ctx.stroke();
        const g = ctx.createLinearGradient(...p1, ...p2); g.addColorStop(0, rgba(C.ink, 0.26)); g.addColorStop(1, rgba(C.ink, 0.06));
        ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.strokeStyle = g; ctx.stroke();
      }
    }
    ctx.beginPath(); r.forEach(([u, v], i) => { const pt = pj(u, v, b.z1); i ? ctx.lineTo(...pt) : ctx.moveTo(...pt); }); ctx.closePath();
    ctx.strokeStyle = rgba(C.silver, b.src === 'R' ? 0.16 : 0.3); ctx.lineWidth = lw(0.25); ctx.stroke();
    ctx.beginPath(); for (const w of walls) { ctx.moveTo(...pj(w.a[0], w.a[1], b.z1)); ctx.lineTo(...pj(w.q[0], w.q[1], b.z1)); }
    ctx.strokeStyle = rgba(C.silver, 0.2); ctx.lineWidth = lw(0.3); ctx.stroke();
    // ±σ: translucent ghost up to h+σ and a dotted ring there (kernel: estimate = soft band / dashed)
    ctx.beginPath();
    const ring = z => r.forEach(([u, v], i) => { const pt = pj(u, v, z); i ? ctx.lineTo(...pt) : ctx.moveTo(...pt); });
    ring(b.z1); ctx.closePath(); ring(zTopHi); ctx.closePath();
    for (const w of walls) { const q4 = [pj(w.a[0], w.a[1], b.z1), pj(w.q[0], w.q[1], b.z1), pj(w.q[0], w.q[1], zTopHi), pj(w.a[0], w.a[1], zTopHi)]; q4.forEach((pt, i) => (i ? ctx.lineTo(...pt) : ctx.moveTo(...pt))); ctx.closePath(); }
    ctx.fillStyle = rgba(C.silver, b.src === 'R' ? 0.012 : 0.02); ctx.fill('nonzero');
    ctx.beginPath(); ring(zTopHi); ctx.closePath(); ctx.setLineDash([lw(0.6), lw(2.2)]); ctx.strokeStyle = rgba(C.silver, 0.13); ctx.lineWidth = lw(0.3); ctx.stroke(); ctx.setLineDash([]);
    // anchors for labels
    const top = r.reduce((m, [u, v]) => { const pt = pj(u, v, zTopHi); return pt[1] < m[1] ? pt : m; }, [0, 1e9]);
    if (b.id === focusId) drawFocus(b);
    labelAnchors[b.id] = { top, base: pj(b.cu, b.cv, b.z0), roof: pj(b.cu, b.cv, b.z1), h: b.h_m, s: b.sigma_m, name: b.name, src: b.src, walls, b };
  }
  qa.counts.windows = winN; qa.counts.windowsLit = litN; qa.counts.windowLitShare = +(litN / Math.max(1, winN)).toFixed(3);
  qa.counts.buildings = B.length;

  // ═════════════ 10. slab border hairlines
  {
    ctx.strokeStyle = rgba(C.brass, 0.26); ctx.lineWidth = lw(0.25);
    for (const u of [U0, U1]) { ctx.beginPath(); for (let v = V0; v <= V1; v += 5) { const pt = pj(u, v, zAt(u, v)); v === V0 ? ctx.moveTo(...pt) : ctx.lineTo(...pt); } ctx.stroke(); }
    ctx.beginPath(); for (let u = U0; u <= U1; u += 5) { const pt = pj(u, V1, zAt(u, V1)); u === U0 ? ctx.moveTo(...pt) : ctx.lineTo(...pt); } ctx.stroke();
  }

  if (!focus.pts.length) throw new Error('focus building missing: ' + focusId);
  window.__focus = focus;

  // ═════════════ 12. words (SVG) — labels on the plate, the cartouche, the sky dial, scale and legend
  const svg = document.getElementById('t'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent = svg, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; parent.appendChild(e); return e; };
  const LRI = '⁦', RLI = '⁧', PDI = '⁩';
  const T_ = (x, y, txt, o = {}) => el('text', { x, y, 'font-family': o.serif ? 'Frank Ruhl Libre' : 'Heebo', 'font-size': (o.size ?? 13) * U, 'font-weight': o.w ?? 400,
    fill: o.fill ?? C.ink, 'fill-opacity': o.a ?? 0.8, direction: o.ltr ? 'ltr' : 'rtl', 'text-anchor': o.anchor ?? 'start', lang: o.ltr ? 'en' : 'he', 'letter-spacing': o.ls ?? 0 }, o.parent ?? svg, txt);
  const line = (pts, o = {}) => el('polyline', { points: pts.map(p => p.join(',')).join(' '), fill: 'none', stroke: o.stroke ?? C.brass, 'stroke-opacity': o.a ?? 0.35, 'stroke-width': lw(o.w ?? 0.25), 'stroke-dasharray': o.dash ?? '', 'stroke-linecap': 'round' }, o.parent ?? svg);
  const fmt = (x, d = 1) => x.toFixed(d).replace('-', '−');

  // labels on the plate: callouts with a brass leader (label text right-aligned at its end point = RTL start)
  const callout = (anchor, dx, dy, lines, o = {}) => {
    const [x, y] = anchor, ex = x + dx, ey = y + dy;
    line([[x, y], [ex, ey], [ex + (dx >= 0 ? 1 : -1) * 6 * U, ey]], { a: 0.4 });
    el('circle', { cx: x, cy: y, r: lw(0.9), fill: C.brass, 'fill-opacity': 0.55 });
    const tx = ex + (dx >= 0 ? 8 * U : -8 * U), anchorSide = dx >= 0 ? 'end' : 'start';
    lines.forEach((t, i) => T_(tx, ey + (i ? 4 : 4) * U + i * (o.lh ?? 15) * U, t.t, { size: t.size ?? 12.5, a: t.a ?? 0.8, fill: t.fill ?? C.ink, w: t.w ?? 400, anchor: anchorSide, serif: t.serif }));
  };
  const LA = P.labels;
  for (const L of LA.callouts) {
    const a = labelAnchors[L.id]; if (!a) { qa.notes.push('label anchor missing ' + L.id); continue; }
    const pt = L.at === 'top' ? a.top : L.at === 'roof' ? a.roof : a.base;
    callout(pt, L.dx * U, L.dy * U, L.lines);
  }
  // sea: region title + the synthetic coastline note
  { const [x, y] = pj(LA.sea.u, LA.sea.v, 0); T_(x, y, LA.sea.title, { serif: true, size: 22, fill: C.region, a: 0.95, anchor: 'middle', ls: 2 * U });
    T_(x, y + 20 * U, LA.sea.note, { size: 11.5, a: 0.62, anchor: 'middle' }); }
  // contour + section notes near the front-left corner
  { const p0 = pj(U0, V0, DATUM), p1 = pj(U0, V0, 0);
    for (const z of [0, 10, 20, 30]) { const pt = pj(U0, V0, z); line([[pt[0] - 7 * U, pt[1]], [pt[0], pt[1]]], { a: 0.4 }); T_(pt[0] - 10 * U, pt[1] + 4 * U, String(z), { size: 10.5, a: 0.6, anchor: 'start', ltr: true }); }
    { const pr = pj(U1, V0, DATUM); T_(pr[0], pr[1] + 18 * U, LA.section, { size: 11.5, a: 0.6, anchor: 'start' }); }
    void p1; }
  // road names (data) as micrography along their own centre lines
  for (const rn of LA.roadNames) {
    const r = D.roads.filter(x => x.name === rn.name).sort((a, b) => b.line_uv.length - a.line_uv.length)[0]; if (!r) continue;
    let pts = r.line_uv.map(([u, v]) => pj(u, v, zAt(u, v))); if (pts[0][0] > pts[pts.length - 1][0]) pts = pts.reverse();
    const id = 'rd' + Math.abs(SKY.hashString(rn.name));
    el('path', { id, d: 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L'), fill: 'none' }, svg.querySelector('defs') || el('defs'));
    const t = el('text', { 'font-family': 'Heebo', 'font-size': 10.5 * U, fill: C.ink, 'fill-opacity': 0.55, direction: 'rtl', lang: 'he', 'letter-spacing': 1.2 * U, dy: -3 * U });
    el('textPath', { href: '#' + id, startOffset: (rn.at ?? 50) + '%', 'text-anchor': 'middle' }, t, rn.name);
  }

  // ───────────── right column: cartouche
  const CX0 = LA.col.x0, CX1 = LA.col.x1, cw = CX1 - CX0, xr = CX1 - 18 * U;
  el('rect', { x: CX0, y: LA.col.y0, width: cw, height: LA.col.y1 - LA.col.y0, fill: 'none', stroke: C.brass, 'stroke-opacity': 0.3, 'stroke-width': lw(0.25) });
  el('rect', { x: CX0 + 5 * U, y: LA.col.y0 + 5 * U, width: cw - 10 * U, height: LA.col.y1 - LA.col.y0 - 10 * U, fill: 'none', stroke: C.brass, 'stroke-opacity': 0.16, 'stroke-width': lw(0.25) });
  let y = LA.col.y0 + 46 * U;
  T_(xr, y, LA.title, { serif: true, size: 30, w: 500, fill: C.brass, a: 0.78 }); y += 30 * U;
  T_(xr, y, LA.place, { serif: true, size: 17, fill: C.pearl, a: 0.42 }); y += 22 * U;
  T_(xr, y, LA.coords, { size: 11, a: 0.55 }); y += 26 * U;
  line([[CX0 + 18 * U, y - 12 * U], [xr, y - 12 * U]], { a: 0.25 });
  T_(xr, y, LA.when, { size: 14.5, a: 0.85, w: 500 }); y += 20 * U;
  T_(xr, y, LA.heb, { serif: true, size: 15, fill: C.brass, a: 0.7 }); y += 30 * U;

  // sky dial (oriented like the plate: up = the view direction, azimuth v_az)
  { const R0 = 74 * U, cx = CX0 + 22 * U + R0, cy = y + R0 + 6 * U;
    const dirXY = (az, r) => { const a = (az - D.frame.v_az_deg) * d2r; return [cx + Math.sin(a) * r, cy - Math.cos(a) * r]; };
    el('circle', { cx, cy, r: R0, fill: rgba(C.fieldTop, 0.6), stroke: C.brass, 'stroke-opacity': 0.4, 'stroke-width': lw(0.375) });
    for (const alt of [30, 60]) el('circle', { cx, cy, r: R0 * (90 - alt) / 90, fill: 'none', stroke: C.ink, 'stroke-opacity': 0.16, 'stroke-width': lw(0.25), 'stroke-dasharray': `${lw(1)} ${lw(3)}` });
    for (const [az, he] of [[0, 'צ'], [90, 'מז'], [180, 'ד'], [270, 'מע']]) { const [x1, y1] = dirXY(az, R0), [x2, y2] = dirXY(az, R0 + 6 * U), [tx, ty] = dirXY(az, R0 + 15 * U); line([[x1, y1], [x2, y2]], { a: 0.5 }); T_(tx, ty + 4 * U, he, { size: 10.5, a: 0.7, anchor: 'middle' }); }
    // view direction (camera looks along +v)
    const [vx, vy] = dirXY(D.frame.v_az_deg, R0 - 10 * U); line([[cx, cy], [vx, vy]], { a: 0.18, dash: `${lw(2)} ${lw(2)}` });
    // moon shadow direction
    const [sx, sy] = dirXY(qa.moonShadow.toward_az, R0 * 0.55); line([[cx, cy], [sx, sy]], { stroke: C.ink, a: 0.5, w: 0.5 });
    T_(sx + 4 * U, sy - 4 * U, 'צל', { size: 10, a: 0.6, anchor: 'end' });
    // moon (symbol: not true size; dimmed under the brightness budget), real alt/az
    const [mx, my] = dirXY(P.moon.az, R0 * (90 - P.moon.alt) / 90);
    el('circle', { cx: mx, cy: my, r: 6.5 * U, fill: C.silver, 'fill-opacity': 0.55 });
    // sun below the horizon: a dashed tick outside the dial at its azimuth
    const [ux1, uy1] = dirXY(P.sun.az, R0 + 3 * U), [ux2, uy2] = dirXY(P.sun.az, R0 + 26 * U);
    line([[ux1, uy1], [ux2, uy2]], { stroke: C.ink, a: 0.3, dash: `${lw(1.5)} ${lw(2)}` });
    // dial text (to the right of the dial)
    const tx = xr; let ty = cy - R0 + 12 * U;
    for (const t of LA.dial) { T_(tx, ty, t.t, { size: t.size ?? 12, a: t.a ?? 0.78, fill: t.fill ?? C.ink, w: t.w ?? 400 }); ty += (t.gap ?? 17) * U; }
    y = Math.max(cy + R0 + 34 * U, ty + 10 * U);
  }
  line([[CX0 + 18 * U, y - 14 * U], [xr, y - 14 * U]], { a: 0.25 });
  // legend
  { const lx = xr, sw = CX0 + 22 * U; let ly = y + 4 * U;
    T_(lx, ly, 'מקרא', { serif: true, size: 15, fill: C.brass, a: 0.7 }); ly += 22 * U;
    const sym = (kind, yy) => {
      const x0 = sw, x1 = sw + 34 * U;
      if (kind === 'focus') { line([[x0, yy], [x1, yy]], { stroke: C.focusGlow, a: 0.25, w: 6 }); line([[x0, yy], [x1, yy]], { stroke: C.focusCore, a: 1, w: 1.75 }); }
      else if (kind === 'sharp') line([[x0, yy], [x1, yy]], { stroke: C.ink, a: 0.7, w: 0.5 });
      else if (kind === 'band') { el('rect', { x: x0, y: yy - 5 * U, width: 34 * U, height: 10 * U, fill: C.silver, 'fill-opacity': 0.08 }); line([[x0, yy - 5 * U], [x1, yy - 5 * U]], { stroke: C.silver, a: 0.3, dash: `${lw(0.6)} ${lw(2.2)}` }); }
      else if (kind === 'dash') line([[x0, yy], [x1, yy]], { a: 0.5, dash: `${lw(5)} ${lw(4)}`, w: 0.375 });
      else if (kind === 'window') { for (let i = 0; i < 5; i++) el('rect', { x: x0 + i * 7 * U, y: yy - 2 * U, width: 3.4 * U, height: 3.6 * U, fill: i % 2 ? '#03050E' : C.window, 'fill-opacity': i % 2 ? 0.6 : 0.92 }); }
      else if (kind === 'shadow') { el('rect', { x: x0, y: yy - 5 * U, width: 34 * U, height: 10 * U, fill: C.shadow, 'fill-opacity': 0.7 }); }
      else if (kind === 'contour') { line([[x0, yy - 3 * U], [x1, yy - 3 * U]], { stroke: C.ink, a: 0.3 }); line([[x0, yy + 3 * U], [x1, yy + 3 * U]], { stroke: C.ink, a: 0.12 }); }
      else if (kind === 'lamp') { el('ellipse', { cx: (x0 + x1) / 2, cy: yy, rx: 14 * U, ry: 6 * U, fill: C.sodium, 'fill-opacity': 0.12 }); }
    };
    for (const it of LA.legend) { sym(it.k, ly - 4 * U); T_(lx, ly, it.t, { size: 11.5, a: 0.78 }); if (it.t2) { ly += 14 * U; T_(lx, ly, it.t2, { size: 10.5, a: 0.55 }); } ly += 20 * U; }
    y = ly + 4 * U;
  }
  line([[CX0 + 18 * U, y - 12 * U], [xr, y - 12 * U]], { a: 0.25 });
  // sources + licence + kernel stamp
  { let ly = y + 6 * U;
    for (const t of LA.sources) { T_(xr, ly, t.t, { size: t.size ?? 10.5, a: t.a ?? 0.62, w: t.w ?? 400, fill: t.fill ?? C.ink }); ly += (t.gap ?? 14) * U; }
    qa.colBottom = ly;
    // locator: where the area sits in Ashdod (city outline of the sample = estimated → dashed), north up
    const rings = (D.city?.outer_rings_sample || []).filter(r => r.length > 2);
    if (rings.length) {
      const all = rings.flat(), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const boxTop = ly + 8 * U, boxH = LA.col.y1 - 22 * U - boxTop, k = Math.min(boxH / (y1 - y0), (cw * 0.42) / (x1 - x0));
      const ox = CX0 + 30 * U, oy = boxTop + boxH;                                         // map at the left of the column
      const m = ([e, n]) => [ox + (e - x0) * k, oy - (n - y0) * k];
      for (const r of rings) el('polygon', { points: r.map(p => m(p).map(v => v.toFixed(1)).join(',')).join(' '), fill: rgba(C.ink, 0.04), stroke: C.ink, 'stroke-opacity': 0.4, 'stroke-width': lw(0.3), 'stroke-dasharray': `${lw(2.5)} ${lw(2)}` });
      const [CXs, CYs] = D.frame.center_sample, toEN = (u, v) => [CXs + u * UD[0] + v * VD[0], CYs + u * UD[1] + v * VD[1]];
      const rect = [[U0, V0], [U1, V0], [U1, V1], [U0, V1]].map(([u, v]) => m(toEN(u, v)));
      el('polygon', { points: rect.map(p => p.map(v => v.toFixed(1)).join(',')).join(' '), fill: rgba(C.brass, 0.25), stroke: C.brass, 'stroke-opacity': 0.75, 'stroke-width': lw(0.5) });
      const rc = m(toEN(0, 0)), tx = xr;
      line([[rc[0] + 6 * U, rc[1]], [tx - 210 * U, rc[1]]], { a: 0.3 });
      T_(tx, rc[1] - 4 * U, 'האזור בתוך אשדוד', { size: 12, a: 0.78, w: 500 });
      T_(tx, rc[1] + 12 * U, 'קו המתאר של העיר בדגימה — משוער מהבניינים', { size: 10.5, a: 0.55 });
      T_(tx, rc[1] + 26 * U, `צפון למעלה · ${LRI}${((x1 - x0) / 1000).toFixed(1)}×${((y1 - y0) / 1000).toFixed(1)}${PDI} ק״מ`, { size: 10.5, a: 0.55 });
      const na = [ox + (x1 - x0) * k + 12 * U, boxTop + 16 * U];
      line([[na[0], na[1] + 14 * U], [na[0], na[1]]], { a: 0.5 }); T_(na[0], na[1] - 4 * U, 'צ', { size: 10.5, a: 0.7, anchor: 'middle' });
    }
  }

  // ───────────── under the plate: scale bar and a ground-plane north arrow
  { const by = LA.scale.y, bx = pj(LA.scale.u, V0, 0)[0];
    for (let m = 0; m <= 100; m += 10) { const x = bx + m * s; line([[x, by], [x, by - (m % 50 ? 4 : 8) * U]], { a: 0.45 }); }
    line([[bx, by], [bx + 100 * s, by]], { a: 0.45 });
    for (const m of [0, 50, 100]) T_(bx + m * s, by + 15 * U, String(m), { size: 10.5, a: 0.6, anchor: 'middle', ltr: true });
    T_(bx + 100 * s + 44 * U, by + 1 * U, 'מ׳', { size: 11, a: 0.6, anchor: 'end' });
    T_(bx + 100 * s + 64 * U, by + 1 * U, LA.scale.note, { size: 10.5, a: 0.55, anchor: 'end' });
    // north on the ground plane, projected
    const [nu, nv] = en2uv(0, 1), [ax, ay] = [LA.north.x, LA.north.y], len = 36 * U;
    const dx = nu, dy = -nv * sE, L = Math.hypot(dx, dy), ex = ax + dx / L * len, ey = ay + dy / L * len;
    line([[ax, ay], [ex, ey]], { a: 0.6, w: 0.5 });
    line([[ex - (dx / L) * 7 * U + (dy / L) * 3.5 * U, ey - (dy / L) * 7 * U - (dx / L) * 3.5 * U], [ex, ey], [ex - (dx / L) * 7 * U - (dy / L) * 3.5 * U, ey - (dy / L) * 7 * U + (dx / L) * 3.5 * U]], { a: 0.6, w: 0.5 });
    T_(ex + (dx / L) * 12 * U, ey + (dy / L) * 12 * U + 4 * U, 'צ', { size: 12, a: 0.75, anchor: 'middle' });
  }
  // outer frame
  el('rect', { x: 18 * U, y: 18 * U, width: W - 36 * U, height: H - 36 * U, fill: 'none', stroke: C.brass, 'stroke-opacity': 0.22, 'stroke-width': lw(0.25) });

  // fonts must be the real ones (kernel typography rule)
  await document.fonts.ready;
  window.__fonts = { heebo: document.fonts.check(`12px Heebo`, 'אבג'), frank: document.fonts.check(`12px "Frank Ruhl Libre"`, 'אבג') };
  qa.layout = { s, EL: V.elevation_deg, OX, OY, slabTop: pj(0, V1, 0)[1], sectionBottom: pj(0, V0, DATUM)[1] };
  void RLI; void PDI; void LRI;
  return qa;
}
