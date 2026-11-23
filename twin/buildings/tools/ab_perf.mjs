// A/B: אותו עמוד, אותה מצלמה – חומר החזיתות מול למברט פשוט (קרוב לחומר המקורי של המנוע). node tools/ab_perf.mjs 8852 street
import { createRequire } from 'module';
const require = createRequire('/tmp/pw/node_modules/');
const { chromium } = require('playwright');
const [port, view] = [process.argv[2] || 8852, process.argv[3] || 'street'];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const p = await b.newPage({ viewport: { width: 360, height: 800 } });
await p.goto(`http://127.0.0.1:${port}/buildings/demo.html?view=${view}&dpr=1`);
await p.waitForFunction(() => window.DEMO_READY && window.YZ && window.YZ.loaded, null, { timeout: 180000 });
await p.waitForTimeout(2000);
const r = await p.evaluate(() => { const E = window.YZ.engine, T = E.scene.constructor && window.YZ.engine.renderer && null; const W = document.getElementById('fr').contentWindow, THREE = W.THREE;
  const plain = new THREE.MeshLambertMaterial({ vertexColors: true }), fac = window.API.material, gl = E.renderer.getContext(), px = new Uint8Array(4);
  const groups = E.scene.children.filter(c => c.isGroup && c.children.some(m => m.userData && m.userData.towner));
  const setM = m => groups.forEach(g => g.children.forEach(x => x.material = m));
  const time = (n) => { const t = performance.now(); for (let i = 0; i < n; i++) { E.renderer.render(E.scene, E.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - t) / n; };
  const inst = window.API.root; const res = { plain: [], facade: [], facadeNoClutter: [] };
  for (let k = 0; k < 3; k++) { setM(plain); inst.visible = false; time(1); res.plain.push(time(4)); setM(fac); time(1); res.facadeNoClutter.push(time(4)); inst.visible = true; time(1); res.facade.push(time(4)); }
  const U = window.API.uniforms; const tex0 = U.uHasTex.value; U.uHasTex.value = 0; setM(fac); inst.visible = false; time(1); res.noTex = [time(4), time(4), time(4)]; U.uHasTex.value = tex0; U.uDetail.value = 0; time(1); res.noDetail = [time(4), time(4), time(4)]; U.uDetail.value = 1; window.API.setQuality('lite'); time(2); res.lite = [time(4), time(4), time(4)]; window.API.setQuality('full'); time(2);
  const med = a => a.slice().sort((x, y) => x - y)[1]; return { plainMs: med(res.plain), facadeNoClutterMs: med(res.facadeNoClutter), facadeMs: med(res.facade), noTexMs: med(res.noTex), noDetailMs: med(res.noDetail), liteMs: med(res.lite), calls: E.renderer.info.render.calls, tris: E.renderer.info.render.triangles }; });
console.log(view, JSON.stringify(r)); await b.close();
