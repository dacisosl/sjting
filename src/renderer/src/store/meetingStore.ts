/** 회의 상태 스토어 (zustand) — MeetingClient 가 갱신하고 UI 가 구독한다 */
import { create } from 'zustand'
import type { LayoutMode } from '@shared/constants'
import type { ChatMessage, NetworkQuality, Participant } from '@shared/types'

export type MeetingPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended'

export interface LocalMedia {
  /** 자기 화면 미리보기용 카메라 트랙 */
  camera: MediaStreamTrack | null
  screen: MediaStreamTrack | null
}

export interface MeetingState {
  phase: MeetingPhase
  endedReason: string | null
  error: string | null
  me: { participantId: string; isHost: boolean; displayName: string } | null
  serverUrl: string | null
  roomId: string | null
  /** 방장에게만: 현재 초대 토큰 */
  invite: { token: string; expiresAt: number } | null
  mode: LayoutMode
  locked: boolean
  maxParticipants: number
  participants: Participant[]
  activeSpeakerId: string | null
  recentSpeakers: string[]
  chat: ChatMessage[]
  unreadChat: number
  local: LocalMedia
  micOn: boolean
  micMuted: boolean
  camOn: boolean
  sharing: boolean
  /** `${participantId}:${source}` → 수신 중인 원격 트랙 */
  remoteTracks: Record<string, MediaStreamTrack>
  quality: NetworkQuality
  mediaState: RTCPeerConnectionState | 'new'
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
  addChat: (m: ChatMessage) => void
  setRemoteTrack: (key: string, track: MediaStreamTrack | null) => void
  setVisible: (participantId: string, visible: boolean) => void
  toast: (text: string, kind?: 'info' | 'warn' | 'error') => void
  setSidePanel: (p: MeetingState['sidePanel']) => void
}

const initial: MeetingState = {
  phase: 'idle',
  endedReason: null,
  error: null,
  me: null,
  serverUrl: null,
  roomId: null,
  invite: null,
  mode: 'presentation',
  locked: false,
  maxParticipants: 20,
  participants: [],
  activeSpeakerId: null,
  recentSpeakers: [],
  chat: [],
  unreadChat: 0,
  local: { camera: null, screen: null },
  micOn: false,
  micMuted: true,
  camOn: false,
  sharing: false,
  remoteTracks: {},
  quality: { rtt: null, packetLossPct: null, uploadBps: 0, downloadBps: 0, level: 'unknown' },
  mediaState: 'new',
  visibleParticipantIds: [],
  sidePanel: 'none',
  toastMsg: null
}

let toastSeq = 0

export const useMeetingStore = create<MeetingState & MeetingActions>((set, get) => ({
  ...initial,
  set: (patch) => set(typeof patch === 'function' ? patch : () => patch),
  reset: () => set({ ...initial, remoteTracks: {}, local: { camera: null, screen: null } }),
  upsertParticipant: (p) =>
    set((s) => ({ participants: s.participants.some((x) => x.id === p.id) ? s.participants.map((x) => (x.id === p.id ? p : x)) : [...s.participants, p] })),
  patchParticipant: (id, patch) => set((s) => ({ participants: s.participants.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  removeParticipant: (id) =>
    set((s) => ({
      participants: s.participants.filter((x) => x.id !== id),
      recentSpeakers: s.recentSpeakers.filter((x) => x !== id),
      activeSpeakerId: s.activeSpeakerId === id ? null : s.activeSpeakerId
    })),
  addChat: (m) =>
    set((s) => ({
      chat: [...s.chat.slice(-299), m],
      unreadChat: s.sidePanel === 'chat' || m.participantId === s.me?.participantId ? 0 : s.unreadChat + 1
    })),
  setRemoteTrack: (key, track) =>
    set((s) => {
      const next = { ...s.remoteTracks }
      if (track) next[key] = track
      else delete next[key]
      return { remoteTracks: next }
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
