/** Versioned public data snapshots. No per-player requests to providers. */
import data from '../../data/extra/extra.json';
import {pairText,STATS} from './stats';
import {buildPool,pickQuestion,chooseLevel,type Pool,type Level,type Difficulty,type PickOptions,type ServerQuestion} from './quiz';
export const EXTRA_KEYS=['convenience_count','convenience_per_10000','cafe_count','cafe_per_10000','bakery_count','bakery_per_10000','karaoke_count','karaoke_per_10000','bicycle_length','rice_production','coastline_length','road_length','electricity_sales','railway_registered','single_household_ratio','urban_park_per_person','uninhabited_islands','snow_days','public_libraries','forest_share','daytime_increase','museum_count'] as const;
export type ExtraKey=(typeof EXTRA_KEYS)[number];
export const isExtraKey=(key:string):key is ExtraKey=>(EXTRA_KEYS as readonly string[]).includes(key);
const cache=new Map<string,Pool>();
export function extraMeta(key:ExtraKey){const d=data.metrics[key];return {key,label:STATS[key].label,unit:STATS[key].unit,source:d.source,ref_date:d.ref_date,fetched_at:data.collected_at,updated_at:data.collected_at,regions:246,present:d.rows.length,missing:246-d.rows.length};}
export function pickExtraQuestion(key:ExtraKey,difficulty:Difficulty,opts:PickOptions):ServerQuestion|null{
 const first=chooseLevel(difficulty,opts.rng),d=data.metrics[key];
 for(const level of [first,first==='sido'?'sigungu':'sido'] as Level[]){
  const ck=key+'|'+level;let pool=cache.get(ck);
  if(!pool){pool=buildPool(key,level,d.ref_date,d.rows.filter(r=>r.level===level).map(r=>({code:r.code,name:r.name,value:r.value})),d.source);cache.set(ck,pool);}
  const q=pickQuestion(pool,difficulty,opts);if(q){q.basis=d.basis;if(key==='snow_days'){for(const c of q.choices){c.name=d.rows.find(r=>r.code===c.code)!.name;q.full_names[c.code]=c.name;}q.text=STATS[key].question.replace('{pair}',pairText(q.choices[0].name,q.choices[1].name));}return q;}
 }
 return null;
}
