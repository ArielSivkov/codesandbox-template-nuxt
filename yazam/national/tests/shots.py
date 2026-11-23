#!/usr/bin/env python3
"""צילומי מסך 360×800 (DPR 2 כמו טלפון) – כדור, ישראל, אשדוד, הארז יום ולילה.
שרת: national/tools_serve.sh (127.0.0.1:8830).  python3 tests/shots.py [--only name]"""
import json, sys, time, os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8830/index.html"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shots")
SHOTS = [
    ("01_globe", "at=globe&t=2026-11-23T14:30:00%2B02:00"),
    ("02_globe_dusk_israel", "at=israel&dist=16000000&t=2026-11-23T16:50:00%2B02:00"),
    ("03_israel", "at=israel&t=2026-11-23T11:00:00%2B02:00"),
    ("04_ashdod_day", "at=ashdod&t=2026-11-23T15:20:00%2B02:00"),
    ("05_ashdod_night", "at=ashdod&t=2026-11-23T19:40:00%2B02:00"),
    ("06_haerez_day", "at=haerez&t=2026-11-23T11:30:00%2B02:00"),
    ("07_haerez_sunset", "at=haerez&t=2026-11-23T16:35:00%2B02:00"),
    ("08_haerez_night", "at=haerez&t=2026-11-23T20:30:00%2B02:00"),
]
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"]


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    os.makedirs(OUT, exist_ok=True)
    res = {}
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=ARGS)
        app_mtime = os.path.getmtime(os.path.join(OUT, "..", "web", "js", "app.js"))
        for name, q in SHOTS:
            if only and only not in name:
                continue
            png = os.path.join(OUT, name + ".png")
            if "--skip-existing" in sys.argv and os.path.exists(png) and os.path.getmtime(png) > app_mtime:
                print(name, "קיים – דילוג"); continue
            ctx = br.new_context(viewport={"width": 360, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
            t0 = time.time()
            pg.goto(f"{BASE}?{q}&tier=mid", wait_until="load")
            pg.wait_for_function("window.NAT && (window.NAT.ready || window.NAT.bootErr)", timeout=120000)
            # חכה לאריחים (אם יש) ולכמה פריימים
            deadline = time.time() + 120
            while time.time() < deadline:
                s = pg.evaluate("NAT.stats()")
                if s["frames"] > 12 and s.get("roadSegs") is not None and (s.get("wanted", 0) == 0 or s.get("loaded", 0) >= s.get("wanted", 0)):
                    break
                time.sleep(0.5)
            time.sleep(1.5)
            pg.evaluate("NAT.wake(8000)"); time.sleep(0.5)
            pg.screenshot(path=os.path.join(OUT, name + ".png"), timeout=240000)
            s = pg.evaluate("NAT.stats()")
            res[name] = {"seconds": round(time.time() - t0, 1), "errors": errs[:5], **{k: s.get(k) for k in ("mode", "calls", "tris", "geoms", "texs", "loaded", "wanted", "lamps", "builtBlocks", "heapMB", "netBytes", "fps", "lastErr", "roadSegs", "roadErr")}}
            print(name, json.dumps(res[name], ensure_ascii=False))
            ctx.close()
        br.close()
    json.dump(res, open(os.path.join(OUT, "shots.json" if not only else f"shots_{only}.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
