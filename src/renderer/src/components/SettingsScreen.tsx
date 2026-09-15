import { useState } from 'react'
import { ArrowLeft, FileDown } from 'lucide-react'
import { useDevices } from '../lib/useDevices'
import { useAppStore } from '../store/appStore'
import { Button, Card, Field, Input, Select } from './ui'

export default function SettingsScreen() {
  const { go, settings, updateSettings } = useAppStore()
  const devices = useDevices()
  const [saved, setSaved] = useState<string | null>(null)
  if (!settings) return null

  const save = async (patch: Parameters<typeof updateSettings>[0]) => {
    await updateSettings(patch)
    setSaved('저장됨')
    setTimeout(() => setSaved(null), 1500)
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
                <option value="document">문서 모드 (1080p, 5~15fps, 글자 선명)</option>
                <option value="video">동영상 모드 (30fps, 시스템 오디오)</option>
              </Select>
            </Field>
            <p className="text-xs text-slate-500">장치 이름이 비어 있으면 회의에서 한 번 마이크·카메라를 켠 뒤 다시 확인하세요.</p>
          </div>
        </Card>
        <Card title="방장 네트워크">
          <div className="space-y-4">
            <Field label="시그널링 포트 (TCP)" hint="기본 44330. 변경 시 수동 포트포워딩 규칙도 맞춰야 합니다.">
              <Input
                type="number"
                min={1024}
                max={65535}
                defaultValue={settings.signalingPort}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (v >= 1024 && v <= 65535 && v !== settings.signalingPort) void save({ signalingPort: v })
                }}
              />
            </Field>
            <Field label="미디어 포트 (UDP/TCP)" hint="기본 44331">
              <Input
                type="number"
                min={1024}
                max={65535}
                defaultValue={settings.mediaPort}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (v >= 1024 && v <= 65535 && v !== settings.mediaPort) void save({ mediaPort: v })
                }}
              />
            </Field>
            <Field label="초대코드 유효 시간">
              <Select value={String(settings.inviteTtlSec)} onChange={(e) => void save({ inviteTtlSec: Number(e.target.value) })}>
                <option value="3600">1시간</option>
                <option value="14400">4시간</option>
                <option value="43200">12시간</option>
                <option value="86400">24시간</option>
              </Select>
            </Field>
            <div className="rounded-lg bg-slate-800/50 p-3 text-xs text-slate-400">
              이전 회의 최대 업로드: {settings.lastMeasuredUploadMbps !== null ? `${settings.lastMeasuredUploadMbps} Mbps` : '기록 없음'}
            </div>
          </div>
        </Card>
        <Card title="진단 로그">
          <p className="mb-3 text-xs text-slate-400">로그에는 토큰·전체 IP·채팅·미디어 내용이 포함되지 않습니다. 문제 신고 시 첨부할 수 있습니다.</p>
          <Button onClick={() => void window.sjting.log.export().then((p) => p && setSaved(`내보냄: ${p}`))}>
            <FileDown size={16} /> 로그 내보내기
          </Button>
        </Card>
        <Card title="정보">
          <p className="text-xs text-slate-400">
            SJTing 은 Electron·mediasoup 기반 오픈소스 앱입니다. 업데이트는 GitHub Releases 에서 수동으로 내려받습니다.
          </p>
          <Button className="mt-3" onClick={() => void window.sjting.app.openExternal('https://github.com/dacisosl/sjting/releases')}>
            GitHub Releases 열기
          </Button>
        </Card>
      </main>
    </div>
  )
}
