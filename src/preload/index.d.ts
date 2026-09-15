import type { SjtingApi } from '../shared/ipc'

declare global {
  interface Window {
    sjting: SjtingApi
  }
}

export {}
