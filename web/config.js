/* 지역왕 화면 설정 — 바꿀 값은 이 파일 한 곳에만 있습니다.
   이 파일은 인터넷에 그대로 공개됩니다. 열쇠·비밀번호는 절대 적지 마세요. */
window.JIYEOK_CONFIG = {
  // 게임 서버 주소(배포된 Cloudflare 서버). 내 컴퓨터의 서버로 시험할 때는 "http://127.0.0.1:8787" 로 바꾸고,
  // 그 화면 주소가 server/.dev.vars 의 ALLOWED_ORIGINS 에 있어야 합니다.
  apiBase: "https://region-king-api.dotlee.workers.dev",

  // 모든 화면 맨 아래에 보이는 자료 출처 문구
  sourceText: "자료: 통계청 KOSIS(행정안전부 주민등록 인구통계, 국토교통부) · 행정구역 경계: (준비 중)",

  // 한 줄 설명
  tagline: "실제 공공데이터로 만든 지역 퀴즈, 몇 연승까지 갈 수 있을까?",

  // 주제 버튼 (순서대로 보임). main: true 가 가장 큰 기본 버튼
  topics: [
    { id: "all",  icon: "🎲", name: "모두 섞기", main: true, serverTopic: "mix" },
    { id: "pop",  icon: "👥", name: "인구" },
    { id: "age",  icon: "🎂", name: "나이" },
    { id: "map",  icon: "🗺", name: "지도" },
    { id: "car",  icon: "🚗", name: "자동차" }
  ],

  // 자료 기준 날짜 문구(서버에서 받은 기준월이 {date}에 들어감). 서버에 연결하지 못하면 아무것도 보이지 않습니다.
  dataDateText: "자료 기준: {date}",

  // 게임 진행 설정
  game: {
    nextDelayMs: 1200,        // 맞힌 뒤 다음 문제로 넘어가기까지 (정답·값을 보여 주는 시간)
    requestTimeoutMs: 10000,  // 서버 응답을 기다리는 최대 시간
    defaultTimeLimitSec: 15   // 서버가 시간을 알려 주지 않을 때만 쓰는 값
  },

  // 게임 안내 문구
  texts: {
    loading: "문제를 불러오는 중이에요…",
    correct: "정답이에요! 👏",
    wrong: "아쉬워요, 틀렸어요",
    timeout: "시간이 지났어요",
    endTitle: "{n}연승으로 끝났어요",
    toHome: "홈으로",
    retry: "다시 시도",
    offline: "지금 게임 서버에 연결할 수 없어요. 잠시 후 다시 눌러 주세요.",
    serverError: "서버에서 문제가 생겼어요. 잠시 후 다시 해 주세요.",
    refLine: "기준 {date} · 출처 {source}"
  },

  // 안내 문구
  noRecordText: "기록 없음",
  notReadyText: "준비 중이에요. 조금만 기다려 주세요!"
};
