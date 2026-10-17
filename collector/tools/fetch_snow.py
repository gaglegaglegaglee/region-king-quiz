"""Cache public KMA annual snow-day CSVs; no key or runtime provider calls."""
import csv,io,json,urllib.request,urllib.parse,concurrent.futures,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];CACHE=ROOT/'.cache/expansion';OUT=ROOT/'data/extra/snow.json'
stations={108,165,168,156,170,159,102,133,152,119,131,129,138,136,130,115,155,192,162,184,189,101,105,90,140}
mapped=json.loads((ROOT/'data/nature/nature.json').read_text())['climate']['rows']
def fetch(row):
 sid=row['station_id'];path=CACHE/f'snow-{sid}-2025.csv'
 params=dict(schType='2',dataFormCd='F00512',startYear='2025',endYear='2025',schStnId=str(sid),txtStnNm=row['station_name'],serviceSe='F00101',selectType='1',mddlClssCd='WWRPT01',lrgClssCd='WWRPT',pgmNo='697',firstLoading='N',fileType='csv',startMt='01',endMt='12',startMonth='01',endMonth='12')
 url='https://data.kma.go.kr/climate/snw/selectSnwDownload.do?'+urllib.parse.urlencode(params)
 if not path.exists():path.write_bytes(urllib.request.urlopen(url,timeout=45).read())
 text=path.read_bytes().decode('cp949');lines=list(csv.reader(io.StringIO(text)));annual=next((r for r in lines if len(r)==15 and r[0]=='2025'),None)
 if annual is None:return None
 if any(x in ['―','-',''] for x in annual[1:14]):return None
 months=list(map(float,annual[1:13]));value=float(annual[13]);assert value==sum(months)
 observed={r[1] for r in lines if len(r)==5 and r[0]=='2025' and len(r[1])==4 and r[1].isdigit()}
 assert len(observed)==value,(sid,value,len(observed))
 # Zero cannot establish whether an unstaffed station observed phenomena; omit rather than infer.
 if value<=0:return None
 return dict(code=row['code'],name=row['name'],level='sigungu',value=value,station_id=sid,station_name=row['station_name'],months=months,source_url=url,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:rows=[r for r in ex.map(fetch,[r for r in mapped if r['station_id'] in stations]) if r]
assert len(rows)>=15
OUT.write_text(json.dumps(dict(ref_date='2025',source='기상청 기상현상일수 · 눈일수',source_url='https://data.kma.go.kr/climate/snw/selectSnwChart.do?pgmNo=697',basis='2025년 해당 지역 내 관측지점에서 눈이 관측된 날 수 · 적설량이나 지역 전체 평균과 다름 · 관측값을 확인한 지점만 비교',rows=rows),ensure_ascii=False,indent=2)+'\n');print(json.dumps({r['station_name']:r['value'] for r in rows},ensure_ascii=False))
