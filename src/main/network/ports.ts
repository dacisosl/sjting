/** 포트 사용 가능 여부 검사와 대체 포트 선택 (계획서 4.1) */
import dgram from 'node:dgram'
import net from 'node:net'
import { PORT_FALLBACK_ATTEMPTS } from '@shared/constants'

export function isTcpPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, host)
  })
}

export function isUdpPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4')
    sock.once('error', () => resolve(false))
    sock.bind(port, host, () => sock.close(() => resolve(true)))
  })
}

export interface PortPlan {
  signaling: number
  media: number
  changed: boolean
}

/**
 * 시그널링(TCP) 과 미디어(UDP+TCP 동일 번호) 포트를 확보한다.
 * 기본 포트가 막혀 있으면 순차적으로 대체 포트를 고른다.
 */
export async function planPorts(
  preferredSignaling: number,
  preferredMedia: number,
  checks: { tcp?: typeof isTcpPortFree; udp?: typeof isUdpPortFree } = {}
): Promise<PortPlan> {
  const tcp = checks.tcp ?? isTcpPortFree
  const udp = checks.udp ?? isUdpPortFree

  let signaling = -1
  for (let i = 0; i < PORT_FALLBACK_ATTEMPTS; i++) {
    const p = preferredSignaling + i
    if (p > 65535) break
    if (await tcp(p)) {
      signaling = p
      break
    }
  }
  if (signaling < 0) throw new Error('사용 가능한 시그널링 포트를 찾지 못했습니다')

  let media = -1
  for (let i = 0; i < PORT_FALLBACK_ATTEMPTS; i++) {
    const p = preferredMedia + i
    if (p > 65535 || p === signaling) continue
    if ((await udp(p)) && (await tcp(p))) {
      media = p
      break
    }
  }
  if (media < 0) throw new Error('사용 가능한 미디어 포트를 찾지 못했습니다')

  return { signaling, media, changed: signaling !== preferredSignaling || media !== preferredMedia }
}

/** TCP 연결 도달 여부 (헤어핀 자기 검사 등에 사용) */
export function tcpConnectCheck(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port })
    const timer = setTimeout(() => {
      sock.destroy()
      resolve(false)
    }, timeoutMs)
    sock.once('connect', () => {
      clearTimeout(timer)
      sock.destroy()
      resolve(true)
    })
    sock.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}
