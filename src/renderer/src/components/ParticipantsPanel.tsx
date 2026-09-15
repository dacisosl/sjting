import { Hand, MicOff, MonitorUp, UserX, WifiOff } from 'lucide-react'
import { meetingClient } from '../lib/MeetingClient'
import { useMeetingStore } from '../store/meetingStore'
import { Button } from './ui'

export default function ParticipantsPanel() {
  const { participants, me, activeSpeakerId, maxParticipants, locked, toast } = useMeetingStore()
  const isHost = !!me?.isHost
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
        <span>
          참가자 {participants.length} / {maxParticipants}
        </span>
        {locked && <span className="text-amber-300">입장 잠김</span>}
      </div>
      <ul className="scrollbar-thin flex-1 overflow-auto p-2">
        {participants.map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-800/60">
            <span className={`h-2 w-2 rounded-full ${activeSpeakerId === p.id ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            <span className="flex-1 truncate text-slate-100">
              {p.displayName}
              {p.id === me?.participantId && <span className="text-slate-500"> (나)</span>}
              {p.isHost && <span className="ml-1 rounded bg-sky-500/20 px-1 text-[10px] text-sky-300">방장</span>}
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              {p.handRaised && <Hand size={14} className="text-amber-300" />}
              {p.sharingScreen && <MonitorUp size={14} className="text-sky-300" />}
              {p.connection === 'reconnecting' && <WifiOff size={14} className="text-rose-300" />}
              {p.micMuted && <MicOff size={14} />}
            </span>
            {isHost && p.id !== me?.participantId && (
              <Button
                variant="ghost"
                className="px-1.5 py-1"
                title="강퇴"
                onClick={() => void meetingClient.kick(p.id).catch((e) => toast((e as Error).message, 'error'))}
              >
                <UserX size={14} className="text-rose-300" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
