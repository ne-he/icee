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
const Z_FAR = -205
const X_FAR = 215
// dataran berhenti di radius ini, sisanya cincin pegunungan (buildMountains)
const R_GROUND = 190
const R_MTN_OUT = 480

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
  // gundukan salju (drift) yang cukup gede biar kebaca bentuknya dari kamera,
  // tapi landai di jalur retakan (kamera & batu hero di sekitar x 0)
  const nearCrack = smoothstep(2, 9, Math.abs(x))
  let h = fbm(x * 0.045, z * 0.045, 4) * (0.7 + 1.1 * nearCrack)
  h += fbm(x * 0.14 + 3, z * 0.2, 3) * (0.2 + 0.35 * nearCrack)
  // drift ukuran sedang (panjang gelombang ~8) yang bikin bayangan kebaca di depan kamera
  h += fbm(x * 0.12 - 7, z * 0.15 + 2, 3) * 0.6 * nearCrack * (1 - smoothstep(40, 90, d))
  h += noise2(x * 0.9, z * 0.22) * 0.05 * (1 - smoothstep(20, 60, d))
  // makin jauh makin bergelombang: bukit berlapis yang jadi siluet di kabut
  const hills = smoothstep(40, 130, d)
  h += (fbm(x * 0.014 + 4, z * 0.014 - 2, 4) * 0.5 + 0.5) * 7 * hills
  return GROUND_Y + h
}

// ===== pegunungan di cakrawala =====
// Punggungan tajam (ridged noise dengan warp), tingginya ngikut jarak biar
// sudut ke puncak kira-kira tetap (gak nembus tepi atas layar), dan ada
// "masker" lebar yang bikin sebagian pegunungan rendah: cakrawala berlapis,
// ada celah yang nunjukin barisan gunung lebih jauh di belakangnya.
export function mountainHeight(x, z) {
  const r = Math.hypot(x, z - 4)
  const mtn = smoothstep(R_GROUND + 8, 300, r)
  if (mtn <= 0) return 0
  const wx = x * 0.0055 + fbm(x * 0.004, z * 0.004, 2) * 1.2
  const wz = z * 0.0055 + fbm(x * 0.004 + 9, z * 0.004 - 4, 2) * 1.2
  const peaks = Math.pow(ridged(wx + 7, wz + 3, 6), 1.9)
  const a = Math.atan2(x, -(z - 4))
  const mask = 0.3 + 0.7 * smoothstep(-0.35, 0.35, fbm(a * 2.2 + 3, r * 0.006, 3))
  return (0.25 + 0.75 * peaks) * 0.17 * r * mtn * mask
}

// cincin polar dari R_GROUND ke R_MTN_OUT, pusat (0, 4) sama kayak dataran.
// Balikin DAFTAR geometri (potongan, lihat chunkGrid)
export function buildMountains({ seg = 640, rings = 90, sectors = 1, radial = 1 } = {}) {
  const pos = []
  const col = []
  const idx = []
  const R0 = R_GROUND - 6
  for (let j = 0; j <= rings; j++) {
    const t = j / rings
    const r = R0 + (R_MTN_OUT - R0) * Math.pow(t, 1.35)
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const x = Math.sin(a) * r
      const z = 4 - Math.cos(a) * r
      // tepi dalam sedikit di bawah dataran (ketutup), lalu naik jadi gunung
      const y = snowHeight(x, z) - 0.3 * (1 - smoothstep(R0, R_GROUND + 6, r)) + mountainHeight(x, z)
      pos.push(x, y, z)
      col.push(1, 1, 1)
    }
  }
  const W = seg + 1
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * W + i
      const b = a + 1
      const d = a + W
      const e = d + 1
      idx.push(a, d, b, b, d, e)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  // dipotong jadi juring (keliling) & pita (radius), lihat chunkGrid: kamera
  // cuma pernah natap sepotong cincin, sisanya ke-cull frustum
  return chunkGrid(g, rings, seg, radial, sectors)
}

// ===== potong grid jadi beberapa mesh, biar frustum culling kepake =====
// Dataran & cincin gunung itu grid raksasa: kalau satu mesh, bounding sphere-nya
// selalu kena frustum, culling gak pernah jalan dan SEMUA segitiganya diproses
// tiap frame (dua kali: pass utama + buffer es). Di sini grid (rows x cols quad,
// index 6 per quad urut per baris, pola yang dipakai semua builder di file ini)
// dipecah jadi potongan yang BERBAGI atribut (posisi, normal, warna diupload
// ke GPU sekali, normal dihitung dari grid utuh jadi sambungannya mulus) tapi
// punya index & bounding sphere sendiri. Bentuknya gak berubah sama sekali.
// rCut/cCut = jumlah potongan (dibagi rata) atau daftar batas pecahan 0..1.
export function chunkGrid(g, rows, cols, rCut = 1, cCut = 1) {
  const cuts = (c, n) =>
    (Array.isArray(c) ? c : Array.from({ length: c + 1 }, (_, i) => i / c))
      .map((f) => Math.round(f * n))
      .filter((v, i, a) => a.indexOf(v) === i)
  const rs = cuts(rCut, rows)
  const cs = cuts(cCut, cols)
  if (rs.length === 2 && cs.length === 2) return [g]
  const src = g.index.array
  const p = g.attributes.position.array
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  const out = []
  for (let i = 0; i + 1 < rs.length; i++) {
    for (let j = 0; j + 1 < cs.length; j++) {
      const r0 = rs[i]
      const r1 = rs[i + 1]
      const c0 = cs[j]
      const c1 = cs[j + 1]
      const w = (c1 - c0) * 6
      const idx = new src.constructor((r1 - r0) * w)
      for (let r = r0; r < r1; r++) {
        const at = (r * cols + c0) * 6
        idx.set(src.subarray(at, at + w), (r - r0) * w)
      }
      const c = new THREE.BufferGeometry()
      for (const k in g.attributes) c.setAttribute(k, g.attributes[k])
      c.setIndex(new THREE.BufferAttribute(idx, 1))
      // bounding sphere dari vertex potongan ini aja, bukan seluruh grid
      box.makeEmpty()
      for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) box.expandByPoint(v.fromArray(p, (r * (cols + 1) + q) * 3))
      const s = new THREE.Sphere()
      box.getCenter(s.center)
      let far = 0
      for (let r = r0; r <= r1; r++)
        for (let q = c0; q <= c1; q++) far = Math.max(far, s.center.distanceToSquared(v.fromArray(p, (r * (cols + 1) + q) * 3)))
      s.radius = Math.sqrt(far)
      c.boundingSphere = s
      c.boundingBox = box.clone()
      out.push(c)
    }
  }
  return out
}

// bibir salju di tepi retakan: sedikit ngegunduk (cornice)
function lip(dist) {
  return 0.22 * Math.exp(-dist / 0.7) - 0.05 * Math.exp(-dist / 0.18)
}

// ===== dataran salju: dua belahan (kiri & kanan retakan) =====
// Tiap belahan grid (s, t): s dari tepi retakan ke luar (rapat di dekat tepi),
// t dari dekat kamera ke cakrawala (rapat di dekat). Di belakang CRACK_END
// setengah lebarnya 0, dua belahan ketemu di garis yang sama: salju utuh.
// Balikin daftar potongan dua belahan (rCut/cCut, lihat chunkGrid)
export function buildGround({ cols = 100, rows = 190, rCut = 1, cCut = 1 } = {}) {
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
        // di luar R_GROUND dataran nyelam ke bawah cincin gunung (gak z-fighting)
        y -= smoothstep(R_GROUND - 2, R_GROUND + 12, Math.hypot(x, z - 4)) * 8
        pos.push(x, y, z)
        // "AO" murah: cekungan (lebih rendah dari rata-rata sekelilingnya) agak
        // redup, punggung drift agak terang, plus bibir retakan redup
        let ao = 1
        if (dist > 0.8 || !open) {
          const q = 1.8
          const avg = (snowHeight(x + q, z) + snowHeight(x - q, z) + snowHeight(x, z + q) + snowHeight(x, z - q)) * 0.25
          ao = 1 + (snowHeight(x, z) - avg) * 0.45
        }
        const edgeShade = open ? 0.18 * Math.exp(-dist / 1.4) : 0
        const v = THREE.MathUtils.clamp(ao - edgeShade, 0.68, 1.06)
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
    halves.push(...chunkGrid(g, rows, cols, rCut, cCut))
  }
  return halves
}

// ===== dinding celah (gua es di bawah retakan) =====
// Grid (d, z): d = kedalaman di bawah bibir, z sepanjang celah. Offset keluar
// dari tepi retakan: nyaris 0 di bibir (bibir salju jadi overhang), melebar
// cepat jadi langit-langit miring, lalu dinding tegak bergelombang di ±W.
// Warna vertex: atas terang cyan (cahaya tembus es tipis), makin dalam makin gelap.
export function buildWalls({ W = 9, cols = 150, rows = 150, zNear = 20, zFar = -215 } = {}) {
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
        // gua NUTUP di ujung jauh (dinding kiri-kanan ketemu), biar dari
        // permukaan gak keliatan tembus ke langit lewat ujung guanya
        const Wz = W * Math.sqrt(1 - smoothstep(CRACK_END + 5, zFar + 22, z))
        // melebar: langit-langit miring sampai ~6 di bawah bibir, lalu tegak
        let off = Wz * Math.pow(smoothstep(0.15, 6.5, d), 0.75)
        // tonjolan besar (buttress) & lekukan, variatif sepanjang z dan kedalaman
        off += fbm(d * 0.08 + side * 11, z * 0.07, 3) * 0.36 * Wz * smoothstep(1, 5, d)
        // fluting vertikal khas dinding es: noise dipanjangin ke bawah
        off += noise2(z * 0.8 + side * 5, d * 0.09) * 0.45 * smoothstep(0.5, 3, d)
        off += noise2(z * 3.1, d * 0.6 + side) * 0.08
        // tonjolan ke dalam dibatesin: batu section (x ±3.2..4) gak boleh nembus dinding
        off = Math.max(off, Wz * 0.82 * Math.pow(smoothstep(0.15, 6.5, d), 0.75))
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
  const g = new THREE.PlaneGeometry(40, 240, 50, 200)
  g.rotateX(-Math.PI / 2)
  const p = g.attributes.position
  const col = []
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i) - 95
    p.setZ(i, z)
    p.setY(i, FLOOR_Y + fbm(x * 0.2, z * 0.2, 4) * 1.4 + Math.abs(x) * 0.12)
    // pakai material dinding: warna vertex = biru dasar yang gelap
    col.push(0.05, 0.11, 0.18)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}
