// data/regions.json → data/regions.sql (D1 regions 표에 넣는 SQL). 이미 있으면 갱신, 목록에 없는 지역은 active=0.
import { readFileSync, writeFileSync } from "node:fs";

const q = (s) => (s === null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);

export function toSql(file) {
  const rs = file.regions;
  const lines = [
    `-- 자동 생성 (collector/src/to-sql.mjs). 출처: ${file.source}, 기준일 ${file.as_of}, 원본 받은 날 ${file.raw_downloaded_at}`,
  ];
  for (const r of rs) {
    lines.push(
      `INSERT INTO regions (code, name, level, parent_code, active, display_name) VALUES (${q(r.code)}, ${q(r.name)}, ${q(r.level)}, ${q(r.parent_code)}, 1, ${q(r.display_name)}) ` +
        `ON CONFLICT(code) DO UPDATE SET name=excluded.name, level=excluded.level, parent_code=excluded.parent_code, active=1, display_name=excluded.display_name;`,
    );
  }
  lines.push(`UPDATE regions SET active = 0 WHERE code NOT IN (${rs.map((r) => q(r.code)).join(", ")});`);
  return lines.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = JSON.parse(readFileSync(new URL("../../data/regions.json", import.meta.url), "utf-8"));
  writeFileSync(new URL("../../data/regions.sql", import.meta.url), toSql(file));
  console.log(`regions.sql 생성: ${file.regions.length}줄`);
}
