"""python -m pytest /home/claude/swarm/buildings/pipeline -q"""
import json
import os
import subprocess
import sys

from shapely.geometry import Point, Polygon, box
from shapely import affinity

sys.path.insert(0, os.path.dirname(__file__))
import typology as ty  # noqa: E402

HERE = os.path.dirname(__file__)


def test_classify_matches_js():
    """אותם מקרים כמו tests/typology.test.js – הצינור והלקוח מסכימים."""
    cases = [
        (dict(typ='house', area=180, floors=2), 'VILLA'), (dict(area=160, floors=2), 'VILLA'),
        (dict(typ='apartments', area=600, floors=4, length=30, width=20), 'WALKUP'),
        (dict(area=900, floors=4, length=75, width=12), 'RAKEVET'), (dict(area=900, floors=4, length=35, width=12), 'WALKUP'),
        (dict(area=700, floors=8, length=30, width=22), 'BLOCK'), (dict(typ='apartments', area=800, floors=20, h=61), 'TOWER'),
        (dict(area=800, floors=4, h=13, name='Sea View Tower'), 'WALKUP'), (dict(typ='retail', area=2000, floors=2), 'COMMERCIAL'),
        (dict(area=8000, floors=3, name='קניון סימול'), 'COMMERCIAL'), (dict(area=500, floors=4, name='בית כנסת משכן מאיר'), 'PUBLIC'),
        (dict(typ='warehouse', area=5000, floors=1), 'INDUSTRIAL'), (dict(area=25, floors=1), 'ANNEX'),
        (dict(typ='office', area=1500, floors=15, h=52), 'TOWER'),
    ]
    for kw, want in cases:
        assert ty.classify(**kw)[0] == ty.T[want], (kw, want)
    # השוואה ישירה מול מימוש ה-JS (אם node קיים)
    js = os.path.join(HERE, '..', 'src', 'typology.js')
    prog = ("const TY=require(%r);const c=JSON.parse(process.argv[1]);"
            "console.log(JSON.stringify(c.map(k=>TY.classify({typ:k.typ,name:k.name,area:k.area,floors:k.floors,h:k.h,len:k.length,wid:k.width,floorsSrc:'R'}).code)))") % js
    try:
        res = subprocess.run(['node', '-e', prog, json.dumps([kw for kw, _ in cases])], capture_output=True, text=True, timeout=30)
        got = json.loads(res.stdout)
        assert got == [ty.T[w] for _, w in cases]
    except FileNotFoundError:
        pass


def test_facade_fields_data_only():
    g = affinity.rotate(box(0, 0, 70, 12), 25)
    b = dict(geom=g, tags={'building': 'apartments', 'start_date': '1972', 'building:material': 'plaster', 'roof:shape': 'flat'},
             type='apartments', name='', area=g.area, floors=4, h=13, src='R')
    f = ty.facade_fields(b, shop_points=[Point(35, 6)], quarters=[("רובע ז'", affinity.rotate(box(-50, -50, 150, 150), 25))])
    assert f['ty'] == ty.T['RAKEVET'] and f['e'] == 1972 and f['m'] == 0 and f['rs'] == 'flat' and f['q'] == "רובע ז'"
    assert 'gf' not in f or f['gf'] == 1
    # בלי נתונים: רק ty (ומקור), שום שדה ממוצא
    b2 = dict(geom=box(0, 0, 20, 20), tags={'building': 'yes'}, type='', name='', area=400, floors=4, h=13, src='R')
    f2 = ty.facade_fields(b2)
    assert set(f2) == {'ty', 'fs'} and f2['fs'] == 'R'


def test_shop_point_inside_footprint():
    g = box(0, 0, 30, 15)
    b = dict(geom=g, tags={}, type='', name='', area=g.area, floors=4, h=13, src='R')
    assert ty.facade_fields(b, shop_points=[Point(10, 5)]).get('gf') == 1
    assert 'gf' not in ty.facade_fields(b, shop_points=[Point(100, 5)])


def test_attach_counts():
    bl = [dict(geom=box(i * 50, 0, i * 50 + 20, 20), tags={}, type='', name='', area=400, floors=4, h=13, src='R') for i in range(5)]
    c = ty.attach_facades(bl, shop_points=[Point(10, 10)])
    assert c == {ty.T['WALKUP']: 5} and bl[0]['facade'].get('gf') == 1 and 'gf' not in bl[1]['facade']
