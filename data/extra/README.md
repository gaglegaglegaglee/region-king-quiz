# 확장 비교 자료

정적 스냅샷을 Worker에 함께 배포합니다. 이용자별 외부 API 요청이나 브라우저 인증키가 필요하지 않습니다. `extra.json`의 각 지표가 출처 URL, 기준일, 비교 기준과 수록 지역을 보존합니다.

| 지표 | 기준 | 지역 범위 |
|---|---|---|
| 편의점·카페·빵집·노래방 등록 점포 수 | 소진공 2026-06 | 242개 시도·시군구 |
| 위 4종의 인구 1만 명당 수 | 위 점포 수 / 주민등록인구 2026-09 × 10,000 | 242개 지역, 두 기준월을 함께 표시 |
| 자전거도로 총연장 | 행안부 2025년 기준 자전거 이용 현황 | 현재 16개 시도 |
| 도로 총연장 | 국토부 2025-12-31 도로현황 통계 | 현재 16개 시도 |
| 해안선 길이 | 해양수산부·국립해양조사원 2025 연안 통계 | 11개 연안 시도 |
| 쌀 생산량 | 국가데이터처 2025 최종 생산량 | 15개 시도, 신뢰도 낮은 서울 제외 |
| 전력 소비량(한전 공급분) | 한전 / KOSIS e-지방지표 2025 | 현재 16개 시도 |

- 자전거도로는 전용도로·보행자 겸용도로·전용차로·우선도로를 합칩니다. 관광 코스의 GPS 길이와 다릅니다.
- 도로는 도로법상 7개 등급의 총연장입니다. 국토교통부 인포그래픽 4쪽의 km 반올림 값을 시각적으로 대조해 전사했습니다. `audit.road`에 원래 17개 시도 값을 보존합니다. 반올림 합계 오차를 맞추려고 어느 지역 값도 조정하지 않습니다.
- 해안선은 자연·인공을 합친 연안의 공식 총계입니다. 원문에서 기타연안으로 분리한 부분은 임의 배분하지 않았고, 미수록 내륙을 0으로 만들지 않습니다.
- 쌀은 논벼+밭벼, 현백률 92.9%(9분도) 백미 기준의 톤 단위 생산량입니다. 벼(조곡)나 10a당 생산량과 구분합니다. 2026 예상생산량 대신 2025 확정 자료를 사용합니다.
- 전력판매량은 가정·상가·공장 등 전체 용도의 한전 판매 전력량(MWh)입니다. 자가발전까지 포함한 총 소비량과 같지 않습니다. KOSIS 공개 지역지표의 한국전력공사 자료를 사용합니다.
- 광주와 전남의 가산 지표는 먼저 합산하여 현재 전남광주로 대응합니다. 비율은 분자·분모를 합산한 뒤 재계산합니다.

## 재현과 원본

`collector/tools/build_extra.py`는 `data/shops/shops.json`, `data/stats/population.json`과 `.cache/expansion/`의 공식 PDF/HTML/JSON을 사용합니다. PyMuPDF가 필요합니다. 다운로드 원본의 SHA-256과 표에서 읽은 기초 수치를 JSON audit에 보존합니다.

원본:
- 행안부: https://mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000014&nttId=129807 (`bike.pdf`, 4쪽)
- 쌀: https://sri.kostat.go.kr/boardDownload.es?bid=228&list_no=439216&seq=3 (`rice.pdf`, 10쪽)
- 해안: https://coast.mof.go.kr/coastAdmin/research/aspect.do (`coast`, 2025 표)
- 도로: https://www.rsis.kr/의 2025 인포그래픽 (`road.pdf`, 4쪽)
- 전력: https://kosis.kr/visual/eRegionIndex/eRegionWhole.do?unitySrvcId=911 (`power-all.json`, 2025)

큰 원본 파일은 캐시에만 보관합니다. 고정 스냅샷 갱신은 재수집·검사·Worker 재배포로 반영하며, 기존 KOSIS 10종 월간 갱신과 별도입니다.

## 전화 지역번호

`phone.json`은 [KTis 114On 전국 지역번호 안내](https://www.114.co.kr/search?tab=market)의 17개 통화권 대응표입니다. 2026-10-17 확인. 번호→지역, 지역→번호 모두 4지선다입니다. 전화 통화권은 행정구역과 다르므로 현재 16개 시도 목록을 그대로 쓰지 않습니다. 광주062·전남061도 독립적으로 유지합니다. 부천032·광명/과천02 등 예외를 안내합니다. 공개 보기 ID는 a/b/c/d로 번호 자체를 정답 식별자에 넣지 않습니다.

## 후속 지표 (2026-10-17 추가)

| 지표 | 기준 | 범위·해석 |
|---|---|---|
| TAGO 등록 기차역 수 | 2026-10-17 조회 | 349개 등록 ID, 현재 15개 시도. 과거 역도 있어 현재 영업역 전수와 다름. 미제공 제주를 0으로 만들지 않음 |
| 1인 가구 비율 | 2025 | 일반가구 기준. 합산 분모 없는 전남광주 제외, 15개 시도 |
| 도시지역 1인당 조성 공원면적 | 2025 | 미집행 면적 제외, **도시지역 인구**로 나눔. 원지표 천㎡/천명과 동일한 수치의 ㎡/명. 통합지역 제외 |
| 무인도 수 | 제5차 연안기본조사 | 연안포털 등록 현황 지정+미지정 2,910개. 유인도 포함 전체 섬 수와 다름 |
| 눈일수 | 2025 | 명시한 관측소 한 곳의 값. 눈 깊이·시도 전체 평균과 다름. 월12개 합=연합계=일별 고유 날짜 수 검증 |
| 공공도서관 수 | 2024 | 문체부/KOSIS 1,296관. 학교·대학·작은도서관 전체 수가 아님 |
| 박물관 수 | 2025-01-01 | 문화기반시설 총람의 국공립·사립·대학 박물관 918관, 미술관 제외 |
| 산림 비율 | 2020 | 산림면적÷국토면적. 통합지역은 분자·분모 합산. 군위 편입 영향 대구·경북 제외 |
| 낮 인구 증감률 | 2020 총조사 | 주간인구지수−100. 통근·통학 순유입에 따른 상대 증감, 통신 기반 실시간 낮밤 측정이 아님. 통합지역 및 대구·경북 제외 |

추가 원문:
- 철도: https://www.data.go.kr/data/15098552/openapi.do (현행 `1613000/TrainInfo/GetCtyCodeList`, `GetCtyAcctoTrainSttnList`; 인증키는 수집에만 사용)
- 가구: https://kosis.kr/visual/eRegionIndex/eRegionWhole.do?unitySrvcId=813
- 공원: https://kosis.kr/visual/eRegionIndex/eRegionWhole.do?unitySrvcId=1035, 산식 확인 공식 보고서 https://mods.go.kr/boardDownload.es?bid=5110&list_no=442364&seq=2
- 도서관: https://kosis.kr/visual/eRegionIndex/eRegionWhole.do?unitySrvcId=1051
- 산림: https://kfss.forest.go.kr/stat/ptl/main/majorStatIndirs.do?curMenu=12505
- 주간인구: https://www.kostat.go.kr/boardDownload.es?bid=203&list_no=415274&seq=6 (인쇄42쪽/PDF50쪽)
- 박물관: https://www.mcst.go.kr/site/s_policy/dept/deptView.jsp?pSeq=2078 (총람9쪽/PDF9쪽)
- 눈: https://data.kma.go.kr/climate/snw/selectSnwChart.do?pgmNo=697

눈 원본은 `collector/tools/fetch_snow.py`로 공개 CSV를 수집합니다. 결측이나 확인되지 않은 0을 추정해서 채우지 않습니다. 원자료 16곳 중 지역별로 고정 선택한 관측소 11곳을 출제하고 보기에도 관측소 이름을 명시합니다. 원자료와 월별 값·SHA256은 `snow.json`에 보존합니다.

### 긴 교량·터널 소재지

`landmarks.json`은 국토부 **2026 도로 교량 및 터널 현황조서**의 최대연장 교량(인쇄11쪽)·장대터널(인쇄37쪽) 목록 중 19건을 수록합니다. 기준일2025-12-31. 질문은 **현황조서에 기재된 소재 시도**를 묻습니다. 위치 주소 한 개가 시설 전체의 행정경계 범위를 뜻하지 않음을 표시합니다. 길이는 시설물 연장으로 접속도로까지 포함한 사업 구간 길이와 다릅니다. 공개 보기 ID는 a/b/c/d입니다.

원본: https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1213 (`bridge.pdf`, 첨부17113)

### 기차역 없는 지역

`railway-absence.json`은 고흥군의 공식 **2025 업무평가**에 철도 부재가 직접 적힌 단일 확인 사례입니다. 보기는 코레일 역 위치정보에 역이 확인되는 순천·목포·보성과 비교합니다. 전국 API 누락을 0으로 처리하거나 전국 무역 지역을 전수 확인한 기능이 아닙니다. 문제 전 기준 문구에는 정답 지역명을 넣지 않고 구체적 근거는 답 제출 후 설명합니다.

원본: https://www.goheung.go.kr/home/www/down/www453/2026/04%20%EA%B4%80%EA%B4%91%EC%A0%95%EC%B1%85%EC%8B%A4.pdf (인쇄118쪽/PDF6쪽), https://www.data.go.kr/data/15127532/fileData.do (2024-04-01 역 좌표)

화면의 가게 관련 안내는 학생에게 익숙한 ‘가게’ 표현을 사용하며, 업종·기준월·수치는 원자료와 동일합니다. 전력은 소비자 관점으로 ‘전력 소비량’이라고 표시하고, 한전 공급분 기준과 자가발전 소비 제외를 함께 안내합니다.
