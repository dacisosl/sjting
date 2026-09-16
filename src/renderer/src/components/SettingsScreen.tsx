import { useState } from 'react'
import { ArrowLeft, FileDown } from 'lucide-react'
import { DEFAULT_SERVER_URL } from '@shared/constants'
import { useDevices } from '../lib/useDevices'
import { useAppStore } from '../store/appStore'
import { Button, Card, Field, Input, Select } from './ui'

export default function SettingsScreen() {
  const { go, settings, updateSettings } = useAppStore()
  const devices = useDevices()
  const [saved, setSaved] = useState<string | null>(null)
  const [serverUrl, setServerUrl] = useState(settings?.serverUrl ?? DEFAULT_SERVER_URL)
  if (!settings) return null

  const save = async (patch: Parameters<typeof updateSettings>[0]) => {
    try {
      await updateSettings(patch)
      setSaved('저장됨')
    } catch (e) {
      setSaved(`저장 실패: ${(e as Error).message}`)
    }
    setTimeout(() => setSaved(null), 2000)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
        <Button variant="ghost" onClick={() => go('home')}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold">설정</h1>
        {saved && <span className="text-xs text-emerald-400">{saved}</span>}
      </header>
      <main className="grid flex-1 grid-cols-1 gap-5 overflow-auto p-6 lg:grid-cols-2">
        <Card title="장치">
          <div className="space-y-4">
            <Field label="마이크">
              <Select value={settings.preferredMicId ?? ''} onChange={(e) => void save({ preferredMicId: e.target.value || null })}>
                <option value="">기본 장치</option>
                {devices.mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || '마이크'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="카메라">
              <Select value={settings.preferredCameraId ?? ''} onChange={(e) => void save({ preferredCameraId: e.target.value || null })}>
                <option value="">기본 장치</option>
                {devices.cameras.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || '카메라'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="스피커">
              <Select value={settings.preferredSpeakerId ?? ''} onChange={(e) => void save({ preferredSpeakerId: e.target.value || null })}>
                <option value="">기본 장치</option>
                {devices.speakers.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || '스피커'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="화면공유 기본 프리셋">
              <Select value={settings.screenPreset} onChange={(e) => void save({ screenPreset: e.target.value as 'document' | 'video' })}>
                <option value="document">문서 모드 (1080p, 10fps, 글자 선명)</option>
                <option value="video">동영상 모드 (30fps, 시스템 오디오)</option>
              </Select>
            </Field>
            <p className="text-xs text-slate-500">장치 이름이 비어 있으면 회의에서 한 번 마이크·카메라를 켠 뒤 다시 확인하세요.</p>
          </div>
        </Card>
        <Card title="회의 서버 (고급)">
          <div className="space-y-3">
            <Field label="서버 주소" hint="직접 배포한 서버를 쓸 때만 바꿉니다. 기본값으로 되돌리려면 비우고 저장하세요.">
              <Input value={serverUrl} spellCheck={false} onChange={(e) => setServerUrl(e.target.value)} />
            </Field>
            <Button
              onClick={() => {
                const v = serverUrl.trim() || DEFAULT_SERVER_URL
                setServerUrl(v)
                void save({ serverUrl: v })
              }}
            >
              서버 주소 저장
            </Button>
          </div>
        </Card>
        <Card title="진단 로그">
          <p className="mb-3 text-xs text-slate-400">로그에는 토큰·채팅·미디어 내용이 포함되지 않습니다. 문제 신고 시 첨부할 수 있습니다.</p>
          <Button onClick={() => void window.sjting.log.export().then((p) => p && setSaved(`내보냄: ${p}`))}>
            <FileDown size={16} /> 로그 내보내기
          </Button>
        </Card>
        <Card title="정보">
          <p className="text-xs text-slate-400">SJTing 은 Electron 과 Cloudflare Realtime 기반 오픈소스 앱입니다. 업데이트는 GitHub Releases 에서 내려받습니다.</p>
          <Button className="mt-3" onClick={() => void window.sjting.app.openExternal('https://github.com/dacisosl/sjting/releases')}>
            GitHub Releases 열기
          </Button>
        </Card>
      </main>
    </div>
  )
}
