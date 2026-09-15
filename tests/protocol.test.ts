import { describe, expect, it } from 'vitest'
import { ClientEnvelopeSchema, HOST_ONLY_METHODS, RequestSchemas } from '@shared/protocol'
import { CHAT_MAX_LENGTH, DISPLAY_NAME_MAX } from '@shared/constants'

describe('signaling schemas', () => {
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
  })

  it('limits chat length', () => {
    expect(RequestSchemas.chat.safeParse({ text: 'hi' }).success).toBe(true)
    expect(RequestSchemas.chat.safeParse({ text: 'x'.repeat(CHAT_MAX_LENGTH + 1) }).success).toBe(false)
    expect(RequestSchemas.chat.safeParse({ text: '' }).success).toBe(false)
  })

  it('validates produce sources and kinds', () => {
    expect(RequestSchemas.produce.safeParse({ transportId: 't', kind: 'video', rtpParameters: {}, source: 'screen' }).success).toBe(true)
    expect(RequestSchemas.produce.safeParse({ transportId: 't', kind: 'text', rtpParameters: {}, source: 'screen' }).success).toBe(false)
    expect(RequestSchemas.produce.safeParse({ transportId: 't', kind: 'video', rtpParameters: {}, source: 'webcam' }).success).toBe(false)
  })

  it('clamps consumer layers', () => {
    expect(RequestSchemas.setConsumerLayers.safeParse({ consumerId: 'c', spatialLayer: 2 }).success).toBe(true)
    expect(RequestSchemas.setConsumerLayers.safeParse({ consumerId: 'c', spatialLayer: 9 }).success).toBe(false)
  })

  it('marks host-only methods', () => {
    for (const m of ['kick', 'muteAll', 'setLock', 'setMode', 'closeRoom'] as const) expect(HOST_ONLY_METHODS.has(m)).toBe(true)
    expect(HOST_ONLY_METHODS.has('chat')).toBe(false)
    expect(HOST_ONLY_METHODS.has('leave')).toBe(false)
  })
})
