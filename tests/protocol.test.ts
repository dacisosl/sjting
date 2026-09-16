import { describe, expect, it } from 'vitest'
import { ClientEnvelopeSchema, CreateRoomSchema, HOST_ONLY_METHODS, RequestSchemas } from '@shared/protocol'
import { CHAT_MAX_LENGTH, DISPLAY_NAME_MAX } from '@shared/constants'

describe('signaling schemas v2', () => {
  it('validates envelopes', () => {
    expect(ClientEnvelopeSchema.safeParse({ id: 1, method: 'join', data: {} }).success).toBe(true)
    expect(ClientEnvelopeSchema.safeParse({ id: -1, method: 'join', data: {} }).success).toBe(false)
    expect(ClientEnvelopeSchema.safeParse({ id: 1, method: '', data: {} }).success).toBe(false)
    expect(ClientEnvelopeSchema.safeParse({ id: 1, method: 'x'.repeat(41), data: {} }).success).toBe(false)
  })

  it('validates join', () => {
    const ok = RequestSchemas.join.safeParse({ token: 'a'.repeat(22), displayName: ' 홍길동 ' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.displayName).toBe('홍길동')
    expect(RequestSchemas.join.safeParse({ token: 'short', displayName: 'x' }).success).toBe(false)
    expect(RequestSchemas.join.safeParse({ token: 'a'.repeat(22), displayName: 'x'.repeat(DISPLAY_NAME_MAX + 1) }).success).toBe(false)
    expect(RequestSchemas.join.safeParse({ token: 'a'.repeat(22), displayName: '   ' }).success).toBe(false)
    expect(RequestSchemas.join.safeParse({ token: 'a'.repeat(22), displayName: 'x', resume: { participantId: 'p', resumeKey: 'k'.repeat(22) } }).success).toBe(true)
  })

  it('validates setTracks with nullable refs and rejects unknown sources', () => {
    expect(RequestSchemas.setTracks.safeParse({ camera: { sessionId: 's', trackName: 't' }, mic: null }).success).toBe(true)
    expect(RequestSchemas.setTracks.safeParse({ camera: { sessionId: '', trackName: 't' } }).success).toBe(false)
    expect(RequestSchemas.setTracks.safeParse({ camera: { sessionId: 's' } }).success).toBe(false)
    expect(RequestSchemas.setTracks.safeParse({}).success).toBe(true)
  })

  it('limits chat length', () => {
    expect(RequestSchemas.chat.safeParse({ text: 'hi' }).success).toBe(true)
    expect(RequestSchemas.chat.safeParse({ text: 'x'.repeat(CHAT_MAX_LENGTH + 1) }).success).toBe(false)
    expect(RequestSchemas.chat.safeParse({ text: '' }).success).toBe(false)
  })

  it('marks host-only methods', () => {
    for (const m of ['kick', 'muteAll', 'setLock', 'setMode', 'rotateInvite', 'closeRoom'] as const) expect(HOST_ONLY_METHODS.has(m)).toBe(true)
    expect(HOST_ONLY_METHODS.has('chat')).toBe(false)
    expect(HOST_ONLY_METHODS.has('setTracks')).toBe(false)
  })

  it('validates room creation', () => {
    const ok = CreateRoomSchema.safeParse({ displayName: '방장' })
    expect(ok.success && ok.data.mode).toBe('presentation')
    expect(CreateRoomSchema.safeParse({ displayName: '' }).success).toBe(false)
    expect(CreateRoomSchema.safeParse({ displayName: 'a', inviteTtlSec: 10 }).success).toBe(false)
  })
})
