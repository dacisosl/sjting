import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { Hand, MicOff, MonitorUp, WifiOff } from 'lucide-react'
import type { Participant } from '@shared/types'
import { useMeetingStore } from '../store/meetingStore'

interface Props {
  participant: Participant
  track: MediaStreamTrack | null
  /** 화면공유 타일이면 true */
  isScreen?: boolean
  large?: boolean
  mirror?: boolean
  isMe?: boolean
  className?: string
}

export default function VideoTile({ participant, track, isScreen, large, mirror, isMe, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = useMeetingStore((s) => s.activeSpeakerId === participant.id)
  const setVisible = useMeetingStore((s) => s.setVisible)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (track) {
      v.srcObject = new MediaStream([track])
      void v.play().catch(() => undefined)
    } else {
      v.srcObject = null
    }
  }, [track])

  // 창 밖으로 스크롤된 타일은 구독을 멈춘다 (계획서 6.4)
  useEffect(() => {
    const el = rootRef.current
    if (!el || isMe || isScreen) return
    const io = new IntersectionObserver(([e]) => setVisible(participant.id, e.isIntersecting), { threshold: 0.2 })
    io.observe(el)
    return () => {
      io.disconnect()
      setVisible(participant.id, false)
    }
  }, [participant.id, isMe, isScreen, setVisible])

  const showVideo = !!track && track.readyState === 'live'

  return (
    <div
      ref={rootRef}
      className={clsx(
        'relative overflow-hidden rounded-xl bg-slate-900 ring-2 transition',
        active && !isScreen ? 'ring-emerald-400' : 'ring-transparent',
        large ? 'h-full w-full' : 'aspect-video',
        className
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={clsx('h-full w-full', isScreen ? 'object-contain' : 'object-cover', mirror && 'scale-x-[-1]', !showVideo && 'hidden')}
      />
      {!showVideo && (
        <div className="flex h-full w-full items-center justify-center">
          <div className={clsx('flex items-center justify-center rounded-full bg-slate-700 font-semibold text-slate-100', large ? 'h-24 w-24 text-3xl' : 'h-12 w-12 text-lg')}>
            {participant.displayName.slice(0, 2)}
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-xs text-white">
        {isScreen && <MonitorUp size={12} />}
        <span className="truncate">
          {participant.displayName}
          {isMe ? ' (나)' : ''}
          {participant.isHost ? ' · 방장' : ''}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {participant.handRaised && <Hand size={12} className="text-amber-300" />}
          {participant.connection === 'reconnecting' && <WifiOff size={12} className="text-rose-300" />}
          {participant.micMuted && !isScreen && <MicOff size={12} className="text-rose-300" />}
        </span>
      </div>
    </div>
  )
}

/** 원격 오디오 재생용 숨김 요소 */
export function AudioSink({ track, speakerId }: { track: MediaStreamTrack; speakerId: string | null }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const a = ref.current
    if (!a) return
    a.srcObject = new MediaStream([track])
    void a.play().catch(() => undefined)
  }, [track])
  useEffect(() => {
    const a = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (a?.setSinkId && speakerId) void a.setSinkId(speakerId).catch(() => undefined)
  }, [speakerId])
  return <audio ref={ref} autoPlay />
}
