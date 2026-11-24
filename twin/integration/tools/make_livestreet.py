#!/usr/bin/env python3
"""רחוב חי ביום (24.11.2026): בונה עולם = בסיס + חבילת הרחוב החי.
python3 -I tools/make_livestreet.py <src> <dst>      (src == dst → עדכון במקום, למשל עותק ה-git)
חבילה:
  · adapters/63-livestreet.data.js — עקיפות בניינים ושתילות מתצפית שטח (נתונים בלבד, עם סיבה ומספר תמונה)
  · adapters/63-livestreet.js      — מדרכות/קירות/שיחים/עמודים/פחים/רכבים/עצים (?livestreet=0 מכבה; ?ls_<חלק>=0/1)
  · mods/vehicles/                 — vehicles.js + 5 דגמי רכב פרטי (CC0, מחלקת כלי הרכב) + manifest
  · תיקונים: BD3 (הסתרת בניין לפי YZ_BOVR.hide), VG1 (חשיפת מודול הצמחייה), FM1–FM5 (חומרי חזית 4–7 בתוסף הבניינים)
אין כאן קבצים מתמונות השטח.
"""
import os, sys, shutil, json, subprocess
INT = '/home/claude/swarm/integration'
src = sys.argv[1]; dst = sys.argv[2]
src = src if os.path.isabs(src) else os.path.join(INT, src); dst = dst if os.path.isabs(dst) else os.path.join(INT, dst)
if os.path.abspath(src) != os.path.abspath(dst):
    if os.path.isdir(dst): shutil.rmtree(dst)
    shutil.copytree(src, dst)
for f in ['63-livestreet.data.js', '63-livestreet.js']: shutil.copy2(os.path.join(INT, 'adapters', f), os.path.join(dst, 'adapters', f))
VD = dst + '/mods/vehicles'; os.makedirs(VD + '/models', exist_ok=True)
shutil.copy2('/home/claude/swarm/vehicles/plugin/vehicles.js', VD + '/vehicles.js')
TYPES = ['mini', 'hatch', 'sedan', 'suv', 'mpv']
man = json.load(open('/home/claude/swarm/vehicles/models/manifest.json', encoding='utf-8'))
man['types'] = {k: v for k, v in man['types'].items() if k in TYPES}
json.dump(man, open(VD + '/models/manifest.json', 'w', encoding='utf-8'), ensure_ascii=False)
for t in TYPES: shutil.copy2('/home/claude/swarm/vehicles/models/%s.glb' % t, VD + '/models/%s.glb' % t)

PATCHES = [
 ('BD3-hide', 'js/world.js',
  "    out.push({ id: b.i, name: b.n || '',",
  "    if (_ov && _ov.hide) { (window.YZ_BOVR_HIDDEN = window.YZ_BOVR_HIDDEN || {})[b.i] = { x: cx / n, z: cz / n, note: _ov.note }; continue; }   // רחוב חי: בניין כללי שבתמונות הוא צמחייה\n    out.push({ id: b.i, name: b.n || '',"),
 ('VG1-expose', 'adapters/48-vegetation.js',
  "  const V = { veg: null, keys: new Set(), pending: new Set() };",
  "  const V = window.YZVeg = { veg: null, keys: new Set(), pending: new Set() };   // חשוף לרחוב החי (fillSlots)"),
 ('FM1-pack', 'mods/plugins/buildings/dept/typology.js',
  "((flags.mat & 3) << 12); }", "((flags.mat & 7) << 12); }"),
 ('FM2-unpack', 'mods/plugins/buildings/dept/typology.js',
  "mat: (p >> 12) & 3 }; }", "mat: (p >> 12) & 7 }; }"),
 ('FM3-hint-range', 'mods/plugins/buildings/plugin.js',
  "if (mi != null && mi >= 0 && mi <= 3) flags.mat = mi; }",
  "if (mi != null && mi >= 0 && mi <= 7) flags.mat = mi; }"),
 ('FM4-mats', 'mods/plugins/buildings/dept/facades.js',
  "    else wallC = mix(vec3(0.40, 0.50, 0.56), vec3(0.50, 0.59, 0.65), s1);",
  "    else if (matId < 3.5) wallC = mix(vec3(0.40, 0.50, 0.56), vec3(0.50, 0.59, 0.65), s1);\n"
  "    else if (matId < 4.5) wallC = vec3(0.92, 0.91, 0.87) * (0.98 + 0.04 * s1);   // 4 טיח לבן מחוספס (מועדון השחמט, 061/063)\n"
  "    else if (matId < 5.5) wallC = mix(vec3(0.47, 0.45, 0.43), vec3(0.56, 0.54, 0.51), s1);   // 5 טיח אפור כהה — וילה מודרנית (062)\n"
  "    else if (matId < 6.5) wallC = mix(vec3(0.84, 0.78, 0.66), vec3(0.90, 0.85, 0.74), s1);   // 6 בלוק ישן בז' (055)\n"
  "    else wallC = mix(vec3(0.88, 0.85, 0.77), vec3(0.93, 0.90, 0.83), s1);   // 7 אבן בהירה (מגדלי הדקל) + פס חום"),
 ('FM5-tex', 'mods/plugins/buildings/dept/facades.js',
  "float tx = matId < 0.5 ? texture2D(uTexP, tuv).g / 0.78 : (matId < 1.5 ? texture2D(uTexS, tuv / 1.2).g / 0.62 : 1.0);",
  "float tx = (matId < 0.5 || (matId > 3.5 && matId < 6.5)) ? texture2D(uTexP, tuv).g / 0.78 : ((matId < 1.5 || matId > 6.5) ? texture2D(uTexS, tuv / 1.2).g / 0.62 : 1.0);"),
 ('FM6-stripe', 'mods/plugins/buildings/dept/facades.js',
  "      ${glslParams()}",
  "      if (matId > 6.5 && fract(u / 13.0) < 0.11) alb *= vec3(0.60, 0.46, 0.36);   // פס חום אנכי (מגדלי הדקל)\n      ${glslParams()}"),
]
res = []
for name, f, old, new in PATCHES:
    p = os.path.join(dst, f); s = open(p, encoding='utf-8').read()
    if new in s: res.append((name, 'already')); continue
    if s.count(old) != 1: sys.exit('PATCH FAILED %s: %d matches' % (name, s.count(old)))
    open(p, 'w', encoding='utf-8').write(s.replace(old, new)); res.append((name, 'applied'))
ip = dst + '/index.html'; html = open(ip, encoding='utf-8').read()
anchor = '<script src="adapters/62-beautyday.js"></script>'
assert html.count(anchor) == 1
add = ['<script src="adapters/63-livestreet.data.js"></script>', '<script src="adapters/63-livestreet.js"></script>']
add = [t for t in add if t not in html]
if add: html = html.replace(anchor, anchor + '\n' + '\n'.join(add)); open(ip, 'w', encoding='utf-8').write(html)
for f in ['adapters/63-livestreet.js', 'adapters/63-livestreet.data.js', 'adapters/48-vegetation.js', 'js/world.js', 'mods/vehicles/vehicles.js', 'mods/plugins/buildings/plugin.js']:
    r = subprocess.run(['node', '--check', os.path.join(dst, f)], capture_output=True, text=True)
    if r.returncode: sys.exit('SYNTAX ' + f + r.stderr[:400])
for f in ['mods/plugins/buildings/dept/typology.js', 'mods/plugins/buildings/dept/facades.js']:
    r = subprocess.run(['node', '--check', '--input-type=module'], input=open(os.path.join(dst, f), encoding='utf-8').read(), capture_output=True, text=True)
    if r.returncode and 'export' not in r.stderr and 'import' not in r.stderr: sys.exit('SYNTAX ' + f + r.stderr[:400])
b = json.load(open(dst + '/build.json', encoding='utf-8'))
b['livestreet'] = {'base': os.path.basename(src), 'added': ['adapters/63-livestreet.js', 'adapters/63-livestreet.data.js', 'mods/vehicles (5 דגמים)'], 'patches': dict(res)}
json.dump(b, open(dst + '/build.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(b['livestreet'], ensure_ascii=False))
