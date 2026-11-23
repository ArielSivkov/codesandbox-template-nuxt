// מייצר אובייקטים פרוצדורליים לכל האריחים → data/gen/<key>.json + data/gen/summary.json
// הרצה: node tools/gen_tiles.js <tiles_v_dir> data/style_rules.json data/gen [key1,key2,...]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const PG = require('../js/procgen.js');
const [tdir, rulesPath, outDir, only] = process.argv.slice(2);
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
let keys = fs.readdirSync(tdir).filter(f => f.endsWith('.json.gz')).map(f => f.replace('.json.gz', '')).sort();
if (only) { const s = new Set(only.split(',')); keys = keys.filter(k => s.has(k)); }
const sum = { prov: PG.PROV, generated_by: 'procgen.js', rules_digest: PG.fnv1a(JSON.stringify(rules)).toString(16), tiles: {}, totals: {}, ms_total: 0, ms_max: 0, styles: {} };
for (const k of keys) {
  const tile = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(tdir, k + '.json.gz'))));
  const r = PG.generateTile(tile, rules);
  const o = { key: k, origin: r.origin, prov: r.prov, digest: PG.digest(r), roads: r.roads, kinds: {} };
  for (const kk of PG.KINDS) { o.kinds[kk] = { n: r.kinds[kk].n, d: Array.from(r.kinds[kk].data, v => Math.round(v * 100) / 100) }; sum.totals[kk] = (sum.totals[kk] || 0) + r.kinds[kk].n; }
  for (const rd of r.roads) sum.styles[rd.style] = (sum.styles[rd.style] || 0) + 1;
  fs.writeFileSync(path.join(outDir, k + '.json'), JSON.stringify(o));
  sum.tiles[k] = { n: r.total, ms: r.ms, digest: o.digest, roads: r.roads.length }; sum.ms_total += r.ms; sum.ms_max = Math.max(sum.ms_max, r.ms);
}
sum.ms_total = Math.round(sum.ms_total); sum.n_total = Object.values(sum.totals).reduce((a, b) => a + b, 0);
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(sum, null, 1));
console.log(JSON.stringify({ tiles: keys.length, n_total: sum.n_total, totals: sum.totals, styles: sum.styles, ms_total: sum.ms_total, ms_max: sum.ms_max }));
