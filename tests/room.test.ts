import { describe, expect, it } from 'vitest'
import { Room } from '../src/main/host/Room'
import { MAX_PARTICIPANTS } from '@shared/constants'
import type { Participant } from '@shared/types'

function p(id: string, isHost = false): Participant {
  return { id, displayName: id, isHost, micMuted: false, camOff: true, handRaised: false, sharingScreen: false, connection: 'connected', joinedAt: Date.now() }
}

describe('Room', () => {
  it('enforces max participants on the server side', () => {
    const room = new Room({ mode: 'presentation' })
    for (let i = 0; i < MAX_PARTICIPANTS; i++) {
      expect(room.canJoin(false, false)).toBeNull()
      room.add(p(`u${i}`))
    }
    expect(room.size).toBe(20)
    expect(room.canJoin(false, false)).toBe('ROOM_FULL')
    expect(room.canJoin(true, false)).toBe('ROOM_FULL')
    // 재접속은 자리를 이미 갖고 있으므로 허용
    expect(room.canJoin(false, true)).toBeNull()
  })

  it('caps configured max at 20', () => {
    expect(new Room({ mode: 'grid', maxParticipants: 50 }).maxParticipants).toBe(20)
  })

  it('lock blocks participants but not host', () => {
    const room = new Room({ mode: 'presentation' })
    room.locked = true
    expect(room.canJoin(false, false)).toBe('ROOM_LOCKED')
    expect(room.canJoin(true, false)).toBeNull()
  })

  it('tracks producers and screen share state', () => {
    const room = new Room({ mode: 'presentation' })
    room.add(p('a'))
    room.addProducer({ producerId: 's1', participantId: 'a', kind: 'video', source: 'screen', paused: false })
    expect(room.get('a')?.sharingScreen).toBe(true)
    room.setProducerPaused('s1', true)
    expect(room.getProducer('s1')?.paused).toBe(true)
    room.removeProducer('s1')
    expect(room.get('a')?.sharingScreen).toBe(false)
    expect(room.listProducers()).toHaveLength(0)
  })

  it('removing a participant drops their producers and speaker state', () => {
    const room = new Room({ mode: 'conversation' })
    room.add(p('a'))
    room.add(p('b'))
    room.addProducer({ producerId: 'm1', participantId: 'a', kind: 'audio', source: 'mic', paused: false })
    room.activeSpeakerId = 'a'
    room.remove('a')
    expect(room.has('a')).toBe(false)
    expect(room.producersOf('a')).toHaveLength(0)
    expect(room.activeSpeakerId).toBeNull()
    expect(room.snapshot().participants.map((x) => x.id)).toEqual(['b'])
  })

  it('update cannot change id or host flag', () => {
    const room = new Room({ mode: 'grid' })
    room.add(p('h', true))
    const next = room.update('h', { isHost: false, id: 'x', micMuted: true } as Partial<Participant>)
    expect(next?.id).toBe('h')
    expect(next?.isHost).toBe(true)
    expect(next?.micMuted).toBe(true)
  })

  it('chat history is bounded and wiped on destroy', () => {
    const room = new Room({ mode: 'grid' })
    for (let i = 0; i < 350; i++) room.addChat('a', 'a', `m${i}`)
    expect(room.chatHistory().length).toBe(300)
    expect(room.chatHistory()[0].text).toBe('m50')
    room.destroy()
    expect(room.chatHistory()).toHaveLength(0)
    expect(room.size).toBe(0)
  })
})
