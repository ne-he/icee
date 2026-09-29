import * as THREE from 'three'
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { CRYSTALS } from '../content'
import { LOW } from '../perf'
import { crackCenter, crackHalf, wallOffset, wallTopY } from './terrain'
import { fbm, noise2, smoothstep } from './noise'
import { TUNE } from './tune'
import { wallU } from './materials'
import { worldState } from './World'

// ===== isi gua es di bawah retakan (icev2) =====
// Tiga lapis biar turunnya kerasa gua gletser beneran, bukan lorong kosong
// dengan latar biru rata:
//  1. formasi es: icicle di bibir & langit-langit, sisa jembatan salju yang
//     nyangkut di antara dinding, ledge yang nonjol dari dinding, bongkah es
//     jatuh, dan siluet besar jauh di lorong yang tenggelam di kabut. Semua
//     digabung SATU geometri pakai material dinding yang sama (materials.js):
//     nol program shader baru, satu draw call
//  2. kolom cahaya siang dari retakan (billboard silinder, satu draw call)
//  3. debu es / salju halus yang turun dari retakan, tiga lapis jarak (dekat
//     = bokeh, tengah, jauh) buat parallax & skala (satu draw call)
// Semua material dibikin sekali pas mount & gak pernah di-unmount (Warmup di
// Experience ngompilasi semuanya di balik loader), yang digerakin cuma uniform
// & visible.

const V = (x, y, z) => new THREE.Vector3(x, y, z)

// angka acak deterministik: bentuk gua sama persis tiap kunjungan
function rand(seed) {
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
function keepOut() {
  const caps = []
  const cap = (a, b, ra, rb) => caps.push({ a, ab: b.clone().sub(a), l2: Math.max(1e-6, a.distanceToSquared(b)), ra, rb })
  const frames = CRYSTALS.map((c) => V(c.position[0], c.position[1] + 0.4, c.position[2] + 7.5))
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
  return caps
}
const _q = new THREE.Vector3()
function isClear(caps, x, y, z, r) {
  // sumur portal & kamar outro (udah di-approve) dibiarin bersih
  if (y < -23 && z > -14 && Math.hypot(x, z - 1.5) < 8) return false
  if (y < -34 && z > -14) return false
  for (const c of caps) {
    _q.set(x, y, z).sub(c.a)
    const t = THREE.MathUtils.clamp(_q.dot(c.ab) / c.l2, 0, 1)
    _q.addScaledVector(c.ab, -t)
    if (_q.length() < r + c.ra + (c.rb - c.ra) * t) return false
  }
  return true
}

// x permukaan dinding di sisi ini pada tinggi y
function wallX(side, z, y, W) {
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
      const l0 = u0 + seg
      const l1 = u1 + seg
      B.idx.push(u0, u1, l0, u1, l1, l0)
    }
  }
  const last = base + (rings - 1) * seg
  for (let i = 0; i < seg; i++) B.idx.push(last + i, last + ((i + 1) % seg), tip)
}

// ===== bongkah es / salju =====
// bola yang "dikotakin" (superellipsoid), diskala, dilengkungin, dikasih
// noise biar kayak es leleh atau salju padat, bukan primitif. Dipakai buat
// jembatan salju, ledge, bongkah jatuh, dan siluet besar di lorong jauh
function addBlob(B, o) {
  const { c, s, seed = 0, sq = 0.5, sag = 0, rough = 0.22, drip = 0, snow = 0.8, tint = 1, rotY = 0, rotZ = 0, rotX = 0 } = o
  const taper = o.taper || 0 // ujung patah (jembatan yang tinggal separo) lebih tipis
  const seg = o.seg || 24
  const ring = o.ring || 14
  const e = new THREE.Euler(rotX, rotY, rotZ, 'YZX')
  const m = new THREE.Matrix4().makeRotationFromEuler(e)
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
      const fx = x / s[0]
      // taper > 0: ujung +x yang menipis, < 0: ujung -x
      if (taper) y *= 1 - Math.abs(taper) * smoothstep(-0.2, 1, fx * Math.sign(taper))
      y -= sag * (1 - Math.min(1, fx * fx))
      const n = fbm(x * 0.55 + seed * 7.1, z * 0.55 + y * 0.4 - seed * 3.3, 3)
      const k = 1 + n * rough
      x *= k
      z *= k
      y *= 1 + n * rough * 0.5
      // bawahnya netes / menggumpal ke bawah
      if (drip && uy < -0.15) y -= Math.max(0, noise2(x * 1.4 + seed * 5, z * 1.4 - seed)) * drip * -uy
      p.set(x, y, z).applyMatrix4(m)
      const top = smoothstep(0.3, 0.75, uy) * snow
      const cv = tint * (0.9 + 0.2 * n) * (1 - top) + 1.2 * top
      B.v(c[0] + p.x, c[1] + p.y, c[2] + p.z, cv)
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
// ujung patah menipis gak rata. Bentuk jembatan salju beneran, bukan papan.
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
  // ujung patah panjangnya gak rata (sedikit maju mundur di sisi depan/belakang)
  for (let i = 0; i <= NX; i++) {
    const fx = (i / NX) * 2 - 1
    const lx = (fx * len) / 2
    const ff = free ? fx * free : 0 // 1 = ujung bebas
    // pangkal ketanam: menebal & melebar (nyatu ke dinding, gak nempel doang)
    const rootA = free === 0 ? smoothstep(0.6, 1, Math.abs(fx)) : smoothstep(0.55, 1, -ff)
    const thick = (1 + 0.8 * rootA) * (1 + 0.3 * fbm(lx * 0.3 + seed * 5.1, seed, 2))
    // ujung bebas: meruncing bulat, ujung ketanam: ditutup di dalam dinding
    let env = 1
    if (free) env = Math.sqrt(Math.max(0, 1 - smoothstep(0.5, 1, ff)))
    if (i === 0 || i === NX) env = 0
    const yc = free === 0 ? y - sag * (1 - fx * fx) + tilt * fx : y - sag * Math.pow(Math.max(0, (ff + 1) / 2), 2) + tilt * fx
    const hTop = th * 0.42 * thick
    const hBot = th * 0.58 * thick
    const hz = dz * (1 + 0.38 * fbm(lx * 0.28 + seed * 3.3, 1.7 + seed, 2)) * Math.sqrt(thick)
    for (let k = 0; k < NS; k++) {
      const a = (k / NS) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      // atas lebih rata (permukaan salju), bawah lebih bulat menggantung
      let v = ca >= 0 ? hTop * Math.pow(ca, 0.5) : -hBot * Math.pow(-ca, 0.85)
      const w = hz * Math.sign(sa) * Math.pow(Math.abs(sa), 0.65)
      const n = fbm(lx * 0.7 + ca * 1.3 + seed * 7, sa * 1.3 + lx * 0.15 - seed, 3)
      const rr = 1 + 0.2 * n
      if (ca < -0.2) v -= Math.max(0, noise2(lx * 1.2 + seed * 3, sa * 2.2)) * 0.45 * th * -ca
      const px = lx
      const py = yc + v * rr * env
      const pz = w * rr * env
      const top = smoothstep(0.25, 0.6, ca)
      B.v(xm + px * cs + pz * sn, py, z - px * sn + pz * cs, (0.92 + 0.14 * n) * (1 - top) + 1.2 * top)
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let k = 0; k < NS; k++) {
      const k1 = (k + 1) % NS
      const a = base + i * NS + k
      const b = base + i * NS + k1
      const c = base + (i + 1) * NS + k
      const d = base + (i + 1) * NS + k1
      B.idx.push(a, b, c, b, d, c)
    }
  }
  // titik bawah (buat nempelin icicle) di posisi lokal lx, dunia
  return (lx) => {
    const fx = THREE.MathUtils.clamp((lx / len) * 2, -1, 1)
    const ff = free ? fx * free : 0
    const yc = free === 0 ? y - sag * (1 - fx * fx) + tilt * fx : y - sag * Math.pow(Math.max(0, (ff + 1) / 2), 2) + tilt * fx
    return { x: xm + lx * cs, y: yc - th * 0.5, z: z - lx * sn }
  }
}

// ===== susunan formasi =====
// Posisinya ditaruh tangan (bukan acak rata) biar komposisinya kebaca: tiap
// jembatan/ledge di ketinggian ANTARA batu section, jadi siluet batu selalu
// lawan kabut, bukan numpuk sama bongkah di belakangnya. Ledge cuma di bagian
// dinding yang udah tegak (di bawah langit-langit miring)
//  side: +1 kanan, -1 kiri. reach < 1 = pecahan lebar lorong, >= 1 = meter
const SLABS = [
  // jembatan salju utuh, nyangkut di antara dua dinding
  { kind: 'bridge', z: -17, y: -4.4, th: 1.5, dz: 1.7, sag: 0.9, rotY: 0.16, tilt: 0.35, seed: 1 },
  { kind: 'bridge', z: -33, y: -17.6, th: 1.8, dz: 2.2, sag: 1.3, rotY: -0.22, tilt: -0.5, seed: 2 },
  { kind: 'bridge', z: -44, y: -6, th: 1.6, dz: 2.0, sag: 1.0, rotY: 0.1, tilt: 0.4, seed: 3 },
  { kind: 'bridge', z: -64, y: -12.5, th: 2.2, dz: 2.8, sag: 1.4, rotY: -0.12, tilt: 0.3, seed: 4 },
  // sisa jembatan yang tinggal separo, patah di tengah
  { kind: 'ledge', side: -1, reach: 0.58, z: -24, y: -10.8, th: 1.3, dz: 1.8, sag: 0.8, rotY: 0.25, seed: 5 },
  { kind: 'ledge', side: 1, reach: 0.52, z: -52, y: -24.5, th: 1.6, dz: 2.3, sag: 1.0, rotY: -0.3, seed: 6 },
  // ledge pendek yang nonjol dari dinding
  { kind: 'ledge', side: 1, reach: 2.3, z: -8.5, y: -10.8, th: 0.95, dz: 1.3, sag: 0.35, rotY: -0.35, seed: 7 },
  { kind: 'ledge', side: -1, reach: 2.4, z: -12, y: -8.6, th: 1.0, dz: 1.5, sag: 0.4, rotY: 0.3, seed: 8 },
  { kind: 'ledge', side: -1, reach: 2.0, z: -17, y: -20.6, th: 0.9, dz: 1.2, sag: 0.3, rotY: 0.2, seed: 9 },
  { kind: 'ledge', side: 1, reach: 2.5, z: -20.5, y: -16.3, th: 1.0, dz: 1.4, sag: 0.4, rotY: -0.15, seed: 10 },
  { kind: 'ledge', side: 1, reach: 2.8, z: -29, y: -26.6, th: 1.1, dz: 1.7, sag: 0.4, rotY: 0.2, seed: 11 },
  { kind: 'ledge', side: -1, reach: 3.0, z: -38, y: -9.4, th: 1.2, dz: 1.9, sag: 0.5, rotY: -0.25, seed: 12 },
  { kind: 'ledge', side: -1, reach: 2.2, z: -4.5, y: -27.4, th: 0.9, dz: 1.3, sag: 0.3, rotY: 0.3, seed: 13 },
  { kind: 'ledge', side: 1, reach: 1.9, z: -2.5, y: -12.4, th: 0.8, dz: 1.1, sag: 0.3, rotY: -0.3, seed: 14 },
]
// bongkah jatuh yang nyangkut (di atas ledge / nempel dinding), sama siluet
// besar jauh di lorong: lempeng es raksasa yang nyender ke dinding
const BLOCKS = [
  { side: 1, z: -20.3, y: -15.0, s: [0.9, 0.75, 0.8], rotY: 0.6, rotZ: 0.3, seed: 21 },
  { side: -1, z: -37.2, y: -7.8, s: [1.2, 0.9, 1.0], rotY: -0.4, rotZ: -0.25, seed: 22 },
  { side: -1, z: -26, y: -29, s: [1.6, 1.3, 1.4], rotY: 0.9, rotZ: 0.4, seed: 23 },
  { side: 1, z: -44, y: -12, s: [1.8, 1.5, 1.5], rotY: 0.3, rotZ: -0.5, seed: 24 },
]
const PILLARS = [
  // [side, z, tinggi pusat, setengah tinggi, lebar, miring]
  { side: -1, z: -47, y: -30, h: 16, w: 1.4, lean: 0.28, seed: 31 },
  { side: 1, z: -58, y: -34, h: 19, w: 1.8, lean: -0.22, seed: 32 },
  { side: -1, z: -72, y: -26, h: 15, w: 2.2, lean: 0.18, seed: 33 },
]

function buildFormations(W, caps) {
  const B = new Mesher()
  const r = rand(7)

  // --- jembatan & ledge ---
  for (const sl of SLABS) {
    const { z, y } = sl
    // dinding diukur di bawah jembatan (langit-langit miring: makin ke bawah
    // makin lebar), biar pangkalnya beneran ketanam, gak ngambang
    const yb = y - sl.sag - sl.th * 0.6
    const xl = Math.min(wallX(-1, z, y, W), wallX(-1, z, yb, W))
    const xr = Math.max(wallX(1, z, y, W), wallX(1, z, yb, W))
    let xa, xb, free
    if (sl.kind === 'bridge') {
      xa = xl - 1.6
      xb = xr + 1.6
      free = 0
    } else {
      const len = sl.reach < 1 ? (xr - xl) * sl.reach : sl.reach
      if (sl.side > 0) {
        xa = xr - len
        xb = xr + 1.8
        free = -1
      } else {
        xa = xl - 1.8
        xb = xl + len
        free = 1
      }
    }
    // dicek di ujung bebas & tengah: jangan masuk zona steril
    const tipX = free < 0 ? xa : free > 0 ? xb : (xa + xb) / 2
    const r0 = Math.max(sl.th, sl.dz) + 0.3
    if (!isClear(caps, tipX, y, z, r0) || !isClear(caps, (xa + xb) / 2, y - sl.sag, z, r0)) continue
    const under = addBridge(B, { xa, xb, y, z, th: sl.th, dz: sl.dz, sag: sl.sag, seed: sl.seed, rotY: sl.rotY, tilt: sl.tilt || (r() - 0.5) * 0.3, free, nx: sl.kind === 'bridge' ? 34 : 20 })

    // icicle di bawahnya (bagian yang gak ketanam dinding)
    const len = xb - xa
    const f0 = free === 0 ? -len / 2 + 2.2 : free < 0 ? -len / 2 + 0.4 : -len / 2 + 2.4
    const f1 = free === 0 ? len / 2 - 2.2 : free < 0 ? len / 2 - 2.4 : len / 2 - 0.4
    const n = Math.round((f1 - f0) * (1.4 + r() * 1.2))
    for (let i = 0; i < n; i++) {
      if (r() < 0.3) continue
      const p = under(f0 + r() * (f1 - f0))
      const zz = p.z + (r() - 0.5) * sl.dz * 0.9
      const L = 0.25 + Math.pow(r(), 1.7) * 1.8
      if (!isClear(caps, p.x, p.y - L * 0.5, zz, 0.5 + L * 0.5)) continue
      addIcicle(B, p.x, p.y, zz, L, (0.035 + L * 0.05) * (0.7 + r() * 0.8), r(), 1.15)
    }
  }

  // --- bongkah jatuh ---
  for (const b of BLOCKS) {
    const x = wallX(b.side, b.z, b.y, W) - b.side * b.s[0] * 0.55
    if (!isClear(caps, x, b.y, b.z, Math.max(...b.s))) continue
    addBlob(B, { c: [x, b.y, b.z], s: b.s, seed: b.seed, sq: 0.3, rough: 0.2, snow: 0.7, tint: 0.9, rotY: b.rotY, rotZ: b.rotZ, rotX: 0.2, seg: 16, ring: 10 })
  }

  // --- siluet besar di lorong jauh (seracs miring nyender dinding) ---
  for (const pl of PILLARS) {
    const x = wallX(pl.side, pl.z, pl.y, W) - pl.side * pl.w * 1.4
    addBlob(B, { c: [x, pl.y, pl.z], s: [pl.w, pl.h, pl.w * 1.3], seed: pl.seed, sq: 0.6, rough: 0.3, drip: 0.2, snow: 0.6, tint: 0.85, rotZ: pl.lean * pl.side, rotY: pl.seed, seg: 16, ring: 18 })
  }

  // --- icicle di bibir retakan & langit-langit ---
  // Berkelompok (bukan rata): jalan sepanjang z, kadang lompat jauh (celah
  // kosong), tiap kelompok punya kedalaman & panjang dasar sendiri. Banyak
  // yang pendek, sedikit yang panjang banget
  const maxN = LOW ? 150 : 300
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
        if (!isClear(caps, x, y - L * 0.5, zz, 0.35 + L * 0.5)) continue
        addIcicle(B, x, y, zz, L, r0, r(), lipRow ? 1.25 : 1.12)
        count++
      }
    }
  }
  return { geo: B.build() }
}

export function Cave({ W, wallMat }) {
  const formations = useMemo(() => buildFormations(W, keepOut()).geo, [W])
  useFrame(() => {
    // skrip warna dinding (live dari TUNE)
    wallU.uCaveTop.value.set(TUNE.caveTop)
    wallU.uCaveMid.value.set(TUNE.caveMid)
    wallU.uCaveDeep.value.set(TUNE.caveDeep)
    wallU.uCaveTopK.value = TUNE.caveTopK
    wallU.uCaveOcc.value = TUNE.caveOcc
    wallU.uFogLift.value = TUNE.caveFogLift
    wallU.uNavy.value = worldState.navy
  })
  return <mesh geometry={formations} material={wallMat} />
}
