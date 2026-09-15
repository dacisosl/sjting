import { useEffect, useState } from 'react'
import { listDevices, type DeviceLists } from './media'

const EMPTY: DeviceLists = { mics: [], cameras: [], speakers: [] }

/** 장치 목록을 구독하고 연결/분리를 감지한다 */
export function useDevices(): DeviceLists {
  const [devices, setDevices] = useState<DeviceLists>(EMPTY)
  useEffect(() => {
    let alive = true
    const refresh = () => void listDevices().then((d) => alive && setDevices(d)).catch(() => undefined)
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])
  return devices
}
