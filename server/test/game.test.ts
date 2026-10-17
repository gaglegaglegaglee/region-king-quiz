import { describe, it, expect, beforeAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import m1 from "../migrations/0001_init.sql?raw";
import m2 from "../migrations/0002_region_display_name.sql?raw";
import m3 from "../migrations/0003_games.sql?raw";
import m5 from "../migrations/0005_leaderboard.sql?raw";
import m6 from "../migrations/0006_quiz_topics.sql?raw";
import m4 from "../migrations/0004_daily_counts.sql?raw";
import regionsSql from "../../data/regions.sql?raw";
import statsSql from "../../data/stats/all.sql?raw";
import { createWorker } from "../src/index";
import { STATS, statKeysOfTopic } from "../src/stats";
import { seededRng, pairKey } from "../src/quiz";
import { difficultyFor, purgeOldGames, RETENTION_DAYS, GRACE_MS, TIME_LIMIT_SEC } from "../src/game";

// ── 진짜 SQL을 돌리는 메모리 D1 흉내(node:sqlite) ──
function makeD1() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(m1); sql.exec(m2); sql.exec(m3); sql.exec(m4); sql.exec(m5); sql.exec("BEGIN;"+m6+"COMMIT;"); sql.exec(regionsSql); sql.exec(statsSql);
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    first: async () => (sql.prepare(q).get(...args) as any) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
    _exec: () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
  });
  const db = {
    prepare: (q: string) => stmt(q),
    batch: async (list: any[]) => {
      sql.exec("BEGIN");
      try { const r = list.map((s) => s._exec()); sql.exec("COMMIT"); return r; } catch (e) { sql.exec("ROLLBACK"); throw e; }
    },
  } as unknown as D1Database;
  return { db, sql };
}

const ORIGIN = "http://127.0.0.1:5500";
let clock = Date.UTC(2026, 9, 20);
const { db, sql } = makeD1();
const env = { DB: db, ALLOWED_ORIGINS: ORIGIN };
const worker = createWorker({ now: () => clock, rng: seededRng(12345) });

const post = (path: string, body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
  worker.fetch(new Request("http://x" + path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), env);
const start = async (topic = "mix") => { const r = await post("/api/game/start", { topic }); return { r, b: (await r.json()) as any }; };
const answer = async (game_id: string, question_id: string, choice_code: string) => {
  const r = await post("/api/game/answer", { game_id, question_id, choice_code });
  return { r, b: (await r.json()) as any };
};
const answerOf = (gid: string, qid: string) => (sql.prepare("SELECT answer_code a, a_code, b_code FROM game_questions WHERE game_id=? AND question_id=?").get(gid, qid) as any);
const right = (gid: string, qid: string) => answerOf(gid, qid).a as string;
const wrong = (gid: string, qid: string) => { const x = answerOf(gid, qid); return x.a === x.a_code ? x.b_code : x.a_code; };

beforeAll(() => { clock = Date.UTC(2026, 9, 20); });

describe("판 시작", () => {
  it("판 번호는 128비트 무작위, 1번 문제는 공개 모양만", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) { const { b } = await start(); expect(b.game_id).toMatch(/^[0-9a-f]{32}$/); ids.add(b.game_id); }
    expect(ids.size).toBe(30);
    const { r, b } = await start("population");
    expect(r.status).toBe(200);
    expect(Object.keys(b).sort()).toEqual(["game_id", "ok", "question"]);
    expect(Object.keys(b.question).sort()).toEqual(["choices", "number", "question_id", "stat_key", "text", "time_limit_sec"]);
    expect(b.question.number).toBe(1);
    expect(b.question.time_limit_sec).toBe(15);
    expect(b.question.choices).toHaveLength(2);
    const s = JSON.stringify(b);
    expect(s).not.toContain("answer"); expect(s).not.toContain("value"); expect(s).not.toContain("correct");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("주제 필터", async () => {
    const seen: Record<string, Set<string>> = {};
    for (const t of ["population", "nature", "map", "industry", "mix"]) {
      seen[t] = new Set();
      for (let i = 0; i < (t === "mix" ? 150 : 60); i++) seen[t].add((await start(t)).b.question.stat_key);
    }
    expect([...seen.population].every((k) => [...statKeysOfTopic("population"), ...statKeysOfTopic("age")].includes(k as any))).toBe(true);
    expect((await start("age")).r.status).toBe(400);
    expect((await start("cars")).r.status).toBe(400);
    expect([...seen.map].sort()).toEqual(["area", "name_to_shape", "parent", "shape_to_name","position_north","position_south","position_east","position_west"].sort());
    expect(seen.population.size).toBe(7); expect([...seen.industry].sort()).toEqual(["cars","cars_per_1000"]);expect([...seen.nature].sort()).toEqual(["annual_precip","annual_temp","mean_elevation"]);
    expect(seen.mix.size).toBe(20);
  });
  it("시·도는 줄임말, 해설용 정식 이름은 답한 뒤 values에", async () => {
    let found = false;
    for (let i = 0; i < 60 && !found; i++) {
      const { b } = await start("population");
      const names: string[] = b.question.choices.map((c: any) => c.name);
      if (!names.some((n) => /^(서울|부산|세종|경기|강원|충북|전북|전남광주|제주|인천|대구|대전|울산|충남|경북|경남)$/.test(n))) continue;
      found = true;
      expect(b.question.text).toMatch(new RegExp(`^${names[0]}(와|과) ${names[1]} 중`));
      const a = await answer(b.game_id, b.question.question_id, right(b.game_id, b.question.question_id));
      for (const v of a.b.values) expect(v.name_full).not.toBe(v.name);
    }
    expect(found).toBe(true);
  });
  it("잘못된 주제·입력", async () => {
    for (const body of [{}, { topic: "zzz" }, { topic: 3 }, { topic: null }, []]) {
      const r = await post("/api/game/start", body);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).ok).toBe(false);
    }
  });
});

describe("답 내기", () => {
  it("정답 → 다음 문제 → 오답으로 종료, 정답은 답 낸 뒤에만", async () => {
    const g = (await start("population")).b;
    const q1 = g.question;
    const a1 = await answer(g.game_id, q1.question_id, right(g.game_id, q1.question_id));
    expect(a1.r.status).toBe(200);
    expect(a1.b.correct).toBe(true);
    expect(a1.b.streak).toBe(1);
    expect(a1.b.answer_code).toBe(right(g.game_id, q1.question_id));
    expect(a1.b.values).toHaveLength(2);
    expect(a1.b.values[0]).toMatchObject({ display: expect.stringMatching(/.+\d.*/) });
    expect(a1.b.ref_date).toMatch(/^\d{4}-\d{2}/);
    expect(a1.b.source).toBeTruthy();
    expect(a1.b.game_over).toBeUndefined();
    const q2 = a1.b.next_question;
    expect(q2.number).toBe(2);
    expect(q2.question_id).not.toBe(q1.question_id);
    // 다음 문제에 정답·값이 미리 들어 있지 않다
    expect(Object.keys(q2).sort()).toEqual(["choices", "number", "question_id", "stat_key", "text", "time_limit_sec"]);
    expect(JSON.stringify(q2)).not.toMatch(/answer|value|correct/);
    const a2 = await answer(g.game_id, q2.question_id, wrong(g.game_id, q2.question_id));
    expect(a2.b.correct).toBe(false);
    expect(a2.b.game_over).toBe(true);
    expect(a2.b.next_question).toBeUndefined();
    expect(a2.b.streak).toBe(1);
    expect(a2.b.answer_code).toBe(right(g.game_id, q2.question_id));
    const row = sql.prepare("SELECT status, over_reason, streak FROM games WHERE id=?").get(g.game_id) as any;
    expect(row).toEqual({ status: "over", over_reason: "wrong", streak: 1 });
  });
  it("정답 판정은 출제 때 저장한 값으로(원자료와도 일치)", async () => {
    for (let i = 0; i < 40; i++) {
      const g = (await start("population")).b;
      const x = sql.prepare("SELECT stat_key, a_code, b_code, answer_code FROM game_questions WHERE game_id=?").get(g.game_id) as any;
      const val = (c: string) => (sql.prepare("SELECT value FROM stat_values WHERE region_code=? AND stat_key=?").get(c, x.stat_key) as any).value as number;
      const higher = STATS[x.stat_key as keyof typeof STATS].direction === "higher";
      expect(x.answer_code).toBe((val(x.a_code) > val(x.b_code)) === higher ? x.a_code : x.b_code);
    }
  });
  it("15초 + 여유 2초까지 허용, 넘으면 시간 초과로 판 종료", async () => {
    const g1 = (await start()).b;
    clock += TIME_LIMIT_SEC * 1000 + GRACE_MS; // 정확히 17초: 아직 허용
    const ok = await answer(g1.game_id, g1.question.question_id, right(g1.game_id, g1.question.question_id));
    expect(ok.b.correct).toBe(true);
    const g2 = (await start()).b;
    clock += TIME_LIMIT_SEC * 1000 + GRACE_MS + 1;
    const late = await answer(g2.game_id, g2.question.question_id, right(g2.game_id, g2.question.question_id));
    expect(late.r.status).toBe(200);
    expect(late.b.correct).toBe(false);
    expect(late.b.timed_out).toBe(true);
    expect(late.b.game_over).toBe(true);
    expect((sql.prepare("SELECT over_reason r FROM games WHERE id=?").get(g2.game_id) as any).r).toBe("timeout");
    expect((await answer(g2.game_id, g2.question.question_id, "11")).r.status).toBe(409);
  });
  it("거절: 이미 답한 문제·다른 판의 문제·없는 문제·끝난 판·형식 오류", async () => {
    const g = (await start()).b, h = (await start()).b;
    const q1 = g.question;
    // 다른 판의 question_id
    expect((await answer(g.game_id, h.question.question_id, q1.choices[0].code)).r.status).toBe(404);
    // 없는 문제
    expect((await answer(g.game_id, "q9-abcdefgh", q1.choices[0].code)).r.status).toBe(404);
    // 문제에 없는 지역: 400이고 문제는 그대로 풀 수 있다
    const bad = await answer(g.game_id, q1.question_id, "99999");
    expect(bad.r.status).toBe(400); expect(bad.b.ok).toBe(false);
    expect(JSON.stringify(bad.b)).not.toContain(right(g.game_id, q1.question_id) + '"');
    const a1 = await answer(g.game_id, q1.question_id, right(g.game_id, q1.question_id));
    expect(a1.r.status).toBe(200);
    // 이미 답한 문제
    const again = await answer(g.game_id, q1.question_id, right(g.game_id, q1.question_id));
    expect(again.r.status).toBe(409); expect(again.b.message).toBe("이미 답한 문제예요");
    // 끝난 판
    const q2 = a1.b.next_question;
    await answer(g.game_id, q2.question_id, wrong(g.game_id, q2.question_id));
    const over = await answer(g.game_id, q2.question_id, q2.choices[0].code);
    expect(over.r.status).toBe(409); expect(over.b.message).toMatch(/끝난 판/);
    // 형식 오류·없는 판
    expect((await answer("abc", q1.question_id, "11")).r.status).toBe(400);
    expect((await answer("0".repeat(32), q1.question_id, "11")).r.status).toBe(404);
    expect((await answer(g.game_id, "../x", "11")).r.status).toBe(400);
    expect((await post("/api/game/answer", { game_id: g.game_id, question_id: q1.question_id })).status).toBe(400);
    expect((await post("/api/game/answer", { game_id: g.game_id, question_id: q1.question_id, choice_code: 11 })).status).toBe(400);
  });
  it("같은 문제에 동시에 두 번 답해도 한 번만 처리", async () => {
    const g = (await start("population")).b;
    const c = right(g.game_id, g.question.question_id);
    const rs = await Promise.all([1, 2, 3].map(() => answer(g.game_id, g.question.question_id, c)));
    expect(rs.filter((x) => x.r.status === 200)).toHaveLength(1);
    expect(rs.filter((x) => x.r.status === 409)).toHaveLength(2);
    expect((sql.prepare("SELECT COUNT(*) n FROM game_questions WHERE game_id=?").get(g.game_id) as any).n).toBe(2);
  });
});

describe("긴 판", () => {
  it("100문제: 같은 (통계, 두 지역) 반복 없음, 같은 통계 연속 없음, 번호 순서, 난이도 단계", async () => {
    expect([1, 5, 6, 15, 16, 40].map(difficultyFor)).toEqual(["easy", "easy", "normal", "normal", "hard", "hard"]);
    for (const topic of ["mix", "population"]) {
      const g = (await start(topic)).b;
      let q = g.question;
      for (let n = 1; n <= 100; n++) {
        expect(q.number).toBe(n);
        const a = await answer(g.game_id, q.question_id, right(g.game_id, q.question_id));
        expect(a.b.correct).toBe(true);
        if (n === 100) break;
        q = a.b.next_question;
      }
      const rows = sql.prepare("SELECT stat_key, a_code, b_code, values_json FROM game_questions WHERE game_id=? ORDER BY number").all(g.game_id) as any[];
      expect(rows).toHaveLength(101);
      expect(new Set(rows.map((r) => { const v=JSON.parse(r.values_json); return Array.isArray(v) ? pairKey(r.stat_key, r.a_code, r.b_code) : v.key; })).size).toBe(101);
      for (let i = 1; i < rows.length; i++) expect(rows[i].stat_key).not.toBe(rows[i - 1].stat_key);
    }
  });
});

describe("요청 형식", () => {
  it("JSON이 아니거나 너무 크거나 GET이면 한국어로 거절", async () => {
    expect((await post("/api/game/start", '{"topic":"mix"}', { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post("/api/game/start", '{"topic":"mix"}', {})).status).toBe(415);
    expect((await post("/api/game/start", "not json")).status).toBe(400);
    expect((await post("/api/game/start", "[1]")).status).toBe(400);
    const big = await post("/api/game/start", JSON.stringify({ topic: "mix", x: "a".repeat(3000) }));
    expect(big.status).toBe(413);
    const g = await worker.fetch(new Request("http://x/api/game/start"), env);
    expect(g.status).toBe(405);
    const b: any = await g.json(); expect(b.message).toMatch(/[가-힣]/);
  });
  it("허용 출처만 통과하고, 서버 오류는 내용을 숨긴다", async () => {
    const bad = await worker.fetch(new Request("http://x/api/game/start", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: '{"topic":"mix"}' }), env);
    expect(bad.status).toBe(403);
    const ok = await worker.fetch(new Request("http://x/api/game/start", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: '{"topic":"mix"}' }), env);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const broken = { prepare() { throw new Error("SECRET sql"); } } as unknown as D1Database;
    const r = await worker.fetch(new Request("http://x/api/game/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"topic":"mix"}' }), { DB: broken });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("SECRET");
  });
});

describe("7일 지난 판 삭제(cron)", () => {
  const DAY = 24 * 3600 * 1000;
  const mk = (id: string, lastAt: number) => {
    sql.prepare("INSERT INTO games (id, topic, created_at, last_at) VALUES (?,?,?,?)").run(id, "mix", lastAt, lastAt);
    sql.prepare("INSERT INTO game_questions (game_id, question_id, number, stat_key, a_code, b_code, answer_code, values_json, ref_date, source, asked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id, "q1-x", 1, "population", "11", "26", "11", "[]", "2026-09", "s", lastAt);
  };
  it("7일 넘은 판과 문제만 지운다", async () => {
    const now = clock;
    mk("old".padEnd(32, "0"), now - RETENTION_DAYS * DAY - 1000);
    mk("edge".padEnd(32, "0"), now - RETENTION_DAYS * DAY + 1000);
    mk("new".padEnd(32, "0"), now);
    const n = await purgeOldGames(db, now);
    expect(n).toBe(1);
    const ids = (sql.prepare("SELECT id FROM games WHERE id IN (?,?,?)").all("old".padEnd(32, "0"), "edge".padEnd(32, "0"), "new".padEnd(32, "0")) as any[]).map((r) => r.id).sort();
    expect(ids).toEqual(["edge".padEnd(32, "0"), "new".padEnd(32, "0")]);
    expect((sql.prepare("SELECT COUNT(*) n FROM game_questions WHERE game_id=?").get("old".padEnd(32, "0")) as any).n).toBe(0);
    expect((sql.prepare("SELECT COUNT(*) n FROM game_questions WHERE game_id=?").get("edge".padEnd(32, "0")) as any).n).toBe(1);
  });
  it("정해진 시각 작업(scheduled)이 삭제를 실행한다", async () => {
    mk("old2".padEnd(32, "0"), clock - 8 * DAY);
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({} as any, env, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as any);
    await Promise.all(pending);
    expect(sql.prepare("SELECT 1 FROM games WHERE id=?").get("old2".padEnd(32, "0"))).toBeUndefined();
  });
});

describe("남용 방어", () => {
  const postWith = (e: any, path: string, body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request("http://x" + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), e);
  const limiter = (limit: number, seen: string[]) => { let n = 0; return { limit: async ({ key }: { key: string }) => { seen.push(key); return { success: ++n <= limit }; } } as unknown as RateLimit; };

  it("주소별 분당 상한을 넘으면 429(한국어), 주소는 제한 장치 키로만 쓰이고 DB에 남지 않는다", async () => {
    const keys: string[] = [];
    const e = { ...env, START_LIMITER: limiter(2, keys), ANSWER_LIMITER: limiter(1, []) };
    const hdr = { "cf-connecting-ip": "203.0.113.77" };
    expect((await postWith(e, "/api/game/start", { topic: "mix" }, hdr)).status).toBe(200);
    expect((await postWith(e, "/api/game/start", { topic: "mix" }, hdr)).status).toBe(200);
    const r = await postWith(e, "/api/game/start", { topic: "mix" }, hdr);
    expect(r.status).toBe(429);
    expect(((await r.json()) as any).message).toBe("잠시 후 다시 해 주세요");
    expect(keys).toEqual(["203.0.113.77", "203.0.113.77", "203.0.113.77"]);
    const ans = { game_id: "0".repeat(32), question_id: "q1", choice_code: "11" };
    expect((await postWith(e, "/api/game/answer", ans, hdr)).status).toBe(404); // 첫 번째는 통과(판이 없어서 404)
    expect((await postWith(e, "/api/game/answer", ans, hdr)).status).toBe(429);
    const dump = JSON.stringify([sql.prepare("SELECT * FROM games").all(), sql.prepare("SELECT * FROM daily_counts").all()]);
    expect(dump).not.toContain("203.0.113.77");
  });
  it("제한 장치가 고장나도 게임은 막지 않는다", async () => {
    const bad = { limit: async () => { throw new Error("x"); } } as unknown as RateLimit;
    expect((await postWith({ ...env, START_LIMITER: bad }, "/api/game/start", { topic: "mix" })).status).toBe(200);
  });
  it("하루 전체 판 시작 상한을 넘으면 503, 다음 날(UTC)에는 다시 열린다", async () => {
    const saved = clock;
    clock = Date.UTC(2031, 0, 5, 12);
    const e = { ...env, DAILY_GAME_LIMIT: "3" };
    for (let i = 0; i < 3; i++) expect((await postWith(e, "/api/game/start", { topic: "population" })).status).toBe(200);
    const r = await postWith(e, "/api/game/start", { topic: "population" });
    expect(r.status).toBe(503);
    expect(((await r.json()) as any).message).toBe("오늘 게임이 너무 많아요. 내일 다시 해 주세요");
    const before = (sql.prepare("SELECT COUNT(*) n FROM games").get() as any).n;
    // 동시 요청도 상한을 넘지 못한다
    await Promise.all([1, 2, 3, 4].map(() => postWith(e, "/api/game/start", { topic: "population" })));
    expect((sql.prepare("SELECT COUNT(*) n FROM games").get() as any).n).toBe(before);
    expect((sql.prepare("SELECT n FROM daily_counts WHERE day='2031-01-05'").get() as any).n).toBe(3);
    clock = Date.UTC(2031, 0, 6, 0, 0, 1);
    expect((await postWith(e, "/api/game/start", { topic: "population" })).status).toBe(200);
    clock = saved;
  });
  it("잘못된 주제로는 하루 횟수를 쓰지 않는다", async () => {
    const day = new Date(clock).toISOString().slice(0, 10);
    const n0 = (sql.prepare("SELECT n FROM daily_counts WHERE day=?").get(day) as any)?.n ?? 0;
    await post("/api/game/start", { topic: "zzz" });
    expect((sql.prepare("SELECT n FROM daily_counts WHERE day=?").get(day) as any)?.n ?? 0).toBe(n0);
  });
});

describe("다음 문제 만들기 실패", () => {
  it("판을 끝내고 맞힌 결과(연승)와 game_over를 돌려준다", async () => {
    let fail = false;
    const flaky = { prepare: (q: string) => db.prepare(q), batch: async (l: any[]) => { if (fail) throw new Error("D1 장애 SECRET"); return db.batch(l); } } as unknown as D1Database;
    const e = { ...env, DB: flaky };
    const g: any = await (await worker.fetch(new Request("http://x/api/game/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"topic":"population"}' }), e)).json();
    const q = g.question;
    const a1: any = await (await post("/api/game/answer", { game_id: g.game_id, question_id: q.question_id, choice_code: right(g.game_id, q.question_id) })).json();
    expect(a1.next_question.number).toBe(2); // 정상 경로(여기서는 db 직접)
    // 새 판으로 장애 상황 재현
    const g2: any = await (await worker.fetch(new Request("http://x/api/game/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"topic":"population"}' }), e)).json();
    fail = true;
    const r = await worker.fetch(new Request("http://x/api/game/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game_id: g2.game_id, question_id: g2.question.question_id, choice_code: right(g2.game_id, g2.question.question_id) }) }), e);
    fail = false;
    const b: any = await r.json();
    expect(r.status).toBe(200);
    expect(b).toMatchObject({ ok: true, correct: true, streak: 1, game_over: true });
    expect(b.next_question).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain("SECRET");
    expect(sql.prepare("SELECT status, over_reason, streak FROM games WHERE id=?").get(g2.game_id)).toEqual({ status: "over", over_reason: "error", streak: 1 });
    expect((await answer(g2.game_id, g2.question.question_id, "11")).r.status).toBe(409);
  });
});

describe("시간 초과 끝내기와 표시 단위", () => {
  it("choice_code null 또는 timeout:true → 판 timeout 종료, 정답·값 공개, 맞힌 것으로 치지 않음(15초 전이어도)", async () => {
    for (const mk of [(g: any) => ({ game_id: g.game_id, question_id: g.question.question_id, choice_code: null }), (g: any) => ({ game_id: g.game_id, question_id: g.question.question_id, timeout: true })]) {
      const g = (await start("population")).b;
      const r = await post("/api/game/answer", mk(g));
      const b: any = await r.json();
      expect(r.status).toBe(200);
      expect(b).toMatchObject({ ok: true, correct: false, timed_out: true, game_over: true, streak: 0, answer_code: right(g.game_id, g.question.question_id) });
      expect(b.values).toHaveLength(2); expect(b.ref_date).toBeTruthy(); expect(b.source).toBeTruthy();
      expect(sql.prepare("SELECT status, over_reason FROM games WHERE id=?").get(g.game_id)).toEqual({ status: "over", over_reason: "timeout" });
      expect((await post("/api/game/answer", mk(g))).status).toBe(409);
    }
    // 연승 중이어도 그 문제는 틀림, 연승은 유지
    const g = (await start("population")).b;
    const a1 = await answer(g.game_id, g.question.question_id, right(g.game_id, g.question.question_id));
    const q2 = a1.b.next_question;
    const t: any = await (await post("/api/game/answer", { game_id: g.game_id, question_id: q2.question_id, choice_code: null })).json();
    expect(t).toMatchObject({ correct: false, game_over: true, streak: 1 });
  });
  it("값 표시가 문제 문구의 단위와 맞는다", () => {
    expect(STATS.cars_per_1000.format(339)).toBe("1,000명당 339대");
    expect(STATS.density.format(13972)).toBe("1㎢당 13,972명");
    expect(STATS.area.format(39.5)).toBe("39.5㎢");
    expect(STATS.avg_age.format(43.14)).toBe("43.1세");
    expect(STATS.persons_per_household.format(2.25)).toBe("2.25명");
    expect(STATS.pop_change_5y.format(3.5)).toBe("+3.5%");
    expect(STATS.elderly_ratio.format(20.04)).toBe("20.0%");
    expect(STATS.child_ratio.format(9.95)).toMatch(/%$/);
    expect(STATS.population.format(9279861)).toBe("928.0만 명");
    expect(STATS.cars.format(3150052)).toBe("315.0만 대");
  });
});

describe("지도 4지선다 진행과 답 공개", () => {
  it("3·4번째 보기 정답도 인정하고, 모든 지도 유형의 해설은 답 뒤에만 공개한다", async () => {
    const seen = new Set<string>();
    let laterChoice = false;
    const g = (await start("map")).b;
    let q = g.question;
    for (let i = 0; i < 65; i++) {
      const code = right(g.game_id, q.question_id);
      const chosen = q.choices.findIndex((c: any) => c.code === code);
      if (q.kind) {
        seen.add(q.kind);
        expect(q.choices).toHaveLength(4);
        expect(JSON.stringify(q)).not.toMatch(/answer_code|question_key|full_names|displays/);
        if (chosen >= 2) laterChoice = true;
      }
      const a = await answer(g.game_id, q.question_id, code);
      expect(a.r.status).toBe(200); expect(a.b.correct).toBe(true);
      if (q.kind) {
        expect(a.b.values).toHaveLength(4);
        expect(a.b.values.every((v: any) => v.value === null && v.display && v.name_full)).toBe(true);
        expect(a.b.explanation).toBeTruthy();
      }
      q = a.b.next_question;
      expect(q).toBeTruthy();
    }
    expect([...seen].sort()).toEqual(["name_to_shape", "parent", "shape_to_name"]);
    expect(laterChoice).toBe(true);
    const history = sql.prepare("SELECT stat_key,values_json FROM game_questions WHERE game_id=?").all(g.game_id) as any[];
    const keys = history.map(r => { const d = JSON.parse(r.values_json); return Array.isArray(d) ? undefined : d.key; }).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
