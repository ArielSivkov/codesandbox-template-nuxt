#!/usr/bin/env python3
"""עדכון היופי ביום (23.11.2026 13:30): בונה עולם = הבסיס שבקישור היציב (ברירת מחדל world_r3; כעת world_git = עותק של twin/integration/world) + חבילת היום בלבד.
python3 -I tools/make_dayworld.py [src=world_r3] [dst=world_rd]
חבילת היום:
  · adapters/61-beauty.js  — מסלול יום: שמיים כחולים מהתמונות, כמעט בלי עננים ביום בהיר, חשיפה 1.55, שמש/שמיים (לילה ושעת זהב — כמו בסבב 4d)
  · adapters/62-beautyday.js — מועדון שחמט אשדוד (דגם פרוצדורלי, 3 קריאות ציור) + עצי קרקע בלילה
  · mods/plugins/_common/mathooks.js + mods/plugins/ground/plugin.js — תוסף הקרקע (אספלט, מדרכות אדומות, אבני שפה כחול-לבן, מעברי חצייה); עצי התוסף כבויים (נכשלו בזוג 032)
  · תיקונים: BD1/BD2 (עקיפת גובה לבניין המועדון), GR1–GR5 (אספלט בהיר יותר, טלאים אפורים, עצי הקרקע כבויים, בלי דשא תלת־ממדי בשכבה החסכונית)
לא נוגע ב-world_r3. אין כאן קבצים מתמונות השטח.
"""
import os, sys, shutil, json, time
INT = '/home/claude/swarm/integration'
sys.path.insert(0, INT + '/tools'); import patches
src = os.path.join(INT, sys.argv[1] if len(sys.argv) > 1 else 'world_r3'); dst = os.path.join(INT, sys.argv[2] if len(sys.argv) > 2 else 'world_rd')
if os.path.isdir(dst): shutil.rmtree(dst)
shutil.copytree(src, dst)
for f in ['61-beauty.js', '62-beautyday.js']: shutil.copy2(os.path.join(INT, 'adapters', f), os.path.join(dst, 'adapters', f))
# בבסיס סבב 3: מסלול היום בלבד — מתחת ל-4° (שעת זהב ולילה) 61-beauty לא נוגע בכלום, כדי שהלילה יישאר כמו בקישור היציב
BEAUTY_IN_BASE = 'adapters/61-beauty.js' in open(os.path.join(src, 'index.html'), encoding='utf-8').read()
if not BEAUTY_IN_BASE:   # בסיס בלי 61-beauty (סבב 3): יום בלבד + בלי כיפת עננים בשכבה החסכונית (ביצועים)
    bp = os.path.join(dst, 'adapters', '61-beauty.js'); bs = open(bp, encoding='utf-8').read(); assert bs.count('day: { on: true, only: false,') == 1 and bs.count('domeLow: true') == 1
    open(bp, 'w', encoding='utf-8').write(bs.replace('day: { on: true, only: false,', 'day: { on: true, only: true,').replace('domeLow: true', 'domeLow: false'))
os.makedirs(dst + '/mods/plugins/_common', exist_ok=True); os.makedirs(dst + '/mods/plugins/ground', exist_ok=True)
shutil.copy2(INT + '/frozen/plugins/_common/mathooks.js', dst + '/mods/plugins/_common/mathooks.js')
shutil.copy2('/home/claude/swarm/ground/plugin.js', dst + '/mods/plugins/ground/plugin.js')
WANT = ('BD1', 'BD2', 'GR1', 'GR2', 'GR3', 'GR4', 'GR5')
sel = [p for p in patches.PATCHES if p[0].startswith(WANT)]
old = patches.PATCHES; patches.PATCHES = sel
res = patches.apply(dst + '/js', lambda r: None); patches.PATCHES = old
bad = [r for r in res if r[1] != 'applied']
if bad: sys.exit('PATCH FAILED: %r' % bad)
ip = dst + '/index.html'; html = open(ip, encoding='utf-8').read()
anchor = '<script src="adapters/70-present.js"></script>'
assert html.count(anchor) == 1
add = ['<script src="adapters/61-beauty.js"></script>', '<script src="adapters/62-beautyday.js"></script>',
       '<script src="mods/plugins/_common/mathooks.js"></script>', '<script src="mods/plugins/ground/plugin.js"></script>']
if os.environ.get('NOGROUND'): add = add[:2]; shutil.rmtree(dst + '/mods/plugins/ground')   # וריאנט מדידה: בלי תוסף הקרקע
add = [t for t in add if t not in html]   # בסיס שכבר כולל 61-beauty — לא מוסיפים שוב
html = html.replace(anchor, '\n'.join(add) + '\n' + anchor)
open(ip, 'w', encoding='utf-8').write(html)
for f in [x for x in os.listdir(dst + '/adapters') if x.endswith('.js')]:
    import subprocess
    r = subprocess.run(['node', '--check', os.path.join(dst, 'adapters', f)], capture_output=True, text=True)
    if r.returncode: sys.exit('SYNTAX ' + f + r.stderr[:400])
b = json.load(open(dst + '/build.json', encoding='utf-8'))
b['day_update'] = {'built_at': time.strftime('%Y-%m-%d %H:%M:%S'), 'base': os.path.basename(src), 'added': ['adapters/61-beauty.js', 'adapters/62-beautyday.js', 'mods/plugins/ground', 'mods/plugins/_common'], 'patches': dict(res)}
json.dump(b, open(dst + '/build.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(b['day_update'], ensure_ascii=False))
