#!/usr/bin/env python3
"""The CONTINUOUS process: each run picks the next cities from the queue, builds them,
records progress, and (in CI) the workflow uploads the changed tiles to R2.

  python run_queue.py --max-cities 2 --osm pbf --pbf israel.osm.pbf --dem cop30 [--overture]
  python run_queue.py --status            # print progress table

Selection order each run:
  1. cities that failed (< 3 attempts), 2. never-built cities in wave/priority order,
  3. built cities older than --refresh-days (OSM changes daily; corrections arrive constantly).

progress.json (committed back to the repo by the workflow = the public progress manifest):
{
 "v": 1, "updated_at": "...", "pipeline": "0.1.0",
 "cities": {
   "ashdod": {"name_he": "אשדוד", "wave": 1, "priority": 1, "status": "built",
              "attempts": 1, "last_built": "...", "error": null,
              "stats": {"buildings": 7427, "tiles": 79, "confidence": {...}, "height_primary_source": {...}}}
 },
 "totals": {"cities_built": 1, "cities_total": 24, "buildings": 7427, "share_conf_high_or_better": 0.006}
}
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_city  # noqa: E402
from yazam import __version__  # noqa: E402


def now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_progress(path, cities):
    p = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {"v": 1, "cities": {}}
    for i, c in enumerate(cities):
        e = p["cities"].setdefault(c["slug"], {"status": "queued", "attempts": 0, "last_built": None, "error": None})
        e.update({"name_he": c["name_he"], "wave": c.get("wave", 9), "priority": c.get("priority", i + 1)})
    return p


def renewal_priority(cities, csv_path):
    """Re-rank by number of declared urban-renewal complexes per city in the official CSV
    (the same file the current map can load). Column with the city name is auto-detected."""
    raw = open(csv_path, "rb").read()
    try:
        txt = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        txt = raw.decode("cp1255")
    rows = list(csv.DictReader(io.StringIO(txt)))
    col = next((k for k in rows[0] if k and any(w in k for w in ("ישוב", "יישוב", "עיר", "רשות"))), None)
    cnt = {}
    for r in rows:
        name = (r.get(col) or "").strip()
        cnt[name] = cnt.get(name, 0) + 1
    for c in cities:
        c["renewal_complexes"] = cnt.get(c["name_he"], 0)
    ranked = sorted(cities, key=lambda c: (c.get("wave", 9), -c["renewal_complexes"]))
    for i, c in enumerate(ranked):
        c["priority"] = i + 1
    return ranked


def pick(progress, cities, n, refresh_days):
    by = {c["slug"]: c for c in cities}
    ent = progress["cities"]
    failed = [s for s, e in ent.items() if e["status"] == "failed" and e["attempts"] < 3 and s in by]
    queued = [s for s, e in ent.items() if e["status"] == "queued" and s in by]
    limit = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=refresh_days)
    stale = [s for s, e in ent.items() if e["status"] == "built" and e["last_built"]
             and dt.datetime.strptime(e["last_built"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc) < limit]
    key = lambda s: (ent[s]["wave"], ent[s]["priority"])
    return (sorted(failed, key=key) + sorted(queued, key=key) + sorted(stale, key=key))[:n]


def totals(p):
    built = [e for e in p["cities"].values() if e["status"] == "built"]
    nb = sum(e.get("stats", {}).get("buildings", 0) for e in built)
    good = sum(e.get("stats", {}).get("confidence", {}).get(k, 0) for e in built for k in ("מאומת", "גבוה"))
    return {"cities_built": len(built), "cities_total": len(p["cities"]), "buildings": nb,
            "share_conf_high_or_better": round(good / nb, 4) if nb else 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-cities", type=int, default=2)
    ap.add_argument("--refresh-days", type=int, default=30)
    ap.add_argument("--progress", default=os.path.join(HERE, "progress.json"))
    ap.add_argument("--renewal-csv")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--only", help="comma separated slugs to force")
    args, passthrough = ap.parse_known_args()
    cities = json.load(open(os.path.join(HERE, "cities.json"), encoding="utf-8"))["cities"]
    if args.renewal_csv:
        cities = renewal_priority(cities, args.renewal_csv)
    prog = load_progress(args.progress, cities)
    if args.status:
        for s, e in sorted(prog["cities"].items(), key=lambda kv: (kv[1]["wave"], kv[1]["priority"])):
            st = e.get("stats", {})
            print(f'{e["wave"]} {e["priority"]:>2} {s:16s} {e["status"]:8s} {st.get("buildings", "-"):>7} {e.get("last_built") or ""}')
        return
    todo = args.only.split(",") if args.only else pick(prog, cities, args.max_cities, args.refresh_days)
    print("this run:", todo)
    for slug in todo:
        e = prog["cities"][slug]
        e["status"], e["attempts"] = "running", e.get("attempts", 0) + 1
        json.dump(prog, open(args.progress, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        try:
            m = build_city.main(["--city", slug] + passthrough)
            e.update({"status": "built", "last_built": now(), "error": None, "attempts": 0,
                      "stats": {k: m["stats"][k] for k in ("buildings", "tiles", "area_km2", "confidence",
                                                            "height_primary_source", "land_qa")},
                      "boundary_kind": m["boundary_kind"], "sources": m["sources"]})
            q = m["stats"]["land_qa"]
            if q["sea_components"] > 3 or q["buildings_in_sea"] > max(5, 0.002 * m["stats"]["buildings"]):
                e["warning"] = f"land/sea QA: {q}"
        except Exception as ex:
            e.update({"status": "failed", "error": f"{type(ex).__name__}: {ex}"[:500]})
            traceback.print_exc()
        prog["updated_at"], prog["pipeline"], prog["totals"] = now(), __version__, totals(prog)
        json.dump(prog, open(args.progress, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(prog["totals"], ensure_ascii=False))
    if any(prog["cities"][s]["status"] == "failed" for s in todo):
        sys.exit(1)


if __name__ == "__main__":
    main()
