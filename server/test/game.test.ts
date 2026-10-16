import { describe, it, expect, beforeAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import m1 from "../migrations/0001_init.sql?raw";
import m2 from "../migrations/0002_region_display_name.sql?raw";
import m3 from "../migrations/0003_games.sql?raw";
import regionsSql from "../../data/regions.sql?raw";
import statsSql from "../../data/stats/all.sql?raw";
import { createWorker } from "../src/index";
import { STATS, statKeysOfTopic } from "../src/stats";
import { seededRng, pairKey } from "../src/quiz";
import { difficultyFor, purgeOldGames, RETENTION_DAYS, GRACE_MS, TIME_LIMIT_SEC } from "../src/game";

// ── 진짜 SQL을 돌리는 메모리 D1 흉내(node:sqlite) ──
function makeD1() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(m1); sql.exec(m2); sql.exec(m3); sql.exec(regionsSql); sql.exec(statsSql);
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
    for (const t of ["population", "age", "map", "cars", "mix"]) {
      seen[t] = new Set();
      for (let i = 0; i < (t === "mix" ? 150 : 60); i++) seen[t].add((await start(t)).b.question.stat_key);
    }
    expect([...seen.population].every((k) => statKeysOfTopic("population").includes(k as any))).toBe(true);
    expect([...seen.age].every((k) => statKeysOfTopic("age").includes(k as any))).toBe(true);
    expect([...seen.cars].every((k) => statKeysOfTopic("cars").includes(k as any))).toBe(true);
    expect([...seen.map]).toEqual(["area"]);
    expect(seen.population.size).toBe(4); expect(seen.age.size).toBe(3); expect(seen.cars.size).toBe(2);
    expect(seen.mix.size).toBe(10);
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
      const g = (await start("mix")).b;
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
    for (const topic of ["mix", "age"]) {
      const g = (await start(topic)).b;
      let q = g.question;
      for (let n = 1; n <= 100; n++) {
        expect(q.number).toBe(n);
        const a = await answer(g.game_id, q.question_id, right(g.game_id, q.question_id));
        expect(a.b.correct).toBe(true);
        if (n === 100) break;
        q = a.b.next_question;
      }
      const rows = sql.prepare("SELECT stat_key, a_code, b_code FROM game_questions WHERE game_id=? ORDER BY number").all(g.game_id) as any[];
      expect(rows).toHaveLength(101);
      expect(new Set(rows.map((r) => pairKey(r.stat_key, r.a_code, r.b_code))).size).toBe(101);
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
