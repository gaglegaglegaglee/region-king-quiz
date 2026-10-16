-- 하루(UTC) 판 시작 횟수. 전체 상한(무료 D1 쓰기 한도 보호)에 쓴다. 개인 정보는 담지 않는다.
CREATE TABLE daily_counts (
  day TEXT PRIMARY KEY,   -- YYYY-MM-DD (UTC)
  n   INTEGER NOT NULL
);
