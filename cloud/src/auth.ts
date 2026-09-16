/** 토큰 생성·해시·검증, 입장권(HMAC) 서명, 속도 제한 — WebCrypto 기반 (Workers/Node 공용) */

const enc = new TextEncoder()

export function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 128비트 이상 무작위 토큰 (base64url) */
export function randomToken(bytes = 16): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return toBase64Url(b)
}

/** 짧은 무작위 ID (소문자+숫자, 혼동 문자 제외) */
export function randomId(len = 10): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const b = new Uint8Array(len)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += alphabet[x % alphabet.length]
  return s
}

export async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 방장은 토큰 원문 대신 해시만 보관하고, 비교는 상수 시간으로 수행 */
export async function verifyToken(candidate: string, expectedHashHex: string | null | undefined): Promise<boolean> {
  if (!expectedHashHex) return false
  return constantTimeEqual(await sha256Hex(candidate), expectedHashHex)
}

// ---------------------------------------------------------------- 입장권 (ticket)

export interface TicketPayload {
  /** roomId */
  r: string
  /** participantId */
  p: string
  /** 만료 (UNIX 초) */
  exp: number
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signTicket(secret: string, payload: TicketPayload): Promise<string> {
  const body = toBase64Url(enc.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${toBase64Url(new Uint8Array(sig))}`
}

export async function verifyTicket(secret: string, ticket: string, now = Math.floor(Date.now() / 1000)): Promise<TicketPayload | null> {
  const dot = ticket.indexOf('.')
  if (dot <= 0 || ticket.length > 2048) return null
  const body = ticket.slice(0, dot)
  const sig = ticket.slice(dot + 1)
  let ok = false
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(sig), enc.encode(body))
  } catch {
    return null
  }
  if (!ok) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as TicketPayload
    if (typeof payload.r !== 'string' || typeof payload.p !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < now) return null
    return payload
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 속도 제한

/** 슬라이딩 윈도우 카운터 기반 속도 제한 (메모리, 인스턴스 로컬) */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

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

  sweep(now = Date.now()): void {
    for (const [k, arr] of this.hits) {
      const kept = arr.filter((t) => now - t < this.windowMs)
      if (kept.length === 0) this.hits.delete(k)
      else this.hits.set(k, kept)
    }
  }
}
