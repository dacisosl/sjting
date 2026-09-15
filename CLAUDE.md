# SJTing — Claude Code 작업 지침

설치형 소규모 화상회의 앱 (Electron + React + Tailwind + mediasoup). 방장 PC 가 SFU 서버가 되는 서버리스 구조, 최대 20명.
**모든 기능 결정의 기준은 `docs/화상회의앱_최종보완계획.md` 이다.** 계획서와 다르게 구현해야 하면 이유를 코드 주석과 커밋 메시지에 남긴다.

## 명령

```bash
npm install            # 최초 1회. mediasoup worker 프리빌드와 Electron 바이너리를 내려받음
npm run check          # typecheck(node+web) + vitest — 커밋 전 반드시 통과
npm run dev            # Electron 개발 실행 (Windows 로컬에서만 의미 있음)
npm run dist:win:dir   # 패키징 검증 (unpacked). mediasoup-worker.exe 가 app.asar.unpacked 에 있어야 함
```

클라우드(Linux) 환경에서는 `npm run check` 까지만 가능하다. Electron 바이너리가 필요 없으면 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`.
실제 회의 동작(카메라·화면공유·UPnP)은 Windows PC 2대 이상에서 수동 검증한다 — CI 는 이를 대신하지 못한다.

## 구조 요약

- `src/shared/` — Main·Renderer 공용. `protocol.ts`(시그널링 zod 스키마·타입), `invite.ts`(초대코드 CBOR+CRC32+Base64URL), `constants.ts`(포트·품질 정책·한도), `types.ts`, `ipc.ts`(preload API 계약).
- `src/main/host/` — `HostController`(시작/종료 오케스트레이션) → `MediasoupServer`(Worker/Router/WebRtcServer) + `SignalingServer`(WSS, 인증, 속도 제한, 요청 dispatch) + `Room`(순수 상태).
- `src/main/network/` — `stun.ts`(공인 IP 확인 전용), `upnp.ts`, `ports.ts`(대체 포트), `localNet.ts`(사설/CGNAT 판별), `diagnostics.ts`(9단계 진단, deps 주입으로 테스트).
- `src/main/security/` — `certificate.ts`(자체 서명 인증서·SHA-256 지문), `tokens.ts`(128비트 토큰, 해시 비교, RateLimiter).
- `src/main/ipc.ts` — 모든 IPC 입력 zod 검증. 인증서 지문 고정(`pinned`)과 화면공유 소스 선택 상태를 보관.
- `src/renderer/src/lib/MeetingClient.ts` — mediasoup-client. 방장·참가자 동일 코드. 구독 계획은 `lib/layout.ts`(순수 함수) 가 결정.
- `src/renderer/src/store/` — zustand (`meetingStore`, `appStore`).

## 반드시 지킬 규칙

1. **보안 설정 유지**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, CSP, `setWindowOpenHandler` deny. preload 에 fs/shell 노출 금지.
2. **입력 검증**: 새 시그널링 메서드는 `RequestSchemas` 에 zod 스키마를 추가하고, 방장 전용이면 `HOST_ONLY_METHODS` 에 넣는다. IPC 핸들러도 zod 로 검증한다.
3. **인원 제한은 서버(Room.canJoin)에서 강제**한다. UI 제한에 의존하지 않는다.
4. **로그에 토큰·전체 IP·채팅·미디어 내용을 남기지 않는다.** `createLogger` 의 redact 를 우회하지 않는다. IP 표시는 `maskIp`.
5. **초대코드 포맷 변경 시** `INVITE_VERSION` 을 올리고 하위 버전 디코딩 호환을 유지한다.
6. **mediasoup 는 externalize** (번들 금지). worker 실행 파일은 `asarUnpack` 대상이며 `resolveWorkerBinary()` 가 패키징 경로를 설정한다.
7. **품질 정책 변경은 `QUALITY` 상수에서** 한다. 카메라 simulcast 3계층, 화면공유 VP9 L1T3 → VP8 대체 순서를 유지한다.
8. **STUN 은 공인 IP 확인 용도**로만 쓴다. TURN·중계 서버는 MVP 범위 밖(계획서 1.6).
9. 새 기능은 `tests/` 에 단위테스트를 추가한다. main 모듈 테스트는 `tests/mocks/electron.ts` 별칭을 사용한다.
10. 커밋 메시지는 한국어 요약 + 관련 계획서 단계(예: `3단계`)를 적는다.

## 계획서 단계별 현재 상태

- 0~7단계에 해당하는 MVP 코드 골격과 단위테스트가 구현되어 있다.
- **미검증 항목(실기기 필요)**: 설치본에서 Worker 실행, 서로 다른 회선 2대 30분 유지, LAN 20명 60분, 1080p 문서 판독성, 가정 공유기 UPnP 모델별 시험, 60분 메모리 안정성.
- 8단계(코드사이닝, 자동 업데이트, macOS, IPv6, TURN, 녹화, 가상 배경, QR, LAN 검색)는 미착수.
