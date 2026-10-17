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
 data=shops[key];month=data['ref_date'][:4]+'-'+data['ref_date'][4:];basis=f'{month} 소상공인 자료에 등록된 {label} 점포 수'
 add(key+'_count',shops['source']+' · '+data['category'],shops['source_url'],month,data['rows'],basis)
 ratio=[]
 for r in data['rows']:
  if r['code'] in pop and pop[r['code']]>0:ratio.append({**r,'value':r['value']/pop[r['code']]*10000})
 add(key+'_per_10000',shops['source']+' + 행정안전부 주민등록인구(KOSIS)',shops['source_url'],month+' 점포 / '+population['ref_date']+' 인구',ratio,basis+' ÷ '+population['ref_date']+' 인구 × 1만 (서로 다른 기준월)')
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
add('electricity_sales','한국전력공사 전력판매량 · KOSIS e-지방지표','https://kosis.kr/visual/eRegionIndex/eRegionWhole.do?unitySrvcId=911','2025',provinces(raw),'한전이 판매한 전력량(MWh) · 가정·상가·공장 등 전체 용도 · 자가발전 소비와 다를 수 있음');audit['power']=raw
# Raw table facts and source hashes make manual transcription explicit and reproducible.
result={'collected_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'regions_as_of':'2026-09-30','metrics':metrics,'audit':audit,'source_sha256':{f:hashlib.sha256((CACHE/f).read_bytes()).hexdigest() for f in ['bike.pdf','rice.pdf','coast','road.pdf','power-all.json']}}
tmp=OUT/'extra.tmp';tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));tmp.replace(OUT/'extra.json');print(json.dumps({key:len(value['rows']) for key,value in metrics.items()},ensure_ascii=False))
