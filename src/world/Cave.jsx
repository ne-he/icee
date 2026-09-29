import * as THREE from 'three'
import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { LOW } from '../perf'
import { GROUND_Y } from './terrain'
import { smoothstep } from './noise'
import { TUNE } from './tune'
import { wallU } from './materials'
import { worldState } from './World'
import { buildBeams, buildDust, buildFormations } from './caveGeo'

const V = (x, y, z) => new THREE.Vector3(x, y, z)

// ===== isi gua es di bawah retakan (icev2) =====
// Tiga lapis biar turunnya kerasa gua gletser beneran, bukan lorong kosong
// dengan latar biru rata:
//  1. formasi es: icicle di bibir & langit-langit, sisa jembatan salju yang
//     nyangkut di antara dinding, ledge yang nonjol dari dinding, bongkah es
//     jatuh, dan siluet besar jauh di lorong yang tenggelam di kabut. Semua
//     digabung SATU geometri pakai material dinding yang sama (materials.js):
//     nol program shader baru, satu draw call
//  2. kolom cahaya siang dari retakan (billboard silinder, satu draw call)
//  3. debu es / salju halus yang turun dari retakan, tiga lapis jarak (dekat
//     = bokeh, tengah, jauh) buat parallax & skala (satu draw call)
// Semua material dibikin sekali pas mount & gak pernah di-unmount (Warmup di
// Experience ngompilasi semuanya di balik loader), yang digerakin cuma uniform
// & visible. Geometri & susunannya di caveGeo.js (JS murni, bisa dicek di node).

// ===== kolom cahaya dari retakan =====
// Tiap kolom = strip quad yang diputer di sumbunya sendiri ngadep kamera
// (billboard silinder, di vertex shader), jadi kebaca volume dari sudut mana
// pun. Semua kolom digabung satu geometri. Terang di atas, pudar ke bawah,
// garis-garis sinar di dalamnya geser pelan, pudar di kabut & pas kamera
// nembus kolomnya
const beamVert = /* glsl */ `
  attribute vec3 aAxis;
  attribute vec2 aW;
  attribute vec2 aUV;
  attribute vec2 aSeed;
  uniform float uTime;
  varying vec2 vUV;
  varying vec2 vSeed;
  varying float vDist;
  varying float vFace;
  void main() {
    vec3 dir = normalize(aAxis);
    vec3 P = position + aAxis * aUV.y;
    // goyang pelan kayak cahaya lewat udara yang gerak
    P.x += sin(uTime * 0.11 + aSeed.x * 6.283) * 0.22 * aUV.y;
    P.z += cos(uTime * 0.09 + aSeed.x * 4.1) * 0.18 * aUV.y;
    vec3 toCam = cameraPosition - P;
    vec3 sd = cross(dir, toCam);
    float l = length(sd);
    sd = l > 1e-4 ? sd / l : vec3(1.0, 0.0, 0.0);
    float w = mix(aW.x, aW.y, aUV.y);
    P += sd * aUV.x * w * 0.5;
    vec4 mv = viewMatrix * vec4(P, 1.0);
    gl_Position = projectionMatrix * mv;
    vUV = aUV;
    vSeed = aSeed;
    vDist = -mv.z;
    vFace = abs(dot(normalize(toCam), dir));
  }
`
const beamFrag = /* glsl */ `
  uniform float uTime;
  uniform float uInt;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uTop;
  uniform vec3 uLow;
  varying vec2 vUV;
  varying vec2 vSeed;
  varying float vDist;
  varying float vFace;
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float u = vUV.x;
    float v = vUV.y;
    // tepi lembut (gauss), gak ada garis potongan plane
    float edge = max(0.0, exp(-u * u * 2.6) - 0.07) / 0.93;
    float along = smoothstep(0.0, 0.08, v) * pow(1.0 - v, 1.9);
    // sinar-sinar di dalam kolom, geser pelan (debu lewat cahaya). Kontrasnya
    // dijaga rendah: volume kabut yang disinari, bukan garis-garis laser
    float rays = vnoise(vec2(u * 2.6 + vSeed.x * 17.0, v * 0.8 - uTime * 0.03));
    rays = mix(rays, vnoise(vec2(u * 6.0 - vSeed.x * 9.0 + uTime * 0.015, v * 1.8 + uTime * 0.04)), 0.4);
    float a = edge * along * (0.55 + 0.6 * rays) * vSeed.y * uInt;
    a *= smoothstep(1.2, 4.5, vDist);
    a *= 1.0 - smoothstep(0.82, 0.97, vFace);
    a *= 1.0 - 0.75 * smoothstep(uFogNear, uFogFar * 1.2, vDist);
    gl_FragColor = vec4(mix(uTop, uLow, smoothstep(0.0, 0.8, v)), a);
    #include <colorspace_fragment>
  }
`

// ===== debu es / salju halus =====
// Partikel ditaruh di pola yang berulang tiap "kotak" di dunia, lalu di-wrap
// ke kotak di depan kamera (vertex shader). Hasilnya partikel nempel di dunia
// (parallax asli pas kamera turun) tapi selalu ada di sekitar kamera, di
// kedalaman berapa pun, tanpa update CPU. Tiga lapis: dekat (gede, lembut
// kayak bokeh), tengah, jauh (titik halus yang ketelen kabut)
const dustVert = /* glsl */ `
  attribute vec4 aR; // kecepatan jatuh, fase, ukuran dunia, kelip
  attribute float aL; // lapis 0 dekat, 1 tengah, 2 jauh
  uniform float uTime;
  uniform float uMotion;
  uniform float uInt;
  uniform float uOutK;
  uniform float uPx;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uBox0;
  uniform vec3 uBox1;
  uniform vec3 uBox2;
  uniform vec3 uAhead;
  varying float vA;
  varying float vSoft;
  void main() {
    vec3 box = aL < 0.5 ? uBox0 : (aL < 1.5 ? uBox1 : uBox2);
    float ahead = aL < 0.5 ? uAhead.x : (aL < 1.5 ? uAhead.y : uAhead.z);
    vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    vec3 ctr = cameraPosition + fwd * ahead;
    float t = uTime * uMotion;
    vec3 w = position * box;
    w.y -= t * aR.x;
    w.x += sin(t * 0.37 + aR.y * 6.283) * 0.3 + sin(t * 0.13 + aR.y * 17.0) * 0.5;
    w.z += cos(t * 0.29 + aR.y * 4.1) * 0.3;
    vec3 loc = mod(w - ctr + box * 0.5, box) - box * 0.5;
    vec3 p = ctr + loc;
    vec3 e = abs(loc) / (box * 0.5);
    float edge = 1.0 - smoothstep(0.72, 1.0, max(max(e.x, e.y), e.z));
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    gl_Position = projectionMatrix * mv;
    float px = aR.z * uPx / max(dist, 0.05);
    // disinari retakan: terang di gua atas & tepat di bawah celah, redup di dalem
    float light = mix(0.2, 1.0, smoothstep(-32.0, -3.0, p.y)) * (0.5 + 0.5 * exp(-p.x * p.x / 20.0));
    // di atas salju (kamera di luar): cahaya mendung rata
    light = mix(light, uOutK, smoothstep(${(GROUND_Y - 0.5).toFixed(2)}, ${(GROUND_Y + 0.5).toFixed(2)}, p.y));
    float tw = pow(max(0.0, sin(t * (1.1 + aR.y * 2.3) + aR.y * 40.0)), 18.0) * aR.w;
    float fog = 1.0 - smoothstep(uFogNear, uFogFar, dist);
    float big = smoothstep(7.0, 24.0, px);
    gl_PointSize = clamp(px, 1.0, 24.0);
    vA = light * edge * fog * uInt * (1.0 + tw * 3.0) * mix(1.0, 0.3, big) * smoothstep(0.3, 1.2, dist) * min(1.0, px * px);
    vSoft = big;
  }
`
const dustFrag = /* glsl */ `
  uniform vec3 uCol;
  varying float vA;
  varying float vSoft;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    float core = exp(-r2 * 4.5);
    float disc = smoothstep(1.0, 0.6, r2);
    float a = mix(core, disc * 0.55 + core * 0.45, vSoft) * vA;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uCol, a);
    #include <colorspace_fragment>
  }
`
const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export function Cave({ W, wallMat }) {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const { formations, beams } = useMemo(() => {
    const f = buildFormations(W, LOW)
    return { formations: f.geo, beams: buildBeams(f.K, f.occluders, LOW) }
  }, [W])
  const dust = useMemo(() => buildDust(LOW), [])

  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uInt: { value: 0 },
          uFogNear: { value: 7 },
          uFogFar: { value: 58 },
          uTop: { value: new THREE.Color('#f2fbff') },
          uLow: { value: new THREE.Color('#8ccdf0') },
        },
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    []
  )
  const dustMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMotion: { value: reduceMotion ? 0.15 : 1 },
          uInt: { value: 0 },
          uOutK: { value: 0.8 },
          uPx: { value: 1000 },
          uFogNear: { value: 7 },
          uFogFar: { value: 58 },
          uBox0: { value: V(8, 6, 8) },
          uBox1: { value: V(18, 14, 22) },
          uBox2: { value: V(34, 26, 48) },
          uAhead: { value: V(3.5, 10, 27) },
          uCol: { value: new THREE.Color('#e2f4ff') },
        },
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  )

  const refs = useMemo(() => ({ beam: null, dust: null }), [])
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const y = camera.position.y
    const out = worldState.out
    const navy = worldState.navy
    // skrip warna dinding (live dari TUNE)
    wallU.uCaveTop.value.set(TUNE.caveTop)
    wallU.uCaveMid.value.set(TUNE.caveMid)
    wallU.uCaveDeep.value.set(TUNE.caveDeep)
    wallU.uCaveTopK.value = TUNE.caveTopK
    wallU.uCaveOcc.value = TUNE.caveOcc
    wallU.uFogLift.value = TUNE.caveFogLift
    wallU.uNavy.value = navy

    const fog = scene.fog
    const fn = fog ? fog.near : 7
    const ff = fog ? fog.far : 58

    // kolom cahaya: paling kuat di gua atas (d 0.1 sampai 0.4), pudar makin
    // dalam, mati pas di luar & pas outro navy
    const bu = beamMat.uniforms
    bu.uTime.value = t
    bu.uInt.value = TUNE.beams * (1 - out) * (1 - 0.8 * smoothstep(-12, -30, y)) * (1 - navy)
    bu.uFogNear.value = fn
    bu.uFogFar.value = ff
    if (refs.beam) refs.beam.visible = bu.uInt.value > 0.002

    const du = dustMat.uniforms
    du.uTime.value = t
    du.uInt.value = TUNE.dust * THREE.MathUtils.lerp(1, TUNE.dustOut, out) * (1 - navy)
    du.uFogNear.value = fn
    du.uFogFar.value = ff
    // ukuran titik dunia ke piksel: tinggi buffer / (2 tan(fov/2)), ikut dpr
    du.uPx.value = state.gl.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    if (refs.dust) refs.dust.visible = du.uInt.value > 0.002
  })

  return (
    <>
      <mesh geometry={formations} material={wallMat} />
      <mesh ref={(m) => (refs.beam = m)} geometry={beams} material={beamMat} frustumCulled={false} renderOrder={2} />
      <points ref={(m) => (refs.dust = m)} geometry={dust} material={dustMat} frustumCulled={false} renderOrder={3} />
    </>
  )
}
