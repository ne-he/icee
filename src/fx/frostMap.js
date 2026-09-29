// ===== peta embun beku (frost) buatan, sekali bikin di canvas =====
// Dipakai dua jalur: shader TransitionEffect (desktop) dan overlay DOM (HP).
// Nol file tambahan, digambar sekali pas modul pertama kali diminta.
//
// Dua bagian:
//  - ubin kristal (tileable): dendrit es bercabang, digambar dengan wrap di
//    tepi ubin, jadi bisa diulang di layar dengan skala tetap (garisnya tetep
//    tajam & gak ketarik ngikut rasio layar)
//  - peta tumbuh (ruang layar): tinggi di sudut & tepi, rendah di tengah, plus
//    noise. Shader nge-threshold ini pakai kekuatan frost, jadi embunnya
//    MERAMBAT dari tepi ke tengah, bukan cuma fade
//
// Tekstur shader (canvas opaque, gak ada urusan premultiply alpha):
//   R = kristal, G = peta tumbuh (dibaca di uv layar), B = kristal di-blur
//   (gradiennya jadi arah pembiasan)

// PRNG deterministik: tiap kunjungan pola frost-nya sama
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function valueNoise(rnd, n) {
  const g = new Float32Array(n * n)
  for (let i = 0; i < g.length; i++) g[i] = rnd()
  return (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const at = (i, j) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)]
    const a = at(xi, yi)
    const b = at(xi + 1, yi)
    const c = at(xi, yi + 1)
    const d = at(xi + 1, yi + 1)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
  }
}

// dendrit: jalan acak yang sesekali bercabang ~60 derajat (bulu es), makin
// jauh makin tipis. Tiap segmen digambar 9x (geser ±S) biar ubinnya nyambung
function dendrite(ctx, rnd, S, x, y, ang, len, w, depth) {
  let px = x
  let py = y
  const step = 2.5
  const n = Math.max(2, Math.floor(len / step))
  for (let i = 0; i < n; i++) {
    ang += (rnd() - 0.5) * 0.3
    const nx = px + Math.cos(ang) * step
    const ny = py + Math.sin(ang) * step
    ctx.lineWidth = Math.max(0.45, w * (1 - (i / n) * 0.75))
    ctx.beginPath()
    for (let ox = -S; ox <= S; ox += S) {
      for (let oy = -S; oy <= S; oy += S) {
        ctx.moveTo(px + ox, py + oy)
        ctx.lineTo(nx + ox, ny + oy)
      }
    }
    ctx.stroke()
    if (depth > 0 && rnd() < 0.3) {
      const side = rnd() < 0.5 ? -1 : 1
      dendrite(ctx, rnd, S, nx, ny, ang + side * (0.9 + rnd() * 0.25), len * (0.18 + rnd() * 0.22), w * 0.62, depth - 1)
    }
    px = nx
    py = ny
  }
}

// box blur 2 lintasan dengan wrap (ubin tetep nyambung)
function blurWrap(src, S, r) {
  const tmp = new Float32Array(S * S)
  const out = new Float32Array(S * S)
  const k = 1 / (2 * r + 1)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += src[y * S + ((x + i + S) % S)]
      tmp[y * S + x] = s * k
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += tmp[((y + i + S) % S) * S + x]
      out[y * S + x] = s * k
    }
  }
  return out
}

const cache = new Map()

// ubin kristal S x S (0..1) + versi blur-nya
function crystalTile(S) {
  const key = 'c' + S
  if (cache.has(key)) return cache.get(key)
  const rnd = mulberry(20260929)
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, S, S)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  const u = S / 512
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.2 + rnd() * 0.3})`
    dendrite(ctx, rnd, S, rnd() * S, rnd() * S, rnd() * Math.PI * 2, (50 + rnd() * 130) * u, (0.9 + rnd() * 1.1) * u, 3)
  }
  // butiran kilau halus
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.08 + rnd() * 0.25})`
    ctx.fillRect(rnd() * S, rnd() * S, u * (0.7 + rnd()), u * (0.7 + rnd()))
  }
  const img = ctx.getImageData(0, 0, S, S).data
  const crystal = new Float32Array(S * S)
  for (let i = 0; i < S * S; i++) crystal[i] = Math.min(1, img[i * 4] / 255)
  const soft = blurWrap(crystal, S, Math.max(2, Math.round(3 * u)))
  const out = { crystal, soft }
  cache.set(key, out)
  return out
}

// peta tumbuh di ruang layar (W x H), 0 tengah .. 1 sudut
function growMap(W, H) {
  const n1 = valueNoise(mulberry(7), 64)
  const grow = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const qx = Math.abs(x / W - 0.5) * 2
      const qy = Math.abs(y / H - 0.5) * 2
      // superelips: sudut paling tinggi, tepi sedang, tengah 0
      const r = Math.pow(Math.pow(qx, 4) + Math.pow(qy, 4), 0.25)
      const nz = n1((x / W) * 6, (y / H) * 6) * 0.6 + n1((x / W) * 17 + 5, (y / H) * 17) * 0.4
      grow[y * W + x] = Math.min(1, Math.max(0, (r - 0.35) / 0.8 + (nz - 0.5) * 0.5))
    }
  }
  return grow
}

// canvas RGB buat tekstur shader: R/B ubin kristal, G peta tumbuh (layar)
export function frostCanvasRGB(S = 512) {
  const { crystal, soft } = crystalTile(S)
  const grow = growMap(S, S)
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')
  const im = ctx.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    im.data[i * 4] = crystal[i] * 255
    im.data[i * 4 + 1] = grow[i] * 255
    im.data[i * 4 + 2] = Math.min(1, soft[i] * 2.4) * 255
    im.data[i * 4 + 3] = 255
  }
  ctx.putImageData(im, 0, 0)
  return cv
}

// frost siap tempel ke canvas DOM (HP), digambar pas rasio layar biar
// kristalnya gak ketarik: putih kebiruan, alpha = kristal di area tumbuh +
// kabut embun tipis di sudut. Rambatannya di DOM lewat transform scale (murah)
export function paintFrostRGBA(cv, W, H) {
  const T = 256
  const { crystal } = crystalTile(T)
  const grow = growMap(W, H)
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')
  const im = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const g = grow[i]
      const c = crystal[(y % T) * T + (x % T)]
      const reach = Math.min(1, Math.max(0, (g - 0.25) / 0.45))
      const haze = Math.min(1, Math.max(0, (g - 0.55) / 0.45))
      const a = Math.min(1, c * 1.5 * reach + haze * haze * 0.45)
      im.data[i * 4] = 228
      im.data[i * 4 + 1] = 239
      im.data[i * 4 + 2] = 247
      im.data[i * 4 + 3] = a * 255
    }
  }
  ctx.putImageData(im, 0, 0)
}
