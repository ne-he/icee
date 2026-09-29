import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { LOW } from '../perf'
import { warmState } from '../warmup'
import { computeFx } from './fxState'

// ===== salju 3D yang kesapu lewat pas transisi =====
// Butiran salju hidup di kotak dunia yang "ngikut" kamera (posisi di-wrap pakai
// mod di shader), jadi butirannya DIAM di dunia dan gerak kamera sendiri yang
// bikin mereka lewat: nyemplung ke retakan = salju nyembur ke atas, naik di
// gua = salju ngalir ke bawah, badai = angin samping.
//
// Tiap butir digambar sebagai kapsul yang dipanjangin searah gerak RELATIF
// (angin dikurangi kecepatan kamera) di ruang layar = motion blur murah, jadi
// kesan ngebut kebaca walau cuma satu frame. Satu draw call instanced.
//
// Cuma kelihatan di jendela transisi (fx.snow > 0). Pas warmup dia sengaja
// dibiarin visible biar programnya ikut dikompilasi di balik loader
// (compileAsync three cuma ngompilasi objek yang visible).
const COUNT = LOW ? 380 : 1100
const BOX = 14 // sisi kotak salju di sekitar kamera (unit dunia)

const vert = /* glsl */ `
  attribute vec2 corner;
  attribute vec4 seed;
  uniform vec3 uCam;
  uniform vec3 uDrift;
  uniform vec3 uRel;
  uniform float uBox;
  uniform float uTime;
  uniform vec2 uHalf;
  varying vec2 vQ;
  varying float vLen;
  varying float vW;
  varying float vA;
  void main() {
    // butiran = titik acak di kotak + geseran angin (diakumulasi di JS) + goyang
    vec3 wob = vec3(sin(uTime * 0.9 + seed.w * 40.0), 0.0, cos(uTime * 0.7 + seed.w * 23.0)) * 0.25;
    vec3 p = seed.xyz * uBox + uDrift + wob;
    p = uCam + mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
    // ekor = posisi relatif butir ini ~sepersekian detik lalu
    vec3 tail = p - uRel * (0.7 + seed.w * 0.6);
    vec4 a = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vec4 b = projectionMatrix * viewMatrix * vec4(tail, 1.0);
    if (b.w < 0.1) b = a;
    vec2 sa = a.xy / a.w * uHalf;
    vec2 sb = b.xy / b.w * uHalf;
    vec2 dir = sb - sa;
    float len = min(length(dir), uHalf.y * 0.5);
    vec2 n = len > 0.01 ? dir / length(dir) : vec2(0.0, 1.0);
    vec2 perp = vec2(-n.y, n.x);
    // radius layar (px): ukuran dunia 1.3..2.6 cm diproyeksiin, dijepit biar
    // butir yang mepet kamera gak jadi gumpalan raksasa
    float r = (0.013 + 0.013 * seed.w) * projectionMatrix[1][1] * uHalf.y / max(a.w, 0.05);
    r = clamp(r, 0.7, 5.5);
    float along = mix(-r, len + r, corner.y);
    vec2 pos = sa + n * along + perp * corner.x * r;
    gl_Position = vec4(pos / uHalf * a.w, a.z, a.w);
    vQ = vec2(along, corner.x * r);
    vLen = len;
    vW = r;
    // pudar di tepi kotak (gak nongol tiba-tiba pas di-wrap) & kalau mepet lensa
    float dist = length(p - uCam);
    vA = (1.0 - smoothstep(uBox * 0.3, uBox * 0.48, dist)) * smoothstep(0.25, 0.9, a.w) * (0.45 + 0.55 * fract(seed.w * 7.13));
    // ekor panjang = energinya kebagi, makin panjang makin tipis
    vA *= clamp((2.0 * r) / (len + 2.0 * r), 0.2, 1.0);
    if (a.w < 0.1) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`
const frag = /* glsl */ `
  uniform float uAmt;
  uniform vec3 uColor;
  varying vec2 vQ;
  varying float vLen;
  varying float vW;
  varying float vA;
  void main() {
    // jarak ke segmen kepala-ekor = kapsul lembut
    float da = max(0.0, max(-vQ.x, vQ.x - vLen));
    float d = length(vec2(da, vQ.y));
    float a = 1.0 - smoothstep(vW * 0.35, vW, d);
    gl_FragColor = vec4(uColor, a * vA * uAmt);
    #include <colorspace_fragment>
  }
`

export function SnowFx() {
  const size = useThree((s) => s.size)
  const mesh = useRef()
  const [geo, mat] = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    // quad: corner.x = lintang (-1..1), corner.y = sepanjang (0 kepala, 1 ekor)
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2))
    g.setIndex([0, 1, 2, 2, 1, 3])
    let s = 12345
    const rnd = () => {
      s = (s * 16807) % 2147483647
      return s / 2147483647
    }
    const seeds = new Float32Array(COUNT * 4)
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd()
    g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4))
    g.instanceCount = COUNT
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uDrift: { value: new THREE.Vector3() },
        uRel: { value: new THREE.Vector3() },
        uBox: { value: BOX },
        uTime: { value: 0 },
        uHalf: { value: new THREE.Vector2(1, 1) },
        uAmt: { value: 0 },
        uColor: { value: new THREE.Color('#f4f8fb') },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    })
    return [g, m]
  }, [])
  const st = useMemo(() => ({ prev: new THREE.Vector3(), vel: new THREE.Vector3(), has: false, drift: new THREE.Vector3() }), [])
  useFrame((state, delta) => {
    const f = computeFx()
    const cam = state.camera.position
    const dt = Math.max(1e-3, Math.min(0.05, delta))
    // kecepatan kamera (dihaluskan). Lompatan gede (teleport jembatan, recenter)
    // bukan gerak beneran: reset, jangan jadi coretan selebar layar
    if (st.has) {
      const jump = cam.distanceTo(st.prev)
      if (jump > 4) st.vel.set(0, 0, 0)
      else {
        const k = 1 - Math.exp(-dt / 0.07)
        st.vel.x += ((cam.x - st.prev.x) / dt - st.vel.x) * k
        st.vel.y += ((cam.y - st.prev.y) / dt - st.vel.y) * k
        st.vel.z += ((cam.z - st.prev.z) / dt - st.vel.z) * k
        if (st.vel.length() > 45) st.vel.setLength(45)
      }
    }
    st.prev.copy(cam)
    st.has = true
    const w = f.wind
    st.drift.x = (st.drift.x + w[0] * dt) % BOX
    st.drift.y = (st.drift.y + w[1] * dt) % BOX
    st.drift.z = (st.drift.z + w[2] * dt) % BOX
    const u = mat.uniforms
    u.uCam.value.copy(cam)
    u.uDrift.value.copy(st.drift)
    // gerak relatif butir terhadap kamera selama ~1/22 detik = panjang coretan
    u.uRel.value.set(w[0] - st.vel.x, w[1] - st.vel.y, w[2] - st.vel.z).multiplyScalar(0.045)
    u.uTime.value = state.clock.elapsedTime
    u.uHalf.value.set(size.width / 2, size.height / 2)
    u.uAmt.value = f.snow
    if (mesh.current) mesh.current.visible = f.snow > 0.004 || !warmState.done
  })
  // raycast dimatiin: geometrinya cuma quad di titik 0, posisi aslinya di shader
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={20} raycast={() => null} />
}
