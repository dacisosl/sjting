/**
 * 회의 클라이언트 v2 — Cloudflare Realtime SFU(partytracks) + 회의 서버 WebSocket.
 * 방장도 참가자와 동일한 코드로 동작한다. 미디어 협상은 partytracks 가, 참가자 상태·채팅·트랙 참조는 시그널링이 담당한다.
 */
import 'webrtc-adapter'
import {
  createAudioSink,
  getCamera,
  getMic,
  getScreenshare,
  PartyTracks,
  setLogLevel,
  type MediaDevice,
  type Screenshare,
  type SinkApi,
  type TrackMetadata
} from 'partytracks/client'
import { BehaviorSubject, of, Subscription, type Observable } from 'rxjs'
import type { LayoutMode, MediaSource, Rid, ScreenSharePreset } from '@shared/constants'
import { QUALITY, RECONNECT_GRACE_MS } from '@shared/constants'
import type { ChatMessage, NetworkQuality, ParticipantTracks, RoomSnapshot, TrackRef } from '@shared/types'
import { wsUrl } from './api'
import { isDegraded, planSubscriptions, pushRecentSpeaker, trackKey } from './layout'
import { SignalingClient, SignalingError } from './signaling'
import { platform } from '../platform'
import { useAppStore } from '../store/appStore'
import { useMeetingStore } from '../store/meetingStore'

export interface JoinParams {
  serverUrl: string
  roomId: string
  token: string
  displayName: string
}

const store = useMeetingStore
setLogLevel('warn')

function rlog(level: 'info' | 'warn' | 'error', msg: string): void {
  try {
    platform.log.write(level, msg)
  } catch {
    /* ignore */
  }
}

function toRef(meta: TrackMetadata): TrackRef | null {
  return meta.sessionId && meta.trackName ? { sessionId: meta.sessionId, trackName: meta.trackName } : null
}

function toMeta(ref: TrackRef): TrackMetadata {
  return { location: 'remote', sessionId: ref.sessionId, trackName: ref.trackName }
}

function sameRef(a: TrackRef | null | undefined, b: TrackRef | null | undefined): boolean {
  return !!a && !!b && a.sessionId === b.sessionId && a.trackName === b.trackName
}

interface Pull {
  ref: TrackRef
  sub: Subscription
  rid$: BehaviorSubject<string | undefined> | null
}

export class MeetingClient {
  private sig = new SignalingClient()
  private party: PartyTracks | null = null
  private partySub = new Subscription()
  private pc: RTCPeerConnection | null = null
  private mic: MediaDevice | null = null
  private camera: MediaDevice | null = null
  private screenshare: Screenshare | null = null
  private micSub = new Subscription()
  private camSub = new Subscription()
  private screenSub = new Subscription()
  private pushed: Partial<Record<MediaSource, TrackRef>> = {}
  private pulls = new Map<string, Pull>()
  private audioSink: SinkApi | null = null
  private params: JoinParams | null = null
  private resume: { participantId: string; resumeKey: string } | null = null
  private closed = true
  private reconnecting = false
  private planTimer: number | null = null
  private statsTimer: number | null = null
  private unsubStore: (() => void) | null = null
  private lastStats: { ts: number; sent: number; recv: number; lost: number; pkts: number } | null = null
  private speak: { ctx: AudioContext; analyser: AnalyserNode; src: MediaStreamAudioSourceNode | null; timer: number; lastVoice: number; speaking: boolean } | null = null

  // ---------------------------------------------------------------- 수명주기

  async join(params: JoinParams): Promise<void> {
    if (!this.closed) await this.leave()
    this.params = params
    this.closed = false
    store.getState().set({ phase: 'connecting', error: null, endedReason: null, serverUrl: params.serverUrl, roomId: params.roomId })
    try {
      const ticket = await this.connectAndJoin(false)
      const headers = new Headers({ Authorization: `Bearer ${ticket}` })
      // partytracks 는 ICE 서버 조회에 커스텀 헤더를 붙이지 않으므로 입장권으로 직접 받아 넘긴다 (TURN 자격증명 보호)
      const iceServers = await fetchIceServers(params.serverUrl, headers)
      this.party = new PartyTracks({ prefix: `${params.serverUrl}/partytracks`, headers, iceServers })
      this.partySub = new Subscription()
      this.partySub.add(this.party.peerConnectionState$.subscribe((st) => store.getState().set({ mediaState: st })))
      this.partySub.add(this.party.peerConnection$.subscribe((pc) => (this.pc = pc)))
      this.partySub.add(this.party.sessionError$.subscribe((e) => rlog('warn', `SFU session error: ${e}`)))
      this.ensureAudioSink()
      store.getState().set({ phase: 'connected' })
      void platform.setKeepAwake(true)
      this.startStats()
      this.watchStore()
      this.schedulePlan()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      store.getState().set({ phase: 'ended', endedReason: msg, error: msg })
      this.closed = true
      this.sig.close()
      throw e
    }
  }

  /** WebSocket 연결 + join. 입장권을 돌려준다 */
  private async connectAndJoin(isResume: boolean): Promise<string> {
    if (!this.params) throw new Error('join params missing')
    this.sig.removeAllHandlers()
    this.bindEvents()
    await this.sig.connect(wsUrl(this.params.serverUrl, this.params.roomId))
    const res = await this.sig.request('join', {
      token: this.params.token,
      displayName: this.params.displayName,
      resume: isResume && this.resume ? this.resume : undefined
    })
    this.resume = { participantId: res.participantId, resumeKey: res.resumeKey }
    this.applySnapshot(res.room, res.chatHistory, res.participantId, res.isHost)
    return res.ticket
  }

  private applySnapshot(room: RoomSnapshot, chat: ChatMessage[], myId: string, isHost: boolean): void {
    const prev = store.getState().invite
    store.getState().set({
      me: { participantId: myId, isHost, displayName: this.params!.displayName },
      roomId: room.roomId,
      mode: room.mode,
      locked: room.locked,
      maxParticipants: room.maxParticipants,
      participants: room.participants,
      activeSpeakerId: room.activeSpeakerId,
      chat,
      // 서버 스냅샷에는 토큰 원문이 없으므로 방 생성 때 받은 토큰을 유지한다
      invite: isHost ? (prev ?? (room.invite ? { token: '', expiresAt: room.invite.expiresAt } : null)) : null
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
    })
    this.sig.on('participantUpdated', ({ participantId, patch }) => {
      s().patchParticipant(participantId, patch)
      // 방장의 전체 음소거 요청을 받으면 내 마이크를 실제로 끈다
      if (participantId === s().me?.participantId && patch.micMuted === true && s().micOn && !s().micMuted) void this.setMicMuted(true)
    })
    this.sig.on('activeSpeaker', ({ participantId }) => {
      s().set((st) => ({ activeSpeakerId: participantId, recentSpeakers: pushRecentSpeaker(st.recentSpeakers, participantId) }))
    })
    this.sig.on('chat', (m) => s().addChat(m))
    this.sig.on('roomUpdated', (patch) => s().set(patch))
    this.sig.on('inviteRotated', (inv) => s().set({ invite: inv }))
    this.sig.on('kicked', ({ reason }) => this.end(reason))
    this.sig.on('roomClosed', ({ reason }) => this.end(reason))
    this.sig.onClose(() => {
      if (!this.closed) void this.reconnect()
    })
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.closed) return
    this.reconnecting = true
    store.getState().set({ phase: 'reconnecting' })
    const deadline = Date.now() + RECONNECT_GRACE_MS + 10_000
    let delay = 1000
    while (!this.closed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, delay))
      if (this.closed) break
      try {
        await this.connectAndJoin(true)
        // 서버는 연결이 끊긴 동안 내 트랙 참조를 지웠으므로 다시 알린다
        if (Object.keys(this.pushed).length) await this.sig.request('setTracks', this.pushed).catch(() => undefined)
        const st = store.getState()
        await this.sig.request('updateSelf', { micMuted: st.micMuted, camOff: !st.camOn }).catch(() => undefined)
        store.getState().set({ phase: 'connected' })
        store.getState().toast('다시 연결되었습니다')
        this.reconnecting = false
        this.schedulePlan()
        return
      } catch (e) {
        if (e instanceof SignalingError && ['UNAUTHORIZED', 'ROOM_FULL', 'ROOM_LOCKED', 'ROOM_CLOSED', 'INVITE_EXPIRED', 'BUDGET_EXCEEDED'].includes(e.code)) {
          this.reconnecting = false
          return this.end(e.message)
        }
        delay = Math.min(delay * 2, 8000)
      }
    }
    this.reconnecting = false
    if (!this.closed) this.end('연결이 끊어져 다시 연결하지 못했습니다')
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

  private end(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.stopStats()
    this.stopSpeakingDetector()
    this.unsubStore?.()
    this.unsubStore = null
    for (const key of [...this.pulls.keys()]) this.dropPull(key)
    this.micSub.unsubscribe()
    this.camSub.unsubscribe()
    this.screenSub.unsubscribe()
    this.mic?.disableSource()
    this.camera?.disableSource()
    this.screenshare?.disableSource()
    this.mic = null
    this.camera = null
    this.screenshare = null
    this.pushed = {}
    this.partySub.unsubscribe()
    this.party = null
    this.pc = null
    this.audioSink?.cleanup()
    this.audioSink = null
    this.sig.close()
    store.getState().set({
      phase: 'ended',
      endedReason: reason,
      local: { camera: null, screen: null },
      remoteTracks: {},
      micOn: false,
      micMuted: true,
      camOn: false,
      sharing: false
    })
    void platform.setKeepAwake(false)
  }

  // ---------------------------------------------------------------- 로컬 미디어

  private preferred(kind: 'mic' | 'camera'): string | null {
    const s = useAppStore.getState().settings
    return kind === 'mic' ? (s?.preferredMicId ?? null) : (s?.preferredCameraId ?? null)
  }

  private applyPreferredDevice(dev: MediaDevice, deviceId: string | null, bag: Subscription): void {
    if (!deviceId) return
    const sub = dev.devices$.subscribe((list) => {
      const d = list.find((x) => x.deviceId === deviceId)
      if (d) {
        dev.setPreferredDevice(d)
        sub.unsubscribe()
      }
    })
    bag.add(sub)
  }

  async enableMic(): Promise<void> {
    if (!this.party) throw new Error('회의에 연결되어 있지 않습니다')
    if (!this.mic) {
      this.mic = getMic({ constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: QUALITY.audio.channelCount } })
      this.micSub = new Subscription()
      this.applyPreferredDevice(this.mic, this.preferred('mic'), this.micSub)
      this.micSub.add(this.mic.error$.subscribe((e) => store.getState().toast(describeMediaError('마이크', e), 'error')))
      this.micSub.add(
        this.party.push(this.mic.broadcastTrack$).subscribe((meta) => {
          const ref = toRef(meta)
          if (!ref) return
          this.pushed.mic = ref
          void this.sig.request('setTracks', { mic: ref }).catch(() => undefined)
        })
      )
      this.startSpeakingDetector(this.mic.broadcastTrack$)
    }
    this.mic.startBroadcasting()
    store.getState().set({ micOn: true, micMuted: false })
    await this.sig.request('updateSelf', { micMuted: false }).catch(() => undefined)
  }

  async setMicMuted(muted: boolean): Promise<void> {
    if (!this.mic) return
    if (muted) this.mic.stopBroadcasting()
    else this.mic.startBroadcasting()
    store.getState().set({ micMuted: muted })
    await this.sig.request('updateSelf', { micMuted: muted, speaking: false }).catch(() => undefined)
  }

  async disableMic(): Promise<void> {
    this.stopSpeakingDetector()
    this.micSub.unsubscribe()
    this.mic?.disableSource()
    this.mic = null
    delete this.pushed.mic
    store.getState().set({ micOn: false, micMuted: true })
    await this.sig.request('setTracks', { mic: null }).catch(() => undefined)
    await this.sig.request('updateSelf', { micMuted: true, speaking: false }).catch(() => undefined)
  }

  async enableCamera(): Promise<void> {
    if (!this.party) throw new Error('회의에 연결되어 있지 않습니다')
    if (!this.camera) {
      this.camera = getCamera({
        constraints: { width: { ideal: QUALITY.camera.width }, height: { ideal: QUALITY.camera.height }, frameRate: { ideal: QUALITY.camera.frameRate, max: 30 } }
      })
      this.applyPreferredDevice(this.camera, this.preferred('camera'), this.camSub)
    }
    this.camSub = new Subscription()
    this.camSub.add(this.camera.error$.subscribe((e) => store.getState().toast(describeMediaError('카메라', e), 'error')))
    this.camSub.add(this.camera.broadcastTrack$.subscribe((track) => store.getState().set((s) => ({ local: { ...s.local, camera: track } }))))
    this.camSub.add(
      this.party.push(this.camera.broadcastTrack$, { sendEncodings$: of(QUALITY.camera.encodings.map((e) => ({ ...e }))) }).subscribe((meta) => {
        const ref = toRef(meta)
        if (!ref) return
        this.pushed.camera = ref
        void this.sig.request('setTracks', { camera: ref }).catch(() => undefined)
      })
    )
    this.camera.startBroadcasting()
    store.getState().set({ camOn: true })
    await this.sig.request('updateSelf', { camOff: false }).catch(() => undefined)
  }

  async disableCamera(): Promise<void> {
    this.camSub.unsubscribe()
    this.camera?.stopBroadcasting()
    this.camera?.disableSource()
    delete this.pushed.camera
    store.getState().set((s) => ({ camOn: false, local: { ...s.local, camera: null } }))
    await this.sig.request('setTracks', { camera: null }).catch(() => undefined)
    await this.sig.request('updateSelf', { camOff: true }).catch(() => undefined)
  }

  /** sourceId 가 null 이면 브라우저 기본 선택창(getDisplayMedia)을 사용한다 */
  async startScreenShare(sourceId: string | null, preset: ScreenSharePreset, withSystemAudio: boolean): Promise<void> {
    if (!this.party) throw new Error('회의에 연결되어 있지 않습니다')
    await this.stopScreenShare()
    if (sourceId) await platform.screen.select(sourceId, withSystemAudio)
    const q = QUALITY.screen[preset]
    const ss = getScreenshare({
      audio: withSystemAudio,
      video: { constraints: { width: { max: q.width }, height: { max: q.height }, frameRate: { ideal: q.frameRate, max: q.frameRate } } }
    })
    this.screenshare = ss
    this.screenSub = new Subscription()
    // 문서 모드는 글자 선명도(text), 동영상 모드는 부드러움(motion) 우선
    ss.video.addTransform((track) => {
      try {
        track.contentHint = q.contentHint
      } catch {
        /* ignore */
      }
      return of(track)
    })
    this.screenSub.add(ss.video.error$.subscribe((e) => {
      store.getState().toast(describeMediaError('화면', e), 'error')
      void this.stopScreenShare()
    }))
    this.screenSub.add(ss.video.broadcastTrack$.subscribe((track) => store.getState().set((s) => ({ local: { ...s.local, screen: track } }))))
    this.screenSub.add(
      this.party.push(ss.video.broadcastTrack$, { sendEncodings$: of(q.encodings.map((e) => ({ ...e }))) }).subscribe((meta) => {
        const ref = toRef(meta)
        if (!ref) return
        this.pushed.screen = ref
        void this.sig.request('setTracks', { screen: ref }).catch(() => undefined)
      })
    )
    if (withSystemAudio) {
      this.screenSub.add(
        this.party.push(ss.audio.broadcastTrack$).subscribe((meta) => {
          const ref = toRef(meta)
          if (!ref) return
          this.pushed.screenAudio = ref
          void this.sig.request('setTracks', { screenAudio: ref }).catch(() => undefined)
        })
      )
    }
    // 사용자가 시스템 UI 로 공유를 멈추면 isSourceEnabled 가 false 가 된다
    let wasEnabled = false
    this.screenSub.add(
      ss.isSourceEnabled$.subscribe((en) => {
        if (en) wasEnabled = true
        else if (wasEnabled) void this.stopScreenShare()
      })
    )
    ss.startBroadcasting()
    store.getState().set({ sharing: true })
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenshare) return
    this.screenSub.unsubscribe()
    this.screenshare.disableSource()
    this.screenshare = null
    delete this.pushed.screen
    delete this.pushed.screenAudio
    store.getState().set((s) => ({ sharing: false, local: { ...s.local, screen: null } }))
    await this.sig.request('setTracks', { screen: null, screenAudio: null }).catch(() => undefined)
  }

  async setHandRaised(handRaised: boolean): Promise<void> {
    const me = store.getState().me?.participantId
    if (me) store.getState().patchParticipant(me, { handRaised })
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
  async rotateInvite(): Promise<{ token: string; expiresAt: number }> {
    const inv = await this.sig.request('rotateInvite', {})
    store.getState().set({ invite: inv })
    return inv
  }
  closeRoom() {
    return this.sig.request('closeRoom', {})
  }

  // ---------------------------------------------------------------- 수신(구독) 계획

  private watchStore(): void {
    let prev = store.getState()
    this.unsubStore = store.subscribe((s) => {
      if (
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
      this.applyPlan()
    }, 120)
  }

  private applyPlan(): void {
    if (this.closed || !this.party) return
    const s = store.getState()
    if (!s.me) return
    const plan = planSubscriptions({
      mode: s.mode,
      myId: s.me.participantId,
      participants: s.participants,
      activeSpeakerId: s.activeSpeakerId,
      recentSpeakers: s.recentSpeakers,
      visibleParticipantIds: s.mode === 'grid' ? new Set(s.visibleParticipantIds) : null,
      degraded: isDegraded(s.quality)
    })

    const desired = new Map<string, { ref: TrackRef; kind: 'audio' | 'video'; rid?: Rid }>()
    for (const p of s.participants) {
      if (p.id === s.me.participantId || p.connection !== 'connected') continue
      const t: ParticipantTracks = p.tracks
      // 오디오는 항상 수신
      if (t.mic) desired.set(trackKey(p.id, 'mic'), { ref: t.mic, kind: 'audio' })
      if (t.screenAudio) desired.set(trackKey(p.id, 'screenAudio'), { ref: t.screenAudio, kind: 'audio' })
      // 영상은 계획에 따라
      for (const src of ['camera', 'screen'] as const) {
        const want = plan.video.get(trackKey(p.id, src))
        const ref = t[src]
        if (want && ref) desired.set(trackKey(p.id, src), { ref, kind: 'video', rid: want.rid })
      }
    }

    for (const key of [...this.pulls.keys()]) if (!desired.has(key)) this.dropPull(key)

    for (const [key, d] of desired) {
      const cur = this.pulls.get(key)
      if (cur && sameRef(cur.ref, d.ref)) {
        if (cur.rid$ && d.rid && cur.rid$.getValue() !== d.rid) cur.rid$.next(d.rid)
        continue
      }
      if (cur) this.dropPull(key)
      const meta$ = of(toMeta(d.ref))
      if (d.kind === 'audio') {
        const sub = this.ensureAudioSink().attach(this.party.pull(meta$))
        this.pulls.set(key, { ref: d.ref, sub, rid$: null })
      } else {
        const rid$ = new BehaviorSubject<string | undefined>(d.rid)
        const sub = this.party.pull(meta$, { simulcast: { preferredRid$: rid$ } }).subscribe({
          next: (track) => store.getState().setRemoteTrack(key, track),
          error: (e) => rlog('warn', `pull 실패 ${key}: ${(e as Error)?.message ?? e}`)
        })
        this.pulls.set(key, { ref: d.ref, sub, rid$ })
      }
    }
  }

  private dropPull(key: string): void {
    const p = this.pulls.get(key)
    if (!p) return
    p.sub.unsubscribe()
    this.pulls.delete(key)
    store.getState().setRemoteTrack(key, null)
  }

  private ensureAudioSink(): SinkApi {
    if (this.audioSink) return this.audioSink
    let el = document.getElementById('sjting-audio-sink') as HTMLAudioElement | null
    if (!el) {
      el = document.createElement('audio')
      el.id = 'sjting-audio-sink'
      el.autoplay = true
      el.style.display = 'none'
      document.body.appendChild(el)
    }
    const speaker = useAppStore.getState().settings?.preferredSpeakerId ?? undefined
    this.audioSink = createAudioSink({ audioElement: el, sinkId: speaker })
    return this.audioSink
  }

  // ---------------------------------------------------------------- 발언 감지

  private startSpeakingDetector(track$: Observable<MediaStreamTrack>): void {
    this.stopSpeakingDetector()
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    const buf = new Uint8Array(analyser.fftSize)
    const state = { ctx, analyser, src: null as MediaStreamAudioSourceNode | null, timer: 0, lastVoice: 0, speaking: false }
    this.speak = state
    this.micSub.add(
      track$.subscribe((track) => {
        state.src?.disconnect()
        try {
          state.src = ctx.createMediaStreamSource(new MediaStream([track]))
          state.src.connect(analyser)
        } catch {
          state.src = null
        }
      })
    )
    state.timer = window.setInterval(() => {
      if (store.getState().micMuted) {
        if (state.speaking) this.setSpeaking(false)
        return
      }
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / buf.length)
      const now = Date.now()
      if (rms > 0.03) state.lastVoice = now
      const speaking = now - state.lastVoice < 700
      if (speaking !== state.speaking) this.setSpeaking(speaking)
    }, 200)
  }

  private setSpeaking(speaking: boolean): void {
    if (this.speak) this.speak.speaking = speaking
    const me = store.getState().me?.participantId
    if (me) store.getState().patchParticipant(me, { speaking })
    void this.sig.request('updateSelf', { speaking }).catch(() => undefined)
  }

  private stopSpeakingDetector(): void {
    if (!this.speak) return
    clearInterval(this.speak.timer)
    this.speak.src?.disconnect()
    void this.speak.ctx.close().catch(() => undefined)
    this.speak = null
  }

  // ---------------------------------------------------------------- 통계

  private startStats(): void {
    this.stopStats()
    this.statsTimer = window.setInterval(() => void this.collectStats(), 2000)
  }

  private stopStats(): void {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    this.lastStats = null
  }

  private async collectStats(): Promise<void> {
    const pc = this.pc
    if (this.closed || !pc || pc.connectionState !== 'connected') return
    let sent = 0
    let recv = 0
    let lost = 0
    let pkts = 0
    let rtt: number | null = null
    try {
      const rep = await pc.getStats()
      rep.forEach((r: RTCStats & Record<string, unknown>) => {
        if (r.type === 'outbound-rtp') sent += Number(r.bytesSent ?? 0)
        if (r.type === 'inbound-rtp') {
          recv += Number(r.bytesReceived ?? 0)
          lost += Number(r.packetsLost ?? 0)
          pkts += Number(r.packetsReceived ?? 0)
        }
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime * 1000
      })
    } catch {
      return
    }
    const now = Date.now()
    const prev = this.lastStats
    this.lastStats = { ts: now, sent, recv, lost, pkts }
    if (!prev) return
    const dt = (now - prev.ts) / 1000
    const uploadBps = Math.max(0, ((sent - prev.sent) * 8) / dt)
    const downloadBps = Math.max(0, ((recv - prev.recv) * 8) / dt)
    const dLost = Math.max(0, lost - prev.lost)
    const dPkts = Math.max(0, pkts - prev.pkts)
    const packetLossPct = dLost + dPkts > 0 ? (dLost / (dLost + dPkts)) * 100 : 0
    const level: NetworkQuality['level'] =
      rtt === null && dPkts === 0 ? 'unknown' : packetLossPct >= 5 || (rtt ?? 0) >= 400 ? 'poor' : packetLossPct >= 2 || (rtt ?? 0) >= 200 ? 'fair' : 'good'
    store.getState().set({ quality: { rtt, packetLossPct, uploadBps, downloadBps, level } })
  }
}

async function fetchIceServers(serverUrl: string, headers: Headers): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }]
  try {
    const res = await fetch(`${serverUrl}/partytracks/generate-ice-servers`, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return fallback
    const body = (await res.json()) as { iceServers?: RTCIceServer[] }
    return Array.isArray(body.iceServers) && body.iceServers.length ? body.iceServers : fallback
  } catch {
    return fallback
  }
}

function describeMediaError(label: string, e: unknown): string {
  const name = (e as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return `${label} 권한이 거부되었습니다. Windows 설정 > 개인 정보 > ${label} 에서 앱 접근을 허용하세요`
  if (name === 'NotFoundError' || name === 'DevicesExhaustedError' || name === 'OverconstrainedError') return `${label} 장치를 찾을 수 없습니다. 연결 상태를 확인하거나 다른 장치를 선택하세요`
  if (name === 'NotReadableError' || name === 'AbortError') return `${label} 를 다른 프로그램이 사용 중이거나 읽을 수 없습니다`
  return `${label} 를 시작할 수 없습니다: ${(e as Error)?.message ?? String(e)}`
}

export const meetingClient = new MeetingClient()
