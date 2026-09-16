/** 앱 화면 전환·설정 스토어 */
import { create } from 'zustand'
import type { AppSettings, InvitePayload } from '@shared/types'

export type Screen = 'home' | 'create' | 'join' | 'meeting' | 'settings'

export interface AppState {
  screen: Screen
  settings: AppSettings | null
  /** 딥링크 또는 붙여넣기로 해석된 초대 */
  pendingInvite: InvitePayload | null
  pendingInviteRaw: string | null
  version: string
}

export interface AppActions {
  go: (s: Screen) => void
  setSettings: (s: AppSettings) => void
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  setPendingInvite: (p: InvitePayload | null, raw?: string | null) => void
  setVersion: (v: string) => void
}

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  screen: 'home',
  settings: null,
  pendingInvite: null,
  pendingInviteRaw: null,
  version: '',
  go: (screen) => set({ screen }),
  setSettings: (settings) => set({ settings }),
  updateSettings: async (patch) => {
    const next = await window.sjting.settings.set(patch)
    set({ settings: next })
  },
  setPendingInvite: (pendingInvite, raw = null) => set({ pendingInvite, pendingInviteRaw: raw ?? get().pendingInviteRaw }),
  setVersion: (version) => set({ version })
}))
