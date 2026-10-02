import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { gsap } from 'gsap'
import Experience from './Experience'
import { UI, Loader } from './UI'
import ChatDock from './chat/ChatDock'
import TargetCursor from './components/TargetCursor/TargetCursor'
import { GLACIER_VIDEO, LOW, SCENE_VIDEO } from './perf' // eslint-disable-line no-unused-vars
import { quality } from './quality'
import { TUNE } from './world/tune'
import { onCanvasCreated } from './glRuntime'
import { scrollSettled } from './scrollSettle'
import { DIVE, panelVideo, reducedMotion, startPanelVideo } from './Dive'
import { beginFocus, bgVideoState, chatState, dragState, endFocus, faceState, focusState, introState, scrollState } from './scrollState'
import { B_GATE, B_INTRO, INTRO_MS } from './fx/fxState'
import { FxOverlay, stepFxDom } from './fx/FxOverlay'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

const smooth = (x) => x * x * (3 - 2 * x)

// loop di-bagi: 0..DESCEND = perjalanan turun (hero→partikel), DESCEND..1 =
// "jembatan" balik ke start (naik nembus gua, badai putih, reda di dataran
// salju, lihat src/fx). Counter jalan sampai 120.
const DESCEND = 100 / 120
// anchor auto-center (dalam satuan descend 0..1) → dikonversi ke satuan loop
const DESCEND_ANCHORS = [0, 0.2, 0.4, 0.6, 0.8, 0.915, 1]
const LOOP_ANCHORS = DESCEND_ANCHORS.map((a) => a * DESCEND)
// anchor snap = anchor descend + ujung jembatan (1 = hero loop berikutnya).
// Dulu snap cuma jalan di descend, jadi scroll dikit dari outro bikin halaman
// parkir permanen di tengah jembatan (bridge 0.69, layar kabut biru terus)
const SNAP_ANCHORS = [...LOOP_ANCHORS, 1]

// ===== zona tahan di kamar wajah (revisi 2 Okt) =====
// Permintaan Nehemiah: "jangan sampai orang ke-scroll dikit langsung ilang tanpa
// muncul partikelnya". Dulu geser dikit dari wajah (naik atau turun) langsung
// bikin kartu kontak pudar & wajah mulai buyar. Sekarang di sekitar anchor wajah
// ada plateau: selama scroll masih di dalam zona ini, damped tetep 1 & bridge
// tetep 0, layar diem. Transisinya baru mulai di luar zona.
// Satuan loop (1 = satu putaran). Satu putaran = 5.8 layar, jadi 0.03 ~ 0.17
// layar ke atas, 0.05 ~ 0.29 layar ke bawah.
// Biar batu-batu tetep di titik snap-nya, yang dipadetin cuma potongan
// terakhir turun (titik istirahat portal 0.915 sampai wajah) & awal jembatan.
const FACE_HOLD_UP = 0.03
const FACE_HOLD_DOWN = 0.05
const REST_D = 0.915
const REST_L = REST_D * DESCEND
// posisi loop mentah -> progres turun (0..1) & jembatan (0..1)
const descendOf = (l) => {
  if (l <= REST_L) return clamp(l / DESCEND, 0, 1)
  return REST_D + (1 - REST_D) * clamp((l - REST_L) / (DESCEND - FACE_HOLD_UP - REST_L), 0, 1)
}
const bridgeOf = (l) => clamp((l - DESCEND - FACE_HOLD_DOWN) / (1 - DESCEND - FACE_HOLD_DOWN), 0, 1)
// tinggi 1 periode loop dalam layar (≈ sama feel-nya kayak 480vh descend lama).
// DIBULATIN: 844 * 5.8 = 4895.2, dan di layar dpr 3 window.scrollTo ke angka
// pecahan mendarat meleset subpixel, cukup buat bikin loop 0 kebaca 0.9999
const periodPx = () => Math.round(window.innerHeight * 5.8)
// jumlah salinan periode di kolom scroll. Dinaikin 3 → 5: jarak antar "recenter"
// jadi 2x lebih jauh. Tiap recenter itu lompatan window.scrollTo, dan di HP
// lompatan itu MOTONG inersia scroll (kerasa patah), jadi makin jarang makin bagus
const COPIES = 5

// background = video langit hasil generate (public/scene/scene.mp4): kabut idle "breathing",
// angin, kristal es lewat, dunia yang masuk akal buat batu-batu melayang.
// Pas scroll nyampe batu pertama, videonya fade out ketutup kabut putih polos.
// Kalau file-nya belum ada, fallback ke background procedural (kabut + drifting ice).
export default function App() {
  const [panel, setPanel] = useState(null)
  const [hasVideo, setHasVideo] = useState(false)
  const [hasGlacier, setHasGlacier] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [ready, setReady] = useState(false) // true pas intro emerge kelar (buat munculin tombol ECHO)
  const diveTimer = useRef(null)
  const videoRef = useRef()

  const openChat = () => {
    setChatOpen(true)
    chatState.open = true
  }
  const closeChat = () => {
    setChatOpen(false)
    chatState.open = false
  }

  // klik batu: mulai animasi menyelam (Dive.jsx), panel konten dipasang pas
  // layar udah ketutup video panel. prefers-reduced-motion: tanpa ancang-ancang
  // dan tanpa gerak kamera, cuma crossfade pendek ke video
  const openRock = (id, pos) => {
    if (focusState.phase !== 'idle') return // lagi nyelam/kebuka, abaikan klik dobel
    const fade = reducedMotion()
    beginFocus(id, pos ?? [0, 0, 0], fade ? 'fade' : 'dive')
    // masih di dalam gesture klik: video panel mulai muter (tanpa suara) sekarang,
    // biar udah jalan pas nongol di dalam batu
    startPanelVideo()
    clearTimeout(diveTimer.current)
    diveTimer.current = setTimeout(
      () => {
        setPanel(id)
        focusState.panelOpen = true
      },
      fade ? DIVE.FADE + 20 : DIVE.PANEL
    )
  }
  const closeRock = () => {
    clearTimeout(diveTimer.current)
    setPanel(null)
    focusState.panelOpen = false
    endFocus()
  }
  const veilRef = useRef()
  const depthTintRef = useRef()
  const outroDarkRef = useRef()
  const scrollSpaceRef = useRef()

  // ===== master: intro badai reda (sekali) + infinite loop scroll dua arah =====
  useEffect(() => {
    const S = introState
    let raf
    let P = periodPx() // tinggi 1 periode loop (px)
    // scrollY yang dianggap loop = 0. WAJIB diikat ke posisi pendaratan NYATA,
    // bukan ke kelipatan P: di HP dpr 3 scrollTo mendarat meleset subpixel, dan
    // frac() dari meleset-dikit-ke-bawah itu 0.9999 alias ujung bridge. Efeknya
    // halaman kebuka langsung nyangkut di zona transisi loop, dan auto-snap
    // GAK PERNAH nyala di situ (dulu snap cuma jalan kalau loopRaw <= DESCEND).
    let originY = 0
    let loopDamped = 0 // posisi loop ter-smoothing (0..1), damping SIRKULAR
    let lastNow = performance.now()
    let lastUser = performance.now()
    let snapTween = null // tween GSAP yg lagi jalan (null = gak ada)
    let prevY = 0 // scrollY frame lalu, buat ngedeteksi halaman masih meluncur

    const frac = (v) => ((v % 1) + 1) % 1

    const sizeSpace = () => {
      // pertahanin posisi loop yang lagi jalan pas layar di-resize
      const phase = P ? frac((window.scrollY - originY) / P) : 0
      P = periodPx()
      // COPIES salinan periode + 1 layar: user selalu di salinan tengah, pas
      // mepet tepi di-"recenter" ±P (gak keliatan karena konten periodik: 0 ≡ 120)
      if (scrollSpaceRef.current) scrollSpaceRef.current.style.height = `${COPIES * P + window.innerHeight}px`
      originY = window.scrollY - phase * P
    }
    const bump = () => {
      lastUser = performance.now()
      // user nyentuh input apa pun = snap batal seketika (jangan lawan tangan user)
      if (snapTween) {
        snapTween.kill()
        snapTween = null
      }
    }
    window.addEventListener('resize', sizeSpace)
    window.addEventListener('wheel', bump, { passive: true })
    window.addEventListener('touchmove', bump, { passive: true })
    window.addEventListener('pointerdown', bump)
    window.addEventListener('keydown', bump)

    const tick = (now) => {
      const dt = Math.min(0.05, (now - lastNow) / 1000)
      lastNow = now

      if (S.phase === 'wait') {
        // loader masih nutup, diem
      } else if (S.phase === 'fall') {
        // intro PERTAMA: reuse potongan kedua jembatan loop (badai putih reda di
        // atas dataran salju, kamera turun pelan ke pose hero), digerakin WAKTU
        // dari B_INTRO (putih penuh, sama kayak di balik loader) ke 1. Kabut
        // badainya kebuka, gunung nongol, nama muncul paling akhir
        const k = clamp((now - S.t0) / INTRO_MS, 0, 1)
        const br = B_INTRO + (1 - B_INTRO) * smooth(k)
        const ld = DESCEND + br * (1 - DESCEND)
        loopDamped = ld
        S.reveal = 1 // dunia udah ada di balik badai, badainya yang nyingkap
        scrollState.progress = 1
        scrollState.damped = 1
        scrollState.bridge = br
        scrollState.loopDamped = ld
        scrollState.depthK = 1 - br // retrace ke 0 (hero) pas emerge kelar
        if (window.scrollY !== 0) window.scrollTo(0, 0)
        if (k >= 1) {
          // mendarat di hero → mulai loop normal dari posisi 0
          S.phase = 'idle'
          S.reveal = 1
          setReady(true) // dunia udah kebentuk → tombol ECHO boleh nongol
          scrollState.progress = scrollState.damped = scrollState.bridge = 0
          scrollState.depthK = scrollState.loopDamped = 0
          loopDamped = 0
          sizeSpace()
          window.scrollTo(0, 2 * P) // masuk salinan tengah
          // jangkar loop = tempat kita BENERAN mendarat, bukan 2*P yang diminta.
          // Selisih subpixel-nya kecil, tapi kalau mendaratnya sedikit di bawah,
          // frac()-nya jadi 0.9999 dan halaman kejebak di bridge (bug HP)
          originY = window.scrollY
          prevY = originY
          lastUser = now
        }
      } else {
        // ---- idle: infinite loop ----
        let y = window.scrollY
        // recenter tak-kasat-mata biar gak pernah mentok tepi (dua arah).
        // Batasnya diukur dari originY, dan lebarnya 4P (dulu 2P), lompatannya
        // jadi separuh lebih jarang. Di HP nunggu luncuran inersia kelar dulu
        // (scrollSettle.js), lompatan di tengah luncuran motong gerakannya
        let recentered = false
        const settled = scrollSettled(now)
        if (settled && y < originY - 1.5 * P) {
          y += P
          window.scrollTo(0, y)
          recentered = true
        } else if (settled && y > originY + 2.5 * P) {
          y -= P
          window.scrollTo(0, y)
          recentered = true
        }
        const loopRaw = frac((y - originY) / P)

        // ---- gate inersia (biang "patah" di HP) ----
        // Di HP jari udah lepas tapi halaman masih meluncur ~1 detik, dan selama
        // luncuran itu GAK ada event touchmove lagi. Akibatnya timer 450ms di
        // bawah kelewat, snap nyala di tengah luncuran, dan tween GSAP rebutan
        // sama inersia browser. Jadi selama posisinya masih berubah, itung
        // sebagai "user masih gerak": snap baru boleh nyala pas beneran diem.
        if (recentered) prevY = y
        else {
          if (!snapTween && Math.abs(y - prevY) > 0.5) lastUser = now
          prevY = y
        }

        // snap antar section (teknik dari video snap-on-scroll Nicolai Palmkvist:
        // fullPage scrollingSpeed 1000ms + transisi GSAP power2.out). Diadaptasi
        // ke infinite loop kita: idle 450ms → SELALU dikunci ke anchor (gak ada
        // posisi nyangkut di tengah section), ke anchor yang paling deket
        // nunggu 650 ms diem (dulu 450): biar gak kerasa "direbut" pas baru berhenti
        if (!snapTween && now - lastUser > 650 && !dragState.active && focusState.phase === 'idle') {
          // dua anchor pengapit posisi sekarang
          let lo = SNAP_ANCHORS[0]
          let hi = SNAP_ANCHORS[SNAP_ANCHORS.length - 1]
          for (let i = 0; i < SNAP_ANCHORS.length - 1; i++) {
            if (loopRaw >= SNAP_ANCHORS[i] - 1e-6 && loopRaw <= SNAP_ANCHORS[i + 1] + 1e-6) {
              lo = SNAP_ANCHORS[i]
              hi = SNAP_ANCHORS[i + 1]
              break
            }
          }
          // di jembatan: lanjut ke hero atau balik ke outro, gak boleh diem di tengah
          const inBridge = lo >= DESCEND - 1e-6
          const g = hi > lo ? (loopRaw - lo) / (hi - lo) : 0
          // revisi 2 Okt (feedback Nehemiah: "scroll dikit dari batu langsung
          // ke portal"): selalu balik ke titik TERDEKAT, gak peduli arah. Dulu
          // searah: lewat 22% celah udah dianggap pindah, dan celah SKILLS ke
          // portal cuma 0.115, jadi geser ~100px aja udah loncat section
          const A = g < 0.5 ? lo : hi
          // ujung jembatan (A = 1) dilebihin 1.5px: damping sirkular ngejar
          // target dari bawah, kalau pas di seam dia nyangkut di 0.9999 (state
          // "outro" padahal layar hero). Lewat dikit = nyebrang ke 0 beneran
          const targetY = originY + (Math.round((y - originY) / P - A) + A) * P + (A === 1 ? 1.5 : 0)
          if (Math.abs(targetY - y) > 2) {
            const proxy = { y }
            const dist = Math.abs(targetY - y) / P
            snapTween = gsap.to(proxy, {
              y: targetY,
              // ~1 detik ala scrollingSpeed fullPage, dikit lebih lama kalau jauh.
              // Jembatan dikasih waktu lebih: isinya animasi nyelam + emerge,
              // kalau disapu 1 detik kerasa kebut
              // Revisi 27 Sep (permintaan: "auto adjust-nya jangan cepet, pelan-pelan"):
              // 1.3 s ke atas + sine.inOut, mulai dan berhentinya sama-sama lembut.
              // Dulu 0.85 s power2.out: nyentak di awal
              duration: inBridge ? Math.min(2.2, 1.2 + dist * 6) : Math.min(2.2, 1.3 + dist * 3),
              ease: inBridge ? 'power1.inOut' : 'sine.inOut',
              onUpdate: () => window.scrollTo(0, proxy.y),
              onComplete: () => {
                snapTween = null
              },
            })
          }
        }
        if (snapTween) y = window.scrollY

        // damping SIRKULAR (jalur terdekat), biar seam 0.99→0.00 gak nge-scrub mundur
        let d = frac((y - originY) / P) - loopDamped
        if (d > 0.5) d -= 1
        if (d < -0.5) d += 1
        loopDamped = frac(loopDamped + d * (1 - Math.exp(-dt / 0.16)))

        const dprog = descendOf(loopDamped)
        const br = bridgeOf(loopDamped)
        scrollState.progress = clamp(loopRaw / DESCEND, 0, 1)
        scrollState.damped = dprog
        scrollState.bridge = br
        scrollState.loopDamped = loopDamped
        // depthK: retrace balik ke 0 pas bridge → ujung bridge == awal descend
        scrollState.depthK = br > 0 ? 1 - br : dprog
      }

      // ---- lapisan DOM transisi (badai putih, coretan salju, frost HP), dari
      //      scrollState yang baru ditulis di atas, jadi frame-nya sama ----
      stepFxDom(now)

      const rv = S.phase === 'idle' ? 1 : S.reveal
      const dk = scrollState.depthK
      if (depthTintRef.current) {
        depthTintRef.current.style.opacity = clamp((dk - 0.2) / 0.5, 0, 1) * 0.68 * rv
      }
      if (outroDarkRef.current) {
        // pakai damped (bukan depthK) biar gelapnya nahan selama di outro, dan
        // padam di awal bridge pas mau balik ke hero
        // pas loop bertahan sampai kamera naik nembus gerbang portal (B_GATE)
        const od = smooth(clamp((scrollState.damped - 0.81) / 0.07, 0, 1)) * (1 - smooth(clamp((scrollState.bridge - B_GATE + 0.06) / 0.1, 0, 1)))
        outroDarkRef.current.style.opacity = od * rv
      }
      const veil = veilRef.current
      if (veil) {
        const k = clamp((dk - 0.02) / 0.13, 0, 1)
        veil.style.transform = `translateY(${100 - 200 * k}vh)`
      }
      const el = videoRef.current
      if (el) {
        const fade = clamp(1 - (dk - 0.12) / 0.24, 0, 1)
        el.style.opacity = (0.3 + 0.7 * fade) * rv
        // pas panel batu kebuka, layar ketutup penuh modal + video glacier,
        // video langit di-pause biar gak ada DUA video rebutan decoder
        // (biang video panel kadang patah). Balik play pas panel ditutup
        if (focusState.panelOpen) {
          if (!el.paused) el.pause()
        } else if (el.paused) el.play().catch(() => {})
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      if (snapTween) snapTween.kill()
      window.removeEventListener('resize', sizeSpace)
      window.removeEventListener('wheel', bump)
      window.removeEventListener('touchmove', bump)
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('keydown', bump)
    }
  }, [])

  // kunci scroll halaman selama panel batu ATAU chat ECHO kebuka, biar pas ditutup
  // scene balik ke posisi yg sama (bukan loncat ke posisi scroll yg berubah di belakang)
  useEffect(() => {
    if (!panel && !chatOpen) return
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prev
    }
  }, [panel, chatOpen])

  useEffect(() => {
    // handle debug buat verifikasi otomatis (Playwright), gak dipakai runtime
    window.__ice = {
      introState,
      scrollState,
      focusState,
      chatState,
      faceState,
      open: openRock,
      close: closeRock,
      openChat,
      closeChat,
      panelVideo,
      tune: TUNE,
    }
    // cek beneran video, dev server Vite ngebales 200 text/html buat file yang gak ada
    // icev2: langit sekarang digambar di scene (Sky di world/World.jsx), video
    // langit v1 gak dipakai lagi, jadi loader gak usah nunggu dia
    bgVideoState.ready = true
    // video loop "dalam glacier" buat background panel batu. File-nya di
    // public/glacier_inside.mp4; kalau ga ketemu, panel fallback ke gradient es.
    fetch(GLACIER_VIDEO, { method: 'HEAD' })
      .then((r) => {
        const type = r.headers.get('content-type') || ''
        if (r.ok && type.includes('video')) setHasGlacier(true)
      })
      .catch(() => {})
  }, [])

  return (
    <>
      {hasVideo && (
        <video
          ref={videoRef}
          className="bg-video"
          src={SCENE_VIDEO}
          autoPlay
          muted
          loop
          playsInline
          // loadeddata = frame pertama udah kelar decode → loader boleh buka tirai
          onLoadedData={() => (bgVideoState.ready = true)}
          onError={() => (bgVideoState.ready = true)}
        />
      )}
      {hasVideo && <div ref={veilRef} className="fog-veil" aria-hidden="true" />}
      {/* tint biru gletser di backdrop, makin dalam makin pekat */}
      <div ref={depthTintRef} className="depth-tint" aria-hidden="true" />
      {/* abis SKILLS latarnya jadi biru tua gelap sampai wajah partikel
          (permintaan 27 Sep: "gelap, terang di akunya aja") */}
      <div ref={outroDarkRef} className="outro-dark" aria-hidden="true" />
      {/* gradient "air dalam" dulu di sini sebagai ShaderGradientCanvas, alias
          konteks WebGL KEDUA. Sekarang digambar di canvas utama (DeepWater di
          Experience.jsx), jadi GPU gak gonta-ganti konteks tiap frame lagi */}
      {/* badai putih + coretan salju (jembatan loop & intro), frost HP */}
      <FxOverlay />
      <div className="canvas-wrap">
        <Canvas
          // di HP dpr 1.5 = 2.25x piksel dibanding dpr 1, dan tiap piksel di sini
          // mahal (transmission nge-render ulang scene). Turun ke 1 = beban
          // fragment shader langsung sepertiga-nya. MSAA juga dimatiin: di HP
          // mahal, dan tepiannya udah ketutup kabut + grain CSS
          // dpr awal HP 1, desktop sampai 1.5. Nilainya dipegang quality.js
          // (bisa turun kalau fps jeblok), prop ini WAJIB ngikut biar re-render
          // App gak ngereset dpr balik ke nilai awal
          dpr={quality.dpr}
          onCreated={onCanvasCreated}
          gl={{ antialias: !LOW, alpha: true, powerPreference: 'high-performance' }}
          // icev2: far 900 (dulu 100), pegunungan di cakrawala ada di jarak 250-430
          camera={{ fov: 32, position: [0, 1.5, 11], near: 0.1, far: 900 }}
          style={{ touchAction: 'pan-y' }}
          // pas panel batu kebuka, scene ketutup penuh sama modal + video glacier.
          // stop render WebGL biar GPU fokus decode video (video gak patah lagi) &
          // hemat baterai. Balik jalan lagi begitu panel ditutup.
          //
          // Hal yang sama berlaku buat drawer chat, TAPI cuma di HP: di situ
          // lebarnya 100vw jadi scene ketutup 100% (diukur, gak ada 1 piksel pun
          // yang keliatan) sementara GPU tetep ngerender 18 draw call / 50rb
          // segitiga tiap frame. Di desktop drawernya cuma 420px dan scene masih
          // keliatan di kiri, jadi di sana JANGAN dibekuin.
          frameloop={panel || (LOW && chatOpen) ? 'never' : 'always'}
        >
          <Suspense fallback={null}>
            <Experience onOpen={openRock} hasVideo={hasVideo} />
          </Suspense>
        </Canvas>
      </div>
      <div ref={scrollSpaceRef} className="scroll-space" aria-hidden="true" />
      <UI panel={panel} onClose={closeRock} hasGlacier={hasGlacier} onOpenChat={openChat} onOpenRock={openRock} />
      <ChatDock open={chatOpen} onOpen={openChat} onClose={closeChat} hidden={!ready || !!panel} />
      {/* kursor bracket 4 sudut (React Bits TargetCursor): ngunci ke elemen
          interaktif DOM, membesar pas hover batu 3D. Desktop doang, di mobile
          komponennya balikin null sendiri */}
      <TargetCursor
        spinDuration={6}
        cursorColor="#e8f4ff"
        targetSelector=".cursor-target, .soc-side, .soc-current, .echo-inline, .rock-close, .rock-sound, .echo-btn, .echo-close, .echo-chip, .echo-send, .outro a"
      />
      <Loader />
    </>
  )
}
