/** 앱 전역 상수 — v2 (Cloudflare Realtime 전환). docs/계획_v2_Cloudflare전환.md 참조 */

export const APP_PROTOCOL = 'sjting'
export const INVITE_LINK_PREFIX = `${APP_PROTOCOL}://join/`

/** 방장 포함 최대 동시 접속자 수 (서버에서 강제) */
export const MAX_PARTICIPANTS = 20

/** 초대코드 기본 만료 (초) */
export const DEFAULT_INVITE_TTL_SEC = 12 * 60 * 60
export const INVITE_VERSION = 2

/**
 * 기본 서버 주소. 배포 후 실제 workers.dev 주소로 바꾼다.
 * 설정 화면에서 사용자가 다른 서버를 지정할 수도 있다.
 */
export const DEFAULT_SERVER_URL = 'https://sjting-server.sjting-server.workers.dev'

/** 시그널링 보호 한도 */
export const WS_MAX_MESSAGE_BYTES = 32 * 1024
export const WS_MAX_MESSAGES_PER_SEC = 30
export const WS_AUTH_TIMEOUT_MS = 10_000
export const AUTH_MAX_FAILURES_PER_IP = 8
export const AUTH_FAILURE_WINDOW_MS = 60_000
export const CHAT_MAX_LENGTH = 1000
export const CHAT_MAX_PER_10SEC = 15
export const DISPLAY_NAME_MAX = 24
/** 재접속 참가자의 자리를 유지하는 시간 */
export const RECONNECT_GRACE_MS = 30_000
/** 방장이 자리를 비운 뒤 방을 닫는 시간 */
export const HOST_ABSENT_CLOSE_MS = 5 * 60_000
/** 아무도 없을 때 방을 닫는 시간 */
export const EMPTY_ROOM_CLOSE_MS = 10 * 60_000
/** 입장권(ticket) 유효 시간 (초) */
export const TICKET_TTL_SEC = 12 * 60 * 60

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
export const MEDIA_SOURCES: readonly MediaSource[] = ['mic', 'camera', 'screen', 'screenAudio']

export type ScreenSharePreset = 'document' | 'video'

/** simulcast 계층 식별자 (Cloudflare 관례: f=full, h=half, q=quarter). 알파벳 순서가 우선순위 */
export const RID = { full: 'f', half: 'h', quarter: 'q' } as const
export type Rid = (typeof RID)[keyof typeof RID]

export interface EncodingSpec {
  rid: Rid
  scaleResolutionDownBy: number
  maxBitrate: number
  maxFramerate: number
}

/** 품질 정책 — 카메라 simulcast 3계층, 화면공유 2계층 */
export const QUALITY = {
  camera: {
    width: 1280,
    height: 720,
    frameRate: 24,
    encodings: [
      { rid: RID.full, scaleResolutionDownBy: 1, maxBitrate: 1_200_000, maxFramerate: 24 },
      { rid: RID.half, scaleResolutionDownBy: 2, maxBitrate: 400_000, maxFramerate: 24 },
      { rid: RID.quarter, scaleResolutionDownBy: 4, maxBitrate: 120_000, maxFramerate: 15 }
    ] as EncodingSpec[]
  },
  screen: {
    document: {
      width: 1920,
      height: 1080,
      frameRate: 10,
      contentHint: 'text' as const,
      encodings: [
        { rid: RID.full, scaleResolutionDownBy: 1, maxBitrate: 5_000_000, maxFramerate: 10 },
        { rid: RID.half, scaleResolutionDownBy: 1.5, maxBitrate: 1_500_000, maxFramerate: 5 }
      ] as EncodingSpec[]
    },
    video: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      contentHint: 'motion' as const,
      encodings: [
        { rid: RID.full, scaleResolutionDownBy: 1, maxBitrate: 7_000_000, maxFramerate: 30 },
        { rid: RID.half, scaleResolutionDownBy: 2, maxBitrate: 2_000_000, maxFramerate: 30 }
      ] as EncodingSpec[]
    }
  },
  audio: { channelCount: 1 }
} as const

/**
 * 월 무료 전송량 1,000GB 를 넘지 않도록 하는 참가자-분 예산.
 * 발표 모드 참가자 1명이 분당 약 45MB 를 받는다고 보고 여유를 둔 값이다.
 */
export const DEFAULT_MONTHLY_BUDGET_MINUTES = 20_000
