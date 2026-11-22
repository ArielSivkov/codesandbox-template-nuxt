import json, math, random, sys
T = json.load(open('/home/claude/swarm/sky/tools/tables_full.json'))
PL = ['Mercury','Venus','Earth','Mars','Jupiter','Saturn']
def ev(ser, tau):
    s = 0.0; p = 1.0
    for terms in ser:
        a = 0.0
        for A, B, C in terms: a += A * math.cos(B + C * tau)
        s += a * p; p *= tau
    return s * 1e-8
def trunc(ser, eps, tmax):
    return [[t for t in terms if t[0]*1e-8 * tmax**k >= eps] for k, terms in enumerate(ser)]
def helio(m, tau):
    L, B, R = ev(m['L'], tau), ev(m['B'], tau), ev(m['R'], tau)
    return (R*math.cos(B)*math.cos(L), R*math.cos(B)*math.sin(L), R*math.sin(B))
def geo(models, p, tau):
    e = helio(models['Earth'], tau); x = helio(models[p], tau)
    d = [x[i]-e[i] for i in range(3)]; n = math.sqrt(sum(v*v for v in d)); return [v/n for v in d]
def sep(a, b): return math.degrees(math.acos(max(-1, min(1, sum(a[i]*b[i] for i in range(3))))))*3600
eps = float(sys.argv[1]); tmax = float(sys.argv[2])
tr = {p: {k: trunc(T[p][k], eps, tmax) for k in 'LBR'} for p in PL}
print('terms', {p: sum(len(s) for k in 'LBR' for s in tr[p][k]) for p in PL}, 'total', sum(len(s) for p in PL for k in 'LBR' for s in tr[p][k]))
random.seed(1)
for lo, hi in [(-0.1, 0.1), (-3.0, 0.1)]:
    taus = [random.uniform(lo, hi) for _ in range(150)]
    out = {}
    for p in PL:
        if p == 'Earth':
            out['Sun'] = max(sep([-v for v in helio(T['Earth'], t)], [-v for v in helio(tr['Earth'], t)]) / 1 for t in taus)  # not normalised: crude
            continue
        out[p] = max(sep(geo(T, p, t), geo(tr, p, t)) for t in taus)
    print('range', lo, hi, {k: round(v, 2) for k, v in out.items()}, 'arcsec max')
