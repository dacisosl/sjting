/**
 * 영상 구독 선택 정책 (계획서 2.3, 6.2, 6.4 — v2 에서는 Cloudflare simulcast rid 로 계층 선택)
 * 모드·발언자·화면 표시 여부에 따라 어느 참가자의 어떤 영상을 어떤 계층으로 받을지 결정한다. 순수 함수.
 */
import type { LayoutMode, Rid } from '@shared/constants'
import { CONVERSATION_MODE_VIDEO_COUNT, MAX_VIDEO_SUBSCRIPTIONS, RID } from '@shared/constants'
import type { Participant } from '@shared/types'

export type VideoSource = 'camera' | 'screen'

export function trackKey(participantId: string, source: string): string {
  return `${participantId}:${source}`
}

export interface SubscriptionPlan {
  /** trackKey → 선호 계층 */
  video: Map<string, { rid: Rid }>
  /** 크게 표시할 참가자 */
  featuredParticipantId: string | null
  /** 화면공유 중인 참가자 */
  screenParticipantId: string | null
}

export interface PlanInput {
  mode: LayoutMode
  myId: string
  participants: Participant[]
  activeSpeakerId: string | null
  /** 최근 발언 순서 (최신 먼저) */
  recentSpeakers: string[]
  /** 화면에 실제로 보이는 참가자 타일. null 이면 전부 보이는 것으로 간주 */
  visibleParticipantIds: Set<string> | null
  /** 네트워크 상태가 나쁘면 계층을 한 단계 낮춘다 */
  degraded: boolean
  maxVideos?: number
}

const LOWER: Record<Rid, Rid> = { f: 'h', h: 'q', q: 'q' }

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
  const video = new Map<string, { rid: Rid }>()
  const others = input.participants.filter((p) => p.id !== input.myId && p.connection === 'connected')
  const hasCam = (p: Participant) => !!p.tracks.camera && !p.camOff
  const sharer = others.find((p) => !!p.tracks.screen) ?? null
  const lower = (rid: Rid): Rid => (input.degraded ? LOWER[rid] : rid)
  const isVisible = (pid: string) => !input.visibleParticipantIds || input.visibleParticipantIds.has(pid)

  let featured: string | null = null
  let budget = max

  switch (input.mode) {
    case 'presentation': {
      if (sharer) {
        video.set(trackKey(sharer.id, 'screen'), { rid: lower(RID.full) })
        budget -= 1
        featured = sharer.id
      } else {
        featured = input.activeSpeakerId && input.activeSpeakerId !== input.myId ? input.activeSpeakerId : (others[0]?.id ?? null)
      }
      const fp = others.find((p) => p.id === featured)
      if (fp && hasCam(fp) && budget > 0) {
        video.set(trackKey(fp.id, 'camera'), { rid: lower(sharer ? RID.half : RID.full) })
        budget -= 1
      }
      for (const p of orderBySpeaking(others, input.recentSpeakers, input.activeSpeakerId)) {
        if (budget <= 0) break
        if (p.id === featured || !isVisible(p.id) || !hasCam(p)) continue
        video.set(trackKey(p.id, 'camera'), { rid: RID.quarter })
        budget -= 1
      }
      break
    }
    case 'conversation': {
      const limit = Math.min(CONVERSATION_MODE_VIDEO_COUNT, max)
      const ordered = orderBySpeaking(others, input.recentSpeakers, input.activeSpeakerId)
      let n = 0
      for (const p of ordered) {
        if (n >= limit) break
        if (!hasCam(p)) continue
        video.set(trackKey(p.id, 'camera'), { rid: lower(ordered.length <= 2 ? RID.full : RID.half) })
        n++
      }
      if (sharer) video.set(trackKey(sharer.id, 'screen'), { rid: lower(RID.full) })
      featured = input.activeSpeakerId
      break
    }
    case 'grid': {
      if (sharer) {
        video.set(trackKey(sharer.id, 'screen'), { rid: RID.half })
        budget -= 1
      }
      for (const p of orderBySpeaking(others, input.recentSpeakers, input.activeSpeakerId)) {
        if (budget <= 0) break
        if (!isVisible(p.id) || !hasCam(p)) continue
        video.set(trackKey(p.id, 'camera'), { rid: RID.quarter })
        budget -= 1
      }
      break
    }
    case 'lowbandwidth': {
      if (sharer) video.set(trackKey(sharer.id, 'screen'), { rid: RID.half })
      const speaker = input.activeSpeakerId && input.activeSpeakerId !== input.myId ? input.activeSpeakerId : null
      const sp = others.find((p) => p.id === speaker)
      if (sp && hasCam(sp)) video.set(trackKey(sp.id, 'camera'), { rid: RID.quarter })
      featured = sharer ? sharer.id : speaker
      break
    }
  }

  return { video, featuredParticipantId: featured, screenParticipantId: sharer?.id ?? null }
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
