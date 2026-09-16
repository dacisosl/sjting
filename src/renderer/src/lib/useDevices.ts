import { useEffect, useState } from 'react'

export interface DeviceLists {
  mics: MediaDeviceInfo[]
  cameras: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
}

const EMPTY: DeviceLists = { mics: [], cameras: [], speakers: [] }

export async function listDevices(): Promise<DeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return {
    mics: all.filter((d) => d.kind === 'audioinput'),
    cameras: all.filter((d) => d.kind === 'videoinput'),
    speakers: all.filter((d) => d.kind === 'audiooutput')
  }
}

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
