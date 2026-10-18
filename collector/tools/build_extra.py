"""Build source-backed shop, infrastructure, agricultural and energy comparisons."""
from pathlib import Path
from collections import defaultdict
from html.parser import HTMLParser
import json,re,datetime,csv,hashlib
import fitz
ROOT=Path(__file__).resolve().parents[2];CACHE=ROOT/'.cache/expansion';OUT=ROOT/'data/extra';OUT.mkdir(parents=True,exist_ok=True)
legal=json.loads((ROOT/'data/regions.json').read_text())['regions'];by={r['code']:r for r in legal};short={'서울':'11','부산':'26','대구':'27','인천':'28','광주':'12','전남':'12','대전':'30','울산':'31','세종':'36','경기':'41','강원':'51','충북':'43','충남':'44','전북':'52','경북':'47','경남':'48','제주':'50'}
metrics={};audit={}
def rows(values):return [{'code':c,'name':by[c]['display_name'],'level':by[c]['level'],'value':v} for c,v in sorted(values.items())]
def provinces(raw,exclude=()):
 result=defaultdict(float)
 for name,value in raw.items():
  if name not in exclude:result[short[name]]+=value
 return rows(result)
def add(key,source,url,date,values,basis):metrics[key]={'source':source,'source_url':url,'ref_date':date,'basis':basis,'rows':values}
shops=json.loads((ROOT/'data/shops/shops.json').read_text());population=json.loads((ROOT/'data/stats/population.json').read_text());pop={r['region_code']:r['value'] for r in population['values']}
for key,label in [('convenience','편의점'),('cafe','카페'),('bakery','빵·도넛'),('karaoke','노래방')]:
 data=shops[key];month=data['ref_date'][:4]+'-'+data['ref_date'][4:];basis=f'{month} 소상공인 자료에 실린 가게 수({label})'
 add(key+'_count',shops['source']+' · '+data['category'],shops['source_url'],month,data['rows'],basis)
 ratio=[]
 for r in data['rows']:
  if r['code'] in pop and pop[r['code']]>0:ratio.append({**r,'value':r['value']/pop[r['code']]*10000})
 add(key+'_per_10000',shops['source']+' + 행정안전부 주민등록인구(KOSIS)',shops['source_url'],month+' 가게 / '+population['ref_date']+' 인구',ratio,basis+' ÷ '+population['ref_date']+' 인구 × 1만 (서로 다른 기준월)')
 audit[key]={'national':data['reported_total'],'province_total':sum(r['value'] for r in data['rows'] if r['level']=='sido'),'category':data['category'],'excluded':data['excluded']};assert audit[key]['national']==audit[key]['province_total']
# Official 2025 bicycle survey: page4, total length includes all four road types.
bike=fitz.open(CACHE/'bike.pdf')[3].get_text();raw={m[0]:float(m[2].replace(',','')) for m in re.findall(r'(?m)^('+('|'.join(short))+r')\n([\d,]+)\n([\d,.]+)\n',bike)};assert len(raw)==17 and abs(sum(raw.values())-28453.41)<.1
add('bicycle_length','행정안전부 2025년 기준 자전거 이용 현황','https://mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000014&nttId=129807','2025',provinces(raw),'전용도로·보행자 겸용도로·전용차로·우선도로 총연장 · 시도 비교');audit['bicycle']=raw
# Official polished rice (not unhusked paddy), including paddy and upland rice.
rice=fitz.open(CACHE/'rice.pdf')[9].get_text();raw={};flagged=[]
for m in re.finditer(r'(?m)^('+('|'.join(short))+r')(?:1\))?\n([^\n]+)\n([^\n]+)\n([^\n]+)\n([^\n]+)\n([^\n]+)\n([^\n]+)',rice):
 name=m[1];value=m[6].strip();raw[name]=int(value.replace(',','').replace('*',''))
 if '*' in value:flagged.append(name)
assert len(raw)==17 and abs(sum(raw.values())-3539433)<=5
add('rice_production','국가데이터처 2025년 쌀 생산량조사','https://sri.kostat.go.kr/boardDownload.es?bid=228&list_no=439216&seq=3','2025',provinces(raw,flagged),'논벼+밭벼 · 9분도 백미 생산량(톤) · 시도 비교 · 신뢰도가 낮은 서울 제외');audit['rice']={'raw':raw,'excluded':flagged}
class Tables(HTMLParser):
 def __init__(self):super().__init__();self.rows=[];self.row=[];self.cell=None
 def handle_starttag(self,t,a):
  if t=='tr':self.row=[]
  if t in ['th','td']:self.cell=''
 def handle_data(self,s):
  if self.cell is not None:self.cell+=s
 def handle_endtag(self,t):
  if t in ['th','td'] and self.cell is not None:self.row.append(re.sub(r'\s+',' ',self.cell).strip());self.cell=None
  if t=='tr' and self.row:self.rows.append(self.row)
t=Tables();t.feed((CACHE/'coast').read_text());raw={}
for row in t.rows:
 if len(row)==16 and row[0].endswith('연안') and row[0][:-2] in short:raw[row[0][:-2]]=float(row[12].replace(',',''))
assert len(raw)==11
add('coastline_length','국립해양조사원 · 해양수산부 연안포털','https://coast.mof.go.kr/coastAdmin/research/aspect.do','2025',provinces(raw),'자연·인공 해안선 합계 · 섬을 포함한 시도별 연안 통계 · 미수록 내륙은 제외');audit['coastline']=raw
# Hand-transcribed exact displayed whole-km figures; original infographic page4 visually checked.
raw={'서울':8391,'부산':3928,'대구':3039,'인천':3417,'광주':1933,'대전':2276,'울산':2587,'세종':449,'경기':16285,'강원':9840,'충북':6971,'충남':8033,'전북':8624,'전남':10929,'경북':13524,'경남':13313,'제주':3236};assert abs(sum(raw.values())-116775)<=17
add('road_length','국토교통부 도로현황 통계 인포그래픽','https://www.rsis.kr/','2025-12-31',provinces(raw),'도로법상 7개 도로 등급의 총연장 · km 단위 반올림 공표값 · 시도 비교');audit['road']=raw
# KOSIS e-regional indicators: KEPCO electricity sales, not gross energy consumption.
d=json.loads((CACHE/'power-all.json').read_text())['allRegionDataList'];raw={r['regionNm']:r['vl'] for r in d if r['regionNm'] in short and r['vl'] is not None};assert len(raw)==17 and all(r['unit']=='MWh' and r['wrtPnttm']=='2025' for r in d)
add('electricity_sales','한국전력공사 전력판매량 · KOSIS e-지방지표','https://kosis.kr/visual/eRegionIndex/eRegionWhole.do?unitySrvcId=911','2025',provinces(raw),'한전 공급 전력 사용량(MWh) 기준 · 가정·상가·공장 등 전체 용도 · 자가발전 소비 제외');audit['power']=raw
# API list snapshot: registered station nodes, including historical records. Never infer zero from missing cities.
city_names={11:'서울',12:'세종',21:'부산',22:'대구',23:'인천',24:'광주',25:'대전',26:'울산',31:'경기',32:'강원',33:'충북',34:'충남',35:'전북',36:'전남',37:'경북',38:'경남'}
raw={};seen=set()
for city,name in city_names.items():
 d=json.loads((CACHE/f'tago-stations-{city}.json').read_text())['response'];assert d['header']['resultCode']=='00'
 b=d['body'];items=b['items']['item'];assert len(items)==b['totalCount']
 for item in items:assert item['nodeid'] not in seen;seen.add(item['nodeid'])
 raw[name]=len(items)
assert len(seen)==349
add('railway_registered','국토교통부 TAGO 국내 기차정보','https://www.data.go.kr/data/15098552/openapi.do','2026-10-17',provinces(raw),'조회 목록에 등록된 기차역 수 · 과거 역 정보 포함 · 현재 운영 중인 전체 철도역 수와 다름 · 미제공 지역은 제외');audit['railway_registered']=raw
# Census household ratios and urban-resident park area: do not add or average rates across merged provinces.
for key,filename,indicator,date,source,basis in [
 ('single_household_ratio','single-household.json','813','2025','국가데이터처 인구총조사 · KOSIS e-지방지표','일반가구 중 1인 가구 비율 · 주민등록 세대와 다름 · 통합지역의 단순 평균은 사용하지 않음'),
 ('urban_park_per_person','parks.json','1035','2025','국토교통부 도시계획현황 · KOSIS e-지방지표','도시공원 조성면적(미집행 제외) ÷ 도시지역 인구 · 원지표 천㎡/천명과 같은 수치 · 통합지역 제외')]:
 d=json.loads((CACHE/filename).read_text())['allRegionDataList'];raw={r['regionNm']:r['vl'] for r in d if r['regionNm'] in short and r['vl'] is not None};assert len(raw)==17
 add(key,source,'https://kosis.kr/visual/eRegionIndex/eRegionWhole.do?unitySrvcId='+indicator,date,provinces(raw,('광주','전남')),basis);audit[key]=raw
# Coastal portal identifies uninhabited islands specifically; do not label this as all islands.
raw={}
for row in t.rows:
 if len(row)==7 and row[0] in short and row[0] not in raw:
  try:raw[row[0]]=int(row[5].replace(',',''))
  except ValueError:pass
assert len(raw)==11 and sum(raw.values())==2910
add('uninhabited_islands','해양수산부 연안포털 · 제5차 연안기본조사','https://coast.mof.go.kr/coastAdmin/research/aspect.do','제5차 연안기본조사',provinces(raw),'지정·미지정 무인도서 합계 · 사람이 사는 섬은 포함하지 않음 · 미수록 내륙 제외');audit['uninhabited_islands']=raw
snow=json.loads((OUT/'snow.json').read_text())
# Fixed, named province observation sites. Never treat station data as an areal mean.
selected={108:'11',156:'12',159:'26',102:'28',133:'30',152:'31',119:'41',131:'43',136:'47',155:'48',184:'50'}
snow_rows=[{'code':selected[r['station_id']],'name':by[selected[r['station_id']]]['short_name']+' · '+r['station_name']+' 관측소','level':'sido','value':r['value'],'station_id':r['station_id']} for r in snow['rows'] if r['station_id'] in selected]
assert len(snow_rows)==len(selected)
add('snow_days',snow['source'],snow['source_url'],snow['ref_date'],snow_rows,snow['basis']+' · 시도마다 명시한 한 관측지점만 비교')
audit['snow_stations']={r['station_name']:r['value'] for r in snow['rows']}
# Public libraries, not school/university/small libraries.
d=json.loads((CACHE/'libraries.json').read_text())['allRegionDataList'];raw={r['regionNm']:r['vl'] for r in d if r['regionNm'] in short and r['vl'] is not None};assert len(raw)==17 and sum(raw.values())==1296
add('public_libraries','문화체육관광부 전국 공공도서관 통계조사 · KOSIS','https://kosis.kr/visual/eRegionIndex/eRegionWhole.do?unitySrvcId=1051','2024',provinces(raw),'전국 공공도서관 통계조사에 수록된 공공도서관 수 · 학교·대학·작은도서관 전체 수와 다름');audit['public_libraries']=raw
# Forest share uses numerator/denominator together, never an average of percentages.
facts=json.loads((CACHE/'forest-data.json').read_text())['data'];forest=defaultdict(dict)
for r in facts:
 if r['iemEnglsNm'] in ['forestArea','landArea']:forest[r['ctprvCd']][r['iemEnglsNm']]=int(r['sttstVal'])
assert len(forest)==17
mapped=defaultdict(lambda: {'forestArea':0,'landArea':0})
for code,r in forest.items():
 if code in ['27','47']:continue # Gunwi transfer changed these provincial boundaries after 2020.
 c={'29':'12','46':'12','45':'52','42':'51'}.get(code,code)
 for key in ['forestArea','landArea']:mapped[c][key]+=r[key]
add('forest_share','산림청 2020 산림기본통계','https://kfss.forest.go.kr/stat/ptl/main/majorStatIndirs.do?curMenu=12505','2020',rows({c:r['forestArea']/r['landArea']*100 for c,r in mapped.items()}),'산림면적 ÷ 국토면적 × 100 · 군위 편입으로 경계가 달라진 대구·경북 제외 · 전남광주는 두 면적을 합산해 계산');audit['forest_share']=dict(forest)
# Census daytime population index is not a phone-based real-time headcount.
text=fitz.open(CACHE/'daytime.pdf')[49].get_text();raw={}
for name in short:
 separated='\\s*'.join(name)
 m=re.search(r'(?m)^'+separated+r'\n([\d,.-]+)\n([\d,.-]+)\n([\d,.-]+)\n([\d,.-]+)\n([\d,.-]+)\n([\d,.-]+)\n([\d,.-]+)\n([\d,.-]+)',text)
 if m:raw[name]=float(m[7])-100
assert len(raw)==17 and abs(raw['서울']-8.8)<1e-9 and abs(raw['세종']+6.6)<1e-9
add('daytime_increase','국가데이터처 2020 인구주택총조사 통근·통학','https://www.kostat.go.kr/boardDownload.es?bid=203&list_no=415274&seq=6','2020',provinces(raw,('광주','전남','대구','경북')),'주간인구지수 − 100(%) · 거주 인구에 통근·통학 순유입을 반영 · 실시간 낮·밤 실측 인구와 다름 · 경계변경·통합 지역 제외');audit['daytime_increase']=raw
book=fitz.open(CACHE/'culture-book.pdf')[8].get_text();raw={}
for m in re.finditer(r'(?m)^('+('|'.join(short))+r')\n([\d,\n]+)',book):
 v=[int(x.replace(',','')) for x in m[2].strip().splitlines()];assert len(v)==19 and v[6]==sum(v[7:10]);raw[m[1]]=v[6]
assert len(raw)==17 and sum(raw.values())==918
add('museum_count','문화체육관광부 2025 전국 문화기반시설 총람','https://www.mcst.go.kr/site/s_policy/dept/deptView.jsp?pSeq=2078','2025-01-01',provinces(raw),'문화기반시설 총람 수록 박물관 수 · 국공립·사립·대학 박물관 합계 · 미술관 제외');audit['museum_count']=raw
# Raw table facts and source hashes make manual transcription explicit and reproducible.
result={'collected_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'regions_as_of':'2026-09-30','metrics':metrics,'audit':audit,'source_sha256':{f:hashlib.sha256((CACHE/f).read_bytes()).hexdigest() for f in ['bike.pdf','rice.pdf','coast','road.pdf','power-all.json','single-household.json','parks.json','libraries.json','forest-data.json','daytime.pdf','culture-book.pdf','bridge.pdf',*[f'tago-stations-{city}.json' for city in city_names]]}}
tmp=OUT/'extra.tmp';tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));tmp.replace(OUT/'extra.json');print(json.dumps({key:len(value['rows']) for key,value in metrics.items()},ensure_ascii=False))
