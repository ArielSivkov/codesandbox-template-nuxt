/* ESH27 aviation — models.js : procedural low-poly models (no external assets, our own work → no licence issues).
 * Both face −Z (nose), +Y up, +X right wing — the body frame of jet.js / spaceship.js. Units: metres.
 *   jet  ≈ 15 m long, 9.5 m span, ~700 triangles (generic fighter silhouette, no real insignia; "27" on the fin)
 *   ship ≈ 18 m long, ~500 triangles
 * userData hooks: flame (afterburner cone), gear (group), plasma (re-entry glow), thrusters. */
export function makeJet(T) {
  const g = new T.Group(); g.name = 'jet';
  const grey = new T.MeshLambertMaterial({ color: 0x8e9aa6 }), dark = new T.MeshLambertMaterial({ color: 0x3a4048 }), glass = new T.MeshLambertMaterial({ color: 0x2c4a63, emissive: 0x0a1622 }), black = new T.MeshLambertMaterial({ color: 0x1b1d20 });
  // fuselage: lathe profile (radius vs length), built along +Y then turned so the nose points −Z
  const prof = [[0, 0], [0.18, 0.5], [0.42, 1.6], [0.62, 3.0], [0.8, 4.8], [0.9, 6.5], [0.92, 10.5], [0.86, 12.6], [0.72, 14.2], [0.66, 15.0]].map(([r, y]) => new T.Vector2(r, y));
  const fus = new T.LatheGeometry(prof, 14); fus.rotateX(Math.PI / 2); fus.translate(0, 0, -7.5); fus.scale(1, 0.92, 1);
  const body = new T.Mesh(fus, grey); g.add(body);
  const can = new T.Mesh(new T.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass); can.scale.set(0.5, 0.55, 1.9); can.position.set(0, 0.6, -3.6); g.add(can);
  const flat = (pts, thick, mat) => { const s = new T.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); const geo = new T.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false }); geo.translate(0, 0, -thick / 2); return new T.Mesh(geo, mat); };
  // wings (planform in x = span, y = −z), extruded and laid flat
  for (const sx of [1, -1]) {
    const w = flat([[0.6, -1.4], [4.7, 2.6], [4.7, 3.5], [0.6, 4.2]].map(([x, y]) => [x * sx, -y]), 0.14, grey); w.rotation.x = -Math.PI / 2; w.position.y = -0.1; g.add(w);
    const lex = flat([[0.5, -5.2], [0.95, -1.2], [0.5, -1.2]].map(([x, y]) => [x * sx, -y]), 0.1, grey); lex.rotation.x = -Math.PI / 2; lex.position.y = 0.05; g.add(lex);
    const hs = flat([[0.7, 5.6], [3.0, 7.2], [3.0, 7.9], [0.7, 8.0]].map(([x, y]) => [x * sx, -y]), 0.1, grey); hs.rotation.x = -Math.PI / 2; hs.position.y = -0.2; g.add(hs);
    const tip = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 3.0, 6), dark); tip.rotation.x = Math.PI / 2; tip.position.set(4.75 * sx, -0.1, 2.4); g.add(tip);
  }
  // vertical fin with a "27" tail mark (canvas texture)
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; const c = cv.getContext('2d'); c.fillStyle = '#8e9aa6'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#f2b84b'; c.font = 'bold 54px Arial'; c.textAlign = 'center'; c.fillText('27', 70, 88);
  const finTex = new T.CanvasTexture(cv); finTex.colorSpace = T.SRGBColorSpace;
  const fs = new T.Shape(); [[4.4, 0.7], [6.6, 3.9], [7.6, 3.9], [7.6, 0.7]].forEach(([z, y], i) => i ? fs.lineTo(z, y) : fs.moveTo(z, y));
  const fg = new T.ExtrudeGeometry(fs, { depth: 0.12, bevelEnabled: false }); fg.translate(0, 0, -0.06); fg.rotateY(-Math.PI / 2);
  { const uv = fg.attributes.uv, p = fg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getZ(i) - 4.4) / 3.2, (p.getY(i) - 0.7) / 3.2); }
  g.add(new T.Mesh(fg, new T.MeshLambertMaterial({ map: finTex })));
  const intake = new T.Mesh(new T.BoxGeometry(1.1, 0.7, 3.4), dark); intake.position.set(0, -0.85, -0.6); g.add(intake);
  const lip = new T.Mesh(new T.BoxGeometry(1.15, 0.75, 0.15), black); lip.position.set(0, -0.85, -2.3); g.add(lip);
  const noz = new T.Mesh(new T.CylinderGeometry(0.58, 0.66, 1.0, 12, 1, true), dark); noz.rotation.x = Math.PI / 2; noz.position.z = 7.9; g.add(noz);
  // afterburner: two nested additive cones (orange outer, blue-white core); scale.z by thrust
  const flame = new T.Group(); flame.position.z = 8.3;
  const fo = new T.Mesh(new T.ConeGeometry(0.55, 4.5, 12, 1, true), new T.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  fo.rotation.x = Math.PI / 2; fo.position.z = 2.25; flame.add(fo);
  const fc = new T.Mesh(new T.ConeGeometry(0.32, 2.4, 10, 1, true), new T.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false }));
  fc.rotation.x = Math.PI / 2; fc.position.z = 1.2; flame.add(fc); g.add(flame); flame.visible = false;
  // landing gear
  const gear = new T.Group(); const wheel = new T.CylinderGeometry(0.32, 0.32, 0.22, 10); wheel.rotateZ(Math.PI / 2);
  for (const [x, z, l] of [[0, -4.6, 1.1], [1.15, 0.9, 1.0], [-1.15, 0.9, 1.0]]) { const st = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, l, 6), dark); st.position.set(x, -0.95 - l / 2 + 0.2, z); gear.add(st); const wh = new T.Mesh(wheel, black); wh.position.set(x, -1.23, z); gear.add(wh); }
  g.add(gear);
  g.traverse(o => { if (o.isMesh && o.material !== fo.material && o.material !== fc.material) o.castShadow = true; });
  g.userData = { flame, flameOuter: fo, flameCore: fc, gear, eye: new T.Vector3(0, 0.95, -4.0) };
  return g;
}
export function makeShip(T) {
  const g = new T.Group(); g.name = 'ship';
  const hull = new T.MeshLambertMaterial({ color: 0xe4e8ec }), belly = new T.MeshLambertMaterial({ color: 0x24282e }), dark = new T.MeshLambertMaterial({ color: 0x2a2f36 }), gold = new T.MeshLambertMaterial({ color: 0xf2b84b }), glass = new T.MeshLambertMaterial({ color: 0x0f2233, emissive: 0x06111a });
  const prof = [[0, 0], [0.35, 0.6], [0.8, 2.0], [1.25, 4.5], [1.5, 7.5], [1.55, 12], [1.45, 16.5], [1.2, 18]].map(([r, y]) => new T.Vector2(r, y));
  const fg = new T.LatheGeometry(prof, 16); fg.rotateX(Math.PI / 2); fg.translate(0, 0, -9.5); fg.scale(1.15, 0.8, 1); g.add(new T.Mesh(fg, hull));
  const keel = new T.Mesh(new T.BoxGeometry(2.2, 0.35, 15), belly); keel.position.set(0, -1.1, 0.5); g.add(keel);                 // heat-shield belly
  const can = new T.Mesh(new T.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass); can.scale.set(0.85, 0.65, 2.4); can.position.set(0, 0.85, -4.6); g.add(can);
  const flat = (pts, th, mat) => { const sh = new T.Shape(); pts.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y)); const geo = new T.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false }); geo.translate(0, 0, -th / 2); geo.rotateX(-Math.PI / 2); return new T.Mesh(geo, mat); };
  for (const sx of [1, -1]) {
    const w = flat([[1.2, 2.0], [7.6, -6.6], [7.6, -8.4], [1.2, -8.4]].map(([x, y]) => [x * sx, y]), 0.28, hull); w.position.y = -0.55; g.add(w);
    const le = flat([[1.25, 2.05], [7.65, -6.55], [7.65, -6.95], [1.25, 1.55]].map(([x, y]) => [x * sx, y]), 0.3, belly); le.position.y = -0.55; g.add(le);
    const fin = new T.Mesh(new T.BoxGeometry(0.16, 2.6, 2.2), gold); fin.position.set(7.4 * sx, 0.55, 7.3); fin.rotation.z = -0.3 * sx; fin.rotation.x = -0.25; g.add(fin);
  }
  const glowM = new T.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false });
  const thr = [];
  for (const [x, y] of [[0, 0.1], [0.95, -0.45], [-0.95, -0.45]]) { const bell = new T.Mesh(new T.CylinderGeometry(0.42, 0.62, 1.1, 12, 1, true), dark); bell.rotation.x = Math.PI / 2; bell.position.set(x, y, 9.0); g.add(bell);
    const ring = new T.Mesh(new T.CircleGeometry(0.55, 12), glowM); ring.position.set(x, y, 9.5); g.add(ring);
    const cone = new T.Mesh(new T.ConeGeometry(0.5, 5, 10, 1, true), new T.MeshBasicMaterial({ color: 0x8fe4ff, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    cone.rotation.x = Math.PI / 2; cone.position.set(x, y, 12.0); g.add(cone); thr.push(cone); }
  const stripe = new T.Mesh(new T.BoxGeometry(0.45, 0.06, 9), gold); stripe.position.set(0, 1.24, 3.5); g.add(stripe);
  // re-entry: bow-shock plasma (two additive cones with the apex just ahead of the nose), opacity ∝ heat flux
  const pl = new T.Group(); const pm1 = new T.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }), pm2 = pm1.clone(); pm2.color.setHex(0xffc49a);
  const c1 = new T.Mesh(new T.ConeGeometry(9.5, 26, 24, 1, true), pm1); c1.rotation.x = -Math.PI / 2; c1.position.z = -11 + 13; pl.add(c1);
  const c2 = new T.Mesh(new T.ConeGeometry(3.2, 9, 18, 1, true), pm2); c2.rotation.x = -Math.PI / 2; c2.position.z = -10.4 + 4.5; pl.add(c2);
  pl.userData.mats = [pm1, pm2]; g.add(pl);
  g.traverse(o => { if (o.isMesh && o.material.blending !== T.AdditiveBlending) o.castShadow = true; });
  g.userData = { thrusters: thr, plasma: pl, eye: new T.Vector3(0, 1.25, -4.6) };
  return g;
}
/** Runway strip (fictional) with markings, as a flat mesh. len/width metres, built along −Z (threshold "27" at +Z end). */
export function makeRunway(T, len = 2400, wid = 45, label = '27') {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 2048; const c = cv.getContext('2d');
  c.fillStyle = '#3b3e42'; c.fillRect(0, 0, 128, 2048);
  for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,0.03)`; c.fillRect(Math.random() * 128, Math.random() * 2048, 2, 2); }
  c.fillStyle = '#e8e8e2'; for (let y = 120; y < 1930; y += 52) c.fillRect(62, y, 4, 28);           // centreline
  c.fillRect(4, 0, 3, 2048); c.fillRect(121, 0, 3, 2048);                                          // edge lines
  for (const yy of [8, 2008]) for (let k = 0; k < 8; k++) c.fillRect(10 + k * 14, yy, 8, 32);       // threshold bars
  c.save(); c.font = 'bold 36px Arial'; c.textAlign = 'center'; c.fillText(label === '27' ? '27' : label, 64, 2000 - 40); c.translate(64, 90); c.rotate(Math.PI); c.fillText('09', 0, 0); c.restore();
  c.fillStyle = '#f2b84b'; c.font = 'bold 13px Arial'; c.save(); c.translate(64, 1024); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText('FICTIONAL · מסלול בדיוני', 0, 40); c.restore();
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
  const geo = new T.PlaneGeometry(wid, len); geo.rotateX(-Math.PI / 2);
  const m = new T.Mesh(geo, new T.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.receiveShadow = true; m.renderOrder = 3;
  const g = new T.Group(); g.add(m);
  const shoulder = new T.Mesh(new T.PlaneGeometry(wid + 40, len + 120).rotateX(-Math.PI / 2), new T.MeshLambertMaterial({ color: 0x8b8a73, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); shoulder.position.y = -0.05; shoulder.renderOrder = 2; g.add(shoulder);
  // approach lights + a sign
  const lm = new T.MeshBasicMaterial({ color: 0xfff3c0 }); for (let i = 1; i <= 8; i++) for (const z of [len / 2 + i * 30, -len / 2 - i * 30]) { const l = new T.Mesh(new T.BoxGeometry(wid * 0.5, 0.3, 0.6), lm); l.position.set(0, 0.3, z); g.add(l); }
  return g;
}
