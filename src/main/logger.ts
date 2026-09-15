/**
 * 민감정보를 남기지 않는 파일 로거 (계획서 8장·9장)
 * - IPv4 는 앞 두 옥텟만 남긴다
 * - 토큰·채팅·미디어 내용은 호출 측에서 절대 전달하지 않는다 (추가로 긴 base64url 문자열은 마스킹)
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_BYTES = 5 * 1024 * 1024
const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g
const LONG_TOKEN = /\b[A-Za-z0-9_-]{22,}\b/g

let logDir: string | null = null
let logFile: string | null = null
let stream: fs.WriteStream | null = null

export function redact(text: string): string {
  return text.replace(IPV4, (_m, a, b) => `${a}.${b}.*.*`).replace(LONG_TOKEN, (m) => `${m.slice(0, 4)}…[redacted]`)
}

function ensureStream(): fs.WriteStream | null {
  if (stream) return stream
  try {
    logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    logFile = path.join(logDir, 'sjting.log')
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_BYTES) {
      fs.renameSync(logFile, path.join(logDir, 'sjting.prev.log'))
    }
    stream = fs.createWriteStream(logFile, { flags: 'a' })
    return stream
  } catch {
    return null
  }
}

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  const ts = new Date().toISOString()
  let line = `${ts} [${level.toUpperCase()}] [${scope}] ${redact(message)}`
  if (extra !== undefined) {
    try {
      line += ' ' + redact(typeof extra === 'string' ? extra : JSON.stringify(extra))
    } catch {
      /* ignore */
    }
  }
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else if (!app.isPackaged) console.log(line)
  ensureStream()?.write(line + '\n')
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => write('debug', scope, m, e),
    info: (m: string, e?: unknown) => write('info', scope, m, e),
    warn: (m: string, e?: unknown) => write('warn', scope, m, e),
    error: (m: string, e?: unknown) => write('error', scope, m, e instanceof Error ? e.message : e)
  }
}

export function getLogFilePath(): string | null {
  ensureStream()
  return logFile
}

export function getLogDir(): string | null {
  ensureStream()
  return logDir
}
