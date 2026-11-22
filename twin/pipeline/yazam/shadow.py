"""Height from shadow length in a dated satellite / aerial image.

H = L * tan(sun_elevation)   (flat ground, shadow measured along the sun azimuth, from the
                              building's sun-facing roof edge to the shadow tip)
For an off-nadir sensor the roof is displaced; measure the shadow on the GROUND only (from the
footprint edge to the tip) – the footprint from OSM gives the edge.

Error propagation: dH = sqrt((tan(e)*dL)^2 + (L*sec^2(e)*de)^2). With 0.5 m pixels, dL ~ 1 px
and sun elevation known to ~0.1 deg the length term dominates.

sun_position() is the NOAA low-precision algorithm (~0.01 deg), no dependencies.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone


def sun_position(dt_utc: datetime, lat: float, lon: float):
    """Return (elevation_deg, azimuth_deg_from_north_clockwise)."""
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    dt_utc = dt_utc.astimezone(timezone.utc)
    jd = dt_utc.timestamp() / 86400.0 + 2440587.5
    T = (jd - 2451545.0) / 36525.0
    L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    Mr = math.radians(M)
    C = (math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
         + math.sin(3 * Mr) * 0.000289)
    true_long = L0 + C
    omega = 125.04 - 1934.136 * T
    lam = true_long - 0.00569 - 0.00478 * math.sin(math.radians(omega))
    eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
    eps = eps0 + 0.00256 * math.cos(math.radians(omega))
    decl = math.degrees(math.asin(math.sin(math.radians(eps)) * math.sin(math.radians(lam))))
    y = math.tan(math.radians(eps / 2)) ** 2
    L0r = math.radians(L0)
    eqt = 4 * math.degrees(y * math.sin(2 * L0r) - 2 * e * math.sin(Mr) + 4 * e * y * math.sin(Mr) * math.cos(2 * L0r)
                           - 0.5 * y * y * math.sin(4 * L0r) - 1.25 * e * e * math.sin(2 * Mr))
    minutes = dt_utc.hour * 60 + dt_utc.minute + dt_utc.second / 60
    tst = (minutes + eqt + 4 * lon) % 1440
    ha = tst / 4 - 180 if tst / 4 >= 0 else tst / 4 + 180
    latr, decr, har = math.radians(lat), math.radians(decl), math.radians(ha)
    cosz = math.sin(latr) * math.sin(decr) + math.cos(latr) * math.cos(decr) * math.cos(har)
    zen = math.degrees(math.acos(max(-1, min(1, cosz))))
    elev = 90 - zen
    az = math.degrees(math.atan2(math.sin(har), math.cos(har) * math.sin(latr) - math.tan(decr) * math.cos(latr))) + 180
    return elev, az % 360


def height_from_shadow(shadow_len_m, dt_utc, lat, lon, len_sigma_m=0.5, elev_sigma_deg=0.1):
    el, az = sun_position(dt_utc, lat, lon)
    if el <= 5:
        raise ValueError("sun too low for a reliable measurement (%.1f deg)" % el)
    t = math.tan(math.radians(el))
    h = shadow_len_m * t
    dh = math.hypot(t * len_sigma_m, shadow_len_m / math.cos(math.radians(el)) ** 2 * math.radians(elev_sigma_deg))
    return {"h": h, "sigma": dh, "sun_elev": el, "sun_az": az, "shadow_dir_az": (az + 180) % 360}
