# SJTing — Claude Code 작업 지침

설치형 소규모 화상회의 앱 (Electron + React + Tailwind) + 회의 서버 (Cloudflare Worker + Durable Objects + Realtime SFU). 최대 20명, 사용자 설정 0.
**기능 결정의 기준은 `docs/계획_v2_Cloudflare전환.md` 이고, 그 위에 `docs/화상회의앱_최종보완계획.md`(v1) 의 품질·보안 원칙을 유지한다.** 계획과 다르게 구현하면 이유를 코드 주석과 커밋 메시지에 남긴다.

## 명령

```bash
npm install && npm --prefix cloud install
npm run check:all            # 앱(typecheck+vitest) + 서버(typecheck+vitest) — 커밋 전 반드시 통과
npx electron-vite build      # 앱 번들 확인
npm --prefix cloud run dev   # 로컬 회의 서버 (cloud/.dev.vars 에 더미 비밀값 필요)
npm run dist:win:dir         # Windows 패키징 검증
```

클라우드(Linux) 환경에서는 `npm run check:all` 과 `electron-vite build`, `wrangler deploy --dry-run` 까지 가능하다. 실제 통화(카메라·화면공유·SFU)는 Windows PC 2대 + 배포된 서버에서 수동 검증한다.

## 구조 요약

- `src/shared/` — 앱·서버 공용. `protocol.ts`(시그널링 zod 스키마·타입, 방 생성 스키마), `invite.ts`(초대코드 v2: 서버URL·방ID·토큰·만료, CBOR+CRC32+Base64URL), `constants.ts`(한도·품질 정책·`DEFAULT_SERVER_URL`), `types.ts`.
- `cloud/src/` — `index.ts`(Hono: 방 생성, WS 전달, `/partytracks/*` 프록시 + 입장권 검증), `RoomDO.ts`(Durable Object, WebSocket Hibernation, 인증·제한·재접속·자동 종료·사용량 틱), `RoomState.ts`(순수 상태, 테스트 대상), `UsageMeterDO.ts`(월 참가자-분 예산), `auth.ts`(토큰·해시·HMAC 입장권·RateLimiter).
- `src/renderer/src/lib/MeetingClient.ts` — partytracks(`PartyTracks.push/pull`, `getMic/getCamera/getScreenshare`, `createAudioSink`) + `signaling.ts`. 구독 계획은 `lib/layout.ts`(순수 함수) 가 결정해 simulcast `preferredRid`(f/h/q) 로 계층을 고른다.
- `src/main/` — 창·보안(CSP `connect-src https: wss:`)·IPC(설정, 초대 파싱, 화면 소스 선택, 잠자기 방지, 로그). 서버 역할 없음.
- `src/renderer/src/store/` — zustand (`meetingStore`, `appStore`).

## 반드시 지킬 규칙

1. **보안 설정 유지**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, CSP, `setWindowOpenHandler` deny. preload 에 fs/shell 노출 금지.
2. **비밀값은 서버에만**: `SFU_APP_TOKEN`, `TICKET_SECRET` 은 `wrangler secret`. 앱 번들·저장소에 절대 넣지 않는다. `/partytracks/*` 는 입장권 검증 없이 열지 않는다.
3. **입력 검증**: 새 시그널링 메서드는 `RequestSchemas` 에 zod 스키마 추가, 방장 전용이면 `HOST_ONLY_METHODS`. HTTP API 도 zod. IPC 핸들러도 zod.
4. **인원 제한·잠금·종료는 서버(RoomState.canJoin)에서 강제**한다. UI 제한에 의존하지 않는다.
5. **무료 한도 차단 장치 유지**: `UsageMeter` 와 `MONTHLY_BUDGET_MINUTES` 를 우회하는 코드를 넣지 않는다. 예산 변경은 `cloud/wrangler.jsonc` 에서만.
6. **로그에 토큰·채팅·미디어 내용을 남기지 않는다.** `createLogger` 의 redact 를 우회하지 않는다.
7. **초대코드 포맷 변경 시** `INVITE_VERSION` 을 올리고 앱·서버 호환 정책을 `decodeInvite` 에 명시한다.
8. **품질 정책 변경은 `QUALITY` 상수에서**. 카메라 simulcast 3계층(f/h/q), 화면공유 2계층(f/h), 문서 모드 `contentHint: 'text'` 유지.
9. 앱·서버 공용 타입은 `src/shared` 에만 둔다. `cloud/` 는 상대 경로(`../../src/shared/*`)로 가져오며 cbor-x 등 Node 전용 모듈은 가져오지 않는다.
10. 새 기능은 `tests/`(앱) 또는 `cloud/tests/`(서버) 에 단위테스트를 추가한다. 서버 흐름 변경 시 `wrangler dev` 로컬 e2e(방 생성→입장→트랙→채팅→강퇴→종료)를 다시 돌린다.
11. 커밋 메시지는 한국어 요약 + 관련 계획 단계(예: `v2 3단계`)를 적는다.

## 현재 상태 (2026-09-16)

- v2 1·2단계 완료: 서버 로컬 e2e 27항목 통과, 앱 typecheck·테스트·빌드 통과.
- **3단계 배포는 운영자 작업 필요** (Cloudflare 계정·SFU 앱·`wrangler login`·secret·deploy). 배포 후 `DEFAULT_SERVER_URL` 갱신.
- 미검증: 실제 SFU 를 통한 2인 통화, 화면공유 판독성, 20명 60분, 사용량 계량 정확도.
- v1 코드(mediasoup·UPnP·진단)는 git 이력(커밋 `9ec1379` 이전)에만 남아 있다.
