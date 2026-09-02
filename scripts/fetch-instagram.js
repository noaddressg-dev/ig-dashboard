// scripts/fetch-instagram.js
// Instagram Graph API에서 계정 지표를 가져와 data/instagram-metrics.json에 누적 저장합니다.
// 필요한 환경변수: IG_ACCESS_TOKEN, IG_USER_ID (GitHub Secrets로 주입됨)

const fs = require("fs");
const path = require("path");

const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID;
const API_VERSION = "v22.0";
const DATA_FILE = path.join(__dirname, "..", "data", "instagram-metrics.json");

if (!ACCESS_TOKEN || !IG_USER_ID) {
  console.error("IG_ACCESS_TOKEN 또는 IG_USER_ID 환경변수가 없습니다.");
  process.exit(1);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(`Instagram API 오류: ${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

async function getProfile() {
  const url = `https://graph.instagram.com/${API_VERSION}/${IG_USER_ID}?fields=username,followers_count,media_count&access_token=${ACCESS_TOKEN}`;
  return fetchJson(url);
}

async function getAccountInsights() {
  const metrics = ["reach", "profile_views", "accounts_engaged", "website_clicks"];
  const url = `https://graph.instagram.com/${API_VERSION}/${IG_USER_ID}/insights?metric=${metrics.join(
    ","
  )}&period=day&metric_type=total_value&access_token=${ACCESS_TOKEN}`;
  return fetchJson(url);
}

function loadExistingData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn("기존 데이터 파일을 읽는 데 실패해서 새로 시작합니다:", e.message);
    return [];
  }
}

async function main() {
  console.log("인스타그램 데이터 수집 시작...");

  const profile = await getProfile();
  const insights = await getAccountInsights();

  const insightMap = {};
  for (const item of insights.data || []) {
    const value = item.total_value?.value ?? item.values?.[0]?.value ?? null;
    insightMap[item.name] = value;
  }

  const snapshot = {
    date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    collected_at: new Date().toISOString(),
    username: profile.username,
    followers_count: profile.followers_count,
    media_count: profile.media_count,
    reach: insightMap.reach ?? null,
    profile_views: insightMap.profile_views ?? null,
    accounts_engaged: insightMap.accounts_engaged ?? null,
    website_clicks: insightMap.website_clicks ?? null,
  };

  const existing = loadExistingData();

  // 같은 날짜 데이터가 이미 있으면 덮어쓰고, 없으면 새로 추가
  const filtered = existing.filter((d) => d.date !== snapshot.date);
  filtered.push(snapshot);
  filtered.sort((a, b) => a.date.localeCompare(b.date));

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(filtered, null, 2));

  console.log("저장 완료:", snapshot);
}

main().catch((err) => {
  console.error("수집 실패:", err.message);
  process.exit(1);
});
