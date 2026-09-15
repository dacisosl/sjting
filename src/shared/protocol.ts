/**
 * 시그널링 메시지 스키마 (계획서 8장: 모든 입력 스키마 검증)
 * 클라이언트 → 서버 요청은 zod 로 엄격 검증하고,
 * 서버 → 클라이언트 응답/이벤트는 TS 타입으로 정의한다.
 */
import { z } from 'zod'
import { CHAT_MAX_LENGTH, DISPLAY_NAME_MAX, type LayoutMode } from './constants'
import type { ChatMessage, Participant, ProducerInfo, RoomSnapshot } from './types'

const anyRecord = z.record(z.string(), z.unknown())
const id = z.string().min(1).max(64)

export const LayoutModeSchema = z.enum(['presentation', 'conversation', 'grid', 'lowbandwidth'])
export const MediaSourceSchema = z.enum(['mic', 'camera', 'screen', 'screenAudio'])

export const RequestSchemas = {
  join: z.object({
    token: z.string().min(16).max(128),
    displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX),
    resume: z.object({ participantId: id, resumeKey: z.string().min(16).max(128) }).optional()
  }),
  /** recv 방향은 Device 로딩 후의 rtpCapabilities 를 함께 보낸다 */
  createTransport: z.object({ direction: z.enum(['send', 'recv']), rtpCapabilities: anyRecord.optional() }),
  connectTransport: z.object({ transportId: id, dtlsParameters: anyRecord }),
  restartIce: z.object({ transportId: id }),
  produce: z.object({
    transportId: id,
    kind: z.enum(['audio', 'video']),
    rtpParameters: anyRecord,
    source: MediaSourceSchema
  }),
  closeProducer: z.object({ producerId: id }),
  pauseProducer: z.object({ producerId: id }),
  resumeProducer: z.object({ producerId: id }),
  consume: z.object({ producerId: id }),
  pauseConsumer: z.object({ consumerId: id }),
  resumeConsumer: z.object({ consumerId: id }),
  setConsumerLayers: z.object({
    consumerId: id,
    spatialLayer: z.number().int().min(0).max(3),
    temporalLayer: z.number().int().min(0).max(3).optional()
  }),
  chat: z.object({ text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) }),
  updateSelf: z.object({
    micMuted: z.boolean().optional(),
    camOff: z.boolean().optional(),
    handRaised: z.boolean().optional()
  }),
  // ----- 방장 전용 -----
  kick: z.object({ participantId: id }),
  muteAll: z.object({}),
  setLock: z.object({ locked: z.boolean() }),
  setMode: z.object({ mode: LayoutModeSchema }),
  closeRoom: z.object({}),
  // -----
  leave: z.object({})
} as const

export type RequestMethod = keyof typeof RequestSchemas
export type RequestData<M extends RequestMethod> = z.infer<(typeof RequestSchemas)[M]>

export const HOST_ONLY_METHODS: ReadonlySet<RequestMethod> = new Set<RequestMethod>([
  'kick',
  'muteAll',
  'setLock',
  'setMode',
  'closeRoom'
])

/** 클라이언트가 보내는 봉투 */
export const ClientEnvelopeSchema = z.object({
  id: z.number().int().nonnegative(),
  method: z.string().min(1).max(40),
  data: z.unknown()
})
export type ClientEnvelope = z.infer<typeof ClientEnvelopeSchema>

export interface TransportParams {
  id: string
  iceParameters: unknown
  iceCandidates: unknown[]
  dtlsParameters: unknown
}

export interface ConsumerParams {
  consumerId: string
  producerId: string
  participantId: string
  kind: 'audio' | 'video'
  source: ProducerInfo['source']
  rtpParameters: unknown
  producerPaused: boolean
}

export interface ResponseMap {
  join: {
    participantId: string
    resumeKey: string
    isHost: boolean
    routerRtpCapabilities: unknown
    room: RoomSnapshot
    chatHistory: ChatMessage[]
  }
  createTransport: TransportParams
  connectTransport: Record<string, never>
  restartIce: { iceParameters: unknown }
  produce: { producerId: string }
  closeProducer: Record<string, never>
  pauseProducer: Record<string, never>
  resumeProducer: Record<string, never>
  consume: ConsumerParams
  pauseConsumer: Record<string, never>
  resumeConsumer: Record<string, never>
  setConsumerLayers: Record<string, never>
  chat: { id: string }
  updateSelf: Record<string, never>
  kick: Record<string, never>
  muteAll: Record<string, never>
  setLock: Record<string, never>
  setMode: Record<string, never>
  closeRoom: Record<string, never>
  leave: Record<string, never>
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ROOM_FULL'
  | 'ROOM_LOCKED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'INVITE_EXPIRED'

export type ServerResponse =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: { code: ErrorCode; message: string } }

export interface EventMap {
  participantJoined: { participant: Participant }
  participantLeft: { participantId: string; reason: 'left' | 'kicked' | 'timeout' | 'error' }
  participantUpdated: { participantId: string; patch: Partial<Participant> }
  newProducer: ProducerInfo
  producerClosed: { participantId: string; producerId: string }
  producerPaused: { producerId: string }
  producerResumed: { producerId: string }
  consumerClosed: { consumerId: string }
  consumerPaused: { consumerId: string }
  consumerResumed: { consumerId: string }
  consumerLayersChanged: { consumerId: string; spatialLayer: number | null; temporalLayer: number | null }
  activeSpeaker: { participantId: string | null }
  chat: ChatMessage
  roomUpdated: { locked?: boolean; mode?: LayoutMode }
  kicked: { reason: string }
  roomClosed: { reason: string }
  /** 서버가 알려주는 참가자 개인의 네트워크 점수 (0~10) */
  transportScore: { transportId: string; score: number }
}

export type EventName = keyof EventMap

export type ServerEvent<E extends EventName = EventName> = { event: E; data: EventMap[E] }

export type ServerMessage = ServerResponse | ServerEvent

export function isServerEvent(msg: ServerMessage): msg is ServerEvent {
  return typeof (msg as ServerEvent).event === 'string'
}
