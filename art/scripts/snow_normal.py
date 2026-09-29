"""Bikin tekstur detail salju tileable buat icev2 (public/textures/snow_detail.jpg).

R,G = normal xy (tangent space datar, 0.5 = tegak), B = tinggi (buat cekungan/AO).
Tinggi dibangun dari spektrum FFT (otomatis nyambung di tepi):
  - sastrugi: riak angin memanjang searah sumbu x (anisotropik)
  - gundukan kecil + butiran halus
Jalanin: python art/scripts/snow_normal.py
"""
import pathlib
import numpy as np
import cv2

N = 1024
OUT = pathlib.Path(__file__).resolve().parents[2] / "public" / "textures" / "snow_detail.jpg"
rng = np.random.default_rng(29)

fx = np.fft.fftfreq(N)[None, :] * N
fy = np.fft.fftfreq(N)[:, None] * N


def field(power, ax=1.0, ay=1.0, lo=1.0, hi=N / 2):
    """noise tileable: amplitudo spektrum ~ 1/f^power, bisa dipanjangin per sumbu"""
    f = np.sqrt((fx * ax) ** 2 + (fy * ay) ** 2)
    f[0, 0] = 1
    amp = np.where((f >= lo) & (f <= hi), f ** -power, 0.0)
    ph = np.exp(2j * np.pi * rng.random((N, N)))
    h = np.real(np.fft.ifft2(amp * ph))
    return (h - h.mean()) / (h.std() + 1e-9)


# riak angin: frekuensi rendah di x (memanjang), tinggi di y (rapat)
sastrugi = field(1.9, ax=1.0, ay=0.2, lo=4, hi=48)
# riak dibikin tajem sebelah (profil gelombang pasir/salju: landai lalu curam)
sastrugi = np.tanh(sastrugi * 1.4)
bumps = field(2.4, lo=2, hi=24)
grain = field(0.6, lo=120, hi=N / 2)
h = 0.5 * sastrugi + 0.45 * bumps + 0.025 * grain
h = (h - h.min()) / (h.max() - h.min())

# normal dari gradien periodik (np.roll = nyambung di tepi)
k = 2.6
dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * k * N / 256
dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * k * N / 256
n = np.dstack([-dx, -dy, np.ones_like(h)])
n /= np.linalg.norm(n, axis=2, keepdims=True)

img = np.dstack([
    (h * 255),                       # B (opencv BGR: kanal 0 = biru)
    ((n[..., 1] * 0.5 + 0.5) * 255),  # G = normal y
    ((n[..., 0] * 0.5 + 0.5) * 255),  # R = normal x
]).clip(0, 255).astype(np.uint8)
OUT.parent.mkdir(parents=True, exist_ok=True)
img = cv2.resize(img, (512, 512), interpolation=cv2.INTER_AREA)
cv2.imwrite(str(OUT), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
print(OUT, OUT.stat().st_size // 1024, "KB")
