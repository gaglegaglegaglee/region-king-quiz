// Scheduled refresh never writes the checked-in data/ directory. Build and validate all ten stats first.
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kosisGet, KosisError } from './kosis.mjs';
import { pickRows, matchRegions, validate, buildPopulationFile, toStatSql } from './population.mjs';
import { TABLES, STAT_DEFS, codeRows, ageRows, areaRows, carsRows, buildAllStats } from './stats.mjs';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = p => JSON.parse(readFileSync(p, 'utf8'));
export const shiftMonth = (ym, amount) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new KosisError('통계 기준월이 올바르지 않아요.');
  const [y, m] = ym.split('-').map(Number), t = y * 12 + m - 1 + amount;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
};
const monthOf = rows => {
  const months = [...new Set(rows.map(r => r.PRD_DE))];
  if (months.length !== 1 || !/^\d{4}(0[1-9]|1[0-2])$/.test(months[0])) throw new KosisError('통계 응답의 기준월이 올바르지 않아요.');
  return months[0].slice(0, 4) + '-' + months[0].slice(4);
};
export function validateBundle(stats, regions, baseline = {}) {
  if (Object.keys(stats).length !== 10) throw new KosisError('통계 10가지가 모두 있어야 해요.');
  const codes = new Set(regions.map(r => r.code));
  for (const key of Object.keys(STAT_DEFS)) {
    const s = stats[key], seen = new Set();
    if (!s || s.stat_key !== key || !s.source || !s.fetched_at || !s.unit || !/^\d{4}-\d{2}(-\d{2})?$/.test(s.ref_date)) throw new KosisError('통계 설명이나 기준일이 비어 있어요.');
    if (!Array.isArray(s.values) || s.values.length < regions.length * .95) throw new KosisError('새 자료의 지역 수가 너무 적어요.');
    for (const v of s.values) {
      if (!codes.has(v.region_code) || seen.has(v.region_code) || !Number.isFinite(v.value)) throw new KosisError('통계 지역 코드나 값이 올바르지 않아요.');
      seen.add(v.region_code);
    }
    const old = baseline[key];
    if (old && (s.ref_date < old.ref_date || s.values.length < old.values.length * .95)) throw new KosisError('이전 자료보다 기준일이 오래되었거나 지역 수가 크게 줄었어요.');
    if (s.values.filter(v => !v.quiz_exclude).length < regions.length * .9) throw new KosisError('문제로 사용할 수 있는 지역이 너무 적어요.');
  }
  return stats;
}
export async function collect({ get = kosisGet, regionsFile = read(resolve(projectRoot, 'data/regions.json')), baseline = {}, now = new Date() } = {}) {
  let calls = 0;
  const request = (table, extra = {}) => {
    if (++calls > 12) throw new KosisError('이번 갱신의 호출 상한(12회)을 넘었어요.');
    return get('Param/statisticsParameterData.do', { orgId: TABLES[table].orgId, tblId: TABLES[table].tblId, itmId: TABLES[table].itmId, objL1: 'ALL', ...(table === 'age' || table === 'area' || table === 'cars' ? { objL2: 'ALL' } : {}), ...(table === 'cars' ? { objL3: 'ALL' } : {}), prdSe: table === 'area' ? 'Y' : 'M', ...extra });
  };
  const latest = {};
  for (const k of ['population', 'age', 'households']) latest[k] = await request(k, { newEstPrdCnt: '1' });
  // Publication times differ: use the latest month that all three have published, then fetch that exact month.
  const ref = ['population', 'age', 'households'].map(k => monthOf(latest[k])).sort()[0];
  const current = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(now);
  if (ref >= current) throw new KosisError('완결된 월 자료가 없거나 지역 목록의 기준월보다 오래된 자료예요.');
  const exact = ym => ({ startPrdDe: ym.replace('-', ''), endPrdDe: ym.replace('-', '') });
  for (const k of Object.keys(latest)) if (monthOf(latest[k]) !== ref) latest[k] = await request(k, exact(ref));
  const picked = pickRows(latest.population), matched = matchRegions(regionsFile.regions, picked.rows);
  const summary = validate(regionsFile.regions, picked, matched), fetchedAt = now.toISOString();
  const population = buildPopulationFile({ regionsFile, picked, matched, summary, fetchedAt });
  const cars = carsRows(await request('cars', { newEstPrdCnt: '1' }));
  if (cars.ref_date >= current) throw new KosisError('자동차 자료와 지역 목록의 기준월이 맞지 않아요.');
  const oldMonth = shiftMonth(ref, -60);
  const oldPop = codeRows(await request('population', exact(oldMonth)), TABLES.population.itmId);
  if (oldPop.ref_date !== oldMonth) throw new KosisError('5년 전 같은 달의 자료가 아니에요.');
  const raw = { population, cars, oldPop, age: ageRows(latest.age), households: codeRows(latest.households, TABLES.households.itmId), area: areaRows(await request('area', { newEstPrdCnt: '1' })), popCars: cars.ref_date === ref ? codeRows(latest.population, TABLES.population.itmId) : codeRows(await request('population', exact(cars.ref_date)), TABLES.population.itmId) };
  if (raw.area.ref_date >= `${current}-01`) throw new KosisError('아직 완료되지 않은 연도 면적 자료예요.');
  const built = buildAllStats(regionsFile.regions, raw);
  const stats = { population, ...Object.fromEntries(Object.entries(built.stats).map(([k, s]) => [k, { ...s, fetched_at: fetchedAt, regions_as_of: regionsFile.as_of }])) };
  validateBundle(stats, regionsFile.regions, baseline);
  return { stats, report: { fetched_at: fetchedAt, calls, regions_as_of: regionsFile.as_of, ...built.report } };
}
export async function run({ out, collectFn = collect } = {}) {
  if (!out) throw new KosisError('새 자료를 저장할 별도 폴더(--out)를 지정해 주세요.');
  const target = resolve(out), data = resolve(projectRoot, 'data');
  if (target === data || target.startsWith(data + '/') || existsSync(target)) throw new KosisError('기존 자료와 다른 빈 저장 경로를 지정해 주세요.');
  const baseline = Object.fromEntries(Object.keys(STAT_DEFS).map(k => [k, read(resolve(data, `stats/${k}.json`))]));
  const bundle = await collectFn({ baseline }); // no file changes until the entire collection passes
  const regions = read(resolve(data, 'regions.json')).regions;
  validateBundle(bundle.stats, regions, baseline);
  const temp = target + `.tmp-${process.pid}`;
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(temp);
  try {
    writeFileSync(resolve(temp, 'bundle.json'), JSON.stringify(bundle));
    const sql = Object.values(bundle.stats).map(s => toStatSql({ ...s, values: s.values.filter(v => !v.quiz_exclude) })).join('');
    writeFileSync(resolve(temp, 'all.sql'), sql);
    renameSync(temp, target);
  } catch (error) { rmSync(temp, { recursive: true, force: true }); throw error; }
  return bundle;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--out'), result = await run({ out: i < 0 ? null : process.argv[i + 1] });
    console.log(`10가지 통계 검증 완료 · 인구 ${result.stats.population.ref_date} · 호출 ${result.report.calls}회`);
  } catch (e) { console.error(e instanceof KosisError ? e.message : '자료 갱신 중 문제가 생겼어요. 기존 자료는 바꾸지 않았어요.'); process.exitCode = 1; }
}
