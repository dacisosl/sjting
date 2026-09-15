import { describe, expect, it } from 'vitest'
import { decodeInvite, encodeInvite, extractInviteCode, InviteError, inviteLink, maskIp } from '@shared/invite'
import { fromBase64Url, toBase64Url, toStdBase64, fromStdBase64 } from '@shared/base64url'
import { crc32 } from '@shared/crc32'
import type { InvitePayload } from '@shared/types'

const token = toBase64Url(new Uint8Array(16).map((_, i) => i * 7 + 1))
const fp = toStdBase64(new Uint8Array(32).map((_, i) => 255 - i))

const payload: InvitePayload = {
  version: 1,
  type: 'public',
  ip: '203.0.113.42',
  signalingPort: 44330,
  mediaPort: 44331,
  token,
  certFingerprint: fp,
  expiresAt: 2_000_000_000
}

describe('base64url', () => {
  it('roundtrips arbitrary bytes', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 16, 31, 32, 33]) {
      const b = new Uint8Array(len).map((_, i) => (i * 37 + len) & 0xff)
      expect(Array.from(fromBase64Url(toBase64Url(b)))).toEqual(Array.from(b))
      expect(Array.from(fromStdBase64(toStdBase64(b)))).toEqual(Array.from(b))
    }
  })
  it('matches Node Buffer encoding', () => {
    const b = Buffer.from('hello sjting world!!')
    expect(toBase64Url(b)).toBe(b.toString('base64url'))
    expect(toStdBase64(b)).toBe(b.toString('base64'))
  })
})

describe('crc32', () => {
  it('matches known vector', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('invite code', () => {
  it('encodes and decodes losslessly', () => {
    const code = encodeInvite(payload)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    const decoded = decodeInvite(code, { now: 1_900_000_000 })
    expect(decoded).toEqual(payload)
  })

  it('accepts sjting:// links and extracts the code', () => {
    const code = encodeInvite(payload)
    const link = inviteLink(code)
    expect(link.startsWith('sjting://join/')).toBe(true)
    expect(extractInviteCode(link)).toBe(code)
    expect(decodeInvite(link, { now: null })).toEqual(payload)
    expect(decodeInvite(` ${link}?x=1 `, { now: null })).toEqual(payload)
  })

  it('supports lan type', () => {
    const lan = { ...payload, type: 'lan' as const, ip: '192.168.0.10' }
    expect(decodeInvite(encodeInvite(lan), { now: null })).toEqual(lan)
  })

  it('rejects expired invites but honours expiresAt=0 (no expiry)', () => {
    const code = encodeInvite(payload)
    expect(() => decodeInvite(code, { now: 2_000_000_001 })).toThrowError(InviteError)
    try {
      decodeInvite(code, { now: 2_000_000_001 })
    } catch (e) {
      expect((e as InviteError).code).toBe('EXPIRED')
    }
    const forever = encodeInvite({ ...payload, expiresAt: 0 })
    expect(decodeInvite(forever, { now: 9_999_999_999 }).expiresAt).toBe(0)
  })

  it('detects corruption via checksum', () => {
    const code = encodeInvite(payload)
    const bytes = fromBase64Url(code)
    bytes[5] ^= 0xff
    const corrupted = toBase64Url(bytes)
    expect(() => decodeInvite(corrupted, { now: null })).toThrowError(/체크섬/)
  })

  it('rejects garbage and wrong sizes', () => {
    expect(() => decodeInvite('short', { now: null })).toThrowError(InviteError)
    expect(() => decodeInvite('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!', { now: null })).toThrowError(InviteError)
    expect(() => encodeInvite({ ...payload, ip: '999.1.1.1' })).toThrowError(InviteError)
  })

  it('rejects tokens shorter than 128 bits', () => {
    expect(() => decodeInvite(encodeInvite({ ...payload, token: toBase64Url(new Uint8Array(8)) }), { now: null })).toThrowError(InviteError)
  })

  it('rejects newer versions', () => {
    const code = encodeInvite({ ...payload, version: 99 })
    try {
      decodeInvite(code, { now: null })
      throw new Error('should fail')
    } catch (e) {
      expect((e as InviteError).code).toBe('VERSION')
    }
  })

  it('masks ip for display', () => {
    expect(maskIp('203.0.113.42')).toBe('203.0.*.*')
    expect(maskIp(null)).toBe('-')
  })
})
