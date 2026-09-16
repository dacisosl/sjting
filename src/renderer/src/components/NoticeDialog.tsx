import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Button, Card } from './ui'

/** 첫 실행 안내: 처리 정보, 서버 경유, 사용량 한도 */
export default function NoticeDialog() {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <Card title="SJTing 사용 전 안내" className="max-w-2xl">
        <ul className="space-y-3 text-sm leading-relaxed text-slate-300">
          <li>
            <b className="text-slate-100">설정 없이 바로.</b> 공유기·포트 설정이 필요 없습니다. 회의 만들기 버튼을 누르고 초대 링크를 보내면 끝입니다. 참가자는 링크만 붙여넣습니다.
          </li>
          <li>
            <b className="text-slate-100">영상 경로.</b> 영상·음성은 Cloudflare 의 실시간 중계 서버를 거쳐 전달되며 저장되지 않습니다. 채팅은 회의가 열려 있는 동안만 서버 메모리에 남고 회의 종료 시 삭제됩니다.
          </li>
          <li>
            <b className="text-slate-100">무료 사용량.</b> 이 서비스는 운영자의 무료 한도 안에서 제공됩니다. 한 달 한도를 다 쓰면 그 달에는 새 회의를 만들 수 없고, 다음 달 1일에 다시 열립니다.
          </li>
          <li>
            <b className="text-slate-100">초대 링크 관리.</b> 링크를 가진 사람은 누구나 들어올 수 있습니다. 신뢰하는 사람에게만 보내고, 유출이 의심되면 방장이 재발급하세요. 방장은 입장 잠금·강퇴를 할 수 있습니다.
          </li>
          <li>
            <b className="text-slate-100">저장되는 정보.</b> 표시 이름, 장치 선택, 서버 주소만 이 PC 에 저장합니다. 로그에는 토큰·채팅·미디어 내용을 남기지 않습니다.
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
