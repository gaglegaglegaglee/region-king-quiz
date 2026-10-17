"""Aggregate official SEMAS shop categories; credentials stay in the collection process."""
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlencode,unquote
from concurrent.futures import ThreadPoolExecutor,as_completed
from collections import Counter
import re,json,gzip,math,time,datetime,hashlib,os
ROOT=Path(__file__).resolve().parents[2];CACHE=ROOT/'.cache/sbiz';OUT=ROOT/'data/shops';CACHE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
secret=os.environ.get('DATA_GO_KR_SERVICE_KEY','')
if not secret:
 envpath=Path(os.environ.get('SBIZ_ENV_FILE','/workspace/Codex_Agent/taekriji/.env.local'))
 if envpath.exists():
  match=re.search(r'^DATA_GO_KR_SERVICE_KEY=(.*)$',envpath.read_text(),re.M)
  if match:secret=unquote(match[1].strip().strip(chr(34)+chr(39)))
if not secret:raise SystemExit('공공데이터 인증 설정이 없습니다. 인증키는 환경변수로 제공하세요.')
regions=json.loads((ROOT/'data/regions.json').read_text())['regions'];legal={r['code']:r for r in regions};merged={c[:5]:r['code'] for r in regions for c in r.get('merged_gu_legal_codes',[])}
def current(code):
 if code in legal:return code
 if code in merged:return merged[code]
 if code[:2] in ['42','45']:code={'42':'51','45':'52'}[code[:2]]+code[2:]
 if code[:2]=='46':code='12'+code[2:]
 code={'29110':'12210','29140':'12240','29155':'12270','29170':'12300','29200':'12330'}.get(code,code)
 return code if code in legal else merged.get(code)
def page(category,n):
 file=CACHE/f'{category}-{n}.json'
 if file.exists():return json.loads(file.read_text())
 params={'serviceKey':secret,'divId':'indsSclsCd','key':category,'numOfRows':1000,'pageNo':n,'type':'json'}
 for attempt in range(4):
  try:
   req=Request('https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInUpjong?'+urlencode(params),headers={'Accept-Encoding':'gzip','User-Agent':'DukyoungPublicDataQuiz/1.0'})
   with urlopen(req,timeout=50) as r:
    raw=r.read();raw=gzip.decompress(raw) if r.headers.get('Content-Encoding')=='gzip' else raw
   obj=json.loads(raw);head=obj.get('header',{});body=obj.get('body',{})
   if str(head.get('resultCode'))!='00':raise ValueError('provider')
   items=body.get('items') or [];items=items if isinstance(items,list) else items.get('item',[])
   result={'month':str(head.get('stdrYm','')),'total':int(body['totalCount']),'page':n,'items':[{'id':str(x['bizesId']),'category':x['indsSclsCd'],'code':str(x['signguCd'])} for x in items]}
   tmp=file.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False));tmp.replace(file);return result
  except Exception:
   if attempt==3:raise RuntimeError(f'공식 점포 자료 수집 실패: 업종 {category}, 페이지 {n}. 인증값과 요청 URL은 숨깁니다.') from None
   time.sleep(attempt+1)
def collect(category):
 first=page(category,1);pages=math.ceil(first['total']/1000);print(json.dumps({'category':category,'rows':first['total'],'pages':pages}),flush=True);allrows=[];months=set();totals=set()
 with ThreadPoolExecutor(max_workers=4) as ex:
  for f in as_completed([ex.submit(page,category,n) for n in range(1,pages+1)]):
   d=f.result();months.add(d['month']);totals.add(d['total']);allrows.extend(d['items'])
 assert len(months)==1 and len(totals)==1 and len(allrows)==first['total']
 assert len({x['id'] for x in allrows})==len(allrows) and all(x['category']==category for x in allrows)
 counts=Counter();unmatched=Counter()
 for x in allrows:
  c=current(x['code'])
  if c:counts[c]+=1
  else:unmatched[x['code']]+=1
 assert sum(unmatched.values())/len(allrows)<.01,dict(unmatched)
 # Historical Incheon split wards cannot be divided from old records. Exclude both new wards and province from questions.
 excluded=set(['28125','28155','28275','28290'])
 affected={code[:2] for code in unmatched}
 for r in regions:
  if r['level']=='sido':
   counts[r['code']]=sum(counts[g['code']] for g in regions if g['parent_code']==r['code'])
   if r['code'] in affected:excluded.add(r['code'])
 rows=[{'code':r['code'],'name':r['display_name'],'level':r['level'],'value':counts[r['code']]} for r in regions if r['code'] not in excluded]
 return {'category':category,'ref_date':next(iter(months)),'reported_total':first['total'],'counted':sum(v for c,v in counts.items() if len(c)==5),'unmatched':dict(unmatched),'excluded':sorted(excluded),'rows':rows}
try:
 result={'source':'소상공인시장진흥공단 상가(상권)정보','source_url':'https://www.data.go.kr/data/15012005/openapi.do','collected_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'공식 소분류별 전국 전체 페이지 수집, 상가업소번호 중복검사 후 시군구 집계. 자료에 등록된 점포 수이며 전체 사업자·소상공인 수가 아님.','convenience':collect('G20405'),'cafe':collect('I21201'),'bakery':collect('I21001'),'karaoke':collect('R10407')}
 tmp=OUT/'shops.tmp';tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));tmp.replace(OUT/'shops.json');print('공식 점포 수 집계 완료',flush=True)
except Exception as e:raise SystemExit(str(e)) from None
