// 나머지 통계 9가지(면적·밀도·5년 증감률·고령/어린이 비율·평균 나이·세대당 인구·자동차·1,000명당 자동차)를
// KOSIS 응답에서 만들고 검증한다. 모든 규칙은 이 파일에 모아 두었다.
import { KosisError } from "./kosis.mjs";
import { matchRegions } from "./population.mjs";

export const ORG = "행정안전부 주민등록인구현황(KOSIS)";
export const TABLES = {
  age: { orgId: "101", tblId: "DT_1B04006", itmId: "T2", name: "행정구역(시군구)별/1세별 주민등록인구" },
  households: { orgId: "101", tblId: "DT_1B040B3", itmId: "T1", name: "행정구역(시군구)별 주민등록세대수" },
  population: { orgId: "101", tblId: "DT_1B040A3", itmId: "T20", name: "행정구역(시군구)별 성별 인구수" },
  area: { orgId: "460", tblId: "TX_315_2009_H1009", itmId: "16315T2008_0012", name: "행정구역 현황(지적통계, 면적)" },
  cars: { orgId: "116", tblId: "DT_MLTM_5498", itmId: "13103873443T4", name: "자동차등록대수현황 시도별(시군구)" },
};

// 통계 10가지 정의(서버와 맞출 이름 그대로)
export const STAT_DEFS = {
  population: { label: "인구", unit: "명", decimals: 0 },
  area: { label: "면적", unit: "㎢", decimals: 2 },
  density: { label: "인구 밀도", unit: "명/㎢", decimals: 1, range: [0, 30000] },
  pop_change_5y: { label: "5년간 인구 증감률", unit: "%", decimals: 2, range: [-50, 100] },
  elderly_ratio: { label: "고령 인구 비율(65세 이상)", unit: "%", decimals: 2, range: [0, 80] },
  child_ratio: { label: "어린이 인구 비율(15세 미만)", unit: "%", decimals: 2, range: [0, 40] },
  avg_age: { label: "평균 나이", unit: "세", decimals: 2, range: [20, 70] },
  persons_per_household: { label: "세대당 인구", unit: "명", decimals: 2, range: [1, 5] },
  cars: { label: "자동차 등록 대수", unit: "대", decimals: 0 },
  cars_per_1000: { label: "1,000명당 자동차 수", unit: "대", decimals: 1, range: [0, 10000] },
};

// 개편(2026-07-01) 때문에 옛 자료에서 이어 붙일 수 없는 지역: 5년 전 인구·면적을 비운다.
// 인천 중구·동구·서구가 제물포·영종·서해·검단구로 갈라져 옛 숫자를 새 구에 나눌 근거가 없다.
export const NO_PREDECESSOR = new Set(["28125", "28155", "28275", "28290"]);

// 1,000명당 자동차가 이 값을 넘는 지역은 cars·cars_per_1000 문제 후보에서 뺀다(값은 파일에 그대로 둔다).
export const CARS_QUIZ_MAX_PER_1000 = 1000;
const MIN_COVERAGE = 0.95;
const MAX_TOTAL_GAP = 0.01;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const fmtMonth = (d) => `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월`;

function month(rows) {
  const ms = new Set(rows.map((r) => r.PRD_DE));
  if (ms.size !== 1) throw new KosisError("통계청 응답에 기준 시점이 여러 개 섞여 있어요. 한 시점만 받아야 해요.");
  return [...ms][0];
}
const toMonth = (p) => `${p.slice(0, 4)}-${p.slice(4, 6)}`;

// ---------- 코드 기준 표(인구·세대·연령) ----------
export function codeRows(resp, itmId) {
  const rows = resp.filter((r) => r.ITM_ID === itmId);
  if (!rows.length) throw new KosisError("통계청 응답에 필요한 항목이 없어요.");
  const ref = toMonth(month(rows));
  const nat = rows.find((r) => r.C1 === "00");
  const national = nat ? Number(nat.DT) : NaN;
  if (!(national > 0)) throw new KosisError("통계청 응답에 전국 값이 없어서 합계를 검증할 수 없어요. 저장하지 않았어요.");
  return {
    ref_date: ref, national,
    rows: rows.filter((r) => r.C1 !== "00").map((r) => ({ kosis_code: r.C1, kosis_name: r.C1_NM, value: Number(r.DT) })),
  };
}

// 표마다 조금씩 다른 지역 이름을 맞춘다: "창원시(통합)" → "창원시", 세종 시·군·구 줄 "세종특별자치시" → "세종시"
export function normName(code, name) {
  const n = name.replace(/\(통합\)$/, "");
  return code === "36110" ? "세종시" : n;
}

// 1세별 표 → 지역별 {계, 65세 이상, 15세 미만, 나이×인원 합}
export function ageRows(resp) {
  const rows = resp.filter((r) => r.ITM_ID === TABLES.age.itmId);
  if (!rows.length) throw new KosisError("통계청 응답에 연령별 자료가 없어요.");
  const ref = toMonth(month(rows));
  const by = new Map();
  for (const r of rows) {
    const e = by.get(r.C1) ?? { kosis_code: r.C1, kosis_name: normName(r.C1, r.C1_NM), total: NaN, elderly: 0, child: 0, ageSum: 0, ages: 0 };
    by.set(r.C1, e);
    const v = Number(r.DT);
    if (r.C2_NM === "계") { e.total = v; continue; }
    const m = /^(\d+)세( 이상)?$/.exec(r.C2_NM);
    if (!m) continue;
    const age = Number(m[1]); // 100세 이상은 100세로 계산
    if (!Number.isFinite(v)) { e.bad = true; continue; }
    e.ages += 1; e.ageSum += age * v;
    if (age >= 65) e.elderly += v;
    if (age < 15) e.child += v;
    e.sum = (e.sum ?? 0) + v;
  }
  const nat = by.get("00");
  if (!nat || !(nat.total > 0)) throw new KosisError("통계청 연령별 응답에 전국 값이 없어요. 저장하지 않았어요.");
  by.delete("00");
  for (const e of by.values()) {
    if (e.bad || e.ages !== 101 || !(e.total >= 0) || Math.abs((e.sum ?? 0) - e.total) > 0) {
      if (e.total === 0 && e.ages === 101) continue;
      if (/출장소$/.test(e.kosis_name) && !(e.total > 0)) continue;
      throw new KosisError(`연령별 자료가 이상해요(${e.kosis_name}: 나이 칸 수나 합계가 맞지 않음). 저장하지 않았어요.`);
    }
  }
  return { ref_date: ref, national: nat.total, rows: [...by.values()] };
}

// ---------- 이름 기준 표(면적: 시·도 이름 + 시·군·구 이름) ----------
export function areaRows(resp) {
  const rows = resp.filter((r) => r.ITM_ID === TABLES.area.itmId && r.C2_NM === "합계");
  if (!rows.length) throw new KosisError("통계청 면적 응답에 합계 자료가 없어요.");
  const ys = new Set(rows.map((r) => r.PRD_DE));
  if (ys.size !== 1) throw new KosisError("통계청 면적 응답에 연도가 여러 개 섞여 있어요.");
  const year = [...ys][0];
  const sidos = new Map(); // 앞 12글자 → 시·도 이름
  for (const r of rows) if (r.C1.length === 11 && r.C1 !== "15315HJG000") sidos.set(r.C1, r.C1_NM);
  const nat = rows.find((r) => r.C1 === "15315HJG000");
  if (!nat) throw new KosisError("통계청 면적 응답에 전국 값이 없어요. 저장하지 않았어요.");
  const out = [];
  for (const r of rows) {
    if (r.C1.length !== 14) continue;
    const sido = sidos.get(r.C1.slice(0, 11));
    if (!sido) throw new KosisError("면적 자료의 지역 구조를 이해할 수 없어요.");
    out.push({ sido, name: r.C1_NM, m2: Number(r.DT), level: "sigungu" });
  }
  for (const [c, n] of sidos) out.push({ sido: n, name: null, m2: Number(rows.find((r) => r.C1 === c).DT), level: "sido" });
  return { ref_date: `${year}-12-31`, national: Number(nat.DT), rows: out };
}

// ---------- 자동차(시도 약칭 + 시군구 이름) ----------
export function carsRows(resp) {
  const rows = resp.filter((r) => r.ITM_ID === TABLES.cars.itmId && r.C3_NM === "총계");
  if (!rows.length) throw new KosisError("통계청 자동차 응답에 총계 자료가 없어요.");
  const ref = toMonth(month(rows));
  return {
    ref_date: ref,
    rows: rows.map((r) => ({ sido: r.C1_NM, name: r.C2_NM, value: Number(r.DT), used: false })),
  };
}

const sidoOf = (regions) => new Map(regions.filter((r) => r.level === "sido").map((r) => [r.code, r]));

// ---------- 면적 맞추기 ----------
// 옛 구성(2025년 말)의 광주광역시+전라남도 → 전남광주통합특별시. 인천 신설 4구는 비움.
export function matchArea(regions, area) {
  const sidos = sidoOf(regions);
  const idx = new Map();
  for (const r of area.rows) idx.set(`${r.sido}|${r.name ?? ""}`, (idx.get(`${r.sido}|${r.name ?? ""}`) ?? []).concat(r));
  const used = new Set();
  const get = (sido, name) => {
    const hit = idx.get(`${sido}|${name ?? ""}`);
    if (hit && hit.length > 1) throw new KosisError(`면적 자료에 같은 이름이 겹쳐요(${sido} ${name}).`);
    if (hit) used.add(`${sido}|${name ?? ""}`);
    return hit?.[0];
  };
  const values = [], blanks = [];
  for (const reg of regions) {
    if (NO_PREDECESSOR.has(reg.code)) { blanks.push({ code: reg.code, name: reg.display_name, reason: "개편으로 옛 면적 자료와 이어 붙일 수 없음" }); continue; }
    let m2 = null;
    if (reg.level === "sido") {
      m2 = reg.code === "12"
        ? ["광주광역시", "전라남도"].map((s) => get(s, null)?.m2).reduce((a, b) => (a == null || b == null ? null : a + b))
        : get(reg.name, null)?.m2;
    } else {
      const sidoName = sidos.get(reg.parent_code).name;
      if (reg.parent_code === "12") {
        const hits = ["광주광역시", "전라남도"].map((s) => get(s, reg.name)).filter(Boolean);
        if (hits.length === 1) m2 = hits[0].m2;
      } else if (reg.code === "36110") m2 = get("세종특별자치시", "세종특별자치시")?.m2;
      else m2 = get(sidoName, reg.name)?.m2;
    }
    if (m2 == null || !(m2 > 0)) { blanks.push({ code: reg.code, name: reg.display_name, reason: "면적 자료에서 찾지 못함" }); continue; }
    values.push({ region_code: reg.code, value: round(m2 / 1e6, 2) });
  }
  return { values, blanks };
}

// ---------- 5년 전 인구 맞추기 ----------
export function matchOldPopulation(regions, old) {
  const bySido = new Map(); // 2자리 → 시·도 이름
  for (const r of old.rows) if (r.kosis_code.length === 2) bySido.set(r.kosis_code, r.kosis_name);
  const idx = new Map();
  for (const r of old.rows) {
    if (r.kosis_code.length !== 5) continue;
    const k = `${r.kosis_code.slice(0, 2)}|${r.kosis_name}`;
    idx.set(k, (idx.get(k) ?? []).concat(r));
  }
  const byCode = new Map(old.rows.map((r) => [r.kosis_code, r]));
  const one = (sido2, name) => {
    const h = idx.get(`${sido2}|${name}`);
    if (h && h.length > 1) throw new KosisError(`5년 전 인구 자료에 같은 이름이 겹쳐요(${name}).`);
    return h?.[0]?.value;
  };
  const values = [], blanks = [];
  const moved = []; // 지금 소속이 옛 소속과 다른 시·군·구: { to: 지금 시·도, from: 옛 시·도, value }
  for (const reg of regions) {
    if (NO_PREDECESSOR.has(reg.code)) { blanks.push({ code: reg.code, name: reg.display_name, reason: "개편으로 5년 전 같은 구역 자료가 없음" }); continue; }
    let v = null;
    if (reg.code === "12") {
      const a = byCode.get("29"), b = byCode.get("46");
      if (a && b) v = a.value + b.value; // 옛 광주광역시 + 전라남도 (통째로 합쳐졌으므로 아래 보정은 하지 않음)
    } else if (reg.level === "sido") {
      const h = byCode.get(reg.code);
      if (h && h.kosis_name === reg.name) v = h.value;
    } else if (reg.parent_code === "12") {
      const c = ["29", "46"].map((s) => one(s, reg.name)).filter((x) => x != null);
      if (c.length === 1) v = c[0];
    } else if (reg.code === "27720") {
      v = one("47", "군위군"); // 군위군은 2023년 경북에서 대구로 옮김
      if (v > 0) moved.push({ to: "27", from: "47", value: v });
    } else {
      const h = byCode.get(reg.code);
      if (h && h.kosis_name === reg.name) v = h.value;
      else v = one(reg.parent_code, reg.name) ?? null;
    }
    if (!(v > 0)) { blanks.push({ code: reg.code, name: reg.display_name, reason: "5년 전 자료에서 찾지 못함" }); continue; }
    values.push({ region_code: reg.code, value: v });
  }
  // 지금 구성 기준으로 시·도 값 보정: 옮겨 온 시·군·구의 옛 값을 새 시·도에 더하고 옛 시·도에서 뺀다.
  // (인천은 시·도 경계가 그대로이고 신설 구만 비우므로 시·도 값은 옛 값 그대로 쓴다.)
  const adjustments = [];
  for (const val of values) {
    if (val.region_code.length !== 2 || val.region_code === "12") continue;
    const plus = moved.filter((m) => m.to === val.region_code).reduce((t, m) => t + m.value, 0);
    const minus = moved.filter((m) => m.from === val.region_code).reduce((t, m) => t + m.value, 0);
    if (plus || minus) { adjustments.push({ code: val.region_code, plus, minus }); val.value += plus - minus; }
  }
  return { values, blanks, adjustments };
}

// ---------- 자동차 맞추기 ----------
export function matchCars(regions, cars) {
  const sidos = sidoOf(regions);
  const values = [], blanks = [];
  const take = (pred) => {
    const hit = cars.rows.filter(pred);
    hit.forEach((r) => (r.used = true));
    return hit;
  };
  for (const reg of regions) {
    const short = reg.level === "sido" ? reg.short_name : sidos.get(reg.parent_code).short_name;
    let hit;
    if (reg.level === "sido") hit = take((r) => r.sido === short && r.name === "계");
    else if (reg.code === "36110") hit = take((r) => r.sido === short && r.name === "세종특별자치시");
    else if (reg.merged_gu_legal_codes) hit = take((r) => r.sido === short && (r.name === reg.name || r.name.startsWith(reg.name + " ")));
    else hit = take((r) => r.sido === short && r.name === reg.name);
    const v = hit.reduce((s, r) => s + r.value, 0);
    if (!hit.length || !(v > 0) || hit.some((r) => !Number.isFinite(r.value))) { blanks.push({ code: reg.code, name: reg.display_name, reason: "자동차 자료에서 찾지 못함" }); continue; }
    values.push({ region_code: reg.code, value: v });
  }
  // 어느 지역에도 안 쓰인 줄(옛 구 이름으로 남은 소량 등) — 시·도 "계"가 아닌 것만 따진다
  const leftover = cars.rows.filter((r) => !r.used && r.name !== "계");
  return { values, blanks, leftover: leftover.map((r) => ({ sido: r.sido, name: r.name, value: r.value })) };
}

// ---------- 검증 ----------
function lvl(regions, code) { return regions.find((r) => r.code === code).level; }

export function checkCoverage(label, regions, values, min = MIN_COVERAGE) {
  if (values.length / regions.length < min)
    throw new KosisError(`${label}: 값을 찾은 지역이 너무 적어요(${values.length}/${regions.length}곳). 이상한 자료라서 저장하지 않았어요.`);
}
export function checkTotals(label, regions, values, national) {
  const sum = (l) => values.filter((v) => lvl(regions, v.region_code) === l).reduce((s, v) => s + v.value, 0);
  const sido = sum("sido"), sg = sum("sigungu");
  if (Math.abs(sido - national) / national > MAX_TOTAL_GAP)
    throw new KosisError(`${label}: 시·도 값을 모두 더한 것이 전국 값과 크게 달라요. 이상한 자료라서 저장하지 않았어요.`);
  // 시·군·구 합: 전국 값보다 소량 모자랄 수 있어(옛 구 이름 소량 등) 3%까지 허용, 넘치면 안 됨
  if (sg > national * 1.01 || sg < national * 0.97)
    throw new KosisError(`${label}: 시·군·구 값을 모두 더한 것이 전국 값과 크게 달라요. 이상한 자료라서 저장하지 않았어요.`);
}
export function checkRange(key, values) {
  const def = STAT_DEFS[key];
  if (!def.range) return;
  const [lo, hi] = def.range;
  const bad = values.filter((v) => !Number.isFinite(v.value) || v.value < lo || v.value > hi);
  if (bad.length) throw new KosisError(`${def.label}: 값이 정상 범위(${lo}~${hi}${def.unit})를 벗어난 지역이 ${bad.length}곳 있어요(예: ${bad[0].region_code}). 이상한 자료라서 저장하지 않았어요.`);
}

// ---------- 전체 계산 ----------
// inputs: { population:{ref_date,values}, age, households, area, oldPop, cars, pop_cars } — 각각 위의 *Rows 결과
export function buildAllStats(regions, raw, { minCoverage = MIN_COVERAGE } = {}) {
  const sumPart = (ageField) => matchRegions(regions, raw.age.rows.map((r) => ({ kosis_code: r.kosis_code, kosis_name: r.kosis_name, value: r[ageField] })));
  const refPop = raw.population.ref_date;
  if (raw.age.ref_date !== refPop || raw.households.ref_date !== refPop)
    throw new KosisError(`인구(${refPop}), 연령별(${raw.age.ref_date}), 세대수(${raw.households.ref_date})의 기준월이 서로 달라요. 저장하지 않았어요.`);
  const popBy = new Map(raw.population.values.map((v) => [v.region_code, v.value]));

  const mTotal = sumPart("total"), mEld = sumPart("elderly"), mChild = sumPart("child"), mAgeSum = sumPart("ageSum");
  const hh = matchRegions(regions, raw.households.rows);
  for (const m of [mTotal, hh]) if (m.unmatched.length || m.empty?.length) throw new KosisError("연령별·세대수 자료에 우리 지역 목록과 맞지 않는 지역이 있어요. 저장하지 않았어요.");
  const get = (m) => new Map(m.values.map((v) => [v.region_code, v.value]));
  const T = get(mTotal), E = get(mEld), C = get(mChild), A = get(mAgeSum), H = get(hh);

  const area = matchArea(regions, raw.area);
  const old = matchOldPopulation(regions, raw.oldPop);
  const cars = matchCars(regions, raw.cars);
  const pop2 = matchRegions(regions, raw.popCars.rows);
  if (pop2.unmatched.length) throw new KosisError(`자동차와 같은 달(${raw.popCars.ref_date}) 인구 자료가 지역 목록과 맞지 않아요. 저장하지 않았어요.`);
  const P2 = get(pop2), AREA = new Map(area.values.map((v) => [v.region_code, v.value])), OLD = new Map(old.values.map((v) => [v.region_code, v.value])), CARS = new Map(cars.values.map((v) => [v.region_code, v.value]));

  const refs = { pop: refPop, area: raw.area.ref_date, old: raw.oldPop.ref_date, cars: raw.cars.ref_date };
  if (raw.popCars.ref_date !== refs.cars) throw new KosisError("자동차와 인구를 같은 달로 맞출 수 없어요. 저장하지 않았어요.");
  const oldSido = old.values.filter((v) => v.region_code.length === 2).reduce((t, v) => t + v.value, 0);
  if (Math.abs(oldSido - raw.oldPop.national) / raw.oldPop.national > MAX_TOTAL_GAP && regions.filter((r) => r.level === "sido").every((r) => old.values.some((v) => v.region_code === r.code)))
    throw new KosisError("5년 전 인구의 시·도 값을 모두 더한 것이 전국과 크게 달라요. 이상한 자료라서 저장하지 않았어요.");
  const out = {};
  const mk = (key, ref, source, inputs, fn) => {
    const vals = [], blanks = [];
    for (const reg of regions) {
      const r = fn(reg.code);
      if (r === null) { blanks.push(reg.code); continue; }
      vals.push({ region_code: reg.code, value: round(r.value, STAT_DEFS[key].decimals), from: r.from });
    }
    out[key] = { stat_key: key, ...STAT_DEFS[key], source, ref_date: ref, inputs, values: vals, blank_regions: blanks };
  };
  const SRC = { pop: ORG, area: "한국국토정보공사 지적통계 행정구역 현황(KOSIS)", cars: "국토교통부 자동차등록대수현황(KOSIS)" };
  // 값이 모자라면 아래 검사에서 어차피 멈춘다. 여기서는 비운다.
  const ratio = (num, den) => (c) => (num.has(c) && den.has(c) && den.get(c) > 0 ? { value: (num.get(c) / den.get(c)) * 100, from: [num.get(c), den.get(c)] } : null);

  out.area = { stat_key: "area", ...STAT_DEFS.area, source: SRC.area, ref_date: raw.area.ref_date, inputs: [{ key: "area", ref_date: raw.area.ref_date }],
    values: area.values, blank_regions: area.blanks.map((b) => b.code) };
  mk("density", refs.pop, `인구: ${ORG} ${fmtMonth(refs.pop)} / 면적: ${SRC.area} ${raw.area.ref_date.slice(0, 4)}년 말`,
    [{ key: "population", ref_date: refs.pop }, { key: "area", ref_date: raw.area.ref_date }],
    (c) => (popBy.has(c) && AREA.has(c) ? { value: popBy.get(c) / AREA.get(c), from: [popBy.get(c), AREA.get(c)] } : null));
  mk("pop_change_5y", refs.pop, `${ORG} ${fmtMonth(refs.old)} → ${fmtMonth(refs.pop)}`,
    [{ key: "population", ref_date: refs.pop }, { key: "population", ref_date: refs.old }],
    (c) => (popBy.has(c) && OLD.has(c) ? { value: ((popBy.get(c) - OLD.get(c)) / OLD.get(c)) * 100, from: [popBy.get(c), OLD.get(c)] } : null));
  mk("elderly_ratio", refs.pop, `${ORG} ${fmtMonth(refs.pop)} 1세별 주민등록인구(65세 이상)`, [{ key: "age", ref_date: refs.pop }], ratio(E, T));
  mk("child_ratio", refs.pop, `${ORG} ${fmtMonth(refs.pop)} 1세별 주민등록인구(15세 미만)`, [{ key: "age", ref_date: refs.pop }], ratio(C, T));
  mk("avg_age", refs.pop, `${ORG} ${fmtMonth(refs.pop)} 1세별 주민등록인구로 계산(만 나이, 100세 이상은 100세)`, [{ key: "age", ref_date: refs.pop }],
    (c) => (A.has(c) && T.get(c) > 0 ? { value: A.get(c) / T.get(c), from: [A.get(c), T.get(c)] } : null));
  mk("persons_per_household", refs.pop, `${ORG} ${fmtMonth(refs.pop)} (인구 ÷ 세대수)`, [{ key: "population", ref_date: refs.pop }, { key: "households", ref_date: refs.pop }],
    (c) => (popBy.has(c) && H.get(c) > 0 ? { value: popBy.get(c) / H.get(c), from: [popBy.get(c), H.get(c)] } : null));
  out.cars = { stat_key: "cars", ...STAT_DEFS.cars, source: SRC.cars, ref_date: refs.cars, inputs: [{ key: "cars", ref_date: refs.cars }],
    values: cars.values.map((v) => ({ ...v, value: round(v.value, 0) })), blank_regions: cars.blanks.map((b) => b.code) };
  mk("cars_per_1000", refs.cars, `자동차: ${SRC.cars} ${fmtMonth(refs.cars)} / 인구: ${ORG} ${fmtMonth(refs.cars)}`,
    [{ key: "cars", ref_date: refs.cars }, { key: "population", ref_date: refs.cars }],
    (c) => (CARS.has(c) && P2.get(c) > 0 ? { value: (CARS.get(c) / P2.get(c)) * 1000, from: [CARS.get(c), P2.get(c)] } : null));

  // 문제로 내기 이상한 값(영업용·렌터카 본점 등록 영향)은 값은 두고 quiz_exclude 표시만 붙인다.
  const quizExcluded = [];
  const perThousand = new Map(out.cars_per_1000.values.map((v) => [v.region_code, v.value]));
  for (const [c, v] of perThousand) {
    if (v > CARS_QUIZ_MAX_PER_1000) {
      const reg = regions.find((r) => r.code === c);
      quizExcluded.push({ region_code: c, name: reg.display_name, cars: CARS.get(c), cars_per_1000: v, reason: `1,000명당 ${CARS_QUIZ_MAX_PER_1000}대 초과(영업용·렌터카 등록 영향 추정)` });
    }
  }
  const exSet = new Set(quizExcluded.map((q) => q.region_code));
  for (const key of ["cars", "cars_per_1000"]) for (const v of out[key].values) if (exSet.has(v.region_code)) v.quiz_exclude = true;

  // 연령 표의 계가 인구 통계와 같은지(같은 달 자료 일치)
  for (const [c, t] of T) if (popBy.has(c) && popBy.get(c) !== t) throw new KosisError("연령별 표의 인구 합계가 인구 통계와 달라요. 저장하지 않았어요.");

  // 검사: 합계(전국과 비교) 먼저, 그다음 지역 수·정상 범위
  checkTotals("면적", regions, out.area.values, raw.area.national / 1e6);
  const natCars = raw.cars.rows.filter((r) => r.name === "계").reduce((s, r) => s + r.value, 0);
  checkTotals("자동차", regions, out.cars.values, natCars);
  checkTotals("세대수", regions, [...H].map(([region_code, value]) => ({ region_code, value })), raw.households.national);
  for (const key of Object.keys(out)) {
    if (key === "population") continue;
    checkCoverage(STAT_DEFS[key].label, regions, out[key].values, minCoverage);
    checkRange(key, out[key].values);
  }
  const leftoverCars = cars.leftover.reduce((s, r) => s + r.value, 0);
  if (leftoverCars / natCars > 0.01) throw new KosisError("자동차 자료에 우리 지역과 맞지 않는 줄이 너무 많아요. 저장하지 않았어요.");
  return { stats: out, report: { area_blanks: area.blanks, old_pop_blanks: old.blanks, old_pop_sido_adjustments: old.adjustments, cars_blanks: cars.blanks, cars_leftover: cars.leftover, quiz_excluded: quizExcluded } };
}
