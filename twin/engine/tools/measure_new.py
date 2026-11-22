#!/usr/bin/env python3
"""מדידה של אב-הטיפוס החדש (אותם תרחישים כמו measure.py): 360x800, SwiftShader, הגשה מהדיסק דרך page.route."""
import json, mimetypes, os, sys, time
from playwright.sync_api import sync_playwright
root, rel, label = sys.argv[1], sys.argv[2], sys.argv[3]
shots = '--shots' in sys.argv
CE = '--ce' in sys.argv
OUT = '/home/claude/swarm/b6/shots'; BASE = 'http://yz.test/'
stats = {'bytes': 0, 'requests': 0, 'external': [], 'files': []}
def handler(route):
    url = route.request.url
    if not url.startswith(BASE):
        stats['external'].append(url); return route.abort()
    p = os.path.join(root, url[len(BASE):].split('?')[0].split('#')[0])
    if os.path.isdir(p): p = os.path.join(p, 'index.html')
    if not os.path.exists(p): return route.fulfill(status=404, body='nf')
    body = open(p, 'rb').read(); ct = mimetypes.guess_type(p)[0] or 'application/octet-stream'
    if p.endswith('.gz') or p.endswith('.bin'): ct = 'application/octet-stream'
    stats['bytes'] += len(body); stats['requests'] += 1; stats['files'].append(url[len(BASE):])
    hdr = {'content-type': ct, 'content-length': str(len(body))}
    if p.endswith('.gz') and CE:   # כמו Worker שמגיש עם Content-Encoding: gzip – הדפדפן פורס בעצמו
        hdr = {'content-type': 'application/json' if '.json' in p else 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': str(len(body))}
    route.fulfill(status=200, body=body, headers=hdr)
def wait_loaded(page, ms=800):
    page.wait_for_timeout(300)
    page.wait_for_function('window.YZ && window.YZ.loaded', timeout=300000, polling=200)
    page.wait_for_timeout(ms)
with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'])
    ctx = br.new_context(viewport={'width': 360, 'height': 800}, device_scale_factor=2.75, is_mobile=True, has_touch=True, locale='he-IL')
    ctx.route('**/*', handler)
    page = ctx.new_page(); logs = []
    page.on('console', lambda m: logs.append(m.type + ': ' + m.text)); page.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    t0 = time.time()
    page.goto(BASE + rel, wait_until='load', timeout=180000); t_load = time.time() - t0
    page.wait_for_function('window.YZ && window.YZ.ready', timeout=180000); t_ready = time.time() - t0
    wait_loaded(page); t_all = time.time() - t0
    bytes_home = stats['bytes']
    page.evaluate('() => { if (window.gc) window.gc(); }'); page.wait_for_timeout(300)
    info = lambda: page.evaluate('() => window.YZ.info()')
    i_home = info()
    if shots: page.screenshot(path=f'{OUT}/{label}-01-home.png')
    bench_home = page.evaluate('() => window.YZ.bench(20)')
    page.evaluate('() => { const Y = window.YZ; Object.assign(Y.cam, {tx: 0, tz: 0, dist: 900, phi: 0.95, theta: -0.4}); Y.applyCam(); }')
    wait_loaded(page, 1200); i_near = info()
    if shots: page.screenshot(path=f'{OUT}/{label}-02-near.png')
    bench_near = page.evaluate('() => window.YZ.bench(20)')
    page.evaluate('() => { const Y = window.YZ; Object.assign(Y.cam, {tx: 150, tz: -200, dist: 300, phi: 1.12, theta: 0.6}); Y.applyCam(); }')
    wait_loaded(page, 1200); i_close = info()
    if shots: page.screenshot(path=f'{OUT}/{label}-03-close.png')
    page.evaluate('() => { const Y = window.YZ; Object.assign(Y.cam, {tx: 163700 - Y.VO.x, tz: -(633600 - Y.VO.n), dist: 2600, phi: 0.9, theta: -1.2}); Y.applyCam(); }')
    wait_loaded(page, 1200)
    if shots: page.screenshot(path=f'{OUT}/{label}-04-coast.png')
    page.evaluate('() => { const Y = window.YZ; Object.assign(Y.cam, {tx: 0, tz: 0, dist: 420, phi: 0.9, theta: 0.3}); Y.applyCam(); }')
    wait_loaded(page, 800)
    page.evaluate('''() => { const Y = window.YZ; const x = Y.VO.x + Y.cam.tx, n = Y.VO.n - Y.cam.tz; const t = Y.tiles.get(Math.floor(x / 1000) + '_' + Math.floor(n / 1000));
      let best = 0, bd = 1e18; for (let k = 0; k < t.meta.n; k++) { const d = (t.tx*1000 + t.meta.cen[2*k] - x)**2 + (t.ty*1000 + t.meta.cen[2*k+1] - n)**2; if (d < bd && t.meta.area[k] > 300) { bd = d; best = k; } }
      return Y.showBuildingAt(t.key, best); }''')
    page.wait_for_timeout(1500)
    if shots: page.screenshot(path=f'{OUT}/{label}-05-card.png')
    i_end = info()
    page.evaluate('() => { if (window.gc) window.gc(); }'); page.wait_for_timeout(300)
    heap = page.evaluate('() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null')
    res = {'label': label, 'transfer_bytes_total': stats['bytes'], 'transfer_bytes_home': bytes_home, 'requests': stats['requests'], 'external_requests': stats['external'],
           't_load_s': round(t_load, 2), 't_ready_s': round(t_ready, 2), 't_home_complete_s': round(t_all, 2), 'home': i_home, 'near': i_near, 'close': i_close, 'end': i_end, 'heap_end_mb': heap,
           'ms_per_frame_home_swiftshader_synced': round(bench_home, 1), 'ms_per_frame_near_swiftshader_synced': round(bench_near, 1),
           'errors': [l for l in logs if 'error' in l.lower() or 'warn' in l.lower()][:20]}
    print(json.dumps(res, ensure_ascii=False, indent=1))
    json.dump(res, open(f'/home/claude/swarm/b6/tools/measure-{label}.json', 'w'), ensure_ascii=False, indent=1)
    br.close()
