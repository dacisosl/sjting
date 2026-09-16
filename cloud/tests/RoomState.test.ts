import { describe, expect, it } from 'vitest'
import { RoomState, type RoomMeta } from '../src/RoomState'
import { MAX_PARTICIPANTS } from '../../src/shared/constants'

function meta(over: Partial<RoomMeta> = {}): RoomMeta {
  return {
    id: 'abc123',
    mode: 'presentation',
    locked: false,
    closed: false,
    createdAt: 1_000_000,
    maxParticipants: 20,
    hostTokenHash: 'h',
    inviteTokenHash: 'i',
    inviteExpiresAt: 0,
    inviteTtlSec: 3600,
    ...over
  }
}

describe('RoomState', () => {
  it('enforces 20 participants server-side', () => {
    const s = new RoomState(meta({ maxParticipants: 99 }))
    expect(s.meta.maxParticipants).toBe(MAX_PARTICIPANTS)
    for (let i = 0; i < 20; i++) {
      expect(s.canJoin(false, false)).toBeNull()
      s.createParticipant(`u${i}`, i === 0)
    }
    expect(s.canJoin(false, false)).toBe('ROOM_FULL')
    expect(s.canJoin(true, false)).toBe('ROOM_FULL')
    expect(s.canJoin(false, true)).toBeNull()
  })

  it('lock blocks participants but not host; closed blocks everyone', () => {
    const s = new RoomState(meta())
    s.meta.locked = true
    expect(s.canJoin(false, false)).toBe('ROOM_LOCKED')
    expect(s.canJoin(true, false)).toBeNull()
    s.meta.closed = true
    expect(s.canJoin(true, true)).toBe('ROOM_CLOSED')
  })

  it('setTracks derives sharingScreen and camOff', () => {
    const s = new RoomState(meta())
    const p = s.createParticipant('a', false)
    expect(p.camOff).toBe(true)
    const patch = s.setTracks(p.id, { screen: { sessionId: 's', trackName: 't' }, camera: { sessionId: 's', trackName: 'c' } })
    expect(patch?.sharingScreen).toBe(true)
    expect(patch?.camOff).toBe(false)
    expect(s.get(p.id)?.tracks.screen?.trackName).toBe('t')
    const patch2 = s.setTracks(p.id, { screen: null })
    expect(patch2?.sharingScreen).toBe(false)
    expect(s.get(p.id)?.tracks.screen).toBeUndefined()
    expect(s.get(p.id)?.tracks.camera).toBeDefined()
    // 카메라 필드가 없는 패치는 camOff 를 건드리지 않는다
    expect(patch2?.camOff).toBeUndefined()
  })

  it('active speaker follows speaking flags with stickiness', () => {
    const s = new RoomState(meta())
    const a = s.createParticipant('a', true)
    const b = s.createParticipant('b', false)
    expect(s.recomputeActiveSpeaker()).toBe(false)
    s.update(a.id, { speaking: true })
    expect(s.recomputeActiveSpeaker()).toBe(true)
    expect(s.activeSpeakerId).toBe(a.id)
    s.update(b.id, { speaking: true })
    expect(s.recomputeActiveSpeaker()).toBe(false) // a 가 계속 말하는 중이면 유지
    s.update(a.id, { speaking: false })
    expect(s.recomputeActiveSpeaker()).toBe(true)
    expect(s.activeSpeakerId).toBe(b.id)
    s.remove(b.id)
    expect(s.activeSpeakerId).toBeNull()
  })

  it('update cannot change id or host flag', () => {
    const s = new RoomState(meta())
    const h = s.createParticipant('h', true)
    const next = s.update(h.id, { isHost: false, id: 'x', micMuted: false } as never)
    expect(next?.id).toBe(h.id)
    expect(next?.isHost).toBe(true)
    expect(next?.micMuted).toBe(false)
  })

  it('chat is bounded and JSON roundtrip preserves state', () => {
    const s = new RoomState(meta())
    const p = s.createParticipant('a', true)
    for (let i = 0; i < 320; i++) s.addChat(p.id, 'a', `m${i}`)
    expect(s.chatHistory()).toHaveLength(300)
    expect(s.chatHistory()[0].text).toBe('m20')
    s.resumeKeyHashes.set(p.id, 'hash')
    s.pendingLeave.set(p.id, 123)
    const copy = RoomState.fromJSON(JSON.parse(JSON.stringify(s.toJSON())))
    expect(copy.size).toBe(1)
    expect(copy.resumeKeyHashes.get(p.id)).toBe('hash')
    expect(copy.pendingLeave.get(p.id)).toBe(123)
    expect(copy.chatHistory()).toHaveLength(300)
    expect(copy.snapshot(true).invite?.expiresAt).toBe(0)
    expect(copy.snapshot(false).invite).toBeNull()
  })

  it('emptySince tracks occupancy and destroy wipes everything', () => {
    const s = new RoomState(meta())
    expect(s.emptySince).toBe(1_000_000)
    const p = s.createParticipant('a', true, 5)
    expect(s.emptySince).toBeNull()
    s.remove(p.id, 99)
    expect(s.emptySince).toBe(99)
    s.addChat('x', 'x', 'hi')
    s.destroy()
    expect(s.chatHistory()).toHaveLength(0)
    expect(s.meta.closed).toBe(true)
  })
})
