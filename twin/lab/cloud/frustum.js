// אילו בניינים רואים בצילום: מיקום GPS + כיוון מצפן + שדה ראייה → בניינים מהאריחים, עם מיקום אופקי בתמונה (% משמאל).
// קואורדינטות: GPS → ITM (GRS80 + Helmert, כמו itm.js במשחק) → מסגרת האריחים (sample) = ITM − (1507.82, 757.76), נמדד מ-7,386 בניינים ±0.56 מ'.
// הסתרה: חלוקה לפרוסות של 0.5°; כל פרוסה שייכת לבניין הקרוב ביותר בה. בניין "נראה" אם יש לו ≥ 4 פרוסות (2°).
export const OFFSET = [1507.82, 757.76];
const D2R = Math.PI / 180;
// ITM: אותו קוד בדיוק כמו במשחק (js/itm.js נטען לפני הקובץ הזה ומגדיר globalThis.ITM)
export function wgs84ToItm(lat, lon) { return globalThis.ITM.wgs84ToItm(lat, lon); }

function rings(b) { const r = b.r; return r && Array.isArray(r[0]) ? r : [r]; }
function dec(r, o) { const out = []; let x = o[0], y = o[1]; for (let i = 0; i + 1 < r.length; i += 2) { x += r[i] / 10; y += r[i + 1] / 10; out.push([x, y]); } return out; }

/** tiles: מפה key→tileJSON (במסגרת sample). מחזיר בניינים נראים משמאל לימין. */
export function visible(tiles, cam, opts = {}) {
  const R = opts.range || 350, step = 0.5, hf = cam.hfov, half = hf / 2, nb = Math.ceil(hf / step);
  const owner = new Array(nb).fill(null), dist = new Array(nb).fill(Infinity), B = new Map();
  for (const t of tiles.values()) for (const b of t.b || []) {
    const P = dec(rings(b)[0], t.o); let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= P.length; cy /= P.length;
    if (Math.hypot(cx - cam.E, cy - cam.N) > R + 60) continue;
    for (let i = 0; i < P.length; i++) {   // דוגמים את הקירות כל ~2 מ'
      const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length], L = Math.hypot(x2 - x1, y2 - y1), k = Math.max(1, Math.ceil(L / 2));
      for (let j = 0; j <= k; j++) { const x = x1 + (x2 - x1) * j / k, y = y1 + (y2 - y1) * j / k, dx = x - cam.E, dy = y - cam.N, d = Math.hypot(dx, dy);
        if (d < 1 || d > R) continue; let rel = Math.atan2(dx, dy) / D2R - cam.heading; rel = ((rel + 540) % 360) - 180;
        if (rel < -half || rel >= half) continue; const s = Math.floor((rel + half) / step); if (d < dist[s]) { dist[s] = d; owner[s] = b; } }
    }
    B.set(b, { id: b.i, name: b.n || '', h: b.h / 10, f: b.f || null, cx, cy });
  }
  const seen = new Map();
  owner.forEach((b, s) => { if (!b) return; const v = seen.get(b) || { s0: s, s1: s, d: Infinity, n: 0 }; v.s0 = Math.min(v.s0, s); v.s1 = Math.max(v.s1, s); v.d = Math.min(v.d, dist[s]); v.n++; seen.set(b, v); });
  return [...seen.entries()].filter(([, v]) => v.n >= 4).map(([b, v]) => { const i = B.get(b);
    // גובה הגג בזווית מעל קו העיניים (גובה עיניים 1.5 מ') – כדי לדעת אם הגג בתמונה
    const roofDeg = Math.atan2(i.h - 1.5, v.d) / D2R;
    return { id: i.id, name: i.name, dist_m: +v.d.toFixed(1), from_pct: Math.round(v.s0 / nb * 100), to_pct: Math.round((v.s1 + 1) / nb * 100), map_height_m: i.h, map_floors: i.f, roof_elev_deg: +roofDeg.toFixed(1) };
  }).sort((x, y) => x.from_pct - y.from_pct);
}
/** שדה ראייה אופקי ממוקד שקול 35 מ"מ ויחס התמונה (רוחב/גובה כפי שצולמה) */
export function hfovDeg(w, h, f35 = 24) { const diag = Math.hypot(w, h); return 2 * Math.atan((w / diag) * 21.63 / f35) / D2R; }
