// KOSIS에서 최신 월 인구를 받아 data/stats/population.json, data/kosis-region-map.json, data/stats/population.sql 을 만든다.
// 사용법: node src/fetch-population.mjs            (KOSIS 1회 호출)
//        node src/fetch-population.mjs --from 응답파일.json   (호출 없이 저장해 둔 응답으로)
// 이상하면 아무것도 저장하지 않고 한국어로 안내한다. 열쇠 값은 출력하지 않는다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { kosisGet, KosisError, checkResponse } from "./kosis.mjs";
import { POPULATION, pickRows, matchRegions, validate, buildPopulationFile, toStatSql } from "./population.mjs";

const root = (p) => new URL("../../" + p, import.meta.url);

export async function run({ from = null, fetchFn } = {}) {
  const regionsFile = JSON.parse(readFileSync(root("data/regions.json"), "utf-8"));
  const resp = from
    ? checkResponse(JSON.parse(readFileSync(from, "utf-8")))
    : await kosisGet("Param/statisticsParameterData.do", {
        orgId: POPULATION.orgId, tblId: POPULATION.tblId, itmId: "ALL", objL1: "ALL", prdSe: "M", newEstPrdCnt: "1",
      }, fetchFn ? { fetchFn } : {});
  const picked = pickRows(resp);
  const matched = matchRegions(regionsFile.regions, picked.rows);
  const summary = validate(regionsFile.regions, picked, matched);
  const pop = buildPopulationFile({ regionsFile, picked, matched, summary, fetchedAt: new Date().toISOString() });
  mkdirSync(root("data/stats"), { recursive: true });
  writeFileSync(root("data/stats/population.json"), JSON.stringify(pop, null, 1) + "\n");
  writeFileSync(root("data/stats/population.sql"), toStatSql(pop));
  writeFileSync(root("data/kosis-region-map.json"), JSON.stringify({
    note: "KOSIS 지역 코드 ↔ 우리 지역 코드. 통계표마다 코드 체계가 다를 수 있어 표별로 보관한다.",
    tables: { [`${POPULATION.orgId}/${POPULATION.tblId}`]: { built_for_ref_date: pop.ref_date, regions_as_of: regionsFile.as_of, map: matched.map } },
  }, null, 1) + "\n");
  return { pop, matched, picked };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const i = process.argv.indexOf("--from");
    const { pop } = await run({ from: i > 0 ? process.argv[i + 1] : null });
    console.log(`인구 ${pop.ref_date} 기준, ${pop.matched_count}곳 저장 (지역 목록 기준일 ${pop.regions_as_of}, 전국 ${pop.national_total?.toLocaleString("ko-KR")}명)`);
  } catch (e) {
    console.error(e instanceof KosisError ? e.message : "예상하지 못한 문제가 생겼어요. 저장하지 않았어요.");
    process.exitCode = 1;
  }
}
