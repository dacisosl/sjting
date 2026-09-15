import { describe, expect, it } from 'vitest'
import { isTcpPortFree, isUdpPortFree, planPorts } from '../src/main/network/ports'
import { PORT_FALLBACK_ATTEMPTS } from '@shared/constants'

describe('planPorts', () => {
  it('keeps preferred ports when free', async () => {
    const plan = await planPorts(44330, 44331, { tcp: async () => true, udp: async () => true })
    expect(plan).toEqual({ signaling: 44330, media: 44331, changed: false })
  })

  it('falls back when preferred ports are busy and avoids collisions', async () => {
    const busyTcp = new Set([44330, 44331, 44332])
    const busyUdp = new Set([44331])
    const plan = await planPorts(44330, 44331, {
      tcp: async (p) => !busyTcp.has(p),
      udp: async (p) => !busyUdp.has(p)
    })
    expect(plan.signaling).toBe(44333)
    expect(plan.media).not.toBe(plan.signaling)
    expect(plan.media).toBeGreaterThanOrEqual(44334)
    expect(plan.changed).toBe(true)
  })

  it('throws when nothing is available', async () => {
    await expect(planPorts(44330, 44331, { tcp: async () => false, udp: async () => false })).rejects.toThrow()
    expect(PORT_FALLBACK_ATTEMPTS).toBeGreaterThan(1)
  })

  it('real sockets: ephemeral high port is free', async () => {
    const port = 40000 + Math.floor(Math.random() * 20000)
    expect(await isTcpPortFree(port, '127.0.0.1')).toBe(true)
    expect(await isUdpPortFree(port, '127.0.0.1')).toBe(true)
  })
})
