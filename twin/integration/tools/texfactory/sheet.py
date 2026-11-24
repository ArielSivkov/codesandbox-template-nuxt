#!/usr/bin/env python3
"""texfactory/sheet.py - דף השוואה לפני/אחרי מצילומי shots_tex.js (לשיפוט בעין, בטלפון).

  python3 -I sheet.py <shots_dir> <out.jpg> <hhmm> <title> <col1:prefix,...>
דוגמה: python3 -I sheet.py tex-shots/tayelet out.jpg 2130 "לילה 21:30" "לפני:before,אחרי (בינונית):after,אחרי (גבוהה):after@high"
שורה לכל מבט (גוף ראשון, נהג); עמודה לכל גרסה. prefix@tag = קובץ <prefix>-<view>-<hhmm>-<tag>.png
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont, features

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def he(s):
    """PIL בלי raqm מצייר משמאל לימין - הופכים טקסט עברי (תוויות קצרות בלבד)."""
    if features.check('raqm'):
        return s
    out, buf = [], ''
    for ch in s:
        if ch.isdigit() or ch in ':.()':
            buf += ch
        else:
            if buf:
                out.append(buf[::-1]); buf = ''
            out.append(ch)
    if buf:
        out.append(buf[::-1])
    return ''.join(out)[::-1]


def main():
    d, out, hhmm, title, cols = sys.argv[1:6]
    cols = [c.split(':', 1) for c in cols.split(',')]
    views = [('fp', 'גוף ראשון (מדרכה)'), ('car', 'מבט נהג (נתיב)')]
    W, H, top, gap = 360, 800, 70, 8
    sheet = Image.new('RGB', (len(cols) * (W + gap) - gap, top + len(views) * (H + 34)), (14, 18, 26))
    dr = ImageDraw.Draw(sheet)
    f1, f2 = ImageFont.truetype(FONT, 26), ImageFont.truetype(FONT, 20)
    dr.text((sheet.width // 2, 18), he(title), fill=(242, 184, 75), font=f1, anchor='mt')
    for ci, (label, pref) in enumerate(cols):
        pref, tag = (pref.split('@') + [''])[:2]
        x = ci * (W + gap)
        for vi, (v, vl) in enumerate(views):
            y = top + vi * (H + 34)
            name = f'{pref}-{v}-{hhmm}' + (f'-{tag}' if tag else '') + '.png'
            p = os.path.join(d, name)
            if os.path.exists(p):
                sheet.paste(Image.open(p).convert('RGB'), (x, y + 30))
            dr.text((x + W // 2, y + 4), he(f'{label} · {vl}'), fill=(238, 243, 248), font=f2, anchor='mt')
    sheet.save(out, quality=86)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
