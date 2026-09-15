/**
 * mediasoup Worker / Router / WebRtcServer 관리 (계획서 4장)
 * - WebRtcServer 로 모든 Transport 가 하나의 UDP/TCP 미디어 포트를 공유
 * - LAN IP 에 바인딩하고 공인 IP 를 announcedAddress 로 알리며 exposeInternalIp 로 LAN 후보도 함께 노출
 */
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { app } from 'electron'
import type * as MS from 'mediasoup'
import type { types as msTypes } from 'mediasoup'
import { createLogger } from '../logger'

const log = createLogger('mediasoup')

export interface MediasoupStartOptions {
  lanIp: string
  publicIp: string | null
  mediaPort: number
}

const MEDIA_CODECS: msTypes.RouterRtpCodecCapability[] = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 600 } },
  {
    kind: 'video',
    mimeType: 'video/VP9',
    clockRate: 90000,
    parameters: { 'profile-id': 0, 'x-google-start-bitrate': 600 }
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 600
    }
  }
]

/** 패키징된 앱에서는 asar 밖(app.asar.unpacked)의 worker 실행 파일을 사용해야 한다 */
export function resolveWorkerBinary(): string | undefined {
  if (!app.isPackaged) return undefined
  const exe = process.platform === 'win32' ? 'mediasoup-worker.exe' : 'mediasoup-worker'
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'mediasoup', 'worker', 'out', 'Release', exe)
}

export interface MediasoupServerEvents {
  died: [Error]
  activeSpeaker: [string | null]
}

export class MediasoupServer extends EventEmitter<MediasoupServerEvents> {
  private worker: msTypes.Worker | null = null
  private router: msTypes.Router | null = null
  private webRtcServer: msTypes.WebRtcServer | null = null
  private speakerObserver: msTypes.ActiveSpeakerObserver | null = null
  private ms: typeof MS | null = null

  get routerRtpCapabilities(): msTypes.RtpCapabilities {
    if (!this.router) throw new Error('router not ready')
    return this.router.rtpCapabilities
  }

  get alive(): boolean {
    return !!this.worker && !this.worker.died && !this.worker.closed
  }

  async start(opts: MediasoupStartOptions): Promise<void> {
    const bin = resolveWorkerBinary()
    if (bin) process.env.MEDIASOUP_WORKER_BIN = bin
    this.ms = await import('mediasoup')

    this.worker = await this.ms.createWorker({
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      // WebRtcServer 를 사용하므로 별도 포트 범위는 소량만 필요하다
      rtcMinPort: opts.mediaPort + 100,
      rtcMaxPort: opts.mediaPort + 199
    })
    this.worker.on('died', (err) => {
      log.error('mediasoup worker 종료됨', err)
      this.emit('died', err)
    })

    const listenInfos: msTypes.TransportListenInfo[] = (['udp', 'tcp'] as const).map((protocol) => ({
      protocol,
      ip: opts.lanIp,
      port: opts.mediaPort,
      announcedAddress: opts.publicIp ?? undefined,
      exposeInternalIp: !!opts.publicIp,
      sendBufferSize: 4 * 1024 * 1024,
      recvBufferSize: 4 * 1024 * 1024
    }))
    this.webRtcServer = await this.worker.createWebRtcServer({ listenInfos })
    this.router = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS })
    this.speakerObserver = await this.router.createActiveSpeakerObserver({ interval: 500 })
    this.speakerObserver.on('dominantspeaker', ({ producer }) => {
      const pid = (producer.appData as { participantId?: string }).participantId ?? null
      this.emit('activeSpeaker', pid)
    })
    log.info(`mediasoup 준비 완료 (미디어 포트 ${opts.mediaPort}, 공인 주소 ${opts.publicIp ? '있음' : '없음'})`)
  }

  async createTransport(appData: Record<string, unknown>): Promise<msTypes.WebRtcTransport> {
    if (!this.router || !this.webRtcServer) throw new Error('router not ready')
    return this.router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1_500_000,
      iceConsentTimeout: 20,
      appData
    })
  }

  canConsume(producerId: string, rtpCapabilities: msTypes.RtpCapabilities): boolean {
    return !!this.router?.canConsume({ producerId, rtpCapabilities })
  }

  async observeAudioProducer(producerId: string): Promise<void> {
    await this.speakerObserver?.addProducer({ producerId }).catch(() => undefined)
  }

  async close(): Promise<void> {
    try {
      this.speakerObserver?.close()
      this.router?.close()
      this.webRtcServer?.close()
      this.worker?.close()
    } catch (e) {
      log.warn('mediasoup 종료 중 오류', e)
    }
    this.speakerObserver = null
    this.router = null
    this.webRtcServer = null
    this.worker = null
  }
}
