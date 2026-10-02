import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { scrollState } from './scrollState'
import { portalFx } from './fx/fxState'
import { iceWallTexture } from './world/materials'
import { LOW } from './perf'
import { warmHooks } from './warmup'

// ===== gerbang es ala igloo.inc (revisi 2 Okt) =====
// Portal lama (torus GLB licin + 8 kapsul) kebaca "bahan belum jadi" kata
// Nehemiah: plastik biru polos, lubangnya kosong, yang keliatan malah bola
// kristal runcing di bawahnya. Versi ini niru susunan portal igloo:
//  1. cincin BALOK es kasar (16 bata, tiap bata miring & geser dikit), tekstur
//     es yang sama kayak dinding gua, sisi dalamnya NYALA (cahaya nembus es)
//  2. selaput tipis di lubang: jaring retakan es (voronoi) yang ngalir pelan,
//     makin pekat ke pinggir. Buyar pas kamera nembus
//  3. busur-busur patah di tengah, dua lapis beda tinggi, muter lawan arah
//  4. inti partikel: pusaran debu es bercahaya. Dari sini juga partikel wajah
//     ngalir turun (ParticleFace mulai dari mulut portal), jadi ceritanya nyambung
// Semua prosedural, nol file model. Dipasang HORIZONTAL, kamera nyorot dari
// atas lalu nyelam lewat lubangnya (jalur kamera di CameraRig gak berubah:
// lewat bidang ring 0.8 dari sumbu, jadi busur dalam dijaga di r >= 1.4)
export const PORTAL_POS = [0, -32.8, 1.5]

// prefers-reduced-motion: kilatan layar dimatiin total
const CALM = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

const R_IN = 2.35 // tepi dalam cincin bata (lubang)
const R_OUT = 3.3
const BRICKS = 16

function rng(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// satu balok = sektor cincin yang diekstrusi + bevel. Shape di bidang XY,
// diputer biar cincinnya rebah di XZ dan tebalnya ke arah Y
function sector(r0, r1, a0, a1, h, bevel, seg) {
  const s = new THREE.Shape()
  // bevel ngembangin garis luar shape, jadi shape-nya dikecilin segitu dulu
  const b0 = r0 + bevel
  const b1 = r1 - bevel
  const da0 = a0 + bevel / b0
  const da1 = a1 - bevel / b0
  s.absarc(0, 0, b1, da0, da1, false)
  s.absarc(0, 0, b0, da1, da0, true)
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.01, h - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: seg,
    steps: 1,
  })
  g.translate(0, 0, -(h - 2 * bevel) / 2)
  g.rotateX(-Math.PI / 2)
  return g
}

// bobot nyala per vertex: sisi yang ngadep sumbu & deket tepi dalam = cahaya
// portal nembus es. Dihitung sekali di sini, shader tinggal baca atribut
function bakeGlow(g, rIn, base, reach) {
  const p = g.attributes.position
  const n = g.attributes.normal
  const out = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    const len = Math.hypot(x, z) || 1
    const inward = clamp01(-(n.getX(i) * x + n.getZ(i) * z) / len)
    const near = 1 - sstep(rIn - 0.05, rIn + reach, len)
    const cap = Math.abs(n.getY(i)) * (1 - sstep(rIn, rIn + reach * 0.8, len)) * 0.55
    out[i] = Math.min(1, base + Math.max(inward * near, cap))
  }
  g.setAttribute('aGlow', new THREE.BufferAttribute(out, 1))
  return g
}

// nyala per tinggi buat geometri di luar portal (cluster podium): ujung
// kristal yang paling atas paling terang, pangkalnya gelap
export function glowByHeight(g, base = 0.06) {
  g.computeBoundingBox()
  const { min, max } = g.boundingBox
  const p = g.attributes.position
  const out = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) out[i] = base + (1 - base) * sstep(0.35, 1, (p.getY(i) - min.y) / (max.y - min.y || 1))
  g.setAttribute('aGlow', new THREE.BufferAttribute(out, 1))
  return g
}

function brickRing() {
  const rnd = rng(9137)
  const parts = []
  const step = (Math.PI * 2) / BRICKS
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const axis = new THREE.Vector3()
  for (let i = 0; i < BRICKS; i++) {
    const a = i * step + (rnd() - 0.5) * 0.04
    // celah antar bata tipis (dulu lebar, kebaca kayak gir)
    const gap = 0.008 + rnd() * 0.01
    const h = 0.9 + (rnd() - 0.5) * 0.16
    const r0 = R_IN + (rnd() - 0.5) * 0.08
    const r1 = R_OUT + (rnd() - 0.5) * 0.16
    const g = sector(r0, r1, a + gap, a + step - gap, h, 0.16, 6)
    // tiap bata miring & geser dikit biar kebaca disusun tangan, bukan dicetak
    const mid = a + step / 2
    const cx = Math.cos(mid) * (r0 + r1) * 0.5
    const cz = -Math.sin(mid) * (r0 + r1) * 0.5
    axis.set(-Math.sin(mid), 0, -Math.cos(mid)).normalize()
    q.setFromAxisAngle(axis, (rnd() - 0.5) * 0.12)
    m.makeTranslation(-cx, 0, -cz)
    g.applyMatrix4(m)
    g.applyMatrix4(m.makeRotationFromQuaternion(q))
    g.applyMatrix4(m.makeTranslation(cx, (rnd() - 0.5) * 0.12, cz))
    parts.push(g)
  }
  const merged = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  return bakeGlow(merged, R_IN, 0.02, 0.42)
}

// busur dalam: [r0, r1, tinggi, y, daftar [mulai, panjang] dalam derajat]
const ARCS = [
  [1.86, 2.1, 0.3, 0.55, [[8, 102], [128, 96], [246, 98]]],
  [1.42, 1.62, 0.24, 1.05, [[30, 58], [104, 40], [166, 72], [262, 52], [326, 22]]],
]
function arcRing([r0, r1, h, y, list], bevel = 0.06, base = 0.18) {
  const D = Math.PI / 180
  const parts = list.map(([s, len]) => sector(r0, r1, s * D, (s + len) * D, h, bevel, Math.max(6, Math.round(len / 5))))
  const merged = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  merged.translate(0, y, 0)
  return bakeGlow(merged, r0, base, 0.3)
}

// ===== cincin terowongan (revisi 2 Okt: "biar kek lebih masuk") =====
// Satu cincin pecahan es ngambang di ATAS gerbang dan satu di BAWAH-nya. Dari
// titik istirahat yang atas kebaca kayak corong yang narik ke lubang, pas
// nyelam dua-duanya lewat cepet di pinggir layar, jadi kamera nembus tiga lapis.
// Radius dalam >= 2.5: jalur kamera di ketinggian ini cuma ~0.6 sampai 1.4 dari
// sumbu (diukur). Cincin atas sengaja BOLONG di sudut 118..218 derajat: batu
// SKILLS (-3.2, -29, 0.5) nongkrong di situ, 3.35 dari sumbu, setinggi cincin.
// Makanya dia gak muter penuh, cuma goyang +-5 derajat
const TUNNEL = [
  { ring: [2.62, 3.08, 0.4, 2.3, [[222, 56], [282, 40], [326, 48], [18, 44], [66, 48]]], spin: 0 },
  { ring: [2.6, 3.02, 0.36, -1.6, [[0, 52], [56, 40], [100, 64], [168, 48], [220, 58], [282, 34], [320, 36]]], spin: -0.04 },
]

// garis cahaya tepi dalam cincin terowongan, dipecah ngikut segmen esnya
// (lingkaran penuh bakal lewat celah & nembus batu SKILLS)
function rimArcs([r0, , , y, list]) {
  const D = Math.PI / 180
  const parts = list.map(([s, len]) => {
    const g = new THREE.TorusGeometry(r0 - 0.04, 0.018, 6, Math.max(8, Math.round(len / 3)), len * D)
    g.rotateZ(s * D)
    // sama kayak sector(): bidang XY direbahin ke XZ, sudutnya tetep nyambung
    g.rotateX(-Math.PI / 2)
    return g
  })
  const merged = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  merged.translate(0, y, 0)
  return merged
}

// ===== material es portal =====
// MeshStandardMaterial biasa + detail triplanar dari tekstur dinding es (RG =
// normal, B = tinggi) + nyala sisi dalam dari atribut aGlow. Gak pakai
// MeshTransmissionMaterial: bata segede ini bakal ngerender scene ulang
export const portalU = {
  uIceTex: { value: null },
  uBump: { value: 0.6 },
  uGlow: { value: 0 },
  uGlowCol: { value: new THREE.Color('#bfe6ff').multiplyScalar(1.7) },
}
// u = set uniform (podium pakai set sendiri biar nyalanya gak ikut padam
// bareng portal), opts = properti material tambahan
export function portalIce(u = portalU, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#8a9fb1', roughness: 0.5, metalness: 0.04, envMapIntensity: 0.62, ...opts })
  m.onBeforeCompile = (s) => {
    if (!portalU.uIceTex.value) portalU.uIceTex.value = iceWallTexture()
    u.uIceTex = portalU.uIceTex
    Object.assign(s.uniforms, u)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying vec3 vPPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = aGlow;\n  vPPos = transformed;')
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vGlow;\nvarying vec3 vPPos;\nuniform sampler2D uIceTex;\nuniform float uBump;\nuniform float uGlow;\nuniform vec3 uGlowCol;'
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
  float iceB = 0.5;
  {
    // grup portal cuma digeser (goyangnya kecil banget), jadi sumbu objek
    // dianggap sejajar dunia: normal dunia dari normal view, tanpa modelMatrix
    vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec3 w = pow(abs(nW), vec3(4.0));
    w /= (w.x + w.y + w.z + 1e-4);
    vec3 p = vPPos * 0.62;
    vec4 tx = texture2D(uIceTex, p.zy + 0.13);
    vec4 ty = texture2D(uIceTex, p.xz + 0.41);
    vec4 tz = texture2D(uIceTex, p.xy + 0.77);
    vec2 ax = tx.rg * 2.0 - 1.0;
    vec2 ay = ty.rg * 2.0 - 1.0;
    vec2 az = tz.rg * 2.0 - 1.0;
    vec3 pert = vec3(0.0, ax.y, ax.x) * w.x + vec3(ay.x, 0.0, ay.y) * w.y + vec3(az.x, az.y, 0.0) * w.z;
    nW = normalize(nW + pert * uBump);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    iceB = tx.b * w.x + ty.b * w.y + tz.b * w.z;
  }
  // bercak es buram vs bening: warna & kekasaran ikut kanal tinggi
  diffuseColor.rgb *= 0.8 + 0.42 * iceB;
  roughnessFactor = clamp(roughnessFactor + (0.5 - iceB) * 0.34, 0.18, 0.9);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGlowCol * (vGlow * uGlow * (0.55 + 0.8 * iceB) + 0.015);'
      )
  }
  m.customProgramCacheKey = () => 'portal-ice'
  return m
}

// ===== selaput retakan di lubang =====
// jarak ke tepi sel voronoi (rumus tepi eksak, dua skala) = garis retakan es
// tipis kayak jaring di portal igloo. Additive, pudar di tengah biar inti
// partikel kebaca, pekat ke pinggir, dan buyar pas kamera mepet bidangnya
const veilVert = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const veilFrag = /* glsl */ `
  uniform float uTime;
  uniform float uAmt;
  uniform float uR;
  uniform vec3 uCol;
  uniform vec3 uHaze;
  uniform float uHole;
  uniform sampler2D uWeb;
  varying vec2 vP;
  void main() {
    float r = length(vP) / uR;
    if (r > 1.0 || uAmt < 0.002) discard;
    // warp pelan biar garisnya melengkung kayak jaring, bukan poligon kaku
    vec2 w = vP + 0.2 * vec2(sin(vP.y * 2.3 + uTime * 0.21), sin(vP.x * 2.1 - uTime * 0.17));
    // dua lapis jaring dari tekstur (R kasar, G halus), geser pelan beda arah
    float l1 = texture2D(uWeb, w * 0.44 + vec2(0.0, uTime * 0.006)).r;
    #ifdef VEIL_FINE
    float l2 = texture2D(uWeb, w * 0.47 + vec2(0.37 - uTime * 0.005, 0.11)).g;
    #else
    float l2 = 0.0;
    #endif
    float rim = smoothstep(0.2, 1.0, r);
    float edge = 1.0 - smoothstep(0.94, 1.0, r);
    float haze = 0.62 + 0.2 * rim;
    // selaputnya kabut es setengah buram (bukan cuma garis additive): kristal
    // podium & cincin lantai jauh di bawah ketutup, yang kebaca jaring + inti
    float lines = l1 * (0.2 + 0.4 * rim) + l2 * 0.2 * rim;
    // robek dari tengah pas kamera mendekat: lubang (uHole) melebar keluar,
    // tepi sobekannya nyala tipis
    float tear = uHole > 0.001 ? exp(-pow((r - uHole) / 0.05, 2.0)) : 0.0;
    lines += tear * 0.9 * (0.4 + 0.6 * l1);
    vec3 col = uHaze * (0.75 + 0.6 * rim) + uCol * lines * 0.75;
    float a = clamp(haze + lines * 0.3, 0.0, 1.0) * edge * uAmt;
    a *= smoothstep(uHole - 0.1, uHole + 0.04, r);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`

// jaring retakan dipanggang SEKALI ke tekstur. Dulu voronoi dihitung di
// shader tiap piksel tiap frame: +2 sampai 3.6 ms GPU (Iris Xe) pas portal
// menuhin layar. R = retakan kasar, G = retakan halus. Selnya periodik jadi
// ubinnya nyambung pas diulang. F2 - F1 = jarak kira-kira ke tepi sel
function webTexture(size = 512) {
  const data = new Uint8Array(size * size * 4)
  const layer = (cells, width, ch, seed) => {
    const rnd = rng(seed)
    const pts = new Float32Array(cells * cells * 2)
    for (let i = 0; i < pts.length; i++) pts[i] = 0.12 + rnd() * 0.76
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells
      const cy = Math.floor(fy)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const cx = Math.floor(fx)
        let d1 = 9
        let d2 = 9
        for (let j = -1; j <= 1; j++) {
          const gy = cy + j
          const ry = ((gy % cells) + cells) % cells
          for (let i = -1; i <= 1; i++) {
            const gx = cx + i
            const k = (ry * cells + (((gx % cells) + cells) % cells)) * 2
            const dx = gx + pts[k] - fx
            const dy = gy + pts[k + 1] - fy
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < d1) {
              d2 = d1
              d1 = d
            } else if (d < d2) d2 = d
          }
        }
        data[(y * size + x) * 4 + ch] = Math.round((1 - sstep(0, width, d2 - d1)) * 255)
      }
    }
  }
  layer(7, 0.06, 0, 311)
  layer(15, 0.08, 1, 977)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  const t = new THREE.DataTexture(data, size, size)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

// ===== inti partikel: pusaran debu es =====
// bola padat kecil + tiga lengan spiral, muter beda kecepatan per radius
// (dalam lebih kenceng) di shader, jadi CPU gak ngapa-ngapain per frame
const CORE_N = LOW ? 900 : 2400
const coreVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uAmt;
  uniform float uHalfH;
  varying float vA;
  varying float vK;
  void main() {
    float r = aSeed.x;
    float th = aSeed.y + uTime * (0.18 + 0.42 / (0.3 + r * 2.0));
    vec3 p = vec3(cos(th) * r, aSeed.z + sin(uTime * 0.8 + aSeed.w * 30.0) * 0.03, sin(th) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 0.05);
    float sz = (0.016 + 0.03 * aSeed.w * aSeed.w) * projectionMatrix[1][1] * uHalfH / dist;
    gl_PointSize = clamp(sz, 1.0, 6.0);
    // pudar kalau mepet lensa (kamera lewat 0.8 dari sumbu, nembus pusaran)
    vA = uAmt * smoothstep(0.6, 2.4, dist) * (0.35 + 0.65 * aSeed.w) * (1.0 - 0.55 * smoothstep(0.9, 1.5, r));
    vK = aSeed.w;
  }
`
const coreFrag = /* glsl */ `
  uniform vec3 uC1;
  uniform vec3 uC2;
  varying float vA;
  varying float vK;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a = exp(-dot(q, q) * 14.0) * vA;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uC2, uC1, vK), a);
    #include <colorspace_fragment>
  }
`
function coreGeometry() {
  const rnd = rng(4242)
  const seeds = new Float32Array(CORE_N * 4)
  for (let i = 0; i < CORE_N; i++) {
    let r, th, y
    if (i < CORE_N * 0.42) {
      // inti: gumpalan padat
      r = Math.pow(rnd(), 1.7) * 0.34
      th = rnd() * Math.PI * 2
      y = (rnd() - 0.5) * 0.4 * (1 - r / 0.42) + 0.16
    } else {
      // tiga lengan spiral
      const arm = Math.floor(rnd() * 3)
      const rr = 0.28 + Math.pow(rnd(), 0.85) * 1.2
      r = rr + (rnd() - 0.5) * 0.09
      th = (arm * Math.PI * 2) / 3 + rr * 2.3 + (rnd() - 0.5) * 0.6
      y = (rnd() - 0.5) * 0.14 + 0.16
    }
    seeds.set([r, th, y, rnd()], i * 4)
  }
  const g = new THREE.BufferGeometry()
  // posisi dummy (posisi beneran dihitung di shader dari aSeed)
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CORE_N * 3), 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.8)
  return g
}

// tekstur glow dibikin di canvas, additive + fog:false biar nembus kabut
function makeGlowTexture(draw) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  draw(c.getContext('2d'))
  return new THREE.CanvasTexture(c)
}

export function Portal() {
  const group = useRef()
  const arcA = useRef()
  const arcB = useRef()
  const glowRing = useRef()
  const glowCore = useRef()
  const rim = useRef()
  const light = useRef()
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const geos = useMemo(
    () => ({
      bricks: brickRing(),
      arcA: arcRing(ARCS[0]),
      arcB: arcRing(ARCS[1]),
      tunnel: TUNNEL.map((t) => arcRing(t.ring, 0.1, 0.1)),
      tunnelRim: TUNNEL.map((t) => rimArcs(t.ring)),
      core: coreGeometry(),
    }),
    []
  )
  const tunnel = useRef([])
  const tunnelRim = useRef([])
  const iceMat = useMemo(() => portalIce(), [])
  const webTex = useMemo(() => webTexture(LOW ? 256 : 512), [])
  // upload tekstur jaring di balik loader, bukan pas portal pertama kelihatan
  useEffect(() => {
    const warm = (gl) => gl.initTexture(webTex)
    warmHooks.add(warm)
    return () => {
      warmHooks.delete(warm)
      webTex.dispose()
    }
  }, [webTex])
  const veilMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uR: { value: R_IN - 0.05 }, uCol: { value: new THREE.Color('#e4f4ff') }, uHaze: { value: new THREE.Color('#4d6a82') }, uHole: { value: 0 }, uWeb: { value: webTex } },
        defines: LOW ? {} : { VEIL_FINE: '' },
        vertexShader: veilVert,
        fragmentShader: veilFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  )
  const coreMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmt: { value: 0 },
          uHalfH: { value: 400 },
          uC1: { value: new THREE.Color('#f4fbff') },
          uC2: { value: new THREE.Color('#8fcdf5') },
        },
        vertexShader: coreVert,
        fragmentShader: coreFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  )

  const ringGlowTex = useMemo(
    () =>
      makeGlowTexture((g) => {
        // puncak terang di r = 0.66 (pas tepi dalam bata), pudar ke dalam & luar
        const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.5, 'rgba(230,244,255,0)')
        grad.addColorStop(0.64, 'rgba(244,251,255,1)')
        grad.addColorStop(0.7, 'rgba(232,246,255,0.7)')
        grad.addColorStop(0.84, 'rgba(214,238,255,0.18)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grad
        g.fillRect(0, 0, 256, 256)
      }),
    []
  )
  const coreGlowTex = useMemo(
    () =>
      makeGlowTexture((g) => {
        const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
        grad.addColorStop(0, 'rgba(206,240,255,0.95)')
        grad.addColorStop(0.3, 'rgba(176,222,255,0.4)')
        grad.addColorStop(1, 'rgba(200,236,255,0)')
        g.fillStyle = grad
        g.fillRect(0, 0, 256, 256)
      }),
    []
  )

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const d = scrollState.damped
    // nyala pelan pas kamera mundur dari SKILLS & pertama liat portalnya di
    // bawah, padam setelah kamera lewat
    const ign = sstep(0.8, 0.885, d)
    const br = scrollState.bridge
    // turun: nyala dari SKILLS, padam abis kamera lewat. Loop: nyala lagi pas
    // partikel wajah kesedot balik & kamera naik nembus dari bawah
    const win = br > 0 ? sstep(0.04, 0.2, br) * (1 - sstep(0.5, 0.64, br)) : ign * (1 - clamp01((d - 0.955) / 0.03))
    const pulse = 0.9 + Math.sin(t * 1.4) * 0.1
    // seberapa jauh kamera dari bidang ring: selaput & inti buyar pas dilewatin
    const dy = Math.abs(state.camera.position.y - PORTAL_POS[1])
    const far = sstep(0.4, 3.2, dy)
    // selaput robek kebuka dari tengah selama kamera turun 4.5 -> 0.8 di atasnya
    const hole = 1.12 * (1 - sstep(0.8, 4.5, dy))
    if (arcA.current) arcA.current.rotation.y += delta * 0.07
    if (arcB.current) arcB.current.rotation.y -= delta * 0.11
    TUNNEL.forEach((tn, i) => {
      const m = tunnel.current[i]
      if (m) {
        if (tn.spin) m.rotation.y += delta * tn.spin
        else m.rotation.y = Math.sin(t * 0.25) * 0.08
      }
      const r = tunnelRim.current[i]
      if (r) r.material.opacity = win * (0.5 - i * 0.14) * pulse
    })
    // efek melesat (TransitionEffect, desktop): puncak pas kamera di bidang
    // gerbang & di dalam lubangnya, dua arah (turun & naik pas loop)
    const cam = state.camera.position
    const off = Math.hypot(cam.x - PORTAL_POS[0], cam.z - PORTAL_POS[2])
    const live = (br === 0 && d > 0.9) || (br > 0 && br < 0.6)
    portalFx.warp = CALM || !live ? 0 : Math.exp(-(dy / 2.4) * (dy / 2.4)) * (1 - sstep(1.4, 2.6, off))
    if (group.current) group.current.rotation.z = Math.sin(t * 0.18) * 0.02
    portalU.uGlow.value = 0.12 + 0.88 * win * pulse
    veilMat.uniforms.uTime.value = t
    veilMat.uniforms.uAmt.value = win
    veilMat.uniforms.uHole.value = hole
    coreMat.uniforms.uTime.value = t
    coreMat.uniforms.uAmt.value = win * (0.35 + 0.65 * far)
    coreMat.uniforms.uHalfH.value = (size.height * dpr) / 2
    if (rim.current) rim.current.material.opacity = win * 0.85 * pulse
    if (glowRing.current) glowRing.current.material.opacity = win * 0.32 * pulse
    if (glowCore.current) glowCore.current.material.opacity = win * 0.3 * pulse * (0.4 + 0.6 * far)
    if (light.current) light.current.intensity = win * 6
  })

  return (
    <group position={PORTAL_POS}>
      <group ref={group}>
        <mesh geometry={geos.bricks} material={iceMat} />
        <mesh ref={arcA} geometry={geos.arcA} material={iceMat} />
        <mesh ref={arcB} geometry={geos.arcB} material={iceMat} />
        {TUNNEL.map((tn, i) => (
          <group key={i} ref={(m) => (tunnel.current[i] = m)}>
            <mesh geometry={geos.tunnel[i]} material={iceMat} />
            <mesh ref={(m) => (tunnelRim.current[i] = m)} geometry={geos.tunnelRim[i]}>
              <meshBasicMaterial color={new THREE.Color('#dff3ff').multiplyScalar(1.8)} transparent opacity={0} depthWrite={false} fog={false} toneMapped={false} />
            </mesh>
          </group>
        ))}
        {/* garis cahaya di tepi dalam bata: warnanya di atas 1 biar Bloom nangkep */}
        <mesh ref={rim} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[R_IN - 0.06, 0.03, 6, 128]} />
          <meshBasicMaterial color={new THREE.Color('#eaf7ff').multiplyScalar(2.2)} transparent opacity={0} depthWrite={false} fog={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={veilMat} renderOrder={1}>
          <circleGeometry args={[R_IN - 0.05, 96]} />
        </mesh>
        <points geometry={geos.core} material={coreMat} renderOrder={3} />
        <mesh ref={glowRing} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <planeGeometry args={[7.3, 7.3]} />
          <meshBasicMaterial
            map={ringGlowTex}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh ref={glowCore} position={[0, 0.14, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <planeGeometry args={[2.6, 2.6]} />
          <meshBasicMaterial
            map={coreGlowTex}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      {/* cahaya beneran nyorot ke bawah, lembut, 2.2 di bawah bidang ring */}
      <pointLight ref={light} color="#eaf6ff" intensity={0} distance={22} decay={2} position={[0, -2.2, 0]} />
      <PortalFlash />
    </group>
  )
}

// ===== kilatan pas nembus ring =====
// Quad layar penuh digambar PALING AKHIR, warnanya dicampur (bukan additive)
// ke biru-es terang dengan takaran maksimal PEAK: layar jadi terang tapi bentuk
// di baliknya tetep keintip, jadi gak pernah jadi putih mati. Pemicunya posisi
// kamera beneran terhadap bidang ring (bukan angka scroll tebakan), naik cepet
// pas kamera nyamperin bidangnya, terus meluruh ngikut waktu biar kerasa
// walau snap-nya ngebut lewat ring cuma dalam beberapa frame.
const PEAK = 0.6
const flashVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`
const flashFrag = /* glsl */ `
  varying vec2 vUv;
  uniform float uAmt;
  uniform float uAspect;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  void main() {
    vec2 p = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
    // inti paling terang di tengah (cahaya dari lubang ring), pinggir lebih
    // dingin & tipis, kesannya cahaya nyembur dari depan, bukan layar dicat
    float core = exp( -dot( p, p ) * 2.6 );
    gl_FragColor = vec4( mix( uEdge, uCore, core ), uAmt * ( 0.5 + 0.5 * core ) );
    #include <colorspace_fragment>
  }
`
function PortalFlash() {
  const mesh = useRef()
  const size = useThree((s) => s.size)
  const amt = useRef(0)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uAmt: { value: 0 },
          uAspect: { value: 1 },
          uCore: { value: new THREE.Color('#f2faff') },
          uEdge: { value: new THREE.Color('#b8daf2') },
        },
        vertexShader: flashVert,
        fragmentShader: flashFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    []
  )
  useFrame((state, delta) => {
    const cam = state.camera.position
    const d = scrollState.damped
    let f = 0
    const br = scrollState.bridge
    if (!CALM && d > 0.88 && (br === 0 ? d < 0.99 : br < 0.6)) {
      // cuma kalau kamera beneran lewat LUBANG ring (bukan pinggirnya)
      const off = Math.hypot(cam.x - PORTAL_POS[0], cam.z - PORTAL_POS[2])
      const dy = cam.y - PORTAL_POS[1]
      const w = dy > 0 ? 1.4 : 1.7
      f = Math.exp(-(dy / w) * (dy / w)) * (1 - sstep(1.2, 2.6, off))
    }
    amt.current = Math.max(f, amt.current * Math.exp(-delta / 0.22))
    if (amt.current < 0.003) amt.current = 0
    mat.uniforms.uAmt.value = amt.current * PEAK
    mat.uniforms.uAspect.value = size.width / Math.max(1, size.height)
    if (mesh.current) mesh.current.visible = amt.current > 0
  })
  return (
    <mesh ref={mesh} material={mat} frustumCulled={false} renderOrder={5000} visible={false}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

