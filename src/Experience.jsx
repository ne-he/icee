import * as THREE from 'three'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, useGLTF, useProgress } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { easing } from 'maath'
import { Crystal, HoverLight, IceBuffer } from './Crystal'
import { DiveFill, stepDive } from './Dive'
import { TransitionEffect } from './fx/TransitionEffect'
import { SnowFx } from './fx/SnowFx'
import { bridgeCamera } from './fx/bridgePath'
import { B_GATE } from './fx/fxState'
import { ParticleFace } from './ParticleFace'
import { FACE_Y, PORTAL_POS, Portal, arcRing, brickRing, glowByHeight, portalIce, rimArcs } from './Portal'
import { World, WorldFog, WorldLights, worldState } from './world/World'
import { Beyond } from './world/Beyond'
import { TUNE } from './world/tune'
import { iceWallTexture, snowDetailTexture } from './world/materials'
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

      {/* batu hero berdiri di ujung retakan, gak jatuh lagi (dulu HeroDrop).
          Intro & ujung loop sekarang badai putih yang reda (src/fx) */}
      <Crystal data={HERO_CRYSTAL} interactive={false} snapT={0} />
      {CRYSTALS.map((c, i) => (
        // snapT = titik scroll pas kamera nge-frame batu ini (sinkron sama
        // anchor di CameraRig), jadi tiap batu bisa diputer pas dia yang keliatan
        <Crystal key={c.id} data={c} onOpen={onOpen} snapT={(i + 1) / (CRYSTALS.length + 1)} />
      ))}

      {/* icev2: dataran salju + celah gletser (gantiin dinding, bongkahan latar
          & pecahan melayang v1) */}
      <World />

      {/* portal es ala igloo, kamera nembus lubangnya sebelum nyampe outro.
          Sekarang prosedural (gak ada GLB), jadi ke-mount bareng scene dan
          pointLight-nya udah ada pas Warmup. Jangan dibungkus Suspense: kalau
          portal nongol setelah Warmup, jumlah lampu berubah dan semua material
          yang kena cahaya dikompilasi ulang pas lagi scroll */}
      <Portal />
      {/* dunia partikel di balik gerbang: debu es naik ke arah portal */}
      <Beyond />

      {/* outro: partikel wajah Nehemiah di atas panggung podium ala igloo.
          Revisi 2 Okt sore: kamar wajah diturunin jauh (FACE_Y, ~19 unit di
          bawah gerbang) biar abis masuk portal masih turun panjang dulu, baru
          kristal nongol (permintaan Nehemiah) */}
      {/* aura terang di belakang wajah = vibe BEDA pas bagian partikel: bukan
          kabut gelap, tapi kamar es bercahaya (permintaan Nehemiah, ala ss#4) */}
      <FaceAura />
      {/* potongan bawah fotonya jatuh di bawah tepi layar, gak kebaca "kaki
          kepotong di tengah" (pose kamera di FACE_Y + 0.75) */}
      <ParticleFace position={[0, FACE_Y, 1.5]} />
      <OutroStage />

      {/* icev2: debu es & kolom cahaya v1 (Sparkles, LightShafts) diganti isi
          gua di world/Cave.jsx (dipasang lewat <World />): debu turun dari
          retakan tiga lapis jarak, kolom cahaya siang dari bukaan retakan */}

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
      {/* salju 3D yang kesapu lewat pas nyemplung, naik di gua, dan badai */}
      <SnowFx />

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
    // tekstur detail dunia (salju, dinding es) itu uniform shader, bukan m.map,
    // jadi gak kejaring traverse di atas: upload manual. Download-nya udah
    // mulai dari preload di bawah file ini, dan Warmup cuma jalan kalau
    // useProgress udah diem, jadi gambarnya pasti udah ada di sini
    gl.initTexture(snowDetailTexture())
    gl.initTexture(iceWallTexture())
    warmHooks.forEach((h) => h(gl))
    Promise.all(jobs)
      .catch(() => {})
      .then(() => {
        warmState.done = true
        // dibaca tools/verify/perf.py: kapan tirai boleh kebuka
        warmState.at = performance.now()
        if (window.__ice) window.__ice.warm = warmState
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
    // loop: bertahan sampai kamera naik nembus gerbang portal (B_GATE)
    const gateOut = 1 - smoothstep(B_GATE - 0.06, B_GATE + 0.04, scrollState.bridge)
    const dark = smoothstep(0.945, 0.965, scrollState.damped) * (1 - (faceState.develop ?? 0)) * gateOut
    o += (0.9 - o) * dark
    // Revisi 27 Sep: dari SKILLS sampai wajah latarnya TETEP biru tua gelap
    // (dulu balik terang pas wajah jadi). Terangnya cuma di aura belakang wajah
    const deep = smoothstep(0.81, 0.88, scrollState.damped) * gateOut
    o += (0.82 - o) * deep * (1 - dark)
    // di balik gerbang portal dinding gua udah gak ada: latar ini jadi ruang
    // kosong penuh (tanpa sisa langit gua yang tembus)
    o += (0.97 - o) * worldState.beyondK
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
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    if (window.__ice) {
      window.__ice.gl = gl
      window.__ice.camera = camera
    }
  }, [gl, camera])
  return null
}

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// efek transisi desktop (CA + frost + glitch), dibikin sekali. Angkanya
// dihitung sendiri tiap frame di TransitionEffect.update (src/fx/fxState.js).
// Batu hero jatuh (HeroDrop) & batu echo yang naik dari bawah podium (HeroEcho)
// dari v1 udah dibuang: jembatan loop sekarang naik nembus gua ke badai putih
function TransitionFx() {
  const effect = useMemo(() => new TransitionEffect(), [])
  useEffect(() => () => effect.dispose(), [effect])
  return <primitive object={effect} dispose={null} />
}

// podium = CLUSTER KRISTAL NATURAL (dimodel di Blender: mound es lumpy +
// belasan kristal prisma variatif, ukuran, ketebalan, tilt, arah beda-beda,
// sengaja GAK simetris/sejajar & gak jarum tajem, permintaan Nehemiah). Wajah
// partikel Nehemiah melayang di atas cluster ini.
function OutroStage() {
  const { nodes } = useGLTF('/models/podium.glb')
  const geo = useMemo(() => {
    const g = Object.values(nodes).find((n) => n.isMesh)?.geometry
    return g ? glowByHeight(g.clone()) : null
  }, [nodes])
  // revisi 2 Okt: dulu biru pucat polos flat shading, dari atas (pas nyelam
  // lewat portal) kebaca "bahan belum jadi". Sekarang es yang sama kayak
  // portal: tekstur dinding es, bercak buram vs bening, ujung kristal nyala
  const u = useMemo(() => ({ uBump: { value: 0.5 }, uGlow: { value: 0.7 }, uGlowCol: { value: new THREE.Color('#bfe6ff').multiplyScalar(1.4) } }), [])
  const mat = useMemo(() => portalIce(u, { color: '#8fa6b9', roughness: 0.3, metalness: 0.14, envMapIntensity: 0.8, flatShading: true }), [u])
  const ring1 = useRef()
  const ring2 = useRef()
  const stage = useRef()
  useFrame((state) => {
    // cuma digambar di balik gerbang portal: dari atas gerbang kristalnya gak
    // boleh udah keliatan ("duri2nya udah keliatan sebelum masuk", 2 Okt)
    if (stage.current) stage.current.visible = worldState.beyond === 1 || !warmState.done
    // cincin lantai cuma pas kamera udah di depan wajah. Dari atas (pas
    // nyelam) dia kebaca lingkaran abu tebel kayak papan target
    const k = smoothstep(0.972, 0.995, scrollState.damped) * (1 - smoothstep(0, 0.1, scrollState.bridge))
    if (ring1.current) ring1.current.material.opacity = 0.5 * k
    if (ring2.current) ring2.current.material.opacity = 0.22 * k
    u.uGlow.value = 0.55 + 0.15 * Math.sin(state.clock.elapsedTime * 1.1)
  })
  return (
    <group ref={stage} position={[0, FACE_Y - 2.9, 1.5]}>
      <mesh geometry={geo} material={mat} />
      {/* shell tipis lebih terang = rim subsurface, kesan cahaya nembus es */}
      <mesh geometry={geo} scale={1.014}>
        <meshBasicMaterial color="#f0f9ff" transparent opacity={0.06} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* dua ring cahaya melingkar di lantai dais, lebih terang & double biar
          panggungnya kerasa "shining" ala referensi */}
      <mesh ref={ring1} position={[0, 0.4, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[2.9, 3.14, 96]} />
        <meshBasicMaterial color="#eaf6ff" toneMapped={false} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2} position={[0, 0.34, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[3.5, 3.62, 96]} />
        <meshBasicMaterial color="#cfe8fb" toneMapped={false} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// aura bercahaya di belakang wajah partikel, bikin bagian outro kerasa "kamar
// es bercahaya" yang beda vibes dari kabut gelap perjalanan turun (permintaan
// Nehemiah, referensi igloo ss#4: partikel nyala di tengah lingkaran cahaya).
// Fade in cuma pas udah mendarat (damped ~1) & padam pas mulai bridge/loop.
//
// Revisi 2 Okt sore ("drpd bulet2 putih, mending dibikin kek buletan
// portalnya, yg ada balok2 keren itu"): dua cincin garis putih tipis diganti
// GERBANG BALOK ES tegak di belakang badan, bahasa yang sama kayak gerbang
// portal (material & nyala sisi dalam), plus cincin pecahan es yang muter
// pelan di belakangnya. Kesannya Nehemiah berdiri di depan portal dunia ini.
// Gerbangnya cuma digambar di balik gerbang portal (worldState.beyond)
const FACE_GATE = { rIn: 3.7, rOut: 4.8 }
const FACE_ARCS = [5.25, 5.6, 0.36, 0, [[10, 62], [80, 34], [122, 76], [206, 48], [262, 70], [340, 14]]]
function FaceAura() {
  const glow = useRef()
  const gate = useRef()
  const spin = useRef()
  const arcs = useRef()
  const rim = useRef()
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
  const geos = useMemo(
    () => ({
      bricks: brickRing({ n: 26, rIn: FACE_GATE.rIn, rOut: FACE_GATE.rOut, h0: 0.95, seed: 4411 }),
      arcs: arcRing(FACE_ARCS, 0.1, 0.12),
      arcRim: rimArcs(FACE_ARCS),
    }),
    []
  )
  // set uniform sendiri: nyalanya ngikut wajah jadi, bukan ngikut gerbang portal
  const u = useMemo(() => ({ uBump: { value: 0.55 }, uGlow: { value: 0 }, uGlowCol: { value: new THREE.Color('#bfe6ff').multiplyScalar(1.6) } }), [])
  const mat = useMemo(() => portalIce(u), [u])
  useFrame((state, delta) => {
    // aura nyala NGIKUT wajah jadi (faceState.assemble, ditulis ParticleFace),
    // bukan ngikut scroll: selama salju masih terbang latarnya biru dalam, jadi
    // partikel es terangnya kebaca. Pas partikel mendarat & jadi warna foto,
    // kamarnya ikut terang di belakang, wajahnya "muncul" kayak foto dicuci
    const asm = faceState.assemble ?? 0
    const fade = 1 - smoothstep(0, 0.12, scrollState.bridge)
    const a = smoothstep(0.15, 0.9, asm) * (faceState.develop ?? 0) * fade
    const t = state.clock.elapsedTime
    // pas ECHO (chatbot) lagi ngetik & kita di section wajah: aura "denyut" lebih
    // terang, kesannya muka partikel lagi ngomong (avatar chatbot hidup)
    const talk = chatState.streaming ? 1 + 0.28 * (0.5 + 0.5 * Math.sin(t * 7)) : 1
    if (glow.current) glow.current.material.opacity = (LOW ? 0.62 : 0.85) * a * talk
    if (gate.current) gate.current.visible = worldState.beyond === 1 || !warmState.done
    // gerbang muter pelan kayak roda, cincin pecahan di belakangnya lawan arah
    if (spin.current) spin.current.rotation.z += delta * 0.025
    if (arcs.current) arcs.current.rotation.z -= delta * 0.05
    // sisi dalam gerbang nyala bareng wajahnya jadi (cahaya dunia di baliknya)
    u.uGlow.value = 0.15 + 0.85 * a * talk
    if (rim.current) rim.current.material.opacity = 0.7 * a * talk
    if (light.current) light.current.intensity = 3.4 * a * talk
  })
  return (
    <group position={[0, FACE_Y + 0.25, -3.5]}>
      {/* halo utama di belakang badan. Diperkecil (dulu 26) biar terangnya
          ngumpul di figurnya, latar sekitarnya tetep gelap. Di HP layarnya
          sempit, halo 17 nutup selebar layar jadi semua terang: dikecilin lagi */}
      <mesh ref={glow}>
        <planeGeometry args={LOW ? [10, 10] : [17, 17]} />
        <meshBasicMaterial map={tex} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      <group ref={gate}>
        {/* cincin dibikin rebah (sumbu Y) di Portal.jsx, di sini ditegakin
            biar ngadep kamera */}
        <group ref={spin}>
          <mesh geometry={geos.bricks} material={mat} rotation-x={Math.PI / 2} />
          <mesh ref={rim} rotation-x={0}>
            <torusGeometry args={[FACE_GATE.rIn - 0.08, 0.04, 6, 160]} />
            <meshBasicMaterial color={new THREE.Color('#eaf7ff').multiplyScalar(2)} transparent opacity={0} depthWrite={false} fog={false} toneMapped={false} />
          </mesh>
        </group>
        <group ref={arcs} position={[0, 0, -0.9]}>
          <mesh geometry={geos.arcs} material={mat} rotation-x={Math.PI / 2} />
          <mesh geometry={geos.arcRim} rotation-x={Math.PI / 2}>
            <meshBasicMaterial color={new THREE.Color('#dff3ff').multiplyScalar(1.5)} transparent opacity={0.35} depthWrite={false} fog={false} toneMapped={false} />
          </mesh>
        </group>
      </group>
      {/* backlight lembut biar kristal stand & wajah ikut berkilau dari belakang */}
      <pointLight ref={light} color="#dcefff" intensity={0} distance={20} decay={2} position={[0, 0.5, 2]} />
    </group>
  )
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
    const GY = PORTAL_POS[1]
    const FY = FACE_Y
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
        // Revisi 2 Okt sore: gerbang di PORTAL_POS (y -36.8, lubang r 3.6),
        // wajah di FACE_Y (-56). Abis nembus gerbang kamera NYELAM LURUS ~13
        // unit di sumbu, lewat dua cincin terowongan (-5.5 & -11 di bawah
        // gerbang, r dalam 3.4 & 3.6, kamera maksimal ~2.2 dari sumbu), baru
        // kristal podium kebaca dari atas, lalu ngayun ke depan wajah
        { t: 0.868, pos: v(0.8, -22.8, 11.8), look: v(0, GY - 0.6, 1.0), hold: 0, spline: true },
        { t: 0.915, pos: v(1.2, -23.2, 2.7), look: v(0, GY - 15, 0.6), hold: 0.012, spline: true, rest: true },
        { t: 0.942, pos: v(0, GY, 2.2), look: v(0, GY - 23, 0.2), hold: 0, spline: true },
        { t: 0.955, pos: v(0, GY - 7.2, 2.4), look: v(0, GY - 27, 0.4), hold: 0, spline: true },
        { t: 0.968, pos: v(0, FY + 5.5, 4.4), look: v(0, FY - 4, 0.6), hold: 0, spline: true },
        { t: 0.984, pos: v(0, FY + 1.4, 8.8), look: v(0, FY, 1.0), hold: 0, spline: true },
        { t: 1, pos: v(0, FY + 0.75, 11.5), look: v(0, FY + 0.65, 1.5), hold: 0, spline: true, rest: true },
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

    // ---- jembatan loop (100→120): dari kamar wajah kamera naik nembus gua ke
    //      cahaya retakan, badai putih nutup, pindah ke atas dataran, badainya
    //      reda sambil kamera turun ke pose hero. Jalurnya di src/fx/bridgePath.js,
    //      ujung-ujungnya persis anchor wajah & hero (loop nyambung dua arah) ----
    const br = scrollState.bridge
    if (br > 0) bridgeCamera(br, p, t, anchors[0], anchors[anchors.length - 1])

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
// tekstur detail dunia: dulu tekstur salju baru mulai di-download pas shader
// salju pertama kali dikompilasi (di onBeforeCompile), kelarnya mepet batas
// 4,5 detik loader (diukur 4,9 detik). Sekarang mulai bareng GLB di atas,
// lewat TextureLoader default jadi ikut kehitung useProgress & ditunggu Warmup
snowDetailTexture()
iceWallTexture()
