/**
 * 플랫폼 어댑터 — 화면·회의 코드는 이 인터페이스만 사용한다.
 *  - Electron: preload 가 노출한 window.sjting 로 위임
 *  - Web: localStorage·브라우저 API 로 구현 (설치 없이 링크만으로 참가)
 * 두 플랫폼은 같은 서버·같은 방을 쓰므로 한 회의에 섞여 들어올 수 있다.
 */
import type { SjtingApi, Unsubscribe } from '@shared/ipc'
import { decodeInvite } from '@shared/invite'
import { buildSettingsSchema, mergeSettings } from '@shared/settingsSchema'
import type { AppSettings, InvitePayload, ScreenSourceInfo } from '@shared/types'

export type PlatformKind = 'electron' | 'web'

export interface Platform {
  kind: PlatformKind
  /** 설치형 앱에서만 true. 화면 소스 선택 창을 앱이 직접 그린다 */
  hasNativeScreenPicker: boolean
  getVersion(): Promise<string>
  openExternal(url: string): Promise<void>
  onDeepLink(cb: (link: string) => void): Unsubscribe
  getPendingDeepLink(): Promise<string | null>
  setKeepAwake(on: boolean): Promise<void>
  settings: { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<AppSettings> }
  invite: { parse(codeOrLink: string): Promise<InvitePayload> }
  screen: { getSources(): Promise<ScreenSourceInfo[] | null>; select(sourceId: string, withSystemAudio: boolean): Promise<void> }
  log: { canExport: boolean; export(): Promise<string | null>; write(level: 'info' | 'warn' | 'error', message: string): void }
}

function electronPlatform(api: SjtingApi): Platform {
  return {
    kind: 'electron',
    hasNativeScreenPicker: true,
    getVersion: () => api.app.getVersion(),
    openExternal: (url) => api.app.openExternal(url),
    onDeepLink: (cb) => api.app.onDeepLink(cb),
    getPendingDeepLink: () => api.app.getPendingDeepLink(),
    setKeepAwake: (on) => api.app.setKeepAwake(on),
    settings: api.settings,
    invite: api.invite,
    screen: { getSources: () => api.screen.getSources(), select: (id, audio) => api.screen.select(id, audio) },
    log: { canExport: true, export: () => api.log.export(), write: (l, m) => api.log.write(l, m) }
  }
}

const WEB_SETTINGS_KEY = 'sjting.settings.v2'

function webPlatform(): Platform {
  const schema = buildSettingsSchema(location.origin)
  let cache: AppSettings | null = null
  let wakeLock: WakeLockSentinel | null = null

  const load = (): AppSettings => {
    if (cache) return cache
    let raw: unknown = {}
    try {
      raw = JSON.parse(localStorage.getItem(WEB_SETTINGS_KEY) ?? '{}')
    } catch {
      raw = {}
    }
    const parsed = schema.safeParse(raw)
    cache = parsed.success ? parsed.data : schema.parse({})
    // 웹은 항상 자기 서버(같은 origin)를 쓴다
    cache = { ...cache, serverUrl: location.origin }
    return cache
  }

  return {
    kind: 'web',
    hasNativeScreenPicker: false,
    getVersion: async () => __APP_VERSION__,
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onDeepLink: () => () => undefined,
    getPendingDeepLink: async () => {
      const m = location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)/)
      const code = m?.[1] ?? new URLSearchParams(location.search).get('code')
      if (!code) return null
      history.replaceState(null, '', '/')
      return `${location.origin}/join/${code}`
    },
    setKeepAwake: async (on) => {
      try {
        if (on && !wakeLock && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen')
        if (!on && wakeLock) {
          await wakeLock.release()
          wakeLock = null
        }
      } catch {
        /* 지원하지 않는 브라우저 */
      }
    },
    settings: {
      get: async () => load(),
      set: async (patch) => {
        const next = { ...mergeSettings(load(), patch, schema), serverUrl: location.origin }
        cache = next
        try {
          localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(next))
        } catch {
          /* private mode 등 */
        }
        return next
      }
    },
    invite: { parse: async (input) => decodeInvite(input) },
    // 브라우저는 getDisplayMedia 기본 선택창을 쓴다
    screen: { getSources: async () => null, select: async () => undefined },
    log: {
      canExport: false,
      export: async () => null,
      write: (level, message) => {
        if (level === 'error') console.error('[sjting]', message)
        else if (level === 'warn') console.warn('[sjting]', message)
        else console.info('[sjting]', message)
      }
    }
  }
}

export const platform: Platform = typeof window !== 'undefined' && window.sjting ? electronPlatform(window.sjting) : webPlatform()
export const IS_WEB = platform.kind === 'web'
export const IS_ELECTRON = platform.kind === 'electron'
