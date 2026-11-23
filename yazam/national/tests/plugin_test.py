#!/usr/bin/env python3
"""בדיקת התוסף במארח העולם המאוחד (בלי לשנות קבצים של מחלקת האינטגרציה):
שרת מקומי משורש swarm (אותו מקור לעולם ולשכבה הארצית), הזרקת host-plugin/national.js לדף integration/world/index.html,
כניסה למצב "מהחלל", קפיצה לרחוב הארז בשכבה, לחיצה על "כניסה לרחוב" → בדיקה שהשחקן הוצב במשחק בנקודה הנכונה
(מסגרת הדגימה = ITM אמיתי − (1524.6, 753.6)), ובדיקה שנקודה בתל אביב (מחוץ לאריחי המשחק) לא נמסרת.
הרצה:  /home/claude/swarm/bin/browser-slot python3 tests/plugin_test.py      פלט: tests/plugin_result.json"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = "/home/claude/swarm"
PORT = 8833
HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..", "host-plugin", "national.js")
OUT = os.path.join(HERE, "plugin_result.json")


def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    res = {"ok": False}
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            ctx = br.new_context(viewport={"width": 360, "height": 800}, device_scale_factor=1, is_mobile=True, has_touch=True)
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
            ctx.add_init_script("window.YZ_NATIONAL_SRC = '/national/web/index.html';")
            t0 = time.time()
            pg.goto(f"http://127.0.0.1:{PORT}/integration/world/index.html?auto=1&nointro=1&tier=low", wait_until="load")
            pg.wait_for_function("window.YZW && YZW.ready && YZW.world.stats.startMs", timeout=240000)
            res["world_boot_s"] = round(time.time() - t0, 1)
            pg.add_script_tag(path=PLUGIN)
            pg.wait_for_function("YZW.modes().some(m => m.id === 'globe' && m.available)", timeout=30000)
            res["plugin"] = pg.evaluate("YZW.plugins().find(p => p.id === 'national')")
            ok = pg.evaluate("YZW.setMode('globe')")
            res["enter_globe"] = ok
            pg.wait_for_selector("iframe[title='ישראל מלמעלה']", timeout=20000)
            res["paused_while_overlay"] = pg.evaluate("YZW.paused")
            fr = pg.frame_locator("iframe[title='ישראל מלמעלה']")
            frame = [f for f in pg.frames if "national/web" in f.url][0]
            frame.wait_for_function("window.NAT && NAT.ready", timeout=180000)
            res["iframe_url"] = frame.url.split("?")[0].replace(f"http://127.0.0.1:{PORT}", "")
            # 1) תל אביב – מחוץ לאריחי המשחק: לא נמסר
            frame.evaluate("NAT.jumpITM(179400, 665300, 600)")
            frame.wait_for_function("document.getElementById('handoff').style.display === 'block'", timeout=60000)
            fr.locator("#handoff").click()
            time.sleep(1.5)
            res["tel_aviv_refused"] = pg.evaluate("YZW.mode() === 'globe' && !!document.querySelector(\"iframe[title='ישראל מלמעלה']\")")
            # 2) רחוב הארז – נמסר
            E, N = 166273.0, 634930.0
            frame.evaluate(f"NAT.jumpITM({E}, {N}, 600)")
            time.sleep(1.0)
            frame.wait_for_function("document.getElementById('handoff').style.display === 'block'", timeout=60000)
            fr.locator("#handoff").click()
            pg.wait_for_function("YZW.mode() === 'walk' && !document.querySelector(\"iframe[title='ישראל מלמעלה']\")", timeout=30000)
            time.sleep(1.0)
            got = pg.evaluate("(() => { const w = YZW.world, p = w.player.pos, it = w.coords.toITM(p.x, p.z); return { E: it.E, N: it.N, handoff: w.national && w.national.lastHandoff, paused: YZW.paused }; })()")
            exp = [E - 1524.6, N - 753.6]
            got["expected_game_frame"] = exp
            got["dist_m"] = round(((got["E"] - exp[0]) ** 2 + (got["N"] - exp[1]) ** 2) ** 0.5, 2)
            res["haerez_handoff"] = got
            res["page_errors"] = errs[:8]
            res["ok"] = bool(res["enter_globe"] and res["paused_while_overlay"] and res["tel_aviv_refused"] and got["dist_m"] < 15 and not got["paused"])
            pg.screenshot(path=os.path.join(HERE, "..", "shots", "09_handoff_in_world.png"), timeout=240000)
            br.close()
    finally:
        srv.terminate()
    json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
