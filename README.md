# SJTing — 설치형 소규모 화상회의 앱

**설정 없이 바로 쓰는** Windows 화상회의 앱입니다. 방 만들기 버튼 하나, 초대 링크 하나. 공유기·포트·계정 설정이 없습니다.
최대 **20명**, 음성·카메라·**문서 중심 고화질 화면공유**.

영상은 Cloudflare Realtime SFU 가 중계하고(저장 안 함), 방 상태·채팅은 Cloudflare Worker + Durable Objects 가 관리합니다. 운영자 1명이 무료 플랜으로 서버를 한 번 올리면 사용자들은 아무 계정도 필요 없습니다.

> v1(방장 PC 가 서버) 에서 v2(Cloudflare) 로 전환한 이유와 구조는 [docs/계획_v2_Cloudflare전환.md](docs/계획_v2_Cloudflare전환.md) 에 있습니다. 원본 요구사항은 [docs/화상회의앱_최종보완계획.md](docs/화상회의앱_최종보완계획.md).

## 두 가지 출입문, 하나의 회의

| | 웹 (기본) | 설치형 앱 |
|---|---|---|
| 접근 | 링크 클릭 → 브라우저에서 바로 | 설치 후 링크 클릭 또는 붙여넣기 |
| 주소 | https://sjting-server.sjting-server.workers.dev | GitHub Releases 설치파일 |
| 화면공유 | 브라우저 기본 선택창 | 앱 자체 선택창(썸네일), 시스템 오디오 loopback |
| 업데이트 | 새로고침 | 수동 설치 (서버가 최소 버전을 안내) |

둘은 같은 서버·같은 방을 쓰므로 한 회의에 섞여 들어옵니다. 초대 링크는 `https://<서버>/join/<코드>` 하나입니다.

## 구조

```
sjting/
├─ src/                 앱 (Electron Main · Preload · React Renderer — 웹과 공유)
│  ├─ shared/           프로토콜(zod)·초대코드·설정 스키마·상수 — 앱·웹·서버가 함께 사용
│  ├─ renderer/src/platform.ts            플랫폼 어댑터 (electron ↔ web)
│  └─ renderer/src/lib/MeetingClient.ts   partytracks(Realtime SFU) + 시그널링
├─ vite.web.config.ts   웹앱 빌드 → cloud/public (Workers Static Assets)
├─ cloud/               회의 서버 (Cloudflare Worker + Durable Objects)
│  ├─ src/RoomDO.ts     방·참가자·채팅·재접속·자동 종료
│  ├─ src/UsageMeterDO.ts  월 사용량 예산 (무료 한도 차단 장치)
│  └─ src/index.ts      방 생성 API · WebSocket · SFU 프록시(입장권 검증)
└─ docs/                계획서 · 배포 안내 · 사용자 안내서
```

## 주요 특징

- **초대 링크 `sjting://join/…`**: 서버 주소·방 ID·128비트 토큰·만료만 담습니다. IP 없음.
- **방장 기능**: 강퇴, 전체 음소거 요청, 입장 잠금, 초대 링크 재발급, 회의 모드 변경.
- **4가지 회의 모드**: 발표 / 대화 / 전체 보기 / 저대역폭. 참가자별 영상 수신 최대 6개, 화면 밖 타일 자동 일시중지, 손실·지연 시 simulcast 계층 자동 하향.
- **화면공유 프리셋**: 문서(1080p·10fps·text hint) / 동영상(30fps·motion hint·시스템 오디오).
- **장애 복구**: 시그널링 지수 백오프 재접속(30초 자리 유지), 미디어 연결은 partytracks 가 자동 복구, 장치 분리 시 대체 장치 시도.
- **무료 한도 보호**: 서버가 월 참가자-분 예산을 세어 한도 초과 시 새 방·입장을 거절합니다. 운영자 카드에 청구가 나가는 경로를 막습니다.
- **보안**: 서버 측 토큰 해시 비교, 모든 입력 zod 검증, 메시지 빈도·인증 실패 제한, 앱 비밀키는 서버에만, Electron sandbox·CSP·최소 preload, 로그에 토큰·채팅 미기록.

## 사용자 요구 사항

- Windows 11 x64, 인터넷 연결. 그게 전부입니다.
- 참가자 5Mbps, 화면공유 방장 10Mbps 업로드 권장.

## 운영자(서버) 준비

[docs/배포_Cloudflare.md](docs/배포_Cloudflare.md) 를 따라 Cloudflare 무료 계정에 서버를 올리고, `src/shared/constants.ts` 의 `DEFAULT_SERVER_URL` 을 배포 주소로 바꿉니다.

## 개발

```bash
npm install && npm --prefix cloud install
npm run check:all        # 앱 + 서버 타입검사·테스트
npm run build:web        # 웹앱 빌드 (cloud/public)
npm run deploy:web       # 웹앱 빌드 + 서버 배포 (wrangler 로그인 필요)
npm run dev              # Electron 개발 실행
npm --prefix cloud run dev   # 로컬 회의 서버 (http://127.0.0.1:8787) — cloud/.dev.vars 필요
npm run dist:win         # Windows 설치파일 (release/<version>/)
```

로컬 서버로 앱을 시험하려면 앱 설정 → 서버 주소에 `http://127.0.0.1:8787` 을 넣습니다. SFU 자격증명이 없으면 방·채팅은 되지만 영상은 연결되지 않습니다.

## 배포

`v*` 태그를 푸시하면 GitHub Actions 가 Windows 설치파일을 빌드해 Releases 에 올립니다. 코드사이닝 미적용 상태라 SmartScreen 경고가 표시됩니다 ("추가 정보 → 실행").

```bash
npm version patch && git push --follow-tags
```

## 라이선스

MIT
