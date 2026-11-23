"""species.json -> species.data.js (ES module) + pipeline copy. Run after editing species.json."""
import json, os, shutil
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = json.load(open(os.path.join(H, 'species.json'), encoding='utf-8'))
open(os.path.join(H, 'species.data.js'), 'w', encoding='utf-8').write(
    '// נוצר אוטומטית מ-species.json ע"י tools/gen_species_js.py – לא לערוך ידנית\nexport default ' +
    json.dumps(s, ensure_ascii=False, separators=(',', ':')) + ';\n')
shutil.copy(os.path.join(H, 'species.json'), os.path.join(os.path.dirname(H), 'pipeline/yazam/species_veg.json'))
print('ok', len(s['species']))
