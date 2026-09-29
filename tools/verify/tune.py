"""Nyari nilai look tanpa build ulang: set window.__ice.tune per varian, screenshot
beberapa kedalaman, jadiin satu lembar perbandingan.

    python tools/verify/tune.py <label> --dist <dist> --zones 0,0.2 \
        --var '{"hemi":0.8}' --var '{"hemi":1.2}'

Hasil: tools/verify/out/tune_<label>.jpg (baris = varian, kolom = kedalaman).
"""
import argparse, json, pathlib, sys, time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from playwright.sync_api import sync_playwright  # noqa: E402
from icehelp import launch, open_site, freeze  # noqa: E402
import cv2, numpy as np  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("label")
ap.add_argument("--dist", required=True)
ap.add_argument("--zones", default="0,0.2")
ap.add_argument("--var", action="append", default=[])
ap.add_argument("--mobile", action="store_true")
ap.add_argument("--h", type=int, default=360)
a = ap.parse_args()
zones = [float(z) for z in a.zones.split(",")]
vars_ = [json.loads(v) for v in a.var] or [{}]
out = HERE / "out"
out.mkdir(exist_ok=True)

rows = []
with sync_playwright() as p:
    b = launch(p)
    kw = dict(width=390, height=844, dsf=2, mobile=True) if a.mobile else dict(width=1536, height=864, dsf=1)
    ctx, pg, errs = open_site(b, a.dist, **kw)
    time.sleep(1.2)
    base = pg.evaluate("JSON.parse(JSON.stringify(window.__ice.tune))")
    for v in vars_:
        pg.evaluate("(v) => Object.assign(window.__ice.tune, v)", {**base, **v})
        ims = []
        for z in zones:
            freeze(pg, z, settle=1.6)
            buf = pg.screenshot(type="jpeg", quality=85)
            im = cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_COLOR)
            im = cv2.resize(im, (int(im.shape[1] * a.h / im.shape[0]), a.h))
            txt = f"d={z} {json.dumps(v)[:70]}"
            cv2.rectangle(im, (0, 0), (min(im.shape[1], 10 + 8 * len(txt)), 24), (0, 0, 0), -1)
            cv2.putText(im, txt, (6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
            ims.append(im)
        rows.append(np.hstack(ims))
    print("errors:", errs or "none")
    ctx.close()
    b.close()
sheet = np.vstack(rows)
cv2.imwrite(str(out / f"tune_{a.label}.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])
print(out / f"tune_{a.label}.jpg")
