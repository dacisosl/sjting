/** 회의 상태 스토어 (zustand) — MeetingClient 가 갱신하고 UI 가 구독한다 */
import { create } from 'zustand'
import type { LayoutMode } from '@shared/constants'
import type { ChatMessage, NetworkQuality, Participant, ProducerInfo } from '@shared/types'

export type MeetingPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended'

export interface LocalMedia {
  mic: MediaStreamTrack | null
  camera: MediaStreamTrack | null
  screen: MediaStreamTrack | null
  screenAudio: MediaStreamTrack | null
}

export interface RemoteConsumerState {
  consumerId: string
  producerId: string
  participantId: string
  kind: 'audio' | 'video'
  source: ProducerInfo['source']
  track: MediaStreamTrack
  paused: boolean
  spatialLayer: number | null
}

export interface MeetingState {
  phase: MeetingPhase
  endedReason: string | null
  error: string | null
  me: { participantId: string; isHost: boolean; displayName: string } | null
  roomId: string | null
  mode: LayoutMode
  locked: boolean
  maxParticipants: number
  participants: Participant[]
  producers: ProducerInfo[]
  activeSpeakerId: string | null
  recentSpeakers: string[]
  chat: ChatMessage[]
  unreadChat: number
  local: LocalMedia
  micMuted: boolean
  camOff: boolean
  sharing: boolean
  consumers: Record<string, RemoteConsumerState>
  quality: NetworkQuality
  /** 화면에 보이는 참가자 타일 */
  visibleParticipantIds: string[]
  sidePanel: 'none' | 'chat' | 'participants'
  toastMsg: { id: number; text: string; kind: 'info' | 'warn' | 'error' } | null
}

export interface MeetingActions {
  set: (patch: Partial<MeetingState> | ((s: MeetingState) => Partial<MeetingState>)) => void
  reset: () => void
  upsertParticipant: (p: Participant) => void
  patchParticipant: (id: string, patch: Partial<Participant>) => void
  removeParticipant: (id: string) => void
  addProducer: (p: ProducerInfo) => void
  removeProducer: (producerId: string) => void
  setProducerPaused: (producerId: string, paused: boolean) => void
  addChat: (m: ChatMessage) => void
  setConsumer: (c: RemoteConsumerState) => void
  patchConsumer: (consumerId: string, patch: Partial<RemoteConsumerState>) => void
  removeConsumer: (consumerId: string) => void
  setVisible: (participantId: string, visible: boolean) => void
  toast: (text: string, kind?: 'info' | 'warn' | 'error') => void
  setSidePanel: (p: MeetingState['sidePanel']) => void
}

const initial: MeetingState = {
  phase: 'idle',
  endedReason: null,
  error: null,
  me: null,
  roomId: null,
  mode: 'presentation',
  locked: false,
  maxParticipants: 20,
  participants: [],
  producers: [],
  activeSpeakerId: null,
  recentSpeakers: [],
  chat: [],
  unreadChat: 0,
  local: { mic: null, camera: null, screen: null, screenAudio: null },
  micMuted: true,
  camOff: true,
  sharing: false,
  consumers: {},
  quality: { rtt: null, packetLossPct: null, uploadBps: 0, downloadBps: 0, level: 'unknown' },
  visibleParticipantIds: [],
  sidePanel: 'none',
  toastMsg: null
}

let toastSeq = 0

export const useMeetingStore = create<MeetingState & MeetingActions>((set, get) => ({
  ...initial,
  set: (patch) => set(typeof patch === 'function' ? patch : () => patch),
  reset: () => set({ ...initial, consumers: {}, local: { mic: null, camera: null, screen: null, screenAudio: null } }),
  upsertParticipant: (p) =>
    set((s) => ({ participants: s.participants.some((x) => x.id === p.id) ? s.participants.map((x) => (x.id === p.id ? p : x)) : [...s.participants, p] })),
  patchParticipant: (id, patch) => set((s) => ({ participants: s.participants.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  removeParticipant: (id) =>
    set((s) => ({
      participants: s.participants.filter((x) => x.id !== id),
      producers: s.producers.filter((p) => p.participantId !== id),
      recentSpeakers: s.recentSpeakers.filter((x) => x !== id),
      activeSpeakerId: s.activeSpeakerId === id ? null : s.activeSpeakerId
    })),
  addProducer: (p) => set((s) => ({ producers: [...s.producers.filter((x) => x.producerId !== p.producerId), p] })),
  removeProducer: (producerId) => set((s) => ({ producers: s.producers.filter((x) => x.producerId !== producerId) })),
  setProducerPaused: (producerId, paused) =>
    set((s) => ({ producers: s.producers.map((x) => (x.producerId === producerId ? { ...x, paused } : x)) })),
  addChat: (m) =>
    set((s) => ({
      chat: [...s.chat.slice(-299), m],
      unreadChat: s.sidePanel === 'chat' || m.participantId === s.me?.participantId ? 0 : s.unreadChat + 1
    })),
  setConsumer: (c) => set((s) => ({ consumers: { ...s.consumers, [c.consumerId]: c } })),
  patchConsumer: (consumerId, patch) =>
    set((s) => (s.consumers[consumerId] ? { consumers: { ...s.consumers, [consumerId]: { ...s.consumers[consumerId], ...patch } } } : {})),
  removeConsumer: (consumerId) =>
    set((s) => {
      const next = { ...s.consumers }
      delete next[consumerId]
      return { consumers: next }
    }),
  setVisible: (participantId, visible) =>
    set((s) => {
      const has = s.visibleParticipantIds.includes(participantId)
      if (visible === has) return {}
      return { visibleParticipantIds: visible ? [...s.visibleParticipantIds, participantId] : s.visibleParticipantIds.filter((x) => x !== participantId) }
    }),
  toast: (text, kind = 'info') => {
    const id = ++toastSeq
    set({ toastMsg: { id, text, kind } })
    setTimeout(() => {
      if (get().toastMsg?.id === id) set({ toastMsg: null })
    }, 4000)
  },
  setSidePanel: (p) => set((s) => ({ sidePanel: p, unreadChat: p === 'chat' ? 0 : s.unreadChat }))
}))
