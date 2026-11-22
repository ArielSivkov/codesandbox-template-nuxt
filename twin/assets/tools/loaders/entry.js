// Classic-script bundle for engines that use window.THREE (r186) – exposes window.ESH_ASSETS.
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from '../node_modules/three/examples/jsm/loaders/KTX2Loader.js';
import { HDRLoader } from '../node_modules/three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from '../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from '../node_modules/three/examples/jsm/utils/SkeletonUtils.js';
window.ESH_ASSETS = { GLTFLoader, KTX2Loader, HDRLoader, MeshoptDecoder, SkeletonUtils, REV: window.THREE && window.THREE.REVISION };
