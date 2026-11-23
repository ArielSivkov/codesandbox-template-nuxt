/* מתאם: הרכב של אריאל – אאודי A1 תלת-דלתית לבנה (דור ראשון, 8X), לוחית 73-464-53 (באישור אריאל, 23.11.2026).
 * מחליף את דגם ה-CC0 של רכב השחקן. הלוגיקה של המשחק (תנועה, התנגשות) לא משתנה; הגלגלים שלנו מסתובבים דרך userData.wheels.
 * מידות (מקור): בסיס גלגלים 2,469 מ"מ, רוחב 1,740, גובה 1,416 – Audi MediaCenter (A1 3-door);
 *   אורך 3,954, מפשק קדמי 1,477 – carexpert.com.au (A1 2016/2017). צורת הפרופיל, הגריל והפנסים: לפי תמונות 075–082 (משוער, לא סריקה).
 * תקציב: כ-2,500 משולשים, 8 חומרים. ?ariel-car=0 מכבה.
 */
(function () {
  'use strict';
  const S = { car: null, model: null, hidden: [], wheelsOrig: null };
  const L = 3.954, Wd = 1.740, H = 1.416, WB = 2.469, TRK = 1.477, R = 0.305;   // מטרים
  const PLATE = '73-464-53';

  function plateTex() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 112; const x = c.getContext('2d');
    x.fillStyle = '#f5c400'; x.fillRect(0, 0, 512, 112);
    x.fillStyle = '#1d4fa3'; x.fillRect(0, 0, 58, 112);
    x.fillStyle = '#fff'; x.font = 'bold 30px Arial'; x.textAlign = 'center'; x.fillText('IL', 29, 92);
    x.fillStyle = '#111'; x.font = 'bold 84px Arial'; x.fillText(PLATE, 290, 86);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(3, 3, 506, 106);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function rimTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#16191c'; x.fillRect(0, 0, 128, 128);
    x.translate(64, 64); x.fillStyle = '#c9ced3'; x.beginPath(); x.arc(0, 0, 50, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2a2f34'; for (let i = 0; i < 10; i++) { x.save(); x.rotate(i * Math.PI / 5); x.beginPath(); x.moveTo(-5, -12); x.lineTo(5, -12); x.lineTo(13, -46); x.lineTo(-13, -46); x.closePath(); x.fill(); x.restore(); }
    x.fillStyle = '#d8dde2'; x.beginPath(); x.arc(0, 0, 11, 0, Math.PI * 2); x.fill();
    const t = new THREE.CanvasTexture(c); if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  function build() {
    const T = THREE, g = new T.Group(); g.name = 'ariel-a1';
    const paint = new T.MeshStandardMaterial({ color: 0xf4f5f2, roughness: 0.32, metalness: 0.05, emissive: 0x2a2a2a });
    const glass = new T.MeshStandardMaterial({ color: 0x0d1318, roughness: 0.08, metalness: 0.4, side: T.DoubleSide });
    const black = new T.MeshLambertMaterial({ color: 0x111316 });
    const chrome = new T.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.2, metalness: 0.9 });
    const head = new T.MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.15, metalness: 0.3, emissive: 0x222018, side: T.DoubleSide });
    const tail = new T.MeshStandardMaterial({ color: 0xb3121a, roughness: 0.3, emissive: 0x3a0306 });
    const tire = new T.MeshLambertMaterial({ color: 0x15171a });
    const plateM = new T.MeshBasicMaterial({ map: plateTex() });
    const rimM = new T.MeshLambertMaterial({ map: rimTex() });
    const hz = L / 2, hw = Wd / 2;

    // גוף מעוגל: חתכי רוחב "קופסה מעוגלת" לאורך הרכב, צר יותר למעלה (כמו בתמונות 076, 079), קשתות גלגלים בשפה התחתונה
    const prof = (z, pts) => { for (let i = 0; i < pts.length - 1; i++) { const [z0, y0] = pts[i], [z1, y1] = pts[i + 1]; if (z >= z0 && z <= z1) return y0 + (y1 - y0) * (z - z0) / (z1 - z0); } return pts[z < pts[0][0] ? 0 : pts.length - 1][1]; };
    const TOP = [[-hz, 0.72], [-1.93, 0.98], [-1.66, 1.31], [-1.18, H], [0.22, H - 0.02], [0.95, 0.93], [1.80, 0.79], [1.95, 0.64], [hz, 0.46]];
    const BELT = [[-hz, 0.70], [-1.93, 0.96], [-1.6, 1.02], [0.9, 0.93], [1.8, 0.78], [hz, 0.46]];
    const ra = 0.37, yBot = z => { let y = 0.21; for (const cz of [-WB / 2, WB / 2]) { const d = z - cz; if (Math.abs(d) < ra) y = Math.max(y, R + Math.sqrt(ra * ra - d * d) - 0.02); } return y; };
    const plan = z => 0.80 + 0.20 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(z) / hz, 5)));
    const glassAt = (z, y, x, top) => { const belt = prof(z, BELT);
      if (y < belt + 0.015) return false;
      if (z > 0.24 && z < 0.95) return true;                       // שמשה קדמית
      if (z < -1.66 && z > -1.92) return Math.abs(x) < hw * 0.62 || y < top - 0.04; // שמשה אחורית
      if (z >= -1.62 && z <= 0.90) return y < top - 0.05;           // חלונות צד (הגג נשאר לבן)
      return false; };
    const zone = z => (z > 0.24 && z < 0.95) ? 'ws' : (z < -1.66 && z > -1.93) ? 'rw' : (z >= -1.60 && z <= 0.88) ? 'side' : 'none';
    // חתך: תחתית → צד תחתון (עד קו החגורה) → צד עליון (חלון) → קשת גג; שורות קבועות כדי שקו החלון יהיה חד
    const ring = z => {
      const top = prof(z, TOP), bot = Math.min(yBot(z), top - 0.14), belt = Math.min(Math.max(prof(z, BELT), bot + 0.08), top - 0.02), aw = hw * plan(z);
      const wt = belt + (top - belt) * 0.72, xb = aw * 0.985, xt = aw * (1 - 0.27 * (wt - belt) / Math.max(0.05, top - belt)), zn = zone(z), out = [];
      const side = [];
      for (let k = 0; k <= 3; k++) { const t = k / 3; side.push([aw * (0.86 + 0.12 * Math.sin(t * Math.PI / 2)), bot + (belt - bot) * 0.18 * t, 0]); }
      for (let k = 1; k <= 6; k++) { const t = k / 6; side.push([aw * (0.98 + 0.005 * Math.sin(t * Math.PI)), bot + (belt - bot) * (0.18 + 0.82 * t) - (k === 6 ? 0.004 : 0), 0]); }
      for (let k = 0; k <= 5; k++) { const t = k / 5, y = belt + (wt - belt) * t; side.push([xb + (xt - xb) * t, y, zn === 'none' ? 0 : 1]); }
      for (let k = 1; k <= 8; k++) { const t = k / 8 * Math.PI / 2, x = xt * Math.pow(Math.cos(t), 0.55), y = wt + (top - wt) * Math.pow(Math.sin(t), 0.7);
        const gls = zn === 'ws' || (zn === 'rw' && x < aw * 0.62) || (zn === 'side' && k <= 1) ? 1 : 0; side.push([x, y, gls]); }
      out.push([0, bot, 0]); for (const q of side) out.push(q);
      for (let k = side.length - 2; k >= 0; k--) out.push([-side[k][0], side[k][1], side[k][2]]);
      return out; };
    const M = ring(0).length, N = 96, gl = [], pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const z = -hz + L * i / N; for (const [x, y, gq] of ring(z)) { pos.push(x, y, z); gl.push(gq); } }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a0 = i * M + j, a1 = i * M + (j + 1) % M, b0 = a0 + M, b1 = a1 + M; idx.push(a0, b0, a1, a1, b0, b1); }
    for (const [i0, flip] of [[0, true], [N, false]]) { const cI = pos.length / 3; let sx = 0, sy = 0; for (let j = 0; j < M; j++) { sx += pos[(i0 * M + j) * 3]; sy += pos[(i0 * M + j) * 3 + 1]; }
      pos.push(sx / M, sy / M, -hz + L * i0 / N); gl.push(0);
      for (let j = 0; j < M; j++) { const a0 = i0 * M + j, a1 = i0 * M + (j + 1) % M; if (flip) idx.push(cI, a1, a0); else idx.push(cI, a0, a1); } }
    const body = new T.BufferGeometry(); body.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); body.setIndex(idx); body.computeVertexNormals();
    const bm = new T.Mesh(body, paint); bm.castShadow = true; bm.receiveShadow = true; g.add(bm);
    // מעטפת זכוכית: אותם קודקודים דחופים החוצה, רק משולשים שכולם בתחום החלון – קו חלון חד בלי מריחה
    const nrm = body.attributes.normal.array, gp = new Float32Array(pos.length), gi = [];
    for (let k = 0; k < pos.length; k++) gp[k] = pos[k] + nrm[k] * 0.012;
    for (let k = 0; k < idx.length; k += 3) if (gl[idx[k]] && gl[idx[k + 1]] && gl[idx[k + 2]]) gi.push(idx[k], idx[k + 1], idx[k + 2]);
    const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(gp, 3)); gg.setIndex(gi); gg.computeVertexNormals();
    g.add(new T.Mesh(gg, glass));
    const quad = (a, b, w, mat, off, x0 = 0) => { const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy), phi = Math.atan2(dz, dy);
      const m = new T.Mesh(new T.PlaneGeometry(w, len), mat); m.rotation.x = phi;
      m.position.set(x0, (a[1] + b[1]) / 2 - Math.sin(phi) * off, (a[0] + b[0]) / 2 + Math.cos(phi) * off); g.add(m); return m; };
    // ספוילר גג שחור (כמו בתמונות 080–082)
    const sp = new T.Mesh(new T.BoxGeometry(1.12, 0.045, 0.24), black); sp.position.set(0, 1.315, -1.60); sp.rotation.x = 0.25; g.add(sp);

    // חזית: גריל "מסגרת יחידה" טרפזי, ארבע טבעות, פנסים, פתחי ערפל
    const gr = new T.Shape([[-0.34, 0.66], [0.34, 0.66], [0.30, 0.26], [-0.30, 0.26]].map(([x, y]) => new T.Vector2(x, y)));
    const grM = new T.Mesh(new T.ShapeGeometry(gr), black); grM.position.z = hz + 0.05; g.add(grM);
    const grF = new T.Mesh(new T.ShapeGeometry(gr), chrome); grF.position.z = hz + 0.045; grF.scale.set(1.04, 1.02, 1); grF.position.y = -0.006; g.add(grF);
    const ringG = new T.TorusGeometry(0.045, 0.008, 6, 18);
    for (let i = 0; i < 4; i++) { const r = new T.Mesh(ringG, chrome); r.position.set((i - 1.5) * 0.068, 0.60, hz + 0.06); g.add(r); }
    for (const s of [-1, 1]) {
      quad([1.95, 0.63], [1.84, 0.76], 0.34, head, 0.03, s * 0.50);
      const fog = new T.Mesh(new T.PlaneGeometry(0.32, 0.09), black); fog.position.set(s * 0.58, 0.32, hz + 0.035); g.add(fog);
      const tl = new T.Mesh(new T.BoxGeometry(0.36, 0.13, 0.04), tail); tl.position.set(s * (hw - 0.22), 0.93, -1.965); g.add(tl);
      const mir = new T.Mesh(new T.BoxGeometry(0.2, 0.11, 0.1), paint); mir.position.set(s * (hw * 0.86 + 0.09), 0.99, 0.80); g.add(mir);
      const mirG = new T.Mesh(new T.PlaneGeometry(0.16, 0.08), glass); mirG.position.set(s * (hw * 0.86 + 0.09), 0.99, 0.745); mirG.rotation.y = Math.PI; g.add(mirG);
    }
    // לוחיות 52×11 ס"מ: קדמית על הגריל, אחורית בדלת התא
    const pG = new T.PlaneGeometry(0.52, 0.114);
    const pf = new T.Mesh(pG, plateM); pf.position.set(0, 0.38, hz + 0.065); g.add(pf);
    const pr = new T.Mesh(pG, plateM); pr.position.set(0, 0.74, -hz - 0.045); pr.rotation.y = Math.PI; g.add(pr);
    for (let i = 0; i < 4; i++) { const r = new T.Mesh(ringG, chrome); r.scale.setScalar(0.85); r.position.set((i - 1.5) * 0.058, 0.92, -1.99); r.rotation.y = Math.PI; g.add(r); }

    // גלגלים: צמיג + חישוק 10 חישורים (כמו בתמונות). הם נכנסים ל-userData.wheels כדי שהמשחק יסובב אותם
    const tireG = new T.CylinderGeometry(R, R, 0.205, 20); tireG.rotateZ(Math.PI / 2);
    const rimG = new T.CircleGeometry(R * 0.72, 20);
    const wheels = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const w = new T.Group(); w.position.set(sx * (hw - 0.115), R, sz * WB / 2);   // מפשק 1,477 + צמיג 205 → פני הגלגל כמעט בקו הגוף
      const t = new T.Mesh(tireG, tire); t.castShadow = true; w.add(t);
      const rim = new T.Mesh(rimG, rimM); rim.position.x = sx * 0.104; rim.rotation.y = sx * Math.PI / 2; w.add(rim);
      g.add(w); wheels.push(w);
    }
    g.userData.ownWheels = wheels;
    // צל מגע רך
    const sd = new T.Mesh(new T.PlaneGeometry(Wd + 0.3, L + 0.4), new T.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.32, depthWrite: false })); sd.rotation.x = -Math.PI / 2; sd.position.y = 0.02; g.add(sd);
    return g;
  }

  YZW.register({
    id: 'ariel-car', name: 'הרכב של אריאל (אאודי A1)', dept: 'assets', order: 57,
    init(world) {
      world.scene.traverse(o => { if (!S.car && o.userData && o.userData.wheels && o.isGroup) S.car = o; });
      if (!S.car) throw new Error('רכב המשחק לא נמצא');
      const m = build();
      for (const c of S.car.children) { if (c.visible) { c.visible = false; S.hidden.push(c); } }
      S.car.add(m); S.model = m;
      S.wheelsOrig = S.car.userData.wheels; S.car.userData.wheels = m.userData.ownWheels;
      world.arielCar = { plate: PLATE, model: 'Audi A1 8X 3-door', source: 'photos 075–082' };
    },
    update() {   // המתאם של נכסי CC0 עשוי להיטען אחרינו – מוודאים שהוא נשאר מוסתר
      if (!S.car || !S.model) return; if (!S.model.visible) S.model.visible = true;   // נכסי CC0 נטענים באיחור ומסתירים את כל הילדים
      for (const c of S.car.children) if (c !== S.model && c.visible) { c.visible = false; if (!S.hidden.includes(c)) S.hidden.push(c); }
    },
    dispose() { if (S.model && S.car) S.car.remove(S.model); if (S.car && S.wheelsOrig) S.car.userData.wheels = S.wheelsOrig; for (const c of S.hidden) c.visible = true; S.hidden = []; S.model = null; },
  });
})();
