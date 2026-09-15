/** 회의 상태(참가자·채팅·잠금·모드) — 미디어 객체와 분리된 순수 상태 모델 */
import type { LayoutMode, MediaSource } from '@shared/constants'
import { MAX_PARTICIPANTS } from '@shared/constants'
import type { ChatMessage, Participant, ProducerInfo, RoomSnapshot } from '@shared/types'
import { generateId } from '../security/tokens'

const CHAT_HISTORY_LIMIT = 300

export type JoinDenial = 'ROOM_FULL' | 'ROOM_LOCKED'

export class Room {
  readonly id: string
  mode: LayoutMode
  locked = false
  readonly maxParticipants: number
  activeSpeakerId: string | null = null
  private readonly participants = new Map<string, Participant>()
  private readonly producers = new Map<string, ProducerInfo>()
  private readonly chat: ChatMessage[] = []
  readonly createdAt = Date.now()

  constructor(opts: { mode: LayoutMode; maxParticipants?: number; id?: string }) {
    this.id = opts.id ?? generateId(6)
    this.mode = opts.mode
    this.maxParticipants = Math.min(opts.maxParticipants ?? MAX_PARTICIPANTS, MAX_PARTICIPANTS)
  }

  get size(): number {
    return this.participants.size
  }

  /** 서버에서 인원·잠금을 강제한다 (UI 제한에 의존하지 않음) */
  canJoin(isHost: boolean, resuming: boolean): JoinDenial | null {
    if (resuming) return null
    if (!isHost && this.locked) return 'ROOM_LOCKED'
    if (this.participants.size >= this.maxParticipants) return 'ROOM_FULL'
    return null
  }

  add(p: Participant): void {
    this.participants.set(p.id, p)
  }

  get(id: string): Participant | undefined {
    return this.participants.get(id)
  }

  has(id: string): boolean {
    return this.participants.has(id)
  }

  update(id: string, patch: Partial<Participant>): Participant | null {
    const cur = this.participants.get(id)
    if (!cur) return null
    const next = { ...cur, ...patch, id: cur.id, isHost: cur.isHost }
    this.participants.set(id, next)
    return next
  }

  remove(id: string): Participant | null {
    const p = this.participants.get(id) ?? null
    this.participants.delete(id)
    for (const [pid, info] of this.producers) if (info.participantId === id) this.producers.delete(pid)
    if (this.activeSpeakerId === id) this.activeSpeakerId = null
    return p
  }

  list(): Participant[] {
    return [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)
  }

  addProducer(info: ProducerInfo): void {
    this.producers.set(info.producerId, info)
    if (info.source === 'screen') this.update(info.participantId, { sharingScreen: true })
  }

  removeProducer(producerId: string): ProducerInfo | null {
    const info = this.producers.get(producerId) ?? null
    this.producers.delete(producerId)
    if (info?.source === 'screen') this.update(info.participantId, { sharingScreen: false })
    return info
  }

  setProducerPaused(producerId: string, paused: boolean): void {
    const info = this.producers.get(producerId)
    if (info) this.producers.set(producerId, { ...info, paused })
  }

  getProducer(producerId: string): ProducerInfo | undefined {
    return this.producers.get(producerId)
  }

  producersOf(participantId: string, source?: MediaSource): ProducerInfo[] {
    return [...this.producers.values()].filter((p) => p.participantId === participantId && (!source || p.source === source))
  }

  listProducers(): ProducerInfo[] {
    return [...this.producers.values()]
  }

  addChat(participantId: string, displayName: string, text: string, system = false): ChatMessage {
    const msg: ChatMessage = { id: generateId(6), participantId, displayName, text, ts: Date.now(), system }
    this.chat.push(msg)
    if (this.chat.length > CHAT_HISTORY_LIMIT) this.chat.splice(0, this.chat.length - CHAT_HISTORY_LIMIT)
    return msg
  }

  chatHistory(): ChatMessage[] {
    return [...this.chat]
  }

  /** 회의 종료 시 채팅 등 메모리 내용을 즉시 제거 (계획서 9장) */
  destroy(): void {
    this.chat.length = 0
    this.participants.clear()
    this.producers.clear()
  }

  snapshot(): RoomSnapshot {
    return {
      roomId: this.id,
      mode: this.mode,
      locked: this.locked,
      maxParticipants: this.maxParticipants,
      participants: this.list(),
      producers: this.listProducers(),
      activeSpeakerId: this.activeSpeakerId
    }
  }
}
