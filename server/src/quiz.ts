// 통계 비교 문제 출제 엔진. 정답은 서버만 안다(ServerQuestion), 화면에는 PublicQuestion만 보낸다.
import { STATS, pairText, type StatDef, type StatKey } from "./stats";

// 시·도는 문제 문구에 줄임말을 쓴다("세종과 강원"). 시·군·구는 display_name 그대로.
const SIDO_SHORT: Record<string, string> = {
  "11": "서울", "12": "전남광주", "26": "부산", "27": "대구", "28": "인천", "30": "대전", "31": "울산", "36": "세종",
  "41": "경기", "43": "충북", "44": "충남", "47": "경북", "48": "경남", "50": "제주", "51": "강원", "52": "전북",
};
const sidoShort = (code: string, level: Level) => (level === "sido" ? SIDO_SHORT[code] : undefined);

export type Level = "sido" | "sigungu";
export type Difficulty = "easy" | "normal" | "hard";

/** 값 차이가 이 비율 미만인 짝은 내지 않는다(상대 차이 |a-b|/max(|a|,|b|)). 조정하려면 이 값만. */
export const MIN_REL_DIFF = 0.03;
/**
 * 난이도는 "그 통계·단위에서 낼 수 있는 짝들의 차이 순위"로 가른다(통계마다 값 분포가 달라도 통하게).
 * 차이는 통계의 diffMode에 따라 상대(%) 또는 절대(%p·세) 차이다. 모든 짝을 만들지 않고
 * 표본(작은 자료는 전부, 큰 자료는 고정 seed 무작위 SAMPLE_PAIRS쌍)으로 띠 경계(분위)를 근사한다.
 * 차이가 큰 위쪽 35% = 쉬움, 가운데 40% = 보통, 작은 아래 25%(그래도 3% 이상) = 어려움.
 * (아래를 좁게 잡은 이유: 시·군·구 인구처럼 값이 한쪽으로 쏠려 있으면 1/3만 해도 "어려움"이 꽤 벌어진 짝이 된다.)
 */
export const BAND_RANGES: Record<Difficulty, [number, number]> = {
  easy: [0.65, 1],
  normal: [0.25, 0.65],
  hard: [0, 0.25],
};
/** 단위 고르기: 쉬움은 시·도(16곳, 널리 아는 큰 지역) 비중을 높게. */
export const SIDO_SHARE: Record<Difficulty, number> = { easy: 0.5, normal: 0.25, hard: 0.1 };

export interface RegionValue { code: string; name: string; value: number; full?: string /* 정식 이름(해설용) */ }
export const SAMPLE_PAIRS = 800;
const SMALL_POOL = 40; // 이 이하면 짝을 전부 센다(시·도 16곳 = 120짝)
const PICK_TRIES = 40;

export type GeoStatKey = "parent" | "shape_to_name" | "name_to_shape" | "phone_to_region" | "region_to_phone";
export type QuestionKey = StatKey | GeoStatKey;
export interface Shape { path: string; viewBox: string }
export interface MapHint { outline: Shape; highlight: Shape; label: string }
export interface PublicQuestion {
  question_id: string;
  basis?: string;
  stat_key: QuestionKey;
  text: string;
  choices: { code: string; name: string; shape?: Shape }[];
  kind?: GeoStatKey;
  shape?: Shape;
  hint?: MapHint;
}
export interface ServerQuestion extends PublicQuestion {
  level: Level;
  difficulty: Difficulty;
  answer_code: string; // 서버 보관용 — 응답에 넣지 말 것
  values: Record<string, number>; // 코드 → 값(답을 낸 뒤 해설용)
  full_names: Record<string, string>; // 코드 → 정식 이름
  ref_date: string;
  source: string;
  question_key?: string;
  displays?: Record<string, string>;
  explanation?: string;
}
export function toPublic(q: ServerQuestion): PublicQuestion {
  return { question_id: q.question_id, stat_key: q.stat_key, text: q.text, ...(q.basis ? {basis:q.basis} : {}), choices: q.choices.map((c) => ({ code: c.code, name: c.name, ...(c.shape ? { shape: c.shape } : {}) })), ...(q.kind ? { kind: q.kind } : {}), ...(q.shape ? { shape: q.shape } : {}), ...(q.hint ? { hint: q.hint } : {}) };
}

export type Rng = () => number;
/** 재현 가능한 난수(mulberry32). 시험에서 seed를 넣는다. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const relDiff = (x: number, y: number): number => {
  const m = Math.max(Math.abs(x), Math.abs(y));
  return m === 0 ? 0 : Math.abs(x - y) / m;
};

/** 같은 (통계, 두 지역) 키. 순서와 무관. */
export function pairKey(stat: StatKey, c1: string, c2: string): string {
  return c1 < c2 ? `${stat}|${c1}|${c2}` : `${stat}|${c2}|${c1}`;
}

/**
 * 두 값으로 문제를 낼 수 있으면 "차이"를, 없으면 null.
 * 낼 수 없는 경우: 3%(relative) 미만, 최소 차이 미만, 화면에 보이는 값(format)이 같음.
 */
export function pairDiff(def: StatDef, x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const abs = Math.abs(x - y);
  if (abs < def.minAbsDiff) return null;
  let d = abs;
  if (def.diffMode === "relative") {
    d = relDiff(x, y);
    if (d < MIN_REL_DIFF) return null;
  }
  if (def.format(x) === def.format(y)) return null;
  return d;
}

export interface Pool {
  stat: StatKey;
  level: Level;
  ref_date: string;
  source: string;
  rows: RegionValue[]; // 값 오름차순(값 없는 지역 제외)
  t1: number; // 어려움/보통 경계 차이
  t2: number; // 보통/쉬움 경계 차이
  hi: number; // 가능한 최대 차이(근사)
  empty: boolean; // 낼 수 있는 짝이 없음
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

/** 같은 단위 지역들의 값을 정렬하고 난이도 띠 경계를 계산한다(짝 전체를 만들지 않는다). */
export function buildPool(stat: StatKey, level: Level, ref_date: string, input: RegionValue[], source = ""): Pool {
  const def = STATS[stat];
  const rows = input.filter((r) => Number.isFinite(r.value)).sort((p, q) => p.value - q.value);
  const n = rows.length;
  const diffs: number[] = [];
  if (n <= SMALL_POOL) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = pairDiff(def, rows[i].value, rows[j].value); if (d !== null) diffs.push(d); }
  } else {
    const rng = seededRng(0x5eed + n); // 고정 seed — 같은 자료면 같은 경계
    for (let k = 0; k < SAMPLE_PAIRS; k++) {
      const i = Math.floor(rng() * n); let j = Math.floor(rng() * (n - 1)); if (j >= i) j++;
      const d = pairDiff(def, rows[i].value, rows[j].value); if (d !== null) diffs.push(d);
    }
  }
  if (diffs.length === 0) return { stat, level, ref_date, source, rows, t1: 0, t2: 0, hi: 0, empty: true };
  diffs.sort((p, q) => p - q);
  const hi = def.diffMode === "relative" ? Math.min(1, diffs[diffs.length - 1]) : rows[n - 1].value - rows[0].value;
  return { stat, level, ref_date, source, rows, t1: quantile(diffs, BAND_RANGES.hard[1]), t2: quantile(diffs, BAND_RANGES.easy[0]), hi: Math.max(hi, diffs[diffs.length - 1]), empty: false };
}

// 같은 isolate 안에서 자료를 잠시 기억한다(자료는 한 달에 한 번 바뀜). 문제마다 D1을 읽지 않게.
const POOL_TTL_MS = 10 * 60 * 1000;
const poolCache = new Map<string, { at: number; pool: Pool | null }>();
export function clearPoolCache(): void { poolCache.clear(); }

/** D1에서 그 통계의 가장 최근 기준 날짜 값을 읽는다(지역은 active, 같은 단위만). */
export async function loadPool(db: D1Database, stat: StatKey, level: Level, now: number = Date.now()): Promise<Pool | null> {
  const ck = `${stat}|${level}`;
  const hit = poolCache.get(ck);
  if (hit && now - hit.at < POOL_TTL_MS) return hit.pool;
  const res = await db
    .prepare(
      `SELECT r.code AS code, COALESCE(r.display_name, r.name) AS name, v.value AS value, v.ref_date AS ref_date, v.source AS source
         FROM stat_values v JOIN regions r ON r.code = v.region_code
        WHERE v.stat_key = ?1 AND r.level = ?2 AND r.active = 1
          AND v.ref_date = (SELECT MAX(ref_date) FROM stat_values WHERE stat_key = ?1)
        ORDER BY r.code`,
    )
    .bind(stat, level)
    .all<{ code: string; name: string; value: number; ref_date: string; source: string }>();
  const rows = res.results ?? [];
  const pool = rows.length < 2 ? null : buildPool(stat, level, rows[0].ref_date, rows.map((x) => ({ code: x.code, name: sidoShort(x.code, level) ?? x.name, full: x.name, value: x.value })), rows[0].source ?? "");
  poolCache.set(ck, { at: now, pool });
  return pool;
}

export interface PickOptions {
  rng?: Rng;
  /** 이미 낸 pairKey 모음 — 같은 판 중복 방지(S2-3에서 판 기록으로 채움) */
  exclude?: ReadonlySet<string>;
  questionId?: string;
}

const inBand = (d: number, band: Difficulty, p: Pool) => (band === "hard" ? d < p.t1 : band === "normal" ? d >= p.t1 && d < p.t2 : d >= p.t2);

/** 정렬된 값에서 target에 가장 가까운 위치(이분 탐색). */
function nearestIndex(rows: RegionValue[], target: number): number {
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].value < target) lo = mid + 1; else hi = mid; }
  return lo;
}

/** 그 띠에서 짝 하나. 무작위 지역 + 띠의 차이에 해당하는 상대 지역을 이분 탐색, 안 되면 작은 자료는 전수 탐색. */
function pickPair(pool: Pool, band: Difficulty, rng: Rng, taken: (a: RegionValue, b: RegionValue) => boolean): [RegionValue, RegionValue] | null {
  const def = STATS[pool.stat];
  const rows = pool.rows, n = rows.length;
  const lo = band === "hard" ? 0 : band === "normal" ? pool.t1 : pool.t2;
  const hi = band === "hard" ? pool.t1 : band === "normal" ? pool.t2 : pool.hi;
  const ok = (a: RegionValue, b: RegionValue) => {
    const d = pairDiff(def, a.value, b.value);
    return d !== null && inBand(d, band, pool) && !taken(a, b);
  };
  for (let t = 0; t < PICK_TRIES; t++) {
    const i = Math.floor(rng() * n);
    const v = rows[i].value;
    const d = lo + rng() * Math.max(hi - lo, 0);
    const up = rng() < 0.5;
    let target: number;
    if (def.diffMode === "absolute") target = up ? v + d : v - d;
    else if (v > 0 && d < 1) target = up ? v / (1 - d) : v * (1 - d);
    else target = rows[Math.floor(rng() * n)].value;
    const c = nearestIndex(rows, target);
    for (const j of [c, c - 1, c + 1]) {
      if (j >= 0 && j < n && j !== i && ok(rows[i], rows[j])) return [rows[i], rows[j]];
    }
  }
  if (n <= SMALL_POOL) { // 작은 자료는 빠짐없이 훑는다(낼 수 있는 짝이 남았는데 못 내는 일이 없게)
    const start = Math.floor(rng() * n);
    for (let k = 0; k < n; k++) for (let m = 0; m < n; m++) {
      const i = (start + k) % n;
      if (i !== m && ok(rows[i], rows[m])) return [rows[i], rows[m]];
    }
  }
  return null;
}

/** 난이도 띠(가까운 띠 순으로 대체)에서 짝을 골라 문제를 만든다. 낼 수 있는 짝이 없으면 null. */
export function pickQuestion(pool: Pool, difficulty: Difficulty, opts: PickOptions = {}): ServerQuestion | null {
  const rng = opts.rng ?? Math.random;
  if (pool.empty || pool.rows.length < 2) return null;
  const order: Difficulty[] =
    difficulty === "easy" ? ["easy", "normal", "hard"] : difficulty === "hard" ? ["hard", "normal", "easy"] : ["normal", "easy", "hard"];
  const taken = (a: RegionValue, b: RegionValue) => !!opts.exclude?.has(pairKey(pool.stat, a.code, b.code));
  let chosen: [RegionValue, RegionValue] | null = null;
  let usedDifficulty: Difficulty = difficulty;
  for (const d of order) {
    chosen = pickPair(pool, d, rng, taken);
    if (chosen) { usedDifficulty = d; break; }
  }
  if (!chosen) return null;
  const def = STATS[pool.stat];
  const [first, second] = rng() < 0.5 ? [chosen[1], chosen[0]] : chosen; // 정답이 늘 같은 쪽에 오지 않게
  const winner = (def.direction === "higher") === (first.value > second.value) ? first : second;
  return {
    question_id: opts.questionId ?? crypto.randomUUID(),
    stat_key: pool.stat,
    text: def.question.replace("{pair}", pairText(first.name, second.name)),
    ...(def.basis ? {basis:def.basis} : {}),
    choices: [{ code: first.code, name: first.name }, { code: second.code, name: second.name }],
    level: pool.level,
    difficulty: usedDifficulty,
    answer_code: winner.code,
    values: { [first.code]: first.value, [second.code]: second.value },
    full_names: { [first.code]: first.full ?? first.name, [second.code]: second.full ?? second.name },
    ref_date: pool.ref_date,
    source: pool.source,
  };
}

export function chooseLevel(difficulty: Difficulty, rng: Rng = Math.random): Level {
  return rng() < SIDO_SHARE[difficulty] ? "sido" : "sigungu";
}
