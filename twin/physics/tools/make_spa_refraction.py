"""ייחוס בלתי תלוי לשבירת אור תלוית מזג אוויר: NREL SPA (Reda & Andreas 2008, משוואות 41–42) דרך pvlib.
SPA מכפיל את השבירה ב-(P/1010)·(283/(273+T)) – אותה הנחה כמו Meeus פרק 16 (Saemundsson). כאן נבדק שהמשחק
(twin/integration/world/js/sim.js) והמודול הקנוני (physics/src/sun.js) מגיבים ללחץ ולטמפרטורה כמו SPA.
פלט: physics/test/spa_refraction_pt.json. הרצה: python3 twin/physics/tools/make_spa_refraction.py"""
import json, os
import numpy as np, pandas as pd
from pvlib import spa

LAT, LON = 31.8014, 34.6435          # אשדוד, רחוב הארז (כמו במשחק)
DT = 69.0                            # ΔT (שניות), כמו ב-spa_reference.json
P_HPA = [980.0, 1010.0, 1030.0]
T_C = [0.0, 10.0, 25.0, 40.0]
# שקיעות ב-4 עונות; נקודות כל 4 דקות מגובה גאומטרי ~15° ועד מתחת לאופק
DAYS = ['2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21']
rows = []
for day in DAYS:
    t = pd.date_range(day + ' 13:00', day + ' 17:30', freq='4min', tz='UTC')
    ut = np.asarray((t - pd.Timestamp('1970-01-01', tz='UTC')).total_seconds(), float)   # שניות יוניקס, בלי תלות ברזולוציה של pandas
    for P in P_HPA:
        for T in T_C:
            app_zen, zen, app_el, el, az, eot = spa.solar_position_numpy(ut, LAT, LON, 0.0, P, T, DT, 0.5667, numthreads=1)
            for i in range(len(ut)):
                if -0.5 <= el[i] <= 15.0:
                    rows.append({'ms': int(round(ut[i] * 1000)), 'p': P, 't': T,
                                 'elGeo': round(float(el[i]), 6), 'elApp': round(float(app_el[i]), 6)})
out = {'source': 'NREL SPA (Reda & Andreas 2008) via pvlib %s spa.solar_position_numpy, delta_t=69 s, atmos_refract=0.5667°' % __import__('pvlib').__version__,
       'site': {'lat': LAT, 'lon': LON}, 'note': 'SPA מוסיף שבירה רק כשהשמש מעל האופק הנראה (elGeo ≥ −0.8333°); נוסחת השבירה ב-SPA היא של Bennett, ב-NOAA פולינום אחר – השוואה מוחלטת ליד האופק בסף רחב יותר',
       'rows': rows}
p = os.path.join(os.path.dirname(__file__), '..', 'test', 'spa_refraction_pt.json')
json.dump(out, open(p, 'w'), separators=(',', ':'))
print(len(rows), 'שורות →', p)
