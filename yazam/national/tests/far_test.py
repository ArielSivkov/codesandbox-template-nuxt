#!/usr/bin/env python3
"""לפני/אחרי לתוסף "טבעות מרחק" בעולם המאוחד, מאותן נקודות מבט כמו צילומי אריאל (מבט-על מעל אשדוד, נמל):
מסך 360×800, האטת מעבד ×6 (CDP), מדידת פריימים 12 ש', קריאות ציור/משולשים של המארח, צילום לפני ואחרי.
הרצה: /home/claude/swarm/bin/browser-slot python3 tests/far_test.py   → tests/far_result.json, shots/far_*.png
הערה: הדפדפן כאן מצייר בתוכנה (SwiftShader) – הפריימים לשנייה אינם מספר של טלפון; קריאות/משולשים כן משמעותיים."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = "/home/claude/swarm"; PORT = 8834
HERE = os.path.dirname(os.path.abspath(__file__)); SHOTS = os.path.join(HERE, "..", "shots")
PLUGIN = os.path.join(HERE, "..", "host-plugin", "national-far.js")
VIEWS = [("quarter", "164751,634164,700"), ("port", "162600,636500,1500")]   # מסגרת הדגימה של המשחק (E,N,מרחק)

MEASURE = """(ms) => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })"""
STATS = """(() => { const w = YZW.world, s = w.stats, W = w.G27.W; return { fps_host: +s.fps.toFixed(2), calls: s.calls, tris: s.tris, heapMB: s.heapMB, tiles: W.tiles.size, radius: W.radius, hiRadius: W.hiRadius,
  far: w.nationalFar ? w.nationalFar.stats : null, pending: W.pending() }; })()"""


def settle(pg, sec=25):
    t0 = time.time()
    while time.time() - t0 < 120:
        if pg.evaluate("YZW.world.G27.W.pending()") == 0 and time.time() - t0 > sec * 0.4: break
        time.sleep(1)
    time.sleep(sec * 0.2)


def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    res = {}
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"])
            for name, at in VIEWS:
                ctx = br.new_context(viewport={"width": 360, "height": 800}, device_scale_factor=1, is_mobile=True, has_touch=True)
                ctx.add_init_script("window.YZ_NATIONAL_DATA = '/national/data/';")
                pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
                cdp = ctx.new_cdp_session(pg)
                t0 = time.time()
                pg.goto(f"http://127.0.0.1:{PORT}/integration/world/index.html?auto=1&nointro=1&view=eye&at={at}&tier=medium", wait_until="load")
                pg.wait_for_function("window.YZW && YZW.ready && YZW.world.stats.startMs", timeout=300000)
                r = {"boot_s": round(time.time() - t0, 1)}
                settle(pg)
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": 6})
                r["before"] = {"fps_raf_6x": round(pg.evaluate(MEASURE, 12000), 2), **pg.evaluate(STATS)}
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
                pg.screenshot(path=os.path.join(SHOTS, f"far_{name}_before.png"), timeout=240000)
                t1 = time.time()
                pg.add_script_tag(path=PLUGIN)
                pg.wait_for_function("YZW.world.nationalFar && YZW.world.nationalFar.stats.firstFrameMs", timeout=240000)
                r["plugin_first_frame_s"] = round(time.time() - t1, 1)
                settle(pg)
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": 6})
                r["after"] = {"fps_raf_6x": round(pg.evaluate(MEASURE, 12000), 2), **pg.evaluate(STATS)}
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
                pg.screenshot(path=os.path.join(SHOTS, f"far_{name}_after.png"), timeout=240000)
                r["plugin_state"] = pg.evaluate("YZW.plugins().find(p => p.id === 'national-far')")
                r["errors"] = errs[:6]
                res[name] = r; print(name, json.dumps(r, ensure_ascii=False)); ctx.close()
            br.close()
    finally:
        srv.terminate()
    json.dump(res, open(os.path.join(HERE, "far_result.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
