/** A positively documented absence case; no nationwide zero inference from an API omission. */
import data from '../../data/extra/railway-absence.json';
import type {Difficulty,PickOptions,ServerQuestion} from './quiz';
export function pickRailwayAbsence(difficulty:Difficulty,opts:PickOptions):ServerQuestion|null{
 const kind='railway_absence',key=kind+'|goheung-2025';if(opts.exclude?.has(key))return null;
 const rng=opts.rng??Math.random,names=[data.answer,...data.others.map(r=>r.name)];
 for(let i=names.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[names[i],names[j]]=[names[j],names[i]];}
 const choices=names.map((name,i)=>({code:String.fromCharCode(97+i),name}));
 return {question_id:opts.questionId??crypto.randomUUID(),stat_key:kind,kind,text:'2025년 기준, 다음 중 일반 여객철도역이 없는 지역은?',basis:data.basis,choices,level:'sigungu',difficulty,answer_code:choices.find(c=>c.name===data.answer)!.code,values:Object.fromEntries(choices.map(c=>[c.code,0])),full_names:Object.fromEntries(choices.map(c=>[c.code,c.name])),displays:Object.fromEntries(choices.map(c=>[c.code,c.name===data.answer?'일반 여객철도역 없음':data.others.find(r=>r.name===c.name)!.station])),explanation:'고흥군의 공식 2025년 업무평가는 철도가 없는 지역에서 철도 연계 관광상품을 운영한 사례를 설명합니다. 순천시·목포시·보성군에는 각각 순천역·목포역·보성역이 있습니다.',question_key:key,ref_date:data.ref_date,source:data.source};
}
