/** IPC 핸들러 — 모든 입력을 zod 로 검증하고 최소 기능만 노출한다 */
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, powerSaveBlocker, shell } from 'electron'
import fs from 'node:fs'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { decodeInvite, InviteError } from '@shared/invite'
import type { ScreenSourceInfo } from '@shared/types'
import { createLogger, getLogFilePath } from './logger'
import { loadSettings, saveSettings, SettingsPatchSchema } from './settings'

const log = createLogger('ipc')

let selectedScreen: { id: string; withAudio: boolean } | null = null
let pendingDeepLink: string | null = null
let keepAwakeId: number | null = null

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

export function stopKeepAwake(): void {
  if (keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId)
  keepAwakeId = null
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
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
  ipcMain.handle(IPC.appSetKeepAwake, (_e, on: unknown) => {
    if (z.boolean().parse(on)) {
      if (keepAwakeId === null) keepAwakeId = powerSaveBlocker.start('prevent-app-suspension')
    } else stopKeepAwake()
  })

  ipcMain.handle(IPC.settingsGet, () => loadSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: unknown) => saveSettings(SettingsPatchSchema.parse(patch)))

  ipcMain.handle(IPC.inviteParse, (_e, raw: unknown) => {
    const input = z.string().min(1).max(2048).parse(raw)
    try {
      return decodeInvite(input)
    } catch (e) {
      if (e instanceof InviteError) throw new Error(e.message)
      throw new Error('초대코드를 해석할 수 없습니다')
    }
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
