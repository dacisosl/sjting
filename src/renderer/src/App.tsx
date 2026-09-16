import { useEffect } from 'react'
import { platform } from './platform'
import { useAppStore } from './store/appStore'
import { useMeetingStore } from './store/meetingStore'
import HomeScreen from './components/HomeScreen'
import CreateRoomScreen from './components/CreateRoomScreen'
import JoinScreen from './components/JoinScreen'
import SettingsScreen from './components/SettingsScreen'
import MeetingRoom from './components/MeetingRoom'
import NoticeDialog from './components/NoticeDialog'
import { Spinner } from './components/ui'

export default function App() {
  const { screen, settings, setSettings, setPendingInvite, setVersion, go } = useAppStore()
  const phase = useMeetingStore((s) => s.phase)

  useEffect(() => {
    void platform.settings.get().then(setSettings)
    void platform.getVersion().then(setVersion)

    const handleLink = async (link: string) => {
      try {
        const payload = await platform.invite.parse(link)
        setPendingInvite(payload, link)
        const ph = useMeetingStore.getState().phase
        if (ph === 'idle' || ph === 'ended') go('join')
      } catch {
        /* 잘못된 링크는 무시 */
      }
    }
    const offLink = platform.onDeepLink((l) => void handleLink(l))
    void platform.getPendingDeepLink().then((l) => {
      if (l) void handleLink(l)
    })
    return () => offLink()
  }, [setSettings, setPendingInvite, setVersion, go])

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
    case 'create':
      return <CreateRoomScreen />
    case 'join':
      return <JoinScreen />
    case 'settings':
      return <SettingsScreen />
    default:
      return <HomeScreen />
  }
}
