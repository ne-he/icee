import * as THREE from 'three'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles, useGLTF, useProgress } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { easing } from 'maath'
import { Crystal, HoverLight, IceBuffer } from './Crystal'
import { DiveFill, stepDive } from './Dive'
import { TransitionEffect } from './fx/TransitionEffect'
import { ParticleFace } from './ParticleFace'
import { Portal } from './Portal'
import { heroFade } from './Glacier'
import { World, WorldFog, WorldLights, worldState } from './world/World'
import { TUNE } from './world/tune'
import { CRYSTALS, HERO_CRYSTAL } from './content'
import { LOW } from './perf'
import { chatState, dragState, faceState, focusState, introState, scrollState } from './scrollState'
import { warmHooks, warmState } from './warmup'

// nilai awal kabut aja, warna & jaraknya disetel WorldFog (world/World.jsx) tiap frame
export const FOG_COLOR = '#b9c0c7'

export default function Experience({ onOpen, hasVideo }) {
  // bloom disetel per zona: di permukaan salju terang semua, bloom v1 (threshold
  // 0.88) bikin seluruh dataran jadi kabut susu. Di dalam celah balik normal
  const bloomRef = useRef()
  useFrame(() => {
    const e = bloomRef.current
    if (!e) return
    e.intensity = TUNE.bloom * (1 - worldState.out * (1 - TUNE.bloomOut))
    e.luminanceMaterial.threshold = TUNE.bloomThreshold
  })
  return (
    <>
      {/* kalau ada video langit (bg.mp4), canvas dibiarin transparan biar videonya
          keliatan di belakang, pas video fade out, body #b9c0c7 yang jadi kabut */}
      {!hasVideo && <color attach="background" args={[FOG_COLOR]} />}
      <fog attach="fog" args={[FOG_COLOR, 16, 50]} />
      {/* icev2: kabut & latar ngikut posisi kamera (di atas salju / di dalam celah) */}
      <WorldFog />
      <Probe />

      {/* icev2: langit mendung = cahaya lembut dari atas (hemisphere), satu
          arah matahari tipis dari kiri atas biar gundukan salju kebaca bentuknya */}
      <WorldLights />
      {/* lampu kilau hover (Crystal.jsx): kepasang dari awal, intensitas 0 pas
          diem. Desktop doang, HP gak punya hover */}
      {!LOW && <HoverLight />}
      <Suspense fallback={null}>
        {/* dulu preset="city" narik file ini dari CDN pihak ketiga (raw.githack)
            tiap kunjungan, sekarang dilayanin dari domain sendiri. Versi 512 px
            (400 KB, dulu 1k = 1,5 MB, file terbesar di jalur loading): PMREM
            dari sumber 512 cuma ngilangin detail di mip paling tajam, padahal
            batu es di sini roughness 0.1 plus kabut, jadi mip itu gak pernah
            kebaca. Dicek A/B pakai screenshot sebelum diganti */}
        {/* icev2: pantulan dari LANGIT MENDUNG buatan (dirender sekali ke cube
            map), gantiin HDRI alun-alun kota v1 yang bikin es mantulin gedung.
            Kubah atas terang rata, pita cakrawala pucat, bawah abu gelap (salju
            teduh). Nol file tambahan */}
        <Environment resolution={128} frames={1} environmentIntensity={TUNE.envInt}>
          <color attach="background" args={['#9ea6b3']} />
          <Lightformer form="circle" intensity={2.4} color="#eef2f7" position={[0, 14, 0]} rotation-x={Math.PI / 2} scale={26} />
          <Lightformer form="rect" intensity={1.1} color="#dfe4eb" position={[0, 2, -14]} scale={[40, 5, 1]} />
          <Lightformer form="rect" intensity={1.1} color="#dfe4eb" position={[0, 2, 14]} rotation-y={Math.PI} scale={[40, 5, 1]} />
          <Lightformer form="rect" intensity={1.1} color="#dfe4eb" position={[14, 2, 0]} rotation-y={-Math.PI / 2} scale={[40, 5, 1]} />
          <Lightformer form="rect" intensity={1.1} color="#dfe4eb" position={[-14, 2, 0]} rotation-y={Math.PI / 2} scale={[40, 5, 1]} />
          <Lightformer form="rect" intensity={0.7} color="#5d6878" position={[0, -12, 0]} rotation-x={-Math.PI / 2} scale={40} />
        </Environment>
      </Suspense>

      <CameraRig />

      {/* gradient air dalam di balik semua objek (pengganti ShaderGradient) */}
      {!LOW && <DeepWater />}

      {/* batu hero dibungkus HeroDrop: pas intro/loop dia JATUH dari atas ke posisinya */}
      <HeroDrop>
        <Crystal data={HERO_CRYSTAL} interactive={false} snapT={0} />
      </HeroDrop>
      {CRYSTALS.map((c, i) => (
        // snapT = titik scroll pas kamera nge-frame batu ini (sinkron sama
        // anchor di CameraRig), jadi tiap batu bisa diputer pas dia yang keliatan
        <Crystal key={c.id} data={c} onOpen={onOpen} snapT={(i + 1) / (CRYSTALS.length + 1)} />
      ))}

      {/* icev2: dataran salju + celah gletser (gantiin dinding, bongkahan latar
          & pecahan melayang v1) */}
      <World />

      {/* portal es ala igloo, kamera nembus lubangnya sebelum nyampe outro.
          SENGAJA gak dibungkus Suspense sendiri lagi: portal punya pointLight.
          Kalau GLB-nya kelar belakangan dan portal nongol setelah Warmup,
          jumlah lampu berubah dan semua material yang kena cahaya dikompilasi
          ulang pas lagi scroll (kejadian di tes, program baru muncul di tengah
          transisi). portal.glb udah di-preload, jadi nunggu dia gak nambah waktu */}
      <Portal />

      {/* outro: partikel wajah Nehemiah di atas panggung podium ala igloo.
          Landing zone diturunin (jauh di bawah portal -32.8) biar kesan
          "kristal masih jauh di bawah" pas top-down (permintaan Nehemiah) */}
      {/* aura terang di belakang wajah = vibe BEDA pas bagian partikel: bukan
          kabut gelap, tapi kamar es bercahaya (permintaan Nehemiah, ala ss#4) */}
      <FaceAura />
      {/* diturunin 0.9 (dulu -40.55): potongan bawah fotonya jatuh di bawah
          tepi layar, gak kebaca "kaki kepotong di tengah" */}
      <ParticleFace position={[0, -41.45, 1.5]} />
      <OutroStage />
      {/* batu asal yang naik dari bawah podium saat transisi loop (100→120).
          Suspense sendiri: batunya baru kepake pas bridge, jadi jangan sampai
          nahan SELURUH scene nunggu ice_gen.glb kelar download */}
      <Suspense fallback={null}>
        <HeroEcho />
      </Suspense>

      {/* debu es yang melayang di sepanjang jalur turun. Di HP jumlahnya dipotong
          ~sepertiga: tiap sparkle itu sprite transparan yang di-blend, dan
          overdraw transparan justru yang paling nyekek GPU HP */}
      <Sparkles count={LOW ? 90 : 260} scale={[18, 48, 12]} position={[0, -17, 0]} size={2} speed={0.3} opacity={0.5} color="#ffffff" />
      <Sparkles count={LOW ? 30 : 80} scale={[10, 7, 8]} position={[0, 0, 2]} size={2.6} speed={0.2} opacity={0.4} color="#ffffff" />
      <Sparkles count={LOW ? 30 : 90} scale={[14, 46, 6]} position={[0, -18, -6]} size={4} speed={0.15} opacity={0.25} color="#ffffff" />

      {/* kolom-kolom cahaya samar menembus kabut */}
      <LightShafts />

      {/* eksperimen post-processing: bloom halus, threshold tinggi biar cuma
          highlight kristal/portal yang "nyala", kabut putih gak ikut meledak.
          multisampling 0 = hemat GPU (AA-nya udah ketutup fog + grain CSS) */}
      {/* DOF sempet dicoba di sini dan DIBUANG: subjek utama ikut ke-blur, ada
          halo di siluet batu, fps drop ke 28, kabut udah ngasih depth blur alami */}
      {/* Di HP seluruh composer DIMATIIN. mipmapBlur itu rantai downsample +
          upsample full-screen tiap frame, dan dia maksa scene dirender ke FBO
          dulu, padahal di frame yang sama transmission material juga lagi
          nge-render scene ke render target sendiri. Dua-duanya rebutan render
          target, dan itu yang bikin batunya kelap-kelip di HP. */}
      {/* efek transisi (src/fx/TransitionEffect.js: chromatic aberration,
          frost, glitch) DIGABUNG ke EffectPass yang sama kayak Bloom: satu
          program, satu pass, nol biaya pas angkanya 0. HP gak punya composer,
          efeknya diganti overlay DOM murah (src/fx/FxOverlay.jsx) */}
      {!LOW && (
        <EffectComposer multisampling={0}>
          <Bloom ref={bloomRef} intensity={0.38} luminanceThreshold={0.88} luminanceSmoothing={0.22} mipmapBlur />
          <TransitionFx />
        </EffectComposer>
      )}

      {/* penutup layar video pas nyelam ke batu (Dive.jsx), di bawah batu-batu
          biar uniform-nya ditulis setelah CameraRig ngitung koreografinya */}
      <DiveFill />

      <Warmup />
      {/* WAJIB paling bawah: useFrame-nya harus jalan setelah kamera & batu
          selesai digerakin di frame yang sama (lihat IceBuffer di Crystal.jsx) */}
      <IceBuffer />
    </>
  )
}

// ===== pemanasan GPU di balik loader (lihat src/warmup.js) =====
// Begitu semua asset kelar (useProgress gak aktif lagi) dan scene udah
// ke-mount, SEMUA material di scene dikompilasi lewat compileAsync, termasuk
// yang lagi disembunyiin atau jauh di luar kamera (portal, podium, wajah).
// compileAsync pakai KHR_parallel_shader_compile: driver ngompilasi di thread
// sendiri, main thread gak ketahan. Versi pertama warmup ini render paksa
// semua objek sekali jalan, dan itu satu frame macet 6,4 detik (diukur).
// Loader (UI.jsx) nungguin warmState.done sebelum buka tirai.
//
// Program shader three dibedain per target render: di desktop scene masuk ke
// render target EffectComposer (tanpa tone mapping, linear), di HP langsung ke
// layar. Buffer es (IceBuffer) selalu ke render target. Jadi dikompilasi buat
// target yang beneran dipakai, bukan sekadar "yang penting kompilasi".
function Warmup() {
  const since = useRef(0)
  const started = useRef(false)
  const rt = useMemo(() => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }), [])
  useEffect(() => () => rt.dispose(), [rt])
  useFrame(({ gl, scene, camera }) => {
    if (started.current || warmState.done) return
    // tunggu loader three.js diem 250 ms: kasih waktu Suspense dalam (portal,
    // HDR, batu echo) ke-mount dulu setelah file terakhirnya kelar
    if (useProgress.getState().active) {
      since.current = 0
      return
    }
    const now = performance.now()
    if (!since.current) since.current = now
    if (now - since.current < 250) return
    started.current = true

    const prev = gl.getRenderTarget()
    const jobs = []
    gl.setRenderTarget(rt)
    jobs.push(gl.compileAsync(scene, camera))
    if (LOW) {
      gl.setRenderTarget(null)
      jobs.push(gl.compileAsync(scene, camera))
    }
    gl.setRenderTarget(prev)
    // tekstur canvas (glow, sprite partikel) di-upload sekarang juga, bukan pas
    // objeknya pertama kelihatan
    scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of ms) if (m.map) gl.initTexture(m.map)
    })
    warmHooks.forEach((h) => h(gl))
    Promise.all(jobs)
      .catch(() => {})
      .then(() => {
        warmState.done = true
      })
  })
  return null
}

// ===== air dalam: pengganti ShaderGradient =====
// Dulu gradient "waterPlane" ini jalan di canvas WebGL KEDUA (ShaderGradientCanvas)
// di belakang scene: dua konteks, dua layer compositing, ~4 fps melayang
// (diukur). Sekarang quad layar penuh di canvas utama, digambar PALING BELAKANG:
// posisinya di bidang far (z 0.99999) dengan depth test, jadi cuma ngisi
// piksel kosong di belakang objek, persis kayak layer DOM-nya dulu.
// Polanya ditiru dari output mentah ShaderGradient (difoto sendirian): navy
// hampir hitam dengan gumpalan cahaya besar yang ngalir pelan. Opacity-nya
// pakai rumus yang sama persis kayak dulu di master loop App.
const deepVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.99999, 1.0);
  }
`
const deepFrag = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uAspect;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 p = vec2(vUv.x * uAspect, vUv.y) * 1.5;
    float t = uTime;
    // domain warp pelan: gumpalan cahaya yang bergeser kayak permukaan air dari bawah
    vec2 q = vec2(noise(p + vec2(0.0, t * 0.35)), noise(p + vec2(5.2, -t * 0.3)));
    float n = noise(p * 0.9 + q * 1.7 + vec2(t * 0.12, -t * 0.08));
    n = 0.65 * n + 0.35 * noise(p * 2.1 - q + t * 0.2);
    vec3 c = mix(uC0, uC1, smoothstep(0.18, 0.46, n));
    c = mix(c, uC2, smoothstep(0.46, 0.7, n));
    c = mix(c, uC3, smoothstep(0.7, 0.92, n));
    gl_FragColor = vec4(c, uOpacity);
    #include <colorspace_fragment>
  }
`
function DeepWater() {
  const mesh = useRef()
  const size = useThree((s) => s.size)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uAspect: { value: 1 },
          uC0: { value: new THREE.Color('#04070d') },
          uC1: { value: new THREE.Color('#0b1723') },
          uC2: { value: new THREE.Color('#1b2e3e') },
          uC3: { value: new THREE.Color('#324759') },
        },
        vertexShader: deepVert,
        fragmentShader: deepFrag,
        transparent: true,
        depthWrite: false,
      }),
    []
  )
  useFrame((state) => {
    const S = introState
    const rv = S.phase === 'idle' ? 1 : S.reveal
    const dk = scrollState.depthK
    let o = THREE.MathUtils.clamp((dk - 0.24) / 0.4, 0, 1) * 0.5 * rv
    // abis nembus portal kamarnya GELAP dulu, biar salju es terang yang lagi
    // turun kebaca (di latar pucat biasa dia cuma jadi kabut abu). Pas wajahnya
    // "dicuci" jadi warna foto (faceState.develop), kamar balik terang lagi
    // bareng aura. Balik 0 sendiri pas bridge (damped tetep 1 tapi develop turun
    // bareng partikel yang fade)
    const dark = smoothstep(0.945, 0.965, scrollState.damped) * (1 - (faceState.develop ?? 0)) * (1 - smoothstep(0, 0.1, scrollState.bridge))
    o += (0.9 - o) * dark
    // Revisi 27 Sep: dari SKILLS sampai wajah latarnya TETEP biru tua gelap
    // (dulu balik terang pas wajah jadi). Terangnya cuma di aura belakang wajah
    const deep = smoothstep(0.81, 0.88, scrollState.damped) * (1 - smoothstep(0, 0.1, scrollState.bridge))
    o += (0.82 - o) * deep * (1 - dark)
    mat.uniforms.uOpacity.value = o
    mat.uniforms.uTime.value = state.clock.elapsedTime * 0.22
    mat.uniforms.uAspect.value = size.width / Math.max(1, size.height)
    if (mesh.current) mesh.current.visible = o > 0.002
  })
  return (
    <mesh ref={mesh} material={mat} frustumCulled={false} renderOrder={-1000} visible={false}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

// nyambungin renderer ke handle debug window.__ice, dipakai buat ngukur
// draw call & segitiga per frame pas verifikasi, gak kepake pas runtime
function Probe() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    if (window.__ice) window.__ice.gl = gl
  }, [gl])
  return null
}

// efek transisi desktop (CA + frost + glitch), dibikin sekali. Angkanya
// dihitung sendiri tiap frame di TransitionEffect.update (src/fx/fxState.js)
function TransitionFx() {
  const effect = useMemo(() => new TransitionEffect(), [])
  useEffect(() => () => effect.dispose(), [effect])
  return <primitive object={effect} dispose={null} />
}

// batu hero jatuh dari atas, digerakin BRIDGE (satu jalur buat intro & loop):
//  - intro pertama (phase 'fall'): App nge-drive bridge 0.6→1.0 (animasi emerge)
//  - tiap loop (idle, bridge): pas biru nutup batu keangkat, lalu jatuh mendarat
//    pas biru nyingkap → mendarat = awal descend (loop mulus)
// icev2: batu hero berdiri di salju, gak jatuh dari langit (0 = matiin jatuhnya)
const HERO_DROP = 0
const easeDrop = (x) => 1 + 1.9 * Math.pow(x - 1, 3) + 0.9 * Math.pow(x - 1, 2)
const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
function HeroDrop({ children }) {
  const ref = useRef()
  useFrame(() => {
    if (!ref.current) return
    const S = introState
    let e
    if (S.phase === 'wait') e = 0
    else {
      // 'fall' (intro emerge) & 'idle' (loop) sama-sama dikendalikan bridge.
      // b=0 (descend/mendarat) → e=1. b naik → keangkat (di balik biru),
      // b>0.45 → jatuh lagi sampai mendarat di b~0.95
      const b = scrollState.bridge
      if (b <= 0) e = 1
      else if (b < 0.45) e = 1 - smoothstep(0, 0.45, b) // keangkat (di balik biru)
      else e = easeDrop(THREE.MathUtils.clamp((b - 0.45) / 0.5, 0, 1)) // jatuh
    }
    ref.current.position.y = (1 - e) * HERO_DROP
  })
  return <group ref={ref}>{children}</group>
}

// batu ASAL yang muncul dari BAWAH podium pas loop (permintaan Nehemiah): pas
// scroll turun dari panggung, di bawah tempat kita berdiri, batu pertama naik,
// kamera nyelam ke situ, lalu (ketutup wash) muncul balik di hero atas. Pakai
// geometri hero yang sama, material lebih murah (tanpa transmission pass ekstra)
// skala dasar echo, ice_gen.glb dimensi ~1 unit, dinaikin biar sebesar batu hero
const ECHO_S = 3.5
function HeroEcho() {
  // pakai ice_gen.glb (model es detail hasil generate Nehemiah), di-clone &
  // center biar poros-nya pas di tengah grup. Cuma dirender pas bridge (hemat)
  const { scene } = useGLTF('/models/ice_gen.glb')
  const geo = useMemo(() => {
    let src = null
    scene.traverse((o) => {
      if (!src && o.isMesh) src = o
    })
    if (!src) return null
    const g = src.geometry.clone()
    // WAJIB pakai matrixWorld node-nya, jangan geometry mentah: GLB-nya
    // dikompresi meshopt + KHR_mesh_quantization, yang naruh POSITION di
    // rentang integer dan naruh skala kompensasinya di transform node. Ambil
    // geometry doang = batunya ke-render ribuan kali kegedean.
    src.updateWorldMatrix(true, false)
    g.applyMatrix4(src.matrixWorld)
    g.center()
    return g
  }, [scene])
  const grp = useRef()
  const mat = useRef()
  useFrame((state) => {
    if (!grp.current) return
    const b = scrollState.bridge
    const vis = b > 0.001 && b < 0.68
    grp.current.visible = vis
    if (!vis) return
    // naik dari bawah frame (-50) ke dasar podium selama dive, di z lebih deket
    // kamera (5.5) biar gak keblok dais podium yg solid, jadi batu keliatan
    // "muncul dari bawah tempat berdiri" pas kamera nyelam ke arahnya
    const rise = smoothstep(0, 0.5, b)
    grp.current.position.y = -48 + rise * 7
    grp.current.rotation.y = state.clock.elapsedTime * 0.18
    // membesar "menelan" layar, jadi ISI utama biru (bukan biru kosong): batu
    // gede berputar nembus wash tembus, baru pudar pas seam teleport lewat
    const grow = 1 + smoothstep(0.26, 0.58, b) * 2.2
    grp.current.scale.setScalar(ECHO_S * grow)
    // muncul cepat, tetep keliatan nembus wash yg tembus, pudar setelah seam 0.55
    const o = smoothstep(0.02, 0.16, b) * (1 - smoothstep(0.58, 0.67, b))
    if (mat.current) mat.current.opacity = o
  })
  return (
    <group ref={grp} position={[0, -48, 5.5]} scale={ECHO_S} visible={false}>
      <mesh geometry={geo}>
        {/* biru gletser PEKAT, sengaja gelap biar kontras nongol di depan
            podium/kabut yg terang pas dive (bukan pucat yg nyaru) */}
        <meshStandardMaterial
          ref={mat}
          color="#7ba3c4"
          roughness={0.4}
          metalness={0}
          emissive="#3d6d95"
          emissiveIntensity={0.55}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

// podium = CLUSTER KRISTAL NATURAL (dimodel di Blender: mound es lumpy +
// belasan kristal prisma variatif, ukuran, ketebalan, tilt, arah beda-beda,
// sengaja GAK simetris/sejajar & gak jarum tajem, permintaan Nehemiah). Wajah
// partikel Nehemiah melayang di atas cluster ini.
function OutroStage() {
  const { nodes } = useGLTF('/models/podium.glb')
  const geo = useMemo(() => Object.values(nodes).find((n) => n.isMesh)?.geometry, [nodes])
  return (
    <group position={[0, -44.35, 1.5]}>
      <mesh geometry={geo}>
        {/* es padat biru, flat shading biar tiap facet kristal kebaca. Tetep
            berkilau (permintaan Nehemiah: "stand tajem dibikin lebih shining"),
            tapi kilaunya dari pantulan env (metalness + roughness rendah), bukan
            dari warna dasar & emissive yang tinggi: desktop gak pakai tone
            mapping, jadi dulu semua facet yang ngadep atas kepotong putih rata
            pas kamera nyelam dari atas */}
        <meshStandardMaterial
          color="#8fadc4"
          roughness={0.14}
          metalness={0.28}
          emissive="#5f8fb8"
          emissiveIntensity={0.2}
          flatShading
        />
      </mesh>
      {/* shell tipis lebih terang = rim subsurface, kesan cahaya nembus es */}
      <mesh geometry={geo} scale={1.014}>
        <meshBasicMaterial color="#f0f9ff" transparent opacity={0.08} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* dua ring cahaya melingkar di lantai dais, lebih terang & double biar
          panggungnya kerasa "shining" ala referensi */}
      <mesh position={[0, 0.4, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[2.9, 3.14, 96]} />
        <meshBasicMaterial color="#eaf6ff" toneMapped={false} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.34, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[3.5, 3.62, 96]} />
        <meshBasicMaterial color="#cfe8fb" toneMapped={false} transparent opacity={0.22} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// aura bercahaya di belakang wajah partikel, bikin bagian outro kerasa "kamar
// es bercahaya" yang beda vibes dari kabut gelap perjalanan turun (permintaan
// Nehemiah, referensi igloo ss#4: partikel nyala di tengah lingkaran cahaya).
// Fade in cuma pas udah mendarat (damped ~1) & padam pas mulai bridge/loop.
function FaceAura() {
  const glow = useRef()
  const ring1 = useRef()
  const ring2 = useRef()
  const light = useRef()
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    grad.addColorStop(0, 'rgba(236,247,255,0.95)')
    grad.addColorStop(0.3, 'rgba(196,226,250,0.5)')
    grad.addColorStop(0.6, 'rgba(150,190,228,0.18)')
    grad.addColorStop(1, 'rgba(150,190,228,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  useFrame((state) => {
    // aura nyala NGIKUT wajah jadi (faceState.assemble, ditulis ParticleFace),
    // bukan ngikut scroll: selama salju masih terbang latarnya biru dalam, jadi
    // partikel es terangnya kebaca. Pas partikel mendarat & jadi warna foto,
    // kamarnya ikut terang di belakang, wajahnya "muncul" kayak foto dicuci
    const asm = faceState.assemble ?? 0
    const fade = 1 - smoothstep(0, 0.12, scrollState.bridge)
    const a = smoothstep(0.15, 0.9, asm) * (faceState.develop ?? 0) * fade
    // cincin cuma pas kamera udah natap wajah dari depan: selama kamera masih
    // ngayun turun, cincin segede ini lewat di layar jadi garis lengkung acak
    const ringA = a * smoothstep(0.975, 0.997, scrollState.damped) * smoothstep(0.5, 1, asm)
    const t = state.clock.elapsedTime
    // pas ECHO (chatbot) lagi ngetik & kita di section wajah: aura "denyut" lebih
    // terang, kesannya muka partikel lagi ngomong (avatar chatbot hidup)
    const talk = chatState.streaming ? 1 + 0.28 * (0.5 + 0.5 * Math.sin(t * 7)) : 1
    if (glow.current) glow.current.material.opacity = (LOW ? 0.62 : 0.85) * a * talk
    // dua cincin tipis pelan berputar = kesan spiral cahaya di ss#4
    if (ring1.current) {
      ring1.current.material.opacity = 0.3 * ringA * talk
      ring1.current.rotation.z = t * 0.05
    }
    if (ring2.current) {
      ring2.current.material.opacity = 0.18 * ringA * talk
      ring2.current.rotation.z = -t * 0.035
    }
    if (light.current) light.current.intensity = 3.4 * a * talk
  })
  return (
    <group position={[0, -41.2, -3.5]}>
      {/* halo utama di belakang badan. Diperkecil (dulu 26) biar terangnya
          ngumpul di figurnya, latar sekitarnya tetep gelap. Di HP layarnya
          sempit, halo 17 nutup selebar layar jadi semua terang: dikecilin lagi */}
      <mesh ref={glow}>
        <planeGeometry args={LOW ? [10, 10] : [17, 17]} />
        <meshBasicMaterial map={tex} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      {/* cincin cahaya konsentris tipis */}
      <mesh ref={ring1} position={[0, 0, 0.6]}>
        <ringGeometry args={[5.4, 5.5, 120]} />
        <meshBasicMaterial color="#dcefff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2} position={[0, 0, 0.6]}>
        <ringGeometry args={[7.6, 7.72, 120]} />
        <meshBasicMaterial color="#c6e2fb" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* backlight lembut biar kristal stand & wajah ikut berkilau dari belakang */}
      <pointLight ref={light} color="#dcefff" intensity={0} distance={20} decay={2} position={[0, 0.5, 2]} />
    </group>
  )
}

// kolom cahaya vertikal samar (fake god-rays), ngisi kekosongan kabut
function LightShafts() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 256
    const g = c.getContext('2d')
    let grad = g.createLinearGradient(0, 0, 64, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.6)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 256)
    // fade juga di ujung atas/bawah biar gak keliatan potongan plane
    g.globalCompositeOperation = 'destination-in'
    grad = g.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(0.25, 'rgba(0,0,0,1)')
    grad.addColorStop(0.75, 'rgba(0,0,0,1)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  const shafts = [
    { pos: [-6.5, -5, -7], rot: 0.16, w: 2.6 },
    { pos: [5.5, -15, -9], rot: -0.12, w: 3.6 },
    { pos: [-4.5, -26, -8], rot: 0.1, w: 2.2 },
    { pos: [2.5, -33.5, -6], rot: -0.08, w: 3.2 },
  ]
  // shaft tingginya 36 jadi nyampe area hero, sembunyiin di atas biar nama bersih
  const mats = useRef([])
  useFrame(() => {
    const vis = heroFade()
    mats.current.forEach((m) => { if (m) m.opacity = 0.14 * vis })
  })
  return shafts.map((s, i) => (
    <mesh key={i} position={s.pos} rotation={[0, 0, s.rot]}>
      <planeGeometry args={[s.w, 36]} />
      <meshBasicMaterial ref={(el) => (mats.current[i] = el)} map={tex} transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  ))
}

// selama rentang ini di sekitar tiap KRISTAL, kamera berhenti sebentar aja.
// hold-nya per-anchor: anchor sequence portal pakai hold 0, dulu hold rata
// 0.03 bikin segmen sempit (0.8 - 0.86) kehabisan jendela gerak, kamera
// "jebret" lompat sekali frame di 82-83/100
const HOLD = 0.03

function CameraRig() {
  const camera = useThree((s) => s.camera)
  const parallax = useMemo(() => ({ v: 1 }), [])
  // target pandang frame lalu, jadi titik awal animasi nyelam ke batu
  const fv = useMemo(() => ({ look: new THREE.Vector3() }), [])
  const [p, t, anchors] = useMemo(() => {
    const v = (x, y, z) => new THREE.Vector3(x, y, z)
    // posisi kamera per anchor = tepat di depan kristalnya (offset +z)
    const front = (c, dz) => v(c[0], c[1] + 0.4, c[2] + dz)
    return [
      new THREE.Vector3(),
      new THREE.Vector3(),
      [
        // icev2: kamera hero sedikit lebih rendah, natap batu hero yang mundur ke z -3
        { t: 0, pos: v(0, 1.5, 11), look: v(0, 0.55, -3), hold: 0 },
        // anchor ngikut daftar CRYSTALS, nambah batu tinggal nambah di content.js
        ...CRYSTALS.map((c, i) => ({
          t: (i + 1) / (CRYSTALS.length + 1),
          pos: front(c.position, 7.5),
          look: v(...c.position),
          hold: HOLD,
        })),
        // koreografi portal, tiga ketukan:
        //  1. dari SKILLS kamera MUNDUR naik sambil nunduk (crane), portal yang
        //     udah jadi keliatan kecil jauh di bawah, lalu geser ke atasnya dan
        //     berhenti natap lurus ke bawah nembus lubang ring (titik snap 0.915,
        //     kristal & kamar wajah keliatan kecil jauh di bawah)
        //  2. NYELAM LURUS turun nembus TENGAH ring, kilatan cahaya dari
        //     PortalFlash (Portal.jsx) pas kamera lewat bidang ring
        //  3. sambil turun kamera mundur & ndongak ke depan, salju partikel
        //     ngalir dari portal dan mendarat jadi wajah
        // Sepanjang bagian yang hampir tegak lurus, titik tatap SELALU sedikit di
        // belakang kamera (look.z < pos.z). Dulu z-nya nyebrang (1.6 lawan 1.5
        // lalu 1.4 lawan 1.5), lookAt ketemu arah tegak lurus persis dan layar
        // muter 180 derajat sekali frame di tengah nyelam
        // rest = titik istirahat (snap), spline = ikut jalur halus portalPath
        // Portal di y -32.8, lubang bersihnya radius 1.52 (segmen dalam mulai
        // di situ): anchor 0.942 = kamera pas di bidang ring, 0.8 dari sumbu
        { t: 0.868, pos: v(0.8, -22.8, 11.8), look: v(0, -33.4, 1.0), hold: 0, spline: true },
        { t: 0.915, pos: v(1.2, -23.2, 2.7), look: v(0, -44, 0.6), hold: 0.012, spline: true, rest: true },
        { t: 0.942, pos: v(0, -32.8, 2.3), look: v(0, -45, 0.2), hold: 0, spline: true },
        { t: 0.962, pos: v(0, -37.2, 4.6), look: v(0, -43.4, 0.2), hold: 0, spline: true },
        { t: 0.982, pos: v(0, -39.9, 8.8), look: v(0, -41.4, 1.0), hold: 0, spline: true },
        { t: 1, pos: v(0, -40.7, 11.5), look: v(0, -40.8, 1.5), hold: 0, spline: true, rest: true },
      ],
    ]
  }, [])

  // ===== jalur kamera portal: spline, bukan patah-patah per anchor =====
  // Interpolasi per segmen di bawah (smoothstep tiap pasang anchor) bikin
  // kamera BERHENTI di tiap anchor. Buat batu itu pas (tiap batu memang titik
  // istirahat), tapi di koreografi portal jadinya denyut maju-berhenti-maju
  // 4 kali dalam sekali snap. Di sini anchor portal dilewatin pakai spline
  // Catmull-Rom non-uniform (waktu = t anchor), kecepatannya nyambung, dan
  // easing-nya cuma satu per rentang: dari batu terakhir ke titik istirahat
  // 0.915, lalu dari situ ke wajah
  const portalPath = useMemo(() => {
    const first = anchors.findIndex((x) => x.spline)
    const spans = []
    let s0 = first - 1
    for (let j = first; j < anchors.length; j++) {
      if (anchors[j].rest) {
        spans.push([s0, j])
        s0 = j
      }
    }
    const g0 = new THREE.Vector3()
    const g3 = new THREE.Vector3()
    const A = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    const B = [new THREE.Vector3(), new THREE.Vector3()]
    // Barry-Goldman: titik di antara P1 & P2 pada waktu x, knot t0 < t1 < t2 < t3
    const cr = (out, P0, P1, P2, P3, t0, t1, t2, t3, x) => {
      A[0].copy(P0).multiplyScalar((t1 - x) / (t1 - t0)).addScaledVector(P1, (x - t0) / (t1 - t0))
      A[1].copy(P1).multiplyScalar((t2 - x) / (t2 - t1)).addScaledVector(P2, (x - t1) / (t2 - t1))
      A[2].copy(P2).multiplyScalar((t3 - x) / (t3 - t2)).addScaledVector(P3, (x - t2) / (t3 - t2))
      B[0].copy(A[0]).multiplyScalar((t2 - x) / (t2 - t0)).addScaledVector(A[1], (x - t0) / (t2 - t0))
      B[1].copy(A[1]).multiplyScalar((t3 - x) / (t3 - t1)).addScaledVector(A[2], (x - t1) / (t3 - t1))
      return out.copy(B[0]).multiplyScalar((t2 - x) / (t2 - t1)).addScaledVector(B[1], (x - t1) / (t2 - t1))
    }
    const along = (out, key, s0, s1, j, x) => {
      const a1 = anchors[j]
      const a2 = anchors[j + 1]
      // ujung rentang: titik bayangan dicerminin biar arah geraknya tetep masuk akal
      const a0 = j > s0 ? anchors[j - 1] : null
      const a3 = j + 1 < s1 ? anchors[j + 2] : null
      const P0 = a0 ? a0[key] : g0.copy(a1[key]).multiplyScalar(2).sub(a2[key])
      const P3 = a3 ? a3[key] : g3.copy(a2[key]).multiplyScalar(2).sub(a1[key])
      const t0 = a0 ? a0.t : 2 * a1.t - a2.t
      const t3 = a3 ? a3.t : 2 * a2.t - a1.t
      return cr(out, P0, a1[key], a2[key], P3, t0, a1.t, a2.t, t3, x)
    }
    return {
      from: anchors[first - 1].t,
      eval(k, pos, look) {
        let s = spans.find(([, b]) => k <= anchors[b].t) || spans[spans.length - 1]
        const [s0, s1] = s
        const lo = anchors[s0].t + anchors[s0].hold
        const hi = anchors[s1].t - anchors[s1].hold
        let u = THREE.MathUtils.clamp((k - lo) / Math.max(1e-4, hi - lo), 0, 1)
        u = u * u * (3 - 2 * u)
        const x = anchors[s0].t + u * (anchors[s1].t - anchors[s0].t)
        let j = s0
        while (j < s1 - 1 && x > anchors[j + 1].t) j++
        along(pos, 'pos', s0, s1, j, x)
        along(look, 'look', s0, s1, j, x)
      },
    }
  }, [anchors])

  useFrame((state, delta) => {
    // damped di-smoothing di App (master loop), di sini tinggal baca
    const k = THREE.MathUtils.clamp(scrollState.damped, 0, 1)

    if (k > portalPath.from) {
      portalPath.eval(k, p, t)
    } else {
      // cari segmen anchor aktif, lalu interpolasi dengan plateau per-anchor
      let i = 0
      while (i < anchors.length - 2 && k > anchors[i + 1].t) i++
      const a = anchors[i]
      const b = anchors[i + 1]
      const start = a.t + a.hold
      const end = b.t - b.hold
      let u = THREE.MathUtils.clamp((k - start) / Math.max(1e-4, end - start), 0, 1)
      u = u * u * (3 - 2 * u)
      p.lerpVectors(a.pos, b.pos, u)
      t.lerpVectors(a.look, b.look, u)
    }

    // ---- jembatan loop (100→120): animasi MENYELAM, bukan fade. Dari panggung,
    //      kamera turun ke bawah podium natap batu asal yg naik dari bawah
    //      (HeroEcho). Di tengah bridge tirai wash nutup sekejap buat nyamarin
    //      lompatan balik ke hero atas; pas bridge kelar (==awal descend) kamera
    //      udah di hero → loop nyambung mulus ----
    const br = scrollState.bridge
    if (br > 0) {
      const L = THREE.MathUtils.lerp
      const hero = anchors[0]
      const podium = anchors[anchors.length - 1]
      if (br <= 0.55) {
        // MENYELAM: view panggung → turun & natap batu asal yg naik di depan podium
        let d = THREE.MathUtils.clamp(br / 0.55, 0, 1)
        d = d * d * (3 - 2 * d)
        p.set(L(podium.pos.x, 0, d), L(podium.pos.y, -42.8, d), L(podium.pos.z, 9.5, d))
        t.set(L(podium.look.x, 0, d), L(podium.look.y, -46, d), L(podium.look.z, 5, d))
      } else {
        // MUNCUL (awalnya ketutup wash): emerge di hero, settle naik halus
        let e = THREE.MathUtils.clamp((br - 0.55) / 0.45, 0, 1)
        e = e * e * (3 - 2 * e)
        p.set(hero.pos.x, L(hero.pos.y - 2.4, hero.pos.y, e), L(hero.pos.z + 1.6, hero.pos.z, e))
        t.set(hero.look.x, hero.look.y, hero.look.z)
      }
    }

    // ---- MENYELAM ke batu pas diklik: ancang-ancang mundur, nyelam lurus, batu
    //      berubah jadi jendela video, video nutup layar, baru panel DOM. Semua
    //      koreografinya di Dive.jsx (stepDive). Selama nyelam kamera dikunci ke
    //      jalurnya, tanpa parallax pointer ----
    const F = focusState
    const locked = F.phase !== 'idle' && stepDive(performance.now(), camera.position, fv.look, p, t)

    // parallax pointer dimatiin halus selama hero di-drag / lagi nyelam ke batu
    easing.damp(parallax, 'v', dragState.active || F.phase !== 'idle' ? 0 : 1, 0.2, delta)
    if (locked) camera.position.copy(p)
    else camera.position.set(p.x + state.pointer.x * 0.5 * parallax.v, p.y + state.pointer.y * 0.3 * parallax.v, p.z)
    camera.lookAt(t)
    fv.look.copy(t)
  })
  return null
}

useGLTF.preload('/models/podium.glb')
// ice_gen.glb SENGAJA gak di-preload: cuma nongol pas transisi bridge, jauh
// setelah frame pertama. Biar gak ikut rebutan bandwidth pas initial load.
