"""Build comparable climate normals and sampled municipal elevation; no runtime keys.
PYTHONPATH=/tmp/travel-map-build:/tmp/travel-poster-tools python3 collector/tools/build_nature.py
"""
from pathlib import Path
import json,csv,io,re,urllib.request,hashlib,gzip,math,concurrent.futures,shutil,datetime
import numpy as np
from shapely.geometry import shape,Point,box
from shapely.ops import unary_union
from shapely import contains_xy,prepare
import fitz
ROOT=Path(__file__).resolve().parents[2];CACHE=ROOT/'.cache/nature';OUT=ROOT/'data/nature';CACHE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
CSV_URL='https://data.kma.go.kr/climate/average30Years/selectAverage30YearsDownload.do?fileType=csv&startYear=2021&schGubun=1&schStnId=&stnFileNm=Average30Years4.json&serviceSe=F00101&selectType=2&mddlClssCd=SFC01&pgmNo=113'
PDF_URL='https://data.kma.go.kr/resources/normals/pdf_data/korea_pdf_0106_v2.pdf'
TREE_URL='https://data.kma.go.kr/resources/contents/climate/Average30Years4.json'
def fetch(url,name,tmp=None):
 p=CACHE/name
 if not p.exists():
  if tmp and Path(tmp).exists():shutil.copyfile(tmp,p)
  else:
   with urllib.request.urlopen(url,timeout=90) as res:p.write_bytes(res.read())
 return p
cp=fetch(CSV_URL,'climate.csv','/tmp/vs-climate.csv');pp=fetch(PDF_URL,'stations.pdf','/tmp/vs-kma-stations.pdf');tp=fetch(TREE_URL,'stations.json','/tmp/vs-kma-stations.json')
regs=json.loads((ROOT/'data/regions.json').read_text())['regions'];lookup={r['code']:r for r in regs}
raw=json.loads((ROOT/'data/geo/source-sig.geojson').read_text());groups={};provinces={}
gwangju={'29110':'12210','29140':'12240','29155':'12270','29170':'12300','29200':'12330'}
for f in raw['features']:
 old=f['properties']['SIG_CD'];name=f['properties']['SIG_KOR_NM'].split()[0];province={'42':'51','45':'52','46':'12','29':'12'}.get(old[:2],old[:2]);name={'세종특별자치시':'세종시'}.get(name,name)
 matches=[r['code'] for r in regs if r['level']=='sigungu' and r['parent_code']==province and r['name']==name]
 geom=shape(f['geometry']);geom=geom if geom.is_valid else geom.buffer(0);provinces.setdefault(province,[]).append(geom)
 if len(matches)==1:groups.setdefault(matches[0],[]).append(geom)
geo={c:unary_union(gs) for c,gs in {**groups,**provinces}.items()};assert len(geo)==242
# KMA's station metadata table, pages14–19 of the published Korean climate normals report.
coords={};doc=fitz.open(pp)
for npage in range(13,19):
 page=doc[npage]
 text=page.get_text()
 if 'Height above sea level' not in text or 'Lat.(N)' not in text:continue
 pattern=r'\n(\d+)\s*\n(\d{2,3})\s*\n([가-힣()]+)\s*\n[^\n]+\s*\n(\d{2})[˚°](\d{2})[´′]\s*\n(\d{3})[˚°](\d{2})[´′]'
 for ordinal,code,name,lat,m1,lon,m2 in re.findall(pattern,text):coords[int(code)]={'lat':int(lat)+int(m1)/60,'lng':int(lon)+int(m2)/60,'name':name}
assert len(coords)>=210,len(coords)
tree=json.loads(tp.read_text())['data'];nodes={n['id']:n for n in tree};station_province={}
for n in tree:
 if n.get('stnid'):station_province[int(n['stnid'])]=nodes[n['pId']]['name']
lines=cp.read_text(encoding='cp949').splitlines();start=next(i for i,l in enumerate(lines) if l.startswith('지점명,'));climate=list(csv.DictReader(lines[start:]));assert len(climate)>=200
mapped={};unmatched=[]
for row in climate:
 try:code=int(row['지점번호']);temp=float(row['평균기온(°C)']);rain=float(row['강수량(mm)'])
 except (ValueError,KeyError):continue
 assert -10<temp<25 and 100<rain<10000
 stname=row['지점명'];pname=station_province.get(code,'');pname={'광주광역시':'전남광주통합특별시','전라남도':'전남광주통합특별시','강원도':'강원특별자치도','전라북도':'전북특별자치도'}.get(pname,pname)
 pr=[r['code'] for r in regs if r['level']=='sido' and r['name']==pname]
 if len(pr)!=1:unmatched.append({'station':code,'name':stname,'reason':'province unmatched'});continue
 exact=[r['code'] for r in regs if r['level']=='sigungu' and r['parent_code']==pr[0] and (r['name']==stname or r['name'][:-1]==stname)]
 match=exact;method='official station name + province'
 if len(match)!=1 and code in coords:
  pt=Point(coords[code]['lng'],coords[code]['lat']);match=[c for c,g in geo.items() if lookup[c]['level']=='sigungu' and lookup[c]['parent_code']==pr[0] and g.contains(pt)];method='official rounded station coordinates within boundary'
 if len(match)!=1:unmatched.append({'station':code,'name':stname,'reason':'no unambiguous municipality'});continue
 target=match[0];entry={'code':target,'name':lookup[target]['display_name'],'station_id':code,'station_name':stname,'temperature':temp,'precipitation':rain,'mapping':method,**coords.get(code,{})};entry['name']=lookup[target]['display_name']
 # Prefer station explicitly named after the municipality; then ASOS; finally lowest station number.
 priority=(0 if method.startswith('official station name') else 1,0 if code<300 else 1,code)
 if target not in mapped or priority<mapped[target][0]:mapped[target]=(priority,entry)
climate_rows=[v[1] for c,v in sorted(mapped.items())];assert len(climate_rows)>100,len(climate_rows)
# Each fixed lattice sample represents the same angular area; cos(latitude) corrects actual area.
STEP=10;tile_keys=set()
for g in geo.values():
 x0,y0,x1,y1=g.bounds
 for lat in range(math.floor(y0),math.floor(y1)+1):
  for lon in range(math.floor(x0),math.floor(x1)+1):
   if g.intersects(box(lon,lat,lon+1,lat+1)):tile_keys.add((lat,lon))
def tile_download(key):
 lat,lon=key;name=f'N{lat:02d}E{lon:03d}.hgt.gz';url=f'https://elevation-tiles-prod.s3.amazonaws.com/skadi/N{lat:02d}/{name}'
 p=fetch(url,name,'/tmp/vs-dem-N37E127.hgt.gz' if (lat,lon)==(37,127) else None)
 return key,p,hashlib.sha256(p.read_bytes()).hexdigest()
print(json.dumps({'climate_regions':len(climate_rows),'DEM_tiles':len(tile_keys)},ensure_ascii=False),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:tiles=list(pool.map(tile_download,sorted(tile_keys)))
acc={c:[0.,0.,0,0] for c in geo}
for c,g in geo.items():prepare(g)
for (lat,lon),p,digest in tiles:
 raw=gzip.decompress(p.read_bytes());n=math.isqrt(len(raw)//2);assert n*n*2==len(raw) and n in [1201,3601]
 stride=STEP if n==3601 else max(1,round(STEP/3));idx=np.arange(stride//2,n-1,stride);zs=np.frombuffer(raw,dtype='>i2').reshape(n,n)[np.ix_(idx,idx)];xs=lon+idx/(n-1);ys=lat+1-idx/(n-1)
 for c,g in geo.items():
  x0,y0,x1,y1=g.bounds;ix=np.flatnonzero((xs>=x0)&(xs<=x1));iy=np.flatnonzero((ys>=y0)&(ys<=y1))
  if not len(ix) or not len(iy):continue
  xx,yy=np.meshgrid(xs[ix],ys[iy]);inside=contains_xy(g,xx,yy);z=zs[np.ix_(iy,ix)];valid=inside&(z!=-32768)&(z>=-50)&(z<=3000);w=np.cos(np.radians(yy));a=acc[c];a[0]+=float((z[valid]*w[valid]).sum());a[1]+=float(w[valid].sum());a[2]+=int(valid.sum());a[3]+=int(inside.sum())
elev=[]
for c,(total,weight,valid,expected) in sorted(acc.items()):
 if valid<10 or valid/max(1,expected)<.995:continue
 elev.append({'code':c,'name':lookup[c]['display_name'],'level':lookup[c]['level'],'value':round(total/weight,2),'samples':valid,'coverage':round(valid/expected,6)})
assert len(elev)>=235,len(elev)
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
out={'collected_at':now,'climate':{'ref_date':'1991–2020','source':'기상청 기후평년값(1991~2020), 지역 내 대표 관측지점 기준','source_url':CSV_URL,'coordinates_source':PDF_URL,'station_tree_source':TREE_URL,'sha256':hashlib.sha256(cp.read_bytes()).hexdigest(),'selection':'같은 시군구 명칭의 지점 우선 → ASOS 우선 → 지점번호 오름차순. 시도 전체 평균으로 확장하지 않음. 좌표는 공식 기후표의 분 단위 좌표.','rows':climate_rows,'unmatched':unmatched},'elevation':{'ref_date':'SRTM·경계2023','source':'USGS SRTM / Mapzen Terrain Tiles · 2023 경계 안 약300m 격자 표본의 면적가중 평균(근사)','source_url':'https://registry.opendata.aws/terrain-tiles/','attribution':'SRTM, GMTED2010 data courtesy of the U.S. Geological Survey; Mapzen.','method':'WGS84/EGM96 표고(m), 각 타일의 고정 약10각초 간격 표본, 위도 cos 가중평균. NoData제외. 경계자료2023, 신설인천4구제외. 수치모델이므로 현재의 정확한 공식 평균표고 통계가 아님.','sampling_arcseconds':10,'rows':elev,'tiles':[{'lat':k[0],'lon':k[1],'sha256':h} for k,p,h in tiles]}}
out['elevation']['excluded']=[{'code':r['code'],'name':r['name'],'reason':'현재 경계 미확인' if r['code'] not in geo else '유효 표고 표본 비율 또는 표본 수 미달'} for r in regs if r['code'] not in {x['code'] for x in elev}]
out['positions']={'ref_date':'2023','source':'VWorld/KnellBalm 2023 경계의 내부 대표점(Point on surface) · 위경도 비교','method':'대표점은 행정구역 안의 한 점이며 시군구청 위치나 극동·극서·극남·극북 지점이 아님. 같은 행정단위끼리만 비교.','rows':[{'code':c,'name':lookup[c]['display_name'],'level':lookup[c]['level'],'lat':round(g.representative_point().y,6),'lng':round(g.representative_point().x,6)} for c,g in sorted(geo.items())]}
(OUT/'nature.json.tmp').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n');(OUT/'nature.json.tmp').replace(OUT/'nature.json')
shutil.copyfile(cp,OUT/'kma-normals-1991-2020.csv');(OUT/'station-mapping.json').write_text(json.dumps({'coordinates':coords,'tree_source':TREE_URL},ensure_ascii=False,indent=2))
print(json.dumps({'done':True,'climate_regions':len(climate_rows),'elevation_regions':len(elev),'elevation_examples':sorted(elev,key=lambda r:-r['value'])[:3]},ensure_ascii=False),flush=True)
