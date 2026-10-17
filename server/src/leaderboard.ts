import { GameError, TOPICS, type GameTopic } from './game';

export interface LeaderboardDeps { db: D1Database; now: () => number }
interface FinishedGame { id: string; topic: GameTopic; streak: number; status: string; last_at: number }
export interface ScoreRecord { id: string; topic: GameTopic; nickname: string; streak: number; created_at: number; rank?: number }
const ID = /^[0-9a-f]{32}$/;
const BAD_WORDS = ['시발', '씨발', '씨팔', '시팔', '병신', '븅신', '개새끼', '좆', '씹', '보지', '자지', '섹스', '니애미', '느금마', 'fuck', 'shit', 'bitch', 'sex', 'porn'];
export function validateNickname(value: unknown): string {
  if (typeof value !== 'string') throw new GameError(400, '별명은 한글·영문·숫자 2~10자로 적어 주세요');
  const name = value.normalize('NFKC').trim();
  if (!/^[가-힣A-Za-z0-9]{2,10}$/.test(name)) throw new GameError(400, '별명은 한글·영문·숫자 2~10자로 적어 주세요');
  const lower = name.toLowerCase().replace(/[0-9]/g, '');
  if (BAD_WORDS.some(word => lower.includes(word))) throw new GameError(400, '다른 별명을 써 주세요');
  return name;
}
export function weekStartKst(now: number): number {
  const kst = new Date(now + 9 * 3600000);
  const mondayOffset = (kst.getUTCDay() + 6) % 7;
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - mondayOffset) - 9 * 3600000;
}
function topicOf(value: unknown): GameTopic {
  if (typeof value !== 'string' || !(TOPICS as readonly string[]).includes(value)) throw new GameError(400, '주제를 골라 주세요');
  return value as GameTopic;
}
function gameIdOf(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new GameError(400, '판 번호가 올바르지 않아요');
  return value;
}
async function gameFor(deps: LeaderboardDeps, id: string): Promise<FinishedGame> {
  const row = await deps.db.prepare('SELECT id, topic, streak, status, last_at FROM games WHERE id=?1').bind(id).first<FinishedGame>();
  if (!row) throw new GameError(404, '찾을 수 없는 판이에요. 새로 시작해 주세요');
  return row;
}
async function eligibility(deps: LeaderboardDeps, game: FinishedGame): Promise<string | null> {
  if (game.status !== 'over') return '판을 마친 뒤에 기록을 올릴 수 있어요';
  if (game.streak <= 0) return '1연승부터 순위표에 올릴 수 있어요';
  const answers = await deps.db.prepare(`SELECT COUNT(*) AS verified,
    SUM(CASE WHEN answered_at-asked_at < 200 THEN 1 ELSE 0 END) AS rapid,
    AVG(answered_at-asked_at) AS average_ms FROM game_questions WHERE game_id=?1 AND correct=1 AND answered_at IS NOT NULL`).bind(game.id).first<{verified:number;rapid:number;average_ms:number}>();
  if (!answers || answers.verified !== game.streak) return '서버에서 기록을 확인할 수 없어요';
  if (answers.rapid >= 3 || (answers.verified >= 5 && answers.average_ms < 400)) return '응답 시간이 너무 짧아 순위표에 올릴 수 없는 기록이에요';
  return null;
}
async function rankAt(deps: LeaderboardDeps, game: FinishedGame, since: number, recordId?: string): Promise<number> {
  const row = await deps.db.prepare(`SELECT COUNT(*) AS n FROM leaderboard WHERE removed=0 AND topic=?1 AND created_at>=?2
    AND (streak>?3 OR (streak=?3 AND (created_at<?4 OR (created_at=?4 AND id<?5))))`)
    .bind(game.topic, since, game.streak, game.last_at, recordId ?? '\uffff').first<{n:number}>();
  return 1 + (row?.n ?? 0);
}
export async function estimateRank(deps: LeaderboardDeps, gameId: unknown) {
  const game = await gameFor(deps, gameIdOf(gameId));
  const reason = await eligibility(deps, game);
  if (reason) return {topic:game.topic, streak:game.streak, eligible:false, overall_rank:null, weekly_rank:null, reason};
  const existing = await deps.db.prepare('SELECT id FROM leaderboard WHERE game_id=?1').bind(game.id).first<{id:string}>();
  const since = weekStartKst(deps.now());
  return {topic:game.topic, streak:game.streak, eligible:true,
    overall_rank:await rankAt(deps, game, 0, existing?.id),
    weekly_rank:game.last_at >= since ? await rankAt(deps, game, since, existing?.id) : null};
}
export async function submitScore(deps: LeaderboardDeps, body: unknown) {
  const b = (body ?? {}) as Record<string,unknown>;
  const gameId = gameIdOf(b.game_id);
  const nickname = validateNickname(b.nickname);
  const game = await gameFor(deps, gameId);
  const reason = await eligibility(deps, game);
  if (reason) throw new GameError(400, reason);
  const id = crypto.randomUUID().replace(/-/g, '');
  // The UNIQUE game_id plus INSERT OR IGNORE makes concurrent retries idempotent.
  await deps.db.prepare(`INSERT OR IGNORE INTO leaderboard(id,game_id,topic,nickname,streak,created_at)
    SELECT ?1,id,topic,?2,streak,last_at FROM games WHERE id=?3 AND status='over' AND streak>0`)
    .bind(id, nickname, gameId).run();
  const record = await deps.db.prepare('SELECT id,topic,nickname,streak,created_at FROM leaderboard WHERE game_id=?1 AND removed=0').bind(gameId).first<ScoreRecord>();
  if (!record) throw new GameError(409, '기록이 바뀌었어요. 다시 확인해 주세요');
  return {record, ...(await estimateRank(deps, gameId))};
}
export async function listScores(deps: LeaderboardDeps, topic: unknown = 'mix', period: unknown = 'all') {
  const t = topicOf(topic);
  if (period !== 'all' && period !== 'week') throw new GameError(400, '전체 또는 이번 주 순위를 골라 주세요');
  const weekStart = weekStartKst(deps.now());
  const data = await deps.db.prepare(`SELECT id,topic,nickname,streak,created_at FROM leaderboard
    WHERE removed=0 AND topic=?1 AND created_at>=?2 ORDER BY streak DESC,created_at ASC,id ASC LIMIT 50`)
    .bind(t, period === 'week' ? weekStart : 0).all<ScoreRecord>();
  return {topic:t, period, week_start:weekStart, records:(data.results ?? []).map((row,index)=>({...row,rank:index+1}))};
}
