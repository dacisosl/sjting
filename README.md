# SJTing — 설치형 소규모 화상회의 앱

별도 서버·월 라이선스 없이, **방장 PC 가 mediasoup SFU 와 시그널링 서버 역할**을 하는 Windows 설치형 화상회의 앱입니다.
방장 포함 **최대 20명**, 음성·카메라·**문서 중심 고화질 화면공유**를 지원합니다.

> 1차 제품 정의: 공인 IPv4 와 포트 개방이 가능한 유선 가정망에서 방장 PC 를 SFU 로 사용하여, 방장 포함 최대 20명이 음성 대화와 문서 중심 고화질 화면공유를 할 수 있는 Windows 설치형 화상회의 앱. 20명 회의에서는 음성과 화면공유를 우선하고, 카메라 영상은 발표자·최근 발언자·화면에 보이는 참가자 중심으로 선택 전송한다.

전체 설계·일정·합격 기준은 [docs/화상회의앱_최종보완계획.md](docs/화상회의앱_최종보완계획.md) 를 따릅니다.

## 주요 특징

- **서버리스**: 방장 앱 안에서 mediasoup Worker/Router/WebRtcServer 와 WSS 시그널링 서버가 실행됩니다. 방장도 자기 SFU 의 참가자 한 명으로 동작합니다.
- **초대코드 / `sjting://join/…` 링크**: CBOR + CRC32 + Base64URL. 128비트 무작위 토큰, 방장 인증서 SHA-256 지문, 만료시간 포함. 방장은 토큰 해시만 보관합니다.
- **인증서 지문 고정**: 참가자 앱은 초대코드의 지문과 방장 WSS 인증서를 비교해 다르면 입장을 차단합니다.
- **네트워크 진단 9단계**: 로컬 IP → 공인 IPv4(STUN) → CGNAT 의심 → UPnP → 포트 매핑 → 방화벽 안내 → 헤어핀 도달 검사 → 업로드 실측 기록 → 권장 인원/모드.
- **UPnP 자동 매핑 + 수동 포트포워딩 안내**, 포트 충돌 시 대체 포트 자동 선택 및 초대코드 반영.
- **4가지 회의 모드**: 발표 / 대화 / 전체 보기 / 저대역폭. 참가자별 영상 구독 최대 6개, 비표시 타일 자동 일시중지, 패킷 손실·RTT 증가 시 계층 자동 하향.
- **화면공유 프리셋**: 문서(1080p·10fps·text hint, 5Mbps) / 동영상(30fps·motion hint, 7Mbps, 시스템 오디오 loopback).
- **코덱**: 화면공유 VP9 SVC(L1T3) 우선 → VP8 대체, 카메라 VP8 simulcast 3계층, H.264 호환 코덕 라우터 등록.
- **방장 기능**: 강퇴, 전체 음소거, 입장 잠금, 초대코드 재발급, 모드 변경, 잠자기 방지, 서버 업로드 통계.
- **장애 복구**: WS 지수 백오프 재접속(30초 자리 유지), ICE 재시작 → Transport 재생성, 장치 분리 감지, Worker 종료 시 안전 종료, 방장 IP 변경 감지.
- **Electron 보안**: sandbox·contextIsolation, 최소 preload API, 모든 IPC/시그널링 입력 zod 검증, CSP, 외부 URL 로딩 금지, 메시지 크기·빈도·인증 실패 제한, 로그 IP·토큰 마스킹.

## 요구 사항

| 항목 | 방장 | 참가자 |
|---|---|---|
| OS | Windows 11 x64 | Windows 11 x64 |
| 네트워크 | 공인 IPv4, UPnP 또는 수동 포트포워딩, 방화벽 허용, 유선 권장 | 일반 인터넷 |
| 회선 | 20명 발표 모드 업로드 200Mbps 이상 권장 | 5Mbps 이상 |
| PC | 4코어 8스레드, RAM 16GB 권장 | - |

지원하지 않는 환경: 통신사 CGNAT, 기관 방화벽, 공유기 권한 없는 와이파이(방장 기능), IPv6 전용, 모바일·브라우저 참가. 자세한 내용은 [docs/네트워크문제해결.md](docs/네트워크문제해결.md).

기본 포트: **TCP 44330** (시그널링), **UDP/TCP 44331** (미디어, WebRtcServer 단일 포트).

## 개발

```bash
npm install          # mediasoup worker 프리빌드 + Electron 바이너리 다운로드
npm run dev          # electron-vite 개발 모드 (HMR)
npm run check        # 타입검사 + 단위테스트
npm run dist:win     # Windows x64 NSIS 설치파일 (release/<version>/)
```

프로젝트 구조:

```
src/main/        Electron Main — host/(mediasoup·시그널링·Room·HostController), network/(STUN·UPnP·포트·진단), security/(인증서·토큰)
src/preload/     contextBridge 로 노출하는 최소 API (window.sjting)
src/renderer/    React + Tailwind UI, lib/MeetingClient(mediasoup-client), store/(zustand)
src/shared/      Main/Renderer 공용: 프로토콜 zod 스키마, 초대코드, 상수, 타입
tests/           vitest 단위테스트 (electron 은 tests/mocks 로 대체)
docs/            계획서, 사용자 안내서, 네트워크 문제 해결서
```

## 배포

`v*` 태그를 푸시하면 GitHub Actions 가 Windows 설치파일을 빌드해 Releases 에 올립니다. MVP 는 수동 업데이트이며 코드사이닝은 미적용 상태라 SmartScreen 경고가 표시됩니다 ("추가 정보 → 실행").

```bash
npm version patch && git push --follow-tags
```

## 라이선스

MIT
