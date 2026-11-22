#!/usr/bin/env python3
"""Procedural, seamlessly tiling PBR materials for an Israeli coastal city (CC0, own work).
Every map is periodic (noise made by FFT filtering of white noise, joints by modulo), so it tiles.
Output per material: <name>_albedo.png (sRGB), <name>_normal.png (OpenGL +Y), <name>_orm.png (R=AO, G=roughness, B=metalness)
plus materials.json with physical size (metres per tile) and three.js MeshStandardMaterial parameters.
Usage: python3 -I gen_textures.py OUT_DIR [size]
"""
import json, os, sys
import numpy as np
from PIL import Image

OUT = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(27)

fy = np.fft.fftfreq(N)[:, None]; fx = np.fft.fftfreq(N)[None, :]
FR = np.sqrt(fx * fx + fy * fy) + 1e-9

def noise(scale_px, beta=2.0, aniso=(1.0, 1.0)):
    """periodic fractal noise, features ~scale_px, normalised to 0..1"""
    w = rng.standard_normal((N, N))
    f = np.sqrt((fx * aniso[0]) ** 2 + (fy * aniso[1]) ** 2) + 1e-9
    amp = f ** (-beta / 2) * np.exp(-(f * scale_px) ** 2 * 0.0) * (f > 1.0 / max(scale_px, 1) / 8)
    amp *= np.exp(-(f * scale_px / 2.0) ** 2)  # low-pass at feature size
    n = np.real(np.fft.ifft2(np.fft.fft2(w) * amp))
    n -= n.min(); n /= n.max() + 1e-9
    return n

def fine(scale_px):
    w = rng.standard_normal((N, N))
    amp = np.exp(-(FR * scale_px) ** 2)
    n = np.real(np.fft.ifft2(np.fft.fft2(w) * amp)); n -= n.min(); return n / (n.max() + 1e-9)

def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    nx, ny, nz = -dx, dy, np.ones_like(h)  # OpenGL convention (+Y up in tangent space, image rows go down)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5

def ao_from_height(h, k=1.0):
    blur = (fine(1) * 0)  # placeholder to keep rng stream stable
    lo = h.copy()
    for s in (2, 6, 14):
        lo = np.minimum(lo, h)
    # cavity: height minus its blurred version (periodic gaussian via FFT)
    H = np.fft.fft2(h)
    b = np.real(np.fft.ifft2(H * np.exp(-(FR * 18) ** 2)))
    cav = np.clip((h - b) * 4 * k + 0.85, 0, 1)
    return np.clip(cav, 0.35, 1)

def rgb(hexs):
    hexs = hexs.lstrip('#'); return np.array([int(hexs[i:i + 2], 16) for i in (0, 2, 4)], float) / 255

def tint(base, var, *fields):
    c = np.ones((N, N, 3)) * rgb(base)
    for f, amt in zip(fields, var):
        c *= (1 + (f[..., None] - 0.5) * amt)
    return np.clip(c, 0, 1)

def save(name, albedo, height, rough, nstr, metal=0.0, ao=None, meta=None):
    nrm = normal_from_height(height, nstr)
    if ao is None: ao = ao_from_height(height)
    orm = np.stack([ao, np.clip(rough, 0.02, 1), np.full((N, N), metal)], -1)
    Image.fromarray((np.clip(albedo, 0, 1) ** 1 * 255).astype(np.uint8)).save(f'{OUT}/{name}_albedo.png')
    Image.fromarray((nrm * 255).astype(np.uint8)).save(f'{OUT}/{name}_normal.png')
    Image.fromarray((orm * 255).astype(np.uint8)).save(f'{OUT}/{name}_orm.png')
    MATS[name] = meta
    print('wrote', name)

MATS = {}
yy, xx = np.mgrid[0:N, 0:N]

# 1. raw concrete (בטון חשוף) – 2 m tile, formwork panel seams every 1 m horizontally
big, mid, sm = noise(300), noise(60), fine(1.5)
_p = fine(1.2); pores = (_p > np.quantile(_p, 0.97)).astype(float)
h = 0.5 * mid + 0.25 * sm - 0.6 * pores
seam = (np.abs(((yy / N * 2) % 1) - 0.5) > 0.497).astype(float)
h -= seam * 0.4
alb = tint('#9c9a94', (0.25, 0.12, 0.08), big, mid, sm) * (1 - 0.35 * pores[..., None]) * (1 - 0.15 * seam[..., None])
streak = noise(60, aniso=(0.3, 5))
alb *= (1 - 0.07 * np.clip((streak[..., None] - 0.6) * 5, 0, 1))
save('concrete', alb, h, 0.86 + 0.1 * (mid - 0.5), 4.0, meta=dict(tile_m=2.0, he='בטון חשוף', roughness=1, metalness=0))

# 2. light plaster / שליכט (spray texture, very Israeli facades)
grain = fine(1.6); blob = fine(3.5)
h = 0.6 * blob + 0.4 * grain
alb = tint('#e9e2d3', (0.06, 0.03, 0.10), noise(400), noise(80), grain)
dirt = noise(200, aniso=(0.4, 4))
alb *= 1 - 0.04 * np.clip((dirt[..., None] - 0.6) * 4, 0, 1)
save('plaster_light', alb, h, 0.92 + 0.06 * (grain - 0.5), 9.0, meta=dict(tile_m=1.0, he='שליכט / טיח בהיר', roughness=1, metalness=0))

# 3. limestone ashlar (אבן נסורה, "אבן ירושלמית") – 4 courses x 2 stones per 1.2 m tile (stone 60x30 cm)
rows, cols = 4, 2
r = (yy * rows // N); c = ((xx + (r % 2) * N // (2 * cols)) * cols // N) % cols
cell = r * 7 + c
ids = (cell * 2654435761 % 1000) / 1000.0
fy_ = (yy * rows / N) % 1; fx_ = (((xx + (r % 2) * N // (2 * cols)) * cols / N)) % 1
edge = np.minimum(np.minimum(fy_, 1 - fy_) * N / rows, np.minimum(fx_, 1 - fx_) * N / cols)
joint = np.clip(1 - edge / 4.0, 0, 1)
chisel = noise(30, aniso=(1, 3)); sm = fine(1.3)
h = 0.6 + 0.12 * chisel + 0.08 * sm - 0.55 * joint - 0.1 * np.clip(1 - edge / 18, 0, 1)
base = np.ones((N, N, 3)) * rgb('#d9c7a3')
base *= (0.9 + 0.2 * ids[..., None]) * np.array([1.0, 0.99, 0.96])
alb = base * (1 + (chisel[..., None] - 0.5) * 0.12) * (1 + (sm[..., None] - 0.5) * 0.08)
_f = fine(2); fossil = (_f > np.quantile(_f, 0.985)).astype(float)
alb *= 1 - 0.18 * fossil[..., None]
alb = alb * (1 - joint[..., None]) + rgb('#b9ad97') * joint[..., None]
save('limestone', alb, h, 0.8 + 0.1 * chisel, 6.0, meta=dict(tile_m=1.2, he='אבן גיר נסורה (בהשראת אבן ירושלמית)', roughness=1, metalness=0, note='אבן 60x30 ס"מ'))

# 4. asphalt (אספלט)
agg = fine(1.4); _s = fine(1.8); stones = np.clip((_s - np.quantile(_s, 0.80)) * 8, 0, 1)
wear = noise(350)
h = 0.4 * agg + 0.6 * stones
alb = tint('#3b3b3d', (0.35, 0.25), agg, wear)
alb = alb * (1 - 0.6 * stones[..., None]) + rgb('#8a8780') * 0.6 * stones[..., None]
oil = noise(160)
alb *= 1 - 0.25 * np.clip((oil[..., None] - 0.7) * 5, 0, 1)
save('asphalt', alb, h, 0.92 - 0.25 * np.clip((oil - 0.7) * 5, 0, 1), 5.0, meta=dict(tile_m=4.0, he='אספלט', roughness=1, metalness=0))

# 5. sidewalk pavers (אבן משתלבת אפורה, 20x10 cm, running bond) – 1 m tile, 10x5 pavers
pr, pc = 10, 5
r = yy * pr // N; ox = (r % 2) * N // (2 * pc)
c = ((xx + ox) * pc // N) % pc
ids = ((r * 31 + c * 17) * 2654435761 % 997) / 997.0
fy_ = (yy * pr / N) % 1; fx_ = ((xx + ox) * pc / N) % 1
edge = np.minimum(np.minimum(fy_, 1 - fy_) * N / pr, np.minimum(fx_, 1 - fx_) * N / pc)
bevel = np.clip(edge / 5.0, 0, 1)
sm = fine(1.3)
h = 0.6 * bevel + 0.1 * sm
red = (ids > 0.86)[..., None]
base = np.where(red, rgb('#a3695a'), rgb('#9a9892')) * (0.88 + 0.22 * ids[..., None])
alb = base * (1 + (sm[..., None] - 0.5) * 0.18) * (0.55 + 0.45 * bevel[..., None])
save('sidewalk_pavers', alb, h, 0.88 + 0.08 * sm, 5.0, meta=dict(tile_m=1.0, he='מדרכה – אבן משתלבת', roughness=1, metalness=0))

# 6. sand (חול חוף/דיונה, אשדוד)
rip = noise(70, beta=2.5, aniso=(0.25, 1.8)); grains = fine(1.0)
h = 0.75 * rip + 0.25 * grains
alb = tint('#dcc49a', (0.10, 0.12, 0.10), noise(500), rip, grains)
_sh = fine(1.5); shell = (_sh > np.quantile(_sh, 0.992))[..., None]
alb = np.where(shell, rgb('#f2ece0'), alb)
save('sand', alb, h, 0.95 + 0.0 * grains, 7.0, meta=dict(tile_m=3.0, he='חול', roughness=1, metalness=0))

# 7. flat roof with white waterproofing (גג שטוח עם איטום לבן/ביטומן) – typical Israeli roof
cracks = noise(25, beta=1.6); patch = noise(220); sm = fine(1.2)
h = 0.3 * cracks + 0.2 * sm
painted = (patch > np.quantile(patch, 0.06))[..., None]
alb = np.where(painted, rgb('#d8d6cf'), rgb('#4a4744')) * (1 + (cracks[..., None] - 0.5) * 0.15) * (1 + (sm[..., None] - 0.5) * 0.06)
alb *= 1 - 0.15 * np.clip((noise(90)[..., None] - 0.6) * 4, 0, 1)
save('roof_flat', alb, h, np.where(painted[..., 0], 0.8, 0.65) + 0.05 * sm, 3.0, meta=dict(tile_m=3.0, he='גג שטוח – איטום', roughness=1, metalness=0))

# 8. clay roof tiles (רעפים) – 1 m tile, 4 rows x 5 tiles
tr, tc = 4, 5
r = yy * tr // N; fy_ = (yy * tr / N) % 1
fx_ = ((xx + (r % 2) * N // (2 * tc)) * tc / N) % 1
c = ((xx + (r % 2) * N // (2 * tc)) * tc // N) % tc
ids = ((r * 13 + c * 7) * 2654435761 % 991) / 991.0
curve = np.sin(fx_ * np.pi) ** 0.6
overlap = fy_  # each row thickens toward its lower edge
h = 0.55 * curve + 0.45 * overlap
shadow = np.clip(overlap * 1.2, 0.35, 1)
alb = rgb('#b4553a') * (0.85 + 0.3 * ids[..., None]) * (0.75 + 0.25 * curve[..., None]) * shadow[..., None]
alb *= 1 + (fine(1.5)[..., None] - 0.5) * 0.12
save('roof_tiles', alb, h, 0.7 + 0.1 * fine(2), 8.0, ao=shadow, meta=dict(tile_m=1.0, he='רעפי חרס', roughness=1, metalness=0))

# 9. glass (זכוכית חלון) – mostly parameters; tiny waviness normal, dark reflective albedo
wav = noise(200, aniso=(1, 0.3))
alb = tint('#2b3a40', (0.05,), wav)
save('glass', alb, wav * 0.2, np.full((N, N), 0.06), 0.5, metal=0.0, ao=np.ones((N, N)),
     meta=dict(tile_m=2.0, he='זכוכית', roughness=1, metalness=0.55, envMapIntensity=1.6, transparent=False,
               note='לטלפון: לא שקוף (opaque) עם השתקפות סביבה; שקיפות אמיתית יקרה במיון'))

json.dump(MATS, open(f'{OUT}/materials.json', 'w'), ensure_ascii=False, indent=1)
