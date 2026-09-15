/** 회의 토큰·세션 키 생성과 검증, 속도 제한 (계획서 5.2) */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 128비트 이상의 무작위 토큰 (base64url) */
export function generateToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/** 방장은 토큰 원문 대신 해시만 보관하고, 비교는 상수 시간으로 수행 */
export function verifyToken(candidate: string, expectedHash: Buffer): boolean {
  const h = hashToken(candidate)
  return h.length === expectedHash.length && timingSafeEqual(h, expectedHash)
}

export function generateId(bytes = 8): string {
  return randomBytes(bytes).toString('hex')
}

/** 슬라이딩 윈도우 카운터 기반 속도 제한 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** 허용되면 true, 한도를 넘었으면 false */
  hit(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (arr.length >= this.limit) {
      this.hits.set(key, arr)
      return false
    }
    arr.push(now)
    this.hits.set(key, arr)
    return true
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    return arr.length >= this.limit
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  /** 오래된 항목 정리 */
  sweep(now = Date.now()): void {
    for (const [k, arr] of this.hits) {
      const kept = arr.filter((t) => now - t < this.windowMs)
      if (kept.length === 0) this.hits.delete(k)
      else this.hits.set(k, kept)
    }
  }
}
