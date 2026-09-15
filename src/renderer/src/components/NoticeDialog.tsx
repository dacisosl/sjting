import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Button, Card } from './ui'

/** 첫 실행 안내 (계획서 9장): 처리 정보, 외부 IP 노출, 방장 책임과 네트워크 한계 */
export default function NoticeDialog() {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <Card title="SJTing 사용 전 안내" className="max-w-2xl">
        <ul className="space-y-3 text-sm leading-relaxed text-slate-300">
          <li>
            <b className="text-slate-100">서버 없는 구조.</b> 회의를 만드는 사람(방장)의 PC 가 회의 서버 역할을 합니다. 영상·음성·채팅은 외부 서비스에 저장되지 않고 방장 PC 를 거쳐 실시간으로만 전달됩니다.
          </li>
          <li>
            <b className="text-slate-100">공인 IP 노출.</b> 초대코드에는 방장의 공인 IP 주소와 포트가 포함됩니다. 초대코드는 신뢰하는 사람에게만 전달하고, 유출이 의심되면 즉시 재발급하세요.
          </li>
          <li>
            <b className="text-slate-100">네트워크 한계.</b> 통신사 CGNAT, 회사·학교 방화벽, 공유기 설정 권한이 없는 환경에서는 외부 회의를 열 수 없습니다. 이 앱은 모든 네트워크에서의 접속을 보장하지 않습니다.
          </li>
          <li>
            <b className="text-slate-100">방장 책임.</b> 방장 PC 가 종료되거나 네트워크가 바뀌면 회의가 종료됩니다. 앱은 회의 중 PC 잠자기를 방지합니다.
          </li>
          <li>
            <b className="text-slate-100">저장되는 정보.</b> 표시 이름, 장치 선택, 포트 설정, 이전 회의의 업로드 측정값만 이 PC 에 저장합니다. 로그에는 토큰·전체 IP·채팅·미디어 내용을 남기지 않습니다.
          </li>
        </ul>
        <div className="mt-6 flex justify-end">
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await updateSettings({ acceptedNotice: true })
            }}
          >
            이해했습니다
          </Button>
        </div>
      </Card>
    </div>
  )
}
