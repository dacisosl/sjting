import { describe, expect, it } from 'vitest'
import { isDegraded, planSubscriptions, pushRecentSpeaker, trackKey } from '../src/renderer/src/lib/layout'
import type { Participant } from '@shared/types'
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
    speaking: false,
    connection: 'connected',
    joinedAt: i,
    tracks: { camera: { sessionId: `s-${id}`, trackName: `cam-${id}` }, mic: { sessionId: `s-${id}`, trackName: `mic-${id}` } },
    ...extra
  }
}

function makeRoom(n: number): Participant[] {
  return [participant('me', 0), ...Array.from({ length: n - 1 }, (_, i) => participant(`p${i + 1}`, i + 1))]
}

function withScreen(p: Participant): Participant {
  return { ...p, sharingScreen: true, tracks: { ...p.tracks, screen: { sessionId: `s-${p.id}`, trackName: `scr-${p.id}` } } }
}

const base = { myId: 'me', activeSpeakerId: null, recentSpeakers: [], visibleParticipantIds: null, degraded: false }

describe('planSubscriptions v2', () => {
  it('never exceeds the max video subscription budget in a 20-person room', () => {
    const participants = makeRoom(20)
    for (const mode of ['presentation', 'conversation', 'grid', 'lowbandwidth'] as const) {
      const plan = planSubscriptions({ ...base, mode, participants })
      expect(plan.video.size).toBeLessThanOrEqual(MAX_VIDEO_SUBSCRIPTIONS)
      for (const key of plan.video.keys()) expect(key.startsWith('me:')).toBe(false)
    }
  })

  it('presentation mode prioritises screen share at full layer and presenter camera at half', () => {
    const participants = makeRoom(8).map((p) => (p.id === 'p3' ? withScreen(p) : p))
    const plan = planSubscriptions({ ...base, mode: 'presentation', participants })
    expect(plan.screenParticipantId).toBe('p3')
    expect(plan.featuredParticipantId).toBe('p3')
    expect(plan.video.get(trackKey('p3', 'screen'))?.rid).toBe('f')
    expect(plan.video.get(trackKey('p3', 'camera'))?.rid).toBe('h')
    for (const [key, l] of plan.video) if (!key.startsWith('p3:')) expect(l.rid).toBe('q')
  })

  it('conversation mode follows recent speakers, max 6 cameras', () => {
    const participants = makeRoom(15)
    const recent = ['p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3']
    const plan = planSubscriptions({ ...base, mode: 'conversation', participants, recentSpeakers: recent, activeSpeakerId: 'p12' })
    const keys = [...plan.video.keys()]
    expect(keys.length).toBe(6)
    expect(keys).toContain(trackKey('p12', 'camera'))
    expect(keys).toContain(trackKey('p9', 'camera'))
    expect(keys).not.toContain(trackKey('p3', 'camera'))
  })

  it('grid mode only subscribes visible tiles at lowest layer', () => {
    const plan = planSubscriptions({ ...base, mode: 'grid', participants: makeRoom(20), visibleParticipantIds: new Set(['p1', 'p2', 'p3']) })
    expect([...plan.video.keys()].sort()).toEqual(['p1:camera', 'p2:camera', 'p3:camera'])
    for (const l of plan.video.values()) expect(l.rid).toBe('q')
  })

  it('low bandwidth mode keeps screen at half layer and only active speaker camera', () => {
    const participants = makeRoom(10).map((p) => (p.id === 'p2' ? withScreen(p) : p))
    const plan = planSubscriptions({ ...base, mode: 'lowbandwidth', participants, activeSpeakerId: 'p5' })
    expect(plan.video.get(trackKey('p2', 'screen'))?.rid).toBe('h')
    expect(plan.video.get(trackKey('p5', 'camera'))?.rid).toBe('q')
    expect(plan.video.size).toBe(2)
  })

  it('degraded network lowers layers', () => {
    const participants = makeRoom(3)
    expect(planSubscriptions({ ...base, mode: 'conversation', participants }).video.get('p1:camera')?.rid).toBe('f')
    expect(planSubscriptions({ ...base, mode: 'conversation', participants, degraded: true }).video.get('p1:camera')?.rid).toBe('h')
  })

  it('skips cameras that are off or missing and reconnecting participants', () => {
    const participants = makeRoom(4).map((p) => {
      if (p.id === 'p1') return { ...p, camOff: true }
      if (p.id === 'p2') return { ...p, connection: 'reconnecting' as const }
      if (p.id === 'p3') return { ...p, tracks: { mic: p.tracks.mic } }
      return p
    })
    const plan = planSubscriptions({ ...base, mode: 'grid', participants })
    expect([...plan.video.keys()]).toEqual([])
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
