/**
 * 회의 클라이언트 — mediasoup-client + 시그널링을 묶어 스토어를 갱신한다.
 * 방장도 자신의 SFU 에 접속하는 한 명의 참가자로 동일 코드를 사용한다 (계획서 1.3).
 */
import { Device, types as ms } from 'mediasoup-client'
import type { LayoutMode, MediaSource, ScreenSharePreset } from '@shared/constants'
import { QUALITY, RECONNECT_GRACE_MS } from '@shared/constants'
import type { ConsumerParams } from '@shared/protocol'
import type { ChatMessage, NetworkQuality, RoomSnapshot } from '@shared/types'
import { getCameraTrack, getMicTrack, getScreenCapture, stopTrack } from './media'
import { isDegraded, planSubscriptions, pushRecentSpeaker } from './layout'
import { SignalingClient, SignalingError } from './signaling'
import { useMeetingStore, type RemoteConsumerState } from '../store/meetingStore'

export interface JoinParams {
  signalingUrl: string
  token: string
  displayName: string
}

const store = useMeetingStore

function rlog(level: 'info' | 'warn' | 'error', msg: string): void {
  try {
    window.sjting.log.write(level, msg)
  } catch {
    /* ignore */
  }
}

export class MeetingClient {
  private sig = new SignalingClient()
  private device: Device | null = null
  private sendTransport: ms.Transport | null = null
  private recvTransport: ms.Transport | null = null
  private producers = new Map<MediaSource, ms.Producer>()
  private consumers = new Map<string, ms.Consumer>()
  private consumerByProducer = new Map<string, string>()
  private pendingConsume = new Set<string>()
  private params: JoinParams | null = null
  private resume: { participantId: string; resumeKey: string } | null = null
  private closed = false
  private reconnecting = false
  private planTimer: number | null = null
  private statsTimer: number | null = null
  private unsubStore: (() => void) | null = null
  private lastStats: { ts: number; bytesSent: number; bytesRecv: number; lost: number; recv: number } | null = null
  private screenPreset: ScreenSharePreset = 'document'

  // ---------------------------------------------------------------- lifecycle

  async join(params: JoinParams): Promise<void> {
    this.params = params
    this.closed = false
    store.getState().set({ phase: 'connecting', error: null, endedReason: null })
    try {
      await this.connectAndJoin(false)
      store.getState().set({ phase: 'connected' })
      this.startStats()
      this.watchStore()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      store.getState().set({ phase: 'ended', endedReason: msg, error: msg })
      this.cleanupTransports()
      this.sig.close()
      throw e
    }
  }

  private async connectAndJoin(isResume: boolean): Promise<void> {
    if (!this.params) throw new Error('join params missing')
    this.sig.removeAllHandlers()
    this.bindEvents()
    await this.sig.connect(this.params.signalingUrl)
    const res = await this.sig.request('join', {
      token: this.params.token,
      displayName: this.params.displayName,
      resume: isResume && this.resume ? this.resume : undefined
    })
    this.resume = { participantId: res.participantId, resumeKey: res.resumeKey }

    if (!this.device) {
      this.device = new Device()
    }
    if (!this.device.loaded) {
      await this.device.load({ routerRtpCapabilities: res.routerRtpCapabilities as ms.RtpCapabilities })
    }
    this.applySnapshot(res.room, res.chatHistory, res.participantId, res.isHost)
    await this.createTransports()
  }

  private applySnapshot(room: RoomSnapshot, chat: ChatMessage[], myId: string, isHost: boolean): void {
    store.getState().set({
      me: { participantId: myId, isHost, displayName: this.params!.displayName },
      roomId: room.roomId,
      mode: room.mode,
      locked: room.locked,
      maxParticipants: room.maxParticipants,
      participants: room.participants,
      producers: room.producers,
      activeSpeakerId: room.activeSpeakerId,
      chat
    })
  }

  private bindEvents(): void {
    const s = store.getState
    this.sig.on('participantJoined', ({ participant }) => {
      s().upsertParticipant(participant)
      s().toast(`${participant.displayName} 님이 입장했습니다`)
    })
    this.sig.on('participantLeft', ({ participantId, reason }) => {
      const p = s().participants.find((x) => x.id === participantId)
      s().removeParticipant(participantId)
      if (p && reason !== 'timeout') s().toast(`${p.displayName} 님이 ${reason === 'kicked' ? '퇴장당했습니다' : '나갔습니다'}`)
      this.schedulePlan()
    })
    this.sig.on('participantUpdated', ({ participantId, patch }) => {
      s().patchParticipant(participantId, patch)
      this.schedulePlan()
    })
    this.sig.on('newProducer', (info) => {
      s().addProducer(info)
      this.schedulePlan()
    })
    this.sig.on('producerClosed', ({ producerId }) => {
      s().removeProducer(producerId)
      const cid = this.consumerByProducer.get(producerId)
      if (cid) this.dropConsumer(cid)
    })
    this.sig.on('producerPaused', ({ producerId }) => s().setProducerPaused(producerId, true))
    this.sig.on('producerResumed', ({ producerId }) => {
      s().setProducerPaused(producerId, false)
      this.schedulePlan()
    })
    this.sig.on('consumerClosed', ({ consumerId }) => this.dropConsumer(consumerId))
    this.sig.on('consumerPaused', ({ consumerId }) => s().patchConsumer(consumerId, { paused: true }))
    this.sig.on('consumerResumed', ({ consumerId }) => s().patchConsumer(consumerId, { paused: false }))
    this.sig.on('consumerLayersChanged', ({ consumerId, spatialLayer }) => s().patchConsumer(consumerId, { spatialLayer }))
    this.sig.on('activeSpeaker', ({ participantId }) => {
      s().set((st) => ({ activeSpeakerId: participantId, recentSpeakers: pushRecentSpeaker(st.recentSpeakers, participantId) }))
      this.schedulePlan()
    })
    this.sig.on('chat', (m) => s().addChat(m))
    this.sig.on('roomUpdated', (patch) => {
      s().set(patch)
      if (patch.mode) this.schedulePlan()
    })
    this.sig.on('kicked', ({ reason }) => this.end(reason))
    this.sig.on('roomClosed', ({ reason }) => this.end(reason))
    this.sig.onClose(() => {
      if (!this.closed) void this.reconnect()
    })
  }

  private async createTransports(): Promise<void> {
    if (!this.device) throw new Error('device not loaded')
    const sendParams = await this.sig.request('createTransport', { direction: 'send' })
    this.sendTransport = this.device.createSendTransport({
      id: sendParams.id,
      iceParameters: sendParams.iceParameters as ms.IceParameters,
      iceCandidates: sendParams.iceCandidates as ms.IceCandidate[],
      dtlsParameters: sendParams.dtlsParameters as ms.DtlsParameters,
      iceServers: []
    })
    this.sendTransport.on('connect', ({ dtlsParameters }, cb, eb) => {
      this.sig
        .request('connectTransport', { transportId: sendParams.id, dtlsParameters: dtlsParameters as unknown as Record<string, unknown> })
        .then(() => cb())
        .catch(eb)
    })
    this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, cb, eb) => {
      this.sig
        .request('produce', {
          transportId: sendParams.id,
          kind,
          rtpParameters: rtpParameters as unknown as Record<string, unknown>,
          source: (appData as { source: MediaSource }).source
        })
        .then(({ producerId }) => cb({ id: producerId }))
        .catch(eb)
    })
    this.sendTransport.on('connectionstatechange', (state) => this.onTransportState('send', state))

    const recvParams = await this.sig.request('createTransport', {
      direction: 'recv',
      rtpCapabilities: this.device.rtpCapabilities as unknown as Record<string, unknown>
    })
    this.recvTransport = this.device.createRecvTransport({
      id: recvParams.id,
      iceParameters: recvParams.iceParameters as ms.IceParameters,
      iceCandidates: recvParams.iceCandidates as ms.IceCandidate[],
      dtlsParameters: recvParams.dtlsParameters as ms.DtlsParameters,
      iceServers: []
    })
    this.recvTransport.on('connect', ({ dtlsParameters }, cb, eb) => {
      this.sig
        .request('connectTransport', { transportId: recvParams.id, dtlsParameters: dtlsParameters as unknown as Record<string, unknown> })
        .then(() => cb())
        .catch(eb)
    })
    this.recvTransport.on('connectionstatechange', (state) => this.onTransportState('recv', state))
    this.schedulePlan()
  }

  private async onTransportState(dir: 'send' | 'recv', state: string): Promise<void> {
    if (state === 'failed') {
      rlog('warn', `${dir} transport failed → ICE 재시작`)
      const t = dir === 'send' ? this.sendTransport : this.recvTransport
      if (!t) return
      try {
        const { iceParameters } = await this.sig.request('restartIce', { transportId: t.id })
        await t.restartIce({ iceParameters: iceParameters as ms.IceParameters })
      } catch {
        // ICE·DTLS 복구 실패 시 Transport 를 폐기하고 전체 재접속 (계획서 7.3)
        if (!this.closed) void this.reconnect(true)
      }
    }
  }

  private async reconnect(force = false): Promise<void> {
    if (this.reconnecting || this.closed) return
    this.reconnecting = true
    store.getState().set({ phase: 'reconnecting' })
    if (force) this.sig.close()
    this.cleanupTransports()
    const deadline = Date.now() + RECONNECT_GRACE_MS + 10_000
    let delay = 1000
    while (!this.closed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, delay))
      if (this.closed) break
      try {
        await this.connectAndJoin(true)
        await this.reproduceLocal()
        store.getState().set({ phase: 'connected' })
        store.getState().toast('다시 연결되었습니다')
        this.reconnecting = false
        return
      } catch (e) {
        if (e instanceof SignalingError && ['UNAUTHORIZED', 'ROOM_FULL', 'ROOM_LOCKED', 'INVITE_EXPIRED'].includes(e.code)) {
          this.reconnecting = false
          return this.end(e.message)
        }
        delay = Math.min(delay * 2, 8000)
      }
    }
    this.reconnecting = false
    if (!this.closed) this.end('연결이 끊어져 다시 연결하지 못했습니다')
  }

  private async reproduceLocal(): Promise<void> {
    const local = store.getState().local
    const wasMuted = store.getState().micMuted
    this.producers.clear()
    if (local.mic && local.mic.readyState === 'live') {
      await this.produceMic(local.mic)
      if (wasMuted) await this.setMicMuted(true)
    }
    if (local.camera && local.camera.readyState === 'live') await this.produceCamera(local.camera)
    if (local.screen && local.screen.readyState === 'live') {
      await this.produceScreen(local.screen, local.screenAudio)
    }
  }

  private cleanupTransports(): void {
    for (const c of this.consumers.values()) c.close()
    this.consumers.clear()
    this.consumerByProducer.clear()
    this.pendingConsume.clear()
    store.getState().set({ consumers: {} })
    for (const p of this.producers.values()) p.close()
    this.producers.clear()
    this.sendTransport?.close()
    this.recvTransport?.close()
    this.sendTransport = null
    this.recvTransport = null
  }

  private end(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.stopStats()
    this.unsubStore?.()
    this.cleanupTransports()
    this.sig.close()
    const local = store.getState().local
    stopTrack(local.mic)
    stopTrack(local.camera)
    stopTrack(local.screen)
    stopTrack(local.screenAudio)
    store.getState().set({
      phase: 'ended',
      endedReason: reason,
      local: { mic: null, camera: null, screen: null, screenAudio: null },
      sharing: false
    })
    void window.sjting.join.clear()
  }

  async leave(): Promise<void> {
    if (this.closed) return
    try {
      if (this.sig.connected) await this.sig.request('leave', {})
    } catch {
      /* ignore */
    }
    this.end('회의에서 나왔습니다')
  }

  // ---------------------------------------------------------------- 로컬 미디어

  async enableMic(deviceId: string | null): Promise<void> {
    const track = await getMicTrack(deviceId)
    stopTrack(store.getState().local.mic)
    store.getState().set((s) => ({ local: { ...s.local, mic: track }, micMuted: false }))
    track.onended = () => {
      store.getState().toast('마이크가 분리되었습니다. 다른 장치를 선택하세요', 'warn')
      void this.disableMic()
    }
    await this.produceMic(track)
    await this.sig.request('updateSelf', { micMuted: false }).catch(() => undefined)
  }

  private async produceMic(track: MediaStreamTrack): Promise<void> {
    if (!this.sendTransport) return
    const producer = await this.sendTransport.produce({
      track,
      codecOptions: { opusStereo: false, opusDtx: QUALITY.audio.opusDtx, opusFec: QUALITY.audio.opusFec, opusMaxAverageBitrate: QUALITY.audio.maxBitrate },
      appData: { source: 'mic' }
    })
    this.producers.set('mic', producer)
  }

  async setMicMuted(muted: boolean): Promise<void> {
    const p = this.producers.get('mic')
    store.getState().set({ micMuted: muted })
    if (!p) return
    if (muted) {
      p.pause()
      await this.sig.request('pauseProducer', { producerId: p.id }).catch(() => undefined)
    } else {
      p.resume()
      await this.sig.request('resumeProducer', { producerId: p.id }).catch(() => undefined)
    }
    await this.sig.request('updateSelf', { micMuted: muted }).catch(() => undefined)
  }

  async disableMic(): Promise<void> {
    const p = this.producers.get('mic')
    if (p) {
      p.close()
      this.producers.delete('mic')
      await this.sig.request('closeProducer', { producerId: p.id }).catch(() => undefined)
    }
    stopTrack(store.getState().local.mic)
    store.getState().set((s) => ({ local: { ...s.local, mic: null }, micMuted: true }))
    await this.sig.request('updateSelf', { micMuted: true }).catch(() => undefined)
  }

  async enableCamera(deviceId: string | null): Promise<void> {
    const presenter = store.getState().mode === 'presentation' && store.getState().sharing
    const track = await getCameraTrack(deviceId, presenter)
    stopTrack(store.getState().local.camera)
    store.getState().set((s) => ({ local: { ...s.local, camera: track }, camOff: false }))
    track.onended = () => {
      store.getState().toast('카메라가 분리되었습니다', 'warn')
      void this.disableCamera()
    }
    await this.produceCamera(track)
  }

  private async produceCamera(track: MediaStreamTrack): Promise<void> {
    if (!this.sendTransport || !this.device) return
    const vp8 = this.device.rtpCapabilities.codecs?.find((c) => c.mimeType.toLowerCase() === 'video/vp8')
    const producer = await this.sendTransport.produce({
      track,
      encodings: QUALITY.camera.encodings.map((e) => ({ ...e })),
      codecOptions: { videoGoogleStartBitrate: 400 },
      codec: vp8,
      appData: { source: 'camera' }
    })
    this.producers.set('camera', producer)
  }

  async disableCamera(): Promise<void> {
    const p = this.producers.get('camera')
    if (p) {
      p.close()
      this.producers.delete('camera')
      await this.sig.request('closeProducer', { producerId: p.id }).catch(() => undefined)
    }
    stopTrack(store.getState().local.camera)
    store.getState().set((s) => ({ local: { ...s.local, camera: null }, camOff: true }))
    await this.sig.request('updateSelf', { camOff: true }).catch(() => undefined)
  }

  async startScreenShare(sourceId: string, preset: ScreenSharePreset, withSystemAudio: boolean): Promise<void> {
    await window.sjting.screen.select(sourceId, withSystemAudio)
    const cap = await getScreenCapture(preset, withSystemAudio)
    this.screenPreset = preset
    await this.stopScreenShare(false)
    store.getState().set((s) => ({ local: { ...s.local, screen: cap.video, screenAudio: cap.audio }, sharing: true }))
    cap.video.onended = () => void this.stopScreenShare()
    await this.produceScreen(cap.video, cap.audio)
  }

  private async produceScreen(video: MediaStreamTrack, audio: MediaStreamTrack | null): Promise<void> {
    if (!this.sendTransport || !this.device) return
    const q = QUALITY.screen[this.screenPreset]
    const codecs = this.device.rtpCapabilities.codecs ?? []
    const vp9 = codecs.find((c) => c.mimeType.toLowerCase() === 'video/vp9')
    const vp8 = codecs.find((c) => c.mimeType.toLowerCase() === 'video/vp8')
    // VP9 SVC 우선, 불가하면 VP8 단일 계층 (계획서 6.3)
    const useSvc = !!vp9
    const producer = await this.sendTransport.produce({
      track: video,
      encodings: useSvc
        ? [{ maxBitrate: q.maxBitrate, scalabilityMode: 'L1T3', maxFramerate: q.frameRate }]
        : [{ maxBitrate: q.maxBitrate, maxFramerate: q.frameRate }],
      codecOptions: { videoGoogleStartBitrate: 1500 },
      codec: useSvc ? vp9 : vp8,
      appData: { source: 'screen' }
    })
    this.producers.set('screen', producer)
    if (audio) {
      const ap = await this.sendTransport.produce({
        track: audio,
        codecOptions: { opusStereo: true, opusDtx: false },
        appData: { source: 'screenAudio' }
      })
      this.producers.set('screenAudio', ap)
    }
  }

  async stopScreenShare(notify = true): Promise<void> {
    for (const src of ['screen', 'screenAudio'] as const) {
      const p = this.producers.get(src)
      if (p) {
        p.close()
        this.producers.delete(src)
        if (notify) await this.sig.request('closeProducer', { producerId: p.id }).catch(() => undefined)
      }
    }
    const l = store.getState().local
    stopTrack(l.screen)
    stopTrack(l.screenAudio)
    store.getState().set((s) => ({ local: { ...s.local, screen: null, screenAudio: null }, sharing: false }))
  }

  async setHandRaised(handRaised: boolean): Promise<void> {
    store.getState().patchParticipant(store.getState().me?.participantId ?? '', { handRaised })
    await this.sig.request('updateSelf', { handRaised }).catch(() => undefined)
  }

  async sendChat(text: string): Promise<void> {
    await this.sig.request('chat', { text })
  }

  // ---------------------------------------------------------------- 방장

  kick(participantId: string) {
    return this.sig.request('kick', { participantId })
  }
  muteAll() {
    return this.sig.request('muteAll', {})
  }
  setLock(locked: boolean) {
    return this.sig.request('setLock', { locked })
  }
  setMode(mode: LayoutMode) {
    return this.sig.request('setMode', { mode })
  }
  closeRoom() {
    return this.sig.request('closeRoom', {})
  }

  // ---------------------------------------------------------------- 구독 계획

  private watchStore(): void {
    let prev = store.getState()
    this.unsubStore = store.subscribe((s) => {
      if (
        s.producers !== prev.producers ||
        s.participants !== prev.participants ||
        s.mode !== prev.mode ||
        s.activeSpeakerId !== prev.activeSpeakerId ||
        s.visibleParticipantIds !== prev.visibleParticipantIds ||
        s.quality.level !== prev.quality.level
      ) {
        this.schedulePlan()
      }
      prev = s
    })
  }

  private schedulePlan(): void {
    if (this.planTimer) return
    this.planTimer = window.setTimeout(() => {
      this.planTimer = null
      void this.applyPlan()
    }, 120)
  }

  private async applyPlan(): Promise<void> {
    if (this.closed || !this.recvTransport || !this.sig.connected) return
    const s = store.getState()
    if (!s.me) return
    const plan = planSubscriptions({
      mode: s.mode,
      myId: s.me.participantId,
      participants: s.participants,
      producers: s.producers,
      activeSpeakerId: s.activeSpeakerId,
      recentSpeakers: s.recentSpeakers,
      visibleParticipantIds: s.mode === 'grid' ? new Set(s.visibleParticipantIds) : null,
      degraded: isDegraded(s.quality)
    })

    // 오디오는 항상 수신
    for (const p of s.producers) {
      if (p.participantId === s.me.participantId) continue
      if (p.kind !== 'audio') continue
      await this.ensureConsumer(p.producerId, true)
    }
    // 영상은 계획에 따라 수신/일시중지
    for (const p of s.producers) {
      if (p.participantId === s.me.participantId || p.kind !== 'video') continue
      const want = plan.video.get(p.producerId)
      if (want) {
        const c = await this.ensureConsumer(p.producerId, true)
        if (c) await this.setLayers(c, p.source, want.spatialLayer, want.temporalLayer)
      } else {
        const cid = this.consumerByProducer.get(p.producerId)
        if (cid) await this.pauseConsumer(cid)
      }
    }
  }

  private async ensureConsumer(producerId: string, resume: boolean): Promise<ms.Consumer | null> {
    const existing = this.consumerByProducer.get(producerId)
    if (existing) {
      const c = this.consumers.get(existing)
      if (c && resume && c.paused) await this.resumeConsumer(existing)
      return c ?? null
    }
    if (this.pendingConsume.has(producerId) || !this.recvTransport) return null
    this.pendingConsume.add(producerId)
    try {
      const params: ConsumerParams = await this.sig.request('consume', { producerId })
      if (!this.recvTransport) return null
      const consumer = await this.recvTransport.consume({
        id: params.consumerId,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters as ms.RtpParameters,
        appData: { participantId: params.participantId, source: params.source }
      })
      this.consumers.set(consumer.id, consumer)
      this.consumerByProducer.set(producerId, consumer.id)
      const state: RemoteConsumerState = {
        consumerId: consumer.id,
        producerId,
        participantId: params.participantId,
        kind: params.kind,
        source: params.source,
        track: consumer.track,
        paused: true,
        spatialLayer: null
      }
      store.getState().setConsumer(state)
      if (resume) await this.resumeConsumer(consumer.id)
      return consumer
    } catch (e) {
      rlog('warn', `consume 실패: ${(e as Error).message}`)
      return null
    } finally {
      this.pendingConsume.delete(producerId)
    }
  }

  private async resumeConsumer(consumerId: string): Promise<void> {
    const c = this.consumers.get(consumerId)
    if (!c) return
    c.resume()
    await this.sig.request('resumeConsumer', { consumerId }).catch(() => undefined)
    store.getState().patchConsumer(consumerId, { paused: false })
  }

  private async pauseConsumer(consumerId: string): Promise<void> {
    const c = this.consumers.get(consumerId)
    if (!c || c.paused) return
    c.pause()
    await this.sig.request('pauseConsumer', { consumerId }).catch(() => undefined)
    store.getState().patchConsumer(consumerId, { paused: true })
  }

  private layerCache = new Map<string, string>()

  private async setLayers(c: ms.Consumer, source: MediaSource, spatial: number, temporal?: number): Promise<void> {
    // 화면공유(VP9 L1T3)는 spatial 0 고정, temporal 로 fps 조절. 카메라(VP8 simulcast)는 spatial 로 해상도 조절
    const req = source === 'screen' ? { spatialLayer: 0, temporalLayer: temporal ?? 2 } : { spatialLayer: spatial, temporalLayer: 2 }
    const key = `${req.spatialLayer}:${req.temporalLayer}`
    if (this.layerCache.get(c.id) === key) return
    this.layerCache.set(c.id, key)
    await this.sig.request('setConsumerLayers', { consumerId: c.id, ...req }).catch(() => undefined)
  }

  private dropConsumer(consumerId: string): void {
    const c = this.consumers.get(consumerId)
    if (c) {
      this.consumerByProducer.delete(c.producerId)
      c.close()
    }
    this.consumers.delete(consumerId)
    this.layerCache.delete(consumerId)
    store.getState().removeConsumer(consumerId)
  }

  // ---------------------------------------------------------------- 통계

  private startStats(): void {
    this.stopStats()
    this.statsTimer = window.setInterval(() => void this.collectStats(), 2000)
  }

  private stopStats(): void {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
  }

  private async collectStats(): Promise<void> {
    if (this.closed) return
    let bytesSent = 0
    let bytesRecv = 0
    let lost = 0
    let recv = 0
    let rtt: number | null = null
    try {
      if (this.sendTransport && this.sendTransport.connectionState === 'connected') {
        const rep = await this.sendTransport.getStats()
        rep.forEach((r: RTCStats & Record<string, unknown>) => {
          if (r.type === 'outbound-rtp') bytesSent += Number(r.bytesSent ?? 0)
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime * 1000
          if (r.type === 'remote-inbound-rtp') lost += Number(r.packetsLost ?? 0)
        })
      }
      if (this.recvTransport && this.recvTransport.connectionState === 'connected') {
        const rep = await this.recvTransport.getStats()
        rep.forEach((r: RTCStats & Record<string, unknown>) => {
          if (r.type === 'inbound-rtp') {
            bytesRecv += Number(r.bytesReceived ?? 0)
            lost += Number(r.packetsLost ?? 0)
            recv += Number(r.packetsReceived ?? 0)
          }
          if (rtt === null && r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') {
            rtt = r.currentRoundTripTime * 1000
          }
        })
      }
    } catch {
      return
    }
    const now = Date.now()
    const prev = this.lastStats
    this.lastStats = { ts: now, bytesSent, bytesRecv, lost, recv }
    if (!prev) return
    const dt = (now - prev.ts) / 1000
    const uploadBps = Math.max(0, ((bytesSent - prev.bytesSent) * 8) / dt)
    const downloadBps = Math.max(0, ((bytesRecv - prev.bytesRecv) * 8) / dt)
    const dLost = Math.max(0, lost - prev.lost)
    const dRecv = Math.max(0, recv - prev.recv)
    const packetLossPct = dLost + dRecv > 0 ? (dLost / (dLost + dRecv)) * 100 : 0
    const level: NetworkQuality['level'] =
      rtt === null && dRecv === 0 ? 'unknown' : packetLossPct >= 5 || (rtt ?? 0) >= 400 ? 'poor' : packetLossPct >= 2 || (rtt ?? 0) >= 200 ? 'fair' : 'good'
    store.getState().set({ quality: { rtt, packetLossPct, uploadBps, downloadBps, level } })
  }
}

export const meetingClient = new MeetingClient()
