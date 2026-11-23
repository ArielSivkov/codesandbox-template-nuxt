// Pre-bakes the far-field textures to data/tex/{region,globe}_{1024,2048}.webp (lossy colour, lossless alpha = water mask)
// by running the same painters in headless Chrome. Usage: node tools/bake.mjs  (needs the demo http server port in /tmp/av_port)
import fs from 'node:fs';
const { chromium } = await import('/tmp/pw/node_modules/playwright/index.mjs');
const port = fs.readFileSync('/tmp/av_port', 'utf8').trim(), base = `http://127.0.0.1:${port}/swarm/aviation/`;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' }); const p = await b.newPage();
await p.goto(base + 'demo.html?city=0&shot=1&scn=globe'); await p.waitForFunction(() => window.SHOT_READY, null, { timeout: 200000 });
const out = await p.evaluate(async base => {
  const { paintGlobe, paintRegion, decodeTerrain } = await import(base + 'src/farfield.js');
  const [region, world, terr] = await Promise.all(['data/region.json', 'data/world.json', 'data/terrain.json'].map(u => fetch(base + u).then(r => r.json())));
  const TR = decodeTerrain(terr), res = {};
  const enc = ({ d, W, H }) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.buffer, d.byteOffset, d.length), W, H), 0, 0); return c.toDataURL('image/webp', 0.86).split(',')[1]; };
  for (const W of [1024, 2048]) { res['globe_' + W] = enc(paintGlobe(world, W)); res['region_' + W] = enc(paintRegion(region, TR, W)); }
  return res;
}, base);
for (const [k, v] of Object.entries(out)) { fs.writeFileSync(`data/tex/${k}.webp`, Buffer.from(v, 'base64')); console.log(k, (Buffer.from(v, 'base64').length / 1024).toFixed(0) + ' KB'); }
await b.close();
