// D1 administrative REST API only. No game/admin endpoint or secret is exposed to browsers.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { KosisError } from './kosis.mjs';
import { projectRoot, validateBundle } from './refresh.mjs';

// All visible changes run inside ONE SQLite statement via this trigger. A statement failure
// rolls back its deletes/inserts together; staging uploads cannot affect live game data.
export const SETUP = [
  `CREATE TABLE IF NOT EXISTS refresh_stage_v1 (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)))`,
  `CREATE TABLE IF NOT EXISTS refresh_activate_v1 (id TEXT PRIMARY KEY REFERENCES refresh_stage_v1(id), activated_at TEXT NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS refresh_activate_v1_apply AFTER INSERT ON refresh_activate_v1 BEGIN
    SELECT CASE WHEN (SELECT json_array_length(json_extract(payload,'$.meta')) FROM refresh_stage_v1 WHERE id=NEW.id) != 10 THEN RAISE(ABORT,'incomplete refresh') END;
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM stat_meta old JOIN refresh_stage_v1 s ON s.id=NEW.id, json_each(s.payload,'$.meta') j
      WHERE old.stat_key=json_extract(j.value,'$.stat_key') AND old.latest_ref_date > json_extract(j.value,'$.latest_ref_date')
    ) THEN RAISE(ABORT,'older refresh') END;
    DELETE FROM stat_values WHERE stat_key IN (SELECT json_extract(j.value,'$.stat_key') FROM refresh_stage_v1 s, json_each(s.payload,'$.meta') j WHERE s.id=NEW.id);
    INSERT INTO stat_values (region_code,stat_key,value,unit,ref_date,source,fetched_at)
      SELECT json_extract(j.value,'$.region_code'),json_extract(j.value,'$.stat_key'),json_extract(j.value,'$.value'),json_extract(j.value,'$.unit'),json_extract(j.value,'$.ref_date'),json_extract(j.value,'$.source'),json_extract(j.value,'$.fetched_at')
      FROM refresh_stage_v1 s, json_each(s.payload,'$.values') j WHERE s.id=NEW.id;
    INSERT OR REPLACE INTO stat_meta (stat_key,label,unit,source,latest_ref_date,updated_at)
      SELECT json_extract(j.value,'$.stat_key'),json_extract(j.value,'$.label'),json_extract(j.value,'$.unit'),json_extract(j.value,'$.source'),json_extract(j.value,'$.latest_ref_date'),json_extract(j.value,'$.updated_at')
      FROM refresh_stage_v1 s, json_each(s.payload,'$.meta') j WHERE s.id=NEW.id;
  END`
];
export const ACTIVATE = 'INSERT INTO refresh_activate_v1(id,activated_at) VALUES (?,?)';
export function toPayload(bundle) {
  const meta = [], values = [];
  for (const s of Object.values(bundle.stats)) {
    meta.push({ stat_key: s.stat_key, label: s.label, unit: s.unit, source: s.source, latest_ref_date: s.ref_date, updated_at: s.fetched_at });
    for (const v of s.values.filter(v => !v.quiz_exclude)) values.push({ region_code: v.region_code, stat_key: s.stat_key, value: v.value, unit: s.unit, source: s.source, ref_date: s.ref_date, fetched_at: s.fetched_at });
  }
  return { meta, values };
}
export function createClient({ account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN, database, fetchFn = fetch } = {}) {
  if (!account || !token || !database) throw new KosisError('Cloudflare 계정·토큰·데이터베이스 설정이 필요해요.');
  return async (sql, params = []) => {
    try {
      const response = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(database)}/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(60000) });
      const body = await response.json();
      if (!response.ok || !body.success || !Array.isArray(body.result) || body.result.some(r => !r.success)) throw new Error();
      return body.result;
    } catch { throw new KosisError('Cloudflare 자료 적용을 확인하지 못했어요. 비밀값이나 응답 본문은 기록하지 않았어요. 운영자 화면에서 기준일을 확인해 주세요.'); }
  };
}
export async function apply(bundle, query, { regions = JSON.parse(readFileSync(resolve(projectRoot, 'data/regions.json'), 'utf8')).regions } = {}) {
  validateBundle(bundle.stats, regions);
  const payload = toPayload(bundle), id = randomUUID();
  const live = await query('SELECT stat_key,latest_ref_date FROM stat_meta');
  for (const row of live[0].results ?? []) {
    if (bundle.stats[row.stat_key] && row.latest_ref_date > bundle.stats[row.stat_key].ref_date) throw new KosisError('운영 자료보다 오래된 자료는 적용하지 않았어요.');
  }
  for (const sql of SETUP) await query(sql);
  await query('INSERT INTO refresh_stage_v1(id,payload) VALUES (?,?)', [id, JSON.stringify(payload)]);
  await query(ACTIVATE, [id, new Date().toISOString()]); // sole live-data mutation, atomic even if another statement failed before it
  const rows = (await query('SELECT stat_key,latest_ref_date FROM stat_meta'))[0].results;
  for (const s of Object.values(bundle.stats)) if (!rows.some(r => r.stat_key === s.stat_key && r.latest_ref_date === s.ref_date)) throw new KosisError('적용 후 기준일 확인이 필요해요.');
  // Keep only the newest activated staging record; no user or game data is staged.
  await query('DELETE FROM refresh_activate_v1 WHERE id != ?', [id]);
  await query('DELETE FROM refresh_stage_v1 WHERE id != ?', [id]);
  return { stats: payload.meta.length, values: payload.values.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new KosisError('검증된 bundle.json 파일을 지정해 주세요.');
    const config = readFileSync(resolve(projectRoot, 'server/wrangler.toml'), 'utf8');
    const database = config.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
    const result = await apply(JSON.parse(readFileSync(process.argv[2], 'utf8')), createClient({ database }));
    console.log(`운영 자료 적용·확인 완료: 통계 ${result.stats}가지 · ${result.values}개 값`);
  } catch (e) { console.error(e instanceof KosisError ? e.message : '자료 적용 중 문제가 생겼어요. 운영자 화면에서 자료 상태를 확인해 주세요.'); process.exitCode = 1; }
}
