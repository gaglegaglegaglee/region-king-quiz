import { describe,it,expect,beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import m1 from '../migrations/0001_init.sql?raw';
import m2 from '../migrations/0002_region_display_name.sql?raw';
import m3 from '../migrations/0003_games.sql?raw';
import m6 from '../migrations/0006_quiz_topics.sql?raw';
import m5 from '../migrations/0005_leaderboard.sql?raw';
import { submitScore,listScores,estimateRank,validateNickname,weekStartKst } from '../src/leaderboard';
import { authorizeAdmin,adminStatus,deleteScore } from '../src/admin';
let sql:DatabaseSync,db:D1Database;
let now=Date.UTC(2026,9,18,15);
const deps=()=>({db,now:()=>now});
beforeEach(()=>{
  now=Date.UTC(2026,9,18,15);sql=new DatabaseSync(':memory:');sql.exec(m1);sql.exec(m2);sql.exec(m3);sql.exec(m5);sql.exec("BEGIN;"+m6+"COMMIT;");
  const statement=(q:string,args:any[]=[]):any=>({bind:(...a:any[])=>statement(q,a),first:async()=>sql.prepare(q).get(...args)??null,
    all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(q).run(...args).changes)}})});
  db={prepare:(q:string)=>statement(q)} as unknown as D1Database;
});
let sequence=0;
function game(streak=3,topic='mix',at=now,speed=1500,status='over') {
  const id=(++sequence).toString(16).padStart(32,'0');
  sql.prepare('INSERT INTO games(id,topic,created_at,last_at,streak,status) VALUES(?,?,?,?,?,?)').run(id,topic,at-100000,at,streak,status);
  const insert=sql.prepare(`INSERT INTO game_questions(game_id,question_id,number,stat_key,a_code,b_code,answer_code,values_json,ref_date,source,asked_at,answered_at,correct)
    VALUES(?, ?, ?, 'population','11','26','11','[]','2026-09','공공자료',?, ?,1)`);
  for(let n=1;n<=streak;n++) insert.run(id,'q'+n,n,at-5000-n*1000,at-5000-n*1000+speed);
  return id;
}
describe('verified leaderboard',()=>{
  it('only finished server scores, no zero scores or client-controlled streak/topic',async()=>{
    const result=await submitScore(deps(),{game_id:game(3,'population'),nickname:'지역왕',streak:999,topic:'cars'});
    expect(result.record).toMatchObject({nickname:'지역왕',topic:'population',streak:3,created_at:now});
    expect(result.overall_rank).toBe(1);await expect(listScores(deps(),'cars')).rejects.toMatchObject({status:400});
    await expect(submitScore(deps(),{game_id:game(0),nickname:'하늘'})).rejects.toThrow('1연승');
    await expect(submitScore(deps(),{game_id:game(2,'mix',now,1500,'playing'),nickname:'하늘'})).rejects.toThrow('마친 뒤');
    const bad=game();sql.prepare('UPDATE games SET streak=99 WHERE id=?').run(bad);
    await expect(submitScore(deps(),{game_id:bad,nickname:'하늘'})).rejects.toThrow('확인할 수');
  });
  it('concurrent retries insert one record and preserve original nickname',async()=>{
    const id=game(4),result=await Promise.all([1,2,3,4].map(n=>submitScore(deps(),{game_id:id,nickname:'별명'+n})));
    expect(new Set(result.map(x=>x.record.id)).size).toBe(1);expect((await listScores(deps())).records).toHaveLength(1);
    expect((await submitScore(deps(),{game_id:id,nickname:'바뀐이름'})).record.nickname).toBe(result[0].record.nickname);
  });
  it('excludes rapid suspicious runs but accepts a few lucky fast answers',async()=>{
    await expect(submitScore(deps(),{game_id:game(3,'mix',now,100),nickname:'차단왕'})).rejects.toThrow('응답 시간');
    await expect(submitScore(deps(),{game_id:game(5,'mix',now,300),nickname:'차단왕'})).rejects.toThrow('응답 시간');
    expect((await submitScore(deps(),{game_id:game(2,'mix',now,100),nickname:'행운왕'})).record.streak).toBe(2);
    expect(await estimateRank(deps(),game(3,'mix',now,100))).toMatchObject({eligible:false,overall_rank:null,weekly_rank:null});
  });
  it('top50 per topic, earlier score wins ties, estimates match final rank',async()=>{
    const first=game(3,'mix',now-1000),second=game(3,'mix',now);
    await submitScore(deps(),{game_id:second,nickname:'늦은왕'});
    expect((await estimateRank(deps(),first)).overall_rank).toBe(1);
    await submitScore(deps(),{game_id:first,nickname:'이른왕'});
    expect((await listScores(deps())).records.map(x=>x.nickname)).toEqual(['이른왕','늦은왕']);
    expect((await estimateRank(deps(),first)).overall_rank).toBe(1);
    for(let n=0;n<55;n++) await submitScore(deps(),{game_id:game(1),nickname:'도전자'+n});
    const list=await listScores(deps());expect(list.records).toHaveLength(50);expect(list.records.at(-1)?.rank).toBe(50);
    await expect(listScores(deps(),'invalid')).rejects.toThrow('주제');await expect(listScores(deps(),'mix','day')).rejects.toThrow('전체');
  });
  it('Monday00:00 KST boundary, old games cleanup preserves published scores',async()=>{
    const monday=now;expect(weekStartKst(monday)).toBe(monday);expect(weekStartKst(monday-1)).toBe(monday-7*86400000);
    const old=game(3,'mix',monday-1),fresh=game(2,'mix',monday);
    await submitScore(deps(),{game_id:old,nickname:'지난주'});await submitScore(deps(),{game_id:fresh,nickname:'이번주'});
    expect((await listScores(deps(),'mix','week')).records.map(x=>x.nickname)).toEqual(['이번주']);expect((await estimateRank(deps(),old)).weekly_rank).toBeNull();
    sql.prepare('DELETE FROM game_questions WHERE game_id=?').run(old);sql.prepare('DELETE FROM games WHERE id=?').run(old);
    expect((await listScores(deps())).records).toHaveLength(2);now+=7*86400000;expect((await listScores(deps(),'mix','week')).records).toHaveLength(0);
  });
  it('nickname format and abusive words including mixed case and digit insertion',()=>{
    for(const name of ['가','elevenchars11','홍 길동','<script>','♥하늘','씨발왕','시1발','FUCK왕','bItCh']) expect(()=>validateNickname(name)).toThrow();
    for(const name of ['지역왕','왕12','Hello12345','하늘']) expect(validateNickname(name)).toBe(name);
  });
});
describe('operator',()=>{
  it('paginates all operator records beyond fifty without gaps and validates the page',async()=>{
    const created:string[]=[];
    for(let n=0;n<57;n++){
      const score=await submitScore(deps(),{game_id:game(1,'mix',now+n),nickname:'도전자'+n});
      created.push(score.record.id);
    }
    const first=await adminStatus(deps()),second=await adminStatus(deps(),2),empty=await adminStatus(deps(),3);
    expect(first).toMatchObject({page:1,has_more:true,total_records:57});
    expect(second).toMatchObject({page:2,has_more:false,total_records:57});
    expect(first.records).toHaveLength(50);expect(second.records).toHaveLength(7);
    const ids=[...first.records,...second.records].map((row:any)=>row.id);
    expect(ids).toEqual([...created].reverse());expect(new Set(ids).size).toBe(57);
    expect(empty).toMatchObject({page:3,has_more:false,total_records:57});expect(empty.records).toHaveLength(0);
    for(const page of [0,-1,1.5,'invalid',100001]) await expect(adminStatus(deps(),page)).rejects.toMatchObject({status:400});
  });
  it('server-only secret, five-failure lock and15minute expiry',async()=>{
    await expect(authorizeAdmin(deps(),undefined,{password:'x'})).rejects.toThrow('설정');
    for(let n=0;n<5;n++) await expect(authorizeAdmin(deps(),'test-only',{password:'bad'})).rejects.toThrow('비밀번호');
    await expect(authorizeAdmin(deps(),'test-only',{password:'test-only'})).rejects.toMatchObject({status:429});
    expect(JSON.stringify(sql.prepare('SELECT * FROM admin_attempts').all())).not.toContain('test-only');now+=15*60000;
    await expect(authorizeAdmin(deps(),'test-only',{password:'test-only'})).resolves.toBeUndefined();
  });
  it('active metric dates/missing counts and immediate score deletion',async()=>{
    sql.exec("INSERT INTO regions(code,name,level,active) VALUES('11','서울','sido',1),('26','부산','sido',1)");
    sql.exec("INSERT INTO stat_meta VALUES('population','인구','명','행안부','2026-09','2026-10-16')");
    sql.exec("INSERT INTO stat_values VALUES('11','population',100,'명','2026-09','행안부','2026-10-16')");
    const score=await submitScore(deps(),{game_id:game(),nickname:'지역왕'}),status=await adminStatus(deps());
    expect(status.stats).toHaveLength(39);expect(status.stats.find(x=>x.key==='population')).toMatchObject({ref_date:'2026-09',fetched_at:'2026-10-16',regions:2,present:1,missing:1});
    expect(status.stats.find(x=>x.key==='area')).toMatchObject({ref_date:null,missing:2});expect(status.total_records).toBe(1);
    await deleteScore(deps(),{id:score.record.id});expect((await listScores(deps())).records).toHaveLength(0);
    await expect(deleteScore(deps(),{id:score.record.id})).rejects.toMatchObject({status:404});
    await expect(submitScore(deps(),{game_id:(sql.prepare('SELECT game_id FROM leaderboard WHERE id=?').get(score.record.id) as any).game_id,nickname:'다시등록'})).rejects.toMatchObject({status:409});
  });
});
