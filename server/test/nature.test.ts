import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import data from '../../data/nature/nature.json';
import legal from '../../data/regions.json';
import {NATURE_KEYS,pickNatureQuestion,natureMeta} from '../src/nature';
import {STATS} from '../src/stats';
import {seededRng,toPublic,pairKey,type Difficulty} from '../src/quiz';
describe('source-backed nature comparisons',()=>{
 it('every selected station matches the official annual KMA CSV, without synthetic regional means',()=>{
  const text=new TextDecoder('euc-kr').decode(readFileSync(new URL('../../data/nature/kma-normals-1991-2020.csv',import.meta.url)));
  expect(text).toContain('1991~2020년');
  const lines=text.split(/\r?\n/),index=lines.findIndex(l=>l.startsWith('지점명,'));
  const raw=new Map(lines.slice(index+1).filter(Boolean).map(l=>{const x=l.split(',').map(s=>s.trim());return [Number(x[1]),x];}));
  const codes=new Set(legal.regions.filter(r=>r.level==='sigungu').map(r=>r.code));
  expect(data.climate.rows.length).toBeGreaterThan(150);
  expect(new Set(data.climate.rows.map(r=>r.code)).size).toBe(data.climate.rows.length);
  for(const row of data.climate.rows){const original=raw.get(row.station_id)!;expect(original).toBeTruthy();expect(row.temperature).toBe(Number(original[2]));expect(row.precipitation).toBe(Number(original[5]));expect(codes.has(row.code)).toBe(true);}
 });
 it('elevation uses populated land samples and excludes unverified wards and insufficient coverage',()=>{
  expect(data.elevation.rows.length).toBeGreaterThan(230);
  const by=new Map(data.elevation.rows.map(r=>[r.code,r]));
  expect(by.get('51190')!.value).toBeGreaterThan(by.get('41110')!.value+500);
  for(const r of data.elevation.rows){expect(r.samples).toBeGreaterThanOrEqual(10);expect(r.coverage).toBeGreaterThanOrEqual(.995);expect(r.value).toBeGreaterThanOrEqual(-50);expect(r.value).toBeLessThan(2000);}
  for(const code of ['28125','28155','28275','28290'])expect(by.has(code)).toBe(false);
  expect(data.elevation.method).toContain('공식 평균표고 통계가 아님');
 });
 it('7 kinds × 3 difficulty levels: exact source values, correct direction, same administrative level, no answer leak',()=>{
  const rng=seededRng(2067),info=new Map(legal.regions.map(r=>[r.code,r]));
  for(const key of NATURE_KEYS)for(const d of ['easy','normal','hard'] as Difficulty[])for(let n=0;n<60;n++){
   const q=pickNatureQuestion(key,d,{rng,questionId:'q'+n})!;expect(q).toBeTruthy();
   const [a,b]=q.choices;expect(a.code).not.toBe(b.code);expect(info.get(a.code)!.level).toBe(info.get(b.code)!.level);
   const original=(code:string)=>key.startsWith('position_')?(()=>{const p=data.positions.rows.find(r=>r.code===code)!;return key==='position_north'||key==='position_south'?p.lat:p.lng;})():key==='mean_elevation'?data.elevation.rows.find(r=>r.code===code)!.value:key==='annual_temp'?data.climate.rows.find(r=>r.code===code)!.temperature:data.climate.rows.find(r=>r.code===code)!.precipitation;
   expect(q.values[a.code]).toBe(original(a.code));expect(q.values[b.code]).toBe(original(b.code));
   const higher=STATS[key].direction==='higher';expect(q.answer_code).toBe((original(a.code)>original(b.code))===higher?a.code:b.code);
   expect(Math.abs(original(a.code)-original(b.code))).toBeGreaterThanOrEqual(STATS[key].minAbsDiff-1e-9);
   expect(q.basis).toBeTruthy();expect(JSON.stringify(toPublic(q))).not.toMatch(/answer_code|full_names|"values"|"displays"/);
   if(key==='annual_temp'||key==='annual_precip'){expect(q.level).toBe('sigungu');expect(q.displays![a.code]).toContain('관측');expect(q.ref_date).toBe('1991–2020');}
  }
 });
 it('all four compass directions and approximate elevation are labelled clearly',()=>{
  expect(STATS.position_north.direction).toBe('higher');expect(STATS.position_east.direction).toBe('higher');expect(STATS.position_south.direction).toBe('lower');expect(STATS.position_west.direction).toBe('lower');
  expect(STATS.position_north.format(37.1234)).toBe('북위 37.12°');expect(STATS.position_east.format(127.1234)).toBe('동경 127.12°');expect(STATS.mean_elevation.format(910.53)).toBe('약 910m');
  for(const key of NATURE_KEYS){const m=natureMeta(key);expect(m.present).toBeGreaterThan(150);expect(m.source).toBeTruthy();}
 });
 it('does not repeat the same pair with reversed choices',()=>{
  for(const key of NATURE_KEYS){const rng=seededRng(41),exclude=new Set<string>();for(let n=0;n<30;n++){const q=pickNatureQuestion(key,'hard',{rng,exclude})!;expect(q).toBeTruthy();const pair=pairKey(key,q.choices[0].code,q.choices[1].code);expect(exclude.has(pair)).toBe(false);exclude.add(pair);}}
 });
});
