// ESH27 mobile asset pipeline: GLB -> meshopt-compressed, quantized, welded GLB with WebP textures;
// PNG PBR maps -> KTX2 (Basis ETC1S/UASTC, mipmapped) + WebP fallback, at 512 (mobile) and 1024 (high tier).
// Writes pack/report.json and pack/REPORT-sizes.txt with before/after sizes, triangles and GPU memory estimates.
// Usage: node optimize.mjs <buildDir> <packDir> [--no-ktx2]
import fs from 'node:fs'; import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, meshopt, textureCompress, resample, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const [BUILD, PACK] = process.argv.slice(2); const NO_KTX = process.argv.includes('--no-ktx2'), HI_KTX = process.argv.includes('--hi-ktx2'), UASTC_NORMALS = !process.argv.includes('--etc1s-normals');
// default: KTX2 (ETC1S, also for normals: smallest download) at 512 only; 1024 tier as WebP. --hi-ktx2 adds KTX2 at 1024, normals default to UASTC+RDO+zstd (Khronos KTX Artist Guide); --etc1s-normals = smaller but blockier.
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// ---- budgets (see BUDGET-mobile.txt) ----
const BUDGET = { prop_tris: 2000, vehicle_tris: 5000, character_tris: 8000, tree_tris: 1500, glb_kb: 150, tex_px_mobile: 512, tex_px_high: 1024 };
const kind = (n) => /car|truck|moto|heli|drone|jetpack/.test(n) ? 'vehicle_tris' : /palm|^tree|olive|ficus/.test(n) ? 'tree_tris' : /char|ubc|ual/.test(n) ? 'character_tris' : 'prop_tris';

const imageDecoder = async (buf) => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: new Uint8Array(data), width: info.width, height: info.height }; };
const report = { generated: new Date().toISOString(), budgets: BUDGET, models: [], textures: [] };
const kb = (b) => Math.round(b / 102.4) / 10;

function tris(doc) { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return Math.round(t); }

// ---------------- models ----------------
fs.mkdirSync(`${PACK}/models`, { recursive: true });
for (const f of fs.readdirSync(`${BUILD}/models`).filter(f => f.endsWith('.glb')).sort()) {
  const src = `${BUILD}/models/${f}`, dst = `${PACK}/models/${f}`;
  const doc = await io.read(src); const before = fs.statSync(src).size;
  await doc.transform(
    dedup(), prune(), weld(), resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [BUDGET.tex_px_mobile, BUDGET.tex_px_mobile], quality: 82 }),
    quantize({ quantizePosition: 14, quantizeNormal: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(dst, doc);
  const after = fs.statSync(dst).size, t = tris(doc), b = getBounds(doc.getRoot().listScenes()[0]);
  const lim = BUDGET[kind(f)];
  report.models.push({ file: `models/${f}`, before_kb: kb(before), after_kb: kb(after), tris: t, tri_budget: lim, within_budget: t <= lim && after / 1024 <= BUDGET.glb_kb,
    size_m: b.max.map((v, i) => Math.round((v - b.min[i]) * 100) / 100), materials: doc.getRoot().listMaterials().length, draw_calls: doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0) });
  console.log('model', f, kb(before), '->', kb(after), 'KB', t, 'tris');
}

// ---------------- textures ----------------
fs.mkdirSync(`${PACK}/textures`, { recursive: true });
const texDir = `${BUILD}/tex`;
for (const f of fs.readdirSync(texDir).filter(f => f.endsWith('.png')).sort()) {
  const base = f.replace('.png', ''), isNormal = base.endsWith('_normal'), isColor = base.endsWith('_albedo');
  const srcBuf = fs.readFileSync(`${texDir}/${f}`);
  for (const px of [BUDGET.tex_px_mobile, BUDGET.tex_px_high]) {
    const png = await sharp(srcBuf).resize(px, px).png().toBuffer();
    const webp = await sharp(png).webp({ quality: isNormal ? 90 : 80 }).toBuffer();
    const name = `${base}_${px}`;
    fs.writeFileSync(`${PACK}/textures/${name}.webp`, webp);
    let ktxSize = null;
    if (!NO_KTX && (px === BUDGET.tex_px_mobile || HI_KTX)) {
      const opts = isNormal
        ? (UASTC_NORMALS ? { isUASTC: true, isNormalMap: true, enableRDO: true, rdoQualityLevel: 3.0, needSupercompression: true, generateMipmap: true, isPerceptual: false }
                         : { isUASTC: false, isNormalMap: true, qualityLevel: 200, compressionLevel: 2, generateMipmap: true, isPerceptual: false })
        : { isUASTC: false, qualityLevel: 160, compressionLevel: 2, generateMipmap: true, isPerceptual: isColor };
      const ktx = await encodeToKTX2(new Uint8Array(png), { ...opts, imageDecoder });
      fs.writeFileSync(`${PACK}/textures/${name}.ktx2`, ktx); ktxSize = ktx.length;
    }
    // GPU memory: RGBA8 uncompressed = 4 B/px; ETC1S -> ETC1/ETC2-RGB = 0.5 B/px; UASTC -> ASTC4x4/ETC2-RGBA = 1 B/px; mip chain x1.333
    report.textures.push({ file: `textures/${name}`, px, source_png_kb: kb(srcBuf.length), webp_kb: kb(webp.length), ktx2_kb: ktxSize && kb(ktxSize),
      gpu_mb_if_webp: Math.round(px * px * 4 * 1.333 / 1048576 * 100) / 100, gpu_mb_if_ktx2: Math.round(px * px * (isNormal && UASTC_NORMALS ? 1 : 0.5) * 1.333 / 1048576 * 100) / 100 });
    console.log('tex', name, 'webp', kb(webp.length), 'ktx2', ktxSize && kb(ktxSize));
  }
}
fs.copyFileSync(`${texDir}/materials.json`, `${PACK}/textures/materials.json`);

// ---------------- text report ----------------
const L = ['ESH27 – דוח גדלים לפני/אחרי (נוצר אוטומטית ע"י tools/optimize.mjs)', '', 'מודלים: קובץ | לפני KB | אחרי KB | משולשים / תקציב | קריאות ציור | בתקציב?'];
for (const m of report.models) L.push(`${m.file} | ${m.before_kb} | ${m.after_kb} | ${m.tris}/${m.tri_budget} | ${m.draw_calls} | ${m.within_budget ? 'כן' : 'לא'}`);
const sum = (a, k) => Math.round(a.reduce((s, x) => s + (x[k] || 0), 0) * 10) / 10;
L.push(`סה"כ מודלים: לפני ${sum(report.models, 'before_kb')} KB, אחרי ${sum(report.models, 'after_kb')} KB`, '', 'טקסטורות: קובץ | PNG מקור KB | WebP KB | KTX2 KB | זיכרון GPU ב-WebP MB | ב-KTX2 MB');
for (const t of report.textures) L.push(`${t.file} | ${t.source_png_kb} | ${t.webp_kb} | ${t.ktx2_kb} | ${t.gpu_mb_if_webp} | ${t.gpu_mb_if_ktx2}`);
for (const px of [512, 1024]) { const a = report.textures.filter(t => t.px === px); L.push(`סה"כ ${px}: WebP ${sum(a, 'webp_kb')} KB, KTX2 ${sum(a, 'ktx2_kb')} KB, זיכרון GPU ${sum(a, 'gpu_mb_if_webp')} MB (WebP) מול ${sum(a, 'gpu_mb_if_ktx2')} MB (KTX2)`); }
fs.writeFileSync(`${PACK}/report.json`, JSON.stringify(report, null, 1));
fs.writeFileSync(`${PACK}/REPORT-sizes.txt`, L.join('\n') + '\n');
console.log(L.slice(-3).join('\n'));
