import { describe, expect, it } from 'vitest'
import { buildSettingsSchema, mergeSettings, SettingsSchema } from '@shared/settingsSchema'

describe('settings merge', () => {
  it('a partial patch must not reset other fields to defaults (acceptedNotice regression)', () => {
    const current = SettingsSchema.parse({ acceptedNotice: true, displayName: '홍길동', preferredMicId: 'mic-1' })
    const next = mergeSettings(current, { defaultMode: 'grid' })
    expect(next.acceptedNotice).toBe(true)
    expect(next.displayName).toBe('홍길동')
    expect(next.preferredMicId).toBe('mic-1')
    expect(next.defaultMode).toBe('grid')
  })

  it('explicit undefined keys are ignored, null clears device ids', () => {
    const current = SettingsSchema.parse({ acceptedNotice: true, preferredMicId: 'mic-1' })
    const next = mergeSettings(current, { acceptedNotice: undefined, preferredMicId: null })
    expect(next.acceptedNotice).toBe(true)
    expect(next.preferredMicId).toBeNull()
  })

  it('rejects invalid values', () => {
    const current = SettingsSchema.parse({})
    expect(() => mergeSettings(current, { defaultMode: 'nope' })).toThrow()
    expect(() => mergeSettings(current, { serverUrl: 'not a url' })).toThrow()
    expect(() => mergeSettings(current, { displayName: 'x'.repeat(25) })).toThrow()
  })

  it('web schema uses its own default server url', () => {
    const s = buildSettingsSchema('https://example.test')
    expect(s.parse({}).serverUrl).toBe('https://example.test')
  })
})
