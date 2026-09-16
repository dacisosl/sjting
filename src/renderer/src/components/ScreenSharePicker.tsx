import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import type { ScreenSourceInfo } from '@shared/types'
import type { ScreenSharePreset } from '@shared/constants'
import { meetingClient } from '../lib/MeetingClient'
import { platform } from '../platform'
import { useAppStore } from '../store/appStore'
import { useMeetingStore } from '../store/meetingStore'
import { Button, Spinner, Toggle } from './ui'

export default function ScreenSharePicker({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((s) => s.settings)
  const toast = useMeetingStore((s) => s.toast)
  const [sources, setSources] = useState<ScreenSourceInfo[] | null | 'native'>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preset, setPreset] = useState<ScreenSharePreset>(settings?.screenPreset ?? 'document')
  const [audio, setAudio] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void platform.screen.getSources().then((s) => setSources(s ?? 'native')).catch(() => setSources([]))
  }, [])

  const start = async () => {
    if (sources !== 'native' && !selected) return
    setBusy(true)
    try {
      await meetingClient.startScreenShare(sources === 'native' ? null : selected, preset, audio)
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">공유할 화면 선택</h2>
        {!sources ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner /> 화면 목록을 불러오는 중…
          </div>
        ) : sources === 'native' ? (
          <p className="rounded-lg bg-slate-800/60 p-3 text-sm text-slate-300">
            "공유 시작" 을 누르면 브라우저가 공유할 화면·창·탭을 고르는 창을 띄웁니다. PC 소리를 함께 보내려면 그 창에서 "시스템 오디오 공유" 또는 "탭 오디오 공유" 를 켜세요.
          </p>
        ) : (
          <div className="scrollbar-thin grid max-h-[50vh] grid-cols-2 gap-3 overflow-auto pr-1 md:grid-cols-3">
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={clsx('rounded-lg border p-2 text-left transition', selected === s.id ? 'border-sky-500 bg-sky-500/10' : 'border-slate-800 hover:border-slate-600')}
              >
                <img src={s.thumbnailDataUrl} alt="" className="aspect-video w-full rounded object-cover" />
                <div className="mt-1 flex items-center gap-1 text-xs text-slate-300">
                  {s.appIconDataUrl && <img src={s.appIconDataUrl} alt="" className="h-4 w-4" />}
                  <span className="truncate">{s.kind === 'screen' ? `🖥 ${s.name}` : s.name}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-400">화질 프리셋</p>
            <div className="flex gap-2">
              <Button variant={preset === 'document' ? 'primary' : 'secondary'} onClick={() => setPreset('document')} className="flex-1">
                문서 (글자 선명, 5~15fps)
              </Button>
              <Button variant={preset === 'video' ? 'primary' : 'secondary'} onClick={() => setPreset('video')} className="flex-1">
                동영상 (30fps)
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-400">시스템 오디오</p>
            <Toggle checked={audio} onChange={setAudio} label="PC 소리 함께 공유 (Windows)" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button variant="primary" onClick={start} disabled={(sources !== 'native' && !selected) || busy}>
            {busy && <Spinner />} 공유 시작
          </Button>
        </div>
      </div>
    </div>
  )
}
