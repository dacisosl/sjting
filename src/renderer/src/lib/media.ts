/** 장치 열거·getUserMedia·화면 캡처 헬퍼 (계획서 6.2 품질 정책) */
import { QUALITY, type ScreenSharePreset } from '@shared/constants'

export interface DeviceLists {
  mics: MediaDeviceInfo[]
  cameras: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
}

export async function listDevices(): Promise<DeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return {
    mics: all.filter((d) => d.kind === 'audioinput'),
    cameras: all.filter((d) => d.kind === 'videoinput'),
    speakers: all.filter((d) => d.kind === 'audiooutput')
  }
}

export class MediaPermissionError extends Error {
  constructor(
    public readonly kind: 'mic' | 'camera' | 'screen',
    message: string
  ) {
    super(message)
  }
}

function describeError(kind: 'mic' | 'camera' | 'screen', e: unknown): MediaPermissionError {
  const name = (e as { name?: string })?.name ?? ''
  const label = kind === 'mic' ? '마이크' : kind === 'camera' ? '카메라' : '화면'
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MediaPermissionError(kind, `${label} 권한이 거부되었습니다. Windows 설정 > 개인 정보 > ${label} 에서 앱 접근을 허용하세요`)
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new MediaPermissionError(kind, `${label} 장치를 찾을 수 없습니다. 연결 상태를 확인하거나 다른 장치를 선택하세요`)
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new MediaPermissionError(kind, `${label} 를 다른 프로그램이 사용 중이거나 읽을 수 없습니다`)
  }
  return new MediaPermissionError(kind, `${label} 를 시작할 수 없습니다: ${(e as Error)?.message ?? String(e)}`)
}

export async function getMicTrack(deviceId: string | null): Promise<MediaStreamTrack> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: QUALITY.audio.channelCount,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    return stream.getAudioTracks()[0]
  } catch (e) {
    if (deviceId) return getMicTrack(null) // 선택 장치가 사라진 경우 기본 장치로 대체
    throw describeError('mic', e)
  }
}

export async function getCameraTrack(deviceId: string | null, presenter = false): Promise<MediaStreamTrack> {
  const q = presenter ? QUALITY.presenterCamera : QUALITY.camera
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: q.width },
        height: { ideal: q.height },
        frameRate: { ideal: q.frameRate, max: 30 }
      }
    })
    return stream.getVideoTracks()[0]
  } catch (e) {
    if (deviceId) return getCameraTrack(null, presenter)
    throw describeError('camera', e)
  }
}

export interface ScreenCapture {
  video: MediaStreamTrack
  audio: MediaStreamTrack | null
}

/**
 * 화면 캡처. 소스는 사전에 window.sjting.screen.select 로 등록되어 있어야 한다
 * (Main 의 setDisplayMediaRequestHandler 가 해당 소스를 넘겨준다).
 */
export async function getScreenCapture(preset: ScreenSharePreset, withSystemAudio: boolean): Promise<ScreenCapture> {
  const q = QUALITY.screen[preset]
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: q.width }, height: { max: q.height }, frameRate: { ideal: q.frameRate, max: q.frameRate } },
      audio: withSystemAudio
    })
    const video = stream.getVideoTracks()[0]
    // 문서 모드는 글자 선명도 우선, 영상 모드는 부드러움 우선
    try {
      video.contentHint = q.contentHint
    } catch {
      /* ignore */
    }
    return { video, audio: stream.getAudioTracks()[0] ?? null }
  } catch (e) {
    throw describeError('screen', e)
  }
}

export function stopTrack(track: MediaStreamTrack | null | undefined): void {
  try {
    track?.stop()
  } catch {
    /* ignore */
  }
}
