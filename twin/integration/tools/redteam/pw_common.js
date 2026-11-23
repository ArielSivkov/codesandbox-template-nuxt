const { chromium } = require('/tmp/pw/node_modules/playwright');
exports.launch = (extra=[]) => chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', ...extra] });
exports.GAME = ''+(process.env.GAME||'http://localhost:8940/world/index.html')+'';
exports.B6 = 'http://127.0.0.1:8811/b6/map/index.html';
exports.collect = p => { const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); }); p.on('pageerror', e => errs.push('pageerror: ' + e.message)); return errs; };
