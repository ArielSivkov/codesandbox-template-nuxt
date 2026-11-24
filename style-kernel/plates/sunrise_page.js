// sunrise_page.js — draws window.SCENE (built by sunrise_scene.mjs) as an engraved plate.
// Canvas for the engraving, SVG for every Hebrew word (kernel typography rule: no fillText for Hebrew).
/* global SCENE */
(async function () {
  'use strict';
  const S = SCENE, W = S.W, H = S.H, dpr = window.devicePixelRatio || 1;
  const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.scale(dpr, dpr);
  const C = S.colors;
  const u = Math.min(W, H) / 1080;                         // kernel line unit
  const hw = px => Math.max(px, 1 / dpr);                  // never thinner than one device pixel

  // seeded PRNG (mulberry32 / FNV-1a, same as sky.js)
  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = key => { let a = (5787 ^ hash(key)) >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const rgba = (hex, a) => { const h = hex.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
  const poly = (pts, close = true) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); if (close) ctx.closePath(); };
  const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // ───────── plate ground
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.plateTop); bg.addColorStop(1, C.plateBottom);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // ───────── the western sky at the moment (sky.js colours, tone-mapped) — a ribbon above the far edge of the sea
  const R = S.ribbon;
  {
    const img = ctx.createImageData(Math.round((R.x1 - R.x0) * dpr), Math.round((R.y1 - R.y0) * dpr));
    const iw = img.width, ih = img.height, d = img.data;
    for (let j = 0; j < ih; j++) {
      const row = R.rows[Math.min(R.rows.length - 1, Math.floor(j / ih * R.rows.length))];
      for (let i = 0; i < iw; i++) {
        const c = row[Math.min(row.length - 1, Math.floor(i / iw * row.length))], o = (j * iw + i) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    // draw through an offscreen canvas so it scales with the transform
    const oc = document.createElement('canvas'); oc.width = iw; oc.height = ih; oc.getContext('2d').putImageData(img, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(oc, R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); ctx.restore();
    // engraved sky: very fine horizontal lines, wider apart upward (kernel: water/sky horizontal)
    const r = rng('plate:sunrise/sky');
    ctx.save(); ctx.beginPath(); ctx.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); ctx.clip();
    for (let y = R.y1 - 2; y > R.y0; y -= 2.2 + (R.y1 - y) * 0.035) {
      ctx.strokeStyle = rgba(C.skyInk, 0.06 + 0.05 * r()); ctx.lineWidth = hw(0.25 * u);
      let x = R.x0; ctx.beginPath();
      while (x < R.x1) { const L = 40 + r() * 220; ctx.moveTo(x, y + (r() - 0.5) * 0.4); ctx.lineTo(Math.min(R.x1, x + L), y + (r() - 0.5) * 0.4); x += L + 4 + r() * 18; }
      ctx.stroke();
    }
    ctx.restore();
    // horizon hairline
    ctx.strokeStyle = rgba(C.hairline, 0.32); ctx.lineWidth = hw(0.25 * u); line([R.x0, R.y1], [R.x1, R.y1]); ctx.stroke();
    // azimuth ticks
    ctx.strokeStyle = rgba(C.hairline, 0.3);
    for (const t of R.ticks) { line([t.x, R.y1], [t.x, R.y1 + (t.major ? 7 : 4)]); ctx.stroke(); }
    // moonset and antisolar marks (truth, small)
    for (const m of R.marks) {
      ctx.strokeStyle = rgba(m.kind === 'moon' ? C.moon : C.pearl, 0.55); ctx.lineWidth = hw(0.35 * u);
      line([m.x, R.y1 - 1], [m.x, R.y1 - 14]); ctx.stroke();
      if (m.kind === 'moon') { ctx.beginPath(); ctx.arc(m.x, R.y1 + 0.5, 3.2, Math.PI, 2 * Math.PI); ctx.fillStyle = rgba(C.moon, 0.35); ctx.fill(); }
    }
    ctx.strokeStyle = rgba(C.hairline, 0.22); ctx.strokeRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
  }

  // ───────── ground: terrain and sea cells (fill + same-colour stroke to hide seams).
  // The cell colours carry approximated fields (glow occlusion, land cover — משוער), so they are shown
  // as a soft field, not a 4 m mosaic: the crisp layer keeps the block's outline, and a copy blurred by
  // about one cell is laid 'source-atop' over it (it never bleeds outside the block). Deterministic.
  {
    const g = document.createElement('canvas'); g.width = cv.width; g.height = cv.height;
    const gc = g.getContext('2d'); gc.scale(dpr, dpr);
    for (const c of S.cells) {
      gc.beginPath(); gc.moveTo(c.pts[0][0], c.pts[0][1]); for (let i = 1; i < c.pts.length; i++) gc.lineTo(c.pts[i][0], c.pts[i][1]); gc.closePath();
      gc.fillStyle = c.c; gc.fill(); gc.strokeStyle = c.c; gc.lineWidth = 0.7; gc.stroke();
    }
    const s = document.createElement('canvas'); s.width = cv.width; s.height = cv.height;
    const sc = s.getContext('2d'); sc.drawImage(g, 0, 0);
    sc.globalCompositeOperation = 'source-atop'; sc.filter = `blur(${(5 * dpr).toFixed(2)}px)`; sc.drawImage(g, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(s, 0, 0); ctx.restore();
    g.width = g.height = s.width = s.height = 0;     // free the two full-size layers (8K master)
  }

  // sea engraving: horizontal hairlines, broken like wave crests (seeded)
  {
    ctx.save(); ctx.beginPath();
    for (const p of S.seaPolys) { ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath(); }
    ctx.clip();
    const r = rng('plate:sunrise/sea');
    const y0 = Math.min(...S.seaPolys.flat().map(p => p[1])), y1 = Math.max(...S.seaPolys.flat().map(p => p[1]));
    for (let y = y0 + 1; y < y1; y += 3.1 + r() * 0.6) {
      const k = (y - y0) / Math.max(1, y1 - y0);
      ctx.strokeStyle = rgba(C.seaInk, 0.12 + 0.10 * k); ctx.lineWidth = hw(0.25 * u);
      ctx.beginPath(); let x = S.block.x0 - 10;
      while (x < S.block.x1 + 10) { const L = 12 + r() * 70; const yy = y + (r() - 0.5) * 0.6; ctx.moveTo(x, yy); ctx.lineTo(x + L, yy + (r() - 0.5) * 0.3); x += L + 3 + r() * 14; }
      ctx.stroke();
      // rare pale glints of the western sky on the water
      if (r() < 0.22) { const gx = S.block.x0 + r() * (S.block.x1 - S.block.x0); ctx.strokeStyle = rgba(C.seaGlint, 0.10 + 0.08 * r()); line([gx, y], [gx + 6 + r() * 18, y]); ctx.stroke(); }
    }
    ctx.restore();
  }

  // sand ripples (סכמטי)
  ctx.strokeStyle = rgba(C.sandInk, 0.26); ctx.lineWidth = hw(0.25 * u);
  for (const p of S.ripples) { poly(p, false); ctx.stroke(); }
  // greenery stipple (park, garden, open ground — land cover of the twin, משוער)
  for (const [x, y, open] of S.stipple) { ctx.beginPath(); ctx.arc(x, y, open ? 0.55 : 0.75, 0, 2 * Math.PI); ctx.fillStyle = rgba(open ? C.openDot : C.greenDot, open ? 0.22 : 0.32); ctx.fill(); }

  // soft long shadows toward the WNW: 45° hatch (kernel shadow direction), only on open ground
  ctx.lineWidth = hw(0.38 * u);
  for (const h of S.shadowHatch) { ctx.strokeStyle = rgba(C.shadowInk, h[4]); line([h[0], h[1]], [h[2], h[3]]); ctx.stroke(); }

  // contours every 2 m (SRTM, משוער) — every 10 m a little stronger
  for (const c of S.contours) { ctx.strokeStyle = rgba(C.ink, c.lev % 10 === 0 ? 0.36 : 0.18); ctx.lineWidth = hw((c.lev % 10 === 0 ? 0.35 : 0.25) * u); line(c.a, c.b); ctx.stroke(); }

  // synthetic coastline: dashed hairline over a soft band
  ctx.save(); ctx.strokeStyle = rgba(C.pearl, 0.05); ctx.lineWidth = 9; ctx.beginPath(); for (const [a, b] of S.coast) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } ctx.stroke();
  ctx.strokeStyle = rgba(C.pearl, 0.30); ctx.lineWidth = hw(0.3 * u); ctx.setLineDash([2.5, 3.5]); ctx.beginPath(); for (const [a, b] of S.coast) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } ctx.stroke(); ctx.restore();

  // roads (OSM centre lines; widths schematic)
  ctx.save(); ctx.lineCap = 'butt';
  for (const r of S.roads) { poly(r.pts, false); ctx.strokeStyle = rgba(C.roadEdge, 0.35); ctx.lineWidth = r.w + 1.4; ctx.stroke(); }
  for (const r of S.roads) { poly(r.pts, false); ctx.strokeStyle = C.road; ctx.lineWidth = r.w; ctx.stroke(); }
  ctx.restore();

  // the block's front section (terrain down to sea level) — schematic strata
  {
    const sk = S.skirt, top = sk.map(s => s.top), bot = sk.map(s => s.bot).reverse();
    poly([...top, ...bot]); ctx.fillStyle = C.skirt; ctx.fill();
    ctx.save(); poly([...top, ...bot]); ctx.clip();
    const yb = Math.max(...sk.map(s => s.bot[1]));
    for (let y = yb; y > Math.min(...top.map(p => p[1])) - 2; y -= 3.2) { ctx.strokeStyle = rgba(C.ink, 0.16); ctx.lineWidth = hw(0.25 * u); line([S.block.x0 - 2, y], [S.block.x1 + 2, y]); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = rgba(C.hairline, 0.4); ctx.lineWidth = hw(0.3 * u); poly(top, false); ctx.stroke();
    line(sk[0].bot, sk[sk.length - 1].bot); ctx.stroke();
    line(sk[0].top, sk[0].bot); ctx.stroke(); line(sk[sk.length - 1].top, sk[sk.length - 1].bot); ctx.stroke();
  }
  // far edge and sides of the block
  ctx.strokeStyle = rgba(C.hairline, 0.30); ctx.lineWidth = hw(0.25 * u);
  line(S.corners.far[0], S.corners.far[1]); ctx.stroke();
  line(S.corners.far[0], S.skirt[0].top); ctx.stroke(); line(S.corners.far[1], S.skirt[S.skirt.length - 1].top); ctx.stroke();

  // ───────── buildings, back to front
  function hatchVertical(pts, spacing, color, alpha, seed) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 - x0 < 1.2) return;
    const r = rng(seed);
    ctx.save(); poly(pts); ctx.clip(); ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = hw(0.25 * u); ctx.beginPath();
    for (let x = x0 + r() * spacing; x < x1; x += spacing * (0.85 + 0.3 * r())) { ctx.moveTo(x, y0 - 1); ctx.lineTo(x, y1 + 1); }
    ctx.stroke(); ctx.restore();
  }
  function hatchDiag(pts, spacing, color, alpha) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    ctx.save(); poly(pts); ctx.clip(); ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = hw(0.25 * u); ctx.beginPath();
    for (let k = x0 - (y1 - y0); k < x1; k += spacing) { ctx.moveTo(k, y1); ctx.lineTo(k + (y1 - y0), y0); }
    ctx.stroke(); ctx.restore();
  }
  const focusDrawn = [];
  const vband = (q, color, alpha) => {           // soft band inside the wall: from h−σ (nothing) up to the nominal roof (alpha)
    const ylo = (q[0][1] + q[1][1]) / 2, ytop = (q[2][1] + q[3][1]) / 2; if (Math.abs(ylo - ytop) < 0.5) return;
    const g = ctx.createLinearGradient(0, ylo, 0, ytop); g.addColorStop(0, rgba(color, 0)); g.addColorStop(1, rgba(color, alpha));
    poly(q); ctx.fillStyle = g; ctx.fill();
  };
  for (const b of S.bldgs) {
    const big = b.tower;
    for (const [wi, w] of b.walls.entries()) {
      poly(w.pts); ctx.fillStyle = w.c; ctx.fill(); ctx.strokeStyle = w.c; ctx.lineWidth = 0.5; ctx.stroke();
      if (w.facing < 0.25) hatchVertical(w.pts, big ? 2.4 : 2.8, C.wallInk, big ? 0.22 : 0.16, `wall:${b.id}/${wi}`);   // walls turned from the light: shadow hatch
      if (w.lit) for (const L of w.lit) {
        poly(L.pts); ctx.fillStyle = w.litC; ctx.fill(); ctx.strokeStyle = w.litC; ctx.lineWidth = 0.4; ctx.stroke();
        hatchVertical(L.pts, 4.2, C.litInk, 0.07, `lit:${b.id}/${wi}`);
      }
    }
    // roof: flat tone (the measured OSM footprint at the nominal height)
    poly(b.roof); ctx.fillStyle = b.roofC; ctx.fill(); ctx.strokeStyle = b.roofC; ctx.lineWidth = 0.4; ctx.stroke();
    // edges: corners and roof outline — thin, crisp (footprint = measured)
    ctx.strokeStyle = rgba(C.edge, big ? 0.6 : 0.42); ctx.lineWidth = hw(0.28 * u);
    for (const w of b.walls) { line(w.pts[0], w.pts[3]); ctx.stroke(); line(w.pts[1], w.pts[2]); ctx.stroke(); }
    poly(b.roof); ctx.stroke();
    // height uncertainty: soft 2σ band at the top of the visible walls + dotted error bars on the corners
    for (const w of b.walls) vband(w.band, C.band, big ? 0.14 : 0.09);
    ctx.save(); ctx.setLineDash([1.1, 2.2]); ctx.strokeStyle = rgba(C.band, big || b.name ? 0.6 : 0.2); ctx.lineWidth = hw(0.3 * u);
    const bars = big || b.name ? b.walls.flatMap(w => w.bars) : b.walls.slice(0, 1).flatMap(w => w.bars.slice(0, 1));   // small buildings: one error bar
    for (const [lo, hi] of bars) { line(lo, hi); ctx.stroke(); }
    ctx.restore();
    // the one focal line: the first light on the Dekel towers (computed terminator), gilded ink (sky.focus.mode = ink)
    if (b.tower) for (const f of S.focusRuns.filter(f => f.id === b.id)) {
      ctx.save();
      poly(f.pts, false); ctx.strokeStyle = C.focusEdge; ctx.lineWidth = 1.75 * u + 1.2 * u; ctx.stroke();
      poly(f.pts, false); ctx.strokeStyle = C.focusFill; ctx.lineWidth = 1.75 * u; ctx.stroke();
      ctx.restore(); focusDrawn.push(f.pts);
    }
  }

  // compass on the ground plane (same projection): north, the sun's azimuth and the shadow's
  const arrow = (a, b, color, alpha, wpx, head = 8) => {
    ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = hw(wpx); line(a, b); ctx.stroke();
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - ux * head - uy * head * 0.38, b[1] - uy * head + ux * head * 0.38); ctx.lineTo(b[0] - ux * head + uy * head * 0.38, b[1] - uy * head - ux * head * 0.38); ctx.closePath();
    ctx.fillStyle = rgba(color, alpha); ctx.fill();
  };
  if (S.compass) {
    const K = S.compass, c = [K.cx, K.cy];
    ctx.strokeStyle = rgba(C.hairline, 0.35); ctx.lineWidth = hw(0.3 * u); poly(K.ellipse); ctx.stroke();
    for (let i = 0; i < K.ellipse.length - 1; i += 6) { const p = K.ellipse[i]; line([c[0] + (p[0] - c[0]) * 0.92, c[1] + (p[1] - c[1]) * 0.92], p); ctx.stroke(); }
    arrow(c, K.north, C.hairline, 0.7, 0.4 * u);
    arrow(K.sun, c, C.pearl, 0.75, 0.45 * u, 9);                   // light travels from the sun's azimuth…
    ctx.save(); ctx.setLineDash([4, 3]); arrow(c, K.shadow, C.pearl, 0.45, 0.35 * u, 7); ctx.restore();   // …and shadows fall away from it
    ctx.beginPath(); ctx.arc(K.sun[0], K.sun[1], 4, 0, 2 * Math.PI); ctx.fillStyle = rgba(C.pearl, 0.6); ctx.fill();
  }
  // legend swatches
  for (const [i, g] of (S.legend || []).entries()) {
    const y = g.y - 4;
    if (i === 0) { ctx.strokeStyle = rgba(g.c, 0.8); ctx.lineWidth = hw(0.4 * u); line([g.x, y], [g.x + 26, y]); ctx.stroke(); }
    if (i === 1) { ctx.fillStyle = rgba(g.c, 0.12); ctx.fillRect(g.x, y - 5, 26, 10); ctx.save(); ctx.setLineDash([1.2, 2.4]); ctx.strokeStyle = rgba(g.c, 0.6); line([g.x, y - 5], [g.x + 26, y - 5]); ctx.stroke(); ctx.restore(); }
    if (i === 2) { ctx.fillStyle = g.c; ctx.fillRect(g.x, y - 5, 26, 10); }
    if (i === 3) { ctx.strokeStyle = C.focusEdge; ctx.lineWidth = 1.75 * u + 1.2 * u; line([g.x, y], [g.x + 26, y]); ctx.stroke(); ctx.strokeStyle = C.focusFill; ctx.lineWidth = 1.75 * u; line([g.x, y], [g.x + 26, y]); ctx.stroke(); }
  }
  // scale bar (true length along the screen-horizontal ground axis only)
  {
    const s = S.labels.scale; ctx.strokeStyle = rgba(C.hairline, 0.6); ctx.lineWidth = hw(0.35 * u);
    const y = s.y; line([s.x0, y], [s.x1, y]); ctx.stroke();
    for (let k = 0; k <= 4; k++) { const x = s.x0 + (s.x1 - s.x0) * k / 4; line([x, y - (k % 2 ? 3 : 5)], [x, y]); ctx.stroke(); }
  }
  // height ruler (metres above sea level, valid for any vertical in this projection)
  {
    const r = { ...S.ruler, y: z => S.ruler.y0 - S.ruler.k * z }; ctx.strokeStyle = rgba(C.hairline, 0.5); ctx.lineWidth = hw(0.3 * u);
    line([r.x, r.y(0)], [r.x, r.y(r.max)]); ctx.stroke();
    for (let z = 0; z <= r.max; z += 10) { line([r.x, r.y(z)], [r.x + (z % 50 ? 4 : 8), r.y(z)]); ctx.stroke(); }
    // terminator range on the ruler
    ctx.strokeStyle = C.brass; ctx.globalAlpha = 0.8; ctx.lineWidth = 2;
    line([r.x - 3, r.y(r.term[0])], [r.x - 3, r.y(r.term[1])]); ctx.stroke(); ctx.globalAlpha = 1;
    // tower tops ±σ
    for (const t of r.tops) { ctx.fillStyle = rgba(C.band, 0.18); ctx.fillRect(r.x + 10, r.y(t.top + t.sigma), 6, r.y(t.top - t.sigma) - r.y(t.top + t.sigma)); ctx.strokeStyle = rgba(C.pearl, 0.6); line([r.x + 9, r.y(t.top)], [r.x + 17, r.y(t.top)]); ctx.stroke(); }
  }

  // ───────── SVG text layer
  const NS = 'http://www.w3.org/2000/svg', ov = document.getElementById('ov');
  const el = (tag, attrs, parent = ov) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.appendChild(e); return e; };
  const text = (x, y, s, o = {}) => {
    const t = el('text', { x, y, 'font-family': o.family || 'Heebo', 'font-size': o.size || 13, 'font-weight': o.weight || 400, fill: o.fill || C.textDim,
      'text-anchor': o.anchor || 'start', direction: o.dir || 'rtl', 'xml:lang': 'he', 'letter-spacing': o.ls || 0, opacity: o.opacity ?? 1 });
    t.textContent = s; return t;
  };
  const leader = (a, b, alpha = 0.45) => el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: C.hairline, 'stroke-opacity': alpha, 'stroke-width': 0.6 });
  for (const L of S.texts) {
    if (L.leader) leader(L.leader[0], L.leader[1], L.leaderAlpha ?? 0.45);
    const t = text(L.x, L.y, L.s, L);
    if (L.tspans) { t.textContent = ''; for (const sp of L.tspans) { const ts = el('tspan', { fill: sp.fill || L.fill || C.textDim }, t); if (sp.weight) ts.setAttribute('font-weight', sp.weight); ts.textContent = sp.s; } }
  }
  // fonts: load, check, then report
  const want = ['400 13px Heebo', '700 13px Heebo', '500 30px "Frank Ruhl Libre"', '400 16px "Frank Ruhl Libre"'];
  await Promise.all(want.map(f => document.fonts.load(f, 'אבגדהוזחטיכלמנסעפצקרשת0123456789')));
  await document.fonts.ready;
  window.__fonts = Object.fromEntries(want.map(f => [f, document.fonts.check(f, 'אבג')]));
  // overflow check: every text inside the plate
  const over = [];
  for (const t of ov.querySelectorAll('text')) { const b = t.getBBox(); if (b.x < 4 || b.y < 4 || b.x + b.width > W - 4 || b.y + b.height > H - 4) over.push(t.textContent.slice(0, 40)); }
  window.__qa = { overflow: over, texts: ov.querySelectorAll('text').length, focusRuns: focusDrawn.length, dpr };
  window.__focus = focusDrawn;
  document.title = 'ready';
})().catch(e => { window.__errors = String(e && e.stack || e); document.title = 'ready'; });
