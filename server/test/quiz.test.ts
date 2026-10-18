import { describe, it, expect, beforeEach } from "vitest";
import regionsJson from "../../data/regions.json";
import popJson from "../../data/stats/population.json";
import { STATS, josaWaGwa, pairText, statKeysOfTopic, type StatKey } from "../src/stats";
import {
  buildPool, loadPool, pickQuestion, pairKey, pairDiff, clearPoolCache, seededRng, toPublic, chooseLevel, relDiff,
  MIN_REL_DIFF, type Difficulty, type Level, type Pool, type RegionValue,
} from "../src/quiz";

const regions: any[] = regionsJson.regions;
const pop: any = popJson;
const info = new Map(regions.map((r) => [r.code, r]));
const raw = new Map<string, number>(pop.values.map((v: any) => [v.region_code, v.value]));

function rows(level: Level): RegionValue[] {
  return [...raw].filter(([c]) => info.get(c)?.level === level)
    .map(([c, v]) => ({ code: c, name: info.get(c).display_name ?? info.get(c).name, value: v }));
}
const allKeys = (p: Pool) => { // 시험용: 낼 수 있는 모든 짝을 직접 센다
  const out: string[] = [];
  for (let i = 0; i < p.rows.length; i++) for (let j = i + 1; j < p.rows.length; j++)
    if (pairDiff(STATS[p.stat], p.rows[i].value, p.rows[j].value) !== null) out.push(pairKey(p.stat, p.rows[i].code, p.rows[j].code));
  return out;
};
const pools = { sido: buildPool("population", "sido", pop.ref_date, rows("sido")), sigungu: buildPool("population", "sigungu", pop.ref_date, rows("sigungu")) };

describe("조사 와/과", () => {
  it("받침에 맞게", () => {
    expect(pairText("청주", "충주")).toBe("청주와 충주");
    expect(pairText("서울", "제주")).toBe("서울과 제주");
    expect(josaWaGwa("부산광역시")).toBe("와");
    expect(josaWaGwa("서울 중구")).toBe("와");
    expect(josaWaGwa("종로구")).toBe("와");
    expect(josaWaGwa("전남광주통합특별시")).toBe("와");
    expect(josaWaGwa("강원특별자치도")).toBe("와");
    expect(josaWaGwa("남원시")).toBe("와");
    expect(josaWaGwa("광주")).toBe("와");
    expect(josaWaGwa("부안군")).toBe("과");
    expect(josaWaGwa("철원")).toBe("과");
  });
});

describe("통계 목록", () => {
  it("39개 비교 지표의 분야 분류", () => {
    expect(Object.keys(STATS)).toHaveLength(39);
    expect(statKeysOfTopic("population").sort()).toEqual(["daytime_increase", "density", "persons_per_household", "pop_change_5y", "population", "single_household_ratio"]);
    expect(statKeysOfTopic("age").sort()).toEqual(["avg_age", "child_ratio", "elderly_ratio"]);
    expect(statKeysOfTopic("map")).toEqual(expect.arrayContaining(["area","position_north","position_south","position_east","position_west"]));
    expect(statKeysOfTopic("industry").sort()).toEqual(expect.arrayContaining(["cars", "cars_per_1000"]));
    expect(statKeysOfTopic("nature").sort()).toEqual(["annual_precip","annual_temp","mean_elevation","urban_park_per_person","snow_days","forest_share"].sort());
    expect(STATS.avg_age.direction).toBe("lower");
    expect(STATS.population.format(279000)).toBe("27.9만 명");
  });
});

describe("인구 문제 출제", () => {
  const diffs: Difficulty[] = ["easy", "normal", "hard"];
  it("무작위 1,000문제: 정답은 원자료 비교와 같고, 단위·3%·값이 맞다", () => {
    const rng = seededRng(42);
    for (let i = 0; i < 1000; i++) {
      const d = diffs[i % 3];
      const level = chooseLevel(d, rng);
      const q = pickQuestion(pools[level], d, { rng })!;
      expect(q).not.toBeNull();
      const [c1, c2] = q.choices.map((c) => c.code);
      expect(c1).not.toBe(c2);
      expect(info.get(c1).level).toBe(level);
      expect(info.get(c2).level).toBe(level);
      const v1 = raw.get(c1)!, v2 = raw.get(c2)!;
      expect(q.answer_code).toBe(v1 > v2 ? c1 : c2);
      expect(q.values).toEqual({ [c1]: v1, [c2]: v2 });
      expect(relDiff(v1, v2)).toBeGreaterThanOrEqual(MIN_REL_DIFF);
      expect(q.text).toMatch(/인구가 많은 곳은\?$/);
    }
  });
  it("값 없는 지역과 3% 미만 짝은 나오지 않는다", () => {
    const p = buildPool("population", "sido", "x", [
      { code: "1", name: "가", value: 1000000 }, { code: "2", name: "나", value: 1020000 },
      { code: "3", name: "다", value: NaN }, { code: "4", name: "라", value: 2000000 },
    ]);
    expect(allKeys(p).sort()).toEqual(["population|1|4", "population|2|4"]); // 1-2(2%)는 제외, 3은 값 없음
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) { const q = pickQuestion(p, (["easy", "normal", "hard"] as Difficulty[])[i % 3], { rng: seededRng(i) })!; seen.add(pairKey("population", q.choices[0].code, q.choices[1].code)); }
    expect([...seen].sort()).toEqual(["population|1|4", "population|2|4"]);
  });
  it("난이도: 쉬움 > 보통 > 어려움 순으로 차이가 크다", () => {
    const avg = (d: Difficulty) => {
      const rng = seededRng(7); let s = 0;
      for (let i = 0; i < 300; i++) { const q = pickQuestion(pools.sigungu, d, { rng })!; const v = Object.values(q.values); s += relDiff(v[0], v[1]); }
      return s / 300;
    };
    const [e, n, h] = [avg("easy"), avg("normal"), avg("hard")];
    expect(e).toBeGreaterThan(n); expect(n).toBeGreaterThan(h);
    expect(h).toBeLessThan(0.3); expect(e).toBeGreaterThan(0.6);
  });
  it("같은 seed는 같은 문제, 낸 짝은 피한다", () => {
    const a = pickQuestion(pools.sido, "normal", { rng: seededRng(1), questionId: "q1" })!;
    const b = pickQuestion(pools.sido, "normal", { rng: seededRng(1), questionId: "q1" })!;
    expect(b).toEqual(a);
    const used = new Set<string>();
    for (let i = 0; i < 130; i++) { // 시·도 짝은 최대 120개 — 모두 소진할 때까지 중복 없음
      const q = pickQuestion(pools.sido, "easy", { rng: seededRng(i), exclude: used });
      if (!q) break;
      const k = pairKey("population", q.choices[0].code, q.choices[1].code);
      expect(used.has(k)).toBe(false);
      used.add(k);
    }
    expect(used.size).toBe(allKeys(pools.sido).length);
    expect(pickQuestion(pools.sido, "easy", { exclude: used })).toBeNull();
  });
  it("정답과 값은 화면용 모양에 없다", () => {
    const q = pickQuestion(pools.sido, "easy", { rng: seededRng(3) })!;
    const pub = JSON.stringify(toPublic(q));
    expect(pub).not.toContain("answer_code");
    expect(pub).not.toContain("values");
    expect(Object.keys(toPublic(q)).sort()).toEqual(["choices", "question_id", "reference", "stat_key", "text"]);
  });
});

describe("낮을수록 정답(direction lower)", () => {
  it("평균 나이는 작은 쪽이 정답, 문구는 더 젊은 곳", () => {
    const p = buildPool("avg_age", "sido", "2026-09", [
      { code: "11", name: "서울", value: 43.1 }, { code: "26", name: "부산", value: 47.5 },
    ]);
    for (let i = 0; i < 20; i++) {
      const q = pickQuestion(p, "easy", { rng: seededRng(i) })!;
      expect(q.answer_code).toBe("11");
      expect(q.text).toMatch(/^(서울과 부산|부산과 서울) 중 주민 평균 나이가 더 젊은 곳은\?$/);
    }
  });
  it("음수 값(증감률)도 큰 쪽이 정답", () => {
    const p = buildPool("pop_change_5y", "sido", "2026-09", [
      { code: "a", name: "가", value: -3 }, { code: "b", name: "나", value: 2 },
    ]);
    expect(pickQuestion(p, "normal")!.answer_code).toBe("b");
  });
});

describe("D1에서 읽기(가짜 D1)", () => {
  beforeEach(() => clearPoolCache());
  it("통계·단위·최근 기준 날짜로 조회하고 이름은 display_name", async () => {
    let seen: any[] = [];
    const db = { prepare: (sql: string) => ({ bind: (...a: any[]) => { seen = a; expect(sql).toContain("COALESCE(r.display_name, r.name)"); return { all: async () => ({ results: [
      { code: "11140", name: "서울 중구", value: 100000, ref_date: "2026-09" },
      { code: "26110", name: "부산 중구", value: 300000, ref_date: "2026-09" }] }) }; } }) } as unknown as D1Database;
    const p = (await loadPool(db, "population", "sigungu")) as Pool;
    expect(seen).toEqual(["population", "sigungu"]);
    const q = pickQuestion(p, "easy", { rng: seededRng(5) })!;
    expect(q.answer_code).toBe("26110");
    expect(q.text).toMatch(/서울 중구와 부산 중구|부산 중구와 서울 중구/);
    expect(q.ref_date).toBe("2026-09");
  });
  it("자료가 2곳 미만이면 null", async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) } as unknown as D1Database;
    expect(await loadPool(db, "area" as StatKey, "sido")).toBeNull();
  });
});

describe("0 근처·부호 교차·표시 동일(absolute 통계)", () => {
  const mk = (stat: StatKey, vals: number[]) => buildPool(stat, "sigungu", "2026-09", vals.map((v, i) => ({ code: String(i + 1), name: "지" + (i + 1), value: v })));
  it("pop_change_5y: 0.5%p 미만 차이는 안 낸다(0.00 vs 0.02, 0.10 vs 0.13)", () => {
    const def = STATS.pop_change_5y;
    expect(pairDiff(def, 0, 0.02)).toBeNull();
    expect(pairDiff(def, 0.1, 0.13)).toBeNull();
    expect(pairDiff(def, -0.2, 0.2)).toBeNull(); // 0.4%p
    expect(pairDiff(def, -0.5, 0.3)).toBe(0.8);
    expect(pairDiff(def, 1.0, 1.5)).toBeCloseTo(0.5);
  });
  it("무작위 3,000문제에서 absolute 통계의 최소 차이·표시 다름·정답이 지켜진다", () => {
    const rng = seededRng(99);
    const vals = Array.from({ length: 120 }, () => Math.round((rng() * 30 - 12) * 100) / 100); // -12 ~ +18, 0 근처 많음
    for (const [stat, min] of [["pop_change_5y", 0.5], ["elderly_ratio", 1], ["avg_age", 1], ["child_ratio", 1]] as [StatKey, number][]) {
      const p = mk(stat, stat === "pop_change_5y" ? vals : vals.map((v) => 20 + v));
      const def = STATS[stat];
      for (let i = 0; i < 750; i++) {
        const q = pickQuestion(p, (["easy", "normal", "hard"] as Difficulty[])[i % 3], { rng })!;
        const [c1, c2] = q.choices.map((c) => c.code);
        const [v1, v2] = [q.values[c1], q.values[c2]];
        expect(Math.abs(v1 - v2)).toBeGreaterThanOrEqual(min - 1e-9);
        expect(def.format(v1)).not.toBe(def.format(v2));
        const winnerIsHigher = def.direction === "higher";
        expect(q.answer_code).toBe((v1 > v2) === winnerIsHigher ? c1 : c2);
      }
    }
  });
  it("표시가 같으면 relative 통계도 제외(인구 10,000명 근처)", () => {
    expect(pairDiff(STATS.population, 50000, 50400)).toBeNull(); // 최소 차이 1,000명 미만
    expect(pairDiff(STATS.density, 100.2, 100.4)).toBeNull();
    expect(pairDiff(STATS.population, 100000, 130000)).not.toBeNull();
  });
  it("부호가 다른 값끼리도 난이도 띠가 차이(%p) 기준으로 나뉜다", () => {
    const rng = seededRng(5);
    const p = mk("pop_change_5y", Array.from({ length: 100 }, () => Math.round((rng() * 20 - 6) * 10) / 10));
    const avg = (d: Difficulty) => { let s = 0; for (let i = 0; i < 300; i++) { const v = Object.values(pickQuestion(p, d, { rng })!.values); s += Math.abs(v[0] - v[1]); } return s / 300; };
    expect(avg("easy")).toBeGreaterThan(avg("normal")); expect(avg("normal")).toBeGreaterThan(avg("hard"));
  });
});

describe("대규모·속도", () => {
  it("실제 인구 10,000문제 정답 정확성", () => {
    const rng = seededRng(2027);
    const diffs: Difficulty[] = ["easy", "normal", "hard"];
    for (let i = 0; i < 10000; i++) {
      const d = diffs[i % 3];
      const level = chooseLevel(d, rng);
      const q = pickQuestion(pools[level], d, { rng })!;
      const [c1, c2] = q.choices.map((c) => c.code);
      expect(info.get(c1).level).toBe(level); expect(info.get(c2).level).toBe(level);
      expect(q.answer_code).toBe(raw.get(c1)! > raw.get(c2)! ? c1 : c2);
      expect(pairDiff(STATS.population, raw.get(c1)!, raw.get(c2)!)).not.toBeNull();
    }
  });
  it("속도: 풀 만들기와 문제 하나", () => {
    const rs = rows("sigungu");
    const t0 = performance.now(); const p = buildPool("population", "sigungu", "x", rs); const t1 = performance.now();
    const rng = seededRng(1);
    pickQuestion(p, "easy", { rng }); const t2 = performance.now();
    for (let i = 0; i < 1000; i++) pickQuestion(p, "normal", { rng }); const t3 = performance.now();
    console.log(`PERF buildPool ${(t1 - t0).toFixed(2)}ms, 첫 문제 ${(t2 - t1).toFixed(2)}ms, 이후 평균 ${((t3 - t2) / 1000).toFixed(3)}ms`);
    expect((t3 - t2) / 1000).toBeLessThan(1);
  });
  it("loadPool은 잠시 기억해 D1을 다시 읽지 않는다", async () => {
    clearPoolCache(); let n = 0;
    const db = { prepare: () => ({ bind: () => ({ all: async () => { n++; return { results: [{ code: "1", name: "가", value: 100000, ref_date: "2026-09" }, { code: "2", name: "나", value: 300000, ref_date: "2026-09" }] }; } }) }) } as unknown as D1Database;
    await loadPool(db, "population", "sido", 1000); await loadPool(db, "population", "sido", 2000);
    expect(n).toBe(1);
    await loadPool(db, "population", "sido", 1000 + 11 * 60 * 1000);
    expect(n).toBe(2);
  });
});

describe("예시 출력", () => {
  it("쉬움·보통·어려움 예시", () => {
    const out: string[] = [];
    const rng = seededRng(2026);
    for (const [d, n] of [["easy", 7], ["normal", 7], ["hard", 6]] as [Difficulty, number][])
      for (let i = 0; i < n; i++) {
        const level = chooseLevel(d, rng);
        const q = pickQuestion(pools[level], d, { rng })!;
        const f = (c: string) => STATS.population.format(q.values[c]);
        out.push(`[${d}/${level}] ${q.text}  (${q.choices.map((c) => c.name + " " + f(c.code)).join(" vs ")}) 정답: ${q.choices.find((c) => c.code === q.answer_code)!.name}`);
      }
    console.log(out.join("\n"));
    expect(out).toHaveLength(20);
  });
});

// A negative change is still eligible: -3% is higher than -8%, without implying growth.
describe("증감률 질문의 부호 해석", () => {
  it.each([[-8,-3],[-4,2],[1,5],[-3,0],[0,4]])("%s / %s: 증가·감소를 전제하지 않고 더 높은 비율을 정답으로", (a,b) => {
    for (const stat of ["pop_change_5y","daytime_increase"] as const) {
      const pool=buildPool(stat,"sigungu","2026-09",[{code:"11110",name:"가 지역",value:a},{code:"11140",name:"나 지역",value:b}]);
      for(let seed=0;seed<6;seed++) {
        const q=pickQuestion(pool,"normal",{rng:seededRng(seed)})!;
        expect(q.answer_code).toBe("11140");
        expect(q.text).toContain("증감률이 더 높은");
        expect(q.text).not.toMatch(/늘어난|증가한|감소한|줄어든/);
        expect(q.values[q.answer_code]).toBe(b);
        expect(STATS[stat].format(a)).toContain(a.toFixed(1));
      }
    }
  });
});


describe("답을 고르기 전 기준 정보",()=>{
  it("자료의 기준월과 실제 출제 단위를 공개한다",()=>{
    for(const level of ['sido','sigungu'] as const){
      const pool=buildPool('population',level,'2026-09',[{code:'11',name:'가',value:10000},{code:'26',name:'나',value:50000}]);
      const q=pickQuestion(pool,'normal',{rng:seededRng(1)})!,pub=toPublic(q);
      expect(pub.reference).toEqual({date:'2026-09',scope:level==='sido'?'전국 시·도 비교':'전국 시·군·구 비교'});
      expect(JSON.stringify(pub)).not.toMatch(/answer_code|full_names|displays|values/);
    }
  });
  it("5년 인구 변화에는 끝나는 월과 함께 시작하는 월도 표시한다",()=>{
    const pool=buildPool('pop_change_5y','sigungu','2026-09',[{code:'11110',name:'가',value:-8},{code:'11140',name:'나',value:-3}]);
    expect(toPublic(pickQuestion(pool,'normal',{rng:seededRng(1)})!).reference).toEqual({date:'2021-09 ~ 2026-09',scope:'전국 시·군·구 비교'});
  });
});
