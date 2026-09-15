import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, RateLimiter, verifyToken } from '../src/main/security/tokens'

describe('tokens', () => {
  it('generates >=128-bit base64url tokens', () => {
    const t = generateToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(t, 'base64url').length).toBe(16)
    expect(generateToken()).not.toBe(t)
  })

  it('verifies against hash only', () => {
    const t = generateToken()
    const h = hashToken(t)
    expect(h.length).toBe(32)
    expect(verifyToken(t, h)).toBe(true)
    expect(verifyToken(t + 'x', h)).toBe(false)
    expect(verifyToken(generateToken(), h)).toBe(false)
  })
})

describe('RateLimiter', () => {
  it('allows up to limit within window then blocks', () => {
    const rl = new RateLimiter(3, 1000)
    const now = 1_000_000
    expect(rl.hit('ip', now)).toBe(true)
    expect(rl.hit('ip', now + 10)).toBe(true)
    expect(rl.hit('ip', now + 20)).toBe(true)
    expect(rl.hit('ip', now + 30)).toBe(false)
    expect(rl.isBlocked('ip', now + 40)).toBe(true)
    // 윈도우가 지나면 다시 허용
    expect(rl.hit('ip', now + 1001)).toBe(true)
    expect(rl.isBlocked('other', now)).toBe(false)
  })

  it('reset and sweep clear entries', () => {
    const rl = new RateLimiter(1, 1000)
    rl.hit('a', 0)
    rl.reset('a')
    expect(rl.hit('a', 1)).toBe(true)
    rl.sweep(5000)
    expect(rl.isBlocked('a', 5000)).toBe(false)
  })
})
