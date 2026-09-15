/** 로컬 IP·게이트웨이 탐지, 사설/CGNAT 주소 판별 */
import dgram from 'node:dgram'
import os from 'node:os'
import { execFile } from 'node:child_process'

export function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false
  if (p[0] === 10) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 192 && p[1] === 168) return true
  if (p[0] === 127) return true
  if (p[0] === 169 && p[1] === 254) return true
  return false
}

/** RFC 6598 공유 주소 공간 (100.64.0.0/10) — 통신사 CGNAT 의 대표적 신호 */
export function isCgnatRange(ip: string): boolean {
  const p = ip.split('.').map(Number)
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127
}

export function isPublicIpv4(ip: string): boolean {
  return !isPrivateIpv4(ip) && !isCgnatRange(ip) && /^\d+\.\d+\.\d+\.\d+$/.test(ip)
}

/** 기본 경로에 사용되는 로컬 IPv4 (UDP connect 트릭, 패킷 전송 없음) */
export function detectLocalIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4')
    const done = (ip: string | null) => {
      try {
        sock.close()
      } catch {
        /* ignore */
      }
      resolve(ip)
    }
    sock.on('error', () => done(fallbackLocalIp()))
    try {
      sock.connect(53, '8.8.8.8', () => {
        try {
          done(sock.address().address)
        } catch {
          done(fallbackLocalIp())
        }
      })
    } catch {
      done(fallbackLocalIp())
    }
  })
}

export function fallbackLocalIp(): string | null {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return null
}

export function listLocalIpv4(): string[] {
  const out: string[] = []
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address)
    }
  }
  return out
}

/** Windows: route print 로 기본 게이트웨이 추출. 실패 시 null */
export function detectGateway(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    execFile('route', ['print', '-4', '0.0.0.0'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      for (const line of stdout.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/)
        if (cols.length >= 4 && cols[0] === '0.0.0.0' && cols[1] === '0.0.0.0' && /^\d+\.\d+\.\d+\.\d+$/.test(cols[2])) {
          return resolve(cols[2])
        }
      }
      resolve(null)
    })
  })
}
