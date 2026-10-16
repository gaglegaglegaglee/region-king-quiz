// 행정표준코드관리시스템(code.go.kr)의 "법정동코드 목록 조회" 화면에서 자료를 받아,
// 시·도 / 시·군·구 단계(코드 끝 5자리가 0)의 줄만 data/raw/legal-dong-sigungu.tsv 로 저장한다.
// (읍·면·동·리 줄은 이 게임에 필요 없어 버린다.)  사용법: npm run download-raw
import { writeFileSync, readFileSync } from "node:fs";

const URL_ = "https://www.code.go.kr/stdcode/regCodeL.do";
const PAGE = 100;
const OUT = new URL("../../data/raw/legal-dong-sigungu.tsv", import.meta.url);

async function page(n) {
  const body = new URLSearchParams({
    cPage: String(n), pageSize: String(PAGE), disuseAt: "ALL", regionCd: "", locataddNm: "",
    sidoCd: "*", sggCd: "*", umdCd: "*", riCd: "*", searchOk: "0", codeseId: "00002",
    chkHigh: "0", chkCrtDt: "0", chkClsDt: "0", chkLocatDt: "0", chkLow: "0",
  });
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(URL_, { method: "POST", body, signal: AbortSignal.timeout(40000) });
      if (r.ok) return await r.text();
    } catch {}
    await new Promise((r) => setTimeout(r, 1500 * t));
  }
  throw new Error(`${n}쪽을 받지 못했어요. 잠시 뒤 다시 해 주세요.`);
}

export function parseRows(html) {
  const rows = [];
  for (const tr of html.split("<tr>").slice(1)) {
    const tds = [...tr.matchAll(/<td class="table_(?:left|center01|center01_11)">([^<]*)<\/td>/g)].map((m) =>
      m[1].replace(/&nbsp;?/g, "").trim());
    if (tds.length >= 7 && /^\d{10}$/.test(tds[0])) rows.push(tds.slice(0, 7));
  }
  return rows;
}

const first = await page(1);
const last = Math.max(...[...first.matchAll(/func_move\((\d+)\)/g)].map((m) => Number(m[1])));
const kept = [];
let total = 0;
for (let n = 1; n <= last; n++) {
  if (n > 1) await new Promise((r) => setTimeout(r, 300)); // 사이트에 부담을 주지 않도록 쪽 사이 0.3초 쉼
  const rows = parseRows(n === 1 ? first : await page(n));
  total += rows.length;
  for (const r of rows) if (r[0].endsWith("00000")) kept.push(r);
  if (n % 20 === 0) console.log(`${n}/${last}쪽`);
}
if (total < 15000) throw new Error(`받은 줄 수(${total})가 너무 적어요. 저장하지 않았어요.`);
kept.sort((a, b) => a[0].localeCompare(b[0]));
const header = ["code", "name", "parent_code", "created", "closed", "last_work", "lowest_name"].join("\t");
writeFileSync(OUT, [header, ...kept.map((r) => r.join("\t"))].join("\n") + "\n");
console.log(`전체 ${total}줄 중 시·도/시·군·구 단계 ${kept.length}줄 저장. 받은 날: ${new Date().toISOString().slice(0, 10)}`);

// 받은 날짜를 SOURCE.json에 기록
const srcPath = new URL("../../data/raw/SOURCE.json", import.meta.url);
const src = JSON.parse(readFileSync(srcPath, "utf-8"));
src.downloaded_at = new Date().toISOString().slice(0, 10);
writeFileSync(srcPath, JSON.stringify(src, null, 2) + "\n");
