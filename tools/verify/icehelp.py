"""Helper verifikasi ICEBERG: file dist/ hasil `npm run build` dilayani lewat
Playwright route interception di http://iceberg.local/, atau langsung ke URL dev
server kalau `dist` diisi http://...

Pakai:
    import sys; sys.path.insert(0, r"<folder file ini>")
    from icehelp import launch, open_site, freeze, measure, stats
    with sync_playwright() as p:
        b = launch(p)
        ctx, pg, errs = open_site(b, r"<repo>/dist")
        freeze(pg, 0.6); pg.screenshot(path=...)
"""
import pathlib, time, statistics as st

MIME = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream",
    ".woff2": "font/woff2", ".ico": "image/x-icon", ".pdf": "application/pdf", ".webp": "image/webp",
}

# three.js ngirim event 'observe' tiap Scene/WebGLRenderer dibikin kalau hook ini ada.
# Dipakai buat baca renderer.info & nyentuh scene langsung dari test.
HOOK = """
window.__caught = { renderers: [], scenes: [] };
window.__THREE_DEVTOOLS__ = new EventTarget();
window.__THREE_DEVTOOLS__.addEventListener('observe', (e) => {
  const o = e.detail;
  if (o && o.isWebGLRenderer) window.__caught.renderers.push(o);
  else if (o && o.isScene) window.__caught.scenes.push(o);
});
"""


def launch(p):
    return p.chromium.launch(channel="chrome", headless=True,
                             args=["--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"])


def open_site(browser, dist, width=1536, height=864, dsf=1.25, mobile=False, wait_idle=True, hook=True):
    raw = dist
    dist = pathlib.Path(dist)
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=dsf,
                              is_mobile=mobile, has_touch=mobile)
    if hook:
        ctx.add_init_script(HOOK)

    def serve(route):
        path = route.request.url.split("iceberg.local", 1)[1].split("?")[0].split("#")[0]
        if path in ("", "/"):
            path = "/index.html"
        f = dist / path.lstrip("/")
        if path.startswith("/api/"):
            return route.fulfill(status=503, body="no backend in local test")
        if not f.is_file():
            f = dist / "index.html"
        ctype = MIME.get(f.suffix.lower(), "application/octet-stream")
        if route.request.method == "HEAD":  # app cuma ngecek content-type, jangan kirim body 1,7 MB
            return route.fulfill(status=200, body=b"", headers={"content-type": ctype})
        route.fulfill(status=200, body=f.read_bytes(),
                      headers={"content-type": MIME.get(f.suffix.lower(), "application/octet-stream")})

    url = "http://iceberg.local/"
    if str(raw).startswith("http"):  # dev server (vite) langsung, tanpa build
        url = str(raw)
    else:
        ctx.route("http://iceberg.local/**", serve)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)[:240]))
    pg.on("console", lambda m: errs.append("CONSOLE: " + m.text[:200]) if m.type == "error" else None)
    pg.goto(url, wait_until="load", timeout=120000)
    if wait_idle:
        pg.wait_for_function("() => window.__ice && window.__ice.introState.phase === 'idle'", timeout=180000)
    return ctx, pg, errs


FREEZE_JS = """(a) => { const I = window.__ice; I.introState.phase = 'wait'; I.introState.t0 = performance.now() + 1e9;
 I.introState.reveal = 1; const s = I.scrollState; const d = a[0], br = a[1];
 s.progress = d; s.damped = d; s.bridge = br; s.depthK = br > 0 ? 1 - br : d;
 s.loopDamped = br > 0 ? 100/120 + br * (1 - 100/120) : d * 100/120; }"""


def freeze(pg, d, bridge=0.0, settle=2.5):
    """Bekuin master loop lalu tulis scrollState langsung (re-assert 8x, wajib).
    Catatan: master loop App ikut beku, jadi opacity overlay DOM yang biasanya
    dia setel (depth-tint, video) gak ikut update. Buat bandingin 3D-nya ini cukup."""
    for _ in range(8):
        pg.evaluate(FREEZE_JS, [d, bridge])
        time.sleep(0.05)
    time.sleep(settle)


def smooth_scroll_to_depth(pg, d, y0, lap=0):
    """Scroll kayak pengunjung (master loop tetap jalan) ke kedalaman d (0..1)."""
    P = pg.evaluate("Math.round(window.innerHeight*5.8)")
    target = y0 + lap * P + d * (100 / 120) * P
    pg.evaluate("""(target) => new Promise(res => { const y0=window.scrollY,n=45;let i=0;
      (function f(){i++;const k=i/n;const e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
      window.scrollTo(0,y0+(target-y0)*e); if(i<n) requestAnimationFrame(f); else res();})(); })""", target)


MEASURE_JS = """(ms) => new Promise(res => { const t = []; const end = performance.now() + ms;
  (function f(now){ t.push(now); if (now < end) requestAnimationFrame(f); else res(t); })(performance.now()); })"""


def measure(pg, ms=4000):
    """Rekam timestamp frame selama ms, balikin (fps, p50, p95, persen frame > 20ms)."""
    return stats(pg.evaluate(MEASURE_JS, ms))


def stats(ts):
    d = sorted(b - a for a, b in zip(ts, ts[1:]))
    n = len(d)
    return (round(1000 / st.mean(d), 1), round(d[int(.5 * n)], 1), round(d[min(n - 1, int(.95 * n))], 1),
            round(sum(x > 20 for x in d) / n * 100, 1))


def script_ms_per_s(ctx, pg, fn):
    """Jalanin fn(), balikin berapa ms JS main thread per detik selama fn jalan."""
    cdp = ctx.new_cdp_session(pg)
    cdp.send("Performance.enable")
    get = lambda: {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}["ScriptDuration"]
    t0, s0 = time.time(), get()
    out = fn()
    return out, round((get() - s0) * 1000 / (time.time() - t0))
