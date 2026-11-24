// noon_scene.js — the noon reference plate, drawn in the browser (Canvas 2D for the engraving, SVG for every word).
// Called by plates/render_noon.mjs through _work/plates/noon.html:  draw(PLATE, SKY, GEO)
//   SKY = style-kernel/sky.js, GEO = plates/noon_geom.js (exact prism shadows along the real sun ray).
// Kernel rules applied here: truth before beauty (geometry only from the twin's tiles, the sun only from sky.js),
// everything not from data is labelled "סכמטי"/"משוער", one gold-ink focus, the rest calm (day budget on local contrast),
// deterministic (seededRandom only).
export async function draw(P, SKY, GEO) {
  const W = P.W, H = P.H, DPR = window.devicePixelRatio || 1, U = H / 1080;          // u = short side / 1080
  const D = P.data, T = D.terrain, C = P.C, R = SKY.seededRandom, LCc = P.landcover.cls;
  const qa = { notes: [], counts: {}, layout: {} }; window.__qa = qa;
  window.__fonts = { heebo: document.fonts.check('400 20px Heebo', 'אבג'), frank: document.fonts.check('400 20px "Frank Ruhl Libre"', 'אבג') };
  const lw = (xu, minPx = 1) => Math.max(minPx / DPR, xu * U);
  const rgba = (hex, a) => { const [r, g, b] = SKY.hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
  const mix = SKY.mixHex;
  const t0 = performance.now();

  // ───────────── canvas
  const cv = document.getElementById('c');
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const ctx = cv.getContext('2d');
  const reset = (c = ctx) => c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const off = () => { const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height; const c = o.getContext('2d'); reset(c); return [o, c]; };
  const blit = (o, { alpha = 1, op = 'source-over', blur = 0 } = {}) => {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    if (blur) ctx.filter = `blur(${(blur * DPR).toFixed(2)}px)`;
    ctx.drawImage(o, 0, 0); ctx.restore();
  };
  reset();

  // ───────────── view: parallel (axonometric) projection, camera at azimuth v_az+180 looking along +v, elevation EL
  const V = P.view, EL = V.elevation_deg * Math.PI / 180, sE = Math.sin(EL), cE = Math.cos(EL), cot = cE / sE;
  const [U0, U1] = D.frame.u_range_m, [V0, V1] = D.frame.v_range_m;
  const s = V.px_per_m, OX = V.left - U0 * s, OY = V.frontY;                         // OY: screen y of (v = V0, z = 0)
  const pj = (u, v, z) => [OX + u * s, OY - (v - V0) * sE * s - z * cE * s];
  const groundT = c => c.setTransform(DPR * s, 0, 0, -DPR * s * sE, DPR * OX, DPR * (OY + V0 * sE * s));   // (u, v') with v' = v + z·cot
  const { zAt, landAt } = GEO.terrain(T);
  const pjg = (u, v) => pj(u, v, zAt(u, v));
  const path = (c, pts, close = true) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); if (close) c.closePath(); };
  const sarea = pts => { let A = 0; for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; A += p[0] * q[1] - q[0] * p[1]; } return A / 2; };
  const orient = pts => (sarea(pts) < 0 ? pts.slice().reverse() : pts);
  const addPoly = (c, pts) => { const o = orient(pts); o.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); };
  const densify = (ring, step = 2) => { const out = []; for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); for (let i = 0; i < n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); } return out; };

  // ───────────── the sun (sky.js, via render_noon.mjs) in the plate frame
  const sf = GEO.sunFrame({ altDeg: P.sun.altApparent, azGridDeg: P.sun.azGrid }, D.frame);
  const sky = { ambient: P.sky.ambient, sunLight: P.sky.sunLight, shadowTint: P.sky.shadowTint, streetLight: P.sky.streetLight, weights: P.sky.weights };
  const lin = hex => SKY.hexToRgb(hex).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const enc = c => SKY.rgbToHex(c.map(v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
  const TM = P.tone, refL = lin(TM.ref), papL = lin(TM.paper);
  const tmap = raw => enc(lin(raw).map((v, i) => Math.min(1, papL[i] * Math.max(1e-4, v / refL[i]) ** TM.gamma)));   // see render_noon.mjs
  const faceTone = (base, facing) => tmap(SKY.shade(base, sky, { facing }));
  const shadeTone = base => tmap(SKY.shade(base, sky, { inShadow: true }));
  const MUL_GROUND = C.mulGround;                                                    // multiply colour: lit ground → ground in shadow
  qa.tones = { mulGround: MUL_GROUND };

  // ───────────── prisms, painter's order
  const PR = D.buildings.map(GEO.prism), byId = new Map(PR.map(p => [p.id, p]));
  const ORDER = GEO.paintOrder(PR);
  const bbox = r => [Math.min(...r.map(p => p[0])), Math.min(...r.map(p => p[1])), Math.max(...r.map(p => p[0])), Math.max(...r.map(p => p[1]))];
  for (const p of PR) p.bb = bbox(p.ring);
  // can O cast a shadow onto something inside bbox bb whose lowest point is at zMin?
  const reaches = (O, bb, zMin) => {
    if (O.z1 <= zMin + 0.01) return false;
    const L = (O.z1 - zMin) * sf.cot, dx = sf.d[0] * L, dy = sf.d[1] * L, m = 0.5;
    const ob = [Math.min(O.bb[0], O.bb[0] + dx), Math.min(O.bb[1], O.bb[1] + dy), Math.max(O.bb[2], O.bb[2] + dx), Math.max(O.bb[3], O.bb[3] + dy)];
    return !(ob[2] < bb[0] - m || ob[0] > bb[2] + m || ob[3] < bb[1] - m || ob[1] > bb[3] + m);
  };

  // engraving: 45° hatch over a screen box (kernel: shadow = 45°)
  const hatch45 = (c, box, sp, col, a, w = lw(0.25)) => {
    const [x0, y0, x1, y1] = box; c.beginPath();
    for (let x = x0 - (y1 - y0) - ((x0 - (y1 - y0)) % sp); x < x1; x += sp) { c.moveTo(x, y1); c.lineTo(x + (y1 - y0), y0); }
    c.strokeStyle = rgba(col, a); c.lineWidth = w; c.stroke();
  };
  const sbox = pts => [Math.min(...pts.map(p => p[0])) - 2, Math.min(...pts.map(p => p[1])) - 2, Math.max(...pts.map(p => p[0])) + 2, Math.max(...pts.map(p => p[1])) + 2];
  const HATCH = 3.0;                                                                 // logical px (2.4u) — within kernel's 3 px … 6u

  // ═════════════ 1. paper
  {
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    const rnd = R('plate:noon/paper|2026-11-24|11');                                   // paper grain (style)
    ctx.fillStyle = rgba(C.ink, 0.03);
    for (let i = 0; i < 12000; i++) { const x = rnd() * W, y = rnd() * H; ctx.fillRect(x, y, lw(0.25), lw(0.25)); }
  }

  // ═════════════ 2. front section (terrain profile at v = V0, from the data; below ground = schematic)
  const DATUM = Math.floor(Math.min(...Array.from({ length: T.nu }, (_, i) => T.z_m[i] ?? 99)) - 6);   // section floor: 6 m under the lowest front point
  qa.sectionDatum_m = DATUM;
  const prof = []; for (let u = U0; u <= U1 + 0.01; u += 2) prof.push([u, zAt(u, V0)]);
  {
    path(ctx, [...prof.map(([u, z]) => pj(u, V0, z)), pj(U1, V0, DATUM), pj(U0, V0, DATUM)]);
    ctx.fillStyle = C.section; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = rgba(C.ink, 0.07); ctx.lineWidth = lw(0.25);
    for (let z = DATUM + 1.4; z < 40; z += 1.4) { const rnd = R('section:' + z.toFixed(1)); ctx.beginPath(); for (let u = U0; u <= U1; u += 8) { const p = pj(u, V0, z + (rnd() - 0.5) * 0.5); u === U0 ? ctx.moveTo(...p) : ctx.lineTo(...p); } ctx.stroke(); }
    ctx.restore();
    path(ctx, prof.map(([u, z]) => pj(u, V0, z)), false); ctx.strokeStyle = rgba(C.ink, 0.6); ctx.lineWidth = lw(0.375); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...pj(U0, V0, DATUM)); ctx.lineTo(...pj(U1, V0, DATUM));
    ctx.setLineDash([lw(3), lw(3)]); ctx.strokeStyle = rgba(C.hairline, 0.5); ctx.lineWidth = lw(0.25); ctx.stroke(); ctx.setLineDash([]);
    for (const u of [U0, U1]) { ctx.beginPath(); ctx.moveTo(...pj(u, V0, DATUM)); ctx.lineTo(...pj(u, V0, zAt(u, V0))); ctx.strokeStyle = rgba(C.hairline, 0.5); ctx.lineWidth = lw(0.25); ctx.stroke(); }
  }

  // ═════════════ 4. ground: the twin's 10 m land cells; tone by estimated land cover + real sun on the SRTM slope
  const cellZ = (i, j) => T.z_m[j * T.nu + i] ?? 0;
  const SANDY = new Set([5, 6, 7, 14, 15]), GREEN = new Set([1, 2, 3, 4, 9, 11, 12, 13]);
  {
    const flat = sf.S[2], [go, gc] = off(), [mo, mc] = off();
    for (let j = T.nv - 2; j >= 0; j--) for (let i = 0; i < T.nu - 1; i++) {
      const land = 4;                                                                   // every cell: the sea polygon is laid on top
      const u = T.u0 + i * T.grid_m, v = T.v0 + j * T.grid_m, gm = T.grid_m;
      const z00 = cellZ(i, j), z10 = cellZ(i + 1, j), z01 = cellZ(i, j + 1), z11 = cellZ(i + 1, j + 1);
      const du = (z10 + z11 - z00 - z01) / (2 * gm), dv = (z01 + z11 - z00 - z10) / (2 * gm), n = Math.hypot(du, dv, 1);
      const lam = (-du * sf.S[0] - dv * sf.S[1] + sf.S[2]) / n;
      const cl = LCc[j * T.nu + i];
      const base = SANDY.has(cl) ? C.groundSand : GREEN.has(cl) ? C.groundGreen : C.groundUrban;
      const t = Math.max(-1, Math.min(1, (lam - flat) * 6));
      const col = t >= 0 ? mix(base, '#FFFFFF', t * 0.2) : mix(base, C.groundShadow, -t * 0.35);
      for (const c of [gc, mc]) {
        path(c, [pj(u, v, z00), pj(u + gm, v, z10), pj(u + gm, v + gm, z11), pj(u, v + gm, z01)]);
        c.fillStyle = c === mc ? rgba('#000000', 0.5 + 0.5 * land / 4) : col;
        c.fill(); c.strokeStyle = c.fillStyle; c.lineWidth = lw(0.3); c.stroke();
      }
    }
    const [bo, bc] = off(); bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.filter = `blur(${(4 * s * DPR).toFixed(1)}px)`; bc.drawImage(go, 0, 0); bc.filter = 'none';
    bc.globalCompositeOperation = 'destination-over'; bc.drawImage(go, 0, 0);
    bc.globalCompositeOperation = 'destination-in'; bc.drawImage(mo, 0, 0);
    blit(bo);
    // stipple: greenery = dots (kernel), sand = a few fine brass grains; urban ground stays plain
    const rnd = R('ground-stipple|2026-11-24');
    let nG = 0;
    for (let k = 0; k < 60000; k++) {
      const u = U0 + rnd() * (U1 - U0), v = V0 + rnd() * (V1 - V0), r2 = rnd();
      if (landAt(u, v) !== 1) continue;
      const i = Math.round((u - T.u0) / T.grid_m), j = Math.round((v - T.v0) / T.grid_m), cl = LCc[j * T.nu + i];
      const p = pjg(u, v);
      if (GREEN.has(cl)) { if (r2 < 0.55) continue; ctx.fillStyle = rgba(C.ink, 0.16); ctx.fillRect(p[0], p[1], lw(0.45), lw(0.45)); nG++; }
      else if (SANDY.has(cl)) { if (r2 < 0.8) continue; ctx.fillStyle = rgba(C.hairline, 0.22); ctx.fillRect(p[0], p[1], lw(0.3), lw(0.3)); }
    }
    qa.counts.greenDots = nG;
  }

  // ═════════════ 4b. sea (polygons from the tiles; the sample's coastline is SYNTHETIC → soft edge + dashed line)
  {
    const [so, sc] = off(); groundT(sc);
    sc.beginPath(); for (const p of D.sea) p.ring_uv.forEach(([u, v], i) => (i ? sc.lineTo(u, v) : sc.moveTo(u, v)));
    const g = sc.createLinearGradient(0, V1, 0, 300); g.addColorStop(0, C.seaFar); g.addColorStop(1, C.seaNear);
    sc.fillStyle = g; sc.fill();
    reset(sc); sc.globalCompositeOperation = 'source-atop';
    sc.strokeStyle = rgba(C.silver, 0.1); sc.lineWidth = lw(0.25);
    const yTop = pj(0, V1, 0)[1], yBot = pj(0, 300, 0)[1];
    for (let y = yTop + 1, k = 0; y < yBot + 30; k++) {
      const rnd = R('sea-line:' + k), x0 = rnd() * 40;
      sc.beginPath();
      for (let x = -x0; x < W * 0.8; x += 22 + rnd() * 46) { const len = 12 + rnd() * 70; sc.moveTo(x, y); sc.lineTo(x + len, y); }
      sc.stroke();
      y += 2.6 + 0.02 * (y - yTop);
    }
    sc.globalCompositeOperation = 'source-over';
    blit(so, { alpha: 0.55, blur: 3.5 * s }); blit(so);
  }

  // ═════════════ 5. contours every metre (marching squares on the SRTM grid) — 5 and 10 m emphasised
  {
    for (let L = 1; L <= 34; L++) {
      ctx.beginPath();
      for (let j = 0; j < T.nv - 1; j++) for (let i = 0; i < T.nu - 1; i++) {
        if (!(T.land[j * T.nu + i] && T.land[j * T.nu + i + 1] && T.land[(j + 1) * T.nu + i] && T.land[(j + 1) * T.nu + i + 1])) continue;
        const z = [cellZ(i, j), cellZ(i + 1, j), cellZ(i + 1, j + 1), cellZ(i, j + 1)];
        const P4 = [[0, 0], [1, 0], [1, 1], [0, 1]], pts = [];
        for (let e = 0; e < 4; e++) { const a = z[e], b = z[(e + 1) % 4]; if ((a < L) !== (b < L)) { const t = (L - a) / (b - a), A = P4[e], B = P4[(e + 1) % 4]; pts.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); } }
        for (let k = 0; k + 1 < pts.length; k += 2) {
          ctx.moveTo(...pj(T.u0 + (i + pts[k][0]) * T.grid_m, T.v0 + (j + pts[k][1]) * T.grid_m, L));
          ctx.lineTo(...pj(T.u0 + (i + pts[k + 1][0]) * T.grid_m, T.v0 + (j + pts[k + 1][1]) * T.grid_m, L));
        }
      }
      const idx = L % 10 === 0, mid = L % 5 === 0;
      ctx.strokeStyle = rgba(C.hairline, idx ? 0.34 : mid ? 0.2 : 0.1); ctx.lineWidth = lw(idx ? 0.375 : 0.25); ctx.stroke();
    }
  }

  // ═════════════ 6. coastline of the data (synthetic in the sample) — dashed = schematic
  {
    const onFrame = (a, b) => (Math.abs(a[0] - b[0]) < 0.01 && (Math.abs(a[0] - U0) < 0.05 || Math.abs(a[0] - U1) < 0.05)) || (Math.abs(a[1] - b[1]) < 0.01 && (Math.abs(a[1] - V0) < 0.05 || Math.abs(a[1] - V1) < 0.05));
    const segs = [];
    for (const p of D.sea) { const r = p.ring_uv; for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5 && !onFrame(a, b)) segs.push([a, b]); } }
    // the shared seam between the two tiles' sea polygons is not a coast: drop segments that appear twice (reversed)
    const key = (a, b) => `${a[0].toFixed(1)},${a[1].toFixed(1)}>${b[0].toFixed(1)},${b[1].toFixed(1)}`, seen = new Map();
    for (const [a, b] of segs) seen.set(key(a, b), (seen.get(key(a, b)) || 0) + 1);
    const coast = segs.filter(([a, b]) => !seen.has(key(b, a)));
    ctx.beginPath(); for (const [a, b] of coast) { ctx.moveTo(...pj(a[0], a[1], 0)); ctx.lineTo(...pj(b[0], b[1], 0)); }
    ctx.setLineDash([lw(5), lw(4)]); ctx.strokeStyle = rgba(C.silver, 0.55); ctx.lineWidth = lw(0.375); ctx.stroke(); ctx.setLineDash([]);
    qa.counts.coastSegments = coast.length;
  }

  // ═════════════ 7. streets: centrelines from OSM (measured); widths by class are SCHEMATIC
  const ROAD_W = { 4: 12, 3: 10, 2: 7, 1: 3.5 };
  const roadPts = r => r.line_uv.map(([u, v]) => [u, v + (zAt(u, v) + 0.1) * cot]);
  {
    const [ao, ac] = off(), [eo, ec] = off();
    for (const c of [ac, ec]) { groundT(c); c.lineCap = 'round'; c.lineJoin = 'round'; }
    for (const pass of [0, 1]) for (const cls of [1, 2, 3, 4]) {
      ec.beginPath(); for (const r of D.roads) if (r.cls === cls) roadPts(r).forEach(([u, v], i) => (i ? ec.lineTo(u, v) : ec.moveTo(u, v)));
      if (pass === 0) { ec.strokeStyle = C.ink; ec.lineWidth = (ROAD_W[cls] ?? 5) + 0.9; ec.stroke(); }
      else { ec.globalCompositeOperation = 'destination-out'; ec.strokeStyle = '#000'; ec.lineWidth = ROAD_W[cls] ?? 5; ec.stroke(); ec.globalCompositeOperation = 'source-over'; }
    }
    for (const cls of [1, 2, 3, 4]) { ac.beginPath(); for (const r of D.roads) if (r.cls === cls) roadPts(r).forEach(([u, v], i) => (i ? ac.lineTo(u, v) : ac.moveTo(u, v))); ac.strokeStyle = C.road; ac.lineWidth = ROAD_W[cls] ?? 5; ac.stroke(); }
    blit(ao, { alpha: 0.85 }); blit(eo, { alpha: 0.26 });
  }

  // ═════════════ 8. ground shadows: exact prisms → SRTM ground. Core at h (tone + 45° hatch), pale fringe out to h+σ
  {
    const mk = extra => {
      const [o, c] = off(); c.fillStyle = '#000';
      for (const p of PR) {
        for (const poly of GEO.shadowOnGround(p, sf, zAt, p.z1 + extra * p.sig)) {
          const pts = densify(poly, 2).map(([u, v]) => pjg(u, v)); path(c, pts); c.fill();
        }
      }
      return o;
    };
    const fringe = mk(1), core = mk(0);
    const tint = (o, hex) => { const c = o.getContext('2d'); c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = hex; c.fillRect(0, 0, o.width, o.height); c.restore(); return o; };
    // fringe only where the core is not
    { const c = fringe.getContext('2d'); c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'destination-out'; c.drawImage(core, 0, 0); c.restore(); }
    const [ho, hc] = off(); hatch45(hc, [0, 0, W, H], HATCH, C.ink, 0.13);
    hc.setTransform(1, 0, 0, 1, 0, 0); hc.globalCompositeOperation = 'destination-in'; hc.drawImage(core, 0, 0);
    blit(tint(fringe, mix('#FFFFFF', MUL_GROUND, 0.35)), { op: 'multiply' });
    blit(tint(core, MUL_GROUND), { op: 'multiply' });
    blit(ho);
  }

  // ═════════════ THE FOCUS — one line: the noon line (shadow of the tower's vertical axis), gold ink on the ground.
  // Drawn before the buildings, so any nearer building still covers it (the focus never hides data).
  const focus = { pts: [], boxes: [] };
  {
    const runs = P.focus.pieces.filter(pc => pc.kind === 'ground').map(pc => pc.pts.map(([u, v, z]) => pj(u, v, z + 0.05)));
    const tip = pj(...P.focus.tip), tipLo = pj(...P.focus.tipLo), tipHi = pj(...P.focus.tipHi);
    focus.pts = runs.map(r => r.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]));
    // clearing (composition.clearing, day form): the engraving under the line is eased toward the paper, softly
    { const [fo, fc] = off(); fc.lineCap = 'round'; fc.lineJoin = 'round'; for (const r of runs) { path(fc, r, false); fc.strokeStyle = C.paper; fc.lineWidth = 7 * U; fc.stroke(); } blit(fo, { alpha: 0.3, blur: 3 * U }); }
    // ±σ: the tip moves along the same meridian; a dashed ink run from h−σ to h+σ and two ticks (not gold: uncertainty)
    {
      const ux = tipHi[0] - tipLo[0], uy = tipHi[1] - tipLo[1], L = Math.hypot(ux, uy), nx = -uy / L, ny = ux / L, tk = 5 * U;
      ctx.beginPath(); ctx.moveTo(...tipLo); ctx.lineTo(...tipHi); ctx.setLineDash([lw(1.6), lw(1.6)]); ctx.strokeStyle = rgba(C.focusEdge, 0.75); ctx.lineWidth = lw(0.5); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); for (const q of [tipLo, tipHi]) { ctx.moveTo(q[0] - nx * tk, q[1] - ny * tk); ctx.lineTo(q[0] + nx * tk, q[1] + ny * tk); }
      ctx.strokeStyle = rgba(C.focusEdge, 0.8); ctx.lineWidth = lw(0.5); ctx.stroke();
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of runs) { path(ctx, r, false); ctx.strokeStyle = C.focusEdge; ctx.lineWidth = lw(3.6, 3); ctx.stroke(); }
    for (const r of runs) { path(ctx, r, false); ctx.strokeStyle = C.focusFill; ctx.lineWidth = lw(1.75, 2); ctx.stroke(); }
    // one bead: the noon point (tip of the shadow of the roof's centre)
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 3.8 * U, 0, 7); ctx.fillStyle = C.focusEdge; ctx.fill();
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 1.9 * U, 0, 7); ctx.fillStyle = C.focusFill; ctx.fill();
    focus.bead = tip; focus.radius = 40 * U; focus.tip = tip; focus.tipLo = tipLo; focus.tipHi = tipHi;
    window.__focus = focus;
  }

  // ═════════════ 9. buildings: back to front. Walls → cast shadows on them → engraving → roof → its shadows → ±σ ghost
  const cnt = { walls: 0, wallsSelfShadow: 0, wallCast: 0, roofCast: 0 };
  const anchors = {};
  for (const b of ORDER) {
    const r = b.ring, n = r.length, sig = b.sig;
    const walls = [];
    for (let k = 0; k < n; k++) {
      const a = r[k], q = r[(k + 1) % n], L = Math.hypot(q[0] - a[0], q[1] - a[1]); if (L < 0.05) continue;
      const nrm = [(q[1] - a[1]) / L, -(q[0] - a[0]) / L];
      if (nrm[1] >= -1e-6) continue;                                                    // faces away from the camera
      walls.push({ a, q, L, nrm, k, mid: (a[1] + q[1]) / 2, sunDot: nrm[0] * sf.toSun[0] + nrm[1] * sf.toSun[1] });
    }
    walls.sort((x, y) => y.mid - x.mid);
    const occ = PR.filter(O => reaches(O, b.bb, b.z0));
    const floors = Math.max(1, b.b.floors | 0), fh = b.b.h_m / floors;
    for (const w of walls) {
      cnt.walls++;
      const quad = [pj(w.a[0], w.a[1], b.z0), pj(w.q[0], w.q[1], b.z0), pj(w.q[0], w.q[1], b.z1), pj(w.a[0], w.a[1], b.z1)];
      const self = w.sunDot <= 0;
      const lit = faceTone(P.tone.wallBase, sf.cosA * Math.max(0, w.sunDot)), dark = shadeTone(P.tone.wallBase);
      path(ctx, quad); ctx.fillStyle = self ? dark : lit; ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = lw(0.2); ctx.stroke();
      ctx.save(); path(ctx, quad); ctx.clip();
      const bx = sbox(quad);
      if (self) { cnt.wallsSelfShadow++; hatch45(ctx, bx, HATCH, C.ink, 0.13); }
      else {
        ctx.beginPath(); let any = 0;
        for (const O of occ) for (const poly of GEO.shadowOnWall(O, w.a, w.nrm, sf)) { addPoly(ctx, poly.map(p => pj(p[0], p[1], p[2]))); any++; }
        if (any) { cnt.wallCast++; ctx.fillStyle = dark; ctx.fill(); ctx.clip(); hatch45(ctx, bx, HATCH, C.ink, 0.13); }
      }
      ctx.restore();
      // wall engraving (style): sparse verticals; floor lines (count from the data, heights schematic)
      ctx.save(); path(ctx, quad); ctx.clip();
      {                                                                                // plaster = dots, not lines (kernel)
        const rnd = R(`wall:${b.id}/w${w.k}|2026-11-24`), area = Math.abs(sarea(quad)), nDots = Math.round(area * 0.035);
        ctx.fillStyle = rgba(C.ink, 0.2);
        for (let i = 0; i < nDots; i++) { const tt = rnd(), zz = rnd(), pa = [w.a[0] + (w.q[0] - w.a[0]) * tt, w.a[1] + (w.q[1] - w.a[1]) * tt], pp = pj(pa[0], pa[1], b.z0 + zz * (b.z1 - b.z0)); ctx.fillRect(pp[0], pp[1], lw(0.3), lw(0.3)); }
      }
      if (fh * cE * s >= 2.2) {
        ctx.beginPath();
        for (let f = 1; f < floors; f++) { const z = b.z0 + f * fh; ctx.moveTo(...pj(w.a[0], w.a[1], z)); ctx.lineTo(...pj(w.q[0], w.q[1], z)); }
        ctx.strokeStyle = rgba(C.ink, 0.12); ctx.lineWidth = lw(0.25); ctx.stroke();
      }
      ctx.restore();
      // measured footprint edge at the ground + the two vertical corners: sharp
      // the footprint is measured (sharpest); the corners rise to an estimated height (softer); the roof ring softer still
      ctx.beginPath(); ctx.moveTo(...quad[0]); ctx.lineTo(...quad[1]); ctx.strokeStyle = rgba(C.ink, 0.42); ctx.lineWidth = lw(0.375); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...quad[0]); ctx.lineTo(...quad[3]); ctx.moveTo(...quad[1]); ctx.lineTo(...quad[2]); ctx.strokeStyle = rgba(C.ink, 0.28); ctx.lineWidth = lw(0.3); ctx.stroke();
    }
    // roof
    const roof = r.map(([u, v]) => pj(u, v, b.z1));
    const roofLit = faceTone(P.tone.roofBase, sf.sinA), roofDark = shadeTone(P.tone.roofBase);
    path(ctx, roof); ctx.fillStyle = roofLit; ctx.fill();
    {
      ctx.save(); path(ctx, roof); ctx.clip();
      const bx = sbox(roof);
      // roof engraving: fine lines parallel to the longest footprint edge (style)
      let best = 0, dir = [1, 0];
      for (let k = 0; k < n; k++) { const a = roof[k], q = roof[(k + 1) % n], L = Math.hypot(q[0] - a[0], q[1] - a[1]); if (L > best) { best = L; dir = [(q[0] - a[0]) / L, (q[1] - a[1]) / L]; } }
      const cx = (bx[0] + bx[2]) / 2, cy = (bx[1] + bx[3]) / 2, ext = Math.hypot(bx[2] - bx[0], bx[3] - bx[1]) / 2 + 2, nx = -dir[1], ny = dir[0];
      ctx.beginPath(); for (let o = -ext; o <= ext; o += 3.4) { ctx.moveTo(cx + nx * o - dir[0] * ext, cy + ny * o - dir[1] * ext); ctx.lineTo(cx + nx * o + dir[0] * ext, cy + ny * o + dir[1] * ext); }
      ctx.strokeStyle = rgba(C.ink, 0.07); ctx.lineWidth = lw(0.25); ctx.stroke();
      // shadows of taller neighbours on this roof
      ctx.beginPath(); let any = 0;
      for (const O of PR) {
        if (O === b || !reaches(O, b.bb, b.z1)) continue;
        for (const poly of GEO.shadowOnPlane(O, b.z1, sf)) { addPoly(ctx, poly.map(([u, v]) => pj(u, v, b.z1))); any++; }
      }
      if (any) { cnt.roofCast++; ctx.fillStyle = roofDark; ctx.fill(); ctx.clip(); hatch45(ctx, bx, HATCH, C.ink, 0.13); }
      ctx.restore();
    }
    path(ctx, roof); ctx.strokeStyle = rgba(C.ink, 0.26); ctx.lineWidth = lw(0.3); ctx.stroke();
    // ±σ: a pale ghost of the walls up to h+σ and a dotted roof ring at h+σ
    {
      const zH = b.z1 + sig;
      ctx.beginPath();
      for (const w of walls) addPoly(ctx, [pj(w.a[0], w.a[1], b.z1), pj(w.q[0], w.q[1], b.z1), pj(w.q[0], w.q[1], zH), pj(w.a[0], w.a[1], zH)]);
      ctx.fillStyle = rgba(C.grid, 0.07); ctx.fill();
      path(ctx, r.map(([u, v]) => pj(u, v, zH))); ctx.setLineDash([lw(0.8), lw(2.2)]); ctx.strokeStyle = rgba(C.silver, 0.42); ctx.lineWidth = lw(0.3); ctx.stroke(); ctx.setLineDash([]);
    }
    // anchors for callouts: top of the camera-facing side
    const front = walls.length ? walls.reduce((m, w) => (w.L * -w.nrm[1] > m.L * -m.nrm[1] ? w : m)) : null;
    if (front) anchors[b.id] = { top: pj((front.a[0] + front.q[0]) / 2, (front.a[1] + front.q[1]) / 2, b.z1 + sig), base: pj((front.a[0] + front.q[0]) / 2, (front.a[1] + front.q[1]) / 2, b.z0) };
  }
  qa.counts = { ...qa.counts, ...cnt, buildings: ORDER.length };
  qa.ms = { scene: Math.round(performance.now() - t0) };

  // ═════════════ 10. words (SVG only)
  const svg = document.getElementById('t'), NS = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const el = (tag, at, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); parent.appendChild(e); return e; };
  const TXT = C.text;
  const words = [];                                                                 // every text element (for QA)
  const text = (x, y, str, o = {}) => {
    const e = el('text', { x, y, 'font-family': o.serif ? "'Frank Ruhl Libre', serif" : 'Heebo, sans-serif', 'font-size': o.size ?? 12, 'font-weight': o.w ?? 400,
      fill: o.fill ?? TXT.secondary, 'fill-opacity': o.a ?? 1, direction: 'rtl', 'text-anchor': o.anchor ?? 'start', ...(o.ls ? { 'letter-spacing': o.ls } : {}), ...(o.tr ? { transform: o.tr } : {}),
      ...(o.halo ? { stroke: C.paper, 'stroke-width': o.halo, 'stroke-opacity': 0.92, 'stroke-linejoin': 'round', 'paint-order': 'stroke' } : {}) }, o.parent);
    e.textContent = str; words.push(e); return e;
  };
  const line = (pts, o = {}) => el('path', { d: 'M' + pts.map(p => p.map(v => v.toFixed(2)).join(' ')).join(' L'), fill: 'none', stroke: o.stroke ?? C.hairline, 'stroke-opacity': o.a ?? 0.6, 'stroke-width': o.w ?? 0.6, ...(o.dash ? { 'stroke-dasharray': o.dash } : {}), 'stroke-linecap': 'round' }, o.parent);
  const L = P.labels;
  const bbx = e => { const b = e.getBBox(); return [b.x, b.y, b.width, b.height]; };
  // wrap a Hebrew line into the column: split at " · " (then at spaces) by measured width in the loaded font
  const wrapText = (x, y, str, o, maxW, lead) => {
    const e = text(x, y, str, o);
    if (e.getComputedTextLength() <= maxW) return y + lead;
    e.remove(); words.pop();
    const parts = str.includes(' · ') ? str.split(' · ') : str.split(' ');
    const sep = str.includes(' · ') ? ' · ' : ' ';
    let cur = '', yy = y;
    for (let i = 0; i < parts.length; i++) {
      const trial = cur ? cur + sep + parts[i] : parts[i];
      const t = text(x, yy, trial, o); const wdt = t.getComputedTextLength(); t.remove(); words.pop();
      if (wdt > maxW && cur) { text(x, yy, cur + (sep === ' · ' ? ' ·' : ''), o); yy += lead; cur = parts[i]; } else cur = trial;
    }
    if (cur) { text(x, yy, cur, o); yy += lead; }
    return yy;
  };

  // plate neat-lines
  el('rect', { x: 18, y: 18, width: W - 36, height: H - 36, fill: 'none', stroke: C.hairline, 'stroke-opacity': 0.55, 'stroke-width': 0.8 });
  el('rect', { x: 24, y: 24, width: W - 48, height: H - 48, fill: 'none', stroke: C.hairline, 'stroke-opacity': 0.3, 'stroke-width': 0.5 });

  // sea title
  { const p = pj(L.sea.u, L.sea.v, 0); text(p[0], p[1], L.sea.title, { serif: true, size: 27, fill: C.region, a: 0.95, ls: 7, anchor: 'middle', halo: 3 }); text(p[0], p[1] + 20, L.sea.note, { size: 11, fill: TXT.muted, anchor: 'middle', halo: 3 }); }

  // street names along their OSM centrelines
  for (const name of L.roadNames) {
    const segs = []; for (const r of D.roads) if (r.name === name) for (let k = 0; k + 1 < r.line_uv.length; k++) segs.push([r.line_uv[k], r.line_uv[k + 1]]);
    if (!segs.length) continue;
    const best = segs.reduce((m, sg) => { const l = Math.hypot(sg[1][0] - sg[0][0], sg[1][1] - sg[0][1]); return l > m.l ? { sg, l } : m; }, { l: 0 }).sg;
    let a = pjg(...best[0]), q = pjg(...best[1]); if (q[0] < a[0]) [a, q] = [q, a];
    const ang = Math.atan2(q[1] - a[1], q[0] - a[0]) * 180 / Math.PI, mx = (a[0] + q[0]) / 2, my = (a[1] + q[1]) / 2;
    text(mx, my + 4, name, { size: 11.5, fill: TXT.secondary, anchor: 'middle', a: 0.9, halo: 2.5, tr: `rotate(${ang.toFixed(2)} ${mx.toFixed(1)} ${(my + 4).toFixed(1)})` });
  }

  // callouts (leader from the top of the ±σ ghost, front side)
  const placeCallout = (id, lines, dx, dy) => {
    const an = anchors[id]; if (!an) return;
    const [x, y] = an.top, tx = x + dx, ty = y + dy;
    line([[x, y - 2], [tx + (dx > 0 ? -5 : 5), ty + 5]], { a: 0.75, w: 0.6 });
    el('circle', { cx: x, cy: y - 2, r: 1.4, fill: C.hairline, 'fill-opacity': 0.9 });
    let yy = ty;
    for (const ln of lines) { text(tx, yy, ln.t, { size: ln.size ?? 11.5, serif: ln.serif, fill: ln.fill ?? TXT.secondary, a: ln.a ?? 1, anchor: dx > 0 ? 'end' : 'start', w: ln.serif ? 500 : 400, halo: 3 }); yy += (ln.size ?? 11.5) + 5; }
  };
  const [cTw, cMid, cTyp] = L.callouts;
  placeCallout(cTw.id, cTw.lines, -150, -24);
  placeCallout(cMid.id, cMid.lines, -64, -14);
  { const an = anchors[cTyp.id], yS = pj(0, V0, DATUM)[1]; if (an) placeCallout(cTyp.id, cTyp.lines, P.layout.typical[0], P.layout.typical[1] === 'below' ? yS + 30 - an.top[1] : P.layout.typical[1]); }

  // the focus words (part of the focus block: the only place the headline ink may be used)
  {
    const tip = focus.tip, x = tip[0] + P.layout.focusLabel[0], y = tip[1] + P.layout.focusLabel[1];
    line([[tip[0] + 3, tip[1] - 4], [x - 6, y + 46]], { stroke: C.focusEdge, a: 0.65, w: 0.7 });
    const e1 = text(x, y, L.focus.title, { serif: true, size: 25, w: 500, fill: TXT.headline, anchor: 'end', halo: 4 });
    const e2 = text(x, y + 21, L.focus.sub, { size: 12.5, fill: TXT.sub, anchor: 'end', halo: 3 });
    const e3 = text(x, y + 38, L.focus.sub2, { size: 11.5, fill: TXT.sub, a: 0.9, anchor: 'end', halo: 3 });
    focus.boxes.push(...[e1, e2, e3].map(bbx));
  }

  // front section label, scale bar (true along u), true-north arrow (= every noon shadow)
  const yBase = pj(0, V0, DATUM)[1];
  // height scale on the section's left end (absolute metres above sea level, SRTM)
  { const zs = []; for (let z = Math.ceil(DATUM / 5) * 5; z <= 35; z += 5) zs.push(z); const x = OX + U0 * s - 6; line([[x, pj(0, V0, zs[0])[1]], [x, pj(0, V0, zs[zs.length - 1])[1]]], { stroke: C.ink, a: 0.5, w: 0.5 }); for (const z of zs) { const yy = pj(0, V0, z)[1]; line([[x - 3, yy], [x, yy]], { stroke: C.ink, a: 0.5, w: 0.5 }); text(x - 5, yy + 3.5, String(z), { size: 9, fill: TXT.muted }); } text(x - 5, pj(0, V0, zs[zs.length - 1])[1] - 9, 'מ׳', { size: 9, fill: TXT.muted }); }
  text(OX + U1 * s - 4, yBase + 20, L.section, { size: 11, fill: TXT.muted });
  {
    const x0 = OX + (U0 + 24) * s, y = yBase + 50;
    for (let m = 0; m < 100; m += 10) el('rect', { x: x0 + m * s, y: y - 3, width: 10 * s, height: 3, fill: (m / 10) % 2 ? C.paper : C.ink, 'fill-opacity': 0.7, stroke: C.ink, 'stroke-opacity': 0.7, 'stroke-width': 0.5 });
    for (const m of [0, 50, 100]) text(x0 + m * s, y + 16, String(m), { size: 11, fill: TXT.muted, anchor: 'middle' });
    text(x0 + 100 * s + 10, y + 1, 'מ׳', { size: 11, fill: TXT.muted, anchor: 'end' });
    text(x0 + 100 * s + 30, y + 1, L.scale.note, { size: 11, fill: TXT.muted, anchor: 'end' });
  }
  {
    const nx = sf.d[0] * s, ny = -sf.d[1] * sE * s, nl = Math.hypot(nx, ny), ux = nx / nl, uy = ny / nl;
    const x = OX + (U0 + 24) * s, y = yBase + 118, Lr = 62;
    line([[x, y], [x + ux * Lr, y + uy * Lr]], { stroke: C.ink, a: 0.75, w: 0.8 });
    el('path', { d: `M${x + ux * Lr} ${y + uy * Lr} L${x + ux * (Lr - 9) - uy * 3.5} ${y + uy * (Lr - 9) + ux * 3.5} L${x + ux * (Lr - 9) + uy * 3.5} ${y + uy * (Lr - 9) - ux * 3.5} Z`, fill: C.ink, 'fill-opacity': 0.75 });
    text(x + ux * (Lr + 8), y + uy * (Lr + 8) + 5, 'צ', { serif: true, size: 15, fill: C.region, anchor: 'end' });
    text(x + Lr + 34, y - 8, L.north.t, { size: 11.5, fill: TXT.secondary, anchor: 'end' });
    text(x + Lr + 34, y + 8, L.north.t2, { size: 10.5, fill: TXT.muted, anchor: 'end' });
  }

  // elevation along the noon line (the gnomon in section): same scale both ways, from the data; ink only (one focus)
  {
    const E = P.elev, k = 1.25, x0 = OX + U1 * s - 545, gy = H - 62;               // gy: screen y of the section's datum
    const zMin = Math.min(...E.prof.map(q => q[1])) - 4, X = t => x0 + (t - E.prof[0][0]) * k, Yz = z => gy - (z - zMin) * k;
    const pr = E.prof.map(([t, z]) => [X(t), Yz(z)]);
    el('path', { d: 'M' + pr.map(q => q.map(v => v.toFixed(1)).join(' ')).join(' L') + ` L${X(E.prof[E.prof.length - 1][0]).toFixed(1)} ${gy} L${X(E.prof[0][0]).toFixed(1)} ${gy} Z`, fill: C.section, 'fill-opacity': 0.9 });
    line(pr, { stroke: C.ink, a: 0.6, w: 0.6 });
    const [ta, tb] = E.tExt;
    const zg = t => E.prof.reduce((m, q) => (Math.abs(q[0] - t) < Math.abs(m[0] - t) ? q : m))[1];
    el('path', { d: `M${X(ta)} ${Yz(zg(ta))} L${X(ta)} ${Yz(E.z1)} L${X(tb)} ${Yz(E.z1)} L${X(tb)} ${Yz(zg(tb))} Z`, fill: faceTone(P.tone.wallBase, sf.cosA * 0.5), stroke: C.ink, 'stroke-opacity': 0.5, 'stroke-width': 0.6 });
    el('path', { d: `M${X(ta)} ${Yz(E.z1)} L${X(ta)} ${Yz(E.z1 + E.sig)} L${X(tb)} ${Yz(E.z1 + E.sig)} L${X(tb)} ${Yz(E.z1)}`, fill: C.grid, 'fill-opacity': 0.1, stroke: C.silver, 'stroke-opacity': 0.5, 'stroke-width': 0.5, 'stroke-dasharray': '1 2' });
    line([[X(0), Yz(zg(0))], [X(0), Yz(E.z1)]], { stroke: C.ink, a: 0.45, w: 0.5, dash: '3 2' });
    const [lo, mid, hi] = E.tips;
    line([[X(0), Yz(E.z1 - E.sig)], [X(lo[0]), Yz(lo[1])]], { stroke: C.ink, a: 0.35, w: 0.5, dash: '2 2' });
    line([[X(0), Yz(E.z1 + E.sig)], [X(hi[0]), Yz(hi[1])]], { stroke: C.ink, a: 0.35, w: 0.5, dash: '2 2' });
    line([[X(0), Yz(E.z1)], [X(mid[0]), Yz(mid[1])]], { stroke: C.ink, a: 0.8, w: 0.7 });
    line(E.prof.filter(q => q[0] >= tb && q[0] <= mid[0]).map(([t, z]) => [X(t), Yz(z)]), { stroke: C.ink, a: 0.85, w: 2 });
    el('circle', { cx: X(mid[0]), cy: Yz(mid[1]), r: 2.2, fill: C.paper, stroke: C.ink, 'stroke-width': 0.9 });
    for (const q of [lo, hi]) line([[X(q[0]), Yz(q[1]) - 4], [X(q[0]), Yz(q[1]) + 4]], { stroke: C.ink, a: 0.6, w: 0.6 });
    const ar = 26, a0 = Math.PI, a1 = Math.PI - E.alt * Math.PI / 180, cx = X(mid[0]), cy = Yz(mid[1]);
    el('path', { d: `M${cx + ar * Math.cos(a0)} ${cy} A${ar} ${ar} 0 0 1 ${cx + ar * Math.cos(a1)} ${cy - ar * Math.sin(a1)}`, fill: 'none', stroke: C.ink, 'stroke-opacity': 0.55, 'stroke-width': 0.5 });
    text(cx - ar - 4, cy - 6, `\u2066${E.alt.toFixed(2)}°\u2069`, { size: 10.5, fill: TXT.secondary, anchor: 'start' });
    text(X(tb) + 6, Yz(E.z1) + 12, `\u2066${(E.z1 - E.z0).toFixed(0)}\u2069 מ׳ \u2066±${E.sig}\u2069`, { size: 10.5, fill: TXT.secondary, anchor: 'end' });
    text((X(tb) + X(mid[0])) / 2, Yz(mid[1]) + 14 + (Yz(zg(tb)) - Yz(mid[1])) / 2, `\u2066${mid[0].toFixed(0)}\u2069 מ׳ צל על הקרקע`, { size: 10.5, fill: TXT.secondary, anchor: 'middle' });
    const xr = OX + U1 * s - 2, yt = Yz(E.z1 + E.sig) + 14;
    text(xr, yt, 'חתך לאורך קו הצהריים', { serif: true, size: 14, fill: C.region });
    text(xr, yt + 17, 'אותו קנה מידה לאורך ולגובה · דרום משמאל, צפון מימין', { size: 10.5, fill: TXT.muted });
    text(xr, yt + 32, `קרקע: ${'\u2066'}SRTM${'\u2069'} (משוער), יורדת צפונה —`, { size: 10.5, fill: TXT.muted });
    text(xr, yt + 46, `לכן הצל ארוך מ-${'\u2066'}${((E.z1 - E.z0) / Math.tan(E.alt * Math.PI / 180)).toFixed(0)}${'\u2069'} מ׳ של קרקע מישורית`, { size: 10.5, fill: TXT.muted });
    qa.layout.elev = [x0, Yz(E.z1 + E.sig), xr - x0, gy - Yz(E.z1 + E.sig)];
  }

  // ═════════════ 11. the cartouche column (right; Hebrew starts on the right)
  const col = L.col, X1 = col.x1, X0 = col.x0, CW = X1 - X0;
  el('line', { x1: X0 - 24, y1: col.y0, x2: X0 - 24, y2: col.y1, stroke: C.hairline, 'stroke-opacity': 0.35, 'stroke-width': 0.6 });
  let y = col.y0 + 38;
  text(X1, y, L.title, { serif: true, size: 36, w: 500, fill: TXT.cartouche }); y += 29;
  text(X1, y, L.place, { serif: true, size: 18.5, fill: C.region }); y += 21;
  y = wrapText(X1, y, L.coords, { size: 11, fill: TXT.muted }, CW, 15); y += 2;
  line([[X0, y], [X1, y]], { a: 0.4, w: 0.5 }); y += 27;
  y = wrapText(X1, y, L.when, { size: 15.5, w: 500, fill: TXT.cartouche }, CW, 21);
  text(X1, y, L.heb, { serif: true, size: 16, fill: C.region }); y += 19;
  text(X1, y, L.noonNote, { size: 11.5, fill: TXT.muted }); y += 18;

  // sun-path dial: today's arc over the southern sky, facing south (east on the left); real sky colours from sky.js
  {
    const DP = P.dial, dh = 112, top = y + 18, baseY = top + dh, xL = X0 + 34, xR = X1 - 20;
    const ax = az => xL + (az - 60) / 240 * (xR - xL), ay = alt => baseY - alt / 45 * dh;
    const gid = 'skyg'; const defs = svg.querySelector('defs');
    const lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    P.sky.stops.forEach((hex, i) => el('stop', { offset: [0, 0.45, 0.8, 1][i], 'stop-color': hex }, lg));
    el('rect', { x: X0, y: top, width: 10, height: dh, fill: `url(#${gid})` }); focus.keys = [[X0 - 1, top - 1, 12, dh + 2]];
    text(X0 + 15, top + 8, 'זנית', { size: 9.5, fill: TXT.muted, anchor: 'end' });
    text(X0 + 15, baseY, 'אופק', { size: 9.5, fill: TXT.muted, anchor: 'end' });
    for (const a of [10, 20, 30, 40]) line([[xL, ay(a)], [xR, ay(a)]], { stroke: C.grid, a: 0.5, w: 0.4 });
    for (const a of [10, 20, 30, 40]) text(xR + 18, ay(a) + 3.5, a + '°', { size: 9, fill: TXT.muted, anchor: 'start' });
    line([[xL, baseY], [xR, baseY]], { stroke: C.ink, a: 0.55, w: 0.7 });
    for (const [az, lab] of [[90, 'מזרח'], [135, ''], [180, 'דרום'], [225, ''], [270, 'מערב']]) {
      line([[ax(az), baseY], [ax(az), baseY + 4]], { stroke: C.ink, a: 0.5, w: 0.6 });
      if (lab) text(ax(az), baseY + 16, lab, { size: 10, fill: TXT.muted, anchor: 'middle' });
    }
    line(DP.path.map(([az, alt]) => [ax(az), ay(alt)]), { stroke: C.hairline, a: 0.95, w: 1 });
    const nx = ax(DP.noon.az), ny = ay(DP.noon.alt);
    for (const hh of DP.hours) {
      const hx = ax(hh.az), hy = ay(hh.alt);
      el('circle', { cx: hx, cy: hy, r: 1.6, fill: C.hairline, 'fill-opacity': 0.9 });
      if (Math.abs(hx - nx) > 16) text(hx, hy - 6, String(hh.h), { size: 9, fill: TXT.muted, anchor: 'middle' });
    }
    line([[nx, ny], [nx, baseY]], { stroke: C.ink, a: 0.45, w: 0.5, dash: '2 2' });
    el('circle', { cx: nx, cy: ny, r: 3.6, fill: C.paper, stroke: C.ink, 'stroke-width': 1, 'stroke-opacity': 0.8 });
    text(nx, ny - 9, `⁦${DP.noon.local}⁩ · ⁦${DP.noon.alt.toFixed(1)}°⁩`, { size: 10.5, fill: TXT.secondary, anchor: 'middle' });
    text(ax(DP.rise.az), baseY - 6, DP.rise.local, { size: 9, fill: TXT.muted, anchor: 'middle' });
    text(ax(DP.set.az), baseY - 6, DP.set.local, { size: 9, fill: TXT.muted, anchor: 'middle' });
    text(X1, top - 4, 'מסלול השמש היום (גובה נראה, מבט לדרום)', { size: 10.5, fill: TXT.muted });
    y = baseY + 38;
    qa.layout.dial = [X0, top, CW, dh];
  }
  for (const ln of L.sunLines) y = wrapText(X1, y, ln.t, { size: ln.size ?? 12.5, w: ln.w ?? 400, fill: TXT.secondary, a: ln.a ?? 1 }, CW, (ln.size ?? 12.5) + 7);
  y += 4; line([[X0, y], [X1, y]], { a: 0.4, w: 0.5 }); y += 24;

  // legend (swatch at the start = right edge, words to its left)
  text(X1, y, 'מקרא', { serif: true, size: 15, fill: C.region }); y += 16;
  const SW = 36, sx1 = X1, sx0 = X1 - SW, tx = X1 - SW - 10, TW = tx - X0;
  for (const it of L.legend) {
    const cy = y + 6, g = el('g', {}); focus.keys.push([sx0 - 1, cy - 8, SW + 2, 16]);
    if (it.k === 'focus') { line([[sx0, cy], [sx1, cy]], { stroke: C.focusEdge, a: 1, w: 3.8, parent: g }); line([[sx0, cy], [sx1, cy]], { stroke: C.focusFill, a: 1, w: 2.2, parent: g }); }
    else if (it.k === 'sharp') { el('rect', { x: sx0 + 4, y: cy - 6, width: SW - 8, height: 12, fill: faceTone(P.tone.roofBase, sf.sinA), stroke: C.ink, 'stroke-opacity': 0.62, 'stroke-width': 0.6 }, g); }
    else if (it.k === 'band') { el('rect', { x: sx0 + 4, y: cy - 6, width: SW - 8, height: 12, fill: C.grid, 'fill-opacity': 0.12 }, g); line([[sx0 + 4, cy - 6], [sx1 - 4, cy - 6]], { stroke: C.silver, a: 0.6, w: 0.6, dash: '0.8 2.2', parent: g }); }
    else if (it.k === 'shadow') {
      const pid = 'h45'; if (!svg.querySelector('#' + pid)) { const pt = el('pattern', { id: pid, width: 3, height: 3, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg.querySelector('defs')); el('line', { x1: 0, y1: 0, x2: 0, y2: 3, stroke: C.ink, 'stroke-opacity': 0.3, 'stroke-width': 0.5 }, pt); }
      el('rect', { x: sx0 + 4, y: cy - 6, width: SW - 8, height: 12, fill: shadeTone(P.tone.roofBase) }, g); el('rect', { x: sx0 + 4, y: cy - 6, width: SW - 8, height: 12, fill: 'url(#h45)' }, g);
    }
    else if (it.k === 'contour') { for (const [o, a] of [[-4, 0.2], [0, 0.34], [4, 0.2]]) line([[sx0 + 2, cy + o], [sx1 - 2, cy + o - 1.5]], { stroke: C.hairline, a, w: 0.5, parent: g }); }
    else if (it.k === 'cover') { el('rect', { x: sx0 + 4, y: cy - 6, width: (SW - 8) / 2, height: 12, fill: C.groundGreen }, g); el('rect', { x: sx0 + 4 + (SW - 8) / 2, y: cy - 6, width: (SW - 8) / 2, height: 12, fill: C.groundSand }, g); const rr = R('legend-dots'); for (let i = 0; i < 12; i++) el('rect', { x: sx0 + 5 + rr() * 13, y: cy - 5 + rr() * 10, width: 0.7, height: 0.7, fill: C.ink, 'fill-opacity': 0.45 }, g); }
    else if (it.k === 'floors') { el('rect', { x: sx0 + 4, y: cy - 6, width: SW - 8, height: 12, fill: faceTone(P.tone.wallBase, sf.cosA * 0.5) }, g); for (const o of [-2, 2]) line([[sx0 + 4, cy + o], [sx1 - 4, cy + o]], { stroke: C.ink, a: 0.3, w: 0.4, parent: g }); }
    else if (it.k === 'road') { el('rect', { x: sx0 + 2, y: cy - 4, width: SW - 4, height: 8, fill: C.road, stroke: C.ink, 'stroke-opacity': 0.32, 'stroke-width': 0.5 }, g); }
    else if (it.k === 'dash') { line([[sx0 + 2, cy], [sx1 - 2, cy]], { stroke: C.silver, a: 0.6, w: 0.8, dash: '5 4', parent: g }); }
    y = wrapText(tx, y + 10, it.t, { size: 12, fill: TXT.secondary }, TW, 16) - 10 + 2;
    if (it.t2) y = wrapText(tx, y + 14, it.t2, { size: 10.5, fill: TXT.muted }, TW, 14) - 14 + 1;
    y += 18;
  }
  y += 2; line([[X0, y], [X1, y]], { a: 0.4, w: 0.5 }); y += 22;
  for (const ln of L.sources) y = wrapText(X1, y, ln.t, { size: ln.size ?? 11, w: ln.w ?? 400, fill: ln.fill ?? TXT.muted, a: ln.a ?? 1 }, CW, ln.gap ?? 15.5);
  qa.layout.colBottom = Math.round(y);
  qa.layout.colOverflow = y > col.y1;

  // QA: text inside the plate; every word box (the day budget exempts words — see qa_noon.py)
  const over = [];
  for (const e of words) { const b = e.getBBox(); if (b.x < 24 || b.y < 24 || b.x + b.width > W - 24 || b.y + b.height > H - 24) over.push(e.textContent.slice(0, 30)); }
  qa.layout.outside = over;
  focus.words = words.filter(e => e.isConnected).map(e => bbx(e).map(v => Math.round(v * 10) / 10));
  qa.counts.words = focus.words.length;
  qa.ms.total = Math.round(performance.now() - t0);
}
