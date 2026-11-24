#!/usr/bin/env python3
"""texfactory/prune.py - משאיר בתיקיית המשחק רק את קבצי זמן הריצה שהמתאם באמת טוען, ומחשב הורדה/זיכרון לכל דרגה.

  python3 -I prune.py <rt_dir> <adapter.js> [--dry]

רשימת הקבצים נקראת מתוך המתאם (adapters/53-materials-hd.js, מילון TIERS) - מקור אמת אחד.
כל השאר (מפות נורמל לחזיתות/קרקע, 2048 שאינו אספלט, דקל) נשאר רק במקור 4096 מחוץ למשחק, ונבנה מחדש ב-make.py.
"""
import json
import os
import re
import sys

from PIL import Image


def tiers_from_adapter(js):
    src = open(js, encoding='utf-8').read()
    m = re.search(r'const TIERS = \{(.*?)\n  \};', src, re.S)
    out = {}
    for name in ('low', 'medium', 'high'):
        t = re.search(name + r': \{(.*?)\} \},', m.group(1), re.S)
        out[name] = sorted(set(re.findall(r"'((?:\d+|macro)/[\w]+\.jpg)'", t.group(1))))
    return out


def main():
    rt, js = sys.argv[1], sys.argv[2]
    dry = '--dry' in sys.argv
    tiers = tiers_from_adapter(js)
    keep = set(f for fs in tiers.values() for f in fs)
    removed = 0
    for d in os.listdir(rt):
        dp = os.path.join(rt, d)
        if not os.path.isdir(dp):
            continue
        for f in os.listdir(dp):
            rel = f'{d}/{f}'
            if rel not in keep:
                removed += 1
                if not dry:
                    os.remove(os.path.join(dp, f))
    report = {}
    for name, fs in tiers.items():
        kb, mb = 0, 0
        for f in fs:
            p = os.path.join(rt, f)
            if not os.path.exists(p):
                print('MISSING', f)
                continue
            kb += os.path.getsize(p) / 1024
            w, h = Image.open(p).size
            mb += w * h * 4 * 4 / 3 / 1048576
        report[name] = {'files': len(fs), 'download_kb': round(kb), 'gpu_mb_est': round(mb, 1)}
    man = os.path.join(rt, 'manifest.json')
    if os.path.exists(man):
        m = json.load(open(man, encoding='utf-8'))
        m['runtime_tiers'] = {k: {'files': tiers[k], **report[k]} for k in tiers}
        m['runtime_note'] = 'רק הקבצים שהמתאם טוען נשארים במשחק; השאר נבנים מחדש מהמקור (make.py)'
        if not dry:
            json.dump(m, open(man, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({'removed': removed, 'tiers': report}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
