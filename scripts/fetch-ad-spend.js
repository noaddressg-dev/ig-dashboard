// scripts/fetch-ad-spend.js
// Marketing API에서 최근 30일 광고 지출/예산/집행기간을 가져와서, 각 광고의 크리에이티브에 있는
// source_instagram_media_id로 오가닉 게시물과 매칭한 뒤, data/instagram-posts.json에
// ad_spend / ad_budget / ad_period_start / ad_period_end 필드를 추가/갱신합니다.
//
// 필요한 환경변수: FB_ADS_TOKEN, FB_AD_ACCOUNT_ID (예: 3724506861106818, "act_" 접두어 없이)
//
// 참고: 예산(budget)은 광고그룹(adset) 단위로 설정돼서, 한 게시물이 여러 광고에 걸쳐 있으면
// 그 게시물과 연결된 광고그룹들의 예산을 합산해서 보여줍니다 (참고용 수치). 실제로 얼마 썼는지는
// ad_spend(지출액)가 훨씬 정확해요.

const fs = require("fs");
const path = require("path");

const ACCESS_TOKEN = process.env.FB_ADS_TOKEN;
const AD_ACCOUNT_ID = process.env.FB_AD_ACCOUNT_ID;
const API_VERSION = "v22.0";
const POSTS_FILE = path.join(__dirname, "..", "data", "instagram-posts.json");

// 소수점 없이 정수 단위로 금액을 다루는 통화들 (예산 필드는 이런 통화에서만 그대로,
// 나머지는 최소 단위(cents 등)로 와서 100으로 나눠야 실제 금액이 됩니다)
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

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

async function getAdSpend() {
  const url = `https://graph.facebook.com/${API_VERSION}/act_${AD_ACCOUNT_ID}/insights?level=ad&fields=ad_id,spend&date_preset=last_30d&limit=200&access_token=${ACCESS_TOKEN}`;
  const rows = await fetchAllPages(url);
  const spendByAdId = {};
  for (const row of rows) {
    spendByAdId[row.ad_id] = parseFloat(row.spend || "0");
  }
  return spendByAdId;
}

// 광고 -> (게시물 ID, 광고그룹 정보) 매핑
async function getAdDetails() {
  const fields =
    "id,creative{source_instagram_media_id},adset{id,daily_budget,lifetime_budget,start_time,end_time}";
  const url = `https://graph.facebook.com/${API_VERSION}/act_${AD_ACCOUNT_ID}/ads?fields=${fields}&limit=200&access_token=${ACCESS_TOKEN}`;
  return fetchAllPages(url);
}

async function getCurrency() {
  const url = `https://graph.facebook.com/${API_VERSION}/act_${AD_ACCOUNT_ID}?fields=currency&access_token=${ACCESS_TOKEN}`;
  const json = await fetchJson(url);
  return json.currency;
}

function toBasicUnit(rawValue, currency) {
  if (rawValue === undefined || rawValue === null) return null;
  const n = parseFloat(rawValue);
  if (Number.isNaN(n)) return null;
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? n : n / 100;
}

async function main() {
  console.log("광고 지출/예산 수집 시작...");

  const [spendByAdId, adDetails, currency] = await Promise.all([
    getAdSpend(),
    getAdDetails(),
    getCurrency(),
  ]);

  // 게시물(media) ID -> { spend, adsetIds: Set }
  const perMedia = {};

  for (const ad of adDetails) {
    const mediaId = ad.creative?.source_instagram_media_id;
    if (!mediaId) continue; // 오가닉 게시물을 부스트한 광고가 아님

    if (!perMedia[mediaId]) {
      perMedia[mediaId] = { spend: 0, adsets: new Map() };
    }

    perMedia[mediaId].spend += spendByAdId[ad.id] || 0;

    const adset = ad.adset;
    if (adset?.id && !perMedia[mediaId].adsets.has(adset.id)) {
      perMedia[mediaId].adsets.set(adset.id, adset);
    }
  }

  const resultByMedia = {};
  for (const [mediaId, info] of Object.entries(perMedia)) {
    let totalBudget = 0;
    let earliestStart = null;
    let latestStop = null;
    let ongoing = false;

    for (const adset of info.adsets.values()) {
      const budgetRaw = adset.lifetime_budget ?? adset.daily_budget ?? null;
      const budget = toBasicUnit(budgetRaw, currency);
      if (budget !== null) totalBudget += budget;

      if (adset.start_time) {
        const start = new Date(adset.start_time);
        if (!earliestStart || start < earliestStart) earliestStart = start;
      }
      if (adset.end_time) {
        const stop = new Date(adset.end_time);
        if (!latestStop || stop > latestStop) latestStop = stop;
      } else {
        ongoing = true; // end_time이 없으면 (주로 daily_budget) 계속 진행 중
      }
    }

    resultByMedia[mediaId] = {
      spend: info.spend,
      budget: totalBudget,
      period_start: earliestStart ? earliestStart.toISOString().slice(0, 10) : null,
      period_end: ongoing ? null : latestStop ? latestStop.toISOString().slice(0, 10) : null,
      ongoing,
    };
  }

  console.log(`${Object.keys(resultByMedia).length}개 게시물에 매칭된 광고 발견 (통화: ${currency})`);

  if (!fs.existsSync(POSTS_FILE)) {
    console.error("data/instagram-posts.json이 없습니다. fetch-instagram-posts.js를 먼저 실행하세요.");
    process.exit(1);
  }

  const posts = JSON.parse(fs.readFileSync(POSTS_FILE, "utf-8"));
  const updated = posts.map((post) => {
    const info = resultByMedia[post.id];
    return {
      ...post,
      ad_spend: info?.spend ?? 0,
      ad_budget: info?.budget ?? 0,
      ad_period_start: info?.period_start ?? null,
      ad_period_end: info?.ongoing ? "진행중" : info?.period_end ?? null,
      ad_spend_currency: currency,
    };
  });

  fs.writeFileSync(POSTS_FILE, JSON.stringify(updated, null, 2));
  console.log("저장 완료: instagram-posts.json에 광고 데이터 반영됨");
}

main().catch((err) => {
  console.error("수집 실패:", err.message);
  process.exit(1);
});
