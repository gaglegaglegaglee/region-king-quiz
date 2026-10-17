# 지역왕 게임 서버 (server/)

Cloudflare Workers(작은 서버 프로그램)와 D1(Cloudflare가 주는 작은 데이터 저장소)으로 만든 게임 서버입니다.
창구(API):
- `GET /api/health` — 서버·자료 상태
- `POST /api/game/start` `{"topic":"mix|population|age|map|cars"}` — 판 시작, 1번 문제(정답 없음)
- `POST /api/game/answer` `{"game_id","question_id","choice_code"}` — 답 내기. 답한 뒤에만 정답·두 값·출처를 알려 주고, 맞히면 `next_question`, 틀리거나 시간(15초 + 여유 2초 = 문제를 낸 뒤 17초까지 인정, 넘으면 틀림)이 지나면 `game_over:true`
- 시간이 다 되면 화면이 `{"game_id","question_id","choice_code":null}`(또는 `"timeout":true`)를 보내 판을 끝내고 정답·두 값을 받습니다. 15초 전에 보내도 포기로 끝나며 맞힌 것으로 치지 않습니다.
- 남용 방지: 한 주소(IP)당 판 시작 분당 20회·답 분당 120회를 넘으면 429 "잠시 후 다시 해 주세요"(주소는 저장하지 않고 Cloudflare 속도 제한 바인딩의 키로만 씁니다). 하루 전체 판 시작이 20,000판(`DAILY_GAME_LIMIT`로 조정)을 넘으면 503 "오늘 게임이 너무 많아요". 다음 문제를 만들다 서버 오류가 나면 그 판은 끝내고(`game_over:true`) 맞힌 연승은 인정합니다.
- 판 기록은 하루 한 번(cron) 7일 지난 것을 지웁니다. 로컬에서는 `wrangler dev --test-scheduled` 후 `/cdn-cgi/handler/scheduled`로 시험

## 처음 한 번: 설치
```
cd server
npm install
```

## 로컬(내 컴퓨터)에서 켜기
계정이 없어도 됩니다. D1은 내 컴퓨터 안에서 흉내 내어 돌립니다.
```
npm run migrate:local   # 저장소 표(지역, 통계 값 등)를 만듭니다
npm run dev             # 서버를 켭니다 (주소: http://127.0.0.1:8787)
```
다른 창에서 확인:
```
curl http://127.0.0.1:8787/api/health
curl -H "Origin: http://127.0.0.1:5500" -i http://127.0.0.1:8787/api/health   # 허용된 화면 주소
curl -H "Origin: https://other.example" -i http://127.0.0.1:8787/api/health   # 403 거절
```
끄려면 서버를 켠 창에서 Ctrl+C.

## 시험
```
npm test        # 동작 시험
npm run typecheck
```

## 허용하는 화면 주소
`wrangler.toml`의 `ALLOWED_ORIGINS`(쉼표로 구분)에 적힌 주소에서 온 요청만 받습니다. 운영에는 GitHub Pages 주소(`https://gaglegaglegaglee.github.io`)만 있습니다. 끝에 `/`나 경로는 붙이지 않습니다.
내 컴퓨터에서 시험할 때의 화면 주소는 `server/.dev.vars` 파일(저장소에 올라가지 않음)에 적습니다.
```
ALLOWED_ORIGINS=http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:8080,http://localhost:8080
```
출처 표시가 없는 요청(주소창에 직접 열기, curl)은 지금은 허용됩니다(health만 있어서).

## 비밀값 (열쇠·비밀번호)
KOSIS 열쇠, 운영자 비밀번호 같은 값은 파일에 적지 않습니다.
- 로컬: `server/.dev.vars` 파일(저장소에 올라가지 않게 막아 둠)
- 배포: `npx wrangler secret put 이름`

## 배포 (이미 올라가 있음: https://region-king-api.dotlee.workers.dev)
Cloudflare 토큰과 계정 ID는 파일에 적지 않고 환경변수 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`로만 넘깁니다(프로젝트 맨 위 `.env`에 보관, 저장소에 올라가지 않음).
다시 올릴 때:
1. 환경변수를 설정한 상태에서 `npm run migrate:remote` (새 마이그레이션이 있을 때만)
2. `npm run deploy`
3. 나온 주소 뒤에 `/api/health`를 붙여 열어 확인합니다.
KOSIS 열쇠는 `npx wrangler secret put KOSIS_API_KEY`로 이미 넣어 두었습니다(값은 어디에도 적지 않습니다).

## 순위와 운영자 API

GET /api/leaderboard?topic=mix&period=all|week, GET /api/leaderboard/estimate?game_id=...
POST /api/leaderboard {game_id,nickname}: 서버가 확인한 종료 판당 한 번 등록합니다. 임의 점수는 받지 않습니다.
POST /api/admin/status {password,page}: 통계 10종과 순위 목록(50개씩)
POST /api/admin/delete {password,id}: 관리자만 삭제합니다. ADMIN_PASSWORD는 Worker Secret에 둡니다.

학교 공용 Wi-Fi를 고려해 IP별 시작120회/분·응답600회/분으로 조정했습니다. 순위 관련240회/분·관리20회/분 제한이 있고 하루 판 시작 상한은 기존20,000입니다. 무료 서비스의 전체 사용량은 공급자 대시보드에서 확인하세요.
