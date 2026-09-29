// angka-angka look dunia icev2 di satu tempat. Objeknya mutable dan dibaca tiap
// frame, jadi bisa disetel langsung dari console / Playwright lewat
// window.__ice.tune tanpa build ulang (buat nyari nilai), lalu nilai final
// ditulis balik ke sini.
export const TUNE = {
  ambient: 0.22,
  hemi: 0.95,
  sun: 0.85,
  fill: 0.35,
  // matahari (tertutup awan) dari BELAKANG kiri: gunung jadi siluet lebih gelap
  // dari langit, gundukan salju dapat sisi terang & sisi teduh
  sunPos: [-8, 7, -14],
  envInt: 0.4,
  snowColor: '#d9dee6',
  snowEnv: 0.55,
  wallGlow: 0.42,
  fogOutNear: 24,
  fogOutFar: 620,
  fogInNear: 7,
  fogInFar: 58,
  fogDeepFar: 42,
  bloom: 0.38,
  bloomOut: 0.25, // pengali bloom pas di permukaan salju
  bloomThreshold: 0.88,
}
