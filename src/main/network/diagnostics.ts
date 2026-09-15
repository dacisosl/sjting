/**
 * 연결 전 네트워크 진단 (계획서 7.2) — 9단계를 순서대로 수행하고 단계별 결과를 콜백으로 전달한다.
 */
import type { DiagnosticLevel, DiagnosticResult, DiagnosticStep, DiagnosticStepKey } from '@shared/types'
import type { LayoutMode } from '@shared/constants'
import { UPLOAD_RECOMMENDATION } from '@shared/constants'
import { maskIp } from '@shared/invite'
import { detectGateway, detectLocalIp, isCgnatRange, isPrivateIpv4, isPublicIpv4 } from './localNet'
import { discoverPublicIp } from './stun'
import { isTcpPortFree, isUdpPortFree, tcpConnectCheck } from './ports'
import { UpnpManager } from './upnp'
import { createLogger } from '../logger'

const log = createLogger('diag')

export interface DiagnosticsOptions {
  signalingPort: number
  mediaPort: number
  lastMeasuredUploadMbps: number | null
  onStep?: (step: DiagnosticStep) => void
  /** 테스트 주입용 */
  deps?: Partial<DiagDeps>
}

export interface DiagDeps {
  detectLocalIp: () => Promise<string | null>
  detectGateway: () => Promise<string | null>
  discoverPublicIp: () => Promise<{ ip: string } | null>
  probeUpnp: () => Promise<{ available: boolean; externalIp: string | null; error: string | null }>
  tryMapping: (localIp: string) => Promise<{ ok: boolean; error: string | null }>
  cleanupMapping: () => Promise<void>
  isTcpFree: (port: number) => Promise<boolean>
  isUdpFree: (port: number) => Promise<boolean>
  hairpinCheck: (ip: string, port: number) => Promise<boolean>
}

const TITLES: Record<DiagnosticStepKey, string> = {
  local: '로컬 IP와 공유기 탐지',
  publicIp: '공인 IPv4 확인',
  cgnat: 'CGNAT 의심 여부',
  upnp: 'UPnP 지원 여부',
  portMap: '포트 매핑 (TCP 시그널링 / UDP·TCP 미디어)',
  firewall: 'Windows 방화벽 안내',
  reachability: '외부 도달 가능성 (간접 검사)',
  bandwidth: '업로드 속도·RTT·패킷 손실',
  recommendation: '예상 지원 인원과 권장 화질'
}

/** 측정된 업로드로 권장 인원·모드 계산 (계획서 6.5) */
export function recommendCapacity(uploadMbps: number | null): { maxParticipants: number; mode: LayoutMode; text: string } {
  if (uploadMbps === null) {
    return {
      maxParticipants: 10,
      mode: 'presentation',
      text: '실측 업로드 기록이 없습니다. 첫 회의는 10명 이하 발표 모드로 시작하고, 회의 중 측정값으로 다시 판단하세요.'
    }
  }
  if (uploadMbps >= UPLOAD_RECOMMENDATION[2].minUploadMbps) {
    return { maxParticipants: 20, mode: 'conversation', text: '20명, 다수 카메라 활성 회의가 가능합니다.' }
  }
  if (uploadMbps >= UPLOAD_RECOMMENDATION[1].minUploadMbps) {
    return { maxParticipants: 20, mode: 'presentation', text: '20명 발표 모드를 권장합니다.' }
  }
  if (uploadMbps >= UPLOAD_RECOMMENDATION[0].minUploadMbps) {
    return { maxParticipants: 10, mode: 'presentation', text: '10명 이하, 화면공유 중심 회의를 권장합니다.' }
  }
  return { maxParticipants: 5, mode: 'lowbandwidth', text: '업로드가 부족합니다. 5명 이하 저대역폭 모드를 권장합니다.' }
}

export function summarize(steps: DiagnosticStep[]): { overall: DiagnosticLevel; summary: string } {
  const by = (k: DiagnosticStepKey) => steps.find((s) => s.key === k)
  if (by('cgnat')?.level === 'gray' || by('publicIp')?.level === 'gray') {
    return { overall: 'gray', summary: 'CGNAT 또는 관리형 네트워크로 판단됩니다. 별도 중계 서버 없이는 외부 회의 개설을 지원하지 않습니다. LAN 회의는 가능합니다.' }
  }
  if (by('portMap')?.level === 'red') {
    return { overall: 'red', summary: '포트를 자동으로 열 수 없습니다. 공유기에서 수동 포트포워딩을 설정한 뒤 다시 검사하세요.' }
  }
  if (by('publicIp')?.level === 'red') {
    return { overall: 'red', summary: '공인 IPv4 를 확인할 수 없습니다. 인터넷 연결을 확인하세요.' }
  }
  const rec = by('recommendation')
  if (rec?.level === 'yellow' || by('reachability')?.level === 'yellow' || by('bandwidth')?.level === 'yellow') {
    return { overall: 'yellow', summary: '외부 회의가 가능하지만 인원 또는 화질 제한을 권장합니다. ' + (rec?.detail ?? '') }
  }
  return { overall: 'green', summary: '외부 회의가 가능합니다. ' + (rec?.detail ?? '') }
}

export async function runDiagnostics(opts: DiagnosticsOptions): Promise<DiagnosticResult> {
  const startedAt = Date.now()
  const steps: DiagnosticStep[] = []
  const upnp = new UpnpManager()
  const deps: DiagDeps = {
    detectLocalIp,
    detectGateway,
    discoverPublicIp: () => discoverPublicIp(),
    probeUpnp: () => upnp.probe(),
    tryMapping: async (localIp) => {
      try {
        await upnp.mapAll(localIp, [
          { port: opts.signalingPort, protocol: 'tcp' },
          { port: opts.mediaPort, protocol: 'udp' },
          { port: opts.mediaPort, protocol: 'tcp' }
        ])
        return { ok: true, error: null }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    cleanupMapping: () => upnp.dispose(),
    isTcpFree: (p) => isTcpPortFree(p),
    isUdpFree: (p) => isUdpPortFree(p),
    hairpinCheck: (ip, port) => tcpConnectCheck(ip, port, 2500),
    ...opts.deps
  }

  const push = (key: DiagnosticStepKey, level: DiagnosticLevel, detail: string) => {
    const step: DiagnosticStep = { key, title: TITLES[key], level, detail }
    steps.push(step)
    opts.onStep?.(step)
    log.info(`${key}: ${level} - ${detail}`)
  }
  const pending = (key: DiagnosticStepKey) => opts.onStep?.({ key, title: TITLES[key], level: 'pending', detail: '검사 중…' })

  // 1. 로컬
  pending('local')
  const localIp = await deps.detectLocalIp()
  const gatewayIp = await deps.detectGateway()
  if (!localIp) push('local', 'red', '네트워크 인터페이스에서 IPv4 주소를 찾지 못했습니다.')
  else push('local', 'green', `로컬 IP ${localIp}${gatewayIp ? `, 공유기 ${gatewayIp}` : ''}`)

  // 2. 공인 IP
  pending('publicIp')
  const stun = await deps.discoverPublicIp()
  const publicIp = stun?.ip ?? null
  if (!publicIp) push('publicIp', 'red', 'STUN 응답이 없습니다. 인터넷 연결 또는 UDP 차단 여부를 확인하세요.')
  else if (!isPublicIpv4(publicIp)) push('publicIp', 'gray', `STUN 이 알려준 주소(${maskIp(publicIp)})가 공인 주소가 아닙니다.`)
  else push('publicIp', 'green', `공인 IPv4 ${maskIp(publicIp)} 확인 (초대코드에 전체 주소가 포함됩니다)`)

  // 4. UPnP (3단계 CGNAT 판정에 외부 IP가 필요하므로 먼저 조회)
  pending('upnp')
  const probe = await deps.probeUpnp()
  const upnpExternalIp = probe.externalIp

  // 3. CGNAT
  pending('cgnat')
  let cgnat = false
  if (publicIp && isCgnatRange(publicIp)) cgnat = true
  if (upnpExternalIp && (isPrivateIpv4(upnpExternalIp) || isCgnatRange(upnpExternalIp))) cgnat = true
  if (publicIp && upnpExternalIp && isPublicIpv4(upnpExternalIp) && upnpExternalIp !== publicIp) cgnat = true
  if (cgnat) push('cgnat', 'gray', '공유기의 외부 주소가 사설/공유 주소이거나 STUN 결과와 다릅니다. 통신사 CGNAT 또는 이중 NAT 로 의심됩니다.')
  else if (!upnpExternalIp) push('cgnat', 'yellow', '공유기 외부 주소를 얻지 못해 CGNAT 여부를 확정할 수 없습니다.')
  else push('cgnat', 'green', 'CGNAT 징후가 없습니다.')

  if (probe.available) push('upnp', 'green', `UPnP 게이트웨이 응답${upnpExternalIp ? `, 외부 주소 ${maskIp(upnpExternalIp)}` : ''}`)
  else push('upnp', 'yellow', `UPnP 를 사용할 수 없습니다 (${probe.error ?? '알 수 없음'}). 수동 포트포워딩이 필요합니다.`)

  // 5. 포트 매핑
  pending('portMap')
  const sigFree = await deps.isTcpFree(opts.signalingPort)
  const mediaFree = (await deps.isUdpFree(opts.mediaPort)) && (await deps.isTcpFree(opts.mediaPort))
  if (!sigFree || !mediaFree) {
    push('portMap', 'yellow', `로컬 포트 ${!sigFree ? opts.signalingPort : opts.mediaPort} 가 사용 중입니다. 회의 시작 시 대체 포트를 자동 선택합니다.`)
  } else if (probe.available && localIp && !cgnat) {
    const map = await deps.tryMapping(localIp)
    if (map.ok) push('portMap', 'green', `TCP ${opts.signalingPort}, UDP/TCP ${opts.mediaPort} 매핑 성공 (검사 후 해제)`)
    else push('portMap', 'red', `UPnP 매핑 실패: ${map.error ?? '알 수 없음'}`)
  } else if (cgnat) {
    push('portMap', 'skipped', 'CGNAT 의심 환경이라 포트 매핑을 시도하지 않았습니다.')
  } else {
    push('portMap', 'red', `UPnP 가 없어 자동 매핑이 불가합니다. 공유기에서 TCP ${opts.signalingPort}, UDP ${opts.mediaPort}, TCP ${opts.mediaPort} 를 ${localIp ?? '이 PC'} 로 포워딩하세요.`)
  }

  // 6. 방화벽
  push('firewall', 'yellow', '첫 회의 시작 시 Windows 방화벽 허용 창이 뜨면 “개인 및 공용 네트워크” 모두 허용하세요. 앱은 방화벽 설정을 변경하지 않습니다.')

  // 7. 외부 도달 (헤어핀 간접 검사)
  pending('reachability')
  if (publicIp && isPublicIpv4(publicIp) && !cgnat && steps.find((s) => s.key === 'portMap')?.level === 'green') {
    const listener = await startTempListener(opts.signalingPort)
    const ok = listener ? await deps.hairpinCheck(publicIp, opts.signalingPort) : false
    await listener?.close()
    if (ok) push('reachability', 'green', '공인 주소로 자기 접속(헤어핀)에 성공했습니다. 외부 도달 가능성이 높습니다.')
    else push('reachability', 'yellow', '헤어핀 접속이 되지 않았습니다. 일부 공유기는 이를 지원하지 않으므로 실제 외부 참가자 1명으로 확인하세요.')
  } else {
    push('reachability', 'skipped', '앞 단계 조건이 충족되지 않아 건너뜁니다.')
  }

  // 8. 업로드
  pending('bandwidth')
  if (opts.lastMeasuredUploadMbps !== null) {
    const lvl: DiagnosticLevel = opts.lastMeasuredUploadMbps >= 200 ? 'green' : opts.lastMeasuredUploadMbps >= 100 ? 'yellow' : 'red'
    push('bandwidth', lvl, `이전 회의 최대 업로드 ${opts.lastMeasuredUploadMbps.toFixed(0)} Mbps (앱 실측). 외부 속도측정 서비스는 사용하지 않습니다.`)
  } else {
    push('bandwidth', 'yellow', '외부 서버 없이 사전 속도 측정을 하지 않습니다. 회의 중 실제 전송량으로 측정하여 다음 진단에 반영합니다.')
  }

  // 9. 권장
  const rec = recommendCapacity(opts.lastMeasuredUploadMbps)
  push('recommendation', opts.lastMeasuredUploadMbps === null || rec.maxParticipants < 20 ? 'yellow' : 'green', rec.text)

  await deps.cleanupMapping().catch(() => undefined)

  const { overall, summary } = summarize(steps)
  return {
    startedAt,
    finishedAt: Date.now(),
    steps,
    overall,
    summary,
    localIp,
    gatewayIp,
    publicIp,
    upnpExternalIp,
    cgnatSuspected: cgnat,
    upnpAvailable: probe.available,
    ports: { signaling: opts.signalingPort, media: opts.mediaPort },
    recommendedMaxParticipants: rec.maxParticipants,
    recommendedMode: rec.mode,
    lastMeasuredUploadMbps: opts.lastMeasuredUploadMbps
  }
}

async function startTempListener(port: number): Promise<{ close: () => Promise<void> } | null> {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const srv = net.createServer((s) => s.destroy())
    srv.once('error', () => resolve(null))
    srv.listen(port, '0.0.0.0', () => resolve({ close: () => new Promise((r) => srv.close(() => r())) }))
  })
}
