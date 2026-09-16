/**
 * 시그널링 메시지 스키마 v2 — 클라이언트 ↔ 회의 서버(Durable Object) WebSocket
 * 클라이언트 → 서버 요청은 zod 로 엄격 검증하고, 서버 → 클라이언트 응답/이벤트는 TS 타입으로 정의한다.
 * 미디어 협상은 Cloudflare Realtime SFU 가 담당하므로 여기서는 참가자 상태·트랙 참조·채팅만 다룬다.
 */
import { z } from 'zod'
import { CHAT_MAX_LENGTH, DISPLAY_NAME_MAX, type LayoutMode } from './constants'
import type { ChatMessage, Participant, RoomSnapshot } from './types'

const id = z.string().min(1).max(64)

export const LayoutModeSchema = z.enum(['presentation', 'conversation', 'grid', 'lowbandwidth'])
export const MediaSourceSchema = z.enum(['mic', 'camera', 'screen', 'screenAudio'])

export const TrackRefSchema = z.object({
  sessionId: z.string().min(1).max(128),
  trackName: z.string().min(1).max(128)
})

export const TracksPatchSchema = z.object({
  mic: TrackRefSchema.nullable().optional(),
  camera: TrackRefSchema.nullable().optional(),
  screen: TrackRefSchema.nullable().optional(),
  screenAudio: TrackRefSchema.nullable().optional()
})

export const RequestSchemas = {
  join: z.object({
    token: z.string().min(16).max(128),
    displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX),
    resume: z.object({ participantId: id, resumeKey: z.string().min(16).max(128) }).optional()
  }),
  /** 내가 SFU 에 올린 트랙 참조를 알린다. null 은 트랙 제거 */
  setTracks: TracksPatchSchema,
  updateSelf: z.object({
    micMuted: z.boolean().optional(),
    camOff: z.boolean().optional(),
    handRaised: z.boolean().optional(),
    speaking: z.boolean().optional()
  }),
  chat: z.object({ text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) }),
  ping: z.object({}),
  // ----- 방장 전용 -----
  kick: z.object({ participantId: id }),
  muteAll: z.object({}),
  setLock: z.object({ locked: z.boolean() }),
  setMode: z.object({ mode: LayoutModeSchema }),
  rotateInvite: z.object({}),
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
  'rotateInvite',
  'closeRoom'
])

/** 클라이언트가 보내는 봉투 */
export const ClientEnvelopeSchema = z.object({
  id: z.number().int().nonnegative(),
  method: z.string().min(1).max(40),
  data: z.unknown()
})
export type ClientEnvelope = z.infer<typeof ClientEnvelopeSchema>

export interface ResponseMap {
  join: {
    participantId: string
    resumeKey: string
    isHost: boolean
    /** /partytracks 프록시에 쓰는 입장권 (Authorization: Bearer) */
    ticket: string
    room: RoomSnapshot
    chatHistory: ChatMessage[]
  }
  setTracks: Record<string, never>
  updateSelf: Record<string, never>
  chat: { id: string }
  ping: { serverTime: number }
  kick: Record<string, never>
  muteAll: Record<string, never>
  setLock: Record<string, never>
  setMode: Record<string, never>
  rotateInvite: { token: string; expiresAt: number }
  closeRoom: Record<string, never>
  leave: Record<string, never>
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ROOM_FULL'
  | 'ROOM_LOCKED'
  | 'ROOM_CLOSED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'INTERNAL'
  | 'INVITE_EXPIRED'

export type ServerResponse =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: { code: ErrorCode; message: string } }

export interface EventMap {
  participantJoined: { participant: Participant }
  participantLeft: { participantId: string; reason: 'left' | 'kicked' | 'timeout' | 'error' }
  participantUpdated: { participantId: string; patch: Partial<Participant> }
  activeSpeaker: { participantId: string | null }
  chat: ChatMessage
  roomUpdated: { locked?: boolean; mode?: LayoutMode }
  /** 방장에게만 */
  inviteRotated: { token: string; expiresAt: number }
  kicked: { reason: string }
  roomClosed: { reason: string }
}

export type EventName = keyof EventMap

export type ServerEvent<E extends EventName = EventName> = { event: E; data: EventMap[E] }

export type ServerMessage = ServerResponse | ServerEvent

export function isServerEvent(msg: ServerMessage): msg is ServerEvent {
  return typeof (msg as ServerEvent).event === 'string'
}

/** 방 생성 요청 (POST /api/rooms) */
export const CreateRoomSchema = z.object({
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX),
  mode: LayoutModeSchema.default('presentation'),
  inviteTtlSec: z.number().int().min(60).max(7 * 24 * 3600).optional()
})
export type CreateRoomRequest = z.infer<typeof CreateRoomSchema>
