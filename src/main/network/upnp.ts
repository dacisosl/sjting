/**
 * UPnP 포트 매핑 (계획서 4.1, 7.3)
 * - TCP 시그널링, UDP 미디어, TCP 미디어 3개를 매핑
 * - 정상 종료 시 제거, 비정상 종료 후 남은 매핑은 다음 실행 시 정리
 */
import dgram from 'node:dgram'
import { upnpNat, type Gateway } from '@achingbrain/nat-port-mapper'
import { createLogger } from '../logger'

const log = createLogger('upnp')
const DESCRIPTION = 'SJTing meeting'
const TTL_MS = 2 * 60 * 60 * 1000

export interface UpnpProbe {
  available: boolean
  gatewayHost: string | null
  externalIp: string | null
  error: string | null
}

export interface MappingSpec {
  port: number
  protocol: 'tcp' | 'udp'
}

export class UpnpManager {
  private gateway: Gateway | null = null
  private readonly client = upnpNat({ description: DESCRIPTION, ttl: TTL_MS, autoRefresh: true })
  private mapped: MappingSpec[] = []

  async probe(timeoutMs = 6000): Promise<UpnpProbe> {
    try {
      const gw = await this.findGateway(timeoutMs)
      if (!gw) {
        // 일부 공유기(KT 등)는 SSDP 광고는 하지만 UPnP 서비스 포트를 열지 않는다. 원인을 구분해 안내한다.
        const ssdp = await rawSsdpProbe(3000)
        const error = ssdp
          ? `공유기(${ssdp})가 UPnP 를 광고하지만 서비스에 접속할 수 없습니다. 공유기 관리 페이지에서 UPnP 를 켜거나 수동 포트포워딩을 하세요`
          : 'UPnP 게이트웨이를 찾지 못했습니다 (공유기에서 UPnP 가 꺼져 있거나 방화벽이 응답을 막았습니다)'
        return { available: false, gatewayHost: ssdp, externalIp: null, error }
      }
      let externalIp: string | null = null
      try {
        externalIp = await gw.externalIp({ signal: AbortSignal.timeout(timeoutMs) })
      } catch (e) {
        log.warn('외부 IP 조회 실패', e)
      }
      return { available: true, gatewayHost: gw.host, externalIp, error: null }
    } catch (e) {
      return { available: false, gatewayHost: null, externalIp: null, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private async findGateway(timeoutMs: number): Promise<Gateway | null> {
    if (this.gateway) return this.gateway
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      for await (const gw of this.client.findGateways({ signal })) {
        if (gw.family === 'IPv4') {
          this.gateway = gw
          return gw
        }
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) log.warn('게이트웨이 탐색 오류', e)
    }
    return this.gateway
  }

  /** 지정 포트들을 동일 번호로 매핑. 하나라도 실패하면 예외 */
  async mapAll(localIp: string, specs: MappingSpec[], timeoutMs = 8000): Promise<void> {
    const gw = await this.findGateway(timeoutMs)
    if (!gw) throw new Error('UPnP 게이트웨이를 찾지 못했습니다')
    for (const spec of specs) {
      const res = await gw.map(spec.port, localIp, {
        externalPort: spec.port,
        protocol: spec.protocol,
        description: DESCRIPTION,
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (res.externalPort !== spec.port) {
        // 동일 포트 매핑이 아닌 경우 초대코드와 불일치하므로 실패 처리
        await gw.unmap(spec.port).catch(() => undefined)
        throw new Error(`외부 포트 ${spec.port}/${spec.protocol} 매핑을 얻지 못했습니다`)
      }
      this.mapped.push(spec)
      log.info(`포트 매핑 완료 ${spec.port}/${spec.protocol}`)
    }
  }

  /** 지정 포트들에 남아 있을 수 있는 매핑 정리 (이전 비정상 종료 대비) */
  async cleanupStale(ports: number[], timeoutMs = 5000): Promise<void> {
    const gw = await this.findGateway(timeoutMs)
    if (!gw) return
    for (const p of ports) {
      await gw.unmap(p, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => undefined)
    }
  }

  async unmapAll(): Promise<void> {
    const gw = this.gateway
    if (!gw) return
    const specs = this.mapped
    this.mapped = []
    for (const spec of specs) {
      await gw.unmap(spec.port, { signal: AbortSignal.timeout(5000) }).catch((e) => log.warn('매핑 제거 실패', e))
    }
  }

  async dispose(): Promise<void> {
    await this.unmapAll()
    await this.gateway?.stop().catch(() => undefined)
    this.gateway = null
  }
}

/** 라이브러리 탐색이 실패했을 때, 공유기가 SSDP 에 응답하는지만 확인한다. 응답한 호스트 IP 또는 null */
export function rawSsdpProbe(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        sock.close()
      } catch {
        /* ignore */
      }
      resolve(v)
    }
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const timer = setTimeout(() => finish(null), timeoutMs)
    sock.on('error', () => finish(null))
    sock.on('message', (msg, rinfo) => {
      if (/InternetGatewayDevice|WANIPConnection|upnp:rootdevice/i.test(msg.toString())) finish(rinfo.address)
    })
    sock.bind(() => {
      const search = (st: string) =>
        Buffer.from(
          ['M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${st}`, '', ''].join('\r\n')
        )
      for (const st of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'upnp:rootdevice']) {
        sock.send(search(st), 1900, '239.255.255.250', () => undefined)
      }
    })
  })
}
