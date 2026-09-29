import { useEffect, useRef } from 'react'
import { LOW } from '../perf'
import { computeFx } from './fxState'
import { paintFrostRGBA } from './frostMap'

// ===== lapisan DOM transisi (desktop & HP) =====
// - putih badai (.fx-white) + gumpalan salju hanyut (.fx-drift): white-out
//   jembatan loop & intro. Di desktop juga DOM (bukan shader) biar HUD ikut
//   ketutup dan jalurnya sama persis kayak HP
// - frost DOM (.fx-frost): CUMA HP. Desktop frost-nya di shader
//   (TransitionEffect), HP gak punya EffectComposer. Rambatan dari tepi =
//   transform scale, murah (cuma compositing, gak repaint)
// - coretan salju (.snow-veil canvas): badai di atas putih, biar plateau
//   putihnya ada gerak, bukan layar putih kosong
// Semua digerakin stepFxDom() dari master loop App (frame yang sama dengan
// update scroll), bukan rAF sendiri.
const els = { white: null, drift: null, frost: null, veil: null, ctx: null }
const veil = { W: 0, H: 0, dpr: 1, drew: false, last: 0, flakes: null, driftX: 0 }

const clamp01 = (x) => Math.min(1, Math.max(0, x))

// opacity & visibility cuma ditulis kalau berubah (hindari style recalc tiap frame)
const last = new Map()
function setOp(el, key, v) {
  if (!el) return
  const q = Math.round(v * 1000) / 1000
  if (last.get(key) === q) return
  last.set(key, q)
  el.style.opacity = q
  el.style.visibility = q > 0.002 ? 'visible' : 'hidden'
}

function makeFlakes() {
  const rnd = (s) => {
    const x = Math.sin(s * 12.9898) * 43758.5453
    return x - Math.floor(x)
  }
  // 3 lapis: jauh (kecil, pelan, samar) sampai deket (gede, kenceng, jelas)
  return Array.from({ length: LOW ? 90 : 170 }, (_, i) => {
    const layer = i % 3
    return {
      x: rnd(i + 1),
      y: rnd(i + 7),
      r: (0.6 + rnd(i + 3) * 1.2) * (0.7 + layer * 0.5),
      spd: 0.45 + layer * 0.5 + rnd(i + 5) * 0.35,
      a: 0.3 + layer * 0.25,
      ph: rnd(i + 11) * 6.28,
    }
  })
}

export function stepFxDom(now) {
  const f = computeFx()
  const dt = veil.last ? Math.min(0.05, (now - veil.last) / 1000) : 0
  veil.last = now
  setOp(els.white, 'white', f.white)
  const dOp = f.calm ? 0 : f.white * 0.9
  setOp(els.drift, 'drift', dOp)
  if (els.drift && dOp > 0.002) {
    // gumpalan badai hanyut searah angin (transform doang). Teksturnya
    // periodik tiap 100vw, jadi modulo 100 nyambung tanpa sambungan
    veil.driftX = (veil.driftX + f.sx * dt * 38) % 100
    els.drift.style.transform = `translate3d(${(-veil.driftX).toFixed(2)}vw, ${(Math.sin(now * 0.0004) * 2).toFixed(2)}vh, 0)`
  }
  if (LOW) {
    // frost HP: muncul sambil "nutup" dari luar layar ke tepi
    setOp(els.frost, 'frost', clamp01(f.frost * 1.4))
    if (els.frost && f.frost > 0.002) {
      els.frost.style.transform = `scale(${(1.32 - 0.3 * clamp01(f.frost)).toFixed(3)})`
    }
  }
  drawVeil(dt, f)
}

function drawVeil(dt, f) {
  const ctx = els.ctx
  if (!ctx) return
  const env = f.calm ? 0 : f.streaks
  if (env <= 0.01) {
    // mayoritas waktu: canvas kosong, di-clear SEKALI pas mati (bukan tiap frame)
    if (veil.drew) {
      ctx.clearRect(0, 0, veil.W, veil.H)
      veil.drew = false
      els.veil.style.visibility = 'hidden'
    }
    return
  }
  if (!veil.drew) els.veil.style.visibility = 'visible'
  veil.drew = true
  const { W, H } = veil
  ctx.clearRect(0, 0, W, H)
  ctx.lineCap = 'round'
  for (const fl of veil.flakes) {
    fl.x += f.sx * fl.spd * dt
    fl.y += f.sy * fl.spd * dt
    fl.ph += dt * 2
    fl.x -= Math.floor(fl.x)
    fl.y -= Math.floor(fl.y)
    const px = fl.x * W
    const py = fl.y * H
    // panjang coretan = jarak tempuh ~45 ms (motion blur)
    const sx = f.sx * fl.spd * W * 0.045
    const sy = f.sy * fl.spd * H * 0.045
    const a = fl.a * env * (0.75 + 0.25 * Math.sin(fl.ph))
    // abu kebiruan tipis + inti putih: di atas putih badai tetep kebaca
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(px - sx, py - sy)
    ctx.strokeStyle = `rgba(140,156,174,${(a * 0.5).toFixed(3)})`
    ctx.lineWidth = fl.r * 2 + 1
    ctx.stroke()
    ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`
    ctx.lineWidth = fl.r * 1.3
    ctx.stroke()
  }
}

export function FxOverlay() {
  const white = useRef()
  const drift = useRef()
  const frost = useRef()
  const cv = useRef()
  useEffect(() => {
    els.white = white.current
    els.drift = drift.current
    els.frost = frost.current
    els.veil = cv.current
    els.ctx = cv.current.getContext('2d')
    veil.flakes = makeFlakes()
    const resize = () => {
      veil.W = window.innerWidth
      veil.H = window.innerHeight
      veil.dpr = Math.min(LOW ? 1.5 : 2, window.devicePixelRatio || 1)
      cv.current.width = veil.W * veil.dpr
      cv.current.height = veil.H * veil.dpr
      els.ctx.setTransform(veil.dpr, 0, 0, veil.dpr, 0, 0)
      veil.drew = false
    }
    resize()
    window.addEventListener('resize', resize)
    // gumpalan badai: noise lembut sekali gambar, di-stretch CSS (jadi blur alami)
    paintDrift(drift.current)
    // frost HP digambar sekali pas rasio layar (lebar 360, kristalnya gak ketarik)
    if (LOW && frost.current) paintFrostRGBA(frost.current, 360, Math.round((360 * window.innerHeight) / Math.max(1, window.innerWidth)))
    last.clear()
    return () => {
      window.removeEventListener('resize', resize)
      els.white = els.drift = els.frost = els.veil = els.ctx = null
    }
  }, [])
  return (
    <>
      {LOW && <canvas ref={frost} className="fx-frost" aria-hidden="true" />}
      <div ref={white} className="fx-white" aria-hidden="true">
        <canvas ref={drift} className="fx-drift" />
      </div>
      <canvas ref={cv} className="snow-veil" aria-hidden="true" />
    </>
  )
}

// tekstur gumpalan salju hanyut: value noise 2 oktaf, putih dengan alpha.
// Kanvas 2 periode horizontal (di CSS lebarnya 200vw, jadi 1 periode = 100vw)
function paintDrift(cv) {
  const S = 128
  cv.width = S * 2
  cv.height = S
  const ctx = cv.getContext('2d')
  const im = ctx.createImageData(S * 2, S)
  const g = new Float32Array(16 * 8)
  let s = 99
  for (let i = 0; i < g.length; i++) {
    s = (s * 16807) % 2147483647
    g[i] = s / 2147483647
  }
  // kisi noise dibungkus per periode (pw sel), biar ujung kanan = ujung kiri
  const at = (i, j, pw) => g[(j & 7) * 16 + (((i % pw) + pw) % pw)]
  const vn = (x, y, pw) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const a = at(xi, yi, pw)
    const b = at(xi + 1, yi, pw)
    const c = at(xi, yi + 1, pw)
    const d = at(xi + 1, yi + 1, pw)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S * 2; x++) {
      // 6 sel per periode (gumpalan gede), oktaf kedua 2x lebih rapat
      const u = (x / S) * 6
      const v = (y / S) * 4
      const n = vn(u, v, 6) * 0.65 + vn(u * 2 + 3, v * 2, 12) * 0.35
      const a = Math.max(0, n - 0.4) / 0.6
      const i = (y * S * 2 + x) * 4
      im.data[i] = 250
      im.data[i + 1] = 252
      im.data[i + 2] = 255
      im.data[i + 3] = a * 210
    }
  }
  ctx.putImageData(im, 0, 0)
}
