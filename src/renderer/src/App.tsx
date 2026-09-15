import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { useMeetingStore } from './store/meetingStore'
import HomeScreen from './components/HomeScreen'
import DiagnosticsScreen from './components/DiagnosticsScreen'
import HostSetupScreen from './components/HostSetupScreen'
import JoinScreen from './components/JoinScreen'
import SettingsScreen from './components/SettingsScreen'
import MeetingRoom from './components/MeetingRoom'
import NoticeDialog from './components/NoticeDialog'
import { Spinner } from './components/ui'

export default function App() {
  const { screen, settings, setSettings, setHostStatus, setPendingInvite, setVersion, go } = useAppStore()
  const phase = useMeetingStore((s) => s.phase)

  useEffect(() => {
    void window.sjting.settings.get().then(setSettings)
    void window.sjting.app.getVersion().then(setVersion)
    void window.sjting.host.getStatus().then(setHostStatus)
    const offStatus = window.sjting.host.onStatus(setHostStatus)

    const handleLink = async (link: string) => {
      try {
        const payload = await window.sjting.invite.parse(link)
        setPendingInvite(payload, link)
        if (useMeetingStore.getState().phase === 'idle' || useMeetingStore.getState().phase === 'ended') go('join')
      } catch {
        /* 잘못된 링크는 무시 */
      }
    }
    const offLink = window.sjting.app.onDeepLink((l) => void handleLink(l))
    void window.sjting.app.getPendingDeepLink().then((l) => {
      if (l) void handleLink(l)
    })
    return () => {
      offStatus()
      offLink()
    }
  }, [setSettings, setHostStatus, setPendingInvite, setVersion, go])

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (!settings.acceptedNotice) return <NoticeDialog />

  if (screen === 'meeting' || (phase !== 'idle' && phase !== 'ended')) return <MeetingRoom />

  switch (screen) {
    case 'diagnostics':
      return <DiagnosticsScreen />
    case 'host-setup':
      return <HostSetupScreen />
    case 'join':
      return <JoinScreen />
    case 'settings':
      return <SettingsScreen />
    default:
      return <HomeScreen />
  }
}
