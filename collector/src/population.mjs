// KOSIS 주민등록인구현황(행정구역(시군구)별 성별 인구수) 응답 → 우리 지역 코드에 맞춘 인구 값.
import { KosisError } from "./kosis.mjs";

export const POPULATION = {
  stat_key: "population",
  label: "인구",
  unit: "명",
  source: "행정안전부 주민등록인구현황(KOSIS)",
  orgId: "101",
  tblId: "DT_1B040A3",
  itmId: "T20", // 총인구수
  tableName: "행정구역(시군구)별 성별 인구수",
};

const MIN_MATCH_RATIO = 0.95; // 활성 지역 중 값을 얻은 비율 하한
const MAX_TOTAL_GAP = 0.01; // 합계가 전국 값과 다를 수 있는 한계(1%)

// 응답에서 총인구수(T20) 줄만 골라 기준월·전국 값을 뽑는다.
export function pickRows(resp) {
  const rows = resp.filter((r) => r.ITM_ID === POPULATION.itmId);
  if (rows.length === 0) throw new KosisError("통계청 응답에 총인구수 자료가 없어요.");
  const months = new Set(rows.map((r) => r.PRD_DE));
  if (months.size !== 1) throw new KosisError("통계청 응답에 기준월이 여러 개 섞여 있어요. 최신 한 달만 받아야 해요.");
  const month = [...months][0];
  if (!/^\d{6}$/.test(month)) throw new KosisError("통계청 응답의 기준월 모양이 이상해요.");
  const national = rows.find((r) => r.C1 === "00");
  const nat = national ? Number(national.DT) : NaN;
  if (!Number.isFinite(nat) || nat <= 0) throw new KosisError("통계청 응답에 전국 인구 값이 없어서 합계를 검증할 수 없어요. 저장하지 않았어요.");
  return {
    ref_date: `${month.slice(0, 4)}-${month.slice(4)}`,
    national_total: Number.isFinite(nat) ? nat : null,
    rows: rows.filter((r) => r.C1 !== "00").map((r) => ({ kosis_code: r.C1, kosis_name: r.C1_NM, value: Number(r.DT), raw: r.DT })),
  };
}

// KOSIS 지역 ↔ 우리 지역. 1순위: 코드가 같고 이름도 같음. 2순위: 같은 시·도 안에서 이름이 하나만 일치.
// 일반 시 합계 줄이 없으면 합쳐진 구 줄을 더한다.
export function matchRegions(regions, rows) {
  const byKosis = new Map(rows.map((r) => [r.kosis_code, r]));
  const used = new Set();
  const values = [];
  const map = {};
  const missing = [];
  const valid = (r) => r && Number.isFinite(r.value) && r.value > 0;

  for (const reg of regions) {
    let hit = byKosis.get(reg.code);
    let method = "code+name";
    if (hit && hit.kosis_name !== reg.name) hit = undefined; // 코드는 같은데 이름이 다르면 믿지 않는다
    if (!hit) {
      const sidoCode = reg.level === "sido" ? null : reg.parent_code;
      const cands = rows.filter((r) => r.kosis_name === reg.name && !used.has(r.kosis_code) &&
        (reg.level === "sido" ? r.kosis_code.length === 2 : r.kosis_code.length === 5 && r.kosis_code.startsWith(sidoCode)));
      if (cands.length === 1) { hit = cands[0]; method = "name-in-sido"; }
    }
    if (hit && valid(hit)) {
      used.add(hit.kosis_code);
      map[hit.kosis_code] = { code: reg.code, kosis_name: hit.kosis_name, name: reg.name, method };
      values.push({ region_code: reg.code, value: hit.value });
      continue;
    }
    // 시 합계가 없으면 구의 합
    const gus = (reg.merged_gu_legal_codes ?? []).map((c) => byKosis.get(c.slice(0, 5)));
    if (gus.length && gus.every(valid)) {
      gus.forEach((g) => used.add(g.kosis_code));
      map[reg.code] = { code: reg.code, kosis_name: reg.name, name: reg.name, method: "sum-of-gu" };
      values.push({ region_code: reg.code, value: gus.reduce((s, g) => s + g.value, 0) });
      continue;
    }
    missing.push({ code: reg.code, name: reg.display_name });
  }
  // 일반 시 안의 구(합쳐진 구)는 쓰이지 않아도 정상. 출장소·값 0도 정상.
  const mergedGu = new Set(regions.flatMap((r) => (r.merged_gu_legal_codes ?? []).map((c) => c.slice(0, 5))));
  const isOffice = (r) => /출장소$/.test(r.kosis_name);
  const empty = rows.filter((r) => !used.has(r.kosis_code) && !mergedGu.has(r.kosis_code) && !isOffice(r) && !Number.isFinite(r.value))
    .map((r) => ({ kosis_code: r.kosis_code, kosis_name: r.kosis_name }));
  const unmatched = rows
    .filter((r) => !used.has(r.kosis_code) && !mergedGu.has(r.kosis_code) && !(r.value === 0 && isOffice(r)) && Number.isFinite(r.value))
    .map((r) => ({ kosis_code: r.kosis_code, kosis_name: r.kosis_name, value: r.value }));
  return { values, map, missing, unmatched, empty };
}

// 이상하면 한국어 오류로 멈춘다. 통과하면 요약을 돌려준다.
export function validate(regions, picked, matched) {
  const active = regions.length;
  if (matched.empty?.length > 0)
    throw new KosisError(`값이 비어 있는 지역이 ${matched.empty.length}곳 있어요(예: ${matched.empty.slice(0, 3).map((u) => u.kosis_name).join(", ")}). 이상한 자료라서 저장하지 않았어요.`);
  const ratio = matched.values.length / active;
  if (ratio < MIN_MATCH_RATIO)
    throw new KosisError(`값을 찾은 지역이 너무 적어요(${matched.values.length}/${active}곳). 이상한 자료라서 저장하지 않았어요.`);
  if (matched.unmatched.length > 0)
    throw new KosisError(`통계청에는 있는데 우리 지역 목록에 없는 지역이 ${matched.unmatched.length}곳 있어요(예: ${matched.unmatched.slice(0, 3).map((u) => u.kosis_name).join(", ")}). 지역 목록 기준일이 자료와 맞는지 확인해 주세요. 저장하지 않았어요.`);
  const sum = (lvl) => matched.values.filter((v) => regions.find((r) => r.code === v.region_code).level === lvl).reduce((s, v) => s + v.value, 0);
  const sido = sum("sido"), sigungu = sum("sigungu");
  if (picked.national_total) {
    for (const [label, s] of [["시·도", sido], ["시·군·구", sigungu]]) {
      if (Math.abs(s - picked.national_total) / picked.national_total > MAX_TOTAL_GAP)
        throw new KosisError(`${label} 인구를 모두 더한 값이 전국 인구와 크게 달라요. 이상한 자료라서 저장하지 않았어요.`);
    }
  }
  return { matched_count: matched.values.length, active_regions: active, sido_sum: sido, sigungu_sum: sigungu };
}

export function buildPopulationFile({ regionsFile, picked, matched, summary, fetchedAt }) {
  return {
    stat_key: POPULATION.stat_key, label: POPULATION.label, unit: POPULATION.unit, source: POPULATION.source,
    kosis_table: { orgId: POPULATION.orgId, tblId: POPULATION.tblId, itmId: POPULATION.itmId, name: POPULATION.tableName },
    ref_date: picked.ref_date, fetched_at: fetchedAt, regions_as_of: regionsFile.as_of,
    national_total: picked.national_total, ...summary,
    values: matched.values.sort((a, b) => a.region_code.localeCompare(b.region_code)),
  };
}

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
export function toStatSql(pop) {
  const L = [`-- 자동 생성 (collector/src/population.mjs). ${pop.source}, 기준월 ${pop.ref_date}, 받은 시각 ${pop.fetched_at}`];
  for (const v of pop.values)
    L.push(`INSERT OR REPLACE INTO stat_values (region_code, stat_key, value, unit, ref_date, source, fetched_at) VALUES (${q(v.region_code)}, ${q(pop.stat_key)}, ${v.value}, ${q(pop.unit)}, ${q(pop.ref_date)}, ${q(pop.source)}, ${q(pop.fetched_at)});`);
  L.push(`INSERT INTO stat_meta (stat_key, label, unit, source, latest_ref_date, updated_at) VALUES (${q(pop.stat_key)}, ${q(pop.label)}, ${q(pop.unit)}, ${q(pop.source)}, ${q(pop.ref_date)}, ${q(pop.fetched_at)}) ` +
    `ON CONFLICT(stat_key) DO UPDATE SET label=excluded.label, unit=excluded.unit, source=excluded.source, latest_ref_date=excluded.latest_ref_date, updated_at=excluded.updated_at;`);
  return L.join("\n") + "\n";
}
