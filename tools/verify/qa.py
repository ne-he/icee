"""QA fitur v1 di dunia v2 (gate sebelum rilis).

    python tools/verify/qa.py --dist <dist> [--label qa]

Ngecek: 4 panel batu kebuka & ketutup (lewat __ice.open + Escape, dan lewat
tombol OPEN), chat buka-tutup, loop scroll dua arah nyebrang seam, snap ke
titik terdekat, zona tahan di wajah, program shader stabil, reduced motion,
tap OPEN di HP, nol error console.
Hasil: tools/verify/out/<label>/qa.json + screenshot.
"""
import argparse, json, pathlib, sys, time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from playwright.sync_api import sync_playwright  # noqa: E402
from icehelp import launch, open_site, smooth_scroll_to_depth  # noqa: E402

PROGS = "window.__caught.renderers[0].info.programs.length"
ROCKS = {"about": ([3.4, -7, -2], 0.2), "journey": ([-3.5, -14.5, -2], 0.4),
         "projects": ([4, -22, -3], 0.6), "skills": ([-3.2, -29, 0.5], 0.8)}

ap = argparse.ArgumentParser()
ap.add_argument("--dist", required=True)
ap.add_argument("--label", default="qa")
a = ap.parse_args()
out = HERE / "out" / a.label
out.mkdir(parents=True, exist_ok=True)
R = {"checks": [], "programs": {}}


def check(name, ok, info=""):
    R["checks"].append({"name": name, "ok": bool(ok), "info": str(info)[:200]})
    print(("PASS " if ok else "FAIL ") + name, info, flush=True)


with sync_playwright() as p:
    b = launch(p)
    ctx, pg, errs = open_site(b, a.dist, width=1440, height=860, dsf=1)
    time.sleep(1.5)
    y0 = pg.evaluate("window.scrollY")
    R["programs"]["idle"] = pg.evaluate(PROGS)

    # 4 panel lewat __ice.open, tutup pakai Escape
    for rid, (pos, d) in ROCKS.items():
        smooth_scroll_to_depth(pg, d, y0)
        time.sleep(3)
        pg.evaluate(f"window.__ice.open('{rid}', {pos})")
        time.sleep(2.8)
        ok = pg.evaluate("document.querySelector('.rock-modal')?.classList.contains('is-open')")
        h2 = pg.evaluate("document.querySelector('.rock-content h2')?.textContent")
        pg.screenshot(path=str(out / f"panel_{rid}.png"))
        pg.keyboard.press("Escape")
        time.sleep(2.8)
        ph = pg.evaluate("window.__ice.focusState.phase")
        check(f"panel {rid} buka+tutup", ok and ph == "idle", f"title={h2} phase={ph}")
    R["programs"]["after_panels"] = pg.evaluate(PROGS)

    # tombol OPEN (jalur HP & keyboard) di batu PROJECTS
    smooth_scroll_to_depth(pg, 0.6, y0)
    time.sleep(3.2)
    has_btn = pg.evaluate("!!document.querySelector('.rock-open')")
    if has_btn:
        pg.click(".rock-open")
        time.sleep(2.8)
        ok = pg.evaluate("document.querySelector('.rock-modal')?.classList.contains('is-open')")
        pg.click(".rock-close")
        time.sleep(2.8)
        check("tombol OPEN + CLOSE", ok and pg.evaluate("window.__ice.focusState.phase") == "idle")
    else:
        check("tombol OPEN ada", False)

    # chat buka-tutup
    pg.evaluate("window.__ice.openChat()")
    time.sleep(1.2)
    chat_open = pg.evaluate("window.__ice.chatState.open")
    pg.screenshot(path=str(out / "chat.png"))
    pg.evaluate("window.__ice.closeChat()")
    time.sleep(0.8)
    check("chat buka-tutup", chat_open and not pg.evaluate("window.__ice.chatState.open"))

    # loop maju: dari wajah terus scroll sampai hero putaran berikutnya
    smooth_scroll_to_depth(pg, 1.0, y0)
    time.sleep(3)
    pg.screenshot(path=str(out / "portrait.png"))
    P = pg.evaluate("Math.round(window.innerHeight*5.8)")
    y = pg.evaluate("window.scrollY")
    for i in range(12):
        pg.mouse.wheel(0, P * 0.2 / 12)
        time.sleep(0.12)
    time.sleep(4.5)
    st = pg.evaluate("({l: window.__ice.scrollState.loopDamped, b: window.__ice.scrollState.bridge})")
    pg.screenshot(path=str(out / "loop_forward.png"))
    check("loop maju mendarat di hero", st["b"] < 0.01 and (st["l"] < 0.02 or st["l"] > 0.98), st)

    # loop mundur: dari hero scroll ke atas nyebrang seam balik ke wajah
    for i in range(12):
        pg.mouse.wheel(0, -P * 0.2 / 12)
        time.sleep(0.12)
    time.sleep(4.5)
    st = pg.evaluate("({l: window.__ice.scrollState.loopDamped, d: window.__ice.scrollState.damped, b: window.__ice.scrollState.bridge})")
    pg.screenshot(path=str(out / "loop_backward.png"))
    check("loop mundur balik ke wajah/bridge anchor", st["b"] < 0.01 or st["b"] > 0.99 or st["d"] > 0.9, st)
    R["programs"]["after_loops"] = pg.evaluate(PROGS)

    # snap ke titik TERDEKAT (permintaan 2 Okt): dari SKILLS (304M) geser 30%
    # celah ke arah mana pun = balik ke SKILLS, geser 70% = pindah
    H = pg.evaluate("window.innerHeight")
    DES = 100 / 120

    def nudge(d0, frac, gap):
        smooth_scroll_to_depth(pg, d0, y0)
        time.sleep(3.5)
        for i in range(8):
            pg.mouse.wheel(0, frac * gap * DES * P / 8)
            time.sleep(0.02)
        time.sleep(4.5)
        return pg.evaluate("window.__ice.scrollState.damped")

    got = [nudge(0.8, 0.3, 0.115), nudge(0.8, -0.3, 0.2), nudge(0.8, 0.7, 0.115)]
    check("snap ke titik terdekat", abs(got[0] - 0.8) < 0.01 and abs(got[1] - 0.8) < 0.01 and abs(got[2] - 0.915) < 0.01, got)

    # zona tahan di wajah: geser ~0.2 layar turun, kartu kontak gak boleh pudar
    smooth_scroll_to_depth(pg, 1.0, y0)
    time.sleep(5)
    for i in range(8):
        pg.mouse.wheel(0, 0.2 * H / 8)
        time.sleep(0.02)
    time.sleep(0.5)
    card = pg.evaluate("+getComputedStyle(document.querySelector('.outro')).opacity")
    check("wajah ditahan pas geser dikit", card > 0.99, f"card={card}")
    time.sleep(4)
    check("program shader stabil", R["programs"]["after_loops"] == R["programs"]["idle"], R["programs"])
    check("nol error console (desktop)", not errs, errs[:3])
    ctx.close()

    # reduced motion: klik batu = crossfade (Dive.jsx ngecek matchMedia pas klik)
    ctx, pg, errs = open_site(b, a.dist, width=1280, height=800, dsf=1)
    pg.emulate_media(reduced_motion="reduce")
    time.sleep(1)
    y0 = pg.evaluate("window.scrollY")
    smooth_scroll_to_depth(pg, 0.2, y0)
    time.sleep(3)
    pg.evaluate("window.__ice.open('about', [3.4, -7, -2])")
    time.sleep(1.2)
    mode = pg.evaluate("window.__ice.focusState.mode")
    ok = pg.evaluate("document.querySelector('.rock-modal')?.classList.contains('is-open')")
    pg.keyboard.press("Escape")
    time.sleep(1.5)
    check("reduced motion: fade", mode == "fade" and ok, f"mode={mode}")
    check("nol error console (reduced)", not errs, errs[:3])
    ctx.close()

    # HP: tap OPEN
    ctx, pg, errs = open_site(b, a.dist, width=390, height=844, dsf=2, mobile=True)
    time.sleep(1.5)
    y0 = pg.evaluate("window.scrollY")
    pg.screenshot(path=str(out / "m_hero.png"))
    smooth_scroll_to_depth(pg, 0.4, y0)
    time.sleep(3.5)
    ok = False
    if pg.evaluate("!!document.querySelector('.rock-open')"):
        pg.tap(".rock-open")
        time.sleep(2.8)
        ok = pg.evaluate("document.querySelector('.rock-modal')?.classList.contains('is-open')")
        pg.screenshot(path=str(out / "m_panel.png"))
        pg.tap(".rock-close")
        time.sleep(2.8)
    check("HP tap OPEN", ok)
    check("nol error console (HP)", not errs, errs[:3])
    ctx.close()
    b.close()

R["pass"] = all(c["ok"] for c in R["checks"])
(out / "qa.json").write_text(json.dumps(R, indent=1))
print("ALL PASS" if R["pass"] else "ADA YANG GAGAL", "->", out / "qa.json")
