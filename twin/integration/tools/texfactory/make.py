#!/usr/bin/env python3
"""texfactory/make.py - מפעל הטקסטורות של העולם התאום (גדוד טקסטורות, ESH27).

  python3 -I make.py --src-dir <dir> --rt-dir <dir> [--n 4096] [--sets asphalt,pavers,...] [--calib calib.json] [--no-src]

כל סט: albedo (sRGB, עם AO אפוי), normal (OpenGL) + roughness, height. הכול פרוצדורלי ומקורי - בלי נכסים של אחרים.
מקור (--src-dir, מחוץ למשחק): 4096 (או --n) כ-JPEG 95 (albedo) ו-PNG 16 ביט לגובה; זמן ריצה (--rt-dir): 2048/1024/512.
קבצי זמן ריצה לכל סט ורזולוציה:
  <set>_c.jpg  - albedo (sRGB, AO אפוי)                         JPEG q86, 4:2:0
  <set>_n.jpg  - R,G = נורמל XY (OpenGL, z משוחזר בשיידר), B = roughness   JPEG q90, 4:4:4
מיוחדים: asphalt_m (מאקרו 64 מ': R בהירות, G טלאי זפת, B קווי איטום סדקים), curb (רצועה 2x0.25 מ', 8:1),
         plaster/stone (פרטי בהירות לתוסף הבניינים: ממוצע G גולמי 0.78 / 0.62 בהתאם לשיידר שלו).
הכול דטרמיניסטי (זרעים קבועים): אותו קלט = אותם בתים.
"""
import argparse
import hashlib
import json
import os
import time

import numpy as np
from PIL import Image, ImageFile

import texlib as T

ImageFile.MAXBLOCK = 1 << 26   # JPEG מתקדם/אופטימלי גדול (אחרת 'broken data stream')

F32 = np.float32
Y = np.array([0.2126, 0.7152, 0.0722], F32)

# ------------------------------------------------------------------ יעדי צבע (ליניארי) - מתוך הכיול (calibrate.py + הדוח)
# chroma = יחס ערוצים מנורמל לממוצע 1; Y = בהירות ליניארית ממוצעת של האלבדו.
TARGET = {
    'asphalt':      {'Y': 0.150, 'chroma': (1.03, 1.00, 0.95)},
    'pavers_gray':  {'Y': 0.270, 'chroma': (1.02, 1.00, 0.96)},
    'pavers_red':   {'Y': 0.220, 'chroma': (1.45, 0.86, 0.68)},
    'concrete':     {'Y': 0.300, 'chroma': (1.02, 1.00, 0.95)},
    'curb_gray':    {'Y': 0.300, 'chroma': (1.01, 1.00, 0.97)},
    'paint_white':  {'Y': 0.560, 'chroma': (1.02, 1.00, 0.95)},
    'paint_red':    {'Y': 0.115, 'chroma': (2.55, 0.25, 0.20)},
    'plaster':      {'Y': 0.600, 'chroma': (1.06, 1.00, 0.90)},
    'stone':        {'Y': 0.450, 'chroma': (1.13, 1.02, 0.82)},
    'palm':         {'Y': 0.160, 'chroma': (1.15, 1.00, 0.80)},
    'grass':        {'Y': 0.110, 'chroma': (0.62, 1.18, 0.40)},
    'drygrass':     {'Y': 0.170, 'chroma': (1.33, 1.20, 0.47)},
    'sand':         {'Y': 0.320, 'chroma': (1.18, 1.10, 0.72)},
}


def tcol(name):
    t = TARGET[name]
    c = np.array(t['chroma'], F32)
    return c * (t['Y'] / float(c @ Y))


def fit_Y(alb, name, mask=None):
    """מכפיל את האלבדו כך שהממוצע = היעד (גוון + בהירות)."""
    return T.match_mean(alb, tcol(name), mask)


def hash2(a, b, seed=0):
    """גיבוב שלמים → 0..1 (וקטורי)."""
    h = (a.astype(np.int64) * 73856093) ^ (b.astype(np.int64) * 19349663) ^ (seed * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return ((h & 0xFFFFFF).astype(F32) / F32(0xFFFFFF))


def grid_uv(n, S, m=None, Sv=None):
    """קואורדינטות במטרים (v עולה למעלה)."""
    m = m or n
    Sv = Sv or S * n / m
    u = (np.arange(m, dtype=F32) + 0.5) * (S / m)
    v = (np.arange(n, dtype=F32) + 0.5) * (Sv / n)
    return np.meshgrid(u, v)


# ================================================================== אספלט (אריח 4 מ')
def asphalt(n, seed=11):
    S = 4.0
    px = S / n
    t0 = time.time()
    # אגרגט גס (~7 מ"מ) + עדין (~3 מ"מ): תאי וורונוי, רק חלק מהאבנים חשופות
    c1 = max(8, int(S / 0.007))
    F1, F2, ID = T.worley(n, c1, seed)
    cell = S / c1 / px                                   # גודל תא בפיקסלים
    rad = (0.30 + 0.22 * ((ID * 7.31) % 1.0)) * cell
    stone = T.smoothstep(rad * 1.05, rad * 0.75, F1) * T.smoothstep(0.0, 0.35 * cell, F2 - F1)
    expo = (ID > 0.50).astype(F32)                       # ~50% מהאבנים חשופות (אספלט ותיק)
    stone *= expo
    del F1, F2, expo
    c2 = max(8, int(S / 0.0028))
    G1, G2, GID = T.worley(n, c2, seed + 1)
    fine = T.smoothstep(0.45 * S / c2 / px, 0.2 * S / c2 / px, G1) * (GID > 0.45)
    del G1, G2, GID
    # מסטיק / בינדר: רעש ס"מ-דצ"מ (חמצון, בלאי), ונקבוביות
    mid = T.spectral(n, seed + 2, beta=2.2, fmin=S / 0.6, fmax=S / 0.01)
    big = T.spectral(n, seed + 3, beta=2.6, fmin=1, fmax=S / 0.15)
    grain = T.spectral(n, seed + 4, beta=0.0, fmin=S / 0.004, fmax=n / 2)
    P1, _, PID = T.worley(n, max(8, int(S / 0.012)), seed + 5)
    pore = T.smoothstep(0.18 * S / max(8, int(S / 0.012)) / px, 0.0, P1) * (PID > 0.82)
    del P1, PID
    # גובה (מטרים)
    h = (stone * (0.0011 + 0.0006 * ((ID * 3.7) % 1.0)) + fine * 0.0004 + mid * 0.00018 + grain * 0.00006
         - pore * 0.0012 + big * 0.00012).astype(F32)
    # אלבדו: בינדר אפור מחומצן, אבן גיר/דולומיט בהירה בגוונים
    binder = 0.075 * (1 + 0.13 * mid + 0.04 * big + 0.08 * grain)   # כתמים בינוניים חלשים (חוזרים כל 4 מ'); וריאציה גדולה = שכבת המאקרו
    sval = 0.20 * (0.65 + 0.70 * ((ID * 11.7) % 1.0))
    sh = np.stack([1.0 + 0.10 * (((ID * 5.3) % 1.0) - 0.5), np.ones_like(ID), 1.0 - 0.14 * (((ID * 2.9) % 1.0) - 0.3)], -1)
    lum = binder * (1 - stone) + sval * stone
    lum = lum * (1 - 0.5 * fine) + 0.20 * fine * (1 - stone)
    lum = lum * (1 - 0.65 * pore)
    alb = lum[..., None] * (sh * stone[..., None] + (1 - stone[..., None]) * np.array([1.0, 1.0, 1.02], F32))
    ao = T.cavity_ao(h, px, 0.004, 900.0)
    alb = alb * (0.55 + 0.45 * ao)[..., None]
    alb = fit_Y(alb, 'asphalt')
    rough = np.clip(0.86 - 0.16 * stone + 0.06 * pore + 0.03 * mid, 0.55, 0.98)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  asphalt {n}: {time.time() - t0:.1f}s')
    return {'S': (S, S), 'albedo': alb, 'normal': nrm, 'rough': rough, 'height': h}


def asphalt_macro(n=1024, seed=12):
    """מאקרו 64 מ' (נדגם בנפרד בשיידר): R = מכפיל בהירות (0.5 = 1.0), G = טלאי זפת/תיקונים, B = קווי איטום סדקים."""
    S = 64.0
    px = S / n
    r = T.rng(seed)
    light = 0.5 + 0.10 * T.spectral(n, seed, beta=2.4, fmin=1, fmax=S / 1.5)
    U, V = grid_uv(n, S)
    patch = np.zeros((n, n), F32)
    for k in range(11):                                   # טלאי תיקון מלבניים (1-4 מ'), עם שוליים לא חלקים
        cx, cy = r.random() * S, r.random() * S
        w, hh = 0.8 + r.random() * 3.2, 0.6 + r.random() * 2.2
        if r.random() < 0.25:
            w, hh = (0.5 + r.random() * 0.4, 6 + r.random() * 8) if r.random() < 0.5 else (6 + r.random() * 8, 0.5 + r.random() * 0.4)
        dx = np.abs(((U - cx + S / 2) % S) - S / 2) - w / 2
        dy = np.abs(((V - cy + S / 2) % S) - S / 2) - hh / 2
        d = np.maximum(dx, dy)
        patch = np.maximum(patch, T.smoothstep(0.06, -0.02, d + 0.05 * T.spectral(n, seed + 10 + k, beta=1.5, fmin=S / 2, fmax=S / 0.2)))
    lines = np.zeros((n, n), F32)
    img = Image.new('L', (n * 3, n * 3), 0)
    from PIL import ImageDraw
    dr = ImageDraw.Draw(img)
    for k in range(34):                                   # קווי איטום סדקים: הליכה אקראית מתפתלת 2-8 מ'
        x, y = r.random() * S, r.random() * S
        ang = r.random() * np.pi * 2
        pts = []
        L = 2 + r.random() * 6
        steps = int(L / 0.15)
        for s in range(steps):
            ang += r.normal() * 0.35
            x += np.cos(ang) * 0.15
            y += np.sin(ang) * 0.15
            pts.append((x / px + n, (S - y) / px + n))
        wpx = max(1, int(round((0.035 + r.random() * 0.025) / px)))
        dr.line(pts, fill=255, width=wpx, joint='curve')
    a = np.asarray(img, F32) / 255
    tiled = np.zeros((n, n), F32)
    for oy in range(3):
        for ox in range(3):
            tiled = np.maximum(tiled, a[oy * n:(oy + 1) * n, ox * n:(ox + 1) * n])
    lines = np.flipud(T.blur(tiled, 0.6))
    out = np.stack([np.clip(light, 0, 1), np.clip(patch, 0, 1), np.clip(lines * 1.4, 0, 1)], -1).astype(F32)
    return out


# ================================================================== אבנים משתלבות (אריח 2 מ', 20x10 ס"מ, קשר חצי)
def pavers(n, seed=21):
    S = 2.0
    px = S / n
    t0 = time.time()
    U, V = grid_uv(n, S)
    L, Wd = 0.20, 0.10
    row = np.floor(V / Wd).astype(np.int32)
    off = (row % 2) * (L / 2)
    uu = U + off
    col = np.floor(uu / L).astype(np.int32)
    col = np.mod(col, int(round(S / L)))
    lu, lv = np.mod(uu, L), np.mod(V, Wd)
    rid = hash2(row, col, seed)
    rid2 = hash2(row + 101, col + 7, seed)
    # שבבים בקצוות: מרחק לשפה עם רעש
    chip = T.spectral(n, seed + 1, beta=1.2, fmin=S / 0.05, fmax=S / 0.004) * 0.0009
    d = np.minimum(np.minimum(lu, L - lu), np.minimum(lv, Wd - lv)) + chip
    joint = T.smoothstep(0.0022, 0.0010, d)
    bevel = T.smoothstep(0.0012, 0.0065, d)
    tilt = ((rid - 0.5) * 0.004 * (lu - L / 2) + (rid2 - 0.5) * 0.004 * (lv - Wd / 2))
    surf = T.spectral(n, seed + 2, beta=1.0, fmin=S / 0.02, fmax=n / 2.2)
    F1, _, PID = T.worley(n, int(S / 0.004), seed + 3)
    pits = T.smoothstep(0.35 * (S / int(S / 0.004)) / px, 0.0, F1) * (PID > 0.7)
    h = (bevel * (0.004 + 0.0006 * (rid - 0.5)) + tilt + surf * 0.00008 - pits * 0.0004 - joint * 0.002).astype(F32)
    dirt = np.clip(0.5 + 0.5 * T.spectral(n, seed + 4, beta=2.2, fmin=1, fmax=S / 0.05), 0, 1)
    tone = 1.0 + 0.16 * (rid - 0.5) + 0.05 * surf
    stain = (hash2(row + 17, col + 31, seed) > 0.93).astype(F32) * (0.25 + 0.3 * dirt)
    lum = tone * (1 - 0.5 * pits) * (1 - 0.18 * stain) * (1 - 0.12 * dirt)
    jl = 0.55 + 0.25 * dirt                                # תפרים: חול/לכלוך
    ao = T.cavity_ao(h, px, 0.006, 260.0)
    out = {}
    for var in ('gray', 'red'):
        base = tcol('pavers_' + var)
        if var == 'red':   # אבנים אדומות בגוונים (חום, כתום, אדום כהה)
            hue = np.stack([1 + 0.12 * (rid2 - 0.5), 1 - 0.10 * (rid2 - 0.5), 1 - 0.10 * (rid2 - 0.5)], -1)
        else:
            hue = np.stack([1 + 0.03 * (rid2 - 0.5), np.ones_like(rid2), 1 - 0.03 * (rid2 - 0.5)], -1)
        stoneC = lum[..., None] * base * hue
        jointC = jl[..., None] * np.array(tcol('pavers_gray') * np.array([1.05, 1.0, 0.9], F32) * 0.75, F32)
        alb = stoneC * (1 - joint[..., None]) + jointC * joint[..., None]
        alb = alb * (0.6 + 0.4 * ao)[..., None]
        out['albedo_' + var] = fit_Y(alb, 'pavers_' + var)
    rough = np.clip(0.80 + 0.10 * joint + 0.05 * pits - 0.05 * stain, 0.6, 0.98)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  pavers {n}: {time.time() - t0:.1f}s')
    return {'S': (S, S), 'albedo': out['albedo_gray'], 'albedo_red': out['albedo_red'], 'normal': nrm, 'rough': rough, 'height': h}


# ================================================================== אבן שפה (רצועה 2 x 0.25 מ'; v=0 בצד הכביש)
def curb(n, seed=31):
    S, Sv = 2.0, 0.25
    m = n
    nv = max(16, int(round(n * Sv / S)))
    px = S / m
    t0 = time.time()
    U, V = grid_uv(nv, S, m=m, Sv=Sv)
    # פרופיל רוחב: מרזב → פנים אנכיות (מקוצרות) → שפה מעוגלת → משטח → תפר למדרכה
    prof = np.interp(V, [0.0, 0.018, 0.022, 0.050, 0.075, 0.215, 0.228, 0.25], [-0.004, -0.004, 0.000, 0.030, 0.040, 0.040, 0.036, 0.030]).astype(F32)
    face = ((V > 0.02) & (V < 0.05)).astype(F32)
    blk = np.floor(U / 1.0).astype(np.int32)
    lu = np.mod(U, 1.0)
    j = np.minimum(lu, 1.0 - lu)
    joint = T.smoothstep(0.004, 0.0015, j)
    surf = T.spectral(nv, seed + 1, beta=1.1, fmin=4, fmax=m / 2.2, m=m)
    h = (prof + surf * 0.00012 - joint * 0.003).astype(F32)
    rid = hash2(blk, blk * 0 + 3, seed)
    wear = np.clip(0.5 + 0.5 * T.spectral(nv, seed + 2, beta=1.6, fmin=4, fmax=m / 8, m=m), 0, 1)
    edge_wear = T.smoothstep(0.08, 0.05, V) * T.smoothstep(0.045, 0.06, V) + T.smoothstep(0.205, 0.225, V)
    spots = T.spectral(nv, seed + 3, beta=0.8, fmin=40, fmax=m / 6, m=m)
    chipped = np.clip((wear - 0.86) * 6 + (spots - 2.2) * 2 + edge_wear * 0.5 * (spots > 0.9), 0, 1)   # היכן שהצבע התקלף (בעיקר בשפות)
    dirt = T.smoothstep(0.03, 0.0, V) * 0.6 + face * 0.25
    concrete = (1 + 0.10 * surf + 0.08 * (rid - 0.5))[..., None] * tcol('curb_gray')
    red, white = tcol('paint_red'), tcol('paint_white')
    paint = np.where((blk % 2 == 0)[..., None], red[None, None, :], white[None, None, :]) * (1 + 0.05 * surf)[..., None]
    painted = paint * (1 - chipped[..., None]) + concrete * chipped[..., None]
    ao = T.cavity_ao(h, px, 0.01, 60.0)
    shade = (1 - 0.35 * face) * (0.6 + 0.4 * ao) * (1 - 0.5 * dirt) * (1 - 0.6 * joint)
    alb_rw = painted * shade[..., None]
    alb_gray = concrete * shade[..., None]
    rough = np.clip(0.82 - 0.22 * (1 - chipped) * (V > 0.02) + 0.1 * joint, 0.45, 0.97)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  curb {m}x{nv}: {time.time() - t0:.1f}s')
    return {'S': (S, Sv), 'albedo': alb_rw, 'albedo_gray': alb_gray, 'normal': nrm, 'rough': rough, 'height': h, 'strip': True}


# ================================================================== מרצפות בטון 40x40 (אריח 2 מ')
def concrete(n, seed=41):
    S = 2.0
    px = S / n
    t0 = time.time()
    U, V = grid_uv(n, S)
    q = 0.40
    i, j = np.floor(U / q).astype(np.int32), np.floor(V / q).astype(np.int32)
    lu, lv = np.mod(U, q), np.mod(V, q)
    chip = T.spectral(n, seed + 1, beta=1.2, fmin=S / 0.05, fmax=S / 0.004) * 0.0008
    d = np.minimum(np.minimum(lu, q - lu), np.minimum(lv, q - lv)) + chip
    joint = T.smoothstep(0.0025, 0.001, d)
    bevel = T.smoothstep(0.001, 0.005, d)
    rid = hash2(i, j, seed)
    F1, _, AID = T.worley(n, int(S / 0.0035), seed + 2)
    agg = T.smoothstep(0.45 * (S / int(S / 0.0035)) / px, 0.15 * (S / int(S / 0.0035)) / px, F1) * (AID > 0.5)
    surf = T.spectral(n, seed + 3, beta=1.4, fmin=S / 0.05, fmax=n / 2.2)
    stain = np.clip(T.spectral(n, seed + 4, beta=2.4, fmin=1, fmax=S / 0.05), 0, None) * 0.5
    crack = np.zeros_like(U)
    r = T.rng(seed + 5)
    for k in range(5):   # סדקים דקים במרצפות בודדות
        ci, cj = r.integers(0, 5), r.integers(0, 5)
        a = r.random() * np.pi
        x0, y0 = ci * q + q / 2, cj * q + q / 2
        dist = np.abs((U - x0) * np.sin(a) - (V - y0) * np.cos(a))
        inside = (i == ci) & (j == cj)
        crack = np.maximum(crack, T.smoothstep(0.0012, 0.0002, dist + 0.0006 * surf) * inside)
    h = (bevel * 0.003 + agg * 0.0003 + surf * 0.0001 - joint * 0.002 - crack * 0.0008 + (rid - 0.5) * 0.0008).astype(F32)
    lum = (1 + 0.12 * (rid - 0.5) + 0.06 * surf) * (1 + 0.25 * agg * (((AID * 9.1) % 1.0) - 0.4)) * (1 - 0.15 * stain) * (1 - 0.5 * crack)
    ao = T.cavity_ao(h, px, 0.006, 220.0)
    alb = lum[..., None] * tcol('concrete') * (0.6 + 0.4 * ao)[..., None] * (1 - 0.45 * joint)[..., None]
    alb = fit_Y(alb, 'concrete')
    rough = np.clip(0.86 - 0.05 * agg + 0.08 * joint, 0.6, 0.98)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  concrete {n}: {time.time() - t0:.1f}s')
    return {'S': (S, S), 'albedo': alb, 'normal': nrm, 'rough': rough, 'height': h}


# ================================================================== טיח חזית בהיר (אריח 1 מ' - כמו בשיידר של תוסף הבניינים)
def plaster(n, seed=51):
    S = 1.0
    px = S / n
    t0 = time.time()
    F1, F2, ID = T.worley(n, int(S / 0.0018), seed)
    cell = (S / int(S / 0.0018)) / px
    grain = T.smoothstep(0.55 * cell, 0.1 * cell, F1) * (0.5 + ID)
    swirl = T.spectral(n, seed + 1, beta=1.8, fmin=S / 0.25, fmax=S / 0.01, aniso=3.0, angle=0.6)
    blot = T.spectral(n, seed + 2, beta=2.6, fmin=1, fmax=S / 0.08)
    fine = T.spectral(n, seed + 3, beta=0.0, fmin=S / 0.002, fmax=n / 2.2)
    h = (grain * 0.0006 + swirl * 0.00015 + fine * 0.00003).astype(F32)
    stain = np.clip(T.spectral(n, seed + 4, beta=2.2, fmin=2, fmax=S / 0.05), 0, None)
    lum = (1 + 0.02 * blot - 0.03 * stain + 0.025 * fine) * (1 - 0.06 * (grain - 0.5))
    ao = T.cavity_ao(h, px, 0.003, 500.0)
    alb = lum[..., None] * tcol('plaster') * (0.75 + 0.25 * ao)[..., None]
    alb = fit_Y(alb, 'plaster')
    rough = np.clip(0.9 + 0.04 * fine, 0.8, 0.99)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  plaster {n}: {time.time() - t0:.1f}s')
    return {'S': (S, S), 'albedo': alb, 'normal': nrm, 'rough': rough, 'height': h, 'g_mean_raw': 0.78}


# ================================================================== חיפוי אבן (אריח 1.2 מ', מיושר לתפרים של תוסף הבניינים: שורות 0.30, אבנים 0.60, היסט 0.30)
def stone(n, seed=61):
    S = 1.2
    px = S / n
    t0 = time.time()
    U, V = grid_uv(n, S)
    row = np.floor(V / 0.30).astype(np.int32)
    off = (row % 2) * 0.30
    uu = U + off
    col = np.mod(np.floor(uu / 0.60).astype(np.int32), 2)
    lu, lv = np.mod(uu, 0.60), np.mod(V, 0.30)
    rid = hash2(row, col, seed)
    rid2 = hash2(row + 9, col + 5, seed)
    d = np.minimum(np.minimum(lu, 0.60 - lu), np.minimum(lv, 0.30 - lv))
    edge = T.smoothstep(0.004, 0.014, d)
    # תלטיש: קווי סיתות מקבילים בזווית שונה לכל אבן
    ang = rid * np.pi
    chis = np.sin((lu * np.cos(ang) + lv * np.sin(ang)) * 2 * np.pi / 0.0045 + 3 * T.spectral(n, seed + 1, beta=2.0, fmin=S / 0.1, fmax=S / 0.01))
    F1, _, PID = T.worley(n, int(S / 0.006), seed + 2)
    pores = T.smoothstep(0.3 * (S / int(S / 0.006)) / px, 0.0, F1) * (PID > 0.8)
    mott = T.spectral(n, seed + 3, beta=2.2, fmin=S / 0.5, fmax=S / 0.005)
    h = (edge * 0.003 + chis * 0.00025 * edge - pores * 0.0006 + mott * 0.0002).astype(F32)
    tone = 1 + 0.14 * (rid - 0.5) + 0.06 * mott
    hue = np.stack([1 + 0.06 * (rid2 - 0.5), np.ones_like(rid2), 1 - 0.10 * (rid2 - 0.5)], -1)
    lum = tone * (1 - 0.35 * pores) * (0.82 + 0.18 * edge)
    ao = T.cavity_ao(h, px, 0.004, 400.0)
    alb = lum[..., None] * tcol('stone') * hue * (0.7 + 0.3 * ao)[..., None]
    alb = fit_Y(alb, 'stone')
    rough = np.clip(0.82 + 0.06 * pores, 0.7, 0.97)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  stone {n}: {time.time() - t0:.1f}s')
    return {'S': (S, S), 'albedo': alb, 'normal': nrm, 'rough': rough, 'height': h, 'g_mean_raw': 0.62}


# ================================================================== גזע דקל (תמר: בסיסי עלים במעוינים) - u סביב (1 מ'), v לגובה (0.54 מ')
def palm(n, seed=71):
    S, Sv = 1.0, 0.54
    nv = int(round(n * Sv / S))
    px = S / n
    t0 = time.time()
    U, V = grid_uv(nv, S, m=n, Sv=Sv)
    cw, ch = S / 7, Sv / 6                              # 7 בסיסים סביב, 6 שורות (זוגי - מחזורי עם היסט חצי)
    row = np.floor(V / ch).astype(np.int32)
    uu = U + (row % 2) * cw / 2
    col = np.floor(uu / cw).astype(np.int32)
    lu, lv = np.mod(uu, cw) / cw - 0.5, np.mod(V, ch) / ch - 0.5
    rid = hash2(row, np.mod(col, 7), seed)
    rid3 = hash2(row + 5, np.mod(col, 7) + 11, seed)
    lu = lu + (rid3 - 0.5) * 0.12
    lv = lv + (rid - 0.5) * 0.10
    wob = T.spectral(nv, seed + 7, beta=2.0, fmin=6, fmax=60, m=n) * 0.06
    dia = np.abs(lu) * (1.05 + 0.25 * rid3) + np.abs(lv + 0.12) * (0.9 + 0.2 * rid) + wob     # מעוין לא סדור (בסיס עלה חתוך)
    boot = T.smoothstep(0.62, 0.40, dia)
    fib = np.abs(T.spectral(nv, seed + 1, beta=1.0, fmin=8, fmax=n / 3, aniso=8.0, angle=np.pi / 2, m=n))
    cut = T.smoothstep(0.06, 0.0, np.abs(lv + 0.12 - 0.30 + 0.25 * np.abs(lu))) * boot
    h = (boot * (0.020 + 0.006 * rid) * (0.6 + 0.4 * (lv + 0.5)) + fib * 0.0015 * (1 - boot) - cut * 0.004).astype(F32)
    lum = (0.55 + 0.6 * boot * (0.8 + 0.4 * rid)) * (0.75 + 0.25 * fib) * (1 - 0.3 * cut)
    ao = T.cavity_ao(h, px, 0.03, 30.0)
    alb = lum[..., None] * tcol('palm') * (0.45 + 0.55 * ao)[..., None]
    alb = fit_Y(alb, 'palm')
    rough = np.clip(0.9 - 0.05 * boot, 0.7, 0.98)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  palm {n}x{nv}: {time.time() - t0:.1f}s')
    return {'S': (S, Sv), 'albedo': alb, 'normal': nrm, 'rough': rough, 'height': h, 'strip': True}


# ================================================================== דשא / עשב יבש / חול
def stamp_blades(n, S, seed, count, len_m, wid_m, palette, base_rgb, flat=0.0):
    """מצייר count עלים (קווים קצרים) בכיוונים אקראיים, עם עטיפה (ריצוף רציף). מחזיר (rgb ליניארי, גובה 0..1, כיסוי).
    palette: [(צבע בסיס ליניארי, צבע קצה ליניארי, משקל)]; flat: 0 = עלים זקופים (קצרים במבט מלמעלה), 1 = שוכבים."""
    from PIL import ImageDraw
    r = T.rng(seed)
    px = S / n
    rgb = Image.fromarray(T.to8(np.clip(base_rgb, 0, 1) ** (1 / 2.2)), 'RGB')    # קנבס בגמא 2.2 (רק לציור; מומר חזרה בסוף)
    hgt = Image.new('L', (n, n), 0)
    cov = Image.new('L', (n, n), 0)
    dr, dh, dc = ImageDraw.Draw(rgb), ImageDraw.Draw(hgt), ImageDraw.Draw(cov)
    hs = np.sort(r.random(count))
    w = np.array([p[2] for p in palette], np.float64)
    w /= w.sum()
    pick = r.choice(len(palette), size=count, p=w)
    for i in range(count):
        hh = hs[i]
        L = len_m * (0.5 + r.random()) * (1 - 0.6 * (1 - flat) * r.random()) / px
        a = r.random() * np.pi * 2
        x0, y0 = r.random() * n, r.random() * n
        x1, y1 = x0 + np.cos(a) * L, y0 + np.sin(a) * L
        xm, ym = (x0 + x1) / 2 + r.normal() * L * 0.08, (y0 + y1) / 2 + r.normal() * L * 0.08
        wpx = max(1, int(round(wid_m * (0.6 + 0.8 * r.random()) / px)))
        base, tip, _ = palette[pick[i]]
        jit = 0.85 + 0.3 * r.random()
        c0 = tuple(int(255 * min(1, (v * jit * (0.6 + 0.4 * hh)) ** (1 / 2.2))) for v in base)
        c1 = tuple(int(255 * min(1, (v * jit * (0.7 + 0.3 * hh)) ** (1 / 2.2))) for v in tip)
        hv = int(40 + 215 * hh)
        for ox in (0, -n, n):
            for oy in (0, -n, n):
                if (ox or oy) and not (min(x0, x1, xm) + ox < n + 4 and max(x0, x1, xm) + ox > -4 and min(y0, y1, ym) + oy < n + 4 and max(y0, y1, ym) + oy > -4):
                    continue
                pa, pm, pb = (x0 + ox, y0 + oy), (xm + ox, ym + oy), (x1 + ox, y1 + oy)
                dr.line([pa, pm], fill=c0, width=wpx)
                dr.line([pm, pb], fill=c1, width=max(1, wpx - 1))
                dh.line([pa, pm, pb], fill=hv, width=wpx)
                dc.line([pa, pm, pb], fill=255, width=wpx)
    out = (np.asarray(rgb, F32) / 255) ** 2.2
    return np.flipud(out).copy(), np.flipud(np.asarray(hgt, F32) / 255).copy(), np.flipud(np.asarray(cov, F32) / 255).copy()


def grass(n, seed=81, dry=False):
    S = 2.0
    px = S / n
    t0 = time.time()
    soilc = tcol('sand') * (0.45 if not dry else 0.8)
    fine = T.spectral(n, seed + 2, beta=0.3, fmin=S / 0.01, fmax=n / 2.2)
    clump = T.spectral(n, seed + 1, beta=2.2, fmin=S / 0.5, fmax=S / 0.03)
    soil = (soilc[None, None, :] * (1 + 0.15 * fine + 0.1 * clump)[..., None]).astype(F32)
    k = (n / 4096) ** 2
    if not dry:
        g = tcol('grass')
        pal = [(g * np.array([0.75, 0.8, 0.8], F32), g * np.array([1.15, 1.12, 0.9], F32), 6),
               (g * np.array([0.65, 0.7, 0.9], F32), g * np.array([0.95, 1.0, 1.0], F32), 3),
               (g * np.array([1.2, 1.05, 0.6], F32), g * np.array([1.6, 1.3, 0.7], F32), 1)]
        rgb, hgt, cov = stamp_blades(n, S, seed, int(150000 * k), 0.045, 0.0022, pal, soil, flat=0.3)
    else:
        d = tcol('drygrass')
        pal = [(d * np.array([0.8, 0.8, 0.85], F32), d * np.array([1.15, 1.1, 1.0], F32), 5),
               (d * np.array([0.55, 0.55, 0.6], F32), d * np.array([0.8, 0.78, 0.8], F32), 3),
               (tcol('grass') * np.array([1.3, 1.0, 1.0], F32), d * np.array([0.9, 0.95, 0.8], F32), 1)]
        bare = T.smoothstep(0.1, -0.5, clump)
        soil = soil * (1 + 0.1 * bare[..., None])
        rgb, hgt, cov = stamp_blades(n, S, seed, int(75000 * k), 0.07, 0.0018, pal, soil, flat=0.8)
    h = (hgt * 0.006 + clump * 0.0015 + fine * 0.0002).astype(F32)
    h = T.blur(h, 0.6)
    ao = T.cavity_ao(h, px, 0.006, 150.0)
    alb = rgb * (0.45 + 0.55 * ao)[..., None]
    alb = fit_Y(alb, 'drygrass' if dry else 'grass')
    rough = np.clip(0.92 - 0.05 * cov, 0.75, 0.99)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  {"drygrass" if dry else "grass"} {n}: {time.time() - t0:.1f}s')
    return {'S': (S, S), 'albedo': alb, 'normal': nrm, 'rough': rough, 'height': h}


def sand(n, seed=91):
    S = 4.0
    px = S / n
    t0 = time.time()
    U, V = grid_uv(n, S)
    warp = T.spectral(n, seed, beta=3.0, fmin=1, fmax=S / 0.8) * 0.25          # מתפתל לאט (בלי טבעות)
    k = 2 * np.pi * round(S / 0.12) / S                   # אדוות רוח ~12 ס"מ (מספר שלם של גלים באריח)
    ph = k * (V + warp + 0.15 * U * 0)
    rip = np.sin(ph) + 0.25 * np.sin(2 * ph + 1.0)        # פרופיל אסימטרי עדין
    rmask = T.smoothstep(-0.3, 0.9, T.spectral(n, seed + 2, beta=2.6, fmin=1, fmax=S / 0.5))
    bumps = T.spectral(n, seed + 5, beta=2.4, fmin=S / 0.6, fmax=S / 0.04)   # שקעים (דריכות, רוח)
    grain = T.spectral(n, seed + 3, beta=0.0, fmin=S / 0.0015, fmax=n / 2.1)
    F1, _, SID = T.worley(n, int(S / 0.012), seed + 4)
    cell = (S / int(S / 0.012)) / px
    shell = T.smoothstep(0.3 * cell, 0.0, F1) * (SID > 0.95)
    peb = T.smoothstep(0.35 * cell, 0.0, F1) * (SID < 0.02)
    h = (rip * 0.0025 * rmask + bumps * 0.004 + grain * 0.00008 + shell * 0.0004 + peb * 0.0008).astype(F32)
    lum = (1 + 0.05 * grain) * (1 + 0.035 * rip * rmask) * (1 + 0.03 * bumps) * (1 + 0.5 * shell) * (1 - 0.4 * peb)
    ao = T.cavity_ao(h, px, 0.03, 40.0)
    alb = lum[..., None] * tcol('sand') * (0.8 + 0.2 * ao)[..., None]
    alb = fit_Y(alb, 'sand')
    rough = np.clip(0.93 - 0.05 * shell, 0.8, 0.99)
    nrm = T.height_to_normal(h, px, 1.0)
    print(f'  sand {n}: {time.time() - t0:.1f}s')
    return {'S': (S, S), 'albedo': alb, 'normal': nrm, 'rough': rough, 'height': h}


def roof(n):
    """גג שטוח (מרצפות בטון) לתוסף הבניינים: אותו מתכון כמו מרצפות הבטון, מנורמל לממוצע G גולמי 0.62 (השיידר שלו מחלק ב-0.62)."""
    d = concrete(n, seed=43)
    d['g_mean_raw'] = 0.62
    return d


def ground_pack(src_dir, rt_dir, n_src, sizes=(1024, 512)):
    """טקסטורת פרטי קרקע ארוזה לשיידר הקרקע: R = דשא, G = עשב יבש, B = חול - בהירות מנורמלת (ממוצע 0.5 = כפל 1.0)."""
    chans = []
    for nm in ('grass', 'drygrass', 'sand'):
        im = Image.open(os.path.join(src_dir, f'{nm}_c_{n_src}.jpg')).convert('RGB')
        a = T.srgb_to_lin(np.asarray(im, F32) / 255) @ Y
        a = a / max(1e-6, float(a.mean())) * 0.5
        chans.append(np.clip(a, 0, 1))
    pk = Image.fromarray(T.to8(np.stack(chans, -1)), 'RGB')     # כבר בכיוון הקובץ (שורה 0 = למעלה)
    out = {}
    for R in sizes:
        od = os.path.join(rt_dir, str(R))
        os.makedirs(od, exist_ok=True)
        p = os.path.join(od, 'ground_d.jpg')
        pk.resize((R, R), Image.LANCZOS).save(p, quality=90, subsampling=0, optimize=True)
        out[f'{R}/ground_d.jpg'] = {'bytes': os.path.getsize(p), 'sha': sha(p), 'px': [R, R]}
    return out


SETS = {
    'asphalt': asphalt, 'pavers': pavers, 'curb': curb, 'concrete': concrete, 'plaster': plaster, 'stone': stone,
    'palm': palm, 'roof': roof, 'grass': grass, 'drygrass': lambda n: grass(n, seed=85, dry=True), 'sand': sand,
}


# ------------------------------------------------------------------ שמירה
def fit_raw_g(alb_lin, g_target):
    """לתוסף הבניינים: מכפיל עד שממוצע ערוץ G הגולמי (sRGB) = היעד (השיידר שלו מחלק בקבוע)."""
    k = 1.0
    for _ in range(30):
        g = T.lin_to_srgb(np.clip(alb_lin[..., 1] * k, 0, 1)).mean()
        k *= (g_target / max(g, 1e-6)) ** 2.2
    return alb_lin * k


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()[:16]


def save_set(name, d, src_dir, rt_dir, sizes, manifest, write_src=True):
    alb = d['albedo']
    if 'g_mean_raw' in d:
        alb = fit_raw_g(alb, d['g_mean_raw'])
    maps = {'c': T.img_rgb_lin(alb), 'n': T.img_raw(T.normal_rgb(d['normal'], d['rough']))}
    for extra in ('albedo_red', 'albedo_gray'):
        if extra in d:
            maps['c_' + extra.split('_')[1]] = T.img_rgb_lin(d[extra])
    H, W = d['albedo'].shape[:2]
    ent = {'tile_m': list(d['S']), 'px': [W, H], 'files': {}, 'mean_lin': [round(float(v), 4) for v in alb.reshape(-1, 3).mean(0)]}
    if write_src:
        os.makedirs(src_dir, exist_ok=True)
        for k, im in maps.items():
            p = os.path.join(src_dir, f'{name}_{k}_{W}.jpg')
            im.save(p, quality=95, subsampling=0)
            ent['files'][f'src/{os.path.basename(p)}'] = {'bytes': os.path.getsize(p), 'sha': sha(p)}
        hp = os.path.join(src_dir, f'{name}_h_{W}.png')
        h = d['height']
        hn = (h - h.min()) / max(1e-9, float(h.max() - h.min()))
        Image.fromarray(np.flipud((hn * 65535).astype(np.uint16))).save(hp)
        ent['height_range_m'] = [round(float(h.min()), 5), round(float(h.max()), 5)]
    for R in sizes:
        r_w = R
        r_h = max(4, int(round(R * H / W)))
        od = os.path.join(rt_dir, str(R))
        os.makedirs(od, exist_ok=True)
        for k, im in maps.items():
            small = im.resize((r_w, r_h), Image.LANCZOS)
            if k.startswith('c'):
                p = os.path.join(od, f'{name}_{k}.jpg')
                small.save(p, quality=86, subsampling=2, optimize=True, progressive=True)
            else:
                # נורמל: הקטנה בממוצע של וקטורים (לא של צבעים) - נרמול מחדש אחרי ההקטנה
                a = np.asarray(small, F32) / 255
                nx, ny = a[..., 0] * 2 - 1, a[..., 1] * 2 - 1
                ln = np.sqrt(np.maximum(1e-6, nx * nx + ny * ny + np.maximum(0, 1 - nx * nx - ny * ny)))
                a[..., 0], a[..., 1] = (nx / ln) * 0.5 + 0.5, (ny / ln) * 0.5 + 0.5
                p = os.path.join(od, f'{name}_{k}.jpg')
                Image.fromarray(T.to8(a)).save(p, quality=90, subsampling=0, optimize=True, progressive=True)
            ent['files'][f'{R}/{os.path.basename(p)}'] = {'bytes': os.path.getsize(p), 'sha': sha(p), 'px': [r_w, r_h]}
    manifest[name] = ent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src-dir', required=True)
    ap.add_argument('--rt-dir', required=True)
    ap.add_argument('--n', type=int, default=4096)
    ap.add_argument('--sets', default=','.join(list(SETS) + ['asphalt_macro']))
    ap.add_argument('--sizes', default='2048,1024,512')
    ap.add_argument('--no-src', action='store_true')
    ap.add_argument('--manifest', default=None)
    a = ap.parse_args()
    sizes = [int(s) for s in a.sizes.split(',') if s]
    man_path = a.manifest or os.path.join(a.rt_dir, 'manifest.json')
    manifest = {}
    if os.path.exists(man_path):
        try:
            manifest = json.load(open(man_path)).get('sets', {})
        except Exception:
            manifest = {}
    t0 = time.time()
    for name in a.sets.split(','):
        if name == 'ground_pack':
            manifest['ground_pack'] = {'tile_m': [2, 2], 'note': 'R=דשא G=עשב יבש B=חול (בהירות מנורמלת, 0.5=1.0)', 'files': ground_pack(a.src_dir, a.rt_dir, a.n)}
            continue
        if name == 'asphalt_macro':
            mac = asphalt_macro(1024)
            im = T.img_raw(mac)
            ent = {'tile_m': [64, 64], 'px': [1024, 1024], 'files': {}, 'note': 'R=בהירות (0.5=1.0), G=טלאי זפת, B=קווי איטום'}
            for R in (1024, 512, 256):
                od = os.path.join(a.rt_dir, 'macro')
                os.makedirs(od, exist_ok=True)
                p = os.path.join(od, f'asphalt_m_{R}.jpg')
                im.resize((R, R), Image.LANCZOS).save(p, quality=90, subsampling=0, optimize=True)
                ent['files'][f'macro/{os.path.basename(p)}'] = {'bytes': os.path.getsize(p), 'sha': sha(p)}
            manifest['asphalt_macro'] = ent
            continue
        fn = SETS[name]
        d = fn(a.n)
        save_set(name, d, a.src_dir, a.rt_dir, sizes, manifest, write_src=not a.no_src)
        del d
    out = {'generator': 'twin/integration/tools/texfactory/make.py', 'license': 'מקורי (פרוצדורלי, ESH27) - אין נכסים חיצוניים',
           'n_src': a.n, 'targets_lin': {k: [round(float(x), 4) for x in tcol(k)] for k in TARGET}, 'sets': manifest}
    os.makedirs(a.rt_dir, exist_ok=True)
    json.dump(out, open(man_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'done in {time.time() - t0:.0f}s → {man_path}')


if __name__ == '__main__':
    main()
