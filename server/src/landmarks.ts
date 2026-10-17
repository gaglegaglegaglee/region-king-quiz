/** Road structure locations from the official annual report, not route/project length. */
import data from '../../data/extra/landmarks.json';
import legal from '../../data/regions.json';
import type {Difficulty,PickOptions,ServerQuestion,Rng} from './quiz';
function shuffle<T>(input:readonly T[],rng:Rng):T[]{const a=[...input];for(let n=a.length-1;n>0;n--){const i=Math.floor(rng()*(n+1));[a[n],a[i]]=[a[i],a[n]];}return a;}
export function pickLandmarkQuestion(kind:'bridge_location'|'tunnel_location',difficulty:Difficulty,opts:PickOptions):ServerQuestion|null{
 const rng=opts.rng??Math.random,target=shuffle(data.rows.filter(r=>r.kind===kind&&!opts.exclude?.has(kind+'|'+r.id)),rng)[0];if(!target)return null;
 const provinces=legal.regions.filter(r=>r.level==='sido').map(r=>r.short_name);
 const names=shuffle([target.province,...shuffle(provinces.filter(n=>n!==target.province),rng).slice(0,3)],rng);
 const choices=names.map((name,i)=>({code:String.fromCharCode(97+i),name})),answer=choices.find(c=>c.name===target.province)!.code;
 const length=target.length.toLocaleString('ko-KR')+'m';
 return {question_id:opts.questionId??crypto.randomUUID(),stat_key:kind,kind,text:`국토부 현황조서에 기재된 ${target.name}(${length})의 소재 시·도는?`,basis:data.basis,choices,level:'sido',difficulty,answer_code:answer,values:Object.fromEntries(choices.map(c=>[c.code,0])),full_names:Object.fromEntries(choices.map(c=>[c.code,c.name])),displays:Object.fromEntries(choices.map(c=>[c.code,c.code===answer?`${target.name} · ${length}`:'다른 시·도'])),explanation:`${target.name}의 현황조서상 소재지는 ${target.province}이며, 시설물 연장은 ${length}입니다. 접속도로를 포함한 전체 사업 구간의 길이와는 다를 수 있습니다.`,question_key:kind+'|'+target.id,ref_date:data.ref_date,source:data.source};
}
