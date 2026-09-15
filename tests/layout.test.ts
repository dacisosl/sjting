import { describe, expect, it } from 'vitest'
import { isDegraded, planSubscriptions, pushRecentSpeaker } from '../src/renderer/src/lib/layout'
import type { Participant, ProducerInfo } from '@shared/types'
import { MAX_VIDEO_SUBSCRIPTIONS } from '@shared/constants'

function participant(id: string, i: number, extra: Partial<Participant> = {}): Participant {
  return {
    id,
    displayName: id,
    isHost: false,
    micMuted: false,
    camOff: false,
    handRaised: false,
    sharingScreen: false,
    connection: 'connected',
    joinedAt: i,
    ...extra
  }
}

function makeRoom(n: number) {
  const participants: Participant[] = [participant('me', 0), ...Array.from({ length: n - 1 }, (_, i) => participant(`p${i + 1}`, i + 1))]
  const producers: ProducerInfo[] = participants.flatMap((p) => [
    { producerId: `cam-${p.id}`, participantId: p.id, kind: 'video', source: 'camera', paused: false },
    { producerId: `mic-${p.id}`, participantId: p.id, kind: 'audio', source: 'mic', paused: false }
  ])
  return { participants, producers }
}

const base = { myId: 'me', activeSpeakerId: null, recentSpeakers: [], visibleParticipantIds: null, degraded: false }

describe('planSubscriptions', () => {
  it('never exceeds the max video subscription budget in a 20-person room', () => {
    const { participants, producers } = makeRoom(20)
    for (const mode of ['presentation', 'conversation', 'grid', 'lowbandwidth'] as const) {
      const plan = planSubscriptions({ ...base, mode, participants, producers })
      expect(plan.video.size).toBeLessThanOrEqual(MAX_VIDEO_SUBSCRIPTIONS)
      for (const id of plan.video.keys()) expect(id).not.toContain('me')
    }
  })

  it('presentation mode prioritises screen share at top layer and presenter camera', () => {
    const { participants, producers } = makeRoom(8)
    producers.push({ producerId: 'screen-p3', participantId: 'p3', kind: 'video', source: 'screen', paused: false })
    const plan = planSubscriptions({ ...base, mode: 'presentation', participants, producers })
    expect(plan.screenProducerId).toBe('screen-p3')
    expect(plan.featuredParticipantId).toBe('p3')
    expect(plan.video.get('screen-p3')?.spatialLayer).toBe(2)
    expect(plan.video.get('cam-p3')?.spatialLayer).toBe(1)
    // 나머지 소형 타일은 최저 계층
    for (const [id, l] of plan.video) if (id !== 'screen-p3' && id !== 'cam-p3') expect(l.spatialLayer).toBe(0)
  })

  it('conversation mode follows recent speakers, max 6 cameras', () => {
    const { participants, producers } = makeRoom(15)
    const recent = ['p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3']
    const plan = planSubscriptions({ ...base, mode: 'conversation', participants, producers, recentSpeakers: recent, activeSpeakerId: 'p12' })
    const cams = [...plan.video.keys()]
    expect(cams.length).toBe(6)
    expect(cams).toContain('cam-p12') // 현재 발언자 최우선
    expect(cams).toContain('cam-p9')
    expect(cams).not.toContain('cam-p3') // 7번째 최근 발언자는 제외
  })

  it('grid mode only subscribes visible tiles at lowest layer', () => {
    const { participants, producers } = makeRoom(20)
    const visible = new Set(['p1', 'p2', 'p3'])
    const plan = planSubscriptions({ ...base, mode: 'grid', participants, producers, visibleParticipantIds: visible })
    expect([...plan.video.keys()].sort()).toEqual(['cam-p1', 'cam-p2', 'cam-p3'])
    for (const l of plan.video.values()) expect(l.spatialLayer).toBe(0)
  })

  it('low bandwidth mode keeps screen at 720p-ish layer and only active speaker camera', () => {
    const { participants, producers } = makeRoom(10)
    producers.push({ producerId: 'screen-p2', participantId: 'p2', kind: 'video', source: 'screen', paused: false })
    const plan = planSubscriptions({ ...base, mode: 'lowbandwidth', participants, producers, activeSpeakerId: 'p5' })
    expect(plan.video.get('screen-p2')).toEqual({ spatialLayer: 1, temporalLayer: 1 })
    expect(plan.video.get('cam-p5')?.spatialLayer).toBe(0)
    expect(plan.video.size).toBe(2)
  })

  it('degraded network lowers camera layers', () => {
    const { participants, producers } = makeRoom(3)
    const good = planSubscriptions({ ...base, mode: 'conversation', participants, producers })
    const bad = planSubscriptions({ ...base, mode: 'conversation', participants, producers, degraded: true })
    expect(good.video.get('cam-p1')?.spatialLayer).toBe(2)
    expect(bad.video.get('cam-p1')?.spatialLayer).toBe(1)
  })

  it('skips paused cameras and reconnecting participants', () => {
    const { participants, producers } = makeRoom(4)
    producers.find((p) => p.producerId === 'cam-p1')!.paused = true
    participants.find((p) => p.id === 'p2')!.connection = 'reconnecting'
    const plan = planSubscriptions({ ...base, mode: 'grid', participants, producers })
    expect([...plan.video.keys()]).toEqual(['cam-p3'])
  })
})

describe('helpers', () => {
  it('isDegraded thresholds', () => {
    expect(isDegraded({ packetLossPct: 0.5, rtt: 50 })).toBe(false)
    expect(isDegraded({ packetLossPct: 3, rtt: 50 })).toBe(true)
    expect(isDegraded({ packetLossPct: null, rtt: 300 })).toBe(true)
  })
  it('pushRecentSpeaker dedupes and caps', () => {
    let l: string[] = []
    for (const id of ['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) l = pushRecentSpeaker(l, id)
    expect(l[0]).toBe('i')
    expect(l.length).toBe(8)
    expect(new Set(l).size).toBe(8)
    expect(pushRecentSpeaker(l, null)).toBe(l)
  })
})
