"""בדיקת game/js/itm.js מול pyproj (EPSG:4326 ⇄ EPSG:2039): python3 tools/test-itm.py"""
import json, random, subprocess, os, sys
from pyproj import Transformer
random.seed(42)
pts = [(random.uniform(29.5, 33.3), random.uniform(34.3, 35.9)) for _ in range(300)]
fw = Transformer.from_crs(4326, 2039, always_xy=True)
ref = [fw.transform(lon, lat) for lat, lon in pts]
js = os.path.join(os.path.dirname(__file__), '..', 'js', 'itm.js')
code = f"const I=require({json.dumps(os.path.abspath(js))});const P={json.dumps(pts)},R={json.dumps(ref)};" \
       "const o=P.map(([la,lo],i)=>{const a=I.wgs84ToItm(la,lo),b=I.itmToWgs84(R[i][0],R[i][1]);return [a.E-R[i][0],a.N-R[i][1],(b.lat-la)*111320,(b.lon-lo)*111320*Math.cos(la*Math.PI/180)];});console.log(JSON.stringify(o))"
d = json.loads(subprocess.check_output(['node', '-e', code]))
fwd = max((x*x + y*y) ** .5 for x, y, _, _ in d); inv = max((x*x + y*y) ** .5 for _, _, x, y in d)
print(f'WGS84→ITM שגיאה מרבית {fwd*1000:.2f} מ"מ · ITM→WGS84 {inv*1000:.2f} מ"מ (300 נקודות בישראל, מול PROJ)')
sys.exit(0 if fwd < 0.01 and inv < 0.01 else 1)
