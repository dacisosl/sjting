import type { LayoutMode, MediaSource } from './constants'

export interface Participant {
  id: string
  displayName: string
  isHost: boolean
  micMuted: boolean
  camOff: boolean
  handRaised: boolean
  sharingScreen: boolean
  /** 재접속 대기 중이면 'reconnecting' */
  connection: 'connected' | 'reconnecting'
  joinedAt: number
}

export interface ProducerInfo {
  producerId: string
  participantId: string
  kind: 'audio' | 'video'
  source: MediaSource
  paused: boolean
}

export interface RoomSnapshot {
  roomId: string
  mode: LayoutMode
  locked: boolean
  maxParticipants: number
  participants: Participant[]
  producers: ProducerInfo[]
  activeSpeakerId: string | null
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

export type InviteAddressType = 'public' | 'lan'

export interface InvitePayload {
  version: number
  type: InviteAddressType
  ip: string
  signalingPort: number
  mediaPort: number
  /** base64url 토큰 (128비트 이상) */
  token: string
  /** 방장 인증서 SHA-256 지문 (base64) */
  certFingerprint: string
  /** UNIX 초 */
  expiresAt: number
}

export interface InviteBundle {
  code: string
  link: string
  payload: InvitePayload
}

export type DiagnosticLevel = 'green' | 'yellow' | 'red' | 'gray' | 'pending' | 'skipped'

export interface DiagnosticStep {
  key: DiagnosticStepKey
  title: string
  level: DiagnosticLevel
  detail: string
}

export type DiagnosticStepKey =
  | 'local'
  | 'publicIp'
  | 'cgnat'
  | 'upnp'
  | 'portMap'
  | 'firewall'
  | 'reachability'
  | 'bandwidth'
  | 'recommendation'

export interface DiagnosticResult {
  startedAt: number
  finishedAt: number
  steps: DiagnosticStep[]
  overall: DiagnosticLevel
  summary: string
  localIp: string | null
  gatewayIp: string | null
  publicIp: string | null
  upnpExternalIp: string | null
  cgnatSuspected: boolean
  upnpAvailable: boolean
  ports: { signaling: number; media: number }
  recommendedMaxParticipants: number
  recommendedMode: LayoutMode
  /** 이전 회의에서 측정된 업로드 (Mbps). 없으면 null */
  lastMeasuredUploadMbps: number | null
}

export interface HostStatus {
  running: boolean
  roomId: string | null
  signalingPort: number | null
  mediaPort: number | null
  publicIp: string | null
  lanIp: string | null
  addressType: InviteAddressType | null
  participantCount: number
  invite: InviteBundle | null
  hostToken: string | null
  certFingerprint: string | null
  upnpMapped: boolean
  startedAt: number | null
  stats: HostStats | null
  lastError: string | null
}

export interface HostStats {
  ts: number
  uploadBps: number
  downloadBps: number
  workerAlive: boolean
  transports: number
  producers: number
  consumers: number
  /** 최근 측정 최대 업로드 (Mbps) */
  peakUploadMbps: number
}

export interface AppSettings {
  displayName: string
  preferredMicId: string | null
  preferredCameraId: string | null
  preferredSpeakerId: string | null
  signalingPort: number
  mediaPort: number
  inviteTtlSec: number
  defaultMode: LayoutMode
  screenPreset: 'document' | 'video'
  acceptedNotice: boolean
  lastMeasuredUploadMbps: number | null
  lastDiagnosticAt: number | null
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
