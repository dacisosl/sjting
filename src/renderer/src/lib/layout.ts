/**
 * 영상 구독 선택 정책 (계획서 2.3, 6.2, 6.4)
 * 모드·발언자·화면 표시 여부에 따라 어느 producer 를 어떤 계층으로 받을지 결정한다.
 * 순수 함수이므로 테스트 가능.
 */
import type { LayoutMode } from '@shared/constants'
import { CONVERSATION_MODE_VIDEO_COUNT, MAX_VIDEO_SUBSCRIPTIONS } from '@shared/constants'
import type { Participant, ProducerInfo } from '@shared/types'

export interface SubscriptionPlan {
  /** producerId → 선호 spatial layer (0=저, 1=중, 2=고) */
  video: Map<string, { spatialLayer: number; temporalLayer?: number }>
  /** 발표 모드 등에서 크게 표시할 참가자 */
  featuredParticipantId: string | null
  /** 화면공유 producer */
  screenProducerId: string | null
}

export interface PlanInput {
  mode: LayoutMode
  myId: string
  participants: Participant[]
  producers: ProducerInfo[]
  activeSpeakerId: string | null
  /** 최근 발언 순서 (최신 먼저) */
  recentSpeakers: string[]
  /** 화면에 실제로 보이는 참가자 타일 (IntersectionObserver). null 이면 전부 보이는 것으로 간주 */
  visibleParticipantIds: Set<string> | null
  /** 네트워크 상태가 나쁘면 계층을 한 단계 낮춘다 */
  degraded: boolean
  maxVideos?: number
}

function orderBySpeaking(participants: Participant[], recent: string[], active: string | null): Participant[] {
  const rank = new Map<string, number>()
  if (active) rank.set(active, -1)
  recent.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i)
  })
  return [...participants].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return a.joinedAt - b.joinedAt
  })
}

export function planSubscriptions(input: PlanInput): SubscriptionPlan {
  const max = Math.min(input.maxVideos ?? MAX_VIDEO_SUBSCRIPTIONS, MAX_VIDEO_SUBSCRIPTIONS)
  const video = new Map<string, { spatialLayer: number; temporalLayer?: number }>()
  const others = input.participants.filter((p) => p.id !== input.myId && p.connection === 'connected')
  const cameraOf = (pid: string) => input.producers.find((pr) => pr.participantId === pid && pr.source === 'camera' && !pr.paused)
  const screen = input.producers.find((pr) => pr.source === 'screen' && pr.participantId !== input.myId) ?? null
  const clamp = (layer: number) => Math.max(0, input.degraded ? layer - 1 : layer)

  let featured: string | null = null
  let budget = max

  const isVisible = (pid: string) => !input.visibleParticipantIds || input.visibleParticipantIds.has(pid)

  switch (input.mode) {
    case 'presentation': {
      if (screen) {
        video.set(screen.producerId, { spatialLayer: 2, temporalLayer: input.degraded ? 1 : 2 })
        budget -= 1
        featured = screen.participantId
      } else {
        featured = input.activeSpeakerId && input.activeSpeakerId !== input.myId ? input.activeSpeakerId : others[0]?.id ?? null
      }
      // 발표자(화면공유자 또는 발언자) 카메라를 중간 계층으로
      if (featured) {
        const cam = cameraOf(featured)
        if (cam && budget > 0) {
          video.set(cam.producerId, { spatialLayer: clamp(screen ? 1 : 2) })
          budget -= 1
        }
      }
      // 나머지는 저화질 소형 타일, 최근 발언자 우선
      for (const p of orderBySpeaking(others, input.recentSpeakers, input.activeSpeakerId)) {
        if (budget <= 0) break
        if (p.id === featured || !isVisible(p.id)) continue
        const cam = cameraOf(p.id)
        if (cam) {
          video.set(cam.producerId, { spatialLayer: 0 })
          budget -= 1
        }
      }
      break
    }
    case 'conversation': {
      const limit = Math.min(CONVERSATION_MODE_VIDEO_COUNT, max)
      const ordered = orderBySpeaking(others, input.recentSpeakers, input.activeSpeakerId)
      let n = 0
      for (const p of ordered) {
        if (n >= limit) break
        const cam = cameraOf(p.id)
        if (cam) {
          video.set(cam.producerId, { spatialLayer: clamp(ordered.length <= 2 ? 2 : 1) })
          n++
        }
      }
      if (screen) video.set(screen.producerId, { spatialLayer: 2, temporalLayer: input.degraded ? 1 : 2 })
      featured = input.activeSpeakerId
      break
    }
    case 'grid': {
      // 최대 20명 타일. 보이는 타일만 초저화질로 구독, 나머지는 정지화면
      if (screen) {
        video.set(screen.producerId, { spatialLayer: 1, temporalLayer: 1 })
        budget -= 1
      }
      for (const p of orderBySpeaking(others, input.recentSpeakers, input.activeSpeakerId)) {
        if (budget <= 0) break
        if (!isVisible(p.id)) continue
        const cam = cameraOf(p.id)
        if (cam) {
          video.set(cam.producerId, { spatialLayer: 0 })
          budget -= 1
        }
      }
      break
    }
    case 'lowbandwidth': {
      // 음성 우선, 화면공유 720p, 카메라는 발언자 1명만 최저 계층
      if (screen) video.set(screen.producerId, { spatialLayer: 1, temporalLayer: 1 })
      const speaker = input.activeSpeakerId && input.activeSpeakerId !== input.myId ? input.activeSpeakerId : null
      if (speaker) {
        const cam = cameraOf(speaker)
        if (cam) video.set(cam.producerId, { spatialLayer: 0, temporalLayer: 0 })
      }
      featured = screen ? screen.participantId : speaker
      break
    }
  }

  return { video, featuredParticipantId: featured, screenProducerId: screen?.producerId ?? null }
}

/** 네트워크 상태 → 저하 여부 (패킷 손실 3% 이상 또는 RTT 250ms 이상) */
export function isDegraded(q: { packetLossPct: number | null; rtt: number | null }): boolean {
  return (q.packetLossPct ?? 0) >= 3 || (q.rtt ?? 0) >= 250
}

/** 최근 발언자 목록 갱신 (최신 먼저, 중복 제거, 최대 n) */
export function pushRecentSpeaker(list: string[], id: string | null, n = 8): string[] {
  if (!id) return list
  const next = [id, ...list.filter((x) => x !== id)]
  return next.slice(0, n)
}
