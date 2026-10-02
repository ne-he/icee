import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { LOW } from '../perf'
import { warmState } from '../warmup'
import { worldState } from './World'

// ===== dunia di balik portal (revisi 2 Okt: "lebih kek masuk dunia baru") =====
// Begitu kamera lewat bidang gerbang ke bawah, dinding gua disembunyiin
// (World.jsx) dan latarnya tinggal ruang biru tua yang ngalir (DeepWater). Di
// sini isinya: ribuan debu es melayang pelan NAIK ke arah portal, dua lapis
// (deket terang, jauh samar). Partikel wajah juga datang dari portal, jadi
// dunia ini kebaca "dunia partikel", bukan lanjutan gua.
// Posisi di-wrap di shader (mod) dalam kotak di sekitar kamar wajah, jadi CPU
// gak ngapa-ngapain per frame. Cuma digambar pas worldState.beyondK > 0.
const N = LOW ? 1400 : 3600
// dari bawah gerbang (-37) sampai jauh di bawah kamar wajah (FACE_Y -56)
const BOX_MIN = new THREE.Vector3(-26, -76, -34)
const BOX_SIZE = new THREE.Vector3(52, 39, 50)

const vert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uAmt;
  uniform float uHalfH;
  uniform vec3 uMin;
  uniform vec3 uSize;
  varying float vA;
  varying float vK;
  void main() {
    // naik pelan + goyang kecil, di-wrap dalam kotak
    vec3 p = position;
    p.y += uTime * (0.18 + 0.22 * aSeed.x);
    p.x += sin(uTime * 0.21 + aSeed.y * 40.0) * 0.35;
    p.z += cos(uTime * 0.17 + aSeed.z * 40.0) * 0.35;
    p = uMin + mod(p - uMin, uSize);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 0.05);
    float sz = (0.02 + 0.05 * aSeed.w * aSeed.w) * projectionMatrix[1][1] * uHalfH / dist;
    gl_PointSize = clamp(sz, 1.0, 5.0);
    // kelip pelan, pudar mepet lensa & di kejauhan, pudar di tepi atas/bawah
    // kotak biru gak nongol/ilang mendadak pas di-wrap
    float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed.y) + aSeed.z * 60.0);
    float edgeY = smoothstep(0.0, 0.12, (p.y - uMin.y) / uSize.y) * (1.0 - smoothstep(0.85, 1.0, (p.y - uMin.y) / uSize.y));
    vA = uAmt * tw * edgeY * smoothstep(0.8, 2.5, dist) * (1.0 - smoothstep(26.0, 46.0, dist)) * (0.3 + 0.7 * aSeed.w);
    vK = aSeed.w;
  }
`
const frag = /* glsl */ `
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

export function Beyond() {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const pts = useRef()
  const [geo, mat] = useMemo(() => {
    let s = 7331
    const rnd = () => {
      s = (s * 16807) % 2147483647
      return s / 2147483647
    }
    const pos = new Float32Array(N * 3)
    const seed = new Float32Array(N * 4)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = BOX_MIN.x + rnd() * BOX_SIZE.x
      pos[i * 3 + 1] = BOX_MIN.y + rnd() * BOX_SIZE.y
      pos[i * 3 + 2] = BOX_MIN.z + rnd() * BOX_SIZE.z
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    // posisi asli digeser & di-wrap di shader: bounding-nya kotak penuh
    g.boundingSphere = new THREE.Sphere(BOX_MIN.clone().addScaledVector(BOX_SIZE, 0.5), BOX_SIZE.length() / 2)
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAmt: { value: 0 },
        uHalfH: { value: 400 },
        uMin: { value: BOX_MIN },
        uSize: { value: BOX_SIZE },
        uC1: { value: new THREE.Color('#eef8ff') },
        uC2: { value: new THREE.Color('#7fb9e0') },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return [g, m]
  }, [])
  useFrame((state) => {
    const k = worldState.beyondK
    mat.uniforms.uTime.value = state.clock.elapsedTime
    mat.uniforms.uAmt.value = k * 0.9
    mat.uniforms.uHalfH.value = (size.height * dpr) / 2
    // tetep visible sampai warmup kelar (biar programnya ikut dikompilasi),
    // abis itu cuma digambar pas di balik portal
    if (pts.current) pts.current.visible = k > 0.002 || !warmState.done
  })
  return <points ref={pts} geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />
}
