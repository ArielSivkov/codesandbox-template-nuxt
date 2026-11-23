"""יוצר קובץ ייחוס בלתי תלוי למודול השמש (physics/src/sun.js).

מקור הייחוס: NREL SPA — Reda & Andreas, "Solar Position Algorithm for Solar Radiation
Applications", NREL/TP-560-34302 (2008), דיוק ±0.0003° בשנים 2000−+6000,
במימוש pvlib.solarposition.spa_python (pvlib, רישיון BSD-3).

הרצה:  pip install pvlib  &&  python twin/physics/tools/make_spa_reference.py
פלט:   twin/physics/test/spa_reference.json  (מספרים מחושבים — לא נתונים מומצאים)

הערות:
- delta_t = 69 שניות (ערך IERS טיפוסי ל-2020; המודול שלנו מתעלם מ-ΔT – קירוב [A1]).
- pvlib 'elevation' = גובה טופוצנטרי בלי שבירה (כולל פרלקסה) → משווים ל-elevationGeometric
  של sun.js עם parallax:true.
- זריחה/שקיעה: sun_rise_set_transit_spa (קצה עליון, 0.8333° מתחת לאופק, כמו NOAA/USNO).
"""
import json
import pathlib

import numpy as np
import pandas as pd
import pvlib

SITES = {  # קואורדינטות WGS84 של מרכזי ערים (מעוגלות; לבדיקת אלגוריתם בלבד)
    "ashdod": (31.8014, 34.6435),
    "jerusalem": (31.7683, 35.2137),
    "eilat": (29.5577, 34.9519),
    "metula": (33.2800, 35.5790),
}
DELTA_T = 69.0


def main():
    rng = np.random.default_rng(27)  # זרע קבוע → קובץ זהה בכל הרצה
    out = {"source": "NREL SPA (Reda & Andreas 2008) via pvlib %s spa_python, delta_t=%.0f s" % (pvlib.__version__, DELTA_T),
           "positions": [], "sunTimes": []}
    # 400 רגעים אקראיים 2000–2035, רק כשהשמש מעל −2° (מה שרלוונטי לצל ולאור)
    t0 = pd.Timestamp("2000-01-01", tz="UTC").value // 10**6
    t1 = pd.Timestamp("2035-12-31", tz="UTC").value // 10**6
    for name, (lat, lon) in SITES.items():
        ms = np.sort(rng.integers(t0, t1, 400))
        idx = pd.DatetimeIndex(pd.to_datetime(ms, unit="ms", utc=True))
        sp = pvlib.solarposition.spa_python(idx, lat, lon, altitude=0, delta_t=DELTA_T)
        for m, el, az in zip(ms, sp["elevation"].values, sp["azimuth"].values):
            if el > -2:
                out["positions"].append({"site": name, "lat": lat, "lon": lon, "ms": int(m),
                                         "elevation": round(float(el), 5), "azimuth": round(float(az), 5)})
        # זריחה/שקיעה: היום ה-1 וה-21 בכל חודש של 2026
        days = pd.DatetimeIndex([pd.Timestamp(2026, mo, d, 12, tz="Asia/Jerusalem") for mo in range(1, 13) for d in (1, 21)])
        rs = pvlib.solarposition.sun_rise_set_transit_spa(days, lat, lon, delta_t=DELTA_T)
        for day, (_, r) in zip(days, rs.iterrows()):
            out["sunTimes"].append({"site": name, "lat": lat, "lon": lon, "y": day.year, "m": day.month, "d": day.day,
                                    "sunrise": int(r["sunrise"].value // 10**6), "sunset": int(r["sunset"].value // 10**6),
                                    "transit": int(r["transit"].value // 10**6)})
    p = pathlib.Path(__file__).resolve().parent.parent / "test" / "spa_reference.json"
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(p, len(out["positions"]), "positions,", len(out["sunTimes"]), "days")


if __name__ == "__main__":
    main()
