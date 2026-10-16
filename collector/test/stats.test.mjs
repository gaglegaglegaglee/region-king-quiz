import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KosisError } from "../src/kosis.mjs";
import { ageRows, areaRows, carsRows, codeRows, buildAllStats, matchOldPopulation, STAT_DEFS, TABLES, CARS_QUIZ_MAX_PER_1000 } from "../src/stats.mjs";

// ---- 가짜 지역 목록(작게) ----
const R = (code, name, level, parent, short, extra = {}) => ({ code, name, display_name: name, level, parent_code: parent, short_name: short, ...extra });
const REGIONS = [
  R("11", "서울특별시", "sido", null, "서울"), R("11680", "강남구", "sigungu", "11", "서울"), R("11140", "중구", "sigungu", "11", "서울"),
  R("12", "전남광주통합특별시", "sido", null, "전남광주"), R("12210", "동구", "sigungu", "12", "전남광주"), R("12110", "목포시", "sigungu", "12", "전남광주"),
  R("27", "대구광역시", "sido", null, "대구"), R("27720", "군위군", "sigungu", "27", "대구"),
  R("28", "인천광역시", "sido", null, "인천"), R("28125", "제물포구", "sigungu", "28", "인천"),
  R("41", "경기도", "sido", null, "경기"), R("41110", "수원시", "sigungu", "41", "경기", { merged_gu_legal_codes: ["4111100000", "4111300000"] }),
];
// 현재 인구(2026-09) / 자동차와 같은 달 인구(2026-08)
const POP = { "11680": 500, "11140": 100, "12210": 80, "12110": 120, "27720": 20, "28125": 50, "41110": 300 };
const sidoOf = { "11680": "11", "11140": "11", "12210": "12", "12110": "12", "27720": "27", "28125": "28", "41110": "41" };
const withSido = (m) => { const o = { ...m }; for (const [c, v] of Object.entries(m)) o[sidoOf[c]] = (o[sidoOf[c]] ?? 0) + v; return o; };
const POPALL = withSido(POP);
const POP_AUG = withSido({ ...POP, "11680": 490 }); // 8월은 조금 다름
const OLD = { "11680": 400, "11140": 110, "29110": 70, "46110": 100, "47720": 25, "41110": 250 }; // 2021년: 광주 동구, 전남 목포, 경북 군위군
const NAMES = { "11": "서울특별시", "11680": "강남구", "11140": "중구", "12": "전남광주통합특별시", "12210": "동구", "12110": "목포시", "27": "대구광역시", "27720": "군위군", "28": "인천광역시", "28125": "제물포구", "41": "경기도", "41110": "수원시" };

const tot = (m) => Object.values(m).reduce((s, v) => s + v, 0);
const natOf = (all) => Object.entries(all).filter(([c]) => c.length === 2).reduce((s, [, v]) => s + v, 0);

function codeResp(vals, names, itm, prd) {
  const rows = Object.entries(vals).map(([c, v]) => ({ C1: c, C1_NM: names[c], DT: String(v), ITM_ID: itm, PRD_DE: prd }));
  rows.unshift({ C1: "00", C1_NM: "전국", DT: String(natOf(vals)), ITM_ID: itm, PRD_DE: prd });
  return rows;
}
// 나이 분포: [나이, 비율]
function ageResp(shares, prd = "202609") {
  const rows = [];
  const add = (c, n, nm, v) => rows.push({ C1: c, C1_NM: nm, C2_NM: n, DT: String(v), ITM_ID: "T2", PRD_DE: prd });
  const all = { ...POPALL };
  for (const [c, total] of [["00", natOf(all)], ...Object.entries(all)]) {
    const sh = c === "11140" ? [[5, 0.1], [40, 0.4], [70, 0.5]] : shares;
    add(c, "계", "x", total);
    for (let a = 0; a <= 100; a++) {
      const f = sh.find(([age]) => age === a);
      add(c, a === 100 ? "100세 이상" : `${a}세`, NAMES[c] ?? "전국", f ? Math.round(total * f[1]) : 0);
    }
  }
  for (const r of rows) r.C1_NM = r.C1 === "00" ? "전국" : NAMES[r.C1];
  return rows;
}
const SH = [[5, 0.2], [40, 0.5], [70, 0.3]];

function areaResp() {
  const A = { 서울특별시: { _: 50, 강남구: 40, 중구: 10 }, 광주광역시: { _: 50, 동구: 50 }, 전라남도: { _: 40, 목포시: 40 }, 대구광역시: { _: 600, 군위군: 600 }, 인천광역시: { _: 5, 중구: 3, 동구: 1, 서구: 1 }, 경기도: { _: 120, 수원시: 120 } };
  const rows = [];
  const mk = (c, nm, km2) => rows.push({ C1: c, C1_NM: nm, C2_NM: "합계", DT: String(km2 * 1e6), ITM_ID: TABLES.area.itmId, PRD_DE: "2025" });
  let total = 0, i = 1;
  for (const [sido, subs] of Object.entries(A)) {
    const sc = "15315HJG" + String(i).padStart(3, "0"); i++;
    mk(sc, sido, subs._);
    total += subs._;
    let j = 1;
    for (const [n, v] of Object.entries(subs)) if (n !== "_") mk(sc + String(j++).padStart(3, "0"), n, v);
  }
  mk("15315HJG000", "전국", total);
  return rows;
}
const AREA_RESP = areaResp();
// 지역 합 검사(시·군·구 합 ≥ 전국의 97%)가 가짜 자료에서 성립하도록 인천 옛 구(중·동·서)가 지역 목록에 없어 빠지는 몫을 작게 둔다
function carsResp(prd = "202608", extra = []) {
  const C = [["서울", "계", 700], ["서울", "강남구", 400], ["서울", "중구", 300],
    ["전남광주", "계", 900], ["전남광주", "동구", 500], ["전남광주", "목포시", 400],
    ["대구", "계", 100], ["대구", "군위군", 100], ["인천", "계", 100], ["인천", "제물포구", 100],
    ["경기", "계", 400], ["경기", "수원시 장안구", 150], ["경기", "수원시 권선구", 200], ["경기", "수원시", 50], ...extra];
  return C.map(([s, n, v]) => ({ C1_NM: s, C2_NM: n, C3_NM: "총계", DT: String(v), ITM_ID: TABLES.cars.itmId, PRD_DE: prd }));
}
function raw(over = {}) {
  const pop = { ref_date: "2026-09", values: REGIONS.map((r) => ({ region_code: r.code, value: POPALL[r.code] })) };
  return {
    population: pop,
    age: ageRows(over.age ?? ageResp(SH)),
    households: codeRows(over.hh ?? codeResp(Object.fromEntries(Object.entries(POPALL).map(([c, v]) => [c, v / 2])), NAMES, "T1", "202609"), "T1"),
    area: areaRows(over.area ?? AREA_RESP),
    oldPop: codeRows(over.oldPop ?? codeResp({ ...OLD, "29": 70, "46": 100, "47": 25, "11": 510, "41": 250, "27": 2, "28": 40 }, { ...NAMES, "29110": "동구", "46110": "목포시", "47720": "군위군", "29": "광주광역시", "46": "전라남도", "47": "경상북도" }, "T20", "202109"), "T20"),
    popCars: codeRows(over.popCars ?? codeResp(POP_AUG, NAMES, "T20", "202608"), "T20"),
    cars: carsRows(over.cars ?? carsResp()),
  };
}
const opt = { minCoverage: 0.8 };

test("면적·연령·자동차 응답 해석", () => {
  const a = ageRows(ageResp(SH));
  assert.equal(a.ref_date, "2026-09");
  const g = a.rows.find((r) => r.kosis_code === "11680");
  assert.equal(g.total, 500); assert.equal(g.child, 100); assert.equal(g.elderly, 150);
  const ar = areaRows(AREA_RESP);
  assert.equal(ar.ref_date, "2025-12-31");
  assert.ok(ar.rows.some((r) => r.sido === "서울특별시" && r.name === "강남구" && r.m2 === 40e6));
  assert.equal(carsRows(carsResp()).ref_date, "2026-08");
});

test("10가지 중 계산 통계 값이 손으로 계산한 값과 같다", () => {
  const { stats } = buildAllStats(REGIONS, raw(), opt);
  const v = (k, c) => stats[k].values.find((x) => x.region_code === c)?.value;
  assert.equal(v("area", "11680"), 40);
  assert.equal(v("density", "11680"), 12.5); // 500 / 40
  assert.equal(v("pop_change_5y", "11680"), 25); // (500-400)/400
  assert.equal(v("elderly_ratio", "11680"), 30);
  assert.equal(v("child_ratio", "11680"), 20);
  assert.equal(v("avg_age", "11680"), 42); // 0.2*5+0.5*40+0.3*70
  assert.equal(v("persons_per_household", "11680"), 2);
  assert.equal(v("cars", "11680"), 400);
  assert.equal(v("cars_per_1000", "11680"), 816.3); // 400 / 490(8월 인구) * 1000
  assert.equal(v("elderly_ratio", "11140"), 50);
  assert.equal(v("avg_age", "11140"), 51.5);
});

test("계산값은 저장된 원자료(from)로 다시 계산해도 같다", () => {
  const { stats } = buildAllStats(REGIONS, raw(), opt);
  const f = {
    density: ([p, a]) => p / a, pop_change_5y: ([n, o]) => ((n - o) / o) * 100, elderly_ratio: ([n, d]) => (n / d) * 100,
    child_ratio: ([n, d]) => (n / d) * 100, avg_age: ([s, d]) => s / d, persons_per_household: ([p, h]) => p / h, cars_per_1000: ([c, p]) => (c / p) * 1000,
  };
  for (const [k, fn] of Object.entries(f)) {
    assert.ok(stats[k].values.length >= 10, k);
    for (const x of stats[k].values) assert.equal(x.value, Math.round(fn(x.from) * 10 ** STAT_DEFS[k].decimals) / 10 ** STAT_DEFS[k].decimals, `${k} ${x.region_code}`);
  }
});

test("기준 시점·단위·출처가 통계마다 기록된다", () => {
  const { stats } = buildAllStats(REGIONS, raw(), opt);
  assert.equal(stats.density.ref_date, "2026-09");
  assert.match(stats.density.source, /인구:.*2026년 9월.*면적:.*2025년 말/);
  assert.equal(stats.area.ref_date, "2025-12-31");
  assert.equal(stats.cars.ref_date, "2026-08");
  assert.equal(stats.cars_per_1000.ref_date, "2026-08");
  assert.match(stats.cars_per_1000.source, /자동차:.*2026년 8월.*인구:.*2026년 8월/);
  assert.match(stats.pop_change_5y.source, /2021년 9월 → 2026년 9월/);
  assert.deepEqual(stats.pop_change_5y.inputs.map((i) => i.ref_date), ["2026-09", "2021-09"]);
  for (const k of Object.keys(stats)) { assert.ok(stats[k].unit); assert.ok(stats[k].source); assert.ok(stats[k].label); }
});

test("개편 처리: 전남광주는 옛 광주+전남을 합치고, 군위군은 경북 옛 값을 쓰며, 인천 신설 구는 비운다", () => {
  const { stats, report } = buildAllStats(REGIONS, raw(), opt);
  const v = (k, c) => stats[k].values.find((x) => x.region_code === c)?.value;
  assert.equal(v("area", "12"), 90); // 광주 50 + 전남 40
  assert.equal(v("area", "12210"), 50); // 광주 동구
  assert.equal(v("area", "12110"), 40); // 전남 목포
  assert.equal(v("pop_change_5y", "12"), 17.65); // 200 vs 70+100=170
  assert.equal(v("pop_change_5y", "12210"), 14.29); // 80 vs 70
  assert.equal(v("pop_change_5y", "27720"), -20); // 20 vs 경북 군위 25
  assert.equal(v("pop_change_5y", "27"), -25.93); // 대구: 옛 2 + 옮겨 온 군위 25 = 27 대비 20
  assert.deepEqual(report.old_pop_sido_adjustments, [{ code: "27", plus: 25, minus: 0 }]); // 경북은 이 가짜 목록에 없음
  assert.equal(v("pop_change_5y", "28"), 25); // 인천 시·도는 경계가 그대로라 옛 값 그대로(50 vs 40)
  assert.equal(v("area", "28125"), undefined);
  assert.equal(v("density", "28125"), undefined);
  assert.equal(v("pop_change_5y", "28125"), undefined);
  assert.deepEqual(stats.pop_change_5y.blank_regions, ["28125"]);
  assert.deepEqual(report.old_pop_blanks.map((b) => b.code), ["28125"]);
  assert.equal(v("cars_per_1000", "28125"), 2000); // 자동차는 현재 구성 그대로
});

test("자동차: 일반 시는 시 줄 + 구 줄을 합치고, 쓰이지 않은 줄은 기록한다", () => {
  const { stats, report } = buildAllStats(REGIONS, raw({ cars: carsResp("202608", [["서울", "옛구", 5]]) }), opt);
  assert.equal(stats.cars.values.find((x) => x.region_code === "41110").value, 400);
  assert.deepEqual(report.cars_leftover, [{ sido: "서울", name: "옛구", value: 5 }]);
});

test("이상 감지: 값을 찾은 지역이 너무 적으면 멈춘다(기본 95%)", () => {
  assert.throws(() => buildAllStats(REGIONS, raw()), (e) => e instanceof KosisError && /너무 적어요/.test(e.message));
});

test("이상 감지: 비율이 정상 범위를 벗어나면 멈춘다", () => {
  const bad = ageResp([[90, 1]]); // 모두 90세
  assert.throws(() => buildAllStats(REGIONS, raw({ age: bad }), opt), (e) => /정상 범위/.test(e.message));
});

test("이상 감지: 합계가 전국과 다르거나 기준월이 어긋나면 멈춘다", () => {
  const hh = codeResp(Object.fromEntries(Object.entries(POPALL).map(([c, v]) => [c, v / 2])), NAMES, "T1", "202609");
  hh.find((r) => r.C1 === "00").DT = "99999";
  assert.throws(() => buildAllStats(REGIONS, raw({ hh }), opt), /전국 값과 크게 달라요/);
  const hh2 = codeResp(Object.fromEntries(Object.entries(POPALL).map(([c, v]) => [c, v / 2])), NAMES, "T1", "202608");
  assert.throws(() => buildAllStats(REGIONS, raw({ hh: hh2 }), opt), /기준월이 서로 달라요/);
  const cars = carsResp().map((r) => (r.C2_NM === "계" && r.C1_NM === "서울" ? { ...r, DT: "9000" } : r));
  assert.throws(() => buildAllStats(REGIONS, raw({ cars }), opt), /크게 달라요/);
});

test("이상 감지: 연령 표가 인구와 어긋나거나 나이 칸이 모자라면 멈춘다", () => {
  const a = ageResp(SH).filter((r) => !(r.C1 === "11680" && r.C2_NM === "50세"));
  assert.throws(() => ageRows(a), /연령별 자료가 이상해요/);
  const b = ageResp(SH).map((r) => (r.C1 === "11680" && r.C2_NM === "계" ? { ...r, DT: "501" } : r));
  assert.throws(() => ageRows(b), /연령별 자료가 이상해요/);
});

test("5년 전 인구: 이름이 겹치면 멈추고 못 찾으면 비운다", () => {
  const old = codeRows(codeResp({ "41110": 250, "41111": 100, "41": 250 }, { "41110": "수원시", "41111": "수원시", "41": "경기도" }, "T20", "202109"), "T20");
  assert.throws(() => matchOldPopulation([R("41", "경기도", "sido", null, "경기"), R("41999", "수원시", "sigungu", "41", "경기")], { rows: [...old.rows, { kosis_code: "41115", kosis_name: "수원시", value: 1 }] }), /겹쳐요/);
  const m = matchOldPopulation([R("11680", "강남구", "sigungu", "11", "서울")], old);
  assert.equal(m.values.length, 0);
  assert.equal(m.blanks.length, 1);
});

test("시·도 보정: 옮겨 온 군위군을 옛 경북에서 빼고 새 대구에 더한다(경북이 목록에 있을 때)", () => {
  const regs = [R("27", "대구광역시", "sido", null, "대구"), R("27720", "군위군", "sigungu", "27", "대구"), R("47", "경상북도", "sido", null, "경북"), R("47730", "의성군", "sigungu", "47", "경북")];
  const old = codeRows(codeResp({ "27": 1000, "47": 500, "47720": 40, "47730": 60 }, { "27": "대구광역시", "47": "경상북도", "47720": "군위군", "47730": "의성군" }, "T20", "202109"), "T20");
  // 위 가짜 표는 시·도 합 계산용이 아니므로 시·도 줄만 따로 확인
  const m = matchOldPopulation(regs, old);
  const val = (c) => m.values.find((x) => x.region_code === c).value;
  assert.equal(val("27"), 1040); // 옛 대구 1000 + 군위 40
  assert.equal(val("47"), 460); // 옛 경북 500 - 군위 40
  assert.equal(val("27720"), 40);
  assert.deepEqual(m.adjustments, [{ code: "27", plus: 40, minus: 0 }, { code: "47", plus: 0, minus: 40 }]);
  // 보정해도 시·도 합계(1000+500)는 그대로
  assert.equal(val("27") + val("47"), 1500);
});

test("1,000명당 자동차 1,000대 초과 지역은 값은 두고 문제 제외 표시만 붙는다", () => {
  const { stats, report } = buildAllStats(REGIONS, raw(), opt);
  const ex = (k, c) => stats[k].values.find((x) => x.region_code === c).quiz_exclude;
  assert.equal(ex("cars_per_1000", "27720"), true);
  assert.equal(ex("cars", "27720"), true);
  assert.equal(stats.cars_per_1000.values.find((x) => x.region_code === "27720").value, 5000); // 값은 그대로
  assert.equal(ex("cars_per_1000", "11680"), undefined);
  assert.ok(report.quiz_excluded.some((q) => q.region_code === "28125" && q.cars_per_1000 === 2000 && /1,000명당 1000대 초과/.test(q.reason)));
  assert.equal(CARS_QUIZ_MAX_PER_1000, 1000);
});

test("저장된 SQL에는 문제 제외 지역의 자동차 행이 없고 나머지는 모두 있다", () => {
  for (const k of ["cars", "cars_per_1000"]) {
    const j = JSON.parse(readFileSync(new URL(`../../data/stats/${k}.json`, import.meta.url), "utf-8"));
    const sql = readFileSync(new URL(`../../data/stats/${k}.sql`, import.meta.url), "utf-8");
    const has = (c) => sql.includes(`VALUES ('${c}', '${k}',`);
    assert.ok(j.values.some((v) => v.quiz_exclude));
    for (const v of j.values) assert.equal(has(v.region_code), !v.quiz_exclude, `${k} ${v.region_code}`);
  }
});
