/**
 * WSS 시그널링 서버 (계획서 5.2, 7.3, 8장)
 * - 첫 메시지는 join 이어야 하며 10초 내 인증되지 않으면 연결을 끊는다
 * - 모든 요청은 zod 스키마 검증, 메시지 크기·빈도 제한, IP 별 인증 실패 제한
 * - 참가자 한 명의 오류는 해당 연결에서 격리한다
 */
import https from 'node:https'
import { EventEmitter } from 'node:events'
import type { types as msTypes } from 'mediasoup'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import {
  AUTH_FAILURE_WINDOW_MS,
  AUTH_MAX_FAILURES_PER_IP,
  CHAT_MAX_PER_10SEC,
  RECONNECT_GRACE_MS,
  WS_AUTH_TIMEOUT_MS,
  WS_MAX_MESSAGES_PER_SEC,
  WS_MAX_MESSAGE_BYTES,
  type MediaSource
} from '@shared/constants'
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
} from '@shared/protocol'
import type { Participant } from '@shared/types'
import { createLogger } from '../logger'
import { generateId, generateToken, hashToken, RateLimiter, verifyToken } from '../security/tokens'
import type { MediasoupServer } from './MediasoupServer'
import { Room } from './Room'

const log = createLogger('signaling')

class RequestError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
  }
}

interface Peer {
  ws: WebSocket
  ip: string
  authenticated: boolean
  participantId: string | null
  isHost: boolean
  resumeKeyHash: Buffer | null
  rtpCapabilities: msTypes.RtpCapabilities | null
  transports: Map<string, msTypes.WebRtcTransport>
  producers: Map<string, msTypes.Producer>
  consumers: Map<string, msTypes.Consumer>
  msgLimiter: RateLimiter
  chatLimiter: RateLimiter
  authTimer: NodeJS.Timeout | null
}

export interface SignalingServerOptions {
  port: number
  tls: { key: string; cert: string }
  media: MediasoupServer
  room: Room
  hostTokenHash: Buffer
  /** 초대 토큰은 재발급될 수 있으므로 getter 로 받는다 */
  getInviteTokenHash: () => Buffer | null
  getInviteExpiresAt: () => number
}

export interface SignalingEvents {
  participantsChanged: [number]
  closed: []
}

export class SignalingServer extends EventEmitter<SignalingEvents> {
  private httpServer: https.Server | null = null
  private wss: WebSocketServer | null = null
  private readonly peers = new Set<Peer>()
  /** 참가자 ID → 재접속 대기 중인 이전 피어 */
  private readonly detached = new Map<string, { peer: Peer; timer: NodeJS.Timeout }>()
  private readonly authFailures = new RateLimiter(AUTH_MAX_FAILURES_PER_IP, AUTH_FAILURE_WINDOW_MS)
  private sweepTimer: NodeJS.Timeout | null = null
  private closing = false

  constructor(private readonly opts: SignalingServerOptions) {
    super()
    this.opts.media.on('activeSpeaker', (pid) => {
      if (this.opts.room.activeSpeakerId === pid) return
      this.opts.room.activeSpeakerId = pid
      this.broadcast('activeSpeaker', { participantId: pid })
    })
  }

  get room(): Room {
    return this.opts.room
  }

  async start(): Promise<void> {
    this.httpServer = https.createServer({ key: this.opts.tls.key, cert: this.opts.tls.cert, minVersion: 'TLSv1.2' }, (_req, res) => {
      res.writeHead(404)
      res.end()
    })
    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: WS_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      verifyClient: ({ req }, done) => {
        const ip = req.socket.remoteAddress ?? 'unknown'
        if (this.authFailures.isBlocked(ip)) return done(false, 429, 'Too Many Requests')
        if (this.peers.size >= this.opts.room.maxParticipants + 5) return done(false, 503, 'Busy')
        done(true)
      }
    })
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req.socket.remoteAddress ?? 'unknown'))
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject)
      this.httpServer!.listen(this.opts.port, '0.0.0.0', () => resolve())
    })
    this.sweepTimer = setInterval(() => this.authFailures.sweep(), 30_000)
    log.info(`시그널링 서버 대기 중 (포트 ${this.opts.port})`)
  }

  // ---------------------------------------------------------------- connection

  private onConnection(ws: WebSocket, ip: string): void {
    const peer: Peer = {
      ws,
      ip,
      authenticated: false,
      participantId: null,
      isHost: false,
      resumeKeyHash: null,
      rtpCapabilities: null,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      msgLimiter: new RateLimiter(WS_MAX_MESSAGES_PER_SEC, 1000),
      chatLimiter: new RateLimiter(CHAT_MAX_PER_10SEC, 10_000),
      authTimer: null
    }
    this.peers.add(peer)
    peer.authTimer = setTimeout(() => {
      if (!peer.authenticated) ws.close(4001, 'auth timeout')
    }, WS_AUTH_TIMEOUT_MS)

    ws.on('message', (data, isBinary) => {
      void this.onMessage(peer, data, isBinary)
    })
    ws.on('close', () => this.onClose(peer))
    ws.on('error', (e) => log.warn('ws 오류', e))
  }

  private async onMessage(peer: Peer, data: RawData, isBinary: boolean): Promise<void> {
    if (isBinary) return peer.ws.close(4002, 'binary not allowed')
    if (!peer.msgLimiter.hit(peer.ip + ':' + (peer.participantId ?? 'anon'))) {
      return this.sendError(peer, 0, 'RATE_LIMITED', '요청이 너무 잦습니다')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data.toString())
    } catch {
      return peer.ws.close(4002, 'bad json')
    }
    const env = ClientEnvelopeSchema.safeParse(parsed)
    if (!env.success) return peer.ws.close(4002, 'bad envelope')
    const { id, method, data: body } = env.data

    if (!(method in RequestSchemas)) return this.sendError(peer, id, 'BAD_REQUEST', '알 수 없는 요청')
    const m = method as RequestMethod
    if (!peer.authenticated && m !== 'join') return this.sendError(peer, id, 'UNAUTHORIZED', '먼저 입장해야 합니다')
    if (HOST_ONLY_METHODS.has(m) && !peer.isHost) return this.sendError(peer, id, 'FORBIDDEN', '방장만 사용할 수 있습니다')

    const schema = RequestSchemas[m]
    const v = schema.safeParse(body)
    if (!v.success) return this.sendError(peer, id, 'BAD_REQUEST', '요청 형식이 올바르지 않습니다')

    try {
      const result = await this.dispatch(peer, m, v.data as never)
      this.send(peer, { id, ok: true, data: result })
    } catch (e) {
      if (e instanceof RequestError) return this.sendError(peer, id, e.code, e.message)
      log.error(`요청 처리 실패 (${m})`, e)
      this.sendError(peer, id, 'INTERNAL', '서버 처리 중 오류가 발생했습니다')
    }
  }

  private onClose(peer: Peer): void {
    this.peers.delete(peer)
    if (peer.authTimer) clearTimeout(peer.authTimer)
    if (!peer.authenticated || !peer.participantId || this.closing) {
      this.releaseMedia(peer)
      return
    }
    // 재접속 대기: 자리를 유지하고 미디어는 정리한다 (재접속 시 클라이언트가 다시 만든다)
    const pid = peer.participantId
    this.releaseMedia(peer, true)
    this.opts.room.update(pid, { connection: 'reconnecting', sharingScreen: false })
    this.broadcast('participantUpdated', { participantId: pid, patch: { connection: 'reconnecting', sharingScreen: false } })
    const timer = setTimeout(() => {
      this.detached.delete(pid)
      this.removeParticipant(pid, 'timeout')
    }, RECONNECT_GRACE_MS)
    this.detached.set(pid, { peer, timer })
  }

  private releaseMedia(peer: Peer, notify = false): void {
    for (const c of peer.consumers.values()) c.close()
    for (const p of peer.producers.values()) {
      p.close()
      const info = this.opts.room.removeProducer(p.id)
      if (notify && info) this.broadcast('producerClosed', { participantId: info.participantId, producerId: p.id })
    }
    for (const t of peer.transports.values()) t.close()
    peer.consumers.clear()
    peer.producers.clear()
    peer.transports.clear()
  }

  private removeParticipant(pid: string, reason: EventMap['participantLeft']['reason']): void {
    const p = this.opts.room.remove(pid)
    if (!p) return
    this.broadcast('participantLeft', { participantId: pid, reason })
    this.emit('participantsChanged', this.opts.room.size)
    log.info(`참가자 퇴장 (${reason})`)
  }

  // ---------------------------------------------------------------- dispatch

  private async dispatch<M extends RequestMethod>(peer: Peer, method: M, data: RequestData<M>): Promise<ResponseMap[M]> {
    type R = ResponseMap[M]
    switch (method) {
      case 'join':
        return (await this.handleJoin(peer, data as RequestData<'join'>)) as R
      case 'createTransport': {
        const d = data as RequestData<'createTransport'>
        if (d.rtpCapabilities) peer.rtpCapabilities = d.rtpCapabilities as msTypes.RtpCapabilities
        const t = await this.opts.media.createTransport({ participantId: peer.participantId, direction: d.direction })
        peer.transports.set(t.id, t)
        t.on('dtlsstatechange', (s) => {
          if (s === 'failed' || s === 'closed') {
            log.warn(`transport dtls ${s}`)
            t.close()
            peer.transports.delete(t.id)
          }
        })
        t.on('icestatechange', (s) => {
          if (s === 'disconnected') log.warn('transport ice disconnected')
        })
        return {
          id: t.id,
          iceParameters: t.iceParameters,
          iceCandidates: t.iceCandidates,
          dtlsParameters: t.dtlsParameters
        } as R
      }
      case 'connectTransport': {
        const d = data as RequestData<'connectTransport'>
        const t = this.requireTransport(peer, d.transportId)
        await t.connect({ dtlsParameters: d.dtlsParameters as msTypes.DtlsParameters })
        return {} as R
      }
      case 'restartIce': {
        const d = data as RequestData<'restartIce'>
        const t = this.requireTransport(peer, d.transportId)
        return { iceParameters: await t.restartIce() } as R
      }
      case 'produce':
        return (await this.handleProduce(peer, data as RequestData<'produce'>)) as R
      case 'closeProducer': {
        const d = data as RequestData<'closeProducer'>
        const p = peer.producers.get(d.producerId)
        if (p) {
          p.close()
          peer.producers.delete(p.id)
          const info = this.opts.room.removeProducer(p.id)
          if (info) this.broadcast('producerClosed', { participantId: info.participantId, producerId: p.id })
        }
        return {} as R
      }
      case 'pauseProducer':
      case 'resumeProducer': {
        const d = data as RequestData<'pauseProducer'>
        const p = peer.producers.get(d.producerId)
        if (!p) throw new RequestError('NOT_FOUND', 'producer 없음')
        if (method === 'pauseProducer') await p.pause()
        else await p.resume()
        this.opts.room.setProducerPaused(p.id, p.paused)
        this.broadcast(method === 'pauseProducer' ? 'producerPaused' : 'producerResumed', { producerId: p.id })
        return {} as R
      }
      case 'consume':
        return (await this.handleConsume(peer, data as RequestData<'consume'>)) as R
      case 'pauseConsumer':
      case 'resumeConsumer': {
        const d = data as RequestData<'pauseConsumer'>
        const c = peer.consumers.get(d.consumerId)
        if (!c) throw new RequestError('NOT_FOUND', 'consumer 없음')
        if (method === 'pauseConsumer') await c.pause()
        else await c.resume()
        return {} as R
      }
      case 'setConsumerLayers': {
        const d = data as RequestData<'setConsumerLayers'>
        const c = peer.consumers.get(d.consumerId)
        if (!c) throw new RequestError('NOT_FOUND', 'consumer 없음')
        if (c.type === 'simulcast' || c.type === 'svc') {
          await c.setPreferredLayers({ spatialLayer: d.spatialLayer, temporalLayer: d.temporalLayer })
        }
        return {} as R
      }
      case 'chat': {
        const d = data as RequestData<'chat'>
        if (!peer.chatLimiter.hit(peer.participantId!)) throw new RequestError('RATE_LIMITED', '채팅이 너무 잦습니다')
        const me = this.opts.room.get(peer.participantId!)!
        const msg = this.opts.room.addChat(me.id, me.displayName, d.text)
        this.broadcast('chat', msg)
        return { id: msg.id } as R
      }
      case 'updateSelf': {
        const d = data as RequestData<'updateSelf'>
        const next = this.opts.room.update(peer.participantId!, d)
        if (next) this.broadcast('participantUpdated', { participantId: next.id, patch: d })
        return {} as R
      }
      case 'kick': {
        const d = data as RequestData<'kick'>
        if (d.participantId === peer.participantId) throw new RequestError('BAD_REQUEST', '자기 자신은 강퇴할 수 없습니다')
        const target = this.findPeer(d.participantId)
        if (target) {
          this.sendEvent(target, 'kicked', { reason: '방장이 퇴장시켰습니다' })
          target.authenticated = false // onClose 에서 재접속 대기 없이 정리
          target.ws.close(4003, 'kicked')
          this.releaseMedia(target, true)
        }
        const det = this.detached.get(d.participantId)
        if (det) {
          clearTimeout(det.timer)
          this.detached.delete(d.participantId)
        }
        this.removeParticipant(d.participantId, 'kicked')
        return {} as R
      }
      case 'muteAll': {
        for (const p of this.peers) {
          if (!p.authenticated || p.isHost || !p.participantId) continue
          for (const prod of p.producers.values()) {
            if ((prod.appData as { source?: MediaSource }).source === 'mic' && !prod.paused) {
              await prod.pause()
              this.opts.room.setProducerPaused(prod.id, true)
              this.broadcast('producerPaused', { producerId: prod.id })
            }
          }
          this.opts.room.update(p.participantId, { micMuted: true })
          this.broadcast('participantUpdated', { participantId: p.participantId, patch: { micMuted: true } })
        }
        const sys = this.opts.room.addChat('system', '시스템', '방장이 전체 음소거를 실행했습니다', true)
        this.broadcast('chat', sys)
        return {} as R
      }
      case 'setLock': {
        const d = data as RequestData<'setLock'>
        this.opts.room.locked = d.locked
        this.broadcast('roomUpdated', { locked: d.locked })
        return {} as R
      }
      case 'setMode': {
        const d = data as RequestData<'setMode'>
        this.opts.room.mode = d.mode
        this.broadcast('roomUpdated', { mode: d.mode })
        return {} as R
      }
      case 'closeRoom':
        setTimeout(() => void this.close('방장이 회의를 종료했습니다'), 50)
        return {} as R
      case 'leave': {
        const pid = peer.participantId!
        peer.authenticated = false
        this.releaseMedia(peer, true)
        this.removeParticipant(pid, 'left')
        setTimeout(() => peer.ws.close(1000, 'bye'), 50)
        return {} as R
      }
      default:
        throw new RequestError('BAD_REQUEST', '지원하지 않는 요청')
    }
  }

  private async handleJoin(peer: Peer, d: RequestData<'join'>): Promise<ResponseMap['join']> {
    if (peer.authenticated) throw new RequestError('BAD_REQUEST', '이미 입장했습니다')
    const room = this.opts.room

    const isHost = verifyToken(d.token, this.opts.hostTokenHash)
    let ok = isHost
    if (!ok) {
      const inviteHash = this.opts.getInviteTokenHash()
      const exp = this.opts.getInviteExpiresAt()
      if (exp !== 0 && Math.floor(Date.now() / 1000) > exp) {
        this.authFailures.hit(peer.ip)
        throw new RequestError('INVITE_EXPIRED', '만료된 초대코드입니다')
      }
      ok = !!inviteHash && verifyToken(d.token, inviteHash)
    }
    if (!ok) {
      this.authFailures.hit(peer.ip)
      log.warn('인증 실패')
      throw new RequestError('UNAUTHORIZED', '초대코드가 올바르지 않습니다')
    }

    // 재접속 처리
    let participant: Participant | null = null
    if (d.resume) {
      const det = this.detached.get(d.resume.participantId)
      if (det && det.peer.resumeKeyHash && verifyToken(d.resume.resumeKey, det.peer.resumeKeyHash)) {
        clearTimeout(det.timer)
        this.detached.delete(d.resume.participantId)
        participant = room.update(d.resume.participantId, { connection: 'connected', displayName: d.displayName })
      }
    }
    const resuming = !!participant
    const denial = room.canJoin(isHost, resuming)
    if (denial) throw new RequestError(denial, denial === 'ROOM_FULL' ? '회의 인원이 가득 찼습니다' : '방장이 입장을 잠갔습니다')

    if (!participant) {
      participant = {
        id: generateId(6),
        displayName: d.displayName,
        isHost,
        micMuted: false,
        camOff: true,
        handRaised: false,
        sharingScreen: false,
        connection: 'connected',
        joinedAt: Date.now()
      }
      room.add(participant)
    }

    if (peer.authTimer) clearTimeout(peer.authTimer)
    const resumeKey = generateToken(16)
    peer.authenticated = true
    peer.participantId = participant.id
    peer.isHost = isHost
    peer.resumeKeyHash = hashToken(resumeKey)
    this.authFailures.reset(peer.ip)

    if (resuming) this.broadcast('participantUpdated', { participantId: participant.id, patch: { connection: 'connected' } }, peer)
    else this.broadcast('participantJoined', { participant }, peer)
    this.emit('participantsChanged', room.size)
    log.info(`참가자 입장 (${isHost ? '방장' : '참가자'}, 현재 ${room.size}명)`)

    return {
      participantId: participant.id,
      resumeKey,
      isHost,
      routerRtpCapabilities: this.opts.media.routerRtpCapabilities,
      room: room.snapshot(),
      chatHistory: room.chatHistory()
    }
  }

  private async handleProduce(peer: Peer, d: RequestData<'produce'>): Promise<ResponseMap['produce']> {
    const t = this.requireTransport(peer, d.transportId)
    // 참가자 1명당 소스별 producer 1개만 허용
    for (const p of peer.producers.values()) {
      if ((p.appData as { source?: MediaSource }).source === d.source) {
        p.close()
        peer.producers.delete(p.id)
        const info = this.opts.room.removeProducer(p.id)
        if (info) this.broadcast('producerClosed', { participantId: info.participantId, producerId: p.id })
      }
    }
    const producer = await t.produce({
      kind: d.kind,
      rtpParameters: d.rtpParameters as msTypes.RtpParameters,
      appData: { participantId: peer.participantId!, source: d.source }
    })
    peer.producers.set(producer.id, producer)
    producer.on('transportclose', () => {
      peer.producers.delete(producer.id)
      const info = this.opts.room.removeProducer(producer.id)
      if (info) this.broadcast('producerClosed', { participantId: info.participantId, producerId: producer.id })
    })
    const info = { producerId: producer.id, participantId: peer.participantId!, kind: d.kind, source: d.source, paused: false }
    this.opts.room.addProducer(info)
    if (d.source === 'mic') await this.opts.media.observeAudioProducer(producer.id)
    if (d.source === 'camera') this.opts.room.update(peer.participantId!, { camOff: false })
    this.broadcast('newProducer', info, peer)
    if (d.source === 'screen') this.broadcast('participantUpdated', { participantId: peer.participantId!, patch: { sharingScreen: true } })
    if (d.source === 'camera') this.broadcast('participantUpdated', { participantId: peer.participantId!, patch: { camOff: false } })
    return { producerId: producer.id }
  }

  private async handleConsume(peer: Peer, d: RequestData<'consume'>): Promise<ResponseMap['consume']> {
    const info = this.opts.room.getProducer(d.producerId)
    if (!info) throw new RequestError('NOT_FOUND', 'producer 없음')
    if (!peer.rtpCapabilities || !this.opts.media.canConsume(d.producerId, peer.rtpCapabilities)) {
      throw new RequestError('BAD_REQUEST', '이 미디어를 수신할 수 없습니다 (코덱 불일치)')
    }
    const recv = [...peer.transports.values()].find((t) => (t.appData as { direction?: string }).direction === 'recv')
    if (!recv) throw new RequestError('BAD_REQUEST', '수신 transport 가 없습니다')
    const consumer = await recv.consume({
      producerId: d.producerId,
      rtpCapabilities: peer.rtpCapabilities,
      paused: true, // 클라이언트가 준비된 뒤 resume (계획서 6.4)
      appData: { participantId: info.participantId, source: info.source }
    })
    peer.consumers.set(consumer.id, consumer)
    const drop = () => {
      peer.consumers.delete(consumer.id)
      this.sendEvent(peer, 'consumerClosed', { consumerId: consumer.id })
    }
    consumer.on('transportclose', drop)
    consumer.on('producerclose', drop)
    consumer.on('producerpause', () => this.sendEvent(peer, 'consumerPaused', { consumerId: consumer.id }))
    consumer.on('producerresume', () => this.sendEvent(peer, 'consumerResumed', { consumerId: consumer.id }))
    consumer.on('layerschange', (layers) =>
      this.sendEvent(peer, 'consumerLayersChanged', {
        consumerId: consumer.id,
        spatialLayer: layers?.spatialLayer ?? null,
        temporalLayer: layers?.temporalLayer ?? null
      })
    )
    return {
      consumerId: consumer.id,
      producerId: d.producerId,
      participantId: info.participantId,
      kind: consumer.kind,
      source: info.source,
      rtpParameters: consumer.rtpParameters,
      producerPaused: consumer.producerPaused
    }
  }

  // ---------------------------------------------------------------- helpers

  private requireTransport(peer: Peer, id: string): msTypes.WebRtcTransport {
    const t = peer.transports.get(id)
    if (!t) throw new RequestError('NOT_FOUND', 'transport 없음')
    return t
  }

  private findPeer(participantId: string): Peer | undefined {
    for (const p of this.peers) if (p.participantId === participantId && p.authenticated) return p
    return undefined
  }

  private send(peer: Peer, msg: unknown): void {
    if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(JSON.stringify(msg))
  }

  private sendError(peer: Peer, id: number, code: ErrorCode, message: string): void {
    this.send(peer, { id, ok: false, error: { code, message } })
  }

  private sendEvent<E extends EventName>(peer: Peer, event: E, data: EventMap[E]): void {
    const msg: ServerEvent<E> = { event, data }
    this.send(peer, msg)
  }

  broadcast<E extends EventName>(event: E, data: EventMap[E], except?: Peer): void {
    const payload = JSON.stringify({ event, data } satisfies ServerEvent<E>)
    for (const p of this.peers) {
      if (p === except || !p.authenticated) continue
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload)
    }
  }

  /** 방장 통계용: 전체 transport 의 송수신 비트레이트 합 */
  async collectStats(): Promise<{ uploadBps: number; downloadBps: number; transports: number; producers: number; consumers: number }> {
    let uploadBps = 0
    let downloadBps = 0
    let transports = 0
    let producers = 0
    let consumers = 0
    for (const p of this.peers) {
      producers += p.producers.size
      consumers += p.consumers.size
      for (const t of p.transports.values()) {
        transports++
        try {
          const stats = await t.getStats()
          for (const s of stats) {
            uploadBps += s.sendBitrate ?? 0
            downloadBps += s.recvBitrate ?? 0
          }
        } catch {
          /* transport closed */
        }
      }
    }
    return { uploadBps, downloadBps, transports, producers, consumers }
  }

  /** 모든 참가자에게 종료를 알리고 서버를 닫는다 */
  async close(reason: string): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.broadcast('roomClosed', { reason })
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    for (const { timer } of this.detached.values()) clearTimeout(timer)
    this.detached.clear()
    await new Promise((r) => setTimeout(r, 100))
    for (const p of this.peers) {
      this.releaseMedia(p)
      try {
        p.ws.close(1001, 'room closed')
      } catch {
        /* ignore */
      }
    }
    this.peers.clear()
    this.opts.room.destroy()
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()))
    await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()))
    this.emit('closed')
    log.info('시그널링 서버 종료')
  }
}
