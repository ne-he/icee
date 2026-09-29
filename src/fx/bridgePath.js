import { B_SWAP, calm, sstep } from './fxState'

// ===== jalur kamera jembatan loop (bridge 0..1) =====
// Dari kamar wajah kamera nengadah lalu NAIK nembus gua ke arah garis cahaya
// retakan, makin lama makin kenceng (ketarik ke atas). Pas badai putih udah
// nutup penuh (B_SWAP) kamera dipindah ke atas dataran, lalu badainya reda
// sambil kamera turun pelan ke posisi hero.
//
// Ujung-ujungnya WAJIB persis anchor descend: br 0 = pose wajah (d 1),
// br 1 = pose hero (d 0). Jadi scroll maju/mundur nyebrang seam gak ada lompatan.
// Reduced motion: kamera gak gerak sama sekali, cuma ganti pose di balik putih.
const L = (a, b, t) => a + (b - a) * t

// ketinggian akhir naik (masih di bawah langit-langit gua, di bawah retakan)
const TOP_Y = -5.5

export function bridgeCamera(br, p, t, hero, podium) {
  const still = calm()
  if (br < B_SWAP) {
    if (still) {
      p.copy(podium.pos)
      t.copy(podium.look)
      return
    }
    // nengadah dulu (0.02..0.3), naiknya nyusul dan makin kenceng
    const tilt = sstep(0.02, 0.3, br)
    const s = sstep(0.05, B_SWAP + 0.08, br)
    const rise = s * s * (1.6 - 0.6 * s)
    p.set(L(podium.pos.x, 0.6, s), L(podium.pos.y, TOP_Y, rise), L(podium.pos.z, 8.6, s))
    // titik tatap: dari wajah ke atas-depan (ke garis cahaya retakan)
    const ux = p.x * 0.5
    const uy = p.y + 9.5
    const uz = p.z - 6.5
    t.set(L(podium.look.x, ux, tilt), L(podium.look.y, uy, tilt), L(podium.look.z, uz, tilt))
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
