const { chromium } = require('/tmp/pw/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 400, height: 300 } })).newPage();
  const out = []; p.on('console', m => { if (/NANSTACK/.test(m.text())) out.push(m.text().slice(0, 900)); });
  await p.addInitScript(() => { const t = setInterval(() => { if (!window.THREE) return; clearInterval(t); const o = THREE.BufferGeometry.prototype.computeBoundingSphere;
    THREE.BufferGeometry.prototype.computeBoundingSphere = function () { o.call(this); if (this.boundingSphere && isNaN(this.boundingSphere.radius)) console.log('NANSTACK ' + (this.name || '') + ' ' + new Error().stack); }; }, 1); });
  await p.goto('http://localhost:8940/world/index.html?auto&nointro&clean=1&t=10:00');
  await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 240000 });
  await p.waitForTimeout(25000);
  console.log([...new Set(out)].slice(0, 4).join('\n----\n')); await b.close();
})();
