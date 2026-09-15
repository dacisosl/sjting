/**
 * 초대코드 인코딩/디코딩 (계획서 5.1)
 * 구조: CBOR([버전, 주소유형, IPv4, 시그널링포트, 미디어포트, 토큰, 인증서지문, 만료시간]) + CRC32(4바이트) → Base64URL
 */
import { Encoder } from 'cbor-x'
import { z } from 'zod'
import { fromBase64Url, fromStdBase64, toBase64Url, toStdBase64 } from './base64url'
import { crc32 } from './crc32'
import { INVITE_LINK_PREFIX, INVITE_VERSION } from './constants'
import type { InviteAddressType, InvitePayload } from './types'

const cbor = new Encoder({ useRecords: false, mapsAsObjects: false })

export const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

const TYPE_CODE: Record<InviteAddressType, number> = { public: 0, lan: 1 }
const CODE_TYPE: Record<number, InviteAddressType> = { 0: 'public', 1: 'lan' }

const TupleSchema = z.tuple([
  z.number().int().min(1),
  z.number().int().min(0).max(1),
  z.instanceof(Uint8Array).refine((b) => b.length === 4, 'ipv4 must be 4 bytes'),
  z.number().int().min(1).max(65535),
  z.number().int().min(1).max(65535),
  z.instanceof(Uint8Array).refine((b) => b.length >= 16, 'token must be >= 128 bits'),
  z.instanceof(Uint8Array).refine((b) => b.length === 32, 'fingerprint must be sha-256'),
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

function ipToBytes(ip: string): Uint8Array {
  if (!IPV4_REGEX.test(ip)) throw new InviteError('INVALID', 'IPv4 형식이 아닙니다')
  return new Uint8Array(ip.split('.').map((p) => Number(p)))
}

function bytesToIp(b: Uint8Array): string {
  return Array.from(b).join('.')
}

export function encodeInvite(payload: InvitePayload): string {
  const tuple = [
    payload.version,
    TYPE_CODE[payload.type],
    ipToBytes(payload.ip),
    payload.signalingPort,
    payload.mediaPort,
    fromBase64Url(payload.token),
    fromStdBase64(payload.certFingerprint),
    payload.expiresAt
  ]
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
  const [version, typeCode, ipBytes, sp, mp, token, fp, exp] = parsed.data
  if (version > INVITE_VERSION) {
    throw new InviteError('VERSION', '더 새로운 버전의 앱에서 만든 초대코드입니다. 앱을 업데이트하세요')
  }

  const now = opts.now === undefined ? Math.floor(Date.now() / 1000) : opts.now
  if (now !== null && exp !== 0 && exp < now) throw new InviteError('EXPIRED', '만료된 초대코드입니다')

  return {
    version,
    type: CODE_TYPE[typeCode],
    ip: bytesToIp(ipBytes),
    signalingPort: sp,
    mediaPort: mp,
    token: toBase64Url(token),
    certFingerprint: toStdBase64(fp),
    expiresAt: exp
  }
}

export function inviteLink(code: string): string {
  return `${INVITE_LINK_PREFIX}${code}`
}

/** 안내 화면·로그용 IP 마스킹 */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '-'
  const p = ip.split('.')
  return p.length === 4 ? `${p[0]}.${p[1]}.*.*` : ip
}
