import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Wifi, WifiOff } from 'lucide-react'
import { LAYOUT_MODE_LABEL } from '@shared/constants'
import type { Participant } from '@shared/types'
import { planSubscriptions, isDegraded } from '../lib/layout'
import { useAppStore } from '../store/appStore'
import { useMeetingStore } from '../store/meetingStore'
import ChatPanel from './ChatPanel'
import ControlBar from './ControlBar'
import InvitePanel from './InvitePanel'
import ParticipantsPanel from './ParticipantsPanel'
import VideoTile, { AudioSink } from './VideoTile'
import { Button, Card } from './ui'

export default function MeetingRoom() {
  const s = useMeetingStore()
  const { go, settings, hostStatus } = useAppStore()
  const [showInvite, setShowInvite] = useState(false)
  const meId = s.me?.participantId ?? ''
  const me = s.participants.find((p) => p.id === meId)

  // 방장은 회의 시작 직후 초대코드를 바로 보여준다
  useEffect(() => {
    if (s.me?.isHost && s.phase === 'connected' && s.participants.length <= 1) setShowInvite(true)
  }, [s.me?.isHost, s.phase, s.participants.length])

  const plan = useMemo(
    () =>
      s.me
        ? planSubscriptions({
            mode: s.mode,
            myId: meId,
            participants: s.participants,
            producers: s.producers,
            activeSpeakerId: s.activeSpeakerId,
            recentSpeakers: s.recentSpeakers,
            visibleParticipantIds: null,
            degraded: isDegraded(s.quality)
          })
        : null,
    [s.me, s.mode, meId, s.participants, s.producers, s.activeSpeakerId, s.recentSpeakers, s.quality]
  )

  const consumers = Object.values(s.consumers)
  const trackFor = (participantId: string, source: 'camera' | 'screen') => {
    if (participantId === meId) return source === 'camera' ? s.local.camera : s.local.screen
    const c = consumers.find((x) => x.participantId === participantId && x.source === source && !x.paused)
    return c?.track ?? null
  }
  const audioConsumers = consumers.filter((c) => c.kind === 'audio')

  if (s.phase === 'ended') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card title="회의가 종료되었습니다" className="max-w-md">
          <p className="text-sm text-slate-300">{s.endedReason}</p>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                s.reset()
                go('home')
              }}
            >
              홈으로
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const screenSharer = s.participants.find((p) => plan?.screenProducerId && s.producers.some((pr) => pr.producerId === plan.screenProducerId && pr.participantId === p.id))
  const myScreen = s.sharing && me ? me : null
  const featuredScreenOwner: Participant | null = screenSharer ?? myScreen ?? null
  const featuredId = plan?.featuredParticipantId ?? s.activeSpeakerId
  const others = s.participants.filter((p) => p.id !== meId)
  const stageMode = s.mode === 'presentation' || s.mode === 'lowbandwidth'

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-100">SJTing</span>
        <span>· {LAYOUT_MODE_LABEL[s.mode]}</span>
        <span>· {s.participants.length}명</span>
        {s.phase === 'reconnecting' && <span className="animate-pulse text-amber-300">다시 연결 중…</span>}
        <span className="ml-auto flex items-center gap-1">
          {s.quality.level === 'poor' ? <WifiOff size={14} className="text-rose-300" /> : <Wifi size={14} className={s.quality.level === 'fair' ? 'text-amber-300' : 'text-emerald-300'} />}
          {s.quality.rtt !== null && <span>{Math.round(s.quality.rtt)}ms</span>}
          {s.quality.packetLossPct !== null && s.quality.packetLossPct > 0 && <span>· 손실 {s.quality.packetLossPct.toFixed(1)}%</span>}
          <span>· ↑{(s.quality.uploadBps / 1e6).toFixed(1)} ↓{(s.quality.downloadBps / 1e6).toFixed(1)} Mbps</span>
          {s.me?.isHost && hostStatus?.stats && <span>· 서버 ↑{(hostStatus.stats.uploadBps / 1e6).toFixed(1)} Mbps</span>}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          {stageMode ? (
            <>
              <div className="min-h-0 flex-1">
                {featuredScreenOwner ? (
                  <VideoTile participant={featuredScreenOwner} track={trackFor(featuredScreenOwner.id, 'screen')} isScreen large isMe={featuredScreenOwner.id === meId} />
                ) : featuredId && s.participants.find((p) => p.id === featuredId) ? (
                  <VideoTile participant={s.participants.find((p) => p.id === featuredId)!} track={trackFor(featuredId, 'camera')} large isMe={featuredId === meId} mirror={featuredId === meId} />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl bg-slate-900 text-sm text-slate-500">화면공유 또는 발언자가 여기에 크게 표시됩니다</div>
                )}
              </div>
              <div className="scrollbar-thin flex h-28 gap-2 overflow-x-auto">
                {me && <VideoTile participant={me} track={s.local.camera} isMe mirror className="w-44 shrink-0" />}
                {others.map((p) => (
                  <VideoTile key={p.id} participant={p} track={trackFor(p.id, 'camera')} className="w-44 shrink-0" />
                ))}
              </div>
            </>
          ) : (
            <div className={clsx('scrollbar-thin grid flex-1 auto-rows-min gap-2 overflow-auto', gridCols(s.participants.length + (featuredScreenOwner ? 1 : 0)))}>
              {featuredScreenOwner && (
                <VideoTile participant={featuredScreenOwner} track={trackFor(featuredScreenOwner.id, 'screen')} isScreen className="col-span-2 row-span-2" isMe={featuredScreenOwner.id === meId} />
              )}
              {me && <VideoTile participant={me} track={s.local.camera} isMe mirror />}
              {others.map((p) => (
                <VideoTile key={p.id} participant={p} track={trackFor(p.id, 'camera')} />
              ))}
            </div>
          )}
        </main>
        {s.sidePanel !== 'none' && (
          <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-900/60">
            {s.sidePanel === 'chat' ? <ChatPanel /> : <ParticipantsPanel />}
          </aside>
        )}
      </div>

      <ControlBar onShowInvite={() => setShowInvite(true)} />

      {audioConsumers.map((c) => (
        <AudioSink key={c.consumerId} track={c.track} speakerId={settings?.preferredSpeakerId ?? null} />
      ))}

      {showInvite && s.me?.isHost && <InvitePanel onClose={() => setShowInvite(false)} />}

      {s.toastMsg && (
        <div
          className={clsx(
            'pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg',
            s.toastMsg.kind === 'error' ? 'bg-rose-600 text-white' : s.toastMsg.kind === 'warn' ? 'bg-amber-500 text-black' : 'bg-slate-700 text-white'
          )}
        >
          {s.toastMsg.text}
        </div>
      )}
    </div>
  )
}

function gridCols(n: number): string {
  if (n <= 1) return 'grid-cols-1'
  if (n <= 4) return 'grid-cols-2'
  if (n <= 9) return 'grid-cols-3'
  if (n <= 16) return 'grid-cols-4'
  return 'grid-cols-5'
}
