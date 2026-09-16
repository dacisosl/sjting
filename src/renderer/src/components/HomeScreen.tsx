import { useEffect, useState } from 'react'
import { Download, LogIn, Radio, Settings } from 'lucide-react'
import type { ServerHealth } from '@shared/types'
import { getHealth } from '../lib/api'
import { IS_ELECTRON, IS_WEB, platform } from '../platform'
import { useAppStore } from '../store/appStore'
import { Badge, Button, Card } from './ui'

/** "1.2.3" 형태 비교: a < b 이면 음수 */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export default function HomeScreen() {
  const { go, version, settings } = useAppStore()
  const [health, setHealth] = useState<ServerHealth | null | 'error'>(null)

  useEffect(() => {
    if (!settings) return
    let alive = true
    getHealth(settings.serverUrl)
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setHealth('error'))
    return () => {
      alive = false
    }
  }, [settings])

  const ok = health && health !== 'error' ? health : null
  const usagePct = ok ? Math.min(100, Math.round((ok.usage.usedMinutes / ok.usage.budgetMinutes) * 100)) : null
  const needsUpdate = IS_ELECTRON && ok && version && compareVersion(version, ok.minAppVersion) < 0

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">SJTing</h1>
          <p className="text-xs text-slate-400">설정 없이 바로 쓰는 소규모 화상회의 · 최대 20명 · {IS_WEB ? '웹' : '설치형'}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {settings?.displayName && <span>{settings.displayName}</span>}
          <span>v{version}</span>
          <Button variant="ghost" onClick={() => go('settings')} title="설정">
            <Settings size={16} />
          </Button>
        </div>
      </header>

      {needsUpdate && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/15 px-6 py-2 text-xs text-amber-200">
          <span>이 앱 버전(v{version})은 서버가 요구하는 최소 버전(v{ok!.minAppVersion})보다 낮습니다. 회의가 정상 동작하지 않을 수 있습니다.</span>
          <Button onClick={() => void platform.openExternal('https://github.com/dacisosl/sjting/releases')}>
            <Download size={14} /> 업데이트 받기
          </Button>
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 gap-5 overflow-auto p-6 md:grid-cols-3">
        <Card title="회의 만들기">
          <p className="mb-4 text-sm text-slate-400">버튼 하나로 방을 만들고 초대 링크를 보내세요. 공유기나 포트 설정은 필요 없습니다.</p>
          <Button variant="primary" className="w-full" onClick={() => go('create')} disabled={health === 'error'}>
            <Radio size={16} /> 회의 만들기
          </Button>
        </Card>

        <Card title="회의 참가">
          <p className="mb-4 text-sm text-slate-400">받은 초대 링크를 {IS_WEB ? '클릭하면 바로 이 페이지로 옵니다. 링크를 붙여넣어도 됩니다.' : '클릭하거나 초대코드를 붙여넣어 접속합니다.'} 회원가입은 없습니다.</p>
          <Button variant="primary" className="w-full" onClick={() => go('join')}>
            <LogIn size={16} /> 초대 링크로 참가
          </Button>
        </Card>

        <Card title="서버 상태">
          {health === null && <p className="text-sm text-slate-400">확인 중…</p>}
          {health === 'error' && (
            <div className="space-y-2">
              <Badge level="red">연결 불가</Badge>
              <p className="text-xs text-slate-400">회의 서버({settings?.serverUrl})에 연결할 수 없습니다. 인터넷 연결을 확인하세요.</p>
            </div>
          )}
          {ok && (
            <div className="space-y-2 text-xs text-slate-400">
              <Badge level={usagePct !== null && usagePct >= 90 ? 'yellow' : 'green'}>정상 · 서버 v{ok.version}</Badge>
              <p>
                이번 달({ok.usage.month}) 무료 사용량 {usagePct}% 사용
              </p>
              <div className="h-1.5 w-full rounded bg-slate-800">
                <div className="h-1.5 rounded bg-sky-500" style={{ width: `${usagePct}%` }} />
              </div>
              <p>사용량은 참가자 수 × 회의 시간으로 계산합니다. 한도를 넘으면 다음 달 1일까지 새 회의를 만들 수 없습니다.</p>
              {IS_WEB && (
                <p className="pt-1">
                  화면공유를 자주 하거나 링크 클릭으로 바로 열리길 원하면{' '}
                  <a className="text-sky-400 underline" href="https://github.com/dacisosl/sjting/releases" target="_blank" rel="noreferrer">
                    설치형 앱
                  </a>
                  도 있습니다. 같은 회의에 함께 들어옵니다.
                </p>
              )}
            </div>
          )}
        </Card>
      </main>
    </div>
  )
}
