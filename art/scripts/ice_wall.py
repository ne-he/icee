"""Tekstur detail dinding es gletser buat icev2 (public/textures/ice_wall.jpg).

Dinding celah gletser asli punya dua ciri yang bikin kebaca "es beneran":
  - scallop: cekungan-cekungan halus bekas lelehan (kayak sisik lebar)
  - strata: pita lapisan salju yang udah jadi es, horizontal, beda terang
R,G = normal xy, B = kombinasi strata + kedalaman scallop (buat warna/tembus cahaya).
Tileable (Voronoi di torus + FFT). Jalanin: python art/scripts/ice_wall.py
"""
import pathlib
import numpy as np
import cv2

N = 512
OUT = pathlib.Path(__file__).resolve().parents[2] / "public" / "textures" / "ice_wall.jpg"
rng = np.random.default_rng(7)

# ---- scallop: jarak ke titik Voronoi terdekat (di torus biar nyambung di tepi) ----
pts = rng.random((70, 2)) * N
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
d1 = np.full((N, N), 1e9, np.float32)
d2 = np.full((N, N), 1e9, np.float32)
for px, py in pts:
    for ox in (-N, 0, N):
        for oy in (-N, 0, N):
            # scallop agak memanjang horizontal (sy 1.35)
            d = np.sqrt((xx - px - ox) ** 2 + ((yy - py - oy) * 1.35) ** 2)
            closer = d < d1
            d2 = np.where(closer, d1, np.minimum(d2, d))
            d1 = np.where(closer, d, d1)
cell = d1 / (d1 + d2 + 1e-6)  # 0 di pusat cekungan, 0.5 di tepi
scallop = -np.cos(np.clip(cell * 2.0, 0, 1) * np.pi * 0.5)  # cekung halus, tepi tajam dikit

fx = np.fft.fftfreq(N)[None, :] * N
fy = np.fft.fftfreq(N)[:, None] * N


def field(power, ax=1.0, ay=1.0, lo=1.0, hi=N / 2):
    f = np.sqrt((fx * ax) ** 2 + (fy * ay) ** 2)
    f[0, 0] = 1
    amp = np.where((f >= lo) & (f <= hi), f ** -power, 0.0)
    h = np.real(np.fft.ifft2(amp * np.exp(2j * np.pi * rng.random((N, N)))))
    return (h - h.mean()) / (h.std() + 1e-9)


# strata: noise yang cuma berubah ke arah y (pita horizontal), sedikit bergelombang
strata = field(1.3, ax=8.0, ay=1.0, lo=3, hi=60)
grain = field(0.8, lo=90, hi=N / 2)
h = 0.75 * scallop + 0.08 * strata + 0.015 * grain
h = (h - h.min()) / (h.max() - h.min())

k = 3.2
dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * k * N / 128
dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * k * N / 128
n = np.dstack([-dx, -dy, np.ones_like(h)])
n /= np.linalg.norm(n, axis=2, keepdims=True)

st = (strata - strata.min()) / (strata.max() - strata.min())
b = 0.65 * st + 0.35 * (1 - cell * 2).clip(0, 1)
img = np.dstack([b * 255, (n[..., 1] * 0.5 + 0.5) * 255, (n[..., 0] * 0.5 + 0.5) * 255]).clip(0, 255).astype(np.uint8)
OUT.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(OUT), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
print(OUT, OUT.stat().st_size // 1024, "KB")
