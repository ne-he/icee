"""Screenshot + angka performa per zona, buat gate tiap milestone icev2.

Pakai (dari root repo, setelah `npm run build`):
    python tools/verify/shots.py <label> [--mobile] [--zones 0,0.2,...] [--no-perf]

Hasil ke tools/verify/out/<label>/ (di luar git): zone_XX.png, contact.jpg, stats.json.
Kedalaman dibekuin lewat freeze() (master loop App ikut beku), jadi overlay DOM
yang biasanya disetel master loop (depth-tint, outro-dark) gak ikut update.
"""
import argparse, json, pathlib, sys, time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from playwright.sync_api import sync_playwright  # noqa: E402
from icehelp import launch, open_site, freeze, measure  # noqa: E402

ZONES = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 0.915, 1.0]
PROGS = "window.__caught.renderers[0].info.programs.length"
CALLS = "(() => { const i = window.__caught.renderers[0].info.render; return [i.calls, i.triangles] })()"

ap = argparse.ArgumentParser()
ap.add_argument("label")
ap.add_argument("--mobile", action="store_true")
ap.add_argument("--zones", default=None)
ap.add_argument("--no-perf", action="store_true")
ap.add_argument("--dist", default=str(ROOT / "dist"))
a = ap.parse_args()
zones = [float(z) for z in a.zones.split(",")] if a.zones else ZONES
out = HERE / "out" / a.label
out.mkdir(parents=True, exist_ok=True)

stats = {"label": a.label, "mobile": a.mobile, "zones": {}}
with sync_playwright() as p:
    b = launch(p)
    kw = dict(width=390, height=844, dsf=2, mobile=True) if a.mobile else dict(width=1536, height=864, dsf=1.25)
    ctx, pg, errs = open_site(b, a.dist, **kw)
    time.sleep(1.5)
    stats["programs_idle"] = pg.evaluate(PROGS)
    for z in zones:
        freeze(pg, z, settle=2.2)
        f = out / f"zone_{int(round(z * 1000)):04d}.png"
        pg.screenshot(path=str(f))
        row = {"calls_tris": pg.evaluate(CALLS)}
        if not a.no_perf:
            row["fps_p50_p95_slow"] = measure(pg, 2500)
        row["programs"] = pg.evaluate(PROGS)
        stats["zones"][str(z)] = row
        print(z, row, flush=True)
    stats["errors"] = errs
    stats["transfer_kb"] = round(pg.evaluate(
        "performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0)") / 1024)
    ctx.close()
    b.close()

(out / "stats.json").write_text(json.dumps(stats, indent=1))
try:
    import cv2, numpy as np
    ims = []
    for z in zones:
        im = cv2.imread(str(out / f"zone_{int(round(z * 1000)):04d}.png"))
        h = 300 if not a.mobile else 420
        im = cv2.resize(im, (int(im.shape[1] * h / im.shape[0]), h))
        cv2.rectangle(im, (0, 0), (120, 26), (0, 0, 0), -1)
        cv2.putText(im, f"d={z}", (6, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        ims.append(im)
    cols = 4
    while len(ims) % cols:
        ims.append(np.zeros_like(ims[0]))
    sheet = np.vstack([np.hstack(ims[i:i + cols]) for i in range(0, len(ims), cols)])
    cv2.imwrite(str(out / "contact.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 82])
except ImportError:
    pass
print("errors:", stats["errors"] or "none", "| transfer KB:", stats["transfer_kb"])
