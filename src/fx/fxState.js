// ===== transisi ala igloo: satu sumber angka buat semua efek =====
// Semua efek transisi (chromatic aberration, frost, glitch, white-out, salju,
// kabut badai) dihitung DI SINI dari posisi scroll + intro, bukan dari waktu.
// Jadi scrub maju-mundur selalu balik ke keadaan yang sama persis (loop dua
// arah mulus), dan screenshot pakai freeze() hasilnya deterministik.
//
// Tiga jendela transisi:
//  1. nyemplung (descend d ~0.03..0.14): kamera nembus bibir retakan salju.
//     Frost tipis di sudut + CA halus, salju kesapu lewat, kabut & langit
//     serah terima. Tanpa glitch (dibuang 2 Okt)
//  2. jembatan loop (bridge 0..1): dari kamar wajah kamera naik nembus
//     portal, gua, dan retakan sampai keluar ke dataran (bridgePath.js), tanpa
//     potongan. Efeknya tinggal salju lewat & frost tipis pas nembus permukaan
//  3. intro pertama: badai putih yang reda di atas dataran, digerakin waktu
//     (pakai rumus jembatan lama dari B_INTRO, B_SWAP = titik ganti pose)
//
// Di luar jendela itu semua angka 0 dan efeknya nol biaya (uniform gate di
// shader, overlay DOM visibility hidden, salju 3D visible false).
import { introState, scrollState } from '../scrollState'

// titik kamera pindah dari gua ke hero, di tengah plateau putih penuh
export const B_SWAP = 0.56
// intro mulai dari sini (putih penuh, kamera udah di atas salju) sampai 1
export const B_INTRO = 0.56
// jalur loop baru (bridgePath.js): br pas kamera naik nembus bidang gerbang
// portal. Dunia partikel (kabut navy, latar gelap, debu) bertahan sampai sini
export const B_GATE = 0.38
export const INTRO_MS = 3400
// pusat denyut nyemplung: kamera nembus bibir retakan (y ~ -1.4) di d ~0.07
const PLUNGE_D = 0.074
// cerminannya di jalur loop: br pas kamera nembus permukaan salju naik
// (diukur dari KEYS bridgePath.js, cek ulang kalau jalurnya diubah)
const B_SURFACE = 0.805

const clamp01 = (x) => Math.min(1, Math.max(0, x))
export const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const bump = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w))

// prefers-reduced-motion: MediaQueryList disimpen sekali, .matches-nya live
// (ikut berubah kalau setelan OS diganti tanpa reload)
const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null
export const calm = () => mq?.matches === true

// nilai per frame. Semua 0..1 kecuali wind (m/detik, arah dunia)
//   ca      : chromatic aberration
//   frost   : embun beku merambat dari tepi layar
//   glitch  : geseran pita horizontal sekejap
//   white   : white-out (overlay DOM, desktop & HP)
//   blizzard: kabut badai (WorldFog nyempitin kabut ke putih)
//   snow    : kepadatan salju 3D di sekitar kamera
//   streaks : salju coretan di atas white-out (canvas DOM)
//   wind    : angin buat salju 3D (m/detik, arah dunia)
//   sx, sy  : laju coretan DOM di layar (lebar/tinggi layar per detik, +y ke bawah)
export const fx = {
  ca: 0,
  frost: 0,
  glitch: 0,
  white: 0,
  blizzard: 0,
  snow: 0,
  streaks: 0,
  wind: [0, -0.8, 0],
  sx: 0,
  sy: 0,
  calm: false,
}

// efek melesat nembus gerbang portal, ditulis Portal.jsx tiap frame dari
// posisi kamera beneran terhadap bidang ring (turun & naik pas loop)
export const portalFx = { warp: 0 }

export function computeFx() {
  const br = scrollState.bridge
  const d = scrollState.damped
  const still = calm()
  fx.calm = still
  let ca = 0
  let frost = 0
  let glitch = 0
  let white = 0
  let blizzard = 0
  let snow = 0
  let streaks = 0
  let wx = 0.9
  let wy = -0.8
  let wz = 0.3
  let sx = 0
  let sy = 0
  if (introState.phase === 'wait') {
    // di balik loader: putih penuh biar pas tirai loader kebuka yang keliatan
    // badai, bukan frame dunia yang belum siap. freeze() di tools/verify juga
    // pakai 'wait' tapi reveal-nya 1, jadi dibedain lewat reveal
    if (introState.reveal < 1) white = 1
  }
  if (br > 0) {
    if (still) {
      // reduced motion: crossfade doang lewat putih, tanpa gerak apa pun
      white = sstep(0.28, 0.5, br) * (1 - sstep(0.62, 0.86, br))
    } else if (introState.phase !== 'fall') {
      // loop (revisi 2 Okt): gak ada badai putih lagi, kamera beneran naik
      // nembus portal, gua, dan retakan (bridgePath.js). Yang tersisa: salju
      // jatuh yang kelewatan pas naik kenceng di gua (coretannya ke BAWAH),
      // lalu frost tipis di sudut pas nembus permukaan, cerminan nyemplung
      snow = sstep(0.4, 0.5, br) * (1 - sstep(0.86, 0.96, br))
      frost = 0.3 * bump(br, B_SURFACE + 0.006, 0.03)
      ca = 0.2 * bump(br, B_SURFACE, 0.03)
      wx = 0.2
      wy = -1.2
      wz = 0
    } else {
      // intro pertama (br B_INTRO..1 digerakin waktu): badai putih yang reda.
      // naik: CA ngikut laju naik, frost ngerambat pas mendekati permukaan
      ca = 0.95 * sstep(0.2, 0.5, br) * (1 - sstep(0.6, 0.8, br))
      frost = 0.85 * sstep(0.26, 0.52, br) * (1 - sstep(0.6, 0.84, br))
      glitch = 0.7 * bump(br, 0.47, 0.022) + 0.55 * bump(br, 0.635, 0.022)
      // putihnya mulai lebih awal & pelan: naik ke arah cahaya, bukan
      // tiba-tiba ketutup. Kabut badai nyusul dari dalam gua
      white = sstep(0.33, 0.5, br) * (1 - sstep(0.6, 0.84, br))
      blizzard = sstep(0.3, 0.52, br) * (1 - sstep(0.62, 0.985, br))
      snow = br < B_SWAP ? sstep(0.06, 0.3, br) : 1 - sstep(0.74, 0.985, br)
      streaks = sstep(0.36, 0.48, br) * (1 - sstep(0.66, 0.86, br))
      if (br < B_SWAP) {
        // di gua: salju cuma jatuh pelan, coretannya dari kamera yang naik
        // kenceng, jadi di layar salju ngalir ke BAWAH
        wx = 0.2
        wy = -1.2
        wz = 0
        sx = 0.05
        sy = 1.5
      } else {
        // badai di permukaan: angin samping kenceng, reda pelan ke semilir
        const calmDown = sstep(B_SWAP, 1, br)
        wx = 7.5 - 6.8 * calmDown
        wy = -1.6 + 0.8 * calmDown
        wz = 2.2 - 1.9 * calmDown
        sx = 0.9 - 0.6 * calmDown
        sy = 0.18
      }
    }
  } else if (!still) {
    // nyemplung lewat retakan (descend). Denyutnya pendek, pusatnya pas kamera
    // nembus bibir salju. Dikunci ke d, jadi scrub mundur = efeknya mundur juga
    // Frost-nya cuma nyentuh sudut (pukulan dingin sekejap, bukan nutup
    // layar), tanpa flash putih: HUD tetep kebaca.
    // Revisi 2 Okt (feedback Nehemiah: "ada garis2 glitch melebar"): pita
    // glitch di sini dibuang total, CA dikecilin biar gak jadi garis pelangi
    // di es gantung. Yang kerasa tinggal dingin di sudut + salju lewat
    const p = bump(d, PLUNGE_D, 0.02)
    ca = 0.25 * p
    frost = 0.34 * bump(d, PLUNGE_D + 0.006, 0.022)
    snow = sstep(0.02, 0.05, d) * (1 - sstep(0.11, 0.16, d))
  }
  fx.ca = ca
  fx.frost = frost
  fx.glitch = glitch
  fx.white = white
  fx.blizzard = blizzard
  fx.snow = snow
  fx.streaks = streaks
  fx.wind[0] = wx
  fx.wind[1] = wy
  fx.wind[2] = wz
  fx.sx = sx
  fx.sy = sy
  return fx
}
