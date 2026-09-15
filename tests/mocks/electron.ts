/** vitest 용 최소 electron 목 — main 모듈이 import 하는 app/powerSaveBlocker 만 흉내낸다 */
import os from 'node:os'
import path from 'node:path'

export const app = {
  isPackaged: false,
  getPath: (_name: string) => path.join(os.tmpdir(), 'sjting-test'),
  getVersion: () => '0.0.0-test'
}

export const powerSaveBlocker = {
  start: () => 1,
  stop: () => undefined,
  isStarted: () => true
}

export default { app, powerSaveBlocker }
