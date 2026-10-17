/** Public administrative geography, attributed cached geometry. Answer mapping remains server-side. */
import legal from "../../data/regions.json";
import boundary from "../../data/geo/boundaries.json";
import type { Difficulty, GeoStatKey, Level, MapHint, Rng, ServerQuestion, Shape } from "./quiz";
export const GEO_KEYS: GeoStatKey[] = ["parent", "shape_to_name", "name_to_shape"];
interface Region { code: string; name: string; display_name: string; level: string; parent_code: string | null }
interface Mapped extends Region { shape: Shape; location?: Shape }
const regions = legal.regions as Region[];
const maps = boundary.regions as Mapped[];
const provinces = regions.filter(r => r.level === "sido");
export const GEO_STATUS = { source: boundary.source, source_url: boundary.source_url, ref_date: boundary.ref_date, region_date: boundary.region_date, count: maps.length, excluded: boundary.excluded, limitations: boundary.changes };
export const geoKey = (kind: GeoStatKey, target: string) => `${kind}|${target}`;
function shuffle<T>(a: readonly T[], rng: Rng): T[] {
  const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b;
}
export function pickGeoQuestion(kind: GeoStatKey, difficulty: Difficulty, options: { rng: Rng; exclude?: ReadonlySet<string>; questionId: string }): ServerQuestion | null {
  const { rng, exclude } = options;
  // Easy shape questions are province outlines; hard ones are municipalities. Normal gradually mixes both.
  const level: Level = difficulty === "easy" ? "sido" : difficulty === "hard" ? "sigungu" : rng() < .25 ? "sido" : "sigungu";
  const eligible = kind === "parent" ? regions.filter(r => r.level === "sigungu") : maps.filter(r => r.level === level && (level === "sido" || maps.filter(o => o.level === level && o.parent_code === r.parent_code).length >= 4));
  const target = shuffle(eligible.filter(r => !exclude?.has(geoKey(kind, r.code))), rng)[0];
  if (!target) return null;
  let choices: ServerQuestion["choices"], answer: string, shape: Shape | undefined, hint: MapHint | undefined;
  const full: Record<string, string> = {}, displays: Record<string, string> = {};
  let text: string, explanation: string;
  if (kind === "parent") {
    const parent = provinces.find(r => r.code === target.parent_code)!;
    choices = shuffle([parent, ...shuffle(provinces.filter(r => r.code !== parent.code), rng).slice(0, 3)], rng).map(r => ({ code: r.code, name: r.name }));
    answer = parent.code; text = `${target.display_name}의 소속 시·도는?`;
    explanation = `${target.display_name}의 소속 시·도는 ${parent.name}입니다. (행정구역 코드 ${target.code}, ${legal.as_of} 기준)`;
    for (const c of choices) { full[c.code] = c.name; displays[c.code] = c.code === answer ? `${target.display_name}의 소속 시·도` : "다른 시·도"; }
  } else {
    const t = target as Mapped;
    const others = maps.filter(r => r.level === level && r.code !== t.code && (level === "sido" || r.parent_code === t.parent_code));
    const chosen = shuffle([t, ...shuffle(others, rng).slice(0, 3)], rng);
    if (kind === "shape_to_name") {
      choices = chosen.map(r => ({ code: r.code, name: r.display_name })); answer = t.code; shape = t.shape;
      text = "이 모양의 지역은 어디일까요?";
      for (const c of choices) { full[c.code] = c.name; displays[c.code] = c.code === answer ? "정답 지역" : "다른 지역"; }
    } else {
      choices = chosen.map((r, i) => ({ code: String.fromCharCode(97 + i), name: `모양 ${i + 1}`, shape: r.shape }));
      answer = choices[chosen.findIndex(r => r.code === t.code)].code;
      text = `${t.display_name}의 모양은?`;
      chosen.forEach((r, i) => { full[choices[i].code] = r.display_name; displays[choices[i].code] = r.display_name; });
    }
    if (t.parent_code && t.location) {
      const p = maps.find(r => r.code === t.parent_code)!;
      hint = { outline: p.shape, highlight: t.location, label: p.name };
    }
    explanation = `정답은 ${t.display_name}입니다. 경계는 ${boundary.ref_date} 공개자료를 현재 행정구역 코드에 연결한 것으로, 2026 신설 인천 4개 구는 출제하지 않습니다.`;
  }
  return { question_id: options.questionId, stat_key: kind, kind, text, choices, ...(shape ? { shape } : {}), ...(hint ? { hint } : {}), level: kind === "parent" ? "sigungu" : level, difficulty, answer_code: answer, values: Object.fromEntries(choices.map(c => [c.code, 0])), full_names: full, displays, explanation, question_key: geoKey(kind, target.code), ref_date: kind === "parent" ? legal.as_of : boundary.ref_date, source: kind === "parent" ? legal.source : boundary.source };
}
