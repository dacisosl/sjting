/** 검증된 JSON 로컬 설정 저장 (민감 토큰은 저장하지 않음) */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { DEFAULT_SERVER_URL } from '@shared/constants'
import type { AppSettings } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('settings')

const SettingsSchema = z.object({
  displayName: z.string().max(24).default(''),
  preferredMicId: z.string().nullable().default(null),
  preferredCameraId: z.string().nullable().default(null),
  preferredSpeakerId: z.string().nullable().default(null),
  serverUrl: z.string().url().default(DEFAULT_SERVER_URL),
  defaultMode: z.enum(['presentation', 'conversation', 'grid', 'lowbandwidth']).default('presentation'),
  screenPreset: z.enum(['document', 'video']).default('document'),
  acceptedNotice: z.boolean().default(false)
})

export const SettingsPatchSchema = SettingsSchema.partial()

let cache: AppSettings | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  if (cache) return cache
  let raw: unknown = {}
  try {
    if (fs.existsSync(filePath())) raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'))
  } catch (e) {
    log.warn('설정 파일을 읽을 수 없어 기본값을 사용합니다', e)
  }
  const parsed = SettingsSchema.safeParse(raw)
  cache = parsed.success ? parsed.data : SettingsSchema.parse({})
  return cache
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const validPatch = SettingsPatchSchema.parse(patch)
  const next = SettingsSchema.parse({ ...loadSettings(), ...validPatch })
  cache = next
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true })
    fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
  } catch (e) {
    log.error('설정 저장 실패', e)
  }
  return next
}
