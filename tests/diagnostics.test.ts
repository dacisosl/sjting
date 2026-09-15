import { describe, expect, it } from 'vitest'
import { recommendCapacity, runDiagnostics, summarize, type DiagDeps } from '../src/main/network/diagnostics'
import type { DiagnosticStep } from '@shared/types'

function deps(over: Partial<DiagDeps> = {}): DiagDeps {
  return {
    detectLocalIp: async () => '192.168.0.20',
    detectGateway: async () => '192.168.0.1',
    discoverPublicIp: async () => ({ ip: '203.0.113.9' }),
    probeUpnp: async () => ({ available: true, externalIp: '203.0.113.9', error: null }),
    tryMapping: async () => ({ ok: true, error: null }),
    cleanupMapping: async () => undefined,
    isTcpFree: async () => true,
    isUdpFree: async () => true,
    hairpinCheck: async () => false,
    ...over
  }
}

const base = { signalingPort: 44330, mediaPort: 44331 }

describe('recommendCapacity', () => {
  it('maps measured upload to participant limits', () => {
    expect(recommendCapacity(null).maxParticipants).toBe(10)
    expect(recommendCapacity(50)).toMatchObject({ maxParticipants: 5, mode: 'lowbandwidth' })
    expect(recommendCapacity(120)).toMatchObject({ maxParticipants: 10, mode: 'presentation' })
    expect(recommendCapacity(220)).toMatchObject({ maxParticipants: 20, mode: 'presentation' })
    expect(recommendCapacity(350)).toMatchObject({ maxParticipants: 20, mode: 'conversation' })
  })
})

describe('runDiagnostics', () => {
  it('healthy home network → green/yellow with mapping succeeded', async () => {
    const seen: DiagnosticStep[] = []
    const r = await runDiagnostics({ ...base, lastMeasuredUploadMbps: 250, onStep: (s) => seen.push(s), deps: deps({ hairpinCheck: async () => true }) })
    expect(r.overall).toBe('green')
    expect(r.cgnatSuspected).toBe(false)
    expect(r.steps.find((s) => s.key === 'portMap')?.level).toBe('green')
    expect(r.steps.find((s) => s.key === 'reachability')?.level).toBe('green')
    expect(r.recommendedMaxParticipants).toBe(20)
    expect(seen.some((s) => s.level === 'pending')).toBe(true)
    // 진단 결과에 전체 공인 IP 가 노출되지 않아야 함 (마스킹)
    expect(r.steps.find((s) => s.key === 'publicIp')?.detail).not.toContain('203.0.113.9')
  })

  it('CGNAT: STUN and router external IP differ → gray', async () => {
    const r = await runDiagnostics({
      ...base,
      lastMeasuredUploadMbps: null,
      deps: deps({ probeUpnp: async () => ({ available: true, externalIp: '100.70.1.2', error: null }) })
    })
    expect(r.cgnatSuspected).toBe(true)
    expect(r.overall).toBe('gray')
    expect(r.steps.find((s) => s.key === 'portMap')?.level).toBe('skipped')
  })

  it('no UPnP → red with manual forwarding guidance', async () => {
    const r = await runDiagnostics({
      ...base,
      lastMeasuredUploadMbps: 250,
      deps: deps({ probeUpnp: async () => ({ available: false, externalIp: null, error: 'timeout' }) })
    })
    expect(r.overall).toBe('red')
    expect(r.steps.find((s) => s.key === 'portMap')?.detail).toContain('포워딩')
  })

  it('UPnP mapping failure → red', async () => {
    const r = await runDiagnostics({ ...base, lastMeasuredUploadMbps: 250, deps: deps({ tryMapping: async () => ({ ok: false, error: 'denied' }) }) })
    expect(r.steps.find((s) => s.key === 'portMap')?.level).toBe('red')
    expect(r.overall).toBe('red')
  })

  it('no STUN response → red public ip', async () => {
    const r = await runDiagnostics({ ...base, lastMeasuredUploadMbps: 250, deps: deps({ discoverPublicIp: async () => null }) })
    expect(r.publicIp).toBeNull()
    expect(r.steps.find((s) => s.key === 'publicIp')?.level).toBe('red')
  })

  it('busy local port → yellow and fallback note', async () => {
    const r = await runDiagnostics({ ...base, lastMeasuredUploadMbps: 250, deps: deps({ isTcpFree: async (p) => p !== 44330 }) })
    expect(r.steps.find((s) => s.key === 'portMap')?.level).toBe('yellow')
  })

  it('no measurement yet → yellow recommendation (10명)', async () => {
    const r = await runDiagnostics({ ...base, lastMeasuredUploadMbps: null, deps: deps({ hairpinCheck: async () => true }) })
    expect(r.overall).toBe('yellow')
    expect(r.recommendedMaxParticipants).toBe(10)
  })
})

describe('summarize', () => {
  const step = (key: DiagnosticStep['key'], level: DiagnosticStep['level']): DiagnosticStep => ({ key, level, title: key, detail: '' })
  it('gray dominates', () => {
    expect(summarize([step('cgnat', 'gray'), step('portMap', 'red')]).overall).toBe('gray')
  })
  it('red beats yellow', () => {
    expect(summarize([step('cgnat', 'green'), step('portMap', 'red'), step('bandwidth', 'yellow')]).overall).toBe('red')
  })
})
