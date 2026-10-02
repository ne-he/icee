import * as THREE from 'three'
import { introState } from '../scrollState'
import { B_SWAP, calm, sstep } from './fxState'

// ===== jalur kamera jembatan loop (bridge 0..1) =====
// Revisi 2 Okt (feedback Nehemiah: "transisi dari end ke start masih kurang
// masuk logika, tiba-tiba putih doang"). Dulu kamera naik setengah jalan di
// gua, layar ketutup badai putih, lalu kamera DIPINDAH ke atas dataran.
// Sekarang gak ada potongan sama sekali, jalurnya beneran nyambung:
//  1. partikel wajah kesedot balik ke portal (ParticleFace), kamera mundur dikit
//     sambil nengadah ke gerbang yang nyala lagi
//  2. kamera NAIK nembus gerbang dari bawah (kilatan + efek melesat, gua
//     muncul lagi pas bidang ring kelewat, lihat World.jsx)
//  3. naik terus lewat gua ke arah garis cahaya retakan, belok dikit ke bawah
//     bukaan retakan (retakannya kebuka sampai z 34, lebarnya ~6.5 di z 10)
//  4. nembus permukaan salju, keluar ke udara terbuka, nunduk ke batu hero
// Ujung-ujungnya WAJIB persis anchor descend: br 0 = pose wajah (d 1),
// br 1 = pose hero (d 0). Jadi scroll maju/mundur nyebrang seam gak ada lompatan.
//
// Arah pandang SELALU condong ke -z (ke arah batu hero) walau lagi nengadah
// hampir tegak: kalau komponen datarnya nyebrang tanda, lookAt muter 180
// derajat dalam satu frame.
//
// Intro pertama (badai putih reda di atas dataran) & reduced motion tetep
// pakai jalur lama di bawah.
const V = (x, y, z) => new THREE.Vector3(x, y, z)

// [br, posisi kamera, titik tatap]. Ujung 0 & 1 diisi pose wajah & hero
const KEYS = [
  [0, null, null],
  [0.14, V(0.1, -39.2, 7.6), V(0, -33.5, 1.4)],
  [0.28, V(0.15, -36.4, 4.0), V(0.1, -26, 1.2)],
  [0.38, V(0.2, -32.8, 2.1), V(0.25, -22, -0.4)],
  [0.5, V(0.3, -26, 3.0), V(0.5, -12, 0)],
  // mendekati permukaan pandangannya udah NATAP KE DEPAN sepanjang retakan
  // (batu hero udah keliatan dari dalam celah). Dulu nengadah ke langit
  // mendung sampai keluar, layarnya abu polos = kebaca white-out lagi
  [0.64, V(0.45, -14, 7.6), V(0.5, -2, 2)],
  [0.78, V(0.4, -3, 10.2), V(0.3, 0.5, -4)],
  [0.88, V(0.2, 3.4, 12.6), V(0.1, 1.6, -3)],
  [1, null, null],
]
// titik-titik di jalur (dipakai caveGeo.keepOut biar icicle/ledge gak nongol
// di depan lensa pas naik)
export const BRIDGE_POINTS = KEYS.slice(1, -1).map((k) => k[1])

// Catmull-Rom non-uniform (Barry-Goldman), knot = br tiap key: kecepatan
// nyambung di tiap key, gak berhenti-jalan
const A = [V(0, 0, 0), V(0, 0, 0), V(0, 0, 0)]
const B = [V(0, 0, 0), V(0, 0, 0)]
const g0 = V(0, 0, 0)
const g3 = V(0, 0, 0)
function cr(out, P0, P1, P2, P3, t0, t1, t2, t3, x) {
  A[0].copy(P0).multiplyScalar((t1 - x) / (t1 - t0)).addScaledVector(P1, (x - t0) / (t1 - t0))
  A[1].copy(P1).multiplyScalar((t2 - x) / (t2 - t1)).addScaledVector(P2, (x - t1) / (t2 - t1))
  A[2].copy(P2).multiplyScalar((t3 - x) / (t3 - t2)).addScaledVector(P3, (x - t2) / (t3 - t2))
  B[0].copy(A[0]).multiplyScalar((t2 - x) / (t2 - t0)).addScaledVector(A[1], (x - t0) / (t2 - t0))
  B[1].copy(A[1]).multiplyScalar((t3 - x) / (t3 - t1)).addScaledVector(A[2], (x - t1) / (t3 - t1))
  return out.copy(B[0]).multiplyScalar((t2 - x) / (t2 - t1)).addScaledVector(B[1], (x - t1) / (t2 - t1))
}
function along(out, idx, br) {
  let j = 0
  while (j < KEYS.length - 2 && br > KEYS[j + 1][0]) j++
  const k1 = KEYS[j]
  const k2 = KEYS[j + 1]
  const k0 = KEYS[j - 1]
  const k3 = KEYS[j + 2]
  // ujung jalur: titik bayangan dicerminin biar arah geraknya masuk akal
  const P0 = k0 ? k0[idx] : g0.copy(k1[idx]).multiplyScalar(2).sub(k2[idx])
  const P3 = k3 ? k3[idx] : g3.copy(k2[idx]).multiplyScalar(2).sub(k1[idx])
  const t0 = k0 ? k0[0] : 2 * k1[0] - k2[0]
  const t3 = k3 ? k3[0] : 2 * k2[0] - k1[0]
  return cr(out, P0, k1[idx], k2[idx], P3, t0, k1[0], k2[0], t3, br)
}

export function bridgeCamera(br, p, t, hero, podium) {
  const still = calm()
  const intro = introState.phase === 'fall'
  if (!still && !intro) {
    KEYS[0][1] = podium.pos
    KEYS[0][2] = podium.look
    KEYS[KEYS.length - 1][1] = hero.pos
    KEYS[KEYS.length - 1][2] = hero.look
    along(p, 1, br)
    along(t, 2, br)
    return
  }
  // ---- jalur lama: intro (badai reda) & reduced motion (ganti pose di balik putih) ----
  if (br < B_SWAP) {
    p.copy(podium.pos)
    t.copy(podium.look)
    return
  }
  if (still) {
    p.copy(hero.pos)
    t.copy(hero.look)
    return
  }
  // badai reda: kamera mulai agak tinggi & mundur, turun pelan ke hero.
  // ease-out kubik: gerak di awal (masih ketutup putih), lalu mendarat lembut
  const k = Math.min(1, Math.max(0, (br - B_SWAP) / (1 - B_SWAP)))
  const e = 1 - Math.pow(1 - k, 3)
  const r = 1 - e
  p.set(hero.pos.x + 0.35 * r, hero.pos.y + 1.5 * r, hero.pos.z + 4.2 * r)
  t.set(hero.look.x, hero.look.y + 0.9 * r, hero.look.z)
}
