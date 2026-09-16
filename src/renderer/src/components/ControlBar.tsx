import { useState } from 'react'
import { clsx } from 'clsx'
import { Hand, LayoutGrid, Link2, Mic, MicOff, MonitorUp, MonitorX, PhoneOff, Users, Video, VideoOff, MessageSquare, Lock, Unlock, VolumeX } from 'lucide-react'
import type { LayoutMode } from '@shared/constants'
import { LAYOUT_MODE_LABEL } from '@shared/constants'
import { meetingClient } from '../lib/MeetingClient'
import { useMeetingStore } from '../store/meetingStore'
import ScreenSharePicker from './ScreenSharePicker'
import { Select } from './ui'

function Ctl({ on, danger, label, onClick, children, badge }: { on?: boolean; danger?: boolean; label: string; onClick: () => void; children: React.ReactNode; badge?: number }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={clsx(
        'relative flex h-11 min-w-11 items-center justify-center rounded-xl px-3 text-sm transition',
        danger ? 'bg-rose-600 text-white hover:bg-rose-500' : on ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      )}
    >
      {children}
      {!!badge && <span className="absolute -right-1 -top-1 rounded-full bg-sky-500 px-1.5 text-[10px] font-bold text-white">{badge}</span>}
    </button>
  )
}

export default function ControlBar({ onShowInvite }: { onShowInvite: () => void }) {
  const s = useMeetingStore()
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const me = s.participants.find((p) => p.id === s.me?.participantId)
  const isHost = !!s.me?.isHost

  const guard = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      s.toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleMic = () => guard(() => (!s.micOn ? meetingClient.enableMic() : meetingClient.setMicMuted(!s.micMuted)))
  const toggleCam = () => guard(() => (s.camOn ? meetingClient.disableCamera() : meetingClient.enableCamera()))
  const toggleShare = () => (s.sharing ? void guard(() => meetingClient.stopScreenShare()) : setPicker(true))
  const leave = () => guard(() => (isHost ? meetingClient.closeRoom() : meetingClient.leave()))

  const micLive = s.micOn && !s.micMuted

  return (
    <>
      <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-950/90 px-4 py-3">
        <Ctl on={micLive} danger={s.micOn && s.micMuted} label={micLive ? '마이크 끄기' : '마이크 켜기'} onClick={() => void toggleMic()}>
          {micLive ? <Mic size={18} /> : <MicOff size={18} />}
        </Ctl>
        <Ctl on={s.camOn} label={s.camOn ? '카메라 끄기' : '카메라 켜기'} onClick={() => void toggleCam()}>
          {s.camOn ? <Video size={18} /> : <VideoOff size={18} />}
        </Ctl>
        <Ctl on={s.sharing} label={s.sharing ? '화면공유 중지' : '화면공유'} onClick={toggleShare}>
          {s.sharing ? <MonitorX size={18} /> : <MonitorUp size={18} />}
        </Ctl>
        <Ctl on={!!me?.handRaised} label="손들기" onClick={() => void guard(() => meetingClient.setHandRaised(!me?.handRaised))}>
          <Hand size={18} />
        </Ctl>

        <div className="mx-2 h-8 w-px bg-slate-800" />

        <div className="flex items-center gap-1 text-xs text-slate-400">
          <LayoutGrid size={14} />
          {isHost ? (
            <Select className="w-auto py-1" value={s.mode} onChange={(e) => void guard(() => meetingClient.setMode(e.target.value as LayoutMode))}>
              {(Object.keys(LAYOUT_MODE_LABEL) as LayoutMode[]).map((m) => (
                <option key={m} value={m}>
                  {LAYOUT_MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          ) : (
            <span>{LAYOUT_MODE_LABEL[s.mode]}</span>
          )}
        </div>

        {isHost && (
          <>
            <Ctl label="초대 링크" onClick={onShowInvite}>
              <Link2 size={18} />
            </Ctl>
            <Ctl on={s.locked} label={s.locked ? '입장 잠금 해제' : '입장 잠금'} onClick={() => void guard(() => meetingClient.setLock(!s.locked))}>
              {s.locked ? <Lock size={18} /> : <Unlock size={18} />}
            </Ctl>
            <Ctl label="전체 음소거 요청" onClick={() => void guard(() => meetingClient.muteAll())}>
              <VolumeX size={18} />
            </Ctl>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Ctl on={s.sidePanel === 'participants'} label="참가자" onClick={() => s.setSidePanel(s.sidePanel === 'participants' ? 'none' : 'participants')} badge={s.participants.length}>
            <Users size={18} />
          </Ctl>
          <Ctl on={s.sidePanel === 'chat'} label="채팅" onClick={() => s.setSidePanel(s.sidePanel === 'chat' ? 'none' : 'chat')} badge={s.unreadChat}>
            <MessageSquare size={18} />
          </Ctl>
          <Ctl danger label={isHost ? '회의 종료' : '나가기'} onClick={() => void leave()}>
            <PhoneOff size={18} />
            <span className="ml-1 hidden sm:inline">{isHost ? '회의 종료' : '나가기'}</span>
          </Ctl>
        </div>
      </div>
      {picker && <ScreenSharePicker onClose={() => setPicker(false)} />}
    </>
  )
}
