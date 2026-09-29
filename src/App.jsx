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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

const FALL_MS = 2100 // durasi animasi emerge intro pertama
const smooth = (x) => x * x * (3 - 2 * x)

// salju yg jatuh nutupin biru transisi loop, canvas ringan, cuma gambar pas
// bridge aktif. Ngasih gerak & isi biar 109→120 gak kerasa "biru kosong doang"
// (permintaan Nehemiah). Alpha ngikut envelope bridge yg sama kayak wash.
function SnowVeil() {
  const ref = useRef()
  useEffect(() => {
    const cv = ref.current
    const ctx = cv.getContext('2d')
    let raf
    let W = 0
    let H = 0
    const dpr = Math.min(LOW ? 1.5 : 2, window.devicePixelRatio || 1)
    const resize = () => {
      W = window.innerWidth
      H = window.innerHeight
      cv.width = W * dpr
      cv.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    const rnd = (s) => {
      const x = Math.sin(s * 12.9898) * 43758.5453
      return x - Math.floor(x)
    }
    // 3 lapis kedalaman: jauh (kecil,lambat,samar) → deket (gede,cepat,jelas)
    const flakes = Array.from({ length: LOW ? 70 : 150 }, (_, i) => {
      const layer = i % 3
      return {
        x: rnd(i + 1),
        y: rnd(i + 7),
        r: (0.7 + rnd(i + 3) * 1.6) * (0.6 + layer * 0.45),
        spd: (0.06 + rnd(i + 5) * 0.16) * (0.5 + layer * 0.5),
        drift: (rnd(i + 9) - 0.5) * 0.4,
        ph: rnd(i + 11) * 6.28,
        a: 0.25 + layer * 0.28,
      }
    })
    let last = performance.now()
    let drew = false // ada sisa gambar di canvas? (biar clear-nya gak tiap frame)
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const br = scrollState.bridge
      const env = clamp((br - 0.28) / 0.14, 0, 1) * (1 - clamp((br - 0.66) / 0.16, 0, 1))
      // salju cuma nyala pas bridge, sisanya (mayoritas waktu) canvas kosong.
      // dulu clearRect full-screen tetep jalan 60x/detik walau gak ada yang
      // digambar, dan di HP itu ngabisin fill rate percuma. Sekarang cuma di-clear
      // sekali pas mati.
      if (env <= 0.02) {
        if (drew) {
          ctx.clearRect(0, 0, W, H)
          drew = false
        }
      } else {
        ctx.clearRect(0, 0, W, H)
        drew = true
        for (const f of flakes) {
          f.y += f.spd * dt
          if (f.y > 1.06) f.y -= 1.12
          f.ph += dt * 0.8
          const px = (f.x + Math.sin(f.ph) * f.drift * 0.04) * W
          const py = ((f.y % 1) + 1) % 1 * H
          ctx.beginPath()
          ctx.fillStyle = `rgba(234,244,252,${f.a * env * (0.6 + 0.4 * Math.sin(f.ph * 1.6))})`
          ctx.arc(px, py, f.r, 0, 6.283)
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} className="snow-veil" aria-hidden="true" />
}

// loop di-bagi: 0..DESCEND = perjalanan turun (hero→partikel), DESCEND..1 =
// "jembatan" balik ke start (batu jatuh lagi). Counter jalan sampai 120.
const DESCEND = 100 / 120
// anchor auto-center (dalam satuan descend 0..1) → dikonversi ke satuan loop
const DESCEND_ANCHORS = [0, 0.2, 0.4, 0.6, 0.8, 0.915, 1]
const LOOP_ANCHORS = DESCEND_ANCHORS.map((a) => a * DESCEND)
// anchor snap = anchor descend + ujung jembatan (1 = hero loop berikutnya).
// Dulu snap cuma jalan di descend, jadi scroll dikit dari outro bikin halaman
// parkir permanen di tengah jembatan (bridge 0.69, layar kabut biru terus)
const SNAP_ANCHORS = [...LOOP_ANCHORS, 1]
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
  const washRef = useRef()
  const depthTintRef = useRef()
  const outroDarkRef = useRef()
  const scrollSpaceRef = useRef()

  // ===== master: intro batu jatuh (sekali) + infinite loop scroll dua arah =====
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
    let prevLoopRaw = 0 // buat ngedeteksi arah scroll terakhir
    let prevY = 0 // scrollY frame lalu, buat ngedeteksi halaman masih meluncur
    let dir = 0 // -1 naik, +1 turun, 0 belum gerak

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
        // intro PERTAMA (permintaan Nehemiah): BUKAN layar putih, reuse animasi
        // emerge biru+salju yang sama kayak ujung loop (112→120). Bridge digerakin
        // WAKTU dari 0.6→1.0: biru+salju nyingkap, batu hero mendarat, nama muncul
        const k = clamp((now - S.t0) / FALL_MS, 0, 1)
        const br = 0.6 + 0.4 * smooth(k) // bridge 0.6 → 1.0 (fase emerge)
        const ld = DESCEND + br * (1 - DESCEND)
        loopDamped = ld
        S.reveal = 1 // dunia udah ada di balik biru, biru yg nyingkap, bukan fog putih
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

        // arah scroll terakhir (jalur sirkular terdekat), cuma dicatat dari
        // gerakan user, bukan dari tween snap yg lagi jalan
        if (!snapTween) {
          let dm = loopRaw - prevLoopRaw
          if (dm > 0.5) dm -= 1
          if (dm < -0.5) dm += 1
          if (Math.abs(dm) > 0.00005) dir = Math.sign(dm)
        }
        prevLoopRaw = loopRaw

        // snap antar section (teknik dari video snap-on-scroll Nicolai Palmkvist:
        // fullPage scrollingSpeed 1000ms + transisi GSAP power2.out). Diadaptasi
        // ke infinite loop kita: idle 450ms → SELALU dikunci ke anchor (gak ada
        // posisi nyangkut di tengah section), dan DIRECTIONAL, lewat 22% gap
        // searah gerakan terakhir udah dianggap "niat pindah section"
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
          let A
          if (dir > 0) A = g > 0.22 ? hi : lo
          else if (dir < 0) A = g < 0.78 ? lo : hi
          else A = g < 0.5 ? lo : hi
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

        const dprog = clamp(loopDamped / DESCEND, 0, 1)
        const br = clamp((loopDamped - DESCEND) / (1 - DESCEND), 0, 1)
        scrollState.progress = clamp(loopRaw / DESCEND, 0, 1)
        scrollState.damped = dprog
        scrollState.bridge = br
        scrollState.loopDamped = loopDamped
        // depthK: retrace balik ke 0 pas bridge → ujung bridge == awal descend
        scrollState.depthK = br > 0 ? 1 - br : dprog
      }

      // ---- tirai biru jembatan: bukan full-cover kosong lagi. Biru dibikin
      //      TEMBUS (env*0.72) biar batu es echo yg membesar keliatan nembusnya
      //      = ada isi, gak biru polos (permintaan Nehemiah). Cuma di detik
      //      teleport (seam br≈0.55) opacity dinaikin ke ~penuh buat nyamarin
      //      lompatan kamera dive→hero ----
      const br = scrollState.bridge
      const env = clamp((br - 0.28) / 0.14, 0, 1) * (1 - clamp((br - 0.66) / 0.16, 0, 1))
      const seam = Math.exp(-Math.pow((br - 0.55) / 0.035, 2))
      const wash = clamp(env * 0.72 + seam * 0.3, 0, 1)
      if (washRef.current) {
        washRef.current.style.opacity = wash
        washRef.current.style.visibility = env > 0.004 ? 'visible' : 'hidden'
      }

      const rv = S.phase === 'idle' ? 1 : S.reveal
      const dk = scrollState.depthK
      if (depthTintRef.current) {
        depthTintRef.current.style.opacity = clamp((dk - 0.2) / 0.5, 0, 1) * 0.68 * rv
      }
      if (outroDarkRef.current) {
        // pakai damped (bukan depthK) biar gelapnya nahan selama di outro, dan
        // padam di awal bridge pas mau balik ke hero
        const od = smooth(clamp((scrollState.damped - 0.81) / 0.07, 0, 1)) * (1 - clamp(scrollState.bridge / 0.12, 0, 1))
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
      {/* tirai biru penutup layar buat transisi loop 100/100 → 0/100 */}
      <div ref={washRef} className="loop-wash" aria-hidden="true" />
      {/* salju jatuh di atas biru pas transisi, biar gak kerasa biru kosong */}
      <SnowVeil />
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
