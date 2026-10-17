/* 지역왕 화면 설정 — 바꿀 값은 이 파일 한 곳에만 있습니다.
   이 파일은 인터넷에 그대로 공개됩니다. 열쇠·비밀번호는 절대 적지 마세요. */
window.JIYEOK_CONFIG = {
  // 게임 서버 주소(배포된 Cloudflare 서버). 내 컴퓨터의 서버로 시험할 때는 "http://127.0.0.1:8787" 로 바꾸고,
  // 그 화면 주소가 server/.dev.vars 의 ALLOWED_ORIGINS 에 있어야 합니다.
  apiBase: "https://region-king-api.dotlee.workers.dev",

  // 모든 화면 맨 아래에 보이는 자료 출처 문구
  sourceText: "자료: 행정안전부·한국국토정보공사(KOSIS), 국토교통부(KOSIS), 기상청, USGS/Mapzen · 경계: VWorld / KnellBalm(2023) · 인천 신설 4구 모양 제외",

  // 한 줄 설명
  tagline: "비교하면, 우리나라가 보인다. 공공데이터 지역 비교 퀴즈",

  // 주제 버튼 (순서대로 보임). main: true 가 가장 큰 기본 버튼
  topics: [
    { id: "all",  icon: "🎲", name: "모든 분야 도전", main: true, serverTopic: "mix" },
    { id: "pop",  icon: "👥", name: "사람", serverTopic: "population" },
    { id: "nature", icon: "☀", name: "자연", serverTopic: "nature" },
    { id: "map", icon: "🗺", name: "지리", serverTopic: "map" },
    { id: "industry", icon: "🚗", name: "산업", serverTopic: "industry" }
  ],

  // 자료 기준 날짜 문구(서버에서 받은 기준월이 {date}에 들어감). 서버에 연결하지 못하면 아무것도 보이지 않습니다.
  dataDateText: "자료 기준: {date}",

  // 게임 진행 설정
  game: {
    nextDelayMs: 1200,        // (아래 설명 참고)
    resultDelayMs: 1800,      // 틀린 뒤 정답·값을 보여 주다가 결과 화면으로 넘어가기까지        // 맞힌 뒤 다음 문제로 넘어가기까지 (정답·값을 보여 주는 시간)
    requestTimeoutMs: 10000,  // 서버 응답을 기다리는 최대 시간
    defaultTimeLimitSec: 15   // 서버가 시간을 알려 주지 않을 때만 쓰는 값
  },

  // 게임 안내 문구
  texts: {
    loading: "문제를 불러오는 중이에요…",
    correct: "정답이에요!",
    wrong: "아쉬워요, 틀렸어요",
    timeout: "시간이 지났어요",
    endTitle: "{n}연승으로 끝났어요",
    toHome: "홈으로",
    retry: "다시 시도",
    offline: "지금 게임 서버에 연결할 수 없어요. 잠시 후 다시 눌러 주세요.",
    serverError: "서버에서 문제가 생겼어요. 잠시 후 다시 해 주세요.",
    slow: "서버 응답이 늦어요. 잠시 뒤 다시 시도해 주세요.",
    answerIs: "정답은 ‘{name}’{josa}.",
    answerLine: "정답: {name}",
    markRight: "✓ 정답",
    markWrong: "✗ 오답",
    resultTitle: "{n}연승!",
    resultZero: "아쉽게도 첫 문제에서 끝났어요",
    reasons: {
      wrong: "틀려서 끝났어요.",
      timeout: "시간이 지나서 끝났어요.",
      quit: "그만하기를 눌러서 끝났어요.",
      nomore: "더 낼 문제가 없어서 여기서 끝났어요.",
      error: "연결에 문제가 있어서 끝났어요."
    },
    lostResult: "연결이 잠시 끊겨 결과를 확인하지 못했어요. 화면에 보이던 연승까지만 보여 드려요.",
    noExplain: "마지막 문제의 해설을 불러오지 못했어요.",
    lastQuestion: "마지막 문제",
    quit: "그만하기",
    again: "다시 하기",
    refLine: "기준 {date} · 출처 {source}"
  },

  // 안내 문구
  noRecordText: "기록 없음",
  notReadyText: "준비 중이에요. 조금만 기다려 주세요!"
};
