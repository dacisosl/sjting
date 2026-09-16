/**
 * 회의방 Durable Object — WebSocket Hibernation API 기반 시그널링 서버.
 * - 첫 메시지는 join 이어야 하며 10초 내 인증되지 않으면 연결을 끊는다
 * - 모든 요청은 zod 스키마 검증, 메시지 빈도 제한, IP 별 인증 실패 제한
 * - 인원(20명)·잠금·종료는 서버에서 강제
 * - 재접속 30초 유예, 방장 5분 부재·10분 공실 시 자동 종료
 * - 1분마다 접속 인원을 사용량 계량기에 더한다
 */
import { DurableObject } from 'cloudflare:workers'
import {
  AUTH_FAILURE_WINDOW_MS,
  AUTH_MAX_FAILURES_PER_IP,
  CHAT_MAX_PER_10SEC,
  EMPTY_ROOM_CLOSE_MS,
  HOST_ABSENT_CLOSE_MS,
  RECONNECT_GRACE_MS,
  TICKET_TTL_SEC,
  WS_AUTH_TIMEOUT_MS,
  WS_MAX_MESSAGES_PER_SEC,
  WS_MAX_MESSAGE_BYTES
} from '../../src/shared/constants'
import {
  ClientEnvelopeSchema,
  HOST_ONLY_METHODS,
  RequestSchemas,
  type ErrorCode,
  type EventMap,
  type EventName,
  type RequestData,
  type RequestMethod,
  type ResponseMap,
  type ServerEvent
} from '../../src/shared/protocol'
import type { Participant } from '../../src/shared/types'
import { RateLimiter, randomToken, sha256Hex, signTicket, verifyToken } from './auth'
import type { Env } from './env'
import { RoomState, type RoomMeta, type RoomStateJSON } from './RoomState'
import type { UsageInfo } from './UsageMeterDO'

const ALARM_INTERVAL_MS = 15_000
const USAGE_TICK_MS = 60_000
const STATE_KEY = 'state'

interface Attachment {
  cid: string
  ip: string
  connectedAt: number
  pid: string | null
  isHost: boolean
}

class RequestError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
  }
}

export interface InitBody {
  hostTokenHash: string
  inviteTokenHash: string
  inviteExpiresAt: number
  inviteTtlSec: number
  mode: RoomMeta['mode']
  maxParticipants: number
}

export class SjtingRoom extends DurableObject<Env> {
  private state: RoomState | null | undefined = undefined
  private readonly msgLimiters = new Map<string, RateLimiter>()
  private readonly chatLimiters = new Map<string, RateLimiter>()
  private readonly authFailures = new RateLimiter(AUTH_MAX_FAILURES_PER_IP, AUTH_FAILURE_WINDOW_MS)
  private usageCache: { at: number; info: UsageInfo } | null = null

  // ---------------------------------------------------------------- 저장

  private async load(): Promise<RoomState | null> {
    if (this.state !== undefined) return this.state
    const j = await this.ctx.storage.get<RoomStateJSON>(STATE_KEY)
    this.state = j ? RoomState.fromJSON(j) : null
    return this.state
  }

  private async save(): Promise<void> {
    if (this.state) await this.ctx.storage.put(STATE_KEY, this.state.toJSON())
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS)
  }

  // ---------------------------------------------------------------- HTTP

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/init') {
      const body = (await request.json()) as InitBody
      const roomId = url.searchParams.get('roomId') ?? ''
      const meta: RoomMeta = {
        id: roomId,
        mode: body.mode,
        locked: false,
        closed: false,
        createdAt: Date.now(),
        maxParticipants: body.maxParticipants,
        hostTokenHash: body.hostTokenHash,
        inviteTokenHash: body.inviteTokenHash,
        inviteExpiresAt: body.inviteExpiresAt,
        inviteTtlSec: body.inviteTtlSec
      }
      this.state = new RoomState(meta)
      await this.save()
      await this.ensureAlarm()
      return Response.json({ ok: true })
    }

    const state = await this.load()
    if (url.pathname === '/info') {
      if (!state) return Response.json({ exists: false })
      return Response.json({
        exists: true,
        closed: state.meta.closed,
        locked: state.meta.locked,
        mode: state.meta.mode,
        participantCount: state.size,
        maxParticipants: state.meta.maxParticipants
      })
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      if (!state || state.meta.closed) return new Response('room not found', { status: 404 })
      const ip = request.headers.get('x-client-ip') ?? 'unknown'
      if (this.authFailures.isBlocked(ip)) return new Response('too many attempts', { status: 429 })
      if (this.ctx.getWebSockets().length >= state.meta.maxParticipants + 5) return new Response('busy', { status: 503 })
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      const att: Attachment = { cid: randomToken(8), ip, connectedAt: Date.now(), pid: null, isHost: false }
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment(att)
      await this.ensureAlarm()
      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('not found', { status: 404 })
  }

  // ---------------------------------------------------------------- WebSocket

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment
    if (typeof message !== 'string') return ws.close(4002, 'binary not allowed')
    if (message.length > WS_MAX_MESSAGE_BYTES) return ws.close(4002, 'too large')
    let lim = this.msgLimiters.get(att.cid)
    if (!lim) {
      lim = new RateLimiter(WS_MAX_MESSAGES_PER_SEC, 1000)
      this.msgLimiters.set(att.cid, lim)
    }
    if (!lim.hit(att.cid)) return this.sendError(ws, 0, 'RATE_LIMITED', '요청이 너무 잦습니다')

    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return ws.close(4002, 'bad json')
    }
    const env = ClientEnvelopeSchema.safeParse(parsed)
    if (!env.success) return ws.close(4002, 'bad envelope')
    const { id, method, data } = env.data
    if (!(method in RequestSchemas)) return this.sendError(ws, id, 'BAD_REQUEST', '알 수 없는 요청')
    const m = method as RequestMethod
    if (!att.pid && m !== 'join') return this.sendError(ws, id, 'UNAUTHORIZED', '먼저 입장해야 합니다')
    if (HOST_ONLY_METHODS.has(m) && !att.isHost) return this.sendError(ws, id, 'FORBIDDEN', '방장만 사용할 수 있습니다')
    const v = RequestSchemas[m].safeParse(data)
    if (!v.success) return this.sendError(ws, id, 'BAD_REQUEST', '요청 형식이 올바르지 않습니다')

    try {
      const result = await this.dispatch(ws, att, m, v.data as never)
      this.send(ws, { id, ok: true, data: result })
    } catch (e) {
      if (e instanceof RequestError) return this.sendError(ws, id, e.code, e.message)
      console.error('request failed', m, e)
      this.sendError(ws, id, 'INTERNAL', '서버 처리 중 오류가 발생했습니다')
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null
    this.msgLimiters.delete(att?.cid ?? '')
    if (!att?.pid) return
    const state = await this.load()
    if (!state || state.meta.closed) return
    const p = state.get(att.pid)
    if (!p) return
    // 같은 참가자의 다른 소켓이 살아 있으면(재접속 완료) 아무것도 하지 않는다.
    // 닫히는 중인 소켓 자신은 아직 getWebSockets() 에 남아 있을 수 있으므로 제외한다.
    if (this.socketsFor(att.pid).some((s) => s !== ws)) return
    state.pendingLeave.set(att.pid, Date.now() + RECONNECT_GRACE_MS)
    state.update(att.pid, { connection: 'reconnecting', speaking: false, sharingScreen: false, tracks: {} })
    this.broadcast('participantUpdated', { participantId: att.pid, patch: { connection: 'reconnecting', speaking: false, sharingScreen: false, tracks: {} } })
    if (state.recomputeActiveSpeaker()) this.broadcast('activeSpeaker', { participantId: state.activeSpeakerId })
    await this.save()
    await this.ensureAlarm()
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.warn('ws error', error)
    await this.webSocketClose(ws, 1011, 'error', false)
  }

  // ---------------------------------------------------------------- 알람 (주기 작업)

  async alarm(): Promise<void> {
    const state = await this.load()
    if (!state) return
    const now = Date.now()
    if (state.meta.closed) {
      await this.ctx.storage.deleteAll()
      this.state = null
      return
    }
    let changed = false

    // 인증 시간 초과 소켓 정리
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment
      if (!att.pid && now - att.connectedAt > WS_AUTH_TIMEOUT_MS) ws.close(4001, 'auth timeout')
    }

    // 재접속 유예 만료
    for (const [pid, deadline] of [...state.pendingLeave]) {
      if (deadline <= now) {
        state.remove(pid, now)
        this.broadcast('participantLeft', { participantId: pid, reason: 'timeout' })
        changed = true
      }
    }

    // 방장 부재·공실 종료
    const hostConnected = this.ctx.getWebSockets().some((ws) => (ws.deserializeAttachment() as Attachment).isHost && (ws.deserializeAttachment() as Attachment).pid)
    if (hostConnected) state.hostLastSeen = now
    if (!hostConnected && now - state.hostLastSeen > HOST_ABSENT_CLOSE_MS) {
      return this.closeRoom('방장이 자리를 비워 회의가 종료되었습니다')
    }
    if (state.size === 0 && state.emptySince !== null && now - state.emptySince > EMPTY_ROOM_CLOSE_MS) {
      return this.closeRoom('참가자가 없어 회의가 종료되었습니다')
    }

    // 사용량 계량 (1분마다 접속 인원만큼 참가자-분 누적)
    const lastTick = (await this.ctx.storage.get<number>('usageTick')) ?? state.meta.createdAt
    if (now - lastTick >= USAGE_TICK_MS) {
      const connected = new Set(this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment).pid).filter(Boolean)).size
      const minutes = Math.floor((now - lastTick) / USAGE_TICK_MS)
      await this.ctx.storage.put('usageTick', lastTick + minutes * USAGE_TICK_MS)
      if (connected > 0) {
        const info = await this.usage(connected * minutes)
        if (info.exceeded) return this.closeRoom('이번 달 무료 사용량을 모두 사용해 회의가 종료되었습니다')
      }
    }

    if (changed) await this.save()
    await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS)
  }

  private async usage(addMinutes = 0): Promise<UsageInfo> {
    if (addMinutes === 0 && this.usageCache && Date.now() - this.usageCache.at < 30_000) return this.usageCache.info
    const stub = this.env.USAGE.get(this.env.USAGE.idFromName('global'))
    const res = addMinutes > 0
      ? await stub.fetch('https://usage/add', { method: 'POST', body: JSON.stringify({ minutes: addMinutes }) })
      : await stub.fetch('https://usage/')
    const info = (await res.json()) as UsageInfo
    this.usageCache = { at: Date.now(), info }
    return info
  }

  // ---------------------------------------------------------------- 요청 처리

  private async dispatch<M extends RequestMethod>(ws: WebSocket, att: Attachment, method: M, data: RequestData<M>): Promise<ResponseMap[M]> {
    type R = ResponseMap[M]
    const state = await this.load()
    if (!state || state.meta.closed) throw new RequestError('ROOM_CLOSED', '종료된 회의입니다')

    switch (method) {
      case 'join':
        return (await this.handleJoin(ws, att, state, data as RequestData<'join'>)) as R

      case 'setTracks': {
        const patch = state.setTracks(att.pid!, data as RequestData<'setTracks'>)
        if (patch) this.broadcast('participantUpdated', { participantId: att.pid!, patch })
        await this.save()
        return {} as R
      }

      case 'updateSelf': {
        const d = data as RequestData<'updateSelf'>
        const next = state.update(att.pid!, d)
        if (next) {
          this.broadcast('participantUpdated', { participantId: att.pid!, patch: d })
          if ('speaking' in d && state.recomputeActiveSpeaker()) this.broadcast('activeSpeaker', { participantId: state.activeSpeakerId })
        }
        await this.save()
        return {} as R
      }

      case 'chat': {
        const d = data as RequestData<'chat'>
        let lim = this.chatLimiters.get(att.pid!)
        if (!lim) {
          lim = new RateLimiter(CHAT_MAX_PER_10SEC, 10_000)
          this.chatLimiters.set(att.pid!, lim)
        }
        if (!lim.hit(att.pid!)) throw new RequestError('RATE_LIMITED', '채팅이 너무 잦습니다')
        const me = state.get(att.pid!)!
        const msg = state.addChat(me.id, me.displayName, d.text)
        this.broadcast('chat', msg)
        await this.save()
        return { id: msg.id } as R
      }

      case 'ping':
        return { serverTime: Date.now() } as R

      case 'kick': {
        const d = data as RequestData<'kick'>
        if (d.participantId === att.pid) throw new RequestError('BAD_REQUEST', '자기 자신은 강퇴할 수 없습니다')
        for (const target of this.socketsFor(d.participantId)) {
          this.sendEvent(target, 'kicked', { reason: '방장이 퇴장시켰습니다' })
          const tatt = target.deserializeAttachment() as Attachment
          target.serializeAttachment({ ...tatt, pid: null })
          target.close(4003, 'kicked')
        }
        if (state.remove(d.participantId)) this.broadcast('participantLeft', { participantId: d.participantId, reason: 'kicked' })
        await this.save()
        return {} as R
      }

      case 'muteAll': {
        for (const p of state.list()) {
          if (p.isHost) continue
          state.update(p.id, { micMuted: true })
          this.broadcast('participantUpdated', { participantId: p.id, patch: { micMuted: true } })
        }
        this.broadcast('chat', state.addChat('system', '시스템', '방장이 전체 음소거를 요청했습니다', true))
        await this.save()
        return {} as R
      }

      case 'setLock': {
        state.meta.locked = (data as RequestData<'setLock'>).locked
        this.broadcast('roomUpdated', { locked: state.meta.locked })
        await this.save()
        return {} as R
      }

      case 'setMode': {
        state.meta.mode = (data as RequestData<'setMode'>).mode
        this.broadcast('roomUpdated', { mode: state.meta.mode })
        await this.save()
        return {} as R
      }

      case 'rotateInvite': {
        const token = randomToken(16)
        state.meta.inviteTokenHash = await sha256Hex(token)
        state.meta.inviteExpiresAt = Math.floor(Date.now() / 1000) + state.meta.inviteTtlSec
        await this.save()
        for (const s of this.hostSockets()) if (s !== ws) this.sendEvent(s, 'inviteRotated', { token, expiresAt: state.meta.inviteExpiresAt })
        return { token, expiresAt: state.meta.inviteExpiresAt } as R
      }

      case 'closeRoom':
        // 응답을 먼저 보낼 수 있도록 종료는 다음 틱에
        void Promise.resolve().then(() => this.closeRoom('방장이 회의를 종료했습니다'))
        return {} as R

      case 'leave': {
        const pid = att.pid!
        ws.serializeAttachment({ ...att, pid: null })
        if (state.remove(pid)) this.broadcast('participantLeft', { participantId: pid, reason: 'left' })
        if (state.recomputeActiveSpeaker()) this.broadcast('activeSpeaker', { participantId: state.activeSpeakerId })
        await this.save()
        setTimeout(() => ws.close(1000, 'bye'), 50)
        return {} as R
      }

      default:
        throw new RequestError('BAD_REQUEST', '지원하지 않는 요청')
    }
  }

  private async handleJoin(ws: WebSocket, att: Attachment, state: RoomState, d: RequestData<'join'>): Promise<ResponseMap['join']> {
    if (att.pid) throw new RequestError('BAD_REQUEST', '이미 입장했습니다')

    const isHost = await verifyToken(d.token, state.meta.hostTokenHash)
    let ok = isHost
    if (!ok) {
      const nowSec = Math.floor(Date.now() / 1000)
      if (state.meta.inviteExpiresAt !== 0 && nowSec > state.meta.inviteExpiresAt) {
        this.authFailures.hit(att.ip)
        throw new RequestError('INVITE_EXPIRED', '만료된 초대코드입니다')
      }
      ok = await verifyToken(d.token, state.meta.inviteTokenHash)
    }
    if (!ok) {
      this.authFailures.hit(att.ip)
      throw new RequestError('UNAUTHORIZED', '초대코드가 올바르지 않습니다')
    }

    // 재접속
    let participant: Participant | null = null
    if (d.resume) {
      const hash = state.resumeKeyHashes.get(d.resume.participantId)
      if (hash && (await verifyToken(d.resume.resumeKey, hash)) && state.get(d.resume.participantId)) {
        state.pendingLeave.delete(d.resume.participantId)
        participant = state.update(d.resume.participantId, { connection: 'connected', displayName: d.displayName })
        // 남아 있는 옛 소켓 정리
        for (const old of this.socketsFor(d.resume.participantId)) if (old !== ws) old.close(4004, 'replaced')
      }
    }
    const resuming = !!participant
    const denial = state.canJoin(isHost, resuming)
    if (denial) {
      const msg = denial === 'ROOM_FULL' ? '회의 인원이 가득 찼습니다' : denial === 'ROOM_LOCKED' ? '방장이 입장을 잠갔습니다' : '종료된 회의입니다'
      throw new RequestError(denial, msg)
    }
    if (!resuming) {
      const usage = await this.usage()
      if (usage.exceeded) throw new RequestError('BUDGET_EXCEEDED', '이번 달 무료 사용량을 모두 사용했습니다. 다음 달에 다시 이용할 수 있습니다')
      participant = state.createParticipant(d.displayName, isHost)
    }

    const resumeKey = randomToken(16)
    state.resumeKeyHashes.set(participant!.id, await sha256Hex(resumeKey))
    ws.serializeAttachment({ ...att, pid: participant!.id, isHost } satisfies Attachment)
    this.authFailures.reset(att.ip)
    if (isHost) state.hostLastSeen = Date.now()

    if (resuming) this.broadcast('participantUpdated', { participantId: participant!.id, patch: { connection: 'connected', displayName: d.displayName } }, ws)
    else this.broadcast('participantJoined', { participant: participant! }, ws)
    await this.save()
    await this.ensureAlarm()

    const ticket = await signTicket(this.env.TICKET_SECRET, { r: state.meta.id, p: participant!.id, exp: Math.floor(Date.now() / 1000) + TICKET_TTL_SEC })
    return {
      participantId: participant!.id,
      resumeKey,
      isHost,
      ticket,
      room: state.snapshot(isHost),
      chatHistory: state.chatHistory()
    }
  }

  private async closeRoom(reason: string): Promise<void> {
    const state = await this.load()
    if (!state || state.meta.closed) return
    this.broadcast('roomClosed', { reason })
    state.destroy()
    await this.save()
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1001, 'room closed')
      } catch {
        /* ignore */
      }
    }
    await this.ctx.storage.deleteAll()
    await this.ctx.storage.deleteAlarm()
    this.state = null
  }

  // ---------------------------------------------------------------- 전송 헬퍼

  private socketsFor(pid: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment).pid === pid)
  }

  private hostSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment() as Attachment
      return a.isHost && a.pid
    })
  }

  private send(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* closed */
    }
  }

  private sendError(ws: WebSocket, id: number, code: ErrorCode, message: string): void {
    this.send(ws, { id, ok: false, error: { code, message } })
  }

  private sendEvent<E extends EventName>(ws: WebSocket, event: E, data: EventMap[E]): void {
    const msg: ServerEvent<E> = { event, data }
    this.send(ws, msg)
  }

  private broadcast<E extends EventName>(event: E, data: EventMap[E], except?: WebSocket): void {
    const payload = JSON.stringify({ event, data } satisfies ServerEvent<E>)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      const a = ws.deserializeAttachment() as Attachment
      if (!a.pid) continue
      try {
        ws.send(payload)
      } catch {
        /* closed */
      }
    }
  }
}
