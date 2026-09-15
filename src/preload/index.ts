/** Preload — 검증된 최소 IPC API 만 Renderer 에 노출 (sandbox: true, CommonJS 로 빌드됨) */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type SjtingApi } from '../shared/ipc'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: SjtingApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.appGetVersion),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    onDeepLink: (cb) => on<string>(IPC.appDeepLink, cb),
    getPendingDeepLink: () => ipcRenderer.invoke(IPC.appGetPendingDeepLink)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  network: {
    runDiagnostics: (opts) => ipcRenderer.invoke(IPC.networkRunDiagnostics, opts),
    onDiagnosticStep: (cb) => on(IPC.networkDiagnosticStep, cb)
  },
  host: {
    start: (opts) => ipcRenderer.invoke(IPC.hostStart, opts),
    stop: () => ipcRenderer.invoke(IPC.hostStop),
    rotateInvite: () => ipcRenderer.invoke(IPC.hostRotateInvite),
    getStatus: () => ipcRenderer.invoke(IPC.hostGetStatus),
    onStatus: (cb) => on(IPC.hostStatus, cb)
  },
  invite: {
    parse: (codeOrLink) => ipcRenderer.invoke(IPC.inviteParse, codeOrLink)
  },
  join: {
    prepare: (payload) => ipcRenderer.invoke(IPC.joinPrepare, payload),
    clear: () => ipcRenderer.invoke(IPC.joinClear)
  },
  screen: {
    getSources: () => ipcRenderer.invoke(IPC.screenGetSources),
    select: (sourceId, withSystemAudio) => ipcRenderer.invoke(IPC.screenSelect, sourceId, withSystemAudio)
  },
  log: {
    export: () => ipcRenderer.invoke(IPC.logExport),
    write: (level, message) => ipcRenderer.send(IPC.logWrite, level, message)
  }
}

contextBridge.exposeInMainWorld('sjting', api)
