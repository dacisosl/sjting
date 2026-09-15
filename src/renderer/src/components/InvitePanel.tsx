import { useState } from 'react'
import { Copy, RefreshCw, X } from 'lucide-react'
import { maskIp } from '@shared/invite'
import { useAppStore } from '../store/appStore'
import { useMeetingStore } from '../store/meetingStore'
import { Badge, Button } from './ui'

export default function InvitePanel({ onClose }: { onClose: () => void }) {
  const { hostStatus, setHostStatus } = useAppStore()
  const toast = useMeetingStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const invite = hostStatus?.invite
  if (!hostStatus?.running || !invite) return null

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    toast(`${label}를 복사했습니다`)
  }

  const rotate = async () => {
    setBusy(true)
    try {
      const inv = await window.sjting.host.rotateInvite()
      setHostStatus({ ...hostStatus, invite: inv })
      toast('초대코드를 재발급했습니다. 이전 코드는 즉시 무효화됩니다')
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
          <h2 className="text-base font-semibold">초대코드</h2>
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <Badge level={hostStatus.addressType === 'public' ? 'green' : 'blue'}>{hostStatus.addressType === 'public' ? '외부 접속 가능' : 'LAN 전용'}</Badge>
          <span>
            주소 {maskIp(invite.payload.ip)} · 포트 {invite.payload.signalingPort}/{invite.payload.mediaPort}
          </span>
          <span>· 만료 {new Date(invite.payload.expiresAt * 1000).toLocaleString()}</span>
          {hostStatus.upnpMapped && <span>· UPnP 매핑됨</span>}
        </div>
        <label className="mb-1 block text-xs text-slate-400">초대 링크 (권장)</label>
        <div className="mb-3 flex gap-2">
          <input readOnly value={invite.link} className="w-full truncate rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200" />
          <Button onClick={() => void copy(invite.link, '초대 링크')}>
            <Copy size={16} />
          </Button>
        </div>
        <label className="mb-1 block text-xs text-slate-400">초대코드</label>
        <div className="mb-4 flex gap-2">
          <textarea readOnly value={invite.code} rows={3} className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200" />
          <Button onClick={() => void copy(invite.code, '초대코드')}>
            <Copy size={16} />
          </Button>
        </div>
        <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200">
          초대코드에는 이 PC 의 공인 IP 가 포함됩니다. 유출이 의심되면 재발급하세요. 재발급하면 기존 코드는 즉시 무효화되지만 이미 입장한 참가자는 유지됩니다.
        </p>
        <div className="flex justify-end">
          <Button variant="danger" onClick={rotate} disabled={busy}>
            <RefreshCw size={16} /> 초대코드 재발급
          </Button>
        </div>
      </div>
    </div>
  )
}
