# 지역왕 게임 서버 (server/)

Cloudflare Workers(작은 서버 프로그램)와 D1(Cloudflare가 주는 작은 데이터 저장소)으로 만든 게임 서버입니다.
지금은 "서버가 켜져 있는지" 알려 주는 `GET /api/health`만 있습니다.

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
`wrangler.toml`의 `ALLOWED_ORIGINS`(쉼표로 구분)에 적힌 주소에서 온 요청만 받습니다.
GitHub Pages 주소(예: `https://내아이디.github.io`)는 배포 때 추가합니다. 끝에 `/`나 경로는 붙이지 않습니다.
주소창에 직접 열거나 curl처럼 출처 표시가 없는 요청은 지금은 허용됩니다(health만 있어서).

## 비밀값 (열쇠·비밀번호)
KOSIS 열쇠, 운영자 비밀번호 같은 값은 파일에 적지 않습니다.
- 로컬: `server/.dev.vars` 파일(저장소에 올라가지 않게 막아 둠)
- 배포: `npx wrangler secret put 이름`

## 배포 (Cloudflare 계정을 만든 뒤)
1. `npx wrangler login` 으로 로그인합니다.
2. `npx wrangler d1 create region-king` 을 실행하면 `database_id`가 나옵니다.
3. `wrangler.toml`의 `database_id`를 그 값으로 바꿉니다. (계정 ID는 파일에 적지 않습니다. 이 값을 저장소에 올릴지는 올리기 전에 확인하세요.)
4. `ALLOWED_ORIGINS`에 GitHub Pages 주소를 추가합니다.
5. `npm run migrate:remote` 로 실제 저장소에 표를 만듭니다.
6. `npm run deploy` 로 올립니다. 나오는 주소 뒤에 `/api/health`를 붙여 열어 확인합니다.
