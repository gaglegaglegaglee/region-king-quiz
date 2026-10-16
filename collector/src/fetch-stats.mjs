// 나머지 통계 9가지를 KOSIS에서 받아 data/stats/<통계키>.json(+.sql), data/stats/all.sql, data/stats/report.json 을 만든다.
// 사용법: node src/fetch-stats.mjs                 (KOSIS 6회 호출)
//        node src/fetch-stats.mjs --from-dir 폴더   (저장해 둔 응답으로, 호출 없음)
// 이상하면 아무것도 저장하지 않고 한국어로 안내한다. 열쇠 값은 출력하지 않는다.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { kosisGet, KosisError, checkResponse } from "./kosis.mjs";
import { TABLES, ageRows, areaRows, carsRows, codeRows, buildAllStats, STAT_DEFS } from "./stats.mjs";
import { toStatSql } from "./population.mjs";

const root = (p) => new URL("../../" + p, import.meta.url);
const MAX_CALLS = Number(process.env.KOSIS_MAX_CALLS ?? 120);

function usedCalls() {
  const f = process.env.KOSIS_CALL_LOG;
  return f && existsSync(f) ? readFileSync(f, "utf-8").split("\n").filter(Boolean).length : 0;
}
const P = "Param/statisticsParameterData.do";
const monthsAgo = (ym, n) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) - n; return `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, "0")}`; };

export async function run({ fromDir = null } = {}) {
  const regionsFile = JSON.parse(readFileSync(root("data/regions.json"), "utf-8"));
  const popFile = JSON.parse(readFileSync(root("data/stats/population.json"), "utf-8"));
  const read = (n) => checkResponse(JSON.parse(readFileSync(`${fromDir}/${n}`, "utf-8")));
  let resp;
  if (fromDir) {
    resp = { age: read("age.json"), area: read("area.json"), hh: read("hh.json"), oldPop: read("pop-old.json"), popCars: read("pop-cars.json"), cars: read("cars.json") };
  } else {
    if (usedCalls() + 6 > MAX_CALLS) throw new KosisError(`통계청 호출 한도(${MAX_CALLS}회)에 가까워서 멈췄어요.`);
    const t = TABLES;
    const get = (tb, extra) => kosisGet(P, { orgId: tb.orgId, tblId: tb.tblId, itmId: tb.itmId, ...extra });
    resp = {};
    resp.age = await get(t.age, { objL1: "ALL", objL2: "ALL", prdSe: "M", newEstPrdCnt: "1" });
    resp.hh = await get(t.households, { objL1: "ALL", prdSe: "M", newEstPrdCnt: "1" });
    resp.area = await get(t.area, { objL1: "ALL", objL2: "ALL", prdSe: "Y", newEstPrdCnt: "1" });
    resp.cars = await get(t.cars, { objL1: "ALL", objL2: "ALL", objL3: "ALL", prdSe: "M", newEstPrdCnt: "1" });
    const carsMonth = carsRows(resp.cars).ref_date;
    resp.popCars = await get(t.population, { objL1: "ALL", prdSe: "M", startPrdDe: carsMonth.replace("-", ""), endPrdDe: carsMonth.replace("-", "") });
    resp.oldPop = await get(t.population, { objL1: "ALL", prdSe: "M", startPrdDe: monthsAgo(popFile.ref_date, 60), endPrdDe: monthsAgo(popFile.ref_date, 60) });
  }
  const raw = {
    population: { ref_date: popFile.ref_date, values: popFile.values },
    age: ageRows(resp.age), households: codeRows(resp.hh, TABLES.households.itmId), area: areaRows(resp.area),
    oldPop: codeRows(resp.oldPop, TABLES.population.itmId), popCars: codeRows(resp.popCars, TABLES.population.itmId), cars: carsRows(resp.cars),
  };
  if (raw.oldPop.ref_date !== `${Number(popFile.ref_date.slice(0, 4)) - 5}${popFile.ref_date.slice(4)}`) throw new KosisError("5년 전 같은 달 인구 자료의 기준월이 맞지 않아요. 저장하지 않았어요.");
  const { stats, report } = buildAllStats(regionsFile.regions, raw);
  const fetchedAt = new Date().toISOString();
  const keys = Object.keys(STAT_DEFS).filter((k) => k !== "population");
  let all = readFileSync(root("data/stats/population.sql"), "utf-8");
  for (const k of keys) {
    const s = { ...stats[k], fetched_at: fetchedAt, regions_as_of: regionsFile.as_of };
    writeFileSync(root(`data/stats/${k}.json`), JSON.stringify(s, null, 1) + "\n");
    // 문제에서 뺄 지역(quiz_exclude)의 행은 SQL에 넣지 않는다(서버 수정 없이 문제에서 빠짐). 값은 json에 남는다.
    const sql = toStatSql({ ...s, values: s.values.filter((v) => !v.quiz_exclude) });
    writeFileSync(root(`data/stats/${k}.sql`), sql);
    all += sql;
  }
  writeFileSync(root("data/stats/all.sql"), all);
  writeFileSync(root("data/stats/report.json"), JSON.stringify({ fetched_at: fetchedAt, ...report }, null, 1) + "\n");
  return { stats, report, keys };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const i = process.argv.indexOf("--from-dir");
    const { stats, report, keys } = await run({ fromDir: i > 0 ? process.argv[i + 1] : null });
    for (const k of keys) console.log(`${STAT_DEFS[k].label}: ${stats[k].values.length}곳 (기준 ${stats[k].ref_date}), 비운 지역 ${stats[k].blank_regions.length}곳`);
    console.log(`자동차 자료 중 어느 지역에도 안 쓴 줄 ${report.cars_leftover.length}개`);
  } catch (e) {
    console.error(e instanceof KosisError ? e.message : "예상하지 못한 문제가 생겼어요. 저장하지 않았어요.");
    process.exitCode = 1;
  }
}
