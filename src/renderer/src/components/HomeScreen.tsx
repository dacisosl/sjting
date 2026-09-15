import { Activity, LogIn, Radio, Settings } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { Button, Card } from './ui'

export default function HomeScreen() {
  const { go, version, settings, hostStatus } = useAppStore()
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">SJTing</h1>
          <p className="text-xs text-slate-400">설치형 소규모 화상회의 · 방장 PC 가 서버 · 최대 20명</p>
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
        <Card title="회의 만들기 (방장)">
          <p className="mb-4 text-sm text-slate-400">
            이 PC 에서 회의 서버를 실행합니다. 공인 IPv4 와 UPnP 또는 수동 포트포워딩이 가능한 유선 가정망을 권장합니다.
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="primary" onClick={() => go('host-setup')}>
              <Radio size={16} /> 회의 열기
            </Button>
            <Button onClick={() => go('diagnostics')}>
              <Activity size={16} /> 네트워크 진단 먼저 하기
            </Button>
          </div>
          {hostStatus?.lastError && <p className="mt-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{hostStatus.lastError}</p>}
        </Card>

        <Card title="회의 참가">
          <p className="mb-4 text-sm text-slate-400">방장에게 받은 초대코드 또는 sjting:// 링크를 붙여넣어 접속합니다. 회원가입은 필요하지 않습니다.</p>
          <Button variant="primary" onClick={() => go('join')}>
            <LogIn size={16} /> 초대코드로 참가
          </Button>
        </Card>

        <Card title="지원 조건 요약">
          <ul className="space-y-1.5 text-xs text-slate-400">
            <li>· 방장: 공인 IPv4, UPnP 또는 수동 포트포워딩, 방화벽 허용</li>
            <li>· 방장 회선: 20명 발표 모드 업로드 200Mbps 이상 권장</li>
            <li>· 방장 PC: 4코어 8스레드, RAM 16GB 이상 권장</li>
            <li>· CGNAT·기관 방화벽·카페 와이파이에서는 방장 기능 미지원</li>
            <li>· 기본 포트: TCP 44330 (시그널링), UDP/TCP 44331 (미디어)</li>
            <li>· MVP 는 IPv4 전용, TURN·모바일·브라우저 참가 미지원</li>
          </ul>
        </Card>
      </main>
    </div>
  )
}
