/** 앱 전역 상수 — 계획서 4.1 포트 설계, 6.2 품질 정책, 2.1 인원 정의 반영 */

export const APP_PROTOCOL = 'sjting'
export const INVITE_LINK_PREFIX = `${APP_PROTOCOL}://join/`

/** 방장 포함 최대 동시 접속자 수 (서버에서 강제) */
export const MAX_PARTICIPANTS = 20

/** 기본 고정 포트 (충돌 시 대체 포트 선택) */
export const DEFAULT_SIGNALING_PORT = 44330
export const DEFAULT_MEDIA_PORT = 44331
/** LAN 전용 미디어 리스너 포트 오프셋 (공인 포트와 별도 소켓) */
export const LAN_MEDIA_PORT_OFFSET = 1
/** 대체 포트 탐색 최대 시도 */
export const PORT_FALLBACK_ATTEMPTS = 20

/** 초대코드 기본 만료 (초) */
export const DEFAULT_INVITE_TTL_SEC = 12 * 60 * 60
export const INVITE_VERSION = 1

/** 시그널링 보호 한도 (계획서 8장) */
export const WS_MAX_MESSAGE_BYTES = 64 * 1024
export const WS_MAX_MESSAGES_PER_SEC = 40
export const WS_AUTH_TIMEOUT_MS = 10_000
export const AUTH_MAX_FAILURES_PER_IP = 5
export const AUTH_FAILURE_WINDOW_MS = 60_000
export const CHAT_MAX_LENGTH = 1000
export const CHAT_MAX_PER_10SEC = 15
export const DISPLAY_NAME_MAX = 24
/** 재접속 참가자의 자리를 유지하는 시간 */
export const RECONNECT_GRACE_MS = 30_000

/** 참가자별 동시 영상 구독 최대 개수 */
export const MAX_VIDEO_SUBSCRIPTIONS = 6
export const CONVERSATION_MODE_VIDEO_COUNT = 6

export type LayoutMode = 'presentation' | 'conversation' | 'grid' | 'lowbandwidth'

export const LAYOUT_MODE_LABEL: Record<LayoutMode, string> = {
  presentation: '발표 모드',
  conversation: '대화 모드',
  grid: '전체 보기',
  lowbandwidth: '저대역폭 모드'
}

export type MediaSource = 'mic' | 'camera' | 'screen' | 'screenAudio'

export type ScreenSharePreset = 'document' | 'video'

/** 계획서 6.2 기본 품질 정책 */
export const QUALITY = {
  camera: {
    width: 640,
    height: 360,
    frameRate: 24,
    /** simulcast 3계층: 180p / 360p / 720p 상한 */
    encodings: [
      { rid: 'r0', scaleResolutionDownBy: 4, maxBitrate: 120_000, maxFramerate: 15 },
      { rid: 'r1', scaleResolutionDownBy: 2, maxBitrate: 350_000, maxFramerate: 24 },
      { rid: 'r2', scaleResolutionDownBy: 1, maxBitrate: 900_000, maxFramerate: 24 }
    ]
  },
  presenterCamera: { width: 1280, height: 720, frameRate: 30 },
  screen: {
    document: { width: 1920, height: 1080, frameRate: 10, maxBitrate: 5_000_000, contentHint: 'text' as const },
    video: { width: 1920, height: 1080, frameRate: 30, maxBitrate: 7_000_000, contentHint: 'motion' as const }
  },
  audio: { channelCount: 1, opusDtx: true, opusFec: true, maxBitrate: 48_000 }
} as const

/** 방장 회선 권장 기준 (Mbps, 업로드) — 계획서 6.5 */
export const UPLOAD_RECOMMENDATION = [
  { maxParticipants: 10, minUploadMbps: 100, label: '10명 이하, 화면공유 중심' },
  { maxParticipants: 20, minUploadMbps: 200, label: '20명, 발표 모드' },
  { maxParticipants: 20, minUploadMbps: 300, label: '20명, 다수 카메라 활성' }
] as const
