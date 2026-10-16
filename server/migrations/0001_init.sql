-- 지역왕 저장소 첫 구조: 지역, 통계 값, 통계 종류 정보
CREATE TABLE regions (
  code        TEXT PRIMARY KEY,                                -- 행정구역 코드
  name        TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('sido', 'sigungu')),
  parent_code TEXT REFERENCES regions(code),                   -- 소속 시·도 코드(시·도는 비움)
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE stat_values (
  region_code TEXT NOT NULL REFERENCES regions(code),
  stat_key    TEXT NOT NULL,
  value       REAL NOT NULL,
  unit        TEXT NOT NULL,
  ref_date    TEXT NOT NULL,                                   -- 기준 날짜 YYYY-MM 또는 YYYY-MM-DD
  source      TEXT NOT NULL,
  fetched_at  TEXT NOT NULL,                                   -- 받은 시각
  PRIMARY KEY (region_code, stat_key, ref_date)
);

CREATE TABLE stat_meta (
  stat_key        TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  unit            TEXT NOT NULL,
  source          TEXT NOT NULL,
  latest_ref_date TEXT,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_regions_parent ON regions(parent_code);
CREATE INDEX idx_stat_values_key ON stat_values(stat_key, ref_date);
