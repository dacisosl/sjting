import { useMemo, useState } from 'react'
import { Copy, RefreshCw, X } from 'lucide-react'
import { INVITE_VERSION } from '@shared/constants'
import { buildInvite } from '@shared/invite'
import { meetingClient } from '../lib/MeetingClient'
import { useMeetingStore } from '../store/meetingStore'
import { Badge, Button } from './ui'

export default function InvitePanel({ onClose }: { onClose: () => void }) {
  const { invite, roomId, serverUrl, toast, participants, maxParticipants } = useMeetingStore()
  const [busy, setBusy] = useState(false)

  const bundle = useMemo(() => {
    if (!invite || !roomId || !serverUrl) return null
    try {
      return buildInvite({ version: INVITE_VERSION, serverUrl, roomId, token: invite.token, expiresAt: invite.expiresAt })
    } catch {
      return null
    }
  }, [invite, roomId, serverUrl])

  if (!bundle) return null

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    toast(`${label}를 복사했습니다`)
  }

  const rotate = async () => {
    setBusy(true)
    try {
      await meetingClient.rotateInvite()
      toast('초대 링크를 재발급했습니다. 이전 링크는 즉시 무효화됩니다')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">초대 링크</h2>
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <Badge level="green">
            {participants.length}/{maxParticipants}명
          </Badge>
          <span>만료 {bundle.payload.expiresAt ? new Date(bundle.payload.expiresAt * 1000).toLocaleString() : '없음'}</span>
        </div>
        <label className="mb-1 block text-xs text-slate-400">초대 링크 (이걸 보내세요)</label>
        <div className="mb-3 flex gap-2">
          <input readOnly value={bundle.link} className="w-full truncate rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200" />
          <Button variant="primary" onClick={() => void copy(bundle.link, '초대 링크')}>
            <Copy size={16} /> 복사
          </Button>
        </div>
        <label className="mb-1 block text-xs text-slate-400">초대코드 (링크가 안 열릴 때 붙여넣기용)</label>
        <div className="mb-4 flex gap-2">
          <textarea readOnly value={bundle.code} rows={2} className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200" />
          <Button onClick={() => void copy(bundle.code, '초대코드')}>
            <Copy size={16} />
          </Button>
        </div>
        <p className="mb-4 rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
          링크를 가진 사람은 누구나 들어올 수 있습니다. 신뢰하는 사람에게만 보내고, 유출이 의심되면 재발급하세요. 재발급하면 기존 링크는 즉시 무효화되지만 이미 입장한 참가자는 유지됩니다.
        </p>
        <div className="flex justify-end">
          <Button variant="danger" onClick={rotate} disabled={busy}>
            <RefreshCw size={16} /> 초대 링크 재발급
          </Button>
        </div>
      </div>
    </div>
  )
}
