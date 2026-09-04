// scripts/fetch-ad-spend.js
// Marketing API에서 최근 30일 광고 지출을 가져와서, 각 광고의 크리에이티브에 있는
// source_instagram_media_id로 오가닉 게시물과 매칭한 뒤, data/instagram-posts.json에
// ad_spend 필드를 추가/갱신합니다.
//
// 필요한 환경변수: FB_ADS_TOKEN, FB_AD_ACCOUNT_ID (예: 3724506861106818, "act_" 접두어 없이)

const fs = require("fs");
const path = require("path");

const ACCESS_TOKEN = process.env.FB_ADS_TOKEN;
const AD_ACCOUNT_ID = process.env.FB_AD_ACCOUNT_ID;
const API_VERSION = "v22.0";
const POSTS_FILE = path.join(__dirname, "..", "data", "instagram-posts.json");

if (!ACCESS_TOKEN || !AD_ACCOUNT_ID) {
  console.error("FB_ADS_TOKEN 또는 FB_AD_ACCOUNT_ID 환경변수가 없습니다.");
  process.exit(1);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(`Marketing API 오류: ${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

// 페이지네이션을 따라가며 모든 데이터를 모읍니다.
async function fetchAllPages(url) {
  const results = [];
  let next = url;
  let page = 0;
  while (next && page < 20) {
    const json = await fetchJson(next);
    results.push(...(json.data || []));
    next = json.paging?.next || null;
    page++;
  }
  return results;
}

// 1. 최근 30일 광고별 지출 가져오기
async function getAdSpend() {
  const url = `https://graph.facebook.com/${API_VERSION}/act_${AD_ACCOUNT_ID}/insights?level=ad&fields=ad_id,spend&date_preset=last_30d&limit=200&access_token=${ACCESS_TOKEN}`;
  const rows = await fetchAllPages(url);
  const spendByAdId = {};
  for (const row of rows) {
    spendByAdId[row.ad_id] = parseFloat(row.spend || "0");
  }
  return spendByAdId;
}

// 2. 각 광고가 어느 오가닉 게시물을 부스트한 건지 확인 (source_instagram_media_id)
async function getAdToMediaMap() {
  const url = `https://graph.facebook.com/${API_VERSION}/act_${AD_ACCOUNT_ID}/ads?fields=id,creative{source_instagram_media_id}&limit=200&access_token=${ACCESS_TOKEN}`;
  const rows = await fetchAllPages(url);
  const map = {};
  for (const ad of rows) {
    const mediaId = ad.creative?.source_instagram_media_id;
    if (mediaId) map[ad.id] = mediaId;
  }
  return map;
}

// 3. 계정 통화 확인 (표시용)
async function getCurrency() {
  const url = `https://graph.facebook.com/${API_VERSION}/act_${AD_ACCOUNT_ID}?fields=currency&access_token=${ACCESS_TOKEN}`;
  const json = await fetchJson(url);
  return json.currency;
}

async function main() {
  console.log("광고 지출 수집 시작...");

  const [spendByAdId, adToMedia, currency] = await Promise.all([
    getAdSpend(),
    getAdToMediaMap(),
    getCurrency(),
  ]);

  // 게시물(media) ID 기준으로 지출 합산 (한 게시물이 여러 광고에 쓰였을 수 있음)
  const spendByMediaId = {};
  for (const [adId, spend] of Object.entries(spendByAdId)) {
    const mediaId = adToMedia[adId];
    if (!mediaId) continue; // 이 광고는 오가닉 게시물을 부스트한 게 아님 (신규 제작 광고)
    spendByMediaId[mediaId] = (spendByMediaId[mediaId] || 0) + spend;
  }

  console.log(`${Object.keys(spendByMediaId).length}개 게시물에 매칭된 광고 지출 발견 (통화: ${currency})`);

  if (!fs.existsSync(POSTS_FILE)) {
    console.error("data/instagram-posts.json이 없습니다. fetch-instagram-posts.js를 먼저 실행하세요.");
    process.exit(1);
  }

  const posts = JSON.parse(fs.readFileSync(POSTS_FILE, "utf-8"));
  const updated = posts.map((post) => ({
    ...post,
    ad_spend: spendByMediaId[post.id] ?? 0,
    ad_spend_currency: currency,
  }));

  fs.writeFileSync(POSTS_FILE, JSON.stringify(updated, null, 2));
  console.log("저장 완료: instagram-posts.json에 ad_spend 반영됨");
}

main().catch((err) => {
  console.error("수집 실패:", err.message);
  process.exit(1);
});
