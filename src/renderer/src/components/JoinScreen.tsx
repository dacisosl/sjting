import { useEffect, useState } from 'react'
import { ArrowLeft, ClipboardPaste } from 'lucide-react'
import type { InvitePayload } from '@shared/types'
import { getRoomInfo, type RoomInfo } from '../lib/api'
import { meetingClient } from '../lib/MeetingClient'
import { IS_WEB, platform } from '../platform'
import { appLink, extractInviteCode } from '@shared/invite'
import { useAppStore } from '../store/appStore'
import { Badge, Button, Card, Field, Input, Spinner } from './ui'

export default function JoinScreen() {
  const { go, settings, updateSettings, pendingInvite, pendingInviteRaw, setPendingInvite } = useAppStore()
  const [name, setName] = useState(settings?.displayName || '')
  const [raw, setRaw] = useState(pendingInviteRaw ?? '')
  const [invite, setInvite] = useState<InvitePayload | null>(pendingInvite)
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (pendingInvite) {
      setInvite(pendingInvite)
      if (pendingInviteRaw) setRaw(pendingInviteRaw)
    }
  }, [pendingInvite, pendingInviteRaw])

  useEffect(() => {
    if (!invite) return setInfo(null)
    let alive = true
    getRoomInfo(invite.serverUrl, invite.roomId)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null))
    return () => {
      alive = false
    }
  }, [invite])

  const parse = async (text: string) => {
    setRaw(text)
    setError(null)
    if (!text.trim()) return setInvite(null)
    try {
      const p = await platform.invite.parse(text)
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
      await meetingClient.join({ serverUrl: invite.serverUrl, roomId: invite.roomId, token: invite.token, displayName: name.trim() })
      go('meeting')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const expired = invite ? invite.expiresAt !== 0 && invite.expiresAt * 1000 < Date.now() : false
  const roomGone = info !== null && (!info.exists || info.closed)

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
            <Field label="초대 링크 또는 초대코드" hint={IS_WEB ? '방장이 보낸 링크를 붙여넣으세요. 링크를 직접 클릭해 이 페이지에 왔다면 이미 채워져 있습니다.' : '방장이 보낸 링크를 붙여넣으세요.'}>
              <div className="flex gap-2">
                <Input value={raw} spellCheck={false} onChange={(e) => void parse(e.target.value)} placeholder="https://.../join/... 또는 sjting://join/..." />
                <Button onClick={paste} title="클립보드에서 붙여넣기">
                  <ClipboardPaste size={16} />
                </Button>
              </div>
            </Field>
            {invite && (
              <div className="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge level={expired ? 'red' : roomGone ? 'red' : 'green'}>{expired ? '만료됨' : roomGone ? '종료된 회의' : '유효한 초대'}</Badge>
                  {info?.exists && !info.closed && (
                    <Badge level={info.locked ? 'yellow' : 'blue'}>
                      {info.locked ? '입장 잠김' : `${info.participantCount}/${info.maxParticipants}명 참가 중`}
                    </Badge>
                  )}
                </div>
                <dl className="grid grid-cols-[100px_1fr] gap-1">
                  <dt className="text-slate-500">회의 서버</dt>
                  <dd className="truncate">{invite.serverUrl.replace(/^https?:\/\//, '')}</dd>
                  <dt className="text-slate-500">방 ID</dt>
                  <dd className="font-mono">{invite.roomId}</dd>
                  <dt className="text-slate-500">만료</dt>
                  <dd>{invite.expiresAt ? new Date(invite.expiresAt * 1000).toLocaleString() : '없음'}</dd>
                </dl>
              </div>
            )}
            {error && <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
            <Button variant="primary" className="w-full" disabled={!invite || expired || roomGone || !name.trim() || busy} onClick={join}>
              {busy ? <Spinner /> : null} {IS_WEB ? '브라우저로 참가' : '참가'}
            </Button>
            {IS_WEB && invite && !expired && !roomGone && (
              <p className="text-center text-xs text-slate-500">
                설치형 앱이 있다면{' '}
                <a className="text-sky-400 underline" href={appLink(extractInviteCode(raw))}>
                  앱으로 열기
                </a>
                . 크롬·엣지 브라우저를 권장합니다.
              </p>
            )}
          </div>
        </Card>
      </main>
    </div>
  )
}
