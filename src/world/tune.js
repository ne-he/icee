// angka-angka look dunia icev2 di satu tempat. Objeknya mutable dan dibaca tiap
// frame, jadi bisa disetel langsung dari console / Playwright lewat
// window.__ice.tune tanpa build ulang (buat nyari nilai), lalu nilai final
// ditulis balik ke sini.
export const TUNE = {
  ambient: 0.1,
  hemi: 0.6,
  sun: 1.7,
  fill: 0.35,
  // matahari (di balik awan tipis) dari samping kiri agak depan: gundukan salju
  // & lereng gunung dapat sisi terang & sisi teduh (ala hero igloo)
  sunPos: [-12, 8, 4],
  envInt: 0.4,
  snowColor: '#d2d8e1',
  snowEnv: 0.55,
  snowBump: 0.7,
  snowGlint: 1.6,
  fogTop: 0.65, // pengali kabut di ketinggian 45 di atas salju (puncak gunung)
  farShade: 0.7, // pengali warna salju di pegunungan jauh
  cloud: 0.07, // kontras awan mendung di langit
  wallGlow: 0.42,
  wallBump: 0.6,
  fogOutNear: 24,
  fogOutFar: 620,
  fogInNear: 7,
  fogInFar: 58,
  fogDeepFar: 42,
  // es v2 (world/iceMaterial.js + Crystal.jsx)
  iceBump: 0.45,
  iceFrost: 0.75,
  heroSnow: 1.0, // salju di sisi atas batu hero (berdiri di dataran)
  rockSnow: 0.3, // hoarfrost tipis di sisi atas batu section
  iceAttColor: '#c9e2f2', // warna es tebal (Beer's law)
  iceAttDist: 6,
  iceThickness: 2.0,
  bloom: 0.38,
  bloomOut: 0.25, // pengali bloom pas di permukaan salju
  bloomThreshold: 0.88,
}
