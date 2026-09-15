/** IPC 핸들러 — 모든 입력을 zod 로 검증하고 최소 기능만 노출한다 (계획서 8장) */
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { z } from 'zod'
import { IPC, type StartRoomOptions } from '@shared/ipc'
import { decodeInvite, InviteError } from '@shared/invite'
import type { DiagnosticStep, InvitePayload, ScreenSourceInfo } from '@shared/types'
import type { HostController } from './host/HostController'
import { createLogger, getLogFilePath } from './logger'
import { runDiagnostics } from './network/diagnostics'
import { loadSettings, saveSettings, SettingsPatchSchema } from './settings'

const log = createLogger('ipc')

const StartRoomSchema = z.object({
  addressType: z.enum(['public', 'lan']),
  mode: z.enum(['presentation', 'conversation', 'grid', 'lowbandwidth']),
  displayName: z.string().trim().min(1).max(24),
  skipUpnp: z.boolean().optional()
})

const InvitePayloadSchema = z.object({
  version: z.number().int(),
  type: z.enum(['public', 'lan']),
  ip: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/),
  signalingPort: z.number().int().min(1).max(65535),
  mediaPort: z.number().int().min(1).max(65535),
  token: z.string().min(16).max(128),
  certFingerprint: z.string().min(40).max(64),
  expiresAt: z.number().int().min(0)
})

const DiagOptsSchema = z.object({
  signalingPort: z.number().int().min(1024).max(65535).optional(),
  mediaPort: z.number().int().min(1024).max(65535).optional()
})

/** 참가자가 접속할 방장 주소와 고정할 인증서 지문 */
interface PinnedHost {
  host: string
  port: number
  fingerprint: string
}

let pinned: PinnedHost | null = null
let selectedScreen: { id: string; withAudio: boolean } | null = null
let pendingDeepLink: string | null = null

export function getPinnedHost(): PinnedHost | null {
  return pinned
}

export function getSelectedScreen(): { id: string; withAudio: boolean } | null {
  return selectedScreen
}

export function setPendingDeepLink(link: string | null): void {
  pendingDeepLink = link
}

export function deliverDeepLink(win: BrowserWindow | null, link: string): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.appDeepLink, link)
    if (win.isMinimized()) win.restore()
    win.focus()
  } else {
    pendingDeepLink = link
  }
}

function pinForSelf(host: HostController): void {
  const s = host.getStatus()
  if (s.running && s.signalingPort && s.certFingerprint) {
    pinned = { host: '127.0.0.1', port: s.signalingPort, fingerprint: s.certFingerprint }
  }
}

export function registerIpc(host: HostController, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())
  ipcMain.handle(IPC.appOpenExternal, async (_e, url: unknown) => {
    const u = z.string().url().parse(url)
    // 외부 링크는 프로젝트 GitHub 만 허용
    if (!/^https:\/\/github\.com\/dacisosl\/sjting(\/|$)/.test(u)) throw new Error('허용되지 않은 링크입니다')
    await shell.openExternal(u)
  })
  ipcMain.handle(IPC.appGetPendingDeepLink, () => {
    const l = pendingDeepLink
    pendingDeepLink = null
    return l
  })

  ipcMain.handle(IPC.settingsGet, () => loadSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: unknown) => saveSettings(SettingsPatchSchema.parse(patch)))

  ipcMain.handle(IPC.networkRunDiagnostics, async (e, raw: unknown) => {
    const opts = DiagOptsSchema.parse(raw ?? {})
    const s = loadSettings()
    const result = await runDiagnostics({
      signalingPort: opts.signalingPort ?? s.signalingPort,
      mediaPort: opts.mediaPort ?? s.mediaPort,
      lastMeasuredUploadMbps: s.lastMeasuredUploadMbps,
      onStep: (step: DiagnosticStep) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.networkDiagnosticStep, step)
      }
    })
    saveSettings({ lastDiagnosticAt: result.finishedAt })
    return result
  })

  ipcMain.handle(IPC.hostStart, async (_e, raw: unknown) => {
    const opts = StartRoomSchema.parse(raw) as StartRoomOptions
    const settings = saveSettings({ displayName: opts.displayName, defaultMode: opts.mode })
    const status = await host.start(opts, settings)
    pinForSelf(host)
    return status
  })
  ipcMain.handle(IPC.hostStop, async () => {
    await host.stop()
    pinned = null
  })
  ipcMain.handle(IPC.hostRotateInvite, () => host.rotateInvite(loadSettings().inviteTtlSec))
  ipcMain.handle(IPC.hostGetStatus, () => host.getStatus())
  host.on('status', (status) => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(IPC.hostStatus, status)
  })

  ipcMain.handle(IPC.inviteParse, (_e, raw: unknown) => {
    const input = z.string().min(1).max(2048).parse(raw)
    try {
      return decodeInvite(input)
    } catch (e) {
      if (e instanceof InviteError) throw new Error(e.message)
      throw new Error('초대코드를 해석할 수 없습니다')
    }
  })

  ipcMain.handle(IPC.joinPrepare, (_e, raw: unknown) => {
    const p = InvitePayloadSchema.parse(raw) as InvitePayload
    pinned = { host: p.ip, port: p.signalingPort, fingerprint: p.certFingerprint }
    return { signalingUrl: `wss://${p.ip}:${p.signalingPort}/` }
  })
  ipcMain.handle(IPC.joinClear, () => {
    pinned = null
    pinForSelf(host)
  })

  ipcMain.handle(IPC.screenGetSources, async (): Promise<ScreenSourceInfo[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen') ? 'screen' : 'window',
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      appIconDataUrl: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }))
  })
  ipcMain.handle(IPC.screenSelect, (_e, id: unknown, withAudio: unknown) => {
    selectedScreen = { id: z.string().min(1).max(200).parse(id), withAudio: z.boolean().parse(withAudio) }
  })

  ipcMain.handle(IPC.logExport, async () => {
    const src = getLogFilePath()
    if (!src || !fs.existsSync(src)) return null
    const w = getWindow()
    const res = await dialog.showSaveDialog(w ?? undefined!, {
      title: '진단 로그 내보내기',
      defaultPath: `sjting-log-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: '텍스트', extensions: ['txt', 'log'] }]
    })
    if (res.canceled || !res.filePath) return null
    fs.copyFileSync(src, res.filePath)
    return res.filePath
  })
  ipcMain.on(IPC.logWrite, (_e, level: unknown, message: unknown) => {
    const lv = z.enum(['info', 'warn', 'error']).safeParse(level)
    const msg = z.string().max(2000).safeParse(message)
    if (lv.success && msg.success) log[lv.data](`[renderer] ${msg.data}`)
  })
}
