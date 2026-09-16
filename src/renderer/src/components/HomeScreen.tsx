import { useEffect, useState } from 'react'
import { LogIn, Radio, Settings } from 'lucide-react'
import type { ServerHealth } from '@shared/types'
import { getHealth } from '../lib/api'
import { useAppStore } from '../store/appStore'
import { Badge, Button, Card } from './ui'

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

  const usagePct = health && health !== 'error' ? Math.min(100, Math.round((health.usage.usedMinutes / health.usage.budgetMinutes) * 100)) : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">SJTing</h1>
          <p className="text-xs text-slate-400">설치형 소규모 화상회의 · 설정 없이 바로 · 최대 20명</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {settings?.displayName && <span>{settings.displayName}</span>}
          <span>v{version}</span>
          <Button variant="ghost" onClick={() => go('settings')} title="설정">
            <Settings size={16} />
          </Button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-5 overflow-auto p-6 md:grid-cols-3">
        <Card title="회의 만들기">
          <p className="mb-4 text-sm text-slate-400">버튼 하나로 방을 만들고 초대 링크를 보내세요. 공유기나 포트 설정은 필요 없습니다.</p>
          <Button variant="primary" className="w-full" onClick={() => go('create')} disabled={health === 'error'}>
            <Radio size={16} /> 회의 만들기
          </Button>
        </Card>

        <Card title="회의 참가">
          <p className="mb-4 text-sm text-slate-400">받은 초대 링크(sjting://…)를 클릭하거나 초대코드를 붙여넣어 접속합니다. 회원가입은 없습니다.</p>
          <Button variant="primary" className="w-full" onClick={() => go('join')}>
            <LogIn size={16} /> 초대코드로 참가
          </Button>
        </Card>

        <Card title="서버 상태">
          {health === null && <p className="text-sm text-slate-400">확인 중…</p>}
          {health === 'error' && (
            <div className="space-y-2">
              <Badge level="red">연결 불가</Badge>
              <p className="text-xs text-slate-400">회의 서버({settings?.serverUrl})에 연결할 수 없습니다. 인터넷 연결을 확인하거나 설정에서 서버 주소를 확인하세요.</p>
            </div>
          )}
          {health && health !== 'error' && (
            <div className="space-y-2 text-xs text-slate-400">
              <Badge level={usagePct !== null && usagePct >= 90 ? 'yellow' : 'green'}>정상 · 서버 v{health.version}</Badge>
              <p>
                이번 달({health.usage.month}) 무료 사용량 {usagePct}% 사용
              </p>
              <div className="h-1.5 w-full rounded bg-slate-800">
                <div className="h-1.5 rounded bg-sky-500" style={{ width: `${usagePct}%` }} />
              </div>
              <p>사용량은 참가자 수 × 회의 시간으로 계산합니다. 한도를 넘으면 다음 달 1일까지 새 회의를 만들 수 없습니다.</p>
            </div>
          )}
        </Card>
      </main>
    </div>
  )
}
