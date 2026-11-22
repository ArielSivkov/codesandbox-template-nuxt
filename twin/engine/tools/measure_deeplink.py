"""כמה בייטים נטענים כשנכנסים ישר לרחוב (?at=…), לפני/בלי מבט על כל העיר."""
import json, os, sys, mimetypes
from playwright.sync_api import sync_playwright
root='/home/claude/swarm/b6/map'; BASE='http://yz.test/'; files=[]
def handler(route):
    url=route.request.url
    if not url.startswith(BASE): return route.abort()
    p=os.path.join(root,url[len(BASE):].split('?')[0]); b=open(p,'rb').read(); files.append((p,len(b)))
    route.fulfill(status=200, body=b, headers={'content-type': mimetypes.guess_type(p)[0] or 'application/octet-stream','content-length':str(len(b))})
with sync_playwright() as pw:
    br=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    ctx=br.new_context(viewport={'width':360,'height':800}, device_scale_factor=2.75); ctx.route('**/*',handler)
    pg=ctx.new_page(); pg.goto(BASE+'index.html?at=166264,634405,900')
    pg.wait_for_function('window.YZ && window.YZ.ready'); pg.wait_for_timeout(500); pg.wait_for_function('window.YZ.loaded', polling=200); pg.wait_for_timeout(500)
    i=pg.evaluate('() => window.YZ.info()')
    data=sum(n for p,n in files if '/data/tiles/' in p)
    print(json.dumps({'tiles_loaded': i['tilesLoaded'], 'tile_bytes_gz': data, 'lod': i['lod'], 'calls': i['calls'], 'tris': i['tris'], 'firstFrameMs': i['firstFrameMs'], 'allVisibleMs': i['allVisibleMs']}))
    br.close()
