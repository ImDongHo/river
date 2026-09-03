/**
 * 실제 HRFCO 값을 받아와 data/readings.json에 저장하는 스크립트.
 * 브라우저에서 실행되지 않습니다 — Node.js로 로컬(또는 나중에 GitHub Actions)에서만 실행합니다.
 *
 * ⚠ 서비스키(authKey)는 절대 이 파일 안에 직접 쓰지 마세요.
 *    반드시 환경변수로 넘겨서 실행하세요:
 *
 *    HRFCO_AUTH_KEY=발급받은키값 node scripts/fetch-and-store.mjs
 *
 * 이렇게 하면 키가 이 파일에도, 터미널 기록 이외에는 어디에도 남지 않습니다.
 * Node 18 이상 필요 (전역 fetch 사용).
 */

import fs from "node:fs/promises";
import path from "node:path";

const AUTH_KEY = process.env.HRFCO_AUTH_KEY;
if (!AUTH_KEY) {
  console.error("❌ 환경변수 HRFCO_AUTH_KEY가 없습니다.");
  console.error("   실행 예: HRFCO_AUTH_KEY=발급받은키값 node scripts/fetch-and-store.mjs");
  process.exit(1);
}

// 지금까지 확정한 관측소들. 신천·금호강 코드는 아직 실호출로 검증 전이니
// 처음 실행할 때 에러가 나면 이 코드가 틀렸을 수 있습니다 — 확인 후 수정하세요.
const STATIONS = {
  station1: "2012695", // 낙동강 · 강창교 (실제 응답 검증됨)
  station2: "2012667", // 신천 · 수성교 (아직 미검증)
  station3: "2012672"  // 금호강 · 운암교 (아직 미검증)
};

// ⚠ 아래 URL 형식은 이전에 성공했던 호출을 기준으로 한 추정치입니다.
//   실제로 여러분이 테스트해서 성공했던 정확한 URL 형식과 다르면 이 줄만 고치면 됩니다.
function buildLiveUrl(wlobscd) {
  return `https://api.hrfco.go.kr/${AUTH_KEY}/waterlevel/list/10M/${wlobscd}.json`;
}

// 화면·저장 파일에는 이 키 없는 버전만 남습니다 (C11 대비).
function buildPublicSourceUrl(wlobscd) {
  return `https://api.hrfco.go.kr/waterlevel/list/10M/${wlobscd}`;
}

function kstPartsFromYmdhm(ymdhm) {
  return {
    y: ymdhm.slice(0, 4), mo: ymdhm.slice(4, 6), d: ymdhm.slice(6, 8),
    h: ymdhm.slice(8, 10), mi: ymdhm.slice(10, 12)
  };
}

// index.html의 normalize()와 완전히 동일한 로직입니다. 서로 다르게 고치지 마세요.
function normalize(raw) {
  const p = kstPartsFromYmdhm(raw.ymdhm);
  return {
    signal_id: `hrfco-${raw.wlobscd}`,
    normalized_value: parseFloat(raw.wl),
    unit: "m",
    source_name: "한강홍수통제소",
    source_url: buildPublicSourceUrl(raw.wlobscd),
    source_time: `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}:00+09:00`,
    fetched_at: new Date().toISOString(),
    record_timezone: "Asia/Seoul",
    record_date: `${p.y}-${p.mo}-${p.d}`
  };
}

async function fetchOne(wlobscd) {
  const res = await fetch(buildLiveUrl(wlobscd));
  if (!res.ok) {
    throw new Error(`${wlobscd} 호출 실패: HTTP ${res.status}`);
  }
  const json = await res.json();
  const raw = json.content?.[0];
  if (!raw) throw new Error(`${wlobscd} 응답에 content가 없습니다: ${JSON.stringify(json)}`);
  return raw;
}

async function main() {
  const dataPath = path.join(process.cwd(), "data", "readings.json");
  const dailyDir = path.join(process.cwd(), "data", "daily");

  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(dataPath, "utf-8"));
  } catch {
    existing = []; // 파일이 아직 없으면 새로 시작
  }

  const results = [];
  for (const [id, wlobscd] of Object.entries(STATIONS)) {
    try {
      const raw = await fetchOne(wlobscd);
      const reading = normalize(raw);
      results.push(reading);
      console.log(`✅ ${id} (${wlobscd}): ${reading.normalized_value}${reading.unit} @ ${reading.record_date}`);
    } catch (e) {
      console.error(`❌ ${id} (${wlobscd}): ${e.message}`);
    }
  }

  // upsert: 같은 signal_id + record_date면 갱신(C20), 다르면 새로 추가(C21)
  let merged = [...existing];
  for (const reading of results) {
    const idx = merged.findIndex(
      r => r.signal_id === reading.signal_id && r.record_date === reading.record_date
    );
    if (idx >= 0) merged[idx] = reading;
    else merged.push(reading);
  }

  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  // 날짜별 스냅샷도 같이 남긴다: data/daily/2026-09-02.json
  // "이 날짜엔 이 값 그대로였다"를 파일명만 보고 바로 찾을 수 있게 하기 위함.
  // record_date가 같은 결과가 여러 개면 그 날짜 파일 안에 관측소별로 upsert된다.
  await fs.mkdir(dailyDir, { recursive: true });
  const byDate = {};
  for (const reading of results) {
    if (!byDate[reading.record_date]) byDate[reading.record_date] = [];
    byDate[reading.record_date].push(reading);
  }
  for (const [date, readingsForDate] of Object.entries(byDate)) {
    const dailyPath = path.join(dailyDir, `${date}.json`);
    let existingDaily = [];
    try {
      existingDaily = JSON.parse(await fs.readFile(dailyPath, "utf-8"));
    } catch {
      existingDaily = [];
    }
    let mergedDaily = [...existingDaily];
    for (const reading of readingsForDate) {
      const idx = mergedDaily.findIndex(r => r.signal_id === reading.signal_id);
      if (idx >= 0) mergedDaily[idx] = reading;
      else mergedDaily.push(reading);
    }
    await fs.writeFile(dailyPath, JSON.stringify(mergedDaily, null, 2) + "\n", "utf-8");
    console.log(`📁 날짜별 스냅샷 저장: data/daily/${date}.json (${mergedDaily.length}건)`);
  }

  console.log(`\n📁 저장 완료: ${dataPath} (총 ${merged.length}건)`);
}

main();
