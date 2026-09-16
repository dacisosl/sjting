import type { LayoutMode, MediaSource } from './constants'

/** Cloudflare Realtime SFU 트랙 참조 — 다른 참가자가 pull 할 때 필요한 최소 정보 */
export interface TrackRef {
  sessionId: string
  trackName: string
}

export type ParticipantTracks = Partial<Record<MediaSource, TrackRef | null>>

export interface Participant {
  id: string
  displayName: string
  isHost: boolean
  micMuted: boolean
  camOff: boolean
  handRaised: boolean
  sharingScreen: boolean
  speaking: boolean
  /** 재접속 대기 중이면 'reconnecting' */
  connection: 'connected' | 'reconnecting'
  joinedAt: number
  tracks: ParticipantTracks
}

export interface RoomSnapshot {
  roomId: string
  mode: LayoutMode
  locked: boolean
  maxParticipants: number
  participants: Participant[]
  activeSpeakerId: string | null
  /** 방장에게만 채워짐 */
  invite: { token: string; expiresAt: number } | null
}

export interface ChatMessage {
  id: string
  participantId: string
  displayName: string
  text: string
  ts: number
  /** 시스템 안내 메시지 */
  system?: boolean
}

export interface InvitePayload {
  version: number
  /** 회의 서버 origin, 예: https://sjting-server.example.workers.dev */
  serverUrl: string
  roomId: string
  /** base64url 토큰 (128비트 이상) */
  token: string
  /** UNIX 초. 0 이면 만료 없음 */
  expiresAt: number
}

export interface InviteBundle {
  code: string
  link: string
  payload: InvitePayload
}

export interface AppSettings {
  displayName: string
  preferredMicId: string | null
  preferredCameraId: string | null
  preferredSpeakerId: string | null
  serverUrl: string
  defaultMode: LayoutMode
  screenPreset: 'document' | 'video'
  acceptedNotice: boolean
}

export interface ScreenSourceInfo {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnailDataUrl: string
  appIconDataUrl: string | null
}

export interface NetworkQuality {
  rtt: number | null
  packetLossPct: number | null
  uploadBps: number
  downloadBps: number
  level: 'good' | 'fair' | 'poor' | 'unknown'
}

/** POST /api/rooms 응답 */
export interface CreateRoomResponse {
  roomId: string
  hostToken: string
  inviteToken: string
  inviteExpiresAt: number
}

/** GET /api/health 응답 */
export interface ServerHealth {
  ok: boolean
  version: string
  /** 이 서버가 지원하는 설치형 앱 최소 버전 (더 낮으면 업데이트 안내) */
  minAppVersion: string
  maxParticipants: number
  /** 이번 달 사용한 참가자-분과 예산 */
  usage: { usedMinutes: number; budgetMinutes: number; month: string }
}
