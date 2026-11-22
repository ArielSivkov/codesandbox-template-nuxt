#!/bin/sh
# Builds pack/vendor/esh-assets-loaders.js (classic script, uses window.THREE r186, exposes window.ESH_ASSETS)
cd "$(dirname "$0")"
npx esbuild loaders/entry.js --bundle --minify --format=iife --alias:three=./loaders/three-global-shim.cjs \
  --define:import.meta.url=__ESH_ASSETS_URL \
  --banner:js="/* ESH27 asset loaders: GLTFLoader, KTX2Loader, HDRLoader, SkeletonUtils from three@0.186.1 (MIT, three.js authors) + meshopt_decoder (MIT, Arseny Kapoulkine). Needs window.THREE r186. Exposes window.ESH_ASSETS. Always call ktx2.setTranscoderPath('<pack>/vendor/basis/'). */
var __ESH_ASSETS_URL=(document.currentScript&&document.currentScript.src)||location.href;" \
  --outfile=../pack/vendor/esh-assets-loaders.js --log-level=error
