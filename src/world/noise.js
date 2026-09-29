// noise 2D deterministik buat bentuk dunia (dataran salju, dinding celah).
// Value noise + fbm + ridged, cukup buat geometri yang dihitung sekali pas load.

function hash(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)

export function noise2(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = fade(fx)
  const v = fade(fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1 // -1..1
}

export function fbm(x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let s = 0
  let a = 1
  let n = 0
  for (let i = 0; i < oct; i++) {
    s += noise2(x, y) * a
    n += a
    x = x * lac + 17.3
    y = y * lac - 9.1
    a *= gain
  }
  return s / n
}

// punggungan tajam (gunung): 1 - |noise|, dipangkatin biar puncaknya runcing
export function ridged(x, y, oct = 5) {
  let s = 0
  let a = 1
  let n = 0
  let w = 1
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(noise2(x, y))
    r *= r
    s += r * a * w
    n += a
    w = Math.min(1, r * 1.6)
    x = x * 2.07 + 31.7
    y = y * 2.07 - 12.9
    a *= 0.5
  }
  return s / n
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
