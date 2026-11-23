#!/usr/bin/env python3
"""ציון דמיון תמונת שטח ↔ רינדור (נמוך = טוב). python3 -I tools/photo_score.py <tag> <round-name>
רכיבים (כולם 0..~1):
  L_w1      מרחק Wasserstein בין התפלגויות הבהירות (L של Lab, 0..1)        משקל 1.0
  ab        מרחק בין גוון ממוצע (a,b) /40                                   משקל 0.6
  hue_hi    מרחק בין היסטוגרמות a,b של הפיקסלים הבהירים (אורות/הילות)        משקל 0.4
  bright    הפרש שבר הפיקסלים הבהירים מאוד (L>0.85) ×10                    משקל 0.5
  edges     הפרש צפיפות קצוות (Canny)  ×4                                    משקל 0.3
  layout    הפרש בהירות ממוצעת ברשת 3×4 (תלוי בדיוק התנוחה – משקל נמוך)       משקל 0.3
השוואות צד-לצד (תמונה | רינדור) נכתבות מחוץ לריפו: /home/claude/swarm/fieldphotos_compare/<round>/ — מכילות תמונות שטח, לא לדחוף.
"""
import sys, os, json, glob
import numpy as np, cv2

PHOTOS = '/home/claude/swarm/fieldphotos/'
W = {'L_w1': 1.0, 'ab': 0.6, 'hue_hi': 0.4, 'bright': 0.5, 'edges': 0.3, 'layout': 0.3}

def load(path, size):
    im = cv2.imread(path); return cv2.resize(im, size, interpolation=cv2.INTER_AREA)

def feats(bgr):
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[..., 0] / 255.0; a = lab[..., 1] - 128; b = lab[..., 2] - 128
    hi = L > 0.6
    ha = np.histogram2d(a[hi].ravel(), b[hi].ravel(), bins=8, range=[[-40, 40], [-40, 40]])[0] if hi.sum() > 10 else np.zeros((8, 8))
    ha = ha / max(ha.sum(), 1)
    e = cv2.Canny(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), 60, 140).mean() / 255.0
    h, w = L.shape; grid = np.array([[L[i * h // 4:(i + 1) * h // 4, j * w // 3:(j + 1) * w // 3].mean() for j in range(3)] for i in range(4)])
    return dict(L=np.sort(L.ravel()), a=float(a.mean()), b=float(b.mean()), ha=ha, bright=float((L > 0.85).mean()), edges=float(e), grid=grid, Lmean=float(L.mean()))

def score(ph, rd):
    f, g = feats(ph), feats(rd)
    c = {'L_w1': float(np.abs(f['L'] - g['L']).mean()), 'ab': float(np.hypot(f['a'] - g['a'], f['b'] - g['b']) / 40),
         'hue_hi': float(np.abs(f['ha'] - g['ha']).sum() / 2), 'bright': float(abs(f['bright'] - g['bright']) * 10), 'edges': float(abs(f['edges'] - g['edges']) * 4),
         'layout': float(np.abs(f['grid'] - g['grid']).mean())}
    c['total'] = float(sum(W[k] * c[k] for k in W))
    c['photo'] = {'Lmean': round(f['Lmean'], 3), 'a': round(f['a'], 1), 'b': round(f['b'], 1), 'bright': round(f['bright'], 4), 'edges': round(f['edges'], 4)}
    c['render'] = {'Lmean': round(g['Lmean'], 3), 'a': round(g['a'], 1), 'b': round(g['b'], 1), 'bright': round(g['bright'], 4), 'edges': round(g['edges'], 4)}
    return c

def main():
    tag, rnd = sys.argv[1], sys.argv[2]
    rdir = f'/home/claude/swarm/integration/rounds/renders/{tag}/'
    cmp_dir = f'/home/claude/swarm/fieldphotos_compare/{rnd}/'; os.makedirs(cmp_dir, exist_ok=True)
    out = {'round': rnd, 'tag': tag, 'pairs': {}, 'weights': W}
    for rp in sorted(glob.glob(rdir + '*.png')):
        pid = os.path.basename(rp)[:3]; ph = glob.glob(PHOTOS + pid + '_*.jpg')
        if not ph: continue
        r = cv2.imread(rp); h, w = r.shape[:2]
        p = load(ph[0], (w, h))
        out['pairs'][pid] = score(p, r)
        side = np.concatenate([p, r], axis=1); cv2.imwrite(cmp_dir + pid + '.jpg', side, [cv2.IMWRITE_JPEG_QUALITY, 82])
    tot = [v['total'] for v in out['pairs'].values()]; out['mean_total'] = float(np.mean(tot)) if tot else None
    os.makedirs('/home/claude/swarm/integration/rounds', exist_ok=True)
    json.dump(out, open(f'/home/claude/swarm/integration/rounds/{rnd}.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps({k: round(v['total'], 4) for k, v in out['pairs'].items()}), 'mean', round(out['mean_total'], 4) if tot else None)

main()
