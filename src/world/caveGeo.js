import * as THREE from 'three'
import { CRYSTALS } from '../content'
import { BRIDGE_POINTS } from '../fx/bridgePath'
import { crackCenter, crackHalf, wallOffset, wallTopY } from './terrain'
import { fbm, noise2, smoothstep } from './noise'

// ===== geometri isi gua (dipakai Cave.jsx) =====
// Dipisah dari komponennya biar murni JS (tanpa React/WebGL): susunan formasi
// bisa dicek & diukur di node sebelum dilihat di browser.

const V = (x, y, z) => new THREE.Vector3(x, y, z)

// angka acak deterministik: bentuk gua sama persis tiap kunjungan
export function rand(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ===== zona steril: jalur kamera & garis pandang ke tiap batu =====
// Formasi & kolom cahaya gak boleh masuk sini. Anchor-nya sinkron sama
// CameraRig (Experience.jsx): kamera tiap batu = batu + (0, 0.4, 7.5)
const frameOf = (c) => V(c.position[0], c.position[1] + 0.4, c.position[2] + 7.5)
export function keepOut() {
  const caps = []
  const cap = (a, b, ra, rb) => caps.push({ a, ab: b.clone().sub(a), l2: Math.max(1e-6, a.distanceToSquared(b)), ra, rb })
  const frames = CRYSTALS.map(frameOf)
  const path = [V(0, 1.5, 11), ...frames, V(0.8, -22.8, 11.8), V(1.2, -23.2, 2.7), V(0, -32.8, 2.3), V(0, -37.2, 4.6), V(0, -39.9, 8.8), V(0, -40.7, 11.5)]
  // radius 1.8 = parallax pointer (±0.5) + lengkung spline portal + napas
  for (let i = 0; i < path.length - 1; i++) cap(path[i], path[i + 1], 1.8, 1.8)
  CRYSTALS.forEach((c, i) => {
    // garis pandang ke batu (juga jalur nyelam pas batu diklik, Dive.jsx)
    cap(frames[i], V(...c.position), 1.3, 1.9 * c.scale + 0.9)
    // ancang-ancang mundur sebelum nyelam
    cap(frames[i], frames[i].clone().add(V(0, 0.3, 3)), 1.6, 1.6)
  })
  // crane ke portal, nyelam lurus nembus ring, kamar wajah
  cap(V(0.8, -22.8, 11.8), V(0, -33.4, 1), 1.5, 5.5)
  cap(V(1.2, -23.2, 2.7), V(0, -44, 0.6), 1.5, 6)
  cap(V(0, -40.7, 11.5), V(0, -41.4, 1.5), 2, 7)
  // jalur loop (revisi 2 Okt): dari wajah naik nembus portal, gua, sampai
  // keluar retakan ke pose hero (fx/bridgePath.js). Di bagian gua atas (z 5
  // sampai 12) jalurnya beda dari jalur turun, jadi wajib ikut steril
  const loop = [V(0, -40.7, 11.5), ...BRIDGE_POINTS, V(0, 1.5, 11)]
  for (let i = 0; i < loop.length - 1; i++) cap(loop[i], loop[i + 1], 1.6, 1.6)
  // kerucut "di belakang batu" per frame section: apa pun yang di layar jatuh
  // di belakang siluet batu (plus margin) & belum ketelen kabut bikin batunya
  // rebutan perhatian. Batu harus selalu lawan kabut
  const sights = CRYSTALS.map((c, i) => {
    const F = frames[i]
    const a = V(...c.position).sub(F)
    const dC = a.length()
    a.divideScalar(dC)
    return { F, a, dC, tanR: (1.8 * c.scale * 1.35) / dC }
  })
  return { caps, sights }
}

const _q = new THREE.Vector3()
export function isClear(K, x, y, z, r) {
  // sumur portal & kamar outro (udah di-approve) dibiarin bersih
  if (y < -23 && z > -14 && Math.hypot(x, z - 1.5) < 8) return false
  if (y < -34 && z > -14) return false
  for (const c of K.caps) {
    _q.set(x, y, z).sub(c.a)
    const t = THREE.MathUtils.clamp(_q.dot(c.ab) / c.l2, 0, 1)
    _q.addScaledVector(c.ab, -t)
    if (_q.length() < r + c.ra + (c.rb - c.ra) * t) return false
  }
  return true
}
// true = di layar jatuh di belakang batu section (dalam jarak `far`)
export function behindRock(K, x, y, z, r, far = 34) {
  for (const s of K.sights) {
    _q.set(x, y, z).sub(s.F)
    const da = _q.dot(s.a)
    if (da < s.dC * 0.8 || da > far) continue
    _q.addScaledVector(s.a, -da)
    if ((_q.length() - r) / da < s.tanR) return true
  }
  return false
}

// x permukaan dinding di sisi ini pada tinggi y
export function wallX(side, z, y, W) {
  const d = Math.max(0, wallTopY(side, z) - y)
  return crackCenter(z) + side * (crackHalf(z) + wallOffset(side, z, d, W))
}

// ===== penampung geometri gabungan =====
class Mesher {
  constructor() {
    this.pos = []
    this.col = []
    this.idx = []
  }
  get n() {
    return this.pos.length / 3
  }
  v(x, y, z, c) {
    this.pos.push(x, y, z)
    this.col.push(c * 0.97, c, c * 1.02)
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(this.idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }
}

// ===== icicle =====
// kerucut meruncing dengan profil gak rata (menggembung, mengecil), sedikit
// bengkok, akarnya ketanam di langit-langit. Warna vertex terang = es tipis,
// cahaya tembus paling kuat (shader dinding bikin dia nyala cyan)
function addIcicle(B, x, y, z, L, r0, seed, bright) {
  const seg = L > 1.2 ? 7 : 5
  const rings = L > 1.2 ? 7 : 5
  const rot = seed * 6.283
  const bx = Math.cos(seed * 91.7) * 0.07 * L
  const bz = Math.sin(seed * 91.7) * 0.07 * L
  const base = B.n
  for (let k = 0; k < rings; k++) {
    const s = k / rings
    const bulge = 1 + 0.22 * noise2(s * 3.1 + seed * 13, seed * 7)
    const r = r0 * (k === 0 ? 1.5 : Math.pow(1 - s, 1.15) * bulge)
    const yy = y + 0.25 - s * (L + 0.25)
    const ox = bx * s * s
    const oz = bz * s * s
    for (let i = 0; i < seg; i++) {
      const a = rot + (i / seg) * Math.PI * 2
      const rr = r * (1 + 0.12 * Math.sin(a * 3 + seed * 5))
      B.v(x + ox + Math.cos(a) * rr, yy, z + oz + Math.sin(a) * rr, bright * (0.92 + 0.16 * s))
    }
  }
  const tip = B.n
  B.v(x + bx, y - L, z + bz, bright * 1.1)
  for (let k = 0; k < rings - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const u0 = base + k * seg + i
      const u1 = base + k * seg + ((i + 1) % seg)
      B.idx.push(u0, u1, u0 + seg, u1, u1 + seg, u0 + seg)
    }
  }
  const last = base + (rings - 1) * seg
  for (let i = 0; i < seg; i++) B.idx.push(last + i, last + ((i + 1) % seg), tip)
}

// ===== bongkah es =====
// bola yang "dikotakin" (superellipsoid), diskala, dikasih noise biar kayak
// es leleh / pecahan, bukan primitif. Dipakai buat bongkah jatuh & seracs jauh
function addBlob(B, o) {
  const { c, s, seed = 0, sq = 0.5, rough = 0.22, drip = 0, snow = 0.8, tint = 1, rotY = 0, rotZ = 0, rotX = 0 } = o
  const seg = o.seg || 24
  const ring = o.ring || 14
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YZX'))
  const p = new THREE.Vector3()
  const sp = (v, k) => Math.sign(v) * Math.pow(Math.abs(v), k)
  const base = B.n
  for (let j = 0; j <= ring; j++) {
    const th = (j / ring) * Math.PI
    for (let i = 0; i <= seg; i++) {
      const ph = (i / seg) * Math.PI * 2
      // parameterisasi & urutan index persis SphereGeometry three (normal keluar)
      const ux = -Math.cos(ph) * Math.sin(th)
      const uy = Math.cos(th)
      const uz = Math.sin(ph) * Math.sin(th)
      let x = sp(ux, sq) * s[0]
      let y = sp(uy, sq) * s[1]
      let z = sp(uz, sq) * s[2]
      const n = fbm(x * 0.55 + seed * 7.1, z * 0.55 + y * 0.4 - seed * 3.3, 3)
      const k = 1 + n * rough
      x *= k
      z *= k
      y *= 1 + n * rough * 0.5
      // bawahnya netes / menggumpal ke bawah
      if (drip && uy < -0.15) y -= Math.max(0, noise2(x * 1.4 + seed * 5, z * 1.4 - seed)) * drip * -uy
      p.set(x, y, z).applyMatrix4(m)
      const top = smoothstep(0.3, 0.75, uy) * snow
      B.v(c[0] + p.x, c[1] + p.y, c[2] + p.z, tint * (0.9 + 0.2 * n) * (1 - top) + 1.05 * top)
    }
  }
  const W1 = seg + 1
  for (let j = 0; j < ring; j++) {
    for (let i = 0; i < seg; i++) {
      const a = base + j * W1 + i + 1
      const b = base + j * W1 + i
      const cc = base + (j + 1) * W1 + i
      const d = base + (j + 1) * W1 + i + 1
      if (j !== 0) B.idx.push(a, b, d)
      if (j !== ring - 1) B.idx.push(b, cc, d)
    }
  }
}

// ===== jembatan salju & ledge =====
// Tabung sepanjang x (dinding ke dinding, atau dinding ke ujung patah) dengan
// penampang yang berubah terus: pangkal di dinding tebal & melebar, tengah
// melendut & menipis, atas salju menggumpal, bawah menggantung & menetes,
// ujung patah membulat. Bentuk jembatan salju beneran, bukan papan.
//  xa..xb: rentang x dunia. free: 0 = dua ujung ketanam dinding, -1 = ujung
//  xa yang patah (bebas), +1 = ujung xb yang patah
function addBridge(B, o) {
  const { xa, xb, y, z, th, dz, sag = 0.5, seed = 0, rotY = 0, tilt = 0, free = 0 } = o
  const NX = o.nx || 30
  const NS = 16
  const cs = Math.cos(rotY)
  const sn = Math.sin(rotY)
  const len = xb - xa
  const xm = (xa + xb) / 2
  const base = B.n
  const center = (fx) => {
    const ff = free ? fx * free : 0
    // jembatan utuh melendut di tengah, patahan melorot ke ujung bebasnya
    const droop = free === 0 ? sag * (1 - fx * fx) : sag * Math.pow(Math.max(0, (ff + 1) / 2), 2)
    return y - droop + tilt * fx + 0.35 * th * fbm(fx * 2.1 + seed * 4.7, seed, 2)
  }
  for (let i = 0; i <= NX; i++) {
    const fx = (i / NX) * 2 - 1
    const lx = (fx * len) / 2
    const ff = free ? fx * free : 0 // 1 = ujung bebas
    // pangkal ketanam: menebal & melebar (nyatu ke dinding, gak nempel doang)
    const rootA = free === 0 ? smoothstep(0.6, 1, Math.abs(fx)) : smoothstep(0.55, 1, -ff)
    const thick = (1 + 0.9 * rootA) * (1 + 0.35 * fbm(lx * 0.3 + seed * 5.1, seed, 2))
    // ujung bebas: meruncing bulat, ujung ketanam: ditutup di dalam dinding
    let env = 1
    if (free) env = Math.sqrt(Math.max(0, 1 - smoothstep(0.45, 1, ff)))
    if (i === 0 || i === NX) env = 0
    const yc = center(fx)
    const hTop = th * 0.42 * thick
    const hBot = th * 0.58 * thick
    const hz = dz * (1 + 0.4 * fbm(lx * 0.28 + seed * 3.3, 1.7 + seed, 2)) * Math.sqrt(thick)
    for (let k = 0; k < NS; k++) {
      const a = (k / NS) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      // atas lebih rata (permukaan salju), bawah lebih bulat menggantung
      let v = ca >= 0 ? hTop * Math.pow(ca, 0.5) : -hBot * Math.pow(-ca, 0.85)
      const w = hz * Math.sign(sa) * Math.pow(Math.abs(sa), 0.65)
      const n = fbm(lx * 0.7 + ca * 1.3 + seed * 7, sa * 1.3 + lx * 0.15 - seed, 3)
      const rr = 1 + 0.22 * n
      if (ca < -0.2) v -= Math.max(0, noise2(lx * 1.2 + seed * 3, sa * 2.2)) * 0.45 * th * -ca
      const py = yc + v * rr * env
      const pz = w * rr * env
      const top = smoothstep(0.25, 0.6, ca)
      B.v(xm + lx * cs + pz * sn, py, z - lx * sn + pz * cs, (0.92 + 0.14 * n) * (1 - top) + 1.05 * top)
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let k = 0; k < NS; k++) {
      const k1 = (k + 1) % NS
      const a = base + i * NS + k
      const b = base + i * NS + k1
      B.idx.push(a, b, a + NS, b, b + NS, a + NS)
    }
  }
  // titik bawah (buat nempelin icicle) di posisi lokal lx
  return (lx) => {
    const fx = THREE.MathUtils.clamp((lx / len) * 2, -1, 1)
    return { x: xm + lx * cs, y: center(fx) - th * 0.5, z: z - lx * sn }
  }
}

// rentang x jembatan/ledge: diukur di bawah jembatan juga (langit-langit
// miring: makin ke bawah makin lebar), biar pangkalnya beneran ketanam
function slabSpan(sl, W) {
  const { z, y } = sl
  const yb = y - sl.sag - sl.th * 0.6
  const xl = Math.min(wallX(-1, z, y, W), wallX(-1, z, yb, W))
  const xr = Math.max(wallX(1, z, y, W), wallX(1, z, yb, W))
  if (sl.kind === 'bridge') return { xa: xl - 1.6, xb: xr + 1.6, free: 0 }
  const len = sl.reach < 1 ? (xr - xl) * sl.reach : sl.reach
  if (sl.side > 0) return { xa: xr - len, xb: xr + 1.8, free: -1 }
  return { xa: xl - 1.8, xb: xl + len, free: 1 }
}

// ===== susunan formasi =====
// Lorong jauh (z < -34): jembatan salju & sisa jembatan ditaruh tangan, jadi
// siluet redup berlapis di kabut. Di zona batu section: ledge, bongkah, icicle
// ditaruh otomatis dari kandidat acak (tetap deterministik) yang lolos dua
// syarat: gak masuk zona steril dan gak jatuh di belakang siluet batu di frame
// section mana pun. Hasilnya formasi selalu ngisi pinggir frame, batu tetap
// lawan kabut
const FAR_SLABS = [
  { kind: 'bridge', z: -38, y: -6.8, th: 1.7, dz: 1.9, sag: 1.1, rotY: 0.14, tilt: 1.2, seed: 1 },
  { kind: 'bridge', z: -47, y: -19.5, th: 2.0, dz: 2.3, sag: 1.4, rotY: -0.2, tilt: -1.5, seed: 2 },
  { kind: 'ledge', side: 1, reach: 0.55, z: -55, y: -9.5, th: 1.8, dz: 2.2, sag: 1.2, rotY: -0.3, seed: 3 },
  { kind: 'ledge', side: -1, reach: 0.5, z: -60, y: -26, th: 1.8, dz: 2.3, sag: 1.0, rotY: 0.3, seed: 4 },
  { kind: 'bridge', z: -68, y: -13, th: 2.3, dz: 2.8, sag: 1.5, rotY: -0.1, tilt: 1.1, seed: 5 },
]
const PILLARS = [
  { side: -1, z: -47, y: -30, h: 16, w: 1.4, lean: 0.28, seed: 31 },
  { side: 1, z: -58, y: -34, h: 19, w: 1.8, lean: -0.22, seed: 32 },
  { side: -1, z: -74, y: -26, h: 15, w: 2.2, lean: 0.18, seed: 33 },
]

export function buildFormations(W, low) {
  const K = keepOut()
  const B = new Mesher()
  const r = rand(7)
  const occluders = [] // buat motong kolom cahaya yang ketutup jembatan
  const report = { slabs: [], blocks: 0, icicles: 0 }

  // jembatan/ledge + icicle di bawahnya. near = true: wajib lolos cek batu
  const putSlab = (sl, near) => {
    const { xa, xb, free } = slabSpan(sl, W)
    const len = xb - xa
    // sampel sepanjang bagian yang gak ketanam dinding
    const s0 = free === 0 ? xa + 1.6 : free < 0 ? xa : xa + 1.8
    const s1 = free === 0 ? xb - 1.6 : free < 0 ? xb - 1.8 : xb
    const rad = Math.max(sl.th, sl.dz) * 0.9
    for (let x = s0; x <= s1 + 1e-3; x += Math.max(0.8, (s1 - s0) / 12)) {
      const fx = ((x - (xa + xb) / 2) / len) * 2
      const yy = sl.y - (free === 0 ? sl.sag * (1 - fx * fx) : sl.sag * 0.5)
      if (!isClear(K, x, yy, sl.z, rad)) return false
      if (near && behindRock(K, x, yy, sl.z, rad)) return false
    }
    const tilt = sl.tilt ?? (r() - 0.5) * 0.5
    const under = addBridge(B, { xa, xb, y: sl.y, z: sl.z, th: sl.th, dz: sl.dz, sag: sl.sag, seed: sl.seed, rotY: sl.rotY, tilt, free, nx: free === 0 ? 34 : 18 })
    occluders.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: sl.z - sl.dz * 1.4, z1: sl.z + sl.dz * 1.4, top: sl.y + sl.th * 0.4 })
    report.slabs.push({ kind: sl.kind, side: sl.side, z: +sl.z.toFixed(1), y: +sl.y.toFixed(1), len: +len.toFixed(1) })
    const f0 = free === 0 ? -len / 2 + 2.2 : free < 0 ? -len / 2 + 0.4 : -len / 2 + 2.4
    const f1 = free === 0 ? len / 2 - 2.2 : free < 0 ? len / 2 - 2.4 : len / 2 - 0.4
    const n = Math.round((f1 - f0) * (1.4 + r() * 1.2))
    for (let i = 0; i < n; i++) {
      if (r() < 0.3) continue
      const p = under(f0 + r() * (f1 - f0))
      const zz = p.z + (r() - 0.5) * sl.dz * 0.9
      const L = 0.25 + Math.pow(r(), 1.7) * 1.8
      if (!isClear(K, p.x, p.y - L * 0.5, zz, 0.3 + L * 0.5)) continue
      if (near && behindRock(K, p.x, p.y - L * 0.5, zz, 0.2 + L * 0.5)) continue
      addIcicle(B, p.x, p.y, zz, L, (0.035 + L * 0.05) * (0.7 + r() * 0.8), r(), 1.15)
      report.icicles++
    }
    return { xa, xb, free }
  }

  for (const sl of FAR_SLABS) putSlab(sl, false)

  // --- ledge otomatis di zona batu (dinding yang udah tegak, y < -8) ---
  const cand = []
  for (const side of [-1, 1]) {
    for (let z = -2; z > -34; z -= 2.1) {
      for (let y = -8.5; y > -31; y -= 1.9) {
        cand.push({ side, z: z + (r() - 0.5) * 1.4, y: y + (r() - 0.5) * 1.2, k: r() })
      }
    }
  }
  cand.sort((a, b) => a.k - b.k)
  const want = low ? 7 : 10
  const picked = []
  for (const c of cand) {
    if (picked.length >= want) break
    // jaga jarak: gak numpuk, dan gak kebanyakan di satu sisi / satu ketinggian
    if (picked.some((p) => Math.hypot(p.z - c.z, p.y - c.y) < (p.side === c.side ? 7 : 4.5))) continue
    const sl = {
      kind: 'ledge',
      side: c.side,
      z: c.z,
      y: c.y,
      reach: 1.5 + r() * 1.9,
      th: 0.75 + r() * 0.55,
      dz: 1.0 + r() * 0.8,
      sag: 0.25 + r() * 0.35,
      rotY: (r() - 0.5) * 0.8,
      tilt: (r() - 0.5) * 0.6,
      seed: 40 + picked.length,
    }
    const span = putSlab(sl, true)
    if (!span) continue
    picked.push({ ...c, span, sl })
  }

  // --- bongkah jatuh: nyangkut di atas sebagian ledge ---
  const blk = (x, y, z, s, seed, near) => {
    if (!isClear(K, x, y, z, Math.max(...s))) return
    if (near && behindRock(K, x, y, z, Math.max(...s))) return
    addBlob(B, { c: [x, y, z], s, seed, sq: 0.55, rough: 0.32, snow: 0.8, tint: 0.9, rotY: r() * 6.28, rotZ: (r() - 0.5) * 0.8, rotX: (r() - 0.5) * 0.6, seg: 16, ring: 10 })
    report.blocks++
  }
  picked.forEach((p, i) => {
    if (i % 2) return
    const { xa, xb, free } = p.span
    // di dekat pangkal (dinding), duduk di atas ledge
    const x = free < 0 ? xb - 2.6 : xa + 2.6
    const sz = 0.5 + r() * 0.45
    blk(x, p.sl.y + p.sl.th * 0.45 + sz * 0.7, p.sl.z + (r() - 0.5) * 0.6, [sz * 1.2, sz, sz * 1.05], 60 + i, true)
  })
  // bongkah gede nyangkut di lorong jauh
  blk(wallX(-1, -41, -12, W) + 1.3, -12, -41, [1.7, 1.3, 1.5], 71, false)
  blk(wallX(1, -52, -30, W) - 1.5, -30, -52, [2.0, 1.6, 1.7], 72, false)

  // --- siluet besar di lorong jauh (seracs miring nyender dinding) ---
  for (const pl of PILLARS) {
    const x = wallX(pl.side, pl.z, pl.y, W) - pl.side * pl.w * 1.4
    addBlob(B, { c: [x, pl.y, pl.z], s: [pl.w, pl.h, pl.w * 1.3], seed: pl.seed, sq: 0.6, rough: 0.3, drip: 0.2, snow: 0.6, tint: 0.85, rotZ: pl.lean * pl.side, rotY: pl.seed, seg: 16, ring: 18 })
  }

  // --- icicle di bibir retakan & langit-langit ---
  // Berkelompok (bukan rata): jalan sepanjang z, kadang lompat jauh (celah
  // kosong), tiap kelompok punya kedalaman & panjang dasar sendiri. Banyak
  // yang pendek, sedikit yang panjang banget
  const maxN = low ? 150 : 300
  let count = 0
  for (const side of [-1, 1]) {
    let z = 16
    while (z > -74 && count < maxN) {
      z -= r() < 0.2 ? 2.5 + r() * 6 : 0.25 + r() * 1.3
      // makin jauh makin jarang (ketelen kabut juga)
      if (z < -40 && r() < 0.45) continue
      const lipRow = r() < 0.42
      const dBase = lipRow ? 0.12 + r() * 0.5 : 0.9 + r() * 4.2
      const lBase = 0.2 + Math.pow(r(), 1.8) * (lipRow ? 1.6 : 2.4)
      const n = 1 + Math.floor(r() * r() * 7)
      for (let k = 0; k < n && count < maxN; k++) {
        const zz = z + (r() - 0.5) * 0.9
        const d = Math.max(0.08, dBase + (r() - 0.5) * 0.5)
        let L = lBase * (0.3 + r() * 0.95)
        if (r() < 0.05) L *= 1.9
        const r0 = 0.03 + L * 0.05 * (0.7 + r() * 0.6)
        const off = wallOffset(side, zz, d, W)
        // cuma di permukaan yang ngadep bawah (langit-langit miring), dan
        // badannya gak boleh nembus dinding di bawahnya
        if (wallOffset(side, zz, d + 0.8, W) - off < 0.35) continue
        if (wallOffset(side, zz, d + L * 0.5, W) - off < r0 + 0.1) continue
        if (wallOffset(side, zz, d + L, W) - off < r0 + 0.15) continue
        const x = crackCenter(zz) + side * (crackHalf(zz) + off + 0.02)
        const y = wallTopY(side, zz) - d
        if (!isClear(K, x, y - L * 0.5, zz, 0.35 + L * 0.5)) continue
        // icicle panjang di belakang batu juga ganggu siluetnya
        if (L > 0.8 && behindRock(K, x, y - L * 0.5, zz, L * 0.3, 26)) continue
        addIcicle(B, x, y, zz, L, r0, r(), lipRow ? 1.25 : 1.12)
        count++
      }
    }
  }
  report.icicles += count
  return { geo: B.build(), occluders, report, K }
}

// ===== kolom cahaya dari retakan =====
export function buildBeams(K, occluders, low) {
  const r = rand(11)
  // kolom sepanjang retakan, SENGAJA di belakang batu-batu (z < -5): di depan
  // batu dia nyuci siluet batu. Beberapa sempit, sisanya lebar & tipis
  const zs = low ? [-6.5, -12, -21, -27, -38, -52] : [-6.5, -9.5, -13, -21, -24.5, -29, -38, -46, -55, -68]
  const pos = []
  const axis = []
  const wv = []
  const uv = []
  const seed = []
  const idx = []
  const STEPS = 10
  for (const z0 of zs) {
    const z = z0 + (r() - 0.5) * 1.6
    const half = crackHalf(z)
    const x = crackCenter(z) + (r() - 0.5) * half * 0.7
    const top = Math.max(wallTopY(-1, z), wallTopY(1, z)) + 0.35
    const dir = V(0.12 + (r() - 0.5) * 0.08, -1, -0.04 + (r() - 0.5) * 0.08).normalize()
    let len = 14 + r() * 13
    // jembatan salju di bawah retakan motong cahayanya
    for (const o of occluders) {
      if (z > o.z0 && z < o.z1 && x > o.x0 && x < o.x1 && o.top < top) len = Math.min(len, (top - o.top) / -dir.y)
    }
    const narrow = r() < 0.3
    const w0 = narrow ? 0.35 + r() * 0.3 : Math.max(0.7, half * 2 * (0.45 + 0.35 * r()))
    const w1 = w0 * (narrow ? 2.2 : 2 + r() * 1.2)
    // dipendekin sampai titik pertama yang masuk zona steril
    for (let t = 0; t <= len; t += 1.5) {
      const w = w0 + (w1 - w0) * (t / len)
      if (!isClear(K, x + dir.x * t, top + dir.y * t, z + dir.z * t, w * 0.3)) {
        len = t
        break
      }
    }
    if (len < 5) continue
    const amp = (narrow ? 0.7 : 0.45) * (0.75 + 0.5 * r())
    const sd = r()
    const b = pos.length / 3
    for (let k = 0; k <= STEPS; k++) {
      for (const s of [-1, 1]) {
        pos.push(x, top, z)
        axis.push(dir.x * len, dir.y * len, dir.z * len)
        wv.push(w0, w1)
        uv.push(s, k / STEPS)
        seed.push(sd, amp)
      }
    }
    for (let k = 0; k < STEPS; k++) {
      const a = b + k * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aAxis', new THREE.Float32BufferAttribute(axis, 3))
  g.setAttribute('aW', new THREE.Float32BufferAttribute(wv, 2))
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 2))
  g.setIndex(idx)
  return g
}

// ===== debu es: posisi dasar di kotak satuan + parameter per partikel =====
export function buildDust(low) {
  const r = rand(23)
  const layers = low ? [45, 300, 340] : [130, 850, 1050]
  const size = [
    [0.018, 0.034],
    [0.011, 0.02],
    [0.02, 0.032],
  ]
  const speed = [
    [0.18, 0.4],
    [0.12, 0.32],
    [0.1, 0.25],
  ]
  const pos = []
  const ar = []
  const al = []
  layers.forEach((n, L) => {
    for (let i = 0; i < n; i++) {
      pos.push(r(), r(), r())
      const sz = size[L][0] + r() * (size[L][1] - size[L][0])
      ar.push(speed[L][0] + r() * (speed[L][1] - speed[L][0]), r(), sz, L === 1 && r() < 0.22 ? 1 : 0)
      al.push(L)
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aR', new THREE.Float32BufferAttribute(ar, 4))
  g.setAttribute('aL', new THREE.Float32BufferAttribute(al, 1))
  return g
}
