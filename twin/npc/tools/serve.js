// שרת פיתוח מקומי מצומצם (127.0.0.1 בלבד): /npc/ → תיקיית הדמויות, /game/ → twin/game (קריאה בלבד)
// node tools/serve.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const ROOTS = { npc: path.resolve(__dirname, '..'), game: path.resolve(process.env.GAME_DIR || '/home/claude/codesandbox-template-nuxt/twin/game') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.gz': 'application/octet-stream', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };
const port = +process.argv[2] || 8790;
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const m = /^\/(npc|game)\/(.*)$/.exec(u);
  if (!m) { res.writeHead(404); return res.end('not found'); }
  const root = ROOTS[m[1]], f = path.resolve(root, m[2] || 'index.html');
  if (!f.startsWith(root + path.sep) && f !== root) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, buf) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf); });
}).listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port + '/npc/demo.html'));
