import os, mimetypes
from playwright.sync_api import sync_playwright
root='/home/claude/swarm/b6/map'; BASE='http://yz.test/'; OUT='/home/claude/swarm/b6/shots'
def handler(route):
    url=route.request.url
    if not url.startswith(BASE): return route.abort()
    p=os.path.join(root,url[len(BASE):].split('?')[0]); route.fulfill(status=200, body=open(p,'rb').read(), headers={'content-type': mimetypes.guess_type(p)[0] or 'application/octet-stream'})
def wait(pg): pg.wait_for_timeout(400); pg.wait_for_function('window.YZ.loaded', polling=200, timeout=200000); pg.wait_for_timeout(700)
with sync_playwright() as pw:
    br=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    ctx=br.new_context(viewport={'width':360,'height':800}, device_scale_factor=2.75, is_mobile=True, has_touch=True); ctx.route('**/*',handler)
    pg=ctx.new_page(); pg.goto(BASE+'index.html?stats'); pg.wait_for_function('window.YZ && window.YZ.ready'); wait(pg)
    pg.evaluate("() => { document.querySelector('input[value=conf]').click(); const Y = window.YZ; Object.assign(Y.cam, {tx: 0, tz: 0, dist: 2600, phi: 0.85, theta: -0.5}); Y.applyCam(); }"); wait(pg)
    pg.screenshot(path=f'{OUT}/after-06-confidence.png')
    # כרטיס עם מעטפת אי־ודאות: גוללים את הכרטיס כך שהבניין נראה מעליו
    pg.evaluate("() => { document.querySelector('input[value=base]').click(); const Y = window.YZ; Object.assign(Y.cam, {tx: 0, tz: 0, dist: 260, phi: 1.05, theta: 0.4}); Y.applyCam(); }"); wait(pg)
    pg.evaluate('''() => { const Y = window.YZ, x = Y.VO.x + Y.cam.tx, n = Y.VO.n - Y.cam.tz, t = Y.tiles.get(Math.floor(x/1000)+'_'+Math.floor(n/1000)); let best=0, bd=1e18;
      for (let k=0;k<t.meta.n;k++){ const d=(t.tx*1000+t.meta.cen[2*k]-x)**2+(t.ty*1000+t.meta.cen[2*k+1]-n)**2; if(d<bd && t.meta.area[k]>200){bd=d;best=k;} } return Y.showBuildingAt(t.key,best); }''')
    pg.wait_for_timeout(1200); pg.evaluate("() => { const c = document.getElementById('card'); c.style.maxHeight = '34vh'; }"); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/after-07-card-shell.png')
    pg.evaluate("() => { const c = document.getElementById('card'); c.scrollTop = 520; }"); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/after-08-card-facades.png')
    pg2=ctx.new_page(); pg2.goto(BASE+'index.html?roofs=demo'); pg2.wait_for_function('window.YZ && window.YZ.ready'); wait(pg2)
    # מחפשים אריח עם הרבה בתים צמודי קרקע
    key = pg2.evaluate("() => { let best=null, bn=0; for (const t of window.YZ.tiles.values()) { if (!t.meta) continue; let n=0; for (let k=0;k<t.meta.n;k++) if (['house','detached'].includes(t.meta.typ[k])) n++; if (n>bn){bn=n;best=t;} } if(!best) return null; let k0=-1; for (let k=0;k<best.meta.n;k++) if (['house','detached'].includes(best.meta.typ[k])) {k0=k;break;} const Y=window.YZ; Object.assign(Y.cam,{tx: best.tx*1000+best.meta.cen[2*k0]-Y.VO.x, tz: -(best.ty*1000+best.meta.cen[2*k0+1]-Y.VO.n), dist: 180, phi: 1.0, theta: 0.7}); Y.applyCam(); return [best.key, bn]; }")
    print('roof demo tile', key); wait(pg2)
    pg2.screenshot(path=f'{OUT}/after-09-roofs-demo.png')
    br.close()
