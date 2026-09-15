import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { DiagnosticResult, DiagnosticStep, DiagnosticStepKey } from '@shared/types'
import { LAYOUT_MODE_LABEL } from '@shared/constants'
import { useAppStore } from '../store/appStore'
import { Badge, Button, Card, LEVEL_LABEL, Spinner } from './ui'

const ORDER: DiagnosticStepKey[] = ['local', 'publicIp', 'cgnat', 'upnp', 'portMap', 'firewall', 'reachability', 'bandwidth', 'recommendation']

export default function DiagnosticsScreen() {
  const { go, settings } = useAppStore()
  const [steps, setSteps] = useState<Record<string, DiagnosticStep>>({})
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.sjting.network.onDiagnosticStep((s) => setSteps((prev) => ({ ...prev, [s.key]: s }))), [])

  const run = async () => {
    setRunning(true)
    setError(null)
    setSteps({})
    setResult(null)
    try {
      setResult(await window.sjting.network.runDiagnostics({ signalingPort: settings?.signalingPort, mediaPort: settings?.mediaPort }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
        <Button variant="ghost" onClick={() => go('home')}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold">네트워크 진단</h1>
        <div className="ml-auto">
          <Button onClick={run} disabled={running}>
            {running ? <Spinner /> : <RefreshCw size={16} />} 다시 검사
          </Button>
        </div>
      </header>
      <main className="grid flex-1 grid-cols-1 gap-5 overflow-auto p-6 lg:grid-cols-[1fr_360px]">
        <Card title="검사 단계">
          <ol className="space-y-2">
            {ORDER.map((k, i) => {
              const s = steps[k]
              return (
                <li key={k} className="flex items-start gap-3 rounded-lg bg-slate-800/40 p-3">
                  <span className="mt-0.5 w-5 text-right text-xs text-slate-500">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-100">{s?.title ?? TITLE_FALLBACK[k]}</span>
                      {s && <Badge level={s.level}>{LEVEL_LABEL[s.level]}</Badge>}
                    </div>
                    {s && s.level !== 'pending' && <p className="mt-1 text-xs text-slate-400">{s.detail}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        </Card>
        <div className="space-y-5">
          <Card title="종합 판정">
            {!result ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Spinner /> 검사 중…
              </div>
            ) : (
              <div className="space-y-3">
                <Badge level={result.overall}>{OVERALL[result.overall]}</Badge>
                <p className="text-sm text-slate-300">{result.summary}</p>
                <dl className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <dt>권장 최대 인원</dt>
                  <dd className="text-slate-200">{result.recommendedMaxParticipants}명</dd>
                  <dt>권장 모드</dt>
                  <dd className="text-slate-200">{LAYOUT_MODE_LABEL[result.recommendedMode]}</dd>
                  <dt>포트</dt>
                  <dd className="text-slate-200">
                    TCP {result.ports.signaling} / UDP·TCP {result.ports.media}
                  </dd>
                  <dt>UPnP</dt>
                  <dd className="text-slate-200">{result.upnpAvailable ? '사용 가능' : '사용 불가'}</dd>
                  <dt>CGNAT 의심</dt>
                  <dd className="text-slate-200">{result.cgnatSuspected ? '예' : '아니오'}</dd>
                </dl>
              </div>
            )}
          </Card>
          <Card title="수동 포트포워딩 안내">
            <p className="text-xs leading-relaxed text-slate-400">
              UPnP 가 없거나 실패하면 공유기 관리 페이지에서 다음 규칙을 이 PC 의 로컬 IP{result?.localIp ? ` (${result.localIp})` : ''} 로 추가하세요.
            </p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-slate-300">
              <li>TCP {settings?.signalingPort ?? 44330} → 시그널링</li>
              <li>UDP {settings?.mediaPort ?? 44331} → 미디어</li>
              <li>TCP {settings?.mediaPort ?? 44331} → 미디어(UDP 차단 대체)</li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">설정 후 회의 열기에서 “UPnP 건너뛰기” 를 선택하세요.</p>
          </Card>
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={() => go('host-setup')} disabled={running}>
              회의 열기로 이동
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}

const TITLE_FALLBACK: Record<DiagnosticStepKey, string> = {
  local: '로컬 IP와 공유기 탐지',
  publicIp: '공인 IPv4 확인',
  cgnat: 'CGNAT 의심 여부',
  upnp: 'UPnP 지원 여부',
  portMap: '포트 매핑',
  firewall: 'Windows 방화벽 안내',
  reachability: '외부 도달 가능성',
  bandwidth: '업로드 속도·RTT·패킷 손실',
  recommendation: '예상 지원 인원과 권장 화질'
}

const OVERALL: Record<string, string> = {
  green: '초록 — 외부 회의 가능',
  yellow: '노랑 — 외부 회의 가능, 제한 권장',
  red: '빨강 — 포트 접근 불가',
  gray: '회색 — 외부 회의 미지원 환경',
  pending: '검사 중',
  skipped: '-'
}
