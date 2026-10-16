// KOSIS 오픈API 호출 도우미. 열쇠 값은 어디에도 출력하지 않는다(오류 문구에도 주소를 넣지 않는다).
import { readFileSync, existsSync, appendFileSync } from "node:fs";

const BASE = "https://kosis.kr/openapi/";

export class KosisError extends Error {}

// 환경변수에 열쇠가 없으면 프로젝트 루트 .env 에서 KOSIS_API_KEY 한 줄만 읽어 채운다.
export function loadKey(env = process.env, envFile = new URL("../../.env", import.meta.url)) {
  if (!env.KOSIS_API_KEY && existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf-8").split(/\r?\n/)) {
      const m = line.match(/^\s*KOSIS_API_KEY\s*=\s*(.*)$/);
      if (m) env.KOSIS_API_KEY = m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  const k = env.KOSIS_API_KEY;
  if (!k) throw new KosisError("통계청 열쇠(KOSIS_API_KEY)가 없어요. 프로젝트 맨 위 폴더의 .env 파일에 KOSIS_API_KEY=열쇠 한 줄을 적거나 환경변수로 지정해 주세요.");
  return k;
}

const ERR = {
  "10": "통계청 열쇠가 없거나 비어 있어요.",
  "11": "통계청 열쇠가 올바르지 않아요. 열쇠를 다시 확인해 주세요.",
  "12": "통계청 열쇠의 사용 기간이 끝났어요.",
  "20": "통계청에 보낸 요청 내용이 잘못됐어요(필수 값 누락).",
  "21": "통계청에 보낸 요청 내용이 잘못됐어요(항목 값 오류).",
  "30": "통계청에 해당 자료가 없어요.",
  "31": "통계청 응답이 너무 커서(4만 칸 초과) 받을 수 없어요. 나눠서 받아야 해요.",
  "40": "통계청 호출 한도를 넘었어요. 나중에 다시 해 주세요.",
  "41": "통계청 호출 한도를 넘었어요. 나중에 다시 해 주세요.",
  "42": "통계청 호출 한도를 넘었어요. 나중에 다시 해 주세요.",
  "50": "통계청 서버에 문제가 있어요. 나중에 다시 해 주세요.",
};

// 응답 본문(JSON)이 오류인지 검사해 한국어로 던진다.
export function checkResponse(body) {
  if (body && !Array.isArray(body) && typeof body === "object" && body.err !== undefined) {
    const code = String(body.err);
    throw new KosisError(ERR[code] ?? `통계청이 오류를 돌려줬어요(번호 ${code}).`);
  }
  if (!Array.isArray(body)) throw new KosisError("통계청 응답 모양이 예상과 달라요.");
  return body;
}

// path 예: "Param/statisticsParameterData.do". params에는 apiKey를 넣지 않는다.
export async function kosisGet(path, params, { key = loadKey(), fetchFn = fetch, callLog = process.env.KOSIS_CALL_LOG } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries({ method: "getList", format: "json", jsonVD: "Y", ...params })) url.searchParams.set(k, v);
  url.searchParams.set("apiKey", key);
  if (callLog) appendFileSync(callLog, `${new Date().toISOString()} ${path}\n`);
  let res;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(60000) });
  } catch {
    throw new KosisError("통계청에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.");
  }
  if (!res.ok) throw new KosisError(`통계청 서버가 오류를 돌려줬어요(상태 ${res.status}).`);
  let body;
  try {
    body = JSON.parse((await res.text()).replace(/^﻿/, ""));
  } catch {
    throw new KosisError("통계청 응답을 읽을 수 없어요.");
  }
  return checkResponse(body);
}
