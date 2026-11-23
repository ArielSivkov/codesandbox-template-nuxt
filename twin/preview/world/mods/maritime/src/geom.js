/* ESH27 twin — maritime / geom.js — procedural low-poly models (THREE injected). All PROCEDURAL, not from data.
 * Every model is ONE merged BufferGeometry with attributes position, normal, color, aTint
 * (aTint = 1 → this vertex takes the per-instance colour, 0 → keeps its own colour).
 */

export function makeKit(T) {
  const tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpE = new T.Euler(), tmpS = new T.Vector3(), tmpP = new T.Vector3();

  function part(geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], tint = 0 } = {}) {
    tmpE.set(rot[0], rot[1], rot[2]); tmpQ.setFromEuler(tmpE); tmpP.set(...pos); tmpS.set(...scale);
    tmpM.compose(tmpP, tmpQ, tmpS);
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()); g.applyMatrix4(tmpM);
    if (!g.attributes.normal) g.computeVertexNormals();
    return { g, color: new T.Color(color), tint };
  }

  function merge(parts) {
    let n = 0; for (const p of parts) n += p.g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), tin = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      const P = p.g.attributes.position, N = p.g.attributes.normal, c = p.count || P.count;
      pos.set(P.array.subarray(0, P.count * 3), o * 3); nor.set(N.array.subarray(0, P.count * 3), o * 3);
      for (let i = 0; i < P.count; i++) { col[(o + i) * 3] = p.color.r; col[(o + i) * 3 + 1] = p.color.g; col[(o + i) * 3 + 2] = p.color.b; tin[o + i] = p.tint; }
      o += P.count; p.g.dispose();
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setAttribute('aTint', new T.BufferAttribute(tin, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, s = 8) => new T.CylinderGeometry(rt, rb, h, s, 1);

  /** hull from a plan-view outline (half-breadths along length) extruded with deadrise; L along +z (bow at +z) */
  function hullGeo(L, B, D, bowFrac = 0.22, sternB = 0.92, keel = 0.5, N = 10) {
    // stations along z: stern .. bow ; each station: deck (±b, D), chine (±b*0.9, D*0.35), keel (0, 0)
    const st = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, z = -L / 2 + s * L;
      let b = B / 2; if (s < 0.05) b *= sternB; if (s > 1 - bowFrac) { const q = (s - (1 - bowFrac)) / bowFrac; b *= Math.sqrt(Math.max(0, 1 - q * q)) * 0.98 + 0.02; }
      const kz = s > 1 - bowFrac ? D * keel * ((s - (1 - bowFrac)) / bowFrac) : 0;   // bow keel rises
      st.push([[-b, D, z], [-b * 0.92, D * 0.4 + kz * 0.4, z], [0, kz, z], [b * 0.92, D * 0.4 + kz * 0.4, z], [b, D, z]]);
    }
    const pos = [];
    const tri = (a, b, c) => pos.push(...a, ...b, ...c);
    for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) {
      const a = st[i][k], b = st[i][k + 1], c = st[i + 1][k + 1], d = st[i + 1][k];
      tri(a, c, b); tri(a, d, c);
    }
    // transom
    const s0 = st[0]; tri(s0[0], s0[1], s0[4]); tri(s0[1], s0[3], s0[4]); tri(s0[1], s0[2], s0[3]);
    // deck
    for (let i = 0; i < N; i++) { const a = st[i][0], b = st[i][4], c = st[i + 1][4], d = st[i + 1][0]; tri(a, b, c); tri(a, c, d); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  }

  // --------------------------------------------------------------- models
  /** container ship, unit = metres, L ≈ 200 m, bow +z. Hull + deck stacks tinted per instance (aTint) */
  function containerShip(L = 200, B = 30, D = 14) {
    const P = [part(hullGeo(L, B, D, 0.18, 0.95, 0.35), 0xffffff, { tint: 1 })];
    P.push(part(box(B * 0.98, 0.6, L * 0.95), 0x8a2a22, { pos: [0, 0.3, 0] }));               // boot-top (red antifouling at waterline)
    P.push(part(box(B * 0.8, 14, 14), 0xf2f2f0, { pos: [0, D + 7, -L * 0.38] }));             // accommodation block (aft)
    P.push(part(box(B * 0.95, 2, 6), 0xf2f2f0, { pos: [0, D + 14.5, -L * 0.38] }));           // bridge wings
    P.push(part(box(3, 10, 3), 0x333333, { pos: [0, D + 19, -L * 0.42] }));                    // funnel
    // container rows (colours baked: generic palette, procedural)
    const pal = [0x9c3b2e, 0x2f5a8a, 0x3d7a4a, 0x8b8f93, 0xc7742c, 0xdedbd2, 0x6b4a33, 0x4a8fb5];
    let k = 0;
    for (let zc = -L * 0.3; zc < L * 0.38; zc += 13.2) for (let xb = -1; xb <= 1; xb++) {
      const tiers = 2 + ((k * 7) % 4); const c = pal[(k * 5 + xb + 7) % pal.length]; k++;
      P.push(part(box(B * 0.3, tiers * 2.6, 12.2), c, { pos: [xb * B * 0.31, D + tiers * 1.3, zc] }));
    }
    return merge(P);
  }
  /** bulk / tanker variant (no containers) */
  function tanker(L = 180, B = 32, D = 15) {
    const P = [part(hullGeo(L, B, D, 0.16, 0.95, 0.3), 0xffffff, { tint: 1 })];
    P.push(part(box(B * 0.98, 0.6, L * 0.95), 0x8a2a22, { pos: [0, 0.3, 0] }));
    P.push(part(box(B * 0.75, 13, 12), 0xf2f2f0, { pos: [0, D + 6.5, -L * 0.4] }));
    P.push(part(box(3, 9, 3), 0x2a2a2a, { pos: [0, D + 17, -L * 0.44] }));
    P.push(part(box(2, 1.5, L * 0.7), 0x6d6d6d, { pos: [0, D + 0.75, L * 0.03] }));          // pipe rack
    for (let z = -L * 0.25; z < L * 0.35; z += 22) P.push(part(box(B * 0.6, 1.2, 3), 0x7b7b7b, { pos: [0, D + 0.6, z] }));
    return merge(P);
  }
  /** motor / sailing yacht ~12 m, bow +z */
  function yacht(L = 12, B = 3.8, mast = true, stations = 10, cheap = false) {
    const P = [part(hullGeo(L, B, 1.6, 0.3, 0.9, 0.6, stations), 0xffffff, { tint: 1 })];
    P.push(part(box(B * 0.6, 1.4, L * 0.35), 0xf4f4f4, { pos: [0, 2.2, -L * 0.05] }));
    if (!cheap) P.push(part(box(B * 0.58, 0.5, L * 0.3), 0x26343f, { pos: [0, 2.6, -L * 0.04] }));          // windows band
    if (mast) P.push(part(cyl(0.08, 0.12, L * 1.3, cheap ? 3 : 5), 0xdddddd, { pos: [0, 1.6 + L * 0.65, L * 0.08] }));
    return merge(P);
  }
  /** player speedboat 6.5 m (white hull, console, windscreen, outboard) — bow +z, waterline at y = 0 */
  function speedboat() {
    const L = 6.5, B = 2.4;
    const P = [part(hullGeo(L, B, 1.1, 0.32, 0.92, 0.7), 0xf3f3f1, { pos: [0, -0.35, 0] })];
    P.push(part(box(0.9, 0.9, 0.8), 0xe8e8e6, { pos: [0, 1.2, -0.3] }));                       // console
    P.push(part(box(1.0, 0.5, 0.06), 0x3a5b70, { pos: [0, 1.85, 0.08], rot: [-0.5, 0, 0] }));  // windscreen
    P.push(part(box(1.6, 0.3, 0.8), 0xd9cdb4, { pos: [0, 0.95, -1.6] }));                       // bench seat (cream)
    P.push(part(box(1.6, 0.5, 0.15), 0xd9cdb4, { pos: [0, 1.25, -2.0] }));
    P.push(part(box(0.28, 0.9, 0.3), 0x3a3d40, { pos: [0, 0.3, -L / 2 - 0.12] }));             // outboard leg
    P.push(part(box(0.45, 0.55, 0.6), 0xf1f1ef, { pos: [0, 0.95, -L / 2 - 0.1] }));            // outboard cowling (white)
    return merge(P);
  }
  /** STS gantry crane (ship-to-shore), boom along +z (toward the water), legs gauge 30 m, height ≈ 75 m */
  function gantryCrane() {
    const C = 0xc8462d, W = 0xe9e6df, Dk = 0x3a3a3a, P = [];
    const gx = 9, gz = 15, H = 44;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(part(box(1.6, H, 1.6), C, { pos: [sx * gx, H / 2, sz * gz] }));
    for (const sz of [-1, 1]) P.push(part(box(gx * 2 + 1.6, 2.2, 1.8), C, { pos: [0, H, sz * gz] }));   // portal beams
    for (const sx of [-1, 1]) P.push(part(box(1.4, 1.6, gz * 2), C, { pos: [sx * gx, 8, 0] }));          // sill beams
    for (const sx of [-1, 1]) P.push(part(box(1.4, 2, gz * 2 + 1), C, { pos: [sx * gx, H - 0.5, 0] }));
    // boom: back-reach 28 m behind, outreach 62 m over water
    P.push(part(box(gx * 2 - 2, 3.2, 92), C, { pos: [0, H + 4, 17] }));
    // A-frame apex + stays
    for (const sx of [-1, 1]) P.push(part(box(1.2, 26, 1.2), C, { pos: [sx * (gx - 2), H + 15, -gz + 3], rot: [0.12, 0, sx * -0.12] }));
    P.push(part(box(gx * 2 - 4, 1.2, 1.2), C, { pos: [0, H + 27.5, -gz + 4.5] }));
    const stay = (z1, len, ang) => P.push(part(box(0.6, 0.6, len), Dk, { pos: [0, H + 16, z1], rot: [ang, 0, 0] }));
    stay(18, 47, 0.46); stay(-24, 24, -0.5);
    P.push(part(box(10, 5, 9), W, { pos: [0, H + 6.5, -22] }));                                  // machinery house
    P.push(part(box(4, 2.6, 5), W, { pos: [0, H + 1, 30] }));                                    // trolley + cabin
    P.push(part(box(0.3, 18, 0.3), Dk, { pos: [0, H - 9, 30] }));                                // ropes
    P.push(part(box(2.6, 1, 12.5), 0xd8b23a, { pos: [0, H - 18.5, 30] }));                       // spreader
    return merge(P);
  }
  /** container stack block: width = 6 stacks × 2.5 m, length 12.2 m, height 1 tier (scaled in y per instance) */
  function containerBlock() { return merge([part(box(15.2, 2.59, 12.2), 0xffffff, { pos: [0, 1.295, 0], tint: 1 })]); }
  function umbrella() {
    return merge([part(cyl(0.03, 0.03, 2.2, 3), 0xdcdcdc, { pos: [0, 1.1, 0] }),
      part(new T.ConeGeometry(1.25, 0.5, 8, 1, true), 0xffffff, { pos: [0, 2.25, 0], tint: 1 })]);   // canopy drawn double-sided
  }
  function lifeguardTower() {
    const Wd = 0xe9e3d3, R = 0xc23a2b, P = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(part(box(0.18, 3.2, 0.18), 0x9a8a72, { pos: [sx * 1.4, 1.6, sz * 1.4] }));
    P.push(part(box(3.4, 0.2, 3.4), 0x9a8a72, { pos: [0, 3.2, 0] }));
    P.push(part(box(3.2, 2.2, 3.2), Wd, { pos: [0, 4.4, 0] }));
    P.push(part(box(3.0, 0.7, 0.05), 0x2d3e4c, { pos: [0, 4.8, 1.62] }));                          // window toward the sea (+z)
    P.push(part(box(4.0, 0.25, 4.0), R, { pos: [0, 5.6, 0] }));
    P.push(part(box(1.0, 0.12, 4.2), 0x9a8a72, { pos: [0, 1.6, -3.3], rot: [-0.75, 0, 0] }));    // ramp
    P.push(part(cyl(0.04, 0.04, 3, 4), 0xdddddd, { pos: [1.6, 7.1, 1.6] }));
    P.push(part(box(0.9, 0.6, 0.03), R, { pos: [2.05, 8.2, 1.6] }));                               // flag (colour varies in reality)
    return merge(P);
  }
  function swimmer() {
    return merge([part(new T.SphereGeometry(0.13, 6, 4), 0xc99b7a, { pos: [0, 0.18, 0], tint: 1 }),
      part(new T.SphereGeometry(0.25, 6, 3), 0xc99b7a, { pos: [0, -0.05, 0], scale: [1.4, 0.5, 0.8], tint: 1 })]);
  }
  function buoy() {
    return merge([part(cyl(0.9, 1.1, 1.6, 8), 0xffffff, { pos: [0, 0.4, 0], tint: 1 }),
      part(cyl(0.12, 0.12, 2.4, 4), 0x555555, { pos: [0, 2.2, 0] }),
      part(new T.ConeGeometry(0.5, 0.9, 6), 0xffffff, { pos: [0, 3.5, 0], tint: 1 })]);
  }
  function lighthouse(h = 16, band = 0xc23a2b) {
    const P = [];
    const n = 4;
    for (let i = 0; i < n; i++) P.push(part(cyl(1.3 - (i + 1) * 0.12, 1.3 - i * 0.12, h / n, 10), i % 2 ? band : 0xf2f2ee, { pos: [0, h / n * (i + 0.5), 0] }));
    P.push(part(cyl(1.4, 1.4, 0.3, 10), 0x333333, { pos: [0, h + 0.15, 0] }));
    P.push(part(cyl(0.7, 0.7, 1.4, 8), 0xfff2b0, { pos: [0, h + 1, 0], tint: 1 }));   // lantern (tinted: red/green light)
    P.push(part(new T.ConeGeometry(0.9, 0.9, 8), 0x333333, { pos: [0, h + 2.1, 0] }));
    return merge(P);
  }
  return { part, merge, hullGeo, containerShip, tanker, yacht, speedboat, gantryCrane, containerBlock, umbrella, lifeguardTower, swimmer, buoy, lighthouse };
}

/** Lambert material whose per-instance colour (attribute aCol) only applies to vertices with aTint = 1 */
export function tintMaterial(T, extra = {}) {
  const m = new T.MeshLambertMaterial(Object.assign({ vertexColors: true, side: T.DoubleSide }, extra));
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nattribute vec3 aCol;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING\n vColor.xyz = mix(vColor.xyz, vColor.xyz * aCol, aTint);\n#endif');
  };
  m.customProgramCacheKey = () => 'tint1';
  return m;
}

/** InstancedMesh with an aCol attribute (default white) */
export function instanced(T, geo, mat, count) {
  const g = geo.clone();
  const col = new Float32Array(count * 3).fill(1);
  g.setAttribute('aCol', new T.InstancedBufferAttribute(col, 3));
  const m = new T.InstancedMesh(g, mat, count);
  m.instanceMatrix.setUsage(T.DynamicDrawUsage);
  m.setCol = (i, c) => { const C = c.isColor ? c : new T.Color(c); col[i * 3] = C.r; col[i * 3 + 1] = C.g; col[i * 3 + 2] = C.b; g.attributes.aCol.needsUpdate = true; };
  return m;
}
