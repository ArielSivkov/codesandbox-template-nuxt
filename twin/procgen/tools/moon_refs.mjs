// ירח לכל תמונה (אמצע הדקה שבשם הקובץ, שעון ישראל UTC+2) – מחלקת השמיים (sky/src/sky.js, מאומת מול ephem/DE421).
// הרצה: node tools/moon_refs.mjs <fieldphotos> data/moon_refs.json
import fs from 'fs';
import { time, observer, moon } from '../../sky/src/sky.js';
const [dir, out] = process.argv.slice(2);
const obs = observer(31.8055, 34.6425, 20);
const res = { src: 'sky/src/sky.js (Meeus ch.47, טופוצנטרי, עם שבירה)', site: [31.8055, 34.6425], refs: {} };
for (const f of fs.readdirSync(dir).filter(f => /^\d{3}_\d{8}_\d{4}\.jpg$/.test(f)).sort()) {
  const hh = +f.slice(13, 15), mm = +f.slice(15, 17);
  const d = new Date(Date.UTC(2026, 10, 23, hh - 2, mm, 30));
  const m = moon(time(d), obs, { apparent: true });
  res.refs[f.slice(0, 3)] = { utc: d.toISOString(), az: +m.az.toFixed(2), alt: +(m.altApparent ?? m.alt).toFixed(2), pm_time_deg: 0.1 };
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(Object.keys(res.refs).length, res.refs['008'], res.refs['032']);
