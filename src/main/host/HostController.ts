/**
 * 방장 회의 서버 오케스트레이션 (계획서 4장, 5장, 7.3)
 * 인증서 → 주소 탐지 → 포트 계획 → UPnP → mediasoup → 시그널링 → 초대코드 → 잠자기 방지 → 통계
 */
import { EventEmitter } from 'node:events'
import { powerSaveBlocker } from 'electron'
import { INVITE_VERSION } from '@shared/constants'
import type { StartRoomOptions } from '@shared/ipc'
import { encodeInvite, inviteLink } from '@shared/invite'
import type { AppSettings, HostStats, HostStatus, InviteBundle, InvitePayload } from '@shared/types'
import { createLogger } from '../logger'
import { detectLocalIp, isPublicIpv4 } from '../network/localNet'
import { planPorts } from '../network/ports'
import { discoverPublicIp } from '../network/stun'
import { UpnpManager } from '../network/upnp'
import { loadOrCreateHostCertificate, type HostCertificate } from '../security/certificate'
import { generateToken, hashToken } from '../security/tokens'
import { MediasoupServer } from './MediasoupServer'
import { Room } from './Room'
import { SignalingServer } from './SignalingServer'

const log = createLogger('host')

export interface HostControllerEvents {
  status: [HostStatus]
  stopped: [string]
}

export class HostController extends EventEmitter<HostControllerEvents> {
  private media: MediasoupServer | null = null
  private signaling: SignalingServer | null = null
  private upnp: UpnpManager | null = null
  private cert: HostCertificate | null = null
  private inviteTokenHash: Buffer | null = null
  private inviteExpiresAt = 0
  private statsTimer: NodeJS.Timeout | null = null
  private netWatchTimer: NodeJS.Timeout | null = null
  private powerBlockerId: number | null = null
  private starting = false
  private status: HostStatus = emptyStatus()
  private peakUploadMbps = 0

  constructor(private readonly persist: (patch: Partial<AppSettings>) => void) {
    super()
  }

  getStatus(): HostStatus {
    return { ...this.status }
  }

  private update(patch: Partial<HostStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.getStatus())
  }

  async start(opts: StartRoomOptions, settings: AppSettings): Promise<HostStatus> {
    if (this.status.running || this.starting) throw new Error('이미 회의가 진행 중입니다')
    this.starting = true
    this.update({ lastError: null })
    try {
      this.cert = await loadOrCreateHostCertificate()

      const lanIp = await detectLocalIp()
      if (!lanIp) throw new Error('네트워크 인터페이스에서 IPv4 주소를 찾지 못했습니다')

      let publicIp: string | null = null
      if (opts.addressType === 'public') {
        const stun = await discoverPublicIp()
        if (!stun) throw new Error('공인 IPv4 를 확인할 수 없습니다 (STUN 응답 없음). 인터넷 연결을 확인하거나 LAN 회의로 시작하세요')
        if (!isPublicIpv4(stun.ip)) {
          throw new Error('공인 IPv4 가 아닌 주소가 확인되었습니다. CGNAT 환경으로 보이며 외부 회의 개설을 지원하지 않습니다. LAN 회의는 가능합니다')
        }
        publicIp = stun.ip
      }

      const ports = await planPorts(settings.signalingPort, settings.mediaPort)
      if (ports.changed) log.warn(`기본 포트 사용 불가, 대체 포트 선택: ${ports.signaling}/${ports.media}`)

      if (opts.addressType === 'public' && !opts.skipUpnp) {
        this.upnp = new UpnpManager()
        await this.upnp.cleanupStale([ports.signaling, ports.media])
        try {
          await this.upnp.mapAll(lanIp, [
            { port: ports.signaling, protocol: 'tcp' },
            { port: ports.media, protocol: 'udp' },
            { port: ports.media, protocol: 'tcp' }
          ])
          this.update({ upnpMapped: true })
        } catch (e) {
          await this.upnp.dispose().catch(() => undefined)
          this.upnp = null
          throw new Error(
            `UPnP 포트 매핑에 실패했습니다 (${e instanceof Error ? e.message : e}). ` +
              `공유기에서 TCP ${ports.signaling}, UDP ${ports.media}, TCP ${ports.media} 를 ${lanIp} 로 수동 포워딩한 뒤 “UPnP 건너뛰기” 로 다시 시작하세요`
          )
        }
      }

      this.media = new MediasoupServer()
      await this.media.start({ lanIp, publicIp, mediaPort: ports.media })
      this.media.on('died', () => void this.stop('미디어 엔진(mediasoup worker)이 종료되어 회의를 안전하게 마쳤습니다'))

      const room = new Room({ mode: opts.mode })
      const hostToken = generateToken(16)
      this.rotateToken(settings.inviteTtlSec)

      this.signaling = new SignalingServer({
        port: ports.signaling,
        tls: { key: this.cert.keyPem, cert: this.cert.certPem },
        media: this.media,
        room,
        hostTokenHash: hashToken(hostToken),
        getInviteTokenHash: () => this.inviteTokenHash,
        getInviteExpiresAt: () => this.inviteExpiresAt
      })
      this.signaling.on('participantsChanged', (n) => this.update({ participantCount: n }))
      await this.signaling.start()

      this.powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')

      this.update({
        running: true,
        roomId: room.id,
        signalingPort: ports.signaling,
        mediaPort: ports.media,
        publicIp,
        lanIp,
        addressType: opts.addressType,
        participantCount: 0,
        hostToken,
        certFingerprint: this.cert.fingerprintBase64,
        startedAt: Date.now(),
        invite: this.buildInvite()
      })
      this.startStats()
      this.startNetWatch(lanIp, publicIp)
      log.info(`회의 시작 (${opts.addressType}, 포트 ${ports.signaling}/${ports.media})`)
      return this.getStatus()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('회의 시작 실패', e)
      await this.teardown()
      this.status = { ...emptyStatus(), lastError: msg }
      this.emit('status', this.getStatus())
      throw new Error(msg)
    } finally {
      this.starting = false
    }
  }

  private rotateToken(ttlSec: number): string {
    const token = generateToken(16)
    this.inviteTokenHash = hashToken(token)
    this.inviteExpiresAt = Math.floor(Date.now() / 1000) + ttlSec
    this.currentInviteToken = token
    return token
  }

  private currentInviteToken = ''

  private buildInvite(): InviteBundle {
    const s = this.status
    if (!this.cert || !s.signalingPort || !s.mediaPort) throw new Error('회의가 준비되지 않았습니다')
    const payload: InvitePayload = {
      version: INVITE_VERSION,
      type: s.addressType ?? 'lan',
      ip: (s.addressType === 'public' ? s.publicIp : s.lanIp) ?? s.lanIp ?? '0.0.0.0',
      signalingPort: s.signalingPort,
      mediaPort: s.mediaPort,
      token: this.currentInviteToken,
      certFingerprint: this.cert.fingerprintBase64,
      expiresAt: this.inviteExpiresAt
    }
    const code = encodeInvite(payload)
    return { code, link: inviteLink(code), payload }
  }

  /** 기존 초대코드를 즉시 폐기하고 새로 발급 (계획서 5.2) */
  rotateInvite(ttlSec: number): InviteBundle {
    if (!this.status.running) throw new Error('진행 중인 회의가 없습니다')
    this.rotateToken(ttlSec)
    const invite = this.buildInvite()
    this.update({ invite })
    log.info('초대코드 재발급')
    return invite
  }

  private startStats(): void {
    this.peakUploadMbps = 0
    this.statsTimer = setInterval(async () => {
      if (!this.signaling || !this.media) return
      try {
        const s = await this.signaling.collectStats()
        const mbps = s.uploadBps / 1_000_000
        if (mbps > this.peakUploadMbps) this.peakUploadMbps = mbps
        const stats: HostStats = {
          ts: Date.now(),
          uploadBps: s.uploadBps,
          downloadBps: s.downloadBps,
          workerAlive: this.media.alive,
          transports: s.transports,
          producers: s.producers,
          consumers: s.consumers,
          peakUploadMbps: this.peakUploadMbps
        }
        this.update({ stats })
      } catch (e) {
        log.warn('통계 수집 실패', e)
      }
    }, 2000)
  }

  /** 네트워크 인터페이스·공인 IP 변경 감지 (계획서 7.3) */
  private startNetWatch(lanIp: string, publicIp: string | null): void {
    this.netWatchTimer = setInterval(async () => {
      const nowLan = await detectLocalIp()
      if (nowLan && nowLan !== lanIp) {
        return void this.stop('방장 PC 의 네트워크가 변경되어 회의를 종료했습니다. 새 회의를 만들어 초대코드를 다시 전달하세요')
      }
      if (publicIp) {
        const stun = await discoverPublicIp(undefined, 4000)
        if (stun && stun.ip !== publicIp) {
          return void this.stop('방장 공인 IP 가 바뀌어 기존 초대코드가 무효화되었습니다. 회의를 다시 만들어 초대코드를 재전달하세요')
        }
      }
    }, 45_000)
  }

  async stop(reason = '방장이 회의를 종료했습니다'): Promise<void> {
    if (!this.status.running && !this.starting) return
    log.info('회의 종료 시작')
    if (this.peakUploadMbps > 0) this.persist({ lastMeasuredUploadMbps: Math.round(this.peakUploadMbps * 10) / 10 })
    await this.teardown(reason)
    this.status = { ...emptyStatus(), lastError: reason.startsWith('방장이') ? null : reason }
    this.emit('status', this.getStatus())
    this.emit('stopped', reason)
  }

  private async teardown(reason = '회의 종료'): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.netWatchTimer) clearInterval(this.netWatchTimer)
    this.statsTimer = null
    this.netWatchTimer = null
    if (this.powerBlockerId !== null && powerSaveBlocker.isStarted(this.powerBlockerId)) powerSaveBlocker.stop(this.powerBlockerId)
    this.powerBlockerId = null
    await this.signaling?.close(reason).catch((e) => log.warn('시그널링 종료 오류', e))
    this.signaling = null
    await this.media?.close().catch(() => undefined)
    this.media = null
    await this.upnp?.dispose().catch((e) => log.warn('UPnP 해제 오류', e))
    this.upnp = null
    this.inviteTokenHash = null
    this.currentInviteToken = ''
  }
}

function emptyStatus(): HostStatus {
  return {
    running: false,
    roomId: null,
    signalingPort: null,
    mediaPort: null,
    publicIp: null,
    lanIp: null,
    addressType: null,
    participantCount: 0,
    invite: null,
    hostToken: null,
    certFingerprint: null,
    upnpMapped: false,
    startedAt: null,
    stats: null,
    lastError: null
  }
}
