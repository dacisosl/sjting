/**
 * Electron Main 진입점 — 보안 원칙 적용:
 * nodeIntegration 끔, contextIsolation·sandbox 켬, CSP, 외부 URL 로딩 금지
 * 미디어·시그널링은 Cloudflare 회의 서버(https/wss)로만 연결한다.
 */
import { app, BrowserWindow, desktopCapturer, session, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_PROTOCOL, INVITE_LINK_PREFIX } from '@shared/constants'
import { deliverDeepLink, getSelectedScreen, registerIpc, setPendingDeepLink, stopKeepAwake } from './ipc'
import { createLogger } from './logger'

const log = createLogger('main')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

// ---------------------------------------------------------------- 단일 인스턴스 + 커스텀 프로토콜
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL)
  }
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.toLowerCase().startsWith(INVITE_LINK_PREFIX))
    if (link) deliverDeepLink(mainWindow, link)
    else mainWindow?.focus()
  })
  const initial = process.argv.find((a) => a.toLowerCase().startsWith(INVITE_LINK_PREFIX))
  if (initial) setPendingDeepLink(initial)
}

// ---------------------------------------------------------------- 창
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'SJTing',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.on('did-finish-load', () => log.info('renderer 로딩 완료'))
  mainWindow.webContents.on('render-process-gone', (_e, details) => log.error(`renderer 프로세스 종료: ${details.reason}`))
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error') log.warn(`[renderer console] ${event.message}`)
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])
    if (!allowed && !url.startsWith('file://')) e.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function applySessionSecurity(): void {
  const ses = session.defaultSession
  const dev = !app.isPackaged
  const csp = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "font-src 'self' data:",
    // 회의 서버(https/wss)와 Cloudflare Realtime 연결 허용. 개발 시 로컬 wrangler dev 도 허용
    `connect-src 'self' https: wss: ${dev ? 'ws: http://localhost:* http://127.0.0.1:* ' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture' || permission === 'clipboard-sanitized-write')
  })
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'display-capture')

  // 화면공유: Renderer 가 IPC 로 미리 선택한 소스만 넘겨준다. 시스템 오디오는 Windows loopback.
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const sel = getSelectedScreen()
      if (!sel) return callback({})
      desktopCapturer
        .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } })
        .then((sources) => {
          const src = sources.find((s) => s.id === sel.id)
          if (!src) return callback({})
          callback({ video: src, audio: sel.withAudio && process.platform === 'win32' ? 'loopback' : undefined })
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
}

// ---------------------------------------------------------------- 앱 수명주기
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (url.toLowerCase().startsWith(INVITE_LINK_PREFIX)) deliverDeepLink(mainWindow, url)
})

app.whenReady().then(() => {
  app.setAppUserModelId('kr.sjting.app')
  applySessionSecurity()
  registerIpc(() => mainWindow)
  createWindow()
  log.info(`SJTing ${app.getVersion()} 시작`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\/dacisosl\/sjting/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

app.on('before-quit', () => stopKeepAwake())
app.on('window-all-closed', () => app.quit())

process.on('uncaughtException', (err) => log.error('uncaughtException', err))
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason instanceof Error ? reason : String(reason)))
