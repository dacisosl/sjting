import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { LayoutMode } from '@shared/constants'
import { LAYOUT_MODE_LABEL } from '@shared/constants'
import { createRoom } from '../lib/api'
import { meetingClient } from '../lib/MeetingClient'
import { useAppStore } from '../store/appStore'
import { useMeetingStore } from '../store/meetingStore'
import { Button, Card, Field, Input, Select, Spinner } from './ui'

export default function CreateRoomScreen() {
  const { go, settings, updateSettings } = useAppStore()
  const [name, setName] = useState(settings?.displayName || '')
  const [mode, setMode] = useState<LayoutMode>(settings?.defaultMode ?? 'presentation')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    if (!settings) return
    setError(null)
    setBusy('회의방을 만드는 중…')
    try {
      const displayName = name.trim()
      await updateSettings({ displayName, defaultMode: mode })
      const created = await createRoom(settings.serverUrl, { displayName, mode })
      useMeetingStore.getState().set({ invite: { token: created.inviteToken, expiresAt: created.inviteExpiresAt } })
      setBusy('회의에 연결하는 중…')
      await meetingClient.join({ serverUrl: settings.serverUrl, roomId: created.roomId, token: created.hostToken, displayName })
      go('meeting')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
        <Button variant="ghost" onClick={() => go('home')} disabled={!!busy}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold">회의 만들기</h1>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 space-y-5 overflow-auto p-6">
        <Card title="회의 설정">
          <div className="space-y-4">
            <Field label="내 표시 이름">
              <Input value={name} maxLength={24} placeholder="예: 김철수" onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="기본 회의 모드" hint="회의 중 언제든 바꿀 수 있습니다. 문서 발표라면 발표 모드를 권장합니다.">
              <Select value={mode} onChange={(e) => setMode(e.target.value as LayoutMode)}>
                {(Object.keys(LAYOUT_MODE_LABEL) as LayoutMode[]).map((m) => (
                  <option key={m} value={m}>
                    {LAYOUT_MODE_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="primary" className="w-full" onClick={start} disabled={!!busy || !name.trim()}>
              {busy ? <Spinner /> : null} 회의 시작
            </Button>
            {busy && <p className="text-xs text-slate-400">{busy}</p>}
            {error && <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
          </div>
        </Card>
        <Card title="시작하면">
          <ul className="space-y-2 text-sm text-slate-400">
            <li>· 초대 링크가 바로 표시됩니다. 복사해서 참가자에게 보내세요.</li>
            <li>· 처음 마이크·카메라를 켤 때 Windows 권한 창이 뜰 수 있습니다.</li>
            <li>· 방장이 5분 이상 자리를 비우면 회의가 자동으로 종료됩니다.</li>
            <li>· 20명 회의는 음성과 화면공유를 우선하며 카메라는 발표자·최근 발언자 중심으로 표시됩니다.</li>
          </ul>
        </Card>
      </main>
    </div>
  )
}
