import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { introState, scrollState } from '../scrollState'
import { GROUND_Y, buildFloor, buildGround, buildMountains, buildWalls } from './terrain'
import { smoothstep } from './noise'
import { TUNE } from './tune'
import { snowMaterial, wallMaterial, wallU, worldU } from './materials'
import { iceU } from './iceMaterial'

// ===== palet dunia (ngikut referensi igloo: mendung, abu kebiruan, kontras rendah) =====
export const PAL = {
  zenith: new THREE.Color('#9aa1af'),
  horizon: new THREE.Color('#bdc2cb'), // = warna kabut di permukaan, biar cakrawala nyatu
  inTop: new THREE.Color('#6d9cbe'), // di dalam celah, ngadep atas: cahaya dari retakan
  inMid: new THREE.Color('#34627f'), // = warna kabut di dalam celah
  inLow: new THREE.Color('#132b40'),
  deepFog: new THREE.Color('#1f4460'),
  navy: new THREE.Color('#15283a'), // outro, senada .outro-dark v1
}

// seberapa "di luar" kamera sekarang: 1 di atas salju, 0 udah di dalam celah
export const worldState = { out: 1, navy: 0 }

// ===== langit / latar: quad layar penuh di bidang far =====
// Warnanya dari ARAH PANDANG per piksel (bukan posisi layar), jadi garis
// cakrawala di langit selalu pas sama cakrawala dunia walau kamera nunduk.
const skyVert = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.99999, 1.0);
  }
`
const skyFrag = /* glsl */ `
  varying vec2 vNdc;
  uniform mat4 uProjInv;
  uniform mat4 uCamWorld;
  uniform float uOut;
  uniform float uNavy;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uInTop;
  uniform vec3 uInMid;
  uniform vec3 uInLow;
  uniform float uTime;
  uniform float uCloud;
  uniform vec3 uSunDir;
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
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += vnoise(p) * a;
      p = p * 2.03 + 11.7;
      a *= 0.5;
    }
    return s;
  }
  void main() {
    vec4 v = uProjInv * vec4(vNdc, 1.0, 1.0);
    vec3 dir = normalize((uCamWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
    float h = dir.y;
    // mendung: paling terang pudar tepat di atas cakrawala, pelan gelap ke atas
    vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.75, h), 0.7));
    // awan mendung: gumpalan besar lembut di bidang awan (makin dekat cakrawala
    // makin gepeng), geser pelan. Plus terang samar di arah matahari di balik awan
    if (h > 0.0) {
      vec2 cuv = dir.xz / (h + 0.18) * 0.55 + uTime * vec2(0.006, 0.002);
      float cl = fbm(cuv);
      float fadeH = smoothstep(0.0, 0.12, h);
      sky *= 1.0 + (cl - 0.5) * uCloud * 2.0 * fadeH;
      sky += vec3(0.05, 0.05, 0.045) * pow(max(dot(dir, uSunDir), 0.0), 6.0) * fadeH;
    }
    vec3 inside = mix(uInMid, uInTop, smoothstep(0.05, 0.9, h));
    // dari dalam celah, yang keliatan ke atas cuma lewat retakan: langit siang
    // terang, jadi retakannya kebaca garis cahaya (bukan celah gelap)
    inside = mix(inside, uHorizon * 1.12, smoothstep(0.3, 0.75, h));
    inside = mix(inside, uInLow, smoothstep(-0.05, -0.9, h));
    vec3 c = mix(inside, sky, uOut);
    // outro: biru tua radial kayak .outro-dark v1 (tengah agak terang di belakang figur)
    vec2 q = (vNdc - vec2(0.0, 0.16)) / vec2(1.2, 1.4);
    float r = length(q);
    vec3 navy = mix(vec3(0.090, 0.188, 0.286), vec3(0.047, 0.102, 0.161), smoothstep(0.0, 0.55, r));
    navy = mix(navy, vec3(0.020, 0.043, 0.071), smoothstep(0.55, 1.0, r));
    c = mix(c, navy, uNavy);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`
function Sky() {
  const camera = useThree((s) => s.camera)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uProjInv: { value: new THREE.Matrix4() },
          uCamWorld: { value: new THREE.Matrix4() },
          uOut: { value: 1 },
          uNavy: { value: 0 },
          uZenith: { value: PAL.zenith },
          uHorizon: { value: PAL.horizon },
          uInTop: { value: PAL.inTop },
          uInMid: { value: PAL.inMid },
          uInLow: { value: PAL.inLow },
          uTime: worldU.uTime,
          uSunDir: worldU.uSunDir,
          uCloud: { value: TUNE.cloud },
        },
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  )
  useFrame(() => {
    const u = mat.uniforms
    u.uProjInv.value.copy(camera.projectionMatrixInverse)
    u.uCamWorld.value.copy(camera.matrixWorld)
    u.uOut.value = worldState.out
    u.uNavy.value = worldState.navy
    u.uCloud.value = TUNE.cloud
  })
  return (
    <mesh material={mat} frustumCulled={false} renderOrder={-1001}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

// ===== kabut + status zona, ngikut POSISI kamera (bukan scroll) =====
// Batas luar/dalam = kamera nembus permukaan salju, jadi transisinya pas sama
// yang keliatan, termasuk pas nyelam ke batu atau pas jembatan loop.
const _fog = new THREE.Color()
export function WorldFog() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const y = camera.position.y
    const out = smoothstep(GROUND_Y - 2.2, GROUND_Y + 1.4, y)
    // makin dalam makin pekat & biru tua
    const deep = smoothstep(-8, -30, y)
    // biru tua outro: logika v1 (abis SKILLS sampai wajah, padam pas bridge)
    const navy = smoothstep(0.81, 0.9, scrollState.damped) * (1 - smoothstep(0, 0.12, scrollState.bridge))
    worldState.out = out
    worldState.navy = navy
    if (!scene.fog) return
    let near = THREE.MathUtils.lerp(TUNE.fogInNear, TUNE.fogOutNear, out)
    let far = THREE.MathUtils.lerp(THREE.MathUtils.lerp(TUNE.fogInFar, TUNE.fogDeepFar, deep), TUNE.fogOutFar, out)
    far = THREE.MathUtils.lerp(far, 36, navy)
    // intro: kabut rapet dulu, kebuka bareng reveal (sama kayak v1)
    const r = introState.phase === 'idle' ? 1 : introState.reveal
    scene.fog.near = THREE.MathUtils.lerp(4, near, r)
    scene.fog.far = THREE.MathUtils.lerp(14, far, r)
    _fog.copy(PAL.inMid).lerp(PAL.deepFog, deep).lerp(PAL.horizon, out).lerp(PAL.navy, navy)
    scene.fog.color.copy(_fog)
  })
  return null
}

// lampu dunia: langit mendung (hemisphere) + matahari tipis dari kiri atas.
// Intensitas dibaca dari TUNE tiap frame
export function WorldLights() {
  const amb = useRef()
  const hemi = useRef()
  const sun = useRef()
  const fill = useRef()
  const scene = useThree((st) => st.scene)
  useFrame((state) => {
    // kekuatan pantulan langit (Environment) ke semua material, bisa disetel live
    scene.environmentIntensity = TUNE.envInt
    worldU.uTime.value = state.clock.elapsedTime
    worldU.uSunDir.value.set(...TUNE.sunPos).normalize()
    worldU.uFogTop.value = TUNE.fogTop
    if (amb.current) amb.current.intensity = TUNE.ambient
    if (hemi.current) hemi.current.intensity = TUNE.hemi
    if (sun.current) {
      sun.current.intensity = TUNE.sun
      sun.current.position.set(...TUNE.sunPos)
    }
    if (fill.current) fill.current.intensity = TUNE.fill
    wallU.uGlow.value = TUNE.wallGlow
    wallU.uWallBump.value = TUNE.wallBump
    wallU.uOut.value = worldState.out
    iceU.uIceBump.value = TUNE.iceBump
    iceU.uFrost.value = TUNE.iceFrost
  })
  return (
    <>
      <ambientLight ref={amb} intensity={TUNE.ambient} />
      <hemisphereLight ref={hemi} args={['#e3e8f0', '#5a6a7d', TUNE.hemi]} />
      <directionalLight ref={sun} position={[-7, 11, 6]} intensity={TUNE.sun} color="#f3f1ee" />
      <directionalLight ref={fill} position={[-6, -4, -6]} intensity={TUNE.fill} color="#dfe8ff" />
    </>
  )
}

export function World() {
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height))
  // di layar potret (HP) sudut pandang horizontal sempit, dinding dirapetin
  // biar tetep kebaca di pinggir layar. Dihitung sekali pas mount
  const portrait = useRef(aspect < 1).current
  const ground = useMemo(() => buildGround(), [])
  const walls = useMemo(() => buildWalls({ W: portrait ? 7 : 9 }), [portrait])
  const floor = useMemo(() => buildFloor(), [])
  const mountains = useMemo(() => buildMountains(), [])
  const snowMat = useMemo(snowMaterial, [])
  useFrame(() => {
    snowMat.color.set(TUNE.snowColor)
    snowMat.envMapIntensity = TUNE.snowEnv
    snowMat.userData.u.uBump.value = TUNE.snowBump
    snowMat.userData.u.uGlint.value = TUNE.snowGlint
    snowMat.userData.u.uFarShade.value = TUNE.farShade
  })
  const iceMat = useMemo(wallMaterial, [])
  return (
    <>
      <Sky />
      {ground.map((g, i) => (
        <mesh key={'g' + i} geometry={g} material={snowMat} />
      ))}
      {walls.map((g, i) => (
        <mesh key={'w' + i} geometry={g} material={iceMat} />
      ))}
      <mesh geometry={floor} material={iceMat} />
      <mesh geometry={mountains} material={snowMat} />
    </>
  )
}
