/** Telephone calling regions are a separate lookup, not current administrative codes. */
import data from '../../data/extra/phone.json';
import type {Difficulty,PickOptions,ServerQuestion,Rng} from './quiz';
function shuffle<T>(input:readonly T[],rng:Rng):T[]{const a=[...input];for(let n=a.length-1;n>0;n--){const i=Math.floor(rng()*(n+1));[a[n],a[i]]=[a[i],a[n]];}return a;}
export function pickPhoneQuestion(kind:'phone_to_region'|'region_to_phone',difficulty:Difficulty,opts:PickOptions):ServerQuestion|null{
 const rng=opts.rng??Math.random;
 const target=shuffle(data.rows.filter(r=>!opts.exclude?.has(kind+'|'+r.prefix)),rng)[0];if(!target)return null;
 const candidates=shuffle([target,...shuffle(data.rows.filter(r=>r.prefix!==target.prefix),rng).slice(0,3)],rng);
 const choices=candidates.map((r,i)=>({code:String.fromCharCode(97+i),name:kind==='phone_to_region'?r.region:r.prefix}));
 return {question_id:opts.questionId??crypto.randomUUID(),stat_key:kind,kind,text:kind==='phone_to_region'?`${target.prefix}은 어느 지역의 대표 전화 지역번호일까요?`:`${target.region} 지역에서 대표적으로 쓰는 전화 지역번호는?`,basis:data.basis,choices,level:'sido',difficulty,answer_code:choices[candidates.findIndex(r=>r.prefix===target.prefix)].code,values:Object.fromEntries(choices.map(c=>[c.code,0])),full_names:Object.fromEntries(candidates.map((r,i)=>[choices[i].code,r.region+' · '+r.prefix])),displays:Object.fromEntries(candidates.map((r,i)=>[choices[i].code,r.region+' 지역번호 '+r.prefix])),explanation:`전화 지역번호 안내표에서 ${target.region}은 ${target.prefix}입니다. 행정구역 경계와 통화권은 일치하지 않을 수 있습니다.`,question_key:kind+'|'+target.prefix,ref_date:data.ref_date,source:data.source};
}
