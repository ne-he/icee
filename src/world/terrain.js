import * as THREE from 'three'
import { fbm, noise2, ridged, smoothstep } from './noise'

// ===== peta dunia icev2: dataran salju + celah gletser =====
// Sumbu sama kayak v1: y = kedalaman (kamera turun dari +1.8 ke -41), kamera
// natap ke -z. Celahnya MEMANJANG di sumbu z (ngejauh dari kamera), jadi pas
// di dalam, dinding ada di kiri-kanan dan lorongnya menghilang ke kabut di
// depan: kedalaman + parallax sepanjang turun.
//
// Bentuknya kayak botol: bukaan di permukaan SEMPIT (retakan di salju, garis
// yang nuntun mata ke batu hero), di bawahnya melebar jadi gua es (dinding di
// ±W), persis celah gletser beneran yang dalemnya "katedral biru".

export const GROUND_Y = -1.4 // permukaan salju rata-rata
export const FLOOR_Y = -49 // dasar celah (di bawah podium -44.35)
export const CRACK_END = -85 // retakan nutup di sini, di belakangnya salju utuh
const Z_NEAR = 34 // ujung dunia di belakang kamera hero (z 11)
const Z_FAR = -430
const X_FAR = 340

// garis tengah retakan: lurus di area kamera, melengkung pelan di kejauhan
export function crackCenter(z) {
  const k = smoothstep(-6, -60, z)
  return k * (Math.sin(z * 0.045 + 1.3) * 3.2 - 2.4 * k) + noise2(z * 0.05, 3.7) * 0.4 * k
}

// setengah lebar bukaan retakan di permukaan. Lebar di dekat kamera (kamera
// nyemplung lewat sini, anchor ABOUT lewat x~1.2 di z~9), menyempit ke arah
// batu hero (z 0), lalu nutup total di CRACK_END
export function crackHalf(z) {
  if (z <= CRACK_END) return 0
  const near = 0.95 + 2.3 * smoothstep(-1, 10, z)
  const jag = noise2(z * 0.9, 1.3) * 0.28 + noise2(z * 2.7, 8.1) * 0.1
  const close = smoothstep(CRACK_END, CRACK_END + 38, z)
  return Math.max(0, (near + jag) * close)
}

// tinggi permukaan salju (tanpa bibir retakan)
export function snowHeight(x, z) {
  const d = Math.hypot(x, z - 4)
  // gundukan pelan + riak angin (sastrugi: noise yang dipanjangin searah angin)
  let h = fbm(x * 0.035, z * 0.035, 4) * 0.9
  h += fbm(x * 0.16, z * 0.16, 3) * 0.22
  h += noise2(x * 0.9, z * 0.22) * 0.05 * (1 - smoothstep(20, 60, d))
  // makin jauh makin bergelombang: bukit berlapis yang jadi siluet di kabut
  const hills = smoothstep(30, 110, d)
  h += (fbm(x * 0.012 + 4, z * 0.012 - 2, 4) * 0.5 + 0.5) * 9 * hills
  // pegunungan di cakrawala: tingginya ngikut jarak (sudut pandang ke puncak
  // kira-kira tetap ~5 derajat), jadi gak nembus tepi atas layar
  const mtn = smoothstep(90, 220, d)
  h += Math.pow(ridged(x * 0.008 + 7, z * 0.008 + 3), 1.4) * 0.12 * d * mtn
  return GROUND_Y + h
}

// bibir salju di tepi retakan: sedikit ngegunduk (cornice)
function lip(dist) {
  return 0.22 * Math.exp(-dist / 0.7) - 0.05 * Math.exp(-dist / 0.18)
}

// ===== dataran salju: dua belahan (kiri & kanan retakan) =====
// Tiap belahan grid (s, t): s dari tepi retakan ke luar (rapat di dekat tepi),
// t dari dekat kamera ke cakrawala (rapat di dekat). Di belakang CRACK_END
// setengah lebarnya 0, dua belahan ketemu di garis yang sama: salju utuh.
export function buildGround({ cols = 110, rows = 220 } = {}) {
  const halves = []
  for (const side of [-1, 1]) {
    const pos = []
    const col = []
    const idx = []
    for (let r = 0; r <= rows; r++) {
      const t = r / rows
      const z = Z_NEAR + (Z_FAR - Z_NEAR) * Math.pow(t, 1.75)
      const cx = crackCenter(z)
      const edge = cx + side * crackHalf(z)
      const open = crackHalf(z) > 0.02
      for (let c = 0; c <= cols; c++) {
        const s = c / cols
        const x = edge + side * (X_FAR - Math.abs(edge)) * Math.pow(s, 2.3)
        const dist = Math.abs(x - edge)
        let y = snowHeight(x, z)
        if (open) y += lip(dist)
        pos.push(x, y, z)
        // "AO" murah: salju agak redup di cekungan & pas di bibir retakan
        const cav = fbm(x * 0.16 + 40, z * 0.16, 2) * 0.05
        const edgeShade = open ? 0.18 * Math.exp(-dist / 1.4) : 0
        const v = THREE.MathUtils.clamp(1 - edgeShade + cav, 0.7, 1.05)
        col.push(v, v, v)
      }
    }
    const W = cols + 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * W + c
        const b = a + 1
        const d = a + W
        const e = d + 1
        // urutan segitiga dibalik per sisi biar normal selalu ngadep atas
        if (side > 0) idx.push(a, b, d, b, e, d)
        else idx.push(a, d, b, b, d, e)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    halves.push(g)
  }
  return halves
}

// ===== dinding celah (gua es di bawah retakan) =====
// Grid (d, z): d = kedalaman di bawah bibir, z sepanjang celah. Offset keluar
// dari tepi retakan: nyaris 0 di bibir (bibir salju jadi overhang), melebar
// cepat jadi langit-langit miring, lalu dinding tegak bergelombang di ±W.
// Warna vertex: atas terang cyan (cahaya tembus es tipis), makin dalam makin gelap.
export function buildWalls({ W = 9, cols = 130, rows = 150, zNear = 20, zFar = -125 } = {}) {
  const walls = []
  for (const side of [-1, 1]) {
    const pos = []
    const col = []
    const idx = []
    for (let r = 0; r <= rows; r++) {
      // rapat di atas (langit-langit & bibir kebaca dari dekat), jarang di bawah
      const t = r / rows
      for (let c = 0; c <= cols; c++) {
        const z = zNear + (zFar - zNear) * (c / cols)
        const cx = crackCenter(z)
        const half = crackHalf(z)
        const topY = snowHeight(cx + side * half, z) + (half > 0.02 ? lip(0) : 0)
        const depth = topY - FLOOR_Y + 2
        const d = depth * Math.pow(t, 1.6)
        // melebar: langit-langit miring sampai ~6 di bawah bibir, lalu tegak
        let off = W * Math.pow(smoothstep(0.15, 6.5, d), 0.75)
        // tonjolan besar (buttress) & lekukan, variatif sepanjang z dan kedalaman
        off += fbm(d * 0.08 + side * 11, z * 0.07, 3) * 0.36 * W * smoothstep(1, 5, d)
        // fluting vertikal khas dinding es: noise dipanjangin ke bawah
        off += noise2(z * 0.8 + side * 5, d * 0.09) * 0.45 * smoothstep(0.5, 3, d)
        off += noise2(z * 3.1, d * 0.6 + side) * 0.08
        // tonjolan ke dalam dibatesin: batu section (x ±3.2..4) gak boleh nembus dinding
        off = Math.max(off, W * 0.82 * Math.pow(smoothstep(0.15, 6.5, d), 0.75))
        const x = cx + side * (half + off)
        const y = topY - d
        pos.push(x, y, z)
        // warna: cyan terang di atas (tembus cahaya), biru tengah, gelap di dasar
        const up = 1 - smoothstep(0.5, 13, d)
        const deep = smoothstep(12, 42, d)
        const hollow = THREE.MathUtils.clamp(0.5 + fbm(d * 0.08 + side * 11, z * 0.07, 3) * 0.9, 0, 1)
        const c0 = [0.28, 0.5, 0.66] // biru es
        const c1 = [0.72, 0.9, 0.98] // cyan terang
        const c2 = [0.06, 0.13, 0.22] // biru dasar
        const k = 0.75 + 0.25 * hollow
        for (let i = 0; i < 3; i++) {
          let v = c0[i] + (c1[i] - c0[i]) * up
          v = v + (c2[i] - v) * deep
          col.push(v * k)
        }
      }
    }
    const W1 = cols + 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * W1 + c
        const b = a + 1
        const d = a + W1
        const e = d + 1
        // normal ngadep ke tengah celah
        if (side > 0) idx.push(a, b, d, b, e, d)
        else idx.push(a, d, b, b, d, e)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    walls.push(g)
  }
  return walls
}

// dasar celah: salju & reruntuhan es gelap, cuma kebaca samar lewat kabut
export function buildFloor() {
  const g = new THREE.PlaneGeometry(40, 150, 60, 150)
  g.rotateX(-Math.PI / 2)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i) - 50
    p.setZ(i, z)
    p.setY(i, FLOOR_Y + fbm(x * 0.2, z * 0.2, 4) * 1.4 + Math.abs(x) * 0.12)
  }
  g.computeVertexNormals()
  return g
}
