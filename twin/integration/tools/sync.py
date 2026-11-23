#!/usr/bin/env python3
"""בונה מחדש את integration/world מעותק טרי של swarm/game + המארח + מתאמים + מודולי המחלקות.
לא נוגע בתיקיות המחלקות (קריאה בלבד). הרצה: python3 tools/sync.py
"""
import os, shutil, json, re, time, sys

SW = '/home/claude/swarm'
INT = SW + '/integration'
WORLD = os.environ.get('YZ_WORLD', INT + '/world')
SKIP = shutil.ignore_patterns('shots', 'tools', 'node_modules', '_dl', '__pycache__', '.pytest_cache', 'tests', 'test', 'redteam-rerun', '*.md')

# מחלקה -> (מקור, רשימת קבצים/תיקיות להעתקה בתוך mods/<id>/). '*' = כל התיקייה (בלי SKIP)
MODS = {
    'physics':    (SW + '/physics',    ['dist/esh27-physics.js', 'src']),
    'weather':    (SW + '/weather',    ['weather.js']),
    'present':    (SW + '/present',    ['*']),
    'atmosphere': (SW + '/atmosphere', ['src']),
    'buildings':  (SW + '/buildings',  ['*']),
    'audio':      (SW + '/audio',      ['*']),
    'transport':  (SW + '/transport',  ['*']),
    'vegetation': (SW + '/vegetation', ['vegetation.js', 'species.data.js', 'data/tiles/g']),
    'maritime':   (SW + '/maritime',   ['maritime.js', 'src', 'fixtures']),
    'npc':        (SW + '/npc',        ['*']),
    'aviation':   (SW + '/aviation',   ['src']),
    'procgen':    (SW + '/procgen',    ['js/procgen.js', 'data/style_rules.json']),
    'npc':        (SW + '/npc',        ['js', 'data']),
    'buildings':  (SW + '/buildings',  ['src']),
    'sky':        (SW + '/sky',        ['dist/esh27-sky.js']),
    'assets':     (SW + '/assets/pack', ['models', 'vendor', 'report.json']),
}

# מודולים שיש להם מתאם פעיל – רק הם מועתקים (השאר נבדקים ומדווחים)
WIRED = {'physics', 'weather', 'present', 'audio', 'maritime', 'atmosphere', 'sky', 'vegetation', 'aviation', 'procgen'}

def copy_item(src, dst):
    if os.path.isdir(src):
        shutil.copytree(src, dst, ignore=SKIP, dirs_exist_ok=True)
    elif os.path.isfile(src):
        os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst)

def main():
    t0 = time.time()
    if os.path.isdir(WORLD): shutil.rmtree(WORLD)
    shutil.copytree(SW + '/game', WORLD, ignore=SKIP)
    shutil.copytree(INT + '/host', WORLD + '/host')
    shutil.copytree(INT + '/adapters', WORLD + '/adapters')
    found = {}
    for mid, (src, items) in MODS.items():
        if mid not in WIRED:
            found[mid] = ('present-not-wired' if os.path.isdir(src) and os.listdir(src) else 'absent'); continue
        if not os.path.isdir(src) or not os.listdir(src):
            found[mid] = 'absent'; continue
        n = 0
        for it in items:
            if it == '*':
                for e in os.listdir(src):
                    if SKIP(src, [e]): continue
                    copy_item(os.path.join(src, e), os.path.join(WORLD, 'mods', mid, e)); n += 1
            else:
                p = os.path.join(src, it)
                if os.path.exists(p):
                    copy_item(p, os.path.join(WORLD, 'mods', mid, os.path.basename(it) if it.startswith('dist/') else it)); n += 1
        found[mid] = 'copied(%d)' % n if n else 'empty'
    # תיקוני הצוות האדום על העותק בלבד
    sys.path.insert(0, INT + '/tools'); import patches
    pres = patches.apply(WORLD + '/js', lambda r: None)
    # index.html: מוסיפים את המארח אחרי game.js, ומחליפים כותרת
    ip = WORLD + '/index.html'
    html = open(ip, encoding='utf-8').read()
    tags = ['<link rel="stylesheet" href="host/host.css">']
    tags.append('<script src="host/host.js"></script>')
    adapters = sorted(f for f in os.listdir(INT + '/adapters') if f.endswith('.js'))
    for f in adapters: tags.append('<script src="adapters/%s"></script>' % f)
    inj = '\n'.join(tags)
    if '<script src="js/game.js"></script>' not in html: sys.exit('game.js tag not found in index.html')
    # המארח נטען לפני game.js כדי ללכוד את הרנדרר מוקדם; המתאמים אחרי
    html = html.replace('<script src="js/game.js"></script>', '<script src="host/host.js"></script>\n<script src="js/game.js"></script>\n' + '\n'.join(tags[2:]))
    html = html.replace('</head>', tags[0] + '\n</head>')
    html = re.sub(r'<title>.*?</title>', '<title>לוח היזם · עולם תאום · אשדוד</title>', html)
    open(ip, 'w', encoding='utf-8').write(html)
    st = os.stat(SW + '/game/js/game.js')
    info = {'built_at': time.strftime('%Y-%m-%d %H:%M:%S'), 'game_js_mtime': time.strftime('%H:%M:%S', time.localtime(st.st_mtime)), 'mods': found, 'adapters': adapters, 'patches': dict(pres)}
    json.dump(info, open(WORLD + '/build.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(info, ensure_ascii=False), '%.1fs' % (time.time() - t0))

main()
