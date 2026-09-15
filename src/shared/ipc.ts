/** Preload 가 Renderer 에 노출하는 API 계약 (window.sjting) */
import type { LayoutMode } from './constants'
import type {
  AppSettings,
  DiagnosticResult,
  DiagnosticStep,
  HostStatus,
  InviteAddressType,
  InviteBundle,
  InvitePayload,
  ScreenSourceInfo
} from './types'

export interface StartRoomOptions {
  addressType: InviteAddressType
  mode: LayoutMode
  displayName: string
  /** 수동 포트포워딩을 이미 했을 때 UPnP 매핑을 건너뛴다 */
  skipUpnp?: boolean
}

export interface PrepareJoinResult {
  signalingUrl: string
}

export type Unsubscribe = () => void

export interface SjtingApi {
  app: {
    getVersion(): Promise<string>
    openExternal(url: string): Promise<void>
    onDeepLink(cb: (code: string) => void): Unsubscribe
    /** 앱 시작 시 인자로 전달된 초대 링크 */
    getPendingDeepLink(): Promise<string | null>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  network: {
    runDiagnostics(opts: { signalingPort?: number; mediaPort?: number }): Promise<DiagnosticResult>
    onDiagnosticStep(cb: (step: DiagnosticStep) => void): Unsubscribe
  }
  host: {
    start(opts: StartRoomOptions): Promise<HostStatus>
    stop(): Promise<void>
    rotateInvite(): Promise<InviteBundle>
    getStatus(): Promise<HostStatus>
    onStatus(cb: (status: HostStatus) => void): Unsubscribe
  }
  invite: {
    parse(codeOrLink: string): Promise<InvitePayload>
  }
  join: {
    /** 초대코드의 인증서 지문을 고정하고 시그널링 URL 을 돌려준다 */
    prepare(payload: InvitePayload): Promise<PrepareJoinResult>
    clear(): Promise<void>
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
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  networkRunDiagnostics: 'network:run-diagnostics',
  networkDiagnosticStep: 'network:diagnostic-step',
  hostStart: 'host:start',
  hostStop: 'host:stop',
  hostRotateInvite: 'host:rotate-invite',
  hostGetStatus: 'host:get-status',
  hostStatus: 'host:status',
  inviteParse: 'invite:parse',
  joinPrepare: 'join:prepare',
  joinClear: 'join:clear',
  screenGetSources: 'screen:get-sources',
  screenSelect: 'screen:select',
  logExport: 'log:export',
  logWrite: 'log:write'
} as const
