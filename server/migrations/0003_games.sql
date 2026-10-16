-- 게임 판 기록. 7일 지나면 하루 한 번 도는 정리 작업(cron)이 지운다. 시각은 밀리초(서버 시계).
CREATE TABLE games (
  id          TEXT PRIMARY KEY,                                -- 추측 불가능한 무작위 32자(128비트)
  topic       TEXT NOT NULL CHECK (topic IN ('mix', 'population', 'age', 'map', 'cars')),
  created_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  streak      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'over')),
  over_reason TEXT CHECK (over_reason IS NULL OR over_reason IN ('wrong', 'timeout', 'abandoned', 'error'))
);

CREATE TABLE game_questions (
  game_id      TEXT NOT NULL REFERENCES games(id),
  question_id  TEXT NOT NULL,
  number       INTEGER NOT NULL,                               -- 판 안 번호(1부터)
  stat_key     TEXT NOT NULL,
  a_code       TEXT NOT NULL,
  b_code       TEXT NOT NULL,
  answer_code  TEXT NOT NULL,                                  -- 정답(서버만 안다). 출제 때 저장, 판정은 이 값으로만
  values_json  TEXT NOT NULL,                                  -- 두 지역 이름·값(답을 낸 뒤 해설용)
  ref_date     TEXT NOT NULL,
  source       TEXT NOT NULL,
  asked_at     INTEGER NOT NULL,
  answered_at  INTEGER,
  choice_code  TEXT,
  correct      INTEGER CHECK (correct IS NULL OR correct IN (0, 1)),
  PRIMARY KEY (game_id, question_id),
  UNIQUE (game_id, number)
);

CREATE INDEX idx_games_last_at ON games(last_at);
