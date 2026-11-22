"""Extract numeric tables (VSOP87D, Meeus ch.47 Moon, IAU1980 nutation) from the text of the
installed PyMeeus package WITHOUT importing/executing it (ast.literal_eval on the literal lists).
Writes tools/tables_full.json. The numbers are the published VSOP87D (Bretagnon & Francou 1988)
and Meeus "Astronomical Algorithms" 2nd ed. tables 47.A/47.B/22.A."""
import ast, json, sys, os
P = '/usr/local/lib/python3.13/site-packages/pymeeus'
def lits(fn, names):
    tree = ast.parse(open(os.path.join(P, fn), encoding='utf8').read())
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            n = node.targets[0].id
            if n in names:
                out[n] = ast.literal_eval(node.value)
    return out
res = {}
for pl in ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn']:
    t = lits(pl + '.py', ['VSOP87_L', 'VSOP87_B', 'VSOP87_R'])
    res[pl] = {k[-1]: v for k, v in t.items()}
    print(pl, {k: [len(s) for s in v] for k, v in res[pl].items()})
m = lits('Moon.py', ['PERIODIC_TERMS_LR_TABLE', 'PERIODIC_TERMS_B_TABLE'])
res['moonLR'] = m['PERIODIC_TERMS_LR_TABLE']; res['moonB'] = m['PERIODIC_TERMS_B_TABLE']
print('moon', len(res['moonLR']), len(res['moonB']))
n = lits('Coordinates.py', ['NUTATION_ARG_TABLE', 'NUTATION_SINE_COEF_TABLE', 'NUTATION_COSINE_COEF_TABLE'])
res['nut'] = n; print('nut', {k: len(v) for k, v in n.items()})
json.dump(res, open(os.path.join(os.path.dirname(__file__), 'tables_full.json'), 'w'))
