"""Jumlah program shader di tiap titik loop (descend + bridge), buat mastiin gak
ada material yang dikompilasi di tengah scroll.

Pakai: python tools/verify/progs.py --dist <dist> [--mobile]
"""
import argparse, pathlib, sys, time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from playwright.sync_api import sync_playwright  # noqa: E402
from icehelp import launch, open_site, freeze  # noqa: E402

PROGS = "window.__caught.renderers[0].info.programs.length"
POINTS = [(0.03, 0), (0.06, 0), (0.1, 0), (0.2, 0), (0.5, 0), (0.9, 0), (0.95, 0), (1, 0),
          (1, 0.1), (1, 0.3), (1, 0.5), (1, 0.6), (1, 0.8), (1, 0.99), (0, 0)]

ap = argparse.ArgumentParser()
ap.add_argument("--dist", required=True)
ap.add_argument("--mobile", action="store_true")
a = ap.parse_args()
with sync_playwright() as p:
    b = launch(p)
    kw = dict(width=390, height=844, dsf=2, mobile=True) if a.mobile else dict(width=1536, height=864, dsf=1.25)
    ctx, pg, errs = open_site(b, a.dist, **kw)
    time.sleep(1.0)
    print("idle", pg.evaluate(PROGS), flush=True)
    for d, br in POINTS:
        freeze(pg, d, bridge=br, settle=0.6)
        print(d, br, pg.evaluate(PROGS), flush=True)
    print("errors:", errs or "none")
    ctx.close()
    b.close()
