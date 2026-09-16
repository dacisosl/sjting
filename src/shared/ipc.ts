/** Preload 가 Renderer 에 노출하는 API 계약 (window.sjting) — v2 */
import type { AppSettings, InvitePayload, ScreenSourceInfo } from './types'

export type Unsubscribe = () => void

export interface SjtingApi {
  app: {
    getVersion(): Promise<string>
    openExternal(url: string): Promise<void>
    onDeepLink(cb: (link: string) => void): Unsubscribe
    /** 앱 시작 시 인자로 전달된 초대 링크 */
    getPendingDeepLink(): Promise<string | null>
    /** 회의 중 PC 잠자기 방지 켜기/끄기 */
    setKeepAwake(on: boolean): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  invite: {
    parse(codeOrLink: string): Promise<InvitePayload>
  }
  screen: {
    getSources(): Promise<ScreenSourceInfo[]>
    /** getDisplayMedia 호출 전 선택한 소스를 등록 */
    select(sourceId: string, withSystemAudio: boolean): Promise<void>
  }
  log: {
    export(): Promise<string | null>
    write(level: 'info' | 'warn' | 'error', message: string): void
  }
}

export const IPC = {
  appGetVersion: 'app:get-version',
  appOpenExternal: 'app:open-external',
  appDeepLink: 'app:deep-link',
  appGetPendingDeepLink: 'app:get-pending-deep-link',
  appSetKeepAwake: 'app:set-keep-awake',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  inviteParse: 'invite:parse',
  screenGetSources: 'screen:get-sources',
  screenSelect: 'screen:select',
  logExport: 'log:export',
  logWrite: 'log:write'
} as const
