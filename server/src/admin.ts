import { GameError } from './game';
import { STATS } from './stats';
import {isNatureKey,natureMeta} from './nature';
import type { LeaderboardDeps } from './leaderboard';
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
async function equalSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [x,y] = await Promise.all([a,b].map(s=>crypto.subtle.digest('SHA-256',encoder.encode(s))));
  const aa=new Uint8Array(x),bb=new Uint8Array(y); let difference=0;
  for(let i=0;i<aa.length;i++) difference |= aa[i]^bb[i];
  return difference===0;
}
/** Passwords are accepted in POST bodies only; never put them in a URL or response. */
export async function authorizeAdmin(deps: LeaderboardDeps, secret: string | undefined, body: unknown): Promise<void> {
  if (!secret) throw new GameError(503, '운영자 비밀번호가 아직 설정되지 않았어요');
  const now=deps.now();
  await deps.db.prepare('DELETE FROM admin_attempts WHERE window_start<=?1').bind(now-WINDOW_MS).run();
  const attempts=await deps.db.prepare('SELECT attempts FROM admin_attempts WHERE singleton=1').first<{attempts:number}>();
  if ((attempts?.attempts ?? 0)>=MAX_FAILURES) throw new GameError(429,'비밀번호를 여러 번 틀렸어요. 15분 뒤에 다시 해 주세요');
  const password=(body as {password?:unknown}|null)?.password;
  if (typeof password==='string' && password.length<=1024 && await equalSecret(password,secret)) return;
  await deps.db.prepare(`INSERT INTO admin_attempts(singleton,window_start,attempts) VALUES(1,?1,1)
    ON CONFLICT(singleton) DO UPDATE SET attempts=attempts+1`).bind(now).run();
  throw new GameError(401,'운영자 비밀번호를 확인해 주세요');
}
export async function adminStatus(deps: LeaderboardDeps, pageInput: unknown = 1) {
  const page=Number(pageInput);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw new GameError(400,"목록 페이지가 올바르지 않아요");
  const regions=await deps.db.prepare('SELECT COUNT(*) n FROM regions WHERE active=1').first<{n:number}>();
  const metas=await deps.db.prepare(`SELECT stat_key,label,unit,source,latest_ref_date,updated_at FROM stat_meta ORDER BY stat_key`).all<{stat_key:string;label:string;unit:string;source:string;latest_ref_date:string|null;updated_at:string}>();
  const metadata=new Map((metas.results??[]).map(row=>[row.stat_key,row]));
  const stats=[];
  for (const [key,def] of Object.entries(STATS)) {
    if(def.topic==="cars")continue;
    if(isNatureKey(key)){stats.push(natureMeta(key));continue;}
    const meta=metadata.get(key);
    const counts=await deps.db.prepare(`SELECT COUNT(v.region_code) present,MAX(v.fetched_at) fetched_at FROM regions r
      LEFT JOIN stat_values v ON v.region_code=r.code AND v.stat_key=?1 AND v.ref_date=?2 WHERE r.active=1`)
      .bind(key,meta?.latest_ref_date??'').first<{present:number;fetched_at:string|null}>();
    stats.push({key,label:meta?.label??def.label,unit:meta?.unit??def.unit,source:meta?.source??null,
      ref_date:meta?.latest_ref_date??null,fetched_at:counts?.fetched_at??null,updated_at:meta?.updated_at??null,
      regions:regions?.n??0,present:counts?.present??0,missing:(regions?.n??0)-(counts?.present??0)});
  }
  const records=await deps.db.prepare('SELECT id,topic,nickname,streak,created_at FROM leaderboard WHERE removed=0 ORDER BY created_at DESC,id ASC LIMIT 50 OFFSET ?1').bind((page-1)*50).all();
  const total=await deps.db.prepare('SELECT COUNT(*) n FROM leaderboard WHERE removed=0').first<{n:number}>();
  return {stats,records:records.results??[],total_records:total?.n??0,page,has_more:page*50<(total?.n??0)};
}
export async function deleteScore(deps: LeaderboardDeps, body: unknown) {
  const id=(body as {id?:unknown}|null)?.id;
  if(typeof id!=='string'||!/^[0-9a-f]{32}$/.test(id)) throw new GameError(400,'기록 번호가 올바르지 않아요');
  const result=await deps.db.prepare("UPDATE leaderboard SET nickname='',removed=1 WHERE id=?1 AND removed=0").bind(id).run();
  if((result.meta?.changes??0)!==1) throw new GameError(404,'이미 지워졌거나 없는 기록이에요');
  return {deleted:true,id};
}
