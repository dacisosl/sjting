# 계획 v2 — Cloudflare Realtime 전환

- 작성일: 2026-09-16
- 원본 계획: [화상회의앱_최종보완계획.md](화상회의앱_최종보완계획.md) (v1, 방장 PC = SFU)
- 결정자: 사용자 (2026-09-16 대화에서 "Cloudflare Realtime 로 재구축" 선택)

## 1. 왜 바꾸는가

v1 은 "서버 비용 0원" 을 위해 방장 PC 가 SFU 서버를 맡는 구조였다. 실제 시험에서 다음이 확인되었다.

- 방장 집 공유기(KT)가 UPnP 를 광고만 하고 실제 서비스는 꺼져 있어 자동 포트 개방 실패.
- 해결에는 공유기 관리 페이지 로그인·설정이 필요하고, 이는 "일반인이 설정 없이 쓴다" 는 핵심 요구와 충돌한다.
- CGNAT·기관망 등 어떤 설정으로도 방장이 될 수 없는 집이 항상 존재한다.

사용자가 정한 우선순위는 (1) 설정 없이 어디서나 동작, (2) 화면공유 화질 최대, (3) 20명, 가볍게. 이를 만족하는 무료 경로는 Cloudflare Realtime SFU (월 1,000GB 무료) 위에 재구축하는 것이다.

## 2. 새 구조

```text
[SJTing 앱 (Electron)]  ──wss──▶  [회의 서버: Cloudflare Worker + Durable Object]
        │                              ├─ 방 생성 / 초대·방장 토큰 발급
        │                              ├─ 참가자 상태·트랙 참조·채팅 (RoomDO)
        │                              ├─ 사용량 계량기 (UsageMeter, 월 참가자-분 예산)
        │                              └─ /partytracks/* → Realtime SFU 프록시 (입장권 검증)
        └──WebRTC──▶  [Cloudflare Realtime SFU]  (영상·음성 중계, DTLS-SRTP)
```

- 방장 PC 는 더 이상 서버가 아니다. 방장도 참가자와 같은 코드로 SFU 에 연결한다.
- 포트 개방·UPnP·공인 IP·CGNAT 문제가 모두 사라진다. 인터넷만 되면 어디서나 방을 만들 수 있다.
- 초대코드에는 IP 가 들어가지 않는다: `[버전, 서버URL, 방ID, 토큰, 만료]`.
- 앱 비밀키(SFU App Secret)는 Worker 에만 있다. 앱은 입장권(HMAC, 12시간)으로 프록시를 통과한다.

## 3. 유지되는 원칙 (v1 → v2)

| 원칙 | v2 에서의 구현 |
|---|---|
| 128비트 토큰, 해시 보관, 상수시간 비교 | `cloud/src/auth.ts` |
| 인원 20명 서버 강제, 잠금, 강퇴, 전체 음소거, 초대 재발급 | `cloud/src/RoomDO.ts`, `RoomState.ts` |
| 메시지 스키마 검증·크기·빈도 제한·인증 실패 제한 | zod + RateLimiter (DO 내부) |
| 재접속 30초 자리 유지 | `pendingLeave` + WebSocket Hibernation |
| 참가자별 영상 구독 최대 6개, 비표시 일시중지, 손실 시 계층 하향 | `layout.ts` → simulcast `preferredRid` (f/h/q) |
| 화면공유 문서/동영상 프리셋, 글자 선명도 우선 | `QUALITY.screen` + `contentHint` |
| 저장하지 않음 | 미디어는 SFU 중계만, 채팅은 방 종료 시 삭제(`storage.deleteAll`) |
| Electron 보안 (sandbox, CSP, 최소 preload) | 유지. `connect-src https: wss:` 로 서버만 허용 |

## 4. 비용과 차단 장치

- Realtime SFU: 월 1,000GB egress 무료, 초과 GB 당 $0.05. 업로드(클라이언트→Cloudflare)는 무료.
- Workers/Durable Objects 무료 플랜: 하루 10만 요청, SQLite 5GB. 회의 신호량은 이에 한참 못 미친다.
- **차단 장치**: `UsageMeter` 가 매 분 접속 인원을 참가자-분으로 누적한다. `MONTHLY_BUDGET_MINUTES`(기본 20,000 ≈ 발표 모드 기준 약 900GB) 를 넘으면 새 방 생성과 입장을 거절하고 진행 중인 방을 종료한다. 매달 1일 UTC 에 초기화된다.
- 운영자(Cloudflare 계정 주인)는 대시보드에서 Realtime 사용량 알림을 추가로 설정하는 것을 권장한다.

## 5. 남는 한계

- Cloudflare 계정을 가진 운영자 1명이 필요하다. 사용자들은 계정이 필요 없다.
- 무료 한도 안에서만 무료다. 한도를 넘는 달에는 그 달 사용이 막힌다(청구 대신 차단).
- 입장권을 가진 참가자는 같은 방의 다른 세션을 조작할 이론적 가능성이 있다(partytracks 세션 잠금은 쿠키 기반이라 file:// 앱에서 사용 불가). 초대 토큰으로만 입장이 가능하므로 실질 위험은 낮으며, 후속으로 세션-참가자 바인딩을 Worker 에 추가할 수 있다.
- 발언자 감지는 클라이언트 RMS 기반이며 서버 오디오 레벨 관측이 없다.

## 6. 단계

- [x] 1단계 — 회의 서버: Worker + RoomDO + UsageMeter + SFU 프록시, 로컬 e2e 27항목 통과
- [x] 2단계 — 앱 재구축: partytracks 기반 MeetingClient, 초대 v2, 화면 재작성, typecheck·테스트·빌드 통과
- [x] 3단계 — 배포 (2026-09-16): `https://sjting-server.sjting-server.workers.dev` 에 배포, 비밀값 3개 등록, 실제 SFU 세션 생성 확인, 앱 기본 서버 주소 반영 ([배포_Cloudflare.md](배포_Cloudflare.md))
- [x] 3.5단계 — 웹앱 (2026-09-16): 같은 렌더러 소스를 `__PLATFORM__='web'` 으로 빌드해 회의 서버의 정적 파일로 함께 배포. 초대 링크를 `https://<서버>/join/<코드>` 하나로 통일(앱 링크 `sjting://` 은 보조). 플랫폼 어댑터(`src/renderer/src/platform.ts`)로 설정·화면선택·잠자기방지·로그를 분리. 브라우저 2탭으로 방 생성→링크 참가→종료 확인. 서버가 `minAppVersion` 을 내려 오래된 설치형 앱에 업데이트 안내.
- [ ] 4단계 — 실기기 시험: PC 2대 통화(웹·앱 혼합), 화면공유 문서 판독성, 20명 발표 모드 60분, 재접속, 사용량 계량 정확도
- [ ] 5단계 — 후속: 세션-참가자 바인딩, TURN 자격증명(Realtime TURN, SFU 와 함께 쓰면 무료), 코드사이닝, 자동 업데이트
