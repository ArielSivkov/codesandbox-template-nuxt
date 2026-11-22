#!/usr/bin/env python3
"""Downsample a Radiance .hdr (RGBE) equirect to a smaller size, box filter in linear light.
Usage: python3 -I hdr_resize.py in.hdr out.hdr WIDTH"""
import sys
import numpy as np

def read_hdr(path):
    b = open(path, 'rb').read(); i = 0
    while True:
        j = b.index(b'\n', i); line = b[i:j]; i = j + 1
        if line.startswith((b'-Y', b'+Y')): break
    parts = line.split(); H, W = int(parts[1]), int(parts[3])
    img = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        if b[i] == 2 and b[i + 1] == 2 and (b[i + 2] << 8 | b[i + 3]) == W:  # new RLE
            i += 4
            for c in range(4):
                x = 0
                while x < W:
                    n = b[i]; i += 1
                    if n > 128:
                        n -= 128; img[y, x:x + n, c] = b[i]; i += 1
                    else:
                        img[y, x:x + n, c] = np.frombuffer(b[i:i + n], np.uint8); i += n
                    x += n
        else:  # flat
            img[y] = np.frombuffer(b[i:i + W * 4], np.uint8).reshape(W, 4); i += W * 4
    e = img[..., 3].astype(np.int32)
    f = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return img[..., :3].astype(np.float64) * f[..., None]

def write_hdr(path, rgb):
    H, W, _ = rgb.shape
    m = rgb.max(-1)
    mant, ex = np.frexp(m)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-38), 0)
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {H} +X {W}\n'.encode())
        f.write(out.tobytes())  # flat (uncompressed) scanlines; gzip/brotli on the server compresses well

src = read_hdr(sys.argv[1]); W = int(sys.argv[3]); k = src.shape[1] // W
H = src.shape[0] // k
small = src[:H * k, :W * k].reshape(H, k, W, k, 3).mean((1, 3))
write_hdr(sys.argv[2], small)
print(sys.argv[1], src.shape, '->', small.shape, 'max', round(float(src.max()), 1), 'sun peak kept as', round(float(small.max()), 1))
