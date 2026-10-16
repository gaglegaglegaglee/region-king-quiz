import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRegions, parseTsv, buildFile, DEFAULT_AS_OF } from "../src/build-regions.mjs";
import { toSql } from "../src/to-sql.mjs";

const raw = parseTsv(readFileSync(new URL("../../data/raw/legal-dong-sigungu.tsv", import.meta.url), "utf-8"));
const list = buildRegions(raw); // 기본 기준일 2026-06-30
const by = (code) => list.find((r) => r.code === code);
const byName = (n) => list.filter((r) => r.name === n);

test("개수: 시·도 17, 시·군·구 229 (시 78·군 82·구 69, 세종시 포함)", () => {
  assert.equal(list.filter((r) => r.level === "sido").length, 17);
  const sg = list.filter((r) => r.level === "sigungu");
  assert.equal(sg.length, 229);
  assert.equal(list.length, 246);
  assert.equal(sg.filter((r) => r.name.endsWith("시")).length, 78);
  assert.equal(sg.filter((r) => r.name.endsWith("군")).length, 82);
  assert.equal(sg.filter((r) => r.name.endsWith("구")).length, 69);
});

test("기초자치단체 계산: 226 + 세종 1 + 제주 행정시 2 = 229", () => {
  const official = 75 + 82 + 69; // 시 75(세종·제주 행정시 제외) + 군 82 + 자치구 69 = 226
  assert.equal(official, 226);
  assert.equal(list.filter((r) => r.level === "sigungu").length, official + 1 + 2);
});

test("시·도별 시·군·구 개수", () => {
  const exp = { 11: 25, 26: 16, 27: 9, 28: 10, 29: 5, 30: 5, 31: 5, 36: 1, 41: 31, 43: 11, 44: 15, 46: 22, 47: 22, 48: 18, 50: 2, 51: 18, 52: 14 };
  for (const [s, n] of Object.entries(exp)) assert.equal(list.filter((r) => r.parent_code === s).length, n, s);
});

test("시·도별 군 목록 (경기 군은 가평·양평·연천 3곳, 여주군은 없다)", () => {
  const guns = (s) => list.filter((r) => r.parent_code === s && r.name.endsWith("군")).map((r) => r.name).sort();
  assert.deepEqual(guns("41"), ["가평군", "양평군", "연천군"]);
  assert.equal(guns("43").length, 8); assert.equal(guns("44").length, 7); assert.equal(guns("52").length, 8);
  assert.equal(guns("46").length, 17); assert.equal(guns("47").length, 12); assert.equal(guns("48").length, 10);
  assert.equal(guns("51").length, 11); assert.equal(guns("28").length, 2); assert.equal(guns("27").length, 2);
  assert.equal(byName("여주군").length, 0); assert.equal(byName("여주시").length, 1);
  assert.equal(by("41730"), undefined); assert.equal(by("41670").name, "여주시");
});

test("같은 시·도에 ○○시와 ○○군이 함께 남지 않는다 (승격된 옛 군 제외)", () => {
  for (const asOf of ["2026-06-30", "2026-07-01", "2026-10-16"]) {
    const l = buildRegions(raw, asOf).filter((r) => r.level === "sigungu");
    const stems = new Set(l.filter((r) => r.name.endsWith("시")).map((r) => r.parent_code + r.name.slice(0, -1)));
    for (const g of l.filter((r) => r.name.endsWith("군"))) assert.ok(!stems.has(g.parent_code + g.name.slice(0, -1)), g.name);
  }
});

test("코드가 겹치지 않고, 모든 시·군·구의 소속 시·도가 있다", () => {
  assert.equal(new Set(list.map((r) => r.code)).size, list.length);
  const sido = new Set(list.filter((r) => r.level === "sido").map((r) => r.code));
  for (const r of list.filter((x) => x.level === "sigungu")) assert.ok(sido.has(r.parent_code), r.code);
  for (const r of list.filter((x) => x.level === "sido")) assert.equal(r.parent_code, null);
});

test("대표 지역과 소속", () => {
  assert.equal(by("11680").name, "강남구"); assert.equal(by("11680").parent_code, "11");
  assert.equal(by("26350").name, "해운대구"); assert.equal(by("26350").parent_code, "26");
  assert.equal(by("41110").name, "수원시"); assert.equal(by("41110").parent_code, "41");
  assert.equal(by("48120").name, "창원시"); assert.equal(by("48120").parent_code, "48");
  assert.equal(by("50110").name, "제주시"); assert.equal(by("50130").name, "서귀포시");
  assert.equal(by("50110").parent_code, "50");
});

test("세종: 시·도 1곳 + 시·군·구 세종시 1곳(소속 도 문제 제외 표시)", () => {
  assert.equal(by("36").name, "세종특별자치시");
  assert.equal(by("36110").name, "세종시");
  assert.equal(by("36110").parent_code, "36");
  assert.equal(by("36110").exclude_from_sub_sido_quiz, true);
  assert.equal(list.filter((r) => r.exclude_from_sub_sido_quiz).length, 1);
});

test("일반 시 안의 구는 시 하나로 합친다", () => {
  assert.equal(byName("수원시").length, 1);
  assert.equal(byName("장안구").length, 0);
  assert.equal(by("41110").merged_gu_legal_codes.length, 4);
  for (const g of ["성남시", "안양시", "부천시", "고양시", "용인시", "청주시", "천안시", "포항시", "전주시", "창원시", "화성시"]) assert.equal(byName(g).length, 1, g);
  for (const gu of ["분당구", "덕양구", "의창구", "상당구", "동탄구", "덕진구"]) assert.equal(byName(gu).length, 0, gu);
  assert.equal(by("41590").merged_gu_legal_codes.length, 4); // 화성시 새 구 4곳(2026-02 신설)
});

test("특별시·광역시 자치구는 그대로 (광주 남구 29155 포함)", () => {
  assert.equal(list.filter((r) => r.parent_code === "11").length, 25);
  assert.equal(by("29155").name, "남구");
  assert.equal(by("29155").parent_code, "29");
});

test("같은 이름 구는 표시 이름으로 구분", () => {
  assert.equal(by("11140").display_name, "서울 중구");
  assert.equal(by("26110").display_name, "부산 중구");
  assert.equal(by("11140").name, "중구");
  assert.equal(by("11680").display_name, "강남구");
  assert.equal(new Set(list.map((r) => r.display_name)).size, list.length);
  assert.ok(byName("고성군").length === 2 && byName("고성군").every((r) => r.display_name.includes(" ")));
});

test("폐지·개편 반영 (기준일 2026-06-30)", () => {
  const names = list.map((r) => r.name);
  assert.ok(!names.includes("강원도") && names.includes("강원특별자치도"));
  assert.ok(!names.includes("전라북도") && names.includes("전북특별자치도"));
  assert.ok(!names.includes("부산직할시") && !names.includes("제주도"));
  assert.ok(!names.includes("여천시") && !names.includes("금성시"));
  assert.equal(by("27720").name, "군위군"); assert.equal(by("27720").parent_code, "27"); // 대구 편입
  assert.equal(by("47720"), undefined);
  assert.equal(by("12"), undefined); // 2026-07-01 통합시는 기준일 이후
  assert.equal(by("28125"), undefined);
});

test("기준일을 바꾸면 2026-07-01 개편(전남광주통합특별시, 인천 구 개편)이 반영된다", () => {
  const after = buildRegions(raw, "2026-10-16");
  assert.equal(after.filter((r) => r.level === "sido").length, 16);
  assert.equal(after.filter((r) => r.level === "sigungu").length, 230);
  const jul = buildRegions(raw, "2026-07-01"); // 개편 첫날 구성(시·도 16, 시·군·구 230)
  assert.equal(jul.filter((r) => r.level === "sido").length, 16);
  assert.equal(jul.filter((r) => r.level === "sigungu").length, 230);
  assert.equal(after.find((r) => r.code === "12").name, "전남광주통합특별시");
  assert.equal(after.find((r) => r.code === "29"), undefined);
  assert.equal(after.find((r) => r.code === "28125").name, "제물포구");
});

test("regions.json이 최신 원본과 일치하고 출처·기준일을 갖는다", () => {
  const saved = JSON.parse(readFileSync(new URL("../../data/regions.json", import.meta.url), "utf-8"));
  assert.deepEqual(saved, buildFile(DEFAULT_AS_OF));
  assert.match(saved.source, /행정표준코드/); assert.equal(saved.as_of, DEFAULT_AS_OF);
  assert.ok(saved.raw_downloaded_at);
});

test("이상한 입력은 멈춘다", () => {
  assert.throws(() => buildRegions(raw, "2026-02-30"));
  assert.throws(() => buildRegions([...raw, raw[0]]), /중복/);
});

test("SQL: 따옴표 처리와 목록 밖 지역 비활성화", () => {
  const sql = toSql({ source: "s", as_of: "x", raw_downloaded_at: "y", regions: [{ code: "11", name: "a'b", display_name: "a'b", level: "sido", parent_code: null }] });
  assert.match(sql, /'a''b'/);
  assert.match(sql, /UPDATE regions SET active = 0 WHERE code NOT IN \('11'\)/);
});
