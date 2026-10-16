import { describe, it, expect } from "vitest";
import worker, { type Env } from "../src/index";

function fakeDB(regions: number, metas: { stat_key: string; latest_ref_date: string | null }[], fail = false) {
  return {
    prepare(sql: string) {
      if (fail) throw new Error("내부 비밀 오류 SELECT secret");
      return {
        first: async () => ({ n: regions }),
        all: async () => ({ results: metas }),
      };
    },
  } as unknown as D1Database;
}
const OK = "http://127.0.0.1:5500";
const env = (db: D1Database): Env => ({ DB: db, ALLOWED_ORIGINS: `${OK}, https://user.github.io` });
const get = (path: string, e: Env, headers: Record<string, string> = {}, method = "GET") =>
  worker.fetch(new Request("http://x" + path, { method, headers }), e);

describe("health", () => {
  it("자료가 있으면 개수와 기준 날짜", async () => {
    const r = await get("/api/health", env(fakeDB(267, [{ stat_key: "population", latest_ref_date: "2025-09" }])));
    expect(r.status).toBe(200);
    const b: any = await r.json();
    expect(b).toEqual({ ok: true, message: "게임 서버가 켜져 있어요", data: { regions: 267, stats: [{ key: "population", latest_ref_date: "2025-09" }] } });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
  it("자료가 없으면 안내", async () => {
    const b: any = await (await get("/api/health", env(fakeDB(0, [])))).json();
    expect(b.ok).toBe(true);
    expect(b.message).toBe("아직 통계 자료가 없어요");
  });
});

describe("CORS", () => {
  it("허용 출처는 헤더를 받는다", async () => {
    const r = await get("/api/health", env(fakeDB(0, [])), { Origin: OK });
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(OK);
  });
  it("그 외 출처는 403 + CORS 헤더 없음", async () => {
    const r = await get("/api/health", env(fakeDB(0, [])), { Origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(((await r.json()) as any).message).toMatch(/허용되지 않은/);
  });
  it("OPTIONS 허용/거절", async () => {
    const e = env(fakeDB(0, []));
    const ok = await get("/api/health", e, { Origin: OK }, "OPTIONS");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(OK);
    const no = await get("/api/health", e, { Origin: "https://evil.example" }, "OPTIONS");
    expect(no.status).toBe(403);
    expect(no.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("오류", () => {
  it("404 한국어", async () => {
    const r = await get("/nope", env(fakeDB(0, [])));
    expect(r.status).toBe(404);
    expect(((await r.json()) as any)).toEqual({ ok: false, message: "찾을 수 없는 주소예요" });
  });
  it("405 한국어", async () => {
    const r = await get("/api/health", env(fakeDB(0, [])), {}, "POST");
    expect(r.status).toBe(405);
  });
  it("내부 오류는 한국어, 예외 내용 비노출", async () => {
    const r = await get("/api/health", env(fakeDB(0, [], true)));
    expect(r.status).toBe(500);
    const t = await r.text();
    expect(t).toContain("서버에 문제가 생겼어요");
    expect(t).not.toContain("secret");
  });
});
