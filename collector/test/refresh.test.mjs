import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { STAT_DEFS } from '../src/stats.mjs';
import { run, collect, validateBundle, shiftMonth, projectRoot } from '../src/refresh.mjs';
import { SETUP, ACTIVATE, toPayload, apply, createClient } from '../src/apply-refresh.mjs';
const read = p => JSON.parse(readFileSync(resolve(projectRoot, p), 'utf8'));
const regions = read('data/regions.json').regions;
const bundle = () => ({ stats: Object.fromEntries(Object.keys(STAT_DEFS).map(k => [k, read(`data/stats/${k}.json`)])), report: {} });

test('완성된 10가지 통계와 SQL을 별도 폴더에 저장하고 원본은 보존한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-refresh-'));
  const source = readFileSync(resolve(projectRoot, 'data/stats/all.sql'));
  try {
    const out = join(dir, 'candidate');
    await run({ out, collectFn: async () => bundle() });
    assert.equal(Object.keys(JSON.parse(readFileSync(join(out, 'bundle.json'))).stats).length, 10);
    assert.match(readFileSync(join(out, 'all.sql'), 'utf8'), /stat_meta/);
    assert.deepEqual(readFileSync(resolve(projectRoot, 'data/stats/all.sql')), source);
  } finally { rmSync(dir, { recursive: true }); }
});
test('수집 실패와 일부 통계 누락은 기존 파일/SQL을 바꾸거나 후보를 만들지 않는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-refresh-'));
  const sql = readFileSync(resolve(projectRoot, 'data/stats/all.sql'));
  try {
    const out = join(dir, 'candidate');
    await assert.rejects(run({ out, collectFn: async () => { throw new Error('offline'); } }));
    assert.equal(existsSync(out), false);
    const partial = bundle(); delete partial.stats.cars;
    await assert.rejects(run({ out, collectFn: async () => partial }), /10가지/);
    assert.equal(existsSync(out), false);
    assert.deepEqual(readFileSync(resolve(projectRoot, 'data/stats/all.sql')), sql);
    writeFileSync(join(dir, 'sentinel'), 'unchanged');
    await assert.rejects(run({ out: dir, collectFn: async () => bundle() }), /빈 저장 경로/);
    assert.equal(readFileSync(join(dir, 'sentinel'), 'utf8'), 'unchanged');
  } finally { rmSync(dir, { recursive: true }); }
});
test('값 누락·중복·외부 지역·오래된 기준일·지역 급감 거부', () => {
  const good = bundle(); assert.doesNotThrow(() => validateBundle(good.stats, regions));
  for (const kind of ['nan', 'duplicate', 'code', 'stale', 'coverage']) {
    const b = bundle(), s = b.stats.population;
    if (kind === 'nan') s.values[0].value = NaN;
    if (kind === 'duplicate') s.values[1].region_code = s.values[0].region_code;
    if (kind === 'code') s.values[0].region_code = '99999';
    if (kind === 'stale') s.ref_date = '2000-01';
    if (kind === 'coverage') s.values = s.values.slice(0, 10);
    assert.throws(() => validateBundle(b.stats, regions, good.stats));
  }
});
test('최신 공통월 선택: 게시 시차가 있으면 더 늦은 표만 공통월로 다시 요청한다', async () => {
  const calls = [];
  await assert.rejects(collect({ now: new Date('2027-03-20'), get: async (_path, p) => {
    calls.push(p);
    if (p.startPrdDe) throw new Error('exact month requested');
    return [{ PRD_DE: p.tblId === 'DT_1B040B3' ? '202701' : '202702' }];
  } }), /exact month requested/);
  assert.equal(calls.length, 4);
  assert.equal(calls[3].startPrdDe, '202701');
  assert.equal(shiftMonth('2027-01', -60), '2022-01');
  assert.equal(shiftMonth('2027-01', -1), '2026-12');
});
test('D1 적용 전 검증 실패는 원격 호출조차 하지 않는다', async () => {
  const b = bundle(); delete b.stats.population;
  let called = 0;
  await assert.rejects(apply(b, async () => { called++; }));
  assert.equal(called, 0);
});
test('Cloudflare 오류/통신 예외에 토큰·응답 본문·주소가 노출되지 않는다', async () => {
  for (const fetchFn of [async () => { throw new Error('SECRET_TOKEN request-url'); }, async () => ({ ok: false, json: async () => ({ success: false, errors: ['SECRET_TOKEN'] }) })]) {
    const client = createClient({ token: 'SECRET_TOKEN', account: 'ACCOUNT_PRIVATE', database: 'DB_PRIVATE', fetchFn });
    await assert.rejects(client('SELECT 1'), e => !/SECRET_TOKEN|ACCOUNT_PRIVATE|DB_PRIVATE|request-url/.test(e.message));
  }
});
test('실제 SQLite: 성공 시 10가지 모두 교체, 활성화 중 실패하면 값·기준일 전부 복구', () => {
  const p = toPayload(bundle());
  const py = `
import sqlite3,json,sys
x=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.execute('CREATE TABLE regions(code TEXT PRIMARY KEY)')
db.executemany('INSERT INTO regions VALUES (?)',[(c,) for c in x['codes']])
db.execute('CREATE TABLE stat_values(region_code TEXT REFERENCES regions(code),stat_key TEXT,value REAL NOT NULL,unit TEXT,ref_date TEXT,source TEXT,fetched_at TEXT,PRIMARY KEY(region_code,stat_key,ref_date))')
db.execute('CREATE TABLE stat_meta(stat_key TEXT PRIMARY KEY,label TEXT,unit TEXT,source TEXT,latest_ref_date TEXT,updated_at TEXT)')
for sql in x['setup']: db.execute(sql)
payload=x['payload']
db.execute('INSERT INTO refresh_stage_v1 VALUES (?,?)',('good',json.dumps(payload)))
db.execute(x['activate'],('good','now'))
assert db.execute('SELECT count(*) FROM stat_meta').fetchone()[0]==10
assert db.execute('SELECT count(*) FROM stat_values').fetchone()[0]==len(payload['values'])
before=list(db.execute('SELECT * FROM stat_values ORDER BY 1,2,5'))
meta=list(db.execute('SELECT * FROM stat_meta ORDER BY 1'))
payload['values'][-1]['region_code']='DOES_NOT_EXIST'
db.execute('INSERT INTO refresh_stage_v1 VALUES (?,?)',('bad',json.dumps(payload)))
try: db.execute(x['activate'],('bad','now'))
except sqlite3.IntegrityError: pass
else: raise AssertionError('activation must fail')
assert list(db.execute('SELECT * FROM stat_values ORDER BY 1,2,5'))==before
assert list(db.execute('SELECT * FROM stat_meta ORDER BY 1'))==meta
assert db.execute("SELECT count(*) FROM refresh_activate_v1 WHERE id='bad'").fetchone()[0]==0
# Regressed dates rejected inside activation too, covering races between client check and activation.
payload['values'][-1]['region_code']=x['codes'][0]
payload['meta'][0]['latest_ref_date']='2000-01'
db.execute('INSERT INTO refresh_stage_v1 VALUES (?,?)',('old',json.dumps(payload)))
try: db.execute(x['activate'],('old','now'))
except sqlite3.IntegrityError: pass
else: raise AssertionError('old activation must fail')
assert list(db.execute('SELECT * FROM stat_values ORDER BY 1,2,5'))==before
print('atomic refresh verified')
`;
  const result = spawnSync('python3', ['-c', py], { input: JSON.stringify({ setup: SETUP, activate: ACTIVATE, payload: p, codes: regions.map(r => r.code) }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /atomic refresh verified/);
  assert.ok(Buffer.byteLength(JSON.stringify(p)) < 1_000_000, 'D1 cell size bound');
});
