import { describe, it, expect } from "vitest";
import { GEO_KEYS, GEO_STATUS, pickGeoQuestion } from "../src/geo";
import { seededRng, toPublic, type Difficulty } from "../src/quiz";
import legal from "../../data/regions.json";
import maps from "../../data/geo/boundaries.json";

describe("official administrative geometry", () => {
  it("covers current codes only, preserves islands and explicitly excludes new unverified wards", () => {
    expect(maps.regions).toHaveLength(242);
    expect(new Set(maps.regions.map(r => r.code)).size).toBe(242);
    expect(maps.excluded.map(r => r.code).sort()).toEqual(["28125", "28155", "28275", "28290"]);
    const codes = new Set(legal.regions.map(r => r.code));
    expect(maps.regions.every(r => codes.has(r.code))).toBe(true);
    expect(maps.regions.filter(r => r.level === "sido")).toHaveLength(16);
    expect(maps.regions.find(r => r.name === "신안군")!.shape.path.split("M").length).toBeGreaterThan(10);
    expect(GEO_STATUS.ref_date).toBe("2023-07-29");
  });
  it("location hint shares parent projection and has no target code/name", () => {
    for (const r of maps.regions) {
      const location = (r as any).location;
      if (!r.parent_code) { expect(location).toBeUndefined(); continue; }
      expect(location.viewBox).toBe(r.shape.viewBox);
      const p = maps.regions.find(o => o.code === r.parent_code)!;
      expect(p.shape.path).toBeTruthy();
      expect(Object.keys(location).sort()).toEqual(["path", "viewBox"]);
      expect(p.level).toBe("sido");
    }
  });
});

describe("geo question generators", () => {
  it("four unique choices, correct parent from current legal data; no answer leakage", () => {
    const rng = seededRng(401);
    for (const kind of GEO_KEYS.filter(k=>k!=="phone_to_region"&&k!=="region_to_phone")) for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) for (let i=0; i<80; i++) {
      const q=pickGeoQuestion(kind,difficulty,{rng,questionId:`q-${i}`})!;
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices.map(c=>c.code)).size).toBe(4);
      expect(new Set(q.choices.map(c=>c.name)).size).toBe(4);
      expect(q.choices.some(c=>c.code===q.answer_code)).toBe(true);
      const pub=toPublic(q); const serialized=JSON.stringify(pub);
      expect(serialized).not.toMatch(/answer_code|full_names|question_key|explanation|displays|values/);
      if(kind==='parent') {
        const code=q.question_key!.split('|')[1];
        expect(q.answer_code).toBe(legal.regions.find(r=>r.code===code)!.parent_code);
      } else {
        expect(Boolean(q.hint)).toBe(q.level==='sigungu');
        if(kind==='shape_to_name')expect(q.shape).toBeTruthy();
        else {
          expect(q.shape).toBeUndefined();
          expect(q.choices.every(c=>c.shape && /^[a-d]$/.test(c.code) && /^모양 [1-4]$/.test(c.name))).toBe(true);
          expect(serialized).not.toContain('legal_code');
        }
        if(q.level==='sigungu' && kind==='shape_to_name') {
          const parents=q.choices.map(c=>legal.regions.find(r=>r.code===c.code)!.parent_code);
          expect(new Set(parents).size).toBe(1);
        }
      }
    }
  });
  it("same game does not repeat target/kind, even after easy province pool exhausts",()=>{
    for(const kind of GEO_KEYS.filter(k=>k!=="phone_to_region"&&k!=="region_to_phone")) {
      const exclude=new Set<string>(),rng=seededRng(19);
      for(let i=0;i<250;i++) {
        const q=pickGeoQuestion(kind,'hard',{rng,questionId:`q-${i}`,exclude});
        if(!q)break;
        expect(exclude.has(q.question_key!)).toBe(false);exclude.add(q.question_key!);
      }
      expect(exclude.size).toBeGreaterThan(200);
    }
    const excluded=new Set(maps.regions.filter(r=>r.level==='sido').map(r=>`shape_to_name|${r.code}`));
    expect(pickGeoQuestion('shape_to_name','easy',{rng:seededRng(3),questionId:'end',exclude:excluded})).toBeNull();
  });
});
