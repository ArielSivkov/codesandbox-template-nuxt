#!/usr/bin/env python3
"""בדיקת ממשק המנוע window.YZ.engine (לעולם המשחק): loadAround, buildingAtPoint/Screen, setTime, setMaterials, dispose."""
import json, mimetypes, os
from playwright.sync_api import sync_playwright
root='/home/claude/swarm/b6/map'; BASE='http://yz.test/'
def handler(route):
    url=route.request.url
    if not url.startswith(BASE): return route.abort()
    p=os.path.join(root,url[len(BASE):].split('?')[0]); route.fulfill(status=200, body=open(p,'rb').read(), headers={'content-type': mimetypes.guess_type(p)[0] or 'application/octet-stream'})
R={}
with sync_playwright() as pw:
    br=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    ctx=br.new_context(viewport={'width':360,'height':800}); ctx.route('**/*',handler)
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE+'index.html?at=166264,634405,600'); pg.wait_for_function('window.YZ && window.YZ.ready'); pg.wait_for_timeout(400); pg.wait_for_function('window.YZ.loaded', polling=200)
    R['loadAround_built'] = pg.evaluate('() => window.YZ.engine.loadAround(164500, 631500, 1200, 1)')
    # 40 בניינים: נקודה פנימית אמיתית (מרכז משולש הגג הראשון) → האם חוזר אותו בניין
    R['building_at_point'] = pg.evaluate('''async () => { const E = window.YZ.engine, Y = window.YZ; let ok = 0, tot = 0, sample = null;
      for (const t of Y.tiles.values()) { if (!t.meta || !t.meta.n) continue;
        for (let k = 0; k < t.meta.n && tot < 40; k += 7) { const b0 = await E.buildingAtPoint(t.tx*1000 + t.meta.cen[2*k], t.ty*1000 + t.meta.cen[2*k+1]);
          tot++; if (b0 && b0.key === t.key && b0.k === k) ok++; else if (b0 === null) { /* מרכז מחוץ לטביעה קעורה */ }
          if (!sample && b0) sample = { id: b0.id, f: b0.f, h: b0.h, sg: b0.sg, src: b0.src, rings: b0.rings.length }; }
        if (tot >= 40) break; }
      return { tested: tot, same_building: ok, sample }; }''')
    R['building_at_point_in_sea'] = pg.evaluate('() => window.YZ.engine.buildingAtPoint(162500, 633500)')
    R['building_at_screen'] = pg.evaluate('''() => { const Y = window.YZ, E = Y.engine; let hits = 0, tot = 0;
      for (const t of Y.tiles.values()) { if (!t.meta || !t.mesh.b || t.lod < 1) continue;
        for (let k = 0; k < t.meta.n && tot < 30; k++) { const v = E.toScene(t.tx*1000 + t.meta.cen[2*k], t.ty*1000 + t.meta.cen[2*k+1], t.meta.base[k] + t.meta.h[k] + t.meta.par[k] - 0.2).project(Y.camera);
          if (Math.abs(v.x) > 0.8 || Math.abs(v.y) > 0.8 || v.z > 1) continue; tot++;
          const b = E.buildingAtScreen((v.x + 1) / 2 * 360, (1 - v.y) / 2 * 800); if (b && b.key === t.key && b.k === k) hits++; } }
      return { tested: tot, same_building: hits }; }''')
    R['sun_noon_jun21'] = pg.evaluate("() => window.YZ.engine.setTime(new Date('2026-06-21T09:45:00Z'))")   # ~12:45 שעון קיץ: גובה ~81°
    R['sun_dec21_0730'] = pg.evaluate("() => window.YZ.engine.setTime(new Date('2026-12-21T05:30:00Z'))")
    R['ground_h'] = pg.evaluate('() => window.YZ.engine.groundHeight(166264, 634405)')
    R['setMaterials'] = pg.evaluate('() => { const E = window.YZ.engine; E.setMaterials({ buildings: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffeecc }) }); return [...window.YZ.tiles.values()].filter(t => t.mesh.b && t.mesh.b.material.color.getHex() === 0xffeecc).length; }')
    R['dispose_gpu_verts_after'] = pg.evaluate('() => { window.YZ.engine.dispose(); return window.YZ.info().gpuVerts; }')
    R['errors']=errs
    print(json.dumps(R, ensure_ascii=False, indent=1)); json.dump(R, open('/home/claude/swarm/b6/tools/test-engine.json','w'), ensure_ascii=False, indent=1)
    br.close()
