import { useEffect, useState } from 'react'
import { ArrowLeft, ClipboardPaste } from 'lucide-react'
import type { InvitePayload } from '@shared/types'
import { maskIp } from '@shared/invite'
import { meetingClient } from '../lib/MeetingClient'
import { useAppStore } from '../store/appStore'
import { Badge, Button, Card, Field, Input, Spinner } from './ui'

export default function JoinScreen() {
  const { go, settings, updateSettings, pendingInvite, pendingInviteRaw, setPendingInvite } = useAppStore()
  const [name, setName] = useState(settings?.displayName || '')
  const [raw, setRaw] = useState(pendingInviteRaw ?? '')
  const [invite, setInvite] = useState<InvitePayload | null>(pendingInvite)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (pendingInvite) {
      setInvite(pendingInvite)
      if (pendingInviteRaw) setRaw(pendingInviteRaw)
    }
  }, [pendingInvite, pendingInviteRaw])

  const parse = async (text: string) => {
    setRaw(text)
    setError(null)
    if (!text.trim()) return setInvite(null)
    try {
      const p = await window.sjting.invite.parse(text)
      setInvite(p)
      setPendingInvite(p, text)
    } catch (e) {
      setInvite(null)
      setError((e as Error).message)
    }
  }

  const paste = async () => {
    try {
      await parse(await navigator.clipboard.readText())
    } catch {
      setError('클립보드를 읽을 수 없습니다. 직접 붙여넣어 주세요')
    }
  }

  const join = async () => {
    if (!invite) return
    setBusy(true)
    setError(null)
    try {
      await updateSettings({ displayName: name.trim() })
      const { signalingUrl } = await window.sjting.join.prepare(invite)
      await meetingClient.join({ signalingUrl, token: invite.token, displayName: name.trim() })
      go('meeting')
    } catch (e) {
      setError((e as Error).message)
      await window.sjting.join.clear()
    } finally {
      setBusy(false)
    }
  }

  const expired = invite ? invite.expiresAt !== 0 && invite.expiresAt * 1000 < Date.now() : false

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
        <Button variant="ghost" onClick={() => go('home')} disabled={busy}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold">회의 참가</h1>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 overflow-auto p-6">
        <Card title="초대코드">
          <div className="space-y-4">
            <Field label="내 표시 이름">
              <Input value={name} maxLength={24} placeholder="예: 김철수" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="초대코드 또는 sjting:// 링크" hint="방장이 보낸 코드를 붙여넣으세요. 직접 타이핑하지 않아도 됩니다.">
              <div className="flex gap-2">
                <Input value={raw} spellCheck={false} onChange={(e) => void parse(e.target.value)} placeholder="sjting://join/..." />
                <Button onClick={paste} title="클립보드에서 붙여넣기">
                  <ClipboardPaste size={16} />
                </Button>
              </div>
            </Field>
            {invite && (
              <div className="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
                <div className="mb-2 flex items-center gap-2">
                  <Badge level={expired ? 'red' : 'green'}>{expired ? '만료됨' : '유효한 초대'}</Badge>
                  <Badge level="blue">{invite.type === 'public' ? '외부 접속' : 'LAN 접속'}</Badge>
                </div>
                <dl className="grid grid-cols-[100px_1fr] gap-1">
                  <dt className="text-slate-500">방장 주소</dt>
                  <dd>
                    {maskIp(invite.ip)} : {invite.signalingPort}
                  </dd>
                  <dt className="text-slate-500">인증서 지문</dt>
                  <dd className="truncate font-mono">{invite.certFingerprint.slice(0, 24)}…</dd>
                  <dt className="text-slate-500">만료</dt>
                  <dd>{invite.expiresAt ? new Date(invite.expiresAt * 1000).toLocaleString() : '없음'}</dd>
                </dl>
                <p className="mt-2 text-slate-500">연결 시 방장 인증서 지문을 고정 검증합니다. 지문이 다르면 입장이 차단됩니다.</p>
              </div>
            )}
            {error && <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
            <Button variant="primary" className="w-full" disabled={!invite || expired || !name.trim() || busy} onClick={join}>
              {busy ? <Spinner /> : null} 참가
            </Button>
          </div>
        </Card>
      </main>
    </div>
  )
}
