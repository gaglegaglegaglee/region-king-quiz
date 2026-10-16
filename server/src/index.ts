// 지역왕 게임 서버: /api/health, /api/game/start, /api/game/answer, 허용 출처(CORS), 한국어 오류, 하루 한 번 옛 판 정리.
import { GameError, answerGame, purgeOldGames, startGame, type GameDeps } from "./game";
import type { Rng } from "./quiz";
export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  START_LIMITER?: RateLimit; // 주소(IP)별 판 시작 분당 상한 (wrangler.toml [[ratelimits]])
  ANSWER_LIMITER?: RateLimit; // 주소별 답 분당 상한
  DAILY_GAME_LIMIT?: string; // 하루 전체 판 시작 상한(없으면 20,000)
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

async function health(env: Env, origin: string | null): Promise<Response> {
  const regions = await env.DB.prepare("SELECT COUNT(*) AS n FROM regions WHERE active = 1").first<{ n: number }>();
  const metas = await env.DB.prepare(
    "SELECT stat_key, latest_ref_date FROM stat_meta ORDER BY stat_key",
  ).all<{ stat_key: string; latest_ref_date: string | null }>();
  const stats = (metas.results ?? []).map((r) => ({ key: r.stat_key, latest_ref_date: r.latest_ref_date }));
  const count = regions?.n ?? 0;
  const empty = count === 0 && stats.length === 0;
  return json(
    {
      ok: true,
      message: empty ? "아직 통계 자료가 없어요" : "게임 서버가 켜져 있어요",
      data: { regions: count, stats },
    },
    200,
    origin,
  );
}

const MAX_BODY_BYTES = 2048;

/** POST 본문(JSON, 2KB 이하)을 읽는다. 문제가 있으면 GameError. */
async function readJson(request: Request): Promise<unknown> {
  const ct = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(ct)) throw new GameError(415, "JSON 형식으로 보내 주세요");
  const len = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) throw new GameError(413, "요청이 너무 커요");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new GameError(413, "요청이 너무 커요");
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new GameError(400, "요청 내용을 읽을 수 없어요");
  }
}

export interface WorkerOptions { now?: () => number; rng?: Rng }

export function createWorker(opts: WorkerOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const rng = opts.rng ?? Math.random;
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const reqOrigin = request.headers.get("Origin");
      let origin: string | null = null;
      if (reqOrigin !== null) {
        if (!allowedOrigins(env).includes(reqOrigin)) {
          return json({ ok: false, message: "허용되지 않은 주소에서 온 요청이에요" }, 403, null);
        }
        origin = reqOrigin;
      }
      try {
        const { pathname } = new URL(request.url);
        if (request.method === "OPTIONS") {
          const headers = new Headers({ Vary: "Origin" });
          if (origin) {
            headers.set("Access-Control-Allow-Origin", origin);
            headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            headers.set("Access-Control-Allow-Headers", "Content-Type");
            headers.set("Access-Control-Max-Age", "600");
          }
          return new Response(null, { status: 204, headers });
        }
        if (pathname === "/api/health") {
          if (request.method !== "GET" && request.method !== "HEAD") {
            return json({ ok: false, message: "이 방식으로는 쓸 수 없어요" }, 405, origin);
          }
          return await health(env, origin);
        }
        if (pathname === "/api/game/start" || pathname === "/api/game/answer") {
          if (request.method !== "POST") return json({ ok: false, message: "이 방식으로는 쓸 수 없어요" }, 405, origin);
          // 주소는 저장하지 않고 속도 제한 바인딩의 키로만 쓴다(없으면 한 묶음으로 센다).
          const limiter = pathname === "/api/game/start" ? env.START_LIMITER : env.ANSWER_LIMITER;
          if (limiter) {
            let allowed = true;
            try { allowed = (await limiter.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success; } catch { /* 제한 장치 오류는 막지 않는다 */ }
            if (!allowed) return json({ ok: false, message: "잠시 후 다시 해 주세요" }, 429, origin);
          }
          const dl = Number(env.DAILY_GAME_LIMIT);
          const deps: GameDeps = { db: env.DB, now, rng, dailyLimit: Number.isInteger(dl) && dl > 0 ? dl : undefined };
          try {
            const body = await readJson(request);
            const data = pathname === "/api/game/start" ? await startGame(deps, body) : await answerGame(deps, body);
            return json({ ok: true, ...data }, 200, origin);
          } catch (e) {
            if (e instanceof GameError) return json({ ok: false, message: e.message }, e.status, origin);
            throw e;
          }
        }
        return json({ ok: false, message: "찾을 수 없는 주소예요" }, 404, origin);
      } catch {
        // 예외 내용·스택은 밖으로 내보내지 않는다.
        return json({ ok: false, message: "서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요" }, 500, origin);
      }
    },
    // 하루 한 번(wrangler.toml의 crons): 7일 지난 판 기록 삭제
    async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
      ctx.waitUntil(purgeOldGames(env.DB, now()).then(() => undefined));
    },
  };
}

export default createWorker() satisfies ExportedHandler<Env>;
