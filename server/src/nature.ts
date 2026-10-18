/** Versioned public climate/terrain snapshot; never fetch public data during a game. */
import data from '../../data/nature/nature.json';
import {STATS,type StatKey} from './stats';
import {buildPool,pickQuestion,chooseLevel,type Difficulty,type Level,type Pool,type PickOptions,type ServerQuestion} from './quiz';
export const NATURE_KEYS=['annual_temp','annual_precip','mean_elevation','position_north','position_south','position_east','position_west'] as const;
export type NatureKey=(typeof NATURE_KEYS)[number];
export const isNatureKey=(key:string):key is NatureKey=>(NATURE_KEYS as readonly string[]).includes(key);
const cache=new Map<string,Pool>();
export function natureMeta(key:NatureKey){
 const position=key.startsWith('position_');
 const source=position?data.positions:key==='mean_elevation'?data.elevation:data.climate;
 return {key,label:STATS[key].label,unit:STATS[key].unit,source:source.source,ref_date:source.ref_date,fetched_at:data.collected_at,updated_at:data.collected_at,regions:(key==='annual_temp'||key==='annual_precip')?230:246,present:source.rows.length,missing:((key==='annual_temp'||key==='annual_precip')?230:246)-source.rows.length};
}
export function pickNatureQuestion(key:NatureKey,difficulty:Difficulty,opts:PickOptions):ServerQuestion|null{
 const climate=key==='annual_temp'||key==='annual_precip';
 const level:Level=climate?'sigungu':chooseLevel(difficulty,opts.rng);
 const levels:Level[]=climate?['sigungu']:[level,level==='sido'?'sigungu':'sido'];
 for(const unit of levels){
  const ck=key+'|'+unit;
  let pool=cache.get(ck);
  if(!pool){
   const info=natureMeta(key);
   const rows=key.startsWith('position_')?data.positions.rows.filter(r=>r.level===unit).map(r=>({code:r.code,name:r.name,value:(key==='position_north'||key==='position_south')?r.lat:r.lng})):key==='mean_elevation'?data.elevation.rows.filter(r=>r.level===unit).map(r=>({code:r.code,name:r.name,value:r.value})):data.climate.rows.map(r=>({code:r.code,name:r.name,value:key==='annual_temp'?r.temperature:r.precipitation}));
   pool=buildPool(key,unit,info.ref_date,rows,info.source);cache.set(ck,pool);
  }
  const q=pickQuestion(pool,difficulty,opts);
  if(!q)continue;
  if(climate){
   q.displays=Object.fromEntries(q.choices.map(c=>{const station=data.climate.rows.find(r=>r.code===c.code)!;return [c.code,STATS[key].format(q.values[c.code])+' · '+station.station_name+' 관측'];}));
   q.reference={date:q.ref_date+' 평년값',scope:q.choices.map(c=>data.climate.rows.find(r=>r.code===c.code)!.station_name+' 관측소').join(' · ')+' 비교'};
  }
  return q;
 }
 return null;
}
