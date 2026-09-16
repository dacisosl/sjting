# 회의 서버 배포 (Cloudflare) — 운영자 1명이 한 번만 하면 됩니다

사용자들은 아무 계정도 필요 없습니다. 아래는 **서버를 올리는 사람(당신)** 만 합니다. 15분쯤 걸립니다.

## 0. 준비물

- Cloudflare 계정 (무료). https://dash.cloudflare.com/sign-up
- 이 저장소를 받은 PC 에 Node.js 22 이상.

## 1. Realtime SFU 앱 만들기 (대시보드)

1. https://dash.cloudflare.com/?to=/:account/realtime/sfu/create 접속.
2. 이름을 `sjting` 으로 두고 생성.
3. 화면에 나오는 **App ID** 와 **App Secret** 을 메모장에 복사해 둡니다. Secret 은 이 화면을 벗어나면 다시 볼 수 없습니다.

(선택) TURN 도 만들면 극단적인 방화벽 뒤 참가자 연결률이 오릅니다. SFU 와 함께 쓰면 무료입니다. https://dash.cloudflare.com/?to=/:account/realtime/turn/create → **TURN Key ID / Token** 메모.

## 2. 로그인

터미널에서 저장소의 `cloud` 폴더로 이동한 뒤:

```bash
npm install
```

```bash
npx wrangler login
```

브라우저가 열리면 **Allow** 를 누릅니다. 이 단계는 비밀번호를 터미널에 입력하지 않고 브라우저에서 직접 승인합니다.

## 3. 비밀값 등록

아래 명령을 하나씩 실행하면 값을 입력하라는 프롬프트가 뜹니다. 메모해 둔 값을 붙여넣고 Enter.

```bash
npx wrangler secret put SFU_APP_ID
```

```bash
npx wrangler secret put SFU_APP_TOKEN
```

입장권 서명 키는 아무 긴 무작위 문자열이면 됩니다. 아래 명령이 만들어 준 값을 붙여넣으세요.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```bash
npx wrangler secret put TICKET_SECRET
```

(선택) TURN 을 만들었다면:

```bash
npx wrangler secret put TURN_APP_ID
```

```bash
npx wrangler secret put TURN_APP_TOKEN
```

(선택) 사용량 조회 API 용 관리자 키:

```bash
npx wrangler secret put ADMIN_KEY
```

## 4. 배포

```bash
npx wrangler deploy
```

마지막 줄에 `https://sjting-server.<당신의-서브도메인>.workers.dev` 형태의 주소가 나옵니다. 이것이 **회의 서버 주소**입니다.

확인:

```bash
curl https://sjting-server.<서브도메인>.workers.dev/api/health
```

`{"ok":true,...}` 가 나오면 성공입니다.

## 5. 앱에 서버 주소 심기

`src/shared/constants.ts` 의 `DEFAULT_SERVER_URL` 을 4단계 주소로 바꾸고 커밋합니다. 그 뒤 앱을 빌드하면 모든 사용자가 그 서버를 기본으로 씁니다. (앱 설정 화면에서 개인이 다른 서버를 지정할 수도 있습니다.)

## 6. 사용량 확인

- 앱 홈 화면 "서버 상태" 카드에 이번 달 사용률이 표시됩니다.
- 대시보드: https://dash.cloudflare.com/?to=/:account/realtime/sfu → 사용량 그래프.
- 예산 조정: `cloud/wrangler.jsonc` 의 `MONTHLY_BUDGET_MINUTES` (기본 20,000 참가자-분). 줄이면 더 안전하고, 늘리면 무료 한도를 넘어 청구될 수 있습니다.
- 권장: Cloudflare 대시보드 → Notifications 에서 Billing 알림을 켜 둡니다.

## 7. 업데이트

서버 코드가 바뀌면 `cloud` 폴더에서 `npx wrangler deploy` 만 다시 실행합니다. 진행 중인 회의는 Durable Object 상태가 유지되므로 끊기지 않는 것이 보통이지만, 배포는 회의 시간이 아닐 때 하는 것을 권장합니다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| `/api/health` 가 500 | `wrangler tail` 로 로그 확인. 비밀값 누락이 흔한 원인 |
| 앱에서 "회의 서버에 연결할 수 없습니다" | 서버 주소 오타, 인터넷 연결 |
| 입장은 되는데 영상이 안 옴 (`미디어 연결 failed`) | SFU_APP_ID/TOKEN 이 잘못됨. 대시보드에서 새 Secret 발급 후 `secret put` 다시 |
| "이번 달 무료 사용량을 모두 사용했습니다" | 예산 소진. 다음 달 1일(UTC) 자동 초기화 |
