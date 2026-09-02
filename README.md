# Instagram 브랜드 계정 대쉬보드 - 데이터 수집 파트

Instagram Graph API에서 매일 자동으로 계정 지표(팔로워 수, 도달, 프로필 조회수 등)를
가져와 `data/instagram-metrics.json`에 누적 저장하는 GitHub Actions 워크플로우입니다.

## 1. GitHub 저장소 만들기

1. github.com에서 새 저장소(New repository)를 생성합니다. Public/Private 상관없습니다.
2. 이 폴더(`ig-dashboard`) 안의 모든 파일을 그 저장소에 올립니다 (업로드 또는 git push).

## 2. Secrets 등록

저장소 페이지에서 **Settings → Secrets and variables → Actions → New repository secret** 로 들어가서
아래 두 개를 등록하세요.

| Secret 이름 | 값 |
|---|---|
| `IG_ACCESS_TOKEN` | 아까 Meta 대시보드에서 발급받은 장기 액세스 토큰 |
| `IG_USER_ID` | 본인의 Instagram 계정 ID (아래에서 확인 방법 참고) |

**IG_USER_ID 확인 방법**: 브라우저에서 아래 주소를 열어보세요 (`YOUR_TOKEN`을 실제 토큰으로 교체).
```
https://graph.instagram.com/v22.0/me?fields=id,username&access_token=YOUR_TOKEN
```
여기서 나오는 `id` 값이 `IG_USER_ID`입니다.

## 3. Actions 활성화

저장소의 **Actions** 탭으로 들어가서 워크플로우 실행을 허용해주세요 (처음 올리면 활성화 여부를 물어봅니다).

## 4. 수동으로 한 번 테스트

**Actions → Fetch Instagram Metrics → Run workflow** 버튼을 눌러 수동으로 한 번 실행해보세요.
성공하면 `data/instagram-metrics.json`에 오늘 날짜의 데이터가 커밋됩니다.

이후에는 매일 자동으로(한국시간 오전 6시) 실행되어 데이터가 하루 단위로 쌓입니다.

## 5. 토큰 갱신

액세스 토큰은 60일 후 만료됩니다. `refresh-token-reminder.yml` 워크플로우가 매달 1일, 15일에
자동 실행되어 새 토큰을 로그에 출력해줍니다. **Actions 탭 → Refresh Token Reminder → 최근 실행 로그**에서
새 토큰 값을 확인해 `IG_ACCESS_TOKEN` Secret 값을 수동으로 교체해주세요.
(완전 자동화하려면 별도의 Personal Access Token으로 Secrets API를 호출하는 방식이 필요한데,
필요하면 다음 단계에서 추가해드릴 수 있어요.)

## 다음 단계

이 저장소에 데이터가 쌓이기 시작하면, `data/instagram-metrics.json`을 읽어서
시각화하는 웹 대쉬보드를 만들 차례입니다.
