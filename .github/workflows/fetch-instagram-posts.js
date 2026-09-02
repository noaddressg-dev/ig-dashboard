// scripts/fetch-instagram-posts.js
// 최근 30일간 게시물 목록과 각 게시물의 실적(도달, 저장, 공유, 좋아요, 댓글 등)을 가져와
// data/instagram-posts.json에 저장합니다. (매번 최근 30일 전체를 새로 덮어씁니다 -
// 오래된 게시물도 도달/저장 수가 계속 늘 수 있어서, 누적이 아니라 매번 최신값으로 갱신합니다)

const fs = require("fs");
const path = require("path");

const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID;
const API_VERSION = "v22.0";
const DATA_FILE = path.join(__dirname, "..", "data", "instagram-posts.json");
const DAYS_BACK = 30;

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

// 최근 게시물 목록 가져오기 (페이지네이션 포함, 30일 이전 게시물이 나오면 중단)
async function getRecentMedia() {
  const cutoff = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;
  const fields = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count";
  let url = `https://graph.instagram.com/${API_VERSION}/${IG_USER_ID}/media?fields=${fields}&limit=50&access_token=${ACCESS_TOKEN}`;

  const results = [];
  let page = 0;

  while (url && page < 5) {
    // 최대 5페이지(약 250개)까지만, 30일치면 보통 1페이지면 충분해요
    const json = await fetchJson(url);
    for (const item of json.data || []) {
      if (new Date(item.timestamp).getTime() < cutoff) {
        return results; // 30일 이전 게시물 나오면 바로 종료
      }
      results.push(item);
    }
    url = json.paging?.next || null;
    page++;
  }
  return results;
}

// 게시물 종류에 따라 사용 가능한 인사이트 지표가 달라서, 넓은 세트로 시도하고
// 실패하면 더 작은 세트로 재시도합니다.
// 참고: follows(팔로우 기여) 지표는 릴스에는 제공되지 않고, 사진/캐러셀(FEED)에만 제공돼요.
async function getMediaInsights(mediaId, mediaProductType) {
  const metricSets =
    mediaProductType === "REELS"
      ? [["reach", "saved", "shares", "plays"], ["reach", "saved"], ["reach"]]
      : [
          ["reach", "saved", "shares", "follows"],
          ["reach", "saved", "follows"],
          ["reach", "follows"],
          ["reach"],
        ];

  for (const metrics of metricSets) {
    try {
      const url = `https://graph.instagram.com/${API_VERSION}/${mediaId}/insights?metric=${metrics.join(
        ","
      )}&access_token=${ACCESS_TOKEN}`;
      const json = await fetchJson(url);
      const map = {};
      for (const item of json.data || []) {
        map[item.name] = item.values?.[0]?.value ?? null;
      }
      return map;
    } catch (e) {
      // 이 지표 세트가 안 맞으면 더 작은 세트로 재시도
      continue;
    }
  }
  return {};
}

async function main() {
  console.log(`최근 ${DAYS_BACK}일 게시물 실적 수집 시작...`);

  const mediaList = await getRecentMedia();
  console.log(`${mediaList.length}개 게시물 발견`);

  const posts = [];
  for (const media of mediaList) {
    const insights = await getMediaInsights(media.id, media.media_product_type);
    posts.push({
      id: media.id,
      caption: (media.caption || "").slice(0, 80), // 너무 길면 잘라서 저장
      media_type: media.media_type,
      media_product_type: media.media_product_type,
      timestamp: media.timestamp,
      permalink: media.permalink,
      like_count: media.like_count ?? null,
      comments_count: media.comments_count ?? null,
      reach: insights.reach ?? null,
      saved: insights.saved ?? null,
      shares: insights.shares ?? null,
      plays: insights.plays ?? null,
      follows: insights.follows ?? null,
    });
  }

  posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(posts, null, 2));

  console.log(`저장 완료: ${posts.length}개 게시물`);
}

main().catch((err) => {
  console.error("수집 실패:", err.message);
  process.exit(1);
});
