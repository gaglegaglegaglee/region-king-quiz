// 지역왕 게임 서버 뼈대: /api/health, 허용 출처(CORS), 한국어 오류.
export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
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
  const regions = await env.DB.prepare("SELECT COUNT(*) AS n FROM regions").first<{ n: number }>();
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

export default {
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
      return json({ ok: false, message: "찾을 수 없는 주소예요" }, 404, origin);
    } catch {
      // 예외 내용·스택은 밖으로 내보내지 않는다.
      return json({ ok: false, message: "서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요" }, 500, origin);
    }
  },
} satisfies ExportedHandler<Env>;
