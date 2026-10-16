# 지역왕

공공데이터(통계청 KOSIS 등)로 문제를 자동으로 만드는 대한민국 지역 퀴즈 웹 게임입니다.
기획은 [PRD.md](PRD.md), 진행 계획은 [SPRINTS.md](SPRINTS.md)에 있습니다.

## 폴더 구성
| 폴더 | 하는 일 | 안내 문서 |
|---|---|---|
| `web/` | 학생이 폰으로 보는 화면(GitHub Pages) | 화면 담당 폴더 |
| `server/` | 게임 서버(Cloudflare Workers + D1 저장소) | [server/README.md](server/README.md) |
| `collector/` | 지역 목록과 통계(인구)를 받아 정리해 서버 저장소에 넣는 프로그램 | [collector/README.md](collector/README.md) |
| `data/` | 정리된 자료(지역 목록, 인구, 대응표)와 받은 원본 | collector 안내 문서 참고 |

비밀 열쇠(통계청 KOSIS 열쇠 등)는 저장소에 올리지 않습니다. 맨 위 폴더의 `.env` 파일에만 두며 `.gitignore`로 막아 두었습니다.
