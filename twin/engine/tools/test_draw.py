#!/usr/bin/env python3
"""בדיקת כלי "שרטוט מגרש": מצולע חותך (11 נקודות כמו בטלפון של אריאל), חסימת "סיום", סידור, גרירה, הוספה על צלע, מחיקה בלחיצה ארוכה, הצמדה."""
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
root = '/home/claude/swarm/b6/map'; OUT = '/home/claude/swarm/b6/shots'; BASE = 'http://yz.test/'
def handler(route):
    url = route.request.url
    if not url.startswith(BASE): return route.abort()
    p = os.path.join(root, url[len(BASE):].split('?')[0])
    if os.path.isdir(p): p = os.path.join(p, 'index.html')
    if not os.path.exists(p): return route.fulfill(status=404, body='nf')
    route.fulfill(status=200, body=open(p, 'rb').read(), headers={'content-type': mimetypes.guess_type(p)[0] or 'application/octet-stream'})
R = {}
with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = br.new_context(viewport={'width': 360, 'height': 800}, device_scale_factor=2.75, is_mobile=True, has_touch=True, locale='he-IL'); ctx.route('**/*', handler)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + 'index.html'); page.wait_for_function('window.YZ && window.YZ.ready')
    page.evaluate('() => { const Y = window.YZ; Object.assign(Y.cam, {tx: 0, tz: 0, dist: 700, phi: 0.9, theta: 0.3}); Y.applyCam(); }')
    page.wait_for_timeout(400); page.wait_for_function('window.YZ.loaded', polling=200); page.wait_for_timeout(600)
    page.click('#bDraw'); page.wait_for_timeout(1200); page.wait_for_function('window.YZ.loaded', polling=200); page.wait_for_timeout(500)
    R['phi_after_start'] = page.evaluate('() => window.YZ.cam.phi')
    # 11 נקודות בסדר "זיגזג" → מצולע חותך
    pts = [(80,250),(280,250),(80,420),(280,420),(80,600),(280,600),(180,640),(300,520),(60,520),(300,330),(60,330)]
    for x, y in pts:
        page.evaluate(f'() => window.YZ.addPlotPoint({x}, {y})')
    page.wait_for_timeout(500)
    R['n_points'] = page.evaluate('() => window.YZ.plot.pts.length')
    R['crossing_edges'] = page.evaluate('() => window.YZ.crossings(window.YZ.plot.pts).length / 2')
    R['done_disabled_when_crossing'] = page.evaluate("() => document.getElementById('dDone').disabled")
    R['bar_text_crossing'] = page.inner_text('#drawTxt')
    page.screenshot(path=f'{OUT}/draw-01-crossing.png')
    page.click('#dSort'); page.wait_for_timeout(500)
    R['crossing_after_sort'] = page.evaluate('() => window.YZ.crossings(window.YZ.plot.pts).length / 2')
    R['done_disabled_after_sort'] = page.evaluate("() => document.getElementById('dDone').disabled")
    R['bar_text_sorted'] = page.inner_text('#drawTxt')
    page.screenshot(path=f'{OUT}/draw-02-sorted.png')
    # גרירת נקודה 0 (אירועי מצביע אמיתיים על הקנבס)
    p0 = page.evaluate('() => window.YZ.toScreen(window.YZ.plot.pts[0])')
    before = page.evaluate('() => window.YZ.plot.pts[0].slice()')
    page.mouse.move(p0[0], p0[1]); page.mouse.down(); page.mouse.move(p0[0] + 20, p0[1] + 30, steps=6)
    page.wait_for_timeout(300); page.screenshot(path=f'{OUT}/draw-03-drag-loupe.png'); page.mouse.up(); page.wait_for_timeout(300)
    after = page.evaluate('() => window.YZ.plot.pts[0].slice()')
    R['drag_moved_m'] = round(((after[0]-before[0])**2 + (after[1]-before[1])**2) ** 0.5, 1)
    # הקשה על אמצע צלע → הוספה במקום הנכון
    n0 = page.evaluate('() => window.YZ.plot.pts.length')
    mid = page.evaluate('() => { const Y = window.YZ, a = Y.toScreen(Y.plot.pts[2]), b = Y.toScreen(Y.plot.pts[3]); return [(a[0]+b[0])/2, (a[1]+b[1])/2]; }')
    page.evaluate(f'() => window.YZ.addPlotPoint({mid[0]}, {mid[1]})')
    R['insert_on_edge_index'] = page.evaluate(f'() => {{ const Y = window.YZ; return Y.plot.pts.findIndex(q => {{ const s = Y.toScreen(q); return Math.hypot(s[0]-{mid[0]}, s[1]-{mid[1]}) < 25; }}); }}')
    R['points_after_insert'] = page.evaluate('() => window.YZ.plot.pts.length') - n0
    # לחיצה ארוכה על נקודה → מחיקה
    p1 = page.evaluate('() => window.YZ.toScreen(window.YZ.plot.pts[1])')
    n1 = page.evaluate('() => window.YZ.plot.pts.length')
    page.mouse.move(p1[0], p1[1]); page.mouse.down(); page.wait_for_timeout(800); page.mouse.up(); page.wait_for_timeout(200)
    R['long_press_deleted'] = n1 - page.evaluate('() => window.YZ.plot.pts.length')
    # הצמדה: הקשה ליד פינת בניין
    snap = page.evaluate('''() => { const Y = window.YZ; for (const t of Y.tiles.values()) { const m = t.mesh.b; if (!m || t.d > 600) continue;
        const pos = m.geometry.attributes.position.array, nrm = m.geometry.attributes.normal.array, nb = m.userData.own.length;
        for (let i = 0; i < nb; i++) if (nrm[i*3+1] >= 120) { const q = [pos[i*3] + t.ox + Y.VO.x, -(pos[i*3+2] - t.on) + Y.VO.n]; const v = new THREE.Vector3(pos[i*3] + t.ox, pos[i*3+1], pos[i*3+2] - t.on).project(Y.camera); const s = [(v.x+1)/2*360, (1-v.y)/2*800];
          if (s[0] > 40 && s[0] < 320 && s[1] > 200 && s[1] < 560) return { q, s }; } } return null; }''')
    if snap:
        n2 = page.evaluate('() => window.YZ.plot.pts.length')
        page.evaluate('() => window.YZ.plot.pts.splice(0)')   # מגרש חדש לבדיקת ההצמדה
        page.evaluate(f"() => window.YZ.addPlotPoint({snap['s'][0] + 9}, {snap['s'][1] - 7})")
        got = page.evaluate('() => window.YZ.plot.pts[0]')
        R['tap_offset_px'] = [9, -7]
        R['snapped_to_corner_dist_m'] = page.evaluate(f'''() => {{ const Y = window.YZ, g = {json.dumps(got)}; let bd = 1e9;
          for (const t of Y.tiles.values()) {{ const m = t.mesh.b; if (!m) continue; const pos = m.geometry.attributes.position.array, nrm = m.geometry.attributes.normal.array, nb = m.userData.own.length;
            for (let i = 0; i < nb; i++) if (nrm[i*3+1] >= 120) bd = Math.min(bd, Math.hypot(pos[i*3] + t.ox + Y.VO.x - g[0], -(pos[i*3+2] - t.on) + Y.VO.n - g[1])); }} return Math.round(bd*100)/100; }}''')
    R['errors'] = errs
    print(json.dumps(R, ensure_ascii=False, indent=1))
    json.dump(R, open('/home/claude/swarm/b6/tools/test-draw.json', 'w'), ensure_ascii=False, indent=1)
    br.close()
