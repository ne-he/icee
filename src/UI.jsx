import { useCallback, useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { beginIntro, bgVideoState, chatState, faceState, focusState, introState, scrollState } from './scrollState'
import { warmState } from './warmup'
import { armPanelVideo, PANEL_VOL, panelVideo, rampPanelSound } from './Dive'
import { AVAILABILITY, CONTACT, CRYSTALS, PANELS, RESUME_URL, SECTION_WORDS } from './content'
import DecryptedText from './components/DecryptedText'

// glyph acak buat efek decode judul, huruf kapital + angka + simbol instrumen,
// senada sama kode section '//////' dan readout HUD
const DECRYPT_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/<>-'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// carousel sosial ala igloo.inc: item tengah kekurung bracket, tetangganya
// redup di kiri-kanan. Geser pakai ARROW KEY keyboard (kiri/kanan) atau klik
// langsung label tetangganya, tanpa tombol panah visual (permintaan Nehemiah).
// Item yang dipilih = bentuk partikel di panggung (face | github | linkedin | whatsapp)
const SOCIAL_ITEMS = [
  { id: 'face', label: 'NEHEMIAH', url: null },
  { id: 'github', label: 'GITHUB', url: CONTACT.github },
  { id: 'linkedin', label: 'LINKEDIN', url: CONTACT.linkedin },
  { id: 'whatsapp', label: 'WHATSAPP', url: CONTACT.whatsapp },
]

function SocialCarousel() {
  const [idx, setIdx] = useState(0)
  const n = SOCIAL_ITEMS.length
  const move = (dir) =>
    setIdx((i) => {
      const j = (i + dir + n) % n
      faceState.target = SOCIAL_ITEMS[j].id
      return j
    })

  // arrow key kiri/kanan buat geser, aktif cuma pas udah mendarat di outro,
  // biar gak ganggu navigasi keyboard pas masih di atas
  useEffect(() => {
    const onKey = (e) => {
      if (scrollState.damped < 0.96) return
      if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const prev = SOCIAL_ITEMS[(idx + n - 1) % n]
  const cur = SOCIAL_ITEMS[idx]
  const next = SOCIAL_ITEMS[(idx + 1) % n]
  return (
    <div className="soc-carousel">
      <button className="soc-side" onClick={() => move(-1)}>
        {prev.label}
      </button>
      {/* item aktif: klik = buka linknya (kalau ada) */}
      <a
        className="soc-current"
        href={cur.url || '#'}
        target={cur.url ? '_blank' : undefined}
        rel="noreferrer"
        onClick={(e) => !cur.url && e.preventDefault()}
      >
        {cur.label}
      </a>
      <button className="soc-side" onClick={() => move(1)}>
        {next.label}
      </button>
    </div>
  )
}
const smooth = (x) => x * x * (3 - 2 * x)

function RowLinks({ links }) {
  if (!links?.length) return null
  return (
    <div className="rock-links">
      {links.map((l) => (
        <a key={l.href} className="cursor-target" href={l.href} target="_blank" rel="noreferrer">
          {l.label}
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
            <path d="M1 8L8 1M8 1H2.5M8 1V6.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </a>
      ))}
    </div>
  )
}

// satu baris panel. Baris projek (yang punya hook) tampil versi skim dulu:
// judul + tag, hook, chip fakta, link, baru paragraf penuh di balik Details.
// Recruiter nyekim, 13 paragraf 100 kata sekaligus gak bakal kebaca. Baris
// ABOUT/JOURNEY/SKILLS tetep teks penuh, isinya udah pendek
function PanelRow({ r, id }) {
  const [open, setOpen] = useState(false)
  const skim = !!r.hook
  // paragraf yang cuma dikit lebih panjang dari hook-nya gak perlu Details,
  // isinya udah kewakilan hook + chip (contoh: FAMILY TASK BOARD)
  const more = skim && r.p.length > r.hook.length + 80
  return (
    <article className={`rock-row ${skim ? 'rock-row--skim' : ''}`}>
      <h3>
        {r.h}
        {r.tag ? <span>{r.tag}</span> : null}
      </h3>
      {skim ? (
        <>
          {/* screenshot demo. Gak di-lazy: baris cuma ada pas panelnya kebuka,
              dan lazy bikin kotaknya kosong sedetik pas panel baru nongol */}
          {r.thumb && <img className="rock-thumb" src={r.thumb} alt="" width="640" height="280" decoding="async" />}
          <p className="rock-hook">{r.hook}</p>
          {r.facts?.length ? (
            <ul className="rock-facts" aria-label="Key facts">
              {r.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          <div className="rock-act">
            <RowLinks links={r.links} />
            {more && (
              <button
                className="rock-more cursor-target"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setOpen((o) => !o)}
              >
                {open ? 'Hide details' : 'Details'}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            )}
          </div>
          {more && (
            <p className="rock-p" id={id} hidden={!open}>
              {r.p}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="rock-p">{r.p}</p>
          <RowLinks links={r.links} />
        </>
      )}
    </article>
  )
}

// ikon speaker buat toggle suara video dalam-glacier
function SpeakerIcon({ on }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" opacity="0.9" />
      {on ? (
        <path
          d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M16 9.5l5 5M21 9.5l-5 5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

export function UI({ panel, onClose, hasGlacier, onOpenChat, onOpenRock }) {
  const hero = useRef()
  const outro = useRef()
  const words = useRef([])
  const depth = useRef()
  const temp = useRef()
  const bar = useRef()
  const hint = useRef()
  const ruler = useRef()
  const outroIn = useRef()
  // tombol "OPEN <SECTION>" di HUD: satu-satunya petunjuk di HP (label batu
  // ke-crop keluar layar di sana) dan satu-satunya jalan buat pengguna keyboard
  // (batu 3D gak bisa di-Tab). Isinya ditulis langsung ke DOM dari loop rAF,
  // bukan state React per frame
  const openBtn = useRef()
  const openName = useRef()
  const framed = useRef(0) // index batu terakhir yang di-frame kamera
  const openShown = useRef(null) // visibility terakhir yang ditulis (biar gak nulis tiap frame)
  const openLive = useRef(null) // pointer-events terakhir yang ditulis
  const atOutro = useRef(false) // lagi mendarat di outro (kelas html.at-outro)

  // simpan konten panel terakhir biar teks gak hilang pas animasi nutup
  const lastRef = useRef(null)
  if (panel) lastRef.current = panel
  const data = PANELS[lastRef.current]

  // pemicu efek decode (DecryptedText): counter naik tiap elemen teksnya
  // TRANSISI dari sembunyi ke keliatan. State React di sini aman karena
  // cuma berubah pas ganti section, bukan tiap frame
  const [wordPlay, setWordPlay] = useState(() => SECTION_WORDS.map(() => 0))
  const [heroPlay, setHeroPlay] = useState(0)
  const wordVis = useRef(SECTION_WORDS.map(() => false))
  const heroVis = useRef(false)

  // video dalam-glacier: suara nyala default (permintaan Nehemiah), bisa di-toggle
  const vidRef = useRef(null)
  const [soundOn, setSoundOn] = useState(true)
  // elemen video yang SAMA dipinjem batu pas nyelam (tekstur di Dive.jsx)
  const bindVid = useCallback((el) => {
    vidRef.current = el
    panelVideo.el = el
  }, [])
  // video panel (905 KB) dulu preload="auto" dari awal, rebutan bandwidth sama
  // model + HDR + video langit pas loading pertama, padahal baru kepake pas batu
  // dibuka. Sekarang src-nya baru dipasang 2.5 detik setelah intro kelar, atau
  // langsung di handler klik batu (armPanelVideo). Sekali dipasang gak dilepas lagi
  const vidArmedRef = useRef(false)
  // 1 = HUD tampil, 0 = lagi nyelam/panel kebuka (label, judul section, OPEN minggir)
  const hudK = useRef(1)
  const diving = useRef(false)

  useEffect(() => {
    // HUD render only, scrollState di-drive master di App.jsx (infinite loop).
    // Nilai "descend-linked" (kabut/depth/ruler) pakai depthK biar retrace mulus
    // balik ke 0 pas bridge (ujung loop == awal, gak nge-pop)
    let raf
    let idleAt = 0 // kapan intro pertama kali kelar (buat jadwal video panel)
    // Tinggi penggaris kedalaman diukur SEKALI (plus tiap resize), gak per frame.
    // Dulu offsetHeight dibaca tiap frame persis setelah teks DPT/TEMP ditulis:
    // itu maksa browser layout ulang 60x per detik (~70 ms JS/detik di outro,
    // ketemu pas profiling 25 Sep 2026)
    let travel = 0
    const measure = () => {
      if (ruler.current) travel = ruler.current.offsetHeight - window.innerHeight
    }
    measure()
    // font web bisa nyampe belakangan dan ngubah tinggi baris penggaris
    document.fonts?.ready.then(measure)
    window.addEventListener('resize', measure)
    // teks readout cuma ditulis kalau nilainya beneran berubah
    let lastDepth = ''
    let lastTemp = ''
    let lastNow = performance.now()
    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - lastNow) / 1000)
      lastNow = now
      if (!vidArmedRef.current) {
        if (introState.phase === 'idle' && !idleAt) idleAt = now
        if (focusState.phase !== 'idle' || (idleAt && now - idleAt > 2500)) {
          vidArmedRef.current = true
          armPanelVideo()
        }
      }
      // nyelam ke batu: HUD minggir halus (bukan ilang sekejap), balik lagi
      // begitu kamera udah mendarat di posisi scroll
      const dv = focusState.phase !== 'idle' || focusState.panelOpen
      hudK.current += ((dv ? 0 : 1) - hudK.current) * (1 - Math.exp(-dt / (dv ? 0.07 : 0.16)))
      const hk = hudK.current
      if (dv !== diving.current) {
        diving.current = dv
        // label batu, logo/readout, vignette, tombol chat: diatur CSS (html.is-diving)
        document.documentElement.classList.toggle('is-diving', dv)
      }
      // video panel sengaja tetep jalan selama animasi keluar (batunya masih
      // nampilin video itu). Baru di-pause pas kamera udah balik
      const pv = vidRef.current
      if (pv && !pv.paused && !dv) pv.pause()
      const t = scrollState.damped // posisi descend (=1 selama bridge)
      const dk = scrollState.depthK // retrace pas bridge
      const br = scrollState.bridge
      const lp = scrollState.loopDamped
      const rv = introState.phase === 'idle' ? 1 : introState.reveal
      // hero text nongol pas dangkal (dk kecil), otomatis balik muncul di ujung bridge
      if (hero.current) {
        const ho = clamp(1 - dk / 0.07, 0, 1) * rv
        hero.current.style.opacity = ho
        const hv = ho > 0.3
        if (hv !== heroVis.current) {
          heroVis.current = hv
          if (hv) setHeroPlay((v) => v + 1) // baru nongol → judul decode
        }
      }
      if (outro.current) {
        // muncul pas mendarat, FADE OUT pas bridge mulai (mau balik ke atas).
        // Mulainya digeser ke 0.984: kamera udah natap wajah dari depan, jadi
        // kartu gak nongol di atas salju yang masih turun dari portal
        // pas loop pudarnya cepet (0.1): wajahnya langsung buyar balik ke portal
        const o = clamp((t - 0.984) / 0.014, 0, 1) * (1 - smooth(clamp(br / 0.1, 0, 1)))
        outro.current.style.opacity = o
        if (outroIn.current) outroIn.current.style.pointerEvents = o > 0.5 ? 'auto' : 'none'
        // kelas di <html> buat CSS: di HP tombol chat melayang disembunyiin pas
        // di outro (nutupin kartu kontak, dan kartunya udah punya tombol chat
        // sendiri). Ditulis cuma pas berubah, bukan tiap frame
        const at = o > 0.5
        if (at !== atOutro.current) {
          atOutro.current = at
          document.documentElement.classList.toggle('at-outro', at)
        }
      }
      SECTION_WORDS.forEach((w, i) => {
        const el = words.current[i]
        if (el) {
          const o = clamp(1 - Math.abs(t - w.center) / 0.12, 0, 1)
          el.style.opacity = o * hk
          // visibilitas decode dihitung TANPA hk: balik dari panel gak perlu
          // muter ulang animasi decode judulnya
          const vis = o > 0.15
          if (vis !== wordVis.current[i]) {
            wordVis.current[i] = vis
            if (vis) setWordPlay((p) => p.map((v, j) => (j === i ? v + 1 : v)))
          }
        }
      })
      const dTxt = `DPT ${String(Math.round(dk * 380)).padStart(3, '0')}M`
      const tTxt = `TEMP ${(-1.2 - dk * 27.3).toFixed(2)}`
      if (depth.current && dTxt !== lastDepth) depth.current.textContent = lastDepth = dTxt
      if (temp.current && tTxt !== lastTemp) temp.current.textContent = lastTemp = tTxt
      if (bar.current) bar.current.style.transform = `scaleX(${lp})`
      // aba-aba scroll cuma perlu sebelum orang mulai turun. Dulu nongol terus
      // sampai dk 0.82, numpuk sama tombol OPEN. Karena pakai dk (yang retrace
      // pas bridge), dia otomatis balik lagi pas mendarat di hero
      if (hint.current) hint.current.style.opacity = clamp(1 - dk / 0.06, 0, 1) * rv * hk
      if (openBtn.current) {
        // batu i di-frame kalau damped deket anchor snap-nya, (i+1)/(N+1), rumus
        // yang sama kayak anchor di App. Penuh dalam 0.035, pudar habis di 0.06.
        // Mati pas bridge dan pas chat kebuka. Pas nyelam/panel kebuka dia
        // mudar bareng HUD lain (hk)
        let fi = -1
        let fo = 0
        if (br === 0 && !chatState.open) {
          const n = CRYSTALS.length + 1
          for (let i = 0; i < CRYSTALS.length; i++) {
            const o = clamp(1 - (Math.abs(t - (i + 1) / n) - 0.035) / 0.025, 0, 1)
            if (o > fo) {
              fo = o
              fi = i
            }
          }
        }
        fo *= rv * hk
        if (fi !== -1 && fi !== framed.current) {
          framed.current = fi
          if (openName.current) openName.current.textContent = CRYSTALS[fi].name
        }
        const b = openBtn.current
        b.style.opacity = fo
        b.style.transform = `translate(-50%, ${((1 - fo) * 10).toFixed(2)}px)`
        // hidden = gak bisa ke-Tab pas gak keliatan
        const shown = fo > 0.02
        if (shown !== openShown.current) {
          openShown.current = shown
          b.style.visibility = shown ? 'visible' : 'hidden'
        }
        const live = fo > 0.5
        if (live !== openLive.current) {
          openLive.current = live
          b.style.pointerEvents = live ? 'auto' : 'none'
        }
      }
      if (ruler.current && travel > 0) ruler.current.style.transform = `translateY(${-dk * travel}px)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      document.documentElement.classList.remove('at-outro', 'is-diving')
    }
  }, [])

  // thumbnail demo di kartu PROJECTS (8 file, ~115 KB) diambil diam-diam pas
  // browser nganggur setelah load, jadi pas panelnya kebuka gambarnya udah di
  // cache. Dulu baru di-fetch pas panel nongol: kotaknya kosong sedetik-dua
  useEffect(() => {
    const load = () =>
      PANELS.projects.rows.forEach((r) => {
        if (r.thumb) new Image().src = r.thumb
      })
    const id = setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(load) : load()), 6000)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Video udah muter tanpa suara sejak klik batu (startPanelVideo di Dive.jsx).
  // Pas panel kebuka suaranya dinyalain, boleh karena halaman udah dapet gesture
  // klik. Kalau browser tetep blok suara, fallback ke muted biar videonya tetep
  // jalan (bukan layar item). Pas panel ditutup suaranya langsung mati, tapi
  // videonya JANGAN di-pause di sini: batunya masih nampilin video itu selama
  // animasi keluar (pause-nya di loop HUD di atas)
  // Volume pelan (PANEL_VOL) dan selalu lewat fade: masuk pelan-pelan, keluar
  // mudar ~0.9 detik baru di-mute (dulu langsung nyala kenceng & mati mendadak)
  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    panelVideo.soundOn = soundOn
    if (panel) {
      armPanelVideo()
      v.muted = !soundOn
      // lanjutin fade dari posisi sekarang (udah mulai naik sejak klik batu)
      if (soundOn) rampPanelSound(PANEL_VOL, 2.0)
      if (v.paused) {
        const p = v.play()
        if (p && p.catch)
          p.catch(() => {
            v.muted = true
            v.play().catch(() => {})
          })
      }
    } else {
      rampPanelSound(0, 0.9)
      const id = setTimeout(() => {
        if (!focusState.panelOpen) v.muted = true
      }, 950)
      return () => clearTimeout(id)
    }
  }, [panel, soundOn])

  return (
    <>
      <div className="grain" aria-hidden="true" />
      {/* vignette via CSS, dulunya post-processing GPU, dipindah ke sini biar enteng */}
      <div className="vignette" aria-hidden="true" />
      {/* penggaris kedalaman kiri, ikut gerak scroll, ala instrumen igloo */}
      <div className="ruler" aria-hidden="true">
        <div className="ruler-in" ref={ruler}>
          {Array.from({ length: 39 }, (_, i) => (
            <div className="tick" key={i}>
              <span>{String(i * 10).padStart(3, '0')}M</span>
            </div>
          ))}
        </div>
      </div>
      <div className="hud">
        <div className="logo">THE ICEBERG</div>
        <div className="meta">
          NEHEMIAH WILHELMUS JUNAIDI
          <br />
          JAKARTA / 2026
        </div>
        {/* jalan pintas buat recruiter yang gak mau scroll sampai bawah */}
        <a className="hud-cv cursor-target" href={RESUME_URL} target="_blank" rel="noopener">
          CV (PDF) <span aria-hidden="true">↗</span>
        </a>
        <div className="readout">
          <div ref={depth}>DPT 000M</div>
          <div ref={temp}>TEMP -1.20</div>
          <div>SIG ▮▮▮▯</div>
        </div>
        <div className="hint" ref={hint}>
          <span className="hint-inner">SCROLL TO DESCEND ▾</span>
        </div>
        <button
          className="rock-open cursor-target"
          ref={openBtn}
          onClick={() => {
            const c = CRYSTALS[framed.current]
            if (c) onOpenRock?.(c.id, c.position)
          }}
        >
          <span className="rock-open-br" aria-hidden="true">⌐</span>
          <span>
            OPEN <span ref={openName}>{CRYSTALS[0].name}</span>
          </span>
          <span className="rock-open-br" aria-hidden="true">¬</span>
        </button>
        <div className="progress-bar" ref={bar} />
      </div>

      {/* judul section: nempel kiri bawah (grid editorial), gak lagi di kanan
          tengah yang nabrak readout DPT/TEMP dan nutupin badan batu */}
      {SECTION_WORDS.map((w, i) => (
        <div key={w.word} className="bigword" ref={(el) => (words.current[i] = el)} aria-hidden="true">
          <div className="bigword-code">SEC {CRYSTALS[i]?.tag}</div>
          <DecryptedText
            text={w.word}
            animateOn="manual"
            playKey={wordPlay[i]}
            sequential
            revealDirection="center"
            speed={55}
            characters={DECRYPT_GLYPHS}
            encryptedClassName="dt-enc"
          />
        </div>
      ))}

      <div className="hero" ref={hero}>
        <h1>
          <DecryptedText
            text="NEHEMIAH"
            animateOn="manual"
            playKey={heroPlay}
            sequential
            revealDirection="center"
            speed={70}
            characters={DECRYPT_GLYPHS}
            encryptedClassName="dt-enc"
          />
        </h1>
        <p>DATA SCIENCE PORTFOLIO / DESCEND TO EXPLORE</p>
      </div>

      <div className="outro" ref={outro}>
        <div className="outro-in" ref={outroIn}>
        <div className="outro-code">// CONTACT</div>
        <h2>LET'S CONNECT</h2>
        <p className="outro-avail">{AVAILABILITY}</p>
        <div className="outro-links">
          <a className="outro-mail" href={`mailto:${CONTACT.email}`}>
            {CONTACT.email.toUpperCase()}
          </a>
          <a className="outro-cv" href={RESUME_URL} target="_blank" rel="noopener">
            CV (PDF) ↗
          </a>
        </div>
        {/* carousel ala igloo: pilih platform → partikel morph jadi logonya */}
        <SocialCarousel />
        {/* pintu masuk chatbot dari klimaks: udah ketemu muka partikel, langsung
            bisa ngajak ngomong, muka partikel = avatar ECHO */}
        <button className="echo-inline" onClick={onOpenChat}>
          <span aria-hidden="true">&gt;</span> Chat with my AI
        </button>
        {/* jalan keluar ke ARMORY. Dua situs porto ini sebelumnya nol saling
            tunjuk, jadi yang mendarat di salah satunya gak pernah tau yang lain */}
        <a className="sister-site" href={CONTACT.armory} target="_blank" rel="noopener">
          OR VISIT NEMI'S GARAGE ↗
        </a>
        {/* petunjuk loop: scroll terus di 100/100 = balik ke permukaan */}
        <div className="loop-hint">KEEP SCROLLING TO RESURFACE ↻</div>
        </div>
      </div>

      {/* panel batu = layar penuh "DI DALAM batu": background loop es-glacier
          (video generate Nehemiah kalau ada, else gradient es) + teks memenuhi
          layar. Muncul pas kamera udah nembus masuk batunya (permintaan Nehemiah) */}
      <div className={`rock-modal ${panel ? 'is-open' : ''}`} aria-hidden={!panel}>
        {hasGlacier ? (
          // videonya udah dikompres ke <1MB, jadi begitu src dipasang (lihat
          // vidArmed) di-preload penuh: ke-buffer semua sebelum user klik
          // kristal = main tanpa patah
          <video
            ref={bindVid}
            className="rock-bg"
            loop
            playsInline
            preload="auto"
            // browser yang nolak nyalain suara tanpa gesture baru langsung
            // nge-pause videonya. Pas panel kebuka itu = layar beku, jadi
            // balik ke muted dan lanjut muter
            onPause={(e) => {
              const v = e.currentTarget
              if (focusState.panelOpen && !v.muted) {
                v.muted = true
                v.play().catch(() => {})
              }
            }}
          />
        ) : (
          <div className="rock-bg rock-bg--fallback" />
        )}
        <div className="rock-scrim" />
        {/* kabut tipis yang ngalir pelan di atas latar gelap, di bawah teks. Mulai
            dari 0 pas serah terima (canvas udah bening), lalu pelan-pelan nebel.
            Di atas scrim, soalnya di bawahnya ketutup gelap sampai gak kebaca */}
        <div className="rock-mist" aria-hidden="true" />
        {/* kepala panel: logo kiri, suara + CLOSE kanan, di atas pelat gradient
            solid. Dulu logo/CLOSE ngambang tanpa latar jadi numpuk sama teks pas
            di-scroll, dan tombol suara di pojok kiri bawah nutupin link LIVE/REPO
            di HP. Sekarang semua kontrol yang nempel layar ngumpul di sini */}
        <div className="rock-top">
          <div className="rock-logo">THE ICEBERG</div>
          <div className="rock-controls">
            {hasGlacier && (
              <button
                className="rock-sound cursor-target"
                onClick={() => setSoundOn((s) => !s)}
                aria-label={soundOn ? 'Mute the background video' : 'Turn the background sound on'}
              >
                <SpeakerIcon on={soundOn} />
                <span className="rock-sound-txt">{soundOn ? 'SOUND ON' : 'SOUND OFF'}</span>
              </button>
            )}
            <button className="rock-close cursor-target" onClick={onClose}>
              <span className="rock-close-br">⌐</span> CLOSE <span className="rock-close-br">¬</span>
            </button>
          </div>
        </div>
        {data && (
          <div className="rock-content" key={lastRef.current}>
            {/* desktop: kolom judul kiri (nempel pas di-scroll) + isi kanan, biar
                separo kanan layar gak kosong. HP: satu kolom biasa */}
            <div className={`rock-inner rock-inner--${lastRef.current}`}>
              <header className="rock-aside">
                <div className="rock-code">{data.code}</div>
                <div className="rock-kicker">{data.kicker}</div>
                <h2>{data.title}</h2>
              </header>
              <div className="rock-rows">
                {data.rows.map((r, i) => (
                  <PanelRow key={r.h} r={r} id={`rock-p-${lastRef.current}-${i}`} />
                ))}
                <div className="rock-foot">{data.foot}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export function Loader() {
  const { active, progress } = useProgress()
  const [done, setDone] = useState(false)
  useEffect(() => {
    // selesai kalau progress 100 ATAU gak ada loader yang aktif lagi,
    // useProgress kadang mentok di bawah 100 padahal asset udah kelar semua.
    // Delay minimal 600ms: kalau ternyata masih ada asset nyusul (active balik
    // true), interval ke-cancel duluan, jadi gak kecolongan mulai intro kepagian.
    // useProgress cuma ngitung asset three.js, video langit (scene.mp4) di luar
    // itu, jadi ditunggu juga (bgVideoState) biar pas tirai kebuka videonya udah
    // nongol, bukan putih dulu sedetik. Batas nunggu video 3 detik.
    // warmState: shader & geometri semua section udah dipanasin di balik tirai
    // (lihat src/warmup.js). Batas nunggu 4,5 detik biar HP lemot gak ketahan.
    if (progress >= 100 || !active) {
      const t0 = performance.now()
      const id = setInterval(() => {
        const el = performance.now() - t0
        if (el >= 600 && (bgVideoState.ready || el > 3000) && (warmState.done || el > 4500)) {
          clearInterval(id)
          setDone(true)
          beginIntro() // loader kelar → batu hero mulai jatuh
        }
      }, 80)
      return () => clearInterval(id)
    }
  }, [active, progress])
  // jaring pengaman: apapun yang terjadi, loader hilang setelah 5 detik
  useEffect(() => {
    const id = setTimeout(() => {
      setDone(true)
      beginIntro()
    }, 5000)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className={`loader ${done ? 'is-done' : ''}`}>
      THE ICEBERG<span>{Math.round(progress)}%</span>
    </div>
  )
}
