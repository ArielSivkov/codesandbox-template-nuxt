#!/usr/bin/env python3
"""בדיקת זרימת אריחים בקנה מידה של 100 ק"מ – זיכרון, אין קפיאה, ניסיון חוזר, פריקה.

תרחישים (360×800, tier=low כדי שהרינדור התוכנתי לא ישלוט בזמנים):
  A. מסלול 50 ק"מ ברחוב (גובה 900 מ'): אשדוד → צפונה לאורך החוף עד ת"א, 26 קפיצות של 2 ק"מ.
     מודדים בכל עצירה: אריחים במפה/נטענו/נדרשו, גאומטריות ב-GPU, ערימת JS, הפריים מתקדם (לא קפוא).
  B. קפיצה אחת של 50 ק"מ (אשדוד → ת"א) ובחזרה – אין דליפה: גאומטריות וערימה חוזרות לטווח.
  C. אופליין: חוסמים את כל /tiles/ ל-20 ש' → שגיאות נספרות, הפריים ממשיך; משחררים → האריחים נטענים (ניסיון חוזר).
  D. אריח פגום (רשומת בניין בלי r) – מוזרק דרך route → האריח נבנה בלי הרשומה, אין חריגה.
פלט: tests/stream_result.json"""
import gzip, json, os, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8830/index.html?nointro=1&tier=low&at=haerez&dist=900"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stream_result.json")
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info", "--js-flags=--expose-gc"]


def snap(pg):
    return pg.evaluate("""(()=>{ if (window.gc) gc(); const s = NAT.stats(); return {frames:s.frames, tilesInMap:s.tilesInMap, loaded:s.loaded, wanted:s.wanted, err:s.tileErr,
      geoms:s.geoms, texs:s.texs, heapMB: s.heapMB, calls:s.calls, tris:s.tris, lastErr:s.lastErr||null, longFrames:s.longFrames, maxFrameMs:Math.round(s.maxFrameMs), net:s.netBytes}; })()""")


def wait_loaded(pg, timeout=90, f0=None):
    """אחרי קפיצה: מחכים קודם ששני פריימים יעברו (כדי שהסטטוס יתעדכן למקום החדש), ורק אז לטעינה מלאה."""
    t0 = time.time()
    if f0 is not None:
        while time.time() - t0 < timeout and pg.evaluate("NAT.status.frames") < f0 + 2:
            time.sleep(0.2)
    while time.time() - t0 < timeout:
        s = pg.evaluate("NAT.stats()")
        if s.get("wanted", 0) and s.get("loaded", 0) >= s.get("wanted", 0) and not pg.evaluate("[...NAT.tiles.values()].some(t=>t.state==='load')"):
            return time.time() - t0
        time.sleep(0.25)
    return None


def main():
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else ["A", "B", "C", "D"]
    res = json.load(open(OUT)) if os.path.exists(OUT) and "--only" in sys.argv else {"scenario": {}}
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=ARGS)
        ctx = br.new_context(viewport={"width": 360, "height": 800}, device_scale_factor=1, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE)
        pg.wait_for_function("window.NAT && NAT.ready", timeout=120000)
        pg.evaluate("NAT.C.heading = 0")
        wait_loaded(pg)
        start = snap(pg)
        # ---------------- A: 50 ק"מ ברחוב, 26 קפיצות של 2 ק"מ צפונה-צפון-מזרח (אשדוד → ת"א)
        E0, N0 = 166273, 634930
        steps = []
        for i in (range(1, 27) if "A" in only else []):
            E, N = E0 + i * 2000 * 0.37, N0 + i * 2000 * 0.93
            f0 = pg.evaluate("NAT.status.frames")
            pg.evaluate(f"NAT.jumpITM({E}, {N}, 900)")
            dt = wait_loaded(pg, f0=f0)
            time.sleep(0.3)
            s = snap(pg); s["step"] = i; s["E"] = round(E); s["N"] = round(N); s["load_s"] = None if dt is None else round(dt, 2)
            s["frames_advanced"] = s["frames"] - f0
            steps.append(s)
            print("A", i, json.dumps(s))
        if "A" in only: res["scenario"]["A_walk_50km"] = {"start": start, "steps": steps,
            "max_tiles_in_map": max(x["tilesInMap"] for x in steps), "max_geoms": max(x["geoms"] for x in steps),
            "max_heapMB": round(max(x["heapMB"] or 0 for x in steps), 1), "end_heapMB": round(steps[-1]["heapMB"] or 0, 1),
            "frozen_steps": sum(1 for x in steps if x["frames_advanced"] <= 0), "unloaded_steps": sum(1 for x in steps if x["load_s"] is None),
            "median_load_s": sorted(x["load_s"] for x in steps if x["load_s"] is not None)[len(steps) // 2]}
        # ---------------- B: קפיצה של 50 ק"מ וחזרה, 3 פעמים
        b = []
        for k in (range(3) if "B" in only else []):
            pg.evaluate(f"NAT.jumpITM({E0 + 18500}, {N0 + 46500}, 900)"); wait_loaded(pg); time.sleep(0.3); b.append(snap(pg))
            pg.evaluate(f"NAT.jumpITM({E0}, {N0}, 900)"); wait_loaded(pg); time.sleep(0.3); b.append(snap(pg))
        if "B" in only: res["scenario"]["B_jump_50km_x3"] = {"snaps": b, "geoms": [x["geoms"] for x in b], "heapMB": [round(x["heapMB"] or 0, 1) for x in b]}
        if "B" in only: print("B", json.dumps(res["scenario"]["B_jump_50km_x3"]["geoms"]), res["scenario"]["B_jump_50km_x3"]["heapMB"])
        # ---------------- C: אופליין 20 ש' ואז חזרה
        if "C" in only:
            blocked = {"n": 0}
            def block(route):
                blocked["n"] += 1; route.abort()
            pg.route("**/tiles/**", block)
            pg.evaluate(f"NAT.jumpITM({E0 + 9000}, {N0 + 22000}, 900)")
            f0 = pg.evaluate("NAT.status.frames"); time.sleep(20)
            c1 = snap(pg); c1["frames_advanced"] = c1["frames"] - f0; c1["blocked_requests"] = blocked["n"]
            pg.unroute("**/tiles/**")
            pg.evaluate("NAT.wake(3000)")
            dt = wait_loaded(pg, timeout=120)
            c2 = snap(pg); c2["recovered_s"] = None if dt is None else round(dt, 1)
            res["scenario"]["C_offline_retry"] = {"during": c1, "after": c2}
            print("C", json.dumps(res["scenario"]["C_offline_retry"]))
        # ---------------- D: אריח פגום (רשומה בלי r, רשומה ריקה, ושם/מזהה עם HTML) – ברחובות, אריחים שלא נטענו קודם
        if "D" in only:
            served = {"n": 0}
            def bad(route):
                r = route.fetch(); body = r.body()
                try:
                    v = json.loads(gzip.decompress(body))
                    if v.get("b"):
                        v["b"][0].pop("r", None); v["b"].append({"i": "w0"})
                        v["b"].append({"i": "<img src=x onerror=window.__xss=1>", "n": "<img src=x onerror=window.__xss=1>", "t": "<b>x</b>", "r": [[0, 0, 100, 0, 0, 100]], "h": "x"})
                    body = gzip.compress(json.dumps(v).encode()); served["n"] += 1
                except Exception:
                    pass
                route.fulfill(status=200, body=body, headers={"content-type": "application/octet-stream"})
            pg.route("**/tiles/v/**", bad)
            f0 = pg.evaluate("NAT.status.frames")
            pg.evaluate("NAT.jumpITM(182050, 645050, 700)")
            dt = wait_loaded(pg, timeout=180, f0=f0)
            # פתיחת כרטיס הבניין "הזדוני" (אם נבנה) – הטקסט נכתב ב-textContent בלבד
            card = pg.evaluate("""(() => { for (const [k, t] of NAT.tiles) { if (!t.meta) continue; const i = t.meta.ids.indexOf('<img src=x onerror=window.__xss=1>'); if (i >= 0) return { tile: k, name: t.meta.names[i] }; } return null; })()""")
            d = snap(pg); d["load_s"] = None if dt is None else round(dt, 1); d["corrupted_tiles_served"] = served["n"]; d["evil_record_built"] = bool(card)
            time.sleep(1.0); d["xss"] = pg.evaluate("!!window.__xss")
            res["scenario"]["D_corrupt_tile"] = d
            print("D", json.dumps(d))
        res["page_errors"] = errs[:10]
        br.close()
    json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
