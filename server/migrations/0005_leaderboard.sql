-- No foreign key: public scores survive the 7-day game-history cleanup.
CREATE TABLE leaderboard (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL CHECK(topic IN ('mix','population','age','map','cars')),
  nickname TEXT NOT NULL,
  streak INTEGER NOT NULL CHECK(streak > 0),
  created_at INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1))
);
CREATE INDEX idx_leaderboard_topic_score ON leaderboard(topic, streak DESC, created_at ASC, id ASC);
CREATE INDEX idx_leaderboard_topic_date ON leaderboard(topic, created_at);
-- A global short-lived throttle stores no address or password.
CREATE TABLE admin_attempts (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
