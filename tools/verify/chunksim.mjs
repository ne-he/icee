// Simulasi frustum culling potongan terrain (world/terrain.js chunkGrid) tanpa
// browser: berapa segitiga & berapa draw call yang lolos frustum di kamera-kamera
// jalur hero/nyemplung, per rasio layar desktop & HP. Buat milih jumlah potongan.
//   node tools/verify/chunksim.mjs '{"ground":{"rCut":[0,0.26,0.5,1],"cCut":3},"mtn":{"sectors":12}}'
import * as THREE from 'three'
import { register } from 'node:module'

// import di src/ gak pakai ekstensi (gaya Vite), Node butuh ".js": tambahin lewat hook
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
      try { return await next(s, c) } catch (e) { if (s.startsWith('.') && !s.endsWith('.js')) return next(s + '.js', c); throw e } }`)
)
const { buildGround, buildMountains } = await import('../../src/world/terrain.js')

const cfg = JSON.parse(process.argv[2] || '{}')
const low = !!cfg.low
const ground = buildGround(cfg.ground || {})
const mtn = buildMountains(cfg.mtn || {})
for (const g of [...ground, ...mtn]) if (!g.boundingSphere) g.computeBoundingSphere()

// kamera: hero, tengah nyemplung (d 0.05, 0.08), muncul lagi dari jembatan loop
const v = (x, y, z) => new THREE.Vector3(x, y, z)
const lerp = (a, b, u) => a.clone().lerp(b, u)
const cams = []
for (const d of [0, 0.03, 0.05, 0.08, 0.1]) {
  const k = Math.min(1, d / 0.17)
  const u = k * k * (3 - 2 * k)
  cams.push(['d' + d, lerp(v(0, 1.5, 11), v(3.4, -6.6, 5.5), u), lerp(v(0, 0.55, -3), v(3.4, -7, -2), u)])
}
cams.push(['bridge', v(0, -0.9, 12.6), v(0, 0.55, -3)])

const tris = (gs) => gs.reduce((s, g) => s + g.index.count / 3, 0)
const fr = new THREE.Frustum()
const m = new THREE.Matrix4()
for (const [aspect, name] of [[1536 / 864, 'desktop'], [390 / 844, 'phone']]) {
  const cam = new THREE.PerspectiveCamera(32, aspect, 0.1, 900)
  const rows = []
  for (const [label, pos, look] of cams) {
    // parallax pointer ±0.5 x, ±0.3 y: ambil yang paling boros
    let worst = null
    for (const px of [-0.5, 0, 0.5]) {
      cam.position.copy(pos).add(v(px, 0, 0))
      cam.lookAt(look)
      cam.updateMatrixWorld()
      m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
      fr.setFromProjectionMatrix(m)
      const vis = (gs) => gs.filter((g) => fr.intersectsSphere(g.boundingSphere))
      const g = vis(ground)
      const t = vis(mtn)
      const r = { gTris: tris(g), gCalls: g.length, mTris: tris(t), mCalls: t.length }
      if (!worst || r.gTris + r.mTris > worst.gTris + worst.mTris) worst = r
    }
    rows.push(label + ` ground ${worst.gTris}/${tris(ground)} (${worst.gCalls}/${ground.length}) mtn ${worst.mTris}/${tris(mtn)} (${worst.mCalls}/${mtn.length})`)
  }
  console.log(name + (low ? ' LOW' : ''))
  rows.forEach((r) => console.log('  ' + r))
}
