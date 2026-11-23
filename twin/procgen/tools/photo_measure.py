"""מדידות פיקסל מהתמונות: מיקום הירח (לכיוון מצלמה) וכרומטיות הפנסים (לגוון אור משוער).
הרצה: python3 -I photo_measure.py <fieldphotos_dir> <out.json>
אין EXIF בקבצים – שדה הראייה הוא הנחה (מצלמה ראשית ~26 מ"מ שקול) ומסומן משוער."""
import sys, json, math, os
from PIL import Image

def moon_pixel(path, box):
    """הירח = חלון 40×40 הבהיר ביותר (ממוצע) בתוך תיבת חיפוש ידנית בשמיים. פנסים/מגדל מוחרגים ע"י התיבה."""
    im = Image.open(path).convert('L'); W, H = im.size
    x0, y0, x1, y1 = [int(v) for v in (box[0]*W, box[1]*H, box[2]*W, box[3]*H)]
    c = im.crop((x0, y0, x1, y1)); px = c.load(); best = None
    for y in range(0, c.height-40, 4):
        for x in range(0, c.width-40, 4):
            m = sum(px[x+i, y+j] for i in range(0, 40, 4) for j in range(0, 40, 4))/100
            if best is None or m > best[0]: best = (m, x, y)
    if not best or best[0] < 200: return None
    m, x, y = best
    return {'u': round((x0+x+20)/W, 4), 'v': round((y0+y+20)/H, 4), 'mean_lum': round(m, 1), 'W': W, 'H': H}

def solve_heading(u, v, W, H, az, alt, hfov_long=69.4, vfov_short=54.9):
    # רוחב/גובה לפי כיוון התמונה (לאורך/לרוחב)
    portrait = H > W
    hx = math.radians((vfov_short if portrait else hfov_long)/2)
    hy = math.radians((hfov_long if portrait else vfov_short)/2)
    nx = (u-0.5)*2*math.tan(hx); ny = (0.5-v)*2*math.tan(hy)
    best = None
    for p10 in range(-300, 800):
        p = math.radians(p10/10)
        # כיוון המטרה במערכת המצלמה: f + nx r + ny u ; גובה זוויתי לא תלוי בכיוון
        fz, uz = math.sin(p), math.cos(p)
        dz = fz + ny*uz
        L = math.sqrt(1 + nx*nx + ny*ny)
        a = math.degrees(math.asin(max(-1, min(1, dz/L))))
        if best is None or abs(a-alt) < abs(best[1]-alt): best = (p, a)
    p = best[0]
    # אזימוט יחסי של המטרה לכיוון המבט
    f = (0, math.cos(p), math.sin(p)); r = (1, 0, 0); upv = (0, -math.sin(p), math.cos(p))
    d = [f[i] + nx*r[i] + ny*upv[i] for i in range(3)]
    rel = math.degrees(math.atan2(d[0], d[1]))
    return {'pitch_deg': round(math.degrees(p), 1), 'rel_az_deg': round(rel, 1), 'heading_deg': round((az - rel) % 360, 1)}

def lamp_chroma(path):
    """כרומטיות של הילת הפנס: פיקסלים בהירים לא רוויים (max 200..250) ברבע העליון-בהיר."""
    im = Image.open(path).convert('RGB'); im.thumbnail((600, 600)); px = im.load()
    R = G = B = n = 0
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = px[x, y]; m = max(r, g, b)
            if 200 <= m <= 250 and min(r, g, b) > 60: R += r; G += g; B += b; n += 1
    if n < 50: return None
    lin = lambda c: ((c/255+0.055)/1.055)**2.4 if c/255 > 0.04045 else c/255/12.92
    r, g, b = lin(R/n*1.0), lin(G/n), lin(B/n)
    X = 0.4124*r+0.3576*g+0.1805*b; Y = 0.2126*r+0.7152*g+0.0722*b; Z = 0.0193*r+0.1192*g+0.9505*b
    x, y = X/(X+Y+Z), Y/(X+Y+Z); nn = (x-0.3320)/(0.1858-y)
    cct = 449*nn**3 + 3525*nn**2 + 6823.3*nn + 5520.33
    return {'mean_rgb': [round(R/n), round(G/n), round(B/n)], 'n_px': n, 'cct_K_raw': round(cct)}

MOON_JOBS = {   # תיבת חיפוש ידנית לירח (חלק מהמסגרת) – מוציאה פנסים/מגדלים מהחיפוש
    '006': (0.55, 0.15, 0.95, 0.42), '008': (0.50, 0.15, 0.80, 0.42),
    '031': (0.35, 0.20, 0.75, 0.50), '032': (0.10, 0.02, 0.50, 0.25)}

if __name__ == '__main__':
    d, out = sys.argv[1], sys.argv[2]
    refs = json.load(open(sys.argv[3], encoding='utf-8'))['refs']
    res = {'fov_assumption': 'מצלמה ראשית ~26 מ"מ שקול: 69.4° בצלע הארוכה, 54.9° בקצרה (משוער – אין EXIF)', 'moon_src': 'data/moon_refs.json', 'moon': {}, 'lamps': {}}
    files = {f[:3]: f for f in os.listdir(d) if f.endswith('.jpg')}
    for pid, box in MOON_JOBS.items():
        if pid not in files: continue
        mp = moon_pixel(os.path.join(d, files[pid]), box)
        if mp: mp.update(solve_heading(mp['u'], mp['v'], mp['W'], mp['H'], refs[pid]['az'], refs[pid]['alt'])); mp['ref'] = refs[pid]
        res['moon'][pid] = mp
    for pid, f in sorted(files.items()): res['lamps'][pid] = lamp_chroma(os.path.join(d, f))
    json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: (v['heading_deg'], v['pitch_deg']) for k, v in res['moon'].items()}))
