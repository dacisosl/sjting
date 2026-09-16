import type { SjtingApi } from '../shared/ipc'

declare global {
  interface Window {
    /** Electron 에서만 존재. 웹에서는 undefined */
    sjting?: SjtingApi
  }
}

export {}
