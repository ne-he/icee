import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { introState, scrollState } from '../scrollState'
import { GROUND_Y, buildFloor, buildGround, buildMountains, buildWalls } from './terrain'
import { smoothstep } from './noise'
import { TUNE } from './tune'
import { snowMaterial, wallMaterial, wallU, worldU } from './materials'
import { iceU } from './iceMaterial'
import { Cave } from './Cave'
import { B_GATE, computeFx } from '../fx/fxState'
import { LOW } from '../perf'
import { PORTAL_POS } from '../Portal'

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
// beyond/beyondK: kamera lagi di balik gerbang portal (dunia partikel, lihat
// Beyond.jsx). beyond = 0/1 buat sembunyiin gua, beyondK = versi halusnya
export const worldState = { out: 1, navy: 0, beyond: 0, beyondK: 0 }

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
  uniform float uCrackSky;
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
    // jauh lebih terang dari gua, jadi retakannya kebaca bukaan cahaya yang
    // silau (disambut bloom), bukan celah biru. Mulai dari sudut landai juga:
    // retakan di ujung lorong keliatan miring dari bawah
    inside = mix(inside, uHorizon * uCrackSky, smoothstep(0.06, 0.4, h));
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
          uCrackSky: { value: TUNE.crackSky },
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
    u.uCrackSky.value = TUNE.crackSky
  })
  // digambar PALING AKHIR di antara benda opaque (dulu paling awal, -1001).
  // Dia duduk di bidang far dengan depth test, jadi hasilnya sama persis, tapi
  // sekarang piksel yang udah ketutup dinding/salju ditolak depth test duluan:
  // fbm awan gak dihitung di bawah semua itu. Di dalam gua hampir selayar penuh
  // ketutup dinding, hemat 1 sampai 3,5 ms GPU per frame (Iris Xe, dua pass)
  return (
    <mesh material={mat} frustumCulled={false} renderOrder={1000}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

// ===== kabut + status zona, ngikut POSISI kamera (bukan scroll) =====
// Batas luar/dalam = kamera nembus permukaan salju, jadi transisinya pas sama
// yang keliatan, termasuk pas nyelam ke batu atau pas jembatan loop.
const _fog = new THREE.Color()
const _fogDeep = new THREE.Color()
// warna badai putih (src/fx): sedikit lebih gelap dari overlay .fx-white biar
// pas overlay-nya menipis, dunia yang ketutup kabut nyambung, gak loncat terang
const BLIZZARD = new THREE.Color('#d9dee4')
// kabut dicampur di ruang KERAPATAN (1/jarak), bukan jarak linear. Lerp linear
// far 620 → 58 bikin kabut baru kerasa di 10% terakhir (serah terimanya
// kerasa "plek"). Di ruang 1/far, setengah jalan = setengah pekat beneran
const mixDensity = (a, b, t) => 1 / THREE.MathUtils.lerp(1 / a, 1 / b, t)
const smoother = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}
export function WorldFog() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const y = camera.position.y
    // serah terima luar → dalam ngikut kamera nembus salju. Rentangnya dilebarin
    // (dulu -3.6..0) biar langit & kabut berubahnya bareng kamera nyelip di
    // bibir retakan (d ~0.04..0.13), bukan ganti mendadak di satu titik
    const out = smoother(GROUND_Y - 4.4, GROUND_Y + 1.7, y)
    // makin dalam makin pekat & biru tua
    const deep = smoothstep(-8, -30, y)
    // biru tua outro: abis SKILLS sampai wajah. Pas loop bertahan sampai
    // kamera naik nembus gerbang portal lagi (B_GATE), baru balik ke kabut gua
    const navy = smoothstep(0.81, 0.9, scrollState.damped) * (1 - smoothstep(B_GATE - 0.06, B_GATE + 0.04, scrollState.bridge))
    worldState.out = out
    worldState.navy = navy
    if (!scene.fog) return
    let near = THREE.MathUtils.lerp(TUNE.fogInNear, TUNE.fogOutNear, out)
    let far = mixDensity(mixDensity(TUNE.fogInFar, TUNE.fogDeepFar, deep), TUNE.fogOutFar, out)
    far = mixDensity(far, 36, navy)
    // di balik gerbang portal: kabut rapet dulu selama kamera nyelam (kristal
    // podium ~20 unit di bawah gak langsung kebaca), kebuka pas mendekati wajah.
    // Jadi kristalnya muncul pelan dari kabut, bukan nongol sekaligus
    const bk = worldState.beyondK
    if (bk > 0) {
      const arrive = smoothstep(0.962, 0.992, scrollState.damped)
      far = mixDensity(far, THREE.MathUtils.lerp(16, 52, arrive), bk)
      near = THREE.MathUtils.lerp(near, THREE.MathUtils.lerp(3, 14, arrive), bk)
    }
    // badai (jembatan loop & intro): kabut rapet putih, kebuka pas badainya reda.
    // computeFx dipanggil di sini juga (murah), biar angkanya dari scroll frame ini
    const bz = computeFx().blizzard
    // puncaknya far 5: bibir retakan di depan kamera juga ketelan putih, jadi
    // yang pertama nongol pas reda itu siluet, bukan lubang biru gelap
    near = THREE.MathUtils.lerp(near, 0.5, bz)
    far = mixDensity(far, 5, bz)
    // loader masih nutup: kabut rapet (reveal 0), sama kayak v1
    const r = introState.phase === 'idle' ? 1 : introState.reveal
    far = mixDensity(14, far, r)
    // near dicampur linear, far di ruang kerapatan: pas badai reda near bisa
    // nyalip far (kejadian: near 12 far 9.7 di br 0.8), dan smoothstep di
    // shader kabut jadi ngaco (gunung item, retakan gak ketutup). Dijepit
    scene.fog.near = Math.min(THREE.MathUtils.lerp(4, near, r), far * 0.5)
    scene.fog.far = far
    // di dalam gua: cyan kebiruan di atas (cahaya retakan) ke biru tua di
    // kedalaman SKILLS, warnanya dari TUNE (Cave.jsx), nyambung ke navy outro
    _fog.set(TUNE.fogCaveTop).lerp(_fogDeep.set(TUNE.fogCaveDeep), deep).lerp(PAL.horizon, out).lerp(PAL.navy, navy).lerp(BLIZZARD, bz)
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
    iceU.uIceGlow.value = TUNE.iceGlow
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

// ===== culling per zona (dari POSISI kamera, sama kayak WorldFog) =====
// Dataran & pegunungan gak kelihatan sama sekali dari dalam gua, tapi tetep
// digambar duluan lalu ketimpa dinding (fragmennya dihitung sia-sia). Batasnya
// dari tools/verify/visibility.py (hitung piksel yang beneran lolos depth test
// sepanjang satu loop) + render A/B offscreen:
//  - pegunungan: 0 piksel mulai kamera y -3.6, dipasang -4 (jarak aman parallax)
//  - dataran: di bawah y -6 sisa beberapa piksel di titik hilang lorong yang
//    udah ketelen kabut, beda maksimal 1/255, 0 persis mulai y -14
// Flag visible ikut kebaca IceBuffer, jadi pass refraksi ikut hemat.
const MTN_BELOW = -4
const GROUND_BELOW = -6

// potongan terrain buat frustum culling (world/terrain.js chunkGrid), dipilih
// pakai tools/verify/chunksim.mjs. Di hero desktop segitiga dataran+gunung per
// pass 191rb jadi ~77rb. HP: potongan dataran lebih sedikit (tiap draw call di
// CPU HP mahal)
const GRID = LOW
  ? {
      // densitas HP: ~40% segitiga desktop. Keliling gunung tetep rapat (448):
      // layar potret cuma lihat ~15 derajat cincin, jadi tiap segmen kebaca
      // gede dan punggungannya jadi patah-patah kalau dikurangin lebih jauh.
      // Dinding: detail kecilnya dari tekstur, bukan dari vertex
      ground: { cols: 60, rows: 115, rCut: [0, 0.26, 1], cCut: [0, 0.45, 1] },
      mtn: { seg: 448, rings: 54, sectors: 16, radial: 2 },
      walls: { cols: 100, rows: 96 },
    }
  : {
      ground: { rCut: [0, 0.26, 0.6, 1], cCut: [0, 0.4, 0.7, 1] },
      mtn: { sectors: 16, radial: 2 },
      walls: {},
    }

export function World() {
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height))
  const camera = useThree((s) => s.camera)
  // di layar potret (HP) sudut pandang horizontal sempit, dinding dirapetin
  // biar tetep kebaca di pinggir layar. Dihitung sekali pas mount
  const portrait = useRef(aspect < 1).current
  const ground = useMemo(() => buildGround(GRID.ground), [])
  const walls = useMemo(() => buildWalls({ W: portrait ? 7 : 9, ...GRID.walls }), [portrait])
  const floor = useMemo(() => buildFloor(), [])
  const mountains = useMemo(() => buildMountains(GRID.mtn), [])
  const snowMat = useMemo(snowMaterial, [])
  const groundRef = useRef()
  const mtnRef = useRef()
  const caveRef = useRef()
  useFrame(() => {
    snowMat.color.set(TUNE.snowColor)
    snowMat.envMapIntensity = TUNE.snowEnv
    snowMat.userData.u.uBump.value = TUNE.snowBump
    snowMat.userData.u.uGlint.value = TUNE.snowGlint
    snowMat.userData.u.uFarShade.value = TUNE.farShade
    const y = camera.position.y
    if (groundRef.current) groundRef.current.visible = y > GROUND_BELOW
    if (mtnRef.current) mtnRef.current.visible = y > MTN_BELOW
    // di balik gerbang portal gua-nya ilang: dinding, dasar, icicle, kolom
    // cahaya. Pindahnya pas kamera nembus bidang ring, ketutup kilatan portal
    // (Portal.jsx), dua arah (turun & naik balik pas loop)
    const gate = PORTAL_POS[1] - 0.35
    const deepEnough = scrollState.damped > 0.93
    worldState.beyond = deepEnough && y < gate ? 1 : 0
    worldState.beyondK = deepEnough ? smoothstep(gate, gate - 1.2, y) : 0
    if (caveRef.current) caveRef.current.visible = !worldState.beyond
  })
  const iceMat = useMemo(wallMaterial, [])
  return (
    <>
      <Sky />
      <group ref={groundRef}>
        {ground.map((g, i) => (
          <mesh key={'g' + i} geometry={g} material={snowMat} userData={{ zone: 'ground' }} />
        ))}
      </group>
      <group ref={caveRef}>
        {walls.map((g, i) => (
          <mesh key={'w' + i} geometry={g} material={iceMat} userData={{ zone: 'walls' }} />
        ))}
        <mesh geometry={floor} material={iceMat} userData={{ zone: 'floor' }} />
        {/* isi gua: icicle, jembatan salju, ledge, kolom cahaya, debu es */}
        <Cave W={portrait ? 7 : 9} wallMat={iceMat} />
      </group>
      <group ref={mtnRef}>
        {mountains.map((g, i) => (
          <mesh key={'m' + i} geometry={g} material={snowMat} userData={{ zone: 'mtn' }} />
        ))}
      </group>
    </>
  )
}
