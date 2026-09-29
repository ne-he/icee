"""Cek visibilitas mesh dunia per posisi kamera, dasar aturan culling zona di
world/World.jsx. Tiap titik scroll (descend + jembatan loop): scene dirender
offscreen dua kali, (1) semua benda opaque KECUALI grup yang dicek, cuma buat
ngisi depth, lalu (2) grup itu sendirian warna magenta dengan depth test. Jumlah
piksel magenta = berapa piksel grup itu beneran kelihatan dari kamera itu.
Nol di semua sampel = aman disembunyiin di rentang posisi kamera itu.

    python tools/verify/visibility.py <label> --dist <dist> [--mobile] [--step 0.01]

Hasil: tools/verify/out/vis_<label>.json (+ ringkasan batas y di stdout).
Catatan: grup dicari lewat bounding box geometri (lihat TAG), jadi tetep jalan
walau jumlah vertex atau jumlah chunk-nya beda per tier.
"""
import argparse, json, pathlib, sys, time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from playwright.sync_api import sync_playwright  # noqa: E402
from icehelp import launch, open_site, freeze  # noqa: E402

# grup mesh dunia (material vertexColors) dari bounding box. userData.zone
# dipakai kalau ada (dipasang World.jsx), fallback ke tebakan ukuran
TAG = """() => { const g = {ground: [], mtn: [], walls: [], floor: []}; const main = window.__caught.scenes.find(s => s.children.length > 8);
  main.traverse(o => { if (!o.isMesh || !o.material || !o.material.vertexColors || o.material.type !== 'MeshStandardMaterial') return;
    if (o.userData.zone && g[o.userData.zone]) { g[o.userData.zone].push(o); return; }
    o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
    if (bb.max.x > 300 || bb.min.x < -300) g.mtn.push(o);
    else if (bb.max.x - bb.min.x > 150) g.ground.push(o);
    else if (bb.min.y < -45 && bb.max.y - bb.min.y < 20) g.floor.push(o);
    else g.walls.push(o); });
  window.__vgrp = g; window.__vmain = main;
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.length])) }"""

COUNT = """(names) => { const r = window.__caught.renderers[0]; const T = window.__vT; const cam = window.__pf ? window.__pf.cam : null;
  if (!cam) return null;
  const scene = window.__vmain;
  if (!window.__vrt) {
    window.__vrt = new T.WebGLRenderTarget(Math.round(r.domElement.width / 2), Math.round(r.domElement.height / 2));
    window.__vblack = new T.MeshBasicMaterial({ color: 0x000000, fog: false });
    window.__vmag = new T.MeshBasicMaterial({ color: 0xff00ff, fog: false });
  }
  const rt = window.__vrt, W = rt.width, H = rt.height;
  const px = new Uint8Array(W * H * 4);
  const all = []; scene.traverse(o => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) all.push([o, o.visible]); });
  const prevT = r.getRenderTarget(), prevAC = r.autoClear, prevO = scene.overrideMaterial, prevBg = scene.background;
  const out = {};
  for (const name of names) {
    const grp = new Set(window.__vgrp[name]);
    // (1) depth dari semua opaque selain grup ini (sky/deepwater = quad di bidang far, bukan penghalang)
    for (const [o, v] of all) {
      const m = o.material; const tr = Array.isArray(m) ? m.some(x => x.transparent) : m && m.transparent;
      o.visible = v && o.isMesh && !tr && !grp.has(o) && o.renderOrder > -1000;
    }
    scene.overrideMaterial = window.__vblack; scene.background = null;
    r.setRenderTarget(rt); r.autoClear = true; r.setClearColor(0x000000, 1); r.clear(); r.render(scene, cam);
    // (2) grup ini doang, magenta, depth test ke hasil (1)
    for (const [o, v] of all) o.visible = v && grp.has(o);
    scene.overrideMaterial = window.__vmag; r.autoClear = false; r.render(scene, cam);
    r.readRenderTargetPixels(rt, 0, 0, W, H, px);
    let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200) n++;
    out[name] = n;
  }
  for (const [o, v] of all) o.visible = v;
  scene.overrideMaterial = prevO; scene.background = prevBg; r.autoClear = prevAC; r.setRenderTarget(prevT);
  out.y = +cam.position.y.toFixed(2); out.z = +cam.position.z.toFixed(2); out.x = +cam.position.x.toFixed(2);
  return out; }"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("label")
    ap.add_argument("--dist", required=True)
    ap.add_argument("--mobile", action="store_true")
    ap.add_argument("--step", type=float, default=0.01)
    a = ap.parse_args()
    out = HERE / "out"
    out.mkdir(parents=True, exist_ok=True)
    samples = []
    with sync_playwright() as p:
        b = launch(p)
        kw = dict(width=390, height=844, dsf=2, mobile=True) if a.mobile else dict(width=1536, height=864, dsf=1.25)
        ctx, pg, errs = open_site(b, a.dist, **kw)
        time.sleep(1)
        # kamera r3f gak ada di window: tangkep dari panggilan gl.render berikutnya
        pg.evaluate("""() => { const r = window.__caught.renderers[0]; window.__pf = window.__pf || {cam: null};
          if (!r.__visWrap) { r.__visWrap = true; const o = r.render.bind(r);
            r.render = (s, c) => { if (c && c.isPerspectiveCamera && s.children.length > 8) window.__pf.cam = c;
              const t = r.getRenderTarget(); if (t) window.__rtC = t.constructor; o(s, c); }; } }""")
        time.sleep(0.5)
        print(pg.evaluate(TAG))
        # konstruktor THREE diambil dari objek yang ada di scene (bundle gak ngekspos THREE)
        pg.evaluate("""() => { let basic = null;
          window.__vmain.traverse(o => { if (!basic && o.isMesh && o.material && o.material.type === 'MeshBasicMaterial') basic = o.material; });
          window.__vT = { MeshBasicMaterial: basic && basic.constructor, WebGLRenderTarget: window.__rtC }; }""")
        ok = pg.evaluate("!!(window.__vT.MeshBasicMaterial && window.__vT.WebGLRenderTarget)")
        if not ok:
            raise SystemExit("gak nemu konstruktor WebGLRenderTarget di halaman")
        names = ["ground", "mtn", "walls", "floor"]
        pts = [(round(i * a.step, 4), 0.0) for i in range(int(1 / a.step) + 1)]
        pts += [(1.0, round(i * 0.04, 3)) for i in range(1, 25)]
        for d, br in pts:
            freeze(pg, d, bridge=br, settle=0.35)
            row = pg.evaluate(COUNT, names)
            row["d"], row["bridge"] = d, br
            samples.append(row)
            print(row, flush=True)
        ctx.close()
        b.close()
    res = {"label": a.label, "mobile": a.mobile, "samples": samples}
    # batas: y kamera terendah yang masih lihat ground / mtn
    for k in ("ground", "mtn", "walls", "floor"):
        vis = [s["y"] for s in samples if s[k] > 0]
        hid = [s["y"] for s in samples if s[k] == 0]
        res[k] = {"min_y_visible": min(vis) if vis else None, "max_y_hidden": max(hid) if hid else None}
    (out / f"vis_{a.label}.json").write_text(json.dumps(res, indent=1))
    for k in ("ground", "mtn", "walls", "floor"):
        print(k, res[k])
    print("errors:", errs or "none")


if __name__ == "__main__":
    main()
