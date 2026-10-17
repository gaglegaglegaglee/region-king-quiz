// 게임 판 진행: 판 시작 → 문제 받기 → 답 내기. 정답 판정은 출제 때 저장한 answer_code로만 한다.
import { isNatureKey, pickNatureQuestion } from "./nature";
import { GEO_KEYS, pickGeoQuestion } from "./geo";
import { STATS, statKeysOfTopic, type StatKey, type Topic } from "./stats";
import {
  chooseLevel, loadPool, pairKey, pickQuestion, toPublic,
  type QuestionKey, type Difficulty, type Level, type PublicQuestion, type Rng, type ServerQuestion,
} from "./quiz";

export const TIME_LIMIT_SEC = 15;
export const GRACE_MS = 2000; // 네트워크 여유
export const RETENTION_DAYS = 7;
export const DEFAULT_DAILY_GAME_LIMIT = 20000; // 하루 전체 판 시작 상한(UTC 날짜 기준)
export const TOPICS = ["mix", "population", "map"] as const;
export type GameTopic = (typeof TOPICS)[number] | "cars" | "age"; // existing finished games remain readable

export interface GameDeps { db: D1Database; now: () => number; rng: Rng; dailyLimit?: number }

export class GameError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function difficultyFor(number: number): Difficulty {
  return number <= 5 ? "easy" : number <= 15 ? "normal" : "hard";
}

export function newGameId(): string {
  const b = new Uint8Array(16); // 128비트
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const GAME_ID_RE = /^[0-9a-f]{32}$/;
const QUESTION_ID_RE = /^[0-9A-Za-z-]{1,64}$/;
const CODE_RE = /^[0-9A-Za-z]{1,20}$/;

export interface NumberedQuestion extends PublicQuestion { number: number; time_limit_sec: number }
interface StoredValue { code: string; name: string; name_full: string; value: number | null; display?: string }
interface StoredGeo { choices: StoredValue[]; key: string; explanation: string; unit: string }
function decodeStored(json: string): { choices: StoredValue[]; geo?: StoredGeo } {
  const data = JSON.parse(json) as StoredValue[] | StoredGeo;
  return Array.isArray(data) ? { choices: data } : { choices: data.choices, geo: data };
}

function statsOfTopic(topic: GameTopic): StatKey[] {
  return (topic === "mix" ? (Object.keys(STATS) as StatKey[]) : (topic === "population" ? [...statKeysOfTopic("population"), ...statKeysOfTopic("age")] : statKeysOfTopic(topic as Topic))).filter(k=>STATS[k].topic!=="cars");
}

/** 통계를 균등 무작위로 고르되 직전과 같은 통계는 피한다. 자료가 없으면 다음 통계로. */
async function makeQuestion(
  deps: GameDeps, topic: GameTopic, number: number, lastStat: string | null, exclude: Set<string>,
): Promise<ServerQuestion | null> {
  const keys: QuestionKey[] = [...statsOfTopic(topic), ...((topic === "map" || topic === "mix") ? GEO_KEYS : [])];
  const order = keys.filter((k) => k !== lastStat);
  for (let i = order.length - 1; i > 0; i--) { // 무작위 섞기 — 앞에서부터 시도
    const j = Math.floor(deps.rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (keys.includes(lastStat as QuestionKey)) order.push(lastStat as QuestionKey); // 다른 통계로 못 내면 마지막 수단
  const difficulty = difficultyFor(number);
  for (const stat of order) {
    if (isNatureKey(stat)) {
      const q=pickNatureQuestion(stat,difficulty,{rng:deps.rng,exclude,questionId:`q${number}-${crypto.randomUUID().slice(0,8)}`});
      if(q)return q;
      continue;
    }
    if ((GEO_KEYS as string[]).includes(stat)) {
      const q = pickGeoQuestion(stat as typeof GEO_KEYS[number], difficulty, { rng: deps.rng, exclude, questionId: `q${number}-${crypto.randomUUID().slice(0, 8)}` });
      if (q) return q;
      continue;
    }
    const first = chooseLevel(difficulty, deps.rng);
    for (const level of [first, first === "sido" ? "sigungu" : "sido"] as Level[]) {
      const pool = await loadPool(deps.db, stat as StatKey, level, deps.now());
      if (!pool) continue;
      const q = pickQuestion(pool, difficulty, { rng: deps.rng, exclude, questionId: `q${number}-${crypto.randomUUID().slice(0, 8)}` });
      if (q) return q;
    }
  }
  return null;
}

function insertQuestion(db: D1Database, gameId: string, number: number, q: ServerQuestion, now: number): D1PreparedStatement {
  const stored: StoredValue[] = q.choices.map((c) => ({ code: c.code, name: c.name, name_full: q.full_names[c.code], value: q.kind ? null : q.values[c.code], ...(q.displays ? { display: q.displays[c.code] } : {}) }));
  const payload = q.kind ? { choices: stored, key: q.question_key, unit: "", explanation: q.explanation } : stored;
  return db
    .prepare(
      `INSERT INTO game_questions (game_id, question_id, number, stat_key, a_code, b_code, answer_code, values_json, ref_date, source, asked_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(gameId, q.question_id, number, q.stat_key, q.choices[0].code, q.choices[1].code, q.answer_code, JSON.stringify(payload), q.ref_date, q.source, now);
}

function numbered(q: ServerQuestion, number: number): NumberedQuestion {
  return { ...toPublic(q), number, time_limit_sec: TIME_LIMIT_SEC };
}

export async function startGame(deps: GameDeps, body: unknown): Promise<{ game_id: string; question: NumberedQuestion }> {
  const topic = (body as { topic?: unknown } | null)?.topic;
  if (typeof topic !== "string" || !(TOPICS as readonly string[]).includes(topic)) {
    throw new GameError(400, "주제를 골라 주세요 (mix, population, map 중 하나)");
  }
  const now = deps.now();
  // 하루 전체 상한: 한 문장으로 "아직 상한 아래일 때만 1 올리기"(동시에 와도 안전)
  const day = new Date(now).toISOString().slice(0, 10);
  const inc = await deps.db
    .prepare("INSERT INTO daily_counts (day, n) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 WHERE n < ?2")
    .bind(day, deps.dailyLimit ?? DEFAULT_DAILY_GAME_LIMIT)
    .run();
  if ((inc.meta?.changes ?? 0) !== 1) throw new GameError(503, "오늘 게임이 너무 많아요. 내일 다시 해 주세요");
  const q = await makeQuestion(deps, topic as GameTopic, 1, null, new Set());
  if (!q) throw new GameError(503, "지금은 문제를 만들 수 없어요. 잠시 뒤에 다시 해 주세요");
  const id = newGameId();
  await deps.db.batch([
    deps.db.prepare("INSERT INTO games (id, topic, created_at, last_at) VALUES (?1, ?2, ?3, ?3)").bind(id, topic, now),
    insertQuestion(deps.db, id, 1, q, now),
  ]);
  return { game_id: id, question: numbered(q, 1) };
}

interface GameRow { id: string; topic: GameTopic; streak: number; status: "playing" | "over" }
interface QRow {
  question_id: string; number: number; stat_key: string; a_code: string; b_code: string; answer_code: string;
  values_json: string; ref_date: string; source: string; asked_at: number; answered_at: number | null;
}

export interface AnswerResult {
  correct: boolean;
  timed_out?: boolean;
  answer_code: string;
  values: { code: string; name: string; name_full: string; value: number | null; display: string }[];
  explanation?: string;
  unit: string;
  ref_date: string;
  source: string;
  streak: number;
  next_question?: NumberedQuestion;
  game_over?: true;
}

export async function answerGame(deps: GameDeps, body: unknown): Promise<AnswerResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const { game_id, question_id, choice_code } = b;
  if (typeof game_id !== "string" || !GAME_ID_RE.test(game_id)) throw new GameError(400, "판 번호가 올바르지 않아요");
  if (typeof question_id !== "string" || !QUESTION_ID_RE.test(question_id)) throw new GameError(400, "문제 번호가 올바르지 않아요");
  // 시간이 다 돼서 화면이 "끝내기"를 보내는 경우: choice_code가 null이거나 timeout:true. (미리 보내도 포기로 끝나며 맞힌 것으로 치지 않는다)
  const giveUp = b.timeout === true || choice_code === null;
  if (!giveUp && (typeof choice_code !== "string" || !CODE_RE.test(choice_code))) throw new GameError(400, "고른 지역이 올바르지 않아요");

  const db = deps.db;
  const game = await db.prepare("SELECT id, topic, streak, status FROM games WHERE id = ?1").bind(game_id).first<GameRow>();
  if (!game) throw new GameError(404, "찾을 수 없는 판이에요. 새로 시작해 주세요");
  if (game.status === "over") throw new GameError(409, "이미 끝난 판이에요. 새로 시작해 주세요");
  const row = await db
    .prepare(
      `SELECT question_id, number, stat_key, a_code, b_code, answer_code, values_json, ref_date, source, asked_at, answered_at
         FROM game_questions WHERE game_id = ?1 AND question_id = ?2`,
    )
    .bind(game_id, question_id)
    .first<QRow>();
  if (!row) throw new GameError(404, "이 판에 없는 문제예요");
  if (row.answered_at !== null) throw new GameError(409, "이미 답한 문제예요");
  const storedData = decodeStored(row.values_json);
  if (!giveUp && !storedData.choices.some(v => v.code === choice_code)) throw new GameError(400, "이 문제에 없는 지역이에요");

  const now = deps.now();
  const timedOut = giveUp || now - row.asked_at > TIME_LIMIT_SEC * 1000 + GRACE_MS;
  const correct = !timedOut && choice_code === row.answer_code;

  // 같은 문제에 답이 동시에 두 번 와도 한 번만 처리되게 "아직 답 안 한 문제"일 때만 표시한다.
  const claim = await db
    .prepare("UPDATE game_questions SET answered_at = ?3, choice_code = ?4, correct = ?5 WHERE game_id = ?1 AND question_id = ?2 AND answered_at IS NULL")
    .bind(game_id, question_id, now, giveUp ? null : choice_code, correct ? 1 : 0)
    .run();
  if ((claim.meta?.changes ?? 0) !== 1) throw new GameError(409, "이미 답한 문제예요");

  const stored = storedData.choices;
  const def = STATS[row.stat_key as StatKey];
  const result: AnswerResult = {
    correct,
    answer_code: row.answer_code,
    values: stored.map((v) => ({ ...v, display: v.display ?? def.format(v.value as number) })),
    unit: storedData.geo?.unit ?? def.unit,
    ...(storedData.geo ? { explanation: storedData.geo.explanation } : {}),
    ref_date: row.ref_date,
    source: row.source,
    streak: game.streak,
  };
  if (timedOut) result.timed_out = true;

  if (!correct) {
    await db
      .prepare("UPDATE games SET status = 'over', over_reason = ?2, last_at = ?3 WHERE id = ?1")
      .bind(game_id, timedOut ? "timeout" : "wrong", now)
      .run();
    result.game_over = true;
    return result;
  }

  const streak = game.streak + 1;
  result.streak = streak;
  try {
    const prev = await db.prepare("SELECT stat_key, a_code, b_code, values_json FROM game_questions WHERE game_id = ?1").bind(game_id).all<{ stat_key: StatKey; a_code: string; b_code: string; values_json: string }>();
    const exclude = new Set((prev.results ?? []).map((r) => decodeStored(r.values_json).geo?.key ?? pairKey(r.stat_key, r.a_code, r.b_code)));
    const number = row.number + 1;
    const next = await makeQuestion(deps, game.topic, number, row.stat_key, exclude);
    if (!next) { // 낼 문제가 없으면 이 판은 여기서 끝낸다(맞힌 것은 인정)
      await db.prepare("UPDATE games SET status = 'over', over_reason = 'abandoned', streak = ?2, last_at = ?3 WHERE id = ?1").bind(game_id, streak, now).run();
      result.game_over = true;
      return result;
    }
    await db.batch([
      db.prepare("UPDATE games SET streak = ?2, last_at = ?3 WHERE id = ?1").bind(game_id, streak, now),
      insertQuestion(db, game_id, number, next, now),
    ]);
    result.next_question = numbered(next, number);
  } catch {
    // 다음 문제를 만들거나 저장하다 실패: 판이 멈춘 채 남지 않게 끝내고, 맞힌 결과는 인정해서 결과 화면으로 보낸다.
    await db.prepare("UPDATE games SET status = 'over', over_reason = 'error', streak = ?2, last_at = ?3 WHERE id = ?1").bind(game_id, streak, now).run();
    result.next_question = undefined;
    result.game_over = true;
  }
  return result;
}

/** 7일 넘게 움직임이 없는 판과 그 문제 기록을 지운다. 지운 판 수를 돌려준다. */
export async function purgeOldGames(db: D1Database, now: number): Promise<number> {
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const [, del] = await db.batch([
    db.prepare("DELETE FROM game_questions WHERE game_id IN (SELECT id FROM games WHERE last_at < ?1)").bind(cutoff),
    db.prepare("DELETE FROM games WHERE last_at < ?1").bind(cutoff),
    db.prepare("DELETE FROM daily_counts WHERE day < ?1").bind(new Date(cutoff).toISOString().slice(0, 10)),
  ]);
  return del.meta?.changes ?? 0;
}
