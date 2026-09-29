"""Contact sheet transisi (src/fx): nyemplung, jembatan loop, intro.

    python tools/verify/fxshots.py <label> --dist <dist> [--mobile] [--only plunge,bridge,intro]
           [--reduced]

- plunge & bridge: scroll dibekuin pakai freeze() (overlay DOM tetep ikut, dia
  dibaca dari scrollState tiap frame di master loop App)
- intro: halaman dibuka tanpa nunggu idle, lalu jam intro dikunci ke T ms
  (introState.t0 ditulis ulang tiap frame), jadi screenshot-nya deterministik
Hasil: tools/verify/out/<label>/{plunge,bridge,intro}.jpg + png per frame.
"""
import argparse, pathlib, sys, time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from playwright.sync_api import sync_playwright  # noqa: E402
from icehelp import launch, open_site, freeze  # noqa: E402

PLUNGE = [0.02, 0.04, 0.055, 0.065, 0.075, 0.085, 0.1, 0.12]
BRIDGE = [0.02, 0.1, 0.2, 0.3, 0.4, 0.46, 0.52, 0.6, 0.66, 0.72, 0.8, 0.88, 0.95, 1.0]
INTRO = [0, 400, 800, 1200, 1600, 2000, 2400, 2800, 3200, 3390]
PROGS = "window.__caught.renderers[0].info.programs.length"

LOCK_JS = """(T) => { const I = window.__ice; window.__lockT = T;
  if (!window.__lockOn) { window.__lockOn = true;
    const f = () => { if (window.__lockT == null) { window.__lockOn = false; return; }
      if (I.introState.phase === 'fall') I.introState.t0 = performance.now() - window.__lockT;
      requestAnimationFrame(f); }; requestAnimationFrame(f); } }"""

ap = argparse.ArgumentParser()
ap.add_argument("label")
ap.add_argument("--dist", required=True)
ap.add_argument("--mobile", action="store_true")
ap.add_argument("--reduced", action="store_true")
ap.add_argument("--only", default="plunge,bridge,intro")
a = ap.parse_args()
only = a.only.split(",")
out = HERE / "out" / a.label
out.mkdir(parents=True, exist_ok=True)
kw = dict(width=390, height=844, dsf=2, mobile=True) if a.mobile else dict(width=1536, height=864, dsf=1.25)


def sheet(name, files, labels):
    try:
        import cv2, numpy as np
    except ImportError:
        return
    ims = []
    for f, lab in zip(files, labels):
        im = cv2.imread(str(f))
        h = 280 if not a.mobile else 400
        im = cv2.resize(im, (int(im.shape[1] * h / im.shape[0]), h))
        cv2.rectangle(im, (0, 0), (150, 26), (0, 0, 0), -1)
        cv2.putText(im, lab, (6, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        ims.append(im)
    cols = 4 if not a.mobile else 7
    while len(ims) % cols:
        ims.append(np.zeros_like(ims[0]))
    s = np.vstack([np.hstack(ims[i:i + cols]) for i in range(0, len(ims), cols)])
    cv2.imwrite(str(out / f"{name}.jpg"), s, [cv2.IMWRITE_JPEG_QUALITY, 80])


with sync_playwright() as p:
    b = launch(p)
    progs = {}
    if "intro" in only:
        ctx, pg, errs = open_site(b, a.dist, wait_idle=False, **kw)
        if a.reduced:
            pg.emulate_media(reduced_motion="reduce")
        pg.wait_for_function("() => window.__ice && window.__ice.introState.phase === 'fall'", timeout=180000)
        pg.evaluate(LOCK_JS, 0)
        time.sleep(1.4)  # tirai loader (CSS 0.8 s) udah ilang
        files = []
        for T in INTRO:
            pg.evaluate(LOCK_JS, T)
            time.sleep(0.5)
            f = out / f"intro_{T:04d}.png"
            pg.screenshot(path=str(f))
            files.append(f)
        pg.evaluate("window.__lockT = null")
        pg.wait_for_function("() => window.__ice.introState.phase === 'idle'", timeout=20000)
        progs["after_intro"] = pg.evaluate(PROGS)
        sheet("intro", files, [f"t={T}ms" for T in INTRO])
        print("intro errors:", errs or "none", flush=True)
        ctx.close()
    if "plunge" in only or "bridge" in only:
        ctx, pg, errs = open_site(b, a.dist, **kw)
        if a.reduced:
            pg.emulate_media(reduced_motion="reduce")
        time.sleep(1.0)
        progs["idle"] = pg.evaluate(PROGS)
        if "plunge" in only:
            files = []
            for d in PLUNGE:
                freeze(pg, d, settle=1.2)
                f = out / f"plunge_{int(d * 1000):04d}.png"
                pg.screenshot(path=str(f))
                files.append(f)
            sheet("plunge", files, [f"d={d}" for d in PLUNGE])
            progs["after_plunge"] = pg.evaluate(PROGS)
        if "bridge" in only:
            files = []
            for br in BRIDGE:
                freeze(pg, 1.0, bridge=br, settle=1.2)
                f = out / f"bridge_{int(br * 1000):04d}.png"
                pg.screenshot(path=str(f))
                files.append(f)
            sheet("bridge", files, [f"br={br}" for br in BRIDGE])
            progs["after_bridge"] = pg.evaluate(PROGS)
        print("scroll errors:", errs or "none", flush=True)
        ctx.close()
    print("programs:", progs)
    b.close()
