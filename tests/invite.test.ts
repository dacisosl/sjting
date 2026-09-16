import { describe, expect, it } from 'vitest'
import { buildInvite, decodeInvite, encodeInvite, extractInviteCode, InviteError, inviteLink, normalizeServerUrl } from '@shared/invite'
import { fromBase64Url, toBase64Url, toStdBase64, fromStdBase64 } from '@shared/base64url'
import { crc32 } from '@shared/crc32'
import type { InvitePayload } from '@shared/types'

const token = toBase64Url(new Uint8Array(16).map((_, i) => i * 7 + 1))

const payload: InvitePayload = {
  version: 2,
  serverUrl: 'https://sjting-server.example.workers.dev',
  roomId: 'abcd2345kx',
  token,
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

describe('invite code v2', () => {
  it('encodes and decodes losslessly and contains no IP', () => {
    const code = encodeInvite(payload)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeInvite(code, { now: 1_900_000_000 })).toEqual(payload)
    expect(code.length).toBeLessThan(160)
  })

  it('accepts sjting:// links and extracts the code', () => {
    const { code, link } = buildInvite(payload)
    expect(link.startsWith('sjting://join/')).toBe(true)
    expect(extractInviteCode(link)).toBe(code)
    expect(decodeInvite(link, { now: null })).toEqual(payload)
    expect(decodeInvite(` ${link}?x=1 `, { now: null })).toEqual(payload)
    expect(inviteLink(code)).toBe(link)
  })

  it('normalizes server url to origin and requires https (localhost http allowed)', () => {
    expect(normalizeServerUrl('https://a.example.com/path?x=1')).toBe('https://a.example.com')
    expect(normalizeServerUrl('http://localhost:8787/')).toBe('http://localhost:8787')
    expect(() => normalizeServerUrl('http://a.example.com')).toThrowError(InviteError)
    const decoded = decodeInvite(encodeInvite({ ...payload, serverUrl: 'https://a.example.com/x' }), { now: null })
    expect(decoded.serverUrl).toBe('https://a.example.com')
  })

  it('rejects expired invites but honours expiresAt=0 (no expiry)', () => {
    const code = encodeInvite(payload)
    try {
      decodeInvite(code, { now: 2_000_000_001 })
      throw new Error('should fail')
    } catch (e) {
      expect((e as InviteError).code).toBe('EXPIRED')
    }
    expect(decodeInvite(encodeInvite({ ...payload, expiresAt: 0 }), { now: 9_999_999_999 }).expiresAt).toBe(0)
  })

  it('detects corruption via checksum', () => {
    const bytes = fromBase64Url(encodeInvite(payload))
    bytes[5] ^= 0xff
    expect(() => decodeInvite(toBase64Url(bytes), { now: null })).toThrowError(/체크섬/)
  })

  it('rejects garbage, short tokens and other versions', () => {
    expect(() => decodeInvite('short', { now: null })).toThrowError(InviteError)
    expect(() => decodeInvite('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!', { now: null })).toThrowError(InviteError)
    expect(() => decodeInvite(encodeInvite({ ...payload, token: toBase64Url(new Uint8Array(8)) }), { now: null })).toThrowError(InviteError)
    for (const version of [1, 99]) {
      try {
        decodeInvite(encodeInvite({ ...payload, version }), { now: null })
        throw new Error('should fail')
      } catch (e) {
        expect((e as InviteError).code).toBe('VERSION')
      }
    }
  })
})
