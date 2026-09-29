"""Angka performa per zona icev2: fps, draw call & segitiga PER FRAME (semua pass
dijumlah), jumlah program shader sepanjang satu loop penuh, total transfer.

Kenapa gak baca renderer.info biasa: EffectComposer (dan IceBuffer) manggil
gl.render berkali-kali per frame, dan info.render di-reset tiap panggilan, jadi
yang kebaca cuma pass terakhir (quad bloom, 1 call). Di sini gl.render dibungkus:
tiap panggilan dicatat (target, calls, segitiga), lalu dijumlah per frame lewat
requestAnimationFrame.

Pakai (dari root repo, setelah build):
    python tools/verify/perf.py <label> --dist <dist> [--mobile] [--zones 0,0.1,...]

Hasil: tools/verify/out/perf_<label>.json (+ ringkasan di stdout).
"""
import argparse, json, pathlib, statistics as st, sys, time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from playwright.sync_api import sync_playwright  # noqa: E402
from icehelp import launch, open_site, freeze, measure  # noqa: E402

ZONES = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 0.868, 0.915, 1.0]
BRIDGE = [0.1, 0.3, 0.5, 0.62, 0.8, 0.95]

# bungkus gl.render renderer utama. Kelas pass:
#  main  = scene utama ke layar / buffer composer (ukuran penuh)
#  ice   = scene utama ke buffer refraksi es (IceBuffer, lebih kecil dari layar)
#  fx    = pass fullscreen composer (bloom dst) & render lain
# Waktu GPU per pass diukur pakai EXT_disjoint_timer_query_webgl2 (ada di Chrome
# headless + ANGLE D3D11 di laptop ini). Ini angka yang paling bisa dipercaya:
# fps headless ketahan vsync 60 dan gampang goyang, ms GPU nggak.
INSTALL = """() => {
  const r = window.__caught.renderers[0];
  if (r.__pfWrapped) return true;
  r.__pfWrapped = true;
  r.info.autoReset = false;
  const gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const orig = r.render.bind(r);
  const blank = () => ({main: [0, 0, 0, 0], ice: [0, 0, 0, 0], fx: [0, 0, 0, 0]});
  const pf = window.__pf = { cur: blank(), frames: [], rec: false, cam: null, gpu: !!ext, n: 0 };
  const pool = [], pending = [];
  let busy = false;
  r.render = function (scene, cam) {
    const c0 = r.info.render.calls, t0 = r.info.render.triangles;
    let q = null;
    if (ext && pf.rec && !busy) { q = pool.pop() || gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); busy = true; }
    orig(scene, cam);
    const dc = r.info.render.calls - c0, dt = r.info.render.triangles - t0;
    const rt = r.getRenderTarget();
    const W = r.domElement.width;
    let k = 'fx';
    if (cam && cam.isPerspectiveCamera && scene.children.length > 8) {
      k = rt && rt.width < W * 0.9 ? 'ice' : 'main';
      pf.cam = cam;
    }
    if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); busy = false; pending.push([q, pf.cur, k]); }
    const c = pf.cur[k]; c[0] += 1; c[1] += dc; c[2] += dt;
  };
  (function tick() {
    // hasil query GPU nyusul beberapa frame kemudian, ditulis balik ke frame asalnya
    if (ext) {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      for (let i = pending.length - 1; i >= 0; i--) {
        const [q, fr, k] = pending[i];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        if (!disjoint) fr[k][3] += ns / 1e6; else fr.bad = true;
        pool.push(q); pending.splice(i, 1);
      }
    }
    if (pf.rec) pf.frames.push(pf.cur);
    pf.cur = blank();
    r.info.reset();
    requestAnimationFrame(tick);
  })();
  return true;
}"""

PROGS = "window.__caught.renderers[0].info.programs.length"


def frame_stats(pg, ms):
    pg.evaluate("() => { window.__pf.frames = []; window.__pf.rec = true; }")
    fps = measure(pg, ms)
    pg.evaluate("() => { window.__pf.rec = false; }")
    time.sleep(0.4)  # nunggu hasil query GPU frame terakhir
    fr = pg.evaluate("() => window.__pf.frames")
    fr = [f for f in fr if f["main"][0] > 0]  # frame yang beneran ngerender scene

    def med(key, i):
        v = [f[key][i] for f in fr]
        return int(st.median(v)) if v else 0

    tot_calls = [f["main"][1] + f["ice"][1] + f["fx"][1] for f in fr]
    tot_tris = [f["main"][2] + f["ice"][2] + f["fx"][2] for f in fr]
    ice_frames = sum(1 for f in fr if f["ice"][0] > 0)
    g = [f for f in fr if not f.get("bad")]

    def gms(keys, q=0.5):
        v = sorted(sum(f[k][3] for k in keys) for f in g)
        return round(v[min(len(v) - 1, int(q * len(v)))], 2) if v else None

    cam = pg.evaluate("(() => { const c = window.__pf.cam; return c ? [c.position.x, c.position.y, c.position.z].map(v => +v.toFixed(2)) : null })()")
    return {
        "fps_p50_p95_slow": fps,
        # ms GPU per frame (median), total & per pass, plus p90 total
        "gpu_ms": gms(["main", "ice", "fx"]),
        "gpu_ms_p90": gms(["main", "ice", "fx"], 0.9),
        "gpu_main_ice_fx": [gms(["main"]), gms(["ice"]), gms(["fx"])],
        "calls": int(st.median(tot_calls)) if fr else 0,
        "tris": int(st.median(tot_tris)) if fr else 0,
        "main_calls_tris": [med("main", 1), med("main", 2)],
        "ice_calls_tris": [med("ice", 1), med("ice", 2)],
        "fx_calls": med("fx", 1),
        "ice_pass_frames_pct": round(100 * ice_frames / max(1, len(fr))),
        "frames": len(fr),
        "cam": cam,
    }



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("label")
    ap.add_argument("--mobile", action="store_true")
    ap.add_argument("--zones", default=None)
    ap.add_argument("--dist", default=str(ROOT / "dist"))
    ap.add_argument("--ms", type=int, default=3000)
    a = ap.parse_args()
    zones = [float(z) for z in a.zones.split(",")] if a.zones else ZONES
    out = HERE / "out"
    out.mkdir(parents=True, exist_ok=True)

    res = {"label": a.label, "mobile": a.mobile, "zones": {}, "bridge": {}}
    with sync_playwright() as p:
        b = launch(p)
        kw = dict(width=390, height=844, dsf=2, mobile=True) if a.mobile else dict(width=1536, height=864, dsf=1.25)
        ctx, pg, errs = open_site(b, a.dist, **kw)
        # kapan tirai loader kebuka vs kapan tekstur baru kelar (timeline performance.now)
        res["intro_open_ms"] = round(pg.evaluate("window.__ice.introState.t0"))
        res["warm"] = pg.evaluate("window.__ice.warm ? {done: window.__ice.warm.done, at: Math.round(window.__ice.warm.at || 0)} : null")
        res["texture_loaded_ms"] = pg.evaluate("""Object.fromEntries(performance.getEntriesByType('resource')
            .filter(r => /textures\\//.test(r.name)).map(r => [r.name.split('/').pop(), Math.round(r.responseEnd)]))""")
        time.sleep(1.0)
        pg.evaluate(INSTALL)
        res["programs_idle"] = pg.evaluate(PROGS)
        res["dpr"] = pg.evaluate("window.__caught.renderers[0].getPixelRatio()")
        res["canvas"] = pg.evaluate("[window.__caught.renderers[0].domElement.width, window.__caught.renderers[0].domElement.height]")
        progs = []
        for z in zones:
            freeze(pg, z, settle=1.6)
            row = frame_stats(pg, a.ms)
            row["programs"] = pg.evaluate(PROGS)
            progs.append(row["programs"])
            res["zones"][str(z)] = row
            print(z, row, flush=True)
        # sisa loop: jembatan balik ke hero, lalu hero lagi (program gak boleh nambah)
        for br in BRIDGE:
            freeze(pg, 1.0, bridge=br, settle=1.0)
            row = frame_stats(pg, 800)
            row["programs"] = pg.evaluate(PROGS)
            progs.append(row["programs"])
            res["bridge"][str(br)] = {k: row[k] for k in ("calls", "tris", "programs", "cam")}
        freeze(pg, 0, settle=1.0)
        progs.append(pg.evaluate(PROGS))
        res["programs_loop"] = progs
        res["programs_constant"] = len(set(progs + [res["programs_idle"]])) == 1
        ents = pg.evaluate("""performance.getEntriesByType('resource').map(r => [r.name.replace(location.origin, ''),
            Math.round((r.transferSize || r.encodedBodySize || 0) / 1024)])""")
        res["transfer_kb"] = sum(k for _, k in ents)
        res["resources_over_20kb"] = sorted([e for e in ents if e[1] >= 20], key=lambda e: -e[1])
        res["errors"] = errs
        ctx.close()
        b.close()

    (out / f"perf_{a.label}.json").write_text(json.dumps(res, indent=1))
    print("programs:", res["programs_loop"], "constant:", res["programs_constant"])
    print("transfer KB:", res["transfer_kb"], "| errors:", errs or "none")
    print("textures:", res["texture_loaded_ms"], "intro opens at", res["intro_open_ms"], "warm", res["warm"])


if __name__ == "__main__":
    main()
