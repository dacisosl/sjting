/**
 * 최소 STUN 클라이언트 (RFC 5389 Binding Request)
 * 공인 IPv4 확인 전용이며, 포트를 열거나 NAT 를 우회하는 수단이 아니다 (계획서 1.3).
 */
import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'

export const DEFAULT_STUN_SERVERS = [
  'stun.l.google.com:19302',
  'stun1.l.google.com:19302',
  'stun.cloudflare.com:3478'
]

const MAGIC_COOKIE = 0x2112a442
const BINDING_REQUEST = 0x0001
const BINDING_SUCCESS = 0x0101
const ATTR_MAPPED_ADDRESS = 0x0001
const ATTR_XOR_MAPPED_ADDRESS = 0x0020

export interface StunResult {
  ip: string
  port: number
  server: string
}

export function buildBindingRequest(txId: Buffer = randomBytes(12)): Buffer {
  const b = Buffer.alloc(20)
  b.writeUInt16BE(BINDING_REQUEST, 0)
  b.writeUInt16BE(0, 2)
  b.writeUInt32BE(MAGIC_COOKIE, 4)
  txId.copy(b, 8)
  return b
}

/** 응답에서 (XOR-)MAPPED-ADDRESS (IPv4) 를 파싱. 실패하면 null */
export function parseBindingResponse(msg: Buffer, txId: Buffer): { ip: string; port: number } | null {
  if (msg.length < 20) return null
  if (msg.readUInt16BE(0) !== BINDING_SUCCESS) return null
  if (msg.readUInt32BE(4) !== MAGIC_COOKIE) return null
  if (!msg.subarray(8, 20).equals(txId)) return null
  const len = msg.readUInt16BE(2)
  let off = 20
  const end = Math.min(msg.length, 20 + len)
  let fallback: { ip: string; port: number } | null = null
  while (off + 4 <= end) {
    const type = msg.readUInt16BE(off)
    const alen = msg.readUInt16BE(off + 2)
    const vstart = off + 4
    if (vstart + alen > end) break
    if ((type === ATTR_XOR_MAPPED_ADDRESS || type === ATTR_MAPPED_ADDRESS) && alen >= 8) {
      const family = msg.readUInt8(vstart + 1)
      if (family === 0x01) {
        let port = msg.readUInt16BE(vstart + 2)
        let addr = msg.readUInt32BE(vstart + 4)
        if (type === ATTR_XOR_MAPPED_ADDRESS) {
          port ^= MAGIC_COOKIE >>> 16
          addr = (addr ^ MAGIC_COOKIE) >>> 0
        }
        const ip = [(addr >>> 24) & 255, (addr >>> 16) & 255, (addr >>> 8) & 255, addr & 255].join('.')
        if (type === ATTR_XOR_MAPPED_ADDRESS) return { ip, port }
        fallback = { ip, port }
      }
    }
    off = vstart + alen + ((4 - (alen % 4)) % 4)
  }
  return fallback
}

function querySingle(server: string, timeoutMs: number): Promise<StunResult> {
  return new Promise((resolve, reject) => {
    const [host, portStr] = server.split(':')
    const port = Number(portStr) || 3478
    const sock = dgram.createSocket('udp4')
    const txId = randomBytes(12)
    let done = false
    const finish = (err: Error | null, res?: StunResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        sock.close()
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else resolve(res!)
    }
    const timer = setTimeout(() => finish(new Error(`STUN timeout: ${host}`)), timeoutMs)
    sock.on('error', (e) => finish(e))
    sock.on('message', (msg) => {
      const parsed = parseBindingResponse(msg, txId)
      if (parsed) finish(null, { ...parsed, server })
    })
    sock.send(buildBindingRequest(txId), port, host, (err) => {
      if (err) finish(err)
    })
  })
}

/** 여러 STUN 서버 중 먼저 응답하는 결과를 사용 */
export async function discoverPublicIp(
  servers: string[] = DEFAULT_STUN_SERVERS,
  timeoutMs = 3000
): Promise<StunResult | null> {
  try {
    return await Promise.any(servers.map((s) => querySingle(s, timeoutMs)))
  } catch {
    return null
  }
}
