/**
 * 초대코드 v2 — 공인 IP 가 들어가지 않는다.
 * 구조: CBOR([버전, 서버URL, 방ID, 토큰, 만료시간]) + CRC32(4바이트) → Base64URL
 */
import { Encoder } from 'cbor-x'
import { z } from 'zod'
import { fromBase64Url, toBase64Url } from './base64url'
import { crc32 } from './crc32'
import { INVITE_LINK_PREFIX, INVITE_VERSION } from './constants'
import type { InvitePayload } from './types'

const cbor = new Encoder({ useRecords: false, mapsAsObjects: false })

const TupleSchema = z.tuple([
  z.number().int().min(1),
  z.string().min(8).max(200),
  z.string().min(4).max(64),
  z.instanceof(Uint8Array).refine((b) => b.length >= 16, 'token must be >= 128 bits'),
  z.number().int().min(0)
])

export type InviteErrorCode = 'INVALID' | 'CHECKSUM' | 'VERSION' | 'EXPIRED'

export class InviteError extends Error {
  constructor(
    public readonly code: InviteErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'InviteError'
  }
}

export function normalizeServerUrl(url: string): string {
  const u = new URL(url)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
    throw new InviteError('INVALID', '서버 주소는 https 여야 합니다')
  }
  return u.origin
}

export function encodeInvite(payload: InvitePayload): string {
  const tuple = [payload.version, normalizeServerUrl(payload.serverUrl), payload.roomId, fromBase64Url(payload.token), payload.expiresAt]
  const body = new Uint8Array(cbor.encode(tuple))
  const crc = crc32(body)
  const out = new Uint8Array(body.length + 4)
  out.set(body, 0)
  out[body.length] = (crc >>> 24) & 0xff
  out[body.length + 1] = (crc >>> 16) & 0xff
  out[body.length + 2] = (crc >>> 8) & 0xff
  out[body.length + 3] = crc & 0xff
  return toBase64Url(out)
}

/** 초대코드 또는 sjting://join/... 링크에서 코드 부분을 추출 */
export function extractInviteCode(input: string): string {
  const s = input.trim()
  if (s.toLowerCase().startsWith(INVITE_LINK_PREFIX)) {
    return s.slice(INVITE_LINK_PREFIX.length).replace(/[/?#].*$/, '')
  }
  return s
}

export interface DecodeOptions {
  /** 현재 시각(초). 만료 검사를 건너뛰려면 null */
  now?: number | null
}

export function decodeInvite(input: string, opts: DecodeOptions = {}): InvitePayload {
  const code = extractInviteCode(input)
  if (code.length < 24 || code.length > 512) throw new InviteError('INVALID', '초대코드 길이가 올바르지 않습니다')
  let raw: Uint8Array
  try {
    raw = fromBase64Url(code)
  } catch {
    throw new InviteError('INVALID', '초대코드 문자가 올바르지 않습니다')
  }
  if (raw.length < 5) throw new InviteError('INVALID', '초대코드가 너무 짧습니다')
  const body = raw.subarray(0, raw.length - 4)
  const tail = raw.subarray(raw.length - 4)
  const expected = ((tail[0] << 24) | (tail[1] << 16) | (tail[2] << 8) | tail[3]) >>> 0
  if (crc32(body) !== expected) throw new InviteError('CHECKSUM', '초대코드가 손상되었습니다 (체크섬 불일치)')

  let decoded: unknown
  try {
    decoded = cbor.decode(body)
  } catch {
    throw new InviteError('INVALID', '초대코드를 해석할 수 없습니다')
  }
  const parsed = TupleSchema.safeParse(decoded)
  if (!parsed.success) throw new InviteError('INVALID', '초대코드 구조가 올바르지 않습니다')
  const [version, serverUrl, roomId, token, exp] = parsed.data
  if (version > INVITE_VERSION) {
    throw new InviteError('VERSION', '더 새로운 버전의 앱에서 만든 초대코드입니다. 앱을 업데이트하세요')
  }
  if (version < INVITE_VERSION) {
    throw new InviteError('VERSION', '이전 버전 앱에서 만든 초대코드입니다. 방장이 앱을 업데이트해야 합니다')
  }
  let origin: string
  try {
    origin = normalizeServerUrl(serverUrl)
  } catch {
    throw new InviteError('INVALID', '초대코드의 서버 주소가 올바르지 않습니다')
  }

  const now = opts.now === undefined ? Math.floor(Date.now() / 1000) : opts.now
  if (now !== null && exp !== 0 && exp < now) throw new InviteError('EXPIRED', '만료된 초대코드입니다')

  return { version, serverUrl: origin, roomId, token: toBase64Url(token), expiresAt: exp }
}

export function inviteLink(code: string): string {
  return `${INVITE_LINK_PREFIX}${code}`
}

export function buildInvite(payload: InvitePayload): { code: string; link: string; payload: InvitePayload } {
  const code = encodeInvite(payload)
  return { code, link: inviteLink(code), payload }
}
