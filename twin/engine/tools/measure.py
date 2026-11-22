#!/usr/bin/env python3
"""מדידת ביצועים בדפדפן חסר ראש (Chrome + SwiftShader), 360x800, בלי שרת:
הבקשות ל-http://yz.test/ מוגשות מהדיסק דרך page.route.
שימוש: measure.py <root_dir> <path_in_root> <label> [--shots]
"""
import json, mimetypes, os, sys, time
from playwright.sync_api import sync_playwright

root, rel, label = sys.argv[1], sys.argv[2], sys.argv[3]
NEW = '--new' in sys.argv
shots = '--shots' in sys.argv
OUT = '/home/claude/swarm/b6/shots'
BASE = 'http://yz.test/'
stats = {'bytes': 0, 'requests': 0, 'external': []}


def handler(route):
    url = route.request.url
    if not url.startswith(BASE):
        stats['external'].append(url)
        return route.abort()
    p = os.path.join(root, url[len(BASE):].split('?')[0].split('#')[0])
    if os.path.isdir(p):
        p = os.path.join(p, 'index.html')
    if not os.path.exists(p):
        return route.fulfill(status=404, body='nf')
    body = open(p, 'rb').read()
    ct = mimetypes.guess_type(p)[0] or 'application/octet-stream'
    if p.endswith('.bin'):
        ct = 'application/octet-stream'
    stats['bytes'] += len(body); stats['requests'] += 1
    route.fulfill(status=200, body=body, headers={'content-type': ct})


with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=[
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--enable-precise-memory-info', '--js-flags=--expose-gc'])
    ctx = br.new_context(viewport={'width': 360, 'height': 800}, device_scale_factor=2.75, is_mobile=True, has_touch=True,
                         locale='he-IL')
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    page.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    page.route('**/*', handler)
    t0 = time.time()
    page.goto(BASE + rel, wait_until='load', timeout=180000)
    t_load = time.time() - t0
    page.wait_for_function('window.YZ && window.YZ.ready', timeout=180000)
    t_ready = time.time() - t0
    page.wait_for_function('window.YZ.loaded', timeout=300000, polling=500)
    t_all = time.time() - t0
    page.wait_for_timeout(800)
    nav = page.evaluate('''() => { const n = performance.getEntriesByType('navigation')[0];
      const r = performance.getEntriesByType('resource');
      return { domInteractive: n.domInteractive, domContentLoaded: n.domContentLoadedEventEnd, loadEvent: n.loadEventEnd,
               resources: r.length } }''')
    def info():
        return page.evaluate('() => { const i = window.YZ.info(); i.heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null; i.geomMem = window.YZ.renderer.info.memory; return i; }')
    page.evaluate('() => { if (window.gc) window.gc(); }')
    page.wait_for_timeout(300)
    i_home = info()
    if shots:
        page.screenshot(path=f'{OUT}/{label}-01-home.png')
    SYNC = '''() => { const Y = window.YZ, gl = Y.renderer.getContext(), px = new Uint8Array(4), s = performance.now();
      for (let i = 0; i < 20; i++) { Y.cam.theta += 0.01; Y.applyCam(); Y.renderer.render(Y.scene, Y.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - s) / 20; }'''
    bench_home = page.evaluate(SYNC)
    # קירוב לאזור עירוני
    page.evaluate('() => { const Y = window.YZ; Object.assign(Y.cam, {tx: Y.CEN[0][0], tz: -Y.CEN[0][1], dist: 900, phi: 0.95, theta: -0.4}); Y.applyCam(); }')
    page.wait_for_function('window.YZ.loaded', timeout=300000, polling=500)
    page.wait_for_timeout(1500)
    i_near = info()
    if shots:
        page.screenshot(path=f'{OUT}/{label}-02-near.png')
    bench_near = page.evaluate(SYNC)
    # מבט קרוב מאוד עם הטיה – פרטי גגות/קומות
    page.evaluate('''() => { const Y = window.YZ; let best = 0, bh = 0; for (let k = 0; k < Y.nb; k++) { const h = Y.heightOf ? Y.heightOf(k) : 0; if (h > bh) { bh = h; best = k; } }
       Object.assign(Y.cam, {tx: Y.CEN[best][0], tz: -Y.CEN[best][1], dist: 320, phi: 1.15, theta: 0.6}); Y.applyCam(); }''')
    page.wait_for_function('window.YZ.loaded', timeout=300000, polling=500)
    page.wait_for_timeout(1500)
    if shots:
        page.screenshot(path=f'{OUT}/{label}-03-close.png')
    # חוף
    page.evaluate('() => { const Y = window.YZ; Object.assign(Y.cam, {tx: -2600, tz: -800, dist: 2600, phi: 0.9, theta: -1.2}); Y.applyCam(); }')
    page.wait_for_function('window.YZ.loaded', timeout=300000, polling=500)
    page.wait_for_timeout(1500)
    if shots:
        page.screenshot(path=f'{OUT}/{label}-04-coast.png')
    # בחירת בניין + כרטיס
    sel = page.evaluate('''() => { const Y = window.YZ; let k = 0, ba = 0; for (let i = 0; i < Y.nb; i++) if (Y.B[i].a > ba && Y.B[i].a < 2000) { ba = Y.B[i].a; k = i; }
       Object.assign(Y.cam, {tx: Y.CEN[k][0], tz: -Y.CEN[k][1], dist: 420, phi: 0.9, theta: 0.3}); Y.applyCam(); return k; }''')
    page.wait_for_function('window.YZ.loaded', timeout=300000, polling=500)
    page.wait_for_timeout(800)
    page.evaluate(f'() => window.YZ.showBuilding({sel})')
    page.wait_for_timeout(800)
    if shots:
        page.screenshot(path=f'{OUT}/{label}-05-card.png')
    i_end = info()
    res = {'label': label, 'transfer_bytes': stats['bytes'], 'requests': stats['requests'], 'external_requests': stats['external'],
           't_load_s': round(t_load, 2), 't_ready_s': round(t_ready, 2), 't_all_tiles_s': round(t_all, 2), 'nav': nav,
           'home': i_home, 'near': i_near, 'end': i_end,
           'ms_per_frame_home_swiftshader_synced': round(bench_home, 1), 'ms_per_frame_near_swiftshader_synced': round(bench_near, 1),
           'errors': [l for l in logs if 'error' in l.lower()][:20]}
    print(json.dumps(res, ensure_ascii=False, indent=1))
    json.dump(res, open(f'/home/claude/swarm/b6/tools/measure-{label}.json', 'w'), ensure_ascii=False, indent=1)
    br.close()
