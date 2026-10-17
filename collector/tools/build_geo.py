"""Normalize cached VWorld geometry against current legal-region codes; never invent missing boundaries.
Usage: PYTHONPATH=/tmp/travel-map-build python3 collector/tools/build_geo.py
Requires shapely>=2.0. Optional --download refreshes the attributed public source (network permission required).
"""
import json, math, hashlib, argparse, urllib.request
from pathlib import Path
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.ops import unary_union, transform
ROOT=Path(__file__).resolve().parents[2]
RAW=ROOT/'data/geo/source-sig.geojson'
URL='https://raw.githubusercontent.com/KnellBalm/kr-admin-geojson/main/sig.geojson'
if argparse.ArgumentParser().parse_known_args()[1] == ['--download']:
    content=urllib.request.urlopen(URL,timeout=60).read()
    candidate=json.loads(content)
    assert candidate['type']=='FeatureCollection' and len(candidate['features'])>=250
    RAW.write_bytes(content)
regions=json.loads((ROOT/'data/regions.json').read_text())['regions']; bycode={r['code']:r for r in regions}
# Official-code based remapping for renamed provinces and merged Gwangju/Jeonnam.
gwangju={'29110':'12210','29140':'12240','29155':'12270','29170':'12300','29200':'12330'}
def current(code):
    if code in gwangju:return gwangju[code]
    if code.startswith('46'):return None # merged province renumbered several counties: join by verified province+name below
    code={'42':'51','45':'52','46':'12'}.get(code[:2],code[:2])+code[2:]
    if code=='47720':code='27720'
    if code in bycode:return code
    # General city wards are grouped into the statistical municipality, using source names.
    return None
groups={}; parents={}
for f in json.loads(RAW.read_text())['features']:
    old=f['properties']['SIG_CD']; code=current(old)
    if not code:
        name=f['properties']['SIG_KOR_NM'].split(' ')[0]
        province={'42':'51','45':'52','46':'12','29':'12'}.get(old[:2],old[:2])
        matches=[r['code'] for r in regions if r['level']=='sigungu' and r['parent_code']==province and r['name']==name]
        code=matches[0] if len(matches)==1 else None
    if code:
        assert bycode[code]['name']=={'세종특별자치시':'세종시'}.get(f['properties']['SIG_KOR_NM'].split(' ')[0],f['properties']['SIG_KOR_NM'].split(' ')[0]), ('name/code mismatch',old,code)
    geom=shape(f['geometry']);geom=geom if geom.is_valid else geom.buffer(0)
    # Provincial outlines can use old ward union, even where ward splits have changed.
    province={'42':'51','45':'52','46':'12','29':'12'}.get(old[:2],old[:2])
    parents.setdefault(province,[]).append(geom)
    if code:groups.setdefault(code,[]).append(geom)
def project(x,y,z=None):return x, -math.degrees(math.log(math.tan(math.pi/4+math.radians(y)/2)))
geo={c:transform(project,unary_union(gs)) for c,gs in {**groups,**parents}.items()}
def path(g,frame=None):
    left,top,right,bottom=frame or g.bounds
    scale=min(280/(right-left),220/(bottom-top));ox=(320-(right-left)*scale)/2;oy=(260-(bottom-top)*scale)/2
    g=transform(lambda x,y,z=None:((x-left)*scale+ox,(y-top)*scale+oy),g).simplify(.3,preserve_topology=True)
    polygons=list(g.geoms) if isinstance(g,MultiPolygon) else [g];out=[]
    for p in polygons:
        if not isinstance(p,Polygon):continue
        for ring in [p.exterior,*p.interiors]:
            out.append('M'+'L'.join(f'{x:.1f},{y:.1f}' for x,y in ring.coords)+'Z')
    return {'path':''.join(out),'viewBox':'0 0 320 260'}
items=[]
for r in regions:
    if r['code'] not in geo:continue
    g=geo[r['code']]; entry={**r,'shape':path(g)}
    if r['parent_code']:
        parent=geo[r['parent_code']]
        entry['location']=path(g,parent.bounds)
    items.append(entry)
missing=[{'code':r['code'],'name':r['name'],'reason':'2026 신설 구의 경계를 2023 자료로 추정하지 않음'} for r in regions if r['code'] not in geo]
assert {x['code'] for x in missing}=={'28125','28155','28275','28290'},missing
out={'source':'국가공간정보포털(VWorld), KnellBalm/kr-admin-geojson 가공본','source_url':'https://github.com/KnellBalm/kr-admin-geojson','ref_date':'2023-07-29','region_date':'2026-09-30','license':'출처 표시 조건 자유 이용 (원본 및 가공본 안내)','raw_sha256':hashlib.sha256(RAW.read_bytes()).hexdigest(),'changes':'2026 코드 연결, 광주·전남 병합, 일반구→시 병합, 투영·화면 단순화. 세종/제주 시군구는 같은 시도 내 4개 선택지가 없어 모양 출제 제외.','excluded':missing,'regions':items}
destination=ROOT/'data/geo/boundaries.json'
temporary=destination.with_suffix('.json.tmp')
temporary.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
temporary.replace(destination)
print(json.dumps({'regions':len(items),'excluded':missing},ensure_ascii=False))
