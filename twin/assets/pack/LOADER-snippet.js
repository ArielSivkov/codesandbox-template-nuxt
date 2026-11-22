/* ESH27 asset pack – loader snippet for the engine/game teams (three.js r186).
 * Tested in /home/claude/swarm/assets/viewer.html (Chrome, 360x800). Two variants: pick the one that matches your build.
 *
 * ── Variant A: classic scripts with window.THREE (what twin/game and twin/engine use today) ──
 *   <script src="vendor/three.min.js"></script>                       // your r186 build
 *   <script src="ASSETS/vendor/esh-assets-loaders.js"></script>       // exposes window.ESH_ASSETS
 */
function eshCreateLoaders(renderer, ASSETS = 'assets/pack/') {
  const A = window.ESH_ASSETS;
  const ktx2 = new A.KTX2Loader()
    .setTranscoderPath(ASSETS + 'vendor/basis/')   // basis_transcoder.js + .wasm (Apache-2.0)
    .detectSupport(renderer);                       // picks ASTC / ETC2 / BC7 / … per device
  const gltf = new A.GLTFLoader()
    .setMeshoptDecoder(A.MeshoptDecoder)            // models are EXT_meshopt_compression + quantized
    .setKTX2Loader(ktx2);                           // for GLBs with KHR_texture_basisu
  const hdr = new A.HDRLoader();
  return { ktx2, gltf, hdr };
}

/* Material from pack/textures (9 materials, see textures/materials.json: tile_m = metres per repeat)
 * ORM = R:AO, G:roughness, B:metalness  (glTF convention) */
async function eshMaterial(L, name, { size = 512, ktx = true, ASSETS = 'assets/pack/' } = {}) {
  const T = window.THREE;
  const load = (map, srgb) => (ktx ? L.ktx2.loadAsync(`${ASSETS}textures/${name}_${map}_${size}.ktx2`)
                                  : new T.TextureLoader().loadAsync(`${ASSETS}textures/${name}_${map}_${size}.webp`))
    .then(t => { t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = 4; return t; });
  const [map, normalMap, orm] = await Promise.all([load('albedo', true), load('normal'), load('orm')]);
  // NB: KTX2 at 1024 exists only with `node tools/optimize.mjs --hi-ktx2`; default 1024 tier is WebP.
  if (name === 'glass') return new T.MeshStandardMaterial({ map, normalMap, aoMap: null, roughness: 0.05, metalness: 0.6, envMapIntensity: 2.2, color: 0xb8d0dc }); // opaque reflective window
  return new T.MeshStandardMaterial({ map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1 }); // factors × ORM channels
  // set texture.repeat = (surface metres / tile_m) per mesh; aoMap uses uv (r151+ no uv2 needed when aoMap.channel = 0)
}

/* Sky / image-based light (Poly Haven CC0, 512x256 RGBE, ~0.5MB, ~0.3MB gzip) */
async function eshSky(L, renderer, scene, name = 'quarry_01', ASSETS = 'assets/pack/') {
  const T = window.THREE;
  const tex = await L.hdr.loadAsync(`${ASSETS}sky/${name}_512.hdr`);
  tex.mapping = T.EquirectangularReflectionMapping;
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture; pmrem.dispose();
  scene.background = tex;               // or keep the engine's Sky shader and use the HDR only for lighting
  scene.environmentIntensity = 0.6;     // the sun DirectionalLight does the direct light (+ shadows)
}

/* Spinning parts in the procedural models (node names):
 *   helicopter: rotor_main (rotate Y), rotor_tail (rotate X)
 *   drone_quad: prop_0..prop_3 (rotate Y, alternate direction)
 *   car_*: wheel_FL, wheel_FR, wheel_RL, wheel_RR (rotate X; front wheels steer around Y)
 *   jetpack: nozzle_L, nozzle_R (attach flame/particles, pointing −Y)
 * Vehicles face +Z, units are metres, +Y up.
 *
 * ── Variant B: ES modules (bundler / importmap) ──
 * import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
 * import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
 * import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
 * import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
 * const ktx2 = new KTX2Loader().setTranscoderPath('/assets/pack/vendor/basis/').detectSupport(renderer);
 * const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
 *
 * Instancing (budget: ≤150 draw calls): load a prop once, then
 *   const src = (await gltf.loadAsync('…/street_light.glb')).scene;
 *   src.traverse(o => { if (o.isMesh) { const im = new THREE.InstancedMesh(o.geometry, o.material, N); … im.setMatrixAt(i, m); scene.add(im); } });
 *   (apply the node's world matrix × each instance matrix; one InstancedMesh per material)
 */
