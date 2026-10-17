-- Expand allowed quiz topics without changing existing games or scores.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE games_new (
  id          TEXT PRIMARY KEY,                                -- 추측 불가능한 무작위 32자(128비트)
  topic       TEXT NOT NULL CHECK (topic IN ('mix', 'population', 'age', 'map', 'cars', 'nature', 'industry')),
  created_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  streak      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'over')),
  over_reason TEXT CHECK (over_reason IS NULL OR over_reason IN ('wrong', 'timeout', 'abandoned', 'error'))
);

CREATE TABLE game_questions_new (
  game_id      TEXT NOT NULL REFERENCES games_new(id),
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

INSERT INTO games_new SELECT * FROM games;
INSERT INTO game_questions_new SELECT * FROM game_questions;
DROP TABLE game_questions;
DROP TABLE games;
ALTER TABLE games_new RENAME TO games;
ALTER TABLE game_questions_new RENAME TO game_questions;
CREATE INDEX idx_games_last_at ON games(last_at);
CREATE TABLE leaderboard_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL CHECK(topic IN ('mix','population','age','map','cars','nature','industry')),
  nickname TEXT NOT NULL,
  streak INTEGER NOT NULL CHECK(streak > 0),
  created_at INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1))
);
INSERT INTO leaderboard_new SELECT * FROM leaderboard;
DROP TABLE leaderboard;
ALTER TABLE leaderboard_new RENAME TO leaderboard;
CREATE INDEX idx_leaderboard_topic_score ON leaderboard(topic, streak DESC, created_at ASC, id ASC);
CREATE INDEX idx_leaderboard_topic_date ON leaderboard(topic, created_at);
PRAGMA defer_foreign_keys = OFF;
