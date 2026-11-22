#!/usr/bin/env python3
"""מרכיב את map/index.html מהתבנית + ה-CSS של המפה המקורית (קריאה בלבד מהמאגר)."""
import sys
src = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/repo/yazam/map/index.html'
h = open(src, encoding='utf-8').read()
css = h[h.index('<style>') + 7:h.index('</style>')]
t = open('/home/claude/swarm/b6/tools/index.template.html', encoding='utf-8').read().replace('/*ORIG_CSS*/', css.strip())
open('/home/claude/swarm/b6/map/index.html', 'w', encoding='utf-8').write(t)
print(len(t))
