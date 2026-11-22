import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
root='/home/claude/swarm/b6/map'; BASE='http://yz.test/'
def handler(route):
    url=route.request.url
    if not url.startswith(BASE): return route.abort()
    p=os.path.join(root,url[len(BASE):].split('?')[0])
    if not os.path.exists(p): print('404',p); return route.fulfill(status=404, body='nf')
    route.fulfill(status=200, body=open(p,'rb').read(), headers={'content-type': mimetypes.guess_type(p)[0] or 'application/octet-stream'})
with sync_playwright() as pw:
    br=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    ctx=br.new_context(viewport={'width':360,'height':800}); ctx.route('**/*',handler)
    pg=ctx.new_page(); pg.on('console',lambda m:print('C',m.type,m.text[:300])); pg.on('pageerror',lambda e:print('E',e))
    pg.goto(BASE+(sys.argv[1] if len(sys.argv)>1 else 'index.html')); pg.wait_for_timeout(8000)
    print(pg.evaluate("() => window.YZ ? JSON.stringify({info: window.YZ.info(), loaded: window.YZ.loaded, bad:[...window.YZ.tiles.values()].filter(t=>t.vis && t.lod!==t.want).map(t=>[t.key,t.lod,t.want,t.busy]).slice(0,10)}) : document.body.innerText.slice(0,300)"))
    br.close()
