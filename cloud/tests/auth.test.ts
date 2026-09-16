import { describe, expect, it } from 'vitest'
import { constantTimeEqual, fromBase64Url, randomId, randomToken, RateLimiter, sha256Hex, signTicket, toBase64Url, verifyTicket, verifyToken } from '../src/auth'

describe('tokens', () => {
  it('randomToken is >=128 bits base64url', () => {
    const t = randomToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(fromBase64Url(t).length).toBe(16)
    expect(randomToken()).not.toBe(t)
  })

  it('base64url roundtrip', () => {
    for (const len of [0, 1, 2, 3, 16, 31]) {
      const b = new Uint8Array(len).map((_, i) => (i * 53 + len) & 0xff)
      expect([...fromBase64Url(toBase64Url(b))]).toEqual([...b])
    }
  })

  it('randomId uses safe alphabet', () => {
    expect(randomId(10)).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/)
  })

  it('verifyToken compares against hash only', async () => {
    const t = randomToken()
    const h = await sha256Hex(t)
    expect(h).toHaveLength(64)
    expect(await verifyToken(t, h)).toBe(true)
    expect(await verifyToken(t + 'x', h)).toBe(false)
    expect(await verifyToken(t, null)).toBe(false)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
  })
})

describe('ticket', () => {
  const secret = 'test-secret-please-change'
  it('signs and verifies', async () => {
    const t = await signTicket(secret, { r: 'room1', p: 'p1', exp: 2_000_000_000 })
    const v = await verifyTicket(secret, t, 1_900_000_000)
    expect(v).toEqual({ r: 'room1', p: 'p1', exp: 2_000_000_000 })
  })
  it('rejects expired, tampered, wrong secret', async () => {
    const t = await signTicket(secret, { r: 'room1', p: 'p1', exp: 1000 })
    expect(await verifyTicket(secret, t, 2000)).toBeNull()
    const valid = await signTicket(secret, { r: 'room1', p: 'p1', exp: 2_000_000_000 })
    const [body, sig] = valid.split('.')
    expect(await verifyTicket(secret, `${body}x.${sig}`, 1)).toBeNull()
    expect(await verifyTicket('other', valid, 1)).toBeNull()
    expect(await verifyTicket(secret, 'garbage', 1)).toBeNull()
  })
})

describe('RateLimiter', () => {
  it('blocks after limit within window', () => {
    const rl = new RateLimiter(2, 1000)
    expect(rl.hit('k', 0)).toBe(true)
    expect(rl.hit('k', 10)).toBe(true)
    expect(rl.hit('k', 20)).toBe(false)
    expect(rl.isBlocked('k', 30)).toBe(true)
    expect(rl.hit('k', 1001)).toBe(true)
    rl.reset('k')
    expect(rl.isBlocked('k', 1002)).toBe(false)
  })
})
