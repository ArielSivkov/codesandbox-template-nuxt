"""texfactory/texlib.py - כלים לטקסטורות פרוצדורליות רציפות (גדוד טקסטורות, ESH27).

הכול מחזורי מעצם הבנייה (ריצוף בלי תפר): רעש ספקטרלי דרך FFT, תאי וורונוי על רשת מחזורית, נגזרות עם np.roll.
מוסכמה: מערכים בקואורדינטות (v, u) כש-v עולה כלפי מעלה (שורה 0 = v=0 = תחתית). בשמירה הופכים (flipud) כך ששורה 0 בקובץ = למעלה,
כמו ש-three.js מצפה (flipY=true). מפות נורמל: מוסכמת OpenGL (ירוק = +v), כמו ב-three.js.
אין כאן שום נכס חיצוני: כל פיקסל מחושב מזרע (seed) - תוצאה זהה בכל ריצה.
"""
import numpy as np
from PIL import Image

F32 = np.float32


def rng(seed):
    return np.random.default_rng(int(seed) & 0xFFFFFFFF)


# ------------------------------------------------------------------ רעש
def spectral(n, seed, beta=2.0, fmin=1.0, fmax=None, aniso=1.0, angle=0.0, m=None):
    """רעש גאוסי מחזורי n x m (ממוצע 0, סטיית תקן 1). תדרים במחזורים לאריח. beta: שיפוע הספקטרום (2 = חום/fBm).
    aniso>1 מותח את הצורות לאורך הכיוון angle (רדיאנים, 0 = לאורך u)."""
    m = m or n
    r = rng(seed)
    w = r.standard_normal((n, m), dtype=F32)
    F = np.fft.rfft2(w)
    # תדרים ביחידות "מחזורים לאורך האריח האופקי" (פיקסלים ריבועיים): ברצועה (m != n) ציר v מוכפל ב-m/n כדי שהצורות לא יימתחו
    fy = (np.fft.fftfreq(n) * n * (m / n)).astype(F32)[:, None]
    fx = (np.fft.rfftfreq(m) * m).astype(F32)[None, :]
    if aniso != 1.0:
        c, s = np.cos(angle), np.sin(angle)
        a = fx * c + fy * s
        b = -fx * s + fy * c
        f = np.sqrt((a / aniso) ** 2 + b ** 2 + 1e-12)   # קטן לאורך הכיוון = צורות ארוכות לאורכו
    else:
        f = np.sqrt(fx * fx + fy * fy + 1e-12)
    filt = np.power(np.maximum(f, 1e-6), -beta / 2.0, dtype=F32)
    filt *= (f >= fmin).astype(F32)
    if fmax:
        filt *= np.clip((fmax * 1.25 - f) / (fmax * 0.25), 0, 1).astype(F32)   # חיתוך רך
    filt[0, 0] = 0
    out = np.fft.irfft2(F * filt, s=(n, m)).astype(F32)
    out -= out.mean()
    sd = out.std()
    return out / (sd if sd > 0 else 1)


def fbm(n, seed, base=4, octaves=6, gain=0.5, lac=2.0, m=None):
    """fBm מחזורי (סכום אוקטבות ספקטרליות מוגבלות פס) - ממוצע 0, סטיית תקן ~1."""
    out = np.zeros((n, m or n), F32)
    a, f, tot = 1.0, float(base), 0.0
    for o in range(octaves):
        if f > min(n, m or n) / 2:
            break
        out += a * spectral(n, seed * 131 + o, beta=0.0, fmin=f / 1.5, fmax=f * 1.5, m=m)
        tot += a * a
        a *= gain
        f *= lac
    return out / np.sqrt(tot)


def worley(n, cells, seed, m=None, jitter=1.0, block=1024):
    """וורונוי מחזורי על רשת מרוצדת: cells תאים לאורך n (ו-cells*m/n לאורך m).
    מחזיר F1, F2 (במרחק פיקסלים) ו-id (מספר אקראי 0..1 לכל תא). מחושב בבלוקים של שורות (זיכרון קבוע גם ב-8K)."""
    m = m or n
    cy, cx = cells, max(1, round(cells * m / n))
    r = rng(seed)
    jx = r.random((cy, cx), dtype=F32) * jitter + (1 - jitter) / 2
    jy = r.random((cy, cx), dtype=F32) * jitter + (1 - jitter) / 2
    rid = r.random((cy, cx), dtype=F32)
    sy, sx = n / cy, m / cx
    xx = (np.arange(m, dtype=F32) + 0.5) / sx
    ix0 = np.floor(xx).astype(np.int32)
    F1 = np.empty((n, m), F32)
    F2 = np.empty((n, m), F32)
    ID = np.empty((n, m), F32)
    for r0 in range(0, n, block):
        r1 = min(n, r0 + block)
        yy = (np.arange(r0, r1, dtype=F32) + 0.5) / sy
        iy0 = np.floor(yy).astype(np.int32)
        f1 = np.full((r1 - r0, m), 1e9, F32)
        f2 = np.full((r1 - r0, m), 1e9, F32)
        idb = np.zeros((r1 - r0, m), F32)
        for dy in (-1, 0, 1):
            iy = iy0 + dy
            wy = np.mod(iy, cy)
            for dx in (-1, 0, 1):
                ix = ix0 + dx
                wx = np.mod(ix, cx)
                fy = (iy[:, None] + jy[wy[:, None], wx[None, :]]) * sy      # מיקום הנקודה בפיקסלים (לא מקופל - רציף)
                fx = (ix[None, :] + jx[wy[:, None], wx[None, :]]) * sx
                d = np.sqrt((fy - (yy[:, None] * sy)) ** 2 + (fx - (xx[None, :] * sx)) ** 2).astype(F32)
                closer = d < f1
                f2 = np.where(closer, f1, np.minimum(f2, d))
                idb = np.where(closer, rid[wy[:, None], wx[None, :]], idb)
                f1 = np.where(closer, d, f1)
        F1[r0:r1], F2[r0:r1], ID[r0:r1] = f1, f2, idb
    return F1, F2, ID


# ------------------------------------------------------------------ עזרים
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return (t * t * (3 - 2 * t)).astype(F32)


def blur(a, sigma_px):
    """טשטוש גאוסי מחזורי דרך FFT."""
    n, m = a.shape
    fy = np.fft.fftfreq(n).astype(F32)[:, None]
    fx = np.fft.rfftfreq(m).astype(F32)[None, :]
    g = np.exp(-2 * (np.pi * sigma_px) ** 2 * (fx * fx + fy * fy)).astype(F32)
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=(n, m)).astype(F32)


def height_to_normal(h, px_m, strength=1.0):
    """h במטרים, px_m = גודל פיקסל במטרים. נורמל OpenGL: x לאורך u, y לאורך v (v עולה למעלה במערך)."""
    dhdu = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * px_m)
    dhdv = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) / (2 * px_m)
    nx, ny, nz = -dhdu * strength, -dhdv * strength, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], axis=-1).astype(F32)


def cavity_ao(h, px_m, radius_m, strength):
    """AO מקורב: כמה הנקודה נמוכה מהסביבה (high-pass שלילי)."""
    lo = blur(h, max(1.0, radius_m / px_m))
    d = (h - lo)
    ao = 1.0 + np.minimum(d, 0) * strength
    return np.clip(ao, 0.0, 1.0).astype(F32)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(F32)


def srgb_to_lin(c):
    c = np.asarray(c, dtype=F32)
    return np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4)).astype(F32)


def hex_lin(h):
    h = h.lstrip('#')
    return srgb_to_lin(np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], F32))


def colorize(base_lin, lum_mod, tint=None):
    """base_lin: צבע ליניארי (3,), lum_mod: מערך כפלי (ממוצע ~1)."""
    out = lum_mod[..., None] * np.asarray(base_lin, F32)[None, None, :]
    if tint is not None:
        out = out * tint
    return out.astype(F32)


def match_mean(rgb_lin, target_lin, mask=None):
    """מכפיל כל ערוץ כך שהממוצע הליניארי יהיה target (כיול צבע)."""
    w = rgb_lin.reshape(-1, 3) if mask is None else rgb_lin[mask]
    cur = w.mean(axis=0)
    k = np.asarray(target_lin, F32) / np.maximum(cur, 1e-6)
    return (rgb_lin * k[None, None, :]).astype(F32)


# ------------------------------------------------------------------ שמירה
def to8(a):
    return np.clip(np.rint(a * 255), 0, 255).astype(np.uint8)


def img_rgb_lin(rgb_lin):
    """ליניארי → sRGB 8 ביט, בהיפוך אנכי (שורה 0 = למעלה)."""
    return Image.fromarray(to8(np.flipud(lin_to_srgb(rgb_lin))), 'RGB')


def img_raw(rgb01):
    """ערכים גולמיים 0..1 (נורמל/מסכות) בלי המרת צבע, בהיפוך אנכי."""
    return Image.fromarray(to8(np.flipud(rgb01)), 'RGB')


def normal_rgb(nrm, extra_b=None):
    """נורמל (‎-1..1) → RGB. אם extra_b ניתן (למשל AO) הוא נכנס לערוץ B (את z משחזרים בשיידר מ-xy)."""
    out = nrm * 0.5 + 0.5
    if extra_b is not None:
        out = out.copy()
        out[..., 2] = extra_b
    return out.astype(F32)


def resize(img, size):
    return img.resize(size, Image.LANCZOS)
