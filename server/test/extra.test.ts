import {describe,it,expect} from 'vitest';
import data from '../../data/extra/extra.json';
import shops from '../../data/shops/shops.json';
import {pickRailwayAbsence} from '../src/railway';
import snow from '../../data/extra/snow.json';
import landmarks from '../../data/extra/landmarks.json';
import {pickLandmarkQuestion} from '../src/landmarks';
import phone from '../../data/extra/phone.json';
import population from '../../data/stats/population.json';
import {EXTRA_KEYS,pickExtraQuestion,extraMeta} from '../src/extra';
import {pickPhoneQuestion} from '../src/phone';
import {seededRng,toPublic,type Difficulty} from '../src/quiz';
import {STATS} from '../src/stats';
describe('source-backed new comparisons',()=>{
 it('national shop totals equal all province totals; no inferred new wards or false census claims',()=>{
  const expected={convenience:54446,cafe:122622,bakery:31168,karaoke:26572};
  for(const k of Object.keys(expected) as (keyof typeof expected)[]){
   const s=shops[k];expect(s.ref_date).toBe('202606');expect(s.reported_total).toBe(expected[k]);expect(s.rows.filter(r=>r.level==='sido').reduce((a,r)=>a+r.value,0)).toBe(s.reported_total);expect(new Set(s.rows.map(r=>r.code)).size).toBe(s.rows.length);
   for(const missing of ['28125','28155','28275','28290'])expect(s.rows.some(r=>r.code===missing)).toBe(false);
  }
 });
 it('per-capita ratios use the actual population snapshot and visibly disclose both months',()=>{
  const pop=new Map(population.values.map(r=>[r.region_code,r.value]));
  for(const key of ['convenience','cafe','bakery','karaoke'] as const){
   const ratio=data.metrics[`${key}_per_10000`],raw=shops[key];expect(ratio.basis).toContain('2026-06');expect(ratio.basis).toContain('2026-09');
   for(const row of ratio.rows)expect(row.value).toBeCloseTo(raw.rows.find(r=>r.code===row.code)!.value/pop.get(row.code)!*10000,10);
  }
 });
 it('matches independently inspected source table examples and preserves data scope',()=>{
  const at=(k:keyof typeof data.metrics,c:string)=>data.metrics[k].rows.find(r=>r.code===c)!.value;
  expect(at('bicycle_length','11')).toBe(1380.93);expect(at('road_length','41')).toBe(16285);expect(at('road_length','12')).toBe(12862);expect(at('rice_production','44')).toBe(693819);expect(at('rice_production','12')).toBe(709019);expect(at('coastline_length','12')).toBe(6878.7);expect(at('electricity_sales','11')).toBe(51137877);
  expect(data.metrics.coastline_length.rows).toHaveLength(11);expect(data.metrics.rice_production.rows.some(r=>r.code==='11')).toBe(false);expect(data.metrics.bakery_count.basis).toContain('도넛');expect(data.metrics.electricity_sales.basis).toContain('자가발전');
 });
 it('preserves railway list scope, ratio exclusions and uninhabited island totals',()=>{
  expect(data.metrics.railway_registered.rows.reduce((s,r)=>s+r.value,0)).toBe(349);
  expect(data.metrics.railway_registered.rows.some(r=>r.code==='50')).toBe(false);
  expect(data.metrics.railway_registered.basis).toContain('과거 역');
  for(const key of ['single_household_ratio','urban_park_per_person'] as const){expect(data.metrics[key].rows).toHaveLength(15);expect(data.metrics[key].rows.some(r=>r.code==='12')).toBe(false);}
  expect(data.metrics.single_household_ratio.rows.find(r=>r.code==='11')!.value).toBe(40.5);
  expect(data.metrics.urban_park_per_person.rows.find(r=>r.code==='11')!.value).toBe(4.6);
  expect(data.metrics.urban_park_per_person.basis).toContain('도시지역 인구');
  expect(data.metrics.uninhabited_islands.rows.reduce((s,r)=>s+r.value,0)).toBe(2910);
  expect(data.metrics.uninhabited_islands.rows.find(r=>r.code==='12')!.value).toBe(1741);
 });
 it('snow days match twelve complete months and expose each chosen observation site',()=>{
  for(const r of data.metrics.snow_days.rows){const station=snow.rows.find(x=>x.station_id===r.station_id)!;expect(station.months.reduce((a,b)=>a+b,0)).toBe(r.value);expect(station.value).toBe(r.value);expect(r.name).toContain('관측소');const q=pickExtraQuestion('snow_days','normal',{rng:seededRng(42)})!;expect(q.choices.every(c=>c.name.includes('관측소'))).toBe(true);expect(q.text).toContain('관측지점');}
 });
 it('preserves independently verified cultural counts, forest ratios and signed daytime changes',()=>{
  expect(data.metrics.public_libraries.rows.reduce((a,r)=>a+r.value,0)).toBe(1296);expect(data.metrics.museum_count.rows.reduce((a,r)=>a+r.value,0)).toBe(918);
  expect(data.metrics.public_libraries.rows.find(r=>r.code==='12')!.value).toBe(107);expect(data.metrics.museum_count.rows.find(r=>r.code==='12')!.value).toBe(78);
  expect(data.metrics.forest_share.rows.find(r=>r.code==='11')!.value).toBeCloseTo(15323/60523*100,10);
  expect(data.metrics.forest_share.rows.find(r=>r.code==='12')!.value).toBeCloseTo((18944+686852)/(50113+1234809)*100,10);
  expect(data.metrics.daytime_increase.rows.find(r=>r.code==='11')!.value).toBeCloseTo(8.8);expect(data.metrics.daytime_increase.rows.find(r=>r.code==='36')!.value).toBeCloseTo(-6.6);
  for(const k of ['forest_share','daytime_increase'] as const)expect(data.metrics[k].rows.some(r=>['27','47'].includes(r.code))).toBe(false);
 });
 it('documents a railway absence positively instead of treating API omissions as zero',()=>{
  const exclude=new Set<string>();for(let i=0;i<20;i++){const q=pickRailwayAbsence('easy',{rng:seededRng(i)})!;expect(q.choices).toHaveLength(4);expect(new Set(q.choices.map(c=>c.name)).size).toBe(4);expect(q.choices.find(c=>c.code===q.answer_code)!.name).toBe('고흥군');expect(q.ref_date).toBe('2025');expect(q.basis).toContain('공식 업무평가');expect(q.basis).not.toContain('고흥');expect(JSON.stringify(toPublic(q))).not.toMatch(/answer_code|explanation|question_key/);exclude.add(q.question_key!);}expect(pickRailwayAbsence('easy',{exclude})).toBeNull();
 });
 it('all additional numeric kinds and difficulty levels use exact cached values, same region level and server-only answers',()=>{
  const rng=seededRng(9237);
  for(const key of EXTRA_KEYS)for(const difficulty of ['easy','normal','hard'] as Difficulty[])for(let n=0;n<20;n++){
   const q=pickExtraQuestion(key,difficulty,{rng})!;expect(q).toBeTruthy();const [a,b]=q.choices,d=data.metrics[key],av=d.rows.find(r=>r.code===a.code)!,bv=d.rows.find(r=>r.code===b.code)!;expect(av.level).toBe(bv.level);expect(q.values[a.code]).toBe(av.value);expect(q.values[b.code]).toBe(bv.value);expect(q.answer_code).toBe(av.value>bv.value?a.code:b.code);expect(Math.abs(av.value-bv.value)).toBeGreaterThanOrEqual(STATS[key].minAbsDiff-1e-9);expect(q.basis).toBe(d.basis);expect(q.ref_date).toBe(d.ref_date);expect(JSON.stringify(toPublic(q))).not.toMatch(/answer_code|full_names|"values"|"displays"/);expect(extraMeta(key).present).toBe(d.rows.length);
  }
 });
 it('road landmark locations identify the official recorded address with four unique options',()=>{
  expect(landmarks.basis).toContain('시설 전체가 한 시도 안에 있다는 뜻은 아님');
  expect(landmarks.rows.find(r=>r.name==='인천대교')).toMatchObject({province:'인천',length:11856});
  expect(landmarks.rows.find(r=>r.name==='인제양양터널')).toMatchObject({province:'강원',length:10965});
  for(const kind of ['bridge_location','tunnel_location'] as const){const exclude=new Set<string>(),rng=seededRng(823);for(let i=0;i<landmarks.rows.filter(r=>r.kind===kind).length;i++){
   const q=pickLandmarkQuestion(kind,'normal',{rng,exclude})!;expect(q).toBeTruthy();const row=landmarks.rows.find(r=>q.question_key===kind+'|'+r.id)!;
   expect(q.choices).toHaveLength(4);expect(new Set(q.choices.map(c=>c.name)).size).toBe(4);expect(q.choices.every(c=>/^[a-d]$/.test(c.code))).toBe(true);expect(q.choices.find(c=>c.code===q.answer_code)!.name).toBe(row.province);expect(q.text).toContain(row.name);expect(q.text).toContain(row.length.toLocaleString('ko-KR'));expect(JSON.stringify(toPublic(q))).not.toMatch(/answer_code|explanation|question_key/);exclude.add(q.question_key!);
  }expect(pickLandmarkQuestion(kind,'normal',{rng,exclude})).toBeNull();}
 });
 it('both phone directions have four unique options, one correct mapping, preserved zeros and no repeats',()=>{
  expect(new Set(phone.rows.map(r=>r.prefix)).size).toBe(17);expect(phone.rows.find(r=>r.region==='경기')!.prefix).toBe('031');expect(phone.rows.find(r=>r.region==='광주')!.prefix).toBe('062');expect(phone.rows.find(r=>r.region==='전남')!.prefix).toBe('061');
  for(const kind of ['phone_to_region','region_to_phone'] as const){const rng=seededRng(37),exclude=new Set<string>();for(let n=0;n<17;n++){const q=pickPhoneQuestion(kind,'easy',{rng,exclude})!;expect(q.choices).toHaveLength(4);expect(q.choices.every(c=>/^[a-d]$/.test(c.code))).toBe(true);expect(new Set(q.choices.map(c=>c.code)).size).toBe(4);expect(new Set(q.choices.map(c=>c.name)).size).toBe(4);const target=phone.rows.find(r=>q.question_key===kind+'|'+r.prefix)!;expect(target).toBeTruthy();expect(q.text).toContain(kind==='phone_to_region'?target.prefix:target.region);expect(q.choices.find(c=>c.code===q.answer_code)!.name).toBe(kind==='phone_to_region'?target.region:target.prefix);expect(q.explanation).toContain(target.prefix);expect(q.basis).toContain('통화권');expect(JSON.stringify(toPublic(q))).not.toMatch(/answer_code|explanation|question_key|full_names/);expect(exclude.has(q.question_key!)).toBe(false);exclude.add(q.question_key!);}expect(pickPhoneQuestion(kind,'easy',{rng,exclude})).toBeNull();}
 });
});
