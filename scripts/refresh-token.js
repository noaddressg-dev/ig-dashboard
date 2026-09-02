// scripts/refresh-token.js
// 장기 액세스 토큰은 발급 후 24시간이 지나면 만료 전(60일 이내)에 갱신할 수 있습니다.
// 이 스크립트는 갱신된 새 토큰을 콘솔에 출력합니다.
// 자동으로 GitHub Secret까지 갱신하지는 않으므로, 출력된 값을 IG_ACCESS_TOKEN Secret에
// 수동으로 업데이트해야 합니다. (약 50일마다 한 번 정도)

const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error("IG_ACCESS_TOKEN 환경변수가 없습니다.");
  process.exit(1);
}

async function main() {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url);
  const json = await res.json();

  if (json.error) {
    console.error("토큰 갱신 실패:", json.error.message);
    process.exit(1);
  }

  console.log("새 토큰이 발급되었습니다. GitHub Secret(IG_ACCESS_TOKEN)에 아래 값으로 업데이트하세요:");
  console.log(json.access_token);
  console.log(`유효기간(초): ${json.expires_in} (약 ${Math.round(json.expires_in / 86400)}일)`);
}

main();
