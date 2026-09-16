/** 앱 설정 스키마 — Electron(main) 과 웹(localStorage) 이 함께 사용 */
import { z } from 'zod'
import { DEFAULT_SERVER_URL } from './constants'
import type { AppSettings } from './types'

const ModeSchema = z.enum(['presentation', 'conversation', 'grid', 'lowbandwidth'])
const PresetSchema = z.enum(['document', 'video'])

export function buildSettingsSchema(defaultServerUrl = DEFAULT_SERVER_URL) {
  return z.object({
    displayName: z.string().max(24).default(''),
    preferredMicId: z.string().nullable().default(null),
    preferredCameraId: z.string().nullable().default(null),
    preferredSpeakerId: z.string().nullable().default(null),
    serverUrl: z.string().url().default(defaultServerUrl),
    defaultMode: ModeSchema.default('presentation'),
    screenPreset: PresetSchema.default('document'),
    acceptedNotice: z.boolean().default(false)
  })
}

export const SettingsSchema = buildSettingsSchema()

/**
 * 부분 갱신용 스키마. 기본값이 없어야 한다 — zod 의 `.partial()` 은 빠진 키에 기본값을 채워 넣어
 * 기존 값(예: acceptedNotice: true)을 덮어쓰는 버그를 만든다.
 */
export const SettingsPatchSchema = z.object({
  displayName: z.string().max(24).optional(),
  preferredMicId: z.string().nullable().optional(),
  preferredCameraId: z.string().nullable().optional(),
  preferredSpeakerId: z.string().nullable().optional(),
  serverUrl: z.string().url().optional(),
  defaultMode: ModeSchema.optional(),
  screenPreset: PresetSchema.optional(),
  acceptedNotice: z.boolean().optional()
})

/** 검증된 패치에서 undefined 키를 제거해 기존 값을 보존한 채 병합한다 */
export function mergeSettings(current: AppSettings, patch: unknown, schema: ReturnType<typeof buildSettingsSchema> = SettingsSchema): AppSettings {
  const p = SettingsPatchSchema.parse(patch)
  const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))
  return schema.parse({ ...current, ...clean })
}
