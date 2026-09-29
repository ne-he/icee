import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Float, Html, MeshTransmissionMaterial, useCursor, useGLTF } from '@react-three/drei'
import { easing } from 'maath'
import { dragState, focusState, scrollState } from './scrollState'
import { LOW } from './perf'
import { diveFx, rockRadius, windowMat } from './Dive'

const MODEL = '/models/iceberg.glb'

// setelan material es. Versi HP ngebuang semua ornamen fragment shader yang
// mahal (aberasi kromatik, distorsi, clearcoat) dan motong jumlah sampling
// refraksi jadi 2. Hasilnya tetep refraksi es beneran, cuma gak sedetail desktop.
// `resolution` sengaja gak ada lagi di sini, lihat IceBuffer di bawah.
const ICE = LOW
  ? {
      samples: 4, // 2 kebaca bintik kasar di tepi gelap batu, 4 = grain separuhnya, +~0.6 ms GPU (Iris Xe, ukuran HP)
      chromaticAberration: 0,
      anisotropy: 0,
      distortion: 0,
      distortionScale: 0,
      temporalDistortion: 0,
      clearcoat: 0,
      clearcoatRoughness: 0,
    }
  : {
      samples: 4,
      // 0.05 bikin tiap tepi gelap di dalam batu keluar garis pelangi yang
      // kebaca glitch, 0.035 masih ngasih kilau spektrum tipis di facet
      chromaticAberration: 0.035,
      anisotropy: 0.15,
      distortion: 0.08,
      distortionScale: 0.2,
      temporalDistortion: 0.03,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    }

// ===== SATU buffer refraksi, dipakai bareng semua batu =====
// Dulu material es pakai `transmissionSampler`: tiap frame three ngerender
// ulang scene ke render target RESOLUSI PENUH, MSAA 4x, HalfFloat, plus bikin
// rantai mipmap-nya. Itu biang lag di section batu (diukur 24 Sep 2026, Iris Xe:
// 46 sampai 52 fps, transmission dimatiin langsung 59). `resolution: 256` yang
// niatnya ngirit gak pernah kepake, soalnya jalur sampler ngabaikan setelan itu.
//
// Sekarang satu buffer dirender sekali per frame di skala ~0.62 dari layar,
// tanpa MSAA, tanpa mipmap, dan dibagi ke semua batu. 0.62 bukan angka asal:
// jalur sampler lama nge-sample di mip level log2(lebar) * roughness * (ior*2-2)
// = kira-kira 0.68, alias udah 2^-0.68 = 0.62 kali lebih buram dari layar. Jadi
// tampilannya setara, cuma bayarnya sepertiga piksel.
//
// Isinya disamain PERSIS sama pass bawaan three: cuma objek opaque yang
// kegambar (yang transparan & batu es-nya sendiri disembunyiin), tone mapping
// mati, dan kalau canvas transparan, clear-nya putih alpha 0.5.
const ICE_SCALE = LOW ? 0.5 : 0.62
export const iceTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  generateMipmaps: false,
})
// mesh es yang lagi ke-mount, didaftarin sama Crystal
const iceMeshes = new Set()
const _frustum = new THREE.Frustum()
const _pv = new THREE.Matrix4()
const _clear = new THREE.Color()
const _hidden = []

const isTransparent = (m) => (Array.isArray(m) ? m.some((x) => x.transparent) : !!m?.transparent)
function chainVisible(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false
  return true
}

function renderIceBuffer(gl, scene, camera) {
  // gak ada batu es yang kelihatan = gak ada yang butuh buffer ini, skip total
  camera.updateMatrixWorld()
  _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  _frustum.setFromProjectionMatrix(_pv)
  let any = false
  for (const m of iceMeshes) {
    if (!chainVisible(m)) continue
    m.updateWorldMatrix(true, false)
    if (_frustum.intersectsObject(m)) {
      any = true
      break
    }
  }
  if (!any) return
  const w = Math.max(1, Math.round(gl.domElement.width * ICE_SCALE))
  const h = Math.max(1, Math.round(gl.domElement.height * ICE_SCALE))
  if (iceTarget.width !== w || iceTarget.height !== h) iceTarget.setSize(w, h)

  _hidden.length = 0
  scene.traverse((o) => {
    if (!o.visible || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return
    if (iceMeshes.has(o) || isTransparent(o.material)) {
      o.visible = false
      _hidden.push(o)
    }
  })
  const prevTarget = gl.getRenderTarget()
  const prevTone = gl.toneMapping
  gl.getClearColor(_clear)
  const prevAlpha = gl.getClearAlpha()
  gl.toneMapping = THREE.NoToneMapping
  if (prevAlpha < 1) gl.setClearColor(0xffffff, 0.5)
  gl.setRenderTarget(iceTarget)
  // clear MANUAL: EffectComposer (postprocessing) matiin gl.autoClear, jadi
  // tanpa ini buffer-nya gak pernah dibersihin dan batunya ngerefraksi hitam
  gl.clear()
  gl.render(scene, camera)
  gl.setRenderTarget(prevTarget)
  gl.setClearColor(_clear, prevAlpha)
  gl.toneMapping = prevTone
  for (let i = 0; i < _hidden.length; i++) _hidden[i].visible = true
  _hidden.length = 0
}

// dipasang PALING BELAKANG di Experience: useFrame-nya didaftarin paling akhir,
// jadi jalan setelah CameraRig, Float, dan animasi batu. Kalau kebalik, buffer
// ketinggalan satu frame dari kamera dan refraksinya "berenang" pas di-scroll
export function IceBuffer() {
  useFrame(({ gl, scene, camera }) => renderIceBuffer(gl, scene, camera))
  return null
}

// ===== hover = cahaya di permata, bukan garis HUD =====
// Versi lama (selubung garis kontur, cincin scan, titik simpul) kebaca kayak
// scanner sci-fi. Kristal keliatan kristal karena CAHAYA: miringin permata di
// bawah lampu, facet yang pas ngadep lampu nyala tajam, sisanya kalem.
// Jadi sekarang hover = satu lampu titik beneran yang ngikutin kursor (material
// es fisik ngasih kilau specular + clearcoat asli), ditambah shader tipis di
// atasnya: kilatan per facet, retakan tipis di crease asli dengan kilau yang
// jalan di sepanjang tepinya, dan percikan dispersi kecil di sudut.

// status hover bareng (cuma satu batu yang bisa di-hover sekaligus).
// point/normal = titik & normal muka di bawah kursor (dunia), light = posisi
// lampu hover sekarang, gain = 0..1 nyala lampu
export const hoverFx = {
  owner: null,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(0, 0, 1),
  light: new THREE.Vector3(0, 999, 0),
  gain: 0,
  snap: false,
}
const LIGHT_PEAK = 5
const LIGHT_DIST = 2.4
const _v = new THREE.Vector3()
const _r = new THREE.Vector3()
const _t1 = new THREE.Vector3()
const _t2 = new THREE.Vector3()
const _want = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _right = new THREE.Vector3(1, 0, 0)

// Lampu hover. Dipasang SEKALI dari awal dengan intensitas 0 dan cuma
// intensitasnya yang dianimasi: nambah/copot lampu pas runtime bikin SEMUA
// material yang kena cahaya dikompilasi ulang (freeze pas hover pertama).
// Posisinya = arah pantul pandangan di titik kursor, jadi facet di bawah kursor
// pasti mantulin lampu ini ke kamera, persis kayak miringin permata ke lampu.
// Plus goyangan kecil ala permata dipegang tangan, biar kilaunya tetep jalan
// di facet & tepi walau kursornya diem. Desktop doang (HP gak punya hover).
export function HoverLight() {
  const light = useRef()
  useFrame((state, delta) => {
    const L = light.current
    if (!L) return
    if (hoverFx.owner) {
      const P = hoverFx.point
      _v.subVectors(state.camera.position, P).normalize()
      const nv = hoverFx.normal.dot(_v)
      // pantulan v terhadap normal muka: r = 2(n.v)n - v
      _r.copy(hoverFx.normal).multiplyScalar(2 * Math.abs(nv) * Math.sign(nv || 1)).sub(_v).normalize()
      _t1.crossVectors(_r, Math.abs(_r.y) < 0.9 ? _up : _right).normalize()
      _t2.crossVectors(_r, _t1)
      const w = state.clock.elapsedTime
      _want
        .copy(P)
        .addScaledVector(_r, LIGHT_DIST)
        .addScaledVector(_t1, Math.cos(w * 1.9) * 0.3)
        .addScaledVector(_t2, Math.sin(w * 1.3) * 0.3)
      if (hoverFx.snap) {
        L.position.copy(_want)
        hoverFx.snap = false
      } else easing.damp3(L.position, _want, 0.12, delta)
    }
    const on = !!hoverFx.owner && focusState.phase === 'idle'
    easing.damp(hoverFx, 'gain', on ? 1 : 0, 0.16, delta)
    L.intensity = hoverFx.gain * LIGHT_PEAK
    hoverFx.light.copy(L.position)
  })
  return <pointLight ref={light} color="#eef7ff" intensity={0} distance={7} decay={2} position={[0, 999, 0]} />
}

// shader kilau (additive, digambar di atas es). Semua dihitung di ruang lokal
// batu: uLight/uCam/uPoint dikonversi tiap frame, batunya muter
const glintVert = /* glsl */ `
  attribute vec3 aBary;
  attribute vec3 aEdge;
  attribute vec3 aFaceN;
  attribute vec3 aFaceC;
  varying vec3 vBary;
  varying vec3 vEdge;
  varying vec3 vPos;
  varying vec3 vFaceN;
  varying vec3 vFaceC;
  void main() {
    vBary = aBary;
    vEdge = aEdge;
    vPos = position;
    vFaceN = aFaceN;
    vFaceC = aFaceC;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const glintFrag = /* glsl */ `
  varying vec3 vBary;
  varying vec3 vEdge;
  varying vec3 vPos;
  varying vec3 vFaceN;
  varying vec3 vFaceC;
  uniform vec3 uPoint;
  uniform vec3 uLight;
  uniform vec3 uCam;
  uniform float uRadius;
  uniform float uReach;
  uniform float uGain;
  void main() {
    float k = uReach * uGain;
    float d = distance(vPos, uPoint) / uRadius;
    if (k < 0.003 || d > 1.3) discard;
    vec3 N = normalize(vFaceN);
    vec3 V = normalize(uCam - vPos);
    vec3 H = normalize(normalize(uLight - vPos) + V);

    // 1) kilatan per facet. Half-vector dihitung di titik TENGAH muka, jadi satu
    //    facet nyala rata kayak cermin kecil yang pas ngadep lampu (pangkat
    //    tinggi = cuma facet yang miringnya pas, tetangganya tetep kalem)
    vec3 Hc = normalize(normalize(uLight - vFaceC) + normalize(uCam - vFaceC));
    float facet = pow(max(dot(N, Hc), 0.0), 320.0);
    // titik panas pantulan lampunya sendiri di dalam facet
    float spot = pow(max(dot(N, H), 0.0), 2600.0);
    float nearF = 1.0 - smoothstep(0.35, 1.25, d);

    // 2) retakan tipis, CUMA di crease asli (diagonal triangulasi & lipatan
    //    landai dimatiin lewat aEdge), dan cuma deket kursor
    vec3 b = mix(vec3(4.0), vBary, step(0.5, vEdge));
    float w = min(b.x, min(b.y, b.z));
    float aa = max(fwidth(w), 1e-5);
    float line = 1.0 - smoothstep(aa * 0.4, aa * 1.4, w);
    float glow = 1.0 - smoothstep(0.0, aa * 3.0, w);
    float nearE = 1.0 - smoothstep(0.15, 0.85, d);

    // kilau yang jalan di tepi: tepi dianggap bevel bulat tipis, normalnya
    // miring dari muka ke arah luar tepi (gradien barycentric-nya). Titik yang
    // pas mantulin lampu = titik terang di tepi, dan titik itu GESER sepanjang
    // tepi tiap lampu/kursor/batu gerak
    vec3 dpx = dFdx(vPos);
    vec3 dpy = dFdy(vPos);
    vec3 bx = dFdx(vBary);
    vec3 by = dFdy(vBary);
    vec3 ng = cross(dpx, dpy);
    vec3 r1 = cross(dpy, ng);
    vec3 r2 = cross(ng, dpx);
    float det = dot(dpx, r1);
    float bi = w == b.x ? 0.0 : (w == b.y ? 1.0 : 2.0);
    vec2 db = bi < 0.5 ? vec2(bx.x, by.x) : (bi < 1.5 ? vec2(bx.y, by.y) : vec2(bx.z, by.z));
    vec3 g = (db.x * r1 + db.y * r2) * sign(det);
    vec3 outward = length(g) > 1e-20 ? -normalize(g) : vec3(0.0);
    vec3 Nb = normalize(N + outward * 0.5);
    float edge = pow(max(dot(Nb, H), 0.0), 700.0);

    vec3 ice = vec3(0.84, 0.93, 1.0);
    float fl = facet * nearF;
    vec3 col = ice * (fl * 0.6 + line * 0.14 * nearE)
             + vec3(1.0) * (spot * nearF * 1.5 + edge * glow * nearE * 1.8);
    // facet yang nyala dapet sedikit pelangi di pinggir lobus-nya (dispersi es)
    float rim = pow(max(dot(N, Hc), 0.0), 120.0) - facet;
    col += vec3(-0.05, 0.02, 0.12) * rim * nearF * 0.8;
    gl_FragColor = vec4(max(col, 0.0) * k, 1.0);
  }
`

// percikan dispersi di sudut: sprite bintang 4 sinar, tiap kanal warna ukurannya
// beda tipis jadi tepinya pecah pelangi. Nyala cuma di sudut yang lagi mantulin
// lampu dan deket kursor, plus kedip kecil
const sparkVert = /* glsl */ `
  attribute vec3 aN;
  attribute float aSeed;
  uniform vec3 uPoint;
  uniform vec3 uLight;
  uniform vec3 uCam;
  uniform float uRadius;
  uniform float uReach;
  uniform float uGain;
  uniform float uTime;
  uniform float uPx;
  varying float vI;
  void main() {
    vec3 N = normalize(aN);
    vec3 V = normalize(uCam - position);
    vec3 H = normalize(normalize(uLight - position) + V);
    float g = pow(max(dot(N, H), 0.0), 48.0);
    float d = distance(position, uPoint) / uRadius;
    float nearS = 1.0 - smoothstep(0.1, 0.75, d);
    float tw = 0.55 + 0.45 * sin(uTime * (4.0 + aSeed * 5.0) + aSeed * 40.0);
    vI = g * nearS * tw * uReach * uGain * step(0.05, dot(N, V));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // naik dikit ke arah kamera biar gak ketelen permukaan es sendiri
    mv.xyz += normalize(-mv.xyz) * 0.04;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vI > 0.01 ? uPx * (0.45 + 0.55 * vI) : 0.0;
  }
`
const sparkFrag = /* glsl */ `
  varying float vI;
  float star(vec2 q) {
    float r = length(q);
    float core = exp(-r * r * 90.0);
    float rays = exp(-abs(q.x) * 55.0) * exp(-abs(q.y) * 5.0) + exp(-abs(q.y) * 55.0) * exp(-abs(q.x) * 5.0);
    return core + rays * 0.55;
  }
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    vec3 c = vec3(star(q * 0.94), star(q), star(q * 1.1));
    c *= 1.0 - smoothstep(0.34, 0.5, max(abs(q.x), abs(q.y)));
    gl_FragColor = vec4(c * vI * 1.7, 1.0);
  }
`

// geometri kilau dipakai bareng antar batu yang modelnya sama → cache biar
// analisis crease-nya cuma sekali per model
const glintCache = new WeakMap()

// Bangun geometri kilau: non-indexed + barycentric + flag crease + normal &
// titik tengah per muka, plus titik-titik sudut buat percikan.
// Crease = edge yang sudut dihedral-nya tajam. Ambangnya persentil 75 (dikurung
// 30°..50°): di batu ini persentil 50 cuma 21°, itu masih lipatan landai hasil
// triangulasi, yang kebaca "kerangka mesh", bukan retakan kristal.
function buildGlintGeometry(src) {
  const cached = glintCache.get(src)
  if (cached) return cached

  const g = src.index ? src.toNonIndexed() : src.clone()
  const pos = g.attributes.position.array
  const n = g.attributes.position.count
  const tri = n / 3

  // vertex dikuantisasi biar duplikat hasil non-index nyatu jadi satu simpul
  const keys = new Array(n)
  for (let i = 0; i < n; i++) {
    keys[i] =
      `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`
  }
  const ek = (i, j) => (keys[i] < keys[j] ? `${keys[i]}|${keys[j]}` : `${keys[j]}|${keys[i]}`)

  // normal + titik tengah per muka
  const fn = new Float32Array(tri * 3)
  const fc = new Float32Array(tri * 3)
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const nr = new THREE.Vector3()
  for (let t = 0; t < tri; t++) {
    va.fromArray(pos, t * 9)
    vb.fromArray(pos, t * 9 + 3)
    vc.fromArray(pos, t * 9 + 6)
    nr.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va)).normalize()
    fn[t * 3] = nr.x
    fn[t * 3 + 1] = nr.y
    fn[t * 3 + 2] = nr.z
    fc[t * 3] = (va.x + vb.x + vc.x) / 3
    fc[t * 3 + 1] = (va.y + vb.y + vc.y) / 3
    fc[t * 3 + 2] = (va.z + vb.z + vc.z) / 3
  }

  // muka-muka yang berbagi tiap edge. Barycentric x=0 di edge SEBERANG vertex 0,
  // makanya urutannya (v1,v2), (v2,v0), (v0,v1)
  const share = new Map()
  for (let t = 0; t < tri; t++) {
    const i0 = t * 3
    const pairs = [
      [i0 + 1, i0 + 2],
      [i0 + 2, i0],
      [i0, i0 + 1],
    ]
    for (let e = 0; e < 3; e++) {
      const k = ek(pairs[e][0], pairs[e][1])
      const rec = share.get(k)
      if (rec) rec.push(t)
      else share.set(k, [t])
    }
  }

  // sudut dihedral per edge (edge batas = tak hingga, selalu dihitung crease)
  const angle = new Map()
  const inner = []
  share.forEach((ts, k) => {
    if (ts.length < 2) {
      angle.set(k, Infinity)
      return
    }
    const a = ts[0] * 3
    const b = ts[1] * 3
    const dot = Math.min(1, Math.max(-1, fn[a] * fn[b] + fn[a + 1] * fn[b + 1] + fn[a + 2] * fn[b + 2]))
    const ang = Math.acos(dot)
    angle.set(k, ang)
    inner.push(ang)
  })
  inner.sort((a, b) => a - b)
  const p75 = inner.length ? inner[Math.floor(inner.length * 0.75)] : 0.6
  const limit = Math.min(0.87, Math.max(0.52, p75))

  const bary = new Float32Array(n * 3)
  const emask = new Float32Array(n * 3)
  const faceN = new Float32Array(n * 3)
  const faceC = new Float32Array(n * 3)
  // jumlah crease per simpul + normal rata-rata muka di sekitarnya (buat sudut)
  const vCrease = new Map()
  const vNormal = new Map()
  const bump = (i) => vCrease.set(keys[i], (vCrease.get(keys[i]) ?? 0) + 1)
  for (let t = 0; t < tri; t++) {
    const i0 = t * 3
    const ks = [ek(i0 + 1, i0 + 2), ek(i0 + 2, i0), ek(i0, i0 + 1)]
    const on = ks.map((k) => (angle.get(k) >= limit ? 1 : 0))
    for (let v = 0; v < 3; v++) {
      const o = (i0 + v) * 3
      bary[o + v] = 1
      // flag edge konstan sepanjang muka (tiga vertex isinya sama)
      emask[o] = on[0]
      emask[o + 1] = on[1]
      emask[o + 2] = on[2]
      for (let c = 0; c < 3; c++) {
        faceN[o + c] = fn[t * 3 + c]
        faceC[o + c] = fc[t * 3 + c]
      }
      const vk = keys[i0 + v]
      const acc = vNormal.get(vk) ?? [0, 0, 0, i0 + v]
      acc[0] += fn[t * 3]
      acc[1] += fn[t * 3 + 1]
      acc[2] += fn[t * 3 + 2]
      vNormal.set(vk, acc)
    }
    // tiap crease edge dihitung sekali per muka, jadi dibagi 2 nanti
    if (on[0]) {
      bump(i0 + 1)
      bump(i0 + 2)
    }
    if (on[1]) {
      bump(i0 + 2)
      bump(i0)
    }
    if (on[2]) {
      bump(i0)
      bump(i0 + 1)
    }
  }

  g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3))
  g.setAttribute('aEdge', new THREE.BufferAttribute(emask, 3))
  g.setAttribute('aFaceN', new THREE.BufferAttribute(faceN, 3))
  g.setAttribute('aFaceC', new THREE.BufferAttribute(faceC, 3))
  g.computeBoundingSphere()

  // sudut beneran = simpul yang ketemu >= 3 crease
  const cp = []
  const cn = []
  const cs = []
  vNormal.forEach((acc, vk) => {
    if ((vCrease.get(vk) ?? 0) / 2 < 3) return
    const i = acc[3]
    const l = Math.hypot(acc[0], acc[1], acc[2]) || 1
    cp.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
    cn.push(acc[0] / l, acc[1] / l, acc[2] / l)
    const h = Math.sin(pos[i * 3] * 127.1 + pos[i * 3 + 1] * 311.7 + pos[i * 3 + 2] * 74.7) * 43758.5453
    cs.push(h - Math.floor(h))
  })
  const corners = new THREE.BufferGeometry()
  corners.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3))
  corners.setAttribute('aN', new THREE.Float32BufferAttribute(cn, 3))
  corners.setAttribute('aSeed', new THREE.Float32BufferAttribute(cs, 1))
  corners.computeBoundingSphere()

  const out = { veil: g, corners }
  glintCache.set(src, out)
  return out
}

// efek tambahan di dalam batu gak boleh nangkep pointer: raycast Points
// punya ambang 1 unit, bakal "kena" duluan dan event-nya gak punya face
const noRaycast = () => null
const _lp = new THREE.Vector3()

export function Crystal({ data, onOpen, interactive = true, snapT = 0 }) {
  const { nodes } = useGLTF(data.model ?? MODEL)
  const camera = useThree((s) => s.camera)
  const group = useRef()
  const spinner = useRef()
  const glint = useRef()
  const spark = useRef()
  const win = useRef()
  const ice = useRef()
  const dragging = useRef(null)
  const dragMoved = useRef(false) // true kalau gesture terakhir beneran muter (bukan klik)
  const [hovered, setHovered] = useState(false)
  const [near, setNear] = useState(!interactive)
  const wp = useMemo(() => new THREE.Vector3(), [])
  const hoverPt = useRef(new THREE.Vector3()) // titik hover terakhir (world space)
  const lv = useMemo(() => new THREE.Vector3(), []) // kerja: world → local
  const draggable = !!data.draggable
  useCursor(hovered && (interactive || draggable))

  const geometry = useMemo(() => Object.values(nodes).find((n) => n.isMesh)?.geometry, [nodes])

  // geometri kilau (barycentric + crease + sudut), di-cache per model.
  // Di HP gak dibangun sama sekali: ini efek HOVER, dan layar sentuh gak punya
  // hover. Lagipula analisis crease per-segitiga (string key tiap vertex + Map
  // antar muka) bikin loading nyendat di HP
  const glintGeo = useMemo(() => (geometry && !LOW ? buildGlintGeometry(geometry) : null), [geometry])

  const uniforms = useMemo(
    () => ({
      uPoint: { value: new THREE.Vector3(0, 999, 0) },
      uLight: { value: new THREE.Vector3(0, 999, 0) },
      uCam: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uReach: { value: 0 },
      uGain: { value: 0 },
      uTime: { value: 0 },
      uPx: { value: 26 },
    }),
    []
  )
  const glintMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: glintVert,
        fragmentShader: glintFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms]
  )
  const sparkMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: sparkVert,
        fragmentShader: sparkFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms]
  )
  // daftarin mesh es ke IceBuffer: disembunyiin pas buffer dirender, dan dipakai
  // buat ngecek masih ada batu yang kelihatan atau nggak
  useEffect(() => {
    const m = ice.current
    if (!m) return
    iceMeshes.add(m)
    return () => iceMeshes.delete(m)
  }, [])

  useEffect(() => {
    if (!geometry) return
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    const bs = geometry.boundingSphere
    // radius dunia batu buat titik berhenti kamera pas nyelam (Dive.jsx)
    rockRadius.set(data.id, (bs.radius + bs.center.length()) * (data.scale ?? 1))
    // radius area kilau ~ separuh badan batu, cukup buat kerasa "lokal"
    uniforms.uRadius.value = bs.radius * 0.55
  }, [geometry, data.id, data.scale, uniforms])

  useFrame((state, delta) => {
    if (!group.current || !spinner.current) return
    const F = focusState
    const mine = F.phase !== 'idle' && F.id === data.id
    // hanya mesh-nya yang muter, label anotasi tetap diam ala igloo.
    // pas lagi di-drag, auto-spin berhenti biar gak rebutan kendali.
    if (!dragging.current) spinner.current.rotation.y += delta * (data.spin ?? 0.06)
    const s = (data.scale ?? 1) * (interactive && hovered ? 1.07 : 1)
    easing.damp3(group.current.scale, [s, s, s], 0.25, delta)
    // "napas" kecil pas ancang-ancang nyelam
    spinner.current.scale.setScalar(mine ? 1 + 0.045 * diveFx.breath : 1)
    // nyelam: batu berubah jadi jendela video (Dive.jsx). Begitu jendelanya
    // udah nutup penuh, es aslinya disembunyiin (hemat transmission + IceBuffer)
    if (win.current) win.current.visible = mine && diveFx.k > 0.001
    if (ice.current) ice.current.visible = !(mine && diveFx.k > 0.999)

    if (glint.current) {
      const u = uniforms
      u.uTime.value += delta
      const want = hovered && F.phase === 'idle' && hoverFx.owner === data.id
      easing.damp(u.uReach, 'value', want ? 1 : 0, 0.2, delta)
      u.uGain.value = hoverFx.gain
      // di luar hover shader-nya discard semua fragment, tapi mesh-nya tetep
      // digambar full (vertex shader + rasterisasi) di 5 batu tiap frame.
      // Disembunyiin total pas gak dipakai
      const on = u.uReach.value > 0.002
      glint.current.visible = on
      if (spark.current) spark.current.visible = on
      if (on) {
        const g = glint.current
        g.worldToLocal(lv.copy(hoverPt.current))
        easing.damp3(u.uPoint.value, lv, 0.1, delta)
        u.uLight.value.copy(g.worldToLocal(_lp.copy(hoverFx.light)))
        u.uCam.value.copy(g.worldToLocal(_lp.copy(state.camera.position)))
        u.uPx.value = 26 * state.viewport.dpr
      }
    }
    if (interactive) {
      group.current.getWorldPosition(wp)
      const n = state.camera.position.distanceTo(wp) < 14
      if (n !== near) setNear(n)
    }
  })

  // titik hover dari hasil raycast: titik + normal MUKA (flat) di dunia
  const aim = (e) => {
    hoverFx.owner = data.id
    hoverFx.point.copy(e.point)
    hoverPt.current.copy(e.point)
    if (e.face) hoverFx.normal.copy(e.face.normal).transformDirection(e.object.matrixWorld)
  }
  // hover lewat label (gak ada titik raycast): pura-pura kursor di muka depan batu
  const aimFront = () => {
    if (!group.current) return
    group.current.getWorldPosition(wp)
    _v.subVectors(camera.position, wp).normalize()
    hoverFx.owner = data.id
    hoverFx.normal.copy(_v)
    hoverFx.point.copy(wp).addScaledVector(_v, (rockRadius.get(data.id) ?? 1.4) * 0.7)
    hoverPt.current.copy(hoverFx.point)
    hoverFx.snap = true
  }
  const unaim = () => {
    setHovered(false)
    if (hoverFx.owner === data.id) hoverFx.owner = null
  }

  const events = {
    onPointerOver: (e) => {
      e.stopPropagation()
      // di layar sentuh, pointerOver ikut kepicu pas jari nyentuh TAPI pointerOut
      // sering gak pernah dateng, jadi hover-nya nyangkut nyala selamanya:
      // batu ke-scale 1.07 terus dan shader kilau terus jalan. Sekalian percuma,
      // HP emang gak punya hover.
      if (e.pointerType === 'touch') return
      setHovered(true)
      aim(e)
      // titik masuk langsung di-snap (tanpa damping) biar kilaunya nongol pas
      // di tempat kursor nyentuh, bukan nyapu dari posisi hover sebelumnya
      hoverFx.snap = true
      if (glint.current) uniforms.uPoint.value.copy(glint.current.worldToLocal(lv.copy(e.point)))
    },
    onPointerMove: (e) => {
      if (e.pointerType === 'touch') return
      aim(e)
    },
    onPointerOut: unaim,
    onPointerCancel: unaim,
  }
  if (interactive) {
    events.onClick = (e) => {
      e.stopPropagation()
      // baru abis muter batunya? jangan buka panel, itu drag, bukan klik
      if (dragMoved.current) {
        dragMoved.current = false
        return
      }
      onOpen?.(data.id, data.position)
    }
  }
  useEffect(() => {
    if (!draggable) return
    // ala igloo: pas batu ini yang lagi di-frame kamera (scroll deket snap-nya),
    // drag DI MANA AJA muterin batunya, gak tergantung raycast kena mesh (sering
    // ketutup overlay/kabut). Gate ke jendela snap-nya biar cuma 1 batu yang aktif,
    // gak semua batu muter barengan pas di-drag
    const down = (e) => {
      // JANGAN drag pakai jari. Di HP gesture ini persis sama dengan gesture
      // scroll, dan efeknya dua-duanya jelek: batunya ikut miring tiap kali
      // di-swipe, DAN pas browser ngambil alih gesture buat scroll dia ngirim
      // pointercancel (bukan pointerup), jadi dragState.active nyangkut true
      // selamanya, dan auto-snap ikut mati permanen abis swipe pertama.
      if (e.pointerType === 'touch') return
      if (focusState.phase !== 'idle') return // lagi nyelam ke batu, jangan drag
      if (Math.abs(scrollState.damped - snapT) > 0.09) return
      if (e.target.closest?.('a, button, .panel, .rock-modal')) return
      dragging.current = { x: e.clientX, y: e.clientY }
      dragMoved.current = false
      dragState.active = true
      document.body.style.cursor = 'grabbing'
    }
    const move = (e) => {
      if (!dragging.current || !spinner.current) return
      const dx = e.clientX - dragging.current.x
      const dy = e.clientY - dragging.current.y
      // gerakan berarti = tandain drag (biar klik setelahnya gak buka panel)
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved.current = true
      spinner.current.rotation.y += dx * 0.01
      spinner.current.rotation.x = THREE.MathUtils.clamp(spinner.current.rotation.x + dy * 0.006, -0.6, 0.6)
      dragging.current = { x: e.clientX, y: e.clientY }
    }
    const up = () => {
      if (!dragging.current) return
      dragging.current = null
      dragState.active = false
      document.body.style.cursor = ''
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // pointercancel WAJIB ikut: kalau browser ngerebut gesture-nya, pointerup
    // gak pernah dateng dan drag-nya nyangkut nyala
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [draggable, snapT])

  return (
    // icev2: batu yang berdiri di tanah (hero) gak ngambang naik-turun
    <Float speed={1.1} rotationIntensity={draggable || data.grounded ? 0 : 0.1} floatIntensity={data.grounded ? 0 : 0.4}>
      <group ref={group} position={data.position} scale={0.001} {...events}>
        <group ref={spinner} rotation={[0, data.yaw ?? 0, 0]}>
          <mesh ref={ice} geometry={geometry}>
            {/* buffer = IceBuffer bareng (lihat atas). resolution={1}: drei tetep
                bikin dua FBO internal per material walau buffer-nya dari luar,
                dulu 256 x tinggi layar x 10 biji buat nganggur, sekarang 1 piksel */}
            <MeshTransmissionMaterial
              buffer={iceTarget.texture}
              resolution={1}
              transmission={1}
              thickness={1.8}
              roughness={0.1}
              ior={1.31}
              color="#eaf2f7"
              attenuationColor="#d6e8f1"
              attenuationDistance={6}
              envMapIntensity={1.1}
              {...ICE}
            />
          </mesh>
          {/* kilau hover: facet, retakan, percikan sudut (shader di atas) */}
          {glintGeo && (
            <mesh
              ref={glint}
              geometry={glintGeo.veil}
              material={glintMat}
              scale={1.004}
              visible={false}
              raycast={noRaycast}
            />
          )}
          {glintGeo && (
            <points
              ref={spark}
              geometry={glintGeo.corners}
              material={sparkMat}
              visible={false}
              raycast={noRaycast}
            />
          )}
          {/* jendela video pas nyelam (material bareng dari Dive.jsx) */}
          {interactive && (
            <mesh
              ref={win}
              geometry={geometry}
              material={windowMat}
              scale={1.006}
              visible={false}
              raycast={noRaycast}
            />
          )}
          <Artifact type={data.artifact} />
        </group>
        {interactive && (
          <Html position={data.labelOffset ?? [1.5, 0.8, 0]} zIndexRange={[8, 0]}>
            <div
              className={`anno ${near ? 'is-visible' : ''} ${hovered ? 'is-hot' : ''}`}
              style={{ pointerEvents: near ? 'auto' : 'none' }}
              onClick={() => onOpen?.(data.id, data.position)}
              onPointerOver={() => {
                setHovered(true)
                aimFront()
              }}
              onPointerOut={unaim}
            >
              <div className="anno-code">{data.tag}</div>
              <div className="anno-name">{data.name}</div>
              <div className="anno-cta">CLICK TO EXPLORE</div>
            </div>
          </Html>
        )}
      </group>
    </Float>
  )
}

// artefak gelap di dalam es, ala penguin dalam bongkahan igloo
function Artifact({ type }) {
  if (!type) return null
  return (
    <mesh scale={0.8}>
      {type === 'tetrahedron' && <tetrahedronGeometry args={[0.4, 0]} />}
      {type === 'octahedron' && <octahedronGeometry args={[0.34, 0]} />}
      {type === 'torusknot' && <torusKnotGeometry args={[0.26, 0.085, 110, 14]} />}
      {type === 'icosahedron' && <icosahedronGeometry args={[0.32, 0]} />}
      {/* dulu #46505a: kebaca lubang hitam, bukan benda yang kebungkus es.
          Slate kebiruan biar tetep gelap kontras tapi ada warnanya */}
      <meshStandardMaterial color="#56697a" roughness={0.4} metalness={0.3} />
    </mesh>
  )
}

useGLTF.preload(MODEL)
useGLTF.preload('/models/iceberg_hero.glb')
