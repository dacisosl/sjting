import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { LayoutMode } from '@shared/constants'
import { LAYOUT_MODE_LABEL } from '@shared/constants'
import type { InviteAddressType } from '@shared/types'
import { meetingClient } from '../lib/MeetingClient'
import { useAppStore } from '../store/appStore'
import { Button, Card, Field, Input, Select, Spinner, Toggle } from './ui'

export default function HostSetupScreen() {
  const { go, settings, updateSettings, setHostStatus } = useAppStore()
  const [name, setName] = useState(settings?.displayName || '방장')
  const [addressType, setAddressType] = useState<InviteAddressType>('public')
  const [mode, setMode] = useState<LayoutMode>(settings?.defaultMode ?? 'presentation')
  const [skipUpnp, setSkipUpnp] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setError(null)
    setBusy('회의 서버를 시작하는 중… (인증서·주소 확인·포트 매핑)')
    try {
      const status = await window.sjting.host.start({ addressType, mode, displayName: name.trim(), skipUpnp })
      setHostStatus(status)
      await updateSettings({ displayName: name.trim(), defaultMode: mode })
      if (!status.invite || !status.hostToken || !status.signalingPort) throw new Error('회의 정보가 준비되지 않았습니다')
      setBusy('방장 클라이언트를 회의에 연결하는 중…')
      await meetingClient.join({
        signalingUrl: `wss://127.0.0.1:${status.signalingPort}/`,
        token: status.hostToken,
        displayName: name.trim()
      })
      go('meeting')
    } catch (e) {
      setError((e as Error).message)
      await window.sjting.host.stop().catch(() => undefined)
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
        <h1 className="text-lg font-semibold">회의 열기</h1>
      </header>
      <main className="grid flex-1 grid-cols-1 gap-5 overflow-auto p-6 lg:grid-cols-[420px_1fr]">
        <Card title="회의 설정">
          <div className="space-y-4">
            <Field label="내 표시 이름">
              <Input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="접속 범위">
              <Select value={addressType} onChange={(e) => setAddressType(e.target.value as InviteAddressType)}>
                <option value="public">외부 참가 허용 (공인 IP + UPnP)</option>
                <option value="lan">같은 네트워크(LAN) 만</option>
              </Select>
            </Field>
            <Field label="기본 회의 모드" hint="회의 중 언제든 바꿀 수 있습니다">
              <Select value={mode} onChange={(e) => setMode(e.target.value as LayoutMode)}>
                {(Object.keys(LAYOUT_MODE_LABEL) as LayoutMode[]).map((m) => (
                  <option key={m} value={m}>
                    {LAYOUT_MODE_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            {addressType === 'public' && (
              <Toggle checked={skipUpnp} onChange={setSkipUpnp} label="UPnP 건너뛰기 (수동 포트포워딩 완료)" />
            )}
            <Button variant="primary" className="w-full" onClick={start} disabled={!!busy || !name.trim()}>
              {busy ? <Spinner /> : null} 회의 시작
            </Button>
            {busy && <p className="text-xs text-slate-400">{busy}</p>}
            {error && <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
          </div>
        </Card>
        <Card title="시작 전 확인">
          <ul className="space-y-2 text-sm text-slate-400">
            <li>· 처음 시작하면 Windows 방화벽 허용 창이 뜹니다. “개인 및 공용 네트워크” 를 모두 허용하세요.</li>
            <li>· 초대코드에는 이 PC 의 공인 IP 가 포함됩니다. 신뢰하는 사람에게만 전달하세요.</li>
            <li>· 포트 {settings?.signalingPort ?? 44330}(TCP), {settings?.mediaPort ?? 44331}(UDP/TCP) 가 사용 중이면 자동으로 대체 포트를 선택합니다.</li>
            <li>· 회의 중 PC 잠자기는 자동으로 방지되고, 종료 시 UPnP 매핑을 제거합니다.</li>
            <li>· 20명 회의는 음성과 화면공유를 우선하며 카메라는 발표자·최근 발언자 중심으로 전송됩니다.</li>
          </ul>
          <div className="mt-4">
            <Button onClick={() => go('diagnostics')} disabled={!!busy}>
              네트워크 진단 실행
            </Button>
          </div>
        </Card>
      </main>
    </div>
  )
}
