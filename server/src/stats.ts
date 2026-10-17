// 통계 목록(한 곳). 새 통계는 STATS에 한 항목만 더하면 문제에 쓰인다.
// 키는 collector가 저장하는 stat_key와 같아야 한다(S2-1).
export type StatKey =
  | "population" | "area" | "density" | "pop_change_5y" | "elderly_ratio"
  | "child_ratio" | "avg_age" | "persons_per_household" | "cars" | "cars_per_1000"
  | "annual_temp" | "annual_precip" | "mean_elevation"
  | "convenience_count" | "convenience_per_10000" | "cafe_count" | "cafe_per_10000" | "bakery_count" | "bakery_per_10000" | "karaoke_count" | "karaoke_per_10000" | "bicycle_length" | "coastline_length" | "road_length" | "rice_production" | "electricity_sales"
  | "position_north" | "position_south" | "position_east" | "position_west";

// 주제 묶음(PRD F1). 지도 주제의 모양 문제는 스프린트 4.
export type Topic = "population" | "age" | "map" | "cars" | "nature" | "industry";

export interface StatDef {
  basis?: string;
  label: string; // 통계 이름
  /** 문제 문구 틀. {pair}는 "A와 B"(받침에 맞는 조사)로 바뀐다. */
  question: string;
  /** higher: 값이 큰 쪽이 정답, lower: 값이 작은 쪽이 정답 */
  direction: "higher" | "lower";
  unit: string;
  topic: Topic;
  /** 해설에 보여 줄 값 모양 */
  format: (v: number) => string;
  /**
   * 두 값이 "다르다"고 보는 기준.
   * relative: 상대 차이 |a-b|/max(|a|,|b|) 3% 이상(양수 값에 적합) + 절대 차이 minAbsDiff 이상
   * absolute: 절대 차이(%p·세 등)만 본다. 0 근처·부호가 갈리는 값에서 상대 차이는 의미가 없기 때문.
   */
  diffMode: "relative" | "absolute";
  minAbsDiff: number; // 원래 단위(명·%p·세 …)로 쓴 최소 차이
}

const comma = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fixed = (digits: number, suffix: string) => (v: number) => `${v.toFixed(digits)}${suffix}`;
// 만 단위: 1만 이상이면 "27.9만 명", 미만이면 "9,500명"
const man = (unitWord: string, small: string) => (v: number) =>
  v >= 10000 ? `${(v / 10000).toFixed(1)}만 ${unitWord}` : `${comma(v)}${small}`;

export const STATS: Record<StatKey, StatDef> = {
  convenience_count: {label:"편의점 수",question:"{pair} 중 등록된 편의점이 더 많은 곳은?",direction:"higher",unit:"곳",topic:"industry",format:(v)=>comma(v)+"곳",diffMode:"relative",minAbsDiff:10},
  convenience_per_10000: {label:"편의점 / 인구 1만 명",question:"{pair} 중 인구 1만 명당 등록된 편의점이 더 많은 곳은?",direction:"higher",unit:"곳",topic:"industry",format:(v)=>v.toFixed(1)+"곳 / 1만 명",diffMode:"relative",minAbsDiff:.2},
  cafe_count: {label:"카페 수",question:"{pair} 중 등록된 카페가 더 많은 곳은?",direction:"higher",unit:"곳",topic:"industry",format:(v)=>comma(v)+"곳",diffMode:"relative",minAbsDiff:10},
  cafe_per_10000: {label:"카페 / 인구 1만 명",question:"{pair} 중 인구 1만 명당 등록된 카페가 더 많은 곳은?",direction:"higher",unit:"곳",topic:"industry",format:(v)=>v.toFixed(1)+"곳 / 1만 명",diffMode:"relative",minAbsDiff:.2},
  bakery_count: {label:"빵집 수",question:"{pair} 중 등록된 빵집이 더 많은 곳은?",direction:"higher",unit:"곳",topic:"industry",format:(v)=>comma(v)+"곳",diffMode:"relative",minAbsDiff:10},
  bakery_per_10000: {label:"빵집 / 인구 1만 명",question:"{pair} 중 인구 1만 명당 등록된 빵집이 더 많은 곳은?",direction:"higher",unit:"곳",topic:"industry",format:(v)=>v.toFixed(1)+"곳 / 1만 명",diffMode:"relative",minAbsDiff:.2},
  karaoke_count: {label:"노래방 수",question:"{pair} 중 등록된 노래방이 더 많은 곳은?",direction:"higher",unit:"곳",topic:"industry",format:(v)=>comma(v)+"곳",diffMode:"relative",minAbsDiff:5},
  karaoke_per_10000: {label:"노래방 / 인구 1만 명",question:"{pair} 중 인구 1만 명당 등록된 노래방이 더 많은 곳은?",direction:"higher",unit:"곳",topic:"industry",format:(v)=>v.toFixed(1)+"곳 / 1만 명",diffMode:"relative",minAbsDiff:.2},
  bicycle_length: {label:"자전거도로 길이",question:"{pair} 중 자전거도로 총연장이 더 긴 곳은?",direction:"higher",unit:"km",topic:"map",format:(v)=>v.toLocaleString("ko-KR",{maximumFractionDigits:1})+"km",diffMode:"relative",minAbsDiff:50},
  coastline_length: {label:"해안선 길이",question:"{pair} 중 해안선이 더 긴 곳은?",direction:"higher",unit:"km",topic:"map",format:(v)=>v.toLocaleString("ko-KR",{maximumFractionDigits:1})+"km",diffMode:"relative",minAbsDiff:20},
  road_length: {label:"도로 총연장",question:"{pair} 중 도로 총연장이 더 긴 곳은?",direction:"higher",unit:"km",topic:"map",format:(v)=>comma(v)+"km",diffMode:"relative",minAbsDiff:100},
  rice_production: {label:"쌀 생산량",question:"{pair} 중 쌀 생산량이 더 많은 곳은?",direction:"higher",unit:"톤",topic:"industry",format:man("톤","톤"),diffMode:"relative",minAbsDiff:5000},
  electricity_sales: {label:"전력판매량",question:"{pair} 중 전력판매량이 더 많은 곳은?",direction:"higher",unit:"MWh",topic:"industry",format:(v)=>comma(v)+"MWh",diffMode:"relative",minAbsDiff:100000},
  position_north: {label:"북쪽 위치",question:"{pair} 중 더 북쪽에 있는 곳은?",direction:"higher",unit:"°",topic:"map",format:(v)=>`북위 ${v.toFixed(2)}°`,diffMode:"absolute",minAbsDiff:.3,basis:"지역마다 지도 안에 기준 위치 하나를 정해 비교해요. (2023년 경계 기준)"},
  position_south: {label:"남쪽 위치",question:"{pair} 중 더 남쪽에 있는 곳은?",direction:"lower",unit:"°",topic:"map",format:(v)=>`북위 ${v.toFixed(2)}°`,diffMode:"absolute",minAbsDiff:.3,basis:"지역마다 지도 안에 기준 위치 하나를 정해 비교해요. (2023년 경계 기준)"},
  position_east: {label:"동쪽 위치",question:"{pair} 중 더 동쪽에 있는 곳은?",direction:"higher",unit:"°",topic:"map",format:(v)=>`동경 ${v.toFixed(2)}°`,diffMode:"absolute",minAbsDiff:.3,basis:"지역마다 지도 안에 기준 위치 하나를 정해 비교해요. (2023년 경계 기준)"},
  position_west: {label:"서쪽 위치",question:"{pair} 중 더 서쪽에 있는 곳은?",direction:"lower",unit:"°",topic:"map",format:(v)=>`동경 ${v.toFixed(2)}°`,diffMode:"absolute",minAbsDiff:.3,basis:"지역마다 지도 안에 기준 위치 하나를 정해 비교해요. (2023년 경계 기준)"},
  annual_temp: { label:"연평균기온",question:"{pair} 중 연평균기온이 높은 곳은?",direction:"higher",unit:"℃",topic:"nature",format:fixed(1,"℃"),diffMode:"absolute",minAbsDiff:1,basis:"1991~2020 기후평년값 · 지역 내 대표 관측지점 기준" },
  annual_precip: { label:"연강수량",question:"{pair} 중 연간 강수량이 많은 곳은?",direction:"higher",unit:"mm",topic:"nature",format:(v)=>`${comma(v)}mm`,diffMode:"relative",minAbsDiff:100,basis:"1991~2020 기후평년값 · 지역 내 대표 관측지점 기준" },
  mean_elevation: { label:"평균 해발고도(근사)",question:"{pair} 중 평균 해발고도가 높은 곳은?",direction:"higher",unit:"m",topic:"nature",format:(v)=>`약 ${comma(Math.round(v/10)*10)}m`,diffMode:"absolute",minAbsDiff:50,basis:"지역 전체 약300m 간격 표고 표본의 면적가중 평균 · 근삿값" },

  population: { label: "인구", question: "{pair} 중 인구가 많은 곳은?", direction: "higher", unit: "명", topic: "population", format: man("명", "명"), diffMode: "relative", minAbsDiff: 1000 },
  pop_change_5y: { label: "5년간 인구 증감률", question: "{pair} 중 최근 5년간 인구가 더 많이 늘어난 곳은?", direction: "higher", unit: "%", topic: "population", format: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`, diffMode: "absolute", minAbsDiff: 0.5 },
  density: { label: "인구 밀도", question: "{pair} 중 인구 밀도가 높은 곳은?", direction: "higher", unit: "명/㎢", topic: "population", format: (v) => `1㎢당 ${comma(v)}명`, diffMode: "relative", minAbsDiff: 1 },
  persons_per_household: { label: "세대당 인구", question: "{pair} 중 한 세대에 사는 사람이 더 많은 곳은?", direction: "higher", unit: "명", topic: "population", format: fixed(2, "명"), diffMode: "relative", minAbsDiff: 0.02 },
  avg_age: { label: "평균 나이", question: "{pair} 중 주민 평균 나이가 더 젊은 곳은?", direction: "lower", unit: "세", topic: "age", format: fixed(1, "세"), diffMode: "absolute", minAbsDiff: 1 },
  elderly_ratio: { label: "고령 인구 비율", question: "{pair} 중 65세 이상 주민 비율이 더 높은 곳은?", direction: "higher", unit: "%", topic: "age", format: fixed(1, "%"), diffMode: "absolute", minAbsDiff: 1 },
  child_ratio: { label: "어린이 비율", question: "{pair} 중 15세 미만 주민 비율이 더 높은 곳은?", direction: "higher", unit: "%", topic: "age", format: fixed(1, "%"), diffMode: "absolute", minAbsDiff: 1 },
  area: { label: "면적", question: "{pair} 중 넓은 곳은?", direction: "higher", unit: "㎢", topic: "map", format: (v) => `${v >= 100 ? comma(v) : v.toFixed(1)}㎢`, diffMode: "relative", minAbsDiff: 0.1 },
  cars: { label: "자동차 등록 대수", question: "{pair} 중 등록된 자동차가 더 많은 곳은?", direction: "higher", unit: "대", topic: "industry", format: man("대", "대"), diffMode: "relative", minAbsDiff: 1000 },
  cars_per_1000: { label: "1,000명당 자동차 수", question: "{pair} 중 주민 1,000명당 자동차가 더 많은 곳은?", direction: "higher", unit: "대", topic: "industry", format: (v) => `1,000명당 ${comma(v)}대`, diffMode: "relative", minAbsDiff: 1 },
};

export function isStatKey(k: string): k is StatKey {
  return Object.prototype.hasOwnProperty.call(STATS, k);
}
export function statKeysOfTopic(topic: Topic): StatKey[] {
  return (Object.keys(STATS) as StatKey[]).filter((k) => STATS[k].topic === topic);
}

/** 받침이 있으면 "과", 없으면 "와"(한글이 아닌 끝 글자는 "와"). */
export function josaWaGwa(word: string): "와" | "과" {
  const code = word.trim().charCodeAt(word.trim().length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? "와" : "과";
  return "와";
}
export function pairText(a: string, b: string): string {
  return `${a}${josaWaGwa(a)} ${b}`;
}
