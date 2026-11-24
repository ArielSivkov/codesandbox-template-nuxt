// מעקה טיילת לבן, 40 מ' – טיוטת qwen2.5-coder (מודל ענן), תוקנה ע"י קלוד: ההיסט z=-1 עבר לקבוצה פנימית (placeITM דורס את position), dispose. כל המידות משוער.
(function () {
  'use strict';
  const E = 166420, N = 636150, POSTS = 21;
  let g = null;
  YZW.register({ id: 'lab-lido-railing', order: 81,
    init(world) {
      const T = THREE; g = new T.Group(); g.name = 'lab-lido-railing';
      const inner = new T.Group(); inner.position.z = -1; g.add(inner); // מטר אחד לכיוון הים משורת העמודונים
      const mat = new T.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0.3, roughness: 0.5 });
      const posts = new T.InstancedMesh(new T.BoxGeometry(0.06, 1.0, 0.06), mat, POSTS), m = new T.Matrix4();
      for (let i = 0; i < POSTS; i++) { m.makeTranslation(-20 + i * 2, 0.5, 0); posts.setMatrixAt(i, m); }
      const top = new T.Mesh(new T.BoxGeometry(40, 0.06, 0.08), mat); top.position.y = 1.0;
      const mid = new T.Mesh(new T.BoxGeometry(40, 0.04, 0.04), mat); mid.position.y = 0.5;
      posts.castShadow = top.castShadow = mid.castShadow = true;
      inner.add(posts, top, mid);
      if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g);
    },
    update() {},
    dispose() { if (g && g.parent) g.parent.remove(g); } });
})();
