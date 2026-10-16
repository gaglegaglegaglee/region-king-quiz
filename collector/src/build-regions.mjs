// 법정동코드 원본(data/raw/legal-dong-sigungu.tsv) → 게임용 지역 목록(data/regions.json)
// 사용법: node src/build-regions.mjs [기준일 YYYY-MM-DD]   (기본 2026-09-30)
//
// 규칙
//  - 기준일에 "있는" 코드만 쓴다: 생성일 <= 기준일 이고, 폐지일이 없거나 기준일보다 뒤.
//  - 지역 코드: 시·도는 앞 2자리("11"), 시·군·구는 앞 5자리("11680").
//  - 일반 시 안의 구(수원시 장안구 등)는 상위 시 하나로 합친다. 특별시·광역시 자치구는 그대로.
//  - 세종특별자치시는 시·도 "36" 이면서 시·군·구 "36110"(세종시) 1곳으로도 넣는다.
//  - 이름이 같은 시·군·구(중구, 동구…)는 display_name 에 시·도 약칭을 붙인다("서울 중구").
import { readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_AS_OF = "2026-09-30"; // KOSIS 최신 월(2026-09)이 2026-07-01 개편 이후 구성이라 맞춤

const SHORT = {
  서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주",
  대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원특별자치도: "강원",
  충청북도: "충북", 충청남도: "충남", 전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북",
  경상남도: "경남", 제주특별자치도: "제주", 전남광주통합특별시: "전남광주",
};

export function parseTsv(text) {
  const [head, ...lines] = text.trim().split("\n");
  const cols = head.split("\t");
  return lines.map((l) => {
    const v = l.split("\t");
    return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? "").trim()]));
  });
}

// 날짜(생성일·폐지일)가 모두 비어 있어 "현존"으로 잘못 보이는 옛 지역의 제외 목록.
// 원본 전체(날짜 빈 줄 177개 포함)를 점검한 결과 일반 규칙(아래 promotedGun)으로 잡히지 않는 예외는 없음.
// 규칙과 겹치지만 근거를 남기려고 적어 둔다.
export const EXCLUDED_LEGAL_CODES = new Map([
  ["4173000000", "경기도 여주군 — 2013-09-23 여주시(4167000000)로 승격됐지만 원본에 날짜가 비어 있음"],
]);

function isActive(r, asOf) {
  const d = asOf.replaceAll("-", "");
  if (r.created && r.created > d) return false;
  if (r.closed && r.closed <= d) return false;
  return true;
}

export function buildRegions(rawRows, asOf = DEFAULT_AS_OF) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || new Date(asOf + "T00:00:00Z").toISOString().slice(0, 10) !== asOf) throw new Error("기준일 형식이 잘못됐어요(YYYY-MM-DD).");
  let rows = rawRows.filter((r) => /^\d{10}$/.test(r.code) && r.code.endsWith("00000") && isActive(r, asOf) && !EXCLUDED_LEGAL_CODES.has(r.code));
  // 일반 규칙: 같은 시·도 안에 이름 앞부분이 같은 "○○시"가 있는 "○○군"은 시로 승격된 옛 군이라 제외한다.
  const stemOf = (r, suffix) => {
    const last = r.name.split(" ").pop();
    return r.name.split(" ").length === 2 && last.endsWith(suffix) && last.length > 1 ? last.slice(0, -1) : null;
  };
  const cityStems = new Set(rows.map((r) => stemOf(r, "시") && r.code.slice(0, 2) + stemOf(r, "시")).filter(Boolean));
  rows = rows.filter((r) => { const st = stemOf(r, "군"); return !(st && cityStems.has(r.code.slice(0, 2) + st)); });
  const byCode = new Map(rows.map((r) => [r.code, r]));
  if (byCode.size !== rows.length) throw new Error("원본에 같은 코드가 중복돼 있어요.");

  const sidos = [];
  const sidoName = new Map(); // 2자리 → 이름
  for (const r of rows) {
    if (r.code.slice(2) === "00000000") {
      sidos.push({ code: r.code.slice(0, 2), name: r.lowest_name || r.name, legal_code: r.code });
      sidoName.set(r.code.slice(0, 2), r.lowest_name || r.name);
    }
  }
  // 세종: 시·도 행이 없고 36110 한 줄만 있다 → 시·도로도 등록
  for (const r of rows) {
    const s = r.code.slice(0, 2);
    if (!sidoName.has(s) && r.name.startsWith("세종특별자치시") && r.code.slice(5) === "00000") {
      sidoName.set(s, "세종특별자치시");
      sidos.push({ code: s, name: "세종특별자치시", legal_code: s + "00000000" });
    }
  }

  const sigungu = [];
  const merged = new Map(); // 시 코드 → 합쳐진 구 목록
  for (const r of rows) {
    if (r.code.slice(2) === "00000000") continue;
    const s = r.code.slice(0, 2);
    const five = r.code.slice(0, 5);
    if (!sidoName.has(s)) throw new Error(`소속 시·도를 찾을 수 없어요: ${r.code}`);
    const parentCityCode = five.slice(0, 4) + "0" + "00000";
    const parentCity = byCode.get(parentCityCode);
    const isGeneralGu = five[4] !== "0" && parentCity && parentCity.lowest_name.endsWith("시");
    if (isGeneralGu) {
      const k = parentCityCode.slice(0, 5);
      if (!merged.has(k)) merged.set(k, []);
      merged.get(k).push(r.code);
      continue;
    }
    // 합쳐지지 않았는데 "…도 …시 …구" 꼴이면 규칙에서 빠진 것이므로 멈춘다.
    if (r.name.split(" ").length >= 3 && r.name.split(" ")[1].endsWith("시") && r.name.endsWith("구") && !/(특별|광역)시$/.test(r.name.split(" ")[0]))
      throw new Error(`일반 구인지 판단할 수 없어요: ${r.code} ${r.name}`);
    const name = r.name.startsWith("세종특별자치시") ? "세종시" : r.lowest_name;
    sigungu.push({ code: five, name, level: "sigungu", parent_code: s, legal_code: r.code });
  }

  const dup = new Map();
  for (const g of sigungu) dup.set(g.name, (dup.get(g.name) ?? 0) + 1);
  const out = [];
  for (const s of sidos.sort((a, b) => a.code.localeCompare(b.code))) {
    const short = SHORT[s.name];
    if (!short) throw new Error(`시·도 약칭을 모르는 이름이에요: ${s.name}`);
    out.push({ code: s.code, name: s.name, display_name: s.name, short_name: short, level: "sido", parent_code: null, legal_code: s.legal_code });
  }
  for (const g of sigungu.sort((a, b) => a.code.localeCompare(b.code))) {
    const short = SHORT[sidoName.get(g.parent_code)];
    out.push({
      code: g.code, name: g.name, display_name: dup.get(g.name) > 1 ? `${short} ${g.name}` : g.name,
      short_name: short, level: "sigungu", parent_code: g.parent_code, legal_code: g.legal_code,
      ...(merged.has(g.code) ? { merged_gu_legal_codes: merged.get(g.code).sort() } : {}),
      ...(g.parent_code === "36" ? { exclude_from_sub_sido_quiz: true } : {}),
    });
  }
  const names = new Set();
  for (const r of out) {
    if (names.has(r.display_name)) throw new Error(`표시 이름이 겹쳐요: ${r.display_name}`);
    names.add(r.display_name);
  }
  return out;
}

export function buildFile(asOf = DEFAULT_AS_OF) {
  const raw = new URL("../../data/raw/legal-dong-sigungu.tsv", import.meta.url);
  const src = JSON.parse(readFileSync(new URL("../../data/raw/SOURCE.json", import.meta.url), "utf-8"));
  const regions = buildRegions(parseTsv(readFileSync(raw, "utf-8")), asOf);
  return {
    source: src.source, source_url: src.source_url, raw_downloaded_at: src.downloaded_at, terms: src.terms,
    as_of: asOf,
    counts: { sido: regions.filter((r) => r.level === "sido").length, sigungu: regions.filter((r) => r.level === "sigungu").length },
    regions,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const asOf = process.argv[2] ?? DEFAULT_AS_OF;
  const f = buildFile(asOf);
  writeFileSync(new URL("../../data/regions.json", import.meta.url), JSON.stringify(f, null, 1) + "\n");
  console.log(`기준일 ${asOf}: 시·도 ${f.counts.sido}곳, 시·군·구 ${f.counts.sigungu}곳 → data/regions.json`);
}
