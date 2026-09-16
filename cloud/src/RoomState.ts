/** 회의 상태 — Durable Object 저장소에 JSON 으로 통째로 보관되는 순수 모델. 테스트 가능. */
import type { LayoutMode } from '../../src/shared/constants'
import { MAX_PARTICIPANTS, MEDIA_SOURCES } from '../../src/shared/constants'
import type { ChatMessage, Participant, ParticipantTracks, RoomSnapshot, TrackRef } from '../../src/shared/types'

const CHAT_HISTORY_LIMIT = 300

export type JoinDenial = 'ROOM_FULL' | 'ROOM_LOCKED' | 'ROOM_CLOSED'

export interface RoomMeta {
  id: string
  mode: LayoutMode
  locked: boolean
  closed: boolean
  createdAt: number
  maxParticipants: number
  hostTokenHash: string
  inviteTokenHash: string
  inviteExpiresAt: number
  inviteTtlSec: number
}

export interface RoomStateJSON {
  meta: RoomMeta
  participants: Participant[]
  /** participantId → resumeKey 해시 */
  resumeKeyHashes: Record<string, string>
  /** participantId → 재접속 대기 만료(ms) */
  pendingLeave: Record<string, number>
  chat: ChatMessage[]
  activeSpeakerId: string | null
  /** 방장이 마지막으로 연결되어 있던 시각(ms) */
  hostLastSeen: number
  /** 참가자가 0명이 된 시각(ms). 누군가 있으면 null */
  emptySince: number | null
}

let seq = 0
function shortId(): string {
  seq = (seq + 1) % 1_000_000
  const b = new Uint8Array(4)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('') + seq.toString(36)
}

export class RoomState {
  meta: RoomMeta
  private participants = new Map<string, Participant>()
  resumeKeyHashes = new Map<string, string>()
  pendingLeave = new Map<string, number>()
  private chat: ChatMessage[] = []
  activeSpeakerId: string | null = null
  hostLastSeen: number
  emptySince: number | null

  constructor(meta: RoomMeta) {
    this.meta = { ...meta, maxParticipants: Math.min(meta.maxParticipants, MAX_PARTICIPANTS) }
    this.hostLastSeen = meta.createdAt
    this.emptySince = meta.createdAt
  }

  static fromJSON(j: RoomStateJSON): RoomState {
    const s = new RoomState(j.meta)
    for (const p of j.participants) s.participants.set(p.id, p)
    s.resumeKeyHashes = new Map(Object.entries(j.resumeKeyHashes))
    s.pendingLeave = new Map(Object.entries(j.pendingLeave))
    s.chat = j.chat
    s.activeSpeakerId = j.activeSpeakerId
    s.hostLastSeen = j.hostLastSeen
    s.emptySince = j.emptySince
    return s
  }

  toJSON(): RoomStateJSON {
    return {
      meta: this.meta,
      participants: [...this.participants.values()],
      resumeKeyHashes: Object.fromEntries(this.resumeKeyHashes),
      pendingLeave: Object.fromEntries(this.pendingLeave),
      chat: this.chat,
      activeSpeakerId: this.activeSpeakerId,
      hostLastSeen: this.hostLastSeen,
      emptySince: this.emptySince
    }
  }

  get size(): number {
    return this.participants.size
  }

  /** 서버에서 인원·잠금·종료를 강제한다 */
  canJoin(isHost: boolean, resuming: boolean): JoinDenial | null {
    if (this.meta.closed) return 'ROOM_CLOSED'
    if (resuming) return null
    if (!isHost && this.meta.locked) return 'ROOM_LOCKED'
    if (this.participants.size >= this.meta.maxParticipants) return 'ROOM_FULL'
    return null
  }

  createParticipant(displayName: string, isHost: boolean, now = Date.now()): Participant {
    const p: Participant = {
      id: shortId(),
      displayName,
      isHost,
      micMuted: true,
      camOff: true,
      handRaised: false,
      sharingScreen: false,
      speaking: false,
      connection: 'connected',
      joinedAt: now,
      tracks: {}
    }
    this.participants.set(p.id, p)
    this.emptySince = null
    if (isHost) this.hostLastSeen = now
    return p
  }

  get(id: string): Participant | undefined {
    return this.participants.get(id)
  }

  update(id: string, patch: Partial<Participant>): Participant | null {
    const cur = this.participants.get(id)
    if (!cur) return null
    const next: Participant = { ...cur, ...patch, id: cur.id, isHost: cur.isHost, tracks: patch.tracks ?? cur.tracks }
    this.participants.set(id, next)
    return next
  }

  /** 트랙 참조 갱신. null 이면 제거. 변경된 필드만 반환 */
  setTracks(id: string, patch: ParticipantTracks): Partial<Participant> | null {
    const cur = this.participants.get(id)
    if (!cur) return null
    const tracks: ParticipantTracks = { ...cur.tracks }
    for (const src of MEDIA_SOURCES) {
      if (!(src in patch)) continue
      const v = patch[src] as TrackRef | null | undefined
      if (v) tracks[src] = v
      else delete tracks[src]
    }
    const out: Partial<Participant> = { tracks }
    const sharing = !!tracks.screen
    if (sharing !== cur.sharingScreen) out.sharingScreen = sharing
    if ('camera' in patch) out.camOff = !tracks.camera
    this.participants.set(id, { ...cur, ...out })
    return out
  }

  remove(id: string, now = Date.now()): Participant | null {
    const p = this.participants.get(id) ?? null
    this.participants.delete(id)
    this.resumeKeyHashes.delete(id)
    this.pendingLeave.delete(id)
    if (this.activeSpeakerId === id) this.activeSpeakerId = null
    if (this.participants.size === 0) this.emptySince = now
    return p
  }

  list(): Participant[] {
    return [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)
  }

  host(): Participant | undefined {
    return [...this.participants.values()].find((p) => p.isHost)
  }

  /** speaking 플래그를 기준으로 현재 발언자를 갱신. 바뀌었으면 true */
  recomputeActiveSpeaker(): boolean {
    const speaking = this.list().filter((p) => p.speaking && p.connection === 'connected')
    let next: string | null
    if (speaking.length === 0) next = null
    else if (this.activeSpeakerId && speaking.some((p) => p.id === this.activeSpeakerId)) next = this.activeSpeakerId
    else next = speaking[0].id
    if (next === this.activeSpeakerId) return false
    this.activeSpeakerId = next
    return true
  }

  addChat(participantId: string, displayName: string, text: string, system = false, now = Date.now()): ChatMessage {
    const msg: ChatMessage = { id: shortId(), participantId, displayName, text, ts: now, system }
    this.chat.push(msg)
    if (this.chat.length > CHAT_HISTORY_LIMIT) this.chat.splice(0, this.chat.length - CHAT_HISTORY_LIMIT)
    return msg
  }

  chatHistory(): ChatMessage[] {
    return [...this.chat]
  }

  snapshot(forHost: boolean): RoomSnapshot {
    return {
      roomId: this.meta.id,
      mode: this.meta.mode,
      locked: this.meta.locked,
      maxParticipants: this.meta.maxParticipants,
      participants: this.list(),
      activeSpeakerId: this.activeSpeakerId,
      invite: forHost ? { token: '', expiresAt: this.meta.inviteExpiresAt } : null
    }
  }

  /** 회의 종료: 채팅 등 메모리 내용을 즉시 제거 */
  destroy(): void {
    this.chat.length = 0
    this.participants.clear()
    this.resumeKeyHashes.clear()
    this.pendingLeave.clear()
    this.meta.closed = true
  }
}
