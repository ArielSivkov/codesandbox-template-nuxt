import { DatabaseSync } from 'node:sqlite'; import http from 'node:http'; import W from './worker.mjs';
const sql = new DatabaseSync(':memory:');
const DB = { prepare(q) { let args = []; const st = { bind(...a) { args = a; return st; }, async run() { sql.prepare(q).run(...args); return {}; }, async first() { return sql.prepare(q).get(...args) || null; }, async all() { return { results: sql.prepare(q).all(...args) }; } }; return st; } };
http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c;
  const r = await W.fetch(new Request('http://127.0.0.1:8950' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : b }), { DB });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); }).listen(8950, '127.0.0.1');
