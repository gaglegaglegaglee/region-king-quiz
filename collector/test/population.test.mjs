import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kosisGet, checkResponse, loadKey, KosisError } from "../src/kosis.mjs";
import { pickRows, matchRegions, validate, toStatSql } from "../src/population.mjs";

const sample = JSON.parse(readFileSync(new URL("./fixtures/kosis-population-sample.json", import.meta.url), "utf-8"));
const R = (code, name, level, parent, extra = {}) => ({ code, name, display_name: name, level, parent_code: parent, ...extra });
const regions = [
  R("11", "서울특별시", "sido", null), R("11680", "강남구", "sigungu", "11"), R("11140", "중구", "sigungu", "11"),
  R("41", "경기도", "sido", null), R("41110", "수원시", "sigungu", "41", { merged_gu_legal_codes: ["4111100000", "4111300000"] }),
  R("41220", "평택시", "sigungu", "41"),
];

test("응답에서 총인구수·기준월·전국 값을 뽑는다", () => {
  const p = pickRows(sample);
  assert.equal(p.ref_date, "2026-09");
  assert.equal(p.national_total, 1000);
  assert.equal(p.rows.length, 9); // 남자 줄·전국 줄 제외
});

test("코드와 이름이 같으면 맞춘다, 출장소(0)는 무시, 일반 구는 쓰이지 않아도 정상", () => {
  const m = matchRegions(regions, pickRows(sample).rows);
  assert.equal(m.values.length, 6);
  assert.equal(m.values.find((v) => v.region_code === "41110").value, 300); // 시 합계 줄 사용
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.unmatched, []);
  assert.ok(Object.values(m.map).every((x) => x.method === "code+name"));
});

test("KOSIS에 시 합계가 없으면 구의 합을 쓴다", () => {
  const rows = pickRows(sample).rows.filter((r) => r.kosis_code !== "41110");
  const m = matchRegions(regions, rows);
  assert.equal(m.values.find((v) => v.region_code === "41110").value, 300);
  assert.equal(m.map["41110"].method, "sum-of-gu");
});

test("코드가 달라도 같은 시·도 안에서 이름이 하나뿐이면 이름으로 맞춘다(기록 남김)", () => {
  const rows = pickRows(sample).rows.map((r) => (r.kosis_code === "11680" ? { ...r, kosis_code: "11999" } : r));
  const m = matchRegions(regions, rows);
  assert.equal(m.map["11999"].method, "name-in-sido");
  assert.equal(m.map["11999"].code, "11680");
});

test("코드는 같은데 이름이 다르면 믿지 않고 멈출 거리로 남긴다", () => {
  const rows = pickRows(sample).rows.map((r) => (r.kosis_code === "11680" ? { ...r, kosis_name: "다른구" } : r));
  const m = matchRegions(regions, rows);
  assert.deepEqual(m.missing.map((x) => x.code), ["11680"]);
  assert.deepEqual(m.unmatched.map((x) => x.kosis_code), ["11680"]);
});

test("이상 감지: 지역이 모자라면 저장하지 않는다", () => {
  const p = pickRows(sample);
  const rows = p.rows.filter((r) => !["11680", "11140", "41220"].includes(r.kosis_code));
  const m = matchRegions(regions, rows);
  assert.throws(() => validate(regions, { ...p, rows }, m), (e) => e instanceof KosisError && /너무 적어요/.test(e.message));
});

test("이상 감지: 우리 목록에 없는 KOSIS 지역이 있으면 멈춘다(개편 기준일 불일치)", () => {
  const p = pickRows(sample);
  const rows = [...p.rows, { kosis_code: "12", kosis_name: "전남광주통합특별시", value: 5 }];
  assert.throws(() => validate(regions, p, matchRegions(regions, rows)), /목록에 없는 지역/);
});

test("이상 감지: 합계가 전국과 크게 다르면 멈춘다", () => {
  const p = pickRows(sample); // 시·도 합 = 400+600 = 1000 = 전국, 시·군·구 합 = 150+250+300+300 = 1000
  const ok = validate(regions, p, matchRegions(regions, p.rows));
  assert.equal(ok.sido_sum, 1000);
  assert.equal(ok.sigungu_sum, 1000);
  const bad = { ...p, national_total: 2000 };
  assert.throws(() => validate(regions, bad, matchRegions(regions, p.rows)), /전국 인구와 크게 달라요/);
});

test("KOSIS 오류 번호는 한국어로", () => {
  for (const [err, re] of [["10", /열쇠/], ["11", /올바르지 않아요/], ["40", /한도/], ["99", /번호 99/]]) {
    assert.throws(() => checkResponse({ err, errMsg: "Invalid key" }), (e) => e instanceof KosisError && re.test(e.message) && !/Invalid/.test(e.message));
  }
  assert.throws(() => checkResponse({ foo: 1 }), /예상과 달라요/);
});

test("열쇠 없음 / 연결 실패 / 잘못된 열쇠 안내, 열쇠·주소가 메시지에 섞이지 않는다", async () => {
  assert.throws(() => loadKey({}, new URL("file:///nonexistent/.env")), /열쇠\(KOSIS_API_KEY\)가 없어요/);
  const SECRET = "FAKEKEY123=";
  const opts = (fetchFn) => ({ key: SECRET, fetchFn, callLog: null });
  await assert.rejects(kosisGet("x.do", {}, opts(async () => { throw new Error(`boom https://kosis.kr?apiKey=${SECRET}`); })),
    (e) => /연결하지 못했어요/.test(e.message) && !e.message.includes(SECRET) && !e.message.includes("http"));
  await assert.rejects(kosisGet("x.do", {}, opts(async () => new Response(JSON.stringify({ err: "11", errMsg: "x" })))),
    (e) => /올바르지 않아요/.test(e.message) && !e.message.includes(SECRET));
  await assert.rejects(kosisGet("x.do", {}, opts(async () => new Response("<html>", { status: 502 }))), /상태 502/);
  await assert.rejects(kosisGet("x.do", {}, opts(async () => new Response("not json"))), /읽을 수 없어요/);
});

test(".env 파일에서 열쇠를 읽는다(값 끝 = 포함)", () => {
  const d = mkdtempSync(join(tmpdir(), "rk-"));
  writeFileSync(join(d, ".env"), "OTHER=1\nKOSIS_API_KEY=abc123==\n");
  const env = {};
  assert.equal(loadKey(env, new URL("file://" + join(d, ".env"))), "abc123==");
});

test("SQL: 값·기준월·출처 포함, 메타 갱신", () => {
  const sql = toStatSql({ stat_key: "population", label: "인구", unit: "명", source: "s", ref_date: "2026-09", fetched_at: "t", values: [{ region_code: "11", value: 5 }] });
  assert.match(sql, /INSERT OR REPLACE INTO stat_values .*'11', 'population', 5, '명', '2026-09', 's', 't'/);
  assert.match(sql, /latest_ref_date=excluded\.latest_ref_date/);
});

test("전국 줄이 없으면 저장하지 않고 한국어로 안내", () => {
  const noNat = sample.filter((r) => r.C1 !== "00");
  assert.throws(() => pickRows(noNat), (e) => e instanceof KosisError && /전국 인구 값이 없어서/.test(e.message));
  const badNat = sample.map((r) => (r.C1 === "00" ? { ...r, DT: "-" } : r));
  assert.throws(() => pickRows(badNat), /전국 인구 값이 없어서/);
});

test("값이 비어 있는('-') 지역은 정확한 안내로 멈춘다", () => {
  const p = pickRows(sample.map((r) => (r.C1 === "11680" ? { ...r, DT: "-" } : r)));
  const m = matchRegions(regions, p.rows);
  assert.deepEqual(m.empty.map((x) => x.kosis_code), ["11680"]);
  assert.deepEqual(m.unmatched, []);
  assert.throws(() => validate(regions, p, m), (e) => /값이 비어 있는 지역이 1곳/.test(e.message) && !/목록에 없는/.test(e.message));
});
